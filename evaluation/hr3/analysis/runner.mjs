import { Worker } from 'node:worker_threads';
import { mkdir, readFile, open, unlink } from 'node:fs/promises';
import { resolve, join, relative } from 'node:path';
import { pathToFileURL } from 'node:url';
import { allCells, FROZEN, CANDIDATE_CHOICES, ALLOCATIONS } from './design.mjs';
import { monteCarlo } from './statistics.mjs';
import { boundaryChecks } from './boundary.mjs';
import { implementationManifest, canonical, hash, atomicJSON, loadDataset, storeDataset, ROOT } from './storage.mjs';

export function configuration(options = {}) {
  const known = new Set(['engineeringSmoke', 'datasets', 'draws', 'cells', 'workers', 'out', 'seed', 'stopAfter']);
  if (Object.keys(options).some(k => !known.has(k))) throw Error('Unknown runner option');
  const smoke = options.engineeringSmoke === true, full = allCells();
  const datasets = options.datasets ?? FROZEN.datasets, draws = options.draws ?? FROZEN.draws, workers = options.workers ?? 1;
  if (![datasets, draws, workers].every(Number.isInteger) || datasets < 1 || datasets > FROZEN.datasets || draws < 2 || draws > FROZEN.draws || workers < 1 || workers > 4) throw Error('Invalid dataset/draw/worker count (maximum 4 workers)');
  const wanted = options.cells ?? full.map(c => c.id);
  if (!Array.isArray(wanted) || !wanted.length || new Set(wanted).size !== wanted.length || wanted.some(id => !full.some(c => c.id === id))) throw Error('Unknown/empty/duplicate cells');
  const cells = full.filter(c => wanted.includes(c.id));
  if (!smoke && (datasets !== FROZEN.datasets || draws !== FROZEN.draws || cells.length !== full.length || options.seed !== undefined)) throw Error('Reduced/modified grids require explicit --engineering-smoke; output will be non-certifying');
  if (options.stopAfter !== undefined && (!Number.isInteger(options.stopAfter) || options.stopAfter < 1)) throw Error('Invalid stopAfter checkpoint limit');
  const out = resolve(options.out ?? join(ROOT, 'reports', smoke ? 'smoke' : 'full'));
  if (relative(ROOT, out).startsWith('..') || out === ROOT) throw Error('Outputs must be below analysis/');
  return { engineeringSmoke: smoke, datasets, draws, cells, workers, out, seed: options.seed ?? 'hr3-validation-v1', stopAfter: options.stopAfter };
}
function cellSummary(cell, rows, planned) {
  const n = rows.length, dimensions = rows[0]?.primary.names ?? [];
  return { design: cell, plannedDatasets: planned, completedDatasets: n, status: n === planned ? 'complete' : 'incomplete',
    independentConditionalCoverageBenchmark: cell.kind === 'coverage' || cell.icc === 0,
    decisions: n && cell.kind === 'power' ? Object.fromEntries(['Advance', 'Keep U', 'Inconclusive'].map(d => [d, monteCarlo(rows.filter(r => r.decision === d).length, n)])) : null,
    coverage: dimensions.map((name, j) => ({ name, ...monteCarlo(rows.filter(r => r.coverage[j]).length, n),
      auditFlag: monteCarlo(rows.filter(r => r.coverage[j]).length, n).wilson95[1] < .95 ? 'investigate-undercoverage' : null })),
    lineageCoverage: n && cell.kind === 'power' ? dimensions.map((name, j) => ({ name, ...monteCarlo(rows.filter(r => r.lineageCoverage[j]).length, n) })) : null,
    datasets: rows.map(r => ({ index: r.index, artifact: `datasets/${cell.id}/${String(r.index).padStart(4, '0')}.json`, replicateSHA256: r.replicateArtifact.sha256 })) };
}
export async function run(options = {}, log = console.error) {
  const fingerprintStart = performance.now();
  const config = configuration(options), implementation = await implementationManifest();
  const timings = { fingerprintMs: performance.now() - fingerprintStart, checkpointScanMs: 0, datasetIOMs: 0, manifestIOMs: 0, workerStartupMs: 0 };
  const identity = { version: 'hr3-analysis-v1', implementation, engineeringSmoke: config.engineeringSmoke, datasets: config.datasets, draws: config.draws,
    cells: config.cells, seed: config.seed, bootstrapSeed: FROZEN.bootstrapSeed, frozen: FROZEN, allocations: ALLOCATIONS, candidateChoices: CANDIDATE_CHOICES };
  const identitySHA256 = hash(canonical(identity)), manifestPath = join(config.out, 'manifest.json');
  await mkdir(config.out, { recursive: true });
  const lockPath = join(config.out, 'runner.lock'), lock = await open(lockPath, 'wx');
  await lock.writeFile(JSON.stringify({ pid: process.pid, started: new Date().toISOString() }));
  const workers = [], rows = new Map(config.cells.map(c => [c.id, []])), dirty = new Set(config.cells.map(c => c.id)), summaries = new Map();
  let interrupted = false, lastProgress = Date.now(), lastActivity = Date.now(), completedThisRun = 0, timer;
  const interrupt = () => { interrupted = true; log('Stopping dispatch; checkpointing active datasets.'); };
  process.on('SIGINT', interrupt); process.on('SIGTERM', interrupt);
  const manifest = { ...identity, identitySHA256, certificationEligible: false,
    certificationBlockers: ['Candidate design choices require prospective review; full §15 acceptance and material-undercoverage review remain external gates.', ...(config.engineeringSmoke ? ['ENGINEERING SMOKE: reduced or explicitly non-certifying run.'] : [])],
    status: 'incomplete', started: new Date().toISOString(), updated: null, runtime: { node: process.version, workers: config.workers, timings }, boundarySupplements: boundaryChecks(), cells: [] };
  const save = async () => {
    const saveStart = performance.now();
    manifest.updated = new Date().toISOString();
    await mkdir(join(config.out, 'cells'), { recursive: true });
    for (const c of config.cells) if (dirty.has(c.id)) {
      dirty.delete(c.id);
      const full = cellSummary(c, rows.get(c.id).sort((a, b) => a.index - b.index), config.datasets);
      const resultArtifact = `cells/${c.id}.json`;
      await atomicJSON(join(config.out, resultArtifact), full);
      const { datasets: _datasets, ...summary } = full;
      summaries.set(c.id, { ...summary, resultArtifact, resultSHA256: hash(canonical(full)) });
    }
    manifest.cells = config.cells.map(c => summaries.get(c.id));
    await atomicJSON(manifestPath, manifest);
    timings.manifestIOMs += performance.now() - saveStart;
  };
  try {
    const old = await readFile(manifestPath, 'utf8').then(JSON.parse, e => { if (e.code === 'ENOENT') return null; throw e; });
    if (old && old.identitySHA256 !== identitySHA256) throw Error('Resume refused: implementation, authority or design hash mismatch');
    if (old) manifest.started = old.started;
    const scanStart = performance.now();
    const pending = [];
    for (const cell of config.cells) for (let index = 0; index < config.datasets; index++) {
      const summary = await loadDataset(config.out, cell, index, config.draws, identitySHA256);
      if (summary) rows.get(cell.id).push(summary); else pending.push({ cell, index, options: { draws: config.draws, seed: config.seed } });
      if (index % 1000 === 999) log(`checkpoint scan ${cell.id}: ${index + 1}/${config.datasets}`);
    }
    timings.checkpointScanMs = performance.now() - scanStart;
    await save();
    lastProgress = Date.now(); lastActivity = lastProgress;
    log(`Loaded ${[...rows.values()].reduce((s, a) => s + a.length, 0)} datasets; ${pending.length} pending; ${config.workers} workers; certificationEligible=false.`);
    let next = 0, writeQueue = Promise.resolve(), lastManifest = Date.now();
    const checkpoint = async (job, result) => {
      const ioStart = performance.now();
      const summary = await storeDataset(config.out, job, result, identitySHA256);
      timings.datasetIOMs += performance.now() - ioStart;
      rows.get(job.cell.id).push(summary); dirty.add(job.cell.id); completedThisRun++; lastProgress = Date.now(); lastActivity = lastProgress;
      // Dataset commits are authoritative. Periodic/cell-completion manifest
      // updates avoid rewriting the entire growing result index per dataset.
      if (lastProgress - lastManifest >= 30000 || rows.get(job.cell.id).length === config.datasets) {
        lastManifest = lastProgress; writeQueue = writeQueue.then(save); await writeQueue;
      }
      log(`checkpoint ${job.cell.id}/${job.index}: primary=${(summary.timings.primaryMs / 1000).toFixed(3)}s lineage=${(summary.timings.lineageMs / 1000).toFixed(3)}s`);
    };
    const active = new Map();
    let stallError;
    timer = setInterval(() => {
      log(`progress completedThisRun=${completedThisRun} active=${JSON.stringify([...active.values()])} idleSinceCheckpointMs=${Date.now() - lastProgress} idleSinceDrawActivityMs=${Date.now() - lastActivity}`);
      if (active.size && Date.now() - lastActivity > 300000) {
        stallError = Error('Five minutes without a checkpoint or actual draw progress; stop and investigate activity before resuming');
        interrupted = true; for (const w of workers) w.terminate();
      }
    }, 30000);
    async function lane() {
      const workerStart = performance.now();
      const worker = new Worker(new URL('./worker.mjs', import.meta.url)); workers.push(worker);
      worker.once('online', () => { timings.workerStartupMs += performance.now() - workerStart; });
      while (!interrupted && next < pending.length && (config.stopAfter === undefined || next < config.stopAfter)) {
        const job = pending[next++]; active.set(worker.threadId, { cell: job.cell.id, index: job.index });
        const result = await new Promise((resolveJob, reject) => {
          const cleanup = () => { worker.off('message', message); worker.off('error', error); worker.off('exit', onExit); };
          const message = m => {
            if (m.progress) { lastActivity = Date.now(); active.set(worker.threadId, { cell: job.cell.id, index: job.index, ...m.progress }); return; }
            cleanup(); m.error ? reject(Error(m.error)) : resolveJob(m.result);
          };
          const error = e => { cleanup(); reject(e); };
          const onExit = code => { cleanup(); reject(stallError ?? Error(`Worker exited ${code} before completion`)); };
          worker.on('message', message); worker.once('error', error); worker.once('exit', onExit); worker.postMessage(job);
        });
        active.delete(worker.threadId); await checkpoint(job, result);
      }
    }
    const results = await Promise.allSettled(Array.from({ length: config.workers }, () => lane().catch(e => {
      interrupted = true; log(`Worker lane failed: ${e.message}; stopping new dispatch.`); throw e;
    })));
    for (const r of results) if (r.status === 'rejected') throw r.reason;
    await writeQueue;
    manifest.status = [...rows.values()].every(a => a.length === config.datasets) ? 'complete' : 'incomplete';
    manifest.interrupted = interrupted;
    await save();
    return manifest;
  } catch (e) {
    manifest.status = 'failed'; manifest.error = e.stack;
    // Never overwrite an incompatible existing manifest on a resume rejection.
    const current = await readFile(manifestPath, 'utf8').then(JSON.parse, () => null);
    if (!current || current.identitySHA256 === identitySHA256) await save();
    throw e;
  } finally {
    clearInterval(timer); await Promise.allSettled(workers.map(w => w.terminate()));
    process.off('SIGINT', interrupt); process.off('SIGTERM', interrupt);
    await lock.close(); await unlink(lockPath);
  }
}
export function parseArgs(argv) {
  const options = {}, numeric = new Set(['datasets', 'draws', 'workers', 'stop-after']);
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--engineering-smoke') { options.engineeringSmoke = true; continue; }
    if (!['--out', '--datasets', '--draws', '--cells', '--workers', '--seed', '--stop-after'].includes(arg) || argv[i + 1] === undefined) throw Error('Unknown/missing option ' + arg);
    const key = arg.slice(2), value = argv[++i], camel = key.replace(/-([a-z])/g, (_, c) => c.toUpperCase());
    options[camel] = key === 'cells' ? value.split(',') : numeric.has(key) ? Number(value) : value;
  }
  return options;
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const [major, minor] = process.versions.node.split('.').map(Number);
  try {
    if (major < 22 || (major === 22 && minor < 16)) throw Error('Node >=22.16 required');
    const manifest = await run(parseArgs(process.argv.slice(2)));
    console.error(`Run ${manifest.status}; certificationEligible=${manifest.certificationEligible}`);
    process.exitCode = manifest.interrupted ? 130 : 0;
  } catch (e) { console.error(e.stack); process.exitCode = 1; }
}

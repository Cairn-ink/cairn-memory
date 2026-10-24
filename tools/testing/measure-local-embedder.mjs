// Opt-in qualification only. No installer, fetch, package hooks or fallback.
import { readFile, readdir, stat, writeFile, rename, rm, mkdtemp } from 'node:fs/promises';
import { tmpdir, cpus, release } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { performance, monitorEventLoopDelay } from 'node:perf_hooks';
import { randomUUID } from 'node:crypto';
import { absolutePath, HASH, refusal } from '../../adapters/local-embedder/common.mjs';
import { verifyPack } from '../../adapters/local-embedder/pack.mjs';
import { localEmbeddingFactory } from '../../adapters/local-embedder/index.mjs';
import { startBundle } from '../../adapters/local-embedder/bundle.mjs';
import { childEnvironment } from '../../adapters/local-embedder/process.mjs';
import { validateVector } from '../../core/context-read-embedder.mjs';
import { LOCAL_OPERATIONAL_CODES } from '../../core/context-read-local-status.mjs';
export function parseLocalMeasurement(args) {
  try {
    const values = new Map(), flags = ['--pack', '--expected-manifest-sha256', '--output'];
    for (let i = 0; i < args.length; i += 2) {
      if (!flags.includes(args[i]) || values.has(args[i]) || !args[i + 1]) throw 0;
      values.set(args[i], args[i + 1]);
    }
    if (values.size !== 3 || !HASH.test(values.get('--expected-manifest-sha256'))) throw 0;
    return { packPath: absolutePath(values.get('--pack')), expectedHash: values.get('--expected-manifest-sha256'), output: absolutePath(values.get('--output')) };
  } catch { throw refusal('invalid_input'); }
}
const checked = value => { if (!value?.ok) throw refusal(value?.error?.code ?? 'measurement_failed'); return value.value; };
function timings(samples) {
  const sorted = [...samples].sort((a, b) => a - b);
  return { samples: samples.length, p50Ms: sorted[Math.max(0, Math.ceil(sorted.length * .5) - 1)] ?? null,
    p95Ms: sorted[Math.max(0, Math.ceil(sorted.length * .95) - 1)] ?? null };
}
async function directoryBytes(path) {
  let bytes = 0;
  for (const e of await readdir(path, { withFileTypes: true })) bytes += e.isDirectory() ? await directoryBytes(join(path, e.name)) : (await stat(join(path, e.name))).size;
  return bytes;
}
async function processRss(pid) {
  if (process.platform === 'linux') {
    const value = await readFile('/proc/' + pid + '/status', 'utf8');
    return Number(/^VmRSS:\s+(\d+) kB$/m.exec(value)?.[1] ?? 0) * 1024;
  }
  if (process.platform === 'darwin') {
    const { stdout } = await promisify(execFile)('/bin/ps', ['-o', 'rss=', '-p', String(pid)], { env: childEnvironment(), timeout: 2000, maxBuffer: 1024 });
    return Number(stdout.trim()) * 1024;
  }
  throw refusal('model_runtime_unavailable');
}
function rssMonitor() {
  let ids, peakInferenceBytes = 0, peakSupervisorBytes = 0, peakParentBytes = process.memoryUsage().rss, pending = Promise.resolve(), active = false;
  const sample = () => {
    if (!ids || active) return;
    active = true;
    pending = Promise.allSettled([processRss(ids.inferencePid), processRss(ids.supervisorPid)]).then(values => {
      if (values[0].status === 'fulfilled') peakInferenceBytes = Math.max(peakInferenceBytes, values[0].value);
      if (values[1].status === 'fulfilled') peakSupervisorBytes = Math.max(peakSupervisorBytes, values[1].value);
      peakParentBytes = Math.max(peakParentBytes, process.memoryUsage().rss); active = false;
    });
  };
  const timer = setInterval(sample, 25);
  return { start(value) { ids = value; sample(); }, async close() { clearInterval(timer); await pending; }, report() { return { peakInferenceBytes, peakSupervisorBytes, peakParentBytes, samplingMs: 25 }; } };
}
export async function measureLocalWorkload(pack, config, { start = startBundle, monitorRss = rssMonitor,
  crash = pid => process.kill(pid, 'SIGKILL') } = {}) {
  const workspace = await mkdtemp(join(tmpdir(), 'cairn-local-qualification-'));
  const monitor = monitorRss(), lag = monitorEventLoopDelay({ resolution: 10 }); lag.enable();
  let owner, core, bundle, ids;
  const report = { cache: 'no embedding cache; fresh synthetic canonical store', threads: 4, warmQuery: null, lookup: null, refresh: {}, failures: [] };
  const create = localEmbeddingFactory({ verify: async () => pack, start: async (p, threads) => {
    bundle = await start(p, threads, { onRegistration(value) { ids = value; monitor.start(value); } }); return bundle;
  } });
  const makeOwner = () => create({ packPath: config.packPath, threads: 4, maxRequests: 10000 });
  const namespace = { ownerId: 'local-qualification', scope: 'personal', projectId: null }, token = {}, grants = new WeakMap();
  const authority = { authorize(request, supplied) { if (supplied !== token) return null; const grant = {}, { input, ...binding } = request; grants.set(grant, { ...binding, accessGeneration: 1 }); return grant; }, isCurrent(grant) { return grants.get(grant) ?? null; } };
  const path = join(workspace, 'canonical.sqlite');
  try {
    const loadStart = performance.now(); owner = await makeOwner(); report.coldLoadMs = performance.now() - loadStart;
    const warm = [];
    for (let i = 0; i < 20; i++) { const start = performance.now(); const vectors = await owner.embedder.embed(['qualification smoke query ' + i]); validateVector(vectors[0], owner.embedder); warm.push(performance.now() - start); }
    report.warmQuery = timings(warm);
    const { openMemoryCore } = await import('../../core/contract.mjs');
    const open = () => openMemoryCore({ path,
      privateCards: { version: 'private-cards-local-v1', source: 'submitted-note-v1', storage: 'local-plain-v1', disclosure: 'explicit-submitted-note-v1', authority },
      contextRead: { version: 'context-read-v1', authority, embedder: owner.embedder, policy: owner.policy, localStatus: owner.localStatus } });
    core = open();
    const admit = text => checked(core.admit({ namespace, memory: { content: text, kind: 'fact' }, receipts: [{ client: 'qualification', sessionId: 'qualification', eventId: randomUUID(), role: 'user', excerpt: text }] }));
    const refresh = async () => {
      const started = performance.now(); let attempts = 0, embedded = 0, coverage;
      for (let i = 0; i < 32; i++) {
        const value = checked(await core.refreshContextIndex({ readSet: [namespace], types: ['memory', 'card'], intent: 'current', budget: { maxItems: 1024, maxMs: 5000 } }, token));
        attempts += value.progress.embeddingAttempts; embedded += value.progress.embedded; coverage = value.coverage;
        if (value.status === 'complete' && value.channels.semantic.state === 'ready') { const elapsedMs = performance.now() - started; return { elapsedMs, calls: i + 1, attempts, embedded, documentsPerSecond: embedded * 1000 / elapsedMs, coverage }; }
        if (value.progress.embeddingAttempts && !value.progress.embedded) throw refusal(value.channels.semantic.state);
      }
      throw refusal('measurement_failed');
    };
    for (let i = 0; i < 8; i++) admit('qualification short uncached document ' + i);
    report.refresh.short = await refresh();
    // Card bodies admit up to 20,000 characters; Memories admit only 4,000.
    // Leave room for title/newline and special tokens in the actual canonical
    // representation. The successful singleton result supplies its token count.
    const nearLimit = 'x '.repeat(8100).trim();
    const draft = checked(core.createCardDraft({ namespace, actionId: 'qualification-near-limit-draft', drafting: 'authored',
      input: { authoredInput: { text: 'Qualification fixture source', occurredAt: null }, title: 'qualification near limit', body: nearLimit } }, token));
    checked(core.confirmCardDraft({ namespace, cardId: draft.id, expectedRevision: draft.revision,
      actionId: 'qualification-near-limit-confirm', applicability: 'current' }, token));
    report.refresh.nearLimit = await refresh();
    report.refresh.nearLimit.tokenCount = bundle.diagnostics().lastTokenCount;
    if (report.refresh.nearLimit.tokenCount < 8000 || report.refresh.nearLimit.tokenCount > 8192) throw refusal('measurement_failed');
    try { await owner.embedder.embed(['x '.repeat(20000)]); throw refusal('measurement_failed'); }
    catch (e) { if (e.code !== 'context_item_too_large') throw e; report.tokenRefusal = 'context_item_too_large'; }
    const query = { readSet: [namespace], query: 'qualification', types: ['memory', 'card'], intent: 'current', semantic: true, deadlineMs: 5000 };
    const samples = [];
    for (let i = 0; i < 20; i++) { const start = performance.now(), value = checked(await core.findCandidates(query, token)); if (value.channels.semantic.state !== 'ready' || !value.items.length) throw refusal('measurement_failed'); samples.push(performance.now() - start); }
    report.lookup = timings(samples);
    crash(ids.inferencePid); await bundle.whenClosed();
    const degraded = checked(await core.findCandidates(query, token));
    if (!degraded.items.length || degraded.channels.semantic.state === 'ready') throw refusal('measurement_failed');
    core.close(); core = null; await owner.close(); owner = null;
    owner = await makeOwner(); core = open();
    const recovered = checked(await core.findCandidates(query, token));
    if (recovered.channels.semantic.state !== 'ready') throw refusal('measurement_failed');
    report.explicitReinitialization = 'ready'; report.diskBytes = await directoryBytes(config.packPath);
    await monitor.close(); report.rss = monitor.report();
    if (!report.rss.peakInferenceBytes || !report.rss.peakSupervisorBytes) throw refusal('measurement_failed');
    return report;
  } catch (e) { Object.defineProperty(e, 'measurement', { value: report }); throw e; }
  finally {
    lag.disable(); await monitor.close(); report.rss = monitor.report();
    report.eventLoopDelay = { meanMs: Number.isFinite(lag.mean) ? lag.mean / 1e6 : null, p95Ms: lag.percentile(95) / 1e6, maxMs: lag.max / 1e6 };
    try { core?.close(); } finally { await owner?.close(); await rm(workspace, { recursive: true, force: true }); }
  }
}
async function save(path, value) {
  const temp = join(dirname(path), '.cairn-measure-' + randomUUID() + '.json');
  try { await writeFile(temp, JSON.stringify(value, null, 2) + '\n', { flag: 'wx', mode: 0o600 }); await rename(temp, path); }
  finally { await rm(temp, { force: true }); }
}
export async function runLocalMeasurement(args, { verify = verifyPack, workload = measureLocalWorkload, write = save } = {}) {
  let config, output;
  const report = { ok: false, platform: process.platform, arch: process.arch, os: release(), node: process.versions.node,
    hardware: cpus()[0]?.model ?? 'unknown', libc: process.platform === 'linux' ? process.report.getReport().header.glibcVersionRuntime ?? 'unidentified' : null,
    commit: /^[a-f0-9]{40}$/.test(process.env.CAIRN_QUAL_COMMIT ?? '') ? process.env.CAIRN_QUAL_COMMIT : null, threads: 4, manifestHash: null, expectedManifestHash: null, workload: null };
  try {
    config = parseLocalMeasurement(args); output = config.output; report.expectedManifestHash = config.expectedHash;
    const start = performance.now(), pack = await verify(config.packPath); report.verificationMs = performance.now() - start;
    report.manifestHash = pack.manifestHash;
    if (pack.manifestHash !== config.expectedHash) throw refusal('model_pack_integrity');
    report.workload = await workload(pack, config); report.ok = true;
  } catch (e) {
    report.workload = e.measurement ?? null;
    const allowed = [...LOCAL_OPERATIONAL_CODES, 'invalid_input', 'provider_error', 'budget_denied', 'dimension_mismatch', 'context_item_too_large'];
    report.error = { code: allowed.includes(e?.code) ? e.code : 'measurement_failed', retryable: false };
    if (!output && args.filter(v => v === '--output').length === 1) { try { output = absolutePath(args[args.indexOf('--output') + 1]); } catch { /* No safe destination. */ } }
  }
  try { if (!output) return { exitCode: 1, report }; await write(output, report); }
  catch { return { exitCode: 1, report: { ...report, ok: false, error: { code: 'report_unavailable', retryable: false } } }; }
  return { exitCode: report.ok ? 0 : 1, report };
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const result = await runLocalMeasurement(process.argv.slice(2));
  if (result.exitCode) console.error('cairn_local_embedder_measurement_failed');
  process.exitCode = result.exitCode;
}

import { spawn } from 'node:child_process';
import { appendFileSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, isAbsolute, join, relative, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const compare = (a, b) => a < b ? -1 : a > b ? 1 : 0;

export function coreFiles(cwd = root) {
  return readdirSync(join(cwd, 'core/test'), { withFileTypes: true })
    .filter(entry => entry.isFile() && entry.name.endsWith('.test.mjs'))
    .map(entry => `core/test/${entry.name}`).sort(compare);
}

export function verifyPlan(files, shards) {
  const union = shards.flatMap(shard => shard.files).sort(compare);
  const expected = [...files].sort(compare);
  if (new Set(union).size !== union.length || union.length !== expected.length ||
      union.some((file, index) => file !== expected[index])) {
    throw new Error('shard coverage must be complete and disjoint');
  }
}

export function planShards(files, weights = {}, count = 6) {
  if (!Number.isSafeInteger(count) || count < 1) throw new Error('invalid shard count');
  if (!Array.isArray(files) || files.some(file => typeof file !== 'string' || !file) ||
      new Set(files).size !== files.length) throw new Error('invalid file list');
  if (!weights || typeof weights !== 'object' || Array.isArray(weights)) throw new Error('invalid weights map');
  for (const [file, weight] of Object.entries(weights)) {
    if (typeof weight !== 'number' || !Number.isFinite(weight) || weight < 0) {
      throw new Error(`invalid weight: ${file}`);
    }
  }
  const known = files.filter(file => Object.hasOwn(weights, file)).map(file => weights[file]).sort((a, b) => a - b);
  const middle = Math.floor(known.length / 2);
  const fallback = known.length ? (known.length % 2 ? known[middle] : known[middle - 1] / 2 + known[middle] / 2) : 1;
  const weightOf = file => Object.hasOwn(weights, file) ? weights[file] : fallback;
  const ordered = [...files].sort((a, b) => weightOf(b) - weightOf(a) || compare(a, b));
  const shards = Array.from({ length: count }, (_, index) => ({ index, files: [], total: 0 }));
  for (const file of ordered) {
    const target = [...shards].sort((a, b) => a.total - b.total || a.files.length - b.files.length || a.index - b.index)[0];
    target.files.push(file);
    target.total += weightOf(file);
    if (!Number.isFinite(target.total)) throw new Error('shard weight overflow');
  }
  verifyPlan(files, shards);
  return { shards, total: files.length, fallback };
}

function readJSON(file, fallback) {
  try { return JSON.parse(readFileSync(file, 'utf8')); }
  catch (error) { if (error.code === 'ENOENT') return fallback; throw error; }
}

export function validateFlakes(entries) {
  if (!Array.isArray(entries) || entries.some(entry => !entry || typeof entry.file !== 'string' ||
      !entry.file || typeof entry.reason !== 'string' || !entry.reason.trim()) ||
      new Set(entries.map(entry => entry.file)).size !== entries.length) throw new Error('invalid known flakes');
  return entries;
}

// Both normal shards and one-file reruns use the unchanged workspace/group
// runner. Reporter flags precede file arguments and pass straight to node --test.
export async function runFiles({ files, timingsFile, cwd = root, env = process.env, stdio = 'inherit' }) {
  if (!files.length) return { code: 0, signal: null }; // node --test with no files would discover the whole tree.
  const child = spawn(process.execPath, [join(root, 'tools/testing/run.mjs'),
    '--test-reporter=spec', '--test-reporter-destination=stdout',
    `--test-reporter=${join(root, 'tools/testing/file-timing-reporter.mjs')}`,
    `--test-reporter-destination=${timingsFile}`, ...files], { cwd, env, stdio });
  const handlers = new Map();
  let termination;
  for (const signal of ['SIGINT', 'SIGTERM', 'SIGHUP']) {
    const forward = () => { termination ??= signal; child.kill(signal); };
    handlers.set(signal, forward);
    process.on(signal, forward);
  }
  try {
    const result = await new Promise((resolveResult, reject) => {
      child.once('error', reject);
      child.once('close', (code, signal) => resolveResult({ code: code ?? 1, signal }));
    });
    return termination ? { code: { SIGINT: 130, SIGTERM: 143, SIGHUP: 129 }[termination], signal: termination } : result;
  } finally {
    for (const [signal, handler] of handlers) process.off(signal, handler);
  }
}

export function readTimings(file, cwd = root) {
  try {
    return readFileSync(file, 'utf8').split('\n').filter(line => line.trim()).map(line => {
      const record = JSON.parse(line);
      if (typeof record.file !== 'string' || !record.file || !['pass', 'fail'].includes(record.outcome) ||
          !Number.isFinite(record.durationMs) || record.durationMs < 0) throw new Error('invalid timing record');
      return { ...record, file: relative(cwd, isAbsolute(record.file) ? record.file : resolve(cwd, record.file)).split('\\').join('/') };
    });
  } catch { return null; } // Incomplete evidence must never authorize a rerun.
}

export async function executeShard({ files, outputDir, knownFlakes = [], cwd = root,
  env = process.env, log = console.log, run = runFiles }) {
  validateFlakes(knownFlakes);
  mkdirSync(outputDir, { recursive: true, mode: 0o700 });
  writeFileSync(join(outputDir, 'files.json'), `${JSON.stringify(files, null, 2)}\n`);
  const timingsFile = join(outputDir, 'timings.jsonl');
  writeFileSync(timingsFile, '');
  const result = await run({ files, timingsFile, cwd, env });
  const records = readTimings(timingsFile, cwd);
  let code = result.code;
  const reruns = [];
  if (code !== 0 && !result.signal) {
    const failing = [...new Set((records ?? []).filter(record => record.outcome === 'fail').map(record => record.file))].sort(compare);
    const observed = new Set((records ?? []).map(record => record.file));
    const allowed = new Set(knownFlakes.map(entry => entry.file));
    const complete = records !== null && files.every(file => observed.has(file)) && [...observed].every(file => files.includes(file));
    if (result.code === 1 && complete && failing.length && failing.every(file => allowed.has(file))) {
      code = 0;
      for (const [index, file] of failing.entries()) {
        const reason = knownFlakes.find(entry => entry.file === file).reason;
        log(`::warning::KNOWN-FLAKE RERUN (once, alone): ${file} — ${reason}`);
        const retry = await run({ files: [file], timingsFile: join(outputDir, `rerun-${index + 1}.jsonl`), cwd, env });
        reruns.push({ file, reason, code: retry.code });
        log(`KNOWN-FLAKE RERUN RESULT: ${file}: exit ${retry.code}`);
        if (retry.code !== 0) code = retry.code;
        if (retry.signal) break;
      }
    } else {
      log('Shard failed; no rerun: failure evidence is incomplete or includes an unlisted failure.');
    }
  }
  // Timing and summary publication are observational: an I/O failure here must
  // not replace the runner's exit status (in either direction).
  try {
    const weights = {};
    for (const record of records ?? []) weights[record.file] = (weights[record.file] ?? 0) + record.durationMs / 1000;
    writeFileSync(join(outputDir, 'weights.json'), `${JSON.stringify(weights, null, 2)}\n`);
    const summary = [`## Core shard (${files.length} files; exit ${code})`, '', '| File | Top-level seconds |', '| --- | ---: |',
      ...files.map(file => `| ${file} | ${Object.hasOwn(weights, file) ? weights[file].toFixed(3) : 'unavailable'} |`), '',
      ...reruns.map(retry => `**KNOWN-FLAKE RERUN**: ${retry.file} — ${retry.reason}; exit ${retry.code}`), '',
      '### File list', '', '```text', ...files, '```', ''].join('\n');
    writeFileSync(join(outputDir, 'summary.md'), summary);
    if (env.GITHUB_STEP_SUMMARY) appendFileSync(env.GITHUB_STEP_SUMMARY, summary);
  } catch (error) { log(`Timing publication failed: ${error.message}`); }
  return { code, records, reruns, timingsFile };
}

export async function main(args = process.argv.slice(2)) {
  let shard;
  let count;
  let list = false;
  for (let index = 0; index < args.length; index++) {
    const arg = args[index];
    if ((arg === '--shard' || arg === '--of') && /^[1-9]\d*$/.test(args[index + 1] ?? '')) {
      if (arg === '--shard' && shard === undefined) shard = Number(args[++index]);
      else if (arg === '--of' && count === undefined) count = Number(args[++index]);
      else throw new Error('duplicate option');
    } else if (arg === '--list' && !list) list = true;
    else throw new Error('usage: core-shards.mjs --shard K --of N [--list]');
  }
  if (!Number.isSafeInteger(shard) || !Number.isSafeInteger(count) || shard < 1 || shard > count) throw new Error('invalid shard selection');
  const plan = planShards(coreFiles(), readJSON(join(root, 'tools/testing/core-test-weights.json'), {}), count);
  const files = plan.shards[shard - 1].files;
  console.error(`Core plan: ${plan.total} files across ${count} disjoint shards; shard ${shard}: ${files.length} files`);
  if (list) { if (files.length) console.log(files.join('\n')); return 0; }
  const outputDir = process.env.CORE_SHARD_OUTPUT_DIR ?? mkdtempSync(join(tmpdir(), 'core-shard-'));
  console.log(`Timing artifacts: ${outputDir}`);
  const result = await executeShard({ files, outputDir, knownFlakes: readJSON(join(root, 'tools/testing/core-known-flakes.json'), []) });
  return result.code;
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  try { process.exitCode = await main(); }
  catch (error) { console.error(error); process.exitCode = 1; }
}

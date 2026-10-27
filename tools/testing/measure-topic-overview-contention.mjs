/**
 * E1-C phase 1, opt-in only. No production modules or journal defaults change.
 * PRE-REGISTERED, before collecting observations:
 *   five repetitions, fixed 30,000 ms windows; alternate journal and variant
 *   order each repetition. Each writer/reader pair has its own no-reader trial.
 *   DELETE bounded candidate, under writers committing no more often than once
 *   per 20 ms: zero storage_busy, reader p95 <=250 ms, writer commits/s >=90%
 *   of paired no-reader, writer public-call p95 <=250 ms. Report the p95 ratio
 *   too; there is no additional relative-latency gate. Never gate as-is or WAL.
 *   Report all failures, including cursor_stale, separately from storage_busy.
 *   Require reader attempts/successes and writer progress for a meaningful gate.
 *   Raw calls can contain several transactions: pace public calls, measure real
 *   COMMIT gaps, and label bursts ineligible for the commit-paced DELETE gate.
 *
 * Candidate: copy the reader's module closure to scratch and patch ONLY it. A
 * request-wide 250 ms monotonic budget starts at host dispatch, inside the
 * retained 5 s deadline. Before every native SQL execution/prepare, install the
 * remaining busy_timeout (rounded down). Query time also consumes this budget;
 * it cannot reset at each transaction. No retries, host waits, or public seam.
 * SQLite waits run in the existing Worker; close()/deadline still terminate it.
 * Budget exhaustion preserves native BUSY -> storage_busy, never empty success.
 * The candidate includes wrapper overhead; source and patched hashes are saved.
 *
 * Usage: npm run measure:topic-overview-contention -- --report /tmp/e1c.json
 * --plan: print protocol/matrix without running. --smoke: ONLY schema29/DELETE/
 * same-owner, one repetition, three 2 s windows; observations, no timing gates.
 * Default report: ./topic-overview-contention-report.json (outside scratch).
 * Full measurement belongs in the primary's machine-wide queue, never CI tests.
 */
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { chmodSync, copyFileSync, existsSync, mkdirSync, readFileSync, renameSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { monitorEventLoopDelay, performance } from 'node:perf_hooks';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';
import { isMainThread, parentPort, Worker, workerData } from 'node:worker_threads';
import { createTestWorkspace } from './workspace.mjs';
import { overlapPageReport } from './measure-contention.mjs';

const root = fileURLToPath(new URL('../../', import.meta.url));
export const PROTOCOL = Object.freeze({ repetitions: 5, windowMs: 30000, writerPauseMs: 20,
  candidateWaitMs: 250, requestDeadlineMs: 5000, memories: 1112, namespaces: 4, mocs: 71,
  candidateDesign: 'Temporary copy only; remaining native busy_timeout refreshed before SQL from one host-dispatch budget; no retry; includes proxy overhead',
  cachePolicy: 'Fresh store clone and fresh reader/writer Workers per trial; no reader warmup; first read includes Worker startup',
  eventLoopMonitorResolutionMs: 10,
  thresholds: { candidateDeleteStorageBusy: 0, readerP95Ms: 250,
    writerThroughputRatio: .9, writerP95Ms: 250 },
  readerRequest: 'Fresh readTopicOverview({namespace}) with default bounds; no outer retries or cursors',
  latencyPopulation: 'All attempts started inside the fixed window, including failures and final drain',
  throughputPopulation: 'Actual successful COMMIT executions finishing inside the fixed window',
  rawPacing: '20 ms after public-call completion; internal COMMIT bursts reported, not treated as commit-paced',
  rawModel: 'Scripted in-process rationaleModel fixture, synthetic local-plain port; no network or paid calls',
  baselinePairing: 'Fresh clones of the same closed seed, per schema/journal/writer/repetition; reverse journal and all variant orders on odd repetitions',
  cancellation: 'SIGINT/SIGTERM closes the reader and terminates the writer; request deadline and reader.close() retained in candidate',
  thresholdChanges: [],
});
export const namespaces = Object.freeze([
  { ownerId: 'overview-owner', scope: 'personal', projectId: null },
  { ownerId: 'overview-owner', scope: 'project', projectId: 'synthetic-one' },
  { ownerId: 'other-owner', scope: 'personal', projectId: null },
  { ownerId: 'other-owner', scope: 'project', projectId: 'synthetic-two' },
]);
export function parseArgs(args) {
  // The npm wrapper deletes its TMPDIR. Keep the default report outside it.
  const result = { smoke: false, plan: false, report: resolve('topic-overview-contention-report.json') };
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--smoke') result.smoke = true;
    else if (args[i] === '--plan') result.plan = true;
    else if (args[i] === '--report' && args[i + 1] && !args[i + 1].startsWith('--')) result.report = resolve(args[++i]);
    else throw Error('Usage: measure-topic-overview-contention.mjs [--plan] [--smoke] [--report PATH]');
  }
  return result;
}
export function buildTrialPlan({ smoke = false, schema18Available = true } = {}) {
  if (smoke) return ['no-reader', 'as-is', 'bounded'].map(variant =>
    ({ schema: 29, journal: 'DELETE', writer: 'same-owner', variant, repetition: 0, pair: '29:DELETE:same-owner:0', windowMs: 2000 }));
  const trials = [];
  for (let repetition = 0; repetition < PROTOCOL.repetitions; repetition++) {
    for (const schema of schema18Available ? [29, 18] : [29]) {
      for (const writer of ['none', 'same-owner', 'other-owner', ...(schema === 29 ? ['raw'] : [])]) {
        for (const journal of repetition % 2 ? ['WAL', 'DELETE'] : ['DELETE', 'WAL']) {
          const variants = writer === 'none' ? ['as-is', 'bounded'] : ['no-reader', 'as-is', 'bounded'];
          for (const variant of repetition % 2 ? variants.reverse() : variants) trials.push({
            schema, journal, writer, variant, repetition, pair: `${schema}:${journal}:${writer}:${repetition}`, windowMs: PROTOCOL.windowMs,
          });
        }
      }
    }
  }
  return trials;
}
export function latency(values) {
  const sorted = [...values].sort((a, b) => a - b);
  const at = p => sorted.length ? sorted[Math.ceil(sorted.length * p) - 1] : null;
  return { p50Ms: at(.5), p95Ms: at(.95), maxMs: sorted.at(-1) ?? null };
}
export function readerMetrics(attempts) {
  const failures = {};
  for (const call of attempts) if (call.code) failures[call.code] = (failures[call.code] ?? 0) + 1;
  const storageBusy = failures.storage_busy ?? 0;
  const { storage_busy: ignored, ...otherFailures } = failures;
  return { attempts: attempts.length, successes: attempts.filter(call => !call.code).length,
    completeOverviews: attempts.filter(call => call.complete).length,
    countsComplete: attempts.filter(call => call.countsComplete).length,
    storageBusy, storageBusyRate: attempts.length ? storageBusy / attempts.length : null,
    otherFailures, ...latency(attempts.map(call => call.elapsedMs)) };
}
const unwrap = result => { assert.equal(result.ok, true, JSON.stringify(result)); return result.value; };

// Dynamic imports keep SQLite out of this tool's link-time closure too.
export async function seedStore(path, schema, { memories = PROTOCOL.memories, mocs = PROTOCOL.mocs, onProgress = () => {} } = {}) {
  const { installOverviewLayout } = await import('../../core/testing/topic-overview-raw29-fixture.mjs');
  const { openMemoryCore } = await import('../../core/contract.mjs');
  installOverviewLayout(path, schema);
  const core = openMemoryCore({ path });
  try {
    for (let n = 0; n < namespaces.length; n++) {
      const namespace = namespaces[n], saved = [];
      let epoch;
      const count = Math.floor(memories / 4) + (n < memories % 4 ? 1 : 0);
      const topicCount = Math.floor(mocs / 4) + (n < mocs % 4 ? 1 : 0);
      assert.ok(count >= topicCount && topicCount >= 2);
      for (let i = 0; i < count; i++) {
        const content = `Synthetic E1-C namespace ${n} Memory ${i}.`;
        const value = unwrap(core.admit({ namespace, memory: { content, kind: 'fact' },
          receipts: [{ client: 'synthetic-e1c', sessionId: 'seed', eventId: `${n}-${i}`, role: 'user', excerpt: content }] }));
        saved.push(value.memory); epoch = value.indexRevision;
        if ((i + 1) % 64 === 0) {
          onProgress({ schema, namespace: n, admitted: i + 1, namespaceTarget: count });
          await delay(0); // Allow cancellation while seeding; outside measurement.
        }
      }
      const place = items => {
        const value = unwrap(core.applyPlacement({ namespace, expectedIndexRevision: epoch,
          expectedMemoryRevisions: items.map(item => ({ memoryId: item.memoryId, revision: 1 })), proposal: { items } }));
        epoch = value.indexRevision; return value;
      };
      const first = place([{ memoryId: saved[0].id, parentIds: [], newL1: {
        title: `Synthetic topic ${n}-0`, parentL2Ids: [], newL2Title: `Synthetic root ${n}` } }]);
      const rootId = first.createdMocs.find(moc => moc.level === 'L2').id;
      const l1 = [first.createdMocs.find(moc => moc.level === 'L1').id];
      for (let i = 1; i < topicCount - 1; i++) l1.push(place([{ memoryId: saved[i].id, parentIds: [], newL1: {
        title: `Synthetic topic ${n}-${i}`, parentL2Ids: [rootId] } }]).createdMocs[0].id);
      for (let i = topicCount - 1; i < saved.length; i += 5) place(saved.slice(i, i + 5).map((memory, offset) =>
        ({ memoryId: memory.id, parentIds: [l1[(i + offset) % l1.length]] })));
      onProgress({ schema, namespace: n, admitted: count, mocs: topicCount, complete: true });
    }
  } finally { core.close(); }
  chmodSync(path, 0o600);
  return inspectStore(path);
}
export async function inspectStore(path) {
  const { DatabaseSync } = await import('node:sqlite');
  const db = new DatabaseSync(path, { readOnly: true, timeout: 5000 });
  try {
    return { schema: db.prepare('PRAGMA user_version').get().user_version,
      memories: db.prepare('SELECT count(*) n FROM memories').get().n,
      mocs: db.prepare('SELECT count(*) n FROM mocs').get().n,
      namespaces: db.prepare('SELECT count(*) n FROM (SELECT DISTINCT owner_id,scope,project_id FROM memories)').get().n,
      rawAvailable: Boolean(db.prepare("SELECT 1 FROM sqlite_master WHERE name='raw_capture_events'").get()) };
  } finally { db.close(); }
}

function replaceOnce(source, before, after) {
  assert.equal(source.split(before).length, 2, `patch anchor must occur exactly once: ${before}`);
  return source.replace(before, after);
}
export function createCandidate(directory) {
  mkdirSync(directory, { mode: 0o700 });
  const copied = new Set(), sources = [];
  function visit(path) {
    if (copied.has(path)) return;
    assert.ok(path.startsWith(root) && path.endsWith('.mjs'), 'copy only repo module source');
    copied.add(path);
    const source = readFileSync(path, 'utf8'), file = relative(root, path), destination = join(directory, file);
    mkdirSync(dirname(destination), { recursive: true, mode: 0o700 });
    writeFileSync(destination, source, { mode: 0o600 });
    sources.push({ file, sha256: createHash('sha256').update(source).digest('hex') });
    for (const match of source.matchAll(/(?:from\s*|import\s*(?:\(\s*)?|new URL\(\s*)['"](\.[^'"]+\.mjs)['"]/g)) {
      visit(resolve(dirname(path), match[1]));
    }
  }
  visit(join(root, 'core/memory-reader.mjs'));
  visit(join(root, 'core/topic-overview-worker.mjs'));
  directory = join(directory, 'core');
  const patches = [
    ['memory-reader.mjs', [
      [': { ...request, deadlineAt: started + duration });', `: { ...request, deadlineAt: started + duration, __measurementLockDeadline: performance.now() + ${PROTOCOL.candidateWaitMs} });`],
    ]],
    ['topic-overview-worker.mjs', [
      ["const { deadlineAt, ...request } = message;", "const { deadlineAt, __measurementLockDeadline, ...request } = message;\n  globalThis.__measurementLockDeadline = __measurementLockDeadline;"],
    ]],
    ['read-database.mjs', [
      ["import { assertNoCardCurrentDependencies }", "import { performance } from 'node:perf_hooks';\nimport { measurementDatabase } from './measurement-database.mjs';\nimport { assertNoCardCurrentDependencies }"],
      ['db = topicPolicy ? topicPolicy.database(native, wal) : native;', 'native = measurementDatabase(native, performance);\n    db = topicPolicy ? topicPolicy.database(native, wal) : native;'],
      [' PRAGMA busy_timeout=${contextRead ? 5000 : 0};', ''],
    ]],
  ];
  const hashes = [];
  for (const [file, edits] of patches) {
    const original = readFileSync(join(directory, file), 'utf8');
    let patched = original;
    for (const [before, after] of edits) patched = replaceOnce(patched, before, after);
    writeFileSync(join(directory, file), patched, { mode: 0o600 });
    const hash = text => createHash('sha256').update(text).digest('hex');
    hashes.push({ file, originalSha256: hash(original), candidateSha256: hash(patched) });
  }
  // Every statement refreshes the SHARED remaining budget, including cached
  // prepared statements. Cache the installed value to avoid redundant PRAGMAs.
  writeFileSync(join(directory, 'measurement-database.mjs'), `
export function measurementDatabase(native, performance) {
  let installed;
  function configure() {
    const remaining = Math.max(0, Math.floor(globalThis.__measurementLockDeadline - performance.now()));
    if (!Number.isFinite(remaining)) throw Error('measurement deadline missing');
    if (remaining !== installed) { native.exec('PRAGMA busy_timeout=' + remaining); installed = remaining; }
  }
  function wrap(target, names) {
    return new Proxy(target, { get(object, key) {
      const value = Reflect.get(object, key, object);
      if (key === 'constructor' || typeof value !== 'function') return value;
      return (...args) => {
        if (names.includes(key)) configure();
        const result = Reflect.apply(value, object, args);
        return key === 'prepare' ? wrap(result, ['get', 'all', 'run', 'iterate']) : result;
      };
    } });
  }
  return wrap(native, ['exec', 'prepare']);
}
`, { mode: 0o600 });
  return { readerUrl: pathToFileURL(join(directory, 'memory-reader.mjs')).href, sources, patches: hashes,
    addedModuleSha256: createHash('sha256').update(readFileSync(join(directory, 'measurement-database.mjs'))).digest('hex') };
}

export async function openWriter(path, writer) {
  const { openMemoryCore } = await import('../../core/contract.mjs');
  if (writer !== 'raw') return openMemoryCore({ path });
  const { localPlainPort, splitRaw } = await import('../../core/testing/raw-fixtures.mjs');
  const { cardHost } = await import('../../core/testing/raw-source-fixtures.mjs');
  const { rationaleModel } = await import('../../core/testing/rationale-model.mjs');
  const core = openMemoryCore({ path, model: rationaleModel(), privateCards: cardHost().options,
    captureQualification: 'source-bound-v2', rawConversations: { mode: 'raw-v1', port: localPlainPort(),
      capBytes: 200000000, readPolicy: () => ({ generation: 'synthetic-e1c', reason: null }) } });
  return { ...core, splitRaw };
}
export async function publicWrite(core, kind, sequence) {
  const namespace = namespaces[kind === 'other-owner' ? 2 : 0];
  const content = `Synthetic E1-C public ${kind} write ${sequence}.`;
  if (kind === 'raw') {
    const value = unwrap(await core.captureRaw({ namespace, client: 'claude-code', sessionId: `capture-${sequence}`,
      eventId: `event-${sequence}`, messages: core.splitRaw(content, { id: `message-${sequence}` }) }));
    unwrap(value.interpretation);
  } else unwrap(core.admit({ namespace, memory: { content, kind: 'fact' },
    receipts: [{ client: 'synthetic-e1c', sessionId: 'writer', eventId: `write-${sequence}`, role: 'user', excerpt: content }] }));
}

async function writerThread(config) {
  const { DatabaseSync } = await import('node:sqlite');
  const keeper = new DatabaseSync(config.path, { timeout: 5000 });
  let core;
  const commits = [], calls = [];
  const originalExec = DatabaseSync.prototype.exec;
  let measuring = false;
  try {
    assert.equal(keeper.prepare(`PRAGMA journal_mode=${config.journal}`).get().journal_mode.toUpperCase(), config.journal);
    keeper.exec('PRAGMA synchronous=FULL');
    const pragmas = Object.fromEntries(['journal_mode', 'synchronous', 'page_size', 'cache_size', 'wal_autocheckpoint', 'busy_timeout']
      .map(name => [name, Object.values(keeper.prepare(`PRAGMA ${name}`).get())[0]]));
    // Instrument actual COMMITs without changing the public writer call path.
    // All public-writer connections use this native prototype in this Worker.
    const writerConnections = new Set();
    DatabaseSync.prototype.exec = function(sql) {
      writerConnections.add(this);
      const result = Reflect.apply(originalExec, this, [sql]);
      if (measuring && /^\s*COMMIT\s*;?\s*$/i.test(sql)) commits.push(performance.now());
      return result;
    };
    if (config.writer !== 'none') core = await openWriter(config.path, config.writer);
    const writerPragmas = [...writerConnections].filter(db => db.isOpen).map(db => Object.fromEntries(
      ['journal_mode', 'synchronous', 'page_size', 'cache_size', 'wal_autocheckpoint', 'busy_timeout']
        .map(name => [name, Object.values(db.prepare(`PRAGMA ${name}`).get())[0]])));
    for (const settings of writerPragmas) {
      assert.equal(settings.journal_mode.toUpperCase(), config.journal);
      assert.equal(settings.synchronous, 2, 'FULL durability on every writer connection');
    }
    parentPort.postMessage({ type: 'ready', pragmas, writerPragmas, sqlite: keeper.prepare('SELECT sqlite_version() version,sqlite_source_id() sourceId').get(),
      compileOptions: keeper.prepare('PRAGMA compile_options').all().map(row => row.compile_options) });
    const { startAt, endAt } = await new Promise(resolveStart => parentPort.once('message', resolveStart));
    await delay(Math.max(0, startAt - performance.now()));
    let sequence = 0, lastProgress = startAt;
    while (config.writer !== 'none' && performance.now() < endAt) {
      const startedAt = performance.now(), before = commits.length;
      let code;
      measuring = true;
      try { await publicWrite(core, config.writer, sequence++); }
      catch (error) { code = error.code ?? error.message; }
      finally { measuring = false; }
      const finishedAt = performance.now();
      calls.push({ startedAt, finishedAt, elapsedMs: finishedAt - startedAt, commits: commits.length - before, ...(code ? { code } : {}) });
      if (code) break; // No hidden writer retry or expensive automatic restart.
      if (finishedAt - lastProgress >= 1000) {
        parentPort.postMessage({ type: 'progress', calls: calls.length, commits: commits.length }); lastProgress = finishedAt;
      }
      const nextCallAt = finishedAt + PROTOCOL.writerPauseMs;
      // Timers may wake slightly early; enforce the minimum using an async wait.
      do { await delay(Math.max(1, nextCallAt - performance.now())); } while (performance.now() < nextCallAt);
    }
    if (config.writer === 'none') await delay(Math.max(0, endAt - performance.now()));
    parentPort.postMessage({ type: 'result', calls, commits, startAt, endAt, companionsBeforeClose: companionSizes(config.path) });
  } finally {
    DatabaseSync.prototype.exec = originalExec;
    core?.close(); keeper.close(); parentPort.close();
  }
}

const companionSizes = path => Object.fromEntries(['-wal', '-shm'].map(suffix => {
  try { return [suffix, statSync(path + suffix).size]; } catch (error) { if (error.code === 'ENOENT') return [suffix, 0]; throw error; }
}));
export async function runTrial(cell, path, candidate, { signal } = {}) {
  const actor = new Worker(new URL(import.meta.url), { workerData: { topicOverviewWriter: true, ...cell, path }, execArgv: [] });
  let reader, fatal, writerResult, readyInfo, writerProgress = { calls: 0, commits: 0 };
  let resolveReady;
  const ready = new Promise(resolve => { resolveReady = resolve; });
  actor.on('message', message => {
    if (message.type === 'ready') { readyInfo = message; resolveReady(); }
    if (message.type === 'progress') writerProgress = message;
    if (message.type === 'result') {
      writerResult = message;
      const failed = message.calls.find(call => call.code);
      if (failed) {
        fatal = Object.assign(Error(`public writer failed: ${failed.code}`), { evidence: message });
        console.error(JSON.stringify({ measurement: 'topic-overview-writer-failure', ...cell, call: failed }));
      }
    }
  });
  actor.on('error', error => { fatal = error; resolveReady(); });
  const exited = new Promise(resolveExit => actor.on('exit', code => {
    if (!writerResult) fatal ??= Error(`writer exited ${code} without a result`);
    resolveReady(); resolveExit(code);
  }));
  const attempts = [], histogram = monitorEventLoopDelay({ resolution: 10 });
  let samples, progress, watchdog;
  const onAbort = () => { fatal = Error('measurement cancelled'); void reader?.close(); void actor.terminate(); resolveReady(); };
  signal?.addEventListener('abort', onAbort, { once: true });
  if (signal?.aborted) onAbort();
  try {
    const startupTimeout = setTimeout(() => { fatal = Error('writer startup exceeded 30 s'); void actor.terminate(); resolveReady(); }, 30000);
    try { await ready; } finally { clearTimeout(startupTimeout); }
    if (fatal) throw fatal;
    if (cell.variant !== 'no-reader') {
      const module = await import(cell.variant === 'bounded' ? candidate.readerUrl : new URL('../../core/memory-reader.mjs', import.meta.url).href);
      reader = module.openMemoryReader({ path, ownerId: namespaces[0].ownerId });
    }
    const startAt = performance.now() + 50, endAt = startAt + cell.windowMs;
    const sizes = { samples: 0, max: { '-wal': 0, '-shm': 0 }, end: null };
    const sample = () => {
      const current = companionSizes(path); sizes.samples++;
      for (const suffix of ['-wal', '-shm']) sizes.max[suffix] = Math.max(sizes.max[suffix], current[suffix]);
      sizes.end = current;
    };
    actor.postMessage({ startAt, endAt });
    watchdog = setTimeout(() => { fatal = Error('trial exceeded window + 10 s drain'); void reader?.close(); void actor.terminate(); }, cell.windowMs + 10050);
    await delay(Math.max(0, startAt - performance.now()));
    histogram.enable();
    samples = setInterval(sample, 100); sample();
    progress = setInterval(() => console.error(JSON.stringify({ measurement: 'topic-overview-progress', pair: cell.pair,
      variant: cell.variant, readerAttempts: attempts.length, writerCalls: writerProgress.calls, writerCommits: writerProgress.commits })), 5000);
    while (performance.now() < endAt) {
      if (fatal) throw fatal;
      if (!reader) { await delay(Math.min(25, Math.max(0, endAt - performance.now()))); continue; }
      const startedAt = performance.now();
      const result = await reader.readTopicOverview({ namespace: namespaces[0] });
      const finishedAt = performance.now();
      attempts.push({ startedAt, finishedAt, elapsedMs: finishedAt - startedAt,
        ...(result.ok ? { complete: result.value.coverage.complete, countsComplete: result.value.coverage.countsComplete }
          : { code: result.error.code }) });
      // Yield even for immediate failures; never use a synchronous host busy wait.
      await delay(0);
    }
    sample(); histogram.disable();
    clearInterval(samples); clearInterval(progress);
    const exitCode = await exited;
    if (fatal) throw fatal;
    assert.equal(exitCode, 0, 'writer Worker exit code');
    const committed = writerResult.commits.filter(at => at >= startAt && at < endAt);
    const gaps = committed.slice(1).map((at, i) => at - committed[i]);
    const failures = writerResult.calls.filter(call => call.code);
    return { ...cell, writerKind: cell.writer, startAt, endAt, drainMs: Math.max(0, performance.now() - endAt),
      reader: { ...readerMetrics(attempts), activeWriterOverlap: overlapPageReport(attempts, writerResult.calls) },
      writer: { calls: writerResult.calls.length, commits: committed.length, commitsPerSecond: committed.length / (cell.windowMs / 1000),
        failures, ...latency(writerResult.calls.map(call => call.elapsedMs)),
        minimumCommitGapMs: gaps.length ? Math.min(...gaps) : null,
        commitPaced: committed.length >= 2 && gaps.every(gap => gap >= PROTOCOL.writerPauseMs), exitCode },
      eventLoopDelay: histogram.count ? { p50Ms: histogram.percentile(50) / 1e6, p95Ms: histogram.percentile(95) / 1e6, maxMs: histogram.max / 1e6 } : null,
      companions: cell.journal === 'WAL' ? { ...sizes, writerEnd: writerResult.companionsBeforeClose } : null, environment: readyInfo,
      // Raw intervals allow independent overlap/pacing audits without counting sleeps.
      readerCalls: attempts, writerCalls: writerResult.calls, commitTimes: committed };
  } finally {
    clearInterval(samples); clearInterval(progress); clearTimeout(watchdog); histogram.disable();
    signal?.removeEventListener('abort', onAbort);
    await reader?.close();
    await actor.terminate(); await exited;
  }
}

export function compareTrials(trials, smoke = false) {
  return trials.map(trial => {
    const baseline = trials.find(other => other.pair === trial.pair && other.variant === 'no-reader');
    const throughputRatio = baseline?.writer.commitsPerSecond > 0 ? trial.writer.commitsPerSecond / baseline.writer.commitsPerSecond : null;
    const p95Ratio = baseline?.writer.p95Ms > 0 ? trial.writer.p95Ms / baseline.writer.p95Ms : null;
    const eligible = !smoke && trial.journal === 'DELETE' && trial.variant === 'bounded' && trial.writerKind !== 'none';
    const commitPaced = trial.writer.commitPaced && baseline?.writer.commitPaced;
    const rawBurst = trial.writerKind === 'raw' && !commitPaced;
    const checks = eligible && baseline && !rawBurst ? {
      commitPaced: Boolean(commitPaced),
      readerProgress: trial.reader.attempts > 0 && trial.reader.successes > 0,
      storageBusy: trial.reader.storageBusy === PROTOCOL.thresholds.candidateDeleteStorageBusy,
      readerP95: trial.reader.p95Ms !== null && trial.reader.p95Ms <= PROTOCOL.thresholds.readerP95Ms,
      writerProgress: trial.writer.commits > 0 && (baseline?.writer.commits ?? 0) > 0,
      writerThroughput: throughputRatio >= PROTOCOL.thresholds.writerThroughputRatio,
      writerP95: trial.writer.p95Ms !== null && trial.writer.p95Ms <= PROTOCOL.thresholds.writerP95Ms,
      writerFailures: trial.writer.failures.length === 0 && baseline?.writer.failures.length === 0,
    } : null;
    return { ...trial, comparison: { throughputRatio, p95Ratio, baselineVariant: baseline ? 'no-reader' : null },
      gate: { status: checks ? (Object.values(checks).every(Boolean) ? 'pass' : 'fail') : eligible && !baseline ? 'pending' : 'observation', checks,
        reason: smoke ? 'smoke, timing gates disabled' : eligible && rawBurst ? 'Raw internal COMMIT bursts are not >=20 ms commit-paced; observational only' : null } };
  });
}
export function compactTable(trials) {
  const f = value => value == null ? '-' : value.toFixed(2);
  return ['schema journal writer variant rep attempts busy% other read95/max writer/s write95 rate/base loop95 WAL/SHM gate',
    ...trials.map(t => `${t.schema} ${t.journal} ${t.writerKind} ${t.variant} ${t.repetition + 1} ${t.reader.attempts} ${f(t.reader.storageBusyRate == null ? null : t.reader.storageBusyRate * 100)} ${Object.values(t.reader.otherFailures).reduce((a, b) => a + b, 0)} ${f(t.reader.p95Ms)}/${f(t.reader.maxMs)} ${f(t.writer.commitsPerSecond)} ${f(t.writer.p95Ms)} ${f(t.comparison.throughputRatio)} ${f(t.eventLoopDelay?.p95Ms)} ${t.companions ? `${t.companions.max['-wal']}/${t.companions.max['-shm']}` : '-'} ${t.gate.status}`)].join('\n');
}

export async function main(args = process.argv.slice(2)) {
  const options = parseArgs(args);
  const schema18Available = existsSync(join(root, 'core/testing/topic-overview-raw29-fixture.mjs'));
  const plan = buildTrialPlan({ ...options, schema18Available });
  const report = { protocol: PROTOCOL, smoke: options.smoke, status: 'registered', registeredAt: new Date().toISOString(),
    node: process.version, platform: process.platform, arch: process.arch,
    schema18: { available: schema18Available, fixture: 'core/testing/topic-overview-raw29-fixture.mjs#installOverviewLayout',
      reason: schema18Available ? 'physical schema18 installer exists' : 'fixture module unavailable; no relabelled schema29 substitute' },
    skipped: [{ schema: 18, writer: 'raw', reason: 'Raw capture needs >=25; enabling it would migrate the schema18 trial' }], plan, trials: [] };
  console.log(JSON.stringify({ measurement: 'topic-overview-preregistration', ...report }));
  if (options.plan) return report;
  mkdirSync(dirname(options.report), { recursive: true });
  const save = () => {
    const temporary = `${options.report}.${process.pid}.partial`;
    writeFileSync(temporary, JSON.stringify(report, null, 2) + '\n', { mode: 0o600 });
    renameSync(temporary, options.report);
  };
  save(); // Durable pre-registration BEFORE even creating/reading a fixture.
  const workspace = createTestWorkspace(null, { prefix: 'cairn-overview-contention-' });
  const controller = new AbortController();
  const cancel = () => controller.abort();
  process.once('SIGINT', cancel); process.once('SIGTERM', cancel);
  let failure;
  try {
    report.candidate = createCandidate(join(workspace.path, 'candidate'));
    report.fixtures = {};
    for (const schema of [...new Set(plan.map(cell => cell.schema))]) {
      console.error(`Seeding synthetic schema ${schema}: ${PROTOCOL.memories} Memories, ${PROTOCOL.namespaces} namespaces, ${PROTOCOL.mocs} MOCs`);
      const path = join(workspace.path, `seed-${schema}.sqlite`);
      report.fixtures[schema] = await seedStore(path, schema, { onProgress(progress) {
        if (controller.signal.aborted) throw Error('measurement cancelled');
        console.error(JSON.stringify({ measurement: 'topic-overview-seed-progress', ...progress }));
      } });
      assert.deepEqual(report.fixtures[schema], { schema, memories: PROTOCOL.memories, namespaces: PROTOCOL.namespaces, mocs: PROTOCOL.mocs, rawAvailable: schema === 29 });
    }
    for (let i = 0; i < plan.length; i++) {
      if (controller.signal.aborted) throw Error('measurement cancelled');
      const cell = plan[i], path = join(workspace.path, `trial-${i}.sqlite`);
      copyFileSync(join(workspace.path, `seed-${cell.schema}.sqlite`), path); chmodSync(path, 0o600);
      console.error(JSON.stringify({ measurement: 'topic-overview-start', trial: i + 1, total: plan.length, ...cell }));
      report.trials.push(await runTrial(cell, path, report.candidate, { signal: controller.signal }));
      report.trials = compareTrials(report.trials, options.smoke); save();
      console.error(compactTable([report.trials.at(-1)]));
    }
    report.trials = compareTrials(report.trials, options.smoke);
    const writerErrors = report.trials.some(t => t.writer.failures.length);
    const unexpectedReaderErrors = report.trials.some(t => Object.keys(t.reader.otherFailures).some(code => code !== 'cursor_stale'));
    report.status = writerErrors || unexpectedReaderErrors || report.trials.some(t => t.gate.status === 'fail') ? 'failed' : 'complete';
    report.finishedAt = new Date().toISOString();
  } catch (error) {
    failure = error; report.status = controller.signal.aborted ? 'cancelled' : 'failed';
    report.failure = { message: error.message, code: error.code ?? null, ...(error.evidence ? { evidence: error.evidence } : {}) };
    console.error(`Measurement failed: ${error.message}; partial report: ${options.report}. No automatic restart.`);
  } finally {
    process.off('SIGINT', cancel); process.off('SIGTERM', cancel);
    try { await workspace.cleanup(); }
    catch (error) { report.status = 'failed'; report.cleanupFailure = error.message; console.error(error); }
    finally { save(); }
  }
  console.log(compactTable(report.trials));
  console.log(JSON.stringify({ report: options.report, status: report.status, trials: report.trials.length }));
  if (failure || report.status !== 'complete') process.exitCode = 1;
  return report;
}

if (!isMainThread && workerData?.topicOverviewWriter) {
  await writerThread(workerData);
} else if (isMainThread && process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await main();
}

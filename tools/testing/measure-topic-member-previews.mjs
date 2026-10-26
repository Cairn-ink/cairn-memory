/**
 * topic-member-previews-v1 PRE-REGISTERED launch protocol (no test timing gates).
 * Node 24.22.1 REQUIRED; 22.16.0/24.15.0 are compatibility observations only.
 * Full Cartesian cells: 1112/3336 memories; four namespaces, 60 L1+11 L2 MOCs;
 * physical18/current33; DELETE/WAL; L1/L2/unfiled; limit24/100;
 * idle/same-owner/other-owner. maxChars72 and all other public defaults.
 * EXACTLY 3 fresh-handle warmups; >=50 successful progressing pages, ceiling500
 * attempts; cold >=10 successes, ceiling100, each in a fresh Node process.
 * Every concurrency sample must overlap ACTUAL write/read calls; missed overlaps
 * remain in all-attempt records and need replacements (no selection for speed).
 * Independent process writer: fresh openMemoryCore/write/close each operation,
 * capture/review separately, approximately20ms cadence, no saturated backlog.
 * Concurrent latency gates use successful overlapping requests only; missed
 * overlaps remain in all-attempt and informational successful-page reports.
 * Main success population, limit24:1112 p95<=150/max<=400ms;
 * 3336 p95<=250/max<=600ms. Cold1112 limit24 p95<=600ms (no cold max gate).
 * limit100/cold3336/retained latency REPORT ONLY. Nearest-rank p50/p95/max.
 * ALL attempts including warmups/cold: host absolute loop gap<=100ms (count>100
 * must0), WAL reader+writer storage_busy/native5/6 must0, envelope<=maxBytes,
 * per-item<=1024 bytes/72 graphemes; source<=12000*L, decoded<=12000*L,
 * accepted normalization<=4000*L. DELETE busy has NO rate threshold.
 * Writer production deadlines MUST be supplied unchanged via a small
 * --writer-profile JSON {captureMs,reviewMs,provenance}; no credentials/config
 * files are read implicitly. The profile identifies the deployed host's settings;
 * reviewMs:null is accepted and makes its deadline gate inconclusive. Review
 * latency is compared with5000ms for information only, labelled "not a deadline".
 * Absence makes launch acceptance incomplete, never invents a benchmark deadline.
 * No retry resets the deadline. Per-operation call/lifecycle p95/max separately.
 * --smoke: ONE tiny matrix subset, target1/main+cold,3 warmups, ceiling3,
 * 112-world/4 namespaces/71MOCs; observational only. Run full only in primary queue.
 * --plan writes the preregistered plan without generating fixtures or samples.
 */
import assert from 'node:assert/strict';
import { fork } from 'node:child_process';
import { copyFileSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { performance } from 'node:perf_hooks';
import { setTimeout as delay } from 'node:timers/promises';
import threads, { MessageChannel } from 'node:worker_threads';
import { syncBuiltinESMExports } from 'node:module';
import { serialize } from 'node:v8';
import { createTestWorkspace } from './workspace.mjs';
import { latency } from './measure-topic-overview-contention.mjs';
import { SQLITE_STAGES, SQLITE_STATEMENTS } from '../../core/topic-reader-sqlite.mjs';

export const PROTOCOL = Object.freeze({ version: 'topic-member-previews-v1', runtime: 'v24.22.1',
  warmups: 3, mainSuccesses: 50, mainCeiling: 500, coldSuccesses: 10, coldCeiling: 100,
  writerCadenceMs: 20, reviewInformation: { comparisonMs: 5000, label: 'not a deadline', acceptanceGate: false }, thresholds: { 1112: { p95Ms: 150, maxMs: 400, coldP95Ms: 600 },
    3336: { p95Ms: 250, maxMs: 600 }, loopMaximumMs: 100, walBusy: 0 },
  defaultCaps: { workLimit: 5000, maxBytes: 65536, deadlineMs: 1000 },
  lockPolicy: 'E1-C2 request-wide WAL native wait100ms capped by deadline; DELETE0; no retries',
  cloneAccounting: 'P1 transfers a UTF-8 ArrayBuffer, so observed transfer payload bytes equal JSON envelope bytes; v8.serialize DTO bytes are separately informational; native framing is excluded',
  loopObservation: '1ms heartbeat bracketed by setImmediate before construction and after awaited close, plus final timer drain; idle baseline100ms; no noise subtraction',
  coldTopology: 'fresh Node subprocess -> public host handle -> actual reader Worker; target DB never opened/primed before sample; outer process launch reported separately',
});
export function buildPlan(smoke) {
  const cells = [];
  for (const count of smoke ? [112] : [1112,3336]) for (const schema of smoke ? [18] : [18,33])
    for (const journal of ['DELETE','WAL']) for (const selection of smoke ? ['L2'] : ['L1','L2','unfiled'])
      for (const limit of smoke ? [24] : [24,100]) for (const load of ['idle','same-owner','other-owner']) cells.push({ count, schema, journal, selection, limit, load, profile: 'default-caps', edgeCasesRequired: true });
  return cells;
}
const previewReasons = ['empty','trimmed_prefix_empty','content_limit','invalid_text','grapheme_too_large','segmenter_unavailable'];
const timestamp = () => performance.timeOrigin + performance.now();
const failureCodes = new Set(['measurement_failed','replay_mismatch','membership_mismatch','fixture_invalid',
  'invalid_writer_profile','child_failed','writer_failed','invalid_input','invalid_cursor','cursor_stale',
  'storage_busy','read_timeout','reader_failed','store_closed','read_in_progress','unsupported_database',
  'database_not_found','unsafe_database_file','index_unavailable','moc_not_found','revision_conflict',
  'invalid_ref','context_item_too_large','state_limit','model_timeout']);
const failureNumbers = ['mismatchCount','actualBytes','expectedBytes','actualCount','expectedCount','childExitCode'];
export function safeFailure(error) {
  const code = failureCodes.has(error?.code) ? error.code : 'measurement_failed';
  const failure = { code };
  for (const key of failureNumbers) if (Number.isSafeInteger(error?.[key]) && error[key] >= 0) failure[key] = error[key];
  if (Number.isInteger(error?.sqlite)) failure.sqlite = error.sqlite & 255;
  if (Number.isInteger(error?.extendedCode)) failure.extendedCode = error.extendedCode;
  const d = error?.diagnostics;
  if (SQLITE_STAGES.includes(d?.stage) && SQLITE_STATEMENTS.includes(d?.statement) &&
      Number.isInteger(d?.sqlite?.code) && Number.isInteger(d?.sqlite?.extendedCode)) {
    failure.diagnostics = { stage: d.stage, statement: d.statement,
      sqlite: { code: d.sqlite.code & 255, extendedCode: d.sqlite.extendedCode } };
  }
  return failure;
}
function measurementError(code, numbers = {}) {
  const error = Object.assign(new Error(code), safeFailure({ code, ...numbers }));
  // No original stack, message, cause, assertion operands or response data.
  error.stack = error.code;
  return error;
}
export function recordFailure(report, error) {
  report.status = 'failed'; report.failure = safeFailure(error);
  throw measurementError(report.failure.code, report.failure);
}
export function assertReplay(actual, expected) {
  const a = JSON.stringify(actual), b = JSON.stringify(expected);
  try { assert.ok(a === b, 'replay_mismatch'); }
  catch { throw measurementError('replay_mismatch', { mismatchCount: 1,
    actualBytes: Buffer.byteLength(a), expectedBytes: Buffer.byteLength(b) }); }
}
export function writerProfileInput(value) {
  if (!value || !Number.isSafeInteger(value.captureMs) || value.captureMs < 1 || value.captureMs > 120000 ||
      !(value.reviewMs === null || (Number.isSafeInteger(value.reviewMs) && value.reviewMs > 0)) ||
      typeof value.provenance !== 'string' || !value.provenance) throw measurementError('invalid_writer_profile');
  return { captureMs: value.captureMs, reviewMs: value.reviewMs, provenance: value.provenance };
}
const unwrap = result => { if (!result.ok) throw measurementError(safeFailure(result.error).code); return result.value; };
function observeLoop() {
  let last = performance.now(), maxMs = 0, blocksOver100 = 0;
  const sample = () => { const time = performance.now(), gap = time - last; maxMs = Math.max(maxMs, gap); if (gap > 100) blocksOver100++; last = time; };
  const timer = setInterval(sample, 1);
  let completion;
  return { finish() { return completion ??= (async () => {
    await new Promise(r => setImmediate(r)); await delay(2); sample(); clearInterval(timer);
    return { maxMs, blocksOver100 };
  })(); } };
}
function instrumentWorkers(sourceCases = {}) {
  const Native = threads.Worker, ports = [], metrics = [], transportBytes = [];
  threads.Worker = class extends Native {
    constructor(url, options) {
      const { port1, port2 } = new MessageChannel(); ports.push(port1); port1.on('message', m => metrics.push(m));
      super(url, { ...options, workerData: { ...options.workerData, previewMetricsPort: port2, previewSourceCases: sourceCases }, transferList: [port2],
        execArgv: ['--import', new URL('./fixtures/topic-member-previews-metrics.mjs', import.meta.url).href] });
      this.on('message', result => { if (result instanceof ArrayBuffer) transportBytes.push(result.byteLength); });
    }
  };
  syncBuiltinESMExports();
  return { metrics, transportBytes, close() { ports.forEach(p => p.close()); threads.Worker = Native; syncBuiltinESMExports(); } };
}
export async function attempt(config, writer) {
  const { openMemoryReader } = await import('../../core/memory-reader.mjs');
  const observation = instrumentWorkers(config.sourceCases), loop = observeLoop();
  let reader, result, readStartedAt, readFinishedAt, writerResult;
  try {
    await new Promise(r => setImmediate(r));
    const startedAt = timestamp(), started = performance.now();
    try {
      reader = openMemoryReader({ path: config.path, ownerId: config.namespace.ownerId, diagnostics: true });
      readStartedAt = timestamp();
      const pending = reader.readTopicMembers(config.input);
      if (writer) writer.send({ type: 'start' });
      result = await pending; readFinishedAt = timestamp();
    } finally { await reader?.close(); reader = undefined; }
    const finishedAt = timestamp(), elapsedMs = performance.now() - started;
    if (writer) { writer.send({ type: 'stop' }); writerResult = await writer.wait('stopped'); }
    const hostLoop = await loop.finish();
    const bytes = Buffer.byteLength(JSON.stringify(result)), cloneRepresentationBytes = serialize(result).byteLength;
    const page = result.ok ? result.value : null;
    const reasons = Object.fromEntries(previewReasons.map(reason => [reason, 0])); let previewBounds = true;
    if (page) for (const row of page.items) {
      if (row.preview.status === 'unavailable') reasons[row.preview.reason] = (reasons[row.preview.reason] ?? 0) + 1;
      else previewBounds &&= Buffer.byteLength(row.preview.text) <= 1024 && Array.from(new Intl.Segmenter('und', { granularity: 'grapheme' }).segment(row.preview.text)).length <= 72;
    }
    const writes = writerResult?.calls ?? [];
    const overlap = !writer || writes.some(w => w.writeStartedAt < readFinishedAt && readStartedAt < w.writeFinishedAt);
    const counters = observation.metrics.at(-1) ?? null;
    return { startedAt, finishedAt, readStartedAt, readFinishedAt, elapsedMs, hostLoop, bytes, cloneRepresentationBytes,
      actualTransportPayloadBytes: observation.transportBytes.at(-1) ?? 0, transportFramingBytes: null, refs: page?.items.length ?? 0, status: page?.status ?? null,
      coverage: page?.coverage ?? null, failure: result.ok ? null : safeFailure(result.error), reasons, counters, writes,
      overlap, successfulPage: Boolean(page && (page.status === 'page' || page.items.length || page.nextCursor)),
      bounds: bytes <= 65536 && (observation.transportBytes.at(-1) ?? 0) <= 65536 &&
        (!result.ok || observation.transportBytes.at(-1) === bytes) && previewBounds && (!counters || (counters.sourceBytes <= 12000 * config.cell.limit &&
        counters.decodedUnits <= 12000 * config.cell.limit && counters.normalizationUnits <= 4000 * config.cell.limit && counters.extractions <= config.cell.limit)) };
  } finally {
    try { await reader?.close(); }
    finally { try { await loop.finish(); } finally { observation.close(); } }
  }
}
function actor(args) {
  const child = fork(fileURLToPath(import.meta.url), args, { execArgv: [], stdio: ['ignore','ignore','pipe','ipc'], env: {} });
  const messages = [], waiters = [];
  let lastProgress = Date.now(), exited = false;
  child.stderr.on('data', () => {}); // Never forward unsanitized child exception text.
  child.on('message', m => { lastProgress = Date.now();
    if (m.type === 'failed') { for (const w of waiters.splice(0)) w.reject(measurementError(safeFailure(m.failure).code)); return; } const i = waiters.findIndex(w => w.type === m.type); if (i < 0) messages.push(m); else waiters.splice(i,1)[0].resolve(m); });
  child.wait = type => { const i = messages.findIndex(m => m.type === type); return i >= 0 ? Promise.resolve(messages.splice(i,1)[0]) : new Promise((resolve, reject) => waiters.push({ type, resolve, reject })); };
  child.exited = new Promise(resolveExit => {
    child.on('error', () => {
      exited = true; clearInterval(monitor);
      for (const w of waiters.splice(0)) w.reject(measurementError('child_failed'));
      resolveExit({ code: 1, signal: null });
    });
    child.once('close', (code, signal) => { exited = true; clearInterval(monitor);
      for (const w of waiters.splice(0)) w.reject(measurementError('child_failed', { childExitCode: code ?? 1 }));
      resolveExit({ code, signal }); });
  });
  const monitor = setInterval(() => {
    if (exited) return;
    if (Date.now() - lastProgress > 150000) { process.stderr.write('preview measurement child made no IPC progress; terminating\n'); child.kill('SIGKILL'); }
  }, 5000);
  return child;
}
async function writerProcess(config) {
  const { openMemoryCore } = await import('../../core/contract.mjs');
  const { rationaleModel } = await import('../../core/testing/rationale-model.mjs');
  const { DatabaseSync } = await import('node:sqlite');
  const original = DatabaseSync.prototype.exec;
  let commits = 0, activeWrite = false;
  DatabaseSync.prototype.exec = function(sql) { const result = Reflect.apply(original, this, [sql]); if (activeWrite && /^\s*COMMIT\s*;?\s*$/i.test(sql)) commits++; return result; };
  let running = false, stop = false, pending, sequence = 0, calls = [], closing = false;
  const ns = config.cell.load === 'same-owner' ? config.namespace : { ...config.namespace, ownerId: 'preview-other-owner' };
  async function handleMessage(m) {
    if (m.type === 'close') { closing = true; stop = true; if (!running) process.disconnect(); }
    if (m.type === 'stop') stop = true;
    if (m.type !== 'start' || running) return;
    running = true; stop = false; calls = [];
    do {
      const operation = pending ? 'review' : 'capture', startedAt = timestamp(), started = performance.now();
      const deadlineMs = config.writerProfile?.[operation === 'capture' ? 'captureMs' : 'reviewMs'] ?? null;
      let core, result, writeStartedAt, writeFinishedAt, writeElapsedMs, failure, nativeCommits = 0;
      try {
        const content = `Synthetic preview writer ${process.pid}-${sequence++}`;
        core = openMemoryCore({ path: config.path, decisionReview: 'required-v1',
          ...(config.writerProfile ? { captureDeadlineMs: config.writerProfile.captureMs } : {}),
          model: { ...rationaleModel(), extract: () => ({ items: [{ content, kind: 'decision', confidence: .8, sourceIndices: [0] }] }) } });
        writeStartedAt = timestamp(); const writeStart = performance.now(), before = commits; activeWrite = true;
        try {
          if (pending) result = core.confirm({ namespace: ns, memoryId: pending.id, expectedRevision: pending.revision,
            actionId: `confirm-${process.pid}-${sequence++}`, receipt: { client: 'preview-measure', sessionId: 'review', eventId: String(sequence), role: 'user', excerpt: 'Confirm synthetic decision.' } });
          else result = await core.capture({ namespace: ns, client: 'preview-measure', sessionId: 'capture', eventId: `${process.pid}-${sequence}`,
            messages: [{ id: String(sequence), role: 'user', content }] });
        } finally { activeWrite = false; writeFinishedAt = timestamp(); writeElapsedMs = performance.now() - writeStart; nativeCommits = commits - before; }
        if (!result.ok) failure = safeFailure(result.error);
        else if (operation === 'capture') pending = unwrap(core.list({ namespace: ns, reviewState: 'awaiting' })).memories.at(-1);
        else pending = null;
      } catch (e) { failure = safeFailure({ code: failureCodes.has(e.code) ? e.code : 'writer_failed', sqlite: e.errcode, extendedCode: e.errcode }); }
      finally { core?.close(); }
      calls.push({ operation, startedAt, finishedAt: timestamp(), elapsedMs: performance.now() - started,
        writeStartedAt, writeFinishedAt, writeElapsedMs, deadlineMs, deadlineStart: writeStartedAt,
        deadlineEnd: writeFinishedAt, commits: nativeCommits, failure: failure ?? null,
        deadlineOverrun: deadlineMs === null ? null : writeElapsedMs > deadlineMs });
      if (!stop) await delay(Math.max(0, PROTOCOL.writerCadenceMs - (performance.now() - started)));
    } while (!stop);
    running = false; process.send({ type: 'stopped', calls });
    if (closing) process.disconnect();
  }
  process.on('message', m => { void handleMessage(m).catch(error => {
    process.exitCode = 1;
    process.send({ type: 'failed', failure: safeFailure(error) }, () => process.disconnect());
  }); });
  process.send({ type: 'ready' });
}
function summarize(records, cell) {
  const failures = {}, statuses = {}, reasons = Object.fromEntries(previewReasons.map(reason => [reason, 0]));
  for (const r of records) {
    if (r.failure) failures[r.failure.code] = (failures[r.failure.code] ?? 0) + 1;
    const status = r.status ?? 'error'; statuses[status] = (statuses[status] ?? 0) + 1;
    for (const [key, n] of Object.entries(r.reasons)) reasons[key] = (reasons[key] ?? 0) + n;
  }
  const successes = records.filter(r => r.successfulPage);
  const gated = successes.filter(r => cell.load === 'idle' || r.overlap);
  const edgeCaseExtractions = [0,0,0,0], edgeCaseSourceBytes = [0,0,0,0];
  let edgeCaseMismatches = 0;
  for (const r of records) {
    for (let i = 0; i < 4; i++) {
      edgeCaseExtractions[i] += r.counters?.edgeCaseExtractions?.[i] ?? 0;
      edgeCaseSourceBytes[i] += r.counters?.edgeCaseSourceBytes?.[i] ?? 0;
    }
    edgeCaseMismatches += r.counters?.edgeCaseMismatches ?? 0;
  }
  return { attempts: records.length, successfulPages: successes.length, successfulOverlaps: successes.filter(r => r.overlap).length, gatedPages: gated.length, edgeCaseExtractions, edgeCaseSourceBytes, edgeCaseMismatches, failures, statuses, reasons,
    storageBusy: failures.storage_busy ?? 0, storageBusyRate: records.length ? (failures.storage_busy ?? 0) / records.length : null,
    sqliteBusy: records.filter(r => [5,6].includes(r.failure?.diagnostics?.sqlite?.code)).length,
    allAttempts: latency(records.map(r => r.elapsedMs)), successfulPopulation: latency(successes.map(r => r.elapsedMs)), gatedPopulation: latency(gated.map(r => r.elapsedMs)),
    envelopeBytes: latency(records.map(r => r.bytes)), actualTransportPayloadBytes: latency(records.map(r => r.actualTransportPayloadBytes)), cloneRepresentationBytes: latency(records.map(r => r.cloneRepresentationBytes)),
    hostLoopMaximumMs: Math.max(0, ...records.map(r => r.hostLoop.maxMs)),
    blocksOver100: records.reduce((n, r) => n + r.hostLoop.blocksOver100, 0), missedOverlaps: records.filter(r => !r.overlap).length,
    writers: Object.fromEntries(['capture','review'].map(op => {
      const calls = records.flatMap(r => r.writes).filter(w => w.operation === op);
      return [op, { attempts: calls.length, commits: calls.reduce((n,c) => n+c.commits, 0),
        storageBusy: calls.filter(c => c.failure?.code === 'storage_busy').length,
        storageBusyRate: calls.length ? calls.filter(c => c.failure?.code === 'storage_busy').length / calls.length : null,
        sqliteBusy: calls.filter(c => [5,6].includes(c.failure?.sqlite)).length,
        callLatency: latency(calls.map(c => c.writeElapsedMs).filter(Number.isFinite)), lifecycleLatency: latency(calls.map(c => c.elapsedMs)),
        failures: calls.filter(c => c.failure), missingDeadlines: calls.filter(c => c.deadlineMs === null).length,
        deadlineOverruns: calls.filter(c => c.deadlineOverrun).length,
        deadlineGate: !calls.length || calls.some(c => c.deadlineMs === null) ? 'inconclusive' :
          calls.some(c => c.deadlineOverrun || ['model_timeout','read_timeout'].includes(c.failure?.code)) ? 'fail' : 'pass',
        ...(op === 'review' ? { informationalComparison: { ...PROTOCOL.reviewInformation,
          observedAboveComparison: calls.filter(c => c.writeElapsedMs > PROTOCOL.reviewInformation.comparisonMs).length } } : {}) }];
    })) };
}
export function decide(cell, series, records, required, production, cold = false) {
  const summary = summarize(records, cell), all = records.flatMap(r => r.writes), threshold = PROTOCOL.thresholds[cell.count];
  const mutationExplainsStale = record => cell.load === 'same-owner' && record.overlap &&
    record.writes.some(w => w.commits > 0 && w.writeStartedAt < record.readFinishedAt && record.readStartedAt < w.writeFinishedAt);
  const checks = {
    loop: summary.blocksOver100 === 0 && summary.hostLoopMaximumMs <= 100,
    bytes: records.every(r => r.bounds), numericCounters: records.every(r => r.failure || r.counters),
    walBusy: cell.journal !== 'WAL' || records.every(r => r.failure?.code !== 'storage_busy' && ![5,6].includes(r.failure?.diagnostics?.sqlite?.code) &&
      r.writes.every(w => w.failure?.code !== 'storage_busy' && ![5,6].includes(w.failure?.sqlite))),
    expectedFailures: records.every(r => !r.failure || ['storage_busy','read_timeout'].includes(r.failure.code) ||
      (r.failure.code === 'cursor_stale' && mutationExplainsStale(r))),
    writerDeadlines: all.every(w => !w.deadlineOverrun && !['model_timeout','read_timeout'].includes(w.failure?.code)),
    writerFailures: all.every(w => !w.failure || (cell.journal === 'DELETE' && w.failure.code === 'storage_busy')),
    edgeCaseConsistency: summary.edgeCaseMismatches === 0,
  };
  // Missing samples/percentiles are unknown, not observed threshold violations.
  if (threshold && cell.limit === 24 && (!cold || cell.count === 1112)) {
    const population = summary.gatedPopulation;
    checks.p95 = population.p95Ms === null ? null : population.p95Ms <= (cold ? threshold.coldP95Ms : threshold.p95Ms);
    if (!cold) checks.maximum = population.maxMs === null ? null : population.maxMs <= threshold.maxMs;
  }
  if (cell.load !== 'idle') for (const op of ['capture','review']) {
    const writer = summary.writers[op];
    checks[op + 'Deadline'] = writer.deadlineGate === 'inconclusive' ? null : writer.deadlineGate === 'pass';
  }
  if (cell.edgeCasesRequired) checks.edgeCaseCoverage = summary.edgeCaseExtractions.every(n => n > 0) ? true : null;
  const missingWriters = cell.load !== 'idle' && ['capture','review'].some(op => !all.some(w => w.operation === op && w.commits > 0));
  const observedFailure = Object.values(checks).some(v => v === false);
  return { series, summary, checks, decision: observedFailure ? 'fail' :
    summary.gatedPages < required || Object.values(checks).some(v => v === null) || !production || missingWriters ? 'inconclusive' : 'pass' };
}

export async function seed(count, schema, workspace) {
  const { buildMemberWorld, ledgerMembers } = await import('../../core/testing/topic-members-world.mjs');
  const { f, spaces } = buildMemberWorld(null, count);
  try {
    const namespace = spaces[0];
    const nodes = [...f.mocs.values()].filter(m => m.namespace === namespace);
    const root = nodes.find(m => m.level === 'L2');
    const child = nodes.find(m => m.level === 'L1' && f.edges.get(root.id).has(m.id));
    // The smallest eight namespace IDs guarantee every page24/page100 selection
    // reaches all four cases. Filed copies serve L1 and its containing L2;
    // separate unfiled copies preserve the fixed world shape.
    const measured = f.ledger.filter(row => row.namespace === namespace)
      .sort((a,b) => Buffer.compare(Buffer.from(a.id), Buffer.from(b.id))).slice(0,8);
    for (let offset = 0; offset < measured.length; offset += 4) f.place(namespace,
      measured.slice(offset, offset + 4).map(row => ({ memoryId: row.id, parentIds: offset === 0 ? [child.id] : [] })));
    const cases = ['👨‍👩‍👧‍👦 ZWJ 台北', 'e\u0301 か\u3099 combining', ' '.repeat(3000) + 'leading useful', '界'.repeat(4000)];
    const sourceCases = {};
    for (const [i, row] of f.ledger.entries()) {
      const index = measured.findIndex(m => m.id === row.id);
      const content = index >= 0 ? cases[index % 4] : ['中文 notes', '日本語 メモ', 'Mixed 中文 ja 👨‍👩‍👧‍👦'][i % 3] + ` ${i}`;
      f.db.prepare('UPDATE memories SET content=? WHERE id=?').run(content, row.id); row.content = content;
      if (index >= 0) sourceCases[row.id] = { caseIndex: index % 4, bytes: Buffer.byteLength(content) };
    }
    const selection = Object.fromEntries([['L1', child.id], ['L2', root.id]].map(([level,id]) => {
      const node = f.mocs.get(id); return [level, { type: 'moc', mocId: id, revision: node.revision, level }];
    }));
    assert.equal(f.ledger.length, count); assert.equal(spaces.length, 4); assert.equal(f.mocs.size, 71);
    const physical = { memories: f.db.prepare('SELECT count(*) n FROM memories').get().n,
      mocs: f.db.prepare('SELECT count(*) n FROM mocs').get().n,
      namespaces: f.db.prepare('SELECT count(*) n FROM (SELECT DISTINCT owner_id,scope,project_id FROM memories)').get().n,
      l1: f.db.prepare('SELECT count(*) n FROM mocs WHERE level=1').get().n,
      l2: f.db.prepare('SELECT count(*) n FROM mocs WHERE level=2').get().n };
    const ledgerShape = { memories: f.ledger.length, mocs: f.mocs.size, namespaces: spaces.length,
      l1: [...f.mocs.values()].filter(n => n.level === 'L1').length, l2: [...f.mocs.values()].filter(n => n.level === 'L2').length };
    assert.deepEqual(physical, ledgerShape); assert.equal(physical.l1, 60); assert.equal(physical.l2, 11);
    const expectedIds = Object.fromEntries(['L1','L2','unfiled'].map(level => [level,
      ledgerMembers(f, namespace, level === 'unfiled' ? { type: 'unfiled' } : selection[level]).map(r => r.id)]));
    f.core.close();
    if (schema === 33) { const { openDatabase } = await import('../../core/database.mjs'); const db = openDatabase(f.path, { currentDependencies: true }); db.close(); }
    const path = join(workspace.path, `seed-${count}-${schema}.sqlite`); copyFileSync(f.path, path);
    return { path, namespace, selection, expectedIds, sourceCases, physical, ledgerShape, ledger: f.ledger.map(({ id, revision, kind, parents, namespace }) => ({ id, revision, kind, parents, namespace })),
      memories: count, namespaces: spaces.length, mocs: f.mocs.size, l1: nodes.filter(n => n.level === 'L1').length };
  } finally { await f.workspace.cleanup(); }
}
async function retainedTraversal(config, fixture) {
  const { openMemoryReader } = await import('../../core/memory-reader.mjs');
  const { DatabaseSync } = await import('node:sqlite');
  const db = new DatabaseSync(config.path, { readOnly: true });
  let expected = [...fixture.expectedIds[config.cell.selection]];
  try {
    if (config.cell.selection === 'unfiled') {
      const known = new Set(fixture.ledger.map(r => r.id)), n = config.namespace;
      expected.push(...db.prepare(`SELECT id FROM memories WHERE owner_id=? AND scope=? AND project_id=?
        AND deleted=0 AND currentness='current' AND review_state IN ('none','confirmed')`).all(n.ownerId,n.scope,n.projectId ?? '')
        .filter(r => !known.has(r.id)).map(r => r.id));
    }
  } finally { db.close(); }
  expected.sort((a,b) => Buffer.compare(Buffer.from(a),Buffer.from(b)));
  const observation = instrumentWorkers(config.sourceCases);
  const reader = openMemoryReader({ path: config.path, ownerId: config.namespace.ownerId }), loop = observeLoop();
  const records = [], ids = [], start = performance.now(); let cursor, previousInput, previousOutput;
  try {
    do {
      const input = { ...config.input, ...(cursor ? { cursor } : {}) }, before = performance.now();
      const output = await reader.readTopicMembers(input), elapsedMs = performance.now() - before;
      if (!output.ok) return { informational: true, complete: false, failure: safeFailure(output.error), records, elapsedMs: performance.now() - start };
      await new Promise(r => setImmediate(r));
      const counters = observation.metrics.at(-1) ?? null;
      const previewBounds = output.value.items.every(r => r.preview.status !== 'available' ||
        (Buffer.byteLength(r.preview.text) <= 1024 && Array.from(new Intl.Segmenter('und', { granularity: 'grapheme' }).segment(r.preview.text)).length <= 72));
      records.push({ elapsedMs, bytes: Buffer.byteLength(JSON.stringify(output)),
        actualTransportPayloadBytes: observation.transportBytes.at(-1), counters,
        resourceBounds: previewBounds && counters !== null && counters.extractions <= config.cell.limit &&
          counters.sourceBytes <= 12000 * config.cell.limit && counters.decodedUnits <= 12000 * config.cell.limit && counters.normalizationUnits <= 4000 * config.cell.limit,
        refs: output.value.items.length,
        status: output.value.status, coverage: output.value.coverage });
      ids.push(...output.value.items.map(r => r.id)); cursor = output.value.nextCursor;
      previousInput = input; previousOutput = output;
    } while (cursor);
    if (JSON.stringify(ids) !== JSON.stringify(expected)) throw measurementError('membership_mismatch', { actualCount: ids.length, expectedCount: expected.length });
    if (previousInput.cursor) assertReplay(await reader.readTopicMembers(previousInput), previousOutput);
    return { informational: true, complete: true, exactEof: true, expectedRefs: expected.length, emittedRefs: ids.length,
      lifecycleLatency: { ...latency(records.map(r => r.elapsedMs)), totalMs: performance.now() - start }, records };
  } finally {
    try { await reader.close(); }
    finally { try { config.retainedLoop = await loop.finish(); } finally { observation.close(); } }
  }
}
async function run(args) {
  let smoke = false, plan = false, reportPath = resolve('topic-member-previews-report.json'), writerProfile;
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--smoke') smoke = true;
    else if (args[i] === '--plan') plan = true;
    else if (args[i] === '--report') reportPath = resolve(args[++i]);
    else if (args[i] === '--writer-profile') {
      writerProfile = writerProfileInput(JSON.parse(readFileSync(resolve(args[++i]), 'utf8')));
    } else throw Error('Usage: --smoke --plan --report PATH --writer-profile PATH');
  }
  const report = { protocol: PROTOCOL, registeredAt: new Date().toISOString(), node: process.version, smoke, writerProfile: writerProfile ?? null,
    plan: buildPlan(smoke), cells: [], status: 'registered' };
  const save = () => { writeFileSync(reportPath + '.partial', JSON.stringify(report, null, 2) + '\n', { mode: 0o600 }); renameSync(reportPath + '.partial', reportPath); };
  save(); if (plan) return report;
  const workspace = createTestWorkspace(null, { prefix: 'cairn-preview-measure-' }), seeds = new Map();
  try {
    const idleLoop = observeLoop(); await delay(100); report.idleBaseline = await idleLoop.finish();
    for (const [i, cell] of report.plan.entries()) {
      process.stderr.write(JSON.stringify({ progress: i + 1, total: report.plan.length, cell }) + '\n');
      const key = `${cell.count}:${cell.schema}`;
      if (!seeds.has(key)) seeds.set(key, await seed(cell.count, cell.schema, workspace));
      const fixture = seeds.get(key), path = join(workspace.path, `cell-${i}.sqlite`); copyFileSync(fixture.path, path);
      const { DatabaseSync } = await import('node:sqlite'); const db = new DatabaseSync(path);
      try { assert.equal(db.prepare(`PRAGMA journal_mode=${cell.journal}`).get().journal_mode.toUpperCase(), cell.journal); } finally { db.close(); }
      const input = { namespace: fixture.namespace, selection: cell.selection === 'unfiled' ? { type: 'unfiled' } : fixture.selection[cell.selection],
        accessRevision: 'preview-measure', previews: { version: PROTOCOL.version, maxChars: 72 }, limit: cell.limit };
      const config = { cell, path, namespace: fixture.namespace, input, writerProfile, sourceCases: fixture.sourceCases };
      let writer;
      const entry = { cell, fixture: { ...fixture.physical, ledgerShape: fixture.ledgerShape }, warmups: [], main: [], cold: [] };
      report.cells.push(entry); save();
      try {
        if (cell.load !== 'idle') { writer = actor(['--writer', JSON.stringify(config)]); await writer.wait('ready'); }
        for (let n = 0; n < 3; n++) { entry.warmups.push(await attempt(config, writer)); save(); }
        const target = smoke ? 1 : 50, ceiling = smoke ? 3 : 500;
        while (entry.main.filter(r => r.successfulPage && r.overlap).length < target && entry.main.length < ceiling) { entry.main.push(await attempt(config, writer)); save(); }
        const coldTarget = smoke ? 1 : 10, coldCeiling = smoke ? 3 : 100;
        while (entry.cold.filter(r => r.successfulPage && r.overlap).length < coldTarget && entry.cold.length < coldCeiling) {
          const outer = performance.now(), processLoop = observeLoop();
          const child = actor(['--cold', JSON.stringify(config)]);
          const message = await child.wait('result'), exit = await child.exited;
          assert.equal(exit.code, 0); assert.equal(exit.signal, null);
          entry.cold.push({ ...message.record, processExit: exit, outerProcessLaunchAndSampleMs: performance.now() - outer,
            launcherLoop: await processLoop.finish() }); save();
        }
        const production = process.version === PROTOCOL.runtime && !smoke;
        entry.retained = await retainedTraversal(config, fixture);
        entry.retained.hostLoop = config.retainedLoop;
        entry.retained.bounds = entry.retained.records.every(r => r.bytes <= 65536 && r.bytes === r.actualTransportPayloadBytes && r.resourceBounds);
        entry.retained.decision = entry.retained.complete && entry.retained.bounds && config.retainedLoop.maxMs <= 100 ? 'pass' : 'fail';
        entry.decisions = [decide(cell, 'main', entry.main, 50, production), decide(cell, 'cold', entry.cold, 10, production, true),
          decide({ ...cell, limit: 100 }, 'warmup', entry.warmups, 0, production)];
      } finally {
        if (writer) { writer.send({ type: 'close' }); entry.writerExit = await writer.exited; assert.equal(entry.writerExit.code, 0); }
        save();
      }
    }
    report.status = smoke ? 'smoke-observation' : report.cells.some(c => (c.decisions.some(d => d.decision === 'fail') || c.retained?.decision === 'fail')) ? 'failed' :
      report.cells.some(c => c.decisions.some(d => d.decision === 'inconclusive')) ? 'inconclusive' : 'accepted';
  } catch (e) { recordFailure(report, e); }
  finally {
    try { await workspace.cleanup(); }
    catch (e) { recordFailure(report, e); }
    finally { save(); }
  }
  console.log(JSON.stringify({ report: reportPath, status: report.status, cells: report.cells.length }));
  if (['failed','inconclusive'].includes(report.status) && !smoke) process.exitCode = 1;
  return report;
}
export async function main(args) {
  try { return await run(args); }
  catch (error) { throw measurementError(safeFailure(error).code, safeFailure(error)); }
}
async function commandLine() {
  if (process.argv[2] === '--writer') await writerProcess(JSON.parse(process.argv[3]));
  else if (process.argv[2] === '--cold') {
    const config = JSON.parse(process.argv[3]); let writer;
    try {
      if (config.cell.load !== 'idle') { writer = actor(['--writer', JSON.stringify(config)]); await writer.wait('ready'); }
      const record = await attempt(config, writer);
      if (writer) { writer.send({ type: 'close' }); record.writerExit = await writer.exited; assert.equal(record.writerExit.code, 0); }
      await new Promise((resolveSend, reject) => process.send({ type: 'result', record }, error => error ? reject(error) : resolveSend()));
    } finally { if (writer?.connected) writer.kill('SIGTERM'); process.disconnect(); }
  } else await main(process.argv.slice(2));
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { await commandLine(); }
  catch (error) { console.error(JSON.stringify({ failure: safeFailure(error) })); process.exitCode = 1; }
}

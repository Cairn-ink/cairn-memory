/**
 * E1-C2 v2 PRE-REGISTERED before any run: every WAL cell, both writer lifecycles,
 * both overview/member methods, physical schema18/current, >=5 x 30 seconds:
 * zero public storage_busy AND diagnostic SQLite primary 5/6; no unexpected
 * reader failures (cursor_stale is permitted and separately counted).
 * Reader p95 <=250ms; public write-call p95 <=250ms; report write p95 AND max
 * for EVERY reader-load cell. Keep >=90% baseline throughput as a reported
 * engine reference, NOT an acceptance gate; never tune the wait to reach it.
 * Host loop max <=100ms. Valid full WAL reader-load cells require >=20 reader
 * attempts overlapping actual public writes, fresh writers >=10 attempts
 * overlapping per-write close, and >=100 native COMMITs inside public write
 * calls AND the window, in both cell and baseline. Insufficient exposure is
 * INVALID, never pass. Attempts (including failures and drain) are all retained.
 * These minima are fixed per full 30s cell; smoke does not assert exposure.
 * DELETE is report-only, with no new production wait. --smoke runs each cell
 * once for 2s, with NO performance acceptance. No full run outside primary's
 * machine-wide queue. Public fresh open/read/close; writer is a CHILD PROCESS.
 * Baselines have no keeper/reader; w2 really closes its last writer connection.
 * Diagnostic-control copies only the reader closure and changes the WAL budget
 * to zero; all other source bytes (including opt-in diagnostics) stay identical.
 * Reader policy v1.1: min(remaining request deadline, 1000ms) minus 20ms reply
 * reserve, shared across the request. Acceptance thresholds above are unchanged.
 * No retry, no journal change by readers, no network/models or real user data.
 */
import assert from 'node:assert/strict';
import { fork } from 'node:child_process';
import { createHash } from 'node:crypto';
import { copyFileSync, readFileSync, writeFileSync, mkdirSync, renameSync, existsSync } from 'node:fs';
import { dirname, join, resolve, relative } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { performance, monitorEventLoopDelay } from 'node:perf_hooks';
import { setTimeout as delay } from 'node:timers/promises';
import { createTestWorkspace } from './workspace.mjs';
import { namespaces, seedStore, latency, openWriter, publicWrite } from './measure-topic-overview-contention.mjs';
import { overlapPageReport } from './measure-contention.mjs';

const root = fileURLToPath(new URL('../../', import.meta.url));
export const PROTOCOL = Object.freeze({ version: 'E1-C2-v2', repetitions: 5, windowMs: 30000,
  smokeWindowMs: 2000, memories: 1112, namespaces: 4, mocs: 71, currentSchema: 33,
  writerPauseMs: 0, readerWaitPolicy: 'E1-C2-v1.1', walWaitMs: 1000, walReplyReserveMs: 20, memberDeadlineMs: 250,
  thresholds: Object.freeze({ storageBusy: 0, sqliteBusy: 0, readerP95Ms: 250, writerThroughputRatio: .9,
    writerP95Ms: 250, hostLoopMaxMs: 100, writeOverlapAttempts: 20, freshCloseOverlapAttempts: 10, commits: 100 }),
  throughputAcceptance: 'reported engine reference only; product acceptance uses public write-call latency',
  latencyPopulation: 'all attempts started in window, including failures/drain; writeLatency measures only publicWrite; top-level writer latency includes open and close',
  throughputPopulation: 'successful public writes completed in window',
  overlapPopulation: 'actual public writer-call and close intervals, clipped to the window; retained shutdown close is reported but never substitutes for fresh per-write close',
  commitPopulation: 'successful native COMMITs only while publicWrite is active, finishing inside the fixed window; exclude opener commits',
  diagnostics: 'SQLite primary/extended numeric codes; errstr is canonical primary SQLite string, never native message',
  readerLifecycle: 'fresh public openMemoryReader/readTopicOverview or readTopicMembers/await close per request',
  baseline: 'paired fresh seed clone with no reader and no keeper; reverse trial order on odd repetitions',
});
export function buildPlan(smoke = false) {
  const cells = [];
  for (let repetition = 0; repetition < (smoke ? 1 : PROTOCOL.repetitions); repetition++)
    for (const schema of [18, PROTOCOL.currentSchema]) for (const journal of ['WAL', 'DELETE'])
      for (const lifecycle of ['retained', 'fresh']) {
        const variants = ['baseline', 'zero-wait-overview', 'zero-wait-members', 'overview', 'members'];
        for (const variant of repetition % 2 ? variants.reverse() : variants) cells.push({ schema, journal, lifecycle,
          variant, repetition, pair: `${schema}:${journal}:${lifecycle}:${repetition}`, windowMs: smoke ? PROTOCOL.smokeWindowMs : PROTOCOL.windowMs });
      }
  return cells;
}
export function failureRecord(result) {
  if (result.ok) return null;
  const diagnostics = result.error.diagnostics;
  const primary = diagnostics?.sqlite.code ?? null;
  const strings = ['not an error', 'SQL logic error', 'internal logic error', 'access permission denied',
    'query aborted', 'database is locked', 'database table is locked', 'out of memory',
    'attempt to write a readonly database', 'interrupted', 'disk I/O error',
    'database disk image is malformed', 'unknown operation', 'database or disk is full',
    'unable to open database file', 'locking protocol', 'unknown error', 'database schema has changed',
    'string or blob too big', 'constraint failed', 'datatype mismatch', 'bad parameter or other API misuse',
    'unknown error', 'authorization denied', 'unknown error', 'column index out of range',
    'file is not a database', 'notification message', 'warning message'];
  return { publicCode: result.error.code, errcode: primary, extendedCode: diagnostics?.sqlite.extendedCode ?? null,
    errstr: strings[primary] ?? null,
    errstrSource: 'canonical-sqlite-primary-code', stage: diagnostics?.stage ?? null, statement: diagnostics?.statement ?? null };
}
export function readerMetrics(attempts) {
  let successes = 0, storageBusy = 0, sqliteBusy = 0, cursorStale = 0;
  const unexpectedFailures = {};
  for (const call of attempts) {
    if (!call.failure) { successes++; continue; }
    const { publicCode, errcode } = call.failure;
    const nativeBusy = [5, 6].includes(errcode);
    if (publicCode === 'storage_busy') storageBusy++;
    if (nativeBusy) sqliteBusy++;
    if (publicCode === 'cursor_stale' && errcode == null) cursorStale++;
    else if (publicCode !== 'storage_busy' && !nativeBusy) unexpectedFailures[publicCode] = (unexpectedFailures[publicCode] ?? 0) + 1;
  }
  return { attempts: attempts.length, successes, storageBusy, sqliteBusy, cursorStale, unexpectedFailures,
    ...latency(attempts.map(call => call.elapsedMs)), tail: latencyTail(attempts.map(call => call.elapsedMs)) };
}

// Report-only reader-latency tail (v1.1 waits up to the remaining deadline in
// the Worker): nearest-rank p99, maximum and counts above 150/500/1000 ms.
export function latencyTail(values) {
  const sorted = values.filter(Number.isFinite).sort((a, b) => a - b);
  const above = limit => sorted.filter(value => value > limit).length;
  return { n: sorted.length, p99Ms: sorted.length ? sorted[Math.ceil(.99 * sorted.length) - 1] : null,
    maxMs: sorted.at(-1) ?? null, over150Ms: above(150), over500Ms: above(500), over1000Ms: above(1000) };
}

// Exposure is based on actual write/close intervals, never a writer PID/lifetime.
export function exposureMetrics(attempts, calls, commits, startAt, endAt) {
  const clip = intervals => intervals.filter(i => Number.isFinite(i.startedAt) && Number.isFinite(i.finishedAt))
    .map(i => ({ startedAt: Math.max(i.startedAt, startAt), finishedAt: Math.min(i.finishedAt, endAt) }))
    .filter(i => i.finishedAt > i.startedAt);
  const writes = clip(calls.map(c => ({ startedAt: c.writeStartedAt, finishedAt: c.writeFinishedAt })));
  const closes = clip(calls.map(c => ({ startedAt: c.closeStartedAt, finishedAt: c.finishedAt })));
  const overlapsClose = call => closes.some(close => call.startedAt < close.finishedAt && call.finishedAt > close.startedAt);
  return { activeWriteOverlap: overlapPageReport(attempts, writes), activeCloseOverlap: overlapPageReport(attempts, closes),
    closeOverlapTail: latencyTail(attempts.filter(overlapsClose).map(call => call.elapsedMs)),
    commits: commits.filter(at => at >= startAt && at < endAt).length };
}

export function diagnosticControl(directory) {
  const copied = new Set(), inventory = [];
  function visit(path) {
    if (copied.has(path)) return;
    assert.ok(path.startsWith(root) && path.endsWith('.mjs'));
    copied.add(path);
    const file = relative(root, path), source = readFileSync(path, 'utf8');
    const destination = join(directory, file); mkdirSync(dirname(destination), { recursive: true });
    const patched = file === 'core/topic-reader-sqlite.mjs' ? source.replace('TOPIC_WAL_WAIT_MS = 1000;', 'TOPIC_WAL_WAIT_MS = 0;') : source;
    if (file === 'core/topic-reader-sqlite.mjs') assert.notEqual(patched, source);
    writeFileSync(destination, patched);
    inventory.push({ file, original: createHash('sha256').update(source).digest('hex'), control: createHash('sha256').update(patched).digest('hex') });
    for (const match of source.matchAll(/(?:from\s*|import\s*(?:\(\s*)?|new URL\(\s*)['"](\.[^'"]+\.mjs)['"]/g)) visit(resolve(dirname(path), match[1]));
  }
  visit(join(root, 'core/memory-reader.mjs')); visit(join(root, 'core/topic-overview-worker.mjs'));
  return { readerUrl: pathToFileURL(join(directory, 'core/memory-reader.mjs')).href, inventory };
}
// Shared independent-writer lifecycle. Instrumentation is supplied by the
// opt-in product observer; ordinary writer policy and public methods stay intact.
export async function measureWriterLifecycle({core,lifecycle,open,write,inspect,close,clock=Date.now}) {
  const startedAt=clock(),start=performance.now();
  let value,error,disposed=lifecycle==='fresh'?false:null,writeStartedAt,writeFinishedAt,writeElapsedMs,closeStartedAt;
  try {
    core??=await open();writeStartedAt=clock();const writeStart=performance.now();
    try{value=await write(core);}finally{writeFinishedAt=clock();writeElapsedMs=performance.now()-writeStart;}
    if(inspect)await inspect(core,value);
  }catch(failure){error=failure;}
  finally {
    if(lifecycle==='fresh') {
      closeStartedAt=clock();try{await close(core);disposed=true;}catch(failure){error??=failure;disposed=false;}core=undefined;
    }
  }
  return {core,value,error,disposed,call:{startedAt,finishedAt:clock(),elapsedMs:performance.now()-start,writeStartedAt,writeFinishedAt,writeElapsedMs,closeStartedAt}};
}
async function writerProcess(config) {
  // There is deliberately NO keeper connection, including during startup.
  const { DatabaseSync } = await import('node:sqlite');
  const original = DatabaseSync.prototype.exec, commits = [], calls = [];
  let core, active = false;
  DatabaseSync.prototype.exec = function(sql) {
    const result = Reflect.apply(original, this, [sql]);
    if (active && /^\s*COMMIT\s*;?\s*$/i.test(sql)) commits.push(Date.now());
    return result;
  };
  try {
    if (config.lifecycle === 'retained') core = await openWriter(config.path, 'same-owner');
    process.send({ type: 'ready', pid: process.pid });
    const { startAt, endAt } = await new Promise(resolveStart => process.once('message', resolveStart));
    await delay(Math.max(0, startAt - Date.now()));
    let sequence = 0, lastProgress = Date.now();
    while (Date.now() < endAt) {
      const measured=await measureWriterLifecycle({core,lifecycle:config.lifecycle,
        open:()=>openWriter(config.path,'same-owner'),
        async write(handle){active=true;try{return await publicWrite(handle,'same-owner',sequence++);}finally{active=false;}},
        close:handle=>handle?.close()});
      core=measured.core;
      const failure=measured.error?{code:measured.error.code??'writer_failed',errcode:measured.error.errcode??null}:null;
      calls.push({...measured.call,walAfterClose:existsSync(config.path+'-wal'),...(failure?{failure}:{})});
      if (failure) break;
      if (Date.now() - lastProgress >= 1000) {
        process.send({ type: 'progress', calls: calls.length, commits: commits.length }); lastProgress = Date.now();
      }
      // A zero-delay yield permits IPC cancellation; not counted as overlap.
      await delay(PROTOCOL.writerPauseMs);
    }
    let finalClose;
    if (core) {
      finalClose = { startedAt: Date.now() }; core.close(); core = undefined;
      finalClose.finishedAt = Date.now(); finalClose.walAfterClose = existsSync(config.path + '-wal');
    }
    // Wait until the (large, 30 s window) result is written to the IPC channel;
    // disconnecting right after send() can drop it.
    await new Promise((resolve, reject) => process.send({ type: 'result', calls, commits, finalClose },
      error => error ? reject(error) : resolve()));
  } finally { core?.close(); DatabaseSync.prototype.exec = original; process.disconnect(); }
}
export async function runTrial(cell, path, control, signal) {
  const actor = fork(fileURLToPath(import.meta.url), ['--writer', JSON.stringify({ ...cell, path })],
    { execArgv: [], stdio: ['ignore', 'ignore', 'pipe', 'ipc'] });
  actor.stderr.on('data', chunk => process.stderr.write(chunk));
  let fatal, writer, reader, resolveReady, lastProgress = Date.now();
  const ready = new Promise(r => { resolveReady = r; });
  actor.on('message', message => {
    lastProgress = Date.now();
    if (message.type === 'ready') resolveReady();
    if (message.type === 'result') writer = message;
  });
  actor.on('error', error => { fatal = error; resolveReady(); });
  // Judge the writer only after both process exit and IPC disconnect: queued
  // messages can still be delivered after 'exit'.
  const disconnected = new Promise(r => actor.once('disconnect', r));
  const exited = new Promise(r => actor.once('exit', (code, signal) => {
    void Promise.race([disconnected, delay(2000)]).then(() => {
      if (code !== 0 || !writer) fatal ??= Error(`writer exit code=${code} signal=${signal}, result=${Boolean(writer)}`);
      resolveReady(); r({ code, signal });
    });
  }));
  const abort = () => { fatal ??= Error('measurement cancelled or stalled'); actor.kill('SIGKILL'); void reader?.close(); resolveReady(); };
  signal?.addEventListener('abort', abort, { once: true });
  if (signal?.aborted) abort();
  const supervision = setInterval(() => {
    console.error(JSON.stringify({ progress: cell, writerPid: actor.pid, lastIpcAgeMs: Date.now() - lastProgress }));
    if (Date.now() - lastProgress > 10000) abort();
  }, 5000);
  const watchdog = setTimeout(abort, cell.windowMs + 15000);
  const histogram = monitorEventLoopDelay({ resolution: 10 }), attempts = [];
  try {
    await ready; if (fatal) throw fatal;
    const { openMemoryReader } = await import(cell.variant.startsWith('zero-wait') ? control.readerUrl : new URL('../../core/memory-reader.mjs', import.meta.url).href);
    const startAt = Date.now() + 50, endAt = startAt + cell.windowMs;
    actor.send({ startAt, endAt }); await delay(Math.max(0, startAt - Date.now())); histogram.enable();
    while (Date.now() < endAt) {
      if (fatal) throw fatal;
      if (cell.variant === 'baseline') { await delay(20); continue; }
      const startedAt = Date.now(), start = performance.now();
      reader = openMemoryReader({ path, ownerId: namespaces[0].ownerId, diagnostics: true });
      const result = cell.variant.endsWith('members') ? await reader.readTopicMembers({ namespace: namespaces[0],
        selection: { type: 'unfiled' }, accessRevision: 'synthetic-wal', deadlineMs: PROTOCOL.memberDeadlineMs }) :
        await reader.readTopicOverview({ namespace: namespaces[0] });
      const finishedAt = Date.now(), elapsedMs = performance.now() - start;
      await reader.close(); reader = undefined;
      const failure = failureRecord(result);
      const call = { startedAt, finishedAt, elapsedMs, ...(failure ? { failure } : {}) }; attempts.push(call);
      if (failure) console.error(JSON.stringify({ nonOk: cell, ...call }));
    }
    histogram.disable(); const exit = await exited; if (fatal) throw fatal;
    const successful = writer.calls.filter(c => !c.failure && c.finishedAt >= startAt && c.finishedAt < endAt);
    const exposure = exposureMetrics(attempts, writer.calls, writer.commits, startAt, endAt);
    return { ...cell, startAt, endAt, reader: { ...readerMetrics(attempts),
        activeWriteOverlap: exposure.activeWriteOverlap, activeCloseOverlap: exposure.activeCloseOverlap,
        shutdownCloseOverlap: writer.finalClose ? overlapPageReport(attempts, writer.finalClose) : null },
      writer: { calls: writer.calls.length, callsPerSecond: successful.length / (cell.windowMs / 1000), commits: exposure.commits,
        writeLatency: latency(writer.calls.filter(c => c.writeElapsedMs !== undefined).map(c => c.writeElapsedMs)),
        failures: writer.calls.filter(c => c.failure), finalClose: writer.finalClose ?? null, ...latency(writer.calls.map(c => c.elapsedMs)), exit },
      hostLoopMaxMs: histogram.max / 1e6, readerCalls: attempts, writerCalls: writer.calls, commitTimes: writer.commits };
  } finally {
    histogram.disable(); clearInterval(supervision); clearTimeout(watchdog);
    signal?.removeEventListener('abort', abort); await reader?.close();
    if (actor.exitCode === null && actor.signalCode === null) actor.kill('SIGKILL'); await exited;
  }
}
export function compare(trials, smoke) {
  return trials.map(t => {
    // Re-derive from retained attempts instead of accepting a public-code-only counter.
    const measured = exposureMetrics(t.readerCalls, t.writerCalls, t.commitTimes, t.startAt, t.endAt);
    const reader = { ...t.reader, ...readerMetrics(t.readerCalls),
      activeWriteOverlap: measured.activeWriteOverlap, activeCloseOverlap: measured.activeCloseOverlap,
      closeOverlapTail: measured.closeOverlapTail };
    const writer = { ...t.writer, commits: measured.commits,
      writeLatency: latency(t.writerCalls.filter(c => c.writeElapsedMs !== undefined).map(c => c.writeElapsedMs)) };
    const baseline = trials.find(b => b.pair === t.pair && b.variant === 'baseline');
    const ratio = baseline?.writer.callsPerSecond > 0 ? t.writer.callsPerSecond / baseline.writer.callsPerSecond : null;
    const readerLoad = t.variant !== 'baseline';
    const walLoad = readerLoad && t.journal === 'WAL';
    const eligible = !smoke && walLoad && ['overview', 'members'].includes(t.variant);
    const bounds = PROTOCOL.thresholds;
    const exposure = !smoke && walLoad ? {
      writeOverlap: reader.activeWriteOverlap.pages >= bounds.writeOverlapAttempts,
      freshCloseOverlap: t.lifecycle !== 'fresh' || reader.activeCloseOverlap.pages >= bounds.freshCloseOverlapAttempts,
      commitProgress: writer.commits >= bounds.commits,
      baselineCommitProgress: Boolean(baseline && baseline.commitTimes.filter(at => at >= baseline.startAt && at < baseline.endAt).length >= bounds.commits),
    } : null;
    const valid = !exposure || Object.values(exposure).every(Boolean);
    const checks = eligible ? { busy: reader.storageBusy === 0 && reader.sqliteBusy === 0,
      readerFailures: Object.keys(reader.unexpectedFailures).length === 0,
      readerProgress: reader.successes > 0,
      readerP95: reader.p95Ms !== null && reader.p95Ms <= bounds.readerP95Ms,
      writerP95: writer.writeLatency.p95Ms !== null && writer.writeLatency.p95Ms <= bounds.writerP95Ms,
      hostLoop: t.hostLoopMaxMs <= bounds.hostLoopMaxMs,
      writerFailures: !t.writer.failures.length && Boolean(baseline && !baseline.writer.failures.length) } : null;
    const unexpected = readerLoad && Object.keys(reader.unexpectedFailures).length > 0;
    return { ...t, reader, writer, throughputRatio: ratio,
      engineThroughput: { referenceRatio: bounds.writerThroughputRatio, meetsReference: ratio === null ? null : ratio >= bounds.writerThroughputRatio,
        acceptanceGate: false },
      validity: { status: exposure ? (valid ? 'valid' : 'invalid') : 'not-evaluated', checks: exposure },
      gate: !valid ? 'invalid' : unexpected ? 'fail' :
        eligible ? (Object.values(checks).every(Boolean) ? 'pass' : 'fail') : 'observation', checks };
  });
}
export async function main(args = process.argv.slice(2)) {
  let smoke = false, planOnly = false, reportPath = resolve('topic-reader-wal-report.json');
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--smoke') smoke = true;
    else if (args[i] === '--plan') planOnly = true;
    else if (args[i] === '--report' && args[i + 1]) reportPath = resolve(args[++i]);
    else throw Error('Usage: measure-topic-reader-wal.mjs [--smoke] [--plan] [--report PATH]');
  }
  const report = { protocol: PROTOCOL, smoke, node: process.version, registeredAt: new Date().toISOString(), plan: buildPlan(smoke), trials: [], status: 'registered' };
  if (planOnly) { console.log(JSON.stringify(report, null, 2)); return report; }
  const save = () => {
    writeFileSync(reportPath + '.partial', JSON.stringify(report, null, 2) + '\n', { mode: 0o600 });
    renameSync(reportPath + '.partial', reportPath);
  };
  save(); // BEFORE seeding or collecting any observations.
  const workspace = createTestWorkspace(null, { prefix: 'cairn-fresh-wal-' }), controller = new AbortController();
  const cancel = () => controller.abort(); process.once('SIGINT', cancel); process.once('SIGTERM', cancel);
  try {
    report.control = diagnosticControl(join(workspace.path, 'control'));
    report.fixtures = {};
    for (const schema of [18, PROTOCOL.currentSchema]) {
      const path = join(workspace.path, `seed-${schema}.sqlite`);
      report.fixtures[schema] = await seedStore(path, 18, { onProgress: progress => {
        if (controller.signal.aborted) throw Error('cancelled'); console.error(JSON.stringify({ seed: schema, ...progress }));
      } });
      if (schema !== 18) {
        const { openDatabase } = await import('../../core/database.mjs');
        const db = openDatabase(path, { currentDependencies: true }); db.close();
        const { inspectStore } = await import('./measure-topic-overview-contention.mjs'); report.fixtures[schema] = await inspectStore(path);
      }
      assert.equal(report.fixtures[schema].schema, schema);
      assert.equal(report.fixtures[schema].memories, 1112); assert.equal(report.fixtures[schema].mocs, 71);
    }
    for (const [i, cell] of report.plan.entries()) {
      if (controller.signal.aborted) throw Error('cancelled');
      const path = join(workspace.path, `trial-${i}.sqlite`); copyFileSync(join(workspace.path, `seed-${cell.schema}.sqlite`), path);
      const { DatabaseSync } = await import('node:sqlite'); const setup = new DatabaseSync(path, { timeout: 5000 });
      try { assert.equal(setup.prepare(`PRAGMA journal_mode=${cell.journal}`).get().journal_mode.toUpperCase(), cell.journal); } finally { setup.close(); }
      console.error(JSON.stringify({ start: i + 1, total: report.plan.length, ...cell }));
      report.trials.push(await runTrial(cell, path, report.control, controller.signal)); report.trials = compare(report.trials, smoke); save();
    }
    report.status = report.trials.some(t => t.gate === 'fail' || t.writer.failures.length) ? 'failed' :
      report.trials.some(t => t.gate === 'invalid') ? 'invalid' : 'complete';
  } catch (error) { report.status = 'failed'; report.failure = error.message; console.error(error); }
  finally {
    process.off('SIGINT', cancel); process.off('SIGTERM', cancel);
    try { await workspace.cleanup(); }
    catch (error) { report.status = 'failed'; report.cleanupFailure = error.message; }
    finally { save(); }
  }
  console.log('schema journal writer variant attempts publicBusy sqliteBusy stale unexpected read95 writer/s lifecycle95 write95/writeMax commits writeOverlap/closeOverlap ratio loopMax gate');
  for (const t of report.trials) console.log([t.schema, t.journal, t.lifecycle, t.variant, t.reader.attempts, t.reader.storageBusy, t.reader.sqliteBusy, t.reader.cursorStale, Object.values(t.reader.unexpectedFailures).reduce((a,b) => a+b, 0),
    t.reader.p95Ms?.toFixed(2), t.writer.callsPerSecond.toFixed(2), t.writer.p95Ms?.toFixed(2),
    [t.writer.writeLatency.p95Ms, t.writer.writeLatency.maxMs].map(v => v?.toFixed(2) ?? '-').join('/'), t.writer.commits,
    [t.reader.activeWriteOverlap.pages, t.reader.activeCloseOverlap.pages].join('/'),
    t.throughputRatio?.toFixed(2), t.hostLoopMaxMs.toFixed(2), t.gate].join(' '));
  console.log(JSON.stringify({ report: reportPath, status: report.status, trials: report.trials.length }));
  if (report.status !== 'complete') process.exitCode = 1;
  return report;
}
if (process.argv[2] === '--writer') await writerProcess(JSON.parse(process.argv[3]));
else if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await main();

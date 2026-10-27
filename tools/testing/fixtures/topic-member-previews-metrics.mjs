// Measurement-only preload. Only numeric extraction coverage leaves this Worker.
import { channel } from 'node:diagnostics_channel';
import { workerData, parentPort, threadId } from 'node:worker_threads';
import { readFileSync, readlinkSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { performance } from 'node:perf_hooks';
import { PREVIEW_SOURCE_SQL } from '../../../core/topic-member-previews-storage.mjs';
import { observeGC } from './topic-member-previews-attribution.mjs';
const gc = observeGC();
let tid = null;
try { tid = Number(readlinkSync('/proc/thread-self').split('/').at(-1)); } catch {}
const cpuSource = typeof process.threadCpuUsage === 'function' ? 'threadCpuUsage' : 'schedstat';
function threadCPU() {
  if (cpuSource === 'threadCpuUsage') return process.threadCpuUsage();
  try { return { totalNs: Number(readFileSync('/proc/thread-self/schedstat', 'utf8').split(/\s+/)[0]) }; }
  catch { return null; }
}
let readIndex = 0, readStart, cpuStart;
const stamp = () => performance.timeOrigin + performance.now();
// Identity precedes the first engine request, so scheduler samples can still
// identify a Worker forcibly terminated before it publishes read completion.
workerData.previewMetricsPort.postMessage({ type: 'worker-online', workerId: threadId, tid, startedAt: stamp() });
// Wrap registration rather than adding an early listener: an early listener
// starts the port and could consume a queued request before the engine loads.
const on = parentPort.on;
parentPort.on = function(event, listener) {
  if (event !== 'message') return Reflect.apply(on, this, [event, listener]);
  return Reflect.apply(on, this, [event, function(...args) {
    readIndex++; readStart = stamp(); cpuStart = threadCPU();
    return Reflect.apply(listener, this, args);
  }]);
};
const postMessage = parentPort.postMessage;
parentPort.postMessage = function(...args) {
  const finishedAt = stamp(), cpuEnd = threadCPU(), index = readIndex, startedAt = readStart;
  const threadCPUTime = cpuStart && cpuEnd ? cpuSource === 'threadCpuUsage' ? {
    userMicros: cpuEnd.user - cpuStart.user, systemMicros: cpuEnd.system - cpuStart.system,
    totalMs: (cpuEnd.user - cpuStart.user + cpuEnd.system - cpuStart.system) / 1000,
  } : { totalMs: (cpuEnd.totalNs - cpuStart.totalNs) / 1e6 } : null;
  // GC performance entries arrive asynchronously. One diagnostic delivery turn
  // lets that read's pending GC entries arrive before the host can terminate us.
  // The yield is included in the observed engine window; never subtract it.
  const publish = () => {
    const entries = gc.drain();
    workerData.previewMetricsPort.postMessage({ type: 'worker-timing', read: {
      readIndex: index, workerId: threadId, tid, startedAt, finishedAt, cpuSource, threadCPUTime,
      gc: entries.filter(e => e.startedAt < finishedAt && e.startedAt + e.durationMs > startedAt),
      deliveredAt: stamp(),
    } });
    entries.length = 0;
    Reflect.apply(postMessage, this, args);
  };
  setImmediate(publish);
};
const prepare = DatabaseSync.prototype.prepare, exec = DatabaseSync.prototype.exec, close = DatabaseSync.prototype.close;
let extractions = [0,0,0,0], bytes = [0,0,0,0], mismatches = 0;
let sqlite = { calls: 0, totalMs: 0, longest: null };
const category = sql => /journal_mode/i.test(sql) ? 'journal_mode' :
  /sqlite_master|pragma_|EXPLAIN/i.test(sql) ? 'schema_metadata' :
    /namespace_epochs|namespace_index_state|store_metadata|index_generations/i.test(sql) ? 'snapshot_metadata' : 'topic_metadata';
function timed(stage, statement, call) {
  const started = performance.now(), startedAt = performance.timeOrigin + started;
  try { return call(); }
  finally {
    const elapsedMs = performance.now() - started;
    sqlite.calls++; sqlite.totalMs += elapsedMs;
    if (!sqlite.longest || elapsedMs > sqlite.longest.elapsedMs) sqlite.longest = { stage, statement, startedAt, elapsedMs };
  }
}
DatabaseSync.prototype.exec = function(sql) {
  return timed('exec', /^\s*(BEGIN|COMMIT|ROLLBACK)\b/i.test(sql) ? 'transaction' : 'configuration', () => Reflect.apply(exec, this, [sql]));
};
// Node 22 finalizes statements during database close. Node 24 also exposes
// explicit statement close/dispose. Count native cleanup as well as execution.
DatabaseSync.prototype.close = function(...args) {
  return timed('close', 'connection', () => Reflect.apply(close, this, args));
};
DatabaseSync.prototype.prepare = function(sql) {
  const label = category(sql), statement = timed('prepare', label, () => Reflect.apply(prepare, this, [sql]));
  for (const method of ['get','all','run','columns','close',Symbol.dispose]) {
    const native = statement[method];
    if (typeof native !== 'function') continue;
    const stage = method === Symbol.dispose ? 'dispose' : method;
    statement[method] = function(...args) { return timed(stage, label, () => Reflect.apply(native, this, args)); };
  }
  const iterate = statement.iterate;
  statement.iterate = function(...args) {
    const iterator = timed('iterate', label, () => Reflect.apply(iterate, this, args));
    for (const method of ['next','return']) {
      const native = iterator[method];
      iterator[method] = function(...values) {
        return timed('iterate_' + method, label, () => Reflect.apply(native, this, values));
      };
    }
    return iterator;
  };
  if (sql !== PREVIEW_SOURCE_SQL) return statement;
  const get = statement.get;
  statement.get = function(...args) {
    const row = Reflect.apply(get, this, args), expected = workerData.previewSourceCases?.[args[0]];
    if (expected) {
      const i = expected.caseIndex;
      extractions[i]++;
      bytes[i] += row?.source?.byteLength ?? 0;
      if (row?.source_type !== 'text' || row.source_bytes !== expected.bytes || row.source?.byteLength !== expected.bytes) mismatches++;
    }
    return row;
  };
  return statement;
};
channel('cairn.topic-member-previews.metrics').subscribe(value => {
  workerData.previewMetricsPort.postMessage({ ...value, readIndex, edgeCaseExtractions: extractions,
    edgeCaseSourceBytes: bytes, edgeCaseMismatches: mismatches, sqlite });
  extractions = [0,0,0,0]; bytes = [0,0,0,0]; mismatches = 0;
  sqlite = { calls: 0, totalMs: 0, longest: null };
});

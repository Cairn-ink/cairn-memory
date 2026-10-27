import { TOPIC_WAL_WAIT_MS, TOPIC_WAL_REPLY_RESERVE_MS } from '../../core/topic-reader-sqlite.mjs';
import assert from 'node:assert/strict';
import test from 'node:test';
import { join } from 'node:path';
import { readFileSync } from 'node:fs';
import { buildPlan, failureRecord, compare, diagnosticControl, PROTOCOL, readerMetrics, exposureMetrics } from './measure-topic-reader-wal.mjs';
import { createTestWorkspace } from './workspace.mjs';

test('registered full matrix and smoke cover both modes, schemas, lifecycles and methods', () => {
  const full = buildPlan(), smoke = buildPlan(true);
  assert.equal(full.length, 200); assert.equal(smoke.length, 40);
  assert.ok(full.every(c => c.windowMs === 30000)); assert.ok(smoke.every(c => c.windowMs === 2000));
  assert.deepEqual([...new Set(full.map(c => c.repetition))], [0, 1, 2, 3, 4]);
  for (const cells of Map.groupBy(full, c => c.pair).values()) {
    assert.deepEqual(cells.map(c => c.variant).sort(), ['baseline', 'members', 'overview', 'zero-wait-members', 'zero-wait-overview']);
  }
  assert.deepEqual(PROTOCOL.thresholds, { storageBusy: 0, sqliteBusy: 0, readerP95Ms: 250, writerThroughputRatio: .9,
    writerP95Ms: 250, hostLoopMaxMs: 100, writeOverlapAttempts: 20, freshCloseOverlapAttempts: 10, commits: 100 });
  assert.equal(PROTOCOL.readerWaitPolicy, 'E1-C2-v1.1');
  assert.equal(PROTOCOL.walWaitMs, TOPIC_WAL_WAIT_MS); assert.equal(PROTOCOL.walReplyReserveMs, TOPIC_WAL_REPLY_RESERVE_MS);
  assert.deepEqual(failureRecord({ ok: false, error: { code: 'storage_busy', diagnostics: {
    stage: 'prepare', statement: 'application_id', sqlite: { code: 5, extendedCode: 261 } } } }), {
    publicCode: 'storage_busy', stage: 'prepare', statement: 'application_id', errcode: 5, extendedCode: 261,
    errstr: 'database is locked', errstrSource: 'canonical-sqlite-primary-code' });
  assert.equal(failureRecord({ ok: false, error: { code: 'read_timeout' } }).errcode, null);
});
function measuredTrial(overrides = {}) {
  const writerCalls = Array.from({ length: 20 }, (_, i) => ({ startedAt: i * 10, finishedAt: i * 10 + 8,
    writeStartedAt: i * 10 + 1, writeFinishedAt: i * 10 + 5, closeStartedAt: i * 10 + 5,
    elapsedMs: 8, writeElapsedMs: i === 19 ? 9 : 4 }));
  return { pair: 'one', journal: 'WAL', lifecycle: 'fresh', variant: 'members',
    startAt: 0, endAt: 30000, reader: {},
    readerCalls: Array.from({ length: 20 }, (_, i) => ({ startedAt: i * 10, finishedAt: i * 10 + 9, elapsedMs: 9 })),
    writer: { calls: 20, callsPerSecond: 10, failures: [], p95Ms: 8 }, writerCalls,
    commitTimes: Array.from({ length: 100 }, (_, i) => i), hostLoopMaxMs: 11, ...overrides };
}
const baseline = () => measuredTrial({ variant: 'baseline', readerCalls: [], writer: { calls: 20, callsPerSecond: 10, failures: [], p95Ms: 8 } });

test('WAL acceptance uses public write latency; throughput is a reported engine reference', () => {
  const trial = measuredTrial({ writer: { calls: 20, callsPerSecond: 5, failures: [], p95Ms: 999 } });
  const compared = compare([baseline(), trial], false)[1];
  assert.equal(compared.gate, 'pass');
  assert.equal(compared.throughputRatio, .5); assert.equal(compared.engineThroughput.meetsReference, false);
  assert.equal(compared.engineThroughput.acceptanceGate, false);
  assert.deepEqual(compared.writer.writeLatency, { p50Ms: 4, p95Ms: 4, maxMs: 9 });
  assert.equal(compare([baseline(), measuredTrial({ hostLoopMaxMs: 101 })], false)[1].gate, 'fail');
  const slow = measuredTrial(); slow.writerCalls.forEach(c => { c.writeElapsedMs = 251; });
  assert.equal(compare([baseline(), slow], false)[1].gate, 'fail');
  assert.equal(compare([baseline(), measuredTrial({ journal: 'DELETE', hostLoopMaxMs: 101 })], false)[1].gate, 'observation');
  assert.equal(compare([baseline(), measuredTrial()], true)[1].gate, 'observation');
});

test('native BUSY/LOCKED counts independently of public classification; stale is permitted, other failures fail', () => {
  for (const code of [5, 6]) {
    const failure = failureRecord({ ok: false, error: { code: 'unsupported_database', diagnostics: {
      stage: 'prepare', statement: 'topic_metadata', sqlite: { code, extendedCode: code === 5 ? 261 : 262 } } } });
    const trial = measuredTrial();
    // Preserve meaningful exposure while reproducing one success plus 99 legacy-mapped native failures.
    trial.readerCalls = Array.from({ length: 100 }, (_, i) => ({ startedAt: i, finishedAt: i + 200, elapsedMs: 200,
      ...(i === 0 ? {} : { failure }) }));
    const result = compare([baseline(), trial], false)[1];
    assert.equal(result.gate, 'fail'); assert.equal(result.reader.storageBusy, 0);
    assert.equal(result.reader.sqliteBusy, 99); assert.equal(result.checks.busy, false);
  }
  const stale = measuredTrial(); stale.readerCalls[0].failure = failureRecord({ ok: false, error: { code: 'cursor_stale' } });
  const good = compare([baseline(), stale], false)[1]; assert.equal(good.gate, 'pass'); assert.equal(good.reader.cursorStale, 1);
  for (const code of ['unsupported_database', 'reader_failed', 'read_timeout']) {
    const bad = measuredTrial(); bad.readerCalls[0].failure = failureRecord({ ok: false, error: { code } });
    const result = compare([baseline(), bad], false)[1];
    assert.equal(result.gate, 'fail'); assert.equal(result.reader.unexpectedFailures[code], 1);
  }
  assert.equal(readerMetrics([{ elapsedMs: 1, failure: failureRecord({ ok: false, error: { code: 'storage_busy' } }) }]).storageBusy, 1);
});

test('insufficient write/close overlap or actual commits makes a cell invalid, retaining all attempts', () => {
  assert.deepEqual({ write: PROTOCOL.thresholds.writeOverlapAttempts, close: PROTOCOL.thresholds.freshCloseOverlapAttempts,
    commits: PROTOCOL.thresholds.commits }, { write: 20, close: 10, commits: 100 });
  for (const missing of ['write', 'close', 'commits', 'baselineCommits']) {
    const trial = measuredTrial(), base = baseline();
    if (missing === 'write') trial.writerCalls.forEach(c => { c.writeStartedAt = c.writeFinishedAt = -1; });
    if (missing === 'close') trial.writerCalls.forEach(c => { delete c.closeStartedAt; });
    if (missing === 'commits') trial.commitTimes = [1];
    if (missing === 'baselineCommits') base.commitTimes = [1];
    const result = compare([base, trial], false)[1];
    assert.equal(result.gate, 'invalid', missing); assert.equal(result.validity.status, 'invalid');
    assert.deepEqual(result.readerCalls, trial.readerCalls); assert.equal(result.reader.attempts, 20);
  }
  const exactClose = measuredTrial(); exactClose.writerCalls.slice(10).forEach(c => { delete c.closeStartedAt; });
  assert.equal(compare([baseline(), exactClose], false)[1].gate, 'pass');
  delete exactClose.writerCalls[9].closeStartedAt;
  assert.equal(compare([baseline(), exactClose], false)[1].gate, 'invalid');
  const nineteenWrites = measuredTrial(); delete nineteenWrites.writerCalls[19].writeStartedAt;
  assert.equal(compare([baseline(), nineteenWrites], false)[1].gate, 'invalid');
  const retained = measuredTrial({ lifecycle: 'retained' }); retained.writerCalls.forEach(c => { delete c.closeStartedAt; });
  assert.equal(compare([baseline(), retained], false)[1].gate, 'pass');
  const outOfWindow = measuredTrial({ commitTimes: Array.from({ length: 100 }, (_, i) => 30000 + i) });
  assert.equal(compare([baseline(), outOfWindow], false)[1].gate, 'invalid');
  const clipped = exposureMetrics([{ startedAt: 30000, finishedAt: 30100, elapsedMs: 100 }],
    [{ writeStartedAt: 30000, writeFinishedAt: 30100, closeStartedAt: 30000, finishedAt: 30100 }], [30000], 0, 30000);
  assert.equal(clipped.activeWriteOverlap.pages, 0); assert.equal(clipped.activeCloseOverlap.pages, 0); assert.equal(clipped.commits, 0);
});

test('diagnostic control changes only the WAL wait constant in a temporary reader closure', t => {
  const workspace = createTestWorkspace(t), dir = join(workspace.path, 'control');
  const control = diagnosticControl(dir);
  assert.deepEqual(control.inventory.filter(f => f.original !== f.control).map(f => f.file), ['core/topic-reader-sqlite.mjs']);
  assert.match(readFileSync(join(dir, 'core/topic-reader-sqlite.mjs'), 'utf8'), /TOPIC_WAL_WAIT_MS = 0;/);
  assert.match(readFileSync(join(dir, 'core/topic-reader-sqlite.mjs'), 'utf8'), /TOPIC_WAL_REPLY_RESERVE_MS = 20;/);
});

test('latencyTail reports nearest-rank p99, max and threshold counts', async () => {
  const { latencyTail } = await import('./measure-topic-reader-wal.mjs');
  const values = Array.from({ length: 100 }, (_, i) => i + 1).concat([151, 501, 1001]);
  const tail = latencyTail(values);
  assert.equal(tail.n, 103);
  assert.equal(tail.p99Ms, 501);
  assert.equal(tail.maxMs, 1001);
  assert.deepEqual([tail.over150Ms, tail.over500Ms, tail.over1000Ms], [3, 2, 1]);
  assert.deepEqual(latencyTail([]), { n: 0, p99Ms: null, maxMs: null, over150Ms: 0, over500Ms: 0, over1000Ms: 0 });
});

import assert from 'node:assert/strict';
import test from 'node:test';
import { createTransportDiagnosticsCollector } from '../transport-diagnostics.mjs';

test('closed metadata schema uses monotonic bounded milestones and detached snapshots', () => {
  const collector = createTransportDiagnosticsCollector();
  assert.equal(collector.snapshot(), null);
  collector.openScope(2, 'generation');
  const attempt = collector.start('generation', 'classify');
  attempt.fetchEntered(); attempt.responseAvailable(); attempt.bodyComplete();
  attempt.settle('response', 'succeeded');
  const snapshot = collector.snapshot();
  assert.deepEqual(Object.keys(snapshot).sort(),
    ['schemaVersion', 'scopeOrdinal', 'phase', 'total', 'dropped', 'observations'].sort());
  assert.equal(snapshot.schemaVersion, 'cairn-transport-phase-diagnostics-v1');
  assert.equal(snapshot.scopeOrdinal, 2); assert.equal(snapshot.total, 1);
  assert.equal(snapshot.dropped, 0);
  assert.deepEqual(Object.keys(snapshot.observations[0]).sort(), [
    'scopeOrdinal', 'phase', 'attemptOrdinal', 'route', 'method', 'fetchEnteredMs',
    'responseAvailableMs', 'bodyCompleteMs', 'settledMs', 'termination', 'accountingOutcome'].sort());
  const row = snapshot.observations[0];
  assert.equal(row.route, 'generation'); assert.equal(row.method, 'classify');
  assert.equal(row.termination, 'response'); assert.equal(row.accountingOutcome, 'succeeded');
  for (const field of ['fetchEnteredMs', 'responseAvailableMs', 'bodyCompleteMs', 'settledMs']) {
    assert.equal(Number.isFinite(row[field]) && row[field] >= 0 && row[field] <= 2_147_483_647, true);
  }
  assert.ok(row.fetchEnteredMs <= row.responseAvailableMs);
  assert.ok(row.responseAvailableMs <= row.bodyCompleteMs);
  assert.ok(row.bodyCompleteMs <= row.settledMs);
  assert.throws(() => { snapshot.observations[0].route = 'secret'; }, TypeError);
  assert.equal(collector.snapshot().observations[0].route, 'generation');
});

test('latest scope ring drops oldest, keeps final failure and fences late handles', () => {
  const collector = createTransportDiagnosticsCollector();
  collector.openScope(0, 'generation');
  const old = collector.start('count');
  old.fetchEntered();
  collector.closeScope();
  const previous = collector.snapshot();
  assert.equal(previous.observations[0].settledMs, null);
  assert.equal(previous.observations[0].termination, 'other_failure');
  collector.openScope(1, 'scoring');
  old.responseAvailable(); old.settle('response', 'succeeded');
  for (let index = 0; index < 257; index++) {
    const attempt = collector.start('judge');
    attempt.fetchEntered();
    attempt.settle(index === 256 ? 'transport_failure' : 'response',
      index === 256 ? 'unknown' : 'succeeded');
  }
  const latest = collector.snapshot();
  assert.equal(latest.scopeOrdinal, 1); assert.equal(latest.phase, 'scoring');
  assert.equal(latest.total, 257); assert.equal(latest.dropped, 1);
  assert.equal(latest.observations.length, 256);
  assert.equal(latest.observations[0].attemptOrdinal, 1);
  assert.equal(latest.observations.at(-1).attemptOrdinal, 256);
  assert.equal(latest.observations.at(-1).termination, 'transport_failure');
  assert.equal(latest.observations.at(-1).accountingOutcome, 'unknown');
  assert.deepEqual(previous.observations[0], { scopeOrdinal: 0, phase: 'generation',
    attemptOrdinal: 0, route: 'count', method: 'unknown', fetchEnteredMs: previous.observations[0].fetchEnteredMs,
    responseAvailableMs: null, bodyCompleteMs: null, settledMs: null,
    termination: 'other_failure', accountingOutcome: null });
  assert.equal(JSON.stringify(latest).includes('secret'), false);
});

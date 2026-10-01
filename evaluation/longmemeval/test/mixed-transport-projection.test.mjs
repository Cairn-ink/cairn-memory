import assert from 'node:assert/strict';
import test from 'node:test';
import { MIXED_TRANSPORT_TERMINATIONS,
  projectMixedTransportTermination } from '../../experiment-budget/mixed-transport-observation.mjs';
import { summarizeAttemptsForOrdinal } from '../mixed-generation.mjs';

const attempt = transportTermination => ({ ordinal: 3, stage: 'mem0-embedding',
  outcome: 'unknown', reservedMicroUsd: 15, actualMicroUsd: null, transportTermination });

test('R2 fixed counters retain failure categories beyond the 64-stage prefix for only this ordinal', () => {
  const rows = Array.from({ length: 64 }, () => ({ ...attempt('response'),
    outcome: 'succeeded', actualMicroUsd: 1 }));
  rows.push(...MIXED_TRANSPORT_TERMINATIONS.map(attempt), attempt(undefined));
  rows.splice(10, 0, { ...attempt('transport_failure'), ordinal: 4 });
  const result = summarizeAttemptsForOrdinal(rows, 3);
  assert.equal(result.retainedStageCount, 64);
  assert.equal(result.omittedStageCount, 13);
  assert.equal(result.requests, 77);
  assert.equal(result.reservedMicroUsd, 77 * 15);
  assert.equal(result.knownActualMicroUsd, 64);
  assert.equal(result.unknownActualCount, 13);
  assert.ok(result.stages.every(row => row.transportTermination === 'response'));
  assert.deepEqual(result.terminationCounts, {
    response: 65, http_failure: 1, invalid_response: 1, deadline: 1, cancelled: 1,
    case_sealed: 1, external_abort: 1, transport_failure: 1, body_failure: 1,
    usage_bound_exceeded: 1, invalid_payload: 1, other_failure: 1,
  });
  assert.equal(result.terminationUnavailableCount, 1);
});

test('R2 legacy, null, malformed, accessor and toJSON categories stay unavailable without callbacks', () => {
  const values = [undefined, null, 'PRIVATE_CATEGORY_SENTINEL', 1,
    { toJSON() { assert.fail('category toJSON must not run'); } },
    { toString() { assert.fail('category coercion must not run'); } }];
  const rows = values.map(attempt);
  rows.push(Object.assign(Object.create({ transportTermination: 'response' }),
    { ordinal: 3, stage: 'mem0-chat', outcome: null, reservedMicroUsd: 1, actualMicroUsd: null }));
  const accessor = attempt(null);
  Object.defineProperty(accessor, 'transportTermination', {
    get() { assert.fail('category getter must not run'); }, enumerable: true });
  accessor.toJSON = () => assert.fail('attempt toJSON must not run');
  rows.push(accessor);
  const result = summarizeAttemptsForOrdinal(rows, 3);
  assert.equal(result.terminationUnavailableCount, rows.length);
  assert.ok(result.stages.every(row => row.transportTermination === null));
  assert.ok(Object.values(result.terminationCounts).every(value => value === 0));
  assert.equal(JSON.stringify(result).includes('PRIVATE_CATEGORY_SENTINEL'), false);
  assert.equal(projectMixedTransportTermination(null), null);
  assert.equal(projectMixedTransportTermination('response'), null);
  assert.equal(projectMixedTransportTermination(new Proxy({}, {
    getOwnPropertyDescriptor() { assert.fail('proxy trap must not run'); } })), null);
});

test('R2 every finite category projects exactly, independently of pending or failed accounting', () => {
  for (const category of MIXED_TRANSPORT_TERMINATIONS) {
    assert.equal(projectMixedTransportTermination({ transportTermination: category }), category);
  }
  const result = summarizeAttemptsForOrdinal([{ ...attempt('response'), outcome: null,
    settlementFailure: { operation: 'record_outcome', category: 'ledger_busy' } }], 3);
  assert.equal(result.stages[0].outcome, null);
  assert.equal(result.stages[0].actualMicroUsd, null);
  assert.equal(result.terminationCounts.response, 1);
  assert.equal(result.unknownActualCount, 1);
});

import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import test from 'node:test';

const resultsUrl = new URL('../../official-six-v3/results.json', import.meta.url);
const results = JSON.parse(readFileSync(resultsUrl, 'utf8'));
const keys = (value, allowed) => {
  assert.ok(value && typeof value === 'object' && !Array.isArray(value));
  assert.deepEqual(Object.keys(value).sort(), [...allowed].sort());
};
const integer = value => assert.ok(Number.isSafeInteger(value) && value >= 0);
const plannedBatches = [47, 43, 51, 52, 48, 54];
const completedBatches = [10, 8, 3, null, null, null];
const diagnostics = [
  ['qualification_label_canonicality'],
  ['qualification_label_canonicality'],
  ['qualification_slot_mapping', 'adapter_output_invalid'],
  [], [], [],
];

// This is a frozen observation, not an importer or a runtime report generator.
// Exact allowlists and finite values forbid arbitrary source/provider text.
function checkReport(value) {
  keys(value, ['schemaVersion', 'runtimeCommit', 'generation', 'scoring', 'denominators', 'cases', 'accounting']);
  assert.equal(value.schemaVersion, 'official-six-v3-aggregate-v1');
  assert.equal(value.runtimeCommit, '26a7221ec82134306ef2dfeffe11ce46fab3e6be');
  keys(value.generation, ['halted', 'haltReason', 'operatorStatus', 'operatorReason', 'mechanicalSuccess', 'scoreableSix']);
  assert.deepEqual(value.generation, {
    halted: true, haltReason: 'scope_execution_failed', operatorStatus: 'halted',
    operatorReason: 'generation_halted', mechanicalSuccess: false, scoreableSix: false,
  });
  keys(value.scoring, ['executed', 'artifactPresent']);
  assert.deepEqual(value.scoring, { executed: false, artifactPresent: false });
  keys(value.denominators, ['plannedCases', 'plannedArms', 'completedArms', 'failedArms', 'blockedArms']);
  assert.deepEqual(value.denominators, {
    plannedCases: 6, plannedArms: 12, completedArms: 1, failedArms: 5, blockedArms: 6,
  });
  assert.ok(Array.isArray(value.cases));
  assert.equal(value.cases.length, value.denominators.plannedCases);
  assert.equal(value.cases.reduce((sum, row) => sum + row.plannedBatches, 0), 295);
  const totals = { completed: 0, failed: 0, blocked: 0 };
  value.cases.forEach((row, i) => {
    keys(row, ['index', 'plannedBatches', 'cairn', 'mem0']);
    assert.equal(row.index, i + 1);
    assert.equal(row.plannedBatches, plannedBatches[i]);
    keys(row.cairn, ['status', 'reason', 'completedBatches', 'diagnostics']);
    keys(row.mem0, ['status', 'reason', 'answerPresent']);
    assert.deepEqual(row.cairn, {
      status: i < 3 ? 'failed' : 'blocked',
      reason: i < 3 ? 'ingestion_incomplete' : 'scope_execution_failed',
      completedBatches: completedBatches[i], diagnostics: diagnostics[i],
    });
    assert.deepEqual(row.mem0, {
      status: i === 0 ? 'completed' : i < 3 ? 'failed' : 'blocked',
      reason: [null, 'invalid_payload', 'scope_execution_failed', 'scope_execution_failed',
        'scope_execution_failed', 'scope_execution_failed'][i],
      answerPresent: i === 0,
    });
    totals[row.cairn.status]++;
    totals[row.mem0.status]++;
  });
  assert.equal(totals.completed, value.denominators.completedArms);
  assert.equal(totals.failed, value.denominators.failedArms);
  assert.equal(totals.blocked, value.denominators.blockedArms);
  assert.equal(totals.completed + totals.failed + totals.blocked, value.denominators.plannedArms);
  assert.equal(value.denominators.plannedArms, 2 * value.denominators.plannedCases);

  const a = value.accounting;
  keys(a, ['prefixRequestCount', 'prefixReservedMicroUsd', 'newRequests', 'newReservedMicroUsd',
    'finalRequestCount', 'finalReservedMicroUsd', 'limitMicroUsd', 'remainingReservationMicroUsd',
    'ledgerState', 'settledRequests', 'settledSucceeded', 'settledFailed', 'knownCostRequests',
    'knownCostMicroUsd', 'settledUnknownCostRequests', 'unknownCostRequestsIncludingPending',
    'pendingRequests', 'pendingEmbedding']);
  for (const [key, val] of Object.entries(a)) if (!['ledgerState', 'pendingEmbedding'].includes(key)) integer(val);
  assert.deepEqual(a, {
    prefixRequestCount: 18768, prefixReservedMicroUsd: 121064614,
    newRequests: 510, newReservedMicroUsd: 2730879,
    finalRequestCount: 19278, finalReservedMicroUsd: 123795493,
    limitMicroUsd: 200000000, remainingReservationMicroUsd: 76204507,
    ledgerState: 'open', settledRequests: 509, settledSucceeded: 508, settledFailed: 1,
    knownCostRequests: 403, knownCostMicroUsd: 710086, settledUnknownCostRequests: 106,
    unknownCostRequestsIncludingPending: 107, pendingRequests: 1,
    pendingEmbedding: { reservedMicroUsd: 10, observedCostMicroUsd: 10,
      inputTokens: 470, outputTokens: 0, durableOutcome: null, durableCostMicroUsd: null },
  });
  keys(a.pendingEmbedding, ['reservedMicroUsd', 'observedCostMicroUsd', 'inputTokens', 'outputTokens',
    'durableOutcome', 'durableCostMicroUsd']);
  assert.equal(a.prefixRequestCount + a.newRequests, a.finalRequestCount);
  assert.equal(a.prefixReservedMicroUsd + a.newReservedMicroUsd, a.finalReservedMicroUsd);
  assert.equal(a.finalReservedMicroUsd + a.remainingReservationMicroUsd, a.limitMicroUsd);
  assert.equal(a.settledSucceeded + a.settledFailed, a.settledRequests);
  assert.equal(a.settledRequests + a.pendingRequests, a.newRequests);
  assert.equal(a.knownCostRequests + a.settledUnknownCostRequests, a.settledRequests);
  assert.equal(a.settledUnknownCostRequests + a.pendingRequests, a.unknownCostRequestsIncludingPending);
  assert.equal(a.knownCostRequests + a.unknownCostRequestsIncludingPending, a.newRequests);
}

test('frozen public report preserves all scheduled outcomes and incomplete accounting without a score', () => {
  checkReport(results);
  assert.equal(existsSync(new URL('../../official-six-v3/scoring.json', import.meta.url)), false);
});

test('closed shape rejects source text, identifiers, provider data and fabricated scores at every object boundary', () => {
  const objects = value => value && typeof value === 'object'
    ? [value, ...Object.values(value).flatMap(objects)].filter(x => !Array.isArray(x)) : [];
  const fields = ['question', 'source', 'answer', 'reference', 'questionId', 'namespace',
    'credential', 'privatePath', 'providerBody', 'headers', 'database', 'accuracy', 'correct'];
  for (const field of fields) {
    for (let i = 0; i < objects(results).length; i++) {
      const copy = structuredClone(results);
      objects(copy)[i][field] = 'PRIVATE_SENTINEL';
      assert.throws(() => checkReport(copy));
    }
  }
  for (const mutate of [
    v => { v.cases[0].cairn.diagnostics[0] = 'PRIVATE_SENTINEL'; },
    v => { v.cases[1].mem0.reason = 'PRIVATE_SENTINEL'; },
    v => { v.scoring.executed = true; },
    v => { v.cases.pop(); },
    v => { v.cases.reverse(); },
    v => { v.cases[3].cairn.completedBatches = 0; },
    v => { v.accounting.pendingEmbedding.durableOutcome = 'succeeded'; },
    v => { v.accounting.pendingEmbedding.durableCostMicroUsd = 10; },
    v => { v.accounting.unknownCostRequestsIncludingPending = 106; },
    v => { v.accounting.newReservedMicroUsd++; },
    v => { v.accounting.pendingRequests = 0; },
  ]) {
    const copy = structuredClone(results);
    mutate(copy);
    assert.throws(() => checkReport(copy));
  }
});

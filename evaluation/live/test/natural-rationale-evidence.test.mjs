import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { exportNaturalRationaleEvidence } from '../natural-rationale-evidence.mjs';

const artifactBytes = readFileSync(new URL('../../../evaluations/results/natural-rationale-dev-v1.json', import.meta.url));
const artifact = JSON.parse(artifactBytes);
const schedule = [['dev-vendor-transition-en', ['d1', 'd2', 'd3', 'd4'], 'q1'],
  ['dev-tentative-zh', ['d5', 'd6'], 'q2'], ['dev-premise-failure-en', ['d7', 'd8'], 'q3'],
  ['dev-other-actor-zh', ['d9', 'd10'], 'q4']];
function sample() {
  return { version: 1, id: 'natural-rationale-dev-v1', diagnosticOnly: true,
    fixtureSha256: artifact.provenance.fixtureSha256, pins: { ...artifact.provenance.pins },
    status: 'not_run', budgetBefore: null, budgetAfter: null, attempt: null,
    cleanup: { drain: 'not-opened', sessionClose: 'not-opened', ledgerClose: 'not-opened' },
    cases: schedule.map(([caseId]) => ({ caseId, status: 'not_run', result: null })) };
}
function caseResult(ids, questionId) {
  const view = () => ({ status: 'ok', edges: [], failures: [] });
  const arm = (coverage = 'complete') => ({ status: 'ok', sourceIds: [...ids], coverage,
    sourceCoverage: { expectedEvents: ids.length, capturedEvents: ids.length,
      returnedEvents: ids.length, unreturnedSourceIds: [] } });
  return { caseId: schedule[0][0], split: 'dev', sourceCount: ids.length,
    capturedSourceIds: [...ids], absentSourceIds: [], truncatedSourceIds: [], incompleteCapture: false,
    captures: ids.map(sourceId => ({ sourceId, status: 'ok', classification: { status: 'applied' },
      naturalRationale: { captureRationale: { status: 'reviewed', proposed: 0, inserted: 0,
        interpretationStatus: 'model-proposed' }, observation: 'candidate-seen-no-proposal',
      relateCalls: [], beforeCapture: view(), afterCapture: view(), afterColdReopen: view() } })),
    questions: [{ questionId, arms: { 'source-evidence': arm(),
      'rationale-evidence': { ...arm(), relationshipStatus: 'unassessed-not-linked',
        relationshipGeneration: 'automatic-source-bound-v1' }, sourceSnapshot: arm('complete-current-admitted') } }] };
}

test('NRE1 fixed public artifact preserves the full denominator, proposals and accounting', () => {
  assert.equal(createHash('sha256').update(artifactBytes).digest('hex'), '0c590e97f69fc6976f95ee30f73ddb3a5f227fc92a765dedee57bffb17a0bd78');
  assert.deepEqual(artifact.cases.map(item => item.caseId), schedule.map(item => item[0]));
  assert.deepEqual(artifact.denominators, { cases: 4, events: 10, questions: 4, readArmSlots: 12,
    completedCases: 4, completedWithFailuresCases: 0, failedCases: 0, notRunCases: 0,
    failedCaptures: 0, unavailableCaptureSlots: 0, unavailableQuestionSlots: 0,
    failedReadArms: 0, notRunReadArms: 0, unavailableReadArmSlots: 0,
    relateCalls: 10, proposedEdges: 5 });
  assert.deepEqual(artifact.budgetDelta, { requests: 112, reservedMicroUsd: 560000,
    knownUsageMicroUsd: 25971, unknownCostRequests: 56 });
  assert.equal(artifact.budgetAfter.requestCount, 2117);
  assert.equal(artifact.budgetAfter.reservedMicroUsd, 24786000);
  assert.equal(artifact.cases[0].result.questions[0].arms['source-evidence'].sourceIds.join(','), 'd4');
  assert.equal(artifact.cases[0].result.questions[0].arms['rationale-evidence'].sourceIds.join(','), 'd4');
  assert.equal(artifact.cases[0].result.questions[0].arms.sourceSnapshot.sourceIds.length, 4);
  assert.equal(artifact.cases[2].result.questions[0].arms['rationale-evidence'].relationshipStatus, 'unassessed-not-linked');
  assert.ok(!/\/tmp\/|\/home\/|Bearer |memoryId|receiptId|namespace|providerResponse/iu.test(artifactBytes.toString()));
});

test('NRE2 fixed schedule preserves failed and not-run slots; malformed success rejects', () => {
  const raw = sample(); raw.cases[0].status = 'failed';
  const output = exportNaturalRationaleEvidence(raw);
  assert.equal(output.denominators.failedCases, 1); assert.equal(output.denominators.notRunCases, 3);
  assert.equal(output.denominators.unavailableCaptureSlots, 10);
  assert.equal(output.denominators.unavailableQuestionSlots, 4);
  assert.equal(output.denominators.unavailableReadArmSlots, 12);
  assert.equal(output.cases[0].result, null);
  raw.cases[1].caseId = 'other'; assert.throws(() => exportNaturalRationaleEvidence(raw));
  raw.cases[1].caseId = schedule[1][0]; raw.cases[1].status = 'completed';
  assert.throws(() => exportNaturalRationaleEvidence(raw));
});

test('NRE3 unmatched/ambiguous provenance and unavailable proposals are not converted to links', () => {
  const raw = sample(); raw.cases[0].status = 'completed';
  raw.cases[0].result = caseResult(schedule[0][1], 'q1');
  raw.cases[0].result.captures[0].naturalRationale.relateCalls = [{ status: 'returned',
    candidates: [{ index: 0, receipts: [{ index: 0, role: 'user',
      provenance: { status: 'ambiguous', matchingReceiptCount: 2, memoryId: 'private' } },
    { index: 1, role: 'user', provenance: { status: 'unmatched' } }] }], proposedEdges: null }];
  const output = exportNaturalRationaleEvidence(raw);
  const call = output.cases[0].result.captures[0].relateCalls[0];
  assert.equal(call.proposedEdges, null);
  assert.deepEqual(call.candidates[0].receipts.map(item => item.provenance), [
    { status: 'ambiguous', matchingReceiptCount: 2 }, { status: 'unmatched' }]);
  assert.equal(output.denominators.relateCalls, 1); assert.equal(output.denominators.proposedEdges, 0);
});

test('NRE4 output is closed and rejects sensitive projected values and false accounting', () => {
  const raw = sample(); raw.privatePath = '/tmp/private'; raw.pins.authorization = 'Bearer private';
  assert.equal(JSON.stringify(exportNaturalRationaleEvidence(raw)).includes('private'), false);
  raw.cases[0].status = 'completed'; raw.cases[0].result = caseResult(schedule[0][1], 'q1');
  raw.cases[0].result.captures[0].classification.status = '/tmp/private';
  assert.throws(() => exportNaturalRationaleEvidence(raw));
  raw.cases[0].result.captures[0].classification.status = 'applied';
  raw.budgetBefore = { ...artifact.budgetBefore }; raw.budgetAfter = { ...artifact.budgetAfter };
  raw.attempt = { requests: 111, reservedMicroUsd: 560000, halted: null, readOnly: false };
  assert.throws(() => exportNaturalRationaleEvidence(raw));
});

test('NRE5 failed rationale and unavailable trace keep null counts and null proposals', () => {
  const raw = sample(); raw.cases[0].status = 'completed_with_failures';
  raw.cases[0].result = caseResult(schedule[0][1], 'q1');
  const capture = raw.cases[0].result.captures[0];
  capture.naturalRationale.captureRationale = { status: 'failed' };
  capture.naturalRationale.observation = 'candidate-seen-trace-unavailable';
  capture.naturalRationale.relateCalls = [{ status: 'trace-unavailable', candidates: [], proposedEdges: null }];
  const output = exportNaturalRationaleEvidence(raw);
  assert.equal(output.denominators.completedWithFailuresCases, 1);
  assert.deepEqual(output.cases[0].result.captures[0].rationale,
    { status: 'failed', proposed: null, inserted: null, interpretationStatus: null });
  assert.deepEqual(output.cases[0].result.captures[0].relateCalls[0],
    { status: 'trace-unavailable', candidates: [], proposedEdges: null });
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
const read = suffix => readFileSync(new URL(`../../../evaluations/results/qualified-paired-v1${suffix}.json`, import.meta.url), 'utf8');
const evidence = JSON.parse(read(''));
const reviews = ['-english-review', '-chinese-review'].flatMap(suffix => JSON.parse(read(suffix)).cases);
const key = entry => `${entry.caseId}/${entry.arm}`;
const claimKey = entry => JSON.stringify([entry.memoryId, entry.content]);

test('frozen paired evidence keeps all sixteen slots, source hashes and conservative accounting', () => {
  assert.equal(evidence.report.arms.length, 16);
  assert.equal(new Set(evidence.report.arms.map(key)).size, 16);
  for (const [suffix, field] of [['-sources', 'sourceSha256'], ['-rubric', 'rubricSha256']]) {
    assert.equal(createHash('sha256').update(read(suffix)).digest('hex'), evidence.provenance[field]);
  }
  const { before, after, attempt } = evidence.accounting;
  assert.equal(after.requests - before.requests, attempt.requests);
  assert.equal(after.reservedMicroUsd - before.reservedMicroUsd, attempt.reservedMicroUsd);
  assert.ok(attempt.requests <= 272 && attempt.reservedMicroUsd <= 2300000);
  assert.ok(after.reservedMicroUsd <= 20000000 && after.requests <= 4000);
  assert.equal(after.unsettled, 0);
  assert.equal(attempt.requests, 233);
  assert.equal(attempt.reservedMicroUsd, 2004608);
  assert.equal(evidence.report.status, 'incomplete');
  assert.equal(evidence.report.arms.filter(arm => arm.status === 'completed').length, 15);
  const incomplete = evidence.report.arms.find(arm => arm.status !== 'completed');
  assert.equal(key(incomplete), 'Q02/qualified');
  assert.equal(incomplete.windows[1].capture.error.code, 'invalid_model_output');
  assert.equal(incomplete.recall.status, 'not_run');
  assert.equal(incomplete.answer.status, 'not_run');
});

test('independent labels cover every persisted claim and retirement without replacing missing outcomes', () => {
  assert.equal(reviews.length, 16);
  assert.equal(new Set(reviews.map(key)).size, 16);
  for (const arm of evidence.report.arms) {
    const review = reviews.find(item => key(item) === key(arm));
    assert.ok(review);
    assert.equal(review.operationStatus, arm.status);
    const records = arm.windows.flatMap(window => window.reopenedRecords ?? window.records ?? []);
    const claims = new Set(records.map(({ memory }) => claimKey({ memoryId: memory.id, content: memory.content })));
    assert.deepEqual(new Set(review.claims.map(claimKey)), claims, key(arm));
    assert.equal(review.claims.length, claims.size);
    assert.ok(review.claims.every(claim => typeof claim.supported === 'boolean' && claim.reason));
    const retired = new Map(records.filter(record => record.supersession).map(record =>
      [record.memory.id, record.supersession.replacement.memoryId]));
    assert.deepEqual(new Map(review.retirements.map(item => [item.predecessorId, item.successorId])), retired, key(arm));
    assert.equal(review.retirements.length, retired.size);
    assert.ok(review.retirements.every(item => typeof item.justified === 'boolean' && item.reason));
    for (const field of ['currentState', 'requiredRetrieval', 'answer']) {
      assert.ok(['pass', 'fail', 'missing'].includes(review[field].status) && review[field].reason);
    }
    assert.ok(['pass', 'fail', 'missing', 'not_applicable'].includes(review.positiveUpdate.status));
    assert.ok(['pass', 'fail', 'missing'].includes(review.overall));
    if (arm.answer.status !== 'completed') assert.equal(review.answer.status, 'missing');
    if (arm.status !== 'completed') assert.notEqual(review.overall, 'pass');
    if (review.retirements.some(item => !item.justified)) assert.notEqual(review.overall, 'pass');
  }
});

test('retained model observations match accounting and exclude evaluator-only fields', () => {
  const inputs = evidence.modelCalls.filter(call => call.stage === 'input');
  const outputs = evidence.modelCalls.filter(call => call.stage === 'output');
  assert.equal(inputs.length, 109);
  assert.equal(outputs.length, 109);
  assert.equal(inputs.length * 2 + 15, evidence.accounting.attempt.requests);
  for (const call of inputs) {
    assert.ok(outputs.some(output => output.sequence === call.sequence && key(output) === key(call)));
    const serialized = JSON.stringify(call.input);
    assert.doesNotMatch(serialized, /"(?:requiredCurrent|forbiddenCurrent|expectedAnswer|allowedRetirements|qualificationObligations)"\s*:/u);
  }
});

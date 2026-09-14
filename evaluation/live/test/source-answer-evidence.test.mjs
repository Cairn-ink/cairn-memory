import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { exportSourceAnswerEvidence } from '../source-answer-evidence.mjs';

const artifact = JSON.parse(readFileSync(new URL('../../../evaluations/results/source-answer-utility-v1.json', import.meta.url)));
const raw = () => ({ ...structuredClone(artifact), offline: false,
  pins: { fixture: artifact.fixtureSha256, rubric: artifact.rubricSha256, operator: artifact.operatorSha256, sourceRaw: artifact.sourceRawSha256 },
  cases: structuredClone(artifact.cases).map(c => ({ ...c, providerResponse: c.response })) });

test('SAE1: fixed sixteen-answer public projection and pre-live fixture pins are exact', () => {
  assert.deepEqual(exportSourceAnswerEvidence(raw()), artifact);
  for (const [path, expected] of [['../source-answer-fixture.json', artifact.fixtureSha256],
    ['../../../docs/source-answer-rubric.md', artifact.rubricSha256]]) {
    assert.equal(createHash('sha256').update(readFileSync(new URL(path, import.meta.url))).digest('hex'), expected);
  }
  assert.equal(artifact.cases.length, 16);
  assert.equal(artifact.cases.filter(c => c.status === 'completed').length, 16);
  assert.equal(artifact.budgetAfter.requestCount - artifact.budgetBefore.requestCount, 16);
  assert.equal(artifact.budgetAfter.reservedMicroUsd - artifact.budgetBefore.reservedMicroUsd, 800000);
  assert.equal(artifact.budgetAfter.knownUsageMicroUsd - artifact.budgetBefore.knownUsageMicroUsd, 3861);
  assert.equal(artifact.budgetAfter.unknownCostRequests, 521);
  assert.equal(artifact.budgetAfter.unsettled, 0);
  assert.equal(artifact.semanticStatus, 'unassessed');
});

test('SAE2: source contexts are fixed, including identical MOC sources with or without basis', () => {
  for (const id of ['rill-battery', 'pickup-hours', 'temporary-reading', 'journal-belief']) {
    const rows = Object.fromEntries(artifact.cases.filter(c => c.caseId === id).map(c => [c.arm, c]));
    assert.deepEqual(rows.none.context, { sources: [] });
    assert.deepEqual(rows.moc.context.sources, rows['moc-basis'].context.sources);
    assert.equal(rows['moc-basis'].context.basis.status, 'unassessed');
  }
  const altered = raw(); altered.cases[1].context.sources[0].receipts[0].excerpt = 'Invented source';
  assert.throws(() => exportSourceAnswerEvidence(altered), /invalid_source_answer_context/u);
  const leaked = raw(); leaked.cases[0].body.messages[1].content = 'Expected answer';
  assert.throws(() => exportSourceAnswerEvidence(leaked), /invalid_source_answer_body/u);
});

test('SAE3: failed, missing, malformed and truncated answers stay visible rather than counted as success', () => {
  const value = raw(); value.status = 'halted'; value.halted = 'transport_guard_or_evidence_failed';
  value.cases[0].status = 'failed'; value.cases[0].answer = null; value.cases[0].providerResponse = null;
  value.cases[0].responseAvailable = false; value.cases.length = 1;
  const projected = exportSourceAnswerEvidence(value);
  assert.equal(projected.cases[0].status, 'failed');
  assert.equal(projected.cases.filter(c => c.status === 'not_run').length, 15);
  assert.equal(projected.halted, value.halted);
  const malformed = raw(); malformed.cases[0].status = 'invalid_output';
  malformed.cases[0].providerResponse.choices = []; malformed.cases[0].answer = null;
  assert.deepEqual(exportSourceAnswerEvidence(malformed).cases[0].response.choices, []);
  const truncated = raw(); truncated.cases[0].status = 'invalid_output';
  truncated.cases[0].providerResponse.choices[0].finish_reason = 'length';
  assert.equal(exportSourceAnswerEvidence(truncated).cases[0].response.choices[0].finish_reason, 'length');
  assert.equal(exportSourceAnswerEvidence(truncated).cases[0].answer, truncated.cases[0].answer);
});

test('SAE4: other fixtures, reordered slots and sensitive retained strings are rejected', () => {
  for (const change of [r => { r.offline = true; }, r => { r.pins.fixture = 'other'; },
    r => { r.pins.sourceRaw = 'other'; }, r => { r.cases.reverse(); }]) {
    const value = raw(); change(value); assert.throws(() => exportSourceAnswerEvidence(value), /invalid_source_answer/u);
  }
  for (const text of ['/home/person/private', '/tmp/private', 'Bearer synthetic-secret']) {
    const value = raw(); value.cases[0].answer = text;
    assert.throws(() => exportSourceAnswerEvidence(value), /sensitive_source_answer_evidence/u);
  }
  const metadata = raw(); metadata.privatePath = '/home/person/private';
  metadata.cases[0].providerResponse.id = 'private-provider-id';
  assert.deepEqual(exportSourceAnswerEvidence(metadata), artifact);
});

test('SAE5: omissions and abstentions remain raw answers, not fabricated accuracy judgments', () => {
  const pickup = artifact.cases.find(c => c.id === 'pickup-hours-moc-basis');
  assert.match(pickup.answer, /starting next week/u);
  assert.doesNotMatch(pickup.answer, /15:00/u);
  for (const c of artifact.cases) {
    assert.equal(c.answer, c.response.choices[0].message.content);
    assert.equal(Object.hasOwn(c, 'correct'), false);
    assert.equal(Object.hasOwn(c, 'score'), false);
  }
});

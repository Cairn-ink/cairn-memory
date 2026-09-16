import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { boundedText } from '../../../core/validation.mjs';

const fixtureText = readFileSync(new URL('../../live/decision-transition-fixture.json', import.meta.url), 'utf8');
const rubricText = readFileSync(new URL('../../../docs/decision-transition-rubric.json', import.meta.url), 'utf8');
const fixture = JSON.parse(fixtureText);
const rubric = JSON.parse(rubricText);

const exact = (value, keys) => value !== null && typeof value === 'object' &&
  !Array.isArray(value) && Object.getPrototypeOf(value) === Object.prototype &&
  Object.keys(value).sort().join(',') === [...keys].sort().join(',');
const dense = value => Array.isArray(value) && Object.getPrototypeOf(value) === Array.prototype &&
  Object.keys(value).length === value.length &&
  Array.from({ length: value.length }, (_, index) => index).every(index => Object.hasOwn(value, index));
const normalized = value => typeof value === 'string' && value.length > 0 &&
  value.isWellFormed() && value === boundedText(value, 4000);
const date = value => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/u.test(value) &&
  new Date(`${value}T00:00:00.000Z`).toISOString().slice(0, 10) === value;

function validate(source, gold) {
  assert.ok(exact(source, ['version', 'cases']));
  assert.equal(source.version, 'decision-transition-fixture-v1');
  assert.ok(dense(source.cases) && source.cases.length === 4);
  assert.ok(exact(gold, ['version', 'use', 'boundary', 'commonForbiddenConclusions', 'cases']));
  assert.equal(gold.version, 'decision-transition-rubric-v1');
  assert.ok(gold.use.includes('Evaluator only'));
  assert.ok(exact(gold.boundary, ['sourceStatus', 'judgment', 'alternativeSupport',
    'optionalHistory', 'failureAccounting']));
  for (const value of Object.values(gold.boundary)) assert.ok(normalized(value));
  assert.ok(dense(gold.commonForbiddenConclusions) && gold.commonForbiddenConclusions.length >= 4);
  for (const value of gold.commonForbiddenConclusions) assert.ok(normalized(value));
  assert.ok(dense(gold.cases) && gold.cases.length === source.cases.length);
  const allIds = new Set();
  const expectedPairs = ['export-decision', 'export-decision',
    'database-dependency', 'database-dependency'];
  for (const [index, scenario] of source.cases.entries()) {
    const evaluation = gold.cases[index];
    assert.ok(exact(scenario, ['id', 'pair', 'batches', 'question']));
    assert.equal(scenario.pair, expectedPairs[index]);
    assert.ok(typeof scenario.id === 'string' && scenario.id.length > 0);
    assert.ok(!allIds.has(scenario.id)); allIds.add(scenario.id);
    assert.ok(dense(scenario.batches) && scenario.batches.length === 3);
    let previousCapture = '';
    const messageById = new Map();
    for (const batch of scenario.batches) {
      assert.ok(exact(batch, ['id', 'capturedOn', 'messages']));
      assert.ok(typeof batch.id === 'string' && !allIds.has(batch.id)); allIds.add(batch.id);
      assert.ok(date(batch.capturedOn) && batch.capturedOn > previousCapture);
      previousCapture = batch.capturedOn;
      assert.ok(dense(batch.messages) && batch.messages.length === 3);
      let batchUnits = 0;
      for (const message of batch.messages) {
        assert.ok(exact(message, ['id', 'role', 'content']));
        assert.ok(typeof message.id === 'string' && !allIds.has(message.id)); allIds.add(message.id);
        assert.ok(['user', 'assistant'].includes(message.role));
        assert.ok(normalized(message.content) && message.content.length <= 600);
        assert.ok(/[\p{Script=Han}]/u.test(message.content));
        batchUnits += message.content.length;
        messageById.set(message.id, message);
      }
      assert.ok(batchUnits <= 4000);
    }
    assert.equal(messageById.size, 9);
    assert.ok(exact(scenario.question, ['id', 'role', 'content']));
    assert.equal(scenario.question.role, 'user');
    assert.ok(typeof scenario.question.id === 'string' && !allIds.has(scenario.question.id));
    allIds.add(scenario.question.id);
    assert.ok(normalized(scenario.question.content) && scenario.question.content.length <= 600);
    assert.ok(exact(evaluation, ['id', 'requiredClaims', 'optionalHistory', 'forbiddenConclusions']));
    assert.equal(evaluation.id, scenario.id);
    assert.ok(dense(evaluation.requiredClaims) && evaluation.requiredClaims.length >= 7);
    assert.ok(dense(evaluation.optionalHistory));
    assert.ok(dense(evaluation.forbiddenConclusions) && evaluation.forbiddenConclusions.length >= 2);
    for (const item of evaluation.forbiddenConclusions) assert.ok(normalized(item));
    const claimIds = new Set();
    for (const claim of evaluation.requiredClaims) {
      assert.ok(exact(claim, ['id', 'claim', 'status', 'anchors']));
      assert.ok(typeof claim.id === 'string' && claim.id.length > 0 && !claimIds.has(claim.id));
      claimIds.add(claim.id);
      assert.ok(normalized(claim.claim) && normalized(claim.status));
      assert.ok(dense(claim.anchors) && claim.anchors.length >= 1);
      const citations = new Set();
      for (const anchor of claim.anchors) {
        assert.ok(exact(anchor, ['messageId', 'quote']));
        assert.ok(messageById.has(anchor.messageId), `${scenario.id}/${claim.id}: missing message`);
        assert.ok(normalized(anchor.quote));
        const content = messageById.get(anchor.messageId).content;
        const first = content.indexOf(anchor.quote);
        assert.ok(first >= 0 && content.indexOf(anchor.quote, first + 1) < 0,
          `${scenario.id}/${claim.id}: quote is missing or not unique in source`);
        const citation = `${anchor.messageId}\u0000${anchor.quote}`;
        assert.ok(!citations.has(citation)); citations.add(citation);
      }
    }
  }
  assert.equal(allIds.size, 4 * (1 + 3 + 9 + 1));
  for (const [left, right] of [[0, 1], [2, 3]]) {
    assert.deepEqual(source.cases[left].batches.slice(0, 2).map(batch => ({
      capturedOn: batch.capturedOn,
      messages: batch.messages.map(message => [message.role, message.content]),
    })), source.cases[right].batches.slice(0, 2).map(batch => ({
      capturedOn: batch.capturedOn,
      messages: batch.messages.map(message => [message.role, message.content]),
    })));
    assert.equal(source.cases[left].question.content, source.cases[right].question.content);
    assert.notEqual(source.cases[left].batches[2].messages[0].content,
      source.cases[right].batches[2].messages[0].content);
  }
  return true;
}

test('DT1–3/6 four counterfactual conversations and separate evaluator anchors are structurally sound', () => {
  assert.equal(validate(fixture, rubric), true);
  const [review, replaced, unknown, active] = fixture.cases;
  assert.deepEqual(review.batches.slice(0, 2).map(batch => batch.messages.map(message =>
    [message.role, message.content])), replaced.batches.slice(0, 2).map(batch =>
    batch.messages.map(message => [message.role, message.content])));
  assert.deepEqual(unknown.batches.slice(0, 2).map(batch => batch.messages.map(message =>
    [message.role, message.content])), active.batches.slice(0, 2).map(batch =>
    batch.messages.map(message => [message.role, message.content])));
  assert.equal(review.question.content, replaced.question.content);
  assert.equal(unknown.question.content, active.question.content);
  assert.notEqual(review.batches[2].messages[0].content, replaced.batches[2].messages[0].content);
  assert.notEqual(unknown.batches[2].messages[0].content, active.batches[2].messages[0].content);
  assert.equal(fixture.cases.reduce((count, scenario) => count + scenario.batches.reduce(
    (within, batch) => within + batch.messages.length, 0), 0), 36);
  for (const forbidden of ['requiredClaims', 'forbiddenConclusions', 'anchors', 'expectedAnswer',
    'gold', 'grade', 'sourceProjection']) assert.ok(!fixtureText.includes(`"${forbidden}"`));
  assert.ok(rubric.cases[2].requiredClaims.some(item => item.id === 'api-unknown' &&
    item.status === 'unknown'));
  assert.ok(rubric.cases[3].requiredClaims.some(item => item.id === 'api-active' &&
    item.status === 'still-active'));
});

test('DT6 malformed batch, role, ID, source leak, and evaluator anchor fail closed', () => {
  const sourceMutations = [
    value => { value.cases.pop(); },
    value => { value.cases[0].batches[0].messages.pop(); },
    value => { value.cases[0].batches[1].capturedOn = '2026-01-01'; },
    value => { value.cases[0].batches[0].messages[0].role = 'system'; },
    value => { value.cases[0].batches[0].messages[0].content = 'Two  spaces'; },
    value => { value.cases[0].batches[0].messages[0].content = '全'.repeat(601); },
    value => { value.cases[0].batches[0].messages[1].id = value.cases[0].batches[0].messages[0].id; },
    value => { value.cases[0].batches[0].messages[0].gold = true; },
    value => { value.cases[1].batches[0].messages[0].content = '展務組另有決定。'; },
  ];
  for (const mutate of sourceMutations) {
    const copy = structuredClone(fixture);
    mutate(copy);
    assert.throws(() => validate(copy, rubric));
  }
  const badRubric = structuredClone(rubric);
  badRubric.cases[0].requiredClaims[0].anchors[0].quote = 'invented passage';
  assert.throws(() => validate(fixture, badRubric));
  const badCase = structuredClone(rubric);
  badCase.cases[0].requiredClaims[0].anchors[0].messageId = 'field-active-m01';
  assert.throws(() => validate(fixture, badCase));
});

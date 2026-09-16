import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { boundedText } from '../../../core/validation.mjs';

const sourceText = readFileSync(new URL('../../live/cold-neighborhood-fixture.json', import.meta.url), 'utf8');
const rubricText = readFileSync(new URL('../../../docs/cold-neighborhood-rubric.json', import.meta.url), 'utf8');
const source = JSON.parse(sourceText);
const rubric = JSON.parse(rubricText);
const exact = (value, keys) => value !== null && typeof value === 'object' &&
  !Array.isArray(value) && Object.getPrototypeOf(value) === Object.prototype &&
  Object.keys(value).sort().join(',') === [...keys].sort().join(',');
const dense = value => Array.isArray(value) && Object.getPrototypeOf(value) === Array.prototype &&
  Object.keys(value).length === value.length &&
  Array.from({ length: value.length }, (_, index) => index).every(index => Object.hasOwn(value, index));
const normalized = text => typeof text === 'string' && text.length > 0 &&
  text.isWellFormed() && text === boundedText(text, 4000);
const date = value => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/u.test(value) &&
  new Date(`${value}T00:00:00.000Z`).toISOString().slice(0, 10) === value;

function validate(fixture, evaluation) {
  assert.ok(exact(fixture, ['cases']));
  assert.ok(dense(fixture.cases));
  assert.equal(fixture.cases.length, 4);
  assert.ok(exact(evaluation, ['schemaVersion', 'evaluationOnly', 'cases']));
  assert.equal(evaluation.schemaVersion, 1);
  assert.equal(evaluation.evaluationOnly, true);
  assert.ok(dense(evaluation.cases));
  assert.equal(evaluation.cases.length, fixture.cases.length);
  const allIds = new Set();
  for (const [caseIndex, scenario] of fixture.cases.entries()) {
    const gold = evaluation.cases[caseIndex];
    assert.ok(exact(scenario, ['id', 'batches', 'question']));
    assert.equal(typeof scenario.id, 'string');
    assert.ok(!allIds.has(scenario.id)); allIds.add(scenario.id);
    assert.ok(exact(gold, ['id', 'distractorMessageIds', 'obligations', 'forbiddenInferences']));
    assert.equal(gold.id, scenario.id);
    assert.ok(dense(scenario.batches));
    assert.equal(scenario.batches.length, 3);
    const messageById = new Map();
    let priorDate = '';
    for (const batch of scenario.batches) {
      assert.ok(exact(batch, ['id', 'capturedOn', 'messages']));
      assert.equal(typeof batch.id, 'string');
      assert.ok(!allIds.has(batch.id)); allIds.add(batch.id);
      assert.ok(date(batch.capturedOn) && batch.capturedOn > priorDate);
      priorDate = batch.capturedOn;
      assert.ok(dense(batch.messages) && batch.messages.length >= 1 && batch.messages.length <= 24);
      let units = 0;
      for (const message of batch.messages) {
        assert.ok(exact(message, ['id', 'role', 'content']));
        assert.equal(typeof message.id, 'string');
        assert.ok(!allIds.has(message.id)); allIds.add(message.id);
        assert.ok(['user', 'assistant'].includes(message.role));
        assert.ok(normalized(message.content));
        assert.ok(message.content.length <= 600);
        units += message.content.length;
        messageById.set(message.id, message);
      }
      assert.ok(units <= 4000);
    }
    assert.ok(messageById.size >= 12 && messageById.size <= 18);
    assert.ok(exact(scenario.question, ['id', 'role', 'content']));
    assert.equal(scenario.question.role, 'user');
    assert.equal(typeof scenario.question.id, 'string');
    assert.ok(!allIds.has(scenario.question.id)); allIds.add(scenario.question.id);
    assert.ok(normalized(scenario.question.content) && scenario.question.content.length <= 600);
    assert.ok(dense(gold.distractorMessageIds) && gold.distractorMessageIds.length >= 5);
    assert.equal(new Set(gold.distractorMessageIds).size, gold.distractorMessageIds.length);
    for (const id of gold.distractorMessageIds) assert.ok(messageById.has(id));
    assert.ok(dense(gold.obligations) && gold.obligations.length >= 2);
    assert.ok(gold.obligations.filter(item => item.required !== false && item.supportLevel === 'full' &&
      item.state !== 'unknown').length >= 2);
    const rubricIds = new Set();
    for (const item of gold.obligations) {
      assert.ok(exact(item, ['id', 'claim', 'state', 'supportLevel', 'sources',
        ...(Object.hasOwn(item, 'required') ? ['required'] : [])]));
      if (Object.hasOwn(item, 'required')) assert.equal(item.required, false);
      assert.equal(typeof item.id, 'string');
      assert.ok(!rubricIds.has(item.id)); rubricIds.add(item.id);
      assert.ok(typeof item.claim === 'string' && item.claim.length > 0);
      assert.ok(['historical', 'current', 'proposed', 'unknown'].includes(item.state));
      assert.ok(['full', 'partial'].includes(item.supportLevel));
      assert.ok(dense(item.sources) && item.sources.length >= 1);
      const cited = new Set();
      for (const anchor of item.sources) {
        assert.ok(exact(anchor, ['messageId', 'passage']));
        assert.ok(messageById.has(anchor.messageId));
        assert.ok(!cited.has(anchor.messageId)); cited.add(anchor.messageId);
        assert.ok(typeof anchor.passage === 'string' && anchor.passage.length > 0);
        const content = messageById.get(anchor.messageId).content;
        const start = content.indexOf(anchor.passage);
        assert.ok(start >= 0 && content.indexOf(anchor.passage, start + 1) < 0,
          `${scenario.id}/${item.id}: non-unique passage`);
      }
    }
    assert.ok(dense(gold.forbiddenInferences) && gold.forbiddenInferences.length >= 2);
    for (const item of gold.forbiddenInferences) {
      assert.ok(exact(item, ['id', 'claim', 'sourceMessageIds']));
      assert.equal(typeof item.id, 'string');
      assert.ok(!rubricIds.has(item.id)); rubricIds.add(item.id);
      assert.ok(typeof item.claim === 'string' && item.claim.length > 0);
      assert.ok(dense(item.sourceMessageIds) && item.sourceMessageIds.length >= 1);
      assert.equal(new Set(item.sourceMessageIds).size, item.sourceMessageIds.length);
      for (const id of item.sourceMessageIds) assert.ok(messageById.has(id));
    }
  }
  return true;
}

test('CF1–3/6 four capture-compatible source histories have separate anchored evaluator obligations', () => {
  assert.equal(validate(source, rubric), true);
  assert.deepEqual(source.cases.map(item => item.batches.map(batch => batch.messages.length)),
    [[5, 5, 5], [5, 5, 5], [5, 5, 5], [5, 5, 5]]);
  assert.ok(!sourceText.includes('"obligations"'));
  assert.ok(!sourceText.includes('"forbiddenInferences"'));
  assert.ok(!sourceText.includes('"expectedOldActions"'));
  assert.ok(!sourceText.includes('"oldEdges"'));
  assert.equal(rubric.cases[3].obligations.some(item => item.state === 'unknown' &&
    item.supportLevel === 'partial'), true);
});

test('CF6 malformed shapes, dates, bounds, identifiers, and source anchors fail consistency checks', () => {
  const mutations = [
    value => { value.cases.pop(); },
    value => { value.cases[0].batches[1].capturedOn = '2026-01-01'; },
    value => { value.cases[0].batches[0].messages[0].role = 'system'; },
    value => { value.cases[0].batches[0].messages[0].content = 'x'.repeat(601); },
    value => { value.cases[0].batches[0].messages[0].content = 'Two  spaces'; },
    value => { value.cases[0].batches[0].messages[0].expected = 'Alder'; },
    value => { value.cases[0].batches[0].messages[1].id = 'cart-m01'; },
    value => { value.cases[0].batches[0].messages.length = 6; },
  ];
  for (const mutate of mutations) {
    const copy = structuredClone(source);
    mutate(copy);
    assert.throws(() => validate(copy, rubric));
  }
  const badRubric = structuredClone(rubric);
  badRubric.cases[0].obligations[0].sources[0].passage = 'Invented gold passage';
  assert.throws(() => validate(source, badRubric));
});

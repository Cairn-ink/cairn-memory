import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { prepareSourceAnswerAccounting } from '../../architecture/source-answer-accounting.mjs';
import { SOURCE_ANSWER_INSTRUCTION } from '../installed-source-answer-delivery.mjs';

const read = name => JSON.parse(readFileSync(new URL(`../${name}.json`, import.meta.url), 'utf8'));
const fresh = () => ({ fixture: read('answer-accounting-fixture'), rubric: read('answer-accounting-rubric') });
const keys = (value, expected) => assert.deepEqual(Object.keys(value).sort(), [...expected].sort());
const views = history => [history.sources, history.sources.filter(s => s.id !== history.omittedSourceId)];

test('six closed histories form three single-user-sentence contrasts with fixed nonqualifier omissions', () => {
  const { fixture, rubric } = fresh();
  keys(fixture, ['id', 'histories']); keys(rubric, ['id', 'histories']);
  assert.equal(fixture.id, 'source-answer-accounting-comparison-v1'); assert.equal(rubric.id, fixture.id);
  assert.equal(fixture.histories.length, 6); assert.equal(rubric.histories.length, 6);
  assert.deepEqual(rubric.histories.map(h => h.id), fixture.histories.map(h => h.id));
  const ids = new Set(), pairs = new Map();
  for (const [i, history] of fixture.histories.entries()) {
    keys(history, ['id', 'pairId', 'question', 'sources', 'omittedSourceId']);
    assert.ok(history.question.trim()); assert.equal(history.sources.length, 8);
    assert.equal(history.sources.filter(s => s.role === 'user').length, 7);
    assert.equal(history.sources.filter(s => s.role === 'assistant').length, 1);
    for (const source of history.sources) {
      keys(source, ['id', 'role', 'content']); assert.ok(!ids.has(source.id)); ids.add(source.id);
      assert.ok(source.content.trim()); assert.ok(source.content.length <= 800); assert.ok(source.content.isWellFormed());
    }
    const label = rubric.histories[i];
    keys(label, ['id', 'requiredSourceIds', 'qualifierSourceId', 'expectedCommitment', 'reason', 'scope', 'actor', 'unknown']);
    assert.equal(new Set(label.requiredSourceIds).size, label.requiredSourceIds.length);
    assert.ok(label.requiredSourceIds.every(id => history.sources.some(s => s.id === id)));
    assert.ok(label.requiredSourceIds.includes(history.omittedSourceId));
    assert.ok(label.requiredSourceIds.includes(label.qualifierSourceId));
    assert.notEqual(history.omittedSourceId, label.qualifierSourceId);
    for (const field of ['reason', 'scope', 'actor', 'unknown']) assert.ok(typeof label[field] === 'string' && label[field].trim());
    for (const sources of views(history)) assert.ok(sources.some(s => s.id === label.qualifierSourceId));
    pairs.set(history.pairId, [...(pairs.get(history.pairId) ?? []), history]);
  }
  assert.equal(ids.size, 48); assert.equal(pairs.size, 3);
  for (const pair of pairs.values()) {
    assert.equal(pair.length, 2); assert.equal(pair[0].question, pair[1].question);
    const changed = pair[0].sources.flatMap((s, i) => {
      assert.equal(s.role, pair[1].sources[i].role); return s.content === pair[1].sources[i].content ? [] : [i];
    });
    assert.equal(changed.length, 1); assert.equal(pair[0].sources[changed[0]].role, 'user');
    for (const history of pair) assert.equal(history.sources[changed[0]].id, rubric.histories.find(r => r.id === history.id).qualifierSourceId);
    assert.deepEqual(new Set(pair.map(h => rubric.histories.find(r => r.id === h.id).expectedCommitment)), new Set(['provisional', 'committed']));
    assert.equal(pair[0].sources.findIndex(s => s.id === pair[0].omittedSourceId), pair[1].sources.findIndex(s => s.id === pair[1].omittedSourceId));
  }
});

test('all twenty-four arm/view inputs preserve same-source fairness without leaking oracle fields', () => {
  const { fixture } = fresh(); let slots = 0;
  for (const history of fixture.histories) for (const [view, sources] of views(history).entries()) {
    assert.equal(sources.length, view === 0 ? 8 : 7);
    const ordinary = { question: history.question, sources }, inputJson = JSON.stringify(ordinary), counts = [];
    assert.ok(Buffer.byteLength(inputJson) <= 24000);
    const prepared = prepareSourceAnswerAccounting({ inputJson, countTokens: text => { counts.push(text); return 1; } });
    assert.deepEqual(prepared.input, ordinary);
    assert.ok(prepared.system.startsWith(SOURCE_ANSWER_INSTRUCTION)); assert.equal(prepared.maxOutputTokens, 1024);
    assert.equal(counts[0], prepared.system + '\n' + JSON.stringify(ordinary));
    for (const arm of [ordinary, prepared.input]) {
      keys(arm, ['question', 'sources']); assert.deepEqual(arm.sources, sources); slots++;
      assert.ok(!Object.hasOwn(arm, 'omittedSourceId')); assert.ok(!Object.hasOwn(arm, 'requiredSourceIds'));
    }
    const unresolved = { choice: null, commitment: null, scope: null, reasons: [], unknown: ['Synthetic unresolved diagnostic'], answer: 'Synthetic structural observation, not a quality judgment.' };
    const result = prepared.compile(JSON.stringify(unresolved));
    assert.deepEqual(result.sources, sources); assert.equal(result.semanticStatus, 'unassessed'); assert.equal(result.executionAuthority, 'none');
  }
  assert.equal(slots, 24);
});

test('fresh sources avoid earlier corpora and one pair has Chinese source prose and questions', () => {
  const { fixture } = fresh();
  const previous = ['qualifier-preservation-fixture', 'multi-window-fidelity-fixture', 'checklist-selection-fixture', 'augmentation-fixture']
    .flatMap(name => read(name).histories.flatMap(h => h.sources ?? h.windows?.flat() ?? h.messages));
  for (const source of fixture.histories.flatMap(h => h.sources)) assert.ok(!previous.some(old => old.id === source.id || old.content === source.content));
  const chinese = fixture.histories.filter(h => /\p{Script=Han}/u.test(h.question));
  assert.equal(chinese.length, 2); assert.equal(chinese[0].pairId, chinese[1].pairId);
  for (const h of chinese) assert.ok(h.sources.every(s => /\p{Script=Han}/u.test(s.content)));
  // Script presence, IDs and counts cannot establish relevant reasons, true absence,
  // unadopted suggestions or answer fidelity; those require independent semantic review.
});

test('frozen preparations survive external mutation and reject omitted aliases without repair', () => {
  const value = fresh(), before = structuredClone(value);
  for (const history of value.fixture.histories) {
    const original = structuredClone(history), sources = views(history)[1];
    const request = prepareSourceAnswerAccounting({ inputJson: JSON.stringify({ question: history.question, sources }), countTokens: () => 1 });
    history.sources[0].content = 'External mutation'; history.question = 'Changed';
    assert.deepEqual(request.input, { question: original.question, sources: views(original)[1] });
    assert.throws(() => { request.input.sources[0].content = 'Frozen mutation'; });
    const raw = { choice: { text: 'Claim using absent source', sourceIds: [original.omittedSourceId] }, commitment: null, scope: null,
      reasons: [], unknown: [], answer: 'No repaired alias allowed.' };
    assert.throws(() => request.compile(JSON.stringify(raw)), error => error.code === 'invalid_model_output');
  }
  assert.deepEqual(fresh(), before);
});

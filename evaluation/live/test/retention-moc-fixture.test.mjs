import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync, readdirSync } from 'node:fs';
import { boundedText } from '../../../core/validation.mjs';
import { runMultiWindowFidelity } from '../multi-window-fidelity.mjs';
import { SOURCE_ANSWER_INSTRUCTION } from '../installed-source-answer-delivery.mjs';

const directory = new URL('../', import.meta.url);
const read = name => JSON.parse(readFileSync(new URL(`${name}.json`, directory), 'utf8'));
const inputs = () => ({ fixture: read('retention-moc-fixture'), rubric: read('retention-moc-rubric') });
const keys = (value, expected) => assert.deepEqual(Object.keys(value).sort(), [...expected].sort());
const nonempty = (value, limit) => { assert.equal(typeof value, 'string'); assert.ok(value.trim() && value.length <= limit && value.isWellFormed()); };

test('six fresh canonical histories preserve three single-user-line contrasts across eighteen windows', () => {
  const { fixture, rubric } = inputs();
  assert.equal(fixture.id, 'retention-moc-comparison-v1'); assert.equal(rubric.id, fixture.id);
  keys(fixture, ['id', 'histories']); keys(rubric, ['id', 'histories']);
  assert.equal(fixture.histories.length, 6); assert.equal(rubric.histories.length, 6);
  const messages = fixture.histories.flatMap(h => h.windows.flat());
  assert.equal(messages.length, 108); assert.equal(new Set(messages.map(m => m.id)).size, 108);
  const pairs = new Map();
  for (const h of fixture.histories) {
    keys(h, ['id', 'pairId', 'question', 'windows']); nonempty(h.question, 4000);
    assert.equal(h.windows.length, 3);
    pairs.set(h.pairId, [...(pairs.get(h.pairId) ?? []), h]);
    for (const window of h.windows) {
      assert.equal(window.length, 6);
      assert.deepEqual(window.map(m => m.role), ['user', 'user', 'user', 'user', 'user', 'assistant']);
      for (const m of window) {
        keys(m, ['id', 'role', 'content']); assert.match(m.id, /^[a-zA-Z0-9][a-zA-Z0-9_-]*$/);
        nonempty(m.content, 800); assert.equal(m.content.normalize('NFKC'), m.content); assert.equal(boundedText(m.content, 800), m.content);
      }
    }
  }
  assert.equal(pairs.size, 3);
  for (const pair of pairs.values()) {
    assert.equal(pair.length, 2); assert.equal(pair[0].question, pair[1].question);
    const left = pair[0].windows.flat(), right = pair[1].windows.flat();
    const differences = left.flatMap((m, i) => m.content === right[i].content ? [] : [i]);
    assert.equal(differences.length, 1); assert.equal(left[differences[0]].role, 'user');
    assert.deepEqual(new Set(pair.map(h => rubric.histories.find(r => r.id === h.id).expectedCommitment)), new Set(['provisional', 'committed']));
    for (const h of pair) {
      const label = rubric.histories.find(r => r.id === h.id), sources = h.windows.flat();
      assert.equal(label.qualifierSourceId, sources[differences[0]].id);
      assert.ok(label.requiredSourceIds.includes(label.qualifierSourceId));
      assert.ok(label.requiredSourceIds.length > 0 && label.requiredSourceIds.length <= 6);
      const membership = [...label.requiredSourceIds, ...label.irrelevantSourceIds];
      assert.equal(new Set(membership).size, membership.length);
      assert.ok(membership.every(id => sources.some(m => m.id === id)));
      assert.equal(h.windows.filter(w => w.some(m => label.requiredSourceIds.includes(m.id))).length, 3);
      assert.equal(sources.reduce((n, m) => n + m.content.split(label.qualifierQuote).length - 1, 0), 1);
      for (const field of ['qualifierQuote', 'actor', 'reason', 'temporalLimit']) nonempty(label[field], 4000);
    }
  }
  const prior = [];
  function collect(value) {
    if (!value || typeof value !== 'object') return;
    if (typeof value.content === 'string') prior.push(value);
    for (const child of Object.values(value)) collect(child);
  }
  for (const name of readdirSync(directory)) if (name.endsWith('-fixture.json') && name !== 'retention-moc-fixture.json') collect(read(name.slice(0, -5)));
  for (const message of messages) assert.ok(!prior.some(old => old.content === message.content || old.id === message.id));
  const chinese = fixture.histories.filter(h => /\p{Script=Han}/u.test(h.question));
  assert.ok(chinese.length >= 2); assert.equal(chinese[0].pairId, chinese[1].pairId);
  assert.ok(chinese.every(h => h.windows.flat().every(m => /\p{Script=Han}/u.test(m.content))));
});

test('two separate negative queries bind existing histories without placing review unknowns in model data', () => {
  const { fixture } = inputs(), negative = read('retention-moc-negative-queries');
  keys(negative, ['id', 'queries']); assert.equal(negative.id, fixture.id); assert.equal(negative.queries.length, 2);
  assert.equal(new Set(negative.queries.map(q => q.id)).size, 2);
  assert.equal(negative.queries.filter(q => /\p{Script=Han}/u.test(q.question)).length, 1);
  for (const q of negative.queries) {
    keys(q, ['id', 'historyId', 'question', 'expectedUnknowns']); assert.match(q.id, /^[a-zA-Z0-9][a-zA-Z0-9_-]*$/);
    assert.ok(fixture.histories.some(h => h.id === q.historyId)); nonempty(q.question, 4000);
    assert.ok(Array.isArray(q.expectedUnknowns) && q.expectedUnknowns.length > 0);
    for (const unknown of q.expectedUnknowns) nonempty(unknown, 4000);
    assert.ok(!fixture.histories.some(h => h.question === q.question));
  }
  assert.ok(!JSON.stringify(fixture).includes('expectedUnknowns'));
  // Language and membership checks do not establish genuine absence, relevance,
  // denied permission or answer correctness; those require independent review.
});

test('unchanged driver accepts the frozen inputs, retains failure denominators and isolates canonical controls', async () => {
  const value = inputs(), before = structuredClone(value), opens = [], answers = [];
  const report = await runMultiWindowFidelity({ ...value,
    openClient: async request => { opens.push(request); throw new Error('Synthetic unavailable client'); },
    answer: async request => { answers.push(structuredClone(request)); request.sources[0].content = 'Changed callback copy'; return 'Synthetic unassessed control.'; } });
  assert.deepEqual(value, before); assert.equal(report.semanticStatus, 'unassessed'); assert.equal(report.status, 'observed-with-failures');
  assert.equal(report.histories.flatMap(h => h.captures).length, 18); assert.equal(report.histories.flatMap(h => h.answers).length, 12);
  assert.equal(answers.length, 6); assert.ok(opens.length >= 6);
  for (const request of opens) { keys(request, ['historyId', 'windowIndex', 'phase']); assert.equal(request.windowIndex, 0); }
  for (const [i, h] of report.histories.entries()) {
    assert.equal(h.captures[0].capture.status, 'failed'); assert.ok(h.captures.slice(1).every(c => c.status === 'not_run'));
    assert.equal(h.activeAdmittedCount, null); assert.equal(h.recall.status, 'not_run'); assert.equal(h.snapshot.status, 'not_run');
    const retrieved = h.answers.find(a => a.sourceKind === 'retrieved'), control = h.answers.find(a => a.sourceKind === 'canonical-control');
    assert.equal(retrieved.status, 'not_run'); assert.equal(retrieved.constructedControl, false);
    assert.equal(control.status, 'completed'); assert.equal(control.constructedControl, true);
    assert.deepEqual(answers[i], { question: value.fixture.histories[i].question, instructions: SOURCE_ANSWER_INSTRUCTION,
      sourceKind: 'canonical-control', sources: value.fixture.histories[i].windows.flat() });
  }
  // These twelve driver slots are not the future sidecar's twenty-two slots.
});

test('invalid paired sources and oracle bindings reject before any client or answer callback', async () => {
  for (const mutate of [v => v.fixture.histories.pop(), v => { v.fixture.histories[0].windows[0][0].content = 'x'.repeat(801); },
    v => { v.fixture.histories[0].windows[0][0].role = 'system'; }, v => { v.fixture.histories[0].question += ' changed'; },
    v => { v.fixture.histories[0].windows[0][0].id = v.fixture.histories[1].windows[0][0].id; },
    v => { v.rubric.histories[0].requiredSourceIds.push('foreign'); },
    v => { v.rubric.histories[0].qualifierSourceId = v.fixture.histories[0].windows[0][0].id; },
    v => { v.fixture.histories[0].expectedUnknowns = ['Leaked label']; }]) {
    const value = inputs(); mutate(value); let callbacks = 0;
    await assert.rejects(runMultiWindowFidelity({ ...value,
      openClient: async () => { callbacks++; }, answer: async () => { callbacks++; return 'Synthetic'; } }));
    assert.equal(callbacks, 0);
  }
});

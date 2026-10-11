import assert from 'node:assert/strict';
import test from 'node:test';
import { copyFile, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { createTestWorkspace } from '../../../tools/testing/workspace.mjs';
import {
  CORPUS_VERSION, freezeDevelopmentCorpus, hashCanonicalValue, loadDevelopmentFreeze,
  loadEvaluatorRubric, loadModelInputs, validateEvaluatorRubric, validateModelInputs,
} from '../corpus.mjs';

const frozen = await loadDevelopmentFreeze();
const copy = () => structuredClone(frozen);

test('the actual frozen corpus contains every planned slot and variant with bounded conversations', () => {
  assert.equal(frozen.version, CORPUS_VERSION);
  assert.equal(validateModelInputs(frozen.modelInputs), frozen.modelInputs);
  assert.equal(validateEvaluatorRubric(frozen.evaluatorRubric, frozen.modelInputs), frozen.evaluatorRubric);
  assert.deepEqual(frozen.modelInputs.map(item => item.id), Array.from({ length: 24 }, (_, index) => `D${String(index + 1).padStart(2, '0')}`));
  const counts = new Map();
  for (const item of frozen.modelInputs) counts.set(item.family, (counts.get(item.family) ?? 0) + 1);
  assert.equal(counts.size, 6);
  assert.deepEqual([...counts.values()], [4, 4, 4, 4, 4, 4]);
  assert.equal(new Set(Object.values(frozen.evaluatorRubric.cases).map(item => item.variant)).size, 24);
  assert.deepEqual(frozen.evaluatorRubric.cases.D21.anchors, []);
  assert.deepEqual(frozen.evaluatorRubric.cases.D21.requiredMultiSourceSets, []);
  assert.equal(frozen.evaluatorRubric.cases.D10.requiredMultiSourceSets[0].length, 3);
  for (const id of ['D13', 'D14']) {
    const item = frozen.modelInputs.find(candidate => candidate.id === id);
    assert.ok(item.sessions[1].eventTime < item.sessions[0].eventTime, 'late old import must remain old in event time');
  }
});

test('model-facing fixture has only conversation fields, and its loader works with no evaluator file', async t => {
  const workspace = createTestWorkspace(t, { prefix: 'cairn-dev24-corpus-' });
  const casesPath = join(workspace.path, 'cases.json');
  await copyFile(new URL('../cases.json', import.meta.url), casesPath);
  const inputs = await loadModelInputs({ casesPath });
  assert.deepEqual(inputs, frozen.modelInputs);
  await assert.rejects(() => loadEvaluatorRubric(inputs, { rubricPath: join(workspace.path, 'absent-rubric.json') }), { code: 'ENOENT' });
  for (const item of inputs) {
    assert.deepEqual(Object.keys(item).sort(), ['family', 'id', 'question', 'sessions']);
    assert.deepEqual(Object.keys(item.question).sort(), ['date', 'text']);
    for (const session of item.sessions) {
      assert.deepEqual(Object.keys(session).sort(), ['eventTime', 'id', 'messages']);
      for (const message of session.messages) assert.deepEqual(Object.keys(message).sort(), ['content', 'role']);
    }
  }
  const runtimeModule = await readFile(new URL('../corpus.mjs', import.meta.url), 'utf8');
  assert.ok(!/^import .*rubric/m.test(runtimeModule), 'no eager evaluator import');
});

test('strict model schema rejects missing cases, wrong families, duplicates and evaluator metadata', () => {
  for (const mutate of [
    value => value.modelInputs.pop(),
    value => { delete value.modelInputs[0]; },
    value => { value.modelInputs[3].id = 'D03'; },
    value => { value.modelInputs[4].family = 'detail-retention'; },
    value => { value.modelInputs[0].expectedAnswer = '37'; },
    value => { value.modelInputs[0].question.anchors = []; },
    value => { value.modelInputs[0].sessions[0].gold = true; },
    value => { value.modelInputs[0].sessions[0].messages[0].sourceId = 'picked'; },
    value => { value.modelInputs[0].sessions[0].messages[0].role = 'system'; },
    value => { value.modelInputs[0].sessions[0].eventTime = '2026-02-30T09:00:00Z'; },
    value => { value.modelInputs[0].question.date = '2026-04-31'; },
    value => { value.modelInputs[8].sessions[1].id = value.modelInputs[8].sessions[0].id; },
    value => { value.modelInputs[0].sessions[0].messages.length = 1; },
    value => { value.modelInputs[0].sessions.push(...structuredClone(value.modelInputs[0].sessions), ...structuredClone(value.modelInputs[0].sessions), ...structuredClone(value.modelInputs[0].sessions)); },
  ]) {
    const value = copy(); mutate(value);
    assert.throws(() => validateModelInputs(value.modelInputs), TypeError);
  }
});

test('source budget counts Unicode characters and enforces session and case message caps', () => {
  const value = copy();
  value.modelInputs[0].sessions[0].messages.forEach(message => { message.content = 'x'; });
  value.modelInputs[0].sessions[0].messages[0].content = '🧵'.repeat(11_997);
  assert.doesNotThrow(() => validateModelInputs(value.modelInputs));
  value.modelInputs[0].sessions[0].messages[0].content += '🧵';
  assert.throws(() => validateModelInputs(value.modelInputs), /source exceeds 12000/);
  const longSession = copy();
  longSession.modelInputs[0].sessions[0].messages.push(...structuredClone(longSession.modelInputs[0].sessions[0].messages));
  assert.throws(() => validateModelInputs(longSession.modelInputs), /messages: expected an array/);
  const manyMessages = copy();
  manyMessages.modelInputs[9].sessions[0].messages.push({ role: 'user', content: 'One more note.' }, { role: 'assistant', content: 'Noted.' }, { role: 'user', content: 'Another note.' });
  assert.throws(() => validateModelInputs(manyMessages.modelInputs), /3–8 conversation messages/);
});

test('evaluator schema rejects missing rules, bad source spans and invalid multi-source sets', () => {
  for (const mutate of [
    value => { delete value.evaluatorRubric.cases.D24; },
    value => { value.evaluatorRubric.cases.D25 = structuredClone(value.evaluatorRubric.cases.D24); },
    value => { value.evaluatorRubric.cases.D01.variant = 'exact-lexical'; },
    value => { value.evaluatorRubric.spanOffsetUnit = 'bytes'; },
    value => { value.evaluatorRubric.cases.D01.requiredPropositions = []; },
    value => { value.evaluatorRubric.cases.D01.anchors[0].sessionId = 'missing'; },
    value => { value.evaluatorRubric.cases.D01.anchors[0].messageIndex = 100; },
    value => { value.evaluatorRubric.cases.D01.anchors[0].start = -1; },
    value => { value.evaluatorRubric.cases.D01.anchors[0].end += 1; },
    value => { value.evaluatorRubric.cases.D01.anchors[0].text = 'Invented quotation'; },
    value => { value.evaluatorRubric.cases.D01.anchors[0].expected = true; },
    value => { value.evaluatorRubric.cases.D01.anchors.push(structuredClone(value.evaluatorRubric.cases.D01.anchors[0])); },
    value => { value.evaluatorRubric.cases.D09.requiredMultiSourceSets = [[0, 99]]; },
    value => { value.evaluatorRubric.cases.D09.requiredMultiSourceSets = [[0, 0]]; },
    value => { value.evaluatorRubric.cases.D04.requiredMultiSourceSets = [[0, 1]]; },
    value => { value.evaluatorRubric.cases.D21.requiredMultiSourceSets = [[0, 1]]; },
  ]) {
    const value = copy(); mutate(value);
    assert.throws(() => validateEvaluatorRubric(value.evaluatorRubric, value.modelInputs), TypeError);
  }
});

test('CJK and supplementary-character evidence uses exact UTF-16 spans without splitting characters', () => {
  const chinese = frozen.evaluatorRubric.cases.D07.anchors[0];
  const content = frozen.modelInputs[6].sessions[0].messages[0].content;
  assert.equal(content.slice(chinese.start, chinese.end), chinese.text);
  const value = copy();
  value.modelInputs[0].sessions[0].messages[0].content = 'A🧵B';
  value.evaluatorRubric.cases.D01.anchors[0] = { sessionId: 'walk-planning', messageIndex: 0, start: 1, end: 3, text: '🧵' };
  assert.doesNotThrow(() => validateEvaluatorRubric(value.evaluatorRubric, value.modelInputs));
  value.evaluatorRubric.cases.D01.anchors[0].end = 2;
  value.evaluatorRubric.cases.D01.anchors[0].text = '🧵'.slice(0, 1);
  assert.throws(() => validateEvaluatorRubric(value.evaluatorRubric, value.modelInputs), /bisects a Unicode character/);
});

test('freeze is deeply immutable, detached from callers and deterministic across object key order', () => {
  const value = copy();
  const result = freezeDevelopmentCorpus(value);
  const checkFrozen = item => {
    if (item && typeof item === 'object') {
      assert.ok(Object.isFrozen(item));
      Object.values(item).forEach(checkFrozen);
    }
  };
  checkFrozen(result);
  value.modelInputs[0].question.text = 'Mutated caller question';
  value.evaluatorRubric.cases.D01.requiredPropositions[0] = 'Mutated caller gold';
  assert.deepEqual(result, frozen);
  assert.throws(() => { result.modelInputs[0].question.text = 'Changed'; }, TypeError);
  assert.throws(() => { result.evaluatorRubric.cases.D01.anchors[0].text = 'Changed'; }, TypeError);
  assert.equal(hashCanonicalValue({ b: [1, { d: 3, c: 2 }], a: true }), hashCanonicalValue({ a: true, b: [1, { c: 2, d: 3 }] }));
  assert.notEqual(hashCanonicalValue([1, 2]), hashCanonicalValue([2, 1]));
  assert.notEqual(hashCanonicalValue(value.modelInputs), result.hashes.modelInputs);
  assert.notEqual(hashCanonicalValue(value.evaluatorRubric), result.hashes.evaluatorRubric);
  assert.deepEqual(result.hashes, {
    modelInputs: '56f0db72471781497872cdf757c9f9db45772a334198e9e26ac1b4dd947215ac',
    evaluatorRubric: 'c40952734852e01072185939c51f54efa8238d5fa1b44259bf3964b8088ce4f5',
    freeze: '926bc92a1628924167fe1c77d5de6eb8234a4f52dd3b215e88c535bea7d8a5df',
  });
});

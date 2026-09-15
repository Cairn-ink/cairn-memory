import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import test from 'node:test';

const directory = new URL('../', import.meta.url);
const read = name => JSON.parse(readFileSync(new URL(name, directory), 'utf8'));
const fixture = read('small-candidate-fixture.json');
const rubric = read('small-candidate-rubric.json');
const keys = (value, expected) => assert.deepEqual(Object.keys(value).sort(), [...expected].sort());
const safeId = value => assert.match(value, /^[a-zA-Z0-9][a-zA-Z0-9_-]*$/);
const text = (value, maximum) => {
  assert.equal(typeof value, 'string');
  assert.ok(value.trim().length > 0 && value.length <= maximum);
  assert.ok(value.isWellFormed());
};

test('four frozen cases have bounded complete sources, safe identities and no oracle fields', () => {
  keys(fixture, ['id', 'cases']);
  assert.equal(fixture.id, 'small-candidate-comparison-v1');
  assert.deepEqual(fixture.cases.map(item => item.id), ['c01', 'c02', 'c03', 'c04']);
  assert.deepEqual(fixture.cases.map(item => item.sources.length), [3, 3, 2, 4]);
  const ids = new Set();
  for (const item of fixture.cases) {
    keys(item, ['id', 'limit', 'question', 'sources']);
    safeId(item.id); text(item.question, 4000); assert.equal(item.limit, 3);
    for (const source of item.sources) {
      keys(source, ['id', 'role', 'content']);
      safeId(source.id); assert.ok(!ids.has(source.id)); ids.add(source.id);
      assert.ok(['user', 'assistant'].includes(source.role)); text(source.content, 800);
    }
  }
  assert.equal(ids.size, 12);
  // These are shape bounds, not an assessment of relevance or source entailment.
});

test('separate rubric binds each case and partitions only its actual source IDs', () => {
  keys(rubric, ['id', 'cases']); assert.equal(rubric.id, fixture.id);
  assert.deepEqual(rubric.cases.map(item => item.id), fixture.cases.map(item => item.id));
  assert.deepEqual(rubric.cases.map(item => item.category), ['positive', 'mixed', 'none-relevant', 'larger-set']);
  for (const [index, item] of rubric.cases.entries()) {
    keys(item, ['id', 'category', 'requiredSourceIds', 'irrelevantSourceIds', 'expectedFacts', 'unknowns', 'prohibitedInferences']);
    const sourceIds = new Set(fixture.cases[index].sources.map(source => source.id));
    const membership = [...item.requiredSourceIds, ...item.irrelevantSourceIds];
    assert.equal(new Set(membership).size, membership.length);
    assert.deepEqual(new Set(membership), sourceIds);
    for (const field of ['expectedFacts', 'unknowns', 'prohibitedInferences']) {
      assert.ok(Array.isArray(item[field]) && item[field].length > 0);
      for (const statement of item[field]) text(statement, 4000);
    }
    const modelFacing = JSON.stringify({ question: fixture.cases[index].question, sources: fixture.cases[index].sources });
    for (const field of ['category', 'requiredSourceIds', 'irrelevantSourceIds', 'expectedFacts', 'unknowns', 'prohibitedInferences']) {
      assert.ok(!modelFacing.includes(`"${field}":`));
    }
  }
  assert.equal(rubric.cases[0].requiredSourceIds.length, 3);
  assert.ok(rubric.cases[1].irrelevantSourceIds.length > 0);
  assert.equal(rubric.cases[2].requiredSourceIds.length, 0);
  assert.equal(rubric.cases[2].irrelevantSourceIds.length, 2);
});

test('source prose is fresh and the Chinese case includes a Chinese question and sources', () => {
  const priorContent = new Set();
  function collect(value) {
    if (!value || typeof value !== 'object') return;
    if (typeof value.content === 'string') priorContent.add(value.content);
    for (const child of Object.values(value)) collect(child);
  }
  for (const name of readdirSync(directory)) {
    if (name.endsWith('-fixture.json') && name !== 'small-candidate-fixture.json') collect(read(name));
  }
  const currentContent = fixture.cases.flatMap(item => item.sources.map(source => source.content));
  assert.equal(new Set(currentContent).size, 12);
  for (const content of currentContent) assert.ok(!priorContent.has(content));
  const chinese = fixture.cases.find(item => /\p{Script=Han}/u.test(item.question)
    && item.sources.every(source => /\p{Script=Han}/u.test(source.content)));
  assert.ok(chinese, 'Chinese is required in the actual question and complete sources, not only labels.');
  // Script presence is only a language-fixture check; human review must assess
  // Traditional Chinese wording, facts, unknowns and prohibited inferences.
});

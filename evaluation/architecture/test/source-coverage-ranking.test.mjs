import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const baselineBytes = readFileSync(new URL('../fixtures/recall-rank-source-evidence-baseline.md', import.meta.url));
const candidateBytes = readFileSync(new URL('../../../core/prompts/recall-rank-source-evidence.md', import.meta.url));
const fixtureBytes = readFileSync(new URL('../source-coverage-cases.json', import.meta.url));
const rubricBytes = readFileSync(new URL('../source-coverage-rubric.json', import.meta.url));
const fixture = JSON.parse(fixtureBytes);
const rubric = JSON.parse(rubricBytes);
const hash = value => createHash('sha256').update(value).digest('hex');

const expectedCases = [
  ['simple-exact', [[0]], [], [], [1, 2]],
  ['multi-fact-three-cards', [[0], [1], [2]], [], [], [3]],
  ['historical-current', [[0], [1]], [], [], [2]],
  ['rejected-proposal', [[0], [1]], [], [], [2]],
  ['pending-choice', [[0], [1], [2]], [], [], [3]],
  ['premise-challenge', [[0], [1]], [], [], [2]],
  ['person-scope-separation', [[0], [1], [2]], [], [], [3]],
  ['temporal-three-events', [[0], [1], [2]], [], [], [3]],
  ['duplicate-vs-complementary', [[0, 1], [2]], [], [[0, 1]], [3]],
  ['no-answer', [], [], [], [0, 1, 2]],
  ['untrusted-embedded-instructions', [[0]], [], [], [1, 2]],
  ['irrelevant-decoys', [[2]], [], [], [0, 1, 3]],
];

test('SCR4 retains the exact bounded baseline prompt independently of the candidate', () => {
  assert.equal(baselineBytes.byteLength, 1376);
  assert.equal(hash(baselineBytes), 'e08ced39cfe8873be5b03fc473d52acbf9ff6682c0741c2a5514df1ce3dc63db');
  assert.notEqual(hash(candidateBytes), hash(baselineBytes));
  assert.ok(candidateBytes.byteLength <= 24_000);
});

test('SCR2 default, qualified and rationale rank prompts retain their fixed bytes', () => {
  for (const [name, expected] of [
    ['recall-rank.md', '930e43038441d117dddf7bcaa2f93363bcb2e9150105d406750800da94b7fbcc'],
    ['recall-rank-qualified.md', '3cfb92a053bdc5cfa5811d65676d89597e7fae5020554318dbe10d38fb936818'],
    ['recall-rank-rationale-evidence.md', 'e13943a0217c15423d8bed5bfb8a791f2b358bed97fe258288fdb3ee1d86a24b'],
  ]) {
    assert.equal(hash(readFileSync(new URL(`../../../core/prompts/${name}`, import.meta.url))), expected);
  }
});

test('SCR4 freezes twelve bounded model-facing cases without evaluation labels', () => {
  assert.deepEqual(Object.keys(fixture), ['version', 'id', 'cases']);
  assert.equal(fixture.version, 1);
  assert.equal(fixture.id, 'source-coverage-ranking-v1');
  assert.deepEqual(fixture.cases.map(item => item.id), expectedCases.map(item => item[0]));
  assert.equal(/requiredSourceGroups|optionalSourceIndices|redundantSourceGroups|irrelevantSourceIndices|evaluation|rubric/u.test(fixtureBytes.toString()), false);
  for (const item of fixture.cases) {
    assert.deepEqual(Object.keys(item), ['id', 'query', 'limit', 'candidates']);
    assert.ok(item.query.length >= 1 && item.query.length <= 4000);
    assert.ok(Number.isInteger(item.limit) && item.limit >= 1 && item.limit <= 12);
    assert.ok(item.candidates.length >= 2 && item.candidates.length <= 36);
    const identities = new Set();
    for (const candidate of item.candidates) {
      assert.deepEqual(Object.keys(candidate), ['namespaceIndex', 'memory', 'receipts', 'receiptCount',
        'interpretationStatus', 'sourceSelectionCoverage']);
      assert.match(candidate.memory.id, /^synthetic-coverage-/u);
      assert.ok(Number.isSafeInteger(candidate.namespaceIndex) && candidate.namespaceIndex >= 0);
      assert.ok(Number.isSafeInteger(candidate.memory.revision) && candidate.memory.revision >= 1);
      assert.ok(['current', 'historical'].includes(candidate.memory.currentness));
      assert.equal(candidate.receiptCount, candidate.receipts.length);
      assert.ok(candidate.receipts.length >= 1 && candidate.receipts.length <= 100);
      for (const receipt of candidate.receipts) {
        assert.match(receipt.id, /^synthetic-receipt-/u);
        assert.ok(['user', 'assistant'].includes(receipt.role));
        assert.ok(receipt.excerpt.length >= 1 && receipt.excerpt.length <= 800);
      }
      const identity = JSON.stringify([candidate.namespaceIndex, candidate.memory.id, candidate.memory.revision]);
      assert.equal(identities.has(identity), false); identities.add(identity);
      assert.equal(candidate.interpretationStatus, 'omitted');
      assert.equal(candidate.sourceSelectionCoverage, 'unassessed');
    }
  }
});

test('SCR4 keeps frozen expectations separate, ordered, reachable and non-overlapping', () => {
  assert.deepEqual(Object.keys(rubric), ['version', 'fixtureId', 'cases']);
  assert.equal(rubric.version, 1);
  assert.equal(rubric.fixtureId, fixture.id);
  assert.deepEqual(rubric.cases.map(item => [item.id, item.requiredSourceGroups,
    item.optionalSourceIndices, item.redundantSourceGroups, item.irrelevantSourceIndices]), expectedCases);
  for (let i = 0; i < fixture.cases.length; i++) {
    const item = rubric.cases[i], sourceCount = fixture.cases[i].candidates.length;
    assert.deepEqual(Object.keys(item), ['id', 'requiredSourceGroups', 'optionalSourceIndices',
      'redundantSourceGroups', 'irrelevantSourceIndices', 'reason']);
    assert.ok(item.reason.length >= 1 && item.reason.length <= 300);
    assert.ok(item.requiredSourceGroups.every(group => group.length >= 1));
    const required = item.requiredSourceGroups.flat();
    const indices = [...required, ...item.optionalSourceIndices, ...item.irrelevantSourceIndices];
    assert.equal(new Set(indices).size, indices.length);
    assert.deepEqual([...indices].sort((a, b) => a - b), Array.from({ length: sourceCount }, (_, index) => index));
    assert.ok(item.redundantSourceGroups.every(group => group.length >= 2
      && group.every(index => required.includes(index))));
    assert.ok(item.redundantSourceGroups.flat().every(index => !item.irrelevantSourceIndices.includes(index)
      && !item.optionalSourceIndices.includes(index)));
    assert.ok(fixture.cases[i].candidates.every(candidate => candidate.memory.currentness === 'current'));
  }
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { searchLexical } from '../moc-lexical-baseline.mjs';

const run = (memories, query, limit = 12) => searchLexical({ memories, query, limit });

test('ranks the complete corpus before limiting and never searches IDs', () => {
  const memories = Array.from({ length: 50 }, (_, i) => ({ id: `aurora-${i}`, content: 'ordinary distractor' }));
  memories.push({ id: 'last', content: 'Aurora observatory opens Friday' });
  const result = run(memories, 'aurora', 1);
  assert.deepEqual(result.ids, ['last']);
  assert.equal(result.scannedDocuments, 51);
  assert.equal(result.tokenizer, 'unicode61');
  assert.equal(result.scores.length, 1);
  assert.ok(Number.isFinite(result.scores[0]));
});

test('retains paraphrase and Chinese segmentation failures honestly', () => {
  assert.deepEqual(run([{ id: 'a', content: 'purchase automobile' }], 'buy car').ids, []);
  const memories = [{ id: 'a', content: '星河觀測站週五開放' }];
  assert.deepEqual(run(memories, '星河觀測站週五開放').ids, ['a']);
  assert.deepEqual(run(memories, '星河').ids, []);
});

test('quotes query-derived maximal tokens, including FTS operators as literal words', () => {
  const result = run([
    { id: 'a', content: 'alpha' }, { id: 'b', content: 'beta' },
    { id: 'c', content: 'unrelated' }, { id: 'd', content: 'NOT' },
  ], 'alpha" NOT beta* : (');
  assert.deepEqual(result.queryTerms, ['alpha', 'NOT', 'beta']);
  assert.equal(result.matchExpression, '"alpha" OR "NOT" OR "beta"');
  assert.deepEqual(result.ids, ['a', 'b', 'd']);
});

test('OR terms find different documents and ties preserve insertion order', () => {
  const memories = [{ id: 'z', content: 'alpha' }, { id: 'a', content: 'beta' }, { id: 'b', content: 'alpha' }];
  assert.deepEqual(run(memories, 'alpha alpha').ids, ['z', 'b']);
  assert.deepEqual(new Set(run(memories, 'alpha beta').ids), new Set(['z', 'a', 'b']));
  assert.deepEqual(run(memories, 'alpha', 1).ids, ['z']);
});

test('empty/tokenless queries and empty corpus return no matches', () => {
  for (const query of ['', '   ', '"*:()']) {
    const result = run([{ id: 'a', content: 'hello' }], query);
    assert.deepEqual(result.ids, []);
    assert.deepEqual(result.queryTerms, []);
  }
  assert.deepEqual(run([], 'hello').ids, []);
});

test('rejects oversized, malformed, duplicate and oracle-bearing inputs', () => {
  const valid = { memories: [{ id: 'a', content: 'hello' }], query: 'hello', limit: 1 };
  for (const input of [
    null, { ...valid, targetId: 'a' }, { ...valid, limit: 0 }, { ...valid, limit: 13 },
    { ...valid, limit: 1.5 }, { ...valid, query: 'x'.repeat(4001) },
    { ...valid, memories: Array.from({ length: 2049 }, (_, i) => ({ id: `${i}`, content: '' })) },
    { ...valid, memories: [{ id: 'a', content: 'x'.repeat(4001) }] },
    { ...valid, memories: [{ id: '', content: '' }] },
    { ...valid, memories: [{ id: 'a', content: '', answer: true }] },
    { ...valid, memories: [{ id: 'a', content: '' }, { id: 'a', content: '' }] },
    { ...valid, memories: [{ id: 'a' }] },
    { ...valid, memories: [null] }, { ...valid, query: 3 },
  ]) assert.throws(() => searchLexical(input), TypeError);
  assert.equal(run(Array.from({ length: 2048 }, (_, i) => ({ id: `${i}`, content: 'x'.repeat(4000) })), 'x'.repeat(4000), 12).ids.length, 12);
});

test('closes SQLite after successful, empty and failed searches, without fallback', () => {
  const originalClose = DatabaseSync.prototype.close;
  const originalExec = DatabaseSync.prototype.exec;
  const closed = [];
  DatabaseSync.prototype.close = function () {
    originalClose.call(this);
    closed.push(this);
  };
  try {
    run([], 'hello');
    run([{ id: 'a', content: 'hello' }], 'hello');
    DatabaseSync.prototype.exec = function () { throw new Error('synthetic FTS5 unavailable'); };
    assert.throws(() => run([], 'hello'), /synthetic FTS5 unavailable/);
    assert.equal(closed.length, 3);
    for (const db of closed) assert.throws(() => db.prepare('SELECT 1'), /not open/);
  } finally {
    DatabaseSync.prototype.close = originalClose;
    DatabaseSync.prototype.exec = originalExec;
  }
});

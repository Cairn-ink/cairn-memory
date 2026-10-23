import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createBM25, compareCanonical } from '../context-read-bm25.mjs';
import { tokenizeT1 } from '../context-read-tokenize.mjs';
import { fuseCandidates } from '../context-read-fusion.mjs';
const document = (memoryId, text) => ({ memoryId, docId: memoryId, text });

// Copied from HR-1 test/arms-lexical.test.mjs (T1/BM25 subset).
test('R03 BM25 hand calculation, distinct query terms, matching candidates and ID ties', () => {
  const index = createBM25([document('b','apple apple pear'), document('a','apple'), document('c','pear')]);
  assert.equal(index.N, 3); assert.equal(index.avgLength, 5/3); assert.equal(index.df.get('apple'), 2);
  const rows = index.search('apple apple');
  const idf = Math.log(1 + 1.5 / 2.5);
  assert.equal(rows.find(r => r.memoryId === 'b').score, idf * 2 * 2.2 / (2 + 1.2 * (0.25 + 0.75 * 3 / (5/3))));
  assert.equal(rows.find(r => r.memoryId === 'a').score, idf * 2.2 / (1 + 1.2 * (0.25 + 0.75 / (5/3))));
  assert.deepEqual(index.search('missing'), []);
  assert.deepEqual(createBM25([document('b','apple'), document('a','apple')]).search('apple').map(r => r.memoryId), ['a','b']);
  assert.deepEqual(index.search('apple'), index.search('apple apple'));
});

const sample = JSON.parse(readFileSync(new URL('./fixtures/context-read/hr1-sample.json', import.meta.url)));
const pairs = run => Array.from(run).slice(1).map((point, i) => Array.from(run)[i] + point);
// Manually transcribed run boundaries; these expected tokens never call T1.
const frozenTokens = [
  [...pairs('使用者三月把月報庫的資料庫定為'), 'sqlite'],
  [...pairs('使用者八月決定讓月報庫改用'), 'postgresql'],
  pairs('使用者補充月報庫換資料庫的原因'),
  [...pairs('使用者為月報庫設定每月'), 'hosting', '預算'],
  'user originally chose 60 second response cache relaycart'.split(' '),
  'user shortened relaycart s response cache lifetime'.split(' '),
  'user explained relaycart response cache change'.split(' '),
  'user capped relaycart response caching 48 month'.split(' '),
];
test('R03 frozen synthetic HR-1 sample tokens and projection-local BM25 parity', () => {
  assert.equal(sample.source.sha256, '1ce357439f1ed28cfd2e2c8bf31e0bde1581e1110c40577f06d0a915d8db0bf5');
  sample.documents.forEach((doc, i) => assert.deepEqual(tokenizeT1(doc.text), frozenTokens[i]));
  const index = createBM25(sample.documents);
  const N = frozenTokens.length, lengths = frozenTokens.map(tokens => tokens.length), average = lengths.reduce((a,b)=>a+b)/N;
  for (const [query, wanted] of [['月報庫', ['月報','報庫']], ['資料庫', ['資料','料庫']], ['SQLite', ['sqlite']],
    ['RelayCart response', ['relaycart','response']], ['hosting 預算', ['hosting','預算']]]) {
    // Independent per-term hand formula, using only manually frozen tokens.
    const expected = sample.documents.map((doc, i) => ({ memoryId: doc.memoryId, score: wanted.reduce((sum, term) => {
      const tf = frozenTokens[i].filter(token => token === term).length;
      const df = frozenTokens.filter(tokens => tokens.includes(term)).length;
      return sum + (tf ? Math.log(1 + (N-df+0.5)/(df+0.5)) * tf * 2.2 / (tf + 1.2*(0.25+0.75*lengths[i]/average)) : 0);
    }, 0) })).filter(row => row.score > 0).sort((a,b)=> b.score-a.score || compareCanonical(a,b));
    assert.deepEqual(index.search(query).map(({memoryId,score})=>({memoryId,score})), expected);
    for (const preset of ['rrf-k60-d12','rrf-k10']) {
      const lexical = index.search(query), semantic = lexical.map((row, i) => ({ ...row, score: 1-i/10 }));
      assert.deepEqual(fuseCandidates(lexical, semantic, { preset, semanticState: 'ready', coverageComplete: true }).rows.map(row => row.memoryId), expected.map(row=>row.memoryId));
    }
  }
  const restricted = createBM25(sample.documents.slice(0, 2));
  assert.notEqual(restricted.search('月報庫')[0].score, index.search('月報庫')[0].score);
});

test('R03 lexical retrieval: isolated, embedded two-Han, supplementary Han, mixed width and known miss', () => {
  const index = createBM25([document('single','中'), document('bigram','中文資料庫'), document('supplement','𠀀𠀁𠀂'), document('width','ＡＢＣ１２')]);
  assert.deepEqual(index.search('中').map(row=>row.memoryId), ['single']);
  assert.deepEqual(index.search('資料').map(row=>row.memoryId), ['bigram']);
  assert.deepEqual(index.search('𠀁𠀂').map(row=>row.memoryId), ['supplement']);
  assert.deepEqual(index.search('abc12').map(row=>row.memoryId), ['width']);
  assert.deepEqual(createBM25([]).search('anything'), []);
});

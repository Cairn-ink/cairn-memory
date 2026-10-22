import test from 'node:test';
import assert from 'node:assert/strict';
import { tokenizeT1, tokenizeT1Plus, porterStem, wholeRuns, ENGLISH_STOPWORDS } from '../lib/tokenize.mjs';
import { createQueryScore } from '../../../core/query-candidates.mjs';
import { createBM25 } from '../lib/bm25.mjs';
import { createTrigram, trigramExpression } from '../lib/fts5-trigram.mjs';
import { cosine, poolHidden, normalizeVector } from '../lib/embed-local.mjs';
import { document } from './fixtures-arms/toy.mjs';

test('T1 frozen Unicode boundaries, mixed scripts, NFKC and one-character runs', () => {
  assert.deepEqual(tokenizeT1('ＡＢＣ資料庫x 中，𠀀𠀁𠀂 foo_bar １２ Café e\u0301 +🙂'),
    ['abc','資料','料庫','x','中','𠀀𠀁','𠀁𠀂','foo','bar','12','café','é']);
  assert.deepEqual(tokenizeT1('東京かな한글A42'), ['東京','かな한글a42']);
  assert.deepEqual(tokenizeT1('the AND be 我 愛 資料資料'), ['我','愛','資料','料資','資料']);
  assert.deepEqual(tokenizeT1Plus('資料庫 running THE'), ['資','料','庫','資料','料庫','run']);
  assert.deepEqual(tokenizeT1Plus('中'), ['中']);
  assert.deepEqual(tokenizeT1Plus('running café abc42'), ['run','café','abc42']);
  assert.throws(() => ENGLISH_STOPWORDS.add('x'), /frozen/);
  assert.ok(Object.isFrozen(ENGLISH_STOPWORDS));
});
test('wholeRuns exactly matches core scorer boundaries without NFKC', () => {
  const text = 'ＡＢＣ foo_bar 中文資料庫 Café 42';
  assert.deepEqual(wholeRuns(text), ['ａｂｃ','foo','bar','中文資料庫','café','42']);
  const query = 'foo 中文資料庫';
  assert.equal(createQueryScore(query)(text), [...new Set(wholeRuns(query))].filter(t => wholeRuns(text).includes(t)).length);
});
const porterVectors = {
  caresses:'caress', ponies:'poni', ties:'ti', caress:'caress', cats:'cat', feed:'feed', agreed:'agre',
  plastered:'plaster', bled:'bled', motoring:'motor', sing:'sing', conflated:'conflat', troubled:'troubl', sized:'size',
  hopping:'hop', tanned:'tan', falling:'fall', hissing:'hiss', fizzed:'fizz', failing:'fail', filing:'file',
  happy:'happi', sky:'sky', relational:'relat', conditional:'condit', rational:'ration', valenci:'valenc', hesitanci:'hesit',
  digitizer:'digit', conformabli:'conform', radically:'radic', differentli:'differ', vileli:'vile', analogousli:'analog',
  vietnamization:'vietnam', predication:'predic', operator:'oper', feudalism:'feudal', decisiveness:'decis', hopefulness:'hope',
  callousness:'callous', formaliti:'formal', sensitiviti:'sensit', sensibiliti:'sensibl', triplicate:'triplic', formative:'form',
  formalize:'formal', electriciti:'electr', electrical:'electr', hopeful:'hope', goodness:'good', revival:'reviv', allowance:'allow',
  inference:'infer', airliner:'airlin', gyroscopic:'gyroscop', adjustable:'adjust', defensible:'defens', irritant:'irrit', replacement:'replac',
  adjustment:'adjust', dependent:'depend', adoption:'adopt', homologou:'homolog', communism:'commun', activate:'activ', angulariti:'angular',
  homologous:'homolog', effective:'effect', bowdlerize:'bowdler', probate:'probat', rate:'rate', cease:'ceas', controll:'control', roll:'roll',
};
test('classic Porter 1980 published step vectors', () => {
  for (const [word, expected] of Object.entries(porterVectors)) assert.equal(porterStem(word), expected, word);
});
test('BM25 hand calculation, distinct query terms, matching candidates and ID ties', () => {
  const index = createBM25([document('b','apple apple pear'), document('a','apple'), document('c','pear')]);
  assert.equal(index.N, 3); assert.equal(index.avgLength, 5/3); assert.equal(index.df.get('apple'), 2);
  const rows = index.search('apple apple');
  const idf = Math.log(1 + 1.5 / 2.5);
  assert.equal(rows.find(r => r.memoryId === 'b').score, idf * 2 * 2.2 / (2 + 1.2 * (0.25 + 0.75 * 3 / (5/3))));
  assert.equal(rows.find(r => r.memoryId === 'a').score, idf * 2.2 / (1 + 1.2 * (0.25 + 0.75 / (5/3))));
  assert.deepEqual(index.search('missing'), []);
  assert.deepEqual(createBM25([document('b','apple'), document('a','apple')]).search('apple').map(r => r.memoryId), ['a','b']);
});
test('BM25 A5 maximum document score is collapsed before requested depth', () => {
  const docs = Array.from({ length: 30 }, (_, i) => document('a', 'apple', 'span', `a#${i}`));
  docs.push(document('b','apple pear'), document('c','nothing'));
  assert.deepEqual(createBM25(docs).search('apple', 2).map(row => row.memoryId), ['a','b']);
});
test('FTS5 trigram cannot match short terms and has no LIKE fallback', () => {
  const index = createTrigram([document('a','資料庫備份 abcdef'), document('b','資料庫工程 abc')]);
  try {
    assert.equal(trigramExpression('資料'), ''); assert.deepEqual(index.search('資料'), []);
    assert.equal(trigramExpression('ABCD xy'), '"abc" OR "bcd"');
    assert.equal(trigramExpression('ab cd'), '');
    assert.deepEqual(index.search('資料庫').map(row => row.memoryId).sort(), ['a','b']);
    assert.ok(index.search('abc').every(row => row.score >= 0));
    assert.deepEqual(index.search('" OR - * 🙂'), []);
  } finally { index.close(); }
});
test('masked mean ignores padding, CLS and exact cosine', () => {
  const hidden = { dims: [1,3,2], data: new Float32Array([1,0,0,2,900,900]) };
  const mean = poolHidden(hidden, [1n,1n,0n], 'masked-mean');
  assert.ok(Math.abs(cosine(mean, [1,2]) - 1) < 1e-7);
  assert.deepEqual([...poolHidden(hidden, [1,1,1], 'cls')], [1,0]);
  assert.equal(cosine([2,0], [3,0]), 1);
  assert.equal(cosine([2,0], [-3,0]), -1);
  assert.throws(() => normalizeVector([0,0]), /zero/);
});

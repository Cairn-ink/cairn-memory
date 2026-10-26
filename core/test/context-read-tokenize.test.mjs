import test from 'node:test';
import assert from 'node:assert/strict';
import { tokenizeT1, ENGLISH_STOPWORDS } from '../context-read-tokenize.mjs';

// Copied T1 vectors: HR-1 test/arms-lexical.test.mjs:10. T1+ and
// Porter assertions intentionally excluded: neither is part of frozen T1.
test('R03 T1 frozen Unicode boundaries, mixed scripts, NFKC and one-character runs', () => {
  assert.deepEqual(tokenizeT1('ＡＢＣ資料庫x 中，𠀀𠀁𠀂 foo_bar １２ Café e\u0301 +🙂'),
    ['abc','資料','料庫','x','中','𠀀𠀁','𠀁𠀂','foo','bar','12','café','é']);
  assert.deepEqual(tokenizeT1('東京かな한글A42'), ['東京','かな한글a42']);
  assert.deepEqual(tokenizeT1('the AND be 我 愛 資料資料'), ['我','愛','資料','料資','資料']);
  assert.deepEqual(tokenizeT1('running café abc42'), ['running','café','abc42']);
  assert.throws(() => ENGLISH_STOPWORDS.add('x'), /frozen/);
  assert.ok(Object.isFrozen(ENGLISH_STOPWORDS));
});

test('R03 documented exception: embedded single-Han query 中 misses 中文', () => {
  assert.deepEqual(tokenizeT1('中'), ['中']);
  assert.deepEqual(tokenizeT1('中文'), ['中文']);
  assert.equal(tokenizeT1('中文').includes(tokenizeT1('中')[0]), false);
  assert.equal('中文'.includes('中'), true, 'legacy substring search can match it');
});

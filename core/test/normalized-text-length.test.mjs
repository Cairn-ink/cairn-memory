import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import {
  MemoryStoreError, normalizeBoundedText, normalizedTextLength, openMemoryCore,
} from '../index.mjs';
import { boundedText } from '../validation.mjs';

test('public helpers measure the exact bounded-text normalization in UTF-16 units', () => {
  // Synthetic redaction pattern from plugins/cairn-memory/test/transcript.test.mjs.
  const cases = [
    ['a…b', 'a...b'],
    ['a˜b', 'a \u0303b'],
    ['a¸b', 'a \u0327b'],
    ['ＡＢＣ', 'ABC'],
    ['already normalized ASCII', 'already normalized ASCII'],
    ['中文日本語', '中文日本語'],
    [' \t alpha\n\r  beta\u00a0 ', 'alpha beta'],
    ['prefix Bearer abcdefghijklmnop suffix', 'prefix [REDACTED] suffix'],
    ['a😀b', 'a😀b'],
  ];
  for (const [raw, expected] of cases) {
    assert.equal(normalizeBoundedText(raw), expected);
    assert.equal(normalizedTextLength(raw), expected.length);
    assert.equal(normalizeBoundedText(raw), boundedText(raw, Infinity));
  }
  assert.equal(normalizedTextLength('a…b') - 'a…b'.length, 2);
  for (const point of ['˜', '¸']) {
    assert.equal(normalizedTextLength(`a${point}b`) - `a${point}b`.length, 1);
  }
});

test('raw lengths below 4,000 can normalize to exactly 4,000 or 4,001', () => {
  for (const [raw, length] of [
    ['x'.repeat(3997) + '…', 4000],
    ['x'.repeat(3998) + '…', 4001],
    ['x'.repeat(3998) + '˜z', 4001],
    ['x'.repeat(3997) + '¸z', 4000],
    ['x'.repeat(4000), 4000],
    ['x'.repeat(4001), 4001],
  ]) {
    assert.equal(normalizedTextLength(raw), length);
    if (length <= 4000) assert.equal(boundedText(raw, 4000), normalizeBoundedText(raw));
    else assert.throws(() => boundedText(raw, 4000), { code: 'invalid_text' });
  }
});

test('seeded corpus has equivalent length decisions and unbounded normalized results', () => {
  let seed = 0x6e6f726d;
  const next = () => (seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0);
  const tokens = ['a', '中', '…', '˜', '¸', 'Ａ', 'ﬁ', '😀', '\t', '\n', ' ',
    '\u0301', '\u1100', '\u1161', '\ud800', 'Bearer abcdefghijklmnop'];
  const maxima = [240, 600, 800, 4000];
  const corpus = ['x'.repeat(20000), '…'.repeat(20000)];
  for (let index = 0; index < 256; index++) {
    let value = 'start';
    const size = next() % 160;
    for (let part = 0; part < size; part++) value += tokens[next() % tokens.length];
    const max = maxima[index % maxima.length];
    corpus.push(value, 'x'.repeat(Math.max(0, max - 2 + next() % 5)) + tokens[next() % tokens.length]);
  }
  for (const value of corpus) {
    const length = normalizedTextLength(value);
    assert.equal(normalizeBoundedText(value), boundedText(value, Infinity));
    for (const max of maxima) {
      let accepted = false;
      try {
        assert.equal(boundedText(value, max), normalizeBoundedText(value));
        accepted = true;
      } catch (error) {
        if (!(error instanceof MemoryStoreError)) throw error;
        assert.equal(error.code, 'invalid_text');
      }
      assert.equal(accepted, length <= max, `length=${length}, max=${max}`);
    }
  }
});

test('invalid inputs throw the same MemoryStoreError code as boundedText', () => {
  for (const value of [undefined, null, 42, {}, new String('text'), 'x'.repeat(20001),
    ' '.repeat(20001), '', ' \n\t\u00a0', '[REDACTED]', 'Bearer abcdefghijklmnop', 'a\0b']) {
    let expected;
    assert.throws(() => boundedText(value, Infinity), error => {
      assert.ok(error instanceof MemoryStoreError);
      expected = error.code;
      return true;
    });
    assert.equal(expected, 'invalid_text');
    for (const helper of [normalizeBoundedText, normalizedTextLength]) {
      assert.throws(() => helper(value), error =>
        error instanceof MemoryStoreError && error.code === expected);
    }
  }
});

test('truncation retains its code-point boundary and boundary whitespace behavior', () => {
  assert.equal(boundedText('ab😀z', 3, true), 'ab');
  assert.equal(boundedText('ab😀z', 4, true), 'ab😀');
  assert.equal(boundedText('a˜z', 2, true), 'a ');
  assert.equal(boundedText('…', 2, true), '..');
});

test('normalization is per field and concatenated segments are not length-additive', () => {
  const left = '\u1100', right = '\u1161';
  assert.equal(normalizedTextLength(left) + normalizedTextLength(right), 2);
  assert.equal(normalizedTextLength(left + right), 1);
});

test('24-message public capture rejects precisely the expanded over-limit message', async t => {
  const directory = mkdtempSync(join(tmpdir(), 'cairn-normalized-length-'));
  let calls = 0;
  const core = openMemoryCore({ path: join(directory, 'memory.sqlite'), model: {
    contextWindow: 8192, countTokens: () => 1,
    extract: async () => { calls++; return { items: [] }; },
  } });
  t.after(() => { core.close(); rmSync(directory, { recursive: true, force: true }); });
  const inputs = ['x'.repeat(3998) + '…', 'x'.repeat(3997) + '…', 'x'.repeat(3999)];
  assert.equal(inputs[0].length, 3999);
  for (const [index, content] of inputs.entries()) {
    const before = calls;
    const result = await core.capture({
      namespace: { ownerId: 'synthetic-length-test', scope: 'personal', projectId: null },
      client: 'synthetic', eventId: `batch-${index}`, sessionId: 'session',
      messages: Array.from({ length: 24 }, (_, message) => ({
        id: `message-${message}`, role: 'user', content: message === 12 ? content : 'Synthetic.',
      })),
    });
    const oversized = normalizedTextLength(content) > 4000;
    assert.equal(result.ok, !oversized, JSON.stringify(result));
    if (oversized) {
      assert.deepEqual(result, { ok: false, error: { code: 'invalid_input', retryable: false } });
      assert.equal(calls, before);
    } else assert.equal(calls, before + 1);
  }
});

import assert from 'node:assert/strict';
import test from 'node:test';
import { get_encoding } from 'tiktoken';
import * as adapter from '../index.mjs';
import { vectors } from './tokenizer-vectors.mjs';

test('narrow local counter uses exact o200k_base without a key or transport', () => {
  assert.equal(typeof adapter.countOpenAITokens, 'function');
  const encoder = get_encoding('o200k_base');
  const fetch = globalThis.fetch; globalThis.fetch = () => assert.fail('Local counter must not fetch');
  try {
    for (const { text, tokens } of vectors) assert.equal(adapter.countOpenAITokens(text), tokens.length);
    for (const text of ['', 'Synthetic source quotation.', '中文 🚋 e\u0301', '<|endoftext|>', '{"ok":true,"value":{"memories":[]}}']) {
      assert.equal(adapter.countOpenAITokens(text), encoder.encode(text, [], []).length);
    }
    for (const value of [undefined, null, 1, {}, []]) assert.throws(() => adapter.countOpenAITokens(value),
      error => error.code === 'token_count_unavailable');
  } finally { globalThis.fetch = fetch; encoder.free(); }
});

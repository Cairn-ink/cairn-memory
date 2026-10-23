import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { countTokens, COUNTER_ID } from '../assembly/counter.mjs';

test('fixed o200k_base vectors, including special-token spelling treated as ordinary text', () => {
  for (const [text, expected] of [['', 0], ['hello', 1], ['hello world', 2], ['Hello, world!', 4], ['你好', 1], ['<|endoftext|>', 7]]) assert.equal(countTokens(text), expected, text);
  assert.equal(COUNTER_ID, 'tiktoken@1.0.22:o200k_base:encode(text,[],[])');
  assert.throws(() => countTokens(null), /counter_text/);
});

test('both research manifests pin the exact counter package version', async () => {
  const manifest = JSON.parse(await readFile(new URL('../package.json', import.meta.url)));
  const lock = JSON.parse(await readFile(new URL('../package-lock.json', import.meta.url)));
  assert.equal(manifest.dependencies.tiktoken, '1.0.22');
  assert.equal(lock.packages[''].dependencies.tiktoken, '1.0.22');
  assert.equal(lock.packages['node_modules/tiktoken'].version, '1.0.22');
});

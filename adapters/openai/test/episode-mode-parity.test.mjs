import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, symlinkSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createTestWorkspace } from '../../../tools/testing/workspace.mjs';
import { captureOpenAIParity } from './openai-episode-parity.mjs';
import { setup, captureInput } from './openai-episodes.mjs';

test('E10 frozen base request, output and diagnostic bytes without episode mode', async () => {
  const frozen = JSON.parse(readFileSync(new URL('./openai-legacy-fixture.json', import.meta.url), 'utf8'));
  assert.equal(frozen.base, '7f9ee869');
  assert.ok(frozen.cases.length >= 30);
  assert.deepEqual(await captureOpenAIParity(), frozen.cases);
});

test('E10 legacy core rejects unexpected automatic tags even with an episode-capable adapter', async t => {
  const { core, calls } = setup(t, {}, { sessionEpisodes: undefined });
  const { episodeContext, ...input } = captureInput();
  const result = await core.capture(input);
  assert.equal(result.error.code, 'invalid_model_output');
  assert.deepEqual(calls.map(call => call.payload.text.format.name), ['cairn_extract', 'cairn_extract']);
  assert.equal(JSON.stringify(calls[0].payload.text.format.schema).includes('procedural'), false);
});

test('E10 parity accepts a checkout URL containing spaces', async t => {
  const workspace = createTestWorkspace(t, { prefix: 'openai-parity-' });
  const root = join(workspace.path, 'checkout with spaces');
  symlinkSync(fileURLToPath(new URL('../../../', import.meta.url)), root, 'dir');
  const frozen = JSON.parse(readFileSync(new URL('./openai-legacy-fixture.json', import.meta.url), 'utf8'));
  assert.deepEqual(await captureOpenAIParity(pathToFileURL(root)), frozen.cases);
});

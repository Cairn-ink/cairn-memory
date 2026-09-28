import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { captureOpenAIParity } from '../../../core/testing/openai-episode-parity.mjs';
import { setup, captureInput } from '../../../core/testing/openai-episodes.mjs';

test('E10 frozen base request, output and diagnostic bytes without episode mode', async () => {
  const frozen = JSON.parse(readFileSync(new URL('../../../core/testing/openai-legacy-fixture.json', import.meta.url), 'utf8'));
  assert.equal(frozen.base, '7f9ee869');
  assert.ok(frozen.cases.length >= 30);
  assert.deepEqual(await captureOpenAIParity(new URL('../../../', import.meta.url).pathname), frozen.cases);
});

test('E10 legacy core rejects unexpected automatic tags even with an episode-capable adapter', async t => {
  const { core, calls } = setup(t, {}, { sessionEpisodes: undefined });
  const { episodeContext, ...input } = captureInput();
  const result = await core.capture(input);
  assert.equal(result.error.code, 'invalid_model_output');
  assert.deepEqual(calls.map(call => call.payload.text.format.name), ['cairn_extract', 'cairn_extract']);
  assert.equal(JSON.stringify(calls[0].payload.text.format.schema).includes('procedural'), false);
});

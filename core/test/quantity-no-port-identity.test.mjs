import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { captureOpenAIParity } from '../../adapters/openai/test/openai-episode-parity.mjs';
import { assembleThreeLayerContext } from '../context-read-three-layer.mjs';
import { extractionRequest } from '../capture.mjs';
import { meteredText } from '../context-read-assembly.mjs';
import { compactAssemblyOptions, compactRepresentation } from '../testing/context-read-compact-fixture.mjs';

const fixture = path => JSON.parse(readFileSync(new URL(path, import.meta.url), 'utf8'));

test('extraction request bodies without a ledger retain the existing fixture bytes', async () => {
  const expected = fixture('../../adapters/openai/test/openai-legacy-fixture.json').cases;
  const bodies = cases => cases.filter(row => row.method === 'extract').map(row => row.calls);
  assert.deepEqual(bodies(await captureOpenAIParity()), bodies(expected));
  const cases = fixture('../testing/episode-v15-fixture.json').parity;
  for (const { config, expected: parity } of cases) {
    const [, pinned] = parity.calls.find(([method]) => method === 'extract');
    const request = extractionRequest({ messages: pinned.input.messages }, config);
    assert.equal(JSON.stringify({ system: request.system, input: request.input }),
      JSON.stringify({ system: pinned.system, input: pinned.input }));
  }
});

test('compact reads without a ledger retain the existing metered fixture bytes', () => {
  const expected = fixture('./fixtures/context-read/compact-s01-bytes.json');
  const result = assembleThreeLayerContext(compactAssemblyOptions({ representation: compactRepresentation }));
  assert.equal(meteredText(result.metered), expected.compactText);
});

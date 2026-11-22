import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { isBuiltin } from 'node:module';
import { performance } from 'node:perf_hooks';
import test from 'node:test';
import { extractedItems } from '../../../core/capture-input.mjs';
import { createOpenAIEmbedder } from '../../../adapters/openai/embedding.mjs';
import { schemasFor } from '../../../adapters/openai/schemas.mjs';
import { decodeEmbeddingData } from '@cairn-ink/memory-core/embedding';
import {
  EXTRACT_MEMORIES_PROMPT, plainExtractionSpec, validatePlainCandidates,
} from '@cairn-ink/memory-core/extraction';

const fixtures = name => JSON.parse(readFileSync(new URL(`./fixtures/${name}.json`, import.meta.url), 'utf8'));
const requests = fixtures('extraction-spec');

for (const { name, messages, itemLimit, indexMaximum, errorMessage } of requests) {
  test(`plain extraction request: ${name}`, () => {
    const input = { messages: messages.map((message, index) => ({ index, ...message })) };
    if (errorMessage) {
      assert.throws(() => schemasFor('extract', input), { message: errorMessage });
      assert.throws(() => plainExtractionSpec(messages), { message: errorMessage });
      return;
    }
    const schema = schemasFor('extract', input);
    const actual = plainExtractionSpec(messages);
    assert.deepEqual(actual, { system: EXTRACT_MEMORIES_PROMPT, input, schema });
    assert.equal(JSON.stringify(actual.input), JSON.stringify(input));
    assert.equal(JSON.stringify(actual.schema), JSON.stringify(schema));
    assert.equal(actual.schema.properties.items.maxItems, itemLimit);
    const sourceIndex = actual.schema.properties.items.items.properties.sourceIndices.items;
    if (indexMaximum === null) assert.equal(Object.hasOwn(sourceIndex, 'maximum'), false);
    else assert.equal(sourceIndex.maximum, indexMaximum);
  });
}

// The engine's capture module loads the built-in SQLite driver. The Node 20
// CI row can still run the schema, candidate and embedding oracles.
test('prompt and request projection match the engine capture module', {
  skip: !isBuiltin('node:sqlite') && 'The engine capture module requires node:sqlite',
}, async () => {
  const { extractionRequest } = await import('../../../core/capture.mjs');
  for (const { name, messages, errorMessage } of requests) {
    const { system, input } = extractionRequest({ messages }, {});
    assert.deepEqual(Buffer.from(EXTRACT_MEMORIES_PROMPT), Buffer.from(system), name);
    if (errorMessage) {
      assert.throws(() => schemasFor('extract', input), { message: errorMessage });
      continue;
    }
    const expected = { system, input, schema: schemasFor('extract', input) };
    const actual = plainExtractionSpec(messages);
    assert.deepEqual(actual, expected, name);
    assert.equal(JSON.stringify(actual), JSON.stringify(expected), name);
  }
});

for (const { name, output, policy, errorCode, expected } of fixtures('extraction-candidates')) {
  test(`plain extraction validation: ${name}`, () => {
    const messages = Array.from({ length: policy.sourceCount }, (_, index) => ({
      id: `message-${index}`, role: index % 2 ? 'assistant' : 'user', content: `Evidence ${index}.`,
    }));
    // Causal snapshots expose the indices already validated by the plain path.
    const snapshot = { messages, causal: true, client: 'test-client', sessionId: 'test-session' };
    const diagnostics = [];
    const engine = () => extractedItems(output, snapshot, undefined,
      reason => diagnostics.push(reason), undefined, policy.itemLimit);
    if (errorCode) {
      assert.throws(engine, { code: 'invalid_model_output' });
      assert.deepEqual(diagnostics, [errorCode]);
      assert.throws(() => validatePlainCandidates(output, policy), { code: diagnostics[0] });
      return;
    }
    const engineItems = engine();
    const engineCandidates = engineItems.map(({ receipts, ...candidate }) => {
      assert.deepEqual(receipts, candidate.sourceIndices.map(index => ({
        client: snapshot.client, sessionId: snapshot.sessionId, eventId: messages[index].id,
        role: messages[index].role, excerpt: messages[index].content,
      })));
      return candidate;
    });
    assert.deepEqual(diagnostics, []);
    assert.deepEqual(engineCandidates, expected);
    assert.deepEqual(validatePlainCandidates(output, policy), engineCandidates);
  });
}

const { spec: vectorSpec, cases: embeddingCases } = fixtures('embedding-data');
for (const { name, requestedCount, data, dataJson = JSON.stringify(data), errorCode, expected } of embeddingCases) {
  test(`embedding decode: ${name}`, async () => {
    const model = 'text-embedding-3-small';
    const embedder = createOpenAIEmbedder({
      apiKey: 'synthetic', model, dimensions: vectorSpec.dimensions,
      fetchImpl: async () => new Response(`{"object":"list","model":${JSON.stringify(model)},"data":${dataJson}}`),
    });
    const decode = () => decodeEmbeddingData(JSON.parse(dataJson), requestedCount, vectorSpec);
    const engine = embedder.embed(Array(requestedCount).fill('Synthetic recollection.'), {
      beforeDispatch() {}, settleUsd() {}, deadlineAt: performance.now() + 5000,
    });
    if (errorCode) {
      await assert.rejects(engine, { code: errorCode });
      assert.throws(decode, { code: errorCode });
      return;
    }
    const vectors = await engine;
    assert.deepEqual(vectors, expected.map(vector => Float32Array.from(vector)));
    assert.deepEqual(decode(), vectors);
  });
}

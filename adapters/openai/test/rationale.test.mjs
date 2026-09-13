import assert from 'node:assert/strict';
import test from 'node:test';
import { createOpenAIModel } from '../index.mjs';
import { schemas, schemasFor } from '../schemas.mjs';
import { DEFAULT_MODEL, LUNA_EXTRACTION_MODEL } from '../profiles.mjs';

const input = { memories: [{ index: 0, receipts: [{ index: 0, role: 'user', excerpt: 'I chose A because it works offline.' }] }] };
const output = { edges: [{ from: 0, to: 0, relation: 'supports-decision', fromReceipt: 0, toReceipt: 0 }] };
const request = () => ({ system: 'Synthetic source relation', input, maxOutputTokens: 1024, signal: new AbortController().signal });
test('relate uses existing exact baseline count/generate framing, never inherits extraction profile or paid schema grant', async () => {
  for (const extractionModel of [DEFAULT_MODEL, LUNA_EXTRACTION_MODEL]) {
    const calls = [];
    const model = createOpenAIModel({ apiKey: 'synthetic', extractionModel, fetchImpl: async (url, options) => {
      const body = JSON.parse(options.body); calls.push(body);
      return Response.json(url.endsWith('/input_tokens') ? { object: 'response.input_tokens', input_tokens: 120 } : {
        object: 'response', model: body.model, status: 'completed', error: null, incomplete_details: null,
        output: [{ type: 'message', role: 'assistant', status: 'completed', content: [{ type: 'output_text', text: JSON.stringify(output) }] }],
        usage: { input_tokens: 120, output_tokens: 80, total_tokens: 200 },
      });
    } });
    assert.deepEqual(await model.relate(request()), output); assert.equal(calls.length, 2);
    assert.equal(calls[0].model, DEFAULT_MODEL); assert.equal(calls[0].text.format.name, 'cairn_relate');
    assert.equal(calls[0].text.format.strict, true); assert.equal(calls[0].truncation, 'disabled');
    const { max_output_tokens, store, stream, ...count } = calls[1];
    assert.deepEqual(count, calls[0]); assert.equal(max_output_tokens, 1024); assert.equal(store, false); assert.equal(stream, false);
    assert.equal(Object.hasOwn(schemas, 'relate'), false);
  }
});

test('relate scopes indices and rejects invalid requests/bounds before generation, with no retry', async () => {
  const schema = schemasFor('relate', input);
  assert.deepEqual(schema.properties.edges.items.properties.from.enum, [0]);
  assert.deepEqual(schema.properties.edges.items.properties.fromReceipt.enum, [0]);
  assert.equal(schema.properties.edges.maxItems, 10);
  let calls = 0;
  const model = createOpenAIModel({ apiKey: 'synthetic', fetchImpl: async () => {
    calls++; return Response.json({ object: 'response.input_tokens', input_tokens: 7025 });
  } });
  for (const memories of [[], Array(7).fill(input.memories[0]), [{ index: 0, receipts: [] }]]) {
    await assert.rejects(model.relate({ ...request(), input: { memories } }));
  }
  assert.equal(calls, 0);
  await assert.rejects(model.relate(request()), { code: 'context_budget_exceeded' }); assert.equal(calls, 1);
  const controller = new AbortController(); controller.abort();
  await assert.rejects(model.relate({ ...request(), signal: controller.signal }), { name: 'AbortError' }); assert.equal(calls, 1);
});

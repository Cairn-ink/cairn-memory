import assert from 'node:assert/strict';
import test from 'node:test';
import { createOpenAIModel } from '../index.mjs';
import { schemasFor } from '../schemas.mjs';

for (const count of [1, 5, 6, 12, 20, 40]) test(`user material: provider schema and output allowance follow ${count} user messages`, async () => {
  const calls = [];
  const model = createOpenAIModel({ apiKey: 'synthetic', fetchImpl: async (url, options) => {
    const body = JSON.parse(options.body); calls.push(body);
    return new Response(JSON.stringify(url.endsWith('/input_tokens') ? { object: 'response.input_tokens', input_tokens: 50 }
      : { object: 'response', model: body.model, status: 'completed', error: null, incomplete_details: null,
        output: [{ type: 'message', role: 'assistant', status: 'completed', content: [{ type: 'output_text', text: '{"items":[]}' }] }],
        usage: { input_tokens: 50, output_tokens: body.max_output_tokens, total_tokens: 50 + body.max_output_tokens } }));
  } });
  // The engine's existing planner splits forty short sources into 24 + 16.
  for (const size of count === 40 ? [24, 16] : [count]) {
    const limit = Math.max(5, Math.min(20, size));
    const input = { messages: Array.from({ length: size }, (_, index) => ({ index, role: 'user', content: 'I prefer drawing.' })) };
    const maxOutputTokens = Math.ceil(1024 * limit / 5);
    const before = calls.length;
    assert.deepEqual(await model.extract({ system: 'Synthetic extraction.', input, maxOutputTokens,
      signal: new AbortController().signal }), { items: [] });
    assert.equal(calls.length - before, 2);
    assert.equal(calls[before].text.format.schema.properties.items.maxItems, limit);
    assert.equal(calls[before + 1].max_output_tokens, maxOutputTokens);
    assert.equal(schemasFor('extract', input).properties.items.maxItems, limit);
  }
});


test('user material: ordered reconciliation accepts the larger replacement set with its existing transition bound', () => {
  const schema = schemasFor('reconcile', {
    messages: [{ index: 0 }], items: Array.from({ length: 20 }, (_, index) => ({ index })),
    candidates: [{ index: 0 }],
  });
  assert.equal(schema.properties.transitions.maxItems, 1);
  assert.equal(schema.properties.transitions.items.properties.replacementIndex.enum.length, 20);
});


test('user material: malformed messages still fail as invalid requests before HTTP', async () => {
  let calls = 0;
  const model = createOpenAIModel({ apiKey: 'synthetic', fetchImpl: async () => { calls++; assert.fail('Unexpected HTTP'); } });
  for (const messages of [[null], [undefined], [{ index: 0, role: 'other', content: 'Synthetic.' }]]) {
    await assert.rejects(model.extract({ system: 'Synthetic extraction.', input: { messages }, maxOutputTokens: 1024,
      signal: new AbortController().signal }), /invalid_openai_request/);
  }
  assert.equal(calls, 0);
});

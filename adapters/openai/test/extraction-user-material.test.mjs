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

test('user material: the item ceiling follows user messages at any stated allowance; more than the derived allowance is refused', async () => {
  const bodies = [];
  const model = createOpenAIModel({ apiKey: 'synthetic', fetchImpl: async (_url, options) => {
    bodies.push(JSON.parse(options.body)); throw new Error('synthetic-stop');
  } });
  const messages = count => Array.from({ length: count }, (_, index) => ({ index, role: 'user', content: 'I prefer drawing.' }));
  const call = (count, maxOutputTokens) => model.extract({ system: 'Synthetic extraction.', input: { messages: messages(count) },
    maxOutputTokens, signal: new AbortController().signal });
  // Twelve user messages derive 2458. Capture states 1024.
  for (const stated of [1024, 2048, 2458]) {
    await assert.rejects(call(12, stated), /openai_request_failed/);
    assert.equal(bodies.at(-1).text.format.schema.properties.items.maxItems, 12);
  }
  const sent = bodies.length;
  for (const [count, stated] of [[1, 1025], [12, 2459], [20, 4097], [12, 1023]]) {
    await assert.rejects(call(count, stated), /invalid_openai_request/);
  }
  assert.equal(bodies.length, sent);
});

test('user material: an extraction stopped at the output cap reports its own content-free diagnostic', async () => {
  const run = async (method, details) => {
    const seen = [];
    const model = createOpenAIModel({ apiKey: 'synthetic', onDiagnostic: event => seen.push(event),
      fetchImpl: async (url, options) => {
        const body = JSON.parse(options.body);
        return new Response(JSON.stringify(url.endsWith('/input_tokens') ? { object: 'response.input_tokens', input_tokens: 50 }
          : { object: 'response', model: body.model, status: 'incomplete', error: null, incomplete_details: details,
            output: [{ type: 'message', role: 'assistant', status: 'incomplete', content: [{ type: 'output_text', text: '{"items":[' }] }],
            usage: { input_tokens: 50, output_tokens: 1024, total_tokens: 1074 } }));
      } });
    await assert.rejects(model[method]({ system: 'Synthetic extraction.', maxOutputTokens: 1024, signal: new AbortController().signal,
      input: { messages: [{ index: 0, role: 'user', content: 'I prefer drawing.' }] } }), error => error.code === 'invalid_model_output');
    return seen;
  };
  assert.deepEqual(await run('extract', { reason: 'max_output_tokens' }),
    [{ version: 1, stage: 'extract', layer: 'adapter', reason: 'output_truncated' }]);
  // Any other incomplete response keeps the existing reason.
  assert.deepEqual(await run('extract', { reason: 'content_filter' }),
    [{ version: 1, stage: 'extract', layer: 'adapter', reason: 'response_envelope' }]);
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

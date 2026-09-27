import assert from 'node:assert/strict';
import test from 'node:test';
import { createOpenAIModel } from '../index.mjs';

const request = input => ({ system: 'Extract only from supplied synthetic sources.', input,
  maxOutputTokens: 1024, signal: new AbortController().signal });
const messages = count => Array.from({ length: count }, (_, index) => ({ index,
  role: index % 2 ? 'assistant' : 'user', content: `Synthetic source ${index}.` }));

function sourceDomain(schema) {
  assert.equal(schema.type, 'object');
  assert.equal(schema.additionalProperties, false);
  const items = schema.properties.items;
  const sources = items.items.properties.sourceIndices;
  assert.equal(sources.type, 'array');
  assert.equal(sources.minItems, 1);
  assert.equal(sources.maxItems, 4);
  const accepts = value => Number.isSafeInteger(value)
    && (sources.items.minimum === undefined || value >= sources.items.minimum)
    && (sources.items.maximum === undefined || value <= sources.items.maximum)
    && (sources.items.enum === undefined || sources.items.enum.includes(value));
  return { items, accepts };
}

async function outgoing(input) {
  const bodies = [];
  const model = createOpenAIModel({ apiKey: 'synthetic-key', fetchImpl: async (_url, options) => {
    bodies.push(JSON.parse(options.body));
    throw new Error('synthetic-stop');
  } });
  await assert.rejects(model.extract(request(input)), /openai_request_failed/);
  assert.equal(bodies.length, 1, 'count request only; no automatic retry');
  return bodies[0];
}

test('outgoing extract schema limits source indices to the current canonical batch', async () => {
  for (const count of [1, 2, 24]) {
    const body = await outgoing({ messages: messages(count) });
    const { items, accepts } = sourceDomain(body.text.format.schema);
    assert.equal(items.maxItems, 5);
    for (let index = 0; index < count; index++) assert.equal(accepts(index), true);
    for (const index of [-1, count, count + 1, 99]) {
      assert.equal(accepts(index), false, `source ${index} must be excluded from batch of ${count}`);
    }
    for (const index of ['0', 0.5, null]) assert.equal(accepts(index), false);
  }
});

test('zero-message adapter callers can return only an empty extraction', async () => {
  const body = await outgoing({ messages: [] });
  const { items } = sourceDomain(body.text.format.schema);
  assert.equal(items.maxItems, 0);
  assert.equal(items.minItems ?? 0, 0);
  assert.equal(body.text.format.schema.required.includes('items'), true);
});

test('malformed or noncanonical source snapshots stop before HTTP', async () => {
  const sparse = messages(2); delete sparse[0];
  const malformed = [null, {}, { messages: null }, { messages: {} },
    { messages: sparse }, { messages: messages(25) },
    { messages: [{ ...messages(1)[0], index: 1 }] },
    { messages: [messages(1)[0], { ...messages(1)[0] }] },
    { messages: [messages(2)[1], messages(2)[0]] },
    { messages: [{ role: 'user', content: 'Synthetic.' }] },
    { messages: [{ index: 0, role: 'tool', content: 'Synthetic.' }] },
    { messages: [{ index: 0, role: 'user', content: null }] }];
  for (const input of malformed) {
    let calls = 0;
    const model = createOpenAIModel({ apiKey: 'synthetic-key', fetchImpl: async () => { calls++; } });
    await assert.rejects(model.extract(request(input)), /invalid_openai_request/);
    assert.equal(calls, 0);
  }
});

const envelope = (body, output) => ({ object: 'response', model: body.model,
  status: 'completed', error: null, incomplete_details: null,
  output: [{ type: 'message', role: 'assistant', status: 'completed',
    content: [{ type: 'output_text', text: JSON.stringify(output) }] }],
  usage: { input_tokens: 100, output_tokens: 20, total_tokens: 120 } });

test('count and generation retain one detached extract schema and source snapshot', async () => {
  const input = { messages: messages(2) };
  const bodies = [];
  const model = createOpenAIModel({ apiKey: 'synthetic-key', fetchImpl: async (url, options) => {
    const body = JSON.parse(options.body); bodies.push(body);
    if (url.endsWith('/input_tokens')) {
      input.messages[0].index = 99;
      input.messages.push({ index: 2, role: 'user', content: 'Late source.' });
      return Response.json({ object: 'response.input_tokens', input_tokens: 100 });
    }
    return Response.json(envelope(body, { items: [{ content: 'Synthetic source 1.',
      kind: 'fact', confidence: 0.9, sourceIndices: [1] }] }));
  } });
  assert.deepEqual(await model.extract(request(input)), { items: [{ content: 'Synthetic source 1.',
    kind: 'fact', confidence: 0.9, sourceIndices: [1] }] });
  assert.equal(bodies.length, 2);
  assert.deepEqual(bodies[0].text, bodies[1].text);
  assert.deepEqual(bodies[0].input, bodies[1].input);
  assert.deepEqual(JSON.parse(bodies[1].input[0].content[0].text).messages, messages(2));
  assert.equal(sourceDomain(bodies[1].text.format.schema).accepts(2), false);
});

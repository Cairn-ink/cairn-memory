import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';
import { createOpenAIModel } from '../index.mjs';

const request = input => ({ system: 'Synthetic indexed windows.', input, maxOutputTokens: 1024,
  signal: new AbortController().signal });
const indexed = count => ({ inputMode: 'indexed-windows-v1', messages: Array.from({ length: count }, (_, index) =>
  ({ index, messageIndex: Math.floor(index / 4), role: index % 8 < 4 ? 'user' : 'assistant', content: `Synthetic ${index}.` })) });
const envelope = (body, output) => ({ object: 'response', model: body.model, status: 'completed', error: null,
  incomplete_details: null, output: [{ type: 'message', role: 'assistant', status: 'completed',
    content: [{ type: 'output_text', text: JSON.stringify(output) }] }],
  usage: { input_tokens: 100, output_tokens: 20, total_tokens: 120 } });

test('W9 indexed mode admits 24/25/64, constrains index 24+, and snapshots count and generation', async () => {
  for (const count of [24, 25, 64]) {
    const input = indexed(count); const bodies = [];
    const model = createOpenAIModel({ apiKey: 'synthetic', fetchImpl: async (url, options) => {
      const body = JSON.parse(options.body); bodies.push(body);
      if (url.endsWith('/input_tokens')) {
        input.messages[0].content = 'MUTATED'; input.messages.push({ index: count, messageIndex: 20,
          role: 'user', content: 'LATE' });
        return Response.json({ object: 'response.input_tokens', input_tokens: 100 });
      }
      return Response.json(envelope(body, { items: [{ content: 'Synthetic selection.', kind: 'fact', confidence: 0.8,
        sourceIndices: [count - 1] }] }));
    } });
    assert.deepEqual((await model.extract(request(input))).items[0].sourceIndices, [count - 1]);
    assert.equal(bodies.length, 2);
    assert.deepEqual(bodies[0].input, bodies[1].input);
    assert.deepEqual(bodies[0].text, bodies[1].text);
    const wire = JSON.parse(bodies[0].input[0].content[0].text);
    assert.equal(wire.inputMode, 'indexed-windows-v1');
    assert.equal(wire.messages.length, count);
    assert.equal(wire.messages[0].content, 'Synthetic 0.');
    assert.equal(bodies[0].text.format.schema.properties.items.items.properties.sourceIndices.items.maximum, count - 1);
    assert.equal(JSON.stringify(bodies).includes('LATE'), false);
  }
});

test('W9 malformed opt-in envelopes, modes, fields, groups and bounds reject before any HTTP', async () => {
  const bad = [];
  let getterCalls = 0;
  const variant = change => { const value = indexed(2); change(value); bad.push(value); };
  variant(value => { value.inputMode = undefined; });
  variant(value => { value.inputMode = 'other'; });
  variant(value => { value.extra = true; });
  variant(value => { value.messages[0].extra = true; });
  variant(value => { value.messages[0].index = 1; });
  variant(value => { value.messages[1].messageIndex = 2; });
  variant(value => { value.messages[1].role = 'assistant'; });
  variant(value => { value.messages[0].content = ''; });
  variant(value => { value.messages[0].content = '\ud800'; });
  variant(value => { value.messages[0].content = 'x'.repeat(801); });
  variant(value => { value.messages = Array.from({ length: 65 }, (_, index) =>
    ({ index, messageIndex: Math.floor(index / 4), role: 'user', content: 'x' })); });
  variant(value => { delete value.messages[0]; });
  variant(value => { Object.defineProperty(value.messages[0], 'content', { get: () => { getterCalls++; return 'Synthetic'; }, enumerable: true }); });
  variant(value => { Object.defineProperty(value, 'inputMode', { get: () => { getterCalls++; return 'indexed-windows-v1'; }, enumerable: true }); });
  variant(value => { value.messages[0].content = 'x'.repeat(800); value.messages[1].content = 'x'.repeat(800);
    value.messages.push(...[2, 3, 4, 5].map(index => ({ index, messageIndex: 0, role: 'user', content: 'x'.repeat(800) }))); });
  variant(value => { value.messages = Array.from({ length: 28 }, (_, index) => ({ index,
    messageIndex: Math.floor(index / 4), role: 'user', content: 'x'.repeat(800) })); });
  bad.push({ messages: indexed(25).messages });
  bad.push(Object.assign(Object.create({ inputMode: 'indexed-windows-v1' }), { messages: indexed(25).messages }));
  for (const input of bad) {
    let calls = 0;
    const model = createOpenAIModel({ apiKey: 'synthetic', fetchImpl: async () => { calls++; } });
    await assert.rejects(model.extract(request(input)), /invalid_openai_request/);
    assert.equal(calls, 0);
  }
  assert.equal(getterCalls, 0);
});

test('W9 indexed local/provider/output token bounds remain unchanged', async () => {
  let calls = 0;
  const local = createOpenAIModel({ apiKey: 'synthetic', fetchImpl: async () => { calls++; } });
  const oversized = indexed(25); oversized.messages.forEach(message => { message.content = '漢'.repeat(800); });
  await assert.rejects(local.extract(request(oversized)), { code: 'context_budget_exceeded' });
  assert.equal(calls, 0);
  const counted = createOpenAIModel({ apiKey: 'synthetic', fetchImpl: async () => {
    calls++; return Response.json({ object: 'response.input_tokens', input_tokens: 7025 });
  } });
  await assert.rejects(counted.extract(request(indexed(2))), { code: 'context_budget_exceeded' });
  assert.equal(calls, 1);
  calls = 0;
  const output = createOpenAIModel({ apiKey: 'synthetic', fetchImpl: async (url, options) => {
    calls++; if (url.endsWith('/input_tokens')) return Response.json({ object: 'response.input_tokens', input_tokens: 100 });
    const body = JSON.parse(options.body);
    return Response.json({ ...envelope(body, { items: [] }),
      usage: { input_tokens: 100, output_tokens: 1025, total_tokens: 1125 } });
  } });
  await assert.rejects(output.extract(request(indexed(2))), { code: 'invalid_model_output' });
  assert.equal(calls, 2);
});

test('W9 old extract wire and schema remain byte-identical without own mode', async () => {
  const input = { messages: [{ index: 0, role: 'user', content: 'Synthetic legacy.' }] };
  const bodies = []; const model = createOpenAIModel({ apiKey: 'synthetic', fetchImpl: async (_url, options) => {
    bodies.push(options.body); throw new Error('synthetic stop');
  } });
  await assert.rejects(model.extract(request(input)), /openai_request_failed/);
  assert.equal(createHash('sha256').update(bodies[0]).digest('hex'),
    '572ea5375fe154584aad4767e498cdf8e3bdac0ce4c0860464e3aefc56e01c84');
  const body = JSON.parse(bodies[0]);
  assert.equal(JSON.parse(body.input[0].content[0].text).messages[0].content, 'Synthetic legacy.');
  assert.equal(body.text.format.schema.properties.items.items.properties.sourceIndices.items.maximum, 0);
  const inherited = Object.assign(Object.create({ inputMode: 'indexed-windows-v1' }), input);
  await assert.rejects(model.extract(request(inherited)), /openai_request_failed/);
  assert.equal(bodies[1], bodies[0]);
});

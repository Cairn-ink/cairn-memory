import assert from 'node:assert/strict';
import test, { after, mock } from 'node:test';
import { createOpenAIModel } from '../index.mjs';
import { createBudgetedFetch } from '../live-harness.mjs';
import { schemas, schemasFor } from '../schemas.mjs';
import { DEFAULT_MODEL, EXPERIMENTAL_EXTRACTION_MODEL, LUNA_EXTRACTION_MODEL } from '../profiles.mjs';

const native = mock.method(globalThis, 'fetch', () => assert.fail('Native network is forbidden'));
after(() => native.mock.restore());
const input = () => ({ items: [
  { itemIndex: 0, content: 'I choose the violet tram 🚋.', kind: 'decision',
    sources: [{ receiptIndex: 0, role: 'user', excerpt: 'I choose the violet tram 🚋.' },
      { receiptIndex: 1, role: 'assistant', excerpt: 'A suggestion, not adoption.' }] },
  { itemIndex: 1, content: '我正在考慮週五。', kind: 'context',
    sources: [{ receiptIndex: 0, role: 'user', excerpt: '我正在考慮週五。' }] },
] });
const qualification = text => ({ version: 1,
  slot: { subject: null, property: null, scope: null, applies: null }, value: null,
  attribution: 'unknown', commitment: 'unknown',
  anchors: [{ receiptIndex: 0, start: 0, end: text.length, text, fields: ['value'] }] });
const output = () => ({ qualifications: input().items.map(item => ({ itemIndex: item.itemIndex,
  qualification: qualification(item.sources[0].excerpt) })) });
const request = (value = input()) => ({ system: 'Bind bounded source evidence without inferring authorization.',
  input: value, maxOutputTokens: 1024, signal: new AbortController().signal });
const json = value => new Response(JSON.stringify(value));
function envelope(payload, result = output()) {
  return { object: 'response', model: payload.model, status: 'completed', error: null,
    incomplete_details: null, output: [{ type: 'message', role: 'assistant', status: 'completed',
      content: [{ type: 'output_text', text: JSON.stringify(result) }] }],
    usage: { input_tokens: 120, output_tokens: 80, total_tokens: 200 } };
}
function transport(calls, generate = envelope, tokens = 120) {
  return async (url, options) => {
    const payload = JSON.parse(options.body); calls.push({ url, options, payload });
    assert.ok(calls.length <= 2, 'No qualification retry or fallback');
    return url.endsWith('/input_tokens') ? json({ object: 'response.input_tokens', input_tokens: tokens })
      : json(generate(payload));
  };
}
// Schema vocabulary recognizer only: exact quoting, coverage and item uniqueness
// remain core checks. This is not a provider or semantic correctness simulation.
function accepts(schema, value) {
  if (schema.anyOf) return schema.anyOf.some(child => accepts(child, value));
  if (schema.enum && !schema.enum.includes(value)) return false;
  if (Array.isArray(schema.type) && value === null) return schema.type.includes('null');
  if (schema.type === 'object') return value !== null && typeof value === 'object' && !Array.isArray(value) &&
    schema.required.every(key => Object.hasOwn(value, key)) &&
    Object.keys(value).every(key => Object.hasOwn(schema.properties, key) && accepts(schema.properties[key], value[key]));
  if (schema.type === 'array') return Array.isArray(value) && value.length <= schema.maxItems &&
    (schema.minItems === undefined || value.length >= schema.minItems) && value.every(child => accepts(schema.items, child));
  if (schema.type === 'integer') return Number.isSafeInteger(value) &&
    (schema.minimum === undefined || value >= schema.minimum) && (schema.maximum === undefined || value <= schema.maximum);
  return typeof value === 'string' && (schema.minLength === undefined || value.length >= schema.minLength) &&
    (schema.maxLength === undefined || value.length <= schema.maxLength);
}

test('qualification uses identical bounded baseline count/generate framing for every extraction profile', async () => {
  const bodies = [];
  for (const extractionModel of [DEFAULT_MODEL, EXPERIMENTAL_EXTRACTION_MODEL, LUNA_EXTRACTION_MODEL]) {
    const calls = []; const req = request();
    const model = createOpenAIModel({ apiKey: 'synthetic', extractionModel, fetchImpl: transport(calls) });
    assert.deepEqual(await model.qualify(req), output());
    assert.deepEqual(calls.map(call => call.url), ['https://api.openai.com/v1/responses/input_tokens',
      'https://api.openai.com/v1/responses']);
    for (const { payload, options } of calls) {
      assert.equal(payload.model, DEFAULT_MODEL); assert.equal(payload.reasoning, undefined);
      assert.equal(payload.text.format.name, 'cairn_qualify'); assert.equal(payload.text.format.strict, true);
      assert.equal(payload.text.format.type, 'json_schema'); assert.equal(payload.truncation, 'disabled');
      assert.equal(options.signal, req.signal); assert.equal(options.redirect, 'error');
      assert.deepEqual(options.headers, { Authorization: 'Bearer synthetic', 'Content-Type': 'application/json' });
      assert.deepEqual(JSON.parse(payload.input[0].content[0].text), req.input);
    }
    const { max_output_tokens, store, stream, ...projection } = calls[1].payload;
    assert.deepEqual(projection, calls[0].payload);
    assert.equal(max_output_tokens, 1024); assert.equal(store, false); assert.equal(stream, false);
    bodies.push(calls.map(call => call.payload));
  }
  assert.deepEqual(bodies[0], bodies[1]); assert.deepEqual(bodies[0], bodies[2]);
});

test('dynamic qualification schema requires complete nullable S1 data and per-item source indices', () => {
  assert.equal(Object.hasOwn(schemas, 'qualify'), false);
  const schema = schemasFor('qualify', input());
  assert.equal(accepts(schema, output()), true);
  const variants = schema.properties.qualifications.items.anyOf;
  assert.deepEqual(variants[0].properties.itemIndex.enum, [0]);
  assert.deepEqual(variants[0].properties.qualification.properties.anchors.items.properties.receiptIndex.enum, [0, 1]);
  assert.deepEqual(variants[1].properties.qualification.properties.anchors.items.properties.receiptIndex.enum, [0]);
  const visit = value => {
    if (!value || typeof value !== 'object') return;
    if (value.type === 'object') {
      assert.equal(value.additionalProperties, false);
      assert.deepEqual(value.required, Object.keys(value.properties));
    }
    Object.values(value).forEach(visit);
  };
  visit(schema);
  for (const mutate of [
    value => { value.qualifications.pop(); },
    value => { value.qualifications.push(value.qualifications[0]); },
    value => { value.qualifications[0].itemIndex = 2; },
    value => { value.qualifications[1].qualification.anchors[0].receiptIndex = 1; },
    value => { value.qualifications[0].qualification = null; },
    value => { delete value.qualifications[0].qualification.value; },
    value => { value.qualifications[0].qualification.trusted = true; },
    value => { value.qualifications[0].qualification.slot.subject = ''; },
    value => { value.qualifications[0].qualification.commitment = 'authorized'; },
  ]) { const value = output(); mutate(value); assert.equal(accepts(schema, value), false); }
  const duplicate = output(); duplicate.qualifications[1] = duplicate.qualifications[0];
  assert.equal(accepts(schema, duplicate), true, 'Core must enforce unique complete item coverage');
});

test('malformed qualification snapshots and local overflow fail before HTTP', async () => {
  for (const mutate of [
    value => { value.items = []; },
    value => { value.items.push(value.items[0]); },
    value => { value.items = Array.from({ length: 6 }, (_, itemIndex) => ({ ...value.items[0], itemIndex })); },
    value => { value.items[0].sources = []; },
    value => { value.items[0].sources.push(value.items[0].sources[0]); },
    value => { value.items[0].sources = Array.from({ length: 5 }, (_, receiptIndex) => ({ receiptIndex })); },
  ]) {
    const value = input(); mutate(value); const calls = [];
    const model = createOpenAIModel({ apiKey: 'synthetic', fetchImpl: transport(calls) });
    await assert.rejects(model.qualify(request(value)), /invalid_openai_request/); assert.equal(calls.length, 0);
  }
  const calls = []; const model = createOpenAIModel({ apiKey: 'synthetic', fetchImpl: transport(calls) });
  await assert.rejects(model.qualify({ ...request(), system: 'large '.repeat(10000) }),
    error => error.code === 'context_budget_exceeded'); assert.equal(calls.length, 0);
});

test('qualification count overflow and incomplete output fail without retry or fallback', async () => {
  const counted = [];
  const bounded = createOpenAIModel({ apiKey: 'synthetic', fetchImpl: transport(counted, envelope, 7025) });
  await assert.rejects(bounded.qualify(request()), error => error.code === 'context_budget_exceeded');
  assert.equal(counted.length, 1);
  const calls = [];
  const model = createOpenAIModel({ apiKey: 'synthetic', fetchImpl: transport(calls, payload => ({
    ...envelope(payload), status: 'incomplete', incomplete_details: { reason: 'max_output_tokens' } })) });
  await assert.rejects(model.qualify(request()), error => error.code === 'invalid_model_output');
  assert.equal(calls.length, 2);
});

test('existing paid guard still rejects qualification before network or reservation', async () => {
  const calls = []; const model = createOpenAIModel({ apiKey: 'synthetic', fetchImpl: transport(calls) });
  await model.qualify(request());
  const guard = createBudgetedFetch({ budgetUsd: 0.1, fetchImpl: () => assert.fail('No guarded I/O') });
  await assert.rejects(guard.fetchImpl(calls[0].url, calls[0].options), /request_rejected/);
  assert.equal(guard.snapshot().requestCount, 0); assert.equal(guard.snapshot().reservedUnits, 0);
});

import assert from 'node:assert/strict';
import test from 'node:test';
import { createOpenAIModel } from '../index.mjs';
import { DEFAULT_MODEL, LUNA_EXTRACTION_MODEL, EXPERIMENTAL_EXTRACTION_MODEL } from '../profiles.mjs';
import { schemas, schemasFor } from '../schemas.mjs';

const fields = ['subject', 'property', 'scope', 'applies', 'value', 'attribution', 'commitment'];
const input = () => ({ items: [
  { itemIndex: 0, content: 'A preference', kind: 'preference', candidates: [{ candidateIndex: 0, role: 'user', text: 'A source' },
    { candidateIndex: 1, role: 'assistant', text: 'A suggestion' }] },
  { itemIndex: 1, content: 'Another preference', kind: 'preference', candidates: [{ candidateIndex: 2, role: 'user', text: 'Another source' }] },
] });
const output = () => ({ qualifications: input().items.map((item) => ({ itemIndex: item.itemIndex,
  ...Object.fromEntries(fields.map((field) => [field, { value: ['attribution', 'commitment'].includes(field) ? 'unknown' : null,
    evidenceIndices: field === 'value' ? [item.candidates[0].candidateIndex] : [] }])) })) });
const request = (value = input()) => ({ system: 'Select source candidates; do not calculate offsets.', input: value,
  maxOutputTokens: 1024, signal: new AbortController().signal });
function envelope(model, result = output()) {
  return { object: 'response', model, status: 'completed', error: null, incomplete_details: null,
    output: [{ type: 'message', role: 'assistant', status: 'completed', content: [{ type: 'output_text', text: JSON.stringify(result) }] }],
    usage: { input_tokens: 120, output_tokens: 80, total_tokens: 200 } };
}
function accepts(schema, value) {
  if (schema.anyOf) return schema.anyOf.some((child) => accepts(child, value));
  if (schema.enum && !schema.enum.includes(value)) return false;
  if (schema.type === 'null') return value === null;
  if (schema.type === 'object') return value !== null && typeof value === 'object' && !Array.isArray(value)
    && schema.required.every((key) => Object.hasOwn(value, key))
    && Object.keys(value).every((key) => Object.hasOwn(schema.properties, key) && accepts(schema.properties[key], value[key]));
  if (schema.type === 'array') return Array.isArray(value) && value.length >= (schema.minItems ?? 0)
    && value.length <= schema.maxItems && value.every((child) => accepts(schema.items, child));
  if (schema.type === 'integer') return Number.isSafeInteger(value) && value >= (schema.minimum ?? 0);
  return typeof value === 'string' && value.length >= (schema.minLength ?? 0) && value.length <= (schema.maxLength ?? Infinity);
}

test('candidate qualification uses identical count/generate baseline model framing across extraction profiles', async () => {
  const bodies = [];
  for (const extractionModel of [DEFAULT_MODEL, LUNA_EXTRACTION_MODEL, EXPERIMENTAL_EXTRACTION_MODEL]) {
    const calls = []; const model = createOpenAIModel({ apiKey: 'synthetic', extractionModel,
      fetchImpl: async (url, options) => { const body = JSON.parse(options.body); calls.push({ url, body });
        return Response.json(url.endsWith('/input_tokens') ? { object: 'response.input_tokens', input_tokens: 120 } : envelope(body.model)); } });
    assert.deepEqual(await model.qualifyCandidates(request()), output()); assert.equal(calls.length, 2);
    assert.deepEqual(calls.map((call) => call.url), ['https://api.openai.com/v1/responses/input_tokens', 'https://api.openai.com/v1/responses']);
    for (const call of calls) {
      assert.equal(call.body.model, DEFAULT_MODEL); assert.equal(call.body.text.format.name, 'cairn_qualifyCandidates');
      assert.equal(call.body.reasoning, undefined); assert.equal(call.body.text.format.strict, true);
      assert.deepEqual(JSON.parse(call.body.input[0].content[0].text), input());
    }
    const { max_output_tokens, store, stream, ...count } = calls[1].body;
    assert.equal(max_output_tokens, 1024); assert.equal(store, false); assert.equal(stream, false);
    assert.deepEqual(count, calls[0].body); bodies.push(calls.map((call) => call.body));
  }
  assert.deepEqual(bodies[0], bodies[1]); assert.deepEqual(bodies[0], bodies[2]);
});

test('dynamic candidate schema requires same-item candidate indices and known-value evidence without weakening legacy schemas', () => {
  assert.equal(Object.hasOwn(schemas, 'qualifyCandidates'), false);
  const schema = schemasFor('qualifyCandidates', input()); assert.equal(accepts(schema, output()), true);
  const variants = schema.properties.qualifications.items.anyOf;
  assert.deepEqual(variants[0].properties.subject.anyOf[0].properties.evidenceIndices.items.enum, [0, 1]);
  assert.deepEqual(variants[1].properties.subject.anyOf[0].properties.evidenceIndices.items.enum, [2]);
  const visit = (node) => { if (!node || typeof node !== 'object') return;
    if (node.type === 'object') { assert.equal(node.additionalProperties, false); assert.deepEqual(node.required, Object.keys(node.properties)); }
    Object.values(node).forEach(visit);
  }; visit(schema);
  for (const mutate of [
    (v) => { v.qualifications.pop(); }, (v) => { v.extra = true; },
    (v) => { v.qualifications[0].subject = { value: 'Known', evidenceIndices: [] }; },
    (v) => { v.qualifications[0].subject.evidenceIndices = [2]; },
    (v) => { v.qualifications[0].value.evidenceIndices = [0, 0, 0, 0, 0]; },
    (v) => { v.qualifications[0].attribution.value = 'authorized'; },
    (v) => { v.qualifications[0].scope = { value: 'x'.repeat(121), evidenceIndices: [0] }; },
    (v) => { v.qualifications[0].anchors = []; }, (v) => { delete v.qualifications[0].value; },
  ]) { const value = output(); mutate(value); assert.equal(accepts(schema, value), false); }
  const duplicate = output(); duplicate.qualifications[1] = duplicate.qualifications[0];
  assert.equal(accepts(schema, duplicate), true, 'Unique item coverage remains a core check');
});

test('malformed candidate snapshots and local bounds reject before any HTTP', async () => {
  for (const mutate of [(v) => { v.items = []; }, (v) => { v.items = Array(1); },
    (v) => { v.items[0].candidates = Array(1); }, (v) => { v.items[0].candidates = []; },
    (v) => { v.items[1].candidates[0].candidateIndex = 0; }, (v) => { v.items[1].itemIndex = 0; },
    (v) => { v.items[0].candidates[0].candidateIndex = -1; },
    (v) => { v.items[0].content = ' word'.repeat(8000); }]) {
    const value = input(); mutate(value); let calls = 0;
    const model = createOpenAIModel({ apiKey: 'synthetic', fetchImpl: () => { calls++; assert.fail('No network'); } });
    await assert.rejects(model.qualifyCandidates(request(value))); assert.equal(calls, 0);
  }
});

test('candidate adapter remote token ceiling, malformed JSON and cancellation use bounded new-stage diagnostics', async () => {
  for (const mode of ['tokens', 'json', 'cancel']) {
    const events = []; let calls = 0;
    const model = createOpenAIModel({ apiKey: 'synthetic', onDiagnostic: (event) => events.push(event), fetchImpl: async (url) => {
      calls++;
      if (mode === 'cancel') throw Object.assign(new Error('synthetic-private-error'), { name: 'AbortError' });
      if (url.endsWith('/input_tokens')) return Response.json({ object: 'response.input_tokens', input_tokens: mode === 'tokens' ? 7025 : 120 });
      const response = envelope(DEFAULT_MODEL); response.output[0].content[0].text = '{malformed'; return Response.json(response);
    } });
    await assert.rejects(model.qualifyCandidates(request())); assert.equal(calls, mode === 'json' ? 2 : 1);
    assert.ok(events.length > 0); assert.ok(events.every((event) => event.stage === 'qualifyCandidates'));
    assert.ok(!JSON.stringify(events).includes('synthetic-private-error'));
    if (mode === 'json') assert.ok(events.some((event) => event.reason === 'output_json'));
  }
});

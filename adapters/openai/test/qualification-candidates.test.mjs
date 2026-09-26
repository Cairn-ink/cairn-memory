import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { createOpenAIModel } from '../index.mjs';
import { DEFAULT_MODEL, LUNA_EXTRACTION_MODEL, EXPERIMENTAL_EXTRACTION_MODEL } from '../profiles.mjs';
import { qualificationCandidatesInlineSchema, schemas, schemasFor } from '../schemas.mjs';
import { openMemoryCore } from '../../../core/contract.mjs';

const fields = ['subject', 'property', 'scope', 'applies', 'value', 'attribution', 'commitment'];
const input = () => ({ items: [
  { itemIndex: 0, content: 'A preference', kind: 'preference', candidates: [{ candidateIndex: 0, role: 'user', text: 'A source' },
    { candidateIndex: 1, role: 'assistant', text: 'A suggestion' }] },
  { itemIndex: 1, content: 'Another preference', kind: 'preference', candidates: [{ candidateIndex: 2, role: 'user', text: 'Another source' }] },
] });
const output = () => ({ qualifications: input().items.map((item) => ({ itemIndex: item.itemIndex,
  ...Object.fromEntries(fields.map((field) => [field, { value: ['attribution', 'commitment'].includes(field) ? 'unknown' : null,
    evidenceIndices: field === 'value' ? [item.candidates[0].candidateIndex] : [] }])) })) });
const wire = (value = output()) => ({ qualifications: Object.fromEntries(
  value.qualifications.map(item => [`item_${item.itemIndex}`, item])) });
const request = (value = input()) => ({ system: 'Select source candidates; do not calculate offsets.', input: value,
  maxOutputTokens: 1024, signal: new AbortController().signal });
function envelope(model, result = wire()) {
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
      assert.ok(call.body.instructions.startsWith(request().system + '\n\nProvider wire-format override:'));
      assert.match(call.body.instructions, /item_0=>itemIndex 0, item_1=>itemIndex 1/);
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
  const schema = qualificationCandidatesInlineSchema(input()); assert.equal(accepts(schema, wire()), true);
  const slots = schema.properties.qualifications.properties;
  assert.deepEqual(slots.item_0.properties.subject.anyOf[0].properties.evidenceIndices.items.enum, [0, 1]);
  assert.deepEqual(slots.item_1.properties.subject.anyOf[0].properties.evidenceIndices.items.enum, [2]);
  const visit = (node) => { if (!node || typeof node !== 'object') return;
    if (node.type === 'object') { assert.equal(node.additionalProperties, false); assert.deepEqual(node.required, Object.keys(node.properties)); }
    Object.values(node).forEach(visit);
  }; visit(schema);
  for (const mutate of [
    (v) => { delete v.qualifications.item_1; }, (v) => { v.qualifications.item_2 = v.qualifications.item_1; },
    (v) => { v.extra = true; },
    (v) => { v.qualifications.item_0.subject = { value: 'Known', evidenceIndices: [] }; },
    (v) => { v.qualifications.item_0.subject.evidenceIndices = [2]; },
    (v) => { v.qualifications.item_0.value.evidenceIndices = [0, 0, 0, 0, 0]; },
    (v) => { v.qualifications.item_0.attribution.value = 'authorized'; },
    (v) => { v.qualifications.item_0.scope = { value: 'x'.repeat(121), evidenceIndices: [0] }; },
    (v) => { v.qualifications.item_0.anchors = []; }, (v) => { delete v.qualifications.item_0.value; },
    (v) => { v.qualifications.item_1.itemIndex = 0; },
  ]) { const value = wire(); mutate(value); assert.equal(accepts(schema, value), false); }
  const duplicate = output(); duplicate.qualifications[1] = duplicate.qualifications[0];
  assert.equal(accepts(schema, duplicate), false, 'Provider schema must require unique complete item coverage');
});

test('compact qualification wire schema expands to frozen original inline schemas', () => {
  const ids = [0, 3, 7, 11, 19];
  const groups = [[2], [13, 17], [20, 27, 31], [40, 45, 51, 59], [80]];
  // Literal digests were measured from schemasFor on the fixed pre-repair base,
  // independently of the new inline builder and reference expansion.
  const originalSha256 = [
    'b70271382ced8c013faa6920b5b05f618cf87fad2cec8cc8f4ec31c3bbfbdc28',
    '9fd3fac08aea024f79b83c4c55f99cbb997323047897ee380f900708af52c4a5',
    '317d3afe781f0c540b114a88d9f7c2bdf706a471d24cc7c36636991dee30d91c',
    'd83e9a1de9b27bf1a70ac4475742f0d932ac33a1da30510899d7dbb1413e1ed8',
    '408a2a8ad9293f7f37d47e417f150d63330e002935a510432b71f8a46598f4c4',
  ];
  for (let count = 1; count <= 5; count++) {
    const data = { items: ids.slice(0, count).map((itemIndex, position) => ({ itemIndex,
      candidates: groups[position].map(candidateIndex => ({ candidateIndex })) })) };
    const wireSchema = schemasFor('qualifyCandidates', data);
    const definitions = wireSchema.$defs;
    const expand = (node) => {
      if (Array.isArray(node)) return node.map(expand);
      if (node === null || typeof node !== 'object') return node;
      if (Object.hasOwn(node, '$ref')) {
        assert.deepEqual(Object.keys(node), ['$ref']);
        assert.match(node.$ref, /^#\/\$defs\/q[0-4]_text(?:120|160)$/u);
        const key = node.$ref.slice('#/$defs/'.length);
        assert.ok(Object.hasOwn(definitions, key));
        return expand(definitions[key]);
      }
      return Object.fromEntries(Object.entries(node).filter(([key]) => key !== '$defs')
        .map(([key, value]) => [key, expand(value)]));
    };
    const expanded = expand(wireSchema);
    const digest = createHash('sha256').update(JSON.stringify(expanded)).digest('hex');
    assert.equal(digest, originalSha256[count - 1], `original inline schema for ${count} items`);
    assert.deepEqual(expanded, qualificationCandidatesInlineSchema(data));
  }
});

test('candidate qualification normalizes reordered named slots and rejects invalid mappings without retry', async () => {
  const reversed = wire(); reversed.qualifications = Object.fromEntries(Object.entries(reversed.qualifications).reverse());
  const reorderedCalls = []; const reordered = createOpenAIModel({ apiKey: 'synthetic',
    fetchImpl: async (url, options) => { const body = JSON.parse(options.body); reorderedCalls.push(body);
      return Response.json(url.endsWith('/input_tokens')
        ? { object: 'response.input_tokens', input_tokens: 120 } : envelope(body.model, reversed)); } });
  assert.deepEqual(await reordered.qualifyCandidates(request()), output()); assert.equal(reorderedCalls.length, 2);

  for (const result of [output(), (() => { const value = output(); value.qualifications[1] = value.qualifications[0]; return value; })(),
    (() => { const value = wire(); delete value.qualifications.item_1; return value; })(),
    (() => { const value = wire(); value.qualifications.extra = value.qualifications.item_1; return value; })(),
    (() => { const value = wire(); value.qualifications.item_1.itemIndex = 0; return value; })(),
    (() => { const value = wire(); value.qualifications.item_0.subject.evidenceIndices = [2]; return value; })(),
    (() => { const value = wire(); value.qualifications.item_0.attribution.value = 'authorized'; return value; })(),
    (() => { const value = wire(); delete value.qualifications.item_0.value; return value; })(),
    (() => { const value = wire(); value.qualifications.item_0.extra = true; return value; })()]) {
    let calls = 0; const model = createOpenAIModel({ apiKey: 'synthetic', fetchImpl: async (url, options) => {
      calls++; const body = JSON.parse(options.body); return Response.json(url.endsWith('/input_tokens')
        ? { object: 'response.input_tokens', input_tokens: 120 } : envelope(body.model, result)); } });
    await assert.rejects(model.qualifyCandidates(request()), error => error.code === 'invalid_model_output');
    assert.equal(calls, 2, 'No retry or fallback');
  }
});

test('source-bound capture admits normalized slots and exact replay stays offline while changed replay rejects', async (t) => {
  const calls = []; const model = createOpenAIModel({ apiKey: 'synthetic', fetchImpl: async (url, options) => {
    const body = JSON.parse(options.body); calls.push({ url, body });
    if (url.endsWith('/input_tokens')) return Response.json({ object: 'response.input_tokens', input_tokens: 120 });
    const value = JSON.parse(body.input[0].content[0].text); let result;
    if (body.text.format.name === 'cairn_extract') result = { items: [{ content: value.messages[0].content,
      kind: 'preference', confidence: 0.9, sourceIndices: [0] }] };
    else if (body.text.format.name === 'cairn_qualifyCandidates') {
      result = { qualifications: Object.fromEntries(value.items.map(item => [`item_${item.itemIndex}`, {
        itemIndex: item.itemIndex, ...Object.fromEntries(fields.map(field => [field, {
          value: field === 'value' ? item.content : field === 'attribution' ? 'direct'
            : field === 'commitment' ? 'adopted' : null,
          evidenceIndices: ['value', 'attribution', 'commitment'].includes(field)
            ? [item.candidates[0].candidateIndex] : [],
        }])) }])) };
    } else if (body.text.format.name === 'cairn_classify') {
      result = { items: value.memories.map(memory => ({ memoryId: memory.id, parentIds: [] })) };
    } else assert.fail(`Unexpected method ${body.text.format.name}`);
    return Response.json(envelope(body.model, result));
  } });
  const path = join(mkdtempSync(join(tmpdir(), 'cairn-qualification-slots-')), 'memory.sqlite');
  const core = openMemoryCore({ path, model, captureQualification: 'source-bound-v2' }); t.after(() => core.close());
  const capture = { namespace: { ownerId: 'slot-test', scope: 'personal', projectId: null },
    client: 'synthetic', sessionId: 'session', eventId: 'batch',
    messages: [{ id: 'source', role: 'user', content: 'I prefer the Harbor tram.' }] };
  const first = await core.capture(capture); assert.equal(first.ok, true, JSON.stringify(first));
  const memoryId = first.value.admission.memories[0].id;
  const detail = core.get({ namespace: capture.namespace, memoryId, includeQualification: true });
  assert.equal(detail.ok, true); assert.equal(detail.value.qualification.value, capture.messages[0].content);
  assert.deepEqual(calls.filter(call => !call.url.endsWith('/input_tokens')).map(call => call.body.text.format.name),
    ['cairn_extract', 'cairn_qualifyCandidates', 'cairn_classify']);
  const beforeReplay = calls.length;
  const duplicate = await core.capture(capture); assert.equal(duplicate.ok, true); assert.equal(duplicate.value.duplicate, true);
  const conflict = await core.capture({ ...capture,
    messages: [{ ...capture.messages[0], content: 'I prefer the Juniper ferry.' }] });
  assert.deepEqual(conflict, { ok: false, error: { code: 'event_payload_conflict', retryable: false } });
  assert.equal(calls.length, beforeReplay);
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

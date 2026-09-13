import assert from 'node:assert/strict';
import test, { after, mock } from 'node:test';
import { createOpenAIModel } from '../index.mjs';
import { createBudgetedFetch } from '../live-harness.mjs';
import { DEFAULT_MODEL, EXPERIMENTAL_EXTRACTION_MODEL, LUNA_EXTRACTION_MODEL,
  modelProfile } from '../profiles.mjs';

const native = mock.method(globalThis, 'fetch', () => assert.fail('Native network is forbidden'));
after(() => native.mock.restore());

const input = () => ({
  messages: [
    { index: 2, role: 'user', content: 'The schedule was Friday.' },
    { index: 7, role: 'assistant', content: 'I can update that.' },
    { index: 11, role: 'user', content: 'Confirmed: Monday replaces Friday.' },
  ],
  items: [
    { index: 4, content: 'The schedule is Friday.', kind: 'fact', sourceIndices: [2] },
    { index: 9, content: 'The schedule is Monday.', kind: 'fact', sourceIndices: [11] },
  ],
  candidates: [
    { index: 3, content: 'The schedule is Friday.', kind: 'fact',
      receipts: [{ role: 'user', excerpt: 'The schedule was Friday.' }] },
    { index: 8, content: 'The room is Juniper.', kind: 'fact',
      receipts: [{ role: 'user', excerpt: 'Use Juniper.' }] },
    { index: 12, content: 'The format is concise.', kind: 'preference', receipts: [] },
  ],
});
const request = (value = input()) => ({ system: 'Judge only explicit user-adopted changes.', input: value,
  maxOutputTokens: 1024, signal: new AbortController().signal });
const verdict = { relation: 'supersedes', valueChange: 'changed', adoption: 'explicit' };
const result = { transitions: [{ ...verdict, replacementIndex: 9, predecessorIndex: 3, evidenceIndices: [11] }] };
const json = (value) => new Response(JSON.stringify(value));
function envelope(payload, value = result, changes = {}) {
  return { object: 'response', model: payload.model, status: 'completed', error: null,
    incomplete_details: null, output: [{ type: 'message', role: 'assistant', status: 'completed',
      content: [{ type: 'output_text', text: JSON.stringify(value) }] }],
    usage: { input_tokens: 120, output_tokens: 20, total_tokens: 140 }, ...changes };
}
function transport(calls, generation = (payload) => envelope(payload)) {
  return async (url, options) => {
    const payload = JSON.parse(options.body);
    calls.push({ url, options, payload });
    assert.ok(calls.length <= 2, 'Reconciliation must not retry or fall back');
    return url.endsWith('/input_tokens')
      ? json({ object: 'response.input_tokens', input_tokens: 120 })
      : json(generation(payload));
  };
}

// Minimal recognizer for the emitted schema vocabulary. Correlated semantic
// checks intentionally remain in core and are not simulated here.
function accepts(schema, value) {
  if (schema.enum && !schema.enum.includes(value)) return false;
  if (schema.type === 'object') {
    if (value === null || typeof value !== 'object' || Array.isArray(value)) return false;
    if (schema.required.some((key) => !Object.hasOwn(value, key))) return false;
    if (schema.additionalProperties === false &&
        Object.keys(value).some((key) => !Object.hasOwn(schema.properties, key))) return false;
    return Object.entries(value).every(([key, child]) => accepts(schema.properties[key], child));
  }
  if (schema.type === 'array') return Array.isArray(value) &&
    (schema.minItems === undefined || value.length >= schema.minItems) &&
    (schema.maxItems === undefined || value.length <= schema.maxItems) &&
    value.every((child) => accepts(schema.items, child));
  if (schema.type === 'integer') return Number.isInteger(value) &&
    (schema.minimum === undefined || value >= schema.minimum);
  return true;
}

test('ordered reconciliation uses baseline strict structured output for every extraction profile', async () => {
  const bodies = [];
  for (const extractionModel of [DEFAULT_MODEL, EXPERIMENTAL_EXTRACTION_MODEL, LUNA_EXTRACTION_MODEL]) {
    const calls = [];
    const model = createOpenAIModel({ apiKey: 'synthetic', extractionModel, fetchImpl: transport(calls) });
    const req = request();
    assert.ok(model.countTokens(JSON.stringify(req.input)) > 0, 'Use the actual pinned tokenizer');
    assert.deepEqual(await model.reconcile(req), result);
    assert.deepEqual(calls.map(({ url }) => url), [
      'https://api.openai.com/v1/responses/input_tokens',
      'https://api.openai.com/v1/responses',
    ]);
    for (const { options, payload } of calls) {
      assert.equal(options.signal, req.signal);
      assert.equal(payload.model, DEFAULT_MODEL);
      assert.equal(payload.reasoning, undefined);
      assert.equal(payload.text.format.name, 'cairn_reconcile');
      assert.equal(payload.text.format.type, 'json_schema');
      assert.equal(payload.text.format.strict, true);
      assert.equal(payload.truncation, 'disabled');
    }
    const { max_output_tokens, store, stream, ...generationProjection } = calls[1].payload;
    assert.deepEqual(generationProjection, calls[0].payload);
    assert.equal(max_output_tokens, 1024); assert.equal(store, false); assert.equal(stream, false);
    bodies.push(calls.map(({ payload }) => payload));
  }
  assert.deepEqual(bodies[1], bodies[0]);
  assert.deepEqual(bodies[2], bodies[0]);
  assert.equal(modelProfile(EXPERIMENTAL_EXTRACTION_MODEL).reconcile.model, DEFAULT_MODEL);
  assert.equal(modelProfile(LUNA_EXTRACTION_MODEL).reconcile.model, DEFAULT_MODEL);
  assert.equal(Object.isFrozen(modelProfile(DEFAULT_MODEL).reconcile), true);
});

test('reconciliation schema constrains every output index to the request snapshot', async () => {
  const calls = [];
  const model = createOpenAIModel({ apiKey: 'synthetic', fetchImpl: transport(calls) });
  await model.reconcile(request());
  const schema = calls[0].payload.text.format.schema;
  const transition = schema.properties.transitions.items;
  assert.equal(schema.additionalProperties, false);
  assert.deepEqual(Object.keys(transition.properties).sort(),
    ['adoption', 'evidenceIndices', 'predecessorIndex', 'relation', 'replacementIndex', 'valueChange']);
  assert.deepEqual(transition.properties.replacementIndex.enum, [4, 9]);
  assert.deepEqual(transition.properties.predecessorIndex.enum, [3, 8, 12]);
  assert.deepEqual(transition.properties.evidenceIndices.items.enum, [2, 7, 11]);
  assert.equal(schema.properties.transitions.maxItems, 3);
  assert.equal(transition.properties.evidenceIndices.minItems, 1);
  assert.equal(transition.properties.evidenceIndices.maxItems, 3);
  assert.equal(accepts(schema, result), true);
  assert.equal(accepts(schema, { transitions: [] }), true);
  for (const forged of [
    { transitions: [{ ...verdict, replacementIndex: 10, predecessorIndex: 3, evidenceIndices: [11] }] },
    { transitions: [{ ...verdict, replacementIndex: 9, predecessorIndex: 4, evidenceIndices: [11] }] },
    { transitions: [{ ...verdict, replacementIndex: 9, predecessorIndex: 3, evidenceIndices: [10] }] },
    { transitions: [{ replacementIndex: 9, predecessorIndex: 3, evidenceIndices: [11] }] },
    ...['relation', 'valueChange', 'adoption'].map((key) => ({ transitions: [{ ...result.transitions[0], [key]: 'invented' }] })),
    { transitions: [{ ...result.transitions[0], operation: 'supersede' }] },
    { transitions: Array.from({ length: 4 }, () => result.transitions[0]) },
  ]) assert.equal(accepts(schema, forged), false, JSON.stringify(forged));
  // Index 11 exists in the snapshot but is not a source for replacement 4.
  // The schema permits it; core must enforce that correlated source subset.
  assert.equal(accepts(schema, { transitions: [{ ...verdict, replacementIndex: 4,
    predecessorIndex: 3, evidenceIndices: [11] }] }), true);
  for (const relation of ['reaffirms', 'historical_context', 'compatible', 'unresolved']) {
    assert.equal(accepts(schema, { transitions: [{ ...result.transitions[0], relation,
      valueChange: 'unknown', adoption: 'uncertain' }] }), true);
  }
  // The schema constrains vocabularies, not cross-field semantics. Core rejects
  // a supersession that is not an explicitly adopted changed value.
  assert.equal(accepts(schema, { transitions: [{ ...result.transitions[0],
    valueChange: 'unchanged' }] }), true);
});

test('five qualified judgments fit the existing output budget without extra HTTP calls', async () => {
  const value = input();
  value.candidates = Array.from({ length: 5 }, (_, index) => ({ ...value.candidates[0], index }));
  const full = { transitions: value.candidates.map(({ index }) => ({ ...result.transitions[0],
    predecessorIndex: index, evidenceIndices: [2, 7, 11] })) };
  const calls = [];
  const model = createOpenAIModel({ apiKey: 'synthetic',
    fetchImpl: transport(calls, (payload) => envelope(payload, full)) });
  assert.ok(model.countTokens(JSON.stringify(full)) <= 1024);
  assert.deepEqual(await model.reconcile(request(value)), full);
  assert.equal(accepts(calls[0].payload.text.format.schema, full), true);
  assert.equal(calls[1].payload.max_output_tokens, 1024);
  assert.equal(calls.length, 2);
});

test('malformed reconciliation snapshots fail before fake HTTP', async () => {
  const mutations = [
    (value) => value.messages.push({ ...value.messages[0] }),
    (value) => { value.messages = Array.from({ length: 25 }, (_, index) => ({ index })); },
    (value) => { value.items = Array.from({ length: 6 }, (_, index) => ({ index })); },
    (value) => { value.candidates = Array.from({ length: 13 }, (_, index) => ({ index })); },
  ];
  for (const mutate of mutations) {
    let calls = 0;
    const value = input(); mutate(value);
    const model = createOpenAIModel({ apiKey: 'synthetic', fetchImpl: () => { calls++; return json({}); } });
    await assert.rejects(model.reconcile(request(value)), /invalid_openai_request/);
    assert.equal(calls, 0);
  }
});

test('refusal and incomplete reconciliation fail closed without retry or fallback', async () => {
  const failures = [
    (payload) => envelope(payload, result, { status: 'incomplete',
      incomplete_details: { reason: 'max_output_tokens' } }),
    (payload) => { const value = envelope(payload); value.output[0].content =
      [{ type: 'refusal', refusal: 'Synthetic refusal' }]; return value; },
  ];
  for (const generation of failures) {
    const calls = [];
    const model = createOpenAIModel({ apiKey: 'synthetic', fetchImpl: transport(calls, generation) });
    await assert.rejects(model.reconcile(request()), (error) => error.code === 'invalid_model_output');
    assert.equal(calls.length, 2);
  }
});

test('existing live guard does not authorize reconcile traffic implicitly', async () => {
  const calls = [];
  const model = createOpenAIModel({ apiKey: 'synthetic', fetchImpl: transport(calls) });
  await model.reconcile(request());
  const captured = calls[0];
  const guard = createBudgetedFetch({ budgetUsd: 0.1, fetchImpl: () => assert.fail('No guarded I/O') });
  await assert.rejects(guard.fetchImpl(captured.url, captured.options), /request_rejected/);
  assert.deepEqual(guard.snapshot(), {
    budgetUsd: 0.1, maxRequests: 40, requestCount: 0, reservedUnits: 0, reservedUsd: 0,
    observedInputTokens: 0, observedOutputTokens: 0, observedUsageEstimateUsd: 0,
    rejection: 'request_rejected', requests: [],
  });
});

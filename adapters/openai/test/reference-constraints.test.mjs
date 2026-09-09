import assert from 'node:assert/strict';
import test from 'node:test';
import { createOpenAIModel } from '../index.mjs';
import { createBudgetedFetch, runLiveLifecycle } from '../live-harness.mjs';

const request = (input) => ({ system: 'Synthetic reference constraints.', input,
  maxOutputTokens: 1024, signal: new AbortController().signal });
const emptyMap = () => ({ memories: [{ id: 'harbor', content: 'Harbor uses Go.', revision: 1 },
  { id: 'juniper', content: 'Juniper uses Python.', revision: 1 }],
  map: [{ type: 'unfiled', ref: { memoryId: 'harbor', revision: 1 } },
    { type: 'unfiled', ref: { memoryId: 'juniper', revision: 1 } }], mapExhausted: true });

// Small validator for the emitted schema vocabulary only; no network/dependency.
function accepts(schema, value) {
  if (schema.anyOf) return schema.anyOf.some((branch) => accepts(branch, value));
  if (schema.enum && !schema.enum.includes(value)) return false;
  if (schema.type === 'object') {
    if (value === null || typeof value !== 'object' || Array.isArray(value)) return false;
    if (schema.required?.some((key) => !Object.hasOwn(value, key))) return false;
    if (schema.additionalProperties === false && Object.keys(value).some((key) => !Object.hasOwn(schema.properties, key))) return false;
    return Object.entries(value).every(([key, child]) => !schema.properties[key] || accepts(schema.properties[key], child));
  }
  if (schema.type === 'array') return Array.isArray(value) &&
    (schema.minItems === undefined || value.length >= schema.minItems) &&
    (schema.maxItems === undefined || value.length <= schema.maxItems) && value.every((item) => accepts(schema.items, item));
  if (schema.type === 'string') return typeof value === 'string' &&
    (schema.maxLength === undefined || value.length <= schema.maxLength);
  if (schema.type === 'integer' || schema.type === 'number') return typeof value === 'number' &&
    Number.isFinite(value) && (schema.type !== 'integer' || Number.isInteger(value)) &&
    (schema.minimum === undefined || value >= schema.minimum) && (schema.maximum === undefined || value <= schema.maximum);
  assert.fail(`Unhandled schema type: ${schema.type}`);
}

async function outgoingSchema(method, input) {
  let schema;
  const model = createOpenAIModel({ apiKey: 'synthetic-reference-key', fetchImpl: async (_url, options) => {
    schema = JSON.parse(options.body).text.format.schema;
    throw new Error('synthetic-stop-before-network');
  } });
  await assert.rejects(model[method](request(input)));
  assert.ok(schema, 'Expected a preflight request');
  return schema;
}

test('R01 actual outgoing classify schema rejects observed invented group on an unfiled-only map', async () => {
  const schema = await outgoingSchema('classify', emptyMap());
  const fabricated = { items: [{ memoryId: 'harbor', parentIds: ['programming_languages'],
    newL1: { title: 'programming_languages', parentL2Ids: [] } }] };
  assert.equal(accepts(schema, fabricated), false,
    'A generated topic title is not an existing authorized group ID');
  assert.equal(schema.properties.items.items.anyOf[0].properties.parentIds.maxItems, 0);
});

test('empty group maps permit new titles but never invented L1 or L2 authority', async () => {
  const schema = await outgoingSchema('classify', emptyMap());
  const proposed = { items: [{ memoryId: 'harbor', parentIds: [],
    newL1: { title: 'Programming languages', parentL2Ids: [], newL2Title: 'Engineering' } }] };
  assert.equal(accepts(schema, proposed), true);
  for (const parent of ['Engineering', 'Programming languages', 'foreign-id']) {
    const wrong = structuredClone(proposed); wrong.items[0].newL1.parentL2Ids = [parent];
    assert.equal(accepts(schema, wrong), false);
  }
});

test('classify accepts only snapshot memories and visible groups of the correct level', async () => {
  const input = emptyMap();
  input.map.push({ type: 'moc', moc: { id: 'visible-l1', level: 'L1' } },
    { type: 'moc', moc: { id: 'visible-l2', level: 'L2' } });
  const schema = await outgoingSchema('classify', input);
  const good = { items: [{ memoryId: 'harbor', parentIds: ['visible-l1'],
    newL1: { title: 'New topic', parentL2Ids: ['visible-l2'] } }] };
  assert.equal(accepts(schema, good), true);
  for (const mutate of [
    (value) => { value.items[0].memoryId = 'foreign-memory'; },
    (value) => { value.items[0].parentIds = ['visible-l2']; },
    (value) => { value.items[0].parentIds = ['foreign-l1']; },
    (value) => { value.items[0].newL1.parentL2Ids = ['visible-l1']; },
    (value) => { value.items[0].newL1.parentL2Ids = ['foreign-l2']; },
    (value) => { value.items[0].ownerId = 'foreign-owner'; },
  ]) {
    const wrong = structuredClone(good); mutate(wrong);
    assert.equal(accepts(schema, wrong), false);
  }
});

test('empty classification snapshot permits only zero proposed placements', async () => {
  const schema = await outgoingSchema('classify', { memories: [], map: [], mapExhausted: true });
  assert.equal(accepts(schema, { items: [] }), true);
  assert.equal(accepts(schema, { items: [{ memoryId: 'invented', parentIds: [] }] }), false);
});

test('an incomplete classification map cannot propose new groups', async () => {
  const input = emptyMap(); input.mapExhausted = false;
  const schema = await outgoingSchema('classify', input);
  assert.equal(accepts(schema, { items: [{ memoryId: 'harbor', parentIds: [] }] }), true);
  assert.equal(accepts(schema, { items: [{ memoryId: 'harbor', parentIds: [],
    newL1: { title: 'Undiscovered topic', parentL2Ids: [] } }] }), false);
});

test('single project read set uses namespace index zero and excludes foreign memory IDs/revisions', async () => {
  const schema = await outgoingSchema('select', { query: 'Synthetic project query',
    maps: [{ namespaceIndex: 0, items: [
      { type: 'unfiled', ref: { memoryId: 'project-memory', revision: 2 } },
      { type: 'ref', ref: { childType: 'memory', childId: 'filed-memory', childRevision: 3 } },
      { type: 'ref', ref: { childType: 'L1', childId: 'topic-not-memory', childRevision: 4 } },
    ], exhausted: true }], maxRefs: 24 });
  for (const [memoryId, revision] of [['project-memory', 2], ['filed-memory', 3]]) {
    assert.equal(accepts(schema, { refs: [{ namespaceIndex: 0, memoryId, revision }] }), true);
  }
  for (const override of [{ namespaceIndex: 1 }, { memoryId: 'foreign-memory' },
    { memoryId: 'topic-not-memory' }, { revision: 99 }, { revision: 0 }]) {
    assert.equal(accepts(schema, { refs: [{ namespaceIndex: 0, memoryId: 'project-memory', revision: 2, ...override }] }), false);
  }
});

test('rank response IDs, revisions and namespace indices are limited to supplied candidates', async () => {
  const schema = await outgoingSchema('rank', { query: 'Synthetic', limit: 6,
    candidates: [{ namespaceIndex: 0, memory: { id: 'personal', revision: 1 } },
      { namespaceIndex: 1, memory: { id: 'project', revision: 2 } }] });
  assert.equal(accepts(schema, { refs: [{ namespaceIndex: 1, memoryId: 'project', revision: 2 }] }), true);
  for (const override of [{ namespaceIndex: 2 }, { memoryId: 'foreign' }, { revision: 999 }]) {
    assert.equal(accepts(schema, { refs: [{ namespaceIndex: 1, memoryId: 'project', revision: 2, ...override }] }), false);
  }
});

test('empty select and rank candidates permit only empty refs', async () => {
  for (const [method, input] of [['select', { maps: [], query: 'Synthetic', maxRefs: 24 }],
    ['select', { maps: [{ namespaceIndex: 0, items: [], exhausted: true }], query: 'Synthetic', maxRefs: 24 }],
    ['rank', { candidates: [], query: 'Synthetic', limit: 6 }]]) {
    const schema = await outgoingSchema(method, input);
    assert.equal(accepts(schema, { refs: [] }), true);
    assert.equal(accepts(schema, { refs: [{ namespaceIndex: 0, memoryId: 'invented', revision: 1 }] }), false);
    assert.equal(schema.properties.refs.maxItems, 0);
  }
});

const envelope = (payload, output, inputTokens = 100) => ({ object: 'response', model: payload.model,
  status: 'completed', error: null, incomplete_details: null,
  output: [{ type: 'message', role: 'assistant', status: 'completed',
    content: [{ type: 'output_text', text: JSON.stringify(output) }] }],
  usage: { input_tokens: inputTokens, output_tokens: 100, total_tokens: inputTokens + 100 } });

test('count and generation share exactly one frozen schema despite asynchronous input mutations', async () => {
  const input = emptyMap();
  const bodies = [];
  const model = createOpenAIModel({ apiKey: 'synthetic-reference-key', fetchImpl: async (url, options) => {
    const body = JSON.parse(options.body); bodies.push(body);
    if (url.endsWith('/input_tokens')) {
      input.memories[0].id = 'mutated-memory';
      input.map.push({ type: 'moc', moc: { id: 'late-group', level: 'L1' } });
      return Response.json({ object: 'response.input_tokens', input_tokens: 100 });
    }
    return Response.json(envelope(body, { items: [{ memoryId: 'harbor', parentIds: [] }] }));
  } });
  await model.classify(request(input));
  assert.equal(bodies.length, 2);
  assert.deepEqual(bodies[0].text, bodies[1].text);
  assert.deepEqual(bodies[0].input, bodies[1].input);
  const schema = bodies[1].text.format.schema;
  assert.equal(accepts(schema, { items: [{ memoryId: 'harbor', parentIds: [] }] }), true);
  assert.equal(accepts(schema, { items: [{ memoryId: 'mutated-memory', parentIds: [] }] }), false);
  assert.equal(accepts(schema, { items: [{ memoryId: 'harbor', parentIds: ['late-group'] }] }), false);
});

test('dynamic schemas retain the absolute provider input budget and issue no generation after overflow', async () => {
  let calls = 0;
  let model;
  const req = request(emptyMap());
  model = createOpenAIModel({ apiKey: 'synthetic-reference-key', fetchImpl: async () => {
    calls++;
    return Response.json({ object: 'response.input_tokens', input_tokens: 7025 });
  } });
  await assert.rejects(model.classify(req), (error) => error.code === 'context_budget_exceeded');
  assert.equal(calls, 1);
});

test('live guard accepts the derived classify schema while preserving reservation accounting', async () => {
  const guard = createBudgetedFetch({ budgetUsd: 0.1, fetchImpl: async (url, options) => {
    const payload = JSON.parse(options.body);
    if (url.endsWith('/input_tokens')) return Response.json({ object: 'response.input_tokens', input_tokens: 100 });
    return Response.json(envelope(payload, { items: [{ memoryId: 'harbor', parentIds: [] }] }));
  } });
  const model = createOpenAIModel({ apiKey: 'synthetic-reference-key', fetchImpl: guard.fetchImpl });
  assert.deepEqual(await model.classify(request(emptyMap())), { items: [{ memoryId: 'harbor', parentIds: [] }] });
  assert.equal(guard.snapshot().requestCount, 2);
  assert.equal(guard.snapshot().rejection, null);
  assert.equal(guard.snapshot().reservedUsd, 0.008896);
});

test('live guard rejects a widened dynamic schema before any reservation or network I/O', async () => {
  let captured;
  const spy = createOpenAIModel({ apiKey: 'synthetic-reference-key', fetchImpl: async (url, options) => {
    captured = { url, options }; throw new Error('synthetic-stop');
  } });
  await assert.rejects(spy.classify(request(emptyMap())));
  const body = JSON.parse(captured.options.body);
  body.text.format.schema.properties.items.items.anyOf[0].properties.parentIds.maxItems = 3;
  let calls = 0;
  const guard = createBudgetedFetch({ budgetUsd: 0.1, fetchImpl: async () => { calls++; } });
  await assert.rejects(guard.fetchImpl(captured.url, { ...captured.options, body: JSON.stringify(body) }));
  assert.equal(calls, 0);
  assert.equal(guard.snapshot().reservedUsd, 0);
  assert.equal(guard.snapshot().rejection, 'request_rejected');
});

test('frozen reference schemas support the complete guarded lifecycle with fake HTTP', async () => {
  const report = await runLiveLifecycle({ apiKey: 'synthetic-reference-key', budgetUsd: 0.25,
    fetchImpl: async (url, options) => {
      const payload = JSON.parse(options.body);
      if (url.endsWith('/input_tokens')) return Response.json({ object: 'response.input_tokens', input_tokens: 100 });
      const input = JSON.parse(payload.input[0].content[0].text);
      let output;
      if (payload.text.format.name === 'cairn_extract') output = { items: [{
        content: 'Use diagrams rather than long prose in code reviews.', kind: 'preference', confidence: 0.9, sourceIndices: [0],
      }] };
      else if (payload.text.format.name === 'cairn_classify') output = { items: input.memories.map((memory) => ({
        memoryId: memory.id, parentIds: [], newL1: { title: 'Code review preferences', parentL2Ids: [] },
      })) };
      else if (payload.text.format.name === 'cairn_select') output = { refs: input.maps.flatMap(({ namespaceIndex, items }) =>
        items.flatMap((item) => item.type === 'unfiled' ? [{ namespaceIndex, ...item.ref }] :
          item.type === 'ref' && item.ref.childType === 'memory' ? [{ namespaceIndex,
            memoryId: item.ref.childId, revision: item.ref.childRevision }] : [])).slice(0, 1) };
      else {
        assert.equal(payload.text.format.name, 'cairn_rank');
        output = { refs: input.candidates.slice(0, 1).map(({ namespaceIndex, memory }) => ({
          namespaceIndex, memoryId: memory.id, revision: memory.revision })) };
      }
      assert.equal(accepts(payload.text.format.schema, output), true, payload.text.format.name);
      return Response.json(envelope(payload, output));
    } });
  assert.equal(report.ok, true, JSON.stringify(report));
  assert.equal(report.stages.length, 5);
  assert.ok(report.stages.every((stage) => stage.status === 'passed'));
  assert.equal(report.accounting.rejection, null);
  assert.doesNotMatch(JSON.stringify(report), /synthetic-reference-key/);
});

test('dynamic schemas preserve the existing strict shape and output bounds', async () => {
  const schema = await outgoingSchema('classify', emptyMap());
  assert.equal(accepts(schema, { items: [{ memoryId: 'harbor', parentIds: [] }], unexpected: true }), false);
  assert.equal(accepts(schema, { items: Array.from({ length: 6 }, () => ({ memoryId: 'harbor', parentIds: [] })) }), false);
  const extract = await outgoingSchema('extract', { messages: [] });
  assert.equal(accepts(extract, { items: [{ content: 'x'.repeat(601), kind: 'fact', confidence: 0.9, sourceIndices: [0] }] }), false);
});

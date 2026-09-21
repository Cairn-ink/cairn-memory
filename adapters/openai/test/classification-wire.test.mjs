import assert from 'node:assert/strict';
import test from 'node:test';

import { createOpenAIModel } from '../index.mjs';
import { schemasFor } from '../schemas.mjs';

const uuid = (role, index) => `${role === 'memory' ? '10000000' : '20000000'}-0000-4000-8000-${String(index).padStart(12, '0')}`;
const targetContent = (index) => `Synthetic target ${index}. ${'This bounded evidence sentence carries realistic classification detail. '.repeat(8)}`;
const classificationInput = () => ({
  memories: Array.from({ length: 5 }, (_, index) => ({
    id: uuid('memory', index), namespace: { ownerId: 'classification-wire', scope: 'project', projectId: 'synthetic' },
    content: targetContent(index), kind: 'fact', origin: 'explicit', confidence: 1, revision: 1,
    state: 'active', filing: { status: 'unfiled' }, receiptCount: 1,
    createdAt: '2026-09-21T00:00:00.000Z', updatedAt: '2026-09-21T00:00:00.000Z',
  })),
  map: Array.from({ length: 52 }, (_, index) => ({
    type: 'moc', moc: { id: uuid('moc', index), level: index % 4 === 0 ? 'L2' : 'L1',
      title: `Synthetic catalog topic ${String(index).padStart(2, '0')}`, revision: 1 },
  })),
  mapExhausted: true,
});

const envelope = (payload, output) => ({
  object: 'response', model: payload.model, status: 'completed', error: null, incomplete_details: null,
  output: [{ type: 'message', role: 'assistant', status: 'completed',
    content: [{ type: 'output_text', text: JSON.stringify(output) }] }],
  usage: { input_tokens: 100, output_tokens: 20, total_tokens: 120 },
});

test('CWA5: five targets and 52 visible MOCs use lossless short wire IDs with material local reduction', async () => {
  const input = classificationInput();
  const original = structuredClone(input);
  const bodies = [];
  const model = createOpenAIModel({ apiKey: 'synthetic-classification-wire-key', fetchImpl: async (url, options) => {
    const body = JSON.parse(options.body); bodies.push(body);
    if (url.endsWith('/input_tokens')) return Response.json({ object: 'response.input_tokens', input_tokens: 100 });
    const wire = JSON.parse(body.input[0].content[0].text);
    return Response.json(envelope(body, { items: wire.memories.map((memory) => ({ memoryId: memory.id, parentIds: [] })) }));
  } });
  const result = await model.classify({ system: 'Synthetic bounded classification.', input,
    maxOutputTokens: 1024, signal: new AbortController().signal });

  assert.deepEqual(result, { items: original.memories.map((memory) => ({ memoryId: memory.id, parentIds: [] })) });
  assert.deepEqual(input, original, 'classification transport must not mutate caller input');
  assert.equal(bodies.length, 2);
  assert.deepEqual(bodies[0], (({ max_output_tokens, store, stream, ...countBody }) => countBody)(bodies[1]));

  const wire = JSON.parse(bodies[0].input[0].content[0].text);
  assert.equal(wire.memories.length, 5);
  assert.equal(wire.map.length, 52);
  assert.equal(wire.mapExhausted, true);
  assert.deepEqual(wire.memories.map(({ id, ...memory }) => memory),
    original.memories.map(({ id, ...memory }) => memory));
  assert.deepEqual(wire.map.map(({ moc: { id, ...moc }, ...item }) => ({ ...item, moc })),
    original.map.map(({ moc: { id, ...moc }, ...item }) => ({ ...item, moc })));

  const wireText = JSON.stringify(wire);
  const schemaText = JSON.stringify(bodies[0].text.format.schema);
  for (const id of [...original.memories.map((memory) => memory.id), ...original.map.map((item) => item.moc.id)]) {
    assert.equal(wireText.includes(id), false, `raw ID escaped in wire input: ${id}`);
    assert.equal(schemaText.includes(id), false, `raw ID escaped in wire schema: ${id}`);
  }
  assert.equal(new Set(wire.memories.map((memory) => memory.id)).size, 5);
  assert.equal(new Set(wire.map.map((item) => item.moc.id)).size, 52);
  assert.ok(wire.memories.every((memory) => /^m[0-9a-z]+$/.test(memory.id)));
  assert.ok(wire.map.every((item) => /^c[0-9a-z]+$/.test(item.moc.id)));
  assert.ok(original.memories.every((memory) => memory.content.length <= 600));
  const targetMemoryTokens = model.countTokens(JSON.stringify(original.memories));
  assert.ok(targetMemoryTokens >= 850 && targetMemoryTokens <= 1_200,
    `expected realistic target-memory component, actual=${targetMemoryTokens}`);

  const rawSchemaTokens = model.countTokens(JSON.stringify(schemasFor('classify', original)));
  const wireSchemaTokens = model.countTokens(schemaText);
  const rawCountBody = structuredClone(bodies[0]);
  rawCountBody.input[0].content[0].text = JSON.stringify(original);
  rawCountBody.text.format.schema = schemasFor('classify', original);
  const rawTransportTokens = model.countTokens(JSON.stringify(rawCountBody));
  const wireTransportTokens = model.countTokens(JSON.stringify(bodies[0]));
  assert.ok(wireSchemaTokens <= Math.floor(rawSchemaTokens * 0.55),
    `expected material schema reduction, raw=${rawSchemaTokens} wire=${wireSchemaTokens}`);
  assert.ok(wireTransportTokens <= rawTransportTokens - 1_000,
    `expected material input+schema reduction, raw=${rawTransportTokens} wire=${wireTransportTokens}`);
});

const smallInput = (mapExhausted = true) => ({
  memories: [{ id: uuid('memory', 70), content: `A title may mention ${uuid('moc', 70)} without becoming an ID.`, revision: 1 },
    { id: uuid('memory', 71), content: 'Second synthetic placement target.', revision: 2 }],
  map: [{ type: 'moc', moc: { id: uuid('moc', 70), level: 'L1', title: `Literal ${uuid('memory', 70)}` } },
    { type: 'moc', moc: { id: uuid('moc', 71), level: 'L2', title: 'Existing root' } }],
  mapExhausted,
});

function modelForOutput(input, outputForWire) {
  const bodies = [];
  const model = createOpenAIModel({ apiKey: 'synthetic-classification-wire-key', fetchImpl: async (url, options) => {
    const body = JSON.parse(options.body); bodies.push(body);
    if (url.endsWith('/input_tokens')) return Response.json({ object: 'response.input_tokens', input_tokens: 100 });
    const wire = JSON.parse(body.input[0].content[0].text);
    return Response.json(envelope(body, outputForWire(wire)));
  } });
  return { model, bodies, request: { system: 'Synthetic classification.', input,
    maxOutputTokens: 1024, signal: new AbortController().signal } };
}

test('CWA1/CWA2: classification wire preserves literal content and decodes existing/new parent roles', async () => {
  const input = smallInput();
  const { model, bodies, request } = modelForOutput(input, (wire) => ({ items: [
    { memoryId: wire.memories[0].id, parentIds: [wire.map[0].moc.id] },
    { memoryId: wire.memories[1].id, parentIds: [], newL1: {
      title: 'New leaf', parentL2Ids: [wire.map[1].moc.id], newL2Title: 'New root',
    } },
  ] }));
  assert.deepEqual(await model.classify(request), { items: [
    { memoryId: input.memories[0].id, parentIds: [input.map[0].moc.id] },
    { memoryId: input.memories[1].id, parentIds: [], newL1: {
      title: 'New leaf', parentL2Ids: [input.map[1].moc.id], newL2Title: 'New root',
    } },
  ] });
  const wire = JSON.parse(bodies[0].input[0].content[0].text);
  assert.equal(wire.memories[0].content, input.memories[0].content);
  assert.equal(wire.map[0].moc.title, input.map[0].moc.title);
  assert.equal(wire.memories[0].content.includes(input.map[0].moc.id), true);
  assert.equal(wire.map[0].moc.title.includes(input.memories[0].id), true);
});

test('CWA2: empty catalogs and incomplete maps retain their strict classification forms', async () => {
  for (const { input, newTopic } of [
    { input: { memories: [], map: [], mapExhausted: true }, newTopic: false },
    { input: { memories: [{ id: uuid('memory', 80), content: 'New topic target.', revision: 1 }],
      map: [], mapExhausted: true }, newTopic: true },
    { input: { memories: [{ id: uuid('memory', 81), content: 'Unfiled target.', revision: 1 }],
      map: [], mapExhausted: false }, newTopic: false },
  ]) {
    const item = (memory) => ({ memoryId: memory.id, parentIds: [], ...(newTopic ? { newL1: {
      title: 'Empty-catalog leaf', parentL2Ids: [], newL2Title: 'Empty-catalog root',
    } } : {}) });
    const { model, request } = modelForOutput(input, (wire) => ({ items: wire.memories.map(item) }));
    assert.deepEqual(await model.classify(request), { items: input.memories.map(item) });
  }
});

test('CWA2: unknown, cross-role and raw original IDs fail closed before leaving the adapter', async () => {
  const input = smallInput();
  const cases = [
    (wire) => ({ items: [{ memoryId: 'm-unknown', parentIds: [] }] }),
    (wire) => ({ items: [{ memoryId: wire.map[0].moc.id, parentIds: [] }] }),
    () => ({ items: [{ memoryId: input.memories[0].id, parentIds: [] }] }),
    (wire) => ({ items: [{ memoryId: wire.memories[0].id, parentIds: [wire.memories[1].id] }] }),
    (wire) => ({ items: [{ memoryId: wire.memories[0].id, parentIds: [input.map[0].moc.id] }] }),
    (wire) => ({ items: [{ memoryId: wire.memories[0].id, parentIds: [],
      newL1: { title: 'Wrong level', parentL2Ids: [wire.map[0].moc.id] } }] }),
    (wire) => ({ items: [{ memoryId: wire.memories[0].id, parentIds: [], unexpected: true }] }),
  ];
  for (const output of cases) {
    const { model, request } = modelForOutput(input, output);
    await assert.rejects(model.classify(request), (error) => error?.code === 'invalid_model_output');
  }
});

test('CWA1/CWA4: interleaved calls keep private frozen aliases despite caller mutation', async () => {
  const inputs = [smallInput(), smallInput()];
  inputs[1].memories[0].id = uuid('memory', 90);
  inputs[1].memories[0].content = 'Independent concurrent request.';
  const original = structuredClone(inputs);
  const pendingCounts = [];
  const bodies = [];
  const model = createOpenAIModel({ apiKey: 'synthetic-classification-wire-key', fetchImpl: async (url, options) => {
    const body = JSON.parse(options.body); bodies.push(body);
    if (url.endsWith('/input_tokens')) return new Promise((resolve) => pendingCounts.push(resolve));
    const wire = JSON.parse(body.input[0].content[0].text);
    return Response.json(envelope(body, { items: wire.memories.map((memory) => ({ memoryId: memory.id, parentIds: [] })) }));
  } });
  const invoke = (input) => model.classify({ system: 'Concurrent synthetic classification.', input,
    maxOutputTokens: 1024, signal: new AbortController().signal });
  const calls = inputs.map(invoke);
  await Promise.resolve();
  assert.equal(pendingCounts.length, 2);
  inputs[0].memories[0].id = 'mutated-after-count';
  inputs[1].map[0].moc.id = 'mutated-after-count';
  pendingCounts[1](Response.json({ object: 'response.input_tokens', input_tokens: 100 }));
  await Promise.resolve();
  pendingCounts[0](Response.json({ object: 'response.input_tokens', input_tokens: 100 }));
  const results = await Promise.all(calls);
  assert.deepEqual(results, original.map((input) => ({ items: input.memories.map((memory) => ({
    memoryId: memory.id, parentIds: [],
  })) })));
  for (const body of bodies.filter((body) => body.max_output_tokens === 1024)) {
    const matchingCount = bodies.find((candidate) => candidate.max_output_tokens === undefined &&
      candidate.input[0].content[0].text === body.input[0].content[0].text);
    assert.ok(matchingCount);
    assert.deepEqual(matchingCount.text, body.text);
  }
});

test('CWA1: adapter local preflight remains on the original classification input', async () => {
  let calls = 0;
  const longId = Array.from({ length: 4_000 }, (_, index) => index.toString(36).padStart(4, '0')).join('-');
  const input = { memories: [{ id: longId, content: 'Synthetic.', revision: 1 }],
    map: [], mapExhausted: true };
  const model = createOpenAIModel({ apiKey: 'synthetic-classification-wire-key', fetchImpl: async () => { calls++; } });
  assert.ok(model.countTokens(JSON.stringify({ system: 'Synthetic classification.', input, maxOutputTokens: 1024 })) > 6_000);
  await assert.rejects(model.classify({ system: 'Synthetic classification.', input,
    maxOutputTokens: 1024, signal: new AbortController().signal }),
  (error) => error?.code === 'context_budget_exceeded');
  assert.equal(calls, 0);
});

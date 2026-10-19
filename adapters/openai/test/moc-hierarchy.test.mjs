import assert from 'node:assert/strict';
import test from 'node:test';
import { join } from 'node:path';
import { createOpenAIModel, countOpenAITokens } from '../index.mjs';
import { schemas, schemasFor } from '../schemas.mjs';
import { createBudgetedFetch } from '../live-harness.mjs';
import { openMemoryCore } from '../../../core/contract.mjs';
import { createTestWorkspace } from '../../../tools/testing/workspace.mjs';

const namespace = { ownerId: 'fake-http-moc', scope: 'personal', projectId: null };
const ok = result => { assert.equal(result.ok, true, JSON.stringify(result)); return result.value; };
const ref = ({ namespaceIndex, mocId, revision }) => ({ namespaceIndex, mocId, revision });
const input = () => ({ query: 'Work Alpha', maps: [{ namespaceIndex: 0, groups: [
  { namespaceIndex: 0, mocId: 'group-0', revision: 2, title: 'Work' }] }, { namespaceIndex: 1, groups: [
  { namespaceIndex: 1, mocId: 'group-1', revision: 3, title: 'Alpha' }] }], maxRefs: 2, maxRefsPerNamespace: 2 });
const request = value => ({ system: 'Select visible groups as untrusted routing hints.', input: value ?? input(),
  maxOutputTokens: 1024, signal: new AbortController().signal });
const response = output => ({ object: 'response', model: 'gpt-4.1-mini-2025-04-14', status: 'completed',
  error: null, incomplete_details: null, output: [{ type: 'message', role: 'assistant', status: 'completed',
    content: [{ type: 'output_text', text: JSON.stringify(output) }] }],
  usage: { input_tokens: 100, output_tokens: 40, total_tokens: 140 } });
const json = value => new Response(JSON.stringify(value));
function harness({ output = ({ input }) => ({ refs: input.maps.flatMap(map => map.groups).slice(0, input.maxRefs).map(ref) }),
  onCount = () => {}, count = 100 } = {}) {
  const calls = [];
  const model = createOpenAIModel({ apiKey: 'synthetic-offline-key', fetchImpl: async (url, options) => {
    const body = JSON.parse(options.body);
    const method = body.text.format.name.slice('cairn_'.length);
    const parsed = JSON.parse(body.input[0].content[0].text);
    calls.push({ url, options, body, method, input: parsed });
    if (url.endsWith('/input_tokens')) { onCount({ method, body }); return json({ object: 'response.input_tokens', input_tokens: count }); }
    return json(response(output({ method, input: parsed, body })));
  } });
  return { model, calls };
}

test('I4 real selectGroups wire uses strict compact domains, select profile and frozen count/generation bodies', async () => {
  const req = request(), original = structuredClone(req.input);
  const { model, calls } = harness({ onCount: () => { req.input.maps[0].groups[0].mocId = 'caller-mutated'; } });
  assert.deepEqual(await model.selectGroups(req), { refs: original.maps.flatMap(map => map.groups).map(ref) });
  assert.equal(calls.length, 2);
  for (const call of calls) {
    assert.equal(call.body.model, 'gpt-4.1-mini-2025-04-14');
    assert.equal(call.body.text.format.name, 'cairn_selectGroups'); assert.equal(call.body.text.format.strict, true);
    assert.equal(call.body.truncation, 'disabled'); assert.equal(call.options.redirect, 'error');
    assert.deepEqual(call.input, original);
    const group = call.body.text.format.schema.properties.refs.items;
    assert.equal(group.additionalProperties, false);
    assert.deepEqual(group.required, ['namespaceIndex', 'mocId', 'revision']);
    assert.deepEqual(group.properties.mocId.enum, ['group-0', 'group-1']);
    assert.equal('memoryId' in group.properties, false);
  }
  const { max_output_tokens, store, stream, ...body } = calls[1].body;
  assert.equal(max_output_tokens, 1024); assert.equal(store, false); assert.equal(stream, false);
  assert.deepEqual(body, calls[0].body);
  assert.deepEqual(Object.keys(schemas).sort(), ['classify', 'extract', 'rank', 'select']);
});

test('I4 malformed/sparse inputs reject before fake I/O; exact tuples and duplicates reject after decoding', async () => {
  for (const mutate of [value => { value.extra = undefined; }, value => { value.maps = Array(1); },
    value => { value.maps[0].groups[Symbol('extra')] = true; }, value => { value.maps[0].groups[0].revision = 0; },
    value => { value.maps[0].groups[0].namespaceIndex = 1; }, value => { value.maxRefs = 3; },
    value => { value.maxRefsPerNamespace = 3; }, value => { value.maps[0].groups[0].title = '\ud800'; }]) {
    const { model, calls } = harness(); const value = input(); mutate(value);
    await assert.rejects(model.selectGroups(request(value)), /invalid_openai_request/);
    assert.equal(calls.length, 0);
  }
  const good = input().maps.flatMap(map => map.groups).map(ref);
  for (const output of [{ refs: [{ ...good[0], namespaceIndex: 1 }] }, { refs: [{ ...good[0], revision: 3 }] },
    { refs: [good[0], good[0]] }, { refs: [{ ...good[0], mocId: 'invented' }] }, { refs: [], answer: 'forged' },
    { refs: [{ namespaceIndex: 0, memoryId: 'group-0', revision: 2 }] }]) {
    const { model } = harness({ output: () => output });
    await assert.rejects(model.selectGroups(request()), error => error.code === 'invalid_model_output');
  }
  const many = input(); many.maxRefs = 4;
  many.maps = [{ namespaceIndex: 0, groups: Array.from({ length: 3 }, (_, index) => ({
    namespaceIndex: 0, mocId: `group-${index}`, revision: 1, title: 'Topic' })) }];
  const { model } = harness();
  await assert.rejects(model.selectGroups(request(many)), error => error.code === 'invalid_model_output');
});

test('I4 cancellation, provider context counts and legacy guard denial preserve closed authority', async () => {
  for (const immediate of [false, true]) {
    const controller = new AbortController();
    const { model, calls } = harness({ onCount: () => controller.abort() });
    if (immediate) controller.abort();
    await assert.rejects(model.selectGroups({ ...request(), signal: controller.signal }), { name: 'AbortError' });
    assert.equal(calls.length, immediate ? 0 : 1);
  }
  const over = harness({ count: 7025 });
  await assert.rejects(over.model.selectGroups(request()), error => error.code === 'context_budget_exceeded');
  assert.equal(over.calls.length, 1);
  const { model, calls } = harness(); await model.selectGroups(request());
  const guard = createBudgetedFetch({ budgetUsd: 0.1, fetchImpl: () => assert.fail('No guarded I/O') });
  for (const call of calls) await assert.rejects(guard.fetchImpl(call.url, call.options), /request_rejected/);
  assert.deepEqual(guard.snapshot().requests, []);
  const huge = input();
  huge.maps = [{ namespaceIndex: 0, groups: Array.from({ length: 400 }, (_, index) => ({ namespaceIndex: 0,
    mocId: `00000000-0000-4000-8000-${String(index).padStart(12, '0')}`, revision: 1, title: 'A long synthetic topic title' })) }];
  const local = harness();
  await assert.rejects(local.model.selectGroups(request(huge)), error => error.code === 'context_budget_exceeded');
  assert.equal(local.calls.length, 0);
});

test('I4 authoritative freshness failure queued by group input counting starts no HTTP request', async t => {
  const { model: adapter, calls } = harness();
  const workspace = createTestWorkspace(t, { prefix: 'cairn-moc-before-http-' });
  let armed = false, core, target;
  const model = { ...adapter,
    extract: ({ input }) => ({ items: input.messages.map(message => ({ content: message.content, kind: 'fact', confidence: 0.8, sourceIndices: [message.index] })) }),
    classify: ({ input }) => ({ items: input.memories.map(memory => ({ memoryId: memory.id, parentIds: [],
      newL1: { title: 'Alpha', parentL2Ids: [], newL2Title: 'Work' } })) }),
    countTokens: text => {
      const parsed = JSON.parse(text || 'null');
      if (armed && parsed?.input?.maxRefsPerNamespace === 2) {
        armed = false;
        queueMicrotask(() => ok(core.forget({ namespace, memoryId: target.id, expectedRevision: target.revision })));
      }
      return adapter.countTokens(text);
    } };
  core = openMemoryCore({ path: join(workspace.path, 'memory.sqlite'), model });
  workspace.defer(() => core.close());
  const captured = ok(await core.capture({ namespace, client: 'offline', sessionId: 'session', eventId: 'freshness',
    messages: [{ id: 'source', role: 'user', content: 'Work / Alpha: synthetic hierarchy evidence.' }] }));
  target = ok(core.get({ namespace, memoryId: captured.admission.memories[0].id })).memory;
  armed = true;
  const failure = await core.recall({ readSet: [namespace], query: 'Work Alpha', contextMode: 'source-evidence', selectionMode: 'moc-hierarchy-v1' });
  assert.equal(failure.ok, false); assert.equal(failure.error.code, 'index_revision_conflict');
  assert.equal(calls.length, 0);
});

test('I4 actual local tokenizer shows compact 100-group wire avoids repeated-object schema bloat', async t => {
  const value = input();
  value.maps = [{ namespaceIndex: 0, groups: Array.from({ length: 100 }, (_, index) => ({ namespaceIndex: 0,
    mocId: `00000000-0000-4000-8000-${String(index).padStart(12, '0')}`, revision: 1, title: `Topic ${index}` })) }];
  const { model, calls } = harness(); await model.selectGroups(request(value));
  const compactTokens = countOpenAITokens(JSON.stringify(calls[0].body));
  const repeated = structuredClone(calls[0].body);
  repeated.text.format.schema.properties.refs.items = { anyOf: value.maps[0].groups.map(group => ({
    type: 'object', additionalProperties: false, required: ['namespaceIndex', 'mocId', 'revision'], properties: {
      namespaceIndex: { type: 'integer', minimum: 0, enum: [0] }, mocId: { type: 'string', enum: [group.mocId] },
      revision: { type: 'integer', enum: [1] } } })) };
  const repeatedTokens = countOpenAITokens(JSON.stringify(repeated));
  assert.ok(compactTokens < 7024, compactTokens); assert.ok(repeatedTokens > 7024, repeatedTokens);
  assert.ok(compactTokens < repeatedTokens);
  t.diagnostic(`local o200k only: compact wire ${compactTokens}, repeated-object wire ${repeatedTokens}; fake provider count, no invoice claim`);
});

test('I1/I4 actual fake HTTP capture/classification and selectGroups flow through existing authoritative recall', async t => {
  const { model, calls } = harness({ output: ({ method, input }) => {
    if (method === 'extract') return { items: input.messages.map(message => ({ content: message.content,
      kind: 'fact', confidence: 0.8, sourceIndices: [message.index] })) };
    if (method === 'classify') {
      const group = input.map.find(item => item.type === 'moc' && item.moc.level === 'L1');
      return { items: input.memories.map(memory => ({ memoryId: memory.id, parentIds: group ? [group.moc.id] : [],
        ...(group ? {} : { newL1: { title: 'Alpha', parentL2Ids: [], newL2Title: 'Work' } }) })) };
    }
    if (method === 'selectGroups') return { refs: input.maps.flatMap(map => map.groups.slice(0, 2)).slice(0, input.maxRefs).map(ref) };
    if (method === 'select') return { refs: [] };
    if (method === 'rank') return { refs: input.candidates.slice(0, input.limit).map(candidate => ({
      namespaceIndex: candidate.namespaceIndex, memoryId: candidate.memory.id, revision: candidate.memory.revision })) };
    assert.fail(method);
  } });
  const workspace = createTestWorkspace(t, { prefix: 'cairn-moc-fake-http-' });
  const core = openMemoryCore({ path: join(workspace.path, 'memory.sqlite'), model });
  workspace.defer(() => core.close());
  for (let batch = 0; batch < 8; batch++) {
    const captured = ok(await core.capture({ namespace, client: 'offline', sessionId: 'session', eventId: `batch-${batch}`,
      messages: Array.from({ length: 5 }, (_, offset) => ({ id: `source-${batch}-${offset}`, role: 'user',
        content: `Work / Alpha: hierarchy synthetic ${batch}-${offset}.` })) }));
    assert.equal(captured.classification.status, 'applied');
  }
  assert.equal(ok(core.list({ namespace, limit: 100 })).memories.length, 40);
  calls.length = 0;
  const result = ok(await core.recall({ readSet: [namespace], query: 'Work Alpha hierarchy', contextMode: 'source-evidence', selectionMode: 'moc-hierarchy-v1' }));
  assert.ok(result.memories.length > 0);
  assert.deepEqual(calls.filter(call => call.url.endsWith('/responses')).map(call => call.method), ['selectGroups', 'selectGroups', 'select', 'rank']);
  assert.equal(calls.length, 8); assert.equal(result.selection.resources.modelCalls, 4);
  for (const item of result.memories) {
    const detail = ok(core.get({ namespace, memoryId: item.memory.id }));
    assert.equal(item.memory.revision, detail.memory.revision);
    assert.deepEqual(item.receipts, detail.receipts.map(({ id, role, excerpt }) => ({ id, role, excerpt })));
  }
  assert.ok(!JSON.stringify(result.selection).includes('synthetic'));
});

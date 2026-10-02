import assert from 'node:assert/strict';
import test, { after, mock } from 'node:test';
import { join } from 'node:path';
import { createOpenAIModel } from '../index.mjs';
import { openMemoryCore } from '../../../core/contract.mjs';
import { createTestWorkspace } from '../../../tools/testing/workspace.mjs';

const guard = mock.method(globalThis, 'fetch', () => assert.fail('Native network forbidden'));
after(() => guard.mock.restore());
const canary = 'SYNTHETIC_PRIVATE_CLASSIFICATION_CANARY';
const namespace = { ownerId: 'synthetic-rejection-owner', scope: 'project', projectId: 'synthetic-rejection-project' };
const ok = result => { assert.equal(result.ok, true, JSON.stringify(result)); return result.value; };
const batch = { namespace, client: 'synthetic-rejection-client', sessionId: 'synthetic-rejection-session',
  eventId: 'synthetic-rejection-event', messages: [{ id: 'synthetic-source-id', role: 'user', content: canary }] };
const event = reason => ({ version: 1, stage: 'classify', layer: 'core_validation', reason });
const envelope = (payload, output) => ({ object: 'response', model: payload.model, status: 'completed',
  error: null, incomplete_details: null, output: [{ type: 'message', role: 'assistant', status: 'completed',
    content: [{ type: 'output_text', text: JSON.stringify(output) }] }],
  usage: { input_tokens: 100, output_tokens: 20, total_tokens: 120 } });

function fixture(t, respond) {
  const workspace = createTestWorkspace(t, { prefix: 'classification-rejection-adapter-' });
  const events = [], calls = [], decoded = [];
  const adapter = createOpenAIModel({ apiKey: 'synthetic-not-a-key', onDiagnostic: value => events.push(value),
    fetchImpl: async (url, init) => {
      const payload = JSON.parse(init.body), input = JSON.parse(payload.input[0].content[0].text);
      const stage = payload.text.format.name.slice('cairn_'.length);
      calls.push({ stage, count: url.endsWith('/input_tokens') });
      if (url.endsWith('/input_tokens')) return Response.json({ object: 'response.input_tokens', input_tokens: 100 });
      const output = stage === 'extract' ? { items: [0, 1].map(index => ({
        content: `${canary} assertion ${index}`, kind: 'fact', confidence: 0.8, sourceIndices: [0] })) }
        : respond(input);
      return Response.json(envelope(payload, output));
    } });
  const model = { ...adapter, classify: async request => {
    const value = await adapter.classify(request);
    decoded.push(value); // Prove the output passed adapter validation before core rejected it.
    return value;
  } };
  const path = join(workspace.path, 'store.sqlite');
  const core = openMemoryCore({ path, model });
  workspace.defer(() => core.close());
  return { workspace, path, core, model, events, calls, decoded };
}

function seedTopics(core) {
  // Two distinct visible topics per level permit an adapter-valid two-entry
  // array. One visible topic would impose maxItems=1 at the adapter boundary.
  for (const index of [0, 1]) {
    const content = `Synthetic topic seed ${index}`;
    const memory = ok(core.admit({ namespace, memory: { content, kind: 'fact' }, receipts: [{
      client: 'synthetic', sessionId: 'seed', eventId: `seed-${index}`, role: 'user', excerpt: content }] })).memory;
    const mapped = ok(core.map({ namespace, purpose: 'classification' }));
    ok(core.applyPlacement({ namespace, proposal: { items: [{ memoryId: memory.id, parentIds: [],
      newL1: { title: `Synthetic seed leaf ${index}`, parentL2Ids: [], newL2Title: `Synthetic seed root ${index}` } }] },
      expectedMemoryRevisions: [{ memoryId: memory.id, revision: 1 }], expectedIndexRevision: mapped.indexRevision }));
  }
}

test('CR4: adapter-valid 121-title and duplicates reach core rejection after committed admission', async t => {
  const cases = [
    ['classification_l1_title', input => input.memories.map(memory => ({ memoryId: memory.id, parentIds: [],
      newL1: { title: 'x'.repeat(121), parentL2Ids: [] } }))],
    ['classification_duplicate_targets', input => input.memories.map(() => ({ memoryId: input.memories[0].id, parentIds: [] }))],
    ['classification_duplicate_l1_parents', input => input.memories.map(memory => ({ memoryId: memory.id,
      parentIds: Array(2).fill(input.map.find(item => item.type === 'moc' && item.moc.level === 'L1').moc.id) }))],
    ['classification_duplicate_l2_parents', input => input.memories.map(memory => ({ memoryId: memory.id, parentIds: [],
      newL1: { title: 'Synthetic new leaf', parentL2Ids: Array(2).fill(input.map.find(item => item.type === 'moc' && item.moc.level === 'L2').moc.id) } }))],
  ];
  for (const [reason, items] of cases) await t.test(reason, async t => {
    const f = fixture(t, input => ({ items: items(input) }));
    seedTopics(f.core);
    const result = ok(await f.core.capture(batch));
    assert.equal(f.decoded.length, 1, `adapter validation succeeded; events=${JSON.stringify(f.events)}`);
    assert.deepEqual(result.classification, { status: 'failed', error: { code: 'invalid_model_output', retryable: false } });
    assert.equal(result.admission.memories.length, 2);
    const before = result.admission.memories.map(({ id }) => ok(f.core.get({ namespace, memoryId: id })));
    assert.deepEqual(f.calls, [{ stage: 'extract', count: true }, { stage: 'extract', count: false },
      { stage: 'classify', count: true }, { stage: 'classify', count: false }]);
    const cold = openMemoryCore({ path: f.path, model: f.model });
    f.workspace.defer(() => cold.close());
    const inspected = ok(cold.inspectAdmission({ namespace, client: batch.client, eventId: batch.eventId,
      includeInitialClassification: true }));
    assert.equal(inspected.status, 'completed');
    assert.deepEqual(inspected.initialClassification, { status: 'failed' });
    for (const stored of before) {
      const reopened = ok(cold.get({ namespace, memoryId: stored.memory.id }));
      assert.deepEqual(reopened, stored);
      assert.equal(reopened.memory.revision, 1);
      assert.equal(reopened.memory.filing.status, 'unfiled');
      assert.equal(reopened.receipts.length, 1);
      assert.equal(reopened.receipts[0].excerpt, canary);
    }
    assert.equal(ok(await cold.capture(batch)).duplicate, true);
    assert.equal(f.calls.length, 4, 'duplicate capture cannot retry either model stage');
    assert.deepEqual(f.events, [event(reason)]);
    assert.equal(Object.isFrozen(f.events[0]), true);
    for (const value of [canary, namespace.ownerId, namespace.projectId, batch.eventId,
      ...before.map(stored => stored.memory.id)]) assert.equal(JSON.stringify(f.events).includes(value), false);
  });
});

test('CR4: missing alias fails in adapter before core proposal validation', async t => {
  const f = fixture(t, input => ({ items: input.memories.map(memory => ({ memoryId: 'missing-alias', parentIds: [] })) }));
  const result = ok(await f.core.capture(batch));
  assert.deepEqual(result.classification, { status: 'failed', error: { code: 'invalid_model_output', retryable: false } });
  assert.deepEqual(f.decoded, []);
  assert.deepEqual(f.events, [
    { version: 1, stage: 'classify', layer: 'adapter', reason: 'output_shape' },
    { version: 1, stage: 'classify', layer: 'core_call', reason: 'adapter_output_invalid' },
  ]);
  assert.equal(f.calls.length, 4);
});

test('CR4: 120-codepoint titles file normally while a storage title conflict stays distinct', async t => {
  for (const title of ['x'.repeat(120), '😀'.repeat(120)]) await t.test('valid title boundary', async t => {
    const f = fixture(t, input => ({ items: input.memories.map(memory => ({ memoryId: memory.id, parentIds: [],
      newL1: { title, parentL2Ids: [] } })) }));
    const result = ok(await f.core.capture(batch));
    assert.equal(f.decoded.length, 1);
    assert.equal(result.classification.status, 'applied');
    assert.deepEqual(f.events, []);
    assert.equal(f.calls.length, 4);
    for (const { id } of result.admission.memories) {
      const stored = ok(f.core.get({ namespace, memoryId: id }));
      assert.equal(stored.memory.filing.status, 'filed');
      assert.equal(stored.placements[0].title, title);
      assert.equal(stored.receipts[0].excerpt, canary);
    }
  });
  await t.test('storage conflict', async t => {
    const f = fixture(t, input => ({ items: input.memories.map(memory => ({ memoryId: memory.id, parentIds: [],
      newL1: { title: 'Synthetic seed leaf 0', parentL2Ids: [] } })) }));
    seedTopics(f.core);
    const result = ok(await f.core.capture(batch));
    assert.equal(f.decoded.length, 1);
    assert.deepEqual(result.classification, { status: 'failed', error: { code: 'moc_title_conflict', retryable: false } });
    assert.deepEqual(f.events, [], 'storage rejection is outside core proposal validation');
    assert.equal(f.calls.length, 4);
    for (const { id } of result.admission.memories) {
      const stored = ok(f.core.get({ namespace, memoryId: id }));
      assert.equal(stored.memory.filing.status, 'unfiled');
      assert.equal(stored.receipts[0].excerpt, canary);
    }
  });
});

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createMemoryAdapter } from '@cairn-ink/adapter-memory';
import { CoreError, placePending } from '@cairn-ink/core';

const openGate = { async assertOpen() {} };

test('placePending classifies and applies on the memory adapter', async () => {
  const ids = ['memory-a', 'topic-a'];
  const { uow, memories, placement } = createMemoryAdapter({
    capabilities: { placement: true }, now: () => 10, newId: () => ids.shift(),
  });
  const scope = { owner: 'owner', namespace: null };
  const query = { cursor: null, limit: 10 };
  const text = 'Sequence diagrams explain protocol handshakes.';
  const memory = await uow.run(scope.owner, { pauseLock: true }, (tx) => memories.insert(tx, scope, {
    kind: 'fact', origin: 'explicit', text, textHash: 'sha256:' + '1'.repeat(64),
    confidence: 1, embedding: null, source: { kind: 'mcp', client: null, sessionId: null },
  }, [], 10));
  const { indexRevision } = await uow.run(scope.owner, { readOnly: true }, (tx) => placement.catalog(tx, scope, query));
  const calls = [];
  const model = {
    model: 'scripted',
    contextWindow: 8192,
    countTokens: () => 1,
    async call(stage, request) {
      calls.push({ stage, input: request.input });
      return { items: [{ memoryId: 'm0', parentIds: [],
        newL1: { title: 'Protocol diagrams', parentL2Ids: [] } }] };
    },
  };
  const topic = { id: 'topic-a', level: 'L1', title: 'Protocol diagrams', parentIds: [] };
  const options = { uow, scope, placement, memories, model, gate: openGate };
  assert.deepEqual(await placePending(options), {
    status: 'applied', placed: [{ memoryId: memory.id, topicIds: [topic.id] }], createdTopics: [topic],
  });
  assert.deepEqual(await placePending(options), { status: 'idle' });
  assert.deepEqual(calls, [{ stage: 'classify', input: {
    memories: [{ id: 'm0', revision: memory.revision, kind: 'fact', content: text }], map: [], mapExhausted: true,
  } }]);
  await uow.run(scope.owner, { readOnly: true }, async (tx) => {
    const page = await placement.catalog(tx, scope, query);
    assert.equal(page.indexRevision, indexRevision + 1);
    assert.deepEqual(page.items, [topic]);
    assert.deepEqual(await placement.forMemory(tx, scope, memory.id), [topic.id]);
  });
});

async function pendingFixture(output = { items: [{ memoryId: 'm0', parentIds: [] }] }) {
  const { uow, memories, placement } = createMemoryAdapter({
    capabilities: { placement: true }, newId: () => 'queued-memory',
  });
  const scope = { owner: 'owner', namespace: null };
  const { id: memoryId, revision } = await uow.run(scope.owner, { pauseLock: true }, (tx) => memories.insert(tx, scope, {
    kind: 'fact', origin: 'explicit', text: 'A queued memory.', textHash: 'sha256:' + '2'.repeat(64),
    confidence: 1, embedding: null, source: { kind: 'mcp', client: null, sessionId: null },
  }, [], 10));
  let modelCalls = 0;
  const model = {
    model: 'scripted', contextWindow: 8192, countTokens: () => 1,
    async call() {
      modelCalls++;
      return output;
    },
  };
  const options = { uow, scope, memories, placement, model, gate: openGate };
  return {
    placement, memory: { memoryId, revision },
    run: (overrides) => placePending({ ...options, ...overrides }),
    pending: () => uow.run(scope.owner, { readOnly: true }, (tx) => placement.pending(tx, scope, { limit: 5 })),
    calls: () => modelCalls,
    applied: { status: 'applied', placed: [{ memoryId, topicIds: [] }], createdTopics: [] },
  };
}

test('a batch paused at dispatch leaves the memory pending for the next open batch', async () => {
  const f = await pendingFixture();
  const gate = {
    async assertOpen(_owner, phase) {
      if (phase === 'dispatch') throw new CoreError('capture_paused');
    },
  };
  assert.deepEqual(await f.run({ gate }), { status: 'failed', error: { code: 'capture_paused', retryable: false } });
  assert.equal(f.calls(), 0);
  assert.deepEqual(await f.pending(), [f.memory]);
  assert.deepEqual(await f.run(), f.applied);
  assert.equal(f.calls(), 1);
});

test('a batch hit by storage_busy during apply leaves the memory pending for the next batch', async () => {
  const f = await pendingFixture();
  let attempts = 0;
  const placement = {
    ...f.placement,
    async applyPlacement(...args) {
      if (++attempts === 1) throw new CoreError('storage_busy');
      return f.placement.applyPlacement(...args);
    },
  };
  assert.deepEqual(await f.run({ placement }), { status: 'failed', error: { code: 'storage_busy', retryable: true } });
  assert.equal(f.calls(), 1);
  assert.deepEqual(await f.pending(), [f.memory]);
  assert.deepEqual(await f.run({ placement }), f.applied);
  assert.equal(f.calls(), 2);
  assert.equal(attempts, 2);
});

test('a batch with invalid model output records the failure and is skipped on the next run', async () => {
  const f = await pendingFixture({ items: [] });
  assert.deepEqual(await f.run(), { status: 'failed', error: { code: 'invalid_model_output', retryable: false } });
  assert.deepEqual(await f.pending(), []);
  assert.deepEqual(await f.run(), { status: 'idle' });
  assert.equal(f.calls(), 1);
});

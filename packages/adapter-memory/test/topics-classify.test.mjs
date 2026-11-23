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

async function pendingFixture({ output, count = 1, ...adapterOptions } = {}) {
  let ids = 0;
  const { uow, memories, placement, harness } = createMemoryAdapter({
    capabilities: { placement: true }, newId: () => `queued-memory-${++ids}`, now: () => 100, ...adapterOptions,
  });
  const scope = { owner: 'owner', namespace: null };
  const content = {
    kind: 'fact', origin: 'explicit', text: 'A queued memory.', textHash: 'sha256:' + '2'.repeat(64),
    confidence: 1, embedding: null, source: { kind: 'mcp', client: null, sessionId: null },
  };
  const queued = await uow.run(scope.owner, { pauseLock: true }, async (tx) => {
    const rows = [];
    for (let i = 0; i < count; i++) {
      const { id: memoryId, revision } = await memories.insert(tx, scope, {
        ...content, text: `Queued memory ${i + 1}.`, textHash: 'sha256:' + String(i + 1).repeat(64),
      }, [], 10 + i);
      rows.push({ memoryId, revision });
    }
    return rows;
  });
  const [memory] = queued;
  let modelCalls = 0;
  const model = {
    model: 'scripted', contextWindow: 8192, countTokens: () => 1,
    async call(_stage, { input }) {
      modelCalls++;
      return output ?? { items: input.memories.map(({ id }) => ({ memoryId: id, parentIds: [] })) };
    },
  };
  const options = { uow, scope, memories, placement, model, gate: openGate };
  return {
    placement, memory, queued, advanceClock: harness.advanceClock,
    run: (overrides) => placePending({ ...options, ...overrides }),
    pending: () => uow.run(scope.owner, { readOnly: true }, (tx) => placement.pending(tx, scope, { limit: 5 })),
    async failures() {
      const [owner] = await harness.dump();
      return owner.topics[0]?.failures ?? [];
    },
    async revise() {
      const { memoryId, revision } = memory;
      const row = await uow.run(scope.owner, { pauseLock: true }, (tx) => memories.replaceContent(tx, scope,
        memoryId, revision, { ...content, text: 'Revised memory.' }, null, 20));
      return { memoryId, revision: row.revision };
    },
    calls: () => modelCalls,
    applied: applied(queued.slice(0, 5)),
  };
}

function applied(memories) {
  return { status: 'applied', placed: memories.map(({ memoryId }) => ({ memoryId, topicIds: [] })), createdTopics: [] };
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
  assert.deepEqual(await f.failures(), []);
  assert.deepEqual(await f.pending(), [f.memory]);
  assert.deepEqual(await f.run(), f.applied);
  assert.equal(f.calls(), 1);
});

test('storage_busy during apply gives other memories a turn and retries after the configured window', async () => {
  const retryAfterMs = 100;
  const f = await pendingFixture({ count: 6, topicRetryAfterMs: retryAfterMs });
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
  const failures = await f.failures();
  assert.deepEqual(await f.run({ placement }), applied(f.queued.slice(5)));
  assert.deepEqual(failures.map(([id, { revision, code }]) => ({ memoryId: id, revision, code })),
    f.queued.slice(0, 5).map((memory) => ({ ...memory, code: 'storage_busy' })));
  await f.advanceClock(retryAfterMs - 1);
  assert.deepEqual(await f.run({ placement }), { status: 'idle' });
  await f.advanceClock(1);
  assert.deepEqual(await f.pending(), f.queued.slice(0, 5));
  assert.deepEqual(await f.run({ placement }), f.applied);
  assert.equal(f.calls(), 3);
  assert.equal(attempts, 3);
});

test('three retryable failures exhaust attempts until the memory revision changes', async () => {
  const f = await pendingFixture();
  const placement = {
    ...f.placement,
    async applyPlacement() { throw new CoreError('storage_busy'); },
  };
  for (let attempt = 0; attempt < 3; attempt++) {
    assert.deepEqual(await f.run({ placement }), { status: 'failed', error: { code: 'storage_busy', retryable: true } });
    await f.advanceClock(3_600_000);
  }
  assert.deepEqual(await f.pending(), []);
  assert.deepEqual(await f.run(), { status: 'idle' });
  assert.deepEqual(await f.pending(), []);
  const revised = await f.revise();
  assert.notEqual(revised.revision, f.memory.revision);
  assert.deepEqual(await f.pending(), [revised]);
  assert.deepEqual(await f.run(), f.applied);
});

test('a batch with invalid model output records the failure and is skipped on the next run', async () => {
  const f = await pendingFixture({ output: { items: [] } });
  assert.deepEqual(await f.run(), { status: 'failed', error: { code: 'invalid_model_output', retryable: false } });
  assert.deepEqual(await f.pending(), []);
  assert.deepEqual(await f.run(), { status: 'idle' });
  assert.equal(f.calls(), 1);
});

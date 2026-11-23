import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createMemoryAdapter } from '@cairn-ink/adapter-memory';
import { placePending } from '@cairn-ink/core';

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
  const options = { uow, scope, placement, memories, model };
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

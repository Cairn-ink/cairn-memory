import assert from 'node:assert/strict';
import { test } from 'node:test';
import { placePending, placePendingBatch, placePendingCards, placePendingCardsBatch } from '../src/topics/index.mjs';

const scope = { owner: 'owner', namespace: 'notes' };
const gate = { async assertOpen() {} };
const memory = { id: 'memory', revision: 1, kind: 'fact', text: 'Travel notes. '.repeat(10).slice(0, 120) };

function fixture(size) {
  const topics = Array.from({ length: size }, (_, index) => ({
    id: String(index), level: 'L1', title: 'Topic ' + String(index).padStart(3, '0'),
  }));
  const card = {
    id: 'card', scope, origin: 'import', title: 'Travel', body: 'Travel notes',
    contentHash: 'hash', sourceMessage: null, sourceMemories: [],
  };
  const options = {
    scope, gate,
    uow: { async run(_owner, _options, fn) { return fn({}); } },
    memories: {
      async get() { return memory; },
      async readRevision() { return { revision: memory.revision }; },
    },
    documentCards: {
      async get() { return card; },
      async visibilityInputs() { return [{ card, textFacts: [] }]; },
    },
    fence: { async assertVisible(_tx, _scope, refs) { return refs; } },
    placement: {
      async pending() { return [{ memoryId: memory.id, revision: memory.revision }]; },
      async pendingCards() { return [{ cardId: card.id, contentHash: card.contentHash }]; },
      async catalog(_tx, _scope, { cursor, limit }) {
        const offset = Number(cursor);
        const items = topics.slice(offset, offset + limit);
        const end = offset + items.length;
        const exhausted = end === topics.length;
        return { items, nextCursor: exhausted ? null : String(end), exhausted, indexRevision: 7 };
      },
      async applyPlacement() { return { placed: [], createdTopics: [] }; },
      async applyCardPlacement() { return { placed: [] }; },
    },
  };
  return { topics, options };
}

function assertCatalog(input, topics, count, exhausted) {
  assert.equal(input.map.length, count);
  assert.deepEqual(input.map.map(({ moc }) => moc.title), topics.slice(0, count).map(({ title }) => title));
  assert.equal(input.mapExhausted, exhausted);
}

test('the model receives all 150 short titles with a cap of 200 and stops at the cap for 250', async () => {
  for (const [size, limit, count, exhausted] of [
    [150, {}, 100, false],
    [150, { catalogLimit: 200 }, 150, true],
    [250, { catalogLimit: 200 }, 200, false],
  ]) {
    const { topics, options } = fixture(size);
    const inputs = [];
    const model = {
      model: 'scripted', contextWindow: 8192,
      countTokens: (text) => Math.ceil(Buffer.byteLength(text) / 3),
      async call(_stage, { input }) {
        inputs.push(input);
        return { items: input.memories.map(({ id }) => ({ memoryId: id, parentIds: [] })) };
      },
    };
    assert.equal((await placePending({ ...options, ...limit, model })).status, 'applied');
    assert.equal(inputs.length, 1);
    assertCatalog(inputs[0], topics, count, exhausted);
  }
});

test('a batch caps an unfinished catalog at 200 and accepts the minimum of 1', async () => {
  const { topics, options } = fixture(250);
  for (const catalogLimit of [200, 1]) {
    const result = await placePendingBatch({
      ...options, catalogLimit,
      async classify({ memories }, catalog) {
        assertCatalog(catalog, topics, catalogLimit, false);
        return { items: memories.map(({ id }) => ({ memoryId: id, parentIds: [] })) };
      },
    });
    assert.equal(result.status, 'applied');
  }
});

test('both card entry points honor the larger cap and disable topic creation', async () => {
  const { topics, options } = fixture(150);
  const batch = await placePendingCardsBatch({
    ...options, catalogLimit: 200,
    async classify({ cards }, catalog) {
      assertCatalog(catalog, topics, 150, false);
      return { items: cards.map(({ cardId }) => ({ cardId, parentIds: [] })) };
    },
  });
  assert.equal(batch.status, 'applied');

  const inputs = [];
  const model = {
    model: 'scripted', contextWindow: 8192, countTokens: () => 1,
    async call(_stage, { input }) {
      inputs.push(input);
      return { items: input.memories.map(({ id }) => ({ memoryId: id, parentIds: [] })) };
    },
  };
  assert.equal((await placePendingCards({ ...options, catalogLimit: 200, model })).status, 'applied');
  assert.equal(inputs.length, 1);
  assertCatalog(inputs[0], topics, 150, false);
});

test('invalid limits fail before touching storage or calling classification', async () => {
  const { options } = fixture(1);
  const rejectCall = () => assert.fail('unexpected call');
  for (const run of [placePending, placePendingBatch, placePendingCards, placePendingCardsBatch]) {
    for (const catalogLimit of [0, -1, 201, 1.5, NaN, Infinity, '200', null, true, {}]) {
      await assert.rejects(run({
        ...options, catalogLimit,
        uow: { run: rejectCall }, model: { call: rejectCall }, classify: rejectCall,
      }), { code: 'invalid_input' });
    }
  }
});

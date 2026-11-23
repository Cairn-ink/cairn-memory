import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createMemoryAdapter } from '@cairn-ink/adapter-memory';
import { coreDigest, placePendingCards, placePendingCardsBatch } from '@cairn-ink/core';
import { buildDocumentCard } from '@cairn-ink/core/routing';

const personal = { owner: 'owner', namespace: null };
const team = { ...personal, namespace: 'team' };
const page = { cursor: null, limit: 10 };
const gate = { async assertOpen() {} };
const guard = ({ id: cardId, contentHash }) => ({ cardId, contentHash });
const imported = (id, scope = personal) => ({
  id, scope, origin: 'import', title: 'Imported note', body: 'An imported note about diagrams.',
  contentHash: 'imported-hash', date: null, sourceMessage: null, sourceMemories: [], sentences: [], stale: [],
});
const revised = (card) => ({ ...card, body: 'Revised note.', contentHash: 'revised-hash' });
const modelWith = (call) => ({ model: 'scripted', contextWindow: 8192, countTokens: () => 1, call });
const memoryInput = (text, digit) => ({
  kind: 'fact', origin: 'explicit', text, textHash: 'sha256:' + digit.repeat(64), confidence: 1,
  embedding: null, source: { kind: 'mcp', client: null, sessionId: null },
});

function fixture() {
  let seq = 0;
  const adapter = createMemoryAdapter({
    capabilities: { placement: true, documentCards: true, supersession: true },
    now: () => 100, newId: () => 'row-' + ++seq,
  });
  const { uow, memories, placement, documentCards } = adapter;
  const read = (fn) => uow.run(personal.owner, { readOnly: true }, fn);
  const write = (fn) => uow.run(personal.owner, { pauseLock: true }, fn);
  const put = (card) => write((tx) => documentCards.put(tx, card.scope, card));
  const insert = (text, digit) => write((tx) => memories.insert(tx, personal, memoryInput(text, digit), [], 1));
  async function topic() {
    const { id: memoryId, revision } = await insert('Independent heading source', 'a');
    const { createdTopics } = await write(async (tx) => {
      const { indexRevision } = await placement.catalog(tx, personal, page);
      return placement.applyPlacement(tx, personal, { indexRevision, memoryRevisions: [{ memoryId, revision }] }, {
        items: [{ memoryId, parentIds: [], newL1: { title: 'Diagrams', parentL2Ids: [] } }],
      });
    });
    return createdTopics[0].id;
  }
  const pendingCards = () => read((tx) => placement.pendingCards(tx, personal, { limit: 5 }));
  const applyCard = (card, topicId) => write(async (tx) => {
    const { indexRevision } = await placement.catalog(tx, personal, page);
    return placement.applyCardPlacement(tx, personal, { indexRevision, cards: [guard(card)] }, {
      items: [{ cardId: card.id, parentIds: [topicId] }],
    });
  });
  async function withhold(card) {
    await adapter.harness.seedFact(personal.owner, {
      ...personal, kind: 'text', mode: 'exact', origin: 'forget', actionId: 'withhold-import',
      text: { digests: [await coreDigest(card.body)] },
    });
  }
  return { adapter, ...adapter, scope: personal, gate, read, write, put, insert, topic, pendingCards, applyCard, withhold };
}

test('card classification uses one scope for reads, freshness, fencing and dispatch', async () => {
  const f = fixture();
  const card = { ...imported('shared'), body: 'Withheld personal text about a private draft.' };
  await f.put(card);
  await f.put(imported(card.id, team));
  await f.withhold(card);
  let teamNext = false;
  let ownerReads = 0;
  let namespaceReads = 0;
  const scope = {
    get owner() { ownerReads++; return personal.owner; },
    get namespace() {
      namespaceReads++;
      const namespace = teamNext ? team.namespace : personal.namespace;
      teamNext = false;
      return namespace;
    },
  };
  const documentCards = {
    async get(...args) {
      const result = await f.documentCards.get(...args);
      teamNext = true;
      return result;
    },
  };
  const dispatched = [];
  const model = modelWith(async (_stage, { input }) => {
    dispatched.push(...input.memories.map(({ content }) => content));
    return { items: input.memories.map(({ id }) => ({ memoryId: id, parentIds: [] })) };
  });
  const result = await placePendingCards({ ...f, scope, documentCards, model });
  assert.deepEqual(dispatched, [], 'A visible team card must never clear the withheld personal text');
  assert.deepEqual(result, { status: 'idle' });
  assert.deepEqual([ownerReads, namespaceReads], [1, 1]);
});

test('topic list and members check card visibility in the membership namespace', async () => {
  const f = fixture();
  const topicId = await f.topic();
  const card = imported('shared');
  await f.put(card);
  await f.put(imported(card.id, team));
  await f.applyCard(card, topicId);
  await f.withhold(card);
  function flippingScope() {
    let reads = 0;
    return { owner: personal.owner, get namespace() { return reads++ < 2 ? personal.namespace : team.namespace; } };
  }
  const [listed, members] = await f.read(async (tx) => [
    await f.placement.list(tx, flippingScope(), page),
    await f.placement.members(tx, flippingScope(), topicId, page),
  ]);
  assert.deepEqual({
    cardCount: listed.items.find(({ id }) => id === topicId)?.cardCount,
    cards: members.items.filter(({ kind }) => kind === 'card'),
  }, { cardCount: 0, cards: [] });
});

test('a router card with a historical source is skipped so a healthy import can be placed', async () => {
  const f = fixture();
  const topicId = await f.topic();
  const { id, revision } = await f.insert('Original router source', 'b');
  const sourceMessage = { client: 'client', sessionId: 'session', messageId: 'message' };
  const { card } = await buildDocumentCard({
    id: sourceMessage.messageId, role: 'user', content: 'Router note\n\nIts old source has been superseded.',
  }, { scope: personal, client: sourceMessage.client, canonicalSessionKey: sourceMessage.sessionId });
  assert.ok(card);
  const stale = {
    ...imported(card.id), origin: 'router', title: card.title, body: card.body, sourceMessage,
    sourceMemories: [{ id, revision }],
  };
  const healthy = imported('healthy');
  await f.put(stale);
  await f.put(healthy);
  await f.write((tx) => f.supersession.markHistorical(tx, personal, id, 2));
  const ref = { type: 'card', id: card.id, namespace: personal.namespace };
  assert.deepEqual(await f.read((tx) =>
    f.fence.assertVisible(tx, { owner: personal.owner, namespaces: [personal.namespace] }, [ref])), [ref]);
  const pending = await f.pendingCards();
  const batched = [];
  const result = await placePendingCardsBatch({
    ...f,
    async classify({ cards }, _catalog, { validateFresh }) {
      await validateFresh();
      batched.push(...cards.map(({ cardId, contentHash }) => ({ cardId, contentHash })));
      return { items: cards.map(({ cardId }) => ({ cardId, parentIds: [topicId] })) };
    },
  });
  assert.deepEqual({ pending, batched, result }, {
    pending: [guard(healthy)], batched: [guard(healthy)],
    result: { status: 'applied', placed: [{ cardId: healthy.id, topicIds: [topicId] }] },
  });
  assert.deepEqual(await f.pendingCards(), []);
});

test('reverting a replacement cannot revive the old card placement or failure', async () => {
  const f = fixture();
  const topicId = await f.topic();
  const original = imported('reverted');
  await f.put(original);
  await f.applyCard(original, topicId);
  await f.write((tx) => f.placement.markCardsFailed(tx, personal, [original.id], 'source_excluded'));
  assert.deepEqual(await f.put(revised(original)), { status: 'replaced' });
  assert.deepEqual(await f.put(original), { status: 'replaced' });
  await f.read(async (tx) => {
    assert.deepEqual({
      single: await f.placement.forCard(tx, personal, original.id),
      batch: await f.placement.forCards(tx, personal, [original.id]),
      members: (await f.placement.members(tx, personal, topicId, page)).items.filter(({ kind }) => kind === 'card'),
      pending: await f.placement.pendingCards(tx, personal, { limit: 5 }),
    }, { single: [], batch: [], members: [], pending: [guard(original)] });
  });
  assert.deepEqual((await f.harness.dump())[0].topics[0].cardFailures, []);
});

test('a 201-character import id works from pending through model aliases, membership and drop', async () => {
  const f = fixture();
  const topicId = await f.topic();
  const prefix = 'https://example.test/documents/';
  const card = imported(prefix.padEnd(201, 'a'));
  assert.equal(card.id.length, 201);
  assert.deepEqual(await f.put(card), { status: 'inserted' });
  assert.deepEqual(await f.pendingCards(), [guard(card)]);
  const requests = [];
  const model = modelWith(async (_stage, { input }) => {
    requests.push(input);
    return { items: [{ memoryId: 'm0', parentIds: ['c0'] }] };
  });
  assert.deepEqual(await placePendingCards({ ...f, model }), {
    status: 'applied', placed: [{ cardId: card.id, topicIds: [topicId] }],
  });
  assert.equal(requests.length, 1);
  assert.deepEqual(requests[0].memories.map(({ id }) => id), ['m0']);
  assert.deepEqual(requests[0].map.map(({ moc }) => moc.id), ['c0']);
  await f.read(async (tx) => {
    assert.deepEqual(await f.placement.forCard(tx, personal, card.id), [topicId]);
    assert.deepEqual(await f.placement.forCards(tx, personal, [card.id]), [{
      cardId: card.id, topics: [{ id: topicId, title: 'Diagrams' }],
    }]);
  });
  assert.deepEqual(await f.write((tx) => f.placement.dropCard(tx, personal, card.id)), { dropped: 1 });
  assert.deepEqual(await f.read((tx) => f.placement.forCard(tx, personal, card.id)), []);
});

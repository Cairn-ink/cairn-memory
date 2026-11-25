import assert from 'node:assert/strict';
import { test } from 'node:test';
import { classifyPlacement, CoreError, placePendingCards, placePendingCardsBatch } from '../src/index.mjs';
import { documentCardVisible } from '../src/routing/index.mjs';

const scope = { owner: 'owner', namespace: 'notes' };
const topic = { id: 'child', level: 'L1', title: 'Diagrams', parentIds: [] };
const record = {
  id: 'card', scope, origin: 'import', sourceMessage: null, sourceMemories: [],
  title: 'Diagram guide', body: 'A diagram explains a handshake.', contentHash: 'hash',
  date: null, sentences: [], stale: [],
};
const open = { async assertOpen() {} };
const modelWith = (call) => ({ model: 'scripted', contextWindow: 8192, countTokens: () => 1, call });
const reply = (parentIds = ['c0']) => ({ items: [{ memoryId: 'm0', parentIds }] });
const content = record.title + '\n\n' + record.body;

function fixture({ cards = [record], memoryStates = new Map(), excluded = [], beforeApply } = {}) {
  const records = new Map(cards.map((card) => [card.id, card]));
  const pending = cards.map(({ id, contentHash }) => ({ cardId: id, contentHash }));
  const writes = [];
  const receipts = [];
  let activeTx;
  const options = {
    scope, gate: open,
    uow: {
      async run(owner, { readOnly = false }, fn) {
        assert.equal(owner, scope.owner);
        assert.equal(activeTx, undefined);
        if (!readOnly && beforeApply) {
          beforeApply(records);
          beforeApply = undefined;
        }
        activeTx = { readOnly };
        try {
          return await fn(activeTx);
        } finally {
          activeTx = undefined;
        }
      },
    },
    placement: {
      async pendingCards(tx, actualScope, { limit }) {
        assert.equal(tx, activeTx);
        assert.equal(tx.readOnly, true);
        assert.deepEqual(actualScope, scope);
        assert.equal(limit, 5);
        return pending.filter(({ cardId }) => !receipts.some(({ ids }) => ids.includes(cardId)));
      },
      async catalog(tx) {
        assert.equal(tx, activeTx);
        return { items: [topic], exhausted: true, indexRevision: 4 };
      },
      async applyCardPlacement(tx, actualScope, basedOn, proposal) {
        assert.equal(tx, activeTx);
        assert.equal(tx.readOnly, false);
        assert.deepEqual(actualScope, scope);
        assert.equal(basedOn.indexRevision, 4);
        for (const { cardId, contentHash } of basedOn.cards) {
          if (records.get(cardId)?.contentHash !== contentHash) throw new CoreError('revision_conflict');
        }
        writes.push({ basedOn, proposal });
        return { placed: proposal.items.map(({ cardId, parentIds }) => ({ cardId, topicIds: parentIds })) };
      },
      async markCardsFailed(tx, actualScope, ids, code) {
        assert.equal(tx, activeTx);
        assert.equal(tx.readOnly, false);
        assert.deepEqual(actualScope, scope);
        receipts.push({ ids, code });
      },
    },
    documentCards: {
      async get(tx, actualScope, id) {
        assert.equal(tx, activeTx);
        assert.deepEqual(actualScope, scope);
        return records.get(id) ?? null;
      },
    },
    fence: {
      async assertVisible(tx, selection, refs) {
        assert.equal(tx, activeTx);
        assert.equal(tx.readOnly, true);
        assert.deepEqual(selection, { owner: scope.owner, namespaces: [scope.namespace] });
        const visible = [];
        for (const ref of refs) {
          assert.equal(ref.type, 'card');
          assert.equal(ref.namespace, scope.namespace);
          if (excluded.includes(ref.id)) continue;
          const verdict = await documentCardVisible({
            card: records.get(ref.id), requestedScope: scope, memoryStates, textFacts: [],
          });
          if (verdict.visible) visible.push(ref);
        }
        return visible;
      },
    },
  };
  return { options, records, writes, receipts, inRun: () => activeTx !== undefined };
}

test('an unexpected newL1 from the model becomes unfiled without creating a topic', async () => {
  const { options, writes, inRun } = fixture();
  const model = modelWith(async (_stage, request) => {
    assert.equal(inRun(), false);
    assert.deepEqual(request.input.memories.map(({ content }) => content), [content]);
    return { items: [{ ...reply([]).items[0], newL1: { title: 'Do not create', parentL2Ids: [] } }] };
  });
  assert.deepEqual(await placePendingCards({ ...options, model }), {
    status: 'applied', placed: [{ cardId: record.id, topicIds: [] }],
  });
  assert.deepEqual(writes, [{
    basedOn: { indexRevision: 4, cards: [{ cardId: record.id, contentHash: record.contentHash }] },
    proposal: { items: [{ cardId: record.id, parentIds: [] }] },
  }]);
});

test('allowNewTopics false packs a request with mapExhausted false', async () => {
  let calls = 0;
  const model = modelWith(async (_stage, { input }) => {
    calls++;
    assert.equal(input.mapExhausted, false);
    return reply();
  });
  const { basedOn } = await classifyPlacement({
    model, allowNewTopics: false, async validateFresh() {},
    snapshot: { indexRevision: 4, memories: [{ id: record.id, revision: 1, kind: 'context', content: record.body }] },
    catalog: { map: [{ type: 'moc', moc: topic }], mapExhausted: true },
  });
  assert.equal(calls, 1);
  assert.equal(basedOn.mapExhausted, false);
});

test('a closed gate sends no request and leaves the card pending', async () => {
  const { options, writes, receipts } = fixture();
  const gate = { async assertOpen() { throw new CoreError('capture_paused'); } };
  const model = modelWith(async () => assert.fail('The gate must prevent dispatch'));
  assert.deepEqual(await placePendingCards({ ...options, model, gate }), {
    status: 'failed', error: { code: 'capture_paused', retryable: false },
  });
  assert.deepEqual([writes, receipts], [[], []]);
});

test('a fence-hidden card is never packed or sent and gets source_excluded', async () => {
  const hidden = { ...record, id: 'hidden', title: 'Private title', body: 'Private body' };
  const { options, receipts } = fixture({ cards: [hidden, record], excluded: [hidden.id] });
  const model = {
    ...modelWith(async (_stage, { input }) => {
      assert.deepEqual(input.memories.map(({ content }) => content), [content]);
      return reply();
    }),
    countTokens(text) {
      assert.doesNotMatch(text, /Private title|Private body/);
      return 1;
    },
  };
  assert.equal((await placePendingCards({ ...options, model })).status, 'applied');
  assert.deepEqual(receipts, [{ ids: [hidden.id], code: 'source_excluded' }]);
});

test('a card hidden after freshness and before apply leaves no placement', async () => {
  const { options, writes } = fixture({ beforeApply: (records) => records.delete(record.id) });
  const model = modelWith(async () => reply());
  assert.deepEqual(await placePendingCards({ ...options, model }), {
    status: 'failed', error: { code: 'revision_conflict', retryable: false },
  });
  assert.deepEqual(writes, []);
});

test('a card with a forgotten source never reaches the classifier', async () => {
  const source = { id: 'forgotten', revision: 1 };
  const { options, receipts } = fixture({
    cards: [{ ...record, sourceMemories: [source] }],
    memoryStates: new Map([[source.id, { status: 'forgotten' }]]),
  });
  assert.deepEqual(await placePendingCardsBatch({
    ...options, async classify() { assert.fail('A forgotten source must prevent classification'); },
  }), { status: 'idle' });
  assert.deepEqual(receipts, [{ ids: [record.id], code: 'source_excluded' }]);
});

test('a missing or replaced pending card is skipped without a failure receipt', async () => {
  const missing = { ...record, id: 'missing' };
  const { options, records, receipts, writes } = fixture({ cards: [missing, record] });
  records.delete(missing.id);
  records.set(record.id, { ...record, contentHash: 'new hash' });
  assert.deepEqual(await placePendingCardsBatch({
    ...options, async classify() { assert.fail('Stale pending cards must be skipped'); },
  }), { status: 'idle' });
  assert.deepEqual([writes, receipts], [[], []]);
});

test('a source excluded during the model call receives a terminal receipt', async () => {
  const source = { id: 'source', revision: 1 };
  const memoryStates = new Map([[source.id, { status: 'visible', revision: source.revision, correctedRevisions: [] }]]);
  const { options, writes, receipts } = fixture({ cards: [{ ...record, sourceMemories: [source] }], memoryStates });
  const model = modelWith(async () => {
    memoryStates.set(source.id, { status: 'forgotten' });
    return reply();
  });
  assert.deepEqual(await placePendingCards({ ...options, model }), {
    status: 'failed', error: { code: 'revision_conflict', retryable: false },
  });
  assert.deepEqual(writes, []);
  assert.deepEqual(receipts, [{ ids: [record.id], code: 'source_excluded' }]);
});

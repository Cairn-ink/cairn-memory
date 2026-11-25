import assert from 'node:assert/strict';
import { test } from 'node:test';
import { placePending, placePendingCards } from '../src/index.mjs';

const scope = { owner: 'owner', namespace: null };
const memory = { id: 'memory', revision: 1, kind: 'fact', text: 'A private note.' };
const card = { id: 'card', contentHash: 'hash', title: 'Private notes', body: 'A private draft.',
  scope, origin: 'import', sourceMessage: null, sourceMemories: [] };

for (const kind of ['memory', 'card']) {
  test(`a ${kind} hidden while the pre-send gate is pending never reaches the classifier`, async () => {
    let hidden = false;
    let active = false;
    let calls = 0;
    const phases = [];
    const uow = {
      async run(_owner, { readOnly = false }, fn) {
        assert.equal(active, false);
        active = true;
        const tx = { hidden, readOnly };
        try {
          const result = await fn(tx);
          if (!readOnly) hidden = tx.hidden;
          return result;
        } finally { active = false; }
      },
    };
    const placement = {
      async pending() { return [{ memoryId: memory.id, revision: memory.revision }]; },
      async pendingCards() { return [{ cardId: card.id, contentHash: card.contentHash }]; },
      async catalog() { return { indexRevision: 1, items: [], exhausted: true }; },
      async markFailed() {},
      async markCardsFailed() {},
    };
    const gate = { async assertOpen(owner, phase) {
      phases.push(phase);
      if (phase === 'pre-send') await uow.run(owner, {}, tx => { tx.hidden = true; });
    } };
    const model = { contextWindow: 8192, countTokens: () => 1, async call() {
      assert.equal(active, false);
      calls++;
      return { items: [{ memoryId: 'm0', parentIds: [] }] };
    } };
    const options = { scope, uow, placement, gate, model };
    const result = kind === 'memory'
      ? await placePending({ ...options, memories: {
        async get(tx) { return tx.hidden ? null : memory; },
        async readRevision(tx) { return tx.hidden ? null : { revision: memory.revision }; },
      } })
      : await placePendingCards({ ...options,
        documentCards: {
          async get() { return card; },
          async visibilityInputs(tx, requestedScope, refs) {
            return refs.map(({ id }) => tx.hidden || id !== card.id ? null :
              { card, requestedScope, memoryStates: new Map(), textFacts: [] });
          },
        },
        fence: { async assertVisible(tx, _scope, refs) { return tx.hidden ? [] : refs; } },
      });
    assert.equal(hidden, true);
    assert.deepEqual(result, { status: 'failed', error: { code: 'revision_conflict', retryable: false } });
    assert.equal(calls, 0, 'Hidden content reached the provider');
    assert.deepEqual(phases, ['pre-send']);
  });
}

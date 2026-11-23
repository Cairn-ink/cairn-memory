import { CoreError, isCoreError } from '../errors.mjs';
import { readClassificationCatalog } from './catalog.mjs';
import { classifyPlacement } from './classify.mjs';

/** @import { ErrorCode } from '../errors.mjs' */
/** @import { ItemRef, StoredDocumentCardRecord, TopicCardGuard, Tx } from '../ports/index.d.ts' */
/** @import { PlacePendingCardsBatchOptions, PlacePendingCardsOptions, PlacePendingCardsResult } from './cards.mjs' */

/** @param {PlacePendingCardsBatchOptions} options @returns {Promise<PlacePendingCardsResult>} */
export function placePendingCardsBatch(options) {
  return runPendingCards(options, (snapshot, catalog, controls) => options.classify(snapshot, catalog, controls));
}

/** @param {PlacePendingCardsOptions} options @returns {Promise<PlacePendingCardsResult>} */
export async function placePendingCards({ model, gate, deadline, signal, onDiagnostic, ...options }) {
  if (typeof gate?.assertOpen !== 'function') throw new CoreError('invalid_input');
  return runPendingCards(options, async ({ cards }, catalog, { validateFresh }, indexRevision) => {
    const memories = cards.map(({ cardId, content }) =>
      ({ id: cardId, revision: 1, kind: /** @type {const} */ ('context'), content }));
    const { proposal } = await classifyPlacement({
      model, snapshot: { memories, indexRevision }, catalog, allowNewTopics: false,
      validateFresh, gate, deadline, owner: options.scope.owner, signal, onDiagnostic,
    });
    return { items: proposal.items.map(({ memoryId: cardId, parentIds }) => ({ cardId, parentIds })) };
  });
}

/**
 * @param {Omit<PlacePendingCardsBatchOptions, 'classify'>} options
 * @param {(...args: [...Parameters<PlacePendingCardsBatchOptions['classify']>, number]) =>
 *   ReturnType<PlacePendingCardsBatchOptions['classify']>} classify
 * @returns {Promise<PlacePendingCardsResult>}
 */
async function runPendingCards({ uow, scope, placement, documentCards, fence }, classify) {
  /** @param {Tx} tx @param {readonly TopicCardGuard[]} guards */
  async function readCards(tx, guards) {
    /** @type {StoredDocumentCardRecord[]} */
    const cards = [];
    for (const { cardId, contentHash } of guards) {
      const card = await documentCards.get(tx, scope, cardId);
      if (card?.id === cardId && card.contentHash === contentHash) cards.push(card);
    }
    return cards;
  }

  /** @param {Tx} tx @param {readonly StoredDocumentCardRecord[]} cards */
  async function visibleIds(tx, cards) {
    if (!cards.length) return new Set();
    const { owner, namespace } = scope;
    const refs = cards.map(({ id }) => /** @type {ItemRef} */ ({ type: 'card', id, namespace }));
    const visible = await fence.assertVisible(tx, { owner, namespaces: [namespace] }, refs);
    return new Set(visible.filter((ref) => ref.type === 'card' && ref.namespace === namespace).map(({ id }) => id));
  }

  /** @param {readonly TopicCardGuard[]} guards @param {ErrorCode} code */
  async function markFailed(guards, code) {
    await uow.run(scope.owner, {}, async (tx) => {
      const cards = await readCards(tx, guards);
      if (cards.length) await placement.markCardsFailed(tx, scope, cards.map(({ id }) => id), code);
    });
  }

  const batch = await uow.run(scope.owner, { readOnly: true }, async (tx) => {
    const pending = await placement.pendingCards(tx, scope, { limit: 5 });
    if (!pending.length) return null;
    const { indexRevision, catalogView } = await readClassificationCatalog(placement, tx, scope);
    const cards = await readCards(tx, pending);
    const visible = await visibleIds(tx, cards);
    /** @type {Parameters<PlacePendingCardsBatchOptions['classify']>[0]} */
    const snapshot = { cards: [] };
    /** @type {TopicCardGuard[]} */
    const hidden = [];
    for (const { id: cardId, contentHash, title, body } of cards) {
      if (visible.has(cardId)) snapshot.cards.push({ cardId, contentHash, content: title + '\n\n' + body });
      else hidden.push({ cardId, contentHash });
    }
    return { snapshot, catalogView: { ...catalogView, mapExhausted: false }, hidden,
      basedOn: { indexRevision, cards: snapshot.cards.map(({ cardId, contentHash }) => ({ cardId, contentHash })) } };
  });
  if (!batch) return { status: 'idle' };

  const { snapshot, catalogView, hidden, basedOn } = batch;
  if (hidden.length) await markFailed(hidden, 'source_excluded');
  if (!snapshot.cards.length) return { status: 'idle' };

  /** @type {TopicCardGuard[]} */
  let newlyExcluded = [];
  const validateFresh = async () => {
    const fresh = await uow.run(scope.owner, { readOnly: true }, async (tx) => {
      const cards = await readCards(tx, basedOn.cards);
      const visible = await visibleIds(tx, cards);
      newlyExcluded = cards.filter(({ id }) => !visible.has(id))
        .map(({ id: cardId, contentHash }) => ({ cardId, contentHash }));
      if (visible.size !== basedOn.cards.length || newlyExcluded.length) return false;
      const { indexRevision } = await placement.catalog(tx, scope, { cursor: null, limit: 1 });
      return indexRevision === basedOn.indexRevision;
    });
    if (!fresh) throw new CoreError('revision_conflict');
  };

  try {
    const proposal = await classify(snapshot, catalogView, { validateFresh }, basedOn.indexRevision);
    const result = await uow.run(scope.owner, {}, (tx) => placement.applyCardPlacement(tx, scope, basedOn, proposal));
    return { status: 'applied', ...result };
  } catch (error) {
    if (!isCoreError(error)) throw error;
    const { code, kind, retryable } = error;
    if (kind !== 'paused') {
      try {
        if (newlyExcluded.length) await markFailed(newlyExcluded, 'source_excluded');
        const remaining = basedOn.cards.filter(({ cardId }) => !newlyExcluded.some((guard) => guard.cardId === cardId));
        if (remaining.length) await markFailed(remaining, code);
      } catch {
        // A failed receipt write cannot replace the original error.
      }
    }
    return { status: 'failed', error: { code, retryable } };
  }
}

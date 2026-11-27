import { CoreError, isCoreError } from '../errors.mjs';
import { visibleDocumentCardRows } from '../routing/visibility.mjs';
import { CLASSIFICATION_CATALOG_LIMIT, isClassificationCatalogLimit, readClassificationCatalog } from './catalog.mjs';
import { classifyPlacement } from './classify.mjs';

/** @import { ErrorCode } from '../errors.mjs' */
/** @import { ItemRef, Scope, StoredDocumentCardRecord, TopicCardGuard, Tx } from '../ports/index.d.ts' */
/** @import { PlacePendingCardsBatchOptions, PlacePendingCardsOptions, PlacePendingCardsResult } from './cards.mjs' */

/** @param {PlacePendingCardsBatchOptions} options @returns {Promise<PlacePendingCardsResult>} */
export function placePendingCardsBatch(options) {
  return runPendingCards(options, (snapshot, catalog, controls) => options.classify(snapshot, catalog, controls));
}

/** @param {PlacePendingCardsOptions} options @returns {Promise<PlacePendingCardsResult>} */
export async function placePendingCards({ model, gate, deadline, signal, onDiagnostic, ...options }) {
  if (typeof gate?.assertOpen !== 'function') throw new CoreError('invalid_input');
  return runPendingCards(options, async ({ cards }, catalog, { validateFresh }, indexRevision, owner) => {
    // Classification uses batch-local IDs, so card IDs have no effect on validation or token sizing.
    const memories = cards.map(({ content }, index) =>
      ({ id: String(index), revision: 1, kind: /** @type {const} */ ('context'), content }));
    const { proposal } = await classifyPlacement({
      model, snapshot: { memories, indexRevision }, catalog, allowNewTopics: false,
      validateFresh, gate, deadline, owner, signal, onDiagnostic,
    });
    return { items: proposal.items.map(({ memoryId, parentIds }) => ({ cardId: cards[Number(memoryId)].cardId, parentIds })) };
  });
}

/**
 * @param {Omit<PlacePendingCardsBatchOptions, 'classify'>} options
 * @param {(...args: [...Parameters<PlacePendingCardsBatchOptions['classify']>, number, Scope['owner']]) =>
 *   ReturnType<PlacePendingCardsBatchOptions['classify']>} classify
 * @returns {Promise<PlacePendingCardsResult>}
 */
async function runPendingCards({
  uow, scope: { owner, namespace }, placement, documentCards, fence, catalogLimit = CLASSIFICATION_CATALOG_LIMIT,
}, classify) {
  if (!isClassificationCatalogLimit(catalogLimit)) throw new CoreError('invalid_input');
  const scope = { owner, namespace };
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
    const refs = cards.map(({ id }) => /** @type {ItemRef} */ ({ type: 'card', id, namespace }));
    const visible = await fence.assertVisible(tx, { owner, namespaces: [namespace] }, refs);
    const shown = new Set(visible.filter((ref) => ref.type === 'card' && ref.namespace === namespace).map(({ id }) => id));
    if (!documentCards.visibilityInputs || !shown.size) return new Set();
    const candidates = refs.filter(({ id }) => shown.has(id));
    const evidence = await documentCards.visibilityInputs(tx, scope, candidates, { requireRaw: false });
    const inputs = new Map(candidates.map((ref, index) => [ref, evidence?.[index]]));
    const { rows } = await visibleDocumentCardRows(candidates.map(ref => ({ ref })), ref => {
      const input = inputs.get(ref);
      return input ? { ...input, requestedScope: scope } : null;
    });
    return new Set(rows.map(({ ref }) => ref.id));
  }

  /** @param {readonly TopicCardGuard[]} guards @param {ErrorCode} code */
  async function markFailed(guards, code) {
    await uow.run(owner, {}, async (tx) => {
      const cards = await readCards(tx, guards);
      if (cards.length) await placement.markCardsFailed(tx, scope, cards.map(({ id }) => id), code);
    });
  }

  const batch = await uow.run(owner, { readOnly: true }, async (tx) => {
    const pending = await placement.pendingCards(tx, scope, { limit: 5 });
    if (!pending.length) return null;
    const { indexRevision, catalogView } = await readClassificationCatalog(placement, tx, scope, catalogLimit);
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

  /** @param {Tx} tx */
  async function indexIsStale(tx) {
    const { indexRevision } = await placement.catalog(tx, scope, { cursor: null, limit: 1 });
    return indexRevision !== basedOn.indexRevision;
  }

  let hashesChanged = false;
  /** @type {TopicCardGuard[]} */
  let newlyExcluded = [];
  const validateFresh = async () => {
    const conflict = await uow.run(owner, { readOnly: true }, async (tx) => {
      const cards = await readCards(tx, basedOn.cards);
      hashesChanged ||= cards.length !== basedOn.cards.length;
      const visible = await visibleIds(tx, cards);
      newlyExcluded = cards.filter(({ id }) => !visible.has(id))
        .map(({ id: cardId, contentHash }) => ({ cardId, contentHash }));
      if (cards.length !== basedOn.cards.length || newlyExcluded.length) return 'revision_conflict';
      return await indexIsStale(tx) ? 'topic_index_moved' : null;
    });
    if (conflict) throw new CoreError(conflict);
  };

  try {
    const proposal = await classify(snapshot, catalogView, { validateFresh }, basedOn.indexRevision, owner);
    const result = await uow.run(owner, {}, (tx) => placement.applyCardPlacement(tx, scope, basedOn, proposal));
    return { status: 'applied', ...result };
  } catch (error) {
    if (!isCoreError(error)) throw error;
    const { code, kind, retryable } = error;
    if (kind !== 'paused') {
      try {
        if (newlyExcluded.length) await markFailed(newlyExcluded, 'source_excluded');
        if (!hashesChanged && !newlyExcluded.length) {
          await uow.run(owner, {}, async (tx) => {
            const cards = await readCards(tx, basedOn.cards);
            if (cards.length !== basedOn.cards.length) return;
            const receiptCode = await indexIsStale(tx) ? 'topic_index_moved' : code;
            const visible = await visibleIds(tx, cards);
            const ids = cards.map(({ id }) => id);
            const excluded = ids.filter((id) => !visible.has(id));
            if (excluded.length) return placement.markCardsFailed(tx, scope, excluded, 'source_excluded');
            await placement.markCardsFailed(tx, scope, ids, receiptCode);
          });
        }
      } catch {
        // A failed receipt write cannot replace the original error.
      }
    }
    return { status: 'failed', error: { code, retryable } };
  }
}

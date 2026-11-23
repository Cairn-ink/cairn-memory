import { CoreError } from "@cairn-ink/core";
import { dropCardMemberships } from "./topics.mjs";
import { validateTime, writeNamespace } from "./validation.mjs";

/** @import { DocumentCardHideSelector, StoredDocumentCardRecord, DocumentCardSourceMessage, DocumentCardStore } from "@cairn-ink/core/ports" */
/** @typedef {ReturnType<typeof import("./unit-of-work.mjs").createUnitOfWork>["port"]} Port */

/** @param {unknown} value */
function requireString(value) {
  if (typeof value !== "string" || !value) throw new CoreError("invalid_input");
}

/** @param {DocumentCardHideSelector} selector */
function selectorMatcher(selector) {
  const { sourceMemoryId, sourceMessage, session } = selector;
  const selectors = [sourceMemoryId, sourceMessage, session].filter((value) => value !== undefined);
  if (selectors.length !== 1) throw new CoreError("invalid_input");
  if (sourceMemoryId !== undefined) {
    requireString(sourceMemoryId);
    return (/** @type {StoredDocumentCardRecord} */ card) => card.sourceMemories.some(({ id }) => id === sourceMemoryId);
  }
  const source = sourceMessage ?? session;
  if (!source) throw new CoreError("invalid_input");
  const { client, sessionId } = source;
  requireString(client);
  requireString(sessionId);
  const messageId = sourceMessage?.messageId;
  if (sourceMessage !== undefined) requireString(messageId);
  return (/** @type {StoredDocumentCardRecord} */ { sourceMessage }) =>
    sourceMessage?.client === client && sourceMessage.sessionId === sessionId &&
    (messageId === undefined || sourceMessage.messageId === messageId);
}

/** @param {Port} port @param {() => number} now @returns {DocumentCardStore<StoredDocumentCardRecord>} */
export function createDocumentCardStore(port, now) {
  /** @param {import("@cairn-ink/core/ports").Tx} tx @param {import("@cairn-ink/core/ports").Scope} scope
   * @param {() => (card: StoredDocumentCardRecord) => boolean} prepare */
  function hideCards(tx, scope, prepare) {
    return port.write(tx, scope, "conditional", () => {
      const namespace = writeNamespace(scope);
      const match = prepare();
      return (getState, _markDirty, run) => {
        const state = getState();
        let hidden = 0;
        for (const [id, entry] of state.documentCards.get(namespace) ?? []) {
          if (!entry.card || !match(entry.card)) continue;
          entry.card = null;
          dropCardMemberships(state, namespace, id);
          hidden++;
        }
        if (hidden) run.cardWrites++;
        return { hidden };
      };
    });
  }

  return {
    async put(tx, scope, card) {
      return port.write(tx, scope, "conditional", () => {
        const namespace = writeNamespace(scope);
        const copy = structuredClone(card);
        requireString(copy?.id);
        requireString(copy.contentHash);
        if (copy.scope?.owner !== tx.owner || copy.scope.namespace !== namespace) throw new CoreError("invalid_input");
        if (!Array.isArray(copy.sourceMemories) || !Array.isArray(copy.stale)) throw new CoreError("invalid_input");
        copy.stale = copy.stale.map(({ memoryId, replacementMemoryId }) => ({ memoryId, replacementMemoryId }));
        return (getState, _markDirty, run) => {
          const state = getState();
          const cards = state.documentCards.get(namespace) ?? new Map();
          const previous = cards.get(copy.id);
          if (previous && !previous.card) return { status: "tombstoned" };
          if (previous?.card?.contentHash === copy.contentHash) return { status: "unchanged" };
          if (previous?.card) {
            if (previous.card.origin === undefined) Reflect.deleteProperty(copy, "origin");
            else Object.assign(copy, { origin: previous.card.origin });
          }
          const createdAtMs = previous?.createdAtMs ?? now();
          validateTime(createdAtMs);
          cards.set(copy.id, { card: copy, createdAtMs });
          state.documentCards.set(namespace, cards);
          run.cardWrites++;
          return { status: previous ? "replaced" : "inserted" };
        };
      });
    },

    async hide(tx, scope, cardId, _reason) {
      await hideCards(tx, scope, () => {
        requireString(cardId);
        return ({ id }) => id === cardId;
      });
    },

    async hideWhere(tx, scope, selector, _reason) {
      return hideCards(tx, scope, () => selectorMatcher(selector));
    },

    async markStale(tx, scope, cardId, { memoryId, replacementMemoryId }) {
      return port.write(tx, scope, "conditional", () => {
        const namespace = writeNamespace(scope);
        requireString(cardId);
        requireString(memoryId);
        requireString(replacementMemoryId);
        const stale = { memoryId, replacementMemoryId };
        return (getState, _markDirty, run) => {
          const entry = getState().documentCards.get(namespace)?.get(cardId);
          if (!entry?.card) return;
          if (!entry.card.stale.some((item) => item.memoryId === memoryId && item.replacementMemoryId === replacementMemoryId)) {
            entry.card = { ...entry.card, stale: [...entry.card.stale, stale] };
          }
          run.cardWrites++;
        };
      });
    },

    async get(tx, scope, cardId) {
      return port(tx, scope, false, (state) => structuredClone(state.documentCards.get(scope.namespace)?.get(cardId)?.card ?? null));
    },

    async list(tx, scope) {
      return port(tx, scope, false, (state) => [...(state.documentCards.get(scope.namespace)?.values() ?? [])]
        .flatMap(({ card }) => card ? [structuredClone(card)] : []));
    },
  };
}

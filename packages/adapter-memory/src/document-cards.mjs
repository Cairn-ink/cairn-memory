import { CoreError, compareUtf8 } from "@cairn-ink/core";
import { dropCardMemberships } from "./topics.mjs";
import { copyScope, validateTime, writeNamespace } from "./validation.mjs";

/** @import { DocumentCardAmendment, DocumentCardHideSelector, DocumentCardSourceMessage,
 * DocumentCardStore, Scope, StoredDocumentCardRecord, Tx } from "@cairn-ink/core/ports" */
/** @typedef {ReturnType<typeof import("./unit-of-work.mjs").createUnitOfWork>["port"]} Port */
/** @typedef {Parameters<DocumentCardStore<StoredDocumentCardRecord>["put"]>[2]} CardWrite */
/** @typedef {import("./unit-of-work.mjs").CardEntry} CardEntry */
/** @typedef {{ card: (card: CardWrite) => boolean,
 * amendment?: (amendment: DocumentCardAmendment) => boolean }} HideMatcher */

/** @param {unknown} value */
function requireString(value) {
  if (typeof value !== "string" || !value) throw new CoreError("invalid_input");
}

/** @param {DocumentCardHideSelector} selector @returns {HideMatcher} */
function selectorMatcher(selector) {
  const { sourceMemoryId, sourceMessage, session } = selector;
  const selectors = [sourceMemoryId, sourceMessage, session].filter((value) => value !== undefined);
  if (selectors.length !== 1) throw new CoreError("invalid_input");
  if (sourceMemoryId !== undefined) {
    requireString(sourceMemoryId);
    return { card: ({ sourceMemories }) => sourceMemories.some(({ id }) => id === sourceMemoryId) };
  }
  const source = sourceMessage ?? session;
  if (!source) throw new CoreError("invalid_input");
  const { client, sessionId } = source;
  requireString(client);
  requireString(sessionId);
  const messageId = sourceMessage?.messageId;
  if (sourceMessage !== undefined) requireString(messageId);
  /** @param {{ sourceMessage: DocumentCardSourceMessage | null }} entry */
  const matches = ({ sourceMessage }) =>
    sourceMessage?.client === client && sourceMessage.sessionId === sessionId &&
    (messageId === undefined || sourceMessage.messageId === messageId);
  return { card: matches, amendment: matches };
}

/** @param {CardEntry | undefined} entry @returns {StoredDocumentCardRecord | null} */
function readCard(entry) {
  if (!entry?.card) return null;
  const amendments = [...(entry.amendments?.values() ?? [])].filter((amendment) => amendment !== null)
    .sort((a, b) => compareUtf8(a.date, b.date));
  return structuredClone({ ...entry.card, amendments });
}

/** @param {Port} port @param {() => number} now @returns {DocumentCardStore<StoredDocumentCardRecord>} */
export function createDocumentCardStore(port, now) {
  /** @param {Tx} tx @param {Scope} scope @param {() => HideMatcher} prepare */
  function hideCards(tx, scope, prepare) {
    return port.write(tx, scope, "conditional", () => {
      const namespace = writeNamespace(scope);
      const match = prepare();
      return (getState, _markDirty, run) => {
        const state = getState();
        let hidden = 0;
        for (const [id, entry] of state.documentCards.get(namespace) ?? []) {
          if (!entry.card) continue;
          const hideCard = match.card(entry.card);
          if (!hideCard && !match.amendment) continue;
          for (const [amendmentId, amendment] of entry.amendments ?? []) {
            if (!amendment || !(hideCard || match.amendment?.(amendment))) continue;
            entry.amendments?.set(amendmentId, null);
            hidden++;
          }
          if (hideCard) {
            entry.card = null;
            delete entry.amendments;
            dropCardMemberships(state, namespace, id);
            hidden++;
          }
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
        Reflect.deleteProperty(copy, "amendments");
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
          cards.set(copy.id, { ...previous, card: copy, createdAtMs });
          state.documentCards.set(namespace, cards);
          run.cardWrites++;
          return { status: previous ? "replaced" : "inserted" };
        };
      });
    },

    async amend(tx, callerScope, cardId, amendment) {
      const scope = copyScope(callerScope);
      return port.write(tx, scope, "conditional", () => {
        requireString(cardId);
        const copy = structuredClone(amendment);
        requireString(copy?.amendmentId);
        return (getState, _markDirty, run) => {
          const entry = getState().documentCards.get(scope.namespace)?.get(cardId);
          if (!entry?.card) return { status: "hidden_card" };
          const amendments = entry.amendments ??= new Map();
          if (amendments.has(copy.amendmentId)) return { status: "unchanged" };
          amendments.set(copy.amendmentId, copy);
          run.cardWrites++;
          return { status: "inserted" };
        };
      });
    },

    async hideAmendment(tx, callerScope, cardId, amendmentId, _reason) {
      const scope = copyScope(callerScope);
      return port.write(tx, scope, "conditional", () => {
        requireString(cardId);
        requireString(amendmentId);
        return (getState, _markDirty, run) => {
          const amendments = getState().documentCards.get(scope.namespace)?.get(cardId)?.amendments;
          if (!amendments?.get(amendmentId)) return;
          amendments.set(amendmentId, null);
          run.cardWrites++;
        };
      });
    },

    async hide(tx, scope, cardId, _reason) {
      await hideCards(tx, scope, () => {
        requireString(cardId);
        return { card: ({ id }) => id === cardId };
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
      return port(tx, scope, false, (state) => readCard(state.documentCards.get(scope.namespace)?.get(cardId)));
    },

    async list(tx, scope) {
      return port(tx, scope, false, (state) => [...(state.documentCards.get(scope.namespace)?.values() ?? [])]
        .map(readCard).filter((card) => card !== null));
    },
  };
}

import { CoreError, compareUtf8 } from "@cairn-ink/core";
import { DOCUMENT_CARD_SEARCH_TEXT_VERSION } from "@cairn-ink/core/routing";
import { dropCardMemberships, dropCardPlacement } from "./topics.mjs";
import { copyScope, readEmbedding, snapshotArray, validateCardId, validateTime, writeNamespace, writeTime } from "./validation.mjs";

/** @import { DocumentCardAmendment, DocumentCardHideSelector, DocumentCardSourceMessage,
 * DocumentCardStore, Scope, StoredDocumentCardRecord, Tx } from "@cairn-ink/core/ports" */
/** @typedef {ReturnType<typeof import("./unit-of-work.mjs").createUnitOfWork>["port"]} Port */
/** @typedef {Parameters<DocumentCardStore<StoredDocumentCardRecord>["put"]>[2]} CardWrite */
/** @typedef {CardWrite["sourceMemories"]} MemoryLinks */
/** @typedef {import("./unit-of-work.mjs").CardEntry} CardEntry */
/** @typedef {{ card: (card: CardWrite) => boolean,
 * amendment?: (amendment: DocumentCardAmendment) => boolean }} HideMatcher */

/** @param {unknown} value */
function requireString(value) {
  if (typeof value !== "string" || !value) throw new CoreError("invalid_input");
}

/** @param {MemoryLinks} existing @param {MemoryLinks} links */
function unionMemoryLinks(existing, links) {
  /** @type {Map<string, number>} */
  const revisions = new Map();
  for (const { id, revision } of [...existing, ...links]) {
    const previous = revisions.get(id);
    if (previous === undefined || revision > previous) revisions.set(id, revision);
  }
  return [...revisions].map(([id, revision]) => ({ id, revision }));
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

/** @param {Port} port @param {() => number} now
 * @param {ReturnType<typeof import("./retrieval.mjs").createCardVisibilityInput>} buildVisibilityInput
 * @param {boolean} searchEnabled @returns {DocumentCardStore<StoredDocumentCardRecord>} */
export function createDocumentCardStore(port, now, buildVisibilityInput, searchEnabled) {
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
          let hiddenAmendment = false;
          for (const [amendmentId, amendment] of entry.amendments ?? []) {
            if (!amendment || !(hideCard || match.amendment?.(amendment))) continue;
            entry.amendments?.set(amendmentId, null);
            hiddenAmendment = true;
            hidden++;
          }
          if (hideCard || hiddenAmendment) entry.revision++;
          if (hideCard) {
            entry.card = null;
            delete entry.amendments;
            delete entry.embedding;
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
    async put(tx, scope, card, embedding) {
      return port.write(tx, scope, "conditional", () => {
        const namespace = writeNamespace(scope);
        const copy = structuredClone(card);
        validateCardId(copy?.id);
        requireString(copy.contentHash);
        if (copy.scope?.owner !== tx.owner || copy.scope.namespace !== namespace) throw new CoreError("invalid_input");
        if (!Array.isArray(copy.sourceMemories) || !Array.isArray(copy.stale)) throw new CoreError("invalid_input");
        Reflect.deleteProperty(copy, "amendments");
        copy.stale = copy.stale.map(({ memoryId, replacementMemoryId }) => ({ memoryId, replacementMemoryId }));
        /** @type {CardEntry["embedding"]} */
        let indexedEmbedding;
        if (searchEnabled && embedding) {
          requireString(embedding.model);
          indexedEmbedding = {
            model: embedding.model, vector: readEmbedding(embedding.vector, "passage"),
            textVersion: DOCUMENT_CARD_SEARCH_TEXT_VERSION,
          };
          if (!indexedEmbedding.vector.length) throw new CoreError("invalid_input");
        }
        return (getState, _markDirty, run) => {
          const state = getState();
          const cards = state.documentCards.get(namespace) ?? new Map();
          const previous = cards.get(copy.id);
          if (previous && !previous.card) return { status: "tombstoned" };
          if (previous?.card?.contentHash === copy.contentHash) return { status: "unchanged" };
          if (previous?.card) {
            if (previous.card.origin === undefined) Reflect.deleteProperty(copy, "origin");
            else Object.assign(copy, { origin: previous.card.origin });
            if (previous.card.sourceMessage && copy.sourceMessage) {
              copy.sourceMemories = unionMemoryLinks(previous.card.sourceMemories, copy.sourceMemories);
            }
          }
          const createdAtMs = previous?.createdAtMs ?? now();
          validateTime(createdAtMs);
          let searchIndex;
          if (searchEnabled) {
            const updatedAtMs = previous ? now() : createdAtMs;
            validateTime(updatedAtMs);
            searchIndex = { updatedAtUs: writeTime(updatedAtMs).updatedAtUs, embedding: indexedEmbedding };
          }
          if (previous) dropCardPlacement(state, namespace, copy.id);
          const bodyChanged = previous?.card?.title !== copy.title || previous?.card?.body !== copy.body;
          cards.set(copy.id, { ...previous, card: copy, createdAtMs, ...searchIndex,
            revision: (previous?.revision ?? 0) + 1,
            bodyRevision: (previous?.bodyRevision ?? 0) + Number(bodyChanged),
          });
          state.documentCards.set(namespace, cards);
          run.cardWrites++;
          return { status: previous ? "replaced" : "inserted" };
        };
      });
    },

    async linkMemories(tx, callerScope, cardId, links) {
      const scope = copyScope(callerScope);
      return port.write(tx, scope, "conditional", () => {
        validateCardId(cardId);
        const incoming = snapshotArray(links).map((link) => {
          if (!link || typeof link !== "object") throw new CoreError("invalid_input");
          const { id, revision } = link;
          requireString(id);
          if (!Number.isSafeInteger(revision) || revision < 0) throw new CoreError("invalid_input");
          return { id, revision };
        });
        return (getState, _markDirty, run) => {
          const entry = getState().documentCards.get(scope.namespace)?.get(cardId);
          if (!entry) return { status: "not_found" };
          if (!entry.card) return { status: "tombstoned" };
          const existing = entry.card.sourceMemories;
          const sourceMemories = unionMemoryLinks(existing, incoming);
          if (sourceMemories.length === existing.length && sourceMemories.every(({ id, revision }, index) =>
            id === existing[index].id && revision === existing[index].revision)) return { status: "unchanged" };
          entry.card = { ...entry.card, sourceMemories };
          entry.revision++;
          run.cardWrites++;
          return { status: "linked" };
        };
      });
    },

    async amend(tx, callerScope, cardId, amendment) {
      const scope = copyScope(callerScope);
      return port.write(tx, scope, "conditional", () => {
        validateCardId(cardId);
        const copy = structuredClone(amendment);
        requireString(copy?.amendmentId);
        return (getState, _markDirty, run) => {
          const entry = getState().documentCards.get(scope.namespace)?.get(cardId);
          if (!entry?.card) return { status: "hidden_card" };
          const amendments = entry.amendments ??= new Map();
          if (amendments.has(copy.amendmentId)) return { status: "unchanged" };
          amendments.set(copy.amendmentId, copy);
          entry.revision++;
          run.cardWrites++;
          return { status: "inserted" };
        };
      });
    },

    async hideAmendment(tx, callerScope, cardId, amendmentId, _reason) {
      const scope = copyScope(callerScope);
      return port.write(tx, scope, "conditional", () => {
        validateCardId(cardId);
        requireString(amendmentId);
        return (getState, _markDirty, run) => {
          const entry = getState().documentCards.get(scope.namespace)?.get(cardId);
          if (!entry?.amendments?.get(amendmentId)) return;
          entry.amendments.set(amendmentId, null);
          entry.revision++;
          run.cardWrites++;
        };
      });
    },

    async hide(tx, scope, cardId, _reason) {
      await hideCards(tx, scope, () => {
        validateCardId(cardId);
        return { card: ({ id }) => id === cardId };
      });
    },

    async hideWhere(tx, scope, selector, _reason) {
      return hideCards(tx, scope, () => selectorMatcher(selector));
    },

    async markStale(tx, scope, cardId, { memoryId, replacementMemoryId }) {
      return port.write(tx, scope, "conditional", () => {
        const namespace = writeNamespace(scope);
        validateCardId(cardId);
        requireString(memoryId);
        requireString(replacementMemoryId);
        const stale = { memoryId, replacementMemoryId };
        return (getState, _markDirty, run) => {
          const entry = getState().documentCards.get(namespace)?.get(cardId);
          if (!entry?.card) return;
          if (!entry.card.stale.some((item) => item.memoryId === memoryId && item.replacementMemoryId === replacementMemoryId)) {
            entry.card = { ...entry.card, stale: [...entry.card.stale, stale] };
            entry.revision++;
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

    async visibilityInputs(tx, scope, refs) {
      return port.read(tx, scope, getState => {
        const requestedScope = copyScope(scope);
        const state = getState();
        const cards = state.documentCards.get(requestedScope.namespace);
        return Promise.all(Array.from(refs, async ref => {
          try {
            if (ref?.type !== "card" || ref.namespace !== requestedScope.namespace ||
                typeof ref.id !== "string" || !ref.id) return null;
            const card = cards?.get(ref.id)?.card;
            if (!card || card.scope.owner !== requestedScope.owner ||
                card.scope.namespace !== requestedScope.namespace) return null;
            return structuredClone(await buildVisibilityInput(state, requestedScope, card, true));
          } catch {
            return null;
          }
        }));
      });
    },
  };
}

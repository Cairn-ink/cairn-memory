import { CoreError, compareUtf8 } from "@cairn-ink/core";
import { DOCUMENT_CARD_SEARCH_TEXT_VERSION, documentCardVisible } from "@cairn-ink/core/routing";
import { hasReplacedCitation, memoryCorrectionEvidence } from "./privacy.mjs";
import { dropCardMemberships, dropCardPlacement } from "./topics.mjs";
import { recordCardWrite } from "./unit-of-work.mjs";
import { copyScope, readEmbedding, snapshotArray, validateCardId, validateTime, writeNamespace, writeTime } from "./validation.mjs";

/** @import { DocumentCardAmendment, DocumentCardHideOptions, DocumentCardHideSelector, DocumentCardSourceMessage,
 * DocumentCardStore, Scope, StoredDocumentCardRecord, Tx } from "@cairn-ink/core/ports" */
/** @typedef {ReturnType<typeof import("./unit-of-work.mjs").createUnitOfWork>["port"]} Port */
/** @typedef {Parameters<DocumentCardStore<StoredDocumentCardRecord>["put"]>[2]} CardWrite */
/** @typedef {CardWrite["sourceMemories"]} MemoryLinks */
/** @typedef {import("./unit-of-work.mjs").CardEntry} CardEntry */
/** @typedef {import("./unit-of-work.mjs").AmendmentEntry} AmendmentEntry */
/** @typedef {import("./unit-of-work.mjs").State} State */
/** @typedef {ReturnType<typeof import("./retrieval.mjs").createCardVisibilityInputs>} CardVisibilityInputs */
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

/** @param {State} state @param {Scope} scope @param {MemoryLinks} existing
 * @param {MemoryLinks} incoming @param {boolean} bodyChanged @param {boolean} union */
function updateMemoryLinks(state, scope, existing, incoming, bodyChanged, union) {
  const rows = state.rows.get(scope.namespace);
  const pinned = new Set();
  const retained = existing.filter(({ id, revision }) => {
    const memory = rows?.get(id)?.row;
    const evidence = memoryCorrectionEvidence(state, scope, { id, revision });
    const corrected = evidence.unresolvedCorrection || evidence.correctedRevisions.includes(revision);
    if (!bodyChanged && (corrected || (memory && incoming.some(link => link.id === id && link.revision > memory.revision)))) {
      pinned.add(id);
      return true;
    }
    // A new body can drop the corrected citation or supply one of its own.
    return union && !corrected;
  });
  if (!union && !pinned.size) return incoming;
  return unionMemoryLinks(retained, incoming.filter(({ id }) => !pinned.has(id)))
    .flatMap(link => pinned.has(link.id) ? existing.filter(({ id }) => id === link.id) : [link]);
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

/** @param {AmendmentEntry} entry */
function visibleAmendment(entry) {
  return entry && "amendmentId" in entry ? entry : null;
}

/** @param {AmendmentEntry} entry */
function storedAmendment(entry) {
  return entry && "hidden" in entry ? entry.hidden : visibleAmendment(entry);
}

/** @param {CardEntry | undefined} entry @returns {StoredDocumentCardRecord | null} */
function readCard(entry) {
  if (!entry?.card) return null;
  const amendments = [...(entry.amendments?.values() ?? [])].map(visibleAmendment).filter((amendment) => amendment !== null)
    .sort((a, b) => compareUtf8(a.date, b.date));
  return structuredClone({ ...entry.card, amendments });
}

/** @param {State} state @param {Scope["namespace"]} namespace @param {HideMatcher} match
 * @param {string} reason @param {DocumentCardHideOptions} options */
function hideMatching(state, namespace, match, reason, { purge = false, retainText = false }) {
  let hidden = 0;
  let changed = false;
  for (const [id, entry] of state.documentCards.get(namespace) ?? []) {
    const card = entry.card ?? (purge ? entry.hiddenCard : undefined);
    if (!card) continue;
    if (match.card(card)) {
      if (entry.card) {
        hidden += 1 + [...(entry.amendments?.values() ?? [])].filter(visibleAmendment).length;
        dropCardMemberships(state, namespace, id);
      }
      if (purge) {
        entry.hiddenReason = reason;
        delete entry.hiddenCard;
      } else if (retainText) {
        entry.hiddenCard = card;
      }
      entry.card = null;
      delete entry.embedding;
      if (purge || !retainText) delete entry.amendments;
      entry.revision++;
      changed = true;
      continue;
    }
    if (!match.amendment) continue;
    let changedAmendment = false;
    for (const [amendmentId, value] of entry.amendments ?? []) {
      const visible = entry.card ? visibleAmendment(value) : null;
      const amendment = purge ? storedAmendment(value) : visible;
      if (!amendment || !match.amendment(amendment)) continue;
      entry.amendments?.set(amendmentId, purge ? { hiddenReason: reason } : retainText ? { hidden: amendment } : null);
      if (visible) hidden++;
      changedAmendment = true;
    }
    if (changedAmendment) {
      entry.revision++;
      changed = true;
    }
  }
  return { hidden, changed };
}

/** @param {State} state @param {Scope["namespace"]} namespace
 * @param {(source: DocumentCardSourceMessage, text: string, wholeMessage: boolean) => boolean} isDeleted */
export function purgeDeletedDocumentSources(state, namespace, isDeleted) {
  /** @param {DocumentCardSourceMessage | null} source @param {string} text @param {boolean} [wholeMessage] */
  const matches = (source, text, wholeMessage = false) => source != null && isDeleted(source, text, wholeMessage);
  return hideMatching(state, namespace, {
    card: ({ sourceMessage, body, sentences }) => matches(sourceMessage, body, true) ||
      (Array.isArray(sentences) && sentences.some(sentence => sentence?.source != null &&
        matches(sentence.source, typeof body === "string" ? body.slice(sentence.start, sentence.end) : ""))),
    amendment: ({ sourceMessage, quote }) => matches(sourceMessage, quote),
  }, "raw_deleted", { purge: true });
}

/** @param {Port} port @param {() => number} now
 * @param {CardVisibilityInputs["cardVisibilityInput"]} buildVisibilityInput
 * @param {CardVisibilityInputs["amendmentWithheld"]} amendmentWithheld
 * @param {boolean} searchEnabled @returns {DocumentCardStore<StoredDocumentCardRecord>} */
export function createDocumentCardStore(port, now, buildVisibilityInput, amendmentWithheld, searchEnabled) {
  /** @param {Tx} tx @param {State} state @param {Scope} scope @param {CardEntry | undefined} entry */
  async function readStoredCard(tx, state, scope, entry) {
    const card = entry?.card;
    if (!card) return null;
    if (hasReplacedCitation(state, card)) {
      const input = await buildVisibilityInput(tx, state, scope, card);
      if (!input || !(await documentCardVisible(input)).visible) return null;
    }
    return readCard(entry);
  }

  /** @param {Tx} tx @param {Scope} scope @param {() => HideMatcher} prepare */
  function hideCards(tx, scope, prepare, /** @type {string} */ reason, /** @type {DocumentCardHideOptions} */ options = {}) {
    return port.write(tx, scope, "conditional", () => {
      const namespace = writeNamespace(scope);
      const match = prepare();
      return (getState, _markDirty, run) => {
        const { hidden, changed } = hideMatching(getState(), namespace, match, reason, options);
        if (changed) recordCardWrite(run, namespace);
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
          const bodyChanged = previous?.card?.body !== copy.body;
          const titleChanged = previous?.card?.title !== copy.title;
          if (previous?.card) {
            if (previous.card.origin === undefined) Reflect.deleteProperty(copy, "origin");
            else Object.assign(copy, { origin: previous.card.origin });
            copy.sourceMemories = updateMemoryLinks(state, copy.scope, previous.card.sourceMemories,
              copy.sourceMemories, bodyChanged, !!(previous.card.sourceMessage && copy.sourceMessage));
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
          cards.set(copy.id, { ...previous, card: copy, createdAtMs, ...searchIndex,
            revision: (previous?.revision ?? 0) + 1,
            bodyRevision: (previous?.bodyRevision ?? 0) + Number(bodyChanged || titleChanged),
          });
          state.documentCards.set(namespace, cards);
          recordCardWrite(run, namespace);
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
          const state = getState();
          const entry = state.documentCards.get(scope.namespace)?.get(cardId);
          if (!entry) return { status: "not_found" };
          if (!entry.card) return { status: "tombstoned" };
          const existing = entry.card.sourceMemories;
          const sourceMemories = updateMemoryLinks(state, scope, existing, incoming, false, true);
          if (sourceMemories.length === existing.length && sourceMemories.every(({ id, revision }, index) =>
            id === existing[index].id && revision === existing[index].revision)) return { status: "unchanged" };
          entry.card = { ...entry.card, sourceMemories };
          entry.revision++;
          recordCardWrite(run, scope.namespace);
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
          recordCardWrite(run, scope.namespace);
          return { status: "inserted" };
        };
      });
    },

    async hideAmendment(tx, callerScope, cardId, amendmentId, reason, { purge = false } = {}) {
      const scope = copyScope(callerScope);
      return port.write(tx, scope, "conditional", () => {
        validateCardId(cardId);
        requireString(amendmentId);
        return (getState, _markDirty, run) => {
          const entry = getState().documentCards.get(scope.namespace)?.get(cardId);
          if (!entry?.amendments) return;
          const value = entry.amendments.get(amendmentId) ?? null;
          if (!(purge ? storedAmendment(value) : entry.card && visibleAmendment(value))) return;
          entry.amendments.set(amendmentId, purge ? { hiddenReason: reason } : null);
          entry.revision++;
          recordCardWrite(run, scope.namespace);
        };
      });
    },

    async hide(tx, scope, cardId, reason) {
      await hideCards(tx, scope, () => {
        validateCardId(cardId);
        return { card: ({ id }) => id === cardId };
      }, reason);
    },

    async hideWhere(tx, scope, selector, reason, options) {
      return hideCards(tx, scope, () => selectorMatcher(selector), reason, options);
    },

    async purgeById(tx, scope, cardId, reason) {
      await hideCards(tx, scope, () => {
        validateCardId(cardId);
        return { card: ({ id }) => id === cardId };
      }, reason, { purge: true });
    },

    async listForPurge(tx, scope, selectors, action) {
      return port.read(tx, scope, async getState => {
        const state = getState();
        const factIds = new Set(action?.factIds);
        const facts = new Map([...state.facts].filter(([, { fact, factId }]) =>
          factIds.has(factId) && fact.origin === "forget" &&
          fact.owner === scope.owner && (fact.namespace ?? null) === scope.namespace));
        const matches = selectors?.map(selectorMatcher);
        const candidates = [];
        for (const entry of state.documentCards.get(scope.namespace)?.values() ?? []) {
          const card = entry.card ?? entry.hiddenCard;
          if (!card) continue;
          const selected = matches === undefined || matches.some(({ card: match }) => match(card));
          const amendments = [];
          for (const value of entry.amendments?.values() ?? []) {
            const amendment = storedAmendment(value);
            if (!amendment || (!selected && !matches?.some(({ amendment: match }) => match?.(amendment)))) continue;
            const { amendmentId, sourceMessage } = amendment;
            const sourceWithheld = await amendmentWithheld(tx, state, scope, sourceMessage, facts).catch(() => false);
            amendments.push({ amendmentId, sourceMessage, sourceWithheld });
          }
          if (!selected && amendments.length === 0) continue;
          const input = selected ? await buildVisibilityInput(tx, state, scope, card, false, facts) : null;
          candidates.push(structuredClone({ cardId: card.id, input, amendments }));
        }
        return candidates;
      });
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
          if (!entry?.card || entry.card.stale.some((item) =>
            item.memoryId === memoryId && item.replacementMemoryId === replacementMemoryId)) return;
          entry.card = { ...entry.card, stale: [...entry.card.stale, stale] };
          entry.revision++;
          recordCardWrite(run, namespace);
        };
      });
    },

    async get(tx, scope, cardId) {
      return port(tx, scope, false, state =>
        readStoredCard(tx, state, scope, state.documentCards.get(scope.namespace)?.get(cardId)));
    },

    async list(tx, scope) {
      return port(tx, scope, false, async state => {
        const entries = state.documentCards.get(scope.namespace)?.values() ?? [];
        const cards = await Promise.all(Array.from(entries, entry => readStoredCard(tx, state, scope, entry)));
        return cards.filter(card => card !== null);
      });
    },

    async visibilityInputs(tx, scope, refs, { requireRaw = true, newCard } = {}) {
      return port.read(tx, scope, getState => {
        const requestedScope = copyScope(scope);
        const state = getState();
        const cards = state.documentCards.get(requestedScope.namespace);
        return Promise.all(Array.from(refs, async ref => {
          try {
            if (ref?.type !== "card" || ref.namespace !== requestedScope.namespace ||
                typeof ref.id !== "string" || !ref.id) return null;
            const entry = cards?.get(ref.id);
            if (!entry && newCard?.card.id === ref.id && newCard.card.scope.owner === requestedScope.owner &&
                newCard.card.scope.namespace === requestedScope.namespace) return structuredClone(newCard);
            const card = entry?.card;
            if (!card || card.scope.owner !== requestedScope.owner ||
                card.scope.namespace !== requestedScope.namespace) return null;
            return structuredClone(await buildVisibilityInput(tx, state, requestedScope, card, requireRaw));
          } catch {
            return null;
          }
        }));
      });
    },
  };
}

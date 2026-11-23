import { allDigests, coreDigest, CoreError, compareUtf8, createBM25, rankScores, scoreBM25, termFrequencies, tokenizeT1 } from "@cairn-ink/core";
import { documentCardVisible } from "@cairn-ink/core/routing";
import { cosineDistance } from "./cosine.mjs";
import { decodePayload, decodeSortKey, encodePayload, newestFirst } from "./cursor.mjs";
import { createFactMatcher } from "./fact-match.mjs";
import { copyPublicRow } from "./unit-of-work.mjs";
import { copyReadScope, copyRefs, readEmbedding, validateLimit } from "./validation.mjs";

/** @typedef {import("@cairn-ink/core/ports").StorageAdapter} StorageAdapter */
/** @typedef {import("@cairn-ink/core/ports").RetrievalScope} RetrievalScope */
/** @typedef {import("@cairn-ink/core/ports").Namespace} Namespace */
/** @typedef {import("@cairn-ink/core/ports").ItemRef} ItemRef */
/** @typedef {import("@cairn-ink/core/ports").Receipt} Receipt */
/** @typedef {import("./unit-of-work.mjs").State} State */
/** @typedef {import("./unit-of-work.mjs").Row} Row */
/** @import { DocumentCardMemoryState } from "@cairn-ink/core/routing" */
/** @import { FingerprintKey } from "@cairn-ink/core" */
/** @import { StoredDocumentCardRecord, FingerprintKeyProvider, Scope } from "@cairn-ink/core/ports" */

/** @param {Row} row @returns {ItemRef} */
function memoryRef({ id, scope: { namespace } }) {
  return { type: "memory", id, namespace };
}

/** @param {string} a @param {string} b */
function compareStrings(a, b) {
  // Distinct lone surrogates can encode to the same UTF-8 bytes.
  return compareUtf8(a, b) || (a === b ? 0 : a < b ? -1 : 1);
}

/** @param {Namespace} a @param {Namespace} b */
function compareNamespaces(a, b) {
  return a === b ? 0 : a === null ? -1 : b === null ? 1 : compareStrings(a, b);
}

/** @typedef {{id: string, updatedAtUs: bigint, scope: {namespace: Namespace}}} RecentKey */

/** @param {RecentKey} a @param {RecentKey} b */
function recentOrder(a, b) {
  // Different namespaces can contain the same ID and timestamp.
  return newestFirst(a, b) || compareNamespaces(a.scope.namespace, b.scope.namespace) || compareStrings(a.id, b.id);
}

/** @param {string} cursor @returns {RecentKey} */
function recentAfter(cursor) {
  const [time, id, namespace, ...extra] = decodePayload(cursor);
  if (extra.length || (namespace !== null && typeof namespace !== "string")) throw new CoreError("invalid_cursor");
  return { ...decodeSortKey(time, id), scope: { namespace } };
}

/** @param {RetrievalScope} scope @param {number} revision */
function stateToken({ owner, namespaces, clients }, revision) {
  return encodePayload([owner, revision, [...namespaces].sort(compareNamespaces), clients ? [...clients].sort(compareStrings) : null]);
}

/** @param {string} token */
function validateToken(token) {
  const [owner, revision, namespaces, clients, ...extra] = decodePayload(token);
  if (extra.length || typeof owner !== "string" || !owner ||
    typeof revision !== "number" || !Number.isSafeInteger(revision) || revision < 0) {
    throw new CoreError("invalid_cursor");
  }
  const scope = /** @type {Omit<RetrievalScope, "owner">} */ ({ namespaces, clients: clients === null ? undefined : clients });
  let selection;
  try {
    selection = copyReadScope(owner, scope);
  } catch {
    throw new CoreError("invalid_cursor");
  }
  if (stateToken(selection, revision) !== token) throw new CoreError("invalid_cursor");
}

/** @param {Receipt[]} receipts */
function sourceDates(receipts) {
  /** @type {number | null} */
  let firstMs = null;
  /** @type {number | null} */
  let lastMs = null;
  for (const { occurredAtMs } of receipts) {
    if (occurredAtMs === null) continue;
    firstMs = firstMs === null ? occurredAtMs : Math.min(firstMs, occurredAtMs);
    lastMs = lastMs === null ? occurredAtMs : Math.max(lastMs, occurredAtMs);
  }
  return { firstMs, lastMs };
}

/** @param {ReturnType<typeof createFactMatcher>} matchFacts @param {FingerprintKeyProvider} keys */
export function createCardVisibility(matchFacts, keys) {
  /** @param {State} state @param {Scope} scope @param {StoredDocumentCardRecord} card */
  return async function cardVisible(state, scope, card) {
    const policy = matchFacts(state.facts, scope);
    const rows = state.rows.get(scope.namespace);
    /** @type {Map<string, DocumentCardMemoryState>} */
    const memoryStates = new Map();
    for (const { id } of card.sourceMemories) {
      const entry = rows?.get(id);
      const forgotten = policy.factsFor(id, entry).some(({ fact }) => fact.kind === "identity");
      if (forgotten) memoryStates.set(id, { status: "forgotten" });
      else if (!entry) memoryStates.set(id, { status: "unknown" });
      else if (policy.hides(entry)) memoryStates.set(id, { status: "suppressed" });
      else memoryStates.set(id, { status: entry.row.historical ? "historical" : "visible", revision: entry.row.revision });
    }
    const { sourceMessage } = card;
    let canonicalSessionKey = null;
    let sourceWithheld = false;
    /** @type {FingerprintKey | null} */
    let fingerprintKey = null;
    const { textFacts } = policy;
    try {
      if (textFacts.length) fingerprintKey = await keys.userKey(scope.owner);
      if (sourceMessage) {
        canonicalSessionKey = policy.canonicalSessionKey(sourceMessage);
        // Cards supply the retained text projection for the source message in this adapter.
        const passages = textFacts.length ? await Promise.all([card.body, card.title].map(async (text) => {
          const digests = await allDigests(text);
          if (fingerprintKey) digests.push(await coreDigest(text, fingerprintKey));
          return { digests };
        })) : [];
        sourceWithheld = policy.withholdsCardSource(card, passages);
      }
    } catch {
      return false;
    }
    return (await documentCardVisible({
      card: { ...card, canonicalSessionKey }, requestedScope: scope, memoryStates,
      sourceWithheld, textFacts, fingerprintKey,
    })).visible;
  };
}

/**
 * @param {ReturnType<typeof import("./unit-of-work.mjs").createUnitOfWork>["port"]} port
 * @param {import("@cairn-ink/core").Capabilities} capabilities
 * @param {ReturnType<typeof createFactMatcher>} [matchFacts]
 * @param {ReturnType<typeof createCardVisibility>} [cardVisible]
 * @returns {Pick<StorageAdapter, "lexical" | "vector" | "fence" | "snapshot" | "hydrate" | "recent">}
 */
export function createRetrievalPorts(port, capabilities, matchFacts = createFactMatcher(capabilities.vectorSuppression),
  cardVisible = createCardVisibility(matchFacts, { async userKey() { return null; } })) {
  /** @param {State} state @param {RetrievalScope} scope */
  function policies(state, scope) {
    return new Map(scope.namespaces.map((namespace) =>
      [namespace, matchFacts(state.facts, { owner: scope.owner, namespace })]));
  }

  /** @param {State} state @param {RetrievalScope} scope */
  function visibleRows(state, scope) {
    /** @type {Row[]} */
    const rows = [];
    for (const [namespace, policy] of policies(state, scope)) {
      const entries = state.rows.get(namespace);
      if (!entries) continue;
      for (const entry of entries.values()) {
        if (!entry.row.historical && !policy.hides(entry)) rows.push(entry.row);
      }
    }
    return rows;
  }

  /** @param {State} state @param {RetrievalScope} scope @param {readonly ItemRef[]} refs @param {boolean} includeHistorical */
  function* visibleRefs(state, scope, refs, includeHistorical) {
    const byNamespace = policies(state, scope);
    for (const ref of refs) {
      const policy = byNamespace.get(ref.namespace);
      if (ref.type !== "memory" || !policy) continue;
      const entry = state.rows.get(ref.namespace)?.get(ref.id);
      if (entry && (includeHistorical || !entry.row.historical) && !policy.hides(entry)) {
        yield { ref: memoryRef(entry.row), entry };
      }
    }
  }

  /** @type {import("@cairn-ink/core/ports").VectorCandidates} */
  const vector = {
    async vector(tx, scope, query, model, depth) {
      return port.read(tx, scope, (getState) => {
        const selection = copyReadScope(tx.owner, scope);
        validateLimit(depth);
        const queryVector = readEmbedding(query);
        if (typeof model !== "string" || !model) throw new CoreError("invalid_input");

        const visible = visibleRows(getState(), selection);
        const rows = [];
        for (const row of visible) {
          const { embedding } = row;
          if (embedding?.model !== model || embedding.vector.length !== queryVector.length) continue;
          // Treat a zero vector as orthogonal so every matching embedding is ranked.
          const distance = cosineDistance(queryVector, embedding.vector) ?? 1;
          rows.push({ ref: memoryRef(row), distance, updatedAtUs: row.updatedAtUs });
        }
        rows.sort((a, b) => a.distance - b.distance || newestFirst(
          { id: a.ref.id, updatedAtUs: a.updatedAtUs }, { id: b.ref.id, updatedAtUs: b.updatedAtUs }));
        const eligible = visible.length;
        const embedded = rows.length;
        return { rows: rows.slice(0, depth), coverage: { eligible, embedded, complete: embedded === eligible } };
      });
    },
  };

  return {
    ...(capabilities.semanticRetrieval ? { vector } : {}),
    lexical: {
      async lexical(tx, scope, query, depth) {
        return port.read(tx, scope, (getState) => {
          const selection = copyReadScope(tx.owner, scope);
          validateLimit(depth);
          if (typeof query !== "string") throw new CoreError("invalid_input");
          const terms = tokenizeT1(query);
          if (terms.length === 0) return { rows: [], matched: false };

          const documents = visibleRows(getState(), selection).map((row) => ({
            ref: memoryRef(row), updatedAtUs: row.updatedAtUs, text: row.text,
          }));
          // The core search convenience method caps depth. Score using the same corpus stats
          // and scorer so the port can honor all positive safe-integer depths.
          const index = createBM25(documents);
          const rows = [];
          for (const { ref, updatedAtUs, text } of documents) {
            const score = scoreBM25(terms, termFrequencies(text), index);
            if (score !== null) rows.push({ ref, updatedAtUs, score });
          }
          return { rows: rankScores(rows).slice(0, depth), matched: rows.length > 0 };
        });
      },
    },
    snapshot: {
      async stateToken(tx, scope) {
        return port.read(tx, scope, (getState) => {
          const selection = copyReadScope(tx.owner, scope);
          return stateToken(selection, getState().indexRevision);
        });
      },
      async assertUnchanged(tx, scope, token) {
        return port.read(tx, scope, (getState) => {
          const selection = copyReadScope(tx.owner, scope);
          validateToken(token);
          if (token !== stateToken(selection, getState().indexRevision)) throw new CoreError("cursor_stale");
        });
      },
    },
    hydrate: {
      async hydrate(tx, scope, refs, intent) {
        return port.read(tx, scope, (getState) => {
          const selection = copyReadScope(tx.owner, scope);
          if (intent !== "recall" && intent !== "read" && intent !== "export") throw new CoreError("invalid_input");
          const references = copyRefs(refs);
          return Array.from(visibleRefs(getState(), selection, references, intent !== "recall"), ({ ref, entry }) => ({
            ref, memory: copyPublicRow(entry.row), receipts: structuredClone(entry.receipts),
            sourceDates: sourceDates(entry.receipts),
          }));
        });
      },
    },
    fence: {
      async assertVisible(tx, scope, refs) {
        return port.read(tx, scope, (getState) => {
          const selection = copyReadScope(tx.owner, scope);
          const references = copyRefs(refs);
          const state = getState();
          if (!capabilities.documentCards || !references.some(({ type }) => type === "card")) {
            return Array.from(visibleRefs(state, selection, references, false), ({ ref }) => ref);
          }
          return (async () => {
            const byNamespace = policies(state, selection);
            const visible = [];
            for (const ref of references) {
              const { namespace, type, id } = ref;
              const policy = byNamespace.get(namespace);
              if (!policy) continue;
              if (type === "memory") {
                const entry = state.rows.get(namespace)?.get(id);
                if (entry && !entry.row.historical && !policy.hides(entry)) visible.push(memoryRef(entry.row));
              } else if (type === "card") {
                const card = state.documentCards.get(namespace)?.get(id)?.card;
                if (card && await cardVisible(state, { owner: tx.owner, namespace }, card)) visible.push(ref);
              }
            }
            return visible;
          })();
        });
      },
    },
    recent: {
      async recent(tx, scope, page) {
        return port.read(tx, scope, (getState) => {
          const selection = copyReadScope(tx.owner, scope);
          if (!page || typeof page !== "object") throw new CoreError("invalid_input");
          const { cursor, limit } = page;
          validateLimit(limit);
          const after = cursor === null ? null : recentAfter(cursor);
          const rows = visibleRows(getState(), selection).filter((row) => !after || recentOrder(row, after) > 0).sort(recentOrder);
          const items = rows.slice(0, limit).map(copyPublicRow);
          const last = items.at(-1);
          return {
            items,
            nextCursor: last && rows.length > limit ?
              encodePayload([last.updatedAtUs.toString(), last.id, last.scope.namespace]) : null,
          };
        });
      },
    },
  };
}

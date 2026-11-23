import { CoreError, compareUtf8, createBM25, rankScores, scoreBM25, termFrequencies, tokenizeT1 } from "@cairn-ink/core";
import { cosineDistance } from "./cosine.mjs";
import { decodePayload, decodeSortKey, encodePayload, newestFirst } from "./cursor.mjs";
import { createFactMatcher } from "./fact-match.mjs";
import { matchesMemoryFilters } from "./retrieval-window.mjs";
import { copyPublicRow } from "./unit-of-work.mjs";
import { copyReadScope, copyRefs, readEmbedding, validateLimit } from "./validation.mjs";

/** @typedef {import("@cairn-ink/core/ports").StorageAdapter} StorageAdapter */
/** @typedef {import("@cairn-ink/core/ports").RetrievalScope} RetrievalScope */
/** @typedef {import("@cairn-ink/core/ports").Namespace} Namespace */
/** @typedef {import("@cairn-ink/core/ports").ItemRef} ItemRef */
/** @typedef {import("@cairn-ink/core/ports").Receipt} Receipt */
/** @typedef {import("./unit-of-work.mjs").State} State */
/** @typedef {import("./unit-of-work.mjs").Row} Row */

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
export function stateToken({ owner, namespaces, clients, window }, revision) {
  /** @type {unknown[]} */
  const payload = [owner, revision, [...namespaces].sort(compareNamespaces), clients ? [...clients].sort(compareStrings) : null];
  if (window) payload.push([window.sinceMs ?? null, window.untilMs ?? null]);
  return encodePayload(payload);
}

/** @param {string} token */
export function validateToken(token) {
  const [owner, revision, namespaces, clients, bounds, ...extra] = decodePayload(token);
  if (extra.length || typeof owner !== "string" || !owner ||
    typeof revision !== "number" || !Number.isSafeInteger(revision) || revision < 0) {
    throw new CoreError("invalid_cursor");
  }
  if (bounds !== undefined && (!Array.isArray(bounds) || bounds.length !== 2)) throw new CoreError("invalid_cursor");
  const window = bounds === undefined ? undefined : { sinceMs: bounds[0] ?? undefined, untilMs: bounds[1] ?? undefined };
  const scope = /** @type {Omit<RetrievalScope, "owner">} */ ({
    namespaces, clients: clients === null ? undefined : clients, window,
  });
  let selection;
  try {
    selection = copyReadScope(owner, scope);
  } catch {
    throw new CoreError("invalid_cursor");
  }
  if (stateToken(selection, revision) !== token) throw new CoreError("invalid_cursor");
}

/**
 * @template {{ref: ItemRef, text: string}} T
 * @param {T[]} documents @param {string[]} terms @param {number} depth
 */
export function rankLexical(documents, terms, depth) {
  // The BM25 search convenience method caps depth. The port accepts any positive safe integer.
  const index = createBM25(documents);
  const rows = [];
  for (const { text, ...document } of documents) {
    const score = scoreBM25(terms, termFrequencies(text), index);
    if (score !== null) rows.push({ ...document, score });
  }
  return rankScores(rows).slice(0, depth);
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

/**
 * @param {ReturnType<typeof import("./unit-of-work.mjs").createUnitOfWork>["port"]} port
 * @param {import("@cairn-ink/core").Capabilities} capabilities
 * @param {ReturnType<typeof createFactMatcher>} [matchFacts]
 * @returns {Pick<StorageAdapter, "lexical" | "vector" | "fence" | "snapshot" | "hydrate" | "recent">}
 */
export function createRetrievalPorts(port, capabilities, matchFacts = createFactMatcher(capabilities.vectorSuppression)) {
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
        if (!entry.row.historical && matchesMemoryFilters(scope, entry.row) && !policy.hides(entry)) rows.push(entry.row);
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
      if (entry && (includeHistorical || !entry.row.historical) &&
          matchesMemoryFilters(scope, entry.row) && !policy.hides(entry)) {
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
          const rows = rankLexical(documents, terms, depth);
          return { rows, matched: rows.length > 0 };
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
          return Array.from(visibleRefs(getState(), selection, references, false), ({ ref }) => ref);
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

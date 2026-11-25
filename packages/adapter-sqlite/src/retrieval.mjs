import { compareSortKey, compareUtf8, CoreError, createBM25, rankScores, scoreBM25, termFrequencies, tokenizeT1 } from "@cairn-ink/core";
import { decodeEntry, LIVE_SCOPE, MEMORY_COLUMNS, readEntry, readReceipts } from "./memory-rows.mjs";
import { compareNamespaces, compareStrings, createSnapshotToken, validateSnapshotToken } from "./retrieval-snapshot.mjs";
import { invalidInput, ownerKey, scopeKey } from "./storage-values.mjs";
import { scopedSuppression } from "./suppressions.mjs";

/** @import { HydratedItem, ItemRef, MemoryRow, Namespace, RetrievalScope, StorageAdapter } from "@cairn-ink/core/ports" */
/** @import { Entry } from "./memory-rows.mjs" */
/** @import { Connection, Port } from "./storage-values.mjs" */
/** @import { SessionHasher } from "./suppressions.mjs" */
/** @typedef {Pick<MemoryRow, "id" | "updatedAtUs"> & {scope: { namespace: Namespace }}} RecentKey */

const decoder = new TextDecoder("utf-8", { fatal: true });
const maxSqlInteger = 9223372036854775807n;

/** @template T @param {readonly T[]} values @returns {T[]} */
function copyArray(values) {
  if (!Array.isArray(values)) invalidInput();
  const result = [];
  const length = values.length;
  for (let index = 0; index < length; index++) {
    const slot = Object.getOwnPropertyDescriptor(values, index);
    if (!slot || !Object.hasOwn(slot, "value")) invalidInput();
    result.push(slot.value);
  }
  return result;
}

/** @param {unknown} namespace @returns {namespace is Namespace} */
function validNamespace(namespace) {
  return namespace === null || typeof namespace === "string";
}

/** @param {unknown} value */
function validBound(value) {
  return value === undefined || (typeof value === "number" && Number.isSafeInteger(value) && value >= 0);
}

/** @param {string} owner @param {RetrievalScope} scope @returns {RetrievalScope} */
export function readSet(owner, { namespaces, clients, window }) {
  const namespaceList = copyArray(namespaces);
  if (!namespaceList.length || new Set(namespaceList).size !== namespaceList.length ||
      !namespaceList.every(validNamespace)) invalidInput();
  const clientList = clients === undefined ? undefined : copyArray(clients);
  if (clientList?.some(client => typeof client !== "string")) invalidInput();
  const selection = { owner: ownerKey(owner), namespaces: namespaceList, clients: clientList };
  if (window === undefined) return selection;
  if (!window || typeof window !== "object" || Array.isArray(window)) invalidInput();
  const { sinceMs, untilMs } = window;
  if (!validBound(sinceMs) || !validBound(untilMs) ||
      (sinceMs !== undefined && untilMs !== undefined && sinceMs >= untilMs)) invalidInput();
  return { ...selection, window: { sinceMs, untilMs } };
}

/** @param {RetrievalScope} selection @param {MemoryRow} row */
function matchesFilters({ clients, window }, { source, createdAtMs }) {
  const { sinceMs, untilMs } = window ?? {};
  return (sinceMs === undefined || createdAtMs >= sinceMs) &&
    (untilMs === undefined || createdAtMs < untilMs) &&
    (clients === undefined || (source.client !== null && clients.includes(source.client)));
}

/** @param {MemoryRow} row @returns {ItemRef} */
function memoryRef({ id, scope: { namespace } }) {
  return { type: "memory", id, namespace };
}

/** @param {RecentKey} row */
function encodeRecent({ id, updatedAtUs, scope: { namespace } }) {
  return Buffer.from(JSON.stringify([updatedAtUs.toString(), id, namespace])).toString("base64url");
}

/** @param {string} token @returns {RecentKey} */
function decodeRecent(token) {
  try {
    if (typeof token !== "string" || !/^[A-Za-z0-9_-]+$/u.test(token)) throw new CoreError("invalid_cursor");
    const values = JSON.parse(decoder.decode(Buffer.from(token, "base64url")));
    if (!Array.isArray(values) || values.length !== 3) throw new CoreError("invalid_cursor");
    const [time, id, namespace] = values;
    if (typeof time !== "string" || !/^(0|[1-9][0-9]*)$/u.test(time) ||
        typeof id !== "string" || !id || !validNamespace(namespace)) throw new CoreError("invalid_cursor");
    const key = { id, updatedAtUs: BigInt(time), scope: { namespace } };
    if (encodeRecent(key) !== token) throw new CoreError("invalid_cursor");
    return key;
  } catch {
    throw new CoreError("invalid_cursor");
  }
}

/** @param {RecentKey} a @param {RecentKey} b */
function recentOrder(a, b) {
  return compareSortKey(b.updatedAtUs, a.updatedAtUs) || compareUtf8(b.id, a.id) ||
    compareNamespaces(a.scope.namespace, b.scope.namespace) || compareStrings(a.id, b.id);
}

/** @param {number} limit */
export function validateLimit(limit) {
  if (!Number.isSafeInteger(limit) || limit < 1) invalidInput();
}

/** @template {{ ref: ItemRef, text: string }} T
 * @param {T[]} documents @param {string[]} terms @param {number} depth
 */
export function rankLexical(documents, terms, depth) {
  const index = createBM25(documents);
  const scored = [];
  for (const { text, ...candidate } of documents) {
    const score = scoreBM25(terms, termFrequencies(text), index);
    if (score !== null) scored.push({ ...candidate, score });
  }
  return rankScores(scored).slice(0, depth);
}

/** @param {Connection} db @param {Entry} entry @returns {HydratedItem} */
function hydrateRow(db, { row }) {
  const receipts = readReceipts(db, row.scope, row.id).map(({ client, sessionId, messageId, role, occurredAtMs }) =>
    ({ client, sessionId, messageId, role, occurredAtMs }));
  let firstMs = null;
  let lastMs = null;
  for (const { occurredAtMs } of receipts) {
    if (occurredAtMs === null) continue;
    firstMs = firstMs === null ? occurredAtMs : Math.min(firstMs, occurredAtMs);
    lastMs = lastMs === null ? occurredAtMs : Math.max(lastMs, occurredAtMs);
  }
  return { ref: memoryRef(row), memory: row, receipts, sourceDates: { firstMs, lastMs } };
}

/** @param {Port} port @param {SessionHasher} hashSession @param {string} storeKey
 * @param {(db: Connection, selection: RetrievalScope, refs: readonly ItemRef[]) => ItemRef[]} visibleRawRefs
 * @param {(tx: import("@cairn-ink/core/ports").Tx, scope: RetrievalScope, refs: readonly ItemRef[]) => Promise<ItemRef[]>} [visibleCardRefs]
 * @returns {Pick<StorageAdapter, "lexical" | "fence" | "snapshot" | "hydrate" | "recent">}
 */
export function createRetrievalPorts(port, hashSession, storeKey, visibleRawRefs, visibleCardRefs) {
  const stateToken = createSnapshotToken(storeKey);

  /** @param {Connection} db @param {RetrievalScope} selection @param {RecentKey | null} after
   * @param {number} perNamespaceLimit
   */
  function* visibleRows(db, selection, after = null, perNamespaceLimit = Infinity) {
    // Bind the exact time when SQLite can represent it. The remaining keyset
    // comparison also handles equal times across namespaces.
    const timeBound = after && after.updatedAtUs <= maxSqlInteger ? [after.updatedAtUs] : [];
    const rows = db.prepare(`SELECT ${MEMORY_COLUMNS} FROM cairn_memories WHERE ${LIVE_SCOPE}
      AND historical = 0 ${timeBound.length ? "AND updated_at_us <= ?" : ""}
      ORDER BY updated_at_us DESC, id DESC`);
    for (const namespace of selection.namespaces) {
      if (namespace === "") continue; // No rows can be stored in an empty namespace.
      const scope = { owner: selection.owner, namespace };
      const policy = scopedSuppression(db, scope, hashSession);
      let remaining = perNamespaceLimit;
      for (const record of rows.iterate(...scopeKey(scope), ...timeBound)) {
        const entry = decodeEntry(scope, record);
        if (after && recentOrder(entry.row, after) <= 0) continue;
        if (!matchesFilters(selection, entry.row) || policy.hides(entry)) continue;
        yield entry.row;
        if (--remaining === 0) break;
      }
    }
  }

  /** @param {Connection} db @param {RetrievalScope} selection @param {readonly ItemRef[]} refs
   * @param {boolean} includeHistorical
   */
  function* visibleRefs(db, selection, refs, includeHistorical) {
    const namespaces = new Set(selection.namespaces);
    /** @type {Map<Namespace, ReturnType<typeof scopedSuppression>>} */
    const policies = new Map();
    for (const ref of copyArray(refs)) {
      if (!ref || typeof ref !== "object") invalidInput();
      const { type, id, namespace } = ref;
      if ((type !== "memory" && type !== "raw" && type !== "card") ||
          typeof id !== "string" || !validNamespace(namespace)) invalidInput();
      if (type !== "memory" || !namespaces.has(namespace) || namespace === "" ||
          !id || /[\u0000\uD800-\uDFFF]/u.test(id)) continue;

      const scope = { owner: selection.owner, namespace };
      const entry = readEntry(db, scope, id);
      if (!entry || (!includeHistorical && entry.row.historical) || !matchesFilters(selection, entry.row)) continue;
      let policy = policies.get(namespace);
      if (!policy) {
        policy = scopedSuppression(db, scope, hashSession);
        policies.set(namespace, policy);
      }
      if (!policy.hides(entry)) yield entry;
    }
  }

  return {
    lexical: {
      lexical(tx, scope, query, depth) {
        return port(tx, scope?.owner, {}, db => {
          const selection = readSet(tx.owner, scope);
          validateLimit(depth);
          if (typeof query !== "string") invalidInput();
          const terms = tokenizeT1(query);
          if (terms.length === 0) return { rows: [], matched: false };

          const documents = Array.from(visibleRows(db, selection), row =>
            ({ ref: memoryRef(row), updatedAtUs: row.updatedAtUs, text: row.text }));
          const rows = rankLexical(documents, terms, depth);
          return { rows, matched: rows.length > 0 };
        });
      },
    },
    fence: {
      async assertVisible(tx, scope, refs, intent) {
        // Core supplies a new read transaction for the final delivery check.
        const { selection, references, visible, raw } = await port(tx, scope?.owner, {}, db => {
          const selection = readSet(tx.owner, scope);
          const references = copyArray(refs);
          const visible = Array.from(visibleRefs(db, selection, references, intent === "read"), ({ row }) => memoryRef(row));
          return { selection, references, visible, raw: visibleRawRefs(db, selection, references) };
        });
        if (!visibleCardRefs || !references.some(ref => ref.type === "card")) return [...visible, ...raw];
        const cards = await visibleCardRefs(tx, selection, references);
        const qualified = new Set([...visible, ...cards].map(({ type, namespace, id }) => JSON.stringify([type, namespace, id])));
        return [...references.filter(({ type, namespace, id }) => qualified.has(JSON.stringify([type, namespace, id]))), ...raw];
      },
    },
    hydrate: {
      hydrate(tx, scope, refs, intent) {
        return port(tx, scope?.owner, {}, db => {
          const selection = readSet(tx.owner, scope);
          if (intent !== "recall" && intent !== "read" && intent !== "export") invalidInput();
          return Array.from(visibleRefs(db, selection, refs, intent !== "recall"), entry => hydrateRow(db, entry));
        });
      },
    },
    recent: {
      recent(tx, scope, page) {
        return port(tx, scope?.owner, {}, db => {
          const selection = readSet(tx.owner, scope);
          if (!page || typeof page !== "object") invalidInput();
          const { cursor, limit } = page;
          validateLimit(limit);
          const after = cursor === null ? null : decodeRecent(cursor);
          // Each namespace is already ordered by the first two sort keys.
          // Only its first limit + 1 visible rows can affect the merged page.
          const rows = Array.from(visibleRows(db, selection, after, limit + 1)).sort(recentOrder);
          const items = rows.slice(0, limit);
          const last = items.at(-1);
          return { items, nextCursor: last && rows.length > limit ? encodeRecent(last) : null };
        });
      },
    },
    snapshot: {
      stateToken(tx, scope) {
        return port(tx, scope?.owner, {}, db => stateToken(db, readSet(tx.owner, scope)));
      },
      assertUnchanged(tx, scope, token) {
        return port(tx, scope?.owner, {}, db => {
          const selection = readSet(tx.owner, scope);
          validateSnapshotToken(token);
          if (token !== stateToken(db, selection)) throw new CoreError("cursor_stale");
        });
      },
    },
  };
}

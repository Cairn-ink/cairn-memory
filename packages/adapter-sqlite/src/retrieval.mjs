import { compareSortKey, compareUtf8, CoreError, createBM25, rankScores, scoreBM25, termFrequencies, tokenizeT1 } from "@cairn-ink/core";
import { decodeEntry, decodeJson, decodeStoredReceipt, LIVE_SCOPE, MEMORY_COLUMNS, readEntry, readReceipts } from "./memory-rows.mjs";
import { compareNamespaces, compareStrings, createSnapshotToken, validateSnapshotToken } from "./retrieval-snapshot.mjs";
import { invalidInput, ownerKey, scopeKey } from "./storage-values.mjs";
import { scopedSuppression } from "./suppressions.mjs";

/** @import { HydratedItem, ItemRef, MemoryRow, Namespace, RetrievalScope, StorageAdapter, VectorCandidates, VectorRow } from "@cairn-ink/core/ports" */
/** @import { Entry } from "./memory-rows.mjs" */
/** @import { Connection, Port } from "./storage-values.mjs" */
/** @import { SessionHasher } from "./suppressions.mjs" */
/** @typedef {Pick<MemoryRow, "id" | "updatedAtUs"> & {scope: { namespace: Namespace }}} RecentKey */

const decoder = new TextDecoder("utf-8", { fatal: true });
const maxSqlInteger = 9223372036854775807n;
const receiptsInScan = `(SELECT json_group_array(json_array(r.body, r.legacy_receipt_key) ORDER BY r.ordinal)
  FROM cairn_receipts AS r WHERE r.owner_id = m.owner_id AND r.namespace_key = m.namespace_key
    AND r.memory_id = m.id) AS scan_receipts`;

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

/** @param {ArrayLike<number>} vector */
function vectorScale(vector) {
  let scale = 0;
  for (let index = 0; index < vector.length; index++) {
    const value = vector[index];
    if (!Number.isFinite(value)) return NaN;
    scale = Math.max(scale, Math.abs(value));
  }
  return scale;
}

/** @param {number[]} query @param {number} queryNorm @param {number[]} vector */
function cosineDistance(query, queryNorm, vector) {
  const scale = vectorScale(vector);
  if (!scale) return undefined;
  let dot = 0;
  let norm = 0;
  for (let index = 0; index < query.length; index++) {
    const value = vector[index] / scale;
    dot += query[index] * value;
    norm += value * value;
  }
  return 1 - Math.max(-1, Math.min(1, dot / Math.sqrt(queryNorm * norm)));
}

/** @template T @param {T[]} heap @param {T} item @param {number} depth @param {(a: T, b: T) => number} order */
function keepBest(heap, item, depth, order) {
  // The worst retained candidate is at the root.
  if (heap.length < depth) {
    let index = heap.length;
    heap.push(item);
    while (index > 0) {
      const parent = Math.floor((index - 1) / 2);
      if (order(item, heap[parent]) <= 0) break;
      heap[index] = heap[parent];
      index = parent;
    }
    heap[index] = item;
  } else if (order(item, heap[0]) < 0) {
    let index = 0;
    while (2 * index + 1 < heap.length) {
      const left = 2 * index + 1;
      const right = left + 1;
      const child = right < heap.length && order(heap[right], heap[left]) > 0 ? right : left;
      if (order(heap[child], item) <= 0) break;
      heap[index] = heap[child];
      index = child;
    }
    heap[index] = item;
  }
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
 * @param {boolean} semanticRetrieval
 * @returns {Pick<StorageAdapter, "lexical" | "vector" | "fence" | "snapshot" | "hydrate" | "recent">}
 */
export function createRetrievalPorts(port, hashSession, storeKey, visibleRawRefs, semanticRetrieval) {
  const stateToken = createSnapshotToken(storeKey);

  /** @param {Connection} db @param {RetrievalScope} selection @param {RecentKey | null} after
   * @param {number} perNamespaceLimit @param {boolean} inlineReceipts
   */
  function* visibleRows(db, selection, after = null, perNamespaceLimit = Infinity, inlineReceipts = false) {
    // Bind the exact time when SQLite can represent it. The remaining keyset
    // comparison also handles equal times across namespaces.
    const timeBound = after && after.updatedAtUs <= maxSqlInteger ? [after.updatedAtUs] : [];
    const rowSource = `FROM cairn_memories AS m WHERE ${LIVE_SCOPE}
      AND historical = 0 ${timeBound.length ? "AND updated_at_us <= ?" : ""}
      ORDER BY updated_at_us DESC, id DESC`;
    const rows = db.prepare(`SELECT ${MEMORY_COLUMNS} ${rowSource}`);
    /** @type {typeof rows | undefined} */
    let rowsWithReceipts;
    for (const namespace of selection.namespaces) {
      if (namespace === "") continue; // No rows can be stored in an empty namespace.
      const scope = { owner: selection.owner, namespace };
      const policy = scopedSuppression(db, scope, hashSession);
      // Stream receipt evidence alongside each row when the vector scan needs it.
      const scan = inlineReceipts && policy.needsReceipts
        ? rowsWithReceipts ??= db.prepare(`SELECT ${MEMORY_COLUMNS}, ${receiptsInScan} ${rowSource}`)
        : rows;
      let remaining = perNamespaceLimit;
      for (const record of scan.iterate(...scopeKey(scope), ...timeBound)) {
        const entry = decodeEntry(scope, record);
        if (after && recentOrder(entry.row, after) <= 0) continue;
        if (!matchesFilters(selection, entry.row)) continue;
        const receipts = record.scan_receipts === undefined ? undefined :
          /** @type {Array<[string, string | null]>} */ (decodeJson(record.scan_receipts))
            .map(([body, legacyKey]) => decodeStoredReceipt(body, legacyKey));
        if (policy.hides(entry, receipts)) continue;
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

  /** @type {VectorCandidates} */
  const vector = {
    vector(tx, scope, query, model, depth) {
      return port(tx, scope?.owner, {}, db => {
        const selection = readSet(tx.owner, scope);
        validateLimit(depth);
        if (!(query instanceof Float32Array) || !query.length || typeof model !== "string" || !model) invalidInput();
        const values = Array.from(new Float32Array(query));
        const scale = vectorScale(values);
        if (!Number.isFinite(scale)) invalidInput();
        const scaled = scale ? values.map(value => value / scale) : [];
        const norm = scaled.reduce((sum, value) => sum + value * value, 0);
        // A complete tie keeps read-set order, as in the reference adapter's stable sort.
        const namespaceOrder = new Map(selection.namespaces.map((namespace, index) => [namespace, index]));
        /** @param {VectorRow} a @param {VectorRow} b */
        const order = (a, b) => a.distance - b.distance || compareSortKey(b.updatedAtUs, a.updatedAtUs) ||
          compareUtf8(b.ref.id, a.ref.id) || (namespaceOrder.get(a.ref.namespace) ?? 0) - (namespaceOrder.get(b.ref.namespace) ?? 0);
        /** @type {VectorRow[]} */
        const heap = [];
        let eligible = 0;
        let embedded = 0;
        for (const row of visibleRows(db, selection, null, Infinity, true)) {
          eligible++;
          if (!norm || row.embedding?.model !== model) continue;
          const stored = row.embedding.vector;
          if (!Array.isArray(stored) || stored.length !== scaled.length) continue;
          const distance = cosineDistance(scaled, norm, stored);
          if (distance === undefined) continue;
          embedded++;
          keepBest(heap, { ref: memoryRef(row), distance, updatedAtUs: row.updatedAtUs }, depth, order);
        }
        return { rows: heap.sort(order), coverage: { eligible, embedded, complete: embedded === eligible } };
      });
    },
  };

  return {
    ...(semanticRetrieval ? { vector } : {}),
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
      assertVisible(tx, scope, refs, intent) {
        // Core supplies a new read transaction for the final delivery check.
        return port(tx, scope?.owner, {}, db => {
          const selection = readSet(tx.owner, scope);
          const references = copyArray(refs);
          const visible = Array.from(visibleRefs(db, selection, references, intent === "read"), ({ row }) => memoryRef(row));
          return [...visible, ...visibleRawRefs(db, selection, references)];
        });
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

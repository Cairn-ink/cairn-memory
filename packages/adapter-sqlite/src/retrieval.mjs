import { compareSortKey, compareUtf8, CoreError, createBM25, rankScores, scoreBM25, termFrequencies, tokenizeT1 } from "@cairn-ink/core";
import { decodeEntry, decodeJson, LIVE_SCOPE, MEMORY_COLUMNS, readEntry, readReceipts } from "./memory-rows.mjs";
import { compareNamespaces, compareStrings, createSnapshotToken, validateSnapshotToken, vectorCacheEpoch } from "./retrieval-snapshot.mjs";
import { invalidInput, ownerKey, scopeKey } from "./storage-values.mjs";
import { scopedSuppression } from "./suppressions.mjs";
import { scheduleVectorWarmup } from "./uow.mjs";

/** @import { HydratedItem, ItemRef, MemoryRow, Namespace, RetrievalScope, StorageAdapter, UnitOfWork, VectorCandidates, VectorRow } from "@cairn-ink/core/ports" */
/** @import { Entry } from "./memory-rows.mjs" */
/** @import { Connection, Port } from "./storage-values.mjs" */
/** @import { SessionHasher } from "./suppressions.mjs" */
/** @typedef {Pick<MemoryRow, "id" | "updatedAtUs"> & {scope: { namespace: Namespace }}} RecentKey */
/** @typedef {Omit<VectorRow, "updatedAtUs"> & {revision: number, updatedAtUs?: bigint}} VectorCandidate */
/** @typedef {{ epoch: bigint, status: "building" | "ready" | "oversize", cursor: string[] | null,
 * scopes: Map<string, Map<string, number>>, models: Map<string, number>, keyUnits: number, entries: number,
 * revisions: Float64Array, modelIds: Uint32Array, inverseNorms: Float64Array,
 * offsets: Uint32Array, lengths: Uint32Array, segments: Uint32Array,
 * slabs: Uint8Array[], allocated: number, used: number }} CacheGeneration */

const decoder = new TextDecoder("utf-8", { fatal: true });
const typedArrayPrototype = Object.getPrototypeOf(Float32Array.prototype);
const typedArrayTag = Object.getOwnPropertyDescriptor(typedArrayPrototype, Symbol.toStringTag)?.get;
const maxSqlInteger = 9223372036854775807n;
const vectorPoolSize = 400;
const vectorReadMs = 800;
const warmBatchSize = 128;
const warmSliceMs = 8;
const slabSize = 512 * 1024;
const maxVectorBytes = 48 * 1024 * 1024;
const maxCacheEntries = 40_000;
const maxKeyUnits = 2 * 1024 * 1024;
const smallCommitRows = 16;
const smallCommitBytes = 128 * 1024;
const vectorJsonColumns = "body -> '$.embedding.model' AS model, CAST(body -> '$.embedding.vector' AS BLOB) AS coordinates";

const incompleteVector = () => ({ rows: [], coverage: { eligible: 0, embedded: 0, complete: false } });

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

/** @param {number[]} query @param {number} queryNorm @param {ArrayLike<number>} vector */
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

/** @param {import("node:sqlite").SQLOutputValue} raw */
function releaseProjection(raw) {
  // SQLite returns a fresh BLOB for each projection. Drop its backing store
  // once the decoded coordinates no longer depend on it.
  if (raw instanceof Uint8Array && raw.buffer instanceof ArrayBuffer) {
    const buffer = /** @type {ArrayBuffer & {transfer?(byteLength: number): ArrayBuffer}} */ (raw.buffer);
    buffer.transfer?.(0);
  }
}

/** @param {import("node:sqlite").SQLOutputValue} raw @param {Float64Array} scratch @param {boolean} [exact] */
function decodeCoordinates(raw, scratch, exact = false) {
  try {
    return decodeCoordinateBytes(raw, scratch, exact);
  } finally {
    releaseProjection(raw);
  }
}

/**
 * Decode the numeric JSON projected by SQLite into reusable float storage.
 * Exact scoring uses integer division for short decimals and the standard
 * JSON decoder for longer numbers or scientific notation. Quantization can
 * truncate the mantissa after fifteen digits.
 * @param {import("node:sqlite").SQLOutputValue} raw @param {Float64Array} scratch
 * @param {boolean} exact
 * @returns {number[] | Float64Array | null}
 */
function decodeCoordinateBytes(raw, scratch, exact) {
  if (!(raw instanceof Uint8Array) || raw.length < 2 || raw[0] !== 91 || raw.at(-1) !== 93) return null;
  let size = 0;
  let start = 1;
  while (start < raw.length - 1) {
    if (size === scratch.length) return JSON.parse(decoder.decode(raw));
    const comma = raw.indexOf(44, start);
    const end = comma >= 0 ? comma : raw.length - 1;
    const negative = raw[start] === 45;
    let cursor = start + Number(negative);
    let mantissa = 0, digits = 0, exponent = 0, fraction = false;
    for (; cursor < end; cursor++) {
      const byte = raw[cursor];
      if (byte >= 48 && byte <= 57) {
        if (fraction) exponent--;
        if (digits || byte !== 48) {
          if (digits < 15) mantissa = mantissa * 10 + byte - 48;
          else exponent++;
          digits++;
        }
      } else if (byte === 46 && !fraction) fraction = true;
      else break;
    }
    if (exact && (cursor !== end || digits > 15 || exponent < -15)) return JSON.parse(decoder.decode(raw));
    const signed = negative ? -mantissa : mantissa;
    const value = exact ? signed / 10 ** -exponent : cursor === end && exponent > -300 && exponent < 290
      ? signed * 10 ** exponent : Number(decoder.decode(raw.subarray(start, end)));
    if (!Number.isFinite(value)) return null;
    scratch[size++] = value;
    start = end + 1;
  }
  return scratch.subarray(0, size);
}

/** @param {CacheGeneration} cache @param {number} slot @param {string} model
 * @param {ArrayLike<number> | null} vector
 */
function quantize(cache, slot, model, vector) {
  if (!vector?.length || typeof model !== "string" || !model) return true;
  const scale = vectorScale(vector);
  if (!scale || !Number.isFinite(scale)) return true;
  let modelId = cache.models.get(model);
  if (modelId === undefined) {
    cache.keyUnits += model.length;
    if (cache.keyUnits > maxKeyUnits) return false;
    cache.models.set(model, modelId = cache.models.size + 1);
  }
  let bytes = cache.slabs.at(-1);
  if (!bytes || cache.used + vector.length > bytes.length) {
    const size = Math.max(cache.revisions.length <= smallCommitRows ? 8192 : slabSize, vector.length);
    if (cache.allocated + size > maxVectorBytes) return false;
    bytes = new Uint8Array(size);
    cache.slabs.push(bytes);
    cache.allocated += size;
    cache.used = 0;
  }
  const offset = cache.used;
  let norm = 0;
  for (let index = 0; index < vector.length; index++) {
    const value = Math.round(vector[index] / scale * 127);
    // Biased int8 values, packed into shared byte arrays. The per-vector
    // quantization scale cancels when computing cosine similarity.
    bytes[offset + index] = value + 128;
    norm += value * value;
  }
  cache.used += vector.length;
  cache.modelIds[slot] = modelId;
  cache.inverseNorms[slot] = 1 / Math.sqrt(norm);
  cache.offsets[slot] = offset;
  cache.lengths[slot] = vector.length;
  cache.segments[slot] = cache.slabs.length - 1;
  return true;
}

/** @param {number[]} query @param {number} inverseNorm @param {CacheGeneration} cache @param {number} slot */
function approximateDistance(query, inverseNorm, cache, slot) {
  const bytes = cache.slabs[cache.segments[slot]];
  const offset = cache.offsets[slot];
  let dot = 0;
  for (let index = 0; index < query.length; index++) dot += query[index] * (bytes[offset + index] - 128);
  return 1 - Math.max(-1, Math.min(1, dot * inverseNorm * cache.inverseNorms[slot]));
}

/** @param {bigint} epoch @param {number} [capacity] @returns {CacheGeneration} */
function emptyGeneration(epoch, capacity = maxCacheEntries) {
  return {
    epoch, status: "building", cursor: null, scopes: new Map(), models: new Map(), keyUnits: 0, entries: 0,
    revisions: new Float64Array(capacity), modelIds: new Uint32Array(capacity),
    inverseNorms: new Float64Array(capacity), offsets: new Uint32Array(capacity),
    lengths: new Uint32Array(capacity), segments: new Uint32Array(capacity),
    slabs: [], allocated: 0, used: 0,
  };
}

/** @param {UnitOfWork} uow @param {Port} port @param {SessionHasher} hashSession @param {() => number} now */
export function createVectorCache(uow, port, hashSession, now) {
  const warmOwner = "vector-cache";
  const scratch = new Float64Array(2048);
  /** @type {CacheGeneration | undefined} */
  let generation;
  let scheduled = false;
  let closed = false;

  /** @param {Connection} db @param {CacheGeneration} current @param {number} stopAt */
  function fill(db, current, stopAt) {
    const cursor = current.cursor;
    const rows = db.prepare(`SELECT owner_id, namespace_key, id, revision, ${vectorJsonColumns} FROM cairn_memories
      WHERE deleted = 0 AND historical = 0 ${cursor ? "AND (owner_id, namespace_key, id) > (?, ?, ?)" : ""}
      ORDER BY owner_id, namespace_key, id LIMIT ?`);
    let examined = 0;
    /** @type {ReturnType<typeof scopedSuppression> | undefined} */
    let policy;
    let currentKey = "";
    let currentOwner = "";
    let currentNamespaceKey = "";
    /** @type {MemoryRow["scope"]} */
    let scope = { owner: "", namespace: null };
    for (const record of rows.iterate(...(cursor ?? []), warmBatchSize)) {
      const owner = String(record.owner_id);
      const namespaceKey = String(record.namespace_key);
      const id = String(record.id);
      if (!policy || owner !== currentOwner || namespaceKey !== currentNamespaceKey) {
        currentOwner = owner;
        currentNamespaceKey = namespaceKey;
        currentKey = JSON.stringify([owner, namespaceKey]);
        scope = { owner, namespace: JSON.parse(namespaceKey) };
        policy = scopedSuppression(db, scope, hashSession);
      }
      current.cursor = [owner, namespaceKey, id];
      examined++;
      const entry = policy.facts.length || policy.legacy.size ? readEntry(db, scope, id) : null;
      if (entry) releaseProjection(record.coordinates);
      if (!entry || !policy.hides(entry)) {
        const model = entry ? entry.row.embedding?.model : decodeJson(record.model);
        const vector = entry ? entry.row.embedding?.vector : decodeCoordinates(record.coordinates, scratch);
        let entries = current.scopes.get(currentKey);
        const slot = current.entries++;
        current.keyUnits += id.length + (entries ? 0 : currentKey.length);
        if (slot >= current.revisions.length || current.keyUnits > maxKeyUnits ||
            (model && vector && !quantize(current, slot, model, vector))) {
          current.status = "oversize";
          current.scopes.clear();
          current.models.clear();
          current.slabs.length = 0;
          return;
        }
        current.revisions[slot] = Number(record.revision);
        if (!entries) current.scopes.set(currentKey, entries = new Map());
        entries.set(id, slot);
      }
      if (now() >= stopAt) return;
    }
    if (examined < warmBatchSize) current.status = "ready";
  }

  function schedule() {
    if (closed || scheduled) return;
    scheduled = true;
    scheduleVectorWarmup(() => { void step(); });
  }

  async function step() {
    try {
      if (closed || (generation && generation.status !== "building")) return;
      await uow.run(warmOwner, { readOnly: true }, tx => port(tx, warmOwner, { cachedStatements: true }, db => {
        const epoch = vectorCacheEpoch(db);
        if (!generation || generation.epoch !== epoch) generation = emptyGeneration(epoch);
        fill(db, generation, now() + warmSliceMs);
      }));
    } catch {
      // A failed warm-up is incomplete. A later visibility change starts a new generation.
      generation = undefined;
      return;
    } finally {
      scheduled = false;
    }
    if (!generation || generation.status === "building") schedule();
  }

  function invalidate() {
    generation = undefined;
    schedule();
  }

  /**
   * A small committed store can publish its new snapshot with the write. The
   * row and byte checks include evidence that the visibility predicate reads.
   * @param {Connection} db @param {bigint} epoch
   */
  function prepareCommit(db, epoch) {
    try {
      const footprint = db.prepare(`SELECT count(*) AS rows, COALESCE(SUM(bytes), 0) AS bytes FROM (
        SELECT length(CAST(body AS BLOB)) AS bytes FROM cairn_memories
        UNION ALL SELECT length(CAST(body AS BLOB)) FROM cairn_suppression_facts
        UNION ALL SELECT length(CAST(body AS BLOB)) FROM cairn_receipts
        UNION ALL SELECT length(CAST(fingerprint AS BLOB)) FROM cairn_legacy_denials
        LIMIT ?
      )`).get(smallCommitRows + 1);
      const count = Number(footprint?.rows);
      if (count <= smallCommitRows && Number(footprint?.bytes) <= smallCommitBytes) {
        const next = emptyGeneration(epoch, count);
        fill(db, next, Infinity);
        if (next.status === "ready") return () => { generation = next; };
      }
    } catch {
      // A cache preparation failure leaves committed storage authoritative.
    }
    return invalidate;
  }

  return {
    start: schedule,
    prepareCommit,
    close() {
      closed = true;
      generation = undefined;
    },
    /** @param {Connection} db @param {boolean} readOnly */
    read(db, readOnly) {
      if (!generation || generation.status === "building") return undefined;
      const epoch = vectorCacheEpoch(db);
      if (epoch === generation.epoch && generation.status === "ready") return generation;
      // A later external commit requires a new generation. An older snapshot
      // or a transaction's own uncommitted writes cannot invalidate it.
      if (readOnly && epoch > generation.epoch) invalidate();
      return undefined;
    },
  };
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

/** @param {Connection} db @param {Entry} entry @param {SessionHasher} [lineageHash] @returns {HydratedItem} */
function hydrateRow(db, { row }, lineageHash) {
  const receipts = readReceipts(db, row.scope, row.id).flatMap(receipt => {
    const { client, sessionId, messageId, role, occurredAtMs, legacyReceiptKey, legacy } = receipt;
    const address = { client, sessionId, messageId, role, occurredAtMs };
    if (!lineageHash) return [address];
    // Forget joins opaque span keys to the retained clear source selectors.
    const sessions = legacyReceiptKey !== undefined && legacy?.spans?.length
      ? new Set(legacy.spans.map(span => span.sessionId)) : [sessionId];
    return Array.from(sessions, spanSession => ({ ...address, messageKey: messageId,
      sessionKeyHash: lineageHash(row.scope, client, spanSession) }));
  });
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
 * @param {ReturnType<typeof import("./raw-read.mjs").createRawReads>["visibleRawRefs"]} visibleRawRefs
 * @param {ReturnType<typeof createVectorCache> | undefined} cache @param {() => number} now
 * @param {(tx: import("@cairn-ink/core/ports").Tx, scope: RetrievalScope, refs: readonly ItemRef[]) => Promise<ItemRef[]>} [visibleCardRefs]
 * @returns {Pick<StorageAdapter, "lexical" | "vector" | "fence" | "snapshot" | "hydrate" | "recent">}
 */
export function createRetrievalPorts(port, hashSession, storeKey, visibleRawRefs, cache, now, visibleCardRefs) {
  const stateToken = createSnapshotToken(storeKey);
  const memoryStateToken = createSnapshotToken(storeKey, true);

  /** @param {Connection} db @param {RetrievalScope} selection @param {RecentKey | null} after
   * @param {number} perNamespaceLimit
   */
  function* visibleRows(db, selection, after = null, perNamespaceLimit = Infinity) {
    // Bind the exact time when SQLite can represent it. The remaining keyset
    // comparison also handles equal times across namespaces.
    const timeBound = after && after.updatedAtUs <= maxSqlInteger ? [after.updatedAtUs] : [];
    const rowSource = `FROM cairn_memories AS m WHERE ${LIVE_SCOPE}
      AND historical = 0 ${timeBound.length ? "AND updated_at_us <= ?" : ""}
      ORDER BY updated_at_us DESC, id DESC`;
    const rows = db.prepare(`SELECT ${MEMORY_COLUMNS} ${rowSource}`);
    for (const namespace of selection.namespaces) {
      if (namespace === "") continue; // No rows can be stored in an empty namespace.
      const scope = { owner: selection.owner, namespace };
      const policy = scopedSuppression(db, scope, hashSession);
      let remaining = perNamespaceLimit;
      for (const record of rows.iterate(...scopeKey(scope), ...timeBound)) {
        const entry = decodeEntry(scope, record);
        if (after && recentOrder(entry.row, after) <= 0) continue;
        if (!matchesFilters(selection, entry.row)) continue;
        if (policy.hides(entry)) continue;
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
        if (typedArrayTag?.call(query) !== "Float32Array" || !query.length || typeof model !== "string" || !model) invalidInput();
        const values = Array.from(new Float32Array(query));
        const scale = vectorScale(values);
        if (!Number.isFinite(scale)) invalidInput();
        const snapshot = cache?.read(db, tx.readOnly);
        if (!snapshot) return incompleteVector();
        const generation = snapshot;
        const modelId = generation.models.get(model);
        const stopAt = now() + vectorReadMs;
        const scaled = scale ? values.map(value => value / scale) : [];
        const norm = scaled.reduce((sum, value) => sum + value * value, 0);
        const inverseNorm = norm ? 1 / Math.sqrt(norm) : 0;
        // A complete tie keeps read-set order, as in the reference adapter's stable sort.
        const namespaceOrder = new Map(selection.namespaces.map((namespace, index) => [namespace, index]));
        /** @param {VectorCandidate} row */
        function sortTime(row) {
          const target = { owner: selection.owner, namespace: row.ref.namespace };
          const stamp = timeLookup.get(...scopeKey(target), row.ref.id)?.sort_key;
          return row.updatedAtUs ??= BigInt(String(stamp));
        }
        /** @param {VectorCandidate} a @param {VectorCandidate} b */
        const tieOrder = (a, b) =>
          compareUtf8(b.ref.id, a.ref.id) || (namespaceOrder.get(a.ref.namespace) ?? 0) - (namespaceOrder.get(b.ref.namespace) ?? 0);
        /** @param {VectorCandidate} a @param {VectorCandidate} b */
        const approxOrder = (a, b) => a.distance - b.distance ||
          compareSortKey(b.updatedAtUs ?? sortTime(b), a.updatedAtUs ?? sortTime(a)) || tieOrder(a, b);
        /** @type {VectorCandidate[]} */
        const heap = [];
        const clients = selection.clients === undefined ? null : new Set(selection.clients);
        if (clients?.size === 0) return { rows: [], coverage: { eligible: 0, embedded: 0, complete: true } };
        const { sinceMs, untilMs } = selection.window ?? {};
        // JSON text preserves client strings containing NUL or escaped surrogates.
        const clientColumn = clients ? ", body -> '$.source.client' AS client" : "";
        const metadata = clients || sinceMs !== undefined || untilMs !== undefined
          ? db.prepare(`SELECT id, revision, created_at_ms${clientColumn}
              FROM cairn_memories WHERE ${LIVE_SCOPE} AND historical = 0`)
          : null;
        const timeLookup = db.prepare(`SELECT CAST(updated_at_us AS TEXT) AS sort_key
          FROM cairn_memories WHERE ${LIVE_SCOPE} AND id = ?`);
        let examined = 0;
        let eligible = 0;
        let embedded = 0;

        /** @param {string} id @param {Namespace} namespace @param {number} slot */
        function consider(id, namespace, slot) {
          eligible++;
          if (!norm || generation.modelIds[slot] !== modelId || generation.lengths[slot] !== scaled.length) return;
          embedded++;
          const distance = approximateDistance(scaled, inverseNorm, generation, slot);
          if (heap.length === vectorPoolSize && distance > heap[0].distance) return;
          keepBest(heap, { ref: { type: "memory", id, namespace }, distance, revision: generation.revisions[slot] }, vectorPoolSize, approxOrder);
        }

        for (const namespace of selection.namespaces) {
          if (now() >= stopAt) return incompleteVector();
          if (namespace === "") continue;
          const keys = scopeKey({ owner: selection.owner, namespace });
          const entries = generation.scopes.get(JSON.stringify(keys));
          if (!entries) continue;
          // The epoch certifies that these eligible keys still match this
          // transaction. A filter additionally needs canonical row metadata.
          if (!metadata) {
            for (const [id, slot] of entries) {
              if (++examined % 32 === 0 && now() >= stopAt) return incompleteVector();
              consider(id, namespace, slot);
            }
            continue;
          }
          for (const record of metadata.iterate(...keys)) {
            if (++examined % 32 === 0 && now() >= stopAt) return incompleteVector();
            const createdAtMs = Number(record.created_at_ms);
            if ((sinceMs !== undefined && createdAtMs < sinceMs) || (untilMs !== undefined && createdAtMs >= untilMs) ||
                (clients && (typeof record.client !== "string" || !clients.has(decodeJson(record.client))))) continue;
            const id = String(record.id);
            const slot = entries.get(id);
            if (slot === undefined) continue;
            if (generation.revisions[slot] !== record.revision) return incompleteVector();
            consider(id, namespace, slot);
          }
        }
        const livePoolRow = `FROM cairn_memories WHERE ${LIVE_SCOPE} AND historical = 0 AND id = ?`;
        const poolRows = db.prepare(`SELECT ${MEMORY_COLUMNS} ${livePoolRow}`);
        const poolVectors = db.prepare(`SELECT revision, CAST(updated_at_us AS TEXT) AS sort_key, ${vectorJsonColumns} ${livePoolRow}`);
        const scratch = new Float64Array(Math.min(scaled.length, 2048));
        /** @type {Map<Namespace, ReturnType<typeof scopedSuppression>>} */
        const policies = new Map();
        /** @type {VectorRow[]} */
        const rows = [];
        for (const { ref, revision } of heap) {
          if (now() >= stopAt) return incompleteVector();
          const target = { owner: selection.owner, namespace: ref.namespace };
          let policy = policies.get(ref.namespace);
          if (!policy) {
            policy = scopedSuppression(db, target, hashSession);
            policies.set(ref.namespace, policy);
          }
          const needsEvidence = policy.facts.length > 0 || policy.legacy.size > 0;
          const record = (needsEvidence ? poolRows : poolVectors).get(...scopeKey(target), ref.id);
          if (!record || record.revision !== revision) return incompleteVector();
          // The metadata scan applied request filters in this snapshot.
          // Load the full canonical row whenever its privacy evidence matters.
          const entry = needsEvidence ? decodeEntry(target, record) : null;
          if (entry && policy.hides(entry)) return incompleteVector();
          const storedModel = entry ? entry.row.embedding?.model : decodeJson(record.model);
          const stored = entry ? entry.row.embedding?.vector : decodeCoordinates(record.coordinates, scratch, true);
          if (storedModel !== model || stored?.length !== scaled.length) return incompleteVector();
          const distance = cosineDistance(scaled, norm, stored);
          if (distance === undefined) return incompleteVector();
          rows.push({ ref, distance, updatedAtUs: BigInt(String(record.sort_key)) });
        }
        rows.sort((a, b) => a.distance - b.distance || compareSortKey(b.updatedAtUs, a.updatedAtUs) ||
          compareUtf8(b.ref.id, a.ref.id) ||
          (namespaceOrder.get(a.ref.namespace) ?? 0) - (namespaceOrder.get(b.ref.namespace) ?? 0));
        return { rows: rows.slice(0, depth),
          coverage: { eligible, embedded, complete: embedded === eligible && Math.min(depth, embedded) <= vectorPoolSize } };
      });
    },
  };

  return {
    ...(cache ? { vector } : {}),
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
      async assertVisible(tx, scope, refs, intent, matchesRawVersion) {
        // Core supplies a new read transaction for the final delivery check.
        const { selection, references, visible, raw } = await port(tx, scope?.owner, {}, db => {
          const selection = readSet(tx.owner, scope);
          const references = copyArray(refs);
          const visible = Array.from(visibleRefs(db, selection, references, intent === "read"), ({ row }) => memoryRef(row));
          return { selection, references, visible, raw: visibleRawRefs(db, selection, references, matchesRawVersion) };
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
          const lineageHash = visibleCardRefs && intent === "read" && !tx.readOnly ? hashSession : undefined;
          return Array.from(visibleRefs(db, selection, refs, intent !== "recall"), entry => hydrateRow(db, entry, lineageHash));
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
      findMemory: {
        stateToken(tx, scope) {
          return port(tx, scope?.owner, {}, db => memoryStateToken(db, readSet(tx.owner, scope)));
        },
        assertUnchanged(tx, scope, token) {
          return port(tx, scope?.owner, {}, db => {
            if (token !== memoryStateToken(db, readSet(tx.owner, scope))) throw new CoreError("cursor_stale");
          });
        },
      },
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

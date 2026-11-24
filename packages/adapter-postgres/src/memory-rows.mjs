import { allDigests, CoreError } from "../../core/src/index.mjs";
import { readSourceKind } from "./memory-metadata.mjs";

/** @import { MemoryRow, Receipt } from "../../core/src/ports/index.d.ts" */
/** @import { TextDigest } from "../../core/src/index.mjs" */
/** @import { Connection } from "./driver.mjs" */
/** @typedef {Connection["query"]} Query */

export const TEXT_HASH = "'sha256:' || text_hash";
export const CREATED_MS = "COALESCE(core_created_at_ms, floor(EXTRACT(EPOCH FROM created_at) * 1000))";
export const WRITE_TIME_US = "(EXTRACT(EPOCH FROM updated_at) * 1000000)::bigint";
export const MATCH_COLUMNS = `id, core_namespace, revision, ${WRITE_TIME_US}::text AS updated_us`;
export const MEMORY_COLUMNS = `${MATCH_COLUMNS}, ${TEXT_HASH} AS logical_hash, core_digests, kind, origin,
  confidence, text, source_kind, source_client, source_session_id, ${CREATED_MS}::text AS created_ms,
  embedding_model, embedding::text, currentness`;

/** @param {string} parameter */
export function timestampUs(parameter) {
  // Split days from the µs remainder before interval multiplication to keep the exact sort key.
  const us = `${parameter}::bigint`;
  return `((TIMESTAMP 'epoch' + (${us} / 86400000000)::integer * INTERVAL '1 day'
    + (${us} % 86400000000) * INTERVAL '1 microsecond') AT TIME ZONE 'UTC')`;
}

// A whole-day boundary within PostgreSQL's timestamp range.
const MIN_TIMESTAMP_MS = -210866716800000;

/** @param {number} ms */
export function timestampParts(ms) {
  if (ms < MIN_TIMESTAMP_MS || !Number.isSafeInteger(ms)) return { us: null, exact: ms };
  return { us: (BigInt(ms) * 1000n).toString(), exact: null };
}

/** @param {number} ms */
function receiptTimestamp(ms) {
  const { us, exact } = timestampParts(ms);
  if (exact === null) return { us, exact };
  const whole = Math.trunc(ms);
  const micros = Math.round((ms - whole) * 1000);
  return Number.isSafeInteger(whole) && ms >= MIN_TIMESTAMP_MS && whole + micros / 1000 === ms
    ? { us: (BigInt(whole) * 1000n + BigInt(micros)).toString(), exact: null } : { us: null, exact };
}

/** @param {bigint} us */
export function floorMillis(us) {
  return Number((us - (us < 0n ? 999n : 0n)) / 1000n);
}

/** @param {any} row @param {string} owner */
function readVisibilityFields(row, owner) {
  const updatedAtUs = BigInt(row.updated_us);
  return {
    id: /** @type {string} */ (row.id),
    scope: { owner, namespace: /** @type {string | null} */ (row.core_namespace === null ? null : JSON.parse(row.core_namespace)) },
    textHash: /** @type {string} */ (row.logical_hash),
    revision: /** @type {number} */ (row.revision),
    source: { client: /** @type {string | null} */ (row.source_client ?? null),
      sessionId: /** @type {string | null} */ (row.source_session_id ?? null) },
    createdAtMs: Number(row.created_ms), updatedAtMs: floorMillis(updatedAtUs), updatedAtUs,
  };
}

/** @param {any} row @param {string} owner @returns {MemoryRow} */
export function readMemory(row, owner) {
  const fields = readVisibilityFields(row, owner);
  const kind = readSourceKind(row.source_kind);
  return {
    ...fields,
    kind: row.kind, origin: row.origin ?? (kind === "plugin" ? "inferred" : "explicit"),
    text: row.text, confidence: row.confidence, source: { kind, ...fields.source },
    embedding: { model: row.embedding_model, vector: JSON.parse(row.embedding) },
    historical: row.currentness === "historical",
  };
}

/** @param {any} row @param {string} owner */
export function readEntry(row, owner) {
  return { memory: readMemory(row, owner), digests: /** @type {TextDigest[] | null} */ (row.core_digests) };
}

/** @typedef {ReturnType<typeof readEntry>} MemoryEntry */
/** @typedef {ReturnType<typeof readCandidate>} CandidateEntry */

/** @param {any} row @param {string} owner */
export function readCandidate(row, owner) {
  const memory = {
    ...readVisibilityFields(row, owner),
    text: /** @type {string | undefined} */ (row.text ?? undefined),
    embedding: row.embedding == null ? undefined : { vector: /** @type {number[]} */ (JSON.parse(row.embedding)) },
  };
  return { memory, digests: /** @type {TextDigest[] | null} */ (row.core_digests) };
}

/** @param {Query} query @param {string} owner @param {string | null} namespace @param {string} id */
export async function selectMemory(query, owner, namespace, id) {
  const { rows: [row] } = await query(`SELECT ${MEMORY_COLUMNS} FROM memories
    WHERE user_id = $1 AND core_namespace IS NOT DISTINCT FROM $2 AND id = $3`, [owner, namespace, id]);
  return row ? readEntry(row, owner) : null;
}

/** @param {Query} query @param {string} owner */
export async function advanceIndex(query, owner) {
  await query(`INSERT INTO core_owner_state (user_id, index_revision) VALUES ($1, 1)
    ON CONFLICT (user_id) DO UPDATE SET index_revision = core_owner_state.index_revision + 1`, [owner]);
}

/** @param {string} ids SQL expression returning the selected memory IDs as text[].
 * @param {string} [limit] SQL expression limiting the returned receipts. */
export function memoryReceiptsSql(ids, limit = "NULL") {
  return `SELECT memory_id, client, session_id, message_id, role,
      COALESCE(core_occurred_at_ms, EXTRACT(EPOCH FROM occurred_at) * 1000)::text AS occurred_ms
    FROM core_memory_receipts WHERE user_id = $1 AND memory_id = ANY(${ids}) AND forgotten_at IS NULL
    ORDER BY memory_id COLLATE "C", client COLLATE "C", session_id COLLATE "C", message_id COLLATE "C"
    LIMIT ${limit}`;
}

/** @param {any[]} rows */
export function decodeReceipts(rows) {
  /** @type {Map<string, Receipt[]>} */
  const result = new Map();
  for (const row of rows) {
    let receipts = result.get(row.memory_id);
    if (!receipts) result.set(row.memory_id, receipts = []);
    receipts.push({
      client: row.client, sessionId: row.session_id, messageId: row.message_id, role: row.role,
      occurredAtMs: row.occurred_ms === null ? null : Number(row.occurred_ms),
    });
  }
  return result;
}

/** @param {Query} query @param {string} owner @param {readonly string[]} ids @param {number} [limit] */
export async function readReceipts(query, owner, ids, limit) {
  if (ids.length === 0) return new Map();
  const { rows } = await query(memoryReceiptsSql("$2::text[]", "$3"), [owner, ids, limit ?? null]);
  return decodeReceipts(rows);
}

/** @param {Query} query @param {string} owner @param {string} id @param {readonly Receipt[]} receipts */
export async function attachReceipts(query, owner, id, receipts) {
  if (receipts.length === 0) return false;
  const times = receipts.map(({ occurredAtMs }) =>
    occurredAtMs === null ? { us: null, exact: null } : receiptTimestamp(occurredAtMs));
  const result = await query(`INSERT INTO core_memory_receipts
    (user_id, memory_id, client, session_id, message_id, role, occurred_at, core_occurred_at_ms)
    SELECT $1, $2, client, session_id, message_id, role, ${timestampUs("us")}, exact_ms
    FROM unnest($3::text[], $4::text[], $5::text[], $6::text[], $7::bigint[], $8::double precision[])
      WITH ORDINALITY AS receipt(client, session_id, message_id, role, us, exact_ms, ordinal)
    ORDER BY ordinal ON CONFLICT (user_id, memory_id, client, session_id, message_id) DO NOTHING
    RETURNING memory_id`, [owner, id, receipts.map(r => r.client), receipts.map(r => r.sessionId),
    receipts.map(r => r.messageId), receipts.map(r => r.role), times.map(t => t.us), times.map(t => t.exact)]);
  return result.rows.length > 0;
}

/** @param {Query} query @param {string} owner @param {string} id */
export async function deleteActiveReceipts(query, owner, id) {
  // Marked rows are replay tombstones. Their memory ID is only a storage key.
  await query("DELETE FROM core_memory_receipts WHERE user_id = $1 AND memory_id = $2 AND forgotten_at IS NULL", [owner, id]);
}

/** @param {{text: string, digests?: TextDigest[]}} row */
export async function contentDigests(row) {
  return row.digests ?? await allDigests(row.text);
}

/** @param {string} hash A validated core hash. */
export function storageHash(hash) {
  return hash.slice("sha256:".length);
}

/** @param {unknown} value */
export function readRevisionNumber(value) {
  if (typeof value !== "number" || !Number.isInteger(value) || value < 1 || value > 2147483647) {
    throw new CoreError("invalid_input");
  }
  return value;
}

import { allDigests, CoreError } from "../../core/src/index.mjs";
import { readSourceKind } from "./memory-metadata.mjs";

/** @import { MemoryRow, Receipt } from "../../core/src/ports/index.d.ts" */
/** @import { TextDigest } from "../../core/src/index.mjs" */
/** @import { Connection } from "./driver.mjs" */
/** @typedef {Connection["query"]} Query */

export const TEXT_HASH = "COALESCE(core_text_hash, text_hash)";
export const CREATED_MS = "COALESCE(core_created_at_ms, floor(EXTRACT(EPOCH FROM created_at) * 1000))";
export const MEMORY_COLUMNS = `id, core_namespace, kind, origin, text, ${TEXT_HASH} AS logical_hash,
  core_digests, confidence, source_kind, source_client, source_session_id, revision,
  ${CREATED_MS}::text AS created_ms, (EXTRACT(EPOCH FROM updated_at) * 1000000)::bigint::text AS updated_us,
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

/** @param {bigint} us */
export function floorMillis(us) {
  return Number((us - (us < 0n ? 999n : 0n)) / 1000n);
}

/** @param {any} row @param {string} owner @returns {MemoryRow} */
export function readMemory(row, owner) {
  const updatedAtUs = BigInt(row.updated_us);
  const kind = readSourceKind(row.source_kind);
  return {
    id: row.id, scope: { owner, namespace: row.core_namespace === null ? null : JSON.parse(row.core_namespace) },
    kind: row.kind, origin: row.origin ?? (kind === "plugin" ? "inferred" : "explicit"),
    text: row.text, textHash: row.logical_hash, confidence: row.confidence, revision: row.revision,
    source: { kind, client: row.source_client, sessionId: row.source_session_id },
    createdAtMs: Number(row.created_ms), updatedAtMs: floorMillis(updatedAtUs), updatedAtUs,
    embedding: { model: row.embedding_model, vector: JSON.parse(row.embedding) },
    historical: row.currentness === "historical",
  };
}

/** @param {any} row @param {string} owner */
export function readEntry(row, owner) {
  return { memory: readMemory(row, owner), digests: /** @type {TextDigest[] | null} */ (row.core_digests) };
}

/** @typedef {ReturnType<typeof readEntry>} MemoryEntry */

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

/** @param {Query} query @param {string} owner @param {readonly string[]} ids */
export async function readReceipts(query, owner, ids) {
  /** @type {Map<string, Receipt[]>} */
  const result = new Map();
  if (ids.length === 0) return result;
  const { rows } = await query(`SELECT memory_id, client, session_id, message_id, role,
      COALESCE(core_occurred_at_ms, floor(EXTRACT(EPOCH FROM occurred_at) * 1000)) AS occurred_ms
    FROM core_memory_receipts WHERE user_id = $1 AND memory_id = ANY($2::text[])
    ORDER BY memory_id COLLATE "C", client COLLATE "C", session_id COLLATE "C", message_id COLLATE "C"`, [owner, ids]);
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

/** @param {Query} query @param {string} owner @param {string} id @param {readonly Receipt[]} receipts */
export async function attachReceipts(query, owner, id, receipts) {
  if (receipts.length === 0) return false;
  const times = receipts.map(({ occurredAtMs }) =>
    occurredAtMs === null ? { us: null, exact: null } : timestampParts(occurredAtMs));
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

/** @param {{text: string, digests?: TextDigest[]}} row */
export async function contentDigests(row) {
  return row.digests ?? await allDigests(row.text);
}

/**
 * The hosted unique key still guards ordinary hosted writes. Use a separate logical hash only
 * when a row in a different namespace or a hidden row already holds the physical hash.
 * @param {Query} query @param {string} owner @param {string} id @param {string} hash
 */
export async function storageHash(query, owner, id, hash) {
  const { rows } = await query("SELECT id FROM memories WHERE user_id = $1 AND text_hash = $2 AND id <> $3",
    [owner, hash, id]);
  return rows.length ? [`core:${id}`, hash] : [hash, null];
}

/** @param {unknown} value */
export function readRevisionNumber(value) {
  if (typeof value !== "number" || !Number.isInteger(value) || value < 1 || value > 2147483647) {
    throw new CoreError("invalid_input");
  }
  return value;
}

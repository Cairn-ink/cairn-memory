import { scopeKey } from "./storage-values.mjs";

/** @import { TextDigest } from "@cairn-ink/core" */
/** @import { MemoryRow, Receipt, Scope } from "@cairn-ink/core/ports" */
/** @import { Connection } from "./storage-values.mjs" */
/** @typedef {{ row: MemoryRow, legacyHash?: string, historyHash?: string, digests: TextDigest[] }} Entry */
/** @typedef {Receipt & {legacyReceiptKey?: string, legacy?: {
 * canonicalRead?: boolean,
 * spans?: Array<{sessionId: string, start: number, end: number, precision: string}>
 * }}} StoredReceipt */

export const MEMORY_COLUMNS =
  "id, revision, historical, created_at_ms, CAST(updated_at_us AS TEXT) AS sort_key, text_hash, legacy_hash, body";

export const LIVE_SCOPE = "owner_id = ? AND namespace_key = ? AND deleted = 0";

/** @param {import("node:sqlite").SQLOutputValue} value */
export function decodeJson(value) {
  return JSON.parse(String(value));
}

/** @param {Scope} scope @param {Record<string, import("node:sqlite").SQLOutputValue>} record @returns {Entry} */
export function decodeEntry(scope, record) {
  const { digests, historyHash, time: _legacyTime, ...body } = /** @type {ReturnType<typeof import("./storage-values.mjs").encodeContent>["body"] &
    { historyHash?: string, time?: { createdAt: string, updatedAt: string } }} */ (
    decodeJson(record.body)
  );
  const updatedAtUs = BigInt(String(record.sort_key));
  return {
    row: {
      ...body,
      id: String(record.id),
      scope: { owner: scope.owner, namespace: scope.namespace },
      textHash: String(record.text_hash),
      revision: Number(record.revision),
      historical: record.historical === 1,
      createdAtMs: Number(record.created_at_ms),
      updatedAtMs: Number(updatedAtUs / 1000n),
      updatedAtUs,
    },
    legacyHash: record.legacy_hash === null ? undefined : String(record.legacy_hash),
    historyHash,
    digests,
  };
}

/** @param {Connection} db @param {Scope} scope @param {string} id */
export function readEntry(db, scope, id) {
  const record = db.prepare(`SELECT ${MEMORY_COLUMNS} FROM cairn_memories WHERE ${LIVE_SCOPE} AND id = ?`)
    .get(...scopeKey(scope), id);
  return record && decodeEntry(scope, record);
}

/** @param {Connection} db @param {Scope} scope @param {string} id @returns {StoredReceipt[]} */
export function readReceipts(db, scope, id) {
  return db.prepare(`SELECT body, legacy_receipt_key FROM cairn_receipts
    WHERE owner_id = ? AND namespace_key = ? AND memory_id = ? ORDER BY ordinal`)
    .all(...scopeKey(scope), id).map(({ body, legacy_receipt_key }) =>
      ({ ...decodeJson(body), ...(legacy_receipt_key && { legacyReceiptKey: legacy_receipt_key }) }));
}

/** @param {Connection} db @param {Scope} scope @param {string} id */
export function clearReceipts(db, scope, id) {
  db.prepare("DELETE FROM cairn_receipts WHERE owner_id = ? AND namespace_key = ? AND memory_id = ?")
    .run(...scopeKey(scope), id);
}

/** @param {Connection} db @param {Scope} scope @param {string} id @param {readonly Receipt[]} receipts */
export function attachReceipts(db, scope, id, receipts) {
  if (!receipts.length) return;
  const select = db.prepare(`SELECT COALESCE(MAX(ordinal), 0) AS last FROM cairn_receipts
    WHERE owner_id = ? AND namespace_key = ? AND memory_id = ?`);
  const insert = db.prepare(`INSERT INTO cairn_receipts (owner_id, namespace_key, memory_id, ordinal, source_key, body)
    VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT (owner_id, namespace_key, memory_id, source_key) DO NOTHING`);
  const keys = [...scopeKey(scope), id];
  let ordinal = Number(select.get(...keys)?.last);
  for (const receipt of receipts) {
    insert.run(...keys, ++ordinal, JSON.stringify([receipt.client, receipt.sessionId, receipt.messageId]), JSON.stringify(receipt));
  }
}

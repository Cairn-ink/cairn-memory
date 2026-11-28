import { randomUUID } from "node:crypto";
import { CoreError, receiptExcerpt } from "../../core/src/index.mjs";
import { receiptAddressDenial, receiptExcerptDenial, receiptIdentityDenial, receiptIdentityKey } from "./receipt-identity.mjs";
import { invalidInput, ownerKey, scopeKey, writeTime } from "./storage-values.mjs";

/** @import { TextDigest } from "@cairn-ink/core" */
/** @import { MemoryRow, Receipt, Scope } from "@cairn-ink/core/ports" */
/** @import { Connection } from "./storage-values.mjs" */
/** @typedef {{ revision: number, factEpoch: string }} TextVersion */
/** @typedef {{ row: MemoryRow, legacyHash?: string, historyHash?: string, digests: TextDigest[], textVersions: TextVersion[] }} Entry */
/** @typedef {Receipt & {receiptKey?: string, legacyReceiptKey?: string, legacy?: {
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

/** @param {Connection} db @param {string} owner */
export function readSuppressionEpoch(db, owner) {
  const row = db.prepare("SELECT epoch FROM cairn_suppression_epochs WHERE owner_id = ?").get(ownerKey(owner));
  return row ? BigInt(String(row.epoch)) : null;
}

/** @param {Scope} scope @param {Record<string, import("node:sqlite").SQLOutputValue>} record @returns {Entry} */
export function decodeEntry(scope, record) {
  const { digests, historyHash, textVersions, time: _legacyTime, ...body } = /** @type {ReturnType<typeof import("./storage-values.mjs").encodeContent>["body"] &
    { historyHash?: string, textVersions?: TextVersion[], time?: { createdAt: string, updatedAt: string } }} */ (
    decodeJson(record.body)
  );
  const updatedAtUs = BigInt(String(record.sort_key));
  const revision = Number(record.revision);
  return {
    row: {
      ...body,
      id: String(record.id),
      scope: { owner: scope.owner, namespace: scope.namespace },
      textHash: String(record.text_hash),
      revision,
      historical: record.historical === 1,
      createdAtMs: Number(record.created_at_ms),
      updatedAtMs: Number(updatedAtUs / 1000n),
      updatedAtUs,
    },
    legacyHash: record.legacy_hash === null ? undefined : String(record.legacy_hash),
    historyHash,
    digests,
    // An existing row without history only proves its current text.
    textVersions: textVersions ?? [{ revision, factEpoch: "0" }],
  };
}

/** @param {Connection} db @param {Scope} scope @param {string} id */
export function readEntry(db, scope, id) {
  const record = db.prepare(`SELECT ${MEMORY_COLUMNS} FROM cairn_memories WHERE ${LIVE_SCOPE} AND id = ?`)
    .get(...scopeKey(scope), id);
  return record && decodeEntry(scope, record);
}

/** @param {Connection} db @param {Scope} scope @param {ReturnType<typeof import("./storage-values.mjs").encodeContent>} content
 * @param {readonly Receipt[]} receipts @param {number} nowMs @param {number} [createdAtMs]
 */
export function insertMemory(db, scope, { body, textHash, legacyHash }, receipts, nowMs, createdAtMs = nowMs) {
  const time = writeTime(nowMs);
  if (!Number.isSafeInteger(createdAtMs) || createdAtMs > nowMs) invalidInput();
  const textVersions = [{ revision: 1, factEpoch: String(readSuppressionEpoch(db, scope.owner) ?? 0n) }];
  const id = randomUUID();
  const inserted = db.prepare(`INSERT INTO cairn_memories
    (owner_id, namespace_key, id, revision, created_at_ms, updated_at_us, text_hash, legacy_hash, body)
    VALUES (?, ?, ?, 1, ?, ?, ?, ?, ?) RETURNING id`)
    .get(...scopeKey(scope), id, createdAtMs, time.updatedAtUs, textHash, legacyHash, JSON.stringify({ ...body, textVersions }));
  if (typeof inserted?.id !== "string") throw new CoreError("internal_error");
  const { receiptIds } = attachReceipts(db, scope, inserted.id, receipts, nowMs);
  return { id: inserted.id, revision: 1, createdAtMs, ...time, receiptIds };
}

/** @param {import("node:sqlite").SQLOutputValue} body
 * @param {import("node:sqlite").SQLOutputValue} legacyKey @returns {StoredReceipt}
 */
export function decodeStoredReceipt(body, legacyKey) {
  return { ...decodeJson(body), ...(legacyKey && { legacyReceiptKey: legacyKey }) };
}

/** @param {Connection} db @param {Scope} scope @param {string} id @returns {StoredReceipt[]} */
export function readReceipts(db, scope, id) {
  return db.prepare(`SELECT body, legacy_receipt_key FROM cairn_receipts
    WHERE owner_id = ? AND namespace_key = ? AND memory_id = ? ORDER BY ordinal`)
    .all(...scopeKey(scope), id).map(({ body, legacy_receipt_key }) =>
      decodeStoredReceipt(body, legacy_receipt_key));
}

/** @param {Connection} db @param {Scope} scope @param {string} id */
export function clearReceipts(db, scope, id) {
  db.prepare("DELETE FROM cairn_receipts WHERE owner_id = ? AND namespace_key = ? AND memory_id = ?")
    .run(...scopeKey(scope), id);
}

/** Remove attested plaintext while retaining its source address and denial.
 * @param {Connection} db @param {Scope} scope @param {{client: string, sessionId: string}} session
 * @param {string} [messageId]
 */
export function scrubAttestedReceipts(db, scope, { client, sessionId }, messageId) {
  const keys = scopeKey(scope);
  const legacySession = /^legacy-raw:[0-9a-f]{64}$/u.test(sessionId) ? "s1:" + sessionId.slice(11) : sessionId;
  const rows = db.prepare(`SELECT r.memory_id, r.ordinal, i.id, r.body
    FROM cairn_receipts r JOIN cairn_inspect_receipts i USING (owner_id, namespace_key, memory_id, ordinal)
    WHERE r.owner_id = ? AND r.namespace_key = ? AND r.legacy_receipt_key IS NOT NULL
      AND json_extract(r.body, '$.legacy.root') = 'legacy-attested' AND i.excerpt IS NOT NULL
      AND json_extract(r.body, '$.client') = ?
      AND (json_extract(r.body, '$.sessionId') IN (?, ?) OR EXISTS (
        SELECT 1 FROM json_each(r.body, '$.legacy.spans') s WHERE json_extract(s.value, '$.sessionId') = ?))
      AND (? IS NULL OR json_extract(r.body, '$.messageId') = ?)`)
    .all(...keys, client, sessionId, legacySession, sessionId, messageId ?? null, messageId ?? null);
  if (!rows.length) return;
  const deny = db.prepare("INSERT INTO cairn_legacy_denials VALUES (?, ?, ?) ON CONFLICT DO NOTHING");
  const scrubBody = db.prepare(`UPDATE cairn_receipts SET body = json_remove(body, '$.legacy.excerpt')
    WHERE owner_id = ? AND namespace_key = ? AND memory_id = ? AND ordinal = ?`);
  const scrubExcerpt = db.prepare("UPDATE cairn_inspect_receipts SET excerpt = NULL WHERE id = ?");
  const scrubEvidence = db.prepare(`UPDATE cairn_inspect_evidence SET
    qualification = CASE WHEN EXISTS (SELECT 1 FROM json_each(qualification, '$.anchors')
      WHERE json_extract(value, '$.receiptId') = ?) THEN NULL ELSE qualification END,
    procedural = CASE WHEN EXISTS (SELECT 1 FROM json_each(procedural, '$.anchors')
      WHERE json_extract(value, '$.receiptId') = ?) THEN NULL ELSE procedural END
    WHERE owner_id = ? AND namespace_key = ? AND memory_id = ?`);
  const scrubTag = db.prepare(`DELETE FROM cairn_procedural_tags WHERE owner_id = ? AND namespace_key = ? AND memory_id = ?
    AND EXISTS (SELECT 1 FROM json_each(anchors) WHERE json_extract(value, '$.receiptId') = ?)`);
  for (const { memory_id, ordinal, id, body } of rows) {
    const address = /** @type {import("./receipt-identity.mjs").StoredReceipt} */ (decodeJson(body));
    deny.run(...keys, receiptAddressDenial(address));
    scrubBody.run(...keys, memory_id, ordinal);
    scrubExcerpt.run(id);
    scrubEvidence.run(id, id, ...keys, memory_id);
    scrubTag.run(...keys, memory_id, id);
  }
}

/** @param {Connection} db @param {Scope} scope @param {string} id @param {string} text */
export function suppressReceiptSources(db, scope, id, text) {
  const rows = db.prepare(`SELECT body, legacy_receipt_key FROM cairn_receipts
    WHERE owner_id = ? AND namespace_key = ? AND memory_id = ?`).all(...scopeKey(scope), id);
  const insert = db.prepare(`INSERT INTO cairn_legacy_denials VALUES (?, ?, ?) ON CONFLICT DO NOTHING`);
  for (const { body, legacy_receipt_key } of rows) {
    const receipt = /** @type {import("./receipt-identity.mjs").StoredReceipt} */ (decodeJson(body));
    const key = receipt.receiptKey ?? legacy_receipt_key;
    insert.run(...scopeKey(scope), receiptAddressDenial(receipt));
    if (typeof key === "string") insert.run(...scopeKey(scope), receiptIdentityDenial(key));
    scrubAttestedReceipts(db, scope, receipt, receipt.messageId);
  }
  // A full source turn can be saved without a linked receipt or archive.
  if (text.length > 800) {
    const excerpt = receiptExcerpt(text);
    if (excerpt.length >= 799) insert.run(...scopeKey(scope), receiptExcerptDenial(excerpt));
  }
}

/** @param {Connection} db @param {Scope} scope @param {string} id @param {readonly Receipt[]} receipts
 * @param {number} nowMs @param {boolean} [checkReplay]
 */
export function attachReceipts(db, scope, id, receipts, nowMs, checkReplay = false) {
  /** @type {string[]} */
  const receiptIds = [];
  let added = 0;
  if (!receipts.length) return { receiptIds, added };
  const select = db.prepare(`SELECT COALESCE(MAX(ordinal), 0) AS last FROM cairn_receipts
    WHERE owner_id = ? AND namespace_key = ? AND memory_id = ?`);
  const insert = db.prepare(`INSERT INTO cairn_receipts (owner_id, namespace_key, memory_id, ordinal, source_key, body)
    VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT (owner_id, namespace_key, memory_id, source_key) DO NOTHING`);
  const insertInspect = db.prepare(`INSERT INTO cairn_inspect_receipts
    (owner_id, namespace_key, memory_id, ordinal, id, excerpt, created_at_us) VALUES (?, ?, ?, ?, ?, ?, ?)`);
  const findReceipt = db.prepare(`SELECT i.id, i.excerpt
    FROM cairn_receipts r JOIN cairn_inspect_receipts i USING (owner_id, namespace_key, memory_id, ordinal)
    WHERE r.owner_id = ? AND r.namespace_key = ? AND r.memory_id = ? AND r.source_key = ?`);
  const keys = [...scopeKey(scope), id];
  let ordinal = Number(select.get(...keys)?.last);
  const createdAtUs = BigInt(nowMs) * 1000n;
  for (const { excerpt, ...receipt } of receipts) {
    const storedReceipt = { ...receipt, ...(excerpt !== undefined && { receiptKey: receiptIdentityKey({ ...receipt, excerpt }) }) };
    const sourceKey = JSON.stringify([receipt.client, receipt.sessionId, receipt.messageId]);
    const stored = insert.run(...keys, ordinal + 1, sourceKey, JSON.stringify(storedReceipt));
    if (stored.changes) {
      const receiptId = randomUUID();
      insertInspect.run(...keys, ++ordinal, receiptId, excerpt ?? null, createdAtUs);
      receiptIds.push(receiptId);
      added++;
    } else {
      const existing = findReceipt.get(...keys, sourceKey);
      if (typeof existing?.id !== "string") throw new CoreError("storage_error");
      if (checkReplay && excerpt !== undefined && typeof existing.excerpt === "string" && excerpt !== existing.excerpt) {
        throw new CoreError("invalid_input");
      }
      receiptIds.push(existing.id);
    }
  }
  return { receiptIds, added };
}

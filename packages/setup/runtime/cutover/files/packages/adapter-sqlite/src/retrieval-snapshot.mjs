import { createHmac } from "node:crypto";
import { compareUtf8, CoreError } from "../../core/src/index.mjs";

/** @import { Namespace, RetrievalScope } from "@cairn-ink/core/ports" */
/** @import { Connection } from "./storage-values.mjs" */

/** @param {string} a @param {string} b */
export function compareStrings(a, b) {
  // Distinct lone surrogates can encode to the same UTF-8 bytes.
  return compareUtf8(a, b) || (a === b ? 0 : a < b ? -1 : 1);
}

/** @param {Namespace} a @param {Namespace} b */
export function compareNamespaces(a, b) {
  return a === b ? 0 : a === null ? -1 : b === null ? 1 : compareStrings(a, b);
}

// The snapshot contract invalidates cursors for changes anywhere in this
// owner's index. These projections contain ordering and visibility metadata.
// Memory revisions cover changes to content and receipt replacement. Receipt
// ordinals also catch a receipt-only touch that leaves the revision alone.
const indexState = [
  `SELECT namespace_key, id, revision, created_at_ms, CAST(updated_at_us AS TEXT) AS sort_key, historical, deleted
    FROM cairn_memories WHERE owner_id = ? ORDER BY namespace_key, id`,
  `SELECT namespace_key, memory_id, ordinal FROM cairn_receipts
    WHERE owner_id = ? ORDER BY namespace_key, memory_id, ordinal`,
  "SELECT epoch FROM cairn_suppression_epochs WHERE owner_id = ?",
  "SELECT revision FROM cairn_index_revisions WHERE owner_id = ?",
  `SELECT namespace_key, fingerprint FROM cairn_legacy_denials
    WHERE owner_id = ? ORDER BY namespace_key, fingerprint`,
];

const scopedMemoryState = [
  `SELECT namespace_key, id, revision, created_at_ms, CAST(updated_at_us AS TEXT) AS sort_key, historical, deleted
    FROM cairn_memories WHERE owner_id = ? AND namespace_key IN (SELECT value FROM json_each(?))
    ORDER BY namespace_key, id`,
  `SELECT namespace_key, memory_id, ordinal FROM cairn_receipts
    WHERE owner_id = ? AND namespace_key IN (SELECT value FROM json_each(?)) ORDER BY namespace_key, memory_id, ordinal`,
  `SELECT fact_id, incarnation FROM cairn_suppression_facts
    WHERE owner_id = ? AND namespace_key IN (SELECT value FROM json_each(?))
    AND json_extract(body, '$.kind') <> 'rawSpan' ORDER BY fact_id`,
  `SELECT namespace_key, fingerprint FROM cairn_legacy_denials
    WHERE owner_id = ? AND namespace_key IN (SELECT value FROM json_each(?)) ORDER BY namespace_key, fingerprint`,
];

/** @param {string} storeKey @param {boolean} [memoryOnly] */
export function createSnapshotToken(storeKey, memoryOnly = false) {
  const key = Buffer.from(storeKey, "hex");

  /** @param {Connection} db @param {RetrievalScope} scope */
  return (db, { owner, namespaces, clients, window }) => {
    const hash = createHmac("sha256", key);
    // The service cursor binds the request separately. This token binds the
    // canonical read set to the state of the index in the supplied snapshot.
    hash.update(JSON.stringify([memoryOnly ? "memory-find-snapshot-v1" : "retrieval-snapshot-v1",
      owner, [...namespaces].sort(compareNamespaces),
      clients ? [...clients].sort(compareStrings) : null,
      window && [window.sinceMs ?? null, window.untilMs ?? null]]));
    const args = memoryOnly ? [owner, JSON.stringify(namespaces.map(namespace => JSON.stringify(namespace)))] : [owner];
    for (const sql of memoryOnly ? scopedMemoryState : indexState) {
      hash.update("\n");
      for (const row of db.prepare(sql).iterate(...args)) hash.update(JSON.stringify(row));
    }
    return "v1." + hash.digest("hex");
  };
}

/** @param {string} token */
export function validateSnapshotToken(token) {
  if (typeof token !== "string" || token.length !== 67 || !/^v1\.[0-9a-f]{64}$/u.test(token)) {
    throw new CoreError("invalid_cursor");
  }
}

/**
 * Installed triggers advance these epochs for Memory, receipts, suppression,
 * and Raw fences. Read the stamp on the connection that owns the snapshot.
 * @param {{prepare(sql: string): {get(): {high?: unknown, low?: unknown} | undefined}}} db
 */
export function vectorCacheEpoch(db) {
  // Sum in two parts to stay within SQLite's signed integer aggregate range
  // when combining namespaces that already have large migrated epochs.
  const row = db.prepare(`SELECT CAST(COALESCE(SUM(epoch >> 32), 0) AS TEXT) AS high,
    CAST(COALESCE(SUM(epoch & 4294967295), 0) AS TEXT) AS low FROM cairn_inspect_epochs`).get();
  return (BigInt(String(row?.high)) << 32n) + BigInt(String(row?.low));
}

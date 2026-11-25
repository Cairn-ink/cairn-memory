import { decodeJson, readEntry } from "./memory-rows.mjs";
import { hasRawFence } from "./raw-lineage.mjs";
import { scopeKey } from "./storage-values.mjs";
import { scopedSuppression } from "./suppressions.mjs";

/** @import { MemoryRow, Scope } from "@cairn-ink/core/ports" */
/** @import { Connection } from "./storage-values.mjs" */
/** @import { SessionHasher } from "./suppressions.mjs" */
/** @import { MigratedRawPolicy } from "./migrate/raw-privacy.mjs" */
/** @import { StoredReceipt } from "./receipt-identity.mjs" */
/** @typedef {ReturnType<typeof createPlacementVisibility>} PlacementVisibility */
/** @typedef {ReturnType<PlacementVisibility>} ScopedVisibility */

export const exactScope = "owner_id = ? AND namespace_key = ?";

/** @param {SessionHasher} hashSession
 * @param {ReturnType<typeof import("./receipt-read-safety.mjs").createReceiptReadSafety>} receiptReadSafety
 * @param {MigratedRawPolicy} [migratedRaw]
 */
export function createPlacementVisibility(hashSession, receiptReadSafety, migratedRaw) {
  /** @param {Connection} db @param {Scope} scope @param {ReturnType<typeof scopedSuppression>} [policy] */
  return (db, scope, policy = scopedSuppression(db, scope, hashSession)) => {
    /** @type {Map<string, MemoryRow | undefined>} */
    const seen = new Map();
    const keys = scopeKey(scope);
    const receipts = db.prepare(`SELECT r.body, r.legacy_receipt_key, i.excerpt
      FROM cairn_receipts r LEFT JOIN cairn_inspect_receipts i USING (owner_id, namespace_key, memory_id, ordinal)
      WHERE r.owner_id = ? AND r.namespace_key = ? AND r.memory_id = ?`);
    /** @param {string} id */
    return id => {
      if (seen.has(id)) return seen.get(id);
      const entry = readEntry(db, scope, id);
      let row = entry && !policy.hides(entry) ? entry.row : undefined;
      if (row) {
        const { client, sessionId } = row.source;
        const fenced = client !== null && sessionId !== null && hasRawFence(db, scope, hashSession(scope, client, sessionId));
        const withheld = fenced || receipts.all(...keys, id).some(({ body, legacy_receipt_key, excerpt }) => {
          const { client, sessionId, messageId, role, occurredAtMs, receiptKey, legacyRawAncestryEmpty } =
            /** @type {StoredReceipt} */ (decodeJson(body));
          const legacyKey = typeof legacy_receipt_key === "string" ? legacy_receipt_key : undefined;
          const receipt = { client, sessionId, messageId, role, occurredAtMs, excerpt: typeof excerpt === "string" ? excerpt : undefined };
          const position = { id: messageId, occurredAtMs };
          return migratedRaw?.blocks(db, scope, receipt, [position]) || migratedRaw?.blocksSpan(db, scope, receipt, messageId) ||
            !receiptReadSafety(db, scope, policy, receipt, receiptKey ?? legacyKey, legacyKey, legacyRawAncestryEmpty);
        });
        if (withheld) row = undefined;
      }
      seen.set(id, row);
      return row;
    };
  };
}

/** A retired title keeps only its digest for canonical-title collision checks.
 * @param {PlacementVisibility} visibility
 */
export function createTitleScrubber(visibility) {
  /** @param {Connection} db @param {Scope} scope */
  return (db, scope) => {
    const keys = scopeKey(scope);
    const sources = db.prepare(`SELECT s.topic_id, s.memory_id, s.revision
      FROM cairn_topic_sources s JOIN cairn_topics t
      ON t.owner_id = s.owner_id AND t.namespace_key = s.namespace_key AND t.id = s.topic_id
      WHERE s.owner_id = ? AND s.namespace_key = ? AND t.title IS NOT NULL`).all(...keys);
    if (!sources.length) return;
    const visible = visibility(db, scope);
    const retired = new Set();
    for (const { topic_id, memory_id, revision } of sources) {
      const row = visible(String(memory_id));
      if (!row || row.historical || row.revision !== revision) retired.add(String(topic_id));
    }
    const update = db.prepare(`UPDATE cairn_topics SET title = NULL WHERE ${exactScope} AND id = ?`);
    for (const id of retired) update.run(...keys, id);
  };
}

/** @param {import("./storage-values.mjs").Port} port */
export function placementPort(port) {
  /**
   * @template T
   * @param {import("@cairn-ink/core/ports").Tx} tx @param {Scope} scope @param {{write?: boolean}} options
   * @param {(db: Connection, scope: Scope) => T} work
   */
  return (tx, scope, options, work) => port(tx, scope?.owner, options, db =>
    work(db, { owner: tx.owner, namespace: scope.namespace }));
}

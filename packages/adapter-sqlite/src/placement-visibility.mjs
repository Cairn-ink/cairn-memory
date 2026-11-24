import { readEntry, readReceipts } from "./memory-rows.mjs";
import { importTextBlocked, rawFactPolicy } from "./raw-facts.mjs";
import { hasRawFence } from "./raw-lineage.mjs";
import { readRawRow } from "./raw-rows.mjs";
import { scopeKey } from "./storage-values.mjs";
import { scopedSuppression } from "./suppressions.mjs";

/** @import { MemoryRow, Scope } from "@cairn-ink/core/ports" */
/** @import { Connection } from "./storage-values.mjs" */
/** @import { SessionHasher } from "./suppressions.mjs" */
/** @import { MigratedRawPolicy } from "./migrate/raw-privacy.mjs" */
/** @typedef {ReturnType<typeof createPlacementVisibility>} PlacementVisibility */
/** @typedef {ReturnType<PlacementVisibility>} ScopedVisibility */

export const exactScope = "owner_id = ? AND namespace_key = ?";

/** @param {SessionHasher} hashSession @param {MigratedRawPolicy} [migratedRaw] */
export function createPlacementVisibility(hashSession, migratedRaw) {
  /** @param {Connection} db @param {Scope} scope @param {ReturnType<typeof scopedSuppression>} [policy] */
  return (db, scope, policy = scopedSuppression(db, scope, hashSession)) => {
    /** @type {Map<string, MemoryRow | undefined>} */
    const seen = new Map();
    /** @param {string} id */
    return id => {
      if (seen.has(id)) return seen.get(id);
      const entry = readEntry(db, scope, id);
      let row = entry && !policy.hides(entry) ? entry.row : undefined;
      if (row) {
        const { client, sessionId } = row.source;
        const fenced = client !== null && sessionId !== null && hasRawFence(db, scope, hashSession(scope, client, sessionId));
        const hiddenExcerpt = policy.facts.some(({ fact }) => fact.kind === "text") &&
          db.prepare(`SELECT excerpt FROM cairn_inspect_receipts WHERE ${exactScope} AND memory_id = ? AND excerpt IS NOT NULL`)
            .all(...scopeKey(scope), id).some(({ excerpt }) =>
              typeof excerpt === "string" && importTextBlocked(policy.facts, excerpt, policy.legacy));
        const withheld = fenced || hiddenExcerpt || readReceipts(db, scope, id).some(receipt => {
          const { messageId, occurredAtMs } = receipt;
          const position = { id: messageId, occurredAtMs };
          if (policy.withholdsReceipt(receipt, undefined, receipt.legacyReceiptKey) ||
              hasRawFence(db, scope, hashSession(scope, receipt.client, receipt.sessionId)) ||
              migratedRaw?.blocks(db, scope, receipt, [position]) ||
              migratedRaw?.blocksSpan(db, scope, receipt, messageId)) return true;
          const session = migratedRaw?.storageSession(db, scope, receipt) ?? receipt;
          const archived = readRawRow(db, scope, session, messageId);
          return archived !== undefined && (rawFactPolicy(scope, receipt, policy.facts, hashSession).hides(archived.message) ||
            importTextBlocked([], archived.message.content, policy.legacy));
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

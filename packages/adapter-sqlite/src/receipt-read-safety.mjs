import { receiptExcerpt } from "@cairn-ink/core";
import { importTextBlocked, rawFactPolicy } from "./raw-facts.mjs";
import { hasRawFence } from "./raw-lineage.mjs";
import { readRawRow } from "./raw-rows.mjs";
import { receiptIdentityKey } from "./receipt-identity.mjs";
import { scopedSuppression } from "./suppressions.mjs";

/** @import { Receipt, Scope } from "@cairn-ink/core/ports" */
/** @import { RawRow } from "./raw-rows.mjs" */
/** @import { Connection } from "./storage-values.mjs" */
/** @import { SessionHasher } from "./suppressions.mjs" */
/** @import { MigratedRawPolicy } from "./migrate/raw-privacy.mjs" */
/** @typedef {ReturnType<typeof scopedSuppression>} Policy */

/** Evaluate a retained receipt inside the caller's delivering read transaction.
 * @param {SessionHasher} hashSession
 * @param {ReturnType<typeof import("./raw-lineage.mjs").createRawLineage>} lineage
 * @param {MigratedRawPolicy} [migratedRaw]
 */
export function createReceiptReadSafety(hashSession, lineage, migratedRaw) {
  /** @param {Connection} db @param {Scope} scope @param {Policy} policy @param {Receipt & {excerpt: string}} receipt
   * @param {string | undefined} key @param {string | undefined} legacyKey
   */
  return function receiptReadSafety(db, scope, policy, receipt, key, legacyKey) {
    const { client, sessionId, messageId, role, excerpt } = receipt;
    if (!client || !sessionId || !messageId || (role !== "user" && role !== "assistant") ||
        !key || receiptIdentityKey(receipt) !== key || receiptExcerpt(excerpt) !== excerpt) return false;
    // A Raw-enabled legacy conversion drops the archived rows and retained
    // lineage. Re-archiving an immediate turn alone cannot restore its roots.
    if (legacyKey && migratedRaw) return false;
    if (policy.withholdsReceipt(receipt, key, legacyKey) ||
        importTextBlocked(policy.facts, excerpt, policy.legacy)) return false;

    /** @param {Scope} target @param {RawRow} row @param {Policy} facts */
    function visible(target, row, facts) {
      const { message } = row;
      if (!message.content || message.role !== role) return false;
      const rawPolicy = rawFactPolicy(target, row, facts.facts, hashSession);
      return !hasRawFence(db, target, rawPolicy.sessionKeyHash) &&
        !facts.withholdsReceipt({ ...row, messageId, role, occurredAtMs: message.occurredAtMs }) &&
        !rawPolicy.hides(message) && !importTextBlocked([], message.content, facts.legacy) &&
        !migratedRaw?.blocks(db, target, row, [message]);
    }

    const archived = readRawRow(db, scope, receipt, messageId);
    return archived !== undefined && visible(scope, archived, policy) &&
      lineage.receiptRootsVisible(db, scope, archived, (target, row) =>
        visible(target, row, target.namespace === scope.namespace ? policy : scopedSuppression(db, target, hashSession)));
  };
}

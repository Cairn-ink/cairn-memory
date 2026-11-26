import { receiptExcerpt } from "@cairn-ink/core";
import { readEntry } from "./memory-rows.mjs";
import { importTextBlocked, rawFactPolicy } from "./raw-facts.mjs";
import { hasRawFence } from "./raw-lineage.mjs";
import { readRawRow } from "./raw-rows.mjs";
import { receiptExcerptDenial, receiptIdentityKey } from "./receipt-identity.mjs";
import { sha256 } from "./storage-values.mjs";
import { scopedSuppression } from "./suppressions.mjs";

/** @import { Receipt, Scope } from "@cairn-ink/core/ports" */
/** @import { RawRow } from "./raw-rows.mjs" */
/** @import { Connection } from "./storage-values.mjs" */
/** @import { SessionHasher } from "./suppressions.mjs" */
/** @import { MigratedRawPolicy } from "./migrate/raw-privacy.mjs" */
/** @typedef {ReturnType<typeof scopedSuppression>} Policy */

/** Evaluate a retained receipt or bare address inside the caller's transaction.
 * @param {SessionHasher} hashSession
 * @param {ReturnType<typeof import("./raw-lineage.mjs").createRawLineage>} lineage
 * @param {MigratedRawPolicy} [migratedRaw]
 */
export function createReceiptReadSafety(hashSession, lineage, migratedRaw) {
  /** @param {Connection} db @param {Scope} scope @param {Policy} policy @param {Receipt} receipt
   * @param {string | undefined} key @param {string | undefined} legacyKey
   * @param {Pick<import("./receipt-identity.mjs").StoredReceipt, "legacy" | "legacyRawAncestryEmpty">} [stored]
   * @param {string} [memoryId]
   * @param {(row: RawRow) => void} [onVisibleArchive]
   */
  return function receiptReadSafety(db, scope, policy, receipt, key, legacyKey, stored, memoryId, onVisibleArchive) {
    const { client, sessionId, messageId, role, excerpt, occurredAtMs } = receipt;
    if (!client || !sessionId || !messageId || (role !== "user" && role !== "assistant")) return false;
    if (excerpt !== undefined && (!key || receiptIdentityKey(receipt) !== key || receiptExcerpt(excerpt) !== excerpt)) return false;
    const attested = legacyKey !== undefined && stored?.legacy?.root === "legacy-attested" &&
      (!migratedRaw || typeof stored.legacyRawAncestryEmpty === "boolean");
    const historical = attested && memoryId && excerpt !== undefined && policy.legacy.has(sha256(excerpt.toLowerCase()))
      ? readEntry(db, scope, memoryId) : undefined;
    const retirement = historical?.row.historical && historical.row.text === excerpt &&
      historical.legacyHash === "sha256:" + historical.historyHash ? historical.historyHash : undefined;
    if (policy.withholdsReceipt(receipt, key, legacyKey, { ownPosition: true }) || (excerpt !== undefined &&
        ((excerpt.length >= 799 && policy.legacy.has(receiptExcerptDenial(excerpt))) ||
        importTextBlocked(policy.facts, excerpt, policy.legacy, retirement)))) return false;
    if (hasRawFence(db, scope, hashSession(scope, client, sessionId))) return false;
    const addressOnly = excerpt === undefined;
    const rootSessions = legacyKey && migratedRaw ? [
      ...(/^s1:[0-9a-f]{64}$/u.test(sessionId) ? ["legacy-raw:" + sessionId.slice(3)] : []),
      ...(stored?.legacy?.spans ?? []).map(root => root.sessionId),
    ] : [];
    for (const sessionId of rootSessions) {
      const root = { ...receipt, sessionId };
      if (hasRawFence(db, scope, hashSession(scope, client, sessionId)) ||
          policy.withholdsReceipt(root) || migratedRaw?.blocksSpan(db, scope, root, messageId)) return false;
    }
    const session = rootSessions.length ? { client, sessionId: rootSessions[0] }
      : addressOnly || legacyKey ? migratedRaw?.storageSession(db, scope, receipt) ?? receipt : receipt;
    const archived = readRawRow(db, scope, session, messageId) ?? (session === receipt ? undefined : readRawRow(db, scope, receipt, messageId));
    if (migratedRaw) {
      if (legacyKey && ((!attested && !migratedRaw.receiptAncestryEmpty(db, stored?.legacyRawAncestryEmpty)) ||
          migratedRaw.blocksSpan(db, scope, receipt, messageId) ||
          migratedRaw.blocksEvent(db, { scope, client, eventId: messageId }))) return false;
      if ((legacyKey || !archived) && migratedRaw.blocks(db, scope, receipt, [{ id: messageId, occurredAtMs }])) return false;
    }
    if (!archived) return attested || !lineage.hasPossibleReceiptSource(db, scope, receipt, addressOnly);

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

    const allowed = visible(scope, archived, policy) &&
      lineage.receiptRootsVisible(db, scope, archived, (target, row) =>
        visible(target, row, target.namespace === scope.namespace ? policy : scopedSuppression(db, target, hashSession)));
    if (allowed) onVisibleArchive?.(archived);
    return allowed;
  };
}

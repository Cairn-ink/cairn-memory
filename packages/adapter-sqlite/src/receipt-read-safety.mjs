import { receiptExcerpt } from "@cairn-ink/core";
import { importTextBlocked, rawFactPolicy } from "./raw-facts.mjs";
import { hasRawFence } from "./raw-lineage.mjs";
import { readRawRow } from "./raw-rows.mjs";
import { receiptExcerptDenial, receiptIdentityKey } from "./receipt-identity.mjs";
import { scopedSuppression } from "./suppressions.mjs";

/** @import { Receipt, Scope } from "@cairn-ink/core/ports" */
/** @import { StoredFact } from "@cairn-ink/core" */
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
   * @param {boolean | undefined} [legacyRawAncestryEmpty]
   * @param {ReadonlySet<StoredFact>} [correctionFacts]
   */
  function checkReceipt(db, scope, policy, receipt, key, legacyKey, legacyRawAncestryEmpty, correctionFacts) {
    const { client, sessionId, messageId, role, excerpt, occurredAtMs } = receipt;
    const textFacts = correctionFacts ? policy.facts.filter(stored => !correctionFacts.has(stored)) : policy.facts;
    if (!client || !sessionId || !messageId || (role !== "user" && role !== "assistant")) return false;
    if (excerpt !== undefined && (!key || receiptIdentityKey(receipt) !== key || receiptExcerpt(excerpt) !== excerpt)) return false;
    if (policy.withholdsReceipt(receipt, key, legacyKey) || (excerpt !== undefined &&
        ((excerpt.length >= 799 && policy.legacy.has(receiptExcerptDenial(excerpt))) ||
        importTextBlocked(textFacts, excerpt, policy.legacy)))) return false;
    if (hasRawFence(db, scope, hashSession(scope, client, sessionId))) return false;
    const addressOnly = excerpt === undefined;
    const session = addressOnly ? migratedRaw?.storageSession(db, scope, receipt) ?? receipt : receipt;
    const archived = readRawRow(db, scope, session, messageId);
    if (migratedRaw) {
      if (legacyKey && (!migratedRaw.receiptAncestryEmpty(db, legacyRawAncestryEmpty) ||
          migratedRaw.blocksEvent(db, { scope, client, eventId: messageId }))) return false;
      if ((legacyKey || !archived) && migratedRaw.blocks(db, scope, receipt, [{ id: messageId, occurredAtMs }])) return false;
    }
    if (!archived) return !lineage.hasPossibleReceiptSource(db, scope, receipt, addressOnly);

    /** @param {Scope} target @param {RawRow} row @param {Policy} facts */
    function visible(target, row, facts) {
      const { message } = row;
      if (!message.content || message.role !== role) return false;
      const rawPolicy = rawFactPolicy(target, row, facts === policy ? textFacts : facts.facts, hashSession);
      return !hasRawFence(db, target, rawPolicy.sessionKeyHash) &&
        !facts.withholdsReceipt({ ...row, messageId, role, occurredAtMs: message.occurredAtMs }) &&
        !rawPolicy.hides(message) && !importTextBlocked([], message.content, facts.legacy) &&
        !migratedRaw?.blocks(db, target, row, [message]);
    }

    return visible(scope, archived, policy) &&
      lineage.receiptRootsVisible(db, scope, archived, (target, row) =>
        visible(target, row, target.namespace === scope.namespace ? policy : scopedSuppression(db, target, hashSession)));
  }

  /** @param {[Connection, Scope, Policy, Receipt, string | undefined, string | undefined, (boolean | undefined)?]} args */
  function receiptReadSafety(...args) {
    return checkReceipt(...args);
  }

  /** @param {[Connection, Scope, Policy, Receipt, string | undefined, string | undefined,
   * boolean | undefined, (stored: StoredFact) => boolean]} args */
  receiptReadSafety.withholdReason = (...args) => {
    const [db, scope, policy, receipt, key, legacyKey, ancestry, isCorrection] = args;
    if (checkReceipt(db, scope, policy, receipt, key, legacyKey, ancestry)) return null;
    // If any independent check still withholds, the receipt stays ineligible.
    const corrections = new Set(policy.facts.filter(isCorrection));
    return corrections.size && checkReceipt(db, scope, policy, receipt, key, legacyKey, ancestry, corrections)
      ? "correction" : "withheld";
  };
  return receiptReadSafety;
}

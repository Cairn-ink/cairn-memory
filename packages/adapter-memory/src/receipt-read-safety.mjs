import { allDigests, coreDigest } from "@cairn-ink/core";
import { sha256Hex } from "../../core/src/privacy/fingerprint.mjs";

/** @import { InspectReceipt, Receipt, Scope } from "@cairn-ink/core/ports" */
/** @import { State } from "./unit-of-work.mjs" */
/** @typedef {Receipt & { createdAtMs?: number, captureEventId?: string, includeUnknownTime?: true }} StoredReceipt */
/** @typedef {ReturnType<ReturnType<typeof import("./fact-match.mjs").createFactMatcher>>} Policy */

export const MEMORY_FORGET_RECEIPT = "memory-forget:";

/** @param {Pick<Receipt, "client" | "sessionId" | "messageId" | "role" | "excerpt">} receipt */
export function receiptIdentityKey({ client, sessionId, messageId, role, excerpt }) {
  // The legacy hash serializes the message ID under the eventId property.
  return sha256Hex(JSON.stringify({ client, sessionId, eventId: messageId, role, excerpt }));
}

/** @param {Scope["namespace"]} namespace @param {Pick<Receipt, "client" | "sessionId" | "messageId">} receipt */
export function receiptAddressKey(namespace, { client, sessionId, messageId }) {
  return sha256Hex(JSON.stringify(["receipt-source-address-v1", namespace, client, sessionId, messageId]));
}

/** @param {Scope["namespace"]} namespace @param {string} excerpt */
export function receiptExcerptDenial(namespace, excerpt) {
  return sha256Hex(JSON.stringify(["receipt-source-prefix-v1", namespace, excerpt]));
}

/** @param {import("./privacy.mjs").RingKeys} ringKeys
 * @param {ReturnType<typeof import("./raw.mjs").createRawPorts>["receiptSourcesVisible"]} [rawSourcesVisible]
 */
export function createReceiptReadSafety(ringKeys, rawSourcesVisible) {
  /** @param {State} state @param {Scope} scope @param {StoredReceipt & { excerpt: string }} receipt
   * @param {Policy} policy @param {string} [key] @param {string} [admittedContent]
   */
  async function receiptWithheld(state, scope, receipt, policy, key, admittedContent) {
    const { excerpt } = receipt;
    if (state.receiptDenials.size) {
      const { namespace } = scope;
      if (state.receiptDenials.has(JSON.stringify([namespace, key ?? await receiptIdentityKey(receipt)])) ||
          state.receiptDenials.has(await receiptAddressKey(namespace, receipt)) ||
          (excerpt.length >= 799 && state.receiptDenials.has(await receiptExcerptDenial(namespace, excerpt)))) return true;
    }

    const digests = policy.textFacts.length ? await allDigests(excerpt) : [];
    if (policy.textFacts.length) {
      for (const fingerprintKey of await ringKeys(scope.owner)) digests.push(await coreDigest(excerpt, fingerprintKey));
    }
    return policy.withholdsRaw(receipt, digests) ||
      (rawSourcesVisible ? !await rawSourcesVisible(state, scope, receipt, admittedContent) : false);
  }

  /** @param {State} state @param {Scope} scope @param {StoredReceipt} receipt
   * @param {string | undefined} key @param {Policy} policy @returns {Promise<InspectReceipt | null>}
   */
  async function receiptReadSafety(state, scope, receipt, key, policy) {
    const { client, sessionId, messageId, role, occurredAtMs, id, excerpt, createdAtMs } = receipt;
    if (!client || !sessionId || !messageId || (role !== "user" && role !== "assistant") ||
        !id || !excerpt || createdAtMs === undefined || !key || key !== await receiptIdentityKey(receipt) ||
        await receiptWithheld(state, scope, { ...receipt, excerpt }, policy, key)) return null;
    return { client, sessionId, messageId, eventId: messageId, role, occurredAtMs, id, excerpt, createdAtMs };
  }

  return { receiptReadSafety, receiptWithheld };
}

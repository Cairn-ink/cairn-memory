import { sha256 } from "./storage-values.mjs";

/** @import { Receipt } from "@cairn-ink/core/ports" */
/** @typedef {Receipt & { receiptKey?: string, legacy?: { id: string, excerpt: string, createdAt: string } }} StoredReceipt */

/** @param {Pick<Receipt, "client" | "sessionId" | "messageId" | "role" | "excerpt">} receipt */
export function receiptIdentityKey({ client, sessionId, messageId, role, excerpt }) {
  // Match legacy core/content-safety.mjs:80–81, including property order.
  return sha256(JSON.stringify({ client, sessionId, eventId: messageId, role, excerpt }));
}

/** @param {Pick<Receipt, "client" | "sessionId" | "messageId">} source */
export function receiptAddressDenial({ client, sessionId, messageId }) {
  return "read-receipt-address-v1:" + sha256(JSON.stringify([client, sessionId, messageId]));
}

/** @param {string} key */
export function receiptIdentityDenial(key) {
  return "read-receipt-identity-v1:" + key;
}

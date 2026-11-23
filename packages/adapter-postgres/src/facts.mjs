import { CoreError, compareUtf8 } from "../../core/src/index.mjs";

/** @import { SuppressionFact, TextDigest } from "../../core/src/suppression-fact.mjs" */

const encoder = new TextEncoder();

/** @param {readonly TextDigest[]} digests */
export function canonicalDigests(digests) {
  return [...digests].sort((a, b) => (
    compareUtf8(a.pipeline, b.pipeline) || compareUtf8(a.alg, b.alg) || compareUtf8(a.value, b.value)
  ));
}

/** @param {SuppressionFact} fact A fact already checked by core's validator. */
export function factSlot(fact) {
  switch (fact.kind) {
    case "identity":
      return JSON.stringify(["identity", fact.memoryId, fact.throughRevision ?? null]);
    case "text": {
      const [{ alg, value }] = canonicalDigests(fact.text.digests);
      return JSON.stringify(["text", fact.mode, alg, value]);
    }
    case "session": {
      const { session } = fact;
      return JSON.stringify("sessionId" in session
        ? ["session", session.client, "id", session.sessionId]
        : ["session", session.client, "hash", session.sessionKeyHash]);
    }
    case "window":
      return JSON.stringify([
        "window", fact.client, fact.window.startMs, fact.window.endMs, fact.unknownTime === true, fact.anchor ?? null,
      ]);
    case "rawSpan":
      return JSON.stringify(["rawSpan", fact.sessionKeyHash, fact.messageKey, fact.startUtf16, fact.endUtf16]);
  }
}

/** @param {unknown} value @returns {boolean} */
function containsNullCharacter(value) {
  if (typeof value === "string") return value.includes("\u0000");
  if (value === null || typeof value !== "object") return false;
  return Object.entries(value).some(([key, field]) => (
    key.includes("\u0000") || containsNullCharacter(field)
  ));
}

/** @param {SuppressionFact} fact A fact already checked by core's validator. */
export function assertRepresentable(fact) {
  if (containsNullCharacter(fact)
    || (fact.kind === "text" && fact.text.digests.some(({ redactionVersion }) => redactionVersion > 2147483647))
    || encoder.encode(factSlot(fact)).byteLength > 8192) {
    throw new CoreError("invalid_input");
  }
}

/** @param {string} slot */
export async function slotHash(slot) {
  const hash = await crypto.subtle.digest("SHA-256", encoder.encode(slot));
  return Array.from(new Uint8Array(hash), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

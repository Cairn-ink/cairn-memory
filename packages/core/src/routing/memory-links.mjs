import { CoreError } from "../errors.mjs";
import { compareUtf8 } from "../utf8.mjs";

/** @param {unknown} value @returns {value is Record<string, unknown>} */
const record = (value) => value !== null && typeof value === "object" && !Array.isArray(value);

/** @param {unknown} value @returns {value is string} */
const nonempty = (value) => typeof value === "string" && value.length > 0;

/** @param {unknown} value */
function messageIdentity(value) {
  if (!record(value)) throw new CoreError("invalid_input");
  const { client, sessionId, messageId } = value;
  if (!nonempty(client) || !nonempty(sessionId) || !nonempty(messageId)) throw new CoreError("invalid_input");
  return { client, sessionId, messageId };
}

/** @type {typeof import("./index.mjs").documentCardMemoryLinks} */
export function documentCardMemoryLinks(sourceMessage, memories) {
  try {
    const source = messageIdentity(sourceMessage);
    if (!Array.isArray(memories)) throw new CoreError("invalid_input");
    /** @type {Map<string, number>} */
    const links = new Map();
    for (let i = 0, length = memories.length; i < length; i++) {
      const memory = memories[i];
      if (!record(memory)) throw new CoreError("invalid_input");
      const { id, revision, receipts } = memory;
      if (!nonempty(id) || typeof revision !== "number" || !Number.isSafeInteger(revision) || revision < 0 ||
          !Array.isArray(receipts)) throw new CoreError("invalid_input");

      let matched = false;
      for (let j = 0, count = receipts.length; j < count; j++) {
        const receipt = receipts[j];
        const { client, sessionId, messageId } = messageIdentity(receipt);
        const { role, occurredAtMs } = receipt;
        if ((role !== "user" && role !== "assistant") ||
            (occurredAtMs !== null && !Number.isFinite(occurredAtMs))) throw new CoreError("invalid_input");
        if (client === source.client && sessionId === source.sessionId && messageId === source.messageId) {
          matched = true;
        }
      }
      if (matched && revision > (links.get(id) ?? -1)) links.set(id, revision);
    }
    return [...links].sort(([a], [b]) => compareUtf8(a, b)).map(([id, revision]) => ({ id, revision }));
  } catch {
    throw new CoreError("invalid_input");
  }
}

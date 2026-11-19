import { conforms } from "./hosted-contract.mjs";
import { utcInstant } from "./source-time.mjs";

export const CONTEXT_READ_OPTIONS = Object.freeze({ representation: "compact", max_items: 24, max_tokens: 1_500 });
export const CONTEXT_READ_REQUEST = Object.freeze({
  version: 1,
  fields: Object.freeze(["version", "query", "project_id", "session_id", "representation", "max_items", "max_tokens"]),
  required: Object.freeze(["version", "query"]),
  max_items: Object.freeze({ minimum: 1, maximum: 24 }),
  max_tokens: Object.freeze({ minimum: 500, maximum: 6000 }),
});
export const CONTEXT_READ_RESPONSE = Object.freeze({
  fields: Object.freeze(["memories", "mode", "degraded"]),
  required: Object.freeze(["memories", "mode"]),
  mode: Object.freeze(["semantic", "lexical"]),
  degraded: Object.freeze(["semantic_unavailable"]),
});
const MAX_REPLY_BYTES = 256 * 1024;
const MAX_BAD_REQUEST_BYTES = 16 * 1024;
const COMPACT_ITEM = {
  fields: ["id", "text", "date", "scope", "project_id"],
  required: ["id", "text", "date", "scope"],
};

function hasShape(value, { fields, required }) {
  return value !== null && typeof value === "object" && !Array.isArray(value) &&
    required.every(key => Object.hasOwn(value, key)) &&
    Object.keys(value).every(key => fields.includes(key));
}

export function validContextReadRequest(body) {
  if (!hasShape(body, CONTEXT_READ_REQUEST) || body.version !== CONTEXT_READ_REQUEST.version ||
      body.representation !== CONTEXT_READ_OPTIONS.representation) return false;
  for (const key of ["max_items", "max_tokens"]) {
    if (!Object.hasOwn(body, key)) continue;
    const { minimum, maximum } = CONTEXT_READ_REQUEST[key];
    if (!Number.isInteger(body[key]) || body[key] < minimum || body[key] > maximum) return false;
  }
  const recall = { query: body.query };
  for (const key of ["project_id", "session_id"]) {
    if (Object.hasOwn(body, key)) recall[key] = body[key];
  }
  return conforms("recall-request", recall);
}

function validIdentifier(value) {
  return typeof value === "string" && value.length > 0 && value.length <= 400 && value.isWellFormed() &&
    value.trim() === value && !/\p{Cc}/u.test(value) && [...value].length <= 200;
}

function validCompactItem(item) {
  return hasShape(item, COMPACT_ITEM) && validIdentifier(item.id) && typeof item.text === "string" &&
    (item.date === null || typeof item.date === "string" && item.date.length === 10 &&
      utcInstant(`${item.date}T00:00:00Z`)) &&
    (item.scope === "project" ? Object.hasOwn(item, "project_id") && validIdentifier(item.project_id) :
      item.scope === "personal" && !Object.hasOwn(item, "project_id"));
}

export function validContextReadResponse(value, maxItems = CONTEXT_READ_OPTIONS.max_items) {
  return hasShape(value, CONTEXT_READ_RESPONSE) &&
    CONTEXT_READ_RESPONSE.mode.includes(value.mode) &&
    (!Object.hasOwn(value, "degraded") || CONTEXT_READ_RESPONSE.degraded.includes(value.degraded)) &&
    Array.isArray(value.memories) && value.memories.length <= maxItems &&
    value.memories.every(validCompactItem);
}

async function readBoundedReply(response, maxBytes) {
  let reader;
  const chunks = [];
  let bytes = 0;
  try {
    reader = response.body?.getReader();
    if (!reader) return null;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      bytes += value.byteLength;
      if (bytes > maxBytes) return null;
      chunks.push(value);
    }
    return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(Buffer.concat(chunks, bytes)));
  } catch {
    return null;
  } finally {
    void reader?.cancel().catch(() => {});
  }
}

export async function postContextRead({ endpoint, token }, body, timeoutMs, signal, dispatch) {
  if (!validContextReadRequest(body)) return { status: 400 };
  const payload = JSON.stringify(body);
  let fetchSignal;
  const start = () => {
    signal?.throwIfAborted();
    const timeout = AbortSignal.timeout(timeoutMs);
    fetchSignal = signal ? AbortSignal.any([signal, timeout]) : timeout;
    return fetch(`${endpoint}/api/memory/context-read`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
      body: payload, signal: fetchSignal,
    });
  };
  try {
    const response = await dispatch(start);
    const { status } = response;
    if (status === 400) {
      const value = await readBoundedReply(response, MAX_BAD_REQUEST_BYTES);
      if (value?.code === "representation_unavailable" && Object.keys(value).length === 1)
        return { status, code: "representation_unavailable" };
      return { status };
    }
    if (status !== 200) {
      void response.body?.cancel().catch(() => {});
      return { status };
    }
    const value = await readBoundedReply(response, MAX_REPLY_BYTES);
    fetchSignal.throwIfAborted();
    return validContextReadResponse(value, body.max_items) ? { status, ...value } : { status, code: "invalid_reply" };
  } catch {
    if (!fetchSignal) return { code: "dispatch_refused" };
    return { code: fetchSignal.aborted ? "timeout" : "network" };
  }
}

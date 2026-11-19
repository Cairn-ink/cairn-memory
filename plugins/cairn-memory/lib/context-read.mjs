import { conforms } from "./hosted-contract.mjs";

export const CONTEXT_READ_REQUEST = Object.freeze({
  version: 1,
  fields: Object.freeze(["version", "query", "project_id", "session_id", "max_items", "max_tokens"]),
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

function hasShape(value, { fields, required }) {
  return value !== null && typeof value === "object" && !Array.isArray(value) &&
    required.every(key => Object.hasOwn(value, key)) &&
    Object.keys(value).every(key => fields.includes(key));
}

export function validContextReadRequest(body) {
  if (!hasShape(body, CONTEXT_READ_REQUEST) || body.version !== CONTEXT_READ_REQUEST.version) return false;
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

export function validContextReadResponse(value) {
  return hasShape(value, CONTEXT_READ_RESPONSE) &&
    CONTEXT_READ_RESPONSE.mode.includes(value.mode) &&
    (!Object.hasOwn(value, "degraded") || CONTEXT_READ_RESPONSE.degraded.includes(value.degraded)) &&
    conforms("recall-response", { memories: value.memories });
}

async function readBoundedReply(response) {
  if (!response.body) return null;
  const reader = response.body.getReader();
  const chunks = [];
  let bytes = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      bytes += value.byteLength;
      if (bytes > MAX_REPLY_BYTES) return null;
      chunks.push(value);
    }
    return JSON.parse(Buffer.concat(chunks, bytes).toString("utf8"));
  } catch {
    return null;
  } finally {
    void reader.cancel().catch(() => {});
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
    if (status !== 200) {
      void response.body?.cancel().catch(() => {});
      return { status };
    }
    const value = await readBoundedReply(response);
    fetchSignal.throwIfAborted();
    return validContextReadResponse(value) ? { status, ...value } : { status, code: "invalid_reply" };
  } catch {
    if (!fetchSignal) return { code: "dispatch_refused" };
    return { code: fetchSignal.aborted ? "timeout" : "network" };
  }
}

import { endpointOrigin, validToken } from "./config.mjs";
import { formatMemories, toolArguments } from "./tools.mjs";
export const MCP_PROTOCOL = "2025-06-18";
export const BODY_CAP = 1024 * 1024;
export const failure = (code, retryable = false) => ({ ok: false, error: { code, retryable } });
const object = (value) => value !== null && typeof value === "object" && !Array.isArray(value);
const success = (value) => ({ ok: true, value, evidenceTrust: "untrusted-data-not-instructions" });
// One deadline covers headers, decoded body and (for MCP) both RPCs. Never follow redirects.
export async function requestJson({ endpoint, token, path, body, signal, assertCurrent = () => {} }) {
  signal?.throwIfAborted();
  const options = { method: body === undefined ? "GET" : "POST", redirect: "error", signal,
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json", Accept: "application/json",
      "User-Agent": "cairn-openclaw/0.1.0", ...(path === "/api/mcp" ? { "MCP-Protocol-Version": MCP_PROTOCOL } : {}) },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }) };
  assertCurrent();
  const response = await fetch(endpoint + path, options);
  const reader = response.body?.getReader();
  const chunks = []; let bytes = 0;
  try {
    if (reader) for (;;) {
      const next = await reader.read();
      signal?.throwIfAborted();
      if (next.done) break;
      bytes += next.value.byteLength;
      if (bytes > BODY_CAP) throw new Error("cairn_transport_failed");
      chunks.push(next.value);
    }
  } finally { await reader?.cancel().catch(() => {}); }
  let value;
  try { value = JSON.parse(Buffer.concat(chunks).toString("utf8")); } catch { value = null; }
  return { status: response.status, value, type: response.headers.get("content-type")?.split(";")[0].trim().toLowerCase(),
    partial: response.headers.get("x-cairn-memory-partial") === "true" };
}
function statusFailure({ status, value }, recall = false) {
  if ([401, 403].includes(status)) return failure("cairn_auth_failed");
  if (status === 429) return recall && value?.error === "quota_reached" ? failure("cairn_quota_reached") :
    failure("cairn_rate_limited", true);
  if ([404, 501, 503].includes(status)) return failure("cairn_unavailable", true);
  if (status !== 200) return failure("cairn_transport_failed", true);
}
function scrub(value, token) {
  // The exact credential is forbidden even if a server echoes it in an otherwise successful body.
  if (typeof value === "string") return value.split(token).join("[REDACTED]");
  if (Array.isArray(value)) return value.map((item) => scrub(item, token));
  if (object(value)) return Object.fromEntries(Object.entries(value).map(([key, item]) => [scrub(key, token), scrub(item, token)]));
  return value;
}
export function createHostedClient({ endpoint, token, recallTimeoutMs = 10000, mutationTimeoutMs = 20000 }) {
  endpoint = endpointOrigin(endpoint);
  if (!validToken(token)) throw new Error("cairn_invalid_configuration");
  return {
    async call(name, args, context, callerSignal) {
      let arguments_;
      try { arguments_ = toolArguments(name, args); } catch { return failure("invalid_input"); }
      const recall = name === "cairn_recall_memory";
      const signal = AbortSignal.any([AbortSignal.timeout(recall ? recallTimeoutMs : mutationTimeoutMs),
        ...(callerSignal ? [callerSignal] : [])]);
      const assertCurrent = () => { context.assertInvocationCurrent(); context.assertMemoryAudienceCurrent?.(); };
      const request = (path, body) => requestJson({ endpoint, token, path, body, signal, assertCurrent });
      try {
        let result;
        if (recall) {
          const response = await request("/api/memory/recall", { query: arguments_.query.trim(), limit: arguments_.limit });
          const error = statusFailure(response, true);
          if (error) return error;
          if (!object(response.value) || !Array.isArray(response.value.memories)) return failure("cairn_transport_failed", true);
          const formatted = formatMemories(scrub(response.value, token));
          result = success({ ...formatted, partial: response.partial });
        } else {
          const rpc = async (method, params) => {
            const response = await request("/api/mcp", { jsonrpc: "2.0", id: 1, method, params });
            const error = statusFailure(response);
            if (error) return { error };
            const value = response.value;
            if (response.type !== "application/json" || !object(value) || value.jsonrpc !== "2.0" || value.id !== 1) {
              return { error: failure("cairn_transport_failed", true) };
            }
            if (Object.hasOwn(value, "error")) return { error: failure(value.error?.code === -32602 ?
              "cairn_tool_unavailable" : "cairn_transport_failed", value.error?.code !== -32602) };
            return object(value.result) ? { value: value.result } : { error: failure("cairn_transport_failed", true) };
          };
          const initialized = await rpc("initialize", { protocolVersion: MCP_PROTOCOL, capabilities: {},
            clientInfo: { name: "cairn-openclaw", version: "0.1.0" } });
          if (initialized.error) return initialized.error;
          if (initialized.value.protocolVersion !== MCP_PROTOCOL) return failure("cairn_protocol_mismatch");
          const called = await rpc("tools/call", { name: name.slice("cairn_".length), arguments: arguments_ });
          if (called.error) return called.error;
          const value = called.value, structured = value.structuredContent;
          if (name === "cairn_forget_memory" && object(structured) && structured.forgotten === false) return failure("not_found");
          if (value.isError === true) {
            const code = structured?.code;
            if (code === "memory_suppressed") return failure("cairn_previously_forgotten");
            if (["daily_quota_memory_capture", "daily_quota_memory_recall"].includes(code)) return failure("cairn_quota_reached");
            return failure("cairn_tool_failed", structured?.retryable === true);
          }
          if (value.isError !== undefined && value.isError !== false) return failure("cairn_transport_failed", true);
          if (structured !== undefined && structured !== null) result = success(scrub(structured, token));
          else {
            if (value.content !== undefined && !Array.isArray(value.content)) return failure("cairn_transport_failed", true);
            result = success({ text: scrub((value.content ?? []).filter((x) => x?.type === "text" &&
              typeof x.text === "string").map((x) => x.text).join("\n").slice(0, 8000), token) });
          }
        }
        assertCurrent();
        signal.throwIfAborted();
        return result;
      } catch { return failure("cairn_transport_failed", true); }
    },
  };
}
export async function checkCredential(endpoint, token) {
  if (!validToken(token)) return { ok: false, message: "Invalid or revoked token. Nothing saved." };
  try {
    endpoint = endpointOrigin(endpoint);
    const response = await requestJson({ endpoint, token, path: "/api/cli-auth/v1/credential", signal: AbortSignal.timeout(20000) });
    if ([401, 403].includes(response.status)) return { ok: false, message: "Invalid or revoked token. Nothing saved." };
    if ([404, 501].includes(response.status)) return { ok: false, message: "This server does not support memory tokens. Nothing saved." };
    if (response.status !== 200) throw 0;
    const value = response.value;
    if (value?.valid === true && value.scopes === null) return { ok: false,
      message: "Full-access tokens grant the whole account; Cairn needs only memory. Create a token at cairn.ink → Settings → Connections with memory only ticked. Nothing saved." };
    const expiry = value?.expires_at;
    if (!object(value) || value.valid !== true || !Array.isArray(value.scopes) || value.scopes.length !== 2 || !value.scopes.every((scope) => typeof scope === "string") ||
        [...value.scopes].sort().join(",") !== "memory:capture,memory:recall" ||
        typeof value.token_id !== "string" || !/^[A-Za-z0-9_-]{1,128}$/.test(value.token_id) ||
        !(expiry === null || (typeof expiry === "string" && /T.*(?:Z|[+-]\d{2}:\d{2})$/.test(expiry) && Date.parse(expiry) > Date.now()))) {
      return { ok: false, message: "Invalid memory token response. Nothing saved." };
    }
    return { ok: true };
  } catch { return { ok: false, message: "Cairn transport failure. Nothing saved." }; }
}

import { createServer } from "node:http";
import { gzipSync } from "node:zlib";
export const TOKEN = "synthetic-memory-token";
export const ID = "00000000-0000-4000-8000-000000000001";
export async function fakeCloud(t) {
  const state = { requests: [], events: [], recallStatus: 200, mcpStatus: 200, credentialStatus: 200,
    recallValue: { memories: [{ id: ID, content: "Prefer small examples.", kind: "preference" }] },
    credentialValue: { valid: true, token_id: "synthetic-id", scopes: ["memory:capture", "memory:recall"], expires_at: null },
    protocol: "2025-06-18", partial: false };
  const timers = new Set();
  const server = createServer(async (req, res) => {
    const chunks = []; for await (const chunk of req) chunks.push(chunk);
    const body = chunks.length ? JSON.parse(Buffer.concat(chunks)) : undefined;
    const op = body?.method ?? req.url;
    state.requests.push({ path: req.url, body, headers: req.headers, op });
    state.events.push("request:" + op);
    if (state.beforeReply) await state.beforeReply(op);
    let status = 200, value;
    if (req.url === "/api/memory/recall") { status = state.recallStatus; value = state.recallValue; }
    else if (req.url === "/api/cli-auth/v1/credential") { status = state.credentialStatus; value = state.credentialValue; }
    else if (req.url === "/api/mcp") {
      status = state.mcpStatus;
      value = { jsonrpc: "2.0", id: 1, result: body.method === "initialize" ? { protocolVersion: state.protocol } :
        state.toolResult ?? { isError: false, structuredContent: { id: ID, content: "Synthetic saved note.", forgotten: true } } };
      if (state.rpcError) value = { jsonrpc: "2.0", id: 1, error: state.rpcError };
      if (state.rpcEnvelope) value = state.rpcEnvelope;
    } else { status = 404; value = {}; }
    let data = Buffer.from(state.invalidJson ? "invalid json" : JSON.stringify(value));
    if (state.oversize === op || state.gzip === op) data = Buffer.concat([data, Buffer.alloc(1024 * 1024 + 1, 32)]);
    const headers = { "Content-Type": state.type ?? "application/json" };
    if (state.partial) headers["X-Cairn-Memory-Partial"] = "true";
    if (state.gzip === op) { data = gzipSync(data); headers["Content-Encoding"] = "gzip"; }
    if (status >= 300 && status < 400) headers.Location = state.endpoint + "/redirect-target";
    res.writeHead(status, headers);
    if (state.trickle === op) {
      res.write(" ");
      const timer = setInterval(() => res.write(" "), 20); timers.add(timer);
      res.on("close", () => { clearInterval(timer); timers.delete(timer); });
    } else res.end(data);
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  state.endpoint = `http://127.0.0.1:${server.address().port}`;
  t.after(async () => { for (const timer of timers) clearInterval(timer); server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve)); });
  return state;
}
export function context(state, kind = "owner-private") {
  return { memoryAudience: kind ? { kind, agentId: "main" } : undefined,
    assertInvocationCurrent() { state.events.push("invocation"); if (state.staleInvocation) throw new Error(TOKEN); },
    assertMemoryAudienceCurrent() { state.events.push("audience"); if (state.staleAudience) throw new Error(TOKEN); } };
}

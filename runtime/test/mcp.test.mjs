import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const script = fileURLToPath(new URL("../server.mjs", import.meta.url));
async function connect(t, env) {
  const client = new Client({ name: "cairn-integration-test", version: "1.0.0" });
  const transport = new StdioClientTransport({ command: process.execPath, args: [script], env, stderr: "pipe" });
  transport.stderr?.resume();
  await client.connect(transport);
  t.after(() => client.close());
  return client;
}
async function call(client, name, args) {
  const result = await client.callTool({ name, arguments: args });
  assert.ok(!result.isError, JSON.stringify(result.content));
  return result.structuredContent;
}

test("real SDK stdio lifecycle, extraction, restart, boundaries and correction/forget", async (t) => {
  const requests = [];
  const http = createServer((req, res) => {
    let text = "";
    req.on("data", (chunk) => { text += chunk; });
    req.on("end", () => {
      const body = JSON.parse(text);
      requests.push(body);
      const data = JSON.parse(body.messages[1].content);
      const output = data.messages ? { memories: [{ content: "The user likes tea.", kind: "preference",
        confidence: 0.9, evidence_indices: [0] }] } :
        { ids: data.query === "unrelated" ? [] : data.candidates.map((m) => m.id) };
      res.end(JSON.stringify({ done: true, message: { content: JSON.stringify(output) } }));
    });
  });
  await new Promise((resolve) => http.listen(0, "127.0.0.1", resolve));
  t.after(() => { http.closeAllConnections(); http.close(); });
  const env = { CAIRN_DB_PATH: join(mkdtempSync(join(tmpdir(), "cairn-mcp-test-")), "memory.sqlite"),
    CAIRN_OWNER_ID: "alice", CAIRN_PROJECT_ID: "project-a", CAIRN_MODEL_PROVIDER: "ollama",
    CAIRN_MODEL: "fake-local-model", CAIRN_MODEL_ENDPOINT: `http://127.0.0.1:${http.address().port}` };
  let client = await connect(t, env);
  assert.deepEqual((await client.listTools()).tools.map((tool) => tool.name).sort(),
    ["capture_memory", "correct_memory", "forget_memory", "recall_memory", "remember_memory"]);
  const explicit = await call(client, "remember_memory", { content: "Use SQLite", kind: "decision" });
  assert.ok(explicit.memory.receipts.length);
  const input = { client: "mcp-test", eventId: "event-a", sessionId: "session-a", messages: [
    { id: "message-a", role: "user", content: "api_token=secretvalue123 I like tea." }] };
  assert.equal((await call(client, "capture_memory", input)).memoryCount, 1);
  assert.equal(JSON.stringify(requests).includes("secretvalue123"), false);
  await client.close();
  client = await connect(t, env);
  const beforeReplay = requests.length;
  assert.equal((await call(client, "capture_memory", input)).duplicate, true);
  assert.equal(requests.length, beforeReplay);
  const recalled = await call(client, "recall_memory", { query: "my preferences" });
  assert.match(recalled.untrusted, /untrusted/);
  const tea = recalled.memories.find((m) => m.content === "The user likes tea.");
  assert.ok(tea);
  assert.equal(tea.receipts[0].excerpt, "api_token=[REDACTED] I like tea.");
  assert.deepEqual((await call(client, "recall_memory", { query: "unrelated" })).memories, []);
  const other = await connect(t, { ...env, CAIRN_OWNER_ID: "bob" });
  assert.deepEqual((await call(other, "recall_memory", { query: "tea" })).memories, []);
  assert.equal((await call(other, "forget_memory", { id: tea.id, expectedRevision: tea.revision })).forgotten, false);
  const project = await connect(t, { ...env, CAIRN_PROJECT_ID: "project-b" });
  assert.deepEqual((await call(project, "recall_memory", { query: "tea" })).memories, []);
  const invalid = await client.callTool({ name: "remember_memory", arguments: { content: "cross-owner", ownerId: "bob" } });
  assert.equal(invalid.isError, true);
  const corrected = (await call(client, "correct_memory", { id: tea.id, expectedRevision: tea.revision,
    content: "The user likes coffee.", kind: "preference" })).memory;
  assert.equal((await client.callTool({ name: "forget_memory", arguments: {
    id: tea.id, expectedRevision: tea.revision } })).isError, true);
  assert.equal((await call(client, "forget_memory", { id: tea.id, expectedRevision: corrected.revision })).forgotten, true);
  assert.equal((await call(client, "recall_memory", { query: "preferences" })).memories.some((m) => m.id === tea.id), false);
});

test("model-free configuration supports explicit memory and fails honestly for extraction", async (t) => {
  const client = await connect(t, { CAIRN_DB_PATH: join(mkdtempSync(join(tmpdir(), "cairn-mcp-manual-")), "memory.sqlite"),
    CAIRN_OWNER_ID: "manual", CAIRN_MODEL_PROVIDER: "none" });
  assert.ok((await call(client, "remember_memory", { content: "manual memory" })).memory.id);
  const result = await client.callTool({ name: "recall_memory", arguments: { query: "memory" } });
  assert.equal(result.isError, true);
  assert.equal(result.content[0].text, "model_not_configured");
  assert.ok((await call(client, "remember_memory", { content: "still usable" })).memory.id);
});

test("two MCP processes share capture admission without overlapping model work", async (t) => {
  let release;
  let arrived;
  const firstRequest = new Promise((resolve) => { arrived = resolve; });
  let requests = 0;
  const http = createServer((req, res) => {
    req.resume();
    req.on("end", () => {
      requests++;
      release = () => res.end(JSON.stringify({ done: true, message: { content: '{"memories":[]}' } }));
      arrived();
    });
  });
  await new Promise((resolve) => http.listen(0, "127.0.0.1", resolve));
  t.after(() => { release?.(); http.closeAllConnections(); http.close(); });
  const env = { CAIRN_DB_PATH: join(mkdtempSync(join(tmpdir(), "cairn-mcp-concurrent-")), "memory.sqlite"),
    CAIRN_OWNER_ID: "alice", CAIRN_MODEL_PROVIDER: "ollama", CAIRN_MODEL: "fake-local-model",
    CAIRN_MODEL_ENDPOINT: `http://127.0.0.1:${http.address().port}` };
  const [one, two] = await Promise.all([connect(t, env), connect(t, env)]);
  const input = { client: "test", eventId: "shared-event", sessionId: "session", messages: [
    { id: "message", role: "user", content: "A synthetic preference." }] };
  const first = call(one, "capture_memory", input);
  await firstRequest;
  assert.deepEqual(await call(two, "capture_memory", input), { processing: true });
  release();
  assert.equal((await first).duplicate, false);
  assert.equal(requests, 1);
  assert.equal((await call(two, "capture_memory", input)).duplicate, true);
});

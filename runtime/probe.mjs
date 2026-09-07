import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

if (!process.env.CAIRN_EVAL_MODEL) throw new Error("Set CAIRN_EVAL_MODEL to an already installed local model");
const env = { CAIRN_DB_PATH: join(mkdtempSync(join(tmpdir(), "cairn-mcp-probe-")), "memory.sqlite"),
  CAIRN_OWNER_ID: "probe-owner", CAIRN_PROJECT_ID: "probe-project", CAIRN_MODEL_PROVIDER: "ollama",
  CAIRN_MODEL: process.env.CAIRN_EVAL_MODEL, CAIRN_MODEL_TIMEOUT_MS: "120000",
  CAIRN_MODEL_ENDPOINT: process.env.CAIRN_EVAL_ENDPOINT ?? "http://127.0.0.1:11434" };
const report = { model: env.CAIRN_MODEL, node: process.version, steps: [], passed: false };
const clients = [];
async function connect(overrides = {}) {
  const client = new Client({ name: "cairn-real-model-probe", version: "1.0.0" });
  const transport = new StdioClientTransport({ command: process.execPath,
    args: [fileURLToPath(new URL("./server.mjs", import.meta.url))], env: { ...env, ...overrides }, stderr: "pipe" });
  transport.stderr?.resume();
  clients.push(client);
  await client.connect(transport);
  return client;
}
async function call(client, name, args) {
  const start = Date.now();
  const result = await client.callTool({ name, arguments: args }, undefined, { timeout: 180_000 });
  assert.ok(!result.isError, JSON.stringify(result.content));
  report.steps.push({ name, milliseconds: Date.now() - start, result: result.structuredContent });
  return result.structuredContent;
}
try {
  let client = await connect();
  assert.equal((await client.listTools()).tools.length, 5);
  const input = { client: "probe", sessionId: "session-a", eventId: "event-a", messages: [
    { id: "message-a", role: "user", content: "Please remember my preference: I like concise explanations formatted as bullet points." }] };
  assert.ok((await call(client, "capture_memory", input)).memoryCount > 0);
  await client.close();
  client = await connect();
  assert.equal((await call(client, "capture_memory", input)).duplicate, true);
  const memories = (await call(client, "recall_memory", { query: "How should you format explanations for me?" })).memories;
  assert.ok(memories.length > 0);
  assert.ok(memories.every((m) => m.receipts.some((r) => r.excerpt === input.messages[0].content)));
  assert.deepEqual((await call(client, "recall_memory", { query: "What is the capital of Peru?" })).memories, []);
  for (const overrides of [{ CAIRN_OWNER_ID: "other-owner" }, { CAIRN_PROJECT_ID: "other-project" }]) {
    const other = await connect(overrides);
    assert.deepEqual((await call(other, "recall_memory", { query: "How should you format explanations for me?" })).memories, []);
  }
  const memory = memories[0];
  const corrected = (await call(client, "correct_memory", { id: memory.id, expectedRevision: memory.revision,
    content: "I prefer detailed explanations in full paragraphs.", kind: "preference" })).memory;
  for (const extra of memories.slice(1)) await call(client, "forget_memory", { id: extra.id, expectedRevision: extra.revision });
  const recalled = (await call(client, "recall_memory", { query: "How should you format explanations for me?" })).memories;
  assert.equal(recalled.length, 1);
  assert.equal(recalled[0].content, corrected.content);
  assert.equal((await call(client, "forget_memory", { id: corrected.id, expectedRevision: corrected.revision })).forgotten, true);
  assert.deepEqual((await call(client, "recall_memory", { query: "How should you format explanations for me?" })).memories, []);
  report.passed = true;
} catch (error) {
  report.error = error.code ?? error.message;
  process.exitCode = 1;
} finally {
  await Promise.all(clients.map((client) => client.close()));
  console.log(JSON.stringify(report, null, 2));
}

import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openMemoryStore } from "../core/index.mjs";
import { createMemoryEngine } from "../core/engine.mjs";
import { createOllamaModel } from "../core/models/ollama.mjs";

if (!process.env.CAIRN_EVAL_MODEL) throw new Error("Set CAIRN_EVAL_MODEL to an already installed local model");
const endpoint = process.env.CAIRN_EVAL_ENDPOINT ?? "http://127.0.0.1:11434";
const modelName = process.env.CAIRN_EVAL_MODEL;
const model = createOllamaModel({ endpoint, model: modelName });
const path = join(mkdtempSync(join(tmpdir(), "cairn-model-probe-")), "memory.sqlite");
const report = { model: modelName, node: process.version, path, steps: [], passed: false };
let store = openMemoryStore({ path });
const makeEngine = () => createMemoryEngine({ store, model, ownerId: "probe-owner",
  projectId: "probe-project", timeoutMs: 120_000 });
const step = async (name, run) => {
  const start = Date.now();
  const result = await run();
  report.steps.push({ name, milliseconds: Date.now() - start, result });
  return result;
};
try {
  let engine = makeEngine();
  const capture = { client: "probe", sessionId: "session-a", eventId: "event-a",
    messages: [{ id: "message-a", role: "user",
      content: "Please remember my preference: I like concise explanations formatted as bullet points." }] };
  await step("extract", async () => {
    const result = await engine.capture(capture);
    assert.ok(result.memoryCount >= 1);
    return result;
  });
  const sources = store.scope({ ownerId: "probe-owner", projectId: "probe-project" }).list();
  assert.ok(sources.every((m) => m.receipts.some((r) => r.excerpt === capture.messages[0].content)));
  report.memories = sources;
  store.close();
  store = openMemoryStore({ path });
  engine = makeEngine();
  await step("completed-replay-after-restart", async () => {
    const result = await engine.capture(capture);
    assert.equal(result.duplicate, true);
    return result;
  });
  const found = await step("paraphrased-recall", async () => {
    const result = await engine.recall("How should you format explanations for me?");
    assert.ok(result.length >= 1);
    assert.ok(result.every((m) => sources.some((source) => source.id === m.id)));
    return result.map((m) => ({ id: m.id, content: m.content }));
  });
  await step("unrelated-query", async () => {
    const result = await engine.recall("What is the capital of Peru?");
    assert.deepEqual(result, []);
    return result;
  });
  await step("isolated-owner", async () => {
    const other = createMemoryEngine({ store, model, ownerId: "other", projectId: "probe-project" });
    const result = await other.recall("How should you format explanations for me?");
    assert.deepEqual(result, []);
    return result;
  });
  const scope = store.scope({ ownerId: "probe-owner", projectId: "probe-project" });
  const before = scope.get(found[0].id);
  const corrected = engine.correct(before.id, { content: "I prefer detailed explanations in full paragraphs.",
    kind: "preference", receipt: { client: "probe", sessionId: "session-b", eventId: "correction",
      role: "user", excerpt: "Correction: I prefer detailed explanations in full paragraphs." } }, before.revision);
  // Remove any other extracted entries to make the post-correction expectation exact.
  for (const memory of scope.list()) if (memory.id !== corrected.id) engine.forget(memory.id, memory.revision);
  await step("corrected-recall", async () => {
    const result = await engine.recall("How should you format explanations for me?");
    assert.equal(result.length, 1);
    assert.equal(result[0].content, corrected.content);
    return result.map((m) => m.content);
  });
  engine.forget(corrected.id, corrected.revision);
  await step("forgotten-recall", async () => {
    const result = await engine.recall("How should you format explanations for me?");
    assert.deepEqual(result, []);
    return result;
  });
  report.passed = true;
} catch (error) {
  report.error = error.code ?? error.message;
  process.exitCode = 1;
} finally {
  store.close();
  console.log(JSON.stringify(report, null, 2));
}

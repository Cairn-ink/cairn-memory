import assert from "node:assert/strict";
import { createHash, createHmac } from "node:crypto";
import { test } from "node:test";
import { createMemoryAdapter } from "@cairn-ink/adapter-memory";
import { CoreError } from "@cairn-ink/core";
import { createMemoryService } from "@cairn-ink/core/service";
import {
  HOST_WRITE_HOOK_CASES, captureIdentity, capturedText, messages, receipt, syntheticHooks,
} from "@cairn-ink/conformance/host-write-hooks";

const scope = { owner: "hook-owner", namespace: null };
const source = { kind: "mcp", client: null, sessionId: null };
const now = 12_345;

function fixture({ capability = true, config = {}, failModel = false } = {}) {
  let serial = 0;
  const storage = createMemoryAdapter({ now: () => now, newId: () => `memory-${++serial}`,
    hostWriteHooks: capability, capabilities: { rawArchive: true, embeddingRequiredOnInsert: false } });
  const table = storage.harness.createHostHookTable?.();
  const clock = {
    nowMs: () => now,
    monotonicMs: () => now,
    sha256Hex: value => createHash("sha256").update(value).digest("hex"),
    hmacHex: (key, value) => createHmac("sha256", key).update(value).digest("hex"),
  };
  const deps = { storage, clock, config, gate: { assertOpen() {} }, tokens: { countTokens: () => 1 },
    embedder: { model: "fixture", dimensions: 1, embed: async (texts) => texts.map(() => Float32Array.of(1)) },
    model: { model: "fixture", contextWindow: 32_768, countTokens: () => 1, async call() {
      if (failModel) throw new CoreError("model_timeout");
      return { items: [{ content: capturedText, kind: "fact", confidence: 0.9, sourceIndices: [0] }] };
    } },
  };
  const snapshot = async () => {
    const [owner] = await storage.harness.dump();
    return {
      indexRevision: owner?.indexRevision ?? 0, memoryCount: owner?.rows.length ?? 0,
      receiptCount: owner?.rows.reduce((sum, row) => sum + row.receipts.length, 0) ?? 0,
      factCount: owner?.facts.length ?? 0, rawCount: owner?.rawRows.length ?? 0,
    };
  };
  return { createService: createMemoryService, deps, scope, table, snapshot };
}

for (const { id, title, run } of HOST_WRITE_HOOK_CASES) {
  test(`memory ${id} ${title}`, () => run(fixture()));
}

test("memory Raw fallback keeps a hook failure and records it for the original claim", async () => {
  const { deps, table, snapshot } = fixture({ config: { rawCapture: { onModelFailure: true } }, failModel: true });
  const api = createMemoryService({ ...deps, hostWriteHooks: syntheticHooks({
    async onCaptureFinish(tx, ctx) {
      assert.deepEqual(ctx.writes, []);
      assert.equal(ctx.sources.length, messages.length);
      await table.put(tx, ctx.scope, "raw", "finished");
      throw new Error("synthetic fallback refusal to commit");
    },
  }) });
  await api.enqueueCapture(scope, { ...captureIdentity, messages });
  const start = await snapshot();
  assert.deepEqual(await api.runCapture(scope, captureIdentity), { status: "failed", code: "host_write_hook_failed" });
  assert.deepEqual(await api.captureStatus(scope, captureIdentity.eventId, { client: captureIdentity.client }),
    { status: "failed", code: "host_write_hook_failed" });
  assert.deepEqual(await snapshot(), start);
  assert.equal(await table.inspect(scope, "raw"), undefined);
});

test("memory Raw fallback preserves the model error if the archive fails with hooks registered", async () => {
  const { deps, snapshot } = fixture({ config: { rawCapture: { onModelFailure: true } }, failModel: true });
  deps.storage.raw.archive = async () => { throw new CoreError("storage_busy"); };
  let called = false;
  const api = createMemoryService({ ...deps, hostWriteHooks: syntheticHooks({
    async onCaptureFinish() { called = true; },
  }) });
  await api.enqueueCapture(scope, { ...captureIdentity, messages });
  const start = await snapshot();
  assert.deepEqual(await api.runCapture(scope, captureIdentity), { status: "failed", code: "model_timeout" });
  assert.equal(called, false);
  assert.deepEqual(await snapshot(), start);
});

test("capability alone leaves no-hook write and replay bytes identical", async t => {
  // Both otherwise independent adapters use the same synthetic Raw lineage key.
  t.mock.method(crypto, "getRandomValues", output => output.fill(17));
  const encoded = value => JSON.stringify(value, (_, item) => typeof item === "bigint" ? item.toString() : item);
  async function trace(capability) {
    const { deps } = fixture({ capability });
    const api = createMemoryService(deps);
    const saved = await api.save(scope, "The loop closes at noon.", source, "fact", { receipt });
    const corrected = await api.correct(scope, saved.item.id, saved.item.revision, "The loop closes at sunset.", source);
    const forgotten = await api.forget(scope, saved.item.id, source);
    const admitted = await api.enqueueCapture(scope, { ...captureIdentity, messages });
    const done = await api.runCapture(scope, captureIdentity);
    const replay = await api.runCapture(scope, captureIdentity);
    const dump = await deps.storage.harness.dump();
    // Claim tokens are private and randomized. Successful completion never exposes them.
    return [encoded([saved, corrected, forgotten, admitted, done, replay]), encoded(dump)];
  }
  assert.deepEqual(await trace(true), await trace(false));
});

test("unkeyed Raw-only completion calls the hook even when no item was produced", async () => {
  const { deps, table } = fixture({ config: { rawCapture: { enabled: true } } });
  deps.model = null;
  deps.embedder = null;
  const api = createMemoryService({ ...deps, hostWriteHooks: syntheticHooks({
    async onCaptureFinish(tx, ctx) {
      assert.deepEqual(ctx.writes, []);
      assert.equal(ctx.sources.length, messages.length);
      await table.put(tx, ctx.scope, "empty", ctx.eventId, true);
    },
  }) });
  await api.enqueueCapture(scope, { ...captureIdentity, messages });
  const completed = await api.runCapture(scope, captureIdentity);
  assert.equal(completed.status, "done");
  assert.deepEqual(completed.result.memories, []);
  assert.equal(await table.inspect(scope, "empty"), captureIdentity.eventId);
  assert.deepEqual(await api.runCapture(scope, captureIdentity), completed);
});

test("identity-only Raw evidence authorizes hide without physical erasure", async () => {
  const { deps, snapshot } = fixture();
  const scopedSource = { ...source, client: captureIdentity.client, sessionId: captureIdentity.sessionId };
  const api = createMemoryService({ ...deps, hostWriteHooks: syntheticHooks({
    async onForget(_tx, ctx) {
      assert.deepEqual(ctx.affectedSessions, [{
        client: captureIdentity.client, sessionId: captureIdentity.sessionId, effect: "hide",
      }]);
      assert.deepEqual(ctx.affectedSpans, []);
    },
  }) });
  await api.enqueueCapture(scope, { ...captureIdentity, messages });
  await api.runCapture(scope, captureIdentity);
  const saved = await api.save(scope, "The stairwell has an orange clock.", scopedSource);
  assert.equal(saved.status, "saved");
  const start = await snapshot();
  assert.equal((await api.forget(scope, saved.item.id, scopedSource)).status, "forgotten");
  assert.equal((await snapshot()).rawCount, start.rawCount);
  assert.deepEqual((await api.listRawMessages(scope, { limit: 10 })).items, []);
});

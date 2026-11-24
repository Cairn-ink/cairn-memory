import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { test } from "node:test";
import { createMemoryAdapter } from "@cairn-ink/adapter-memory";
import { createMemoryService } from "@cairn-ink/core/service";

test("the reference service replaces a keyless correction's evidence and suppresses replay of the predecessor", async () => {
  const storage = createMemoryAdapter();
  const scope = { owner: "synthetic-owner", namespace: "synthetic-project" };
  const source = { kind: "mcp", client: "synthetic-local-mcp", sessionId: "explicit-tool" };
  const oldText = "The synthetic albatross wears a teal scarf.";
  const newText = "The synthetic albatross wears an amber scarf.";
  const service = createMemoryService({
    storage,
    model: {
      model: "test", contextWindow: 100, countTokens: () => 1,
      async call() { assert.fail("Explicit writes do not call the model"); },
    },
    embedder: {
      model: "test", dimensions: 1,
      async embed(texts) { return texts.map(() => Float32Array.of(1)); },
    },
    gate: { async assertOpen() {} },
    clock: {
      nowMs: () => 100, monotonicMs: () => 100,
      async sha256Hex(text) { return createHash("sha256").update(text).digest("hex"); },
      async hmacHex() { assert.fail("These writes are keyless"); },
    },
    tokens: { countTokens: () => 1 },
    config: {},
  });
  const indexRevision = () => storage.uow.run(scope.owner, { readOnly: true }, tx => storage.memories.indexRevision(tx));
  const save = await service.save(scope, oldText, source, "context");
  assert.equal(save.status, "saved");
  const { id } = save.item;
  const read = () => service.read(scope, { type: "memory", id });
  const priorReceipts = ["first-event", "second-event"].map(messageId => ({
    client: source.client, sessionId: source.sessionId, messageId, role: "user", occurredAtMs: 10, excerpt: oldText,
  }));
  const seeded = await storage.uow.run(scope.owner, {}, tx => storage.memories.touchDuplicate(tx, scope, id,
    priorReceipts, { kind: "fact", origin: "explicit", confidence: 1 }, 100));
  assert.equal(seeded.revision, 2);
  assert.deepEqual((await read()).receipts, priorReceipts);
  const start = await indexRevision();

  const receipt = { client: source.client, sessionId: source.sessionId, eventId: "correct-event", role: "user", occurredAtMs: 20 };
  assert.deepEqual(await service.correct(scope, id, 12, newText, source, { receipt }),
    { status: "conflict", indexRevision: start });
  const corrected = await service.correct(scope, id, seeded.revision, newText, source, { receipt });
  assert.equal(corrected.status, "saved");
  assert.equal(corrected.item.revision, seeded.revision + 1);
  assert.equal(corrected.item.text, newText);
  assert.equal(corrected.item.kind, "fact");
  assert.equal(corrected.item.origin, "explicit");
  assert.deepEqual(corrected.item.source, source);
  assert.equal(corrected.indexRevision, start + 1);
  assert.equal(corrected.indexRevision, await indexRevision());

  const { eventId, ...metadata } = receipt;
  const expectedReceipts = [{ ...metadata, messageId: eventId, excerpt: newText }];
  assert.deepEqual((await read()).receipts, expectedReceipts);
  const unchanged = await service.correct(scope, id, corrected.item.revision, newText, source,
    { kind: "instruction", receipt: { ...receipt, eventId: "unused-event" } });
  assert.deepEqual(unchanged, { ...corrected, status: "unchanged" });
  assert.deepEqual((await read()).receipts, expectedReceipts);
  assert.deepEqual(await service.save(scope, oldText, source), { status: "suppressed" });
  assert.equal(await indexRevision(), corrected.indexRevision);
});

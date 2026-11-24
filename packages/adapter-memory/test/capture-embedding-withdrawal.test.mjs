import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { test } from "node:test";
import { createMemoryAdapter } from "@cairn-ink/adapter-memory";
import { createMemoryService } from "@cairn-ink/core/service";
import { assertDeletedBeforeItemEmbedding } from "../../core/test/helpers/capture-item-withdrawal.mjs";
import { hostedScope as scope, serviceFake } from "../../core/test/helpers/service-fake.mjs";

test("memory capture withholds item embeddings when Raw is deleted during extraction", async () => {
  const storage = createMemoryAdapter({ capabilities: { rawArchive: true } });
  await assertDeletedBeforeItemEmbedding(storage);
  const [{ rows, rawRows }] = await storage.harness.dump();
  assert.deepEqual(rows, []);
  assert.deepEqual(rawRows, []);
});

test("card screening withholds a deleted outbox source that was never archived", async () => {
  const storage = createMemoryAdapter({ capabilities: { rawArchive: true, documentCards: true } });
  const { deps } = serviceFake({ writes: true, capture: true, hasKey: false });
  const event = { client: "client", sessionId: "card-session", eventId: "card-event" };
  const message = { id: "plan", role: "user", occurredAtMs: Date.UTC(2025, 0, 1), content: "Remember this maintenance plan. " +
    "The hatch opens at 8 each morning. ".repeat(7).trimEnd() };
  const lookup = { scope, ...event };
  const { claim } = storage.capture;
  const { run } = storage.uow;
  const embedded = [];
  let claimTx;
  let deleted = false;
  storage.capture.claim = async (tx, key, messages, options) => {
    const result = await claim(tx, key, messages, options);
    if (result.status === "claimed") {
      assert.equal(messages[0].content, message.content);
      claimTx = tx;
    }
    return result;
  };
  storage.uow.run = async (owner, options, work) => {
    let tx;
    const result = await run(owner, options, current => {
      tx = current;
      return work(current);
    });
    // Commit after the claim releases the lock, while the runner still holds its admitted copy.
    if (tx === claimTx) {
      assert.deepEqual(await run(owner, { pauseLock: true }, current => storage.raw.deleteConversation(current, scope, event)),
        { rawDeleted: 0 });
      const current = await run(owner, { readOnly: true }, current => storage.capture.load(current, lookup));
      assert.equal(current.messages[0].content, "");
      deleted = true;
    }
    return result;
  };
  const service = createMemoryService({
    ...deps, storage, model: null, config: { documentCards: { enabled: true } },
    clock: { ...deps.clock, async sha256Hex(text) { return createHash("sha256").update(text).digest("hex"); } },
    embedder: { ...deps.embedder, async embed(texts) {
      embedded.push([...texts]);
      return texts.map(() => Float32Array.of(1));
    } },
  });

  assert.deepEqual(await service.enqueueCapture(scope, { ...event, messages: [message] }), { status: "accepted" });
  const done = await service.runCapture(scope, event);
  assert.equal(deleted, true, "The deletion must commit after claim");
  assert.deepEqual(embedded, [], "Deleted source produced a card embedding request");
  assert.equal(done.status, "done");
  assert.deepEqual(done.result.memories, []);
  assert.deepEqual(await run(scope.owner, { readOnly: true }, tx => storage.documentCards.list(tx, scope)), []);
  const [{ rawRows }] = await storage.harness.dump();
  assert.deepEqual(rawRows, []);
});

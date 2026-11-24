import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { createMemoryService } from "@cairn-ink/core/service";

export const scope = { owner: "owner", namespace: null };
const selection = { client: "client", sessionId: "session", eventId: "event" };
const message = { id: "lantern", role: "user", content: "Store the lantern under the stairs.", occurredAtMs: 10 };

export async function assertDeletedBeforeItemEmbedding(storage) {
  const lookup = { scope, ...selection };
  const write = work => storage.uow.run(scope.owner, { pauseLock: true }, work);
  const read = work => storage.uow.run(scope.owner, { readOnly: true }, work);
  const embedded = [];
  let deleted = false;
  const service = createMemoryService({
    storage,
    model: {
      model: "test", contextWindow: 16_384, countTokens: () => 1,
      async call(stage, { input }) {
        assert.equal(stage, "extract");
        assert.deepEqual(input.messages.map(({ content }) => content), [message.content]);
        assert.deepEqual(await write(tx => storage.raw.deleteConversation(tx, scope, selection)), { rawDeleted: 1 });
        const current = await read(tx => storage.capture.load(tx, lookup));
        assert.equal(current.messages[0].content, "");
        deleted = true;
        return { items: [{ kind: "instruction", content: "Keep the lantern below the staircase.",
          confidence: 0.9, sourceIndices: [input.messages[0].index] }] };
      },
    },
    embedder: {
      model: "test", dimensions: 1,
      async embed(texts) {
        embedded.push([...texts]);
        return texts.map(() => Float32Array.of(1));
      },
    },
    gate: { async assertOpen() {} },
    clock: { nowMs: () => 1_000, monotonicMs: () => 1_000,
      async sha256Hex(input) { return createHash("sha256").update(input).digest("hex"); },
      hmacHex: () => assert.fail("Capture uses no fingerprint key"),
    },
    tokens: { countTokens: () => 1 },
    config: {},
  });
  assert.deepEqual(await service.enqueueCapture(scope, { ...selection, messages: [message] }), { status: "accepted" });
  await write(async tx => {
    const { key, messages } = await storage.capture.load(tx, lookup);
    assert.deepEqual(await storage.raw.archive(tx, key, messages), { archived: 1 });
  });

  const done = await service.runCapture(scope, selection);
  assert.equal(deleted, true, "The deletion must commit before extraction returns a candidate");
  assert.deepEqual(embedded, [], "Deleted source produced an item embedding request");
  assert.equal(done.status, "done");
  assert.deepEqual(done.result.memories, []);
}

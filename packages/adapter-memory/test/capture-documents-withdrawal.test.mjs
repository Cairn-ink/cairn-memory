import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { test } from "node:test";
import { createMemoryAdapter } from "@cairn-ink/adapter-memory";
import { createMemoryService } from "@cairn-ink/core/service";
import { hostedScope as scope, serviceFake } from "../../core/test/helpers/service-fake.mjs";

const sha256Hex = text => createHash("sha256").update(text).digest("hex");
const event = { client: "client", sessionId: "plan-session", eventId: "plan-event" };
const plan = { id: "plan", role: "user", occurredAtMs: Date.UTC(2025, 0, 1), content: "Remember this maintenance plan. " +
  "The hatch opens at 8 each morning. ".repeat(7).trimEnd() };

/**
 * Card-only capture (no model) where the conversation is deleted after the run loaded the admitted
 * messages and before the finish transaction. The finish must not write a card from the stale copy and
 * must not re-insert the deleted Raw row.
 */
test("a conversation deleted during card embedding yields no card and no restored Raw", async () => {
  const adapter = createMemoryAdapter({ capabilities: { rawArchive: true, documentCards: true } });
  const { deps } = serviceFake({ writes: true, capture: true, hasKey: false });
  const read = work => adapter.uow.run(scope.owner, { readOnly: true }, work);
  const write = work => adapter.uow.run(scope.owner, { pauseLock: true }, work);
  let deleted = false;
  const service = createMemoryService({
    ...deps, storage: adapter, config: { documentCards: { enabled: true } },
    clock: { ...deps.clock, sha256Hex },
    model: null,
    embedder: { ...deps.embedder, async embed(texts) { return texts.map(() => Float32Array.of(1)); } },
    gate: { async assertOpen(owner, phase) {
      assert.equal(owner, scope.owner);
      if (phase === "pre-send" && !deleted) {
        deleted = true;
        assert.deepEqual(await write(tx => adapter.raw.deleteConversation(tx, scope, event)), { rawDeleted: 1 });
      }
    } },
  });

  assert.deepEqual(await service.enqueueCapture(scope, { ...event, messages: [plan] }), { status: "accepted" });
  await write(async tx => {
    const admitted = await adapter.capture.load(tx, { scope, ...event });
    assert.deepEqual(await adapter.raw.archive(tx, admitted.key, admitted.messages), { archived: 1 });
  });

  const done = await service.runCapture(scope, event);
  assert.equal(deleted, true, "The deletion must commit during the card embedding gate");
  assert.equal(done.status, "done");
  assert.deepEqual(done.result.memories, []);
  assert.deepEqual(await read(tx => adapter.documentCards.list(tx, scope)), [], "No card may be built from deleted text");
  const raw = await read(tx => adapter.raw.listRaw(tx, { owner: scope.owner, namespaces: [scope.namespace] },
    { cursor: null, limit: 10 }));
  assert.deepEqual(raw.items, [], "The deleted Raw row must not be re-inserted");
});

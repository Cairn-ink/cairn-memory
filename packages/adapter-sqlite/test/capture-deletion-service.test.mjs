import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { createMemoryService } from "@cairn-ink/core/service";
import { captureFixture } from "./capture-fixtures.mjs";
import { sha256, testAccess } from "./storage-fixtures.mjs";

test("the core runner finishes after a post-recheck deletion without restoring Raw or saving memories", async t => {
  const fixture = await captureFixture();
  t.after(fixture.close);
  const { adapter } = fixture;
  const { capture, raw } = adapter;
  const scope = { owner: "owner", namespace: "garden" };
  const event = { client: "client", sessionId: "deleted-session", eventId: "deleted-event" };
  const other = { client: "client", sessionId: "other-session", eventId: "other-event" };
  const messages = [
    { id: "compass", role: "user", content: "Put the brass compass on the top shelf.", occurredAtMs: 10 },
    { id: "fern", role: "user", content: "Move the silver fern away from the window.", occurredAtMs: 20 },
  ];
  const control = { id: "cedar", role: "user", content: "Plant the cedar by the stone fence.", occurredAtMs: 30 };
  const write = work => adapter.uow.run(scope.owner, { pauseLock: true }, work);
  const read = work => adapter.uow.run(scope.owner, { readOnly: true }, work);
  const checked = [];
  const requests = [];
  let deleted = false;
  let admitted;

  const service = createMemoryService({
    storage: { ...adapter, capture: { ...capture, async assertEligible(tx, key, positions) {
      await capture.assertEligible(tx, key, positions);
      if (key.eventId === event.eventId) checked.push({ deleted, positions: [...positions] });
    } } },
    model: { model: "test", contextWindow: 16_384, countTokens: () => 1,
      async call(stage, { input }) {
        assert.equal(stage, "extract");
        assert.equal(deleted, true);
        requests.push(input.messages.map(({ content }) => content));
        return { items: input.messages.map(({ content, index }) =>
          ({ content, kind: "fact", confidence: 0.9, sourceIndices: [index] })) };
      } },
    embedder: { model: "test", dimensions: 1, async embed(inputs) {
      return inputs.map(() => Float32Array.of(1));
    } },
    gate: { async assertOpen(owner, phase) {
      assert.equal(owner, scope.owner);
      if (phase !== "dispatch" || deleted) return;

      // The dispatch gate runs after the final send recheck, before extraction and outside the transaction.
      assert.deepEqual(checked.at(-1), { deleted: false, positions: [0, 1] });
      assert.deepEqual(await write(tx => raw.deleteConversation(tx, scope, event)), { rawDeleted: 2 });
      const current = await read(tx => capture.load(tx, { scope, ...event }));
      assert.deepEqual(current.messages.map(({ content }) => content), ["", ""]);
      await assert.rejects(write(tx => capture.assertEligible(tx, admitted.key, [0, 1])), { code: "suppressed" });
      deleted = true;
    } },
    clock: { nowMs: () => 1_000, monotonicMs: () => 1_000, sha256Hex: async text => sha256(text),
      hmacHex: () => assert.fail("Keyless capture should not use HMAC") },
    tokens: { countTokens: () => 1 },
    config: {},
  });

  assert.deepEqual(await service.enqueueCapture(scope, { ...event, messages }), { status: "accepted" });
  assert.deepEqual(await service.enqueueCapture(scope, { ...other, messages: [control] }), { status: "accepted" });
  admitted = await write(async tx => {
    const loaded = await capture.load(tx, { scope, ...event });
    assert.deepEqual(loaded.messages, messages);
    assert.deepEqual(await raw.archive(tx, loaded.key, loaded.messages), { archived: 2 });
    return loaded;
  });

  const result = await service.runCapture(scope, event);
  assert.equal(result.status, "done", JSON.stringify(result));
  assert.deepEqual(result.result.memories, []);
  assert.deepEqual(await service.captureStatus(scope, event.eventId), { status: "done" });
  assert.deepEqual(checked.filter(check => check.deleted), [{ deleted: true, positions: [] }]);
  assert.deepEqual(requests, [messages.map(({ content }) => content)]);

  const unrelated = await service.runCapture(scope, other);
  assert.equal(unrelated.status, "done", JSON.stringify(unrelated));
  assert.equal(unrelated.result.memories.length, 1);
  assert.deepEqual(requests.at(-1), [control.content]);
  assert.deepEqual(await testAccess(fixture, scope, {}, db => ({
    memories: db.prepare("SELECT json_extract(body, '$.text') AS text FROM cairn_memories").all().map(({ text }) => text),
    raw: db.prepare("SELECT content FROM cairn_raw_messages").all().map(({ content }) => JSON.parse(content)),
  })), { memories: [control.content], raw: [control.content] });

  await adapter.close();
  const bytes = readFileSync(fixture.path);
  for (const { content } of messages) assert.equal(bytes.includes(content), false);
  assert.equal(bytes.includes(control.content), true);
});

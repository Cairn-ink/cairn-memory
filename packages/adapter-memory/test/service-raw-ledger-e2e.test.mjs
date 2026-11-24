import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { test } from "node:test";
import { createMemoryAdapter } from "@cairn-ink/adapter-memory";
import { createMemoryService } from "@cairn-ink/core/service";

function serviceFor(storage, onExtract = () => assert.fail("Unexpected extraction")) {
  return createMemoryService({
    storage,
    model: {
      model: "test", contextWindow: 16_384, countTokens: () => 1,
      async call(stage, request) {
        assert.equal(stage, "extract");
        onExtract(request.input);
        return { items: [] };
      },
    },
    embedder: { model: "test", dimensions: 1, async embed(inputs) {
      return inputs.map(() => Float32Array.of(1));
    } },
    gate: { async assertOpen() {} },
    clock: {
      nowMs: () => 100, monotonicMs: () => performance.now(),
      async sha256Hex(text) { return createHash("sha256").update(text).digest("hex"); },
      hmacHex: () => assert.fail("The service must use the owner fingerprint key"),
    },
    tokens: { countTokens: () => 1 },
    config: {},
  });
}

test("Core forget blanks admitted text before the runner claims and finishes the event", async () => {
  const forgotten = "The cedar cabinet has a brass handle.";
  const retained = "The maple shelf holds two blue bowls.";
  const messages = [
    { id: "first", role: "user", content: forgotten, occurredAtMs: 10 },
    { id: "second", role: "assistant", content: retained, occurredAtMs: 20 },
  ];
  const scope = { owner: "owner", namespace: null };
  const selection = { client: "client", sessionId: "session", eventId: "event" };
  const source = { kind: "web", client: null, sessionId: null };
  const storage = createMemoryAdapter({ capabilities: { rawArchive: true, fingerprintKey: true } });
  const dispatched = [];
  const service = serviceFor(storage, (input) => dispatched.push(input));
  const load = () => storage.uow.run(scope.owner, { readOnly: true },
    (tx) => storage.capture.load(tx, { scope, ...selection }));
  const enqueue = (batch = messages) => service.enqueueCapture(scope, { ...selection, messages: batch });
  const saved = await service.save(scope, forgotten, source);
  assert.equal(saved.status, "saved");
  assert.deepEqual(await enqueue(), { status: "accepted" });
  const admitted = await load();
  assert.deepEqual(admitted.messages, messages);
  const [{ rawRows }] = await storage.harness.dump();
  assert.deepEqual(rawRows, [], "A pending admission must exercise ledger-only erasure");

  assert.equal((await service.forget(scope, saved.item.id, source)).status, "forgotten");
  const scrubbed = { key: admitted.key, messages: [{ ...messages[0], content: "" }, messages[1]] };
  assert.deepEqual(await load(), scrubbed);
  assert.equal(JSON.stringify(await storage.harness.dump()).includes(forgotten), false);
  assert.deepEqual(await enqueue(), { status: "duplicate" });
  await assert.rejects(enqueue([{ ...messages[0], content: "The cabinet is made of birch." }, messages[1]]),
    { code: "event_payload_conflict" });

  const completed = await service.runCapture(scope, selection);
  assert.equal(completed.status, "done");
  assert.equal(dispatched.length, 1);
  assert.ok(JSON.stringify(dispatched[0]).includes(retained));
  assert.equal(JSON.stringify(dispatched[0]).includes(forgotten), false);
  assert.deepEqual(await load(), scrubbed);
  assert.equal(JSON.stringify(await storage.harness.dump()).includes(forgotten), false);
  assert.deepEqual(await service.runCapture(scope, selection), completed);
  assert.deepEqual(await enqueue(), { status: "duplicate" });
});

test("Core forget erases admitted ledger text throughout the supplied proven closure", async () => {
  const storage = createMemoryAdapter({ capabilities: { rawArchive: true, fingerprintKey: true } });
  const service = serviceFor(storage);
  const scope = { owner: "owner", namespace: null };
  const client = "client";
  const root = { client, sessionId: "root" };
  const linked = { client, sessionId: "linked" };
  const unrelated = { client, sessionId: "unrelated" };
  const forgotten = "The cedar cabinet has a brass handle.";
  const slots = [
    [root, "Two folded towels are in the closet."],
    [linked, "The desk lamp casts a warm light."],
    [unrelated, "Three apples are in the basket."],
  ];
  const source = { kind: "web", ...root };
  const saved = await service.save(scope, forgotten, source);
  assert.equal(saved.status, "saved");
  const admitted = [];
  const load = (selection) => storage.uow.run(scope.owner, { readOnly: true },
    (tx) => storage.capture.load(tx, { scope, ...selection }));
  for (const [session, content] of slots) {
    const selection = { ...session, eventId: session.sessionId };
    const message = { id: "message", role: "user", content, occurredAtMs: 10 };
    assert.deepEqual(await service.enqueueCapture(scope, { ...selection, messages: [message] }), { status: "accepted" });
    const event = await load(selection);
    assert.deepEqual(event.messages, [message]);
    admitted.push({ selection, event });
  }
  const [{ rawRows }] = await storage.harness.dump();
  assert.deepEqual(rawRows, []);

  const closureService = serviceFor({
    ...storage,
    capabilities: { ...storage.capabilities, sessionLineage: true },
    sessionLineage: {
      async provenClosure(tx, targetScope, roots) {
        assert.equal(tx.owner, scope.owner);
        assert.deepEqual(targetScope, scope);
        assert.deepEqual(roots, [root]);
        return [root, linked];
      },
    },
  });
  assert.equal((await closureService.forget(scope, saved.item.id, source)).status, "forgotten");
  const snapshot = JSON.stringify(await storage.harness.dump());
  for (const { selection, event } of admitted) {
    const [message] = event.messages;
    const retained = selection.sessionId === unrelated.sessionId;
    assert.deepEqual(await load(selection), {
      key: event.key,
      messages: [retained ? message : { ...message, content: "" }],
    });
    assert.equal(snapshot.includes(message.content), retained);
  }
});

import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { test } from "node:test";
import { createMemoryAdapter } from "@cairn-ink/adapter-memory";
import { coreDigest } from "@cairn-ink/core";
import { createMemoryService } from "@cairn-ink/core/service";

const scope = { owner: "owner", namespace: null };
const selection = { client: "client", sessionId: "session", eventId: "event" };
const key = { scope, ...selection, payloadDigest: "a".repeat(64) };
const forgotten = "The discarded notebook is on the shelf.";

async function finishBatch(adapter, suppress) {
  const { uow, capture, harness } = adapter;
  const contents = ["First memory", forgotten, "Another memory", forgotten, "Final memory"];
  const items = await Promise.all(contents.map(async (content) => ({
    content, kind: "fact", confidence: 0.9, textHash: `sha256:${(await coreDigest(content)).value}`,
    embedding: null, receipts: [],
  })));
  if (suppress) {
    await harness.seedFact(scope.owner, {
      ...scope, actionId: "forget-text", origin: "forget", kind: "text", mode: "exact",
      text: { digests: [await coreDigest(forgotten)] },
    });
  }
  return uow.run(scope.owner, { pauseLock: true }, async (tx) => {
    const claim = await capture.claim(tx, key, [], { leaseMs: 60_000 });
    assert.equal(claim.status, "claimed");
    return capture.finish(tx, claim.token, items);
  });
}

async function assertMixedFinish(adapter) {
  const result = await finishBatch(adapter, true);
  assert.equal(result.suppressedCount, 2);
  assert.equal(result.memories.length, 3);
  assert.deepEqual(result.suppressedItems, [1, 3], "Finish must report the exact suppressed positions");
  return result;
}

test("finish reports the exact suppressed positions and preserves them on replay", async () => {
  const adapter = createMemoryAdapter();
  const { capture, uow } = adapter;
  const result = await assertMixedFinish(adapter);
  const expected = structuredClone(result);
  const replay = () => uow.run(scope.owner, { pauseLock: true },
    (tx) => capture.claim(tx, key, [], { leaseMs: 60_000 }));

  result.suppressedItems[0] = 0;
  const first = await replay();
  assert.deepEqual(first, { status: "rawReplay", result: expected });
  first.result.suppressedItems.push(4);
  assert.deepEqual(await replay(), { status: "rawReplay", result: expected });
  const readmitted = await uow.run(scope.owner, { pauseLock: true }, (tx) => capture.admit(tx, key, []));
  assert.deepEqual(readmitted, { status: "rawReplay", result: expected });
});

test("finish omits suppression positions when no items were suppressed", async () => {
  const result = await finishBatch(createMemoryAdapter(), false);
  assert.equal(result.suppressedCount, 0);
  assert.equal(Object.hasOwn(result, "suppressedItems"), false);
});

function mutateFinish(t, adapter, mutate) {
  const { finish } = adapter.capture;
  t.mock.method(adapter.capture, "finish", async (tx, token, items) => {
    const result = await finish(tx, token, items);
    result.suppressedItems = mutate(result.suppressedItems);
    return result;
  });
}

for (const [label, mutate] of [
  ["omits a suppressed position", (positions) => positions.slice(0, 1)],
  ["reports off-by-one positions", (positions) => positions.map((position) => position + 1)],
  ["duplicates a suppressed position", ([first]) => [first, first]],
]) {
  test(`the mixed finish assertion catches a result that ${label}`, async (t) => {
    const adapter = createMemoryAdapter();
    mutateFinish(t, adapter, mutate);
    await assert.rejects(assertMixedFinish(adapter), {
      code: "ERR_ASSERTION", message: /^Finish must report the exact suppressed positions/,
    });
  });
}

function archiveAdapter(fingerprintKey) {
  return createMemoryAdapter({ capabilities: { rawArchive: true, fingerprintKey } });
}

async function assertCaptureArchive(storage) {
  const messages = [
    { id: "orchids", content: "The orchids get water on Mondays." },
    { id: "lantern", content: "The lantern is beneath the steps." },
    { id: "mugs", content: "The mugs are beside the kettle." },
  ].map((message, index) => ({ ...message, role: "user", occurredAtMs: index + 1 }));
  const contents = ["Water the orchids each Monday.", "Keep the lantern under the stairs.", "Store the mugs by the kettle."];
  const textHash = `sha256:${(await coreDigest(contents[1])).value}`;
  const { id: memoryId } = await storage.uow.run(scope.owner, {}, (tx) => storage.memories.insert(tx, scope, {
    text: contents[1], kind: "fact", confidence: 0.9, textHash, embedding: null,
    origin: "explicit", source: { kind: "capture", client: null, sessionId: null },
  }, [], 1));
  const service = createMemoryService({
    storage,
    model: {
      model: "fixture", contextWindow: 16_384, countTokens: () => 1,
      async call(stage) {
        assert.equal(stage, "extract");
        return { items: contents.map((content, position) => ({
          content, kind: "fact", confidence: 0.9, sourceIndices: [position],
        })) };
      },
    },
    embedder: {
      model: "fixture", dimensions: 1,
      async embed(inputs) {
        assert.equal(inputs.length, contents.length);
        // Finish suppresses an exact duplicate of a hidden memory. Passage checks only see text facts.
        await storage.harness.seedFact(scope.owner, {
          ...scope, actionId: "forget-identity", origin: "forget", kind: "identity", memoryId,
        });
        return inputs.map(() => Float32Array.of(1));
      },
    },
    gate: { async assertOpen() {} },
    clock: {
      nowMs: () => 100, monotonicMs: () => 100,
      async sha256Hex(text) { return createHash("sha256").update(text).digest("hex"); },
      hmacHex: () => assert.fail("Expected the owner fingerprint provider"),
    },
    tokens: { countTokens: () => 1 },
    config: {},
  });
  assert.deepEqual(await service.enqueueCapture(scope, { ...selection, messages }), { status: "accepted" });
  const completed = await service.runCapture(scope, selection);
  assert.equal(completed.status, "done");
  assert.equal(completed.result.suppressedCount, 1);
  assert.equal(completed.result.memories.length, 2);
  const [{ rows, rawRows }] = await storage.harness.dump();
  assert.deepEqual(rows.filter(({ row }) => row.id !== memoryId).map(({ row }) => row.text).sort(),
    [contents[0], contents[2]].sort());
  assert.deepEqual(rawRows.map(({ messageId }) => messageId).sort(), ["mugs", "orchids"],
    "Raw must contain exactly the sources cited by written items");
  return completed.result;
}

for (const fingerprintKey of [true, false]) {
  test(`finish suppression excludes its source from Raw ${fingerprintKey ? "with" : "without"} an owner key`, async () => {
    const result = await assertCaptureArchive(archiveAdapter(fingerprintKey));
    assert.deepEqual(result.suppressedItems, [1]);
  });
}

test("the Raw assertion catches a written position reported as suppressed", async (t) => {
  const adapter = archiveAdapter(true);
  mutateFinish(t, adapter, (positions) => [0, ...positions]);
  await assert.rejects(assertCaptureArchive(adapter), {
    code: "ERR_ASSERTION", message: /^Raw must contain exactly the sources cited by written items/,
    actual: ["mugs"], expected: ["mugs", "orchids"],
  });
});

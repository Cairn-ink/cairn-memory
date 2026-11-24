import assert from "node:assert/strict";
import { test } from "node:test";
import { coreDigest } from "@cairn-ink/core";
import { createMemoryService } from "@cairn-ink/core/service";
import { hostedScope as scope, serviceFake } from "./helpers/service-fake.mjs";

const selection = { client: "client", sessionId: "session", eventId: "event" };
const messages = [
  { id: "orchids", role: "user", content: "Water the orchids on Mondays.", occurredAtMs: 100 },
  { id: "notebook", role: "assistant", content: "Write the dates in the blue notebook.", occurredAtMs: 200 },
  { id: "lantern", role: "user", content: "The lantern is under the stairs.", occurredAtMs: 300 },
  { id: "flashlight", role: "assistant", content: "The flashlight is under the stairs too.", occurredAtMs: 400 },
];
const candidate = (content, sourceIndices, confidence = 0.9) => ({ content, kind: "fact", confidence, sourceIndices });
const orchids = candidate("The orchids need water every Monday.", [0]);
const notebook = candidate("The blue notebook is used to record dates.", [1]);

async function setup({ incoming = messages.slice(0, 2), items = [orchids, notebook], suppressedItems, eligible } = {}) {
  const fake = serviceFake({ writes: true, capture: true, rawArchive: true });
  if (suppressedItems !== undefined) fake.hooks.finishSuppressedItems = () => suppressedItems;
  if (eligible) fake.hooks.eligible = eligible;
  fake.hooks.model = () => ({ items });
  const service = createMemoryService(fake.deps);
  assert.deepEqual(await service.enqueueCapture(scope, { ...selection, messages: incoming }), { status: "accepted" });
  fake.calls.length = 0;
  return { ...fake, run: () => service.runCapture(scope, selection), status: () => service.captureStatus(scope, selection.eventId) };
}

test("finish suppression excludes every receipted source and keeps an unrelated item's source", async () => {
  const f = await setup({ incoming: messages, eligible: () => [0, 2, 3], suppressedItems: [1], items: [
    candidate("A low-confidence claim.", [0], 0.49),
    orchids,
    candidate("Store portable lights downstairs.", [2, 1]),
  ] });
  const done = await f.run();
  assert.equal(done.status, "done");
  assert.deepEqual(done.result.suppressedItems, [1]);
  assert.equal(done.result.memories.length, 1);
  const [, , items] = f.calls.find(([method]) => method === "capture.finish");
  assert.deepEqual(items.map(({ receipts }) => receipts.map(({ messageId }) => messageId)),
    [["orchids"], ["flashlight", "lantern"]]);
  assert.deepEqual(f.archived(scope.owner), [messages[0]]);
});

test("a suppressed receipt excludes a source also cited by a saved item", async () => {
  const f = await setup({ suppressedItems: [0], items: [orchids,
    candidate("Record the orchid watering dates in the blue notebook.", [0, 1]),
  ] });
  const done = await f.run();
  assert.equal(done.status, "done");
  assert.equal(done.result.memories.length, 1);
  assert.deepEqual(f.archived(scope.owner), [messages[1]]);
});

test("when suppression excludes every source, the runner skips both Raw archive ports", async () => {
  const f = await setup({ suppressedItems: [1, 0] });
  assert.equal((await f.run()).status, "done");
  assert.deepEqual(f.archived(scope.owner), []);
  assert.equal(f.calls.some(([method]) => method.startsWith("raw.")), false);
});

test("an omitted suppressedItems leaves the result and Raw archive unchanged", async () => {
  const f = await setup();
  assert.deepEqual(await f.run(), { status: "done", result: {
    indexRevision: 1,
    memories: [{ id: "captured-1", revision: 1, outcome: "inserted" },
      { id: "captured-2", revision: 1, outcome: "inserted" }],
    suppressedCount: 0, duplicateCount: 0, counters: {},
  } });
  assert.deepEqual(f.archived(scope.owner), messages.slice(0, 2));
});

test("an explicitly empty suppressedItems list keeps every eligible source", async () => {
  const f = await setup({ suppressedItems: [] });
  const done = await f.run();
  assert.equal(done.status, "done");
  assert.deepEqual(done.result.suppressedItems, []);
  assert.deepEqual(f.archived(scope.owner), messages.slice(0, 2));
});

async function assertFailedClosed(f) {
  const failed = { status: "failed", code: "internal_error" };
  assert.deepEqual(await f.run(), failed);
  assert.ok(f.calls.some(([method]) => method === "capture.finish"));
  assert.deepEqual(await f.status(), failed);
  assert.deepEqual(f.committed(scope.owner).rows, []);
  assert.deepEqual(f.archived(scope.owner), []);
  assert.equal(f.calls.some(([method]) => method.startsWith("raw.")), false);
}

for (const [name, suppressedItems] of [
  ["out of range", [2]], ["negative", [-1]], ["duplicate", [0, 0]], ["non-integer", [0.5]],
  ["string position", ["0"]], ["sparse", new Array(1)], ["non-array", null],
]) {
  test(`a ${name} suppressedItems value fails closed`, async () => {
    await assertFailedClosed(await setup({ suppressedItems }));
  });
}

test("a nonempty suppression list fails closed when no sources are eligible at claim", async () => {
  await assertFailedClosed(await setup({ eligible: () => [], suppressedItems: [0] }));
});

test("a nonempty suppression list fails closed when source re-check empties the batch before dispatch", async () => {
  const f = await setup({ incoming: messages.slice(0, 1), eligible: () => [0], suppressedItems: [0] });
  f.seedFact({ ...scope, kind: "text", origin: "forget", actionId: "forget", mode: "exact",
    text: { digests: [await coreDigest(messages[0].content)] } });
  await assertFailedClosed(f);
  assert.deepEqual(f.calls.find(([method]) => method === "capture.assertEligible")[2], []);
  assert.deepEqual(f.calls.find(([method]) => method === "capture.finish")[2], []);
});

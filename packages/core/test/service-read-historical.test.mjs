import assert from "node:assert/strict";
import { test } from "node:test";
import { createMemoryService } from "@cairn-ink/core/service";
import { hostedScope as scope, memory, serviceFake } from "./helpers/service-fake.mjs";

const historical = { ...memory("original"), historical: true };
const active = memory("replacement");
const forgotten = { ...memory("forgotten"), historical: true };
const foreign = [
  memory("other-owner", { scope: { ...scope, owner: "another-owner" } }),
  memory("other-namespace", { scope: { ...scope, namespace: "another-namespace" } }),
];
const target = id => ({ type: "memory", id });

function fixture() {
  const fake = serviceFake({ rows: [historical, active, forgotten, ...foreign], recall: true, leakForgotten: true });
  fake.forget(forgotten);
  fake.hooks.lexicalScore = () => 1;
  const assertVisible = fake.storage.fence.assertVisible;
  fake.storage.fence.assertVisible = (tx, readSet, refs, intent) =>
    assertVisible(tx, readSet, intent === "read" ? refs : refs.filter(({ id }) => id !== historical.id));
  return createMemoryService(fake.deps);
}

test("read returns a superseded memory with the historical flag", async () => {
  assert.deepEqual(await fixture().read(scope, target(historical.id)), {
    status: "found", item: historical, receipts: [], sourceDates: null,
  });
});

test("read returns not_found for forgotten and foreign memories", async () => {
  const service = fixture();
  for (const row of [forgotten, ...foreign]) {
    assert.deepEqual(await service.read(scope, target(row.id)), { status: "not_found" });
  }
});

test("recall and find omit historical memories", async () => {
  const service = fixture();
  assert.deepEqual((await service.recall(scope, "memory", { mode: "search" })).items, [active]);
  const found = await service.find(scope, "memory", { kinds: ["memory"] });
  assert.deepEqual(found.memories, [active]);
  assert.deepEqual(found.layers.memory, { status: "ok", count: 1 });
});

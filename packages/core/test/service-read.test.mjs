import assert from "node:assert/strict";
import { test } from "node:test";
import { CoreError } from "@cairn-ink/core";
import { createMemoryService } from "@cairn-ink/core/service";
import { hostedScope as scope, memory, serviceFake } from "./helpers/service-fake.mjs";

const ref = id => ({ type: "memory", id });
const missing = { status: "not_found" };

test("read hydrates receipts and source dates in the fresh fence snapshot", async () => {
  const item = memory("present");
  const receipts = [{ client: "client", sessionId: "session", messageId: "message", occurredAtMs: 10, role: "user" }];
  const sourceDates = { firstMs: 10, lastMs: 10 };
  const { deps, hooks, calls } = serviceFake({ rows: [item], recall: true });
  hooks.hydrate = rows => rows.map(row => ({ ...row, receipts, sourceDates }));
  const service = createMemoryService(deps);
  assert.deepEqual(await service.read(scope, ref(item.id)), { status: "found", item, receipts, sourceDates });
  const readScope = { owner: scope.owner, namespaces: [scope.namespace] };
  const refs = [{ ...ref(item.id), namespace: scope.namespace }];
  assert.deepEqual(calls, [
    ["run", scope.owner, { readOnly: true }],
    ["hydrate.hydrate", readScope, refs, "read"],
    ["run", scope.owner, { readOnly: true }],
    ["hydrate.hydrate", readScope, refs, "read"],
    ["fence.assertVisible", readScope, refs],
  ]);
  delete hooks.hydrate;
  assert.deepEqual(await service.read(scope, ref(item.id)), { status: "found", item, receipts: [], sourceDates: null });
});

test("read returns the same miss for absent, forgotten, suppressed, historical, and out-of-scope memories", async () => {
  const rows = [
    memory("forgotten"), memory("suppressed"), { ...memory("historical"), historical: true },
    memory("other-owner", { scope: { ...scope, owner: "another-owner" } }),
    memory("other-namespace", { scope: { ...scope, namespace: "another-namespace" } }),
  ];
  const fake = serviceFake({ rows, recall: true, leakForgotten: true });
  fake.forget(rows[0]);
  fake.hooks.hideAtFence = ref => rows.some(row => row.id === ref.id && row.historical);
  fake.hooks.hydrate = rows => rows.filter(({ ref }) => ref.id !== "suppressed");
  const service = createMemoryService(fake.deps);
  for (const id of ["missing", ...rows.map(row => row.id)]) {
    assert.deepEqual(await service.read(scope, ref(id)), missing);
  }
});

test("read drops a memory forgotten after hydration", async () => {
  const item = memory("forgotten-during-read");
  const fake = serviceFake({ rows: [item], recall: true });
  fake.hooks.hydrate = () => { fake.commitForget(item); };
  assert.deepEqual(await createMemoryService(fake.deps).read(scope, ref(item.id)), missing);
});

test("read rejects card refs as capability_unavailable and malformed refs as invalid_input", async () => {
  const { deps, calls } = serviceFake({ recall: true });
  const service = createMemoryService(deps);
  await assert.rejects(service.read(scope, { type: "card", id: "card" }),
    error => error instanceof CoreError && error.code === "capability_unavailable");
  for (const ref of [null, {}, { type: "raw", id: "raw" }, { type: "memory", id: 1 }, { type: "memory", id: "id", namespace: null }]) {
    await assert.rejects(service.read(scope, ref), error => error instanceof CoreError && error.code === "invalid_input");
  }
  assert.deepEqual(calls, []);
});

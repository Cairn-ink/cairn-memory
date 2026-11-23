import assert from "node:assert/strict";
import { test } from "node:test";
import { documentCardVisible } from "@cairn-ink/core/routing";

const scope = { owner: "owner", namespace: "project" };
const card = {
  id: "imported-card",
  scope,
  sourceMessage: null,
  sourceMemories: [{ id: "first", revision: 2 }, { id: "second", revision: 1 }],
};
const memoryStates = new Map([
  ["first", { status: "visible", revision: 2 }],
  ["second", { status: "visible", revision: 1 }],
]);
const read = { card, requestedScope: { ...scope }, memoryStates };

test("an imported card uses its stored ID and current visible memories", async () => {
  assert.deepEqual(await documentCardVisible(read), { visible: true, reason: null });
  assert.deepEqual(await documentCardVisible({ ...read, sourceWithheld: true }), { visible: true, reason: null });
});

test("an authored card can be visible without linked memories", async () => {
  assert.deepEqual(await documentCardVisible({
    ...read, card: { ...card, sourceMemories: [] }, memoryStates: new Map(),
  }), { visible: true, reason: null });
});

test("an imported card requires each linked revision to be present, current and visible", async () => {
  for (const [state, reason] of [
    [undefined, "source_memory_missing"],
    [{ status: "forgotten" }, "source_memory_forgotten"],
    [{ status: "historical", revision: 1 }, "source_memory_not_visible"],
    [{ status: "visible", revision: 2 }, "source_memory_not_visible"],
    [{ status: "suppressed" }, "source_memory_not_visible"],
    [{ status: "unknown" }, "source_memory_not_visible"],
    [{ status: "visible" }, "uncertain"],
  ]) {
    const states = new Map(memoryStates);
    if (state === undefined) states.delete("second");
    else states.set("second", state);
    assert.deepEqual(await documentCardVisible({ ...read, memoryStates: states }), { visible: false, reason });
  }
});

test("a source-less card requires the same owner and namespace", async () => {
  for (const requestedScope of [{ ...scope, owner: "other" }, { ...scope, namespace: null }]) {
    assert.deepEqual(await documentCardVisible({ ...read, requestedScope }), { visible: false, reason: "scope_mismatch" });
  }
});

test("missing source message data fails closed without an explicit null", async () => {
  assert.deepEqual(await documentCardVisible({
    ...read, card: { ...card, sourceMessage: undefined }, sourceWithheld: false,
  }), { visible: false, reason: "uncertain" });
});

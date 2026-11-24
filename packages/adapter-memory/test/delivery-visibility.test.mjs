import assert from "node:assert/strict";
import { test } from "node:test";
import { DELIVERY_VISIBILITY_CASES, runCase } from "@cairn-ink/conformance";
import { CoreError } from "@cairn-ink/core";
import { assertPlacementDelivery, assertRootDelivery, deliveryFactory, rationaleFixture, ROOT_ASSERTION } from "./fixtures/delivery-visibility.mjs";

for (const testCase of DELIVERY_VISIBILITY_CASES) {
  test(`${testCase.id} ${testCase.title}`, async () => {
    assert.equal(await runCase(deliveryFactory(), testCase), null);
  });
}

test("a text fact on a non-root endpoint removes its decisionContext paths", async () => {
  await (await rationaleFixture("non-root")).assertDelivery();
});

test("a text fact on the root endpoint removes its decisionContext paths", async (t) => {
  const fixture = await rationaleFixture("root");
  if (await fixture.assertDelivery() === "todo") {
    t.todo("core decisionContext root endpoint is not fenced (fix pending)");
  }
});

const rootRef = { type: "memory", id: "root", namespace: null };
const premiseRef = { type: "memory", id: "premise", namespace: null };
const empty = { status: "unassessed", refs: [] };
const paths = { status: "unassessed", refs: [{ id: premiseRef.id, revision: 1, relation: "supports-decision", direction: "incoming" }] };
const unrelated = new CoreError("storage_error");

for (const [label, calls, readContext, expected] of [
  ["fixed throw", [rootRef], async () => { throw new CoreError("memory_not_found"); }, "pass"],
  ["fixed empty", [rootRef], async () => empty, "pass"],
  ["current bypass", [premiseRef], async () => paths, "todo"],
]) {
  test(`root delivery classifier accepts the ${label} outcome`, async () => {
    assert.equal(await assertRootDelivery(readContext, calls, rootRef), expected);
  });
}

test("root delivery classifier fails when core ignores a root fence denial", async () => {
  await assert.rejects(assertRootDelivery(async () => paths, [rootRef, premiseRef], rootRef),
    { code: "ERR_ASSERTION", message: ROOT_ASSERTION, actual: paths });
});

test("root delivery classifier fails on metadata without paths", async () => {
  for (const [field, value] of Object.entries({ count: 1, id: rootRef.id, receiptId: "receipt", digest: "digest" })) {
    await assert.rejects(assertRootDelivery(async () => ({ ...empty, [field]: value }), [], rootRef),
      { code: "ERR_ASSERTION", message: ROOT_ASSERTION });
  }
});

test("root delivery classifier propagates unrelated errors", async () => {
  await assert.rejects(assertRootDelivery(async () => { throw unrelated; }, [], rootRef), (error) => error === unrelated);
});

for (const [exclusion, label] of [
  ["text", "text"], ["identity", "identity"], ["session", "own-message session"], ["linked-session", "linked-memory session"],
]) {
  test(`placement after ${label} exclusion gives only the visible card to the classifier`, () =>
    assertPlacementDelivery(exclusion));
}

import assert from "node:assert/strict";
import { test } from "node:test";
import { buildDocumentCard, documentCardSourceWithheld, documentCardVisible } from "../src/routing/index.mjs";

const scope = { owner: "owner", namespace: "project" };
const card = {
  id: "imported-card",
  scope,
  origin: "import",
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
    ...read, card: { ...card, origin: "manual", sourceMemories: [] }, memoryStates: new Map(),
  }), { visible: true, reason: null });
});

test("import and manual cards require each linked revision to be present, current and visible", async () => {
  const manualRead = { ...read, card: { ...card, origin: "manual" } };
  assert.deepEqual(await documentCardVisible(manualRead), { visible: true, reason: null });
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
    assert.deepEqual(await documentCardVisible({ ...manualRead, memoryStates: states }), { visible: false, reason });
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

const sourceMessage = { client: "client", sessionId: "session", messageId: "message" };
const canonicalSessionKey = "key";
const content = "Garden guide";
const { card: built } = await buildDocumentCard(
  { id: sourceMessage.messageId, role: "user", content },
  { scope, client: sourceMessage.client, canonicalSessionKey },
);
assert.ok(built);
const legacyCard = { id: built.id, scope, sourceMessage, canonicalSessionKey, sourceMemories: [] };
const messageRead = { requestedScope: scope, memoryStates: new Map() };

test("a Raw forget still hides a router card projected as source-less", async () => {
  const { client, sessionId } = sourceMessage;
  const sourceWithheld = documentCardSourceWithheld({
    sourceLengthUtf16: content.length, sourceExcluded: false,
    rawRows: [{
      type: "raw", scope, sessionKeyHash: "a".repeat(64), messageKey: "message-key",
      startUtf16: 0, endUtf16: content.length, source: { client, sessionId, occurredAtMs: 100 },
    }],
    facts: [{
      fact: { ...scope, kind: "session", origin: "forget", actionId: "action", session: { client, sessionId } },
      factId: "fact", incarnation: "incarnation", epoch: 1n, createdAtMs: 100,
    }],
  });
  assert.equal(sourceWithheld, true);
  const projected = {
    ...messageRead, card: { id: built.id, scope, origin: "router", sourceMessage: null, sourceMemories: [] },
  };
  assert.deepEqual(await documentCardVisible({ ...projected, sourceWithheld }), { visible: false, reason: "source_withheld" });
  assert.deepEqual(await documentCardVisible(projected), { visible: false, reason: "uncertain" });
  assert.deepEqual(await documentCardVisible({ ...projected, sourceWithheld: false }), { visible: false, reason: "uncertain" });
});

test("router and legacy cards both require the message, canonical ID and Raw verdict", async () => {
  for (const stored of [legacyCard, { ...legacyCard, origin: "router" }]) {
    const input = { ...messageRead, card: stored, sourceWithheld: false };
    assert.deepEqual(await documentCardVisible(input), { visible: true, reason: null });
    assert.deepEqual(await documentCardVisible({ ...input, sourceWithheld: undefined }), { visible: false, reason: "uncertain" });
    assert.deepEqual(await documentCardVisible({ ...input, card: { ...stored, id: "wrong" } }), { visible: false, reason: "id_mismatch" });
    for (const missing of [null, undefined]) {
      assert.deepEqual(await documentCardVisible({ ...input, card: { ...stored, sourceMessage: missing } }),
        { visible: false, reason: "uncertain" });
    }
  }
});

test("a source message conflicts with import and manual origins, and unknown origins fail closed", async () => {
  for (const origin of ["import", "manual", "unknown", null]) {
    assert.deepEqual(await documentCardVisible({
      ...messageRead, card: { ...legacyCard, origin }, sourceWithheld: false,
    }), { visible: false, reason: "uncertain" });
  }
  for (const origin of ["unknown", null]) {
    assert.deepEqual(await documentCardVisible({ ...read, card: { ...card, origin } }), { visible: false, reason: "uncertain" });
  }
});

test("source-less cards require a nonempty string ID", async () => {
  for (const id of ["", 1]) {
    assert.deepEqual(await documentCardVisible({ ...read, card: { ...card, id } }), { visible: false, reason: "uncertain" });
  }
});

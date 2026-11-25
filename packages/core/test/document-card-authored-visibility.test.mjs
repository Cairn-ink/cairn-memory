import assert from "node:assert/strict";
import { test } from "node:test";
import { coreDigest, legacyExactMac, passageShingles, userFingerprintKey } from "../src/index.mjs";
import { buildDocumentCard, documentCardSourceWithheld, documentCardVisible } from "../src/routing/index.mjs";

const scope = { owner: "owner", namespace: "project" };
const card = {
  id: "imported-card",
  scope,
  origin: "import",
  title: "Garden guide",
  body: "A schedule for watering herbs",
  sourceMessage: null,
  sourceMemories: [{ id: "first", revision: 2 }, { id: "second", revision: 1 }],
};
const memoryStates = new Map([
  ["first", { status: "visible", revision: 2, correctedRevisions: [] }],
  ["second", { status: "visible", revision: 1, correctedRevisions: [] }],
]);
const read = { card, requestedScope: { ...scope }, memoryStates, textFacts: [] };
const manualCard = { ...card, origin: "manual", sourceMemories: [] };
const manualRead = { ...read, card: manualCard, memoryStates: new Map() };
const visible = { visible: true, reason: null };
const withheld = { visible: false, reason: "text_withheld" };

const labels = Object.freeze({
  keyIdDomain: "test-key-id", shingleKeyPrefix: "test-shingles:", legacyExactPrefix: "test-exact:",
});
const fingerprintKey = await userFingerprintKey("synthetic key material", scope.owner, labels);
const otherKey = await userFingerprintKey("different synthetic key material", scope.owner, labels);
const fact = (text, mode = "exact") => ({ ...scope, kind: "text", origin: "forget", actionId: "action", mode, text });
const exactFact = async (text, key = null) => fact({ digests: [await coreDigest(text, key)] });

test("an imported card uses its stored ID and current visible memories", async () => {
  assert.deepEqual(await documentCardVisible(read), { visible: true, reason: null });
  assert.deepEqual(await documentCardVisible({ ...read, sourceWithheld: true }), { visible: true, reason: null });
});

test("an authored card can be visible without linked memories", async () => {
  assert.deepEqual(await documentCardVisible(manualRead), visible);
  assert.deepEqual(await documentCardVisible({ ...manualRead, memoryStates: undefined }), visible);
});

for (const field of ["title", "body"]) {
  test(`an exact text fact withholds a manual card by ${field}`, async () => {
    const textFacts = [await exactFact(manualCard[field].toUpperCase())];
    assert.deepEqual(await documentCardVisible({ ...manualRead, textFacts }), withheld);
  });

  test(`shingle containment applies the memory threshold to the manual card ${field}`, async () => {
    const reference = "abcdefgh";
    const shingles = await passageShingles(reference, fingerprintKey, labels);
    assert.equal(shingles.length, 5);
    const textFacts = [fact({ digests: [await coreDigest(reference)], shingles, keyId: fingerprintKey.id }, "full")];
    const input = { ...manualRead, textFacts, fingerprintKey };
    assert.deepEqual(await documentCardVisible({ ...input, card: { ...manualCard, [field]: "abcdef unrelated" } }), withheld);
    assert.deepEqual(await documentCardVisible({ ...input, card: { ...manualCard, [field]: "abcde unrelated" } }), visible);
  });
}

test("an absent stored title leaves the body subject to text withholding", async () => {
  const input = { ...manualRead, card: { ...manualCard, title: null } };
  assert.deepEqual(await documentCardVisible(input), visible);
  const textFacts = [await exactFact(manualCard.body)];
  assert.deepEqual(await documentCardVisible({ ...input, textFacts }), withheld);
});

test("an import needs both current linked revisions and unwithheld text", async () => {
  const textFacts = [await exactFact(card.body)];
  assert.deepEqual(await documentCardVisible({ ...read, textFacts }), withheld);
  const staleStates = new Map(memoryStates).set("second", { status: "visible", revision: 2, correctedRevisions: [] });
  assert.deepEqual(await documentCardVisible({ ...read, memoryStates: staleStates }),
    { visible: false, reason: "source_memory_not_visible" });
});

test("unknown or malformed text facts fail closed", async () => {
  const unrelated = await exactFact("Different notes");
  for (const textFacts of [
    undefined, null, {}, Array(1), [null], [{ ...unrelated, kind: "unknown" }],
    [{ ...unrelated, mode: "unknown" }], [{ ...unrelated, text: { digests: [] } }],
    [{ ...unrelated, actionId: null }], [{ ...unrelated, namespace: "another-project" }],
  ]) {
    assert.equal((await documentCardVisible({ ...manualRead, textFacts })).visible, false);
  }
});

test("a missing or rotated key withholds a card when fact evidence needs that key", async () => {
  const reference = "abcdefgh";
  for (const keyedFact of [
    await exactFact(reference, fingerprintKey),
    fact({ digests: [await coreDigest(reference)], keyId: fingerprintKey.id,
      shingles: await passageShingles(reference, fingerprintKey, labels) }, "full"),
  ]) {
    const input = { ...manualRead, textFacts: [keyedFact] };
    for (const key of [undefined, null, otherKey]) {
      assert.deepEqual(await documentCardVisible({ ...input, fingerprintKey: key }), withheld);
    }
    assert.deepEqual(await documentCardVisible({ ...input, fingerprintKey }), visible);
  }
});

test("a legacy MAC-only fact without comparable core evidence fails closed", async () => {
  const digest = {
    alg: "hmac", value: await legacyExactMac(manualCard.body, fingerprintKey, labels),
    pipeline: "hosted-v1", redactionVersion: 1, keyId: fingerprintKey.id,
  };
  assert.deepEqual(await documentCardVisible({
    ...manualRead, textFacts: [fact({ digests: [digest] })], fingerprintKey,
  }), withheld);
});

test("import and manual cards require each linked revision to be present, current and visible", async () => {
  const manualRead = { ...read, card: { ...card, origin: "manual" } };
  assert.deepEqual(await documentCardVisible(manualRead), { visible: true, reason: null });
  for (const [state, reason] of [
    [undefined, "source_memory_missing"],
    [{ status: "forgotten" }, "source_memory_forgotten"],
    [{ status: "historical", revision: 1, correctedRevisions: [] }, "source_memory_not_visible"],
    [{ status: "visible", revision: 2, correctedRevisions: [] }, "source_memory_not_visible"],
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

test("router cards use Raw text withholding in place of authored card facts", async () => {
  const fact = await exactFact(content);
  const sourceWithheld = documentCardSourceWithheld({
    sourceLengthUtf16: content.length, sourceExcluded: false,
    rawRows: [{ type: "raw", scope, sessionKeyHash: "a".repeat(64), messageKey: "message-key",
      startUtf16: 0, endUtf16: content.length, digests: fact.text.digests }],
    facts: [{ fact, factId: "fact", incarnation: "incarnation", epoch: 1n, createdAtMs: 100 }],
  });
  assert.equal(sourceWithheld, true);
  const input = { ...messageRead, card: { ...legacyCard, origin: "router", title: content, body: content }, textFacts: [fact] };
  assert.deepEqual(await documentCardVisible({ ...input, sourceWithheld: false }), visible);
  assert.deepEqual(await documentCardVisible({ ...input, textFacts: null, sourceWithheld: false }), visible);
  assert.deepEqual(await documentCardVisible({ ...input, sourceWithheld }), { visible: false, reason: "source_withheld" });
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

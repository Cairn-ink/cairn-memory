import assert from "node:assert/strict";
import { test } from "node:test";
import { assertAdapterCapabilities, capabilities, OPTIONAL_PORTS } from "@cairn-ink/core";
import {
  buildDocumentCard, documentCardSourceWithheld, documentCardStaleness, documentCardVisible,
  resolveStaleReplacement,
} from "@cairn-ink/core/routing";

const scope = { owner: "owner", namespace: "project" };
const sourceMessage = { client: "client", sessionId: "session", messageId: "message" };
const canonicalSessionKey = "canonical";
const { card: built } = await buildDocumentCard(
  { id: sourceMessage.messageId, content: "Garden guide", role: "user" },
  { scope, client: sourceMessage.client, canonicalSessionKey },
);
assert.ok(built);
const card = {
  ...built, scope, sourceMessage, canonicalSessionKey, stale: [],
  sourceMemories: [{ id: "source", revision: 2 }],
};
const visible = (revision, content = "Current guidance", date = null) => ({ status: "visible", revision, correctedRevisions: [], content, date });
const historical = { status: "historical", revision: 1, correctedRevisions: [] };
const memoryStates = new Map([["source", visible(2)]]);
const read = { card, requestedScope: { ...scope }, memoryStates, sourceWithheld: false };

test("the fence accepts an exact scope, canonical ID, and fully visible sources", async () => {
  assert.deepEqual(await documentCardVisible(read), { visible: true, reason: null });
  assert.deepEqual(await documentCardVisible({ ...read, card: { ...card, sourceMemories: [] } }),
    { visible: true, reason: null });
});

test("the fence detects mispartitioned list or get results and a relabeled card", async () => {
  for (const requestedScope of [{ ...scope, owner: "other" }, { ...scope, namespace: "other" }]) {
    assert.deepEqual(await documentCardVisible({ ...read, requestedScope }), { visible: false, reason: "scope_mismatch" });
    const relabeled = { ...card, scope: requestedScope, sourceMemories: [] };
    assert.deepEqual(await documentCardVisible({ ...read, card: relabeled, requestedScope }),
      { visible: false, reason: "id_mismatch" });
  }
  for (const changes of [
    { id: "different-card" },
    { canonicalSessionKey: sourceMessage.sessionId },
    { sourceMessage: { ...sourceMessage, messageId: "different-message" } },
    { sourceMessage: { ...sourceMessage, client: "different-client" } },
  ]) {
    assert.deepEqual(await documentCardVisible({ ...read, card: { ...card, ...changes } }),
      { visible: false, reason: "id_mismatch" });
  }
});

test("every linked memory must be known and currently visible", async () => {
  const linked = { ...card, sourceMemories: [...card.sourceMemories, { id: "second", revision: 1 }] };
  for (const [state, reason] of [
    [undefined, "source_memory_missing"],
    [{ status: "forgotten" }, "source_memory_forgotten"],
    [{ status: "suppressed" }, "source_memory_not_visible"],
    [{ status: "unknown" }, "source_memory_not_visible"],
  ]) {
    const states = new Map(memoryStates);
    if (state) states.set("second", state);
    assert.deepEqual(await documentCardVisible({ ...read, card: linked, memoryStates: states }), { visible: false, reason });
  }
});

test("Raw exclusions hide a card without source memories and absent evidence fails closed", async () => {
  assert.deepEqual(await documentCardVisible({
    ...read, card: { ...card, sourceMemories: [] }, sourceWithheld: true,
  }), { visible: false, reason: "source_withheld" });
  for (const partial of [
    { sourceWithheld: null },
    { sourceWithheld: undefined },
    { requestedScope: { owner: scope.owner } },
    { card: { ...card, canonicalSessionKey: null } },
    { card: { ...card, sourceMessage: { ...sourceMessage, sessionId: undefined } } },
    { card: { ...card, sourceMemories: undefined } },
    { card: { ...card, sourceMemories: [,] } },
    { memoryStates: undefined },
    { card: { ...card, sourceMemories: [] }, memoryStates: {} },
    { memoryStates: new Map([["source", { status: "visible" }]]) },
  ]) {
    assert.deepEqual(await documentCardVisible({ ...read, ...partial }), { visible: false, reason: "uncertain" });
  }
});

test("staleness uses live revisions even when there is no stale entry", async () => {
  assert.equal(documentCardStaleness({ card, memoryStates }), false);
  const states = new Map([["source", visible(3)]]);
  assert.equal(documentCardStaleness({ card, memoryStates: states }), true);
  assert.deepEqual(await documentCardVisible({ ...read, memoryStates: states }), { visible: true, reason: null });
  assert.equal(documentCardStaleness({ card, memoryStates: new Map() }), true);
  assert.equal(documentCardStaleness({ card: { ...card, stale: [{ memoryId: "source", replacementMemoryId: "next" }] }, memoryStates }),
    true);
});

test("replacement resolution reads a correction and follows two supersession edges", () => {
  const states = new Map([["next", visible(3, "Corrected guidance", 100)]]);
  const successorOf = new Map();
  const input = { replacementMemoryId: "next", memoryStates: states, successorOf };
  assert.deepEqual(resolveStaleReplacement(input),
    { memoryId: "next", revision: 3, content: "Corrected guidance", date: 100 });
  states.set("next", { ...historical, content: "Old guidance" });
  states.set("second", { ...historical, content: "Other old guidance" });
  states.set("third", visible(5, "Latest guidance"));
  successorOf.set("next", "second");
  successorOf.set("second", "third");
  assert.deepEqual(resolveStaleReplacement(input),
    { memoryId: "third", revision: 5, content: "Latest guidance", date: null });
});

test("replacement resolution withholds missing, forgotten, suppressed and uncertain revisions", () => {
  const successorOf = new Map([["next", "second"]]);
  for (const state of [
    undefined, { status: "forgotten" }, { status: "suppressed" }, { status: "unknown" },
    { status: "visible", revision: 2, content: "Missing date" },
  ]) {
    const states = new Map([["next", historical]]);
    if (state) states.set("second", state);
    assert.equal(resolveStaleReplacement({ replacementMemoryId: "next", memoryStates: states, successorOf }), null);
  }
  const states = new Map([["next", { status: "suppressed" }], ["second", visible(2)]]);
  assert.equal(resolveStaleReplacement({ replacementMemoryId: "next", memoryStates: states, successorOf }), null);
  states.set("next", visible(1));
  assert.equal(resolveStaleReplacement({ replacementMemoryId: "next", memoryStates: states, successorOf }), null);
  states.set("next", historical);
  states.set("second", historical);
  successorOf.set("second", "next");
  assert.equal(resolveStaleReplacement({ replacementMemoryId: "next", memoryStates: states, successorOf }), null);
});

const storedFact = (fields) => ({
  fact: { ...scope, actionId: "action", origin: "forget", ...fields },
  factId: "fact", incarnation: "incarnation", epoch: 1n, createdAtMs: 100,
});
const sessionKeyHash = "a".repeat(64);
const digest = (value) => ({ alg: "sha256", value, pipeline: "core", redactionVersion: 1, keyId: null });
const matchingDigest = digest("b".repeat(64));
const rawRow = {
  type: "raw", scope, sessionKeyHash, messageKey: "message-key", startUtf16: 0, endUtf16: 4,
  source: { client: sourceMessage.client, sessionId: sourceMessage.sessionId, occurredAtMs: 100 },
  digests: [digest("c".repeat(64))],
};
const rawRows = [
  rawRow,
  { ...rawRow, startUtf16: 4, endUtf16: 8, digests: [matchingDigest] },
];
const raw = { rawRows, sourceExcluded: false, sourceLengthUtf16: 8 };

for (const [name, fact] of [
  ["session", { kind: "session", session: { client: rawRow.source.client, sessionId: rawRow.source.sessionId } }],
  ["window", { kind: "window", client: null, window: { startMs: 100, endMs: 101 } }],
  ["text", { kind: "text", mode: "exact", text: { digests: [matchingDigest] } }],
  ["span", { kind: "rawSpan", sessionKeyHash, messageKey: rawRow.messageKey, startUtf16: 7, endUtf16: 8, contentDigest: matchingDigest.value }],
]) {
  test(`a Raw ${name} match withholds the whole card, including cards without linked memories`, async () => {
    const sourceWithheld = documentCardSourceWithheld({ ...raw, facts: [storedFact(fact)] });
    assert.equal(sourceWithheld, true);
    assert.deepEqual(await documentCardVisible({ ...read, card: { ...card, sourceMemories: [] }, sourceWithheld }),
      { visible: false, reason: "source_withheld" });
    assert.equal(documentCardSourceWithheld({ ...raw, facts: [storedFact({ ...fact, namespace: "other" })] }), false);
  });
}

test("Raw identity facts rely on the host's identity-derived exclusion verdict", () => {
  const facts = [storedFact({ kind: "identity", memoryId: "source" })];
  assert.equal(documentCardSourceWithheld({ ...raw, facts }), false);
  assert.equal(documentCardSourceWithheld({ ...raw, facts, sourceExcluded: true }), true);
  assert.equal(documentCardSourceWithheld({ ...raw, facts, sourceExcluded: null }), true);
});

test("Raw comparison uncertainty withholds, while complete nonmatching evidence permits", () => {
  const facts = [storedFact({ kind: "session", session: { client: rawRow.source.client, sessionKeyHash } })];
  assert.equal(documentCardSourceWithheld({ ...raw, facts }), true);
  assert.equal(documentCardSourceWithheld({ ...raw, facts, policy: { hashSessionKey: () => "0".repeat(64) } }), false);
  assert.equal(documentCardSourceWithheld({ ...raw, facts: [] }), false);
  assert.equal(documentCardSourceWithheld({ ...raw, facts: null }), true);
  assert.equal(documentCardSourceWithheld({ ...raw, facts: [null] }), true);
  assert.equal(documentCardSourceWithheld({ ...raw, rawRows: [], facts: [] }), true);
  assert.equal(documentCardSourceWithheld({ ...raw, rawRows: [{ ...rawRow, messageKey: undefined }], facts: [] }), true);
});

test("documentCards registers the optional port in both directions", () => {
  const on = capabilities({ documentCards: true });
  const off = capabilities({});
  assert.equal(on.documentCards, true);
  assert.equal(off.documentCards, false);
  assert.equal(OPTIONAL_PORTS.documentCards, "documentCards");
  assert.doesNotThrow(() => assertAdapterCapabilities({ capabilities: on, documentCards: {} }));
  assert.doesNotThrow(() => assertAdapterCapabilities({ capabilities: off }));
  assert.throws(() => assertAdapterCapabilities({ capabilities: on }), /capability_unavailable/);
  assert.throws(() => assertAdapterCapabilities({ capabilities: off, documentCards: {} }), /capability_unavailable/);
});

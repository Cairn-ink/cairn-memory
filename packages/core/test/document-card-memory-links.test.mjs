import assert from "node:assert/strict";
import { test } from "node:test";
import { CoreError } from "@cairn-ink/core";
import * as routing from "@cairn-ink/core/routing";

const { buildDocumentCard, documentCardMemoryLinks, documentCardStaleness, documentCardVisible, resolveStaleReplacement } = routing;

const scope = { owner: "owner", namespace: null };
const sourceMessage = { client: "client", sessionId: "session", messageId: "message" };
const canonicalSessionKey = "canonical";
const { card: built } = await buildDocumentCard(
  { id: sourceMessage.messageId, role: "user", content: "Garden guide" },
  { scope, client: sourceMessage.client, canonicalSessionKey },
);
assert.ok(built);

const sourceMemories = [{ id: "memory", revision: 2 }];
const card = { ...built, origin: "router", scope, sourceMessage, canonicalSessionKey, sourceMemories, stale: [] };
const read = { card, requestedScope: scope, sourceWithheld: false };
const visible = { visible: true, reason: null };
const hidden = (reason) => ({ visible: false, reason });
const receipt = { ...sourceMessage, role: "user", occurredAtMs: null };
const memory = (id, revision, ...receipts) => ({ id, revision, receipts });

test("historical memory leaves a message-backed card visible and stale", async () => {
  const memoryStates = new Map([["memory", { status: "historical", revision: 2, correctedRevisions: [] }]]);
  for (const origin of ["router", undefined]) {
    const input = { ...read, card: { ...card, origin }, memoryStates };
    assert.equal(documentCardStaleness(input), true);
    assert.deepEqual(await documentCardVisible(input), visible);
  }
});

test("receipt matching requires the same client, session and message and ignores the role", () => {
  const memories = [
    memory("different-client", 1, { ...receipt, client: "other" }),
    memory("different-session", 1, { ...receipt, sessionId: "other" }),
    memory("different-message", 1, { ...receipt, messageId: "other" }),
    memory("no-receipts", 1),
    memory("user", 2, receipt),
    memory("assistant", 3, { ...receipt, messageId: "other" }, { ...receipt, role: "assistant" }),
  ];
  assert.deepEqual(documentCardMemoryLinks(sourceMessage, memories), [
    { id: "assistant", revision: 3 },
    { id: "user", revision: 2 },
  ]);
  assert.deepEqual(documentCardMemoryLinks(sourceMessage, []), []);
});

test("links keep the highest matching revision per id in UTF-8 byte order", () => {
  const memories = [
    memory("𐀀", 1, receipt),
    memory("key", 2, receipt, receipt),
    memory("\uE000", 0, receipt),
    memory("key", 5, receipt),
    memory("key", 4, receipt),
    memory("key", 6, { ...receipt, messageId: "other" }),
    memory("Z", 3, receipt),
  ];
  assert.deepEqual(documentCardMemoryLinks(sourceMessage, memories), [
    { id: "Z", revision: 3 },
    { id: "key", revision: 5 },
    { id: "\uE000", revision: 0 },
    { id: "𐀀", revision: 1 },
  ]);
});

test("malformed link inputs fail even after a matching receipt", () => {
  const invalid = (source, memories) => assert.throws(() => documentCardMemoryLinks(source, memories),
    (error) => error instanceof CoreError && error.code === "invalid_input");
  invalid(null, []);
  for (const field of ["client", "sessionId", "messageId"]) {
    invalid({ ...sourceMessage, [field]: "" }, []);
    invalid(sourceMessage, [memory("memory", 1, receipt, { ...receipt, [field]: null })]);
  }
  for (const memories of [
    null, {}, Array(1), [null], [memory("", 1, receipt)],
    [memory("memory", -1, receipt)], [memory("memory", 1.5, receipt)],
    [memory("memory", Number.MAX_SAFE_INTEGER + 1, receipt)],
    [{ ...memory("memory", 1), receipts: {} }],
    [{ ...memory("memory", 1), receipts: Array(1) }],
    [memory("memory", 1, receipt, null)],
    [memory("memory", 1, { ...receipt, messageId: "other", role: "unknown" })],
    [memory("memory", 1, { ...receipt, occurredAtMs: "yesterday" })],
  ]) {
    invalid(sourceMessage, memories);
  }
});

test("message-backed cards stay visible at any current revision", async () => {
  for (const origin of ["router", undefined]) {
    for (const revision of [1, 2, 3]) {
      const memoryStates = new Map([["memory", { status: "visible", revision, correctedRevisions: [] }]]);
      const input = { ...read, card: { ...card, origin }, memoryStates };
      assert.deepEqual(await documentCardVisible(input), visible);
      assert.equal(documentCardStaleness(input), revision !== 2);
    }
  }
});

test("a correction keeps the linked card visible with a stale entry and a current replacement", async () => {
  const stale = [{ memoryId: "memory", replacementMemoryId: "replacement" }];
  const linked = { ...card, sourceMemories: documentCardMemoryLinks(sourceMessage, [memory("memory", 2, receipt)]), stale };
  const memoryStates = new Map([
    ["memory", { status: "historical", revision: 2, correctedRevisions: [] }],
    ["replacement", { status: "visible", revision: 1, correctedRevisions: [], content: "Corrected guide", date: null }],
  ]);
  const input = { ...read, card: linked, memoryStates };
  assert.deepEqual(await documentCardVisible(input), visible);
  assert.equal(documentCardStaleness(input), true);
  assert.deepEqual(resolveStaleReplacement({
    replacementMemoryId: linked.stale[0].replacementMemoryId,
    memoryStates,
    successorOf: new Map([["memory", "replacement"]]),
  }), { memoryId: "replacement", revision: 1, content: "Corrected guide", date: null });
});

test("forgetting hides a message-backed card even when another link is historical", async () => {
  const linked = { ...card, sourceMemories: [...sourceMemories, { id: "second", revision: 1 }] };
  const memoryStates = new Map([
    ["memory", { status: "historical", revision: 2, correctedRevisions: [] }],
    ["second", { status: "forgotten" }],
  ]);
  for (const origin of ["router", undefined]) {
    assert.deepEqual(await documentCardVisible({ ...read, card: { ...linked, origin }, memoryStates }),
      hidden("source_memory_forgotten"));
  }
});

test("missing, suppressed, unknown and malformed states hide message-backed cards", async () => {
  for (const [states, reason] of [
    [[], "source_memory_missing"],
    [[{ status: "suppressed" }], "source_memory_not_visible"],
    [[{ status: "unknown" }], "source_memory_not_visible"],
    [[{ status: "unexpected" }], "uncertain"],
    [[null], "uncertain"],
    [[{ status: "visible" }], "uncertain"],
    [[{ status: "historical", revision: -1 }], "uncertain"],
  ]) {
    const memoryStates = new Map(states.map(state => ["memory", state]));
    for (const origin of ["router", undefined]) {
      assert.deepEqual(await documentCardVisible({ ...read, card: { ...card, origin }, memoryStates }),
        hidden(reason));
    }
  }
});

test("import and manual cards still require each linked memory to be visible at its recorded revision", async () => {
  for (const origin of ["import", "manual"]) {
    const authored = { ...card, id: "authored", origin, sourceMessage: null };
    for (const [state, expected] of [
      [{ status: "visible", revision: 2, correctedRevisions: [] }, visible],
      [{ status: "visible", revision: 3, correctedRevisions: [] }, hidden("source_memory_not_visible")],
      [{ status: "historical", revision: 2, correctedRevisions: [] }, hidden("source_memory_not_visible")],
      [{ status: "suppressed" }, hidden("source_memory_not_visible")],
      [{ status: "forgotten" }, hidden("source_memory_forgotten")],
      [undefined, hidden("source_memory_missing")],
      [{ status: "unknown" }, hidden("source_memory_not_visible")],
    ]) {
      const memoryStates = state === undefined ? new Map() : new Map([["memory", state]]);
      assert.deepEqual(await documentCardVisible({ ...read, card: authored, memoryStates, textFacts: [] }), expected);
    }
  }
});

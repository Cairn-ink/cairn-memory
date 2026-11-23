import assert from "node:assert/strict";
import { test } from "node:test";
import { createMemoryAdapter } from "@cairn-ink/adapter-memory";
import { TOPIC_CARD_CASES, runCase } from "@cairn-ink/conformance";
import { coreDigest, placePendingCards } from "@cairn-ink/core";
import { buildDocumentCard } from "@cairn-ink/core/routing";

const factory = {
  name: "memory cards in topics",
  async open({ capabilities }) {
    const adapter = createMemoryAdapter({ capabilities });
    return {
      adapter, sessionRefs: "plain", harness: adapter.harness, nativeErrorMap: adapter.nativeErrorMap,
      busyNativeCodes: [], embeddingDimensions: null,
      async close() {},
    };
  },
};

for (const testCase of TOPIC_CARD_CASES) {
  test(testCase.id + " " + testCase.title, async () => {
    assert.equal(await runCase(factory, testCase), null);
  });
}

const scope = { owner: "owner", namespace: null };
const page = { cursor: null, limit: 10 };
const sourceMessage = { client: "client", sessionId: "session", messageId: "message" };
const selection = { owner: scope.owner, namespaces: [scope.namespace] };
const imported = (id) => ({
  id, scope, origin: "import", title: "Imported note", body: "Imported content", contentHash: "hash-" + id,
  date: null, sourceMessage: null, sourceMemories: [], sentences: [], stale: [],
});

async function routed(canonicalSessionKey = sourceMessage.sessionId) {
  const { card } = await buildDocumentCard({
    id: sourceMessage.messageId, role: "user", content: "Document title\n\nMessage body.", occurredAtMs: 10,
  }, { scope, client: sourceMessage.client, canonicalSessionKey });
  assert.ok(card);
  return {
    id: card.id, scope, origin: "router", title: card.title, body: card.body, contentHash: "router-hash",
    date: card.date, sourceMessage, sourceMemories: [], sentences: [], stale: [],
  };
}

test("documentCards is opt-in, including dump state and card fence refs", async () => {
  const adapter = createMemoryAdapter({ capabilities: { placement: true } });
  assert.equal(adapter.documentCards, undefined);
  await adapter.uow.run(scope.owner, { pauseLock: true }, async (tx) => {
    await adapter.memories.insert(tx, scope, {
      kind: "fact", origin: "explicit", text: "Memory", textHash: "sha256:" + "a".repeat(64),
      confidence: 1, embedding: null, source: { kind: "mcp", client: null, sessionId: null },
    }, [], 1);
  });
  assert.equal(Object.hasOwn((await adapter.harness.dump())[0], "documentCards"), false);
  await adapter.uow.run(scope.owner, { readOnly: true }, async (tx) => {
    assert.deepEqual(await adapter.placement.pendingCards(tx, scope, { limit: 5 }), []);
    assert.deepEqual(await adapter.fence.assertVisible(tx, selection, [{ type: "card", id: "card", namespace: null }]), []);
  });
});

test("card writes preserve origin, isolate stored records, and advance the index only on writes", async () => {
  const { uow, placement, documentCards, harness } = createMemoryAdapter({
    capabilities: { placement: true, documentCards: true },
  });
  const revision = () => uow.run(scope.owner, { readOnly: true }, async (tx) =>
    (await placement.catalog(tx, scope, page)).indexRevision);
  const record = imported("first");
  const start = await revision();
  await uow.run(scope.owner, {}, async (tx) => {
    assert.equal((await documentCards.put(tx, scope, record)).status, "inserted");
    assert.equal((await documentCards.put(tx, scope, imported("second"))).status, "inserted");
    assert.equal((await documentCards.put(tx, scope, { ...record, body: "Ignored" })).status, "unchanged");
  });
  assert.equal(await revision(), start + 2);
  await uow.run(scope.owner, {}, async (tx) => {
    assert.equal((await documentCards.put(tx, scope, { ...record, origin: "manual", contentHash: "next" })).status, "replaced");
    await documentCards.markStale(tx, scope, record.id, { memoryId: "old", replacementMemoryId: "next" });
    const stored = await documentCards.get(tx, scope, record.id);
    assert.equal(stored.origin, "import");
    assert.deepEqual(stored.stale, [{ memoryId: "old", replacementMemoryId: "next" }]);
    stored.body = "Do not persist";
    assert.equal((await documentCards.list(tx, scope)).find(({ id }) => id === record.id).body, record.body);
    await documentCards.hide(tx, scope, record.id, "forget");
    await documentCards.hide(tx, scope, record.id, "forget");
  });
  assert.equal(await revision(), start + 5);
  assert.ok(Object.hasOwn((await harness.dump())[0], "documentCards"));
});

test("router fence uses the capture session hash resolver and rejects a forged ID", async () => {
  const sessionHash = "a".repeat(64);
  const hashSessionKey = (client, id) => client === "client" && id === "session" ? sessionHash : null;
  const adapter = createMemoryAdapter({ capabilities: { documentCards: true }, sessionRefs: "hashed", hashSessionKey });
  const { uow, fence, harness, documentCards } = adapter;
  const card = await routed(sessionHash);
  const ref = { type: "card", id: card.id, namespace: null };
  const forged = { ...ref, id: "forged" };
  await uow.run(scope.owner, {}, async (tx) => {
    await documentCards.put(tx, scope, card);
    await documentCards.put(tx, scope, { ...card, id: forged.id });
  });
  const visible = () => uow.run(scope.owner, { readOnly: true }, (tx) => fence.assertVisible(tx, selection, [ref, forged]));
  assert.deepEqual(await visible(), [ref]);
  const fact = { ...scope, kind: "session", origin: "forget", actionId: "forget-session",
    session: { client: sourceMessage.client, sessionKeyHash: sessionHash } };
  await harness.seedFact(scope.owner, fact);
  const blocked = await uow.run(scope.owner, { readOnly: true }, (tx) =>
    adapter.suppressions.snapshot(tx, scope, sourceMessage));
  assert.equal(blocked.blockedSession, true);
  assert.deepEqual(await visible(), []);
});

for (const kind of ["window", "text"]) {
  test("router card without memory links is withheld by a " + kind + " fact", async () => {
    const { uow, fence, harness, documentCards, placement } = createMemoryAdapter({
      capabilities: { documentCards: true, placement: true },
    });
    const card = await routed();
    const ref = { type: "card", id: card.id, namespace: null };
    const visible = () => uow.run(scope.owner, { readOnly: true }, (tx) => fence.assertVisible(tx, selection, [ref]));
    await uow.run(scope.owner, {}, (tx) => documentCards.put(tx, scope, card));
    assert.deepEqual(await visible(), [ref]);
    const fact = kind === "window"
      ? { kind, client: sourceMessage.client, window: { startMs: 10, endMs: 11 } }
      : { kind, mode: "exact", text: { digests: [await coreDigest(card.body)] } };
    await harness.seedFact(scope.owner, { ...scope, ...fact, origin: "forget", actionId: "forget-source" });
    assert.deepEqual(await visible(), []);
    const model = { contextWindow: 8192, countTokens: () => 1, async call() { assert.fail("Withheld text reached the model"); } };
    assert.deepEqual(await placePendingCards({
      uow, scope, fence, placement, documentCards, model, gate: { async assertOpen() {} },
    }), { status: "idle" });
    assert.deepEqual(await uow.run(scope.owner, { readOnly: true },
      (tx) => placement.pendingCards(tx, scope, { limit: 5 })), []);
  });
}

test("card failure writes use a snapshot of the caller's array", async () => {
  const { uow, placement, documentCards } = createMemoryAdapter({
    capabilities: { placement: true, documentCards: true },
  });
  await uow.run(scope.owner, {}, async (tx) => {
    await documentCards.put(tx, scope, imported("first"));
    await documentCards.put(tx, scope, imported("second"));
  });
  await uow.run(scope.owner, {}, async (tx) => {
    const ids = ["first"];
    ids[Symbol.iterator] = function* () { yield "second"; };
    await placement.markCardsFailed(tx, scope, ids, "source_excluded");
    const pending = await placement.pendingCards(tx, scope, { limit: 5 });
    assert.deepEqual(pending.map(({ cardId }) => cardId), ["second"]);
    await assert.rejects(placement.markCardsFailed(tx, scope, [null], "source_excluded"), { code: "invalid_input" });
  });
});

test("placement sends five oldest cards without mixing in pending memories or creating topics", async () => {
  let now = 1;
  const { uow, placement, documentCards, fence, memories } = createMemoryAdapter({
    capabilities: { placement: true, documentCards: true }, now: () => now,
  });
  await uow.run(scope.owner, { pauseLock: true }, (tx) => memories.insert(tx, scope, {
    kind: "fact", origin: "explicit", text: "Pending memory", textHash: "sha256:" + "a".repeat(64),
    confidence: 1, embedding: null, source: { kind: "mcp", client: null, sessionId: null },
  }, [], now));
  for (const id of ["f", "e", "d", "c", "b", "a"]) {
    now++;
    await uow.run(scope.owner, {}, (tx) => documentCards.put(tx, scope, { ...imported(id), title: id }));
  }
  const model = {
    contextWindow: 8192, countTokens: () => 1,
    async call(_stage, { input }) {
      assert.equal(input.mapExhausted, false);
      assert.deepEqual(input.memories.map(({ content }) => content), ["f", "e", "d", "c", "b"]
        .map((id) => id + "\n\nImported content"));
      return { items: input.memories.map(({ id: memoryId }) => ({
        memoryId, parentIds: [], newL1: { title: "Never created", parentL2Ids: [] },
      })) };
    },
  };
  const { status, placed } = await placePendingCards({
    uow, scope, placement, documentCards, fence, model, gate: { async assertOpen() {} },
  });
  assert.equal(status, "applied");
  assert.deepEqual(placed, ["f", "e", "d", "c", "b"].map((cardId) => ({ cardId, topicIds: [] })));
  await uow.run(scope.owner, { readOnly: true }, async (tx) => {
    assert.deepEqual((await placement.pendingCards(tx, scope, { limit: 5 })).map(({ cardId }) => cardId), ["a"]);
    assert.equal((await placement.pending(tx, scope, { limit: 5 })).length, 1);
    assert.deepEqual((await placement.catalog(tx, scope, page)).items, []);
  });
});

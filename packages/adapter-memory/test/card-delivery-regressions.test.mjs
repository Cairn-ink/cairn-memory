import assert from "node:assert/strict";
import { test } from "node:test";
import { createMemoryAdapter } from "@cairn-ink/adapter-memory";
import { coreDigest } from "@cairn-ink/core";
import { buildDocumentCard, documentCardVisible } from "@cairn-ink/core/routing";
import { createMemoryService } from "@cairn-ink/core/service";

const scope = { owner: "owner", namespace: null };
const selection = { owner: scope.owner, namespaces: [scope.namespace] };
const ref = id => ({ type: "card", id, namespace: scope.namespace });

function fixture(capabilities = {}) {
  const storage = createMemoryAdapter({
    documentCardSearch: true,
    capabilities: { documentCards: true, ...capabilities },
  });
  const unused = () => assert.fail("Card find and read do not require these providers");
  const service = createMemoryService({
    storage,
    model: { model: "test", contextWindow: 1, call: unused, countTokens: unused },
    embedder: null,
    gate: { assertOpen: unused },
    clock: { nowMs: unused, monotonicMs: unused, sha256Hex: unused, hmacHex: unused },
    tokens: { countTokens: unused },
    config: {},
  });
  const read = fn => storage.uow.run(scope.owner, { readOnly: true }, fn);
  const write = fn => storage.uow.run(scope.owner, { pauseLock: true }, fn);
  const put = card => write(tx => storage.documentCards.put(tx, scope, card));
  const find = query => service.find(scope, query, { kinds: ["card"] });
  return { storage, service, read, write, put, find };
}

function manual(id, fields = {}) {
  return { id, scope, origin: "manual", body: "Cabinet inventory", date: 12, contentHash: id,
    sourceMessage: null, sourceMemories: [], sentences: [], stale: [], ...fields };
}

for (const [name, archived, replay] of [
  ["conflicting replay of an empty message", "", "Cabinet inventory"],
  ["conflicting replay of a nonempty message", "Lantern inventory", "Cabinet inventory"],
  ["source with no extent", "", null],
  ["missing source", null, null],
]) {
  test(`card delivery withholds a ${name}`, async () => {
    const { storage, service, read, write, put, find } = fixture({ rawArchive: true });
    const sourceMessage = { client: "client", sessionId: "session", messageId: "message" };
    const capture = { scope, client: sourceMessage.client, sessionId: sourceMessage.sessionId,
      eventId: "event", payloadDigest: "a".repeat(64) };
    const message = { id: sourceMessage.messageId, role: "user", content: replay ?? "Cabinet inventory", occurredAtMs: 12 };
    const archive = content => write(tx => storage.raw.archive(tx, capture, [{ ...message, content }]));
    if (archived !== null) assert.deepEqual(await archive(archived), { archived: 1 });
    if (replay !== null) assert.deepEqual(await archive(replay), { archived: 0 });

    const { card } = await buildDocumentCard(message,
      { scope, client: sourceMessage.client, canonicalSessionKey: sourceMessage.sessionId });
    await put(manual(card.id, { origin: "router", title: card.title, body: card.body, sourceMessage }));

    const result = await find("cabinet");
    assert.deepEqual(result.cards, []);
    assert.deepEqual(result.layers.card, { status: "ok", count: 0 });
    assert.deepEqual(await service.readCard(scope, card.id), { status: "not_found" });
    assert.deepEqual(await read(tx => storage.fence.assertVisible(tx, selection, [ref(card.id)])), []);
    const [input] = await read(tx => storage.documentCards.visibilityInputs(tx, scope, [ref(card.id)]));
    assert.equal(input.sourceWithheld, true);
  });
}

test("card visibility inputs keep the fingerprint key across a rotation within a transaction", async () => {
  const { storage, read, put } = fixture({ fingerprintKey: true });
  const card = manual("authored", { title: "Inventory" });
  await put(card);
  const original = await storage.keys.userKey(scope.owner);
  const digest = await coreDigest("An unrelated passage", original);
  await storage.harness.seedFact(scope.owner, {
    ...scope, kind: "text", mode: "exact", origin: "forget", actionId: "withhold",
    text: { digests: [digest] },
  });
  const input = async tx => (await storage.documentCards.visibilityInputs(tx, scope, [ref(card.id)]))[0];

  await read(async tx => {
    const before = await input(tx);
    assert.equal(before.fingerprintKey.id, original.id);
    assert.equal((await documentCardVisible(before)).visible, true);
    await storage.harness.setFingerprintSecret("rotated-fixture-key");
    const after = await input(tx);
    assert.equal((await documentCardVisible(after)).visible, true);
    assert.equal(after.fingerprintKey.id, original.id);
  });
  const next = await read(input);
  assert.notEqual(next.fingerprintKey.id, original.id);
  assert.deepEqual(await documentCardVisible(next), { visible: false, reason: "text_withheld" });
});

test("card find and read deliver an authored card with an absent title as null", async () => {
  const { service, put, find } = fixture();
  const { id, date, body } = manual("untitled");
  await put(manual(id));
  assert.deepEqual((await find("cabinet")).cards, [
    { type: "card", id, title: null, date, excerpt: body, truncated: false },
  ]);
  assert.deepEqual(await service.readCard(scope, id), { status: "found", card: {
    id, title: null, body, date, origin: "manual", sourceClient: null, sourceMemoryIds: [],
  } });
});

test("the legacy read rejects a card ref even when the card store can read it", async () => {
  const { service, put } = fixture();
  const card = manual("authored", { title: "Inventory" });
  await put(card);
  await assert.rejects(service.read(scope, { type: "card", id: card.id }), { code: "capability_unavailable" });
});

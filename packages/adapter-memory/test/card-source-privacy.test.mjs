import assert from "node:assert/strict";
import { test } from "node:test";
import { createMemoryAdapter } from "@cairn-ink/adapter-memory";
import { coreDigest, withholdsAnyPassage } from "@cairn-ink/core";
import { buildDocumentCard } from "@cairn-ink/core/routing";
import { createMemoryService } from "@cairn-ink/core/service";
import { fingerprintMemoryPassages } from "../../core/src/privacy/fingerprint.mjs";

const scope = { owner: "owner", namespace: "project" };
const message = { id: "turn", role: "user", content: "Cabinet inventory", occurredAtMs: 12 };
const captureKey = (scope, sessionId) => ({ scope, client: "client", sessionId,
  eventId: `batch-${sessionId}`, payloadDigest: "a".repeat(64) });
const receipt = ({ client, sessionId }) => ({ client, sessionId, messageId: message.id,
  role: message.role, occurredAtMs: message.occurredAtMs });

function fixture(capabilities = {}) {
  const storage = createMemoryAdapter({ documentCardSearch: true, capabilities: {
    documentCards: true, rawArchive: true, ...capabilities,
  } });
  const unused = () => assert.fail("Card find and read do not require these providers");
  const service = createMemoryService({ storage, embedder: null, config: {},
    model: { model: "test", contextWindow: 1, call: unused, countTokens: unused },
    gate: { assertOpen: unused }, tokens: { countTokens: unused },
    clock: { nowMs: unused, monotonicMs: unused, sha256Hex: unused, hmacHex: unused },
  });
  const write = fn => storage.uow.run(scope.owner, { pauseLock: true }, fn);
  return { storage, write, service };
}

async function putRouter({ storage, write }, key, fields = {}) {
  const { scope, client, sessionId } = key;
  const { card } = await buildDocumentCard(message, { scope, client, canonicalSessionKey: sessionId });
  assert.ok(card);
  const inserted = await write(tx => storage.documentCards.put(tx, scope, {
    id: card.id, scope, origin: "router", title: card.title, body: card.body, date: card.date,
    contentHash: card.id, sourceMessage: { client, sessionId, messageId: message.id },
    sourceMemories: [], sentences: [], stale: [], ...fields,
  }));
  assert.equal(inserted.status, "inserted");
  return card.id;
}

async function assertDelivery(service, scope, id, visible) {
  const found = await service.find(scope, "cabinet", { kinds: ["card"] });
  const read = await service.readCard(scope, id);
  assert.equal(found.layers.card.status, "ok");
  assert.deepEqual({ search: found.cards.some(card => card.id === id), read: read.status },
    { search: visible, read: visible ? "found" : "not_found" });
}

test("a fork card is withheld when the inherited Raw session is fenced", async () => {
  const f = fixture();
  const { storage, write, service } = f;
  const original = captureKey(scope, "original");
  const fork = captureKey({ ...scope, namespace: "project\0fork" }, "fork");
  await write(async tx => {
    for (const key of [original, fork]) {
      assert.deepEqual(await storage.raw.archive(tx, key, [message]), { archived: 1 });
      await storage.raw.recordLineage(tx, key, [message]);
    }
  });
  const id = await putRouter(f, fork);
  await assertDelivery(service, fork.scope, id, true);

  await write(tx => storage.raw.fenceSession(tx, scope, original));
  await assertDelivery(service, fork.scope, id, false);
});

async function captureWithReceipt({ storage, write }, key) {
  assert.deepEqual(await write(tx => storage.raw.archive(tx, key, [message])), { archived: 1 });
  assert.equal((await write(tx => storage.capture.admit(tx, key, [message]))).status, "admitted");
  const claim = await write(tx => storage.capture.claim(tx, key, [message], { leaseMs: 10_000 }));
  assert.equal(claim.status, "claimed");
  await write(tx => storage.capture.beginDispatch(tx, claim.token));
  const textHash = `sha256:${(await coreDigest(message.content)).value}`;
  const result = await write(tx => storage.capture.finish(tx, claim.token, [{ content: message.content,
    textHash, kind: "fact", confidence: 1, embedding: null, receipts: [receipt(key)],
  }]));
  assert.equal(result.memories.length, 1);
  return result.memories[0].id;
}

test("a receipt-linked card is withheld when its qualifying memory is forgotten by identity", async () => {
  const f = fixture({ contextRead: true, contextRawRead: true });
  const { storage, service } = f;
  const key = captureKey(scope, "captured");
  const memoryId = await captureWithReceipt(f, key);
  const id = await putRouter(f, key);
  await assertDelivery(service, scope, id, true);

  await storage.harness.seedFact(scope.owner, { ...scope, kind: "identity", origin: "forget",
    actionId: "forget-memory", memoryId });
  await assertDelivery(service, scope, id, false);
});

test("a card is withheld when memory erasure leaves a receipt-address denial", async () => {
  const f = fixture({ contextRead: true });
  const { storage, service, write } = f;
  const key = captureKey(scope, "erased");
  const memoryId = await captureWithReceipt(f, key);
  const id = await putRouter(f, key);
  await assertDelivery(service, scope, id, true);

  assert.equal(await write(tx => storage.memories.erase(tx, scope, memoryId)), true);
  await assertDelivery(service, scope, id, false);
});

test("a card is withheld when a receipt link lacks capture ancestry", async () => {
  const f = fixture({ inspect: true });
  const { storage, service, write } = f;
  const key = captureKey(scope, "unproven");
  assert.deepEqual(await write(tx => storage.raw.archive(tx, key, [message])), { archived: 1 });
  const id = await putRouter(f, key);
  await assertDelivery(service, scope, id, true);

  const textHash = `sha256:${(await coreDigest(message.content)).value}`;
  await write(tx => storage.memories.insert(tx, scope, { text: message.content, textHash, kind: "fact",
    confidence: 1, embedding: null, origin: "explicit", source: { kind: "mcp", client: null, sessionId: null },
  }, [{ ...receipt(key), excerpt: message.content }], 12));
  await assertDelivery(service, scope, id, false);
});

test("full text containment withholds router titles and bodies while unrelated text stays visible", async () => {
  const f = fixture({ fingerprintKey: true });
  const { storage, write, service } = f;
  const passage = "The orchard has a cedar gate and a path lined with rosemary";
  const containing = `Cabinet notes: ${passage} next to the creek.`;
  const fields = [{ body: containing }, { title: containing }, { body: "Cabinet doors use brass hinges." }];
  const ids = [];
  for (const [index, override] of fields.entries()) {
    const key = captureKey(scope, `archive-${index}`);
    assert.deepEqual(await write(tx => storage.raw.archive(tx, key, [message])), { archived: 1 });
    ids.push(await putRouter(f, key, override));
  }
  const authored = { id: "authored", scope, origin: "manual", title: "Inventory", body: containing,
    contentHash: "authored", date: 12, sourceMessage: null, sourceMemories: [], sentences: [], stale: [] };
  await write(tx => storage.documentCards.put(tx, scope, authored));
  for (const id of [...ids, authored.id]) await assertDelivery(service, scope, id, true);

  const fingerprintKey = await storage.keys.userKey(scope.owner);
  assert.ok(fingerprintKey);
  const [text] = await fingerprintMemoryPassages(passage, passage, fingerprintKey);
  const fact = { ...scope, kind: "text", mode: "full", origin: "forget", actionId: "forget-passage", text };
  assert.equal(withholdsAnyPassage(await fingerprintMemoryPassages(containing, containing, fingerprintKey), [fact]), true);
  await storage.harness.seedFact(scope.owner, fact);

  const found = await service.find(scope, "cabinet", { kinds: ["card"] });
  const reads = await Promise.all([...ids, authored.id].map(id => service.readCard(scope, id)));
  assert.equal(found.layers.card.status, "ok");
  assert.deepEqual({ found: found.cards.map(card => card.id), read: reads.map(card => card.status) },
    { found: [ids[2]], read: ["not_found", "not_found", "found", "not_found"] });
});

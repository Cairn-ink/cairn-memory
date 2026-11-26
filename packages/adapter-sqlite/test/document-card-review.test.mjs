import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import { coreDigest } from "@cairn-ink/core";
import { documentCardVisible } from "@cairn-ink/core/routing";
import { captureService, extract, plan } from "../../conformance/src/capture-documents-support.mjs";
import { createSqliteAdapter, openSqliteAdapter } from "../src/adapter.mjs";
import { readCardGeneration } from "../src/document-card-rows.mjs";
import { openStorage } from "../src/schema/open.mjs";
import { scratch, sha256 } from "./storage-fixtures.mjs";

const scope = { owner: "review-owner-a", namespace: null };
const source = { kind: "mcp", client: null, sessionId: null };
const page = { cursor: null, limit: 40 };
const capabilities = { documentCards: true, placement: true, rawArchive: true, inspect: true, rawWindowHide: true };
const now = () => 2000;
const hash = async (text) => "sha256:" + sha256(text);
const ref = (card) => ({ type: "card", namespace: card.scope.namespace, id: card.id });
const read = (adapter, work, target = scope) => adapter.uow.run(target.owner, { readOnly: true }, work);
const write = (adapter, work, target = scope) => adapter.uow.run(target.owner, { pauseLock: true }, work);
const authored = (id, body, target = scope, sourceMemories = []) => ({
  scope: target, id, title: "Synthetic card title", body, contentHash: sha256(body), date: null,
  origin: "manual", sourceMessage: null, sourceMemories, sentences: [], stale: [],
});
const message = (id, content, occurredAtMs = 50) => ({ id, content, occurredAtMs, role: "user" });
const address = (session, message) => ({ ...session, messageId: message.id });

async function store(t) {
  const { path, remove } = scratch();
  const storage = await openStorage(path);
  const adapter = createSqliteAdapter(storage, { capabilities, now });
  t.after(async () => {
    try { await adapter.close(); }
    finally { remove(); }
  });
  return { adapter, storage, path };
}

async function archive(adapter, tx, target, session, message) {
  const key = { ...session, scope: target, eventId: message.id, payloadDigest: sha256(message.content) };
  return adapter.raw.archive(tx, key, [message]);
}

async function insert(adapter, text, target = scope, receipts = []) {
  const digest = await coreDigest(text);
  return write(adapter, tx => adapter.memories.insert(tx, target, {
    kind: "fact", origin: "explicit", text, textHash: "sha256:" + digest.value, digests: [digest],
    confidence: 1, source, embedding: null,
  }, receipts, now()), target);
}

async function topic(adapter, target, label) {
  const { id, revision } = await insert(adapter, "Synthetic topic source " + label, target);
  return write(adapter, async tx => {
    const { indexRevision } = await adapter.placement.catalog(tx, target, page);
    const { createdTopics } = await adapter.placement.applyPlacement(tx, target, {
      indexRevision, memoryRevisions: [{ memoryId: id, revision }],
    }, { items: [{ memoryId: id, parentIds: [], newL1: { title: label, parentL2Ids: [], newL2Title: label + " overview" } }] });
    return createdTopics;
  }, target);
}

async function file(adapter, card, topics) {
  const target = card.scope;
  const l1 = topics.find(({ level }) => level === "L1").id;
  return write(adapter, async tx => {
    const { indexRevision } = await adapter.placement.catalog(tx, target, page);
    return adapter.placement.applyCardPlacement(tx, target, { indexRevision, cards: [{ cardId: card.id, contentHash: card.contentHash }] },
      { items: [{ cardId: card.id, parentIds: [l1] }] });
  }, target);
}

async function surface(adapter, card, topics = [], inspectId = card.id) {
  const target = card.scope;
  return read(adapter, async tx => {
    const cards = adapter.documentCards;
    const [input] = await cards.visibilityInputs(tx, target, [ref(card)]);
    const single = await cards.get(tx, target, card.id);
    const listed = (await cards.list(tx, target)).find(row => row.id === card.id);
    const selection = { owner: target.owner, namespaces: [target.namespace] };
    const inspection = (await adapter.inspect.item(tx, target, inspectId, { limit: 15, includeQualification: true })).item;
    const annotations = await adapter.placement.forCards(tx, target, [card.id]);
    const pending = (await adapter.placement.pendingCards(tx, target, { limit: 5 })).some(row => row.cardId === card.id);
    const members = await Promise.all(topics.map(async ({ id }) =>
      (await adapter.placement.members(tx, target, id, page)).items.some(row => row.kind === "card" && row.id === card.id)));
    return {
      get: single?.body ?? null, list: listed?.body ?? null, amendments: single?.amendments.map(a => a.amendmentId) ?? [],
      listedAmendments: listed?.amendments.map(a => a.amendmentId) ?? [],
      input: input ? await documentCardVisible(input) : null, sourceWithheld: input?.sourceWithheld ?? null,
      fence: (await adapter.fence.assertVisible(tx, selection, [ref(card)], "read")).length,
      annotations: annotations.length, pending, members, inspection,
    };
  }, target);
}

function assertHidden(view) {
  assert.deepEqual([view.get, view.list, view.input?.visible ?? false, view.fence, view.annotations, view.pending, ...view.members],
    [null, null, false, 0, 0, false, ...view.members.map(() => false)]);
}

function tool(adapter, config = { documentCards: { enabled: true } }, items = [extract("The hatch opens at 8.")]) {
  return captureService({
    adapter, owner: scope.owner, scope: namespace => ({ owner: scope.owner, namespace }), hash, embeddingDimensions: null,
    harness: adapter.hashSessionKey ? { hashSessionKey: (client, sessionId) => adapter.hashSessionKey(scope, client, sessionId) } : {},
  }, config, async () => ({ items }));
}

test("an authored card bound to the corrected revision is withheld from direct Get and List", async t => {
  const { adapter } = await store(t);
  const bound = await insert(adapter, "The synthetic axle is bronze.");
  const card = authored("derived-axle", "Assembly record: the axle material is bronze.", scope, [bound]);
  await write(adapter, tx => adapter.documentCards.put(tx, scope, card));
  const topics = await topic(adapter, scope, "Axle inventory");
  await file(adapter, card, topics);
  const service = tool(adapter).service;
  assert.equal((await service.correct(scope, bound.id, bound.revision, "The synthetic axle is steel.", source)).status, "saved");
  const after = await surface(adapter, card, topics);
  assert.deepEqual(after.input, { visible: false, reason: "source_memory_corrected" });
  assertHidden(after);
});

test("a real capture card loses its source when Core correct replaces the old capture receipt", async t => {
  const { adapter, path } = await store(t);
  const fixture = tool(adapter);
  const capture = await fixture.capture("review-plan", "review-plan", [plan]);
  assert.equal(capture.memories.length, 1);
  const [card] = await fixture.read(tx => adapter.documentCards.list(tx, scope));
  const memory = capture.memories[0];
  const topics = await topic(adapter, scope, "Synthetic capture topic");
  await file(adapter, card, topics);
  const before = await surface(adapter, card, topics, memory.id);
  assert.equal(before.input.visible, true);
  assert.equal((await fixture.service.readCard(scope, card.id)).status, "found");
  const oldRead = await fixture.service.read(scope, { type: "memory", id: memory.id });
  assert.equal(oldRead.status, "found");
  assert.deepEqual(oldRead.receipts.map(receipt => receipt.messageId), [plan.id]);
  const change = message("new-proof", "The hatch opens at 10.", plan.occurredAtMs + 100);
  const newSession = { client: "client", sessionId: "new-session" };
  await write(adapter, tx => archive(adapter, tx, scope, newSession, change));
  const replaced = await fixture.service.correct(scope, memory.id, memory.revision, change.content, source, {
    receipt: { ...address(newSession, change), occurredAtMs: change.occurredAtMs, role: "user" },
  });
  assert.equal(replaced.status, "saved");
  await adapter.close();
  const reopened = await openSqliteAdapter(path, { capabilities, now });
  try {
    const after = await surface(reopened, card, topics, memory.id);
    assert.deepEqual(after.inspection.receipts.map(receipt => receipt.messageId), [change.id]);
    assert.equal(after.sourceWithheld, true);
    assert.deepEqual(after.input, { visible: false, reason: "source_withheld" });
    assertHidden(after);
    assert.equal((await tool(reopened).service.readCard(scope, card.id)).status, "not_found");
  } finally { await reopened.close(); }
});

test("an originally receiptless capture turn can still deliver its card", async t => {
  const { adapter } = await store(t);
  const fixture = tool(adapter, undefined, []);
  const capture = await fixture.capture("receiptless", "receiptless", [plan]);
  assert.equal(capture.memories.length, 0);
  const [card] = await fixture.read(tx => adapter.documentCards.list(tx, scope));
  const visible = await surface(adapter, card);
  assert.deepEqual([visible.get, visible.list, visible.input?.visible, visible.fence], [card.body, card.body, true, 1]);
  assert.equal((await fixture.service.readCard(scope, card.id)).status, "found");
});

test("definite span forget purges independently stored amendment text with cards disabled", async t => {
  const { adapter, path } = await store(t);
  const fixture = tool(adapter);
  const capture = await fixture.capture("review-plan", "review-plan", [plan]);
  const [card] = await fixture.read(tx => adapter.documentCards.list(tx, scope));
  const body = "Synthetic routed payload exclusive to the card store.";
  const routed = { ...card, body, contentHash: sha256(body), sentences: [] };
  const independent = authored("unrelated-review-card", "Synthetic independent parent document.");
  const amendment = { amendmentId: "span-bound-amendment", date: "2025-01-02",
    sourceMessage: card.sourceMessage, quote: "Synthetic quotation exclusive to this card.",
    sentence: "Synthetic amendment payload exclusive to this card." };
  await write(adapter, async tx => {
    await adapter.documentCards.put(tx, scope, routed);
    await adapter.documentCards.put(tx, scope, independent);
    await adapter.documentCards.amend(tx, scope, independent.id, amendment);
  });
  assert.deepEqual((await surface(adapter, independent)).amendments, [amendment.amendmentId]);
  await adapter.close();
  const withCardsOff = await openSqliteAdapter(path);
  try {
    assert.equal(withCardsOff.capabilities.documentCards, false);
    const forgotten = await tool(withCardsOff, {}).service.forget(scope, capture.memories[0].id, source);
    assert.equal(forgotten.status, "forgotten");
  } finally { await withCardsOff.close(); }
  const bytes = readFileSync(path);
  assert.ok(bytes.includes(independent.body));
  const db = new DatabaseSync(path, { readOnly: true });
  try {
    const fact = db.prepare("SELECT COUNT(*) AS n FROM cairn_suppression_facts WHERE json_extract(body, '$.kind') = 'rawSpan'").get().n;
    assert.ok(fact > 0, "Expected a definite span fact from real capture lineage");
    const row = db.prepare("SELECT state, sentence, quote FROM cairn_document_card_amendments WHERE card_id = ?").get(independent.id);
    assert.deepEqual({ ...row }, { state: "purged", sentence: null, quote: null });
    assert.equal(bytes.includes(routed.body), false);
    assert.equal(bytes.includes(amendment.sentence), false);
    assert.equal(bytes.includes(amendment.quote), false);
  } finally { db.close(); }
});

test("an identical stale mark leaves the card generation and revision alone", async t => {
  const { adapter, storage } = await store(t);
  const cards = adapter.documentCards;
  const card = authored("generation", "Synthetic generation card.");
  const stale = { memoryId: "linked", replacementMemoryId: "replacement" };
  const state = tx => storage.port(tx, scope.owner, {}, db => ({
    generation: readCardGeneration(db, scope),
    ...db.prepare("SELECT revision, stale FROM cairn_document_cards WHERE id = ?").get(card.id),
  }));
  const indexRevision = async () => read(adapter, async tx => (await adapter.placement.catalog(tx, scope, page)).indexRevision);

  await write(adapter, tx => cards.put(tx, scope, card));
  const initial = await read(adapter, state);
  const indexBefore = await indexRevision();
  await write(adapter, tx => cards.markStale(tx, scope, card.id, stale));
  const marked = await read(adapter, state);
  assert.deepEqual(marked, { generation: initial.generation + 1, revision: initial.revision + 1, stale: JSON.stringify([stale]) });
  assert.equal(await indexRevision(), indexBefore + 1);

  await write(adapter, async tx => {
    await cards.markStale(tx, scope, card.id, stale);
    assert.deepEqual(await state(tx), marked);
  });
  assert.deepEqual(await read(adapter, state), marked);
  assert.equal(await indexRevision(), indexBefore + 1);
});

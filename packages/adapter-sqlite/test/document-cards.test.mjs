import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import { coreDigest } from "@cairn-ink/core";
import { buildDocumentCard } from "@cairn-ink/core/routing";
import { createMemoryService } from "@cairn-ink/core/service";
import { captureService, correction, extract, plan, update } from "../../conformance/src/capture-documents-support.mjs";
import { createSqliteAdapter } from "../src/adapter.mjs";
import { readCardGeneration } from "../src/document-card-rows.mjs";
import { openSqliteAdapter, SQLITE_PHYSICAL_VERSION } from "../src/index.mjs";
import { migrateLegacyStore } from "../src/migrate/index.mjs";
import { DOCUMENT_CARD_TABLES } from "../src/schema/document-cards.mjs";
import { openStorage } from "../src/schema/open.mjs";
import { editFixture, fixture as legacyFixture, scratch as legacyScratch } from "./legacy/fixtures.mjs";
import { createLegacyBackup, prepareInput } from "./migration-fixtures.mjs";
import { scratch, sha256 } from "./storage-fixtures.mjs";

const scope = { owner: "owner", namespace: null };
const foreign = { ...scope, namespace: "different" };
const source = { kind: "mcp", client: null, sessionId: null };

const run = (adapter, callback, readOnly = false, target = scope) => adapter.uow.run(target.owner,
  readOnly ? { readOnly } : { pauseLock: true }, callback);

const imported = (id, body, target = scope) => ({
  id, scope: target, origin: "manual", title: "Synthetic label", body, contentHash: sha256(body),
  date: null, sourceMessage: null, sourceMemories: [], sentences: [], stale: [],
});

async function archive(adapter, tx, session, message) {
  await adapter.raw.archive(tx, { scope, ...session, eventId: message.id, payloadDigest: sha256(message.content) }, [message]);
  return { ...session, messageId: message.id };
}

async function routed(adapter, tx, session, message) {
  const sourceMessage = await archive(adapter, tx, session, message);
  const { card } = await buildDocumentCard(message, {
    scope, client: session.client, canonicalSessionKey: adapter.hashSessionKey(scope, session.client, session.sessionId),
  });
  return { ...imported(card.id, card.body), origin: "router", title: card.title, date: card.date, sourceMessage,
    sentences: card.sentences.map(({ start, end }) => ({ start, end, source: sourceMessage })) };
}

function assertClosedText(path, erased, retained) {
  const bytes = readFileSync(path);
  for (const text of erased) assert.equal(bytes.includes(Buffer.from(text)), false, "Erased payload is absent from the closed database");
  for (const text of retained) assert.ok(bytes.includes(Buffer.from(text)), "Retained payload is present in the closed database");
}

test("Raw deletion and exact forget remove persisted card text across flag changes", async t => {
  const { path, remove } = scratch();
  t.after(remove);
  let adapter = await openSqliteAdapter(path, { capabilities: { documentCards: true } });
  let deletedCard;
  const deleted = "Synthetic cedar document tied to the deleted conversation.";
  const deletedSentence = "Synthetic cedar amendment sentence to erase.";
  const deletedQuote = "Synthetic cedar amendment quote to erase.";
  const forgotten = "Synthetic cobalt stock must be removed after exact forget.";
  const retained = "Synthetic maple notes from an independent namespace.";
  const deletion = { client: "fixture", sessionId: "deletion" };
  try {
    await run(adapter, async tx => {
      deletedCard = await routed(adapter, tx, deletion, { id: "removed", role: "user", content: deleted, occurredAtMs: 1 });
      await adapter.documentCards.put(tx, scope, deletedCard);
      await adapter.documentCards.put(tx, scope, imported("keep", "Unrelated notes on the workbench."));
      await adapter.documentCards.amend(tx, scope, "keep", {
        amendmentId: "cedar", date: "2025-01-01", sentence: deletedSentence, quote: deletedQuote,
        sourceMessage: deletedCard.sourceMessage,
      });
      await adapter.documentCards.put(tx, scope, imported("exact", forgotten));
      await adapter.documentCards.put(tx, foreign, imported("exact", retained, foreign));
    });
  } finally {
    await adapter.close();
  }

  adapter = await openSqliteAdapter(path);
  try {
    assert.equal(adapter.documentCards, undefined);
    const service = createMemoryService({
      storage: adapter, config: {},
      clock: { nowMs: () => 1, monotonicMs: () => 1, sha256Hex: async value => sha256(value),
        async hmacHex() { assert.fail("Unexpected signing"); } },
      model: { model: "unused", contextWindow: 1, countTokens: () => 0, async call() { assert.fail("Unexpected model"); } },
      embedder: { model: "unused", dimensions: 1, async embed() { assert.fail("Unexpected embedding"); } },
      gate: { async assertOpen() {} }, tokens: { countTokens: () => 0 },
    });
    const { value } = await coreDigest(forgotten);
    const { id } = await run(adapter, tx => adapter.memories.insert(tx, scope, {
      kind: "fact", origin: "explicit", text: forgotten, textHash: "sha256:" + value, embedding: null, confidence: 1, source,
    }, [], 1));
    assert.equal((await service.forget(scope, id, source)).status, "forgotten");
    assert.deepEqual(await run(adapter, tx => adapter.raw.deleteConversation(tx, scope, deletion)), { rawDeleted: 1 });
  } finally {
    await adapter.close();
  }
  assertClosedText(path, [deleted, deletedSentence, deletedQuote, forgotten], [retained]);

  adapter = await openSqliteAdapter(path, { capabilities: { documentCards: true } });
  try {
    const cards = adapter.documentCards;
    assert.deepEqual(await run(adapter, async tx => (await cards.list(tx, scope)).map(record => [record.id, record.amendments]), true),
      [["keep", []]]);
    assert.deepEqual(await run(adapter, tx => cards.put(tx, scope, deletedCard)), { status: "tombstoned" });
    assert.deepEqual(await run(adapter, tx => cards.put(tx, scope, imported("exact", forgotten))), { status: "tombstoned" });
    assert.equal((await run(adapter, tx => cards.get(tx, foreign, "exact"), true, foreign)).body, retained);
  } finally {
    await adapter.close();
  }
});

test("card generations track effective operations, rollback and a concurrent write snapshot", async t => {
  const { path, remove } = scratch();
  const storage = await openStorage(path);
  const adapter = createSqliteAdapter(storage, { capabilities: { documentCards: true } });
  t.after(async () => {
    try { await adapter.close(); }
    finally { remove(); }
  });
  const cards = adapter.documentCards;
  const card = imported("note", "Synthetic note");
  const ref = { id: card.id, type: "card", namespace: scope.namespace };
  const generation = (tx, target = scope) => storage.port(tx, target.owner, {}, db => readCardGeneration(db, target));
  const write = callback => run(adapter, callback);
  assert.equal(await run(adapter, tx => generation(tx), true), 0);
  await write(async tx => {
    await cards.put(tx, scope, card);
    await cards.put(tx, scope, card);
    await cards.linkMemories(tx, scope, card.id, [{ id: "linked", revision: 1 }]);
    await cards.amend(tx, scope, card.id, { amendmentId: "amend", date: "2025-02-02", sentence: "Change", quote: "Quote",
      sourceMessage: { client: "fixture", sessionId: "session", messageId: "message" } });
    await cards.markStale(tx, scope, card.id, { memoryId: "linked", replacementMemoryId: "replacement" });
    assert.equal(await generation(tx), 4);
    await cards.hideWhere(tx, scope, { sourceMemoryId: "linked" }, "forget", { retainText: true });
    assert.equal(await generation(tx), 5);
    assert.deepEqual(await cards.visibilityInputs(tx, scope, [ref]), [null]);
    await cards.purgeById(tx, scope, card.id, "forget");
    assert.equal(await generation(tx), 6);
    await cards.purgeById(tx, scope, card.id, "forget");
    assert.equal(await generation(tx), 6);
  });
  await assert.rejects(write(async tx => {
    await cards.put(tx, scope, imported("rollback", "Rolled back"));
    throw new Error("rollback");
  }), /rollback/);

  const live = imported("live", "Live text");
  await write(tx => cards.put(tx, scope, live));
  const liveRef = { ...ref, id: live.id };
  let started, resume;
  const ready = new Promise(resolve => { started = resolve; });
  const committed = new Promise(resolve => { resume = resolve; });
  const original = run(adapter, async tx => {
    assert.equal((await cards.visibilityInputs(tx, scope, [liveRef]))[0].card.id, live.id);
    started();
    await committed;
    assert.equal((await cards.visibilityInputs(tx, scope, [liveRef]))[0].card.id, live.id);
    return tx;
  }, true);
  try {
    await Promise.race([ready, original]);
    await write(async tx => {
      await cards.hide(tx, scope, live.id, "forget");
      await cards.put(tx, foreign, imported("other", "Independent", foreign));
    });
  } finally {
    resume();
  }
  const ended = await original;
  await assert.rejects(cards.visibilityInputs(ended, scope, [liveRef]), { code: "internal_error" });
  assert.deepEqual(await run(adapter, tx => cards.visibilityInputs(tx, scope, [liveRef]), true), [null]);
  await run(adapter, async tx => {
    assert.equal(await generation(tx), 8);
    assert.equal(await generation(tx, foreign), 1);
  }, true);
});

test("hashed capture amends an archived card and forget erases the card and amendment", async t => {
  const { path, remove } = scratch();
  t.after(remove);
  const adapter = await openSqliteAdapter(path, { capabilities: { documentCards: true } });
  let cardId = "";
  let detected = 0;
  const hash = async text => "sha256:" + sha256(text);
  const fixture = captureService({
    adapter, owner: scope.owner, scope: namespace => ({ owner: scope.owner, namespace }), hash, embeddingDimensions: null,
    harness: { hashSessionKey: (client, sessionId) => adapter.hashSessionKey(scope, client, sessionId) },
  }, { documentCards: { enabled: true, amendments: true } },
  async () => ({ items: cardId ? [] : [extract("The hatch opens at 8.")] }), {
    async detectChanges() {
      detected++;
      return { changes: [{ card_id: cardId, quote: update, new_value: update }] };
    },
    async verifyChange() { return { applies: true, line: update }; },
  });
  try {
    const first = await fixture.capture("plan", "plan", [plan]);
    const [card] = await fixture.read(tx => adapter.documentCards.list(tx, scope));
    cardId = card.id;
    await fixture.capture("correction", "correction", [correction]);
    assert.equal(detected, 1);
    const read = () => fixture.read(tx => adapter.documentCards.get(tx, scope, cardId));
    assert.deepEqual((await read()).amendments.map(({ quote, sentence }) => [quote, sentence]), [[update, update]]);
    const memoryId = first.memories[0].id;
    const delivered = await fixture.service.read(scope, { type: "memory", id: memoryId });
    assert.equal(delivered.status, "found");
    assert.equal(delivered.receipts.length, 1);
    assert.equal("sessionKeyHash" in delivered.receipts[0], false);
    assert.equal("messageKey" in delivered.receipts[0], false);
    assert.equal((await fixture.service.forget(scope, memoryId, source)).status, "forgotten");
    assert.equal(await read(), null);
    await fixture.read(tx => {
      const ref = { id: cardId, type: "card", namespace: scope.namespace };
      return adapter.documentCards.visibilityInputs(tx, scope, [ref]).then(inputs => assert.deepEqual(inputs, [null]));
    });
  } finally {
    await adapter.close();
  }
  const reader = new DatabaseSync(path, { readOnly: true });
  try {
    const row = reader.prepare("SELECT title, body, state FROM cairn_document_cards WHERE id = ?").get(cardId);
    assert.deepEqual({ ...row }, { title: null, body: null, state: "purged" });
    const amendment = reader.prepare("SELECT sentence, quote, state FROM cairn_document_card_amendments WHERE card_id = ?").get(cardId);
    assert.deepEqual({ ...amendment }, { sentence: null, quote: null, state: "purged" });
  } finally {
    reader.close();
  }
});

test("read-only preflight refuses the preceding cardless layout byte-for-byte", async t => {
  const { path, remove } = scratch();
  t.after(remove);
  await (await openSqliteAdapter(path)).close();
  editFixture(path, db => {
    db.exec("PRAGMA foreign_keys = OFF");
    for (const name of DOCUMENT_CARD_TABLES) db.exec(`DROP TABLE ${name}`);
    db.exec(`PRAGMA user_version = ${SQLITE_PHYSICAL_VERSION - 1}`);
  });
  const before = readFileSync(path);
  await assert.rejects(openSqliteAdapter(path, { capabilities: { documentCards: true } }), { code: "storage_error" });
  assert.deepEqual(readFileSync(path), before);
});

test("legacy conversion creates the complete card schema with no card rows", async t => {
  const directory = legacyScratch(t);
  const input = prepareInput(directory, await legacyFixture(directory, 18));
  await createLegacyBackup(input);
  await migrateLegacyStore(input);
  const reader = new DatabaseSync(input.destination, { readOnly: true });
  try {
    assert.equal(reader.prepare("PRAGMA user_version").get().user_version, SQLITE_PHYSICAL_VERSION);
    const actual = reader.prepare("SELECT name FROM sqlite_schema WHERE type = 'table' AND name GLOB 'cairn_document_card*'")
      .all().map(({ name }) => name).sort();
    assert.deepEqual(actual, [...DOCUMENT_CARD_TABLES].sort());
    for (const name of actual) assert.equal(reader.prepare(`SELECT count(*) AS count FROM ${name}`).get().count, 0);
  } finally {
    reader.close();
  }
  const adapter = await openSqliteAdapter(input.destination, { capabilities: { documentCards: true } });
  try {
    assert.deepEqual(await run(adapter, tx => adapter.documentCards.list(tx, scope), true), []);
  } finally {
    await adapter.close();
  }
});

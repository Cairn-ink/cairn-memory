import assert from "node:assert/strict";
import { test } from "node:test";
import { createMemoryAdapter } from "@cairn-ink/adapter-memory";
import { buildDocumentCard, documentCardSearchText } from "@cairn-ink/core/routing";
import { createBM25, scoreBM25, termFrequencies, tokenizeT1 } from "@cairn-ink/core";

const scope = { owner: "owner", namespace: null };
const selection = { owner: scope.owner, namespaces: [scope.namespace] };
const model = "test-model";
const matched = { model, vector: new Float64Array([1, 0]) };

function manual(id, fields = {}) {
  return { id, scope, origin: "manual", title: "Inventory", body: "Spare key and cabinet.", date: 12,
    contentHash: id, sourceMessage: null, sourceMemories: [], sentences: [], stale: [], ...fields };
}

function fixture(options = {}) {
  let now = 100;
  const adapter = createMemoryAdapter({
    now: () => now,
    documentCardSearch: true,
    ...options,
    capabilities: { documentCards: true, ...options.capabilities },
  });
  const { uow, documentCards, documentCardCandidates: candidates } = adapter;
  const read = fn => uow.run(scope.owner, { readOnly: true }, fn);
  const write = fn => uow.run(scope.owner, { pauseLock: true }, fn);
  const put = (card, embedding) => uow.run(card.scope.owner, { pauseLock: true },
    tx => documentCards.put(tx, card.scope, card, embedding));
  const lexical = (query = "cabinet", filters = {}, depth = 50) =>
    read(tx => candidates.lexical(tx, { ...selection, ...filters }, query, depth, {}));
  const vector = (filters = {}, depth = 50) =>
    read(tx => candidates.vector(tx, { ...selection, ...filters }, Float32Array.of(1, 0), model, depth));
  return { adapter, documentCards, read, write, put, lexical, vector, setTime: time => { now = time; } };
}

async function router(f, client, date) {
  const sessionId = `conversation-${date}`;
  const message = { id: `message-${date}`, role: "user", content: "Cabinet inventory", occurredAtMs: date };
  const sourceMessage = { client, sessionId, messageId: message.id };
  if (f.adapter.raw) {
    const capture = { scope, client, sessionId, eventId: message.id, payloadDigest: "a".repeat(64) };
    await f.write(tx => f.adapter.raw.archive(tx, capture, [message]));
  }
  const { card } = await buildDocumentCard(message, { scope, client, canonicalSessionKey: sessionId });
  return manual(card.id, { origin: "router", title: card.title, body: card.body, date, sourceMessage });
}

const ids = ({ rows }) => rows.map(({ ref }) => ref.id);

test("card search defaults off and requires card storage when enabled", () => {
  const adapter = createMemoryAdapter({ capabilities: { documentCards: true } });
  assert.equal(adapter.capabilities.documentCardSearch, false);
  assert.equal(adapter.documentCardCandidates, undefined);
  assert.equal(typeof adapter.documentCards.visibilityInputs, "function");
  assert.throws(() => createMemoryAdapter({ documentCardSearch: true }), { code: "capability_unavailable" });
});

test("lexical candidates score the stored title and body with BM25 before applying depth", async () => {
  const f = fixture();
  const older = manual("older", { title: "Cabinet inventory", body: "Spare key." });
  const tie = manual("tie", { title: older.title, body: older.body });
  const highest = manual("highest", { title: "Cabinet", body: "Cabinet." });
  const unmatched = manual("unmatched", { title: "", body: "Lantern." });
  await f.put(older);
  f.setTime(101);
  for (const card of [tie, highest, unmatched]) await f.put(card);
  const documents = [older, tie, highest, unmatched].map(card => ({
    ref: { type: "card", id: card.id, namespace: scope.namespace },
    text: documentCardSearchText(card),
  }));
  const corpus = createBM25(documents);
  const result = await f.lexical("cabinet");
  assert.equal(result.matched, true);
  assert.deepEqual(ids(result), [highest.id, tie.id, older.id]);
  for (const row of result.rows) {
    const doc = documents.find(({ ref }) => ref.id === row.ref.id);
    assert.deepEqual(row.ref, doc.ref);
    assert.equal(row.score, scoreBM25(tokenizeT1("cabinet"), termFrequencies(doc.text), corpus));
  }
  assert.deepEqual(ids(await f.lexical("cabinet", {}, 2)), [highest.id, tie.id]);
  assert.deepEqual(await f.lexical("unmatched"), { rows: [], matched: false });
});

test("vectors sort by distance, newest write and descending UTF-8 ID before depth", async () => {
  const f = fixture();
  const first = manual("first");
  const older = manual("older");
  const bmp = manual("\uE000");
  const astral = manual("\u{10000}");
  await f.put(first, matched);
  await f.put(older, { model, vector: [0, 1] });
  f.setTime(102);
  for (const tied of [bmp, astral]) await f.put(tied, { model, vector: [0, 1] });
  const result = await f.vector({}, 3);
  assert.deepEqual(ids(result), [first.id, astral.id, bmp.id]);
  assert.deepEqual(result.rows.map(({ distance, updatedAtUs }) => [distance, updatedAtUs]),
    [[0, 100_000n], [1, 102_000n], [1, 102_000n]]);
  assert.deepEqual(result.coverage, { eligible: 4, embedded: 4, complete: true });

  f.setTime(103);
  const replacement = { ...older, body: "Updated cabinet", contentHash: "updated" };
  await f.put(replacement, { model, vector: [0, 1] });
  assert.deepEqual(ids(await f.vector()), [first.id, older.id, astral.id, bmp.id]);

  await f.put({ ...replacement, body: "Another cabinet update", contentHash: "updated-again" });
  assert.deepEqual((await f.vector()).coverage, { eligible: 4, embedded: 3, complete: false });
});

test("both channels apply card date, source client and visibility before calculating coverage or depth", async () => {
  const f = fixture({ capabilities: { rawArchive: true } });
  const visible = await router(f, "selected", 10);
  const withheld = await router(f, "selected", 11);
  const late = await router(f, "selected", 20);
  const otherClient = await router(f, "other", 12);
  const sourceLess = manual("source-less");
  const undated = manual("undated", { date: null });
  const foreign = manual("foreign", { scope: { ...scope, owner: "another-owner" } });
  const hidden = manual("hidden");
  const mismatched = manual("mismatched");
  for (const card of [withheld, late, otherClient, sourceLess, undated, foreign, hidden]) await f.put(card);
  await f.put(visible, matched);
  await f.put(mismatched, { model: "another-model", vector: [1, 0] });
  await f.write(async tx => {
    await f.documentCards.hide(tx, scope, hidden.id, "forget");
    await f.adapter.raw.fenceSession(tx, scope, withheld.sourceMessage);
  });

  const baseline = await f.vector();
  assert.deepEqual(baseline.coverage, { eligible: 6, embedded: 1, complete: false });
  const options = { clients: ["selected"], window: { sinceMs: 10, untilMs: 20 } };
  assert.deepEqual(ids(await f.lexical("cabinet", options, 1)), [visible.id]);
  assert.deepEqual(ids(await f.vector(options)), [visible.id]);
  assert.deepEqual((await f.vector(options)).coverage, { eligible: 1, embedded: 1, complete: true });
  const window = { window: { sinceMs: 12, untilMs: 20 } };
  assert.deepEqual(new Set(ids(await f.lexical("cabinet", window))), new Set([otherClient.id, sourceLess.id, mismatched.id]));
});

test("new card reads fail closed without Raw evidence while the existing fence keeps its verdict", async () => {
  const f = fixture();
  const card = await router(f, "fixture", 12);
  await f.put(card, matched);
  const refs = [{ type: "card", id: card.id, namespace: scope.namespace }];
  assert.deepEqual(await f.read(tx => f.adapter.fence.assertVisible(tx, selection, refs)), refs);
  assert.deepEqual(await f.read(tx => f.documentCards.visibilityInputs(tx, scope, refs)), [null]);
  assert.deepEqual(await f.lexical(), { rows: [], matched: false });
  assert.deepEqual((await f.vector()).coverage, { eligible: 0, embedded: 0, complete: true });
});

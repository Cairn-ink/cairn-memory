import assert from "node:assert/strict";
import { test } from "node:test";
import { runCase } from "@cairn-ink/conformance";
import { assemblyClock, fixtureCount, formatAssembly } from "@cairn-ink/conformance/context-assembly";
import { CONTEXT_READ_DOCUMENT_CARD_CASES } from "@cairn-ink/conformance/context-read-document-cards";
import { DOCUMENT_CARD_VISIBILITY_INPUT_CASES } from "@cairn-ink/conformance/document-card-visibility-input";
import { createBM25 } from "@cairn-ink/core";
import { buildDocumentCard, documentCardSearchText } from "@cairn-ink/core/routing";
import { createMemoryService } from "@cairn-ink/core/service";
import { openSqliteAdapter } from "../src/index.mjs";
import { scratch, seedFact, sha256 } from "./storage-fixtures.mjs";

const now = () => 100;
const monotonicMs = () => 0;
const scope = { owner: "owner", namespace: null };
const shared = { ...scope, namespace: "project\0shared" };
const excluded = { ...scope, namespace: "project\0excluded" };
const foreign = { ...scope, owner: "foreign" };
const readSet = { owner: scope.owner, namespaces: [null], accessGenerations: [1] };
const selection = { types: ["card"], intent: "current" };
const search = { ...selection, query: "petrel" };
const read = (storage, work) => storage.uow.run(scope.owner, { readOnly: true }, work);
const write = (storage, work, target = scope) => storage.uow.run(target.owner, { pauseLock: true }, work);
const open = (path, capabilities) => openSqliteAdapter(path, { capabilities, now, monotonicMs });

function service(storage) {
  return createMemoryService({ profile: "keyless-local", storage,
    clock: { ...assemblyClock(monotonicMs), nowMs: now },
    contextReadCounter: { count: fixtureCount }, contextReadFormat: formatAssembly });
}

async function fixture(t, capabilities = {}) {
  const file = scratch();
  let storage;
  t.after(async () => {
    try { await storage?.close(); }
    finally { file.remove(); }
  });
  storage = await open(file.path, { contextRead: true, documentCards: true, ...capabilities });
  return storage;
}

for (const candidate of [...CONTEXT_READ_DOCUMENT_CARD_CASES, ...DOCUMENT_CARD_VISIBILITY_INPUT_CASES]) {
  test(`${candidate.id} ${candidate.title}`, async () => {
    let target;
    const factory = {
      name: "sqlite-context-document-cards",
      async open({ capabilities }) {
        const file = scratch();
        try {
          const adapter = await openSqliteAdapter(file.path, { capabilities, now });
          return { adapter, nativeErrorMap: {}, busyNativeCodes: [], embeddingDimensions: null, sessionRefs: "hashed",
            harness: { seedFact: (_owner, fact) => seedFact(adapter, fact),
              hashSessionKey: (client, sessionId) => adapter.hashSessionKey(target, client, sessionId) },
            async close() {
              try { await adapter.close(); }
              finally { file.remove(); }
            },
          };
        } catch (error) {
          file.remove();
          throw error;
        }
      },
    };
    assert.equal(await runCase(factory, { ...candidate, run(ctx) {
      target = ctx.scope(null);
      return candidate.run(ctx);
    } }), null);
  });
}

function memoryRow(text) {
  return { text, textHash: "sha256:" + sha256(text.toLowerCase()), kind: "fact", origin: "explicit", confidence: 1,
    source: { kind: "import", client: null, sessionId: null }, embedding: null };
}

function turn(address, content, { target = scope, messageId = address, role = "user" } = {}) {
  return {
    key: { scope: target, client: "fixture", sessionId: address, eventId: address, payloadDigest: "a".repeat(64) },
    source: { client: "fixture", sessionId: address, messageId },
    message: { id: messageId, content, role, occurredAtMs: 1 },
  };
}

async function archive(storage, { key, message }) {
  return write(storage, tx => storage.raw.archive(tx, key, [message]), key.scope);
}

const put = (storage, card) => write(storage, tx => storage.documentCards.put(tx, card.scope, card), card.scope);

function authored(id, target = scope) {
  return { id, scope: target, origin: "manual", title: "Petrel Notes", body: "The petrel nests on the cliff.",
    contentHash: id, date: null, sourceMessage: null, sourceMemories: [], sentences: [], stale: [] };
}

async function router(storage, sourceTurn, sourceMemories = []) {
  const { key, source, message } = sourceTurn;
  assert.equal((await archive(storage, sourceTurn)).archived, 1);
  const { card } = await buildDocumentCard(message, { scope: key.scope, client: source.client,
    canonicalSessionKey: storage.hashSessionKey(key.scope, source.client, source.sessionId) });
  assert.ok(card);
  const record = { ...authored(card.id, key.scope), origin: "router", title: card.title, body: card.body,
    contentHash: sha256(card.body), date: card.date, sourceMessage: source, sourceMemories };
  assert.equal((await put(storage, record)).status, "inserted");
  return record;
}

const amend = (storage, id, date, { source }, quote, sentence = quote) =>
  write(storage, tx => storage.documentCards.amend(tx, scope, id, { amendmentId: date, date, sourceMessage: source, quote, sentence }));

async function finishCapture(storage, { key, source, message }) {
  return write(storage, async tx => {
    assert.equal((await storage.capture.admit(tx, key, [message])).status, "admitted");
    const { status, token } = await storage.capture.claim(tx, key, [message], { leaseMs: 100 });
    assert.equal(status, "claimed");
    const { text: content, ...memory } = memoryRow("The migration route crosses the bay.");
    const result = await storage.capture.finish(tx, token, [{ ...memory, content,
      receipts: [{ ...source, role: message.role, occurredAtMs: message.occurredAtMs }] }]);
    assert.equal(result.memories.length, 1);
    return result.memories[0];
  });
}

test("default budget includes two literal amendments and omits conflicted or forgotten sources", async t => {
  const storage = await fixture(t);
  assert.equal(storage.contextRead.raw, undefined);
  const card = await router(storage, turn("card-source", "Petrel Notes\nThe petrel nests on the cliff."));
  const older = turn("older", "They now nest near the inlet.");
  const newer = turn("newer", "They moved into the dunes.");
  const inaccurate = turn("inaccurate", "The turn contains a different statement.");
  const unproven = turn("unproven", "An explicit receipt does not establish capture lineage.");
  for (const sourceTurn of [older, newer, inaccurate, unproven]) await archive(storage, sourceTurn);
  const captured = await finishCapture(storage, older);
  await write(storage, tx => storage.memories.insert(tx, scope, memoryRow("The inlet is a sheltered spot."),
    [{ ...unproven.source, role: "user", occurredAtMs: 1 }], now()));

  const olderSentence = "The nests moved to the inlet.";
  const newerSentence = "The nests moved to the dunes.";
  await amend(storage, card.id, "2025-03-02", newer, newer.message.content, newerSentence);
  await amend(storage, card.id, "2025-03-01", older, older.message.content, olderSentence);
  await amend(storage, card.id, "2025-03-03", inaccurate, "They moved to the plateau.");
  await amend(storage, card.id, "2025-03-04", unproven, unproven.message.content);
  const projection = ({ source, message }) => read(storage, tx => storage.contextRead.documentCardAmendmentSource(tx,
    readSet, scope, { sourceMessage: source, quote: message.content }));
  assert.ok(await projection(older));
  assert.equal(await projection(unproven), null);

  const api = service(storage);
  const sources = [{ index: 0, date: "2025-03-01", role: "user", excerpt: older.message.content },
    { index: 1, date: "2025-03-02", role: "user", excerpt: newer.message.content }];
  const initial = await api.readContext(readSet, search);
  assert.equal(initial.assembly.items.length, 1);
  assert.deepEqual(initial.assembly.items[0].sources, sources);
  assert.ok(initial.assembly.items[0].body.indexOf(olderSentence) < initial.assembly.items[0].body.indexOf(newerSentence));
  for (const { source } of [older, newer]) assert.ok(!JSON.stringify(initial.assembly).includes(JSON.stringify(source.sessionId)));
  assert.equal(initial.diagnostics.budget.used, fixtureCount(formatAssembly(initial.assembly)));

  assert.equal((await archive(storage, { ...newer, message: { ...newer.message, content: "Disputed statement." } })).archived, 0);
  assert.equal(await projection(newer), null);
  assert.deepEqual((await api.readContext(readSet, search)).assembly.items[0].sources, sources.slice(0, 1));
  // Removing the retained receipt's memory records a denial for its archived address.
  await write(storage, tx => storage.memories.erase(tx, scope, captured.id));
  assert.equal(await projection(older), null);
  const after = (await api.readContext(readSet, search)).assembly.items;
  assert.equal(after.length, 1);
  assert.equal(after[0].body, card.title + "\n" + card.body);
  assert.deepEqual(after[0].sources, []);
});

test("find, fetch and read withhold forgotten bindings, fenced forks, hidden, purged and foreign cards", async t => {
  const storage = await fixture(t);
  const linked = await write(storage, tx => storage.memories.insert(tx, scope, memoryRow("A bird catches fish."), [], now()));
  const linkedCard = await router(storage, turn("linked-source", "Petrel feeding notes"), [linked]);
  const direct = await router(storage, turn("direct-source", "Petrel nesting notes"));
  const root = turn("root-source", "Petrel migration notes", { messageId: "forked-turn", target: excluded });
  const fork = turn("fork-source", root.message.content, { messageId: root.message.id });
  await archive(storage, root);
  await write(storage, tx => storage.raw.recordLineage(tx, root.key, [root.message]), excluded);
  const forkedCard = await router(storage, fork);
  const hidden = await router(storage, turn("hidden-source", "Petrel sightings"));
  const purged = await router(storage, turn("purged-source", "Petrel markings"));
  const other = await router(storage, turn("foreign-source", "Petrel populations", { target: foreign }));
  const api = service(storage);
  const { items } = await api.findCandidates(readSet, search);
  assert.deepEqual(new Set(items.map(({ ref }) => ref.id)), new Set([linkedCard.id, direct.id, forkedCard.id, hidden.id, purged.id]));
  const fetch = ref => api.fetchEvidence(readSet, { refs: [ref], intent: search.intent });
  const linkedRef = items.find(({ ref }) => ref.id === linkedCard.id).ref;
  assert.equal((await fetch(linkedRef)).items[0].triggerMemoryRefs[0].revision, linked.revision);
  await seedFact(storage, { ...scope, kind: "identity", origin: "forget", actionId: "forget-link", memoryId: linked.id });
  // A fact may arrive before the card is physically erased. Exercise the core gate on that active row.
  const [retained] = await read(storage, tx => storage.contextRead.evidence(tx, readSet, [linkedRef], search.intent));
  assert.equal(retained.item.state, "active");
  await assert.rejects(fetch(linkedRef), { code: "evidence_unavailable" });

  await write(storage, async tx => {
    await storage.raw.fenceSession(tx, scope, direct.sourceMessage);
    await storage.raw.fenceSession(tx, excluded, root.source);
    await storage.documentCards.hideWhere(tx, scope, { sourceMessage: hidden.sourceMessage }, "forget", { retainText: true });
    await storage.documentCards.purgeById(tx, scope, purged.id, "forget");
  });
  assert.deepEqual((await api.findCandidates(readSet, search)).items, []);
  assert.deepEqual((await api.readContext(readSet, search)).assembly.items, []);
  for (const { ref } of items) await assert.rejects(fetch(ref), { code: "evidence_unavailable" });
  const foreignRef = { type: "card", scope: foreign, id: other.id, revision: 1, bodyRevision: 1 };
  await assert.rejects(fetch(foreignRef), { code: "authority_required" });
  await assert.rejects(fetch({ ...foreignRef, scope }), { code: "evidence_unavailable" });
  assert.deepEqual(await read(storage, tx => storage.contextRead.evidence(tx, readSet, [foreignRef], search.intent)), [null]);
});

test("card scoring uses only search text and keeps memory statistics and stored binding revisions", async t => {
  const storage = await fixture(t);
  const text = "The petrel nests on a cliff.";
  const linked = await write(storage, tx => storage.memories.insert(tx, scope, memoryRow("A petrel dives for fish."), [], now()));
  await write(storage, tx => storage.memories.replaceContent(tx, scope, linked.id, linked.revision, memoryRow(text), null, now()));
  const card = await router(storage, turn("card-source", "Petrel flight\nThe petrel petrel travels offshore."), [linked]);
  await put(storage, { ...authored("another"), title: "Weather", body: "In summer, the winds blow inland." });
  await amend(storage, card.id, "2025-03-01", turn("amendment", "Auxiliary"), "Auxiliary");
  const { contextRead } = storage;
  const lexical = async (query, types) => {
    const selected = { ...selection, types };
    await contextRead.prepareLexical(readSet, selected, {});
    return read(storage, tx => contextRead.lexical(tx, readSet, selected, query, 24, {}));
  };
  const memory = (await lexical(search.query, ["memory"])).rows[0];
  const combined = await lexical(search.query, ["memory", "card"]);
  assert.deepEqual(combined.rows.find(({ ref }) => ref.type === "memory"), memory);
  const indexed = [card, { ...authored("another"), title: "Weather", body: "In summer, the winds blow inland." }];
  const bm25 = createBM25(indexed.map(({ id, ...card }) => ({ ref: { type: "card", id, namespace: null }, text: documentCardSearchText(card) })));
  const hit = combined.rows.find(({ ref }) => ref.type === "card");
  assert.equal(hit.score, bm25.search(search.query)[0].score);
  assert.deepEqual(hit.ref, { type: "card", scope, id: card.id, revision: 2, bodyRevision: 1 });
  assert.deepEqual(await lexical("auxiliary", ["card"]), { rows: [], matched: 0 });
  const fetched = await service(storage).fetchEvidence(readSet, { refs: [hit.ref], intent: selection.intent });
  assert.deepEqual(fetched.items[0].triggerMemoryRefs, [{ type: "memory", scope, id: linked.id, revision: linked.revision }]);
});

test("card generations are scoped and excluded namespace writes preserve a candidate cursor", async t => {
  const storage = await fixture(t);
  const { documentCards: cards, contextRead } = storage;
  const set = { ...readSet, namespaces: [null, shared.namespace], accessGenerations: [1, 1] };
  const slots = () => read(storage, tx => contextRead.snapshotState(tx, set, selection.types));
  const generations = async () => (await slots()).map(({ card }) => card);
  assert.deepEqual(await generations(), [0, 0]);
  const card = authored("first");
  const other = authored("second", shared);
  await put(storage, card);
  await put(storage, other);
  assert.deepEqual(await generations(), [1, 1]);
  const api = service(storage);
  const { nextCursor, items } = await api.findCandidates(set, { ...search, limit: 1 });
  assert.ok(nextCursor);
  const before = await slots();
  await put(storage, authored("excluded", excluded));
  assert.deepEqual(await slots(), before);
  const next = () => api.findCandidates(set, { ...search, cursor: nextCursor, limit: 1 });
  assert.notEqual((await next()).items[0].ref.id, items[0].ref.id);

  const amendment = turn("change", "The petrel returned.");
  await amend(storage, card.id, "2025-03-01", amendment, amendment.message.content);
  assert.deepEqual(await generations(), [2, 1]);
  await assert.rejects(next(), { code: "cursor_stale" });
  await amend(storage, card.id, "2025-03-01", amendment, amendment.message.content);
  assert.deepEqual(await generations(), [2, 1]);
  await write(storage, tx => cards.linkMemories(tx, scope, card.id, [{ id: "prior-memory", revision: 1 }]));
  assert.deepEqual(await generations(), [3, 1]);
  await write(storage, tx => cards.hideWhere(tx, scope, { sourceMemoryId: "prior-memory" }, "forget", { retainText: true }));
  assert.deepEqual(await generations(), [4, 1]);
  await write(storage, tx => cards.purgeById(tx, scope, card.id, "forget"));
  assert.deepEqual(await generations(), [5, 1]);
  assert.deepEqual((await api.findCandidates(set, search)).items.map(({ ref }) => ref.id), [other.id]);
});

test("card publication resumes a bounded scan and sweeps old postings", async t => {
  const storage = await fixture(t);
  const { documentCards: cards, contextRead } = storage;
  const total = 1025;
  await write(storage, async tx => {
    for (let i = 0; i < total; i++) {
      await cards.put(tx, scope, authored(`card-${String(i).padStart(4, "0")}`));
    }
  });
  const prepare = () => contextRead.prepareLexical(readSet, selection, {});
  const observe = () => read(storage, tx => contextRead.observeIndex(tx, readSet, selection));
  assert.equal((await prepare()).canonicalRows, total - 1);
  assert.equal((await observe()).ready, false);
  assert.equal((await prepare()).canonicalRows, 1);
  const first = await observe();
  assert.deepEqual(first.byType.card, { eligible: total, indexed: total });

  await write(storage, tx => cards.purgeById(tx, scope, "card-0000", "forget"));
  await prepare();
  assert.equal((await observe()).ready, false);
  assert.equal((await prepare()).removed, 1);
  const next = await observe();
  assert.notEqual(next.indexState, first.indexState);
  assert.deepEqual(next.byType.card, { eligible: total - 1, indexed: total - 1 });
  const hits = await read(storage, tx => contextRead.lexical(tx, readSet, selection, search.query, 24, {}));
  assert.equal(hits.matched, total - 1);
  assert.ok(hits.rows.every(({ ref }) => ref.id !== "card-0000"));
});

test("disabled document cards preserve Context Read bytes with stored card rows", async t => {
  const file = scratch();
  t.after(file.remove);
  const profiles = { contextRead: true, contextRawRead: true };
  const inputs = [["memory"], ["card"], ["memory", "card"]].map(types => ({ ...search, types }));
  async function withAdapter(capabilities, run) {
    const adapter = await open(file.path, capabilities);
    try { return await run(adapter); }
    finally { await adapter.close(); }
  }
  async function outputs(storage) {
    assert.equal(storage.contextRead.documentCardAmendmentSource, undefined);
    const api = service(storage);
    const values = [];
    for (const input of inputs) {
      const found = await api.findCandidates(readSet, input);
      const assembled = await api.readContext(readSet, input);
      assert.equal(found.nextCursor, null);
      if (found.items.length) {
        const ref = { ...found.items[0].ref, type: "unsupported" };
        assert.deepEqual(await read(storage, tx => storage.contextRead.evidence(tx, readSet, [ref], input.intent)), [null]);
      }
      values.push(found, assembled);
      if (assembled.snapshot) values.push(await api.fetchEvidence(readSet, { snapshot: assembled.snapshot }));
    }
    return JSON.stringify(values);
  }
  const baseline = await withAdapter(profiles, async storage => {
    await write(storage, tx => storage.memories.insert(tx, scope, memoryRow("Petrels gather offshore."), [], now()));
    await outputs(storage);
    return outputs(storage);
  });
  await withAdapter({ ...profiles, documentCards: true }, storage => put(storage, authored("stored-card")));
  assert.equal(await withAdapter(profiles, outputs), baseline);
});

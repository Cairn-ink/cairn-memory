import assert from "node:assert/strict";
import { test } from "node:test";
import { serialize } from "node:v8";
import { CoreError } from "@cairn-ink/core";
import { buildDocumentCard } from "@cairn-ink/core/routing";
import { createMemoryService } from "@cairn-ink/core/service";
import { hostedScope as scope, memory, serviceFake } from "./helpers/service-fake.mjs";

const skipped = { status: "not_searched", count: 0 };
const unwired = { ...skipped, code: "capability_unavailable" };

function card(id, fields = {}) {
  return { id, scope, origin: "manual", title: "Inventory", body: "Cabinet notes\nSpare key on the shelf.",
    date: 12, sourceMessage: null, sourceMemories: [], ...fields };
}

function evidence(card, fields = {}) {
  return { card, requestedScope: scope, memoryStates: new Map(), textFacts: [], ...fields };
}

function lexical({ id, scope: { namespace } }, score) {
  return { ref: { type: "card", id, namespace }, updatedAtUs: 12_000n, score };
}

function vector(card, distance) {
  const { ref, updatedAtUs } = lexical(card, 0);
  return { ref, updatedAtUs, distance };
}

function fixture({ cards, words, semantic = [], complete = true, options = {} }) {
  const fake = serviceFake(options);
  const { storage } = fake;
  const records = new Map(cards.map(card => [card.id, card]));
  const transactions = [];
  const hooks = {
    input: (id) => records.has(id) ? evidence(records.get(id)) : null,
  };
  function record(tx, method, ...args) {
    assert.equal(tx.options.readOnly, true);
    transactions.push({ tx, method, args });
  }
  Object.assign(storage.capabilities, { documentCards: true, documentCardSearch: true });
  storage.documentCards = {
    async get(tx, selection, id) {
      record(tx, "get", selection, id);
      return records.get(id) ?? null;
    },
    async visibilityInputs(tx, selection, refs) {
      record(tx, "visibilityInputs", selection, refs);
      return refs.map(({ id }) => hooks.input(id, refs));
    },
  };
  storage.documentCardCandidates = {
    async lexical(tx, selection, query, depth) {
      record(tx, "lexical", selection, query, depth);
      return { rows: words, matched: words.length > 0 };
    },
    async vector(tx, selection, query, model, depth) {
      record(tx, "vector", selection, query, model, depth);
      return { rows: semantic, coverage: { complete } };
    },
  };
  return { ...fake, cardHooks: hooks, transactions, service: createMemoryService(fake.deps) };
}

test("card-only find is lexical, applies the read set and uses one snapshot", async () => {
  const item = card("first");
  const { service, transactions, calls } = fixture({
    cards: [item], words: [lexical(item, 2)], options: { recall: true, semantic: true },
  });
  const result = await service.find(scope, "  spare key  ", {
    kinds: ["card"], limit: 1, sinceMs: 10, untilMs: 20, clients: ["fixture", "fixture"],
  });
  assert.deepEqual(result, {
    memories: [], raw: [],
    cards: [{ type: "card", id: item.id, title: item.title, date: 12, excerpt: "Spare key on the shelf.", truncated: false }],
    layers: { memory: skipped, raw: skipped, card: { status: "ok", count: 1 } },
  });
  assert.deepEqual(transactions.map(({ method }) => method), ["lexical", "visibilityInputs", "get", "visibilityInputs"]);
  assert.equal(new Set(transactions.map(({ tx }) => tx)).size, 1);
  assert.deepEqual(transactions[0].args, [
    { owner: scope.owner, namespaces: [scope.namespace], window: { sinceMs: 10, untilMs: 20 }, clients: ["fixture"] },
    "spare key", 50,
  ]);
  assert.deepEqual(transactions[1].args, [scope, [lexical(item, 2).ref]]);
  assert.deepEqual(calls, [["run", scope.owner, { readOnly: true }]]);
});

test("hybrid cards reuse the memory embedding and leave memory and Raw delivery byte-identical", async () => {
  const weak = card("weak");
  const strong = card("strong");
  const rows = [memory("first"), memory("second")];
  const { deps, storage, transactions, hooks, calls } = fixture({
    cards: [weak, strong], words: [lexical(weak, 3), lexical(strong, 2)],
    semantic: [vector(strong, 0.1), vector(weak, 0.3)],
    options: { rows, recall: true, semantic: true },
  });
  hooks.lexicalScore = row => row.id === "first" ? 2 : 1;
  hooks.vectorDistance = row => row.id === "first" ? 0.2 : 0.1;
  storage.capabilities.rawArchive = true;
  const segment = { ref: { type: "raw", id: "raw", namespace: scope.namespace }, client: "fixture",
    sessionId: "conversation", messageId: "message", role: "user", content: "spare key", occurredAtMs: 12, score: 3 };
  let rawVector;
  storage.raw = {
    async raw(_tx, _selection, _query, _intent, options) {
      rawVector = options.queryVector;
      return { segments: [segment], coverage: { complete: false } };
    },
  };
  const baseline = await createMemoryService({ ...deps, storage: {
    ...storage, capabilities: { ...storage.capabilities, documentCards: false, documentCardSearch: false },
    documentCards: undefined, documentCardCandidates: undefined,
  } }).find(scope, "spare key", { kinds: ["memory", "raw"] });
  calls.length = 0;
  const result = await createMemoryService(deps).find(scope, "spare key", { kinds: ["memory", "card", "raw"] });
  const memoryAndRaw = ({ memories, raw, layers }) => ({ memories, raw, layers: [layers.memory, layers.raw] });
  assert.deepEqual(serialize(memoryAndRaw(result)), serialize(memoryAndRaw(baseline)));
  assert.deepEqual(result.memories.map(({ id }) => id), ["second", "first"]);
  assert.deepEqual(result.raw, [segment]);
  assert.deepEqual(result.cards.map(({ id }) => id), [strong.id, weak.id]);
  assert.equal(calls.filter(([method]) => method === "embedQuery").length, 1);
  const { args: [selection, queryVector, model, depth] } = transactions.find(({ method }) => method === "vector");
  assert.equal(selection, transactions[0].args[0]);
  assert.equal(queryVector, calls.find(([method]) => method === "vector.vector")[2]);
  assert.equal(queryVector, rawVector);
  assert.equal(model, "query-model");
  assert.equal(depth, 50);
  assert.equal(new Set(transactions.map(({ tx }) => tx)).size, 1);
  const [batch, ...fresh] = transactions.filter(({ method }) => method === "visibilityInputs");
  assert.deepEqual(batch.args[1].map(({ id }) => id), [weak.id, strong.id, strong.id, weak.id]);
  assert.deepEqual(fresh.map(({ args }) => args[1].map(({ id }) => id)), [[strong.id], [weak.id]]);
});

test("incomplete card vectors fall back to the lexical pool", async () => {
  const words = card("words");
  const semantic = card("semantic");
  const { service, transactions } = fixture({
    cards: [words, semantic], words: [lexical(words, 2)], semantic: [vector(semantic, 0)], complete: false,
    options: { recall: true, semantic: true },
  });
  const result = await service.find(scope, "spare key", { kinds: ["memory", "card"] });
  assert.deepEqual(result.cards.map(({ id }) => id), [words.id]);
  assert.ok(transactions.some(({ method }) => method === "vector"));
});

test("the visibility batch drops unsafe candidates before the page limit", async () => {
  const visible = card("visible");
  const hidden = card("hidden");
  const forgotten = card("forgotten", { sourceMemories: [{ id: "forgotten-memory", revision: 1 }] });
  const source = { client: "fixture", sessionId: "conversation", messageId: "message" };
  const { card: routed } = await buildDocumentCard({ id: source.messageId, role: "user", content: "Cabinet inventory" },
    { scope, client: source.client, canonicalSessionKey: source.sessionId });
  const withheld = card(routed.id, { origin: "router", sourceMessage: source });
  const foreign = card("foreign", { scope: { ...scope, owner: "another-owner" } });
  const candidates = [hidden, forgotten, withheld, foreign, visible];
  const { service, cardHooks, transactions } = fixture({
    cards: candidates, words: candidates.map((card, i) => lexical(card, candidates.length - i)),
  });
  const inputs = new Map([
    [hidden.id, null],
    [forgotten.id, evidence(forgotten, { memoryStates: new Map([["forgotten-memory", { status: "forgotten" }]]) })],
    [withheld.id, evidence({ ...withheld, canonicalSessionKey: source.sessionId }, { sourceWithheld: true })],
    [foreign.id, evidence(foreign, { requestedScope: foreign.scope })],
    [visible.id, evidence(visible)],
  ]);
  cardHooks.input = id => inputs.get(id);
  const result = await service.find(scope, "spare key", { kinds: ["card"], limit: 1 });
  assert.deepEqual(result.cards.map(({ id }) => id), [visible.id]);
  assert.deepEqual(transactions.filter(({ method }) => method === "get").map(({ args }) => args[1]), [visible.id]);
});

test("delivery checks a fresh visibility input after get in the candidate snapshot", async () => {
  const item = card("changing-evidence", { sourceMemories: [{ id: "link", revision: 1 }] });
  const { service, cardHooks, transactions } = fixture({ cards: [item], words: [lexical(item, 1)] });
  let visibilityReads = 0;
  cardHooks.input = () => evidence(item, { memoryStates: new Map([["link",
    ++visibilityReads === 1 ? { status: "visible", revision: 1 } : { status: "forgotten" },
  ]]) });
  const result = await service.find(scope, "spare key", { kinds: ["card"] });
  assert.deepEqual(result.cards, []);
  assert.deepEqual(result.layers.card, { status: "ok", count: 0 });
  assert.equal(visibilityReads, 2);
  assert.equal(new Set(transactions.map(({ tx }) => tx)).size, 1);
});

test("find skips cards for blank queries and reports missing card capabilities", async () => {
  const { service, deps, storage, calls } = fixture({ cards: [], words: [] });
  for (const blank of [null, "", " \n "]) {
    assert.deepEqual((await service.find(scope, blank, { kinds: ["card"] })).layers.card, skipped);
  }
  storage.capabilities.documentCardSearch = false;
  assert.deepEqual((await createMemoryService(deps).find(scope, "query", { kinds: ["card"] })).layers.card, unwired);
  storage.capabilities.documentCardSearch = true;
  const candidates = storage.documentCardCandidates;
  delete storage.documentCardCandidates;
  assert.deepEqual((await createMemoryService(deps).find(scope, "query", { kinds: ["card"] })).layers.card, unwired);
  storage.documentCardCandidates = candidates;
  delete storage.documentCards.visibilityInputs;
  assert.deepEqual((await createMemoryService(deps).find(scope, "query", { kinds: ["card"] })).layers.card, unwired);
  assert.deepEqual(calls, []);
});

test("a card store or input batch failure leaves successful memory and Raw layers intact", async () => {
  const item = card("visible");
  const row = memory("memory");
  const { deps, storage, hooks } = fixture({
    cards: [item], words: [lexical(item, 1)], options: { rows: [row], recall: true },
  });
  hooks.lexicalScore = () => 1;
  storage.capabilities.rawArchive = true;
  storage.raw = { async raw() { return { segments: [], coverage: { complete: true } }; } };
  const get = storage.documentCards.get;
  for (const method of ["get", "visibilityInputs"]) {
    storage.documentCards.get = get;
    storage.documentCards[method] = async () => { throw new CoreError("storage_busy", "private details"); };
    const result = await createMemoryService(deps).find(scope, "spare key", { kinds: ["memory", "card", "raw"] });
    assert.deepEqual(result, {
      memories: [row], cards: [], raw: [],
      layers: { memory: { status: "ok", count: 1 }, raw: { status: "ok", count: 0 },
        card: { status: "unavailable", count: 0, code: "storage_busy" } },
    });
  }
});

import assert from "node:assert/strict";
import test from "node:test";
import {
  CAPABILITIES, CoreError, OPTIONAL_PORTS, assertAdapterCapabilities, capabilities,
  fuseHosted, fuseHostedLexicalOnly, fuseHostedWithCards,
} from "../src/index.mjs";
import {
  DOCUMENT_CARD_SEARCH_TEXT_VERSION, documentCardFindItem, documentCardSearchText, visibleDocumentCardRows,
} from "../src/routing/index.mjs";

const scope = { owner: "owner", namespace: "project" };
const page = { offset: 0, limit: 200 };
const invalidInput = error => error instanceof CoreError && error.code === "invalid_input";
const lexical = (type, id, score, updatedAtUs = 0n, namespace = scope.namespace) =>
  ({ ref: { type, id, namespace }, score, updatedAtUs });
const vector = (type, id, distance, updatedAtUs = 0n, namespace = scope.namespace) =>
  ({ ref: { type, id, namespace }, distance, updatedAtUs });

test("document card candidate registration requires the port and both capabilities", () => {
  assert.ok(CAPABILITIES.includes("documentCardSearch"));
  assert.equal(OPTIONAL_PORTS.documentCardCandidates, "documentCardSearch");
  const documentCards = {};
  const documentCardCandidates = { lexical() {}, vector() {} };
  const storageOnly = capabilities({ documentCards: true });
  const search = capabilities({ documentCards: true, documentCardSearch: true });

  assert.equal(storageOnly.documentCardSearch, false);
  assertAdapterCapabilities({ capabilities: storageOnly, documentCards });
  assertAdapterCapabilities({ capabilities: search, documentCards, documentCardCandidates });
  for (const adapter of [
    { capabilities: storageOnly, documentCards, documentCardCandidates },
    { capabilities: search, documentCards },
    { capabilities: capabilities({ documentCardSearch: true }), documentCardCandidates },
  ]) assert.throws(() => assertAdapterCapabilities(adapter), { code: "capability_unavailable" });
});

test("document card index text preserves the redacted fields exactly", () => {
  const body = "  開頭\n[REDACTED]\n";
  assert.equal(DOCUMENT_CARD_SEARCH_TEXT_VERSION, 1);
  assert.equal(documentCardSearchText({ title: "  標題  ", body }), `  標題  \n\n${body}`);
  for (const title of [null, ""]) assert.equal(documentCardSearchText({ title, body }), body);
});

function visibilityInput(id, overrides = {}) {
  return {
    card: { id, scope, origin: "manual", sourceMessage: null, sourceMemories: [], title: null, body: "Text" },
    requestedScope: scope,
    memoryStates: new Map(),
    textFacts: [],
    ...overrides,
  };
}

test("card candidate visibility preserves order and fails closed by reason", async () => {
  const rows = [
    vector("card", "first", 0.3),
    vector("card", "missing", 0.01),
    vector("memory", "wrong-type", 0.01),
    vector("card", "load-error", 0.01),
    vector("card", "forgotten", 0.01),
    vector("card", "uncertain", 0.01),
    vector("card", "wrong-id", 0.01),
    vector("card", "wrong-namespace", 0.01, 0n, null),
    vector("card", "last", 0.2),
  ];
  const loaded = [];
  const result = await visibleDocumentCardRows(rows, async ref => {
    loaded.push(ref);
    switch (ref.id) {
      case "missing": return null;
      case "load-error": throw new Error("private details");
      case "forgotten": {
        const input = visibilityInput(ref.id);
        input.card.sourceMemories = [{ id: "source", revision: 1 }];
        input.memoryStates.set("source", { status: "forgotten" });
        return input;
      }
      case "uncertain": return visibilityInput(ref.id, { textFacts: null });
      case "wrong-id": return visibilityInput("unrelated");
      default: return visibilityInput(ref.id);
    }
  });

  assert.deepEqual(loaded, rows.filter(row => row.ref.type === "card").map(row => row.ref));
  assert.deepEqual(result, { rows: [rows[0], rows[8]], drops: {
    missing_input: 1, invalid_ref: 1, load_failed: 1, source_memory_forgotten: 1,
    uncertain: 1, id_mismatch: 1, scope_mismatch: 1,
  } });
  assert.equal(result.rows[0], rows[0]);
});

test("withheld cards consume no ranks and visible cards become typed find items", async () => {
  const rows = [lexical("card", "hidden", 9), lexical("card", "visible", 1)];
  const { rows: cardLexical, drops } = await visibleDocumentCardRows(rows, ref =>
    ref.id === "hidden" ? null : visibilityInput(ref.id));
  const found = fuseHostedWithCards({
    memoryLexical: [lexical("memory", "visible", 100)], memoryVector: [], cardLexical, cardVector: null,
  }, page);

  assert.deepEqual(drops, { missing_input: 1 });
  assert.deepEqual(found.rows.map(row => [row.ref.type, row.lexicalRank, row.vectorRank]), [
    ["memory", 1, null], ["card", 1, null],
  ]);
  const { ref } = found.rows[1];
  assert.deepEqual(documentCardFindItem({ id: ref.id, title: null, date: null, body: "Text" }, "text"), {
    type: "card", id: "visible", title: null, date: null, excerpt: "Text", truncated: false,
  });
});

test("hosted fusion uses independent channel ranks, hosted ties, and the inclusive vector-only floor", () => {
  const channels = {
    memoryLexical: [lexical("memory", "shared", 99, 1n)],
    memoryVector: [vector("memory", "shared", 0.9)],
    cardLexical: [lexical("card", "shared", 1, 2n), lexical("card", "lexical", 1)],
    cardVector: [
      vector("card", "below-floor", 0.46),
      vector("card", "shared", 0.9),
      vector("card", "\uE000", 0.45),
      vector("card", "😀", 0.45),
      vector("card", "newer", 0.45, 1n),
    ],
  };
  const { rows, total } = fuseHostedWithCards(channels, { ...page, floor: true });
  assert.equal(total, 6);
  assert.deepEqual(rows.map(row => [row.ref.type, row.ref.id, row.lexicalRank, row.vectorRank, row.score]), [
    ["memory", "shared", 1, 1, 0.5 / 61 + 1 / 61],
    ["card", "shared", 1, 5, 0.5 / 61 + 1 / 65],
    ["card", "newer", null, 1, 1 / 61],
    ["card", "😀", null, 2, 1 / 62],
    ["card", "\uE000", null, 3, 1 / 63],
    ["card", "lexical", 2, null, 0.5 / 62],
  ]);
  assert.equal(rows[1].updatedAtUs, 2n);
  assert.equal(fuseHostedWithCards(channels, page).total, 7);
  assert.deepEqual(fuseHostedWithCards(channels, { offset: 2, limit: 2, floor: true }), { rows: rows.slice(2, 4), total });
});

test("hosted fusion cuts each list to its own pool and rejects misplaced rows before paging", () => {
  const channels = {
    memoryLexical: Array.from({ length: 51 }, (_, i) => lexical("memory", `lexical-${i}`, i)),
    memoryVector: Array.from({ length: 51 }, (_, i) => vector("memory", `vector-${i}`, (50 - i) / 100)),
    cardLexical: Array.from({ length: 51 }, (_, i) => lexical("card", `lexical-${i}`, i)),
    cardVector: Array.from({ length: 51 }, (_, i) => vector("card", `vector-${i}`, (50 - i) / 100)),
  };
  const { rows, total } = fuseHostedWithCards(channels, page);
  assert.equal(total, 200);
  assert.equal(rows.length, total);
  assert.ok(rows.every(row => !row.ref.id.endsWith("-0")));
  for (const [channel, row] of [
    ["memoryLexical", lexical("card", "bad", -1)],
    ["memoryVector", vector("card", "bad", 2)],
    ["cardLexical", lexical("memory", "bad", -1)],
    ["cardVector", vector("raw", "bad", 2)],
  ]) {
    assert.throws(() => fuseHostedWithCards({ ...channels, [channel]: [...channels[channel], row] },
      { offset: 0, limit: 0 }), invalidInput);
  }
});

test("lexical-only card fusion mixes ranks with hosted weights and ties", () => {
  const channels = {
    memoryLexical: [lexical("memory", "z", 100), lexical("memory", "m", 99, 2n)], memoryVector: null,
    cardLexical: [lexical("card", "a", 0.01, 1n), lexical("card", "c", 0.001, 2n)], cardVector: null,
  };
  const { rows, total } = fuseHostedWithCards(channels, { ...page, floor: true });
  assert.equal(total, 4);
  assert.deepEqual(rows.map(row => [row.ref.id, row.lexicalRank, row.vectorRank, row.score]), [
    ["a", 1, null, 0.5 / 61], ["z", 1, null, 0.5 / 61],
    ["m", 2, null, 0.5 / 62], ["c", 2, null, 0.5 / 62],
  ]);
});

function randomGenerator(seed) {
  return max => {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    return Math.floor((seed / 0x100000000) * max);
  };
}

test("random card channels preserve the hosted identity and memory ordering properties", () => {
  const random = randomGenerator(42);
  const candidates = (type, make, measure) => Array.from({ length: random(85) }, () =>
    make(type, String(random(64)), measure(), BigInt(random(6)), random(2) ? scope.namespace : null));
  const lex = type => candidates(type, lexical, () => random(9));
  const vec = type => candidates(type, vector, () => random(21) * 0.05);

  for (let trial = 0; trial < 180; trial++) {
    const memoryLexical = lex("memory");
    const memoryVector = vec("memory");
    const cardLexical = lex("card");
    const cardVector = vec("card");
    const opts = { offset: random(101), limit: random(55), floor: random(2) === 1 };
    const all = { ...page, floor: opts.floor };
    const emptyCards = { cardLexical: [], cardVector: [] };
    assert.deepEqual(fuseHostedWithCards({ memoryLexical, memoryVector, ...emptyCards }, opts),
      fuseHosted(memoryLexical, memoryVector, opts));
    assert.deepEqual(fuseHostedWithCards({ memoryLexical, memoryVector: null, cardLexical: [], cardVector: null }, opts),
      fuseHostedLexicalOnly(memoryLexical, opts));

    for (const cards of [cardVector, null]) {
      const mixed = fuseHostedWithCards({ memoryLexical, memoryVector, cardLexical, cardVector: cards }, all);
      assert.deepEqual(mixed.rows.filter(row => row.ref.type === "memory"), fuseHosted(memoryLexical, memoryVector, all).rows);
      if (cards === null) {
        assert.ok(mixed.rows.filter(row => row.ref.type === "card").every(row => row.vectorRank === null));
      }
    }
    const lexicalOnly = fuseHostedWithCards({ memoryLexical, memoryVector: null, cardLexical, cardVector: null }, all);
    const expected = fuseHostedLexicalOnly(memoryLexical, { offset: 0, limit: cardLexical.length ? 50 : all.limit });
    assert.deepEqual(lexicalOnly.rows.filter(row => row.ref.type === "memory").map(row => row.ref),
      expected.rows.map(row => row.ref));
  }
});

test("find excerpts score CJK and Latin lines and clip at code-point boundaries", () => {
  const item = { id: "card", title: "Notes", date: 42 };
  assert.deepEqual(documentCardFindItem({ ...item, body: "\n購物清單\n𠮷野散步路線\n散步" }, "𠮷野散步", { maxChars: 3 }),
    { type: "card", ...item, excerpt: "𠮷野散", truncated: true });
  assert.deepEqual(documentCardFindItem({ ...item, body: "Lake\nOrchard Trail\nOrchard trail" }, "ORCHARD TRAIL"),
    { type: "card", ...item, excerpt: "Orchard Trail", truncated: false });
  assert.equal(documentCardFindItem({ ...item, body: "\n   \nFirst line\nNext" }, "zz").excerpt, "First line");
  assert.notEqual(documentCardFindItem({ ...item, body: "\n\n" }, "zz", { maxChars: 1 }).excerpt, "");
  assert.equal(documentCardFindItem({ ...item, body: "" }, "zz").excerpt, "");
  assert.equal(documentCardFindItem({ ...item, body: "😀".repeat(241) }, "").excerpt, "😀".repeat(240));
  assert.throws(() => documentCardFindItem({ ...item, body: "One" }, "", { maxChars: 0 }), invalidInput);
});

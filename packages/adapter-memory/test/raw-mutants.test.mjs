import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { registerHooks } from "node:module";
import { test } from "node:test";
import { createMemoryAdapter } from "@cairn-ink/adapter-memory";
import { RAW_CASES, runCase } from "@cairn-ink/conformance";
import { coreDigest, factIncarnationBody } from "@cairn-ink/core";
import { rawFactory } from "./fixtures/raw.mjs";

const adapterURL = new URL("../src/index.mjs", import.meta.url);
const rawURL = new URL("./raw.mjs", adapterURL);

async function variantFactory(name, replacements, options = {}) {
  const adapter = new URL(adapterURL);
  const archive = new URL(rawURL);
  adapter.searchParams.set("variant", name);
  archive.searchParams.set("variant", name);
  let source = readFileSync(rawURL, "utf8");
  for (const [before, after] of replacements) {
    assert.equal(source.split(before).length - 1, 1, `Unexpected mutation sites for ${name}`);
    source = source.replace(before, () => after);
  }
  const hooks = registerHooks({
    resolve(request, context, nextResolve) {
      if (context.parentURL === adapter.href && request === "./raw.mjs") return nextResolve(archive.href, context);
      return nextResolve(request, context);
    },
    load(url, context, nextLoad) {
      if (url === archive.href) return { format: "module", source, shortCircuit: true };
      return nextLoad(url, context);
    },
  });
  try {
    return rawFactory({ ...options, create: (await import(adapter.href)).createMemoryAdapter });
  } finally {
    hooks.deregister();
  }
}

function fixture(ctx) {
  const { raw, snapshot, suppressions, uow } = ctx.adapter;
  const scope = ctx.scope(null);
  const readScope = { owner: ctx.owner, namespaces: [null] };
  const session = { client: "test-client", sessionId: "test-conversation" };
  const capture = { ...session, scope, eventId: "test-event", payloadDigest: "a".repeat(64) };
  const write = (fn) => uow.run(ctx.owner, { pauseLock: true }, fn);
  const read = (fn) => uow.run(ctx.owner, { readOnly: true }, fn);
  return {
    archive: (messages) => write((tx) => raw.archive(tx, capture, messages)),
    allowed: () => read((tx) => raw.archiveAllowed(tx, capture)),
    fence: () => write((tx) => raw.fenceSession(tx, scope, session)),
    purge: (facts) => write((tx) => raw.purgeWithheld(tx, scope, facts)),
    search: () => read((tx) => raw.raw(tx, readScope, "cedar", "search", { limit: 20 })),
    page: (limit = 20, cursor = null) => read((tx) => raw.listRaw(tx, readScope, { limit, cursor })),
    token: () => read((tx) => snapshot.stateToken(tx, readScope)),
    async fact(body) {
      const fact = { ...body, owner: ctx.owner, actionId: "test-forget", origin: "forget" };
      const incarnation = (await ctx.hash(factIncarnationBody(fact))).slice(7);
      const { factId, epoch, createdAtMs } = await write((tx) => suppressions.writeFact(tx, fact, incarnation));
      return { fact, factId, epoch, createdAtMs, incarnation };
    },
  };
}

const item = { id: "test-message", role: "user", content: "cedar garden", occurredAtMs: 1 };
const window = { kind: "window", client: null, window: { startMs: 0, endMs: 2 } };

async function purgeDefinite(ctx) {
  const f = fixture(ctx);
  await f.archive([item]);
  const fact = await f.fact({ kind: "text", mode: "exact", text: { digests: [await coreDigest(item.content)] } });
  assert.deepEqual(await f.purge([fact]), { rawDeleted: 1, ledgerBlanked: 0 });
}

async function refusedVisibility(ctx) {
  const f = fixture(ctx);
  await f.fact(window);
  assert.equal((await f.archive([item])).archived, 0);
  assert.deepEqual((await f.search()).segments, []);
  assert.deepEqual((await f.page()).items, []);
}

async function ordinaryWindow(ctx) {
  const f = fixture(ctx);
  await f.archive([item, { ...item, id: "survivor", occurredAtMs: 3 }]);
  await f.fact(window);
  assert.deepEqual((await f.search()).segments.map(({ messageId }) => messageId), ["survivor"]);
  assert.deepEqual((await f.page()).items.map(({ messageId }) => messageId), ["survivor"]);
}

async function replayCount(ctx) {
  const f = fixture(ctx);
  assert.equal((await f.archive([item])).archived, 1);
  assert.equal((await f.archive([{ ...item, content: "cedar changed" }])).archived, 0);
  assert.equal((await f.page()).items.length, 1);
}

async function unchangedCursor(ctx) {
  const f = fixture(ctx);
  await f.archive([item, { ...item, id: "second", occurredAtMs: 2 }]);
  const { nextCursor } = await f.page(1);
  assert.ok(nextCursor);
  assert.deepEqual((await f.page(1, nextCursor)).items.map(({ messageId }) => messageId), ["second"]);
}

async function allPages(ctx) {
  const f = fixture(ctx);
  const messages = Array.from({ length: 6 }, (_, i) => ({ ...item, id: `message-${i}`, occurredAtMs: i }));
  await f.archive(messages);
  const first = await f.page(2);
  const second = await f.page(2, first.nextCursor);
  const last = await f.page(2, second.nextCursor);
  assert.equal(last.nextCursor, null);
  assert.deepEqual([...first.items, ...second.items, ...last.items].map(({ messageId }) => messageId), messages.map(({ id }) => id));
}

async function fenceVisibility(ctx) {
  const f = fixture(ctx);
  await f.archive([item]);
  await f.fence();
  assert.equal(await f.allowed(), false);
  assert.deepEqual((await f.search()).segments, []);
  assert.deepEqual((await f.page()).items, []);
}

async function changingRevision(ctx) {
  const f = fixture(ctx);
  const token = await f.token();
  assert.equal((await f.archive([item])).archived, 1);
  assert.notEqual(await f.token(), token);
}

const visibleDecision = "match.facts.some((stored) => factHidesRow(stored, candidate, policy) !== false)";
const refusal = "rawArchiveRefused++;";
const purgeKinds = '(fact.kind === "text" || fact.kind === "rawSpan") && fact.owner === target.owner';
const rawSearchRows = "const rows = await visibleRows(getState(), selection);";
const rawSearchRank = "rankLexical(documents, terms, limit).map(publicSegment)";
const insertion = "state.rawRows.set(entry.ref.id, entry);";

function changeWindow(transform) {
  return [
    ["coreDigest, factHidesRow, tokenizeT1", "coreDigest, factHidesRow as coreHidesRow, tokenizeT1"],
    ["const encoder = new TextEncoder();", `const encoder = new TextEncoder();
function factHidesRow(stored, row, policy) {
  const fact = stored.fact;
  return coreHidesRow(fact.kind === "window" ? { ...stored, fact: (${transform})(fact) } : stored, row, policy);
}`],
  ];
}

const mutants = [
  ["purge deletes on ineligible", "K-RAW-8", purgeDefinite, /Purge must retain ineligible rows/, [
    ["candidates.some((stored) => factHidesRow(stored, candidate, policy) === true)",
      "candidates.some((stored) => factHidesRow(stored, candidate, policy) !== false)"],
  ]],
  ["purge deletes window-only rows", "K-RAW-8w", purgeDefinite, /Purge must retain window-only-hidden rows/, [
    [purgeKinds, '(fact.kind === "text" || fact.kind === "rawSpan" || fact.kind === "window") && fact.owner === target.owner'],
  ]],
  ["archive stores then hides refused messages", "K-RAW-2", refusedVisibility, /Refused window messages must never be stored/, [
    [refusal, `${refusal}\n              ${insertion}\n              run.stateWritten = true;`],
  ]],
  ["key conflicts overwrite", "K-RAW-7", replayCount, /A raw key conflict must keep the first row/, [
    ["if (previous) continue;", `if (previous) {\n              ${insertion}\n              run.stateWritten = true;\n              continue;\n            }`],
  ]],
  ["raw search reveals ineligible rows", "K-RAW-3c", ordinaryWindow, /Ineligible client-specific window visibility must be enforced by raw search/, [
    ["async function visibleRows(state, selection)", "async function visibleRows(state, selection, search = false)"],
    [visibleDecision, "match.facts.some((stored) => { const result = factHidesRow(stored, candidate, policy); return search ? result === true : result !== false; })"],
    [rawSearchRows, "const rows = await visibleRows(getState(), selection, true);"],
  ]],
  ["window end is inclusive", "K-RAW-3w", ordinaryWindow, /Half-open window visibility/, changeWindow(
    "(fact) => ({ ...fact, window: { ...fact.window, endMs: fact.window.endMs + 1 } })",
  )],
  ["unknownTime is ignored", "K-RAW-2", refusedVisibility, /unknownTime must refuse arrivals without a time/, changeWindow(
    "({ unknownTime, ...fact }) => fact",
  )],
  ["listRaw ignores the state token", "K-RAW-5", unchangedCursor, /Expected operation to reject/, [
    ["after.token !== token || after.binding !== cursorBinding", "after.binding !== cursorBinding"],
  ]],
  ["the first raw page is oversized", "K-RAW-5", allPages, /A raw page with a next cursor must have exactly limit items/, [
    ["rows.slice(0, limit).map(", "rows.slice(0, limit + (after ? 0 : 1)).map("],
  ]],
  ["raw search reverses BM25 ranks", "K-RAW-4", fenceVisibility, /Raw search must order strict BM25 ranks/, [
    [rawSearchRank, "rankLexical(documents, terms, limit).reverse().map((row) => publicSegment({ ...row, score: 1 }))"],
  ]],
  ["search limits before filtering hidden rows", "K-RAW-4", fenceVisibility, /Raw limit must apply after visibility and ranking/, [
    [rawSearchRows, `const state = getState();
        const visible = new Set((await visibleRows(state, selection)).map((row) => row.ref.id));
        const rows = await visibleRows({ ...state, rawFences: new Set() }, selection);`],
    [rawSearchRank, "rankLexical(documents, terms, limit).filter((row) => visible.has(row.ref.id)).map(publicSegment)"],
  ]],
  ["fence leaves archive writes open", "K-RAW-6", fenceVisibility, /A fenced conversation must refuse later archives/, [
    ["const allowed = allowsArchive(state, scope, admission, facts);",
      "const allowed = allowsArchive({ ...state, rawFences: new Set() }, scope, admission, facts);"],
  ]],
  ["no-op archives advance the revision", "K-RAW-6", changingRevision, /Idempotent and empty archives must advance the revision by 0/, [
    ["if (archived) advanceRevision(run);", "advanceRevision(run);"],
  ]],
];

function rawCase(id) {
  const testCase = RAW_CASES.find((candidate) => candidate.id === id);
  assert.ok(testCase);
  return testCase;
}

for (const [name, id, naive, failure, replacements] of mutants) {
  test(`${id} rejects when ${name} after the naive check passes`, async () => {
    const testCase = rawCase(id);
    const factory = await variantFactory(name, replacements);
    assert.equal(await runCase(factory, { ...testCase, run: naive }), null);
    await assert.rejects(runCase(factory, testCase), failure);
  });
}

async function savedSpan(ctx) {
  return { kind: "rawSpan", startUtf16: 8, endUtf16: 12, messageKey: item.id,
    sessionKeyHash: ctx.harness.hashSessionKey("test-client", "test-conversation"),
    contentDigest: (await ctx.hash(item.content)).slice(7) };
}

for (const sessionRefs of ["plain", "hashed"]) {
  test(`Purged raw span identity refuses a shorter replay (${sessionRefs})`, async () => {
    const result = await runCase(rawFactory({ sessionRefs }), { ...rawCase("K-RAW-8s"), async run(ctx) {
      const f = fixture(ctx);
      assert.equal((await f.archive([item])).archived, 1);
      const span = await f.fact(await savedSpan(ctx));
      assert.deepEqual(await f.purge([span]), { rawDeleted: 1, ledgerBlanked: 0 });
      const before = (await ctx.harness.counters()).rawArchiveRefused;
      const { archived } = await f.archive([{ ...item, content: "cedar" }]);
      assert.deepEqual({ archived, refused: (await ctx.harness.counters()).rawArchiveRefused - before,
        search: (await f.search()).segments.map(({ messageId }) => messageId),
        listing: (await f.page()).items.map(({ messageId }) => messageId) },
      { archived: 0, refused: 1, search: [], listing: [] });
    } });
    assert.equal(result, null);
  });

  test(`K-RAW-4 accepts float32 scores and store-specific ties (${sessionRefs})`, async () => {
    const factory = await variantFactory("float32 scores and reversed ties", [
      [rawSearchRank, `rankLexical(documents, terms, documents.length).reverse()
          .map((row) => publicSegment({ ...row, score: Math.fround(row.score) }))
          .sort((a, b) => b.score - a.score).slice(0, limit)`],
    ], { sessionRefs });
    assert.equal(await runCase(factory, rawCase("K-RAW-4")), null);
  });
}

test("Raw span admission refuses an ineligible identity", async () => {
  const factory = rawFactory({ sessionRefs: "hashed",
    create: (options) => createMemoryAdapter({ ...options, hashSessionKey: () => null }) });
  const result = await runCase(factory, { ...rawCase("K-RAW-2s"), async run(ctx) {
    const f = fixture(ctx);
    await f.fact(await savedSpan(ctx));
    const before = await ctx.harness.dump();
    const { archived } = await f.archive([item]);
    assert.deepEqual({ archived, refused: (await ctx.harness.counters()).rawArchiveRefused }, { archived: 0, refused: 1 });
    assert.deepEqual(await ctx.harness.dump(), before);
  } });
  assert.equal(result, null);
});

function withoutHasher(sessionRefs, purgeWithheld) {
  const factory = rawFactory({ sessionRefs });
  return {
    ...factory,
    async open(options) {
      const opened = await factory.open(options);
      const { hashSessionKey, ...harness } = opened.harness;
      if (purgeWithheld) opened.adapter.raw.purgeWithheld = purgeWithheld;
      return { ...opened, harness };
    },
  };
}

test("Hashed raw cases reject a missing session hasher", async () => {
  const factory = withoutHasher("hashed");
  for (const id of ["K-RAW-2s", "K-RAW-3", "K-RAW-3s", "K-RAW-8", "K-RAW-8s"]) {
    await assert.rejects(runCase(factory, rawCase(id)), /require harness\.hashSessionKey/, id);
  }
});

test("K-RAW-8s rejects a hashed no-op purge factory with no session hasher", async () => {
  const factory = withoutHasher("hashed", async () => ({ rawDeleted: 0, ledgerBlanked: 0 }));
  await assert.rejects(runCase(factory, rawCase("K-RAW-8s")), /require harness\.hashSessionKey/);
});

for (const sessionRefs of ["plain", "hashed"]) {
  test(`K-RAW-8 checks text deletion without a session hasher (${sessionRefs})`, async () => {
    const factory = withoutHasher(sessionRefs, async () => ({ rawDeleted: 0, ledgerBlanked: 0 }));
    await assert.rejects(runCase(factory, rawCase("K-RAW-8")), /Purge must delete only the definite text match/);
  });
}

test("All raw cases accept different storage order and opaque ids", async (t) => {
  const factory = await variantFactory("ordered differently", [
    ["JSON.stringify([owner, namespace, client, sessionId, id])",
      'JSON.stringify(["message", id, sessionId, client, namespace, owner])'],
    [insertion, "state.rawRows = new Map([[entry.ref.id, entry], ...state.rawRows]);"],
  ]);
  for (const testCase of RAW_CASES) {
    await t.test(testCase.id, async () => {
      assert.equal(await runCase(factory, testCase), null);
    });
  }
});

import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import { test } from "node:test";
import { createBM25, termFrequencies } from "@cairn-ink/core";
import { createMemoryService } from "@cairn-ink/core/service";
import { assemblyClock, fixtureCount, formatAssembly } from "@cairn-ink/conformance/context-assembly";
import { rawSegment } from "../src/raw-rows.mjs";
import { receiptIdentityDenial, receiptIdentityKey } from "../src/receipt-identity.mjs";
import { openStorage } from "../src/schema/open.mjs";
import { archivedReceiptExcerpt, scopeKey } from "../src/storage-values.mjs";

const core = JSON.stringify(import.meta.resolve("@cairn-ink/core"));
const observedCore = "data:text/javascript," + encodeURIComponent(`
  export * from ${core};
  import { scoreBM25 as score } from ${core};
  export const observation = { calls: null };
  export function scoreBM25(terms, document, stats) {
    observation.calls?.push({ N: stats.N, totalLength: stats.totalLength,
      averageLength: stats.totalLength / stats.N, df: Object.fromEntries(stats.df) });
    return score(terms, document, stats);
  }
`);
const rawReader = new URL("../src/context-raw-read.mjs", import.meta.url).href;
const hook = registerHooks({
  resolve(specifier, context, nextResolve) {
    return nextResolve(context.parentURL === rawReader && specifier === "@cairn-ink/core" ? observedCore : specifier, context);
  },
});
const { observation } = await import(observedCore);
let createSqliteAdapter;
try {
  ({ createSqliteAdapter } = await import("../src/adapter.mjs"));
} finally {
  hook.deregister();
}
const { scratch, sha256 } = await import("./storage-fixtures.mjs");

const scope = { owner: "owner", namespace: null };
const readSet = { owner: scope.owner, namespaces: [scope.namespace], accessGenerations: [1] };
const source = { kind: "mcp", client: null, sessionId: null };
const write = (adapter, work) => adapter.uow.run(scope.owner, { pauseLock: true }, work);
const rawItems = result => result.assembly.items.flatMap(item =>
  item.ref.type === "raw" ? [item.ref] : (item.evidence ?? []).map(({ ref }) => ref));

async function open(t, monotonicMs = () => performance.now()) {
  const file = scratch();
  let adapter;
  t.after(async () => {
    try { await adapter?.close(); }
    finally { file.remove(); }
  });
  const storage = await openStorage(file.path);
  adapter = createSqliteAdapter(storage, { monotonicMs, capabilities: { contextRead: true, contextRawRead: true } });
  const service = createMemoryService({ storage: adapter, profile: "keyless-local", clock: assemblyClock(monotonicMs),
    contextReadCounter: { count: fixtureCount }, contextReadFormat: formatAssembly });
  return { adapter, service, port: storage.port };
}

function message(id, content, role = "user") {
  return { id, role, content, occurredAtMs: Date.UTC(2025, 0, 2) };
}

async function cite(adapter, tx, session, turn, index, eventId = turn.id) {
  const key = { scope, ...session, eventId, payloadDigest: sha256(turn.content) };
  assert.equal((await adapter.capture.admit(tx, key, [turn])).status, "admitted");
  const claim = await adapter.capture.claim(tx, key, [turn], { leaseMs: 10_000 });
  assert.equal(claim.status, "claimed");
  await adapter.capture.beginDispatch(tx, claim.token);
  await adapter.capture.assertEligible(tx, key, [0]);
  const content = `A field note numbered ${index}.`;
  const result = await adapter.capture.finish(tx, claim.token, [{
    content, kind: "fact", confidence: 0.9, embedding: null, textHash: "sha256:" + sha256(content.toLowerCase()),
    receipts: [{ ...session, messageId: turn.id, role: turn.role, occurredAtMs: turn.occurredAtMs }],
  }]);
  assert.equal(result.memories.length, 1);
}

function denyIdentity({ adapter, port }, session, turn) {
  const key = receiptIdentityKey({ ...session, messageId: turn.id, role: turn.role, excerpt: archivedReceiptExcerpt(turn.content) });
  return write(adapter, tx => port(tx, scope.owner, { write: true }, db =>
    db.prepare("INSERT INTO cairn_legacy_denials VALUES (?, ?, ?)").run(...scopeKey(scope), receiptIdentityDenial(key))));
}

async function publish(adapter) {
  for (let i = 0; i < 3; i++) if (await adapter.maintainContextRaw(readSet)) return;
  assert.fail("Raw inventory checkpoint did not publish");
}

function search(adapter, query, options = {}) {
  return adapter.uow.run(scope.owner, { readOnly: true }, tx =>
    adapter.contextRead.raw.search(tx, readSet, query, { limit: 24, lexicalOnly: true, ...options }));
}

function revalidate(adapter, turns) {
  return adapter.uow.run(scope.owner, { readOnly: true }, tx => adapter.contextRead.raw.revalidate(tx, readSet, turns));
}

async function searchWithStats(adapter, query) {
  const calls = [];
  observation.calls = calls;
  try {
    const result = await search(adapter, query);
    assert.equal(calls.length, result.turns.length);
    assert.ok(calls.length > 0);
    for (const stats of calls) assert.deepEqual(stats, calls[0]);
    return { ...result, stats: calls[0] };
  } finally {
    observation.calls = null;
  }
}

function read(service, query, options = {}) {
  return service.readContext(readSet, { query, types: ["memory"], intent: "current", raw: true,
    budget: { maxItems: 12, maxTokens: 3000 }, ...options });
}

async function forget(adapter, text) {
  const writer = createMemoryService({ storage: adapter, config: {}, model: null, embedder: null,
    gate: { async assertOpen() {} }, clock: assemblyClock(), tokens: { countTokens: fixtureCount } });
  const saved = await writer.save(scope, text, source);
  assert.equal(saved.status, "saved");
  assert.equal((await writer.forget(scope, saved.item.id, source)).status, "forgotten");
}

// Every fixture row has this term, so this scan applies the full proof to
// every row before the test builds an independent BM25 corpus.
async function fullCorpus(adapter, count) {
  const { turns, coverage } = await search(adapter, "archive", { limit: 4096 });
  assert.equal(coverage, "included");
  assert.equal(turns.length, count);
  return createBM25(turns.map(turn => {
    const [client, sessionId] = JSON.parse(turn.conversationId);
    const raw = { client, sessionId, message: message(turn.messageId, turn.ranges[0].text, turn.role) };
    return { ref: rawSegment(turn.scope, raw, 0).ref, text: raw.message.content, turn };
  }));
}

test("Real-size Raw inventory keeps cited proof inside the default Context Read deadline", async t => {
  const fixture = await open(t);
  const { adapter, service } = fixture;
  const prefix = ("archive wave ".repeat(63)).slice(0, 800);
  const forgotten = message("turn-2", prefix + " quartzspire");
  const denied = message("turn-4", "archive cypressgate stood beside the steps");
  const firstSession = { client: "client", sessionId: "thread-0" };
  const vocabulary = ["pebble", "cedar", "granite", "fern", "ochre"];
  assert.equal(archivedReceiptExcerpt(forgotten.content), prefix);

  await write(adapter, async tx => {
    for (let group = 0; group < 125; group++) {
      const session = { ...firstSession, sessionId: `thread-${group}` }, messages = [];
      for (let offset = 0; offset < 10; offset++) {
        const i = group * 10 + offset;
        const note = vocabulary[i % vocabulary.length];
        const user = i === 2 ? forgotten : i === 4 ? denied : message(`turn-${i}`,
          i === 0 ? "archive heliotrope grows in the stone planter" : `archive ${note} ${("field ").repeat(i % 9 + 16)}${i}`);
        messages.push(user, message(`reply-${i}`, `archive ${note} ${("record ").repeat(i % 7 + 12)}${i}`, "assistant"));
      }
      assert.equal((await adapter.raw.importArchive(tx, scope, session, messages)).archived, messages.length);
      for (let i = 0; i < 10; i += 2) await cite(adapter, tx, session, messages[2 * i], group * 10 + i);
    }
  });
  await publish(adapter);

  await t.test("a keyless default-deadline read includes the cited turn and covers Raw", async t => {
    const raw = adapter.contextRead.raw, original = raw.search;
    let elapsed;
    raw.search = async (...args) => {
      const start = performance.now();
      try { return await original(...args); }
      finally { elapsed = performance.now() - start; }
    };
    t.after(() => { raw.search = original; });
    const result = await read(service, "heliotrope");
    assert.deepEqual(rawItems(result).map(({ messageId }) => messageId), ["turn-0"]);
    assert.equal(result.diagnostics.coverage.raw, "included");
    assert.ok(elapsed < 400, `Raw search took ${elapsed?.toFixed(1)} ms`);
    t.diagnostic(`Raw search took ${elapsed.toFixed(1)} ms`);
  });

  await t.test("query turns and their order agree with a full-proof corpus", async () => {
    const full = await fullCorpus(adapter, 2500);
    for (const query of ["heliotrope", "granite", "cedar fern", "ochre record", "quartzspire cypressgate", "missing"]) {
      const limit = 24;
      const expected = full.searchWithCount(query, limit);
      assert.deepEqual(await search(adapter, query, { limit }), {
        turns: expected.rows.map(({ turn }) => turn), coverage: expected.matched > limit ? "partial" : "included",
      }, query);
    }
  });

  await t.test("the forgotten prefix and receipt identity stay hidden on their only matches", async () => {
    for (const [query, turn] of [["quartzspire", forgotten], ["cypressgate", denied]]) {
      assert.deepEqual((await search(adapter, query)).turns.map(({ messageId }) => messageId), [turn.id]);
    }
    await forget(adapter, prefix);
    await denyIdentity(fixture, firstSession, denied);
    await publish(adapter);
    for (const query of ["quartzspire", "cypressgate"]) {
      assert.deepEqual(await search(adapter, query), { turns: [], coverage: "included" });
      const result = await read(service, query, { deadlineMs: 5000 });
      assert.deepEqual(rawItems(result), []);
      assert.equal(result.diagnostics.coverage.raw, "included");
    }
  });
});

test("Forgetting a long nonmatch removes exactly its contribution to the Raw corpus", async t => {
  const { adapter } = await open(t);
  const session = { client: "client", sessionId: "thread" };
  const rows = [
    message("marble", "archive marble marble tile slab grain"),
    message("copper", "archive copper"),
    message("gravel", "archive gravel " + "The trail curves along the lakeshore. ".repeat(12).trimEnd()),
  ];
  assert.equal((await write(adapter, tx => adapter.raw.importArchive(tx, scope, session, rows))).archived, rows.length);
  await publish(adapter);
  const query = "marble copper";
  const lengths = rows.map(({ content }) => termFrequencies(content).length);
  const matchingLength = lengths[0] + lengths[1];
  const df = { marble: 1, copper: 1 };
  assert.deepEqual((await searchWithStats(adapter, query)).stats, {
    N: 3, totalLength: matchingLength + lengths[2], averageLength: (matchingLength + lengths[2]) / 3, df,
  });
  await forget(adapter, rows[2].content);
  await publish(adapter);
  assert.deepEqual((await searchWithStats(adapter, query)).stats, {
    N: 2, totalLength: matchingLength, averageLength: matchingLength / 2, df,
  });
});

test("A matching turn that fails address proof is neither counted nor scored", async t => {
  const fixture = await open(t);
  const { adapter } = fixture;
  const session = { client: "client", sessionId: "thread" };
  const visible = message("visible", "archive marble copper");
  const denied = message("denied", "archive marble copper silver");
  const query = "marble copper silver";
  await write(adapter, tx => adapter.raw.importArchive(tx, scope, session, [visible]));
  await publish(adapter);
  const withoutDenied = await searchWithStats(adapter, query);
  assert.deepEqual(withoutDenied.stats.df, { marble: 1, copper: 1 });
  await write(adapter, async tx => {
    await adapter.raw.importArchive(tx, scope, session, [denied]);
    await cite(adapter, tx, session, denied, 0);
  });
  assert.equal((await search(adapter, "silver")).turns[0].messageId, denied.id);
  await denyIdentity(fixture, session, denied);
  await publish(adapter);
  const withDenied = await searchWithStats(adapter, query);
  assert.deepEqual(withDenied.turns.map(({ messageId }) => messageId), [visible.id]);
  assert.equal(withDenied.coverage, "included");
  assert.deepEqual(withDenied.stats, withoutDenied.stats);
});

test("A Raw deadline during the inventory scan returns no turns", async t => {
  let clock = 0;
  const { adapter } = await open(t, () => clock++);
  const session = { client: "client", sessionId: "thread" };
  await write(adapter, tx => adapter.raw.importArchive(tx, scope, session,
    Array.from({ length: 100 }, (_, i) => message(`turn-${i}`, "archive clover"))));
  await publish(adapter);
  assert.equal((await search(adapter, "clover")).turns.length, 24);
  assert.deepEqual(await search(adapter, "clover", { deadlineAtMs: clock + 30 }), { turns: [], coverage: "partial" });
});

test("Large fenced turns leave time for the visible cited turn", async t => {
  const { adapter, service } = await open(t);
  const session = { client: "client", sessionId: "visible" };
  const fenced = { ...session, sessionId: "fenced" };
  const visible = message("turn", "archive heliotrope by the planter");
  const text = "青石".repeat(10_000);
  const hidden = Array.from({ length: 600 }, (_, i) => message(`hidden-${i}`, text));
  await write(adapter, async tx => {
    assert.equal((await adapter.raw.importArchive(tx, scope, session, [visible])).archived, 1);
    await cite(adapter, tx, session, visible, 0);
    assert.equal((await adapter.raw.importArchive(tx, scope, fenced, hidden)).archived, hidden.length);
    await adapter.raw.fenceSession(tx, scope, fenced);
  });
  await publish(adapter);

  const result = await read(service, "heliotrope");
  assert.deepEqual(rawItems(result).map(({ messageId }) => messageId), [visible.id]);
  assert.equal(result.diagnostics.coverage.raw, "included");
});

test("An unproved nonmatch can affect Raw order through corpus length and count", async t => {
  const fixture = await open(t);
  const { adapter } = fixture;
  const session = { client: "client", sessionId: "thread" };
  const longMatch = message("long", "archive marble marble tile slab grain");
  const shortMatch = message("short", "archive copper");
  const nonmatch = message("nonmatch", "archive " + "gravel ".repeat(50));
  await write(adapter, async tx => {
    const rows = [longMatch, shortMatch, nonmatch];
    assert.equal((await adapter.raw.importArchive(tx, scope, session, rows)).archived, rows.length);
    await cite(adapter, tx, session, nonmatch, 0);
  });
  await publish(adapter);
  const query = "marble copper";
  const visibleCorpus = await fullCorpus(adapter, 3);
  const expectedOrder = visibleCorpus.search(query).map(({ turn }) => turn.messageId);
  assert.deepEqual(expectedOrder, [longMatch.id, shortMatch.id]);
  assert.deepEqual((await search(adapter, query)).turns.map(({ messageId }) => messageId), expectedOrder);

  await denyIdentity(fixture, session, nonmatch);
  await publish(adapter);
  const full = await fullCorpus(adapter, 2);
  const fullOrder = full.search(query).map(({ turn }) => turn.messageId);
  assert.deepEqual(fullOrder, [shortMatch.id, longMatch.id]);
  const { turns, coverage, stats } = await searchWithStats(adapter, query);
  const actual = turns.map(({ messageId }) => messageId);
  assert.equal(coverage, "included");
  assert.deepEqual(new Set(actual), new Set(fullOrder));
  assert.deepEqual(actual, expectedOrder);
  assert.deepEqual(stats, { N: visibleCorpus.N, totalLength: visibleCorpus.totalLength,
    averageLength: visibleCorpus.avgLength, df: { marble: 1, copper: 1 } });
});

test("Raw search and revalidation find a proving capture in a long session", async t => {
  const { adapter, port } = await open(t);
  const session = { client: "client", sessionId: "thread" };
  const turn = message("turn", "archive heliotrope by the planter");
  const provingEvent = "z-capture";
  await write(adapter, async tx => {
    assert.equal((await adapter.raw.importArchive(tx, scope, session, [turn])).archived, 1);
    await cite(adapter, tx, session, turn, 0, provingEvent);
    for (let i = 0; i < 1024; i++) {
      const other = message(`other-${i}`, "archive pebble");
      const key = { scope, ...session, eventId: `a-capture-${i}`, payloadDigest: sha256(other.content) };
      assert.equal((await adapter.capture.admit(tx, key, [other])).status, "admitted");
      const claim = await adapter.capture.claim(tx, key, [other], { leaseMs: 10_000 });
      assert.equal(claim.status, "claimed");
      await adapter.capture.beginDispatch(tx, claim.token);
      assert.equal((await adapter.capture.finish(tx, claim.token, [])).memories.length, 0);
    }
    await port(tx, scope.owner, { write: true }, db => db.exec("ANALYZE"));
  });
  await publish(adapter);

  const query = "heliotrope";
  const started = performance.now();
  const { turns, coverage } = await search(adapter, query, { deadlineAtMs: started + 400 });
  t.diagnostic(`Last capture proof took ${(performance.now() - started).toFixed(1)} ms`);
  assert.equal(coverage, "included");
  assert.deepEqual(turns.map(({ messageId }) => messageId), [turn.id]);
  assert.equal(await revalidate(adapter, turns), true);

  await write(adapter, tx => port(tx, scope.owner, { write: true }, db => {
    assert.equal(db.prepare(`UPDATE cairn_capture_outbox SET messages = '[]'
      WHERE owner_id = ? AND client_key = ? AND event_key = ?`)
      .run(scope.owner, JSON.stringify(session.client), JSON.stringify(provingEvent)).changes, 1);
  }));
  assert.deepEqual(await search(adapter, query), { turns: [], coverage: "included" });
  assert.equal(await revalidate(adapter, turns), false);
});

test("An early capture proof leaves large unrelated payloads unread", async t => {
  const { adapter, port } = await open(t);
  const session = { client: "client", sessionId: "thread" };
  const turn = message("turn", "archive heliotrope by the planter");
  const provingEvent = "a-capture";
  const unrelated = "pebble".repeat(50_000);
  await write(adapter, async tx => {
    assert.equal((await adapter.raw.importArchive(tx, scope, session, [turn])).archived, 1);
    await cite(adapter, tx, session, turn, 0, provingEvent);
    await port(tx, scope.owner, { write: true }, db => {
      const client = JSON.stringify(session.client), first = JSON.stringify(provingEvent);
      const insertClaim = db.prepare(`INSERT INTO cairn_capture_claims
        (owner_id, namespace_key, client_key, event_key, session_key, payload_digest, status)
        SELECT owner_id, namespace_key, client_key, ?, session_key, payload_digest, status
        FROM cairn_capture_claims WHERE owner_id = ? AND client_key = ? AND event_key = ?`);
      const insertOutbox = db.prepare(`INSERT INTO cairn_capture_outbox
        SELECT owner_id, client_key, ?, ?, result
        FROM cairn_capture_outbox WHERE owner_id = ? AND client_key = ? AND event_key = ?`);
      for (let i = 0; i < 1024; i++) {
        const event = JSON.stringify(`z-capture-${i}`);
        assert.equal(insertClaim.run(event, scope.owner, client, first).changes, 1);
        const messages = JSON.stringify([message(`unrelated-${i}`, unrelated)]);
        assert.equal(insertOutbox.run(event, messages, scope.owner, client, first).changes, 1);
      }
      db.exec("ANALYZE");
    });
  });
  await publish(adapter);

  const startSearch = performance.now();
  const { turns, coverage } = await search(adapter, "heliotrope", { deadlineAtMs: startSearch + 400 });
  const searchMs = performance.now() - startSearch;
  assert.equal(coverage, "included");
  assert.deepEqual(turns.map(({ messageId }) => messageId), [turn.id]);
  const startRevalidation = performance.now();
  assert.equal(await revalidate(adapter, turns), true);
  const revalidateMs = performance.now() - startRevalidation;
  t.diagnostic(`First capture proof search took ${searchMs.toFixed(1)} ms, revalidation took ${revalidateMs.toFixed(1)} ms`);
  assert.ok(searchMs < 150);
  assert.ok(revalidateMs < 150);
});

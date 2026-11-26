import assert from "node:assert/strict";
import { test } from "node:test";
import { createBM25 } from "@cairn-ink/core";
import { createMemoryService } from "@cairn-ink/core/service";
import { assemblyClock, fixtureCount, formatAssembly } from "@cairn-ink/conformance/context-assembly";
import { createSqliteAdapter } from "../src/adapter.mjs";
import { rawSegment } from "../src/raw-rows.mjs";
import { receiptIdentityDenial, receiptIdentityKey } from "../src/receipt-identity.mjs";
import { openStorage } from "../src/schema/open.mjs";
import { archivedReceiptExcerpt, scopeKey } from "../src/storage-values.mjs";
import { scratch, sha256 } from "./storage-fixtures.mjs";

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

async function cite(adapter, tx, session, turn, index) {
  const key = { scope, ...session, eventId: turn.id, payloadDigest: sha256(turn.content) };
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

function read(service, query, options = {}) {
  return service.readContext(readSet, { query, types: ["memory"], intent: "current", raw: true,
    budget: { maxItems: 12, maxTokens: 3000 }, ...options });
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

  await t.test("the forgotten prefix and receipt identity stay hidden on their only matches", async () => {
    for (const [query, turn] of [["quartzspire", forgotten], ["cypressgate", denied]]) {
      assert.deepEqual((await search(adapter, query)).turns.map(({ messageId }) => messageId), [turn.id]);
    }
    const writer = createMemoryService({ storage: adapter, config: {}, model: null, embedder: null,
      gate: { async assertOpen() {} }, clock: assemblyClock(), tokens: { countTokens: fixtureCount } });
    const saved = await writer.save(scope, prefix, source);
    assert.equal(saved.status, "saved");
    assert.equal((await writer.forget(scope, saved.item.id, source)).status, "forgotten");
    await denyIdentity(fixture, firstSession, denied);
    await publish(adapter);
    for (const query of ["quartzspire", "cypressgate"]) {
      assert.deepEqual(await search(adapter, query), { turns: [], coverage: "included" });
      const result = await read(service, query, { deadlineMs: 5000 });
      assert.deepEqual(rawItems(result), []);
      assert.equal(result.diagnostics.coverage.raw, "included");
    }
  });

  await t.test("query turns and their order agree with a full-proof corpus", async () => {
    const full = await fullCorpus(adapter, 2498);
    for (const query of ["heliotrope", "granite", "cedar fern", "ochre record", "quartzspire cypressgate", "missing"]) {
      const limit = 24;
      const expected = full.searchWithCount(query, limit);
      assert.deepEqual(await search(adapter, query, { limit }), {
        turns: expected.rows.map(({ turn }) => turn), coverage: expected.matched > limit ? "partial" : "included",
      }, query);
    }
  });
});

test("An unproved nonmatch can affect the order and limit of the matching turns", async t => {
  const fixture = await open(t);
  const { adapter } = fixture;
  const session = { client: "client", sessionId: "thread" };
  const rows = [
    message("marble", "archive marble marble tile slab grain"),
    message("copper", "archive copper"),
    message("gravel", "archive " + "gravel ".repeat(50)),
  ];
  await write(adapter, async tx => {
    assert.equal((await adapter.raw.importArchive(tx, scope, session, rows)).archived, 3);
    await cite(adapter, tx, session, rows[2], 0);
  });
  const query = "marble copper";
  assert.equal((await search(adapter, query, { limit: 1 })).turns[0].messageId, "marble");
  await denyIdentity(fixture, session, rows[2]);
  await publish(adapter);
  const expected = (await fullCorpus(adapter, 2)).search(query, 1).map(({ turn }) => turn);
  assert.equal(expected[0].messageId, "copper");
  assert.deepEqual(await search(adapter, query, { limit: 1 }), { turns: expected, coverage: "partial" });
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

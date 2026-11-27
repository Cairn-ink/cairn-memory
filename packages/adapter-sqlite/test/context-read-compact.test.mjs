import assert from "node:assert/strict";
import { test } from "node:test";
import { createMemoryService } from "@cairn-ink/core/service";
import { assemblyClock, fixtureCount, formatAssembly } from "@cairn-ink/conformance/context-assembly";
import { createMemoryAdapter } from "../../adapter-memory/src/index.mjs";
import { readTokenSigner } from "../../core/src/service/context-read-tokens.mjs";
import { openSqliteAdapter } from "../src/index.mjs";
import { scratch, sha256 } from "./storage-fixtures.mjs";
import { waitForVectorCache } from "./vector-fixtures.mjs";

const scope = { owner: "reader", namespace: "project\0observations" };
const readSet = { owner: scope.owner, namespaces: [scope.namespace], accessGenerations: [1] };
const capabilities = { contextRead: true, contextRawRead: true, rawArchive: true, semanticRetrieval: true };
const input = { query: "telescope", types: ["memory"], intent: "current", raw: false, deadlineMs: 5000 };
const compact = { ...input, representation: "memory-compact-v1" };
const embedding = { model: "fixture", vector: Float32Array.of(1) };
const source = { kind: "mcp", client: null, sessionId: null };
const corpus = Array.from({ length: 64 }, (_, i) => ({
  text: "Telescope observation " + String(i).padStart(2, "0") + ".",
  occurredAtMs: i === 0 ? null : Date.UTC(2026, 0, 65 - i),
}));

function serviceFor(storage, counts) {
  return createMemoryService({
    storage, clock: assemblyClock(() => 0), config: {}, gate: { async assertOpen() {} },
    embedder: null, embedQuery: { async embedQuery() { return embedding; } },
    tokens: { countTokens: fixtureCount }, contextReadFormat: formatAssembly,
    contextReadCounter: { count(text) { counts.push(text); return fixtureCount(text); } },
  });
}

async function seed(storage, entries = corpus) {
  await storage.uow.run(scope.owner, { pauseLock: true }, async tx => {
    for (const [i, { text, occurredAtMs }] of entries.entries()) {
      await storage.memories.insert(tx, scope, {
        text, embedding, source, kind: "fact", origin: "explicit", confidence: 1, textHash: "sha256:" + sha256(text),
      }, [{ id: "receipt-" + i, client: "fixture", sessionId: "observation", eventId: String(i),
        role: "user", excerpt: "Source " + i, messageId: "turn-" + i, occurredAtMs, createdAtMs: 1 }], 1);
    }
  });
}

async function openAdapters(t, options = { capabilities }) {
  const file = scratch();
  let sqlite;
  t.after(async () => {
    try { await sqlite?.close(); }
    finally { file.remove(); }
  });
  // Core's deadline comes from the fixture clock fixed at 0, so SQLite checks it on the same clock.
  sqlite = await openSqliteAdapter(file.path, { monotonicMs: () => 0, ...options });
  return [sqlite, createMemoryAdapter(options)];
}

test("SQLite and memory adapters return the same 64 compact items in lexical and hybrid reads", async t => {
  const [sqlite, memory] = await openAdapters(t);
  await seed(sqlite);
  await seed(memory);
  const expected = [...corpus.slice(1).reverse(), corpus[0]].map(({ text, occurredAtMs }) => ({
    date: occurredAtMs === null ? null : new Date(occurredAtMs).toISOString().slice(0, 16) + "Z", body: text,
  }));

  const results = [];
  for (const [name, storage] of [["SQLite", sqlite], ["memory", memory]]) await t.test(name, async () => {
    const counts = [];
    const { contextRead } = storage;
    let rawCalls = 0;
    const service = serviceFor({ ...storage, contextRead: { ...contextRead, raw: {
      ...contextRead.raw,
      search() { rawCalls++; assert.fail("compact searched Raw"); },
      revalidate() { rawCalls++; assert.fail("compact revalidated Raw"); },
    } } }, counts);
    const read = request => service.readContext(readSet, request);
    const legacy = [];
    // Warm the lexical projection before taking byte comparisons. Warming a
    // projection can change its maintenance diagnostics on the next read.
    await read({ ...input, semantic: false });
    if (storage === sqlite) await waitForVectorCache(storage, scope.owner);
    for (const semantic of [false, true]) {
      for (const representation of ["representation-v2", "representation-v2-dated"]) {
        const request = { ...input, semantic, representation };
        counts.length = 0;
        const result = await read(request);
        assert.deepEqual(result.diagnostics.candidates.coverage.depths, { lexical: 24, semantic: semantic ? 24 : 0 });
        assert.equal(result.diagnostics.candidates.trace.effective, semantic ? "hybrid" : "lexical");
        assert.ok(result.assembly.items.length >= (semantic ? 12 : 24) && result.assembly.items.length <= 24);
        legacy.push({ request, wire: JSON.stringify(result), counted: [...counts] });
      }
    }
    const bodies = [];
    for (const semantic of [false, true]) {
      const value = await read({ ...compact, semantic });
      assert.equal(value.assembly.items.length, 64);
      assert.equal(value.diagnostics.candidates.count, 64);
      assert.equal(value.diagnostics.candidates.trace.preset, "rrf-k60-d64-compact");
      assert.deepEqual(value.diagnostics.candidates.coverage.depths, { lexical: 64, semantic: semantic ? 64 : 0 });
      assert.equal(value.diagnostics.candidates.trace.effective, semantic ? "hybrid" : "lexical");
      if (semantic) assert.ok(value.diagnostics.candidates.ranks.every(({ lexical, semantic }) => lexical && semantic));
      assert.deepEqual(value.assembly.items, expected);
      if (value.snapshot !== null) {
        const replay = await service.fetchEvidence(readSet, { snapshot: value.snapshot });
        assert.equal(replay.snapshot, value.snapshot);
        assert.deepEqual(replay.items.map(item => item.text).sort(), corpus.map(item => item.text));
      }
      bodies.push(value.assembly.items);
    }
    const limited = await read({ ...compact, semantic: false, budget: { maxItems: 24 } });
    const replay = await service.fetchEvidence(readSet, { snapshot: limited.snapshot });
    assert.equal(replay.snapshot, limited.snapshot);
    assert.equal(replay.items.length, 24);
    assert.equal(rawCalls, 0);

    for (const { request, wire, counted } of legacy) {
      counts.length = 0;
      assert.equal(JSON.stringify(await read(request)), wire);
      assert.deepEqual(counts, counted);
    }
    results.push(bodies);
  });
  assert.deepEqual(results, [[expected, expected], [expected, expected]]);
});

test("compact keeps 24 bodies when multibyte IDs exceed the snapshot limit", async () => {
  let nextId = 0;
  const storage = createMemoryAdapter({ capabilities, newId: () => "界".repeat(195) + String(nextId++).padStart(5, "0") });
  const entries = corpus.slice(0, 24);
  await seed(storage, entries);
  const service = serviceFor(storage, []);
  const request = { ...compact, semantic: false };
  const value = await service.readContext(readSet, request);
  assert.deepEqual(value.assembly.items.map(item => item.body).sort(), entries.map(item => item.text));
  assert.equal(value.diagnostics.items.length, 24);
  assert.ok(value.diagnostics.items.every(({ ref }) => ref.id.length === 200 && Buffer.byteLength(ref.id) === 590));
  assert.equal(value.diagnostics.stops.budget, false);
  assert.equal(value.snapshot, null);
  const small = await service.readContext(readSet, { ...request, budget: { maxItems: 1 } });
  assert.equal(typeof small.snapshot, "string");
  const replay = await service.fetchEvidence(readSet, { snapshot: small.snapshot });
  assert.deepEqual(replay.items.map(item => item.text), small.assembly.items.map(item => item.body));
});

test("compact defaults to hybrid with semantic support and honors semantic false", async t => {
  const [sqlite, memory] = await openAdapters(t);
  const lexical = corpus[0];
  const vectorOnly = { text: "Brass instrument.", occurredAtMs: null };
  for (const [name, storage] of [["SQLite", sqlite], ["memory", memory]]) await t.test(name, async () => {
    await seed(storage, [lexical, vectorOnly]);
    if (storage === sqlite) await waitForVectorCache(storage, scope.owner);
    const service = serviceFor(storage, []);
    const hybrid = await service.readContext(readSet, compact);
    assert.equal(hybrid.diagnostics.candidates.trace.effective, "hybrid");
    assert.deepEqual(hybrid.assembly.items.map(item => item.body).sort(), [vectorOnly.text, lexical.text]);
    const lexicalOnly = await service.readContext(readSet, { ...compact, semantic: false });
    assert.equal(lexicalOnly.diagnostics.candidates.trace.effective, "lexical");
    assert.deepEqual(lexicalOnly.assembly.items.map(item => item.body), [lexical.text]);
  });
});

test("compact refuses historical reads and previously signed historical snapshots", async t => {
  const [sqlite, memory] = await openAdapters(t, { capabilities: { ...capabilities, supersession: true } });
  const entry = corpus[0];
  for (const [name, storage] of [["SQLite", sqlite], ["memory", memory]]) await t.test(name, async () => {
    await seed(storage, [entry]);
    const service = serviceFor(storage, []);
    const current = await service.readContext(readSet, { ...compact, semantic: false });
    await storage.uow.run(scope.owner, { pauseLock: true }, tx =>
      storage.supersession.markHistorical(tx, scope, current.diagnostics.items[0].ref.id, 2));
    const history = { ...input, intent: "history", semantic: false };
    const legacy = await service.readContext(readSet, history);
    assert.deepEqual(legacy.assembly.items.map(item => item.body), [entry.text]);
    await assert.rejects(service.readContext(readSet, { ...history, representation: compact.representation }), error => {
      assert.equal(error.code, "invalid_input");
      assert.equal(error.diagnostics, undefined);
      assert.ok(!JSON.stringify(error).includes(entry.text));
      return true;
    });
    const identity = await storage.uow.run(scope.owner, { readOnly: true }, tx => storage.contextRead.identity(tx));
    const payload = JSON.parse(Buffer.from(legacy.snapshot.split(".")[0], "base64url"));
    const snapshot = await readTokenSigner(identity).encode("snapshot", { ...payload, representation: compact.representation });
    await assert.rejects(service.fetchEvidence(readSet, { snapshot }), { code: "snapshot_stale" });
  });
});

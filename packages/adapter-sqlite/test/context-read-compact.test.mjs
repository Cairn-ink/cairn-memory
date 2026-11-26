import assert from "node:assert/strict";
import { test } from "node:test";
import { createMemoryService } from "@cairn-ink/core/service";
import { assemblyClock, fixtureCount, formatAssembly } from "@cairn-ink/conformance/context-assembly";
import { createMemoryAdapter } from "../../adapter-memory/src/index.mjs";
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

async function seed(storage) {
  await storage.uow.run(scope.owner, { pauseLock: true }, async tx => {
    for (const [i, { text, occurredAtMs }] of corpus.entries()) {
      await storage.memories.insert(tx, scope, {
        text, embedding, source, kind: "fact", origin: "explicit", confidence: 1, textHash: "sha256:" + sha256(text),
      }, [{ id: "receipt-" + i, client: "fixture", sessionId: "observation", eventId: String(i),
        role: "user", excerpt: "Source " + i, messageId: "turn-" + i, occurredAtMs, createdAtMs: 1 }], 1);
    }
  });
}

test("SQLite and memory adapters return the same 64 compact items in lexical and hybrid reads", async t => {
  const file = scratch();
  let sqlite;
  t.after(async () => {
    try { await sqlite?.close(); }
    finally { file.remove(); }
  });
  sqlite = await openSqliteAdapter(file.path, { capabilities });
  const memory = createMemoryAdapter({ capabilities });
  await seed(sqlite);
  await seed(memory);
  const expected = [...corpus.slice(1).reverse(), corpus[0]].map(({ text, occurredAtMs }) => ({
    date: occurredAtMs === null ? null : new Date(occurredAtMs).toISOString().slice(0, 16) + "Z", body: text,
  }));

  const results = [];
  for (const storage of [sqlite, memory]) {
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
        assert.deepEqual(result.diagnostics.candidates.coverage.depths, { lexical: 24, semantic: semantic ? 12 : 0 });
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
      assert.equal(JSON.parse(Buffer.from(value.snapshot.split(".")[0], "base64url")).refs.length, 64);
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
  }
  assert.deepEqual(results[0], results[1]);
});

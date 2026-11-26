import assert from "node:assert/strict";
import { test } from "node:test";
import { setTimeout as delay } from "node:timers/promises";
import { createMemoryService } from "@cairn-ink/core/service";
import { assemblyClock, fixtureCount, formatAssembly } from "@cairn-ink/conformance/context-assembly";
import { createMemoryAdapter } from "../../adapter-memory/src/index.mjs";
import { openSqliteAdapter } from "../src/index.mjs";
import { scratch, sha256 } from "./storage-fixtures.mjs";

const scope = { owner: "reader", namespace: "project\0observation" };
const readSet = { owner: scope.owner, namespaces: [scope.namespace], accessGenerations: [1] };
const input = { query: "albatross", types: ["memory"], intent: "current", deadlineMs: 1000 };
const capabilities = { contextRead: true, contextRawRead: true, rawArchive: true, semanticRetrieval: true };
const source = { kind: "mcp", client: null, sessionId: null };
const session = { client: "archive", sessionId: "observation" };
const message = { id: "turn", role: "user", content: "An albatross flew past the tower.", occurredAtMs: null };
const text = "An albatross keeps watch.";
const embedding = { model: "fixture", vector: Float32Array.of(1) };

async function sqlite(t) {
  const file = scratch();
  let storage;
  t.after(async () => {
    try { await storage?.close(); }
    finally { file.remove(); }
  });
  storage = await openSqliteAdapter(file.path, { capabilities });
  return storage;
}

for (const [name, open] of [["SQLite", sqlite], ["memory adapter", () => createMemoryAdapter({ capabilities })]]) {
  test(`${name} delivers the same Raw items with a delayed query embedding`, async t => {
    const storage = await open(t);
    const { id } = await storage.uow.run(scope.owner, { pauseLock: true }, async tx => {
      await storage.raw.importArchive(tx, scope, session, [message]);
      return storage.memories.insert(tx, scope, { text, embedding, source,
        kind: "fact", origin: "explicit", confidence: 1, textHash: "sha256:" + sha256(text) }, [], 1);
    });
    // Publish the durable Raw inventory before comparing channel coverage.
    if (storage.maintainContextRaw) assert.equal(await storage.maintainContextRaw(readSet), true);

    const events = [];
    const mark = name => events.push({ name, at: performance.now() });
    const { contextRead } = storage;
    const service = createMemoryService({
      storage: { ...storage, contextRead: {
        ...contextRead,
        lexical(...args) { mark("lexical"); return contextRead.lexical(...args); },
        raw: { ...contextRead.raw, search(...args) { mark("raw"); return contextRead.raw.search(...args); } },
      } },
      clock: assemblyClock(), config: {}, gate: { async assertOpen() {} }, tokens: { countTokens: fixtureCount },
      contextReadCounter: { count: fixtureCount }, contextReadFormat: formatAssembly,
      embedder: null,
      embedQuery: { async embedQuery() { mark("embed"); await delay(150); mark("embed-end"); return embedding; } },
    });
    const start = performance.now();
    const semantic = await service.readContext(readSet, { ...input, semantic: true });
    const hybridMs = performance.now() - start;
    const semanticEvents = events.splice(0);
    const lexicalStart = performance.now();
    const lexical = await service.readContext(readSet, { ...input, semantic: false });
    const lexicalMs = performance.now() - lexicalStart;
    const at = name => semanticEvents.find(event => event.name === name).at;
    t.diagnostic(JSON.stringify({ rawMs: at("raw") - start, embedMs: at("embed-end") - at("embed"), hybridMs, lexicalMs }));
    assert.ok(at("raw") < at("embed-end"));
    assert.ok(at("lexical") < at("embed-end"));
    assert.equal(semanticEvents.filter(({ name }) => name === "embed").length, 1);
    assert.ok(!events.some(({ name }) => name === "embed"));
    assert.deepEqual(semantic.diagnostics.candidates.channels.semantic, { state: "ready", causes: [] });
    assert.equal(semantic.diagnostics.coverage.raw, "included");
    assert.equal(lexical.diagnostics.coverage.raw, "included");
    const raw = result => result.assembly.items.filter(({ ref }) => ref.type === "raw");
    assert.deepEqual(raw(lexical).map(({ ref }) => ref.messageId), [message.id]);
    assert.deepEqual(raw(semantic), raw(lexical));
    assert.deepEqual((await service.fetchEvidence(readSet, { snapshot: semantic.snapshot })).items.map(({ ref }) => ref.id), [id]);
  });
}

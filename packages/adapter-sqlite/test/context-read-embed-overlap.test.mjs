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
const content = text => ({ text, embedding, source,
  kind: "fact", origin: "explicit", confidence: 1, textHash: "sha256:" + sha256(text) });
const rawItems = result => result.assembly.items.filter(({ ref }) => ref.type === "raw");

function serviceFor(storage, embedQuery, clock = assemblyClock()) {
  return createMemoryService({ storage, clock, config: {}, gate: { async assertOpen() {} },
    tokens: { countTokens: fixtureCount }, contextReadCounter: { count: fixtureCount }, contextReadFormat: formatAssembly,
    embedder: null, embedQuery: { embedQuery } });
}

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
      return storage.memories.insert(tx, scope, content(text), [], 1);
    });
    // Publish the durable Raw inventory before comparing channel coverage.
    if (storage.maintainContextRaw) assert.equal(await storage.maintainContextRaw(readSet), true);

    const events = [];
    const mark = name => events.push({ name, at: performance.now() });
    const { contextRead } = storage;
    const service = serviceFor({ ...storage, contextRead: {
      ...contextRead,
      lexical(...args) { mark("lexical"); return contextRead.lexical(...args); },
      raw: { ...contextRead.raw, search(...args) { mark("raw"); return contextRead.raw.search(...args); } },
    } }, async () => { mark("embed"); await delay(150); mark("embed-end"); return embedding; });
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
    assert.deepEqual(rawItems(lexical).map(({ ref }) => ref.messageId), [message.id]);
    assert.deepEqual(rawItems(semantic), rawItems(lexical));
    assert.deepEqual((await service.fetchEvidence(readSet, { snapshot: semantic.snapshot })).items.map(({ ref }) => ref.id), [id]);
  });

  test(`${name} refreshes lexical evidence after a forget and correction during embedding`, async t => {
    const storage = await open(t);
    const forgottenText = "An albatross roosts on the mast.";
    const originalText = "The albatross nested beneath a bell.";
    const revisedText = "An albatross surveys the southern cliffs.";
    const [retained, forgotten, corrected] = await storage.uow.run(scope.owner, { pauseLock: true }, async tx => {
      const rows = [];
      for (const body of [text, forgottenText, originalText]) {
        rows.push(await storage.memories.insert(tx, scope, content(body), [], 1));
      }
      return rows;
    });
    const firstPass = Promise.withResolvers();
    const model = Promise.withResolvers();
    const { contextRead, uow } = storage;
    let firstLexicalTx;
    let lexicalPasses = 0;
    let dispatches = 0;
    const service = serviceFor({ ...storage,
      uow: { async run(owner, options, work) {
        let readTx;
        const result = await uow.run(owner, options, tx => { readTx = tx; return work(tx); });
        if (readTx === firstLexicalTx) firstPass.resolve();
        return result;
      } },
      contextRead: { ...contextRead, async lexical(tx, ...args) {
        const result = await contextRead.lexical(tx, ...args);
        if (++lexicalPasses === 1) {
          assert.equal(result.rows.length, 3);
          firstLexicalTx = tx;
        }
        return result;
      } },
    }, () => { dispatches++; return model.promise; });
    const reading = service.readContext(readSet, { ...input, raw: false, deadlineMs: 5000 });
    try {
      assert.equal(await Promise.race([firstPass.promise, reading]), undefined);
      assert.equal(dispatches, 1);
      assert.equal((await service.forget(scope, forgotten.id, source)).status, "forgotten");
      const replacement = await uow.run(scope.owner, { pauseLock: true }, tx =>
        storage.memories.replaceContent(tx, scope, corrected.id, corrected.revision, content(revisedText), null, 2));
      assert.deepEqual(replacement, { outcome: "changed", revision: corrected.revision + 1 });
      model.resolve(embedding);
      const result = await reading;
      assert.equal(result.diagnostics.candidates.channels.semantic.state, "ready");
      const expected = [[retained.id, text], [corrected.id, revisedText]];
      assert.deepEqual(new Map(result.assembly.items.map(({ ref, body }) => [ref.id, body])), new Map(expected));
      const replay = await service.fetchEvidence(readSet, { snapshot: result.snapshot });
      assert.deepEqual(new Map(replay.items.map(({ ref, text }) => [ref.id, text])), new Map(expected));
      assert.equal(replay.items.find(({ ref }) => ref.id === corrected.id).ref.revision, replacement.revision);
      assert.deepEqual([lexicalPasses, dispatches], [2, 1]);
    } finally {
      model.resolve(embedding);
      await reading.catch(() => {});
    }
  });
}

test("reassembly after the Raw cutoff reuses and revalidates the first Raw result", async () => {
  async function readAcrossWrite(semantic) {
    const storage = createMemoryAdapter({ capabilities });
    const { contextRead, uow } = storage;
    await uow.run(scope.owner, { pauseLock: true }, async tx => {
      await storage.raw.importArchive(tx, scope, session, [message]);
      await storage.memories.insert(tx, scope, content(text), [], 1);
    });
    let offset = 0;
    const now = () => performance.now() + offset;
    const cutoffs = [];
    const revalidations = [];
    let evidenceTx;
    let committed = false;
    let dispatches = 0;
    const service = serviceFor({ ...storage, capabilities: { ...storage.capabilities, quantityLedger: true },
      quantityLedger: { async list() { return []; } },
      uow: { async run(owner, options, work) {
        let readTx;
        const result = await uow.run(owner, options, tx => { readTx = tx; return work(tx); });
        if (!committed && readTx === evidenceTx) {
          assert.equal(cutoffs.length, 1);
          await uow.run(owner, { pauseLock: true }, tx => storage.memories.insert(tx, scope,
            { ...content("The lighthouse beacon needs repair."), embedding: null }, [], 2));
          committed = true;
          offset = Math.max(0, cutoffs[0] - performance.now() + 1);
        }
        return result;
      } },
      contextRead: { ...contextRead,
        evidence(tx, ...args) { evidenceTx = tx; return contextRead.evidence(tx, ...args); },
        raw: { ...contextRead.raw,
          search(tx, set, query, options) { cutoffs.push(options.deadlineAtMs); return contextRead.raw.search(tx, set, query, options); },
          async revalidate(tx, set, turns) {
            const valid = await contextRead.raw.revalidate(tx, set, turns);
            revalidations.push({ valid, time: now() });
            return valid;
          },
        },
      },
    }, async () => { dispatches++; return embedding; }, assemblyClock(now));
    const result = await service.readContext(readSet, { ...input, query: "how many albatross", semantic });
    assert.equal(committed, true);
    return { result, cutoffs, revalidations, dispatches };
  }
  const sequential = await readAcrossWrite(false);
  const hybrid = await readAcrossWrite(true);
  assert.equal(sequential.cutoffs.length, 2);
  assert.equal(sequential.result.diagnostics.coverage.raw, "included");
  assert.deepEqual(rawItems(sequential.result).map(({ ref }) => ref.messageId), [message.id]);
  assert.equal(hybrid.result.diagnostics.coverage.raw, sequential.result.diagnostics.coverage.raw);
  assert.deepEqual(rawItems(hybrid.result), rawItems(sequential.result));
  assert.equal(hybrid.cutoffs.length, 1);
  assert.ok(hybrid.revalidations.some(({ valid, time }) => valid && time > hybrid.cutoffs[0]));
  assert.equal(hybrid.dispatches, 1);
});

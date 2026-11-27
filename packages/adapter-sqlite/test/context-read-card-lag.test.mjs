import assert from "node:assert/strict";
import { test } from "node:test";
import { assemblyClock, fixtureCount, formatAssembly } from "@cairn-ink/conformance/context-assembly";
import { createMemoryService } from "@cairn-ink/core/service";
import { openSqliteAdapter } from "../src/index.mjs";
import { scratch, seedFact, sha256 } from "./storage-fixtures.mjs";

const scope = { owner: "owner", namespace: null };
const project = { ...scope, namespace: "project\0shared" };
const readSet = { owner: scope.owner, namespaces: [null], accessGenerations: [1] };
const mixed = { query: "petrel", types: ["memory", "card"], intent: "current" };
const memoryOnly = { ...mixed, types: ["memory"] };
const now = () => 1;
const open = (path, monotonicMs, documentCards = true) => openSqliteAdapter(path, {
  now, monotonicMs, capabilities: { contextRead: true, documentCards },
});
const service = (storage, monotonicMs) => createMemoryService({ profile: "keyless-local", storage,
  clock: assemblyClock(monotonicMs), contextReadCounter: { count: fixtureCount }, contextReadFormat: formatAssembly });
const write = (storage, work) => storage.uow.run(scope.owner, { pauseLock: true }, work);
const insert = (storage, tx, text) => storage.memories.insert(tx, scope, {
  text, textHash: "sha256:" + sha256(text.toLowerCase()), kind: "fact", origin: "explicit", confidence: 1,
  source: { kind: "import", client: null, sessionId: null }, embedding: null,
}, [], now());
const put = (storage, tx, target, id, body = "A petrel nests here.", sourceMemories = []) =>
  storage.documentCards.put(tx, target, { id, scope: target, origin: "manual", title: "Bird notes", body,
    contentHash: sha256(body), date: null, sourceMessage: null, sourceMemories, sentences: [], stale: [] });

async function fixture(t, monotonicMs = () => 0) {
  const file = scratch();
  let storage;
  t.after(async () => {
    try { await storage?.close(); }
    finally { file.remove(); }
  });
  storage = await open(file.path, monotonicMs);
  return { storage, api: service(storage, monotonicMs) };
}

test("mixed reads expose remaining card scan and publication work", async t => {
  const { storage, api } = await fixture(t);
  const scoped = { ...readSet, namespaces: [null, project.namespace], accessGenerations: [1, 1] };
  await write(storage, async tx => {
    await insert(storage, tx, "A petrel dives for fish.");
    const longBody = "petrel ".repeat(6000);
    await put(storage, tx, scope, "card-1", longBody);
    await put(storage, tx, scope, "card-2", longBody);
    await put(storage, tx, project, "card-3", longBody);
  });

  const partial = await api.findCandidates(scoped, mixed);
  assert.equal(partial.coverage.status, "partial");
  assert.equal(partial.coverage.maintenance.cardPendingUnits, 3);
  const assembled = await api.readContext(scoped, mixed);
  assert.equal(assembled.diagnostics.candidates.coverage.maintenance.cardPendingUnits, 2);
  const complete = await api.findCandidates(scoped, mixed);
  assert.equal(complete.coverage.status, "complete");
  assert.equal(complete.coverage.byType.card.indexed, 3);
  assert.equal(Object.hasOwn(complete.coverage.maintenance, "cardPendingUnits"), false);
});

test("a stalled mixed read reports lag without counting hidden, forgotten or out-of-scope cards", async t => {
  let time = 0, reading = false;
  const monotonicMs = () => reading ? (time += 2) : time;
  const { storage, api } = await fixture(t, monotonicMs);
  const memory = await write(storage, tx => insert(storage, tx, "A petrel dives for fish."));
  await api.findCandidates(readSet, memoryOnly);
  const baseline = await api.findCandidates(readSet, memoryOnly);
  assert.equal(Object.hasOwn(baseline.coverage.maintenance, "cardPendingUnits"), false);

  await write(storage, async tx => {
    for (let i = 0; i < 110; i++) await put(storage, tx, scope, `card-${i}`);
  });
  assert.equal(JSON.stringify(await api.findCandidates(readSet, memoryOnly)), JSON.stringify(baseline));
  const published = await api.findCandidates(readSet, mixed);
  assert.equal(published.coverage.byType.card.indexed, 110);
  await write(storage, tx => insert(storage, tx, "Wind blows inland."));

  async function assertStalled() {
    reading = true;
    try {
      for (let i = 0; i < 3; i++) {
        const result = await api.findCandidates(readSet, mixed);
        assert.deepEqual(result.items.map(({ ref }) => ref.id), [memory.id]);
        assert.equal(result.coverage.status, "partial");
        assert.equal(result.coverage.maintenance.cardPendingUnits, 2);
        assert.equal(result.coverage.maintenance.progress.checkpoint, published.coverage.maintenance.progress.checkpoint);
      }
    } finally {
      reading = false;
    }
  }
  await assertStalled();
  const binding = await write(storage, async tx => {
    const linked = await insert(storage, tx, "Wind measurements.");
    await put(storage, tx, scope, "hidden", "Petrel sightings.", [linked]);
    await storage.documentCards.hideWhere(tx, scope, { sourceMemoryId: linked.id }, "forget", { retainText: true });
    await put(storage, tx, scope, "forgotten", "Petrel sightings.", [linked]);
    await put(storage, tx, project, "out-of-scope");
    return linked;
  });
  await seedFact(storage, { ...scope, kind: "identity", origin: "forget", actionId: "forget-binding", memoryId: binding.id });
  await assertStalled();
  const complete = await api.findCandidates(readSet, mixed);
  assert.equal(complete.coverage.byType.card.indexed, 110);
  assert.equal(Object.hasOwn(complete.coverage.maintenance, "cardPendingUnits"), false);
});

test("card-disabled reads keep their bytes with cards in storage", async t => {
  const file = scratch();
  t.after(file.remove);
  const monotonicMs = () => 0;
  async function withAdapter(enabled, run) {
    const storage = await open(file.path, monotonicMs, enabled);
    try { return await run(storage, service(storage, monotonicMs)); }
    finally { await storage.close(); }
  }
  const find = async (_, api) => {
    const result = await api.findCandidates(readSet, mixed);
    assert.equal(Object.hasOwn(result.coverage.maintenance, "cardPendingUnits"), false);
    return JSON.stringify(result);
  };
  const baseline = await withAdapter(false, async (storage, api) => {
    await write(storage, tx => insert(storage, tx, "A petrel dives for fish."));
    await find(storage, api);
    return find(storage, api);
  });
  await withAdapter(true, storage => write(storage, tx => put(storage, tx, scope, "stored-card")));
  assert.equal(await withAdapter(false, find), baseline);
});

import assert from "node:assert/strict";
import { test } from "node:test";
import { assemblyClock, fixtureCount, formatAssembly } from "@cairn-ink/conformance/context-assembly";
import { createMemoryService } from "@cairn-ink/core/service";
import { createSqliteAdapter } from "../src/adapter.mjs";
import { openStorage } from "../src/schema/open.mjs";
import { scratch, sha256 } from "./storage-fixtures.mjs";

const scope = { owner: "owner", namespace: null };
const readSet = { owner: scope.owner, namespaces: [null], accessGenerations: [1] };
const mixed = { query: "petrel", types: ["memory", "card"], intent: "current" };

async function checkProgress(t, { cardCount, memoryCount, body, clockStep, visibilityMs, maxReads }) {
  const file = scratch();
  let backend;
  t.after(async () => {
    try { await backend?.close(); }
    finally { file.remove(); }
  });
  backend = await openStorage(file.path);
  let time = 0, reading = false, visibilityLoads = 0;
  const monotonicMs = () => reading ? (time += clockStep) : time;
  const storage = createSqliteAdapter({ ...backend, async port(tx, owner, options, work) {
    const result = await backend.port(tx, owner, options, work);
    if (reading && !tx.readOnly && Array.isArray(result) && result[0]?.requestedScope) {
      visibilityLoads += result.length;
      time += visibilityMs;
    }
    return result;
  } }, { monotonicMs, now: () => 1, capabilities: { contextRead: true, documentCards: true } });
  const service = createMemoryService({ profile: "keyless-local", storage, clock: assemblyClock(monotonicMs),
    contextReadCounter: { count: fixtureCount }, contextReadFormat: formatAssembly });
  const write = work => storage.uow.run(scope.owner, { pauseLock: true }, work);
  const insert = (tx, text) => storage.memories.insert(tx, scope, {
    text, textHash: "sha256:" + sha256(text.toLowerCase()), kind: "fact", origin: "explicit", confidence: 1,
    source: { kind: "import", client: null, sessionId: null }, embedding: null,
  }, [], 1);
  // Sort the matching card last so reaching it requires scanning the whole scope.
  const matchId = "match";
  const memory = await write(async tx => {
    const match = await insert(tx, "A petrel dives for fish.");
    for (let i = 1; i < memoryCount; i++) await insert(tx, `Wind measurement ${i}`);
    for (let i = 0; i < cardCount; i++) {
      const id = i === cardCount - 1 ? matchId : `card-${i}`;
      await storage.documentCards.put(tx, scope, { id, scope, origin: "manual",
        title: id === matchId ? "Petrel Notes" : "Weather", body, contentHash: sha256(body), date: null,
        sourceMessage: null, sourceMemories: [], sentences: [], stale: [] });
    }
    return match;
  });
  await storage.contextRead.prepareLexical(readSet, mixed, {});
  const find = () => service.findCandidates(readSet, mixed);
  const published = await find();
  assert.equal(published.coverage.byType.card.indexed, cardCount);
  await write(tx => insert(tx, "An unrelated weather observation"));
  reading = true;

  let checkpoint = published.coverage.maintenance.progress.checkpoint;
  for (let reads = 1; reads <= maxReads; reads++) {
    const found = await find();
    assert.ok(found.items.some(({ ref }) => ref.type === "memory" && ref.id === memory.id));
    const progress = found.coverage.maintenance.progress.checkpoint;
    assert.ok(progress > checkpoint, `checkpoint stayed at ${checkpoint} on read ${reads}`);
    checkpoint = progress;
    if (reads === 1) assert.equal(found.coverage.status, "partial");
    if (found.coverage.status === "complete") {
      assert.equal(found.coverage.byType.card.indexed, cardCount);
      assert.ok(found.items.some(({ ref }) => ref.type === "card" && ref.id === matchId));
      assert.equal(visibilityLoads, cardCount, "each card's visibility was checked once during rebuilding");
      t.diagnostic(`complete after ${reads} mixed reads`);
      return;
    }
    assert.deepEqual(found.items.map(({ ref }) => ref.id), [memory.id]);
  }
  assert.fail(`card coverage remained partial after ${maxReads} mixed reads`);
}

test("mixed reads persist card progress when scanning uses the allowance", async t => {
  // Republish memories on the first read. The next read has time for all 110
  // cards at 2 ms per clock check, with a third read allowed for publication.
  await checkProgress(t, { cardCount: 110, memoryCount: 192, body: "Wind blows inland.",
    clockStep: 2, visibilityMs: 0, maxReads: 3 });
});

test("mixed reads persist card progress when one visibility load uses the allowance", async t => {
  // The 350 ms visibility load exceeds the card allowance. One read can finish
  // that card and a second can publish the exhausted scan.
  await checkProgress(t, { cardCount: 1, memoryCount: 1, body: "wind ".repeat(16_000),
    clockStep: 0, visibilityMs: 350, maxReads: 2 });
});

import assert from "node:assert/strict";
import { test } from "node:test";
import { assemblyClock, fixtureCount, formatAssembly } from "@cairn-ink/conformance/context-assembly";
import { createMemoryService } from "@cairn-ink/core/service";
import { createSqliteAdapter } from "../src/adapter.mjs";
import { openStorage } from "../src/schema/open.mjs";
import { scratch, sha256 } from "./storage-fixtures.mjs";

test("mixed reads leave time to commit and deliver while card checkpoints advance", async t => {
  const file = scratch();
  let backend;
  t.after(async () => {
    try { await backend?.close(); }
    finally { file.remove(); }
  });
  backend = await openStorage(file.path);
  let time = 0, reading = false;
  const monotonicMs = () => reading ? (time += 2) : time;
  const storage = createSqliteAdapter({ ...backend, uow: {
    async run(owner, options, work) {
      const result = await backend.uow.run(owner, options, work);
      // Charge commit time after the checkpoint's last deadline check.
      if (reading && !options.readOnly) time += 600;
      return result;
    },
  } }, { monotonicMs, now: () => 1, capabilities: { contextRead: true, documentCards: true } });
  const service = createMemoryService({ profile: "keyless-local", storage, clock: assemblyClock(monotonicMs),
    contextReadCounter: { count: fixtureCount }, contextReadFormat: formatAssembly });
  const scope = { owner: "owner", namespace: null };
  const readSet = { owner: scope.owner, namespaces: [null], accessGenerations: [1] };
  const mixed = { query: "petrel", types: ["memory", "card"], intent: "current" };
  const write = work => storage.uow.run(scope.owner, { pauseLock: true }, work);
  const insert = (tx, text) => storage.memories.insert(tx, scope, {
    text, textHash: "sha256:" + sha256(text.toLowerCase()), kind: "fact", origin: "explicit", confidence: 1,
    source: { kind: "import", client: null, sessionId: null }, embedding: null,
  }, [], 1);

  const cardCount = 128;
  const memory = await write(async tx => {
    const match = await insert(tx, "A petrel dives for fish.");
    for (let i = 1; i < 96; i++) await insert(tx, `Wind measurement ${i}`);
    for (let i = 0; i < cardCount; i++) {
      const id = `card-${i}`;
      const body = Array.from({ length: 700 }, (_, j) => (i * 700 + j).toString(36).padStart(4, "0")).join(" ");
      await storage.documentCards.put(tx, scope, { id, scope, origin: "manual",
        title: i === 0 ? "Petrel Notes" : "Weather", body, contentHash: sha256(body), date: null,
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

  async function findWithinDeadline() {
    const started = time;
    const result = await find();
    assert.ok(time - started < 1000);
    return result;
  }
  let result = await findWithinDeadline();
  assert.deepEqual(result.items.map(({ ref }) => ref.id), [memory.id]);
  assert.equal(result.coverage.status, "partial");
  assert.deepEqual(result.channels.lexical, { state: "ready", causes: ["card_index_rebuilding"] });
  let checkpoint = published.coverage.maintenance.progress.checkpoint;
  for (let i = 0; i < cardCount; i++) {
    const progress = result.coverage.maintenance.progress.checkpoint;
    assert.ok(progress > checkpoint);
    if (result.coverage.status === "complete") break;
    checkpoint = progress;
    result = await findWithinDeadline();
  }
  assert.equal(result.coverage.status, "complete");
  assert.equal(result.coverage.byType.card.indexed, cardCount);
  assert.deepEqual(new Set(result.items.map(({ ref }) => ref.id)), new Set([memory.id, "card-0"]));
  const cardScore = ({ items }) => items.find(({ ref }) => ref.type === "card").channels.lexical.rawScore;
  assert.equal(cardScore(result), cardScore(published));
});

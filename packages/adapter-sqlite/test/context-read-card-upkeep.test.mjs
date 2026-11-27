import assert from "node:assert/strict";
import { test } from "node:test";
import { setTimeout as nextTurn } from "node:timers/promises";
import { assemblyClock, fixtureCount, formatAssembly } from "@cairn-ink/conformance/context-assembly";
import { createMemoryService } from "@cairn-ink/core/service";
import { createSqliteAdapter } from "../src/adapter.mjs";
import { openStorage } from "../src/schema/open.mjs";
import { scratch, seedFact, sha256 } from "./storage-fixtures.mjs";

const scope = { owner: "owner", namespace: null };
const readSet = { owner: scope.owner, namespaces: [null], accessGenerations: [1] };
const mixed = { query: "petrel", types: ["memory", "card"], intent: "current", deadlineMs: 1000 };
const memoryOnly = { ...mixed, types: ["memory"] };

function service(storage, monotonicMs) {
  return createMemoryService({ profile: "keyless-local", storage, clock: assemblyClock(monotonicMs),
    contextReadCounter: { count: fixtureCount }, contextReadFormat: formatAssembly });
}

async function fixture(t, raw = false) {
  const file = scratch();
  let backend, storage;
  t.after(async () => {
    try { await (storage ?? backend)?.close(); }
    finally { file.remove(); }
  });
  backend = await openStorage(file.path);
  const cardsByTx = new WeakSet(), memoriesByTx = new WeakSet();
  const on = { clock: 0, prepare: 0, visibility: 0, memoryCommit: 0, cardCommit: 0, cardFailure: null };
  const commits = [], prepared = [], loads = [];
  let time = 0, reading = false, beforeCardWork;
  const clock = () => reading ? (time += on.clock) : time;
  storage = createSqliteAdapter({ ...backend, async port(tx, owner, options, work) {
    const result = await backend.port(tx, owner, options, work);
    if (!reading || tx.readOnly) return result;
    if (typeof result?.state?.last_id === "string" || typeof result?.last_id === "string") {
      cardsByTx.add(tx);
      prepared.push(tx);
      beforeCardWork?.();
      time += on.prepare;
    }
    if (Array.isArray(result) && result[0]?.requestedScope) {
      cardsByTx.add(tx);
      loads.push(...result.map(input => ({ tx, id: input.card.id })));
      time += on.visibility;
      if (on.cardFailure === "abort") throw new DOMException("Card maintenance aborted", "AbortError");
    }
    if (Number.isInteger(result?.canonicalRows) && !cardsByTx.has(tx)) memoriesByTx.add(tx);
    return result;
  }, uow: {
    async run(owner, options, work) {
      let active;
      const result = await backend.uow.run(owner, options, async tx => {
        active = tx;
        const value = await work(tx);
        if (reading && cardsByTx.has(tx) && on.cardFailure === "commit") throw new Error("Card commit failed");
        return value;
      });
      if (reading && !options.readOnly) {
        const memory = memoriesByTx.has(active), card = cardsByTx.has(active);
        if (memory) time += on.memoryCommit;
        if (card && !memory) time += on.cardCommit;
        const rawReady = raw && memory && await backend.uow.run(owner, { readOnly: true }, tx =>
          backend.port(tx, owner, {}, db => db.prepare("SELECT published FROM cairn_context_raw_checkpoints").get()?.published === 1));
        commits.push({ tx: active, memory, card, rawReady });
      }
      return result;
    },
  } }, { monotonicMs: clock, now: () => 1,
    capabilities: { contextRead: true, documentCards: true, contextRawRead: raw } });
  const api = service(storage, clock);
  const write = work => storage.uow.run(scope.owner, { pauseLock: true }, work);
  const inspect = work => backend.uow.run(scope.owner, { readOnly: true }, tx => backend.port(tx, scope.owner, {}, work));
  const insert = (tx, text) => storage.memories.insert(tx, scope, {
    text, textHash: "sha256:" + sha256(text.toLowerCase()), kind: "fact", origin: "explicit", confidence: 1,
    source: { kind: "import", client: null, sessionId: null }, embedding: null,
  }, [], 1);
  const put = (tx, id, body, sourceMemories = []) => storage.documentCards.put(tx, scope, {
    id, scope, origin: "manual", title: "Petrel Notes", body, sourceMemories, contentHash: sha256(body),
    date: null, sourceMessage: null, sentences: [], stale: [],
  });
  async function preload(count, body) {
    const memory = await write(async tx => {
      const hit = await insert(tx, "A petrel dives for fish.");
      for (let i = 0; i < count; i++) await put(tx, `card-${String(i).padStart(3, "0")}`, body);
      return hit;
    });
    await storage.contextRead.prepareLexical(readSet, mixed, {});
    return memory;
  }
  return {
    storage, api, backend, clock, on, commits, prepared, loads, preload, write, inspect, insert, put,
    inject(check) { reading = true; beforeCardWork = check; },
    tick: () => time,
    async find() {
      const started = time;
      const result = await api.findCandidates(readSet, mixed);
      return { result, elapsed: time - started };
    },
    postings: () => inspect(db => db.prepare(`SELECT id, sequence, revision FROM cairn_context_documents
      WHERE id LIKE 'card-%' ORDER BY id`).all()),
  };
}

function assertPartial(result, id) {
  assert.deepEqual(result.items.map(({ ref }) => ref.id), [id]);
  assert.equal(result.coverage.status, "partial");
  assert.deepEqual(result.channels.lexical, { state: "ready", causes: ["card_index_rebuilding"] });
}

test("R1 commits Memory and Raw before card work and returns them after card failures", async t => {
  const f = await fixture(t, true);
  const memory = await f.preload(1, "Wind blows inland.");
  await seedFact(f.storage, { ...scope, kind: "identity", origin: "forget", actionId: "suppress",
    memoryId: "missing-memory" });
  await f.write(tx => f.insert(tx, "Another observation"));
  const attempted = [];
  f.inject(() => {
    attempted.push(f.commits.some(({ memory, rawReady }) => memory && rawReady));
  });
  for (const error of ["abort", "commit"]) {
    f.on.cardFailure = error;
    const { result } = await f.find();
    assertPartial(result, memory.id);
    assert.deepEqual(await f.inspect(db => db.prepare("SELECT published FROM cairn_context_raw_checkpoints").get()?.published), 1);
    assert.ok((await f.postings()).every(row => row.sequence === 1), "a failed card transaction rolled back");
  }
  assert.deepEqual(attempted, [true, true]);
  assert.ok(f.commits.some(({ memory }) => memory));
  assert.ok(f.commits.every(({ card }) => !card));

  const slow = await fixture(t);
  const hit = await slow.preload(1, "Wind blows inland.");
  await slow.write(tx => slow.insert(tx, "Another observation"));
  Object.assign(slow.on, { visibility: 960, cardCommit: 600 });
  slow.inject();
  const delivered = await slow.find();
  assertPartial(delivered.result, hit.id);
  assert.equal(delivered.elapsed, 960);
  await nextTurn(0);
  await slow.backend.uow.run(scope.owner, {}, async () => {});
  assert.deepEqual((await slow.postings()).map(({ sequence }) => sequence), [2]);
  assert.equal(slow.tick() - delivered.elapsed, 600);
});

test("R2 commits verified card work and its cursor when a unit uses the allowance", async t => {
  for (const { count, body, cost, clock, bound } of [
    { count: 110, body: "Wind blows inland.", cost: 0, clock: 2, bound: 3 },
    { count: 1, body: "weather ".repeat(10_000), cost: 350, clock: 0, bound: 2 },
    { count: 5, body: "Wind blows inland.", cost: 480, clock: 0, bound: 6 },
  ]) {
    const f = await fixture(t);
    const memory = await f.preload(count, body);
    await f.write(tx => f.insert(tx, "Another observation"));
    Object.assign(f.on, { clock, visibility: cost });
    f.inject();
    let complete, indexed = 0, checkpoint = 0;
    for (let reads = 1; reads <= bound; reads++) {
      const start = f.loads.length;
      const { result, elapsed } = await f.find();
      assert.ok(elapsed < 1000);
      assert.ok(result.items.some(({ ref }) => ref.id === memory.id));
      const progress = result.coverage.maintenance.progress.checkpoint;
      assert.ok(progress > checkpoint);
      checkpoint = progress;
      const next = (await f.postings()).filter(row => row.sequence === 2).length;
      assert.equal(next - indexed, f.loads.length - start, "each completed verdict made its posting durable");
      indexed = next;
      if (result.coverage.status === "complete") {
        assert.equal(result.coverage.byType.card.indexed, count);
        assert.ok(result.items.some(({ ref }) => ref.id === "card-000"));
        complete = reads;
        break;
      }
    }
    assert.ok(complete, `card projection did not publish within ${bound} reads`);
    assert.equal(new Set(f.loads.map(({ id }) => id)).size, count);
    assert.equal(f.loads.length, count);
    assert.ok(f.loads.every(({ tx }) => f.commits.some(commit => commit.tx === tx && commit.card && !commit.memory)));
    t.diagnostic(`probe ${count} cards, ${body.length} characters, ${cost} ms visibility: ${complete}/${bound} reads`);
  }
});

test("R3 delivers the first post-save mixed read within the deadline", async t => {
  const f = await fixture(t);
  const memory = await f.preload(1, "weather ".repeat(10_000));
  await f.write(tx => f.insert(tx, "Another observation"));
  Object.assign(f.on, { clock: 2, prepare: 345, visibility: 350, memoryCommit: 600, cardCommit: 600 });
  f.inject();
  const { result, elapsed } = await f.find();
  assertPartial(result, memory.id);
  assert.ok(elapsed < mixed.deadlineMs, `mixed read took ${elapsed} ms`);
  assert.equal(f.prepared.length, 0, "the memory commit left no allowance to start a card transaction");
  assert.equal(f.loads.length, 0);
  assert.equal(f.commits.filter(({ memory }) => memory).length, 1);
  t.diagnostic(`probe first post-save mixed read: ${elapsed} ms`);
});

test("R4 forces one unit after two missed passes and finishes with a save before every read", async t => {
  const f = await fixture(t);
  const memory = await f.preload(3, "Wind blows inland.");
  const writer = createMemoryService({ storage: f.storage, config: {}, model: null, embedder: null,
    gate: { async assertOpen() {} }, clock: assemblyClock(f.clock), tokens: { countTokens: fixtureCount } });
  Object.assign(f.on, { clock: 2, visibility: 480, memoryCommit: 760, cardCommit: 600 });
  f.inject();
  const bound = 12;
  let published = false;
  for (let reads = 1; reads <= bound; reads++) {
    assert.equal((await writer.save(scope, `Unrelated observation number ${reads}.`,
      { kind: "mcp", client: null, sessionId: null })).status, "saved");
    const before = f.tick();
    let elapsed;
    if (reads === 3) {
      const response = await f.api.readContext(readSet, mixed);
      assert.deepEqual(response.assembly.items.map(({ ref }) => ref.id), [memory.id]);
      assert.equal(response.diagnostics.candidates.coverage.status, "partial");
      elapsed = f.tick() - before;
    } else {
      const { result, elapsed: duration } = await f.find();
      assertPartial(result, memory.id);
      elapsed = duration;
    }
    assert.ok(elapsed < mixed.deadlineMs);
    await nextTurn(0);
    // Drain any queued writer transaction before checking its durable cursor.
    await f.backend.uow.run(scope.owner, {}, async () => {});
    assert.ok(f.tick() - before - elapsed < 1150, "at most one card unit ran after delivery");
    const rows = await f.postings();
    assert.equal(rows.filter(row => row.sequence === 2).length, Math.min(3, Math.floor(reads / 3)));
    const indexed = await f.storage.uow.run(scope.owner, { readOnly: true }, tx =>
      f.storage.contextRead.observeIndex(tx, readSet, mixed));
    if (!indexed.cardPending) {
      assert.equal(indexed.byType.card.indexed, 3);
      published = true;
      t.diagnostic(`bound save-before-every-read: publication after ${reads}/${bound} reads`);
      break;
    }
  }
  assert.ok(published);
  assert.equal(f.loads.length, 3);
  assert.equal(new Set(f.loads.map(({ tx }) => tx)).size, 3);
  assert.equal((await writer.save(scope, "One more unrelated observation.",
    { kind: "mcp", client: null, sessionId: null })).status, "saved");
  const { result, elapsed } = await f.find();
  assert.equal(result.coverage.status, "complete");
  assert.ok(result.items.some(({ ref }) => ref.id === "card-000"));
  assert.ok(result.items.some(({ ref }) => ref.id === memory.id));
  assert.ok(elapsed < mixed.deadlineMs);
});

test("R5 revalidates unchanged cards before carry-forward and drains withheld postings", async t => {
  const f = await fixture(t);
  const { memory, linked } = await f.write(async tx => {
    const memory = await f.insert(tx, "A petrel dives for fish.");
    const linked = await f.insert(tx, "Linked observation.");
    await f.put(tx, "card-keep", "Wind blows inland.");
    for (let i = 0; i < 3; i++) {
      await f.put(tx, `card-stale-${i}`, "sweep ".repeat(35_000), [{ id: linked.id, revision: linked.revision }]);
    }
    return { memory, linked };
  });
  await f.storage.contextRead.prepareLexical(readSet, mixed, {});
  assert.equal((await f.find()).result.coverage.byType.card.indexed, 4);
  await seedFact(f.storage, { ...scope, kind: "identity", origin: "forget", actionId: "forget-linked", memoryId: linked.id });
  f.inject();
  const remaining = [3];
  let result;
  for (let read = 0; read < 8; read++) {
    ({ result } = await f.find());
    const rows = await f.postings();
    const stale = rows.filter(row => row.id.startsWith("card-stale-"));
    assert.ok(stale.every(row => row.sequence === 1 && row.revision === 1));
    assert.ok(result.items.every(({ ref }) => !ref.id.startsWith("card-stale-")));
    remaining.push(stale.length);
    if (result.coverage.status === "complete") break;
  }
  assert.deepEqual([...new Set(remaining)], [3, 2, 1, 0]);
  assert.equal(result.coverage.byType.card.indexed, 1);
  assert.deepEqual(new Set(result.items.map(({ ref }) => ref.id)), new Set([memory.id, "card-keep"]));
  assert.ok(f.loads.some(({ id, tx }) => id === "card-keep" && f.commits.some(commit => commit.card && commit.tx === tx)));
  assert.equal(await f.inspect(db => db.prepare("SELECT COUNT(*) AS count FROM cairn_context_terms WHERE id LIKE 'card-stale-%'").get().count), 0);

  const disabled = createSqliteAdapter(f.backend, { monotonicMs: f.clock, now: () => 1, capabilities: { contextRead: true } });
  const disabledApi = service(disabled, f.clock);
  await f.api.findCandidates(readSet, memoryOnly);
  assert.equal(JSON.stringify(await f.api.findCandidates(readSet, memoryOnly)),
    JSON.stringify(await disabledApi.findCandidates(readSet, memoryOnly)));
  const disabledMixed = await disabledApi.findCandidates(readSet, mixed);
  assert.equal(disabledMixed.coverage.status, "complete");
  assert.deepEqual(disabledMixed.items.map(({ ref }) => ref.id), [memory.id]);
  assert.deepEqual(disabledMixed.channels.lexical, { state: "ready", causes: [] });
});

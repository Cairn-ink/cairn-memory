import assert from "node:assert/strict";
import { test } from "node:test";
import { runInNewContext } from "node:vm";
import { createMemoryAdapter } from "@cairn-ink/adapter-memory";
import { CoreError } from "@cairn-ink/core";

const owner = "test-owner";
const scope = { owner, namespace: null };
const readScope = { owner, namespaces: [null] };
const key = { scope, client: "client", sessionId: "session", eventId: "event", payloadDigest: "a".repeat(64) };
const first = { client: key.client, sessionId: key.sessionId, messageId: "first", role: "user", occurredAtMs: 10 };
const second = { ...first, messageId: "second" };
const textHash = "sha256:" + "b".repeat(64);
const item = { kind: "fact", content: "Test memory", confidence: 0.5, textHash, embedding: null, receipts: [first] };
const source = { kind: "mcp", client: null, sessionId: null };
const row = { kind: item.kind, text: item.content, confidence: item.confidence, textHash, embedding: null,
  origin: "explicit", source };
const invalid = (error) => error instanceof CoreError && error.code === "invalid_input";

const write = ({ uow }, fn) => uow.run(owner, { pauseLock: true }, fn);
const read = ({ uow }, fn) => uow.run(owner, { readOnly: true }, fn);
const claim = (adapter) => write(adapter, (tx) => adapter.capture.claim(tx, key, [], { leaseMs: 100 }));

function withEmptyIterator(values) {
  return Object.defineProperty(values, Symbol.iterator, { value: function* () {} });
}

function hydrate(adapter, refs) {
  return read(adapter, (tx) => adapter.hydrate.hydrate(tx, readScope, refs, "read"));
}

test("markFailed uses the indexed memory ID despite a different iterator result", async () => {
  const adapter = createMemoryAdapter({ capabilities: { placement: true } });
  const { memories, placement } = adapter;
  const [firstMemory, secondMemory] = await write(adapter, async (tx) => [
    await memories.insert(tx, scope, row, [], 0),
    await memories.insert(tx, scope, row, [], 1),
  ]);
  const ids = Object.defineProperty([firstMemory.id], Symbol.iterator, {
    value: function* () { yield secondMemory.id; },
  });
  await write(adapter, (tx) => placement.markFailed(tx, scope, ids, "invalid_model_output"));
  const pending = await read(adapter, (tx) => placement.pending(tx, scope, { limit: 5 }));
  assert.deepEqual(pending, [{ memoryId: secondMemory.id, revision: secondMemory.revision }]);
});

test("applyPlacement rejects an accessor guard before accessing state or committing", async () => {
  const adapter = createMemoryAdapter({ capabilities: { placement: true } });
  const { memories, placement, harness } = adapter;
  const { id: memoryId, revision } = await write(adapter, (tx) => memories.insert(tx, scope, row, [], 0));
  const { indexRevision } = await read(adapter, (tx) => placement.catalog(tx, scope, { cursor: null, limit: 5 }));
  const proposal = { items: [{ memoryId, parentIds: [] }] };
  let reads = 0;
  const memoryRevisions = Object.defineProperty([], "0", {
    enumerable: true,
    get() { reads++; return { memoryId, revision }; },
  });
  const before = await harness.dump();
  await assert.rejects(write(adapter, (tx) =>
    placement.applyPlacement(tx, scope, { indexRevision, memoryRevisions }, proposal)), invalid);
  // Catch the rejection inside the run. A write failure after state access poisons the run.
  await write(adapter, async (tx) => {
    await assert.rejects(
      placement.applyPlacement(tx, scope, { indexRevision: indexRevision + 1, memoryRevisions }, proposal), invalid);
  });
  assert.equal(reads, 0);
  assert.deepEqual(await harness.dump(), before);
});

test("applyPlacement rejects malformed proposal arrays before checking the index revision", async () => {
  const adapter = createMemoryAdapter({ capabilities: { placement: true } });
  const { memories, placement, harness } = adapter;
  const { id: memoryId, revision } = await write(adapter, (tx) => memories.insert(tx, scope, row, [], 0));
  const { indexRevision } = await read(adapter, (tx) => placement.catalog(tx, scope, { cursor: null, limit: 5 }));
  const proposalItem = { memoryId, parentIds: [] };
  const accessorItems = Object.defineProperty([], "0", { enumerable: true, get: () => proposalItem });
  const lyingIds = new Proxy(["parent"], { get: (target, key) => key === "0" ? "other" : target[key] });
  const accessorParentIds = Object.defineProperty([], "0", { enumerable: true, get: () => "parent" });
  const before = await harness.dump();
  await write(adapter, async (tx) => {
    for (const items of [
      accessorItems,
      [{ ...proposalItem, parentIds: lyingIds }],
      [{ ...proposalItem, newL1: { title: "Child", parentL2Ids: accessorParentIds } }],
      Array(1),
    ]) {
      const basedOn = { indexRevision: indexRevision + 1, memoryRevisions: [{ memoryId, revision }] };
      await assert.rejects(placement.applyPlacement(tx, scope, basedOn, { items }), invalid);
    }
  });
  assert.deepEqual(await harness.dump(), before);
});

test("finish commits and replays the indexed item despite an empty iterator", async () => {
  const adapter = createMemoryAdapter({ now: () => 0 });
  const { token } = await claim(adapter);
  const result = await write(adapter, (tx) => adapter.capture.finish(tx, token, withEmptyIterator([item])));
  const replay = await claim(adapter);
  assert.deepEqual(replay, { status: "rawReplay", result });
  assert.equal(replay.result.memories.length, 1);
  const [{ memory }] = await hydrate(adapter, [{ type: "memory", id: result.memories[0].id, namespace: null }]);
  assert.equal(memory.text, item.content);
});

test("finish keeps the indexed receipt from a foreign-realm array with an empty iterator", async () => {
  const adapter = createMemoryAdapter({ now: () => 0 });
  const { token } = await claim(adapter);
  const receipts = withEmptyIterator(runInNewContext("[receipt]", { receipt: first }));
  const result = await write(adapter, (tx) => adapter.capture.finish(tx, token, [{ ...item, receipts }]));
  const [saved] = await hydrate(adapter, [{ type: "memory", id: result.memories[0].id, namespace: null }]);
  assert.deepEqual(saved.receipts, [first]);
});

for (const [label, value, batch] of [
  ["item", item, (items) => items],
  ["receipt", first, (receipts) => [{ ...item, receipts }]],
]) {
  test(`finish rejects an accessor ${label} without invoking it or changing the dump`, async () => {
    const adapter = createMemoryAdapter({ now: () => 0 });
    const { token } = await claim(adapter);
    const before = await adapter.harness.dump();
    let reads = 0;
    const values = Object.defineProperty([], "0", { get() { reads++; return value; } });
    await write(adapter, async (tx) => {
      await assert.rejects(adapter.capture.finish(tx, "unknown", batch(values)), invalid);
      await assert.rejects(adapter.capture.finish(tx, token, batch(values)), invalid);
    });
    assert.equal(reads, 0);
    assert.deepEqual(await adapter.harness.dump(), before);
  });
}

for (const [label, apply] of [
  ["insert", ({ memories }, tx, _id, receipts) => memories.insert(tx, scope, row, receipts, 1)],
  ["touchDuplicate", ({ memories }, tx, id, receipts) =>
    memories.touchDuplicate(tx, scope, id, receipts, { confidence: row.confidence }, 1)],
  ["replaceContent", ({ memories }, tx, id, receipts) =>
    memories.replaceContent(tx, scope, id, 1, { ...row, text: "Other memory", textHash: "sha256:" + "c".repeat(64) }, receipts, 1)],
]) {
  test(`${label} attaches the indexed receipt despite an empty iterator`, async () => {
    const adapter = createMemoryAdapter();
    const { id } = await write(adapter, (tx) => adapter.memories.insert(tx, scope, row, [], 0));
    const result = await write(adapter, (tx) => apply(adapter, tx, id, withEmptyIterator([second])));
    const [saved] = await hydrate(adapter, [{ type: "memory", id: result.id ?? id, namespace: null }]);
    assert.deepEqual(saved.receipts, [second]);
  });
}

for (const [label, lookup] of [
  ["findDuplicates", ({ memories }, tx, batch) => memories.findDuplicates(tx, scope, batch, { nearDistance: 0 })],
  ["readWritePolicy", ({ memories }, tx, batch) => memories.readWritePolicy(tx, scope, batch, source, "hash")],
]) {
  test(`${label} rejects mismatched or throwing array traps and missing slots`, async () => {
    const adapter = createMemoryAdapter();
    const query = { textHash };
    const differentLength = new Proxy([query], { get: (target, key) => key === "length" ? 0 : target[key] });
    const differentSlot = new Proxy([query], { get: (target, key) => key === "0" ? { textHash } : target[key] });
    const throwingSlot = new Proxy([query], { getOwnPropertyDescriptor(target, key) {
      if (key === "0") throw new Error("slot");
      return Reflect.getOwnPropertyDescriptor(target, key);
    } });
    const inheritedSlot = Object.setPrototypeOf(Array(1), Object.assign(Object.create(Array.prototype), { 0: query }));
    await read(adapter, async (tx) => {
      for (const batch of [differentLength, differentSlot, throwingSlot, inheritedSlot, Array(1)]) {
        await assert.rejects(lookup(adapter, tx, batch), invalid);
      }
    });
  });
}

test("snapshot tokens use the indexed namespaces despite an empty iterator", async () => {
  const adapter = createMemoryAdapter();
  await read(adapter, async (tx) => {
    const token = await adapter.snapshot.stateToken(tx, readScope);
    const misleading = { ...readScope, namespaces: withEmptyIterator([null]) };
    assert.equal(await adapter.snapshot.stateToken(tx, misleading), token);
    await adapter.snapshot.assertUnchanged(tx, misleading, token);
  });
});

test("snapshot tokens use the indexed clients despite an empty iterator", async () => {
  const adapter = createMemoryAdapter();
  await read(adapter, async (tx) => {
    const token = await adapter.snapshot.stateToken(tx, { ...readScope, clients: ["client"] });
    const misleading = { ...readScope, clients: withEmptyIterator(["client"]) };
    assert.equal(await adapter.snapshot.stateToken(tx, misleading), token);
  });
});

for (const [label, lookup] of [
  ["hydrate", (adapter, refs) => hydrate(adapter, refs)],
  ["fence", (adapter, refs) => read(adapter, (tx) => adapter.fence.assertVisible(tx, readScope, refs))],
]) {
  test(`${label} uses indexed refs despite an empty iterator`, async () => {
    const adapter = createMemoryAdapter();
    const { id } = await write(adapter, (tx) => adapter.memories.insert(tx, scope, row, [], 0));
    const ref = { type: "memory", id, namespace: null };
    const expected = await lookup(adapter, [ref]);
    assert.equal(expected.length, 1);
    assert.deepEqual(await lookup(adapter, withEmptyIterator([ref])), expected);
  });
}

test("suppression snapshots compare the indexed candidate times", async () => {
  const adapter = createMemoryAdapter();
  await adapter.harness.seedFact(owner, { owner, actionId: "window", origin: "forget", kind: "window",
    client: key.client, window: { startMs: 10, endMs: 20 } });
  const occurredAtMs = Object.defineProperty([10], "entries", { value: function* () {} });
  const result = await read(adapter, (tx) => adapter.suppressions.snapshot(tx, scope, { client: key.client, occurredAtMs }));
  assert.deepEqual(result.blockedMessages, [0]);
});

const digest = { alg: "sha256", value: textHash.slice(7), pipeline: "core", redactionVersion: 1, keyId: null };
const passage = { digests: [digest], shingles: null, keyId: null };

for (const [label, candidates] of [
  ["passages", () => ({ passages: Array(1) })],
  ["passage digests", () => ({ passages: [{ ...passage, digests: Array(1) }] })],
  ["passage shingles", () => ({ passages: [{ ...passage, shingles: Array(1) }] })],
]) {
  test(`suppression snapshots refuse holes in ${label} even without stored facts`, async () => {
    const adapter = createMemoryAdapter();
    await read(adapter, (tx) => assert.rejects(adapter.suppressions.snapshot(tx, scope, candidates()), invalid));
  });
}

test("text fact validation checks the indexed digest despite an empty iterator", async () => {
  const adapter = createMemoryAdapter();
  const fact = { owner, actionId: "text", origin: "forget", kind: "text", mode: "exact",
    text: { ...passage, digests: withEmptyIterator([{ ...digest, value: "invalid" }]) } };
  const before = await adapter.harness.dump();
  await write(adapter, (tx) => assert.rejects(adapter.suppressions.writeFact(tx, fact, "a".repeat(64)), invalid));
  assert.deepEqual(await adapter.harness.dump(), before);
});

test("text fact validation refuses shingles whose descriptor and indexed read disagree", async () => {
  const adapter = createMemoryAdapter();
  const shingles = new Proxy(["a"], { get: (target, key) => key === "0" ? "b" : target[key] });
  const fact = { owner, actionId: "text", origin: "forget", kind: "text", mode: "exact", text: { ...passage, shingles } };
  await write(adapter, (tx) => assert.rejects(adapter.suppressions.writeFact(tx, fact, "a".repeat(64)), invalid));
});

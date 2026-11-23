import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { test } from "node:test";
import { createMemoryAdapter, TEST_FINGERPRINT_LABELS } from "@cairn-ink/adapter-memory";
import { coreDigest, factBlocksIncoming, userFingerprintKey } from "@cairn-ink/core";

const owner = "test-owner";
const other = "other-owner";
const scope = { owner, namespace: null };
const readScope = { owner, namespaces: [null] };
const key = { scope, client: "test-client", sessionId: "test-session", eventId: "test-event", payloadDigest: "a".repeat(64) };
const row = {
  kind: "fact", origin: "explicit", text: "Test passage", textHash: "sha256:" + "b".repeat(64),
  confidence: 1, source: { kind: "mcp", client: null, sessionId: null }, embedding: null,
};
const digest = { alg: "sha256", value: row.textHash.slice(7), pipeline: "core", redactionVersion: 1, keyId: null };
const fact = { owner, origin: "forget", actionId: "test-action" };
const invalid = { code: "invalid_input" };
const internal = { code: "internal_error" };

async function placementFixture() {
  const adapter = createMemoryAdapter({ capabilities: { placement: true }, now: () => 1 });
  const { uow, memories, placement } = adapter;
  const { id: memoryId, revision } = await uow.run(owner, {}, (tx) => memories.insert(tx, scope, row, [], 0));
  const { indexRevision } = await uow.run(owner, { readOnly: true }, (tx) =>
    placement.catalog(tx, scope, { cursor: null, limit: 1 }));
  return { adapter, indexRevision, guard: { memoryId, revision }, item: { memoryId, parentIds: [] } };
}

for (const [name, trap] of [
  ["denies an indexed slot", { has: (target, key) => key !== "0" && Reflect.has(target, key) }],
  ["hides an index behind a decoy", { ownKeys: () => ["decoy", "length"] }],
  ["adds a non-enumerable decoy", { ownKeys: () => ["0", "length", "decoy"] }],
]) {
  test(`placement rejects a guard proxy that ${name}`, async () => {
    const { adapter: { uow, placement, harness }, indexRevision, guard, item } = await placementFixture();
    const target = Object.defineProperty([guard], "decoy", { value: guard, configurable: true,
      enumerable: name === "hides an index behind a decoy" });
    if (name === "denies an indexed slot") delete target.decoy;
    const before = await harness.dump();
    await uow.run(owner, {}, async (tx) => {
      for (const revision of [indexRevision - 1, indexRevision]) {
        const memoryRevisions = new Proxy(target, trap);
        await assert.rejects(placement.applyPlacement(tx, scope, { indexRevision: revision, memoryRevisions }, { items: [item] }), invalid);
      }
    });
    assert.deepEqual(await harness.dump(), before);
  });
}

test("the shared reader rejects hidden indexed slots outside placement", async () => {
  const { uow, memories } = createMemoryAdapter();
  const queries = new Proxy([{ textHash: row.textHash }], { ownKeys: () => ["length"] });
  await uow.run(owner, { readOnly: true }, (tx) =>
    assert.rejects(memories.findDuplicates(tx, scope, queries, { nearDistance: 0 }), invalid));
});

test("privacy-filtered reads use the issued owner after the guard", async () => {
  const { uow, memories, lexical, hydrate, snapshot, suppressions, harness } = createMemoryAdapter();
  const { id } = await uow.run(owner, {}, (tx) => memories.insert(tx, scope, row, [], 1));
  await harness.seedFact(owner, { ...fact, kind: "identity", memoryId: id });
  await harness.seedFact(owner, { ...fact, kind: "text", mode: "exact", text: { digests: [digest] } });
  await uow.run(owner, { readOnly: true }, async (tx) => {
    function unstable(selection) {
      let reads = 0;
      return { ...selection, get owner() { return reads++ === 0 ? owner : other; } };
    }
    assert.deepEqual((await lexical.lexical(tx, unstable(readScope), row.text, 5)).rows, []);
    assert.deepEqual(await hydrate.hydrate(tx, unstable(readScope), [{ type: "memory", namespace: null, id }], "read"), []);
    const token = await snapshot.stateToken(tx, readScope);
    await snapshot.assertUnchanged(tx, unstable(readScope), token);
    assert.deepEqual((await memories.exportPage(tx, unstable(scope), { cursor: null, limit: 1 })).items, []);
    assert.equal((await suppressions.snapshot(tx, unstable(scope), {})).passages.length, 1);
  });
});

test("stored receipts use the same fields that were validated", async () => {
  const { uow, memories, hydrate } = createMemoryAdapter();
  const reads = new Map();
  const fields = { client: key.client, sessionId: key.sessionId, messageId: "test-message", role: "user", occurredAtMs: 10 };
  const receipt = Object.fromEntries(Object.keys(fields).map((name) => [name, null]));
  for (const [name, value] of Object.entries(fields)) {
    Object.defineProperty(receipt, name, { get() {
      const count = (reads.get(name) ?? 0) + 1;
      reads.set(name, count);
      return name === "occurredAtMs" && count > 2 ? "invalid" : value;
    } });
  }
  const { id } = await uow.run(owner, {}, (tx) => memories.insert(tx, scope, row, [receipt], 1));
  const [saved] = await uow.run(owner, { readOnly: true }, (tx) =>
    hydrate.hydrate(tx, readScope, [{ type: "memory", namespace: null, id }], "read"));
  assert.deepEqual(saved.receipts, [fields]);
  assert.deepEqual([...reads.values()], [1, 1, 1, 1, 1]);
});

test("snapshot ignores times without a client and retains indexed validation with a client", async () => {
  const { uow, suppressions, harness } = createMemoryAdapter();
  await harness.seedFact(owner, { ...fact, kind: "window", client: key.client, window: { startMs: 10, endMs: 20 } });
  await uow.run(owner, { readOnly: true }, async (tx) => {
    const times = new Int32Array([10]);
    await assert.rejects(suppressions.snapshot(tx, scope, { client: null, occurredAtMs: times }), invalid);
    await assert.rejects(suppressions.snapshot(tx, scope, { occurredAtMs: Object.defineProperty([], "0", { get: () => 10 }) }), invalid);
    await assert.rejects(suppressions.snapshot(tx, scope, { client: key.client, occurredAtMs: times }), invalid);
    let reads = 0;
    const accessor = Object.defineProperty([], "0", { get() { reads++; return 10; } });
    await assert.rejects(suppressions.snapshot(tx, scope, { client: key.client, occurredAtMs: accessor }), invalid);
    assert.equal(reads, 0);
    assert.deepEqual((await suppressions.snapshot(tx, scope, { client: key.client, occurredAtMs: [10] })).blockedMessages, [0]);
  });
});

test("placement checks the batch limit before visiting slots or items", async () => {
  const { adapter: { uow, placement }, indexRevision, guard, item } = await placementFixture();
  const visited = [];
  const entry = { ...item, get memoryId() { visited.push("item"); return item.memoryId; } };
  const items = new Proxy(Array(4096).fill(entry), {
    ownKeys(target) { visited.push("keys"); return Reflect.ownKeys(target); },
    getOwnPropertyDescriptor(target, key) {
      if (key !== "length") visited.push("slot");
      return Reflect.getOwnPropertyDescriptor(target, key);
    },
  });
  await uow.run(owner, {}, (tx) => assert.rejects(
    placement.applyPlacement(tx, scope, { indexRevision, memoryRevisions: [guard] }, { items }), invalid));
  assert.equal(visited.length, 0);
});

test("finish and replay report only their own near skips while the harness stays cumulative", async () => {
  const { uow, capture, harness } = createMemoryAdapter({ now: () => 1, capabilities: { nearDuplicate: true } });
  function run(admission, items) {
    return uow.run(admission.scope.owner, { pauseLock: true }, async (tx) => {
      const { token } = await capture.claim(tx, admission, [], { leaseMs: 100 });
      return capture.finish(tx, token, items);
    });
  }
  const item = { content: row.text, kind: row.kind, confidence: row.confidence, textHash: row.textHash, embedding: null, receipts: [] };
  const batch = [item, { ...item, content: "Other passage", textHash: "sha256:" + "c".repeat(64) }];
  const admission = { ...key, scope: { ...scope, owner: other } };
  assert.equal((await run(admission, batch)).counters.nearSkippedUnembedded, 1);
  assert.equal((await run(key, [])).counters.nearSkippedUnembedded, 0);
  const replay = await uow.run(owner, { pauseLock: true }, (tx) => capture.claim(tx, key, [], { leaseMs: 100 }));
  assert.equal(replay.status, "rawReplay");
  assert.equal(replay.result.counters.nearSkippedUnembedded, 0);
  assert.equal((await harness.counters()).nearSkippedUnembedded, 1);
});

test("admission ports reject forged, ended and foreign-owner transactions before payload validation", async () => {
  const { uow, capture } = createMemoryAdapter();
  const ended = await uow.run(owner, {}, (tx) => tx);
  const malformed = { ...key, payloadDigest: "invalid" };
  const foreign = { ...malformed, scope: { ...scope, owner: other } };
  await uow.run(owner, { pauseLock: true }, async (tx) => {
    for (const [issued, candidate] of [[{ ...tx }, malformed], [ended, malformed], [tx, foreign]]) {
      await assert.rejects(capture.eligible(issued, candidate, []), internal);
      await assert.rejects(capture.assertEligible(issued, candidate, []), internal);
      await assert.rejects(capture.claim(issued, candidate, [], { leaseMs: 100 }), internal);
    }
    await assert.rejects(capture.eligible(tx, malformed, []), invalid);
    await assert.rejects(capture.assertEligible(tx, malformed, []), invalid);
  });
});

test("discarded queued writes leave only the sticky run rejection under strict mode", () => {
  const child = spawnSync(process.execPath, ["--unhandled-rejections=strict", "--input-type=module", "-e", `
    import assert from "node:assert/strict";
    import { createMemoryAdapter } from ${JSON.stringify(new URL("../src/index.mjs", import.meta.url).href)};
    const { uow, memories, harness } = createMemoryAdapter();
    const scope = ${JSON.stringify(scope)};
    const row = ${JSON.stringify(row)};
    await assert.rejects(uow.run(scope.owner, {}, async (tx) => {
      const { id, revision } = await memories.insert(tx, scope, row, [], 1);
      void memories.replaceContent(tx, scope, "missing", revision, row, null, 2);
      void memories.replaceContent(tx, scope, id, revision + 1, row, null, 2);
    }), { code: "memory_not_found" });
    assert.deepEqual(await harness.dump(), []);
    console.log("run rejected and rolled back");
  `], { encoding: "utf8", timeout: 5000 });
  assert.ifError(child.error);
  assert.match(child.stdout, /run rejected and rolled back/);
  assert.equal(child.status, 0, child.stderr);
});

test("an empty direct passage vector leaves exact digest matching available", async () => {
  const { uow, suppressions, harness } = createMemoryAdapter({ capabilities: { vectorSuppression: true } });
  await harness.seedFact(owner, { ...fact, kind: "text", mode: "full", text: { digests: [digest], embedding: [1, 0] } });
  await uow.run(owner, { readOnly: true }, async (tx) => {
    const passage = { digests: [digest], shingles: null, keyId: null, embedding: [] };
    const { passages: unfiltered } = await suppressions.snapshot(tx, scope, {});
    assert.equal(factBlocksIncoming(unfiltered[0], { scope, passages: [passage] }, { mode: "capture" }), true);
    const result = await suppressions.snapshot(tx, scope, { passages: [passage] });
    assert.deepEqual(result.passages, unfiltered);
    const miss = { ...passage, digests: [{ ...digest, value: "c".repeat(64) }] };
    assert.deepEqual((await suppressions.snapshot(tx, scope, { passages: [miss] })).passages, []);
  });
});

test("fixture seeding rejects a key outside the owner ring until it is published", async () => {
  const { harness, keys } = createMemoryAdapter({ capabilities: { fingerprintKey: true } });
  const nextSecret = "test-next-key";
  const next = await userFingerprintKey(nextSecret, owner, TEST_FINGERPRINT_LABELS);
  async function keyedFact(key, text) {
    return { ...fact, kind: "text", mode: "exact", text: { digests: [await coreDigest(text, key)] } };
  }
  const current = await keyedFact(await keys.userKey(owner), "Current passage");
  const future = await keyedFact(next, "Future passage");
  await harness.seedFact(owner, current);
  const before = await harness.dump();
  await assert.rejects(harness.seedFact(owner, future), invalid);
  assert.deepEqual(await harness.dump(), before);
  await harness.setFingerprintSecret(nextSecret);
  await harness.seedFact(owner, future);
  await harness.seedFact(owner, current);
});

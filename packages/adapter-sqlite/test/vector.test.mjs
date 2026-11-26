import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import { setTimeout } from "node:timers/promises";
import { PRIVACY_REDACTION_VERSIONS } from "@cairn-ink/core";
import { createMemoryService } from "@cairn-ink/core/service";
import { createSqliteAdapter, openSqliteAdapter } from "../src/adapter.mjs";
import { openStorage } from "../src/schema/open.mjs";
import { scopeKey } from "../src/storage-values.mjs";
import { scratch, seedFact, sha256, testAccess } from "./storage-fixtures.mjs";
import { waitForVectorCache } from "./vector-fixtures.mjs";

const scope = { owner: "reader", namespace: null };
const selection = { owner: scope.owner, namespaces: [null] };
const axis = Float32Array.of(1, 0, 0);
const semantic = { capabilities: { semanticRetrieval: true, supersession: true } };

async function open(t) {
  const { path, remove } = scratch();
  const storage = await openStorage(path).catch(error => { remove(); throw error; });
  const adapter = createSqliteAdapter(storage, semantic);
  t.after(async () => {
    try { await adapter.close(); } finally { remove(); }
  });
  return { adapter, path, port: storage.port };
}

function content(text, vector, { model = "test", client = "editor" } = {}) {
  return { text, textHash: "sha256:" + sha256(text), kind: "fact", origin: "explicit", confidence: 1,
    source: { kind: "mcp", client, sessionId: null }, embedding: vector && { model, vector } };
}

const read = (adapter, fn) => adapter.uow.run(scope.owner, { readOnly: true }, fn);
const write = (adapter, target, fn) => adapter.uow.run(target.owner, {}, fn);
const ref = (target, id) => ({ type: "memory", id, namespace: target.namespace });

function insert(adapter, text, vector = [0, 1, 0], { target = scope, time = 10, receipts = [], ...opts } = {}) {
  return write(adapter, target, tx => adapter.memories.insert(tx, target, content(text, vector, opts), receipts, time));
}

function search(adapter, { view = selection, query = axis, depth = 50 } = {}) {
  return read(adapter, tx => adapter.vector.vector(tx, view, query, "test", depth));
}

function addUnrelatedRows(adapter) {
  const target = { owner: "other-reader", namespace: null };
  return write(adapter, target, async tx => {
    for (let index = 0; index < 20; index++) {
      await adapter.memories.insert(tx, target, content(`other memory ${index}`, axis), [], 1);
    }
  });
}

function oracleDistance(query, vector) {
  const dot = vector.reduce((sum, value, index) => sum + value * query[index], 0);
  return 1 - dot / (Math.hypot(...query) * Math.hypot(...vector));
}

test("exact vector top depth matches a full sort, including byte and microsecond ties", async t => {
  const opened = await open(t);
  const { adapter } = opened;
  const project = { ...scope, namespace: "shared" };
  const view = { ...selection, namespaces: [project.namespace, scope.namespace] };
  const query = Float32Array.of(1, 2, 3);
  const time = 9_007_199_254_740_992n;
  const entries = [
    { id: "\u{10000}", target: project, updatedAtUs: time + 1n, vector: [1, 2, 3] },
    { id: "\uE000", target: scope, updatedAtUs: time + 1n, vector: [1, 2, 3] },
    { id: "\u{10000}", target: scope, updatedAtUs: time + 1n, vector: [1, 2, 3] },
    { id: "new-id-old-time", target: project, updatedAtUs: time, vector: [1, 2, 3] },
    ...Array.from({ length: 96 }, (_, index) => ({ id: `row-${index}`, target: index % 2 ? scope : project,
      updatedAtUs: time + BigInt(index % 7), vector: [(index * 19) % 97 - 48, 3, -2] })),
  ];
  for (const { id, target, updatedAtUs, vector } of entries) {
    const saved = await insert(adapter, `orchard ${id}`, vector, { target });
    await testAccess(opened, target, { write: true }, db => {
      assert.equal(db.prepare(`UPDATE cairn_memories SET id = ?, updated_at_us = ?
        WHERE owner_id = ? AND namespace_key = ? AND id = ?`).run(id, updatedAtUs, ...scopeKey(target), saved.id).changes, 1);
    });
  }
  await insert(adapter, "orchard other model", [...query], { model: "other" });
  await insert(adapter, "orchard wrong size", [1, 2]);
  await insert(adapter, "orchard zero vector", [0, 0, 0]);
  await waitForVectorCache(adapter, scope.owner);

  const expected = entries.map(({ id, target, updatedAtUs, vector }) =>
    ({ ref: ref(target, id), updatedAtUs, distance: oracleDistance(query, vector) }))
    .sort((a, b) => a.distance - b.distance || (a.updatedAtUs > b.updatedAtUs ? -1 : a.updatedAtUs < b.updatedAtUs ? 1 : 0) ||
      Buffer.compare(Buffer.from(b.ref.id), Buffer.from(a.ref.id)));
  for (const depth of [1, 2, 3, 7, 31, Number.MAX_SAFE_INTEGER]) {
    const found = await search(adapter, { view, query, depth });
    assert.deepEqual(found.coverage, { eligible: 103, embedded: 100, complete: false });
    const prefix = expected.slice(0, depth);
    assert.deepEqual(found.rows.map(({ ref, updatedAtUs }) => ({ ref, updatedAtUs })),
      prefix.map(({ ref, updatedAtUs }) => ({ ref, updatedAtUs })));
    for (const [index, { distance }] of found.rows.entries()) {
      assert.ok(Math.abs(distance - prefix[index].distance) < 1e-14);
    }
  }
  assert.deepEqual(await search(adapter, { view, query: new Float32Array(3) }),
    { rows: [], coverage: { eligible: 103, embedded: 0, complete: false } });
});

test("vector visibility excludes hidden rows before ranking and coverage", async t => {
  const opened = await open(t);
  const { adapter } = opened;
  const view = { ...selection, clients: ["editor"], window: { sinceMs: 10, untilMs: 20 } };
  const source = { client: "editor", sessionId: "source", messageId: "turn", role: "user", occurredAtMs: 12 };
  const denied = { ...source, sessionId: "other-source" };
  const visible = await insert(adapter, "orchard retained", [0, 1, 0], { receipts: [{ ...source, sessionId: "open-source" }] });
  const erased = await insert(adapter, "orchard forgotten", axis);
  const suppressed = "orchard suppressed";
  await insert(adapter, suppressed, axis);
  await insert(adapter, "orchard fenced", axis, { receipts: [source] });
  await insert(adapter, "orchard legacy denial", axis, { receipts: [denied] });
  const previous = await insert(adapter, "orchard historical", axis);
  await insert(adapter, "orchard before", axis, { time: 9 });
  await insert(adapter, "orchard after", axis, { time: 20 });
  await insert(adapter, "orchard wrong client", axis, { client: "other" });
  await insert(adapter, "orchard no client", axis, { client: null });
  await insert(adapter, "orchard wrong owner", axis, { target: { ...scope, owner: "other" } });
  await insert(adapter, "orchard wrong namespace", axis, { target: { ...scope, namespace: "other" } });
  await write(adapter, scope, async tx => {
    assert.equal(await adapter.memories.erase(tx, scope, erased.id), true);
    await adapter.raw.fenceSession(tx, scope, source);
    await adapter.supersession.record(tx, scope, { previous, replacement: visible }, [], 12);
    await adapter.supersession.markHistorical(tx, scope, previous.id, 12);
  });
  await seedFact(adapter, { ...scope, origin: "forget", actionId: "text", kind: "text", mode: "exact",
    text: { digests: [{ alg: "sha256", keyId: null, pipeline: "core", redactionVersion: PRIVACY_REDACTION_VERSIONS.core,
      value: sha256(suppressed) }] } });
  await seedFact(adapter, { ...scope, origin: "forget", actionId: "session", kind: "session",
    session: { client: source.client, sessionKeyHash: adapter.hashSessionKey(scope, source.client, source.sessionId) } });
  const address = sha256(JSON.stringify(["receipt-source-address-v1", denied.client, denied.sessionId, denied.messageId, denied.role]));
  await testAccess(opened, scope, { write: true }, db => {
    db.prepare("INSERT INTO cairn_legacy_denials VALUES (?, ?, ?)").run(...scopeKey(scope), "rs1:a:" + address);
  });
  await waitForVectorCache(adapter, scope.owner);
  await read(adapter, async tx => {
    const expected = [ref(scope, visible.id)];
    assert.deepEqual((await adapter.lexical.lexical(tx, view, "orchard", 50, {})).rows.map(row => row.ref), expected);
    const vector = await adapter.vector.vector(tx, view, axis, "test", 1);
    assert.deepEqual(vector.rows.map(row => row.ref), expected);
    assert.deepEqual(vector.coverage, { eligible: 1, embedded: 1, complete: true });
  });
});

function service(storage, embedQuery, diagnostics) {
  const clock = { nowMs: () => 30, monotonicMs: () => 0, sha256Hex: async text => sha256(text),
    hmacHex: () => assert.fail("No fingerprint key") };
  return createMemoryService({ storage, embedQuery, diagnostics, clock, config: {}, embedder: null,
    gate: { assertOpen() {} }, tokens: { countTokens: () => 1 } });
}

test("recall falls back with incomplete vector coverage and reorders with complete coverage", async t => {
  const { adapter } = await open(t);
  await addUnrelatedRows(adapter);
  const preferred = await insert(adapter, "orchard", [-1, 0, 0]);
  const nearby = await insert(adapter, "orchard mango", axis);
  const missing = await insert(adapter, "cedar", null);
  const reasons = [];
  const embedQuery = { async embedQuery() { return { vector: axis, model: "test" }; } };
  const lexical = service(adapter);
  const hybrid = service(adapter, embedQuery, ({ reason }) => reasons.push(reason));
  const recall = (instance, limit = 5) => instance.recall(scope, "orchard", { mode: "search", limit });

  // The first request takes the lexical fallback before any timer can warm the cache.
  assert.deepEqual(await search(adapter), { rows: [], coverage: { eligible: 0, embedded: 0, complete: false } });
  assert.deepEqual(await recall(hybrid, 1), await recall(lexical, 1));
  assert.deepEqual(reasons.splice(0), ["coverage_incomplete"]);
  await waitForVectorCache(adapter, scope.owner);
  assert.deepEqual((await recall(lexical)).items.map(({ id }) => id), [preferred.id, nearby.id]);
  assert.deepEqual(await recall(hybrid, 1), await recall(lexical, 1));
  assert.deepEqual((await search(adapter)).coverage, { eligible: 3, embedded: 2, complete: false });
  assert.deepEqual(reasons, ["coverage_incomplete"]);

  await write(adapter, scope, tx => adapter.memories.replaceContent(tx, scope, missing.id, missing.revision,
    content("cedar branch", [0, 1, 0]), null, 20));
  assert.deepEqual(await search(adapter), { rows: [], coverage: { eligible: 0, embedded: 0, complete: false } });
  assert.deepEqual(await recall(hybrid, 1), await recall(lexical, 1));
  assert.deepEqual(reasons, ["coverage_incomplete", "coverage_incomplete"]);
  await waitForVectorCache(adapter, scope.owner);
  assert.deepEqual((await search(adapter)).coverage, { eligible: 3, embedded: 3, complete: true });
  assert.deepEqual((await recall(hybrid)).items.map(({ id }) => id), [nearby.id, preferred.id, missing.id]);
  assert.deepEqual(reasons, ["coverage_incomplete", "coverage_incomplete"]);
});

test("default and keyless recall preserve lexical output without a query vector", async t => {
  const { path, remove } = scratch();
  let enabled;
  t.after(async () => {
    try { await enabled?.close(); } finally { remove(); }
  });
  const encode = value => JSON.stringify(value, (_, field) => typeof field === "bigint" ? field.toString() : field);
  const recall = instance => instance.recall(scope, "orchard", { mode: "search", limit: 1 });
  const disabled = await openSqliteAdapter(path);
  let expected;
  try {
    assert.equal(disabled.capabilities.semanticRetrieval, false);
    assert.equal(disabled.vector, undefined);
    await insert(disabled, "orchard", null);
    await insert(disabled, "orchard mango", null);
    const baseline = await recall(service(disabled));
    assert.equal(baseline.items[0].text, "orchard");
    assert.ok(baseline.nextCursor);
    expected = encode(baseline);
    assert.equal(encode(await recall(service(disabled, { async embedQuery() { assert.fail("Capability is off"); } }))), expected);
  } finally {
    await disabled.close();
  }
  enabled = await openSqliteAdapter(path, semantic);
  assert.equal(encode(await recall(service(enabled))), expected);
  assert.equal(encode(await recall(service(enabled, { async embedQuery() { return null; } }))), expected);
  assert.equal(encode(await recall(service(enabled, { async embedQuery() { return { vector: axis, model: "test" }; } }))), expected);
});

test("a vector cache for a newer snapshot cannot feed an older transaction", async t => {
  const { adapter } = await open(t);
  const original = await insert(adapter, "original", axis);
  await waitForVectorCache(adapter, scope.owner);
  const started = Promise.withResolvers();
  const resume = Promise.withResolvers();
  const reader = read(adapter, async tx => {
    started.resolve();
    await resume.promise;
    const result = await adapter.vector.vector(tx, selection, axis, "test", 5);
    assert.deepEqual(result, { rows: [], coverage: { eligible: 0, embedded: 0, complete: false } });
  });
  let later;
  try {
    await Promise.race([started.promise, reader]);
    later = await insert(adapter, "later", axis, { time: 11 });
  } finally {
    resume.resolve();
    await reader;
  }
  await waitForVectorCache(adapter, scope.owner);
  assert.deepEqual((await search(adapter)).rows.map(row => row.ref.id), [later.id, original.id]);
});

test("committed writes, forget, suppression and Raw fences refresh a warm vector generation", async t => {
  const { adapter } = await open(t);
  await addUnrelatedRows(adapter);
  const old = await insert(adapter, "orchard old", axis);
  const stable = await insert(adapter, "orchard stable", [0, 1, 0]);
  await waitForVectorCache(adapter, scope.owner);
  const ranking = async () => (await search(adapter)).rows.map(({ ref }) => ref.id);
  const cold = { rows: [], coverage: { eligible: 0, embedded: 0, complete: false } };
  assert.deepEqual(await ranking(), [old.id, stable.id]);

  const added = await insert(adapter, "orchard added", axis, { time: 12 });
  assert.deepEqual(await search(adapter), cold);
  await waitForVectorCache(adapter, scope.owner);
  assert.deepEqual(await ranking(), [added.id, old.id, stable.id]);

  await write(adapter, scope, tx => adapter.memories.replaceContent(tx, scope, added.id, added.revision,
    content("orchard corrected", [-1, 0, 0]), null, 15));
  assert.deepEqual(await search(adapter), cold);
  await waitForVectorCache(adapter, scope.owner);
  assert.deepEqual(await ranking(), [old.id, stable.id, added.id]);

  assert.equal((await service(adapter).forget(scope, old.id, { kind: "mcp", client: null, sessionId: null })).status,
    "forgotten");
  // Let the commit-triggered rebuild run without a vector request prodding it.
  await setTimeout(60);
  assert.deepEqual(await ranking(), [stable.id, added.id]);

  const source = { client: "editor", sessionId: "source" };
  await adapter.uow.run(scope.owner, { pauseLock: true }, tx => adapter.raw.fenceSession(tx, scope, source));
  assert.deepEqual(await search(adapter), cold);
  await waitForVectorCache(adapter, scope.owner);
  assert.deepEqual(await ranking(), [stable.id, added.id]);

  await seedFact(adapter, { ...scope, origin: "forget", actionId: "text", kind: "text", mode: "exact",
    text: { digests: [{ alg: "sha256", keyId: null, pipeline: "core", redactionVersion: PRIVACY_REDACTION_VERSIONS.core,
      value: sha256("orchard stable") }] } });
  assert.deepEqual(await search(adapter), cold);
  await waitForVectorCache(adapter, scope.owner);
  assert.deepEqual(await ranking(), [added.id]);
});

test("the vector channel returns exact order and distances after approximate ties", async t => {
  const { adapter } = await open(t);
  const closest = await insert(adapter, "orchard close", [1, 0.002, 0], { time: 10 });
  const farther = await insert(adapter, "orchard farther", [1, 0.003, 0], { time: 20 });
  const { rows } = await search(adapter, { depth: 2 });
  assert.deepEqual(rows.map(({ ref }) => ref.id), [closest.id, farther.id]);
  assert.ok(rows[0].distance > 0 && rows[0].distance < rows[1].distance);
});

test("vector and lexical client filters preserve stored JSON strings", async t => {
  const { adapter } = await open(t);
  await insert(adapter, "orchard unfiltered", axis, { client: "editor" });
  const escaped = await insert(adapter, "orchard escaped", axis, { client: "editor\0child" });
  await waitForVectorCache(adapter, scope.owner);
  const view = { ...selection, clients: ["editor\0child"] };
  const lexical = await read(adapter, tx => adapter.lexical.lexical(tx, view, "orchard", 2, {}));
  assert.deepEqual(lexical.rows.map(({ ref }) => ref.id), [escaped.id]);
  const vector = await search(adapter, { view });
  assert.deepEqual(vector.rows.map(({ ref }) => ref.id), [escaped.id]);
  assert.deepEqual(vector.coverage, { eligible: 1, embedded: 1, complete: true });
});

test("rollbacks keep the warm cache and external commits invalidate it even at the same revision", async t => {
  const { adapter, path } = await open(t);
  const original = await insert(adapter, "orchard original", axis);
  const other = await insert(adapter, "orchard other", [0, 1, 0]);
  await waitForVectorCache(adapter, scope.owner);
  const readIds = async () => (await search(adapter)).rows.map(({ ref }) => ref.id);
  assert.deepEqual(await readIds(), [original.id, other.id]);

  const rollback = new Error("rollback");
  await assert.rejects(write(adapter, scope, async tx => {
    await adapter.memories.erase(tx, scope, original.id);
    const result = await adapter.vector.vector(tx, selection, axis, "test", 2);
    assert.equal(result.coverage.complete, false);
    assert.deepEqual(result.rows, []);
    throw rollback;
  }), error => error === rollback);
  assert.deepEqual(await readIds(), [original.id, other.id]);

  const db = new DatabaseSync(path);
  try {
    assert.equal(db.prepare(`UPDATE cairn_memories SET body = json_set(body, '$.embedding.vector', json('[-1,0,0]'))
      WHERE owner_id = ? AND id = ?`).run(scope.owner, original.id).changes, 1);
  } finally {
    db.close();
  }
  assert.deepEqual(await search(adapter), { rows: [], coverage: { eligible: 0, embedded: 0, complete: false } });
  await waitForVectorCache(adapter, scope.owner);
  assert.deepEqual(await readIds(), [other.id, original.id]);
});

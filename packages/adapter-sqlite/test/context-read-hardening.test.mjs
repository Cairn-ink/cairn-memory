import assert from "node:assert/strict";
import { test } from "node:test";
import { contextReadTestService } from "@cairn-ink/conformance/context-read";
import { createSqliteAdapter } from "../src/adapter.mjs";
import { openStorage } from "../src/schema/open.mjs";
import { scratch, sha256, testAccess } from "./storage-fixtures.mjs";

const scope = { owner: "fixture-owner", namespace: "project\0read" };
const outside = { ...scope, namespace: "project\0outside" };
const readSet = { owner: scope.owner, namespaces: [scope.namespace], accessGenerations: [1] };
const options = { capabilities: { contextRead: true, contextRawRead: true } };
const source = { kind: "mcp", client: null, sessionId: null };
const session = sessionId => ({ client: "fixture-client", sessionId });
const message = (id, content = "albatross sighting", role = "user") => ({ id, content, role, occurredAtMs: null });
const receipt = (address, turn) => ({ ...address, messageId: turn.id, role: turn.role,
  occurredAtMs: turn.occurredAtMs, excerpt: turn.content });
const read = (adapter, action) => adapter.uow.run(scope.owner, { readOnly: true }, action);
const write = (adapter, action) => adapter.uow.run(scope.owner, { pauseLock: true }, action);

async function fixture(t) {
  const file = scratch();
  const adapters = [];
  t.after(async () => {
    try {
      for (const adapter of adapters) await adapter.close();
    } finally {
      file.remove();
    }
  });
  async function open() {
    const storage = await openStorage(file.path);
    const adapter = createSqliteAdapter(storage, options);
    adapters.push(adapter);
    return { adapter, port: storage.port };
  }
  return { ...await open(), open };
}

async function insert(adapter, text, receipts = [], now = 1) {
  const row = await write(adapter, tx => adapter.memories.insert(tx, scope, {
    text, kind: "fact", confidence: 1, origin: "explicit", source, embedding: null,
    textHash: "sha256:" + sha256(text.toLowerCase()),
  }, receipts, now));
  return { type: "memory", scope, id: row.id, revision: row.revision };
}

async function archive(adapter, target, address, turns, record = false) {
  await write(adapter, async tx => {
    const key = { scope: target, ...address, eventId: address.sessionId, payloadDigest: "a".repeat(64) };
    assert.equal((await adapter.raw.archive(tx, key, turns)).archived, turns.length);
    if (record) await adapter.raw.recordLineage(tx, key, turns);
  });
}

async function publish(adapter) {
  for (let pass = 0; pass < 8; pass++) {
    if (await adapter.maintainContextRaw(readSet)) return;
  }
  assert.fail("Raw inventory did not finish reconciliation");
}

function searchRaw(adapter) {
  return read(adapter, tx => adapter.contextRead.raw.search(tx, readSet, "albatross", { limit: 24, lexicalOnly: true }));
}

test("erase and forget remove lexical terms in the erasing transaction", async t => {
  const db = await fixture(t);
  const { adapter } = db;
  const erase = await insert(adapter, "albatross first");
  const forget = await insert(adapter, "albatross second");
  const keep = await insert(adapter, "albatross third");
  const selections = ["current", "history"].map(intent => ({ types: ["memory"], intent }));
  const reconcile = () => Promise.all(selections.map(selection => adapter.contextRead.prepareLexical(readSet, selection, {})));
  const counts = (db, id) => ["documents", "terms"].map(table =>
    db.prepare(`SELECT count(*) AS n FROM cairn_context_${table} WHERE id = ?`).get(id).n);
  const retained = id => testAccess(db, scope, {}, connection => counts(connection, id));
  await reconcile();
  assert.deepEqual(await retained(erase.id), [2, 4]);
  assert.deepEqual(await retained(forget.id), [2, 4]);

  const rollback = new Error("rollback erase");
  await assert.rejects(write(adapter, async tx => {
    assert.equal(await adapter.memories.erase(tx, scope, erase.id), true);
    assert.deepEqual(await db.port(tx, scope.owner, {}, connection => counts(connection, erase.id)), [0, 0]);
    throw rollback;
  }), error => error === rollback);
  assert.deepEqual(await retained(erase.id), [2, 4]);
  await write(adapter, async tx => {
    assert.equal(await adapter.memories.erase(tx, scope, erase.id), true);
    assert.deepEqual(await db.port(tx, scope.owner, {}, connection => counts(connection, erase.id)), [0, 0]);
  });
  assert.equal((await contextReadTestService(adapter).forget(scope, forget.id, source)).status, "forgotten");
  assert.deepEqual(await retained(forget.id), [0, 0]);
  assert.deepEqual(await retained(keep.id), [2, 4]);
  assert.deepEqual((await reconcile()).map(metrics => metrics.removed), [2, 2]);
  assert.deepEqual((await reconcile()).map(metrics => metrics.removed), [0, 0]);
  assert.deepEqual(await retained(erase.id), [0, 0]);
  assert.deepEqual(await retained(forget.id), [0, 0]);
  assert.deepEqual(await retained(keep.id), [2, 4]);
});

test("an opaque Raw checkpoint resumes after reopen", async t => {
  const db = await fixture(t);
  const address = session("checkpoint-session");
  await archive(db.adapter, scope, address,
    Array.from({ length: 1025 }, (_, i) => message(`checkpoint-turn-${String(i).padStart(4, "0")}`)));
  assert.equal(await db.adapter.maintainContextRaw(readSet), false);
  const checkpoint = ({ adapter, port }) => testAccess({ adapter, port }, scope, {}, connection =>
    connection.prepare("SELECT last_key, examined, published FROM cairn_context_raw_checkpoints").get());
  const pending = await checkpoint(db);
  assert.equal(pending.examined, 1024);
  assert.equal(pending.published, 0);
  for (const coordinate of [address.client, address.sessionId, "checkpoint-turn-", "project"]) {
    assert.equal(pending.last_key.includes(coordinate), false, `Checkpoint copied ${coordinate}`);
  }
  await db.adapter.close();

  const reopened = await db.open();
  assert.equal(await reopened.adapter.maintainContextRaw(readSet), true);
  const done = await checkpoint(reopened);
  assert.equal(done.examined, 1025);
  assert.equal(done.published, 1);

  const plaintext = JSON.stringify([scope.namespace, address.client, address.sessionId, "checkpoint-turn-1023"]);
  await testAccess(reopened, scope, { write: true }, connection =>
    connection.prepare("UPDATE cairn_context_raw_checkpoints SET last_key = ?, examined = 1024, published = 0").run(plaintext));
  await reopened.adapter.close();
  const upgraded = await db.open();
  assert.equal(await checkpoint(upgraded), undefined);
  assert.equal(await upgraded.adapter.maintainContextRaw(readSet), false);
  assert.equal(await upgraded.adapter.maintainContextRaw(readSet), true);
});

test("fenced Raw rows do not spend the row or text caps", async t => {
  const { adapter } = await fixture(t);
  const safe = message("safe-turn");
  await archive(adapter, scope, session("z-safe"), [safe]);
  await publish(adapter);
  const baseline = await searchRaw(adapter);
  assert.equal(baseline.coverage, "included");
  assert.deepEqual(baseline.turns.map(turn => turn.messageId), [safe.id]);

  for (const [address, count, text] of [
    [session("a-long-fenced"), 216, "x".repeat(20_000)],
    [session("b-many-fenced"), 4097, "short"],
  ]) {
    await archive(adapter, scope, address, Array.from({ length: count }, (_, i) => message(`hidden-${i}`, text)));
    await write(adapter, tx => adapter.raw.fenceSession(tx, scope, address));
    await publish(adapter);
    const result = await searchRaw(adapter);
    assert.equal(result.coverage, "included", address.sessionId);
    assert.deepEqual(result.turns.map(turn => turn.messageId), [safe.id]);
  }
});

test("inspect continuations bind relevant receipt safety across namespaces", async t => {
  const { adapter } = await fixture(t);
  const root = session("root"), fork = session("fork");
  const shared = message("shared-turn");
  await archive(adapter, outside, root, [shared], true);
  await archive(adapter, scope, fork, [shared], true);
  const safe = receipt(session("standalone"), message("safe-turn", "independent source"));
  const memory = await insert(adapter, "Memory with two receipts", [safe], 1);
  await write(adapter, tx => adapter.memories.touchDuplicate(tx, scope, memory.id,
    [receipt(fork, shared)], { confidence: 1 }, 2));
  await insert(adapter, "Second Memory for listing", [], 3);
  const inspect = contextReadTestService(adapter).inspect;
  const itemInput = { memoryId: memory.id, receiptLimit: 1 };
  const firstItem = await inspect(scope, itemInput);
  const firstList = await inspect(scope, { limit: 1 });
  assert.equal(firstItem.receipts[0].messageId, safe.messageId);
  assert.ok(firstItem.nextReceiptCursor);
  assert.ok(firstList.nextCursor);

  const unrelated = session("unrelated");
  await archive(adapter, outside, unrelated, [message("unrelated-turn")]);
  await write(adapter, tx => adapter.raw.fenceSession(tx, outside, unrelated));
  assert.equal((await inspect(scope, itemInput)).nextReceiptCursor, firstItem.nextReceiptCursor);
  assert.equal((await inspect(scope, { limit: 1 })).nextCursor, firstList.nextCursor);
  const nextItem = () => inspect(scope, { ...itemInput, receiptCursor: firstItem.nextReceiptCursor });
  const nextList = () => inspect(scope, { limit: 1, cursor: firstList.nextCursor });
  assert.deepEqual((await nextItem()).receipts.map(row => row.messageId), [shared.id]);
  assert.deepEqual((await nextList()).memories.map(row => row.id), [memory.id]);

  await write(adapter, tx => adapter.raw.fenceSession(tx, outside, root));
  await assert.rejects(nextItem, { code: "cursor_stale" });
  await assert.rejects(nextList, { code: "cursor_stale" });
  assert.deepEqual((await inspect(scope, itemInput)).receipts.map(row => row.messageId), [safe.messageId]);
});

test("Raw search withholds a fork whose root has a different role", async t => {
  const { adapter } = await fixture(t);
  const shared = message("shared-turn");
  await archive(adapter, outside, session("matching-root"), [shared], true);
  await archive(adapter, scope, session("fork"), [shared], true);
  await publish(adapter);
  assert.deepEqual((await searchRaw(adapter)).turns.map(turn => turn.messageId), [shared.id]);
  await archive(adapter, outside, session("conflicting-root"), [{ ...shared, role: "assistant" }], true);
  await publish(adapter);
  assert.deepEqual(await searchRaw(adapter), { turns: [], coverage: "included" });
});

test("fetch caps qualified receipts after withholding unsafe receipts", async t => {
  const { adapter } = await fixture(t);
  const address = session("fenced-receipts");
  const denied = Array.from({ length: 17 }, (_, i) => message(`denied-${i}`, "withheld source"));
  await archive(adapter, scope, address, denied);
  const ref = await insert(adapter, "Memory with many receipts", denied.map(turn => receipt(address, turn)));
  const safe = Array.from({ length: 17 }, (_, i) => receipt(session("safe-receipts"),
    message(`safe-${i}`, `safe source ${i}`)));
  for (const [i, item] of safe.entries()) {
    await write(adapter, tx => adapter.memories.touchDuplicate(tx, scope, ref.id, [item], { confidence: 1 }, i + 2));
  }
  await write(adapter, tx => adapter.raw.fenceSession(tx, scope, address));

  const service = contextReadTestService(adapter);
  const inspected = await service.inspect(scope, { memoryId: ref.id });
  assert.deepEqual(inspected.receipts.map(row => row.messageId), safe.map(row => row.messageId));
  const current = await read(adapter, tx => adapter.memories.get(tx, scope, ref.id));
  const result = await service.fetchEvidence(readSet, { refs: [{ ...ref, revision: current.revision }], intent: "current" });
  const { provenance } = result.items[0];
  assert.deepEqual(provenance.sources.map(row => row.receiptId), inspected.receipts.slice(0, 16).map(row => row.id));
  assert.deepEqual(provenance.coverage, { status: "budget_exhausted", included: 16, omitted: null });
});

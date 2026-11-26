import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
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
  return { ...await open(), open, path: file.path };
}

async function insert(adapter, text, receipts = []) {
  const row = await write(adapter, tx => adapter.memories.insert(tx, scope, {
    text, kind: "fact", confidence: 1, origin: "explicit", source, embedding: null,
    textHash: "sha256:" + sha256(text.toLowerCase()),
  }, receipts, 1));
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

test("Raw checkpoints resume after reopen and plaintext is replaced only by upkeep", async t => {
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
  const bytes = readFileSync(db.path);
  const readOnlyOpen = await db.open();
  await readOnlyOpen.adapter.close();
  assert.ok(readFileSync(db.path).equals(bytes), "Opening a store with a plaintext checkpoint changed database bytes");

  const upkeep = await db.open();
  assert.equal(await upkeep.adapter.maintainContextRaw(readSet), false);
  const restarted = await checkpoint(upkeep);
  assert.equal(restarted.examined, 1024);
  assert.equal(restarted.published, 0);
  assert.match(restarted.last_key, /^v1\.[A-Za-z0-9_-]+$/u);
  assert.equal(await upkeep.adapter.maintainContextRaw(readSet), true);
  const completed = await checkpoint(upkeep);
  assert.equal(completed.examined, 1025);
  assert.equal(completed.published, 1);
  assert.match(completed.last_key, /^v1\.[A-Za-z0-9_-]+$/u);
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

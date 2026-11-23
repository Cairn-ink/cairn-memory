import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import {
  createPostgresMemoryReads, createPostgresMemoryStore, createPostgresPauseStore,
  createPostgresSupersessionStore, createPostgresSuppressionStore, createPostgresUnitOfWork,
} from "../src/index.mjs";
import { migrationDatabase, migrationDbTest } from "./migration-database.mjs";

const owner = "memory-owner";
const other = "other-owner";
const scope = { owner, namespace: null };
const readSet = { owner, namespaces: [null] };
const readOnly = { readOnly: true };
const pauseLock = { pauseLock: true };
const evidence = { client: "client", sessionId: "session", messageId: "message", role: "user", occurredAtMs: 0.0005 };
const hash = (text) => createHash("sha256").update(text).digest("hex");
const content = (text, vector = [1, ...Array(1535).fill(0)]) => ({
  text, textHash: "sha256:" + hash(text), confidence: 1, kind: "fact", origin: "explicit",
  source: { kind: "mcp", client: null, sessionId: null }, embedding: { model: "fixture", vector },
});
const ref = (id) => ({ type: "memory", namespace: null, id });

async function fixture(t) {
  const { pool, source } = await migrationDatabase(t);
  await pool.query("INSERT INTO users (id) VALUES ($1), ($2)", [owner, other]);
  const { run } = createPostgresUnitOfWork(source);
  return {
    pool, run, memories: createPostgresMemoryStore(), pause: createPostgresPauseStore(),
    supersession: createPostgresSupersessionStore(), suppressions: createPostgresSuppressionStore(),
    ...createPostgresMemoryReads(),
  };
}

test("Postgres advances only the acting owner's index for committed memory and pause changes", migrationDbTest, async (t) => {
  const { pool, run, memories, pause, supersession, hydrate, recent, fence } = await fixture(t);
  await pool.query("INSERT INTO core_owner_state (user_id, index_revision) VALUES ($1, 19)", [other]);
  const state = async (revision) => {
    const { rows } = await pool.query("SELECT user_id, index_revision, fact_epoch FROM core_owner_state ORDER BY user_id COLLATE \"C\"");
    assert.deepEqual(rows, [
      { user_id: owner, index_revision: String(revision), fact_epoch: "0" },
      { user_id: other, index_revision: "19", fact_epoch: "0" },
    ]);
  };

  const original = content("original");
  const inserted = await run(owner, {}, (tx) => memories.insert(tx, scope, original, [], 10));
  const { id } = inserted;
  await state(1);
  const merge = { confidence: original.confidence };
  await run(owner, {}, (tx) => memories.touchDuplicate(tx, scope, id, [evidence, evidence], merge, 10));
  await state(2);
  const [item] = await run(owner, readOnly, (tx) => hydrate.hydrate(tx, readSet, [ref(id)], "read"));
  assert.deepEqual(item.receipts, [evidence]);

  await run(owner, {}, (tx) => memories.touchDuplicate(tx, scope, id, [evidence], merge, 10));
  await run(owner, {}, (tx) => memories.replaceContent(tx, scope, id, 1, original, [], 11));
  await run(owner, pauseLock, (tx) => pause.set(tx, owner, false));
  await state(2);

  await assert.rejects(run(owner, {}, async (tx) => {
    await memories.replaceContent(tx, scope, id, 1, content("rolled back"), [], 12);
    throw new Error("rollback");
  }), { message: "rollback" });
  await state(2);
  await run(owner, {}, (tx) => memories.replaceContent(tx, scope, id, 1, content("changed"), null, 12));
  await state(3);

  await run(owner, {}, (tx) => supersession.markHistorical(tx, scope, id, 13));
  await state(4);
  await assert.rejects(
    run(owner, {}, (tx) => memories.replaceContent(tx, scope, id, 3, original, null, 14)),
    { code: "memory_historical" },
  );
  await state(4);
  await run(owner, readOnly, async (tx) => {
    const page = await recent.recent(tx, readSet, { cursor: null, limit: 1 });
    assert.deepEqual(page.items, []);
    assert.deepEqual(await fence.assertVisible(tx, readSet, [ref(id)], "read"), [ref(id)]);
  });
  await run(owner, pauseLock, (tx) => pause.set(tx, owner, true));
  await state(5);
  await run(owner, pauseLock, (tx) => pause.set(tx, owner, false));
  await state(6);

  await run(owner, {}, async (tx) => {
    assert.equal(await memories.erase(tx, scope, id), true);
    assert.equal(await memories.erase(tx, scope, id), false);
  });
  await state(7);
  assert.equal((await pool.query("SELECT 1 FROM core_memory_receipts WHERE user_id = $1", [owner])).rowCount, 0);
});

test("Postgres reads legacy metadata and pages by exact microseconds then C collation", migrationDbTest, async (t) => {
  const { pool, run, memories, recent } = await fixture(t);
  const ids = ["\u{10000}", "\uE000", "later"];
  const vector = JSON.stringify(content("fixture").embedding.vector);
  for (const [i, id] of ids.entries()) {
    await pool.query(`INSERT INTO memories (user_id, id, text, text_hash, kind, embedding, embedding_model,
      source_kind, updated_at, created_at) VALUES ($1, $2, $2, $3, 'fact', $4, 'fixture', 'plugin',
      TIMESTAMPTZ 'epoch' + $5::int * INTERVAL '1 microsecond', TIMESTAMPTZ 'epoch')`,
    [owner, id, hash(id), vector, i === 2 ? 1002 : 1001]);
  }
  await run(owner, readOnly, async (tx) => {
    const order = [];
    let cursor = null;
    do {
      const page = await recent.recent(tx, readSet, { cursor, limit: 1 });
      const [row] = page.items;
      assert.deepEqual([row.origin, row.confidence, row.revision, row.source.kind], ["inferred", 1, 1, "plugin"]);
      order.push([row.id, row.updatedAtUs]);
      cursor = page.nextCursor;
    } while (cursor !== null);
    assert.deepEqual(order, [[ids[2], 1002n], [ids[0], 1001n], [ids[1], 1001n]]);
    const [matches] = await memories.findDuplicates(tx, scope, [{ textHash: "sha256:" + hash(ids[0]) }], { nearDistance: 0 });
    assert.deepEqual(matches.map(match => match.id), [ids[0]]);
  });
});

test("Postgres preserves safe-integer import times and scoped hashes across the hosted unique key", migrationDbTest, async (t) => {
  const { run, memories, suppressions, hydrate } = await fixture(t);
  const text = content("shared text");
  const earlier = await run(owner, {}, (tx) => memories.insert(tx, scope, {
    ...text, createdAtMs: Number.MIN_SAFE_INTEGER,
  }, [], Number.MAX_SAFE_INTEGER));
  const named = { owner, namespace: "project\u0000example" };
  const later = await run(owner, {}, (tx) => memories.insert(tx, named, text, [], 10));
  await run(owner, readOnly, async (tx) => {
    const saved = await memories.get(tx, scope, earlier.id);
    assert.equal(saved.createdAtMs, Number.MIN_SAFE_INTEGER);
    assert.equal(saved.updatedAtUs, BigInt(Number.MAX_SAFE_INTEGER) * 1000n);
    assert.equal((await memories.get(tx, named, later.id)).textHash, text.textHash);
    assert.equal(await memories.get(tx, scope, later.id), null);
  });

  const existing = await run(owner, {}, (tx) => memories.insert(tx, scope, content("to edit"), [], 11));
  const fact = { owner, kind: "identity", origin: "forget", actionId: "fixture", memoryId: earlier.id };
  await run(owner, {}, (tx) => suppressions.writeFact(tx, fact, hash("fixture")));
  await run(owner, {}, (tx) => memories.replaceContent(tx, scope, existing.id, 1, text, null, 12));
  const visible = await run(owner, readOnly, (tx) => hydrate.hydrate(tx, readSet, [ref(earlier.id), ref(existing.id)], "read"));
  assert.deepEqual(visible.map(({ memory }) => [memory.id, memory.textHash]), [[existing.id, text.textHash]]);
});

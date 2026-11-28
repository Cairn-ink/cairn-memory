import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import { createPostgresSuppressionStore, createPostgresTopicStore, createPostgresUnitOfWork } from "../src/index.mjs";
import { factIncarnationBody } from "../../core/src/index.mjs";
import { decodeCursor } from "../../core/src/retrieval/hosted-paging.mjs";
import { migrationDatabase, migrationDbTest } from "./migration-database.mjs";

const owner = "hosted-unfiled";
const scope = { owner, namespace: null };

test("T-TOP-HU-PG hosted outcomes and revision-preserving writes", migrationDbTest, async t => {
  const { pool, source } = await migrationDatabase(t);
  const { run } = createPostgresUnitOfWork(source);
  const store = createPostgresTopicStore();
  const newer = '"'.repeat(1500) + "🥧,:";
  const older = "z,:[1]";
  const l2 = "l2-only";
  const stale = "stale-edge";
  await pool.query("INSERT INTO users (id) VALUES ($1)", [owner]);
  await pool.query("INSERT INTO topic_index_state VALUES ($1, 7)", [owner]);
  await pool.query("INSERT INTO core_owner_state (user_id, index_revision) VALUES ($1, 11)", [owner]);
  await pool.query(`INSERT INTO memories (id, user_id, text, kind, text_hash, revision, embedding, embedding_model, source_kind, created_at)
    SELECT id, $1, id, 'fact', md5(id), revision, (ARRAY[1] || array_fill(0, ARRAY[1535]))::vector,
      'fixture', 'web', '2025-01-02 03:04:05.123000+00'::timestamptz + rank * INTERVAL '1 microsecond'
    FROM unnest($2::text[], $3::int[], $4::int[]) AS x(id, revision, rank)`,
  [owner, [newer, older, l2, stale, "current-l1", "terminal"], [1, 1, 1, 2, 1, 1], [1, 0, 0, 0, 2, 3]]);
  await pool.query(`INSERT INTO topics (user_id, id, level, title, title_key)
    VALUES ($1, 'l1', 1, 'Region', 'region'), ($1, 'l2', 2, 'Parent', 'parent')`, [owner]);
  await pool.query(`INSERT INTO memory_placements (user_id, memory_id, memory_revision, status, attempts)
    SELECT $1, id, revision, CASE WHEN id = 'terminal' THEN 'failed' WHEN id = $2 THEN 'filed' ELSE 'unfiled' END,
      CASE WHEN id = 'terminal' THEN 2 ELSE 0 END
    FROM memories WHERE user_id = $1`, [owner, older]);
  await pool.query(`INSERT INTO memory_topics (user_id, memory_id, topic_id, memory_revision)
    VALUES ($1, 'current-l1', 'l1', 1), ($1, $2, 'l1', 1), ($1, $3, 'l2', 1)`, [owner, stale, l2]);

  const page = (cursor = null, limit = 1) => run(owner, { readOnly: true }, tx => store.unfiled(tx, scope, { cursor, limit }));
  const clock = () => run(owner, { readOnly: true }, async tx =>
    (await store.catalog(tx, scope, { cursor: null, limit: 10 })).indexRevision);
  const first = await page();
  const pairs = [[newer, 1], [l2, 1], [stale, 2], [older, 1]];
  const digest = createHash("sha256").update(JSON.stringify(pairs)).digest("hex");
  assert.equal(first.count, 4);
  assert.deepEqual(first.items, [{ id: newer, revision: 1, createdAtUs: 1735787045123001n }]);
  assert.ok(first.nextCursor.length > 4096);
  assert.deepEqual(decodeCursor(first.nextCursor), ["unfiled", owner, 18, digest, "1735787045123001", newer]);
  assert.deepEqual(await page(first.nextCursor, 50), { count: 4, nextCursor: null, items: [
    { id: older, revision: 1, createdAtUs: 1735787045123000n },
    { id: stale, revision: 2, createdAtUs: 1735787045123000n },
    { id: l2, revision: 1, createdAtUs: 1735787045123000n },
  ] });

  // A legacy edit plus replacement outcome changes only a revision in the digest.
  await pool.query("UPDATE memories SET revision = 2 WHERE user_id = $1 AND id = $2", [owner, newer]);
  await pool.query("UPDATE memory_placements SET memory_revision = 2 WHERE user_id = $1 AND memory_id = $2", [owner, newer]);
  assert.equal(await clock(), 18);
  await assert.rejects(page(first.nextCursor), { code: "cursor_stale" });

  const beforeForget = await page();
  await pool.query("INSERT INTO memory_forget_log (user_id, memory_id) VALUES ($1, $2)", [owner, older]);
  assert.equal(await clock(), 18);
  await assert.rejects(page(beforeForget.nextCursor), { code: "cursor_stale" });
  const beforeRetry = await page();
  assert.equal(beforeRetry.count, 3);

  await pool.query(`UPDATE memory_placements SET status = 'unfiled', attempts = 3
    WHERE user_id = $1 AND memory_id = 'terminal'`, [owner]);
  assert.equal(await clock(), 18);
  await assert.rejects(page(beforeRetry.nextCursor), { code: "cursor_stale" });
  assert.equal((await page()).items[0].id, "terminal");

  const beforeHostedAdvance = await page();
  await pool.query("UPDATE topic_index_state SET revision = revision + 1 WHERE user_id = $1", [owner]);
  assert.equal(await clock(), 19);
  await assert.rejects(page(beforeHostedAdvance.nextCursor), { code: "cursor_stale" });

  // Receipt evidence supersedes the physical memory source for plain session facts.
  await pool.query("UPDATE core_owner_state SET legacy_facts_ready = true WHERE user_id = $1", [owner]);
  await pool.query(`UPDATE memories SET source_client = 'client', source_session_id = 'hidden'
    WHERE user_id = $1 AND id = ANY($2)`, [owner, [newer, l2]]);
  await pool.query(`INSERT INTO core_memory_receipts (user_id, memory_id, client, session_id, message_id, role)
    VALUES ($1, $2, 'client', 'safe', 'kept', 'user'), ($1, $3, 'client', 'hidden', 'denied', 'user')`,
  [owner, newer, stale]);
  await pool.query(`INSERT INTO suppressions (id, user_id, kind, origin, client, session_id)
    VALUES ('plain-session', $1, 'session', 'forget', 'client', 'hidden')`, [owner]);
  assert.deepEqual((await page(null, 50)).items.map(row => row.id), ["terminal", newer]);
  const counts = () => run(owner, { readOnly: true }, tx => store.memoryCounts(tx, scope));
  assert.deepEqual(await counts(), { memoryCount: 3, pending: 0 });
  const identity = { ...scope, kind: "identity", origin: "forget", actionId: "hide-member",
    memoryId: "current-l1", throughRevision: 1 };
  const incarnation = createHash("sha256").update(factIncarnationBody(identity)).digest("hex");
  await run(owner, {}, tx => createPostgresSuppressionStore().writeFact(tx, identity, incarnation));
  assert.deepEqual(await counts(), { memoryCount: 2, pending: 0 });
});

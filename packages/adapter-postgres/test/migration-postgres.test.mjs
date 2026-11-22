import assert from "node:assert/strict";
import test from "node:test";
import { CoreError } from "../../core/src/index.mjs";
import { applyMigrations } from "../src/index.mjs";
import { migrationDatabase, migrationDbTest } from "./migration-database.mjs";

const readLedger = "SELECT id, applied_at::text FROM core_schema_migrations ORDER BY id";

test("Postgres bootstraps the hosted baseline and applies all migrations on an empty database", migrationDbTest, async (t) => {
  const { pool, source, baseline, migrations } = await migrationDatabase(t);
  const { rows: [tables] } = await pool.query(`
    SELECT array_agg(relname::text ORDER BY relname::text COLLATE "C") AS tables
    FROM pg_class c
    WHERE relnamespace = 'public'::regnamespace AND relkind = 'r'
      AND NOT EXISTS (
        SELECT 1 FROM pg_depend WHERE classid = 'pg_class'::regclass AND objid = c.oid AND deptype = 'e'
      )
  `);
  assert.deepEqual(tables.tables, [
    "capture_events", "capture_raw_fences", "capture_raw_lineage", "core_memory_receipts",
    "core_schema_migrations", "jobs", "memories", "memory_forget_log", "memory_pause",
    "raw_messages", "suppressions", "users",
  ]);

  const { rows: [index] } = await pool.query(`
    SELECT indisvalid, pg_get_indexdef(indexrelid) AS definition
    FROM pg_index WHERE indexrelid = 'memories_user_recent_c'::regclass
  `);
  assert.equal(index.indisvalid, true);
  assert.match(index.definition, /\(user_id, updated_at DESC, id COLLATE "C" DESC\)$/);

  const { rows: applied } = await pool.query(readLedger);
  assert.deepEqual(applied.map(({ id }) => id), migrations.map(({ id }) => id));
  assert.ok(applied.every(({ applied_at }) => applied_at));
  await pool.query(baseline);
  await applyMigrations(source, migrations);
  assert.deepEqual((await pool.query(readLedger)).rows, applied);

  await pool.query("INSERT INTO users VALUES ('owner')");
  await pool.query("INSERT INTO core_memory_receipts VALUES ('owner', 'memory', 'client', 'session', 'message', 'user', NULL)");
  await assert.rejects(pool.query(`
    INSERT INTO core_memory_receipts VALUES ('owner', 'memory', 'client', 'session', 'message', 'assistant', NULL)
  `), { code: "23505" });
  await assert.rejects(pool.query(`
    INSERT INTO core_memory_receipts VALUES ('owner', 'memory', 'client', 'session', 'other', 'system', NULL)
  `), { code: "23514" });
  await pool.query("DELETE FROM users WHERE id = 'owner'");
  assert.equal((await pool.query("SELECT 1 FROM core_memory_receipts")).rowCount, 0);
});

test("Postgres bounds the metadata lock wait, then upgrades an existing row without rewriting the table", migrationDbTest, async (t) => {
  const { pool, source, migrations } = await migrationDatabase(t, { migrate: false });
  await pool.query("INSERT INTO users VALUES ('owner')");
  await pool.query(`
    INSERT INTO memories (id, user_id, text, kind, text_hash, embedding, embedding_model,
                          source_kind, source_client, source_session_id, created_at, updated_at)
    VALUES ('old', 'owner', 'example', 'fact', 'digest',
            (ARRAY[1] || array_fill(0, ARRAY[1535]))::vector, 'test-model',
            'plugin', 'client', 'session', TIMESTAMPTZ 'epoch',
            TIMESTAMPTZ 'epoch' + INTERVAL '1 microsecond')
  `);
  const oldProjection = "SELECT to_jsonb(memories) - ARRAY['revision', 'confidence', 'origin'] AS value FROM memories";
  const fileNode = "SELECT pg_relation_filenode('memories') AS node";
  const { rows: [oldRow] } = await pool.query(oldProjection);
  const { rows: [{ node: before }] } = await pool.query(fileNode);

  const [metadata] = migrations;
  const writer = await pool.connect();
  try {
    await writer.query("BEGIN");
    assert.equal((await writer.query("UPDATE memories SET text = 'held' WHERE id = 'old'")).rowCount, 1);
    const started = performance.now();
    await assert.rejects(applyMigrations(source, [metadata]), (error) => (
      error instanceof CoreError && error.code === "lock_timeout" && error.message === "lock_timeout"
    ));
    const elapsed = Math.round(performance.now() - started);
    assert.ok(elapsed < 9_000, `metadata lock wait exceeded bound: ${elapsed} ms`);
    t.diagnostic(`metadata migration returned lock_timeout after ${elapsed} ms with the writer still open`);
    assert.equal((await pool.query(readLedger)).rowCount, 0);
  } finally {
    try {
      await writer.query("ROLLBACK");
    } finally {
      writer.release(true);
    }
  }

  await applyMigrations(source, migrations);
  const { rows: [{ node: after }] } = await pool.query(fileNode);
  assert.equal(after, before);
  t.diagnostic(`memories relfilenode stayed ${before} across the metadata migration`);
  assert.deepEqual((await pool.query(oldProjection)).rows, [oldRow]);
  assert.deepEqual((await pool.query("SELECT revision, confidence, origin FROM memories")).rows, [
    { revision: 1, confidence: 1, origin: null },
  ]);
  assert.deepEqual((await pool.query(`
    SELECT conname, convalidated FROM pg_constraint WHERE conrelid = 'memories'::regclass
      AND conname IN ('memories_core_metadata_check', 'memories_source_kind_check') ORDER BY conname
  `)).rows, [
    { conname: "memories_core_metadata_check", convalidated: true },
    { conname: "memories_source_kind_check", convalidated: true },
  ]);
  for (const assignment of ["revision = 0", "confidence = 2", "origin = 'x'"]) {
    await assert.rejects(pool.query(`UPDATE memories SET ${assignment}`), { code: "23514" });
  }
  await assert.rejects(pool.query("UPDATE memories SET embedding = NULL"), { code: "23502" });
  await pool.query("UPDATE memories SET source_kind = 'capture'");

  // Exercise the file guards even when the ledger would skip the SQL.
  const replay = await pool.connect();
  try {
    for (const { sql } of migrations.filter(({ concurrent }) => !concurrent)) {
      await replay.query("BEGIN");
      await replay.query(sql);
      await replay.query("COMMIT");
    }
  } finally {
    replay.release(true);
  }
  assert.deepEqual((await pool.query("SELECT source_kind FROM memories")).rows, [{ source_kind: "capture" }]);
});

test("Postgres removes only the failed concurrent index and can retry it", migrationDbTest, async (t) => {
  const { pool, source, migrations } = await migrationDatabase(t);
  await pool.query(`
    CREATE SCHEMA "Probe";
    CREATE TABLE "Probe".values_to_index (id int);
    INSERT INTO "Probe".values_to_index VALUES (1), (1);
    CREATE INDEX "Retry Index" ON public.memories (kind);
  `);
  const retry = {
    id: "retry",
    sql: 'CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS "Retry Index" ON "Probe".values_to_index (id)',
    concurrent: true,
  };
  const plan = [...migrations, retry];
  const readIndexes = `
    SELECT nspname, indisvalid FROM pg_index i
    JOIN pg_class c ON i.indexrelid = c.oid
    JOIN pg_namespace n ON c.relnamespace = n.oid
    WHERE relname = 'Retry Index' ORDER BY nspname::text COLLATE "C"
  `;
  const healthy = { nspname: "public", indisvalid: true };
  const { rows: applied } = await pool.query(readLedger);
  await assert.rejects(pool.query(retry.sql), { code: "23505" });
  assert.deepEqual((await pool.query(readIndexes)).rows, [{ nspname: "Probe", indisvalid: false }, healthy]);

  // First clear a leftover invalid index, then exercise cleanup after a failure in this run.
  for (let attempt = 0; attempt < 2; attempt++) {
    await assert.rejects(applyMigrations(source, plan), (error) => (
      error instanceof CoreError && error.code === "index_unavailable" && error.message === "index_unavailable"
    ));
    assert.deepEqual((await pool.query(readIndexes)).rows, [healthy]);
    assert.deepEqual((await pool.query(readLedger)).rows, applied);
  }

  await pool.query('TRUNCATE "Probe".values_to_index');
  await applyMigrations(source, plan);
  assert.deepEqual((await pool.query(readIndexes)).rows, [{ nspname: "Probe", indisvalid: true }, healthy]);
  assert.equal((await pool.query(readLedger)).rows.at(-1).id, retry.id);
});

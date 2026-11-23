import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { setTimeout as delay } from "node:timers/promises";
import { CoreError } from "../../core/src/index.mjs";
import { applyMigrations, storedSourceKind } from "../src/index.mjs";
import { migrationDatabase, migrationDbTest } from "./migration-database.mjs";

const readLedger = "SELECT id, applied_at::text FROM core_schema_migrations ORDER BY id";
const readMetadataValidation = `
  SELECT convalidated FROM pg_constraint WHERE conrelid = 'memories'::regclass
    AND conname = 'memories_core_metadata_check'
`;

function insertMemory(connection, id, sourceKind = "plugin") {
  return connection.query(`
    INSERT INTO memories (id, user_id, text, kind, text_hash, embedding, embedding_model,
                          source_kind, source_client, source_session_id, created_at, updated_at)
    VALUES ($1, 'owner', 'example', 'fact', $1,
            (ARRAY[1] || array_fill(0, ARRAY[1535]))::vector, 'test-model',
            $2, 'client', 'session', TIMESTAMPTZ 'epoch',
            TIMESTAMPTZ 'epoch' + INTERVAL '1 microsecond')
  `, [id, sourceKind]);
}

test("Postgres hosted baseline matches the expected catalog structure", migrationDbTest, async (t) => {
  const { pool } = await migrationDatabase(t, { migrate: false });
  const expected = await readFile(new URL("./fixtures/baseline-catalog.tsv", import.meta.url), "utf8");
  const { rows } = await pool.query(`
    WITH tables AS (
      SELECT c.oid, c.relname FROM pg_class c
      WHERE relnamespace = 'public'::regnamespace AND relkind = 'r'
        AND NOT EXISTS (
          SELECT 1 FROM pg_depend WHERE classid = 'pg_class'::regclass AND objid = c.oid AND deptype = 'e'
        )
    ), catalog AS (
      SELECT t.relname AS table_name, 'column' AS item, a.attname AS name,
        format_type(a.atttypid, a.atttypmod) || CASE WHEN a.attnotnull THEN ' NOT NULL' ELSE ' NULL' END AS definition
      FROM tables t JOIN pg_attribute a ON a.attrelid = t.oid
      WHERE a.attnum > 0 AND NOT a.attisdropped
      UNION ALL
      SELECT t.relname, 'constraint', c.conname, pg_get_constraintdef(c.oid)
      FROM tables t JOIN pg_constraint c ON c.conrelid = t.oid
      UNION ALL
      SELECT t.relname, 'index', c.relname, pg_get_indexdef(i.indexrelid)
      FROM tables t JOIN pg_index i ON i.indrelid = t.oid
      JOIN pg_class c ON c.oid = i.indexrelid
    )
    SELECT concat_ws(chr(9), table_name, item, name, definition) AS entry
    FROM catalog ORDER BY table_name::text COLLATE "C", item COLLATE "C", name::text COLLATE "C"
  `);
  assert.deepEqual(rows.map(({ entry }) => entry), expected.trimEnd().split("\n"));
});

test("Postgres applies all migrations to the empty hosted baseline", migrationDbTest, async (t) => {
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
    "capture_events", "capture_raw_fences", "capture_raw_lineage", "card_placements", "card_topics", "core_fact_digests",
    "core_memory_receipts", "core_owner_state", "core_schema_migrations", "core_suppression_facts",
    "document_cards", "jobs", "memories", "memory_conflicts", "memory_forget_log", "memory_pause", "memory_placements", "memory_supersessions", "memory_topics",
    "raw_messages", "suppressions", "topic_edges", "topic_index_state", "topic_title_sources", "topics", "users",
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
  await assert.rejects(insertMemory(pool, "capture", "capture"), {
    code: "23514", constraint: "memories_source_kind_check",
  });
  await insertMemory(pool, "old");
  const oldProjection = "SELECT to_jsonb(memories) - ARRAY['revision', 'confidence', 'origin', 'currentness'] AS value FROM memories";
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
  await assert.rejects(pool.query("UPDATE memories SET source_kind = 'capture'"), {
    code: "23514", constraint: "memories_source_kind_check",
  });

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
  assert.deepEqual((await pool.query("SELECT source_kind FROM memories")).rows, [{ source_kind: "plugin" }]);
});

async function waitForValidationLock(observer, gatePid) {
  const deadline = performance.now() + 3_000;
  while (performance.now() < deadline) {
    const { rows } = await observer.query(`
      SELECT mode FROM pg_locks WHERE relation = 'memories'::regclass AND granted
        AND $1::int = ANY(pg_blocking_pids(pid))
    `, [gatePid]);
    if (rows.length) return rows.map(({ mode }) => mode);
    await delay(20);
  }
  assert.fail("validation did not reach the advisory lock with a table lock held");
}

test("Postgres allows a second session to insert and select before metadata validation commits", migrationDbTest, async (t) => {
  const { pool, source, migrations: [metadata, validation] } = await migrationDatabase(t, { migrate: false });
  await pool.query("INSERT INTO users VALUES ('owner')");
  await insertMemory(pool, "old");
  await applyMigrations(source, [metadata]);
  assert.deepEqual((await pool.query(readMetadataValidation)).rows, [{ convalidated: false }]);
  await assert.rejects(pool.query("UPDATE memories SET revision = 0"), {
    code: "23514", constraint: "memories_core_metadata_check",
  });

  const gate = await pool.connect();
  let writer;
  let applying;
  try {
    writer = await pool.connect();
    await writer.query("SET statement_timeout = '2s'");
    await gate.query("SELECT pg_advisory_lock(1)");
    // Pause the validation batch after ALTER TABLE while the transaction still holds its lock.
    applying = applyMigrations(source, [
      metadata,
      { ...validation, sql: validation.sql + "\nSELECT pg_advisory_xact_lock(1);" },
    ]);
    applying.catch(() => {});
    const modes = await waitForValidationLock(writer, gate.processID);
    assert.equal((await insertMemory(writer, "during-validation", storedSourceKind("capture"))).rowCount, 1);
    assert.deepEqual((await writer.query(
      "SELECT id, source_kind FROM memories WHERE id = 'during-validation'",
    )).rows, [{ id: "during-validation", source_kind: "plugin" }]);
    assert.deepEqual((await writer.query(readMetadataValidation)).rows, [{ convalidated: false }]);
    assert.deepEqual((await writer.query(readLedger)).rows.map(({ id }) => id), [metadata.id]);
    assert.ok(modes.includes("ShareUpdateExclusiveLock"));
    t.diagnostic("INSERT and SELECT finished while the validator held ShareUpdateExclusiveLock before commit");
  } finally {
    writer?.release(true);
    gate.release(true);
    await applying;
  }
  assert.deepEqual((await pool.query(readMetadataValidation)).rows, [{ convalidated: true }]);
  assert.deepEqual((await pool.query(readLedger)).rows.map(({ id }) => id), [metadata.id, validation.id]);
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
    index: {
      name: '"Retry Index"',
      table: '"Probe".values_to_index',
      definition: 'CREATE UNIQUE INDEX "Retry Index" ON "Probe".values_to_index USING btree (id)',
    },
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
  await pool.query(retry.sql);
  await applyMigrations(source, plan);
  assert.deepEqual((await pool.query(readIndexes)).rows, [{ nspname: "Probe", indisvalid: true }, healthy]);
  assert.equal((await pool.query(readLedger)).rows.at(-1).id, retry.id);
});

for (const valid of [true, false]) {
  test(`Postgres leaves ${valid ? "a valid" : "an invalid"} same-name index with a foreign definition untouched`, migrationDbTest, async (t) => {
    const { pool, source, migrations } = await migrationDatabase(t, { migrate: false });
    const transactional = migrations.slice(0, 3);
    await applyMigrations(source, transactional);
    const { rows: applied } = await pool.query(readLedger);
    if (valid) {
      await pool.query("CREATE INDEX memories_user_recent_c ON memories (kind)");
    } else {
      await pool.query("INSERT INTO users VALUES ('owner')");
      await insertMemory(pool, "one");
      await insertMemory(pool, "two");
      await assert.rejects(pool.query("CREATE UNIQUE INDEX CONCURRENTLY memories_user_recent_c ON memories (kind)"), {
        code: "23505",
      });
    }

    const readIndex = `
      SELECT indexrelid, indisvalid, pg_get_indexdef(indexrelid) AS definition FROM pg_index
      WHERE indexrelid = to_regclass('memories_user_recent_c')
    `;
    const { rows: [foreign] } = await pool.query(readIndex);
    assert.equal(foreign.indisvalid, valid);
    assert.match(foreign.definition, /USING btree \(kind\)$/);
    const error = await applyMigrations(source, migrations).catch((error) => error);
    assert.deepEqual((await pool.query(readIndex)).rows, [foreign]);
    assert.deepEqual((await pool.query(readLedger)).rows, applied);
    assert.ok(error instanceof CoreError);
    assert.equal(error.code, "index_unavailable");
    assert.equal(error.message, "index_unavailable");
  });
}

test('Postgres refuses a same-name index whose "C" collation only renders like the built-in one', migrationDbTest, async (t) => {
  const { pool, source, migrations } = await migrationDatabase(t, { migrate: false });
  await applyMigrations(source, migrations.slice(0, 3));
  const { rows: applied } = await pool.query(readLedger);
  await pool.query("CREATE SCHEMA lookalike");
  await pool.query("CREATE COLLATION lookalike.\"C\" (provider = libc, locale = 'C')");
  await pool.query('CREATE INDEX memories_user_recent_c ON memories (user_id, updated_at DESC, id COLLATE lookalike."C" DESC)');
  // With the lookalike schema ahead of pg_catalog in the runner's session, its collation renders
  // exactly as COLLATE "C", so only the catalog identity check can tell them apart.
  const lookalikeFirst = {
    async connect() {
      const connection = await source.connect();
      await connection.query("SET search_path = lookalike, pg_catalog, public");
      return connection;
    },
  };
  const readIndex = "SELECT indexrelid, indisvalid FROM pg_index WHERE indexrelid = 'public.memories_user_recent_c'::regclass";
  const { rows: [lookalikeIndex] } = await pool.query(readIndex);
  const error = await applyMigrations(lookalikeFirst, migrations).catch((error) => error);
  assert.deepEqual((await pool.query(readIndex)).rows, [lookalikeIndex]);
  assert.deepEqual((await pool.query("SELECT id FROM public.core_schema_migrations ORDER BY id")).rows.map(({ id }) => id), applied.map(({ id }) => id).sort());
  assert.ok(error instanceof CoreError);
  assert.equal(error.code, "index_unavailable");
});

test("the runner builds and records the index even when the caller's search path shadows the built-in collation", migrationDbTest, async (t) => {
  const { pool, source, migrations } = await migrationDatabase(t, { migrate: false });
  await pool.query("CREATE SCHEMA lookalike");
  await pool.query("CREATE COLLATION lookalike.\"C\" (provider = libc, locale = 'C')");
  const lookalikeFirst = {
    async connect() {
      const connection = await source.connect();
      await connection.query("SET search_path = lookalike, pg_catalog, public");
      return connection;
    },
  };
  await applyMigrations(lookalikeFirst, migrations);
  const { rows: [index] } = await pool.query(`
    SELECT i.indisvalid,
      (SELECT array_agg(n.nspname::text ORDER BY n.nspname::text COLLATE "C")
        FROM unnest(i.indcollation::oid[]) AS c(oid)
        JOIN pg_collation pc ON pc.oid = c.oid JOIN pg_namespace n ON n.oid = pc.collnamespace) AS schemas
    FROM pg_index i WHERE i.indexrelid = 'public.memories_user_recent_c'::regclass`);
  assert.equal(index.indisvalid, true);
  // user_id (default collation) and id (COLLATE "C") must both use built-in collations.
  assert.deepEqual(index.schemas, ["pg_catalog", "pg_catalog"]);
  const { rows } = await pool.query("SELECT id FROM public.core_schema_migrations ORDER BY id");
  assert.equal(rows.length, migrations.length);
});

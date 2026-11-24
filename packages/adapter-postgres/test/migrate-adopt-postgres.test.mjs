import assert from "node:assert/strict";
import test from "node:test";
import { CoreError } from "../../core/src/index.mjs";
import { applyMigrations } from "../src/index.mjs";
import { migrationDatabase, migrationDbTest } from "./migration-database.mjs";

const createTarget = { id: "create-target", concurrent: false, sql: "CREATE TABLE adoption_target (id int)" };
const readLedger = "SELECT id, applied_at::text FROM core_schema_migrations ORDER BY id";
const defaultTimeout = "SET statement_timeout = '30s'";

function concurrentIndex(name) {
  return {
    id: name,
    concurrent: true,
    sql: `CREATE INDEX CONCURRENTLY IF NOT EXISTS ${name} ON public.adoption_target (id)`,
    index: {
      name,
      table: "public.adoption_target",
      definition: `CREATE INDEX ${name} ON public.adoption_target USING btree (id)`,
    },
  };
}

function traceQueries(source) {
  const statements = [];
  return {
    statements,
    async connect() {
      const connection = await source.connect();
      return {
        query(sql, params) {
          statements.push(sql.startsWith("SELECT i.indisvalid") ? "inspect index" : sql);
          return connection.query(sql, params);
        },
        release: (destroy) => connection.release(destroy),
      };
    },
  };
}

function migrationError(code, migrationId) {
  return (error) => {
    assert.ok(error instanceof CoreError);
    assert.equal(error.code, code);
    assert.equal(error.message, code);
    assert.equal(error.migrationId, migrationId);
    assert.equal(error.cause, undefined);
    return true;
  };
}

test("adoption records an existing table without replaying SQL and leaves the ledger intact on rerun", migrationDbTest, async (t) => {
  const { pool, source } = await migrationDatabase(t, { migrate: false });
  await pool.query(createTarget.sql);
  let probes = 0;
  const migration = {
    ...createTarget,
    async adopt(query) {
      probes++;
      const [row] = await query(`SELECT to_regclass($1) IS NOT NULL AS present,
        current_setting('transaction_read_only') AS read_only`, ["public.adoption_target"]);
      assert.equal(row.read_only, "on");
      return row.present;
    },
  };

  await applyMigrations(source, [migration]);
  const { rows: ledger } = await pool.query(readLedger);
  assert.deepEqual(ledger.map(({ id }) => id), [migration.id]);
  await applyMigrations(source, [migration]);
  assert.deepEqual((await pool.query(readLedger)).rows, ledger);
  assert.equal(probes, 1);
});

test("a declined adoption executes SQL and a throwing hook preserves the committed prefix", migrationDbTest, async (t) => {
  const { pool, source } = await migrationDatabase(t, { migrate: false });
  const first = {
    ...createTarget,
    async adopt(query) {
      const [{ present }] = await query("SELECT to_regclass($1) IS NOT NULL AS present", ["public.adoption_target"]);
      return present;
    },
  };
  const failing = {
    id: "throwing-hook",
    concurrent: false,
    sql: "INSERT INTO adoption_target VALUES (1)",
    async adopt(query) {
      assert.deepEqual(await query("SELECT id FROM core_schema_migrations"), [{ id: first.id }]);
      throw new Error("probe failed");
    },
  };
  let laterProbes = 0;
  const later = { ...failing, id: "later", async adopt() { laterProbes++; return true; } };

  await assert.rejects(applyMigrations(source, [first, failing, later]), migrationError("internal_error", failing.id));
  assert.deepEqual((await pool.query("SELECT id FROM adoption_target")).rows, []);
  assert.deepEqual((await pool.query(readLedger)).rows.map(({ id }) => id), [first.id]);
  assert.equal(laterProbes, 0);
});

test("the adoption helper rejects writes to existing tables", migrationDbTest, async (t) => {
  const { pool, source } = await migrationDatabase(t, { migrate: false });
  await pool.query(createTarget.sql);
  const migration = {
    ...createTarget,
    async adopt(query) {
      await assert.rejects(query("INSERT INTO adoption_target VALUES ($1)", [1]), { code: "25006" });
      return true;
    },
  };

  await applyMigrations(source, [migration]);
  assert.deepEqual((await pool.query("SELECT id FROM adoption_target")).rows, []);
});

test("adoption cannot fill a gap before an already recorded migration", migrationDbTest, async (t) => {
  const { pool, source } = await migrationDatabase(t, { migrate: false });
  const later = { id: "later", concurrent: false, sql: "SELECT 1" };
  await applyMigrations(source, [later]);
  const { rows: ledger } = await pool.query(readLedger);
  let probes = 0;
  const first = { ...createTarget, async adopt() { probes++; return true; } };

  await assert.rejects(applyMigrations(source, [first, later]), migrationError("invalid_input", undefined));
  assert.equal(probes, 0);
  assert.deepEqual((await pool.query(readLedger)).rows, ledger);
});

test("a held conflicting lock reports the transactional migration ID", migrationDbTest, async (t) => {
  const { pool, source } = await migrationDatabase(t, { migrate: false });
  await applyMigrations(source, [createTarget]);
  const migration = { id: "add-column", concurrent: false, sql: "ALTER TABLE adoption_target ADD COLUMN label text" };
  const locker = await pool.connect();
  try {
    await locker.query("BEGIN");
    await locker.query("INSERT INTO adoption_target VALUES (1)");
    await assert.rejects(applyMigrations(source, [createTarget, migration]), migrationError("lock_timeout", migration.id));
  } finally {
    locker.release(true);
  }
  assert.deepEqual((await pool.query(readLedger)).rows.map(({ id }) => id), [createTarget.id]);
});

test("a concurrent timeout override surrounds each build and leaves the transactional default intact", migrationDbTest, async (t) => {
  const { pool, source } = await migrationDatabase(t, { migrate: false });
  const traced = traceQueries(source);
  const indexes = [concurrentIndex("adoption_first_idx"), concurrentIndex("adoption_next_idx")];
  const captureTimeout = {
    id: "capture-timeout",
    concurrent: false,
    sql: "CREATE TABLE observed_timeout AS SELECT current_setting('statement_timeout') AS value",
  };
  await applyMigrations(traced, [createTarget, ...indexes, captureTimeout], { concurrentStatementTimeoutMs: 10_000 });

  for (const index of indexes) {
    const build = traced.statements.indexOf(index.sql);
    assert.deepEqual(traced.statements.slice(build - 1, build + 4), [
      "SET statement_timeout = '10000ms'", index.sql, "inspect index", defaultTimeout,
      "INSERT INTO core_schema_migrations (id) VALUES ($1)",
    ]);
  }
  assert.deepEqual((await pool.query("SELECT value FROM observed_timeout")).rows, [{ value: "30s" }]);
});

test("an explicit default concurrent timeout needs no extra session statements", migrationDbTest, async (t) => {
  const { source } = await migrationDatabase(t, { migrate: false });
  const traced = traceQueries(source);
  await applyMigrations(traced, [createTarget, concurrentIndex("adoption_default_idx")], {
    concurrentStatementTimeoutMs: 30_000,
  });
  assert.deepEqual(traced.statements.filter((sql) => sql.startsWith("SET statement_timeout")), [defaultTimeout]);
});

test("a blocked concurrent build uses the override and restores the default after failure", migrationDbTest, async (t) => {
  const { pool, source } = await migrationDatabase(t, { migrate: false });
  await applyMigrations(source, [createTarget]);
  const traced = traceQueries(source);
  const index = concurrentIndex("adoption_blocked_idx");
  const locker = await pool.connect();
  try {
    await locker.query("BEGIN");
    await locker.query("LOCK TABLE adoption_target IN SHARE ROW EXCLUSIVE MODE");
    await assert.rejects(
      applyMigrations(traced, [createTarget, index], { concurrentStatementTimeoutMs: 250 }),
      migrationError("statement_timeout", index.id),
    );
  } finally {
    locker.release(true);
  }
  assert.deepEqual(traced.statements.slice(-4), [
    "SET statement_timeout = '250ms'", index.sql, "inspect index", defaultTimeout,
  ]);
  assert.deepEqual((await pool.query(readLedger)).rows.map(({ id }) => id), [createTarget.id]);
});

test("invalid concurrent timeout values are rejected before connecting", async () => {
  const source = { connect: () => assert.fail("connected with an invalid timeout") };
  for (const value of [0, -1, 0.5, Infinity, NaN, 2_147_483_648, "500", null]) {
    await assert.rejects(applyMigrations(source, [], { concurrentStatementTimeoutMs: value }), { code: "invalid_input" });
  }
});

test("a RAISE from a migration guard reports its migration ID", migrationDbTest, async (t) => {
  const { pool, source } = await migrationDatabase(t, { migrate: false });
  const migration = {
    id: "guarded-step",
    concurrent: false,
    sql: "DO $$ BEGIN RAISE EXCEPTION 'guard refused migration'; END $$",
  };
  await assert.rejects(applyMigrations(source, [migration]), migrationError("internal_error", migration.id));
  assert.deepEqual((await pool.query(readLedger)).rows, []);
});

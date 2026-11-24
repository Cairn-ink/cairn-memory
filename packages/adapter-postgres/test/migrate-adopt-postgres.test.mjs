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

function traceQueries(source, runQuery = (connection, sql, params) => connection.query(sql, params)) {
  const statements = [];
  const releases = [];
  return {
    statements,
    releases,
    async connect() {
      const connection = await source.connect();
      return {
        query(sql, params) {
          statements.push(sql.startsWith("SELECT i.indisvalid") ? "inspect index" : sql);
          return runQuery(connection, sql, params);
        },
        release(destroy) {
          releases.push(destroy);
          return connection.release(destroy);
        },
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
  await applyMigrations(source, [createTarget]);
  const { rows: prefix } = await pool.query(readLedger);
  const traced = traceQueries(source);
  const write = "INSERT INTO adoption_target VALUES ($1)";
  const migration = {
    id: "reject-write",
    concurrent: false,
    sql: "SELECT 1",
    async adopt(query) {
      await assert.rejects(query(write, [1]), { code: "invalid_input" });
      return true;
    },
  };

  await assert.rejects(applyMigrations(traced, [createTarget, migration]), migrationError("invalid_input", migration.id));
  assert.ok(!traced.statements.includes(write));
  assert.ok(!traced.statements.includes(migration.sql));
  assert.deepEqual((await pool.query("SELECT id FROM adoption_target")).rows, []);
  assert.deepEqual((await pool.query(readLedger)).rows, prefix);
});

for (const [name, statements] of [
  ["transaction control", [
    "ROLLBACK TO SAVEPOINT migration_adoption",
    "INSERT INTO adoption_target VALUES (2)",
    "SAVEPOINT migration_adoption",
  ]],
  ["LOCK TABLE", ["LOCK TABLE adoption_target IN ROW SHARE MODE"]],
  ["FOR UPDATE", ["SELECT id FROM adoption_target FOR UPDATE"]],
  ["multiple statements", ["SELECT 1; LOCK TABLE adoption_target IN ROW SHARE MODE"]],
  ["a modifying CTE", ["WITH changed AS (DELETE FROM adoption_target RETURNING id) SELECT * FROM changed"]],
]) {
  test(`the adoption helper rejects ${name} before sending it`, migrationDbTest, async (t) => {
    const { pool, source } = await migrationDatabase(t, { migrate: false });
    await applyMigrations(source, [createTarget]);
    await pool.query("INSERT INTO adoption_target VALUES (1)");
    const { rows: prefix } = await pool.query(readLedger);
    const traced = traceQueries(source);
    const migration = {
      id: "reject-probe",
      concurrent: false,
      sql: "INSERT INTO adoption_target VALUES (3)",
      async adopt(query) {
        for (const sql of statements) await query(sql);
        return true;
      },
    };

    await assert.rejects(applyMigrations(traced, [createTarget, migration]), migrationError("invalid_input", migration.id));
    assert.ok(!traced.statements.includes(statements[0]));
    assert.ok(!traced.statements.includes(migration.sql));
    assert.deepEqual((await pool.query(readLedger)).rows, prefix);
    assert.deepEqual((await pool.query("SELECT id FROM adoption_target")).rows, [{ id: 1 }]);
  });
}

test("read probes accept a CTE with quoted and commented semicolons", migrationDbTest, async (t) => {
  const { pool, source } = await migrationDatabase(t, { migrate: false });
  const migration = {
    id: "read-probe",
    concurrent: false,
    sql: "SELECT 1 / 0",
    async adopt(query) {
      const rows = await query(String.raw`
        /* outer /* ; LOCK */ comment */
        WITH probe AS (SELECT $tag$; SAVEPOINT$tag$ AS "value;LOCK", $1::bool AS present)
        SELECT CASE WHEN present THEN "value;LOCK" || E'\';' ELSE 'ROLLBACK;' END AS result FROM probe;
        -- ; COMMIT
      `, [true]);
      assert.deepEqual(rows, [{ result: "; SAVEPOINT';" }]);
      return true;
    },
  };
  await applyMigrations(source, [migration]);
  assert.deepEqual((await pool.query(readLedger)).rows.map(({ id }) => id), [migration.id]);
});

for (const [name, intercepted] of [
  ["missing savepoint", ["RELEASE SAVEPOINT migration_adoption"]],
  ["write with recreated savepoint", [
    "ROLLBACK TO SAVEPOINT migration_adoption",
    "INSERT INTO adoption_target VALUES (2)",
    "SAVEPOINT migration_adoption",
  ]],
  ["row lock", [
    "ROLLBACK TO SAVEPOINT migration_adoption",
    "SELECT id FROM adoption_target FOR UPDATE",
  ]],
]) {
  test(`the adoption transaction check rejects a ${name}`, migrationDbTest, async (t) => {
    const { pool, source } = await migrationDatabase(t, { migrate: false });
    await applyMigrations(source, [createTarget]);
    await pool.query("INSERT INTO adoption_target VALUES (1)");
    const { rows: prefix } = await pool.query(readLedger);
    const probe = "SELECT 1 AS present";
    const traced = traceQueries(source, async (connection, sql, params) => {
      const result = await connection.query(sql, params);
      // Simulate a probe side effect that passes the SQL filter.
      if (sql === probe) for (const statement of intercepted) await connection.query(statement);
      return result;
    });
    const migration = {
      id: "reject-transaction-state",
      concurrent: false,
      sql: "INSERT INTO adoption_target VALUES (3)",
      async adopt(query) {
        await query(probe);
        return false;
      },
    };

    await assert.rejects(applyMigrations(traced, [createTarget, migration]), migrationError("invalid_input", migration.id));
    assert.ok(traced.statements.includes(probe));
    assert.ok(!traced.statements.includes(migration.sql));
    assert.deepEqual((await pool.query(readLedger)).rows, prefix);
    assert.deepEqual((await pool.query("SELECT id FROM adoption_target")).rows, [{ id: 1 }]);
  });
}

test("non-boolean adoption results fail before executing migration SQL", migrationDbTest, async (t) => {
  const { pool, source } = await migrationDatabase(t, { migrate: false });
  await applyMigrations(source, [createTarget]);
  const { rows: prefix } = await pool.query(readLedger);

  for (const result of [{ present: true }, 1, undefined]) {
    const traced = traceQueries(source);
    const migration = {
      id: "reject-result",
      concurrent: false,
      sql: "ALTER TABLE adoption_target ADD COLUMN label text",
      async adopt() { return result; },
    };
    await assert.rejects(applyMigrations(traced, [createTarget, migration]), migrationError("invalid_input", migration.id));
    assert.ok(!traced.statements.includes(migration.sql));
    assert.deepEqual((await pool.query(readLedger)).rows, prefix);
  }
  assert.deepEqual((await pool.query("SELECT * FROM adoption_target LIMIT 0")).fields.map(({ name }) => name), ["id"]);
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

test("a cancelled timeout reset still drops an invalid unique index", migrationDbTest, async (t) => {
  const { pool, source } = await migrationDatabase(t, { migrate: false });
  await applyMigrations(source, [createTarget]);
  const { rows: prefix } = await pool.query(readLedger);
  await pool.query("INSERT INTO adoption_target VALUES (1)");
  const index = concurrentIndex("adoption_unique_idx");
  index.sql = index.sql.replace("CREATE INDEX", "CREATE UNIQUE INDEX");
  index.index.definition = index.index.definition.replace("CREATE INDEX", "CREATE UNIQUE INDEX");

  const readIndex = `SELECT indisvalid AS valid, indisready AS ready FROM pg_index
    WHERE indexrelid = to_regclass('public.adoption_unique_idx')`;
  const snapshot = await pool.connect();
  try {
    await snapshot.query("BEGIN ISOLATION LEVEL REPEATABLE READ");
    await snapshot.query("SELECT id FROM adoption_target");
    let startedBuild = false;
    let resetAttempts = 0;
    let buildError;
    let beforeReset;
    const traced = traceQueries(source, async (connection, sql, params) => {
      if (sql === index.sql) {
        startedBuild = true;
        try {
          return await connection.query(sql, params);
        } catch (error) {
          buildError = error.code;
          throw error;
        }
      }
      if (startedBuild && sql === defaultTimeout && ++resetAttempts === 1) {
        ({ rows: beforeReset } = await pool.query(readIndex));
        await snapshot.query("ROLLBACK");
        throw Object.assign(new Error("injected cancellation"), { code: "57014" });
      }
      return connection.query(sql, params);
    });
    const outcome = await applyMigrations(traced, [createTarget, index], { concurrentStatementTimeoutMs: 750 })
      .catch((error) => error);

    assert.equal(buildError, "57014");
    assert.equal(resetAttempts, 1);
    assert.deepEqual(beforeReset, [{ valid: false, ready: true }]);
    assert.deepEqual((await pool.query(readIndex)).rows, []);
    await pool.query("INSERT INTO adoption_target VALUES (1)");
    assert.deepEqual((await pool.query("SELECT id FROM adoption_target")).rows, [{ id: 1 }, { id: 1 }]);
    migrationError("index_unavailable", index.id)(outcome);
    assert.deepEqual((await pool.query(readLedger)).rows, prefix);
  } finally {
    snapshot.release(true);
  }
});

test("a failed invalid-index drop destroys the session and a later run can clean up", migrationDbTest, async (t) => {
  const { pool, source } = await migrationDatabase(t, { migrate: false });
  await applyMigrations(source, [createTarget]);
  const { rows: prefix } = await pool.query(readLedger);
  await pool.query("INSERT INTO adoption_target VALUES (1), (1)");
  const index = concurrentIndex("adoption_pending_drop_idx");
  index.sql = index.sql.replace("CREATE INDEX", "CREATE UNIQUE INDEX");
  index.index.definition = index.index.definition.replace("CREATE INDEX", "CREATE UNIQUE INDEX");
  const traced = traceQueries(source, async (connection, sql, params) => {
    if (sql.startsWith("DROP INDEX CONCURRENTLY")) {
      throw Object.assign(new Error("injected cancellation"), { code: "57014" });
    }
    return connection.query(sql, params);
  });
  const readIndex = "SELECT to_regclass('public.adoption_pending_drop_idx') IS NOT NULL AS present";

  await assert.rejects(applyMigrations(traced, [createTarget, index]), migrationError("index_unavailable", index.id));
  assert.deepEqual(traced.releases, [true]);
  assert.deepEqual((await pool.query(readIndex)).rows, [{ present: true }]);
  assert.deepEqual((await pool.query(readLedger)).rows, prefix);

  await assert.rejects(applyMigrations(source, [createTarget, index]), migrationError("index_unavailable", index.id));
  assert.deepEqual((await pool.query(readIndex)).rows, [{ present: false }]);
  assert.deepEqual((await pool.query(readLedger)).rows, prefix);
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

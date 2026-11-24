import assert from "node:assert/strict";
import test from "node:test";
import { CoreError } from "../../core/src/index.mjs";
import { applyMigrations } from "../src/index.mjs";
import { migrationDatabase, migrationDbTest } from "./migration-database.mjs";

const prefixMigration = { id: "001", concurrent: false, sql: "CREATE TABLE lock_guard_target (id int)" };
const migrationSql = "INSERT INTO lock_guard_target VALUES (1)";
const readLedger = "SELECT id, applied_at::text FROM core_schema_migrations ORDER BY id";
const migrationKey = "hashtextextended('core_schema_migrations', 0)";

function trace(source) {
  const queries = [];
  let session;
  return {
    queries,
    get session() { return session; },
    async connect() {
      const connection = await source.connect();
      session = connection;
      return {
        query(sql, params) {
          queries.push({ sql, params });
          return connection.query(sql, params);
        },
        release: (destroy) => connection.release(destroy),
      };
    },
  };
}

function migrationError(error, code, migrationId) {
  assert.ok(error instanceof CoreError);
  assert.equal(error.code, code);
  assert.equal(error.migrationId, migrationId);
  return true;
}

test("adoption rejects advisory lock calls before sending them even if the hook catches the error", migrationDbTest, async (t) => {
  const { pool, source } = await migrationDatabase(t, { migrate: false });
  const statements = [
    "SELECT pg_advisory_unlock_all()",
    "SELECT pg_catalog.PG_ADVISORY_UNLOCK /* outer /* inner */ comment */ (1)",
    'SELECT "pg_catalog"."pg_advisory_lock_shared"\n-- comment\n(1)',
    "WITH probe AS (SELECT pg_try_advisory_xact_lock(1)) SELECT * FROM probe",
    String.raw`SELECT pg_catalog.U&"pg_adv\0069sory_unlock_all"()`,
    `SELECT pg_catalog.U&"pg_adv!0069sory_lock" UESCAPE /* comment */ '!' (1)`,
  ];
  for (const probe of statements) {
    const traced = trace(source);
    let probeError;
    const migration = {
      ...prefixMigration,
      async adopt(query) {
        try {
          await query(probe);
        } catch (error) {
          probeError = error;
        }
        return true;
      },
    };

    const failure = await applyMigrations(traced, [migration]).then(() => undefined, (error) => error);
    assert.ok(traced.queries.every(({ sql }) => sql !== probe), `sent ${probe}`);
    assert.ok(probeError instanceof CoreError);
    assert.equal(probeError.code, "invalid_input");
    migrationError(failure, "invalid_input", migration.id);
    assert.deepEqual((await pool.query(readLedger)).rows, []);
  }
});

test("adoption accepts advisory function names inside literals, comments and column identifiers", migrationDbTest, async (t) => {
  const { pool, source } = await migrationDatabase(t, { migrate: false });
  const migration = {
    ...prefixMigration,
    async adopt(query) {
      assert.deepEqual(await query(`SELECT pg_advisory_unlock_all, "pg_advisory_lock" FROM (
        SELECT 'pg_advisory_unlock_all()' AS pg_advisory_unlock_all,
          $probe$pg_try_advisory_lock(1)$probe$ AS "pg_advisory_lock"
        /* pg_advisory_lock(1) */) AS probe`), [{
        pg_advisory_unlock_all: "pg_advisory_unlock_all()",
        pg_advisory_lock: "pg_try_advisory_lock(1)",
      }]);
      return true;
    },
  };
  await applyMigrations(source, [migration]);
  assert.deepEqual((await pool.query(readLedger)).rows.map(({ id }) => id), [migration.id]);
});

for (const adopted of [true, false]) {
  test(`adoption rolls back on lock loss when the hook returns ${adopted}`, migrationDbTest, async (t) => {
    const { pool, source } = await migrationDatabase(t, { migrate: false });
    const traced = trace(source);
    const otherSession = await source.connect();
    let prefix;
    const migration = {
      id: "002",
      concurrent: false,
      sql: migrationSql,
      async adopt() {
        prefix = (await pool.query(readLedger)).rows;
        const contender = trace(source);
        await assert.rejects(applyMigrations(contender, [prefixMigration, migration]), (error) =>
          migrationError(error, "storage_busy", undefined));
        assert.ok(contender.queries.every(({ sql }) => !sql.includes("CREATE TABLE IF NOT EXISTS")));

        // Simulate a hook side effect on the runner session outside the guarded query helper.
        const { rows: [released] } = await traced.session.query(`SELECT pg_advisory_unlock(${migrationKey}) AS ok`);
        assert.equal(released.ok, true);
        const { rows: [acquired] } = await otherSession.query(`SELECT pg_try_advisory_lock(${migrationKey}) AS ok`);
        assert.equal(acquired.ok, true);
        await traced.session.query(`SELECT pg_advisory_lock(${migrationKey} # 1)`);
        return adopted;
      },
    };

    try {
      await assert.rejects(applyMigrations(traced, [prefixMigration, migration]), (error) =>
        migrationError(error, "storage_busy", migration.id));
    } finally {
      await otherSession.release(true);
    }
    assert.equal(traced.queries.at(-1).sql, "ROLLBACK");
    assert.ok(traced.queries.every(({ sql, params }) => sql !== migrationSql && params?.[0] !== migration.id));
    assert.deepEqual(prefix.map(({ id }) => id), [prefixMigration.id]);
    assert.deepEqual((await pool.query(readLedger)).rows, prefix);
    assert.deepEqual((await pool.query("SELECT id FROM lock_guard_target")).rows, []);
  });
}

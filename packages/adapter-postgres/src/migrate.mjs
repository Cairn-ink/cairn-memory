import { CoreError } from "../../core/src/index.mjs";
import { toPostgresError } from "./errors.mjs";

/** @import { Connection, ConnectionSource } from "./driver.mjs" */
/** @import { ApplyMigrationsOptions, Migration, MigrationQuery } from "./index.mjs" */

const DEFAULT_STATEMENT_TIMEOUT_MS = 30_000;
const SET_DEFAULT_STATEMENT_TIMEOUT = "SET statement_timeout = '30s'";
const MIGRATION_LOCK_KEY = "hashtextextended('core_schema_migrations', 0)";
const MIGRATION_LOCK = `SELECT pg_try_advisory_lock(${MIGRATION_LOCK_KEY}) AS locked`;
const MIGRATION_UNLOCK = `SELECT pg_advisory_unlock(${MIGRATION_LOCK_KEY}) AS unlocked`;
const CREATE_LEDGER = `CREATE TABLE IF NOT EXISTS core_schema_migrations (
  id text PRIMARY KEY,
  applied_at timestamptz NOT NULL DEFAULT now()
)`;
const READ_LEDGER = "SELECT id FROM core_schema_migrations";
const RECORD_MIGRATION = "INSERT INTO core_schema_migrations (id) VALUES ($1)";

// The index inherits the table's schema, which may differ from the session's current schema.
const IDENTIFIER = /(?:"(?:[^"]|"")+"|[a-z_][a-z_0-9$]*)/.source;
const CONCURRENT_INDEX = new RegExp(
  `^\\s*CREATE\\s+(?:UNIQUE\\s+)?INDEX\\s+CONCURRENTLY\\s+IF\\s+NOT\\s+EXISTS\\s+`
  + `(${IDENTIFIER})\\s+ON\\s+((?:${IDENTIFIER}\\s*\\.\\s*)?${IDENTIFIER})(?=\\s|\\()`,
  "i",
);
const READ_INDEX = `SELECT i.indisvalid AS valid, n.nspname AS schema, idx.relname AS name,
    pg_catalog.pg_get_indexdef(i.indexrelid) AS definition,
    NOT EXISTS (
      SELECT 1 FROM pg_catalog.unnest(i.indcollation::pg_catalog.oid[]) AS c(oid)
      WHERE c.oid OPERATOR(pg_catalog.<>) 0 AND NOT EXISTS (
        SELECT 1 FROM pg_catalog.pg_collation pc
        WHERE pc.oid OPERATOR(pg_catalog.=) c.oid
          AND pc.collnamespace OPERATOR(pg_catalog.=) 'pg_catalog'::pg_catalog.regnamespace
      )
    ) AS builtin_collations
  FROM pg_catalog.pg_index i
  JOIN pg_catalog.pg_class idx ON idx.oid OPERATOR(pg_catalog.=) i.indexrelid
  JOIN pg_catalog.pg_namespace n ON n.oid OPERATOR(pg_catalog.=) idx.relnamespace
  WHERE idx.relname OPERATOR(pg_catalog.=) (pg_catalog.parse_ident($1)::pg_catalog.name[])[1]
    AND i.indrelid OPERATOR(pg_catalog.=) pg_catalog.to_regclass($2)`;

/** @param {string} name */
function quoteIdentifier(name) {
  return `"${name.replaceAll('"', '""')}"`;
}

/** @param {Connection} connection @param {(query: MigrationQuery) => Promise<boolean>} adopt */
async function shouldAdopt(connection, adopt) {
  await connection.query("SAVEPOINT migration_adoption");
  await connection.query("SET LOCAL transaction_read_only = on");
  const adopted = await adopt(async (text, params) => (await connection.query(text, params)).rows);
  // Rolling back the savepoint restores the transaction's write mode after the probe.
  await connection.query("ROLLBACK TO SAVEPOINT migration_adoption");
  await connection.query("RELEASE SAVEPOINT migration_adoption");
  return adopted === true;
}

/** @param {Connection} connection @param {Extract<Migration, { concurrent: false }>} migration */
async function applyTransactional(connection, { id, sql, adopt }) {
  await connection.query("BEGIN");
  try {
    if (!adopt || !(await shouldAdopt(connection, adopt))) await connection.query(sql);
    await connection.query(RECORD_MIGRATION, [id]);
  } catch (error) {
    try {
      await connection.query("ROLLBACK");
    } catch {
      // The session will be destroyed. Preserve the original failure.
    }
    throw error;
  }

  let command;
  try {
    command = (await connection.query("COMMIT"))?.command;
  } catch {
    // A missing commit acknowledgement leaves the outcome uncertain.
  }
  if (command === "ROLLBACK") throw new CoreError("storage_error");
  if (command !== "COMMIT") throw new CoreError("commit_outcome_unknown");
}

/** @param {Connection} connection @param {Extract<Migration, { concurrent: true }>} migration */
async function buildAndInspectIndex(connection, { sql, index }) {
  let failure;
  try {
    await connection.query(sql);
  } catch (error) {
    failure = toPostgresError(error);
  }

  let state;
  try {
    ({ rows: [state] } = await connection.query(READ_INDEX, [index.name, index.table]));
  } catch (error) {
    throw failure ?? error;
  }
  if (!state) throw failure ?? new CoreError("index_unavailable");
  // Compare the canonical SQL verbatim so quoted identifiers and literals keep their meaning.
  if (state.definition !== index.definition.trim()) throw new CoreError("index_unavailable");
  // A same-named collation in another schema can render identically; require catalog identity.
  if (state.builtin_collations !== true) throw new CoreError("index_unavailable");
  if (state.valid !== true && state.valid !== false) throw new CoreError("index_unavailable");
  return state;
}

/**
 * @param {Connection} connection
 * @param {Extract<Migration, { concurrent: true }>} migration
 * @param {number} statementTimeoutMs
 */
async function applyConcurrent(connection, migration, statementTimeoutMs) {
  const override = statementTimeoutMs !== DEFAULT_STATEMENT_TIMEOUT_MS;
  let state;
  try {
    if (override) await connection.query(`SET statement_timeout = '${statementTimeoutMs}ms'`);
    state = await buildAndInspectIndex(connection, migration);
  } finally {
    if (override) {
      try {
        await connection.query(SET_DEFAULT_STATEMENT_TIMEOUT);
      } catch (error) {
        if (state) throw error;
      }
    }
  }
  if (state.valid === false) {
    const qualifiedName = `${quoteIdentifier(state.schema)}.${quoteIdentifier(state.name)}`;
    await connection.query(`DROP INDEX CONCURRENTLY IF EXISTS ${qualifiedName}`);
    throw new CoreError("index_unavailable");
  }
  await connection.query(RECORD_MIGRATION, [migration.id]);
}

/**
 * The host provides the full, ordered list of immutable migrations as SQL text.
 * The connection must support session state and be dedicated to this run until destroyed.
 * @param {ConnectionSource} source
 * @param {readonly Migration[]} migrations
 * @param {ApplyMigrationsOptions} [options]
 */
export async function applyMigrations(source, migrations, options = {}) {
  try {
    const { concurrentStatementTimeoutMs = DEFAULT_STATEMENT_TIMEOUT_MS } = options;
    // PostgreSQL accepts integer milliseconds up to the signed 32-bit limit.
    if (!Number.isInteger(concurrentStatementTimeoutMs)
      || concurrentStatementTimeoutMs < 1 || concurrentStatementTimeoutMs > 2_147_483_647) {
      throw new CoreError("invalid_input");
    }
    const ids = new Set();
    const ordered = migrations.map((migration) => {
      const { id, sql, concurrent } = migration;
      if (typeof id !== "string" || !id || ids.has(id)) throw new CoreError("invalid_input");
      ids.add(id);
      if (!concurrent) return { id, sql, concurrent, adopt: migration.adopt };

      const target = CONCURRENT_INDEX.exec(sql);
      const { index } = migration;
      if (!target || index?.name !== target[1] || index.table !== target[2]
        || typeof index.definition !== "string" || !index.definition.trim()) {
        throw new CoreError("invalid_input");
      }
      return { id, sql, concurrent, index: { ...index } };
    });

    const connection = await source.connect();
    let complete = false;
    try {
      await connection.query("SET lock_timeout = '5s'");
      await connection.query(SET_DEFAULT_STATEMENT_TIMEOUT);
      // The runner owns its session: the hosted tables live in public, so new objects land there and
      // only public and pg_catalog are visible. A caller's search_path (or lookalike objects in other
      // schemas) cannot change what a migration touches or how index definitions render.
      await connection.query("SET search_path = public, pg_catalog");
      // Index definitions are compared as text; keep their rendering independent of session quoting.
      await connection.query("SET quote_all_identifiers = off");
      if ((await connection.query(MIGRATION_LOCK)).rows[0]?.locked !== true) {
        throw new CoreError("storage_busy");
      }
      await connection.query(CREATE_LEDGER);
      const { rows } = await connection.query(READ_LEDGER);
      const applied = new Set(rows.map(({ id }) => id));
      if (applied.size > ordered.length || ordered.slice(0, applied.size).some(({ id }) => !applied.has(id))) {
        throw new CoreError("invalid_input");
      }

      for (const migration of ordered.slice(applied.size)) {
        try {
          if (migration.concurrent) {
            await applyConcurrent(connection, migration, concurrentStatementTimeoutMs);
          } else {
            await applyTransactional(connection, migration);
          }
        } catch (error) {
          throw Object.assign(new CoreError(toPostgresError(error).code), { migrationId: migration.id });
        }
      }
      // A pool may return from destroy before PostgreSQL ends the session.
      // Wait for the server to release the lock before reporting success.
      if ((await connection.query(MIGRATION_UNLOCK)).rows[0]?.unlocked !== true) {
        throw new CoreError("storage_error");
      }
      complete = true;
    } finally {
      try {
        await connection.release(true);
      } catch (error) {
        if (complete) throw error;
      }
    }
  } catch (error) {
    throw toPostgresError(error);
  }
}

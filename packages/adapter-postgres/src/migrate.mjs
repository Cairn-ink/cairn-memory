import { CoreError } from "../../core/src/index.mjs";
import { toPostgresError } from "./errors.mjs";

/** @import { Connection, ConnectionSource } from "./driver.mjs" */
/** @import { Migration } from "./index.mjs" */

const MIGRATION_LOCK = "SELECT pg_try_advisory_lock(hashtextextended('core_schema_migrations', 0)) AS locked";
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
const READ_INDEX = `SELECT i.indisvalid AS valid, n.nspname AS schema, idx.relname AS name
  FROM pg_catalog.pg_index i
  JOIN pg_catalog.pg_class idx ON idx.oid = i.indexrelid
  JOIN pg_catalog.pg_namespace n ON n.oid = idx.relnamespace
  WHERE idx.relname = (pg_catalog.parse_ident($1)::name[])[1] AND i.indrelid = pg_catalog.to_regclass($2)`;

/** @param {string} name */
function quoteIdentifier(name) {
  return `"${name.replaceAll('"', '""')}"`;
}

/** @param {Connection} connection @param {Migration} migration */
async function applyTransactional(connection, { id, sql }) {
  await connection.query("BEGIN");
  try {
    await connection.query(sql);
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

/** @param {Connection} connection @param {Migration} migration @param {string} index @param {string} table */
async function applyConcurrent(connection, { id, sql }, index, table) {
  let failure;
  try {
    await connection.query(sql);
  } catch (error) {
    failure = toPostgresError(error);
  }

  let state;
  try {
    ({ rows: [state] } = await connection.query(READ_INDEX, [index, table]));
  } catch (error) {
    throw failure ?? error;
  }
  if (state?.valid === false) {
    const qualifiedName = `${quoteIdentifier(state.schema)}.${quoteIdentifier(state.name)}`;
    await connection.query(`DROP INDEX CONCURRENTLY IF EXISTS ${qualifiedName}`);
    throw new CoreError("index_unavailable");
  }
  if (failure) throw failure;
  if (state?.valid !== true) throw new CoreError("index_unavailable");
  await connection.query(RECORD_MIGRATION, [id]);
}

/**
 * The host provides the full, ordered list of immutable migrations as SQL text.
 * The connection must support session state and be dedicated to this run until destroyed.
 * @param {ConnectionSource} source
 * @param {readonly Migration[]} migrations
 */
export async function applyMigrations(source, migrations) {
  try {
    const ids = new Set();
    const ordered = migrations.map(({ id, sql, concurrent }) => {
      if (!id || ids.has(id)) throw new CoreError("invalid_input");
      ids.add(id);
      const index = concurrent ? CONCURRENT_INDEX.exec(sql) : null;
      if (concurrent && !index) throw new CoreError("invalid_input");
      return { id, sql, concurrent, index };
    });

    const connection = await source.connect();
    let complete = false;
    try {
      await connection.query("SET lock_timeout = '5s'");
      await connection.query("SET statement_timeout = '30s'");
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
        if (migration.index) {
          const [, index, table] = migration.index;
          await applyConcurrent(connection, migration, index, table);
        } else {
          await applyTransactional(connection, migration);
        }
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

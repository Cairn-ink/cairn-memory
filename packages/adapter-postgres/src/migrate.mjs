import { CoreError } from "../../core/src/index.mjs";
import { toPostgresError } from "./errors.mjs";

/** @import { Connection, ConnectionSource } from "./driver.mjs" */
/** @import { ApplyMigrationsOptions, Migration, MigrationQuery } from "./index.mjs" */

const DEFAULT_STATEMENT_TIMEOUT_MS = 30_000;
const SET_DEFAULT_STATEMENT_TIMEOUT = "SET statement_timeout = '30s'";
const MIGRATION_LOCK_KEY = "hashtextextended('core_schema_migrations', 0)";
const MIGRATION_LOCK = `SELECT pg_try_advisory_lock(${MIGRATION_LOCK_KEY}) AS locked`;
const MIGRATION_UNLOCK = `SELECT pg_advisory_unlock(${MIGRATION_LOCK_KEY}) AS unlocked`;
// PostgreSQL stores the two halves of a bigint advisory key in classid and objid.
const HOLDS_MIGRATION_LOCK = `SELECT EXISTS (
  SELECT 1 FROM pg_catalog.pg_locks
  WHERE locktype OPERATOR(pg_catalog.=) 'advisory' AND granted
    AND pid OPERATOR(pg_catalog.=) pg_catalog.pg_backend_pid()
    AND mode OPERATOR(pg_catalog.=) 'ExclusiveLock' AND objsubid OPERATOR(pg_catalog.=) 1
    AND ((classid::pg_catalog.int8 OPERATOR(pg_catalog.<<) 32)
      OPERATOR(pg_catalog.|) objid::pg_catalog.int8) OPERATOR(pg_catalog.=) ${MIGRATION_LOCK_KEY}
) AS locked`;
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

const NON_READ_KEYWORDS = new Set(["DELETE", "INSERT", "INTO", "MERGE", "UPDATE"]);
const TRANSACTION_OR_LOCK_KEYWORDS = new Set([
  "ABORT", "BEGIN", "COMMIT", "END", "LOCK", "PREPARE", "RELEASE", "ROLLBACK", "SAVEPOINT", "SET", "START",
]);
const ADVISORY_LOCK_FUNCTION = /^pg_(?:advisory_(?:lock|unlock)|try_advisory)/i;

/** @param {string} name @param {string} escape */
function decodeUnicodeIdentifier(name, escape) {
  const marker = `\\u{${escape.charCodeAt(0).toString(16)}}`;
  const escapes = new RegExp(`${marker}(${marker}|\\+[0-9a-fA-F]{6}|[0-9a-fA-F]{4})`, "gu");
  return name.replace(escapes, (_, code) => {
    if (code === escape) return escape;
    const point = Number.parseInt(code.replace(/^\+/, ""), 16);
    return point <= 0x10ffff ? String.fromCodePoint(point) : "\0";
  });
}

/** @param {string} text @param {RegExp} token */
function nextProbeToken(text, token) {
  while (token.lastIndex < text.length) {
    const match = /** @type {RegExpExecArray} */ (token.exec(text));
    const [value] = match;
    if (value === "/*") {
      const comment = /\/\*|\*\//g;
      comment.lastIndex = token.lastIndex;
      let depth = 1;
      while (depth) {
        const delimiter = comment.exec(text)?.[0];
        if (!delimiter) return null;
        depth += delimiter === "/*" ? 1 : -1;
      }
      token.lastIndex = comment.lastIndex;
    } else if (!/^[\t\n\v\f\r ]/.test(value) && !value.startsWith("--")) {
      return match;
    }
  }
}

/** @param {string} text @param {RegExp} token */
function isCteColumnList(text, token) {
  const lookahead = new RegExp(token);
  lookahead.lastIndex = token.lastIndex;
  const next = () => nextProbeToken(text, lookahead);
  let delimiter;
  do {
    const [, unicodeQuote, quotedName, , word] = next() ?? [];
    if (quotedName === undefined && word === undefined) return false;
    delimiter = next();
    if (unicodeQuote && delimiter?.[4]?.toUpperCase() === "UESCAPE") {
      next(); // The main scan validates the escape literal.
      delimiter = next();
    }
  } while (delimiter?.[0] === ",");
  if (delimiter?.[0] !== ")" || next()?.[4]?.toUpperCase() !== "AS") return false;

  let body = next();
  if (body?.[4]?.toUpperCase() === "NOT") {
    body = next();
    if (body?.[4]?.toUpperCase() !== "MATERIALIZED") return false;
  }
  if (body?.[4]?.toUpperCase() === "MATERIALIZED") body = next();
  if (body?.[0] !== "(") return false;

  // A function in FROM can also be followed by AS and a column definition list.
  // Require a query at the start of the body to distinguish a CTE declaration.
  const query = next();
  const keyword = query?.[4]?.toUpperCase();
  return query?.[0] === "(" || keyword === "SELECT" || keyword === "WITH"
    || keyword === "TABLE" || (keyword === "VALUES" && next()?.[0] === "(");
}

/** @param {string} text */
function isReadProbe(text) {
  if (typeof text !== "string" || text.includes("\0")) return false;
  // Consume complete PostgreSQL lexical tokens before checking words or semicolons.
  // Require E strings for backslashes so ordinary strings are unambiguous in any session.
  const token = /[\t\n\v\f\r ]+|--[^\r\n]*|\/\*|[Ee]'(?:''|\\[\s\S]|[^'\\])*'|'(?:''|[^'\\])*'|(U&)?"((?:""|[^"])*)"|(\$(?:[a-z_\u0080-\uffff][a-z_0-9\u0080-\uffff]*)?\$)|([a-z_\u0080-\uffff][a-z_0-9$\u0080-\uffff]*)|[\s\S]/iy;
  let started = false;
  let terminated = false;
  let parentheses = 0;
  let cases = 0;
  let identifier;
  let identifierIntroducer;
  let previousToken;
  let unicodeName;
  let awaitingEscape = false;
  let readEscape = false;
  while (true) {
    const match = nextProbeToken(text, token);
    if (match === null) return false;
    if (!match) break;
    const [value, unicodeQuote, quotedName, dollarQuote, word] = match;
    if (terminated) return false;
    const keyword = word?.toUpperCase();
    if (awaitingEscape) {
      // Require a single plain character so PostgreSQL and this lexer interpret UESCAPE identically.
      if (!/^'[^\t\n\v\f\r +0-9a-f'"\\]'$/i.test(value)) return false;
      identifier = decodeUnicodeIdentifier(unicodeName ?? "", value[1]);
      unicodeName = undefined;
      awaitingEscape = false;
      readEscape = true;
      continue;
    }
    if (readEscape && value.startsWith("'")) return false; // SQL can concatenate adjacent literals across a newline.
    readEscape = false;
    if (unicodeName !== undefined && keyword === "UESCAPE") {
      awaitingEscape = true;
      continue;
    }
    if (value === "(") {
      const name = unicodeName === undefined ? identifier : decodeUnicodeIdentifier(unicodeName, "\\");
      if (name !== undefined && ADVISORY_LOCK_FUNCTION.test(name) && identifierIntroducer !== "AS"
        && (identifierIntroducer === "." || !isCteColumnList(text, token))) return false;
    }
    identifier = word ?? quotedName?.replaceAll('""', '"');
    identifierIntroducer = previousToken;
    previousToken = keyword ?? value;
    unicodeName = unicodeQuote ? identifier : undefined;
    if (!started) {
      if (keyword !== "SELECT" && keyword !== "WITH") return false;
      started = true;
    } else if (dollarQuote) {
      const end = text.indexOf(dollarQuote, token.lastIndex);
      if (end === -1) return false;
      token.lastIndex = end + dollarQuote.length;
    } else if (value === "'" || value === '"') {
      return false;
    } else if (value === ";") {
      terminated = true;
    } else if (value === "(") {
      parentheses++;
    } else if (value === ")") {
      if (--parentheses < 0) return false;
    } else if (keyword) {
      if (NON_READ_KEYWORDS.has(keyword)) return false;
      if (parentheses) continue;
      if (keyword === "CASE") cases++;
      else if (keyword === "END" && cases) cases--;
      else if (TRANSACTION_OR_LOCK_KEYWORDS.has(keyword)) return false;
    }
  }
  return started && !awaitingEscape && parentheses === 0 && cases === 0;
}

/** @param {Connection} connection @param {(query: MigrationQuery) => Promise<boolean>} adopt */
async function shouldAdopt(connection, adopt) {
  await connection.query("SAVEPOINT migration_adoption");
  await connection.query("SET LOCAL transaction_read_only = on");
  let probing = true;
  let invalidProbe = false;
  let adopted;
  try {
    adopted = await adopt(async (text, params) => {
      if (!probing || !isReadProbe(text)) {
        invalidProbe = true;
        throw new CoreError("invalid_input");
      }
      try {
        return (await connection.query(text, params)).rows;
      } catch (error) {
        if (error && typeof error === "object" && "code" in error && error.code === "25006") {
          invalidProbe = true;
          throw new CoreError("invalid_input");
        }
        throw error;
      }
    });
  } finally {
    probing = false;
    if (invalidProbe) throw new CoreError("invalid_input");
  }
  if (adopted !== true && adopted !== false) throw new CoreError("invalid_input");
  try {
    const { rows: [state] } = await connection.query("SELECT pg_catalog.pg_current_xact_id_if_assigned() IS NULL AS clean");
    if (state?.clean !== true) throw new CoreError("invalid_input");
    // Roll back to restore write mode, then release to verify the savepoint survived the probe.
    await connection.query("ROLLBACK TO SAVEPOINT migration_adoption");
    await connection.query("RELEASE SAVEPOINT migration_adoption");
  } catch {
    throw new CoreError("invalid_input");
  }
  return adopted;
}

/** @param {Connection} connection @param {Extract<Migration, { concurrent: false }>} migration */
async function applyTransactional(connection, { id, sql, adopt }) {
  await connection.query("BEGIN");
  try {
    let adopted = false;
    if (adopt) {
      adopted = await shouldAdopt(connection, adopt);
      // Only adoption hooks run host code that could release the lock. Between hooks, losing
      // the session would already fail the run, so this check covers the intervening migrations.
      if ((await connection.query(HOLDS_MIGRATION_LOCK)).rows[0]?.locked !== true) {
        throw new CoreError("storage_busy");
      }
    }
    if (!adopted) await connection.query(sql);
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
        // A matching invalid index can already enforce uniqueness. Clean it up even if SET fails.
        if (state?.valid === true) throw error;
      }
    }
  }
  if (state.valid === false) {
    const qualifiedName = `${quoteIdentifier(state.schema)}.${quoteIdentifier(state.name)}`;
    try {
      await connection.query(`DROP INDEX CONCURRENTLY IF EXISTS ${qualifiedName}`);
    } catch {
      // The runner destroys the session on failure. A later run can retry the drop.
    }
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

import { CoreError } from "../../core/src/index.mjs";
import { toPostgresError } from "./errors.mjs";
import { isReadStatement } from "./read-only.mjs";

/** @import { OwnerId, Tx, UnitOfWork, UnitOfWorkOptions } from "../../core/src/index.mjs" */
/** @import { Connection, ConnectionSource } from "./driver.mjs" */
/** @typedef {{ connection: Connection, failure?: CoreError }} Run */

const LOCK_TIMEOUT = "SET LOCAL lock_timeout = '5s'";
const STATEMENT_TIMEOUT = "SET LOCAL statement_timeout = '30s'";
// Match the hosted service so both implementations serialize on the same locks.
const PAUSE_LOCK = "SELECT pg_advisory_xact_lock(hashtextextended('cairn:memory-pause:' || $1, 0))";
const OWNER_LOCK = "SELECT pg_advisory_xact_lock(hashtext('w3:' || $1))";

/** @type {WeakMap<Tx, Run>} */
const liveRuns = new WeakMap();

/**
 * @param {Tx} tx
 * @param {string} text
 * @param {unknown[]} [values]
 */
export async function query(tx, text, values) {
  const run = liveRuns.get(tx);
  if (!run || (tx.readOnly && !isReadStatement(text))) {
    throw new CoreError("internal_error");
  }
  if (run.failure) throw run.failure;

  try {
    return await run.connection.query(text, values);
  } catch (error) {
    // A failed statement can leave the transaction aborted even if fn catches it.
    run.failure ??= toPostgresError(error);
    throw run.failure;
  }
}

/** @param {ConnectionSource} source @returns {UnitOfWork} */
export function createPostgresUnitOfWork(source) {
  return { run };

  /**
   * @template T
   * @param {OwnerId} owner
   * @param {UnitOfWorkOptions} options
   * @param {(tx: Tx) => Promise<T>} fn
   */
  async function run(owner, { pauseLock, readOnly = false }, fn) {
    try {
      const connection = await source.connect();
      let committed = false;
      try {
        await connection.query(readOnly ? "BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY" : "BEGIN");
        await connection.query(LOCK_TIMEOUT);
        await connection.query(STATEMENT_TIMEOUT);
        if (!readOnly) {
          if (pauseLock) await connection.query(PAUSE_LOCK, [owner]);
          await connection.query(OWNER_LOCK, [owner]);
        }

        const tx = Object.freeze({ owner, readOnly, __adapter: undefined });
        /** @type {Run} */
        const state = { connection };
        liveRuns.set(tx, state);
        let result;
        try {
          result = await fn(tx);
        } finally {
          liveRuns.delete(tx);
        }
        if (state.failure) throw state.failure;

        const commit = await connection.query("COMMIT");
        // Some transports expose the command tag, including ROLLBACK for an aborted COMMIT.
        if ("command" in commit && typeof commit.command === "string" && commit.command !== "COMMIT") {
          throw new CoreError("internal_error");
        }
        committed = true;
        return result;
      } catch (error) {
        try {
          await connection.query("ROLLBACK");
        } catch {
          // Keep the original failure. The connection will be discarded.
        }
        throw error;
      } finally {
        try {
          if (committed) await connection.release();
          else await connection.release(true);
        } catch (error) {
          if (committed) throw error;
        }
      }
    } catch (error) {
      throw toPostgresError(error);
    }
  }
}

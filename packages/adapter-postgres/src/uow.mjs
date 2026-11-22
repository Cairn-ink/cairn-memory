import { CoreError } from "../../core/src/index.mjs";
import { toPostgresError } from "./errors.mjs";
import { isReadStatement } from "./read-only.mjs";

/** @import { OwnerId, Tx, UnitOfWork, UnitOfWorkOptions } from "../../core/src/index.mjs" */
/** @import { Connection, ConnectionSource, QueryResult } from "./driver.mjs" */
/** @typedef {{ connection: Connection, pending: Set<Promise<QueryResult>>, failure?: CoreError }} Run */

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
export function query(tx, text, values) {
  const run = liveRuns.get(tx);
  if (!run) return Promise.reject(new CoreError("internal_error"));

  const pending = (async () => {
    try {
      if (run.failure) throw run.failure;
      if (tx.readOnly && !isReadStatement(text)) throw new CoreError("internal_error");
      return await run.connection.query(text, values);
    } catch (error) {
      // A failed statement can leave the transaction aborted even if fn catches it.
      run.failure ??= toPostgresError(error);
      throw run.failure;
    }
  })();
  run.pending.add(pending);
  // Observe rejections even when fn drops the returned promise.
  const forget = () => run.pending.delete(pending);
  void pending.then(forget, forget);
  return pending;
}

/** @param {Connection} connection @param {boolean} committed */
async function releaseConnection(connection, committed) {
  // Failed runs already discard the connection. Reset reusable sessions outside the transaction.
  if (committed) {
    try {
      if ((await connection.query("SELECT pg_advisory_unlock_all()")).command === "SELECT"
        && (await connection.query("RESET ALL")).command === "RESET") {
        await connection.release();
        return;
      }
    } catch {
      // Preserve the committed result and try to discard the connection.
    }
  }
  try {
    await connection.release(true);
  } catch {
    // Preserve the transaction outcome if the driver cannot discard it.
  }
}

/** @param {ConnectionSource} source @returns {UnitOfWork} */
export function createPostgresUnitOfWork(source) {
  return { run };

  /**
   * The core contract forbids nested runs for the same owner.
   * @template T
   * @param {OwnerId} owner
   * @param {UnitOfWorkOptions} options
   * @param {(tx: Tx) => Promise<T>} fn
   */
  async function run(owner, { pauseLock, readOnly = false }, fn) {
    try {
      const connection = await source.connect();
      /** @type {Run} */
      const state = { connection, pending: new Set() };
      let committed = false;
      try {
        let result;
        try {
          await connection.query(readOnly ? "BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY" : "BEGIN");
          await connection.query(LOCK_TIMEOUT);
          await connection.query(STATEMENT_TIMEOUT);
          if (!readOnly) {
            if (pauseLock) await connection.query(PAUSE_LOCK, [owner]);
            await connection.query(OWNER_LOCK, [owner]);
          }

          const tx = Object.freeze({ owner, readOnly, __adapter: undefined });
          liveRuns.set(tx, state);
          try {
            result = await fn(tx);
          } finally {
            liveRuns.delete(tx);
            await Promise.allSettled(state.pending);
            if (state.failure) throw state.failure;
          }
        } catch (error) {
          try {
            await connection.query("ROLLBACK");
          } catch {
            // Keep the original failure. The connection will be discarded.
          }
          throw error;
        }

        let command;
        try {
          command = (await connection.query("COMMIT"))?.command;
        } catch {
          // Without a recognized command tag, the caller must reconcile the outcome.
        }
        if (command === "ROLLBACK") {
          throw state.failure ?? new CoreError("storage_error");
        }
        if (command !== "COMMIT") throw new CoreError("commit_outcome_unknown");
        committed = true;
        return result;
      } finally {
        await releaseConnection(connection, committed);
      }
    } catch (error) {
      throw toPostgresError(error);
    }
  }
}

import { CoreError } from "../../core/src/index.mjs";
import { toPostgresError } from "./errors.mjs";
import { isReadStatement } from "./read-only.mjs";

/** @import { OwnerId, Tx, UnitOfWork, UnitOfWorkOptions } from "../../core/src/index.mjs" */
/** @import { Connection, ConnectionSource } from "./driver.mjs" */
/** @typedef {{ connection: Connection, pending: Set<Promise<unknown>>, operationTail?: Promise<unknown>, failure?: CoreError }} Run */

const LOCK_TIMEOUT = "SET LOCAL lock_timeout = '5s'";
const STATEMENT_TIMEOUT = "SET LOCAL statement_timeout = '30s'";
// Match the hosted service so both implementations serialize on the same locks.
const PAUSE_LOCK = "SELECT pg_advisory_xact_lock(hashtextextended('cairn:memory-pause:' || $1, 0))";
const OWNER_LOCK = "SELECT pg_advisory_xact_lock(hashtext('w3:' || $1))";

/** @type {WeakMap<Tx, Run>} */
const liveRuns = new WeakMap();

/** @param {Tx} tx @param {boolean} [write] */
export function requireLiveRun(tx, write = false) {
  const run = liveRuns.get(tx);
  if (!run || (write && tx.readOnly)) throw new CoreError("internal_error");
  return run;
}

/** @template T @param {Run} run @param {Promise<T>} pending */
function trackPending(run, pending) {
  run.pending.add(pending);
  // Observe rejections even when fn drops the returned promise.
  const forget = () => run.pending.delete(pending);
  void pending.then(forget, forget);
  return pending;
}

/**
 * @param {Run} run
 * @param {boolean} readOnly
 * @param {string} text
 * @param {unknown[]} [values]
 */
async function queryInRun(run, readOnly, text, values) {
  try {
    if (run.failure) throw run.failure;
    if (readOnly && !isReadStatement(text)) throw new CoreError("internal_error");
    return await run.connection.query(text, values);
  } catch (error) {
    // A failed statement can leave the transaction aborted even if fn catches it.
    run.failure ??= toPostgresError(error);
    throw run.failure;
  }
}

/**
 * @param {Tx} tx
 * @param {string} text
 * @param {unknown[]} [values]
 */
export function query(tx, text, values) {
  const run = liveRuns.get(tx);
  if (!run) return Promise.reject(new CoreError("internal_error"));
  return trackPending(run, queryInRun(run, tx.readOnly, text, values));
}

/**
 * Keep a multi-statement operation on the captured connection until it settles.
 * @template T
 * @param {Tx} tx
 * @param {(query: Connection["query"]) => Promise<T>} body
 */
export function runOperation(tx, body) {
  const run = liveRuns.get(tx);
  if (!run) return Promise.reject(new CoreError("internal_error"));

  const start = async () => {
    try {
      if (run.failure) throw run.failure;
      return await body((text, values) => queryInRun(run, tx.readOnly, text, values));
    } catch (error) {
      run.failure ??= toPostgresError(error);
      throw run.failure;
    }
  };
  const pending = (run.operationTail ?? Promise.resolve()).then(start, start);
  run.operationTail = pending;
  return trackPending(run, pending);
}

/** @param {Connection} connection @param {boolean} committed */
async function releaseConnection(connection, committed) {
  // Failed runs already destroy the connection. Reset reusable sessions outside the transaction.
  if (committed) {
    try {
      // The server tag is "DISCARD ALL"; some drivers report only the first word.
      const { command } = await connection.query("DISCARD ALL");
      if (command === "DISCARD ALL" || command === "DISCARD") {
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

/**
 * Production hosts should use a source that opens a fresh client on connect for
 * each run and ends it on release. This prevents session state from carrying
 * across runs at this layer. DISCARD ALL is the backstop for pooled sources.
 * Pool rules for hosts (DISCARD ALL does not cover these): adapter SQL never reads custom
 * (dotted) settings, so a placeholder left registered by an earlier session cannot change it;
 * and the driver contract carries no statement names, so the adapter never creates named
 * protocol statements. A host must not share a pooled source with code that uses named
 * statements or custom settings.
 * DISCARD ALL leaves the pseudorandom state set by setseed intact. Owner data
 * and transaction correctness are independent of that state.
 * @param {ConnectionSource} source
 * @returns {UnitOfWork}
 */
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

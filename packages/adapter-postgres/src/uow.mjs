import { CoreError } from "../../core/src/index.mjs";
import { toPostgresError } from "./errors.mjs";
import { isReadStatement } from "./read-only.mjs";

/** @import { OwnerId, Tx, UnitOfWork, UnitOfWorkOptions } from "../../core/src/index.mjs" */
/** @import { Connection, ConnectionSource } from "./driver.mjs" */
/** @typedef {{ connection: Connection, pending: Set<Promise<unknown>>, operationTail?: Promise<unknown>, failure?: CoreError, statementFailure?: CoreError, pauseLock: boolean, indexStart?: bigint }} Run */

const LOCK_TIMEOUT = "5s";
const STATEMENT_TIMEOUT = "SET LOCAL statement_timeout = '30s'";
// Match the hosted service so both implementations serialize on the same locks.
const PAUSE_LOCK_KEY = "hashtextextended('cairn:memory-pause:' || $1, 0)";
const PAUSE_LOCK = `SELECT pg_advisory_xact_lock(${PAUSE_LOCK_KEY})`;
const SHARED_PAUSE_LOCK = `SELECT pg_advisory_lock_shared(${PAUSE_LOCK_KEY})`;
const SHARED_PAUSE_UNLOCK = `SELECT pg_advisory_unlock_shared(${PAUSE_LOCK_KEY}) AS value`;
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
 * @param {boolean} [checkAfterFailure]
 */
async function queryInRun(run, readOnly, text, values, checkAfterFailure = false) {
  // Logical write failures leave PostgreSQL usable for precondition reads. The
  // transaction still rolls back with the first failure and issues no further writes.
  if (run.failure && (!checkAfterFailure || run.statementFailure || !isReadStatement(text))) throw run.failure;
  try {
    if (readOnly && !isReadStatement(text)) throw new CoreError("internal_error");
    return await run.connection.query(text, values);
  } catch (error) {
    // A failed statement can leave the transaction aborted even if fn catches it.
    run.statementFailure ??= toPostgresError(error);
    run.failure ??= run.statementFailure;
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
 * @param {(query: Connection["query"], run: Run) => Promise<T>} body
 * @param {boolean} [checkAfterFailure] Allow read-only precondition checks after a logical failure.
 */
export function runOperation(tx, body, checkAfterFailure = false) {
  const run = liveRuns.get(tx);
  if (!run) return Promise.reject(new CoreError("internal_error"));

  const start = async () => {
    try {
      if (run.failure && (!checkAfterFailure || run.statementFailure)) throw run.failure;
      return await body((text, values) => queryInRun(run, tx.readOnly, text, values, checkAfterFailure), run);
    } catch (error) {
      const mapped = toPostgresError(error);
      run.failure ??= mapped;
      throw mapped;
    }
  };
  const pending = (run.operationTail ?? Promise.resolve()).then(start, start);
  run.operationTail = pending;
  return trackPending(run, pending);
}

/** @param {Connection} connection @param {OwnerId} owner */
async function unlockSharedPause(connection, owner) {
  try {
    const { rows } = await connection.query(SHARED_PAUSE_UNLOCK, [owner]);
    return Boolean(rows[0]?.value);
  } catch {
    // The caller discards the session and preserves the transaction outcome.
    return false;
  }
}

/** @param {Connection} connection @param {boolean} reusable */
async function releaseConnection(connection, reusable) {
  // Reset reusable sessions outside the transaction.
  if (reusable) {
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
    const callbackFailure = { caught: false, error: /** @type {unknown} */ (undefined) };
    try {
      const connection = await source.connect();
      /** @type {Run} */
      const state = { connection, pending: new Set(), pauseLock: pauseLock === true };
      let committed = false;
      let sharedPauseHeld = false;
      try {
        if (readOnly && pauseLock) {
          // Acquire the session lock before BEGIN so the snapshot follows the wait.
          const { rows: [{ value: previousTimeout }] } = await connection.query("SELECT current_setting('lock_timeout') AS value");
          await connection.query(`SET lock_timeout = '${LOCK_TIMEOUT}'`);
          await connection.query(SHARED_PAUSE_LOCK, [owner]);
          sharedPauseHeld = true;
          await connection.query("SELECT set_config('lock_timeout', $1, false)", [previousTimeout]);
        }
        let result;
        try {
          await connection.query(readOnly ? "BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY" : "BEGIN");
          await connection.query(`SET LOCAL lock_timeout = '${LOCK_TIMEOUT}'`);
          await connection.query(STATEMENT_TIMEOUT);
          if (!readOnly) {
            if (pauseLock) await connection.query(PAUSE_LOCK, [owner]);
            await connection.query(OWNER_LOCK, [owner]);
          }

          const tx = Object.freeze({ owner, readOnly, __adapter: undefined });
          liveRuns.set(tx, state);
          try {
            result = await fn(tx);
          } catch (error) {
            callbackFailure.caught = true;
            callbackFailure.error = error;
            throw error;
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
        const unlocked = !sharedPauseHeld || await unlockSharedPause(connection, owner);
        await releaseConnection(connection, committed && unlocked);
      }
    } catch (error) {
      // Port and driver failures have their own mapping. Preserve an explicit
      // callback rejection so callers can distinguish their rollback signal.
      if (callbackFailure.caught && Object.is(error, callbackFailure.error)) throw error;
      throw toPostgresError(error);
    }
  }
}

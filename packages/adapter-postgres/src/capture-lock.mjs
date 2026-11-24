import { CoreError } from "../../core/src/index.mjs";
import { toPostgresError } from "./errors.mjs";
import { requireLiveRun, runOperation } from "./uow.mjs";

/** @import { Tx } from "../../core/src/ports/unit-of-work.d.ts" */
/** @import { Run } from "./uow.mjs" */
/** @import { Connection } from "./driver.mjs" */
/** @typedef {Connection["query"]} Query */

// The pause lock is acquired by the UnitOfWork before the owner write lock.
// Inspect the lock held by this backend without acquiring it in reverse order.
const HAS_PAUSE_LOCK = `SELECT EXISTS (
  SELECT 1 FROM pg_catalog.pg_locks
  CROSS JOIN (SELECT hashtextextended('cairn:memory-pause:' || $1, 0) AS key) AS pause
  WHERE locktype = 'advisory' AND pid = pg_backend_pid() AND objsubid = 1 AND granted AND mode = 'ExclusiveLock'
    AND classid::bigint = ((pause.key >> 32) & 4294967295)
    AND objid::bigint = (pause.key & 4294967295)
) AS held`;

/**
 * Prepare inputs synchronously, then check the pause lock before touching capture state.
 * Guard and validation failures leave an otherwise usable run, as in the reference adapter.
 * @template T @param {Tx} tx @param {() => (query: Query, run: Run) => Promise<T>} prepare
 */
export async function pauseLockedWrite(tx, prepare) {
  requireLiveRun(tx, true);
  /** @type {((query: Query, run: Run) => Promise<T>) | undefined} */
  let body;
  /** @type {CoreError | undefined} */
  let invalidInput;
  try {
    body = prepare();
  } catch (error) {
    invalidInput = toPostgresError(error);
  }
  const result = await runOperation(tx, async (query, run) => {
    const { rows: [lock] } = await query(HAS_PAUSE_LOCK, [tx.owner]);
    if (lock?.held !== true) return { error: new CoreError("internal_error") };
    if (!body) return { error: invalidInput };
    return { value: await body(query, run) };
  });
  if ("value" in result) return /** @type {T} */ (result.value);
  throw result.error;
}

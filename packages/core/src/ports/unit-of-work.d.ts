import type { OwnerId } from "./common.d.ts";

/**
 * Transaction handle. Opaque to core: core passes it to port methods unchanged.
 * The Tx IS the run identity. Ports must only be called with a Tx obtained from the same
 * UnitOfWork run. Adapters reject a Tx they did not issue or whose run has ended, and refuse
 * writes on a readOnly Tx. Adapters are not required to detect a live Tx passed into a
 * different, concurrently live run (no async-context mechanism exists on every runtime);
 * core never does that, and the conformance kit checks core's call sites.
 */
export interface Tx {
  readonly owner: OwnerId;
  readonly readOnly: boolean;
  /** Adapter-private. */
  readonly __adapter: unknown;
}

export interface UnitOfWorkOptions {
  /** Take the owner's pause lock first (save, update, forget, capture admission, pause/resume). */
  pauseLock?: boolean;
  /** One consistent snapshot, no writes (Postgres REPEATABLE READ READ ONLY; local read txn). */
  readOnly?: boolean;
}

/**
 * Contract (every adapter, checked by the conformance kit):
 * - one atomic transaction per run; any throw rolls back everything;
 * - writers are serialized per owner;
 * - lock order is ALWAYS pause lock, then the owner write lock;
 * - inside fn, core awaits ONLY port methods called with this Tx: no model, network, timer
 *   or foreign I/O (core embeds/extracts before run, then re-checks inside);
 * - native failures surface as CoreError codes via the adapter's native-code map.
 *
 * Await-safety (approved design):
 * - Postgres: one checked-out connection per run; BEGIN … COMMIT on it; advisory locks.
 * - Local (synchronous SQLite driver): the adapter runs each write unit on an EXCLUSIVE
 *   writer connection held under an async mutex (process-wide, single writer). Port methods
 *   execute synchronously and return already-resolved promises; because the mutex makes the
 *   connection exclusive, no foreign statement can interleave across core's awaits. The
 *   adapter's runner replaces the engine's "no async work inside a transaction" guard with
 *   this mutex + an ownership check on every port call (the Tx must be the live one).
 *   readOnly runs get the same treatment on a dedicated reader connection (its own mutex,
 *   one read transaction / snapshot), since the engine guard rejects async reads too.
 * - Conformance: lock order; rollback on throw at every step; an outbound-call-counting
 *   model/fetch stub records zero calls inside run; (local) a concurrent run on the same
 *   connection waits for the mutex and never observes uncommitted state.
 */
export interface UnitOfWork {
  run<T>(owner: OwnerId, options: UnitOfWorkOptions, fn: (tx: Tx) => Promise<T>): Promise<T>;
}

import { AsyncLocalStorage } from "node:async_hooks";
import { realpathSync, statSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { pathToFileURL } from "node:url";
import { types } from "node:util";
import { CoreError } from "@cairn-ink/core";
import { isNativeSqliteError, toSqliteError } from "./errors.mjs";
import { assertMigrationComplete, assertServingFilename } from "./migrate/guard.mjs";
import { sqlitePortScope } from "./port-scope.mjs";

/** @import { OwnerId, Tx, UnitOfWork } from "@cairn-ink/core/ports" */
/** @typedef {{ db: DatabaseSync, pauseLock: boolean, failure?: CoreError, transactionEnded?: boolean, executing?: boolean,
 * arrivalRefusal?: (db: PortConnection) => void }} LiveRun */
/** @typedef {ReturnType<typeof sqlitePortScope>["connection"]} PortConnection */

/** @type {AsyncLocalStorage<Tx>} */
const runContext = new AsyncLocalStorage();

class Mutex {
  #tail = Promise.resolve();

  async acquire() {
    const previous = this.#tail;
    /** @type {() => void} */
    let release = () => {};
    this.#tail = new Promise((resolve) => { release = resolve; });
    await previous;
    return release;
  }
}

/** @param {string} path */
function fileIdentity(path) {
  const file = statSync(path, { bigint: true });
  if (!file.isFile()) throw new CoreError("invalid_input");
  return `${file.dev}:${file.ino}`;
}

/** @param {string} identity */
function reserveFile(identity) {
  // Named shared-memory databases are shared by SQLite connections across Workers.
  // This transaction reserves the physical file without locking its WAL writer.
  const reservation = new DatabaseSync(`file:cairn-sqlite-owner-${identity}?mode=memory&cache=shared`);
  try {
    if (reservation.prepare("SELECT sqlite_compileoption_used('OMIT_SHARED_CACHE') AS omitted").get()?.omitted !== 0) {
      throw new CoreError("storage_error");
    }
    reservation.exec("BEGIN IMMEDIATE");
    return reservation;
  } catch (error) {
    reservation.close();
    throw error;
  }
}

/** @param {unknown} value */
function hasThenableResult(value) {
  if (value === null || (typeof value !== "object" && typeof value !== "function")) return false;
  // Accessors and proxies can supply a callable then during Promise resolution.
  for (let object = value; object; object = Object.getPrototypeOf(object)) {
    if (types.isProxy(object)) return true;
    const then = Object.getOwnPropertyDescriptor(object, "then");
    if (then) return !Object.hasOwn(then, "value") || typeof then.value === "function";
  }
  return false;
}

/**
 * Own the reader and writer for a provisioned database file. The host routes
 * owners to files and keeps the canonical path stable for the lifetime of the store.
 * @param {string} filename
 */
export function openSqliteUnitOfWork(filename) {
  return openUnitOfWork(filename, false);
}

/** @param {string} filename */
export function openMigrationUnitOfWork(filename) {
  return openUnitOfWork(filename, true);
}

/** @param {string} filename @param {boolean} migration */
function openUnitOfWork(filename, migration) {
  if (typeof filename !== "string" || !filename || filename === ":memory:") throw new CoreError("invalid_input");
  if (runContext.getStore()) throw new CoreError("internal_error");

  /** @type {DatabaseSync | undefined} */
  let openingWriter;
  /** @type {DatabaseSync | undefined} */
  let openingReader;
  /** @type {DatabaseSync | undefined} */
  let reservation;
  try {
    const path = realpathSync(filename);
    if (!migration) {
      assertServingFilename(filename);
      assertServingFilename(path);
    }
    const identity = fileIdentity(path);
    reservation = reserveFile(identity);
    const uri = pathToFileURL(path);
    uri.searchParams.set("mode", "rw");
    openingWriter = new DatabaseSync(uri.href);
    if (!migration) assertMigrationComplete(openingWriter);
    const journalMode = openingWriter.prepare("PRAGMA main.journal_mode = WAL").get()?.journal_mode;
    if (journalMode !== "wal") throw new CoreError("storage_error");
    openingReader = new DatabaseSync(path, { readOnly: true });
    openingReader.exec("PRAGMA query_only = ON");
    if (fileIdentity(path) !== identity) throw new CoreError("storage_error");
  } catch (error) {
    try {
      closeConnections(openingReader, openingWriter, reservation);
    } catch {
      // Keep the startup failure and reserve the file if a handle could not close.
    }
    throw toSqliteError(error);
  }
  const writer = openingWriter;
  const reader = openingReader;
  const migratedRaw = Boolean(writer.prepare("SELECT 1 FROM sqlite_schema WHERE name='cairn_migrated_raw_privacy'").get());
  const writerLock = new Mutex();
  const readerLock = new Mutex();
  /** @type {Map<OwnerId, { lock: Mutex, users: number }>} */
  const pauseLocks = new Map();
  /** @type {WeakMap<Tx, LiveRun>} */
  const live = new WeakMap();
  /** @type {Set<Promise<unknown>>} */
  const pending = new Set();
  /** @type {Promise<void> | undefined} */
  let closing;
  let unusable = false;

  const uow = /** @satisfies {UnitOfWork} */ ({
    run(owner, options, fn) {
      if (typeof owner !== "string" || !owner || !options || typeof options !== "object" || typeof fn !== "function") {
        return Promise.reject(new CoreError("invalid_input"));
      }
      if (closing || unusable || runContext.getStore()) return Promise.reject(new CoreError("internal_error"));
      let pauseLock;
      let readOnly;
      try {
        pauseLock = options.pauseLock === true;
        readOnly = options.readOnly === true;
      } catch (error) {
        return Promise.reject(error);
      }
      if (closing || unusable) return Promise.reject(new CoreError("internal_error"));
      const work = Promise.resolve().then(() => execute(owner, pauseLock, readOnly, fn));
      pending.add(work);
      const settled = () => pending.delete(work);
      void work.then(settled, settled);
      return work;
    },
  });

  /** @template T @param {OwnerId} owner @param {boolean} pauseLock @param {boolean} readOnly @param {(tx: Tx) => Promise<T>} fn */
  async function execute(owner, pauseLock, readOnly, fn) {
    const db = readOnly ? reader : writer;
    const pause = pauseLock ? pauseLocks.get(owner) ?? { lock: new Mutex(), users: 0 } : undefined;
    if (pause) {
      pause.users++;
      pauseLocks.set(owner, pause);
    }
    const releasePause = await pause?.lock.acquire();
    const releaseConnection = await (readOnly ? readerLock : writerLock).acquire();
    try {
      if (unusable) throw new CoreError("internal_error");
      const tx = Object.freeze({ owner, readOnly, __adapter: undefined });
      const run = /** @type {LiveRun} */ ({ db, pauseLock });
      let callbackFailed = false;
      const protectArrival = migratedRaw && pauseLock && !readOnly;
      try {
        db.exec(readOnly ? "BEGIN" : "BEGIN IMMEDIATE");
        if (protectArrival) db.exec("SAVEPOINT capture_arrival");
        // A deferred BEGIN alone does not establish a SQLite read snapshot.
        if (readOnly) db.prepare("SELECT rootpage FROM main.sqlite_schema LIMIT 1").get();
        live.set(tx, run);
        let result;
        try {
          result = await runContext.run(tx, fn, tx);
        } catch (error) {
          callbackFailed = true;
          throw error;
        } finally {
          live.delete(tx);
        }
        if (run.failure) throw run.failure;
        if (run.transactionEnded || !db.isTransaction) throw new CoreError("internal_error");
        db.exec("COMMIT");
        return result;
      } catch (error) {
        const refusal = protectArrival && db.isTransaction && !run.transactionEnded && run.arrivalRefusal;
        try {
          if (refusal) {
            // Discard every ordinary write. Only the privacy refusal survives,
            // under the original writer lock, before the error reaches core.
            db.exec("ROLLBACK TO capture_arrival");
            const scope = sqlitePortScope(db, operation => operation());
            try { refusal(scope.connection); }
            finally { scope.revoke(); }
            db.exec("COMMIT");
          } else if (db.isTransaction) db.exec("ROLLBACK");
        } catch (cleanupError) {
          unusable = true;
          try { if (db.isOpen) db.close(); } catch { /* Retry cleanup during shutdown. */ }
          if (refusal) throw toSqliteError(cleanupError);
        }
        throw callbackFailed && !isNativeSqliteError(error) ? error : toSqliteError(error);
      }
    } finally {
      releaseConnection();
      releasePause?.();
      if (pause && --pause.users === 0) pauseLocks.delete(owner);
    }
  }

  /** @param {Tx} tx @param {NonNullable<LiveRun["arrivalRefusal"]>} effect */
  function preserveArrivalRefusal(tx, effect) {
    const run = live.get(tx);
    if (!run || !migratedRaw || !run.pauseLock || tx.readOnly) throw new CoreError("internal_error");
    assertTransaction(tx, run);
    run.arrivalRefusal ??= effect;
  }

  /** @param {Tx} tx @param {LiveRun} run */
  function assertTransaction(tx, run) {
    if (live.get(tx) !== run || runContext.getStore() !== tx || unusable || run.executing) {
      throw new CoreError("internal_error");
    }
    if (run.transactionEnded || !run.db.isTransaction) {
      run.transactionEnded = true;
      throw new CoreError("internal_error");
    }
  }

  /**
   * Adapter-private access for a trusted, synchronous storage operation. Bodies
   * only use the supplied connection for statements and return materialized data.
   * @template T
   * @param {Tx} tx
   * @param {OwnerId} owner
   * @param {{ write?: boolean, pauseLock?: boolean }} options
   * @param {(db: PortConnection) => T} body
   * @returns {Promise<Awaited<T>>}
   */
  function port(tx, owner, { write = false, pauseLock = false }, body) {
    const run = live.get(tx);
    if (!run || runContext.getStore() !== tx || owner !== tx.owner || (write && tx.readOnly) ||
        (pauseLock && !run.pauseLock) || unusable) {
      return Promise.reject(new CoreError("internal_error"));
    }
    try {
      assertTransaction(tx, run);
      if (types.isAsyncFunction(body) || types.isGeneratorFunction(body)) throw new CoreError("internal_error");
      const scope = sqlitePortScope(run.db, operation => {
        assertTransaction(tx, run);
        run.executing = true;
        try {
          return operation();
        } finally {
          run.executing = false;
          // SQLite can end the transaction before surfacing a statement error.
          if (!run.db.isTransaction) run.transactionEnded = true;
        }
      });
      let result;
      try {
        result = body(scope.connection);
      } finally {
        scope.revoke();
      }
      if (types.isPromise(result)) void Promise.prototype.then.call(result, undefined, () => {});
      if (result === scope.connection || types.isPromise(result) || hasThenableResult(result)) {
        throw new CoreError("internal_error");
      }
      return Promise.resolve(result);
    } catch (error) {
      const mapped = toSqliteError(error);
      if (write) run.failure ??= mapped;
      const rejected = Promise.reject(mapped);
      // The transaction still checks the poison if its caller drops this promise.
      if (write) void rejected.catch(() => {});
      return rejected;
    }
  }

  function close() {
    if (runContext.getStore()) return Promise.reject(new CoreError("internal_error"));
    closing ??= Promise.allSettled(pending).then(() => closeConnections(reader, writer, reservation));
    return closing;
  }

  return { uow, port, close, preserveArrivalRefusal };
}

/** @param {DatabaseSync | undefined} reader @param {DatabaseSync | undefined} writer @param {DatabaseSync | undefined} reservation */
function closeConnections(reader, writer, reservation) {
  try {
    try {
      try {
        if (reader?.isOpen) reader.close();
      } finally {
        if (writer?.isOpen) writer.close();
      }
    } finally {
      if (reservation?.isOpen && !reader?.isOpen && !writer?.isOpen) reservation.close();
    }
  } catch (error) {
    throw toSqliteError(error);
  }
}

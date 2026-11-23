import { AsyncLocalStorage } from "node:async_hooks";
import { realpathSync, statSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { pathToFileURL } from "node:url";
import { types } from "node:util";
import { CoreError } from "@cairn-ink/core";
import { isNativeSqliteError, toSqliteError } from "./errors.mjs";

/** @import { OwnerId, Tx, UnitOfWork, UnitOfWorkOptions } from "@cairn-ink/core/ports" */
/** @typedef {{ db: DatabaseSync, pauseLock: boolean, failure?: CoreError }} LiveRun */

const openFiles = new Set();
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

/**
 * Own the reader and writer for a provisioned database file. The host routes
 * owners to files and keeps the canonical path stable for the lifetime of the store.
 * @param {string} filename
 */
export function openSqliteUnitOfWork(filename) {
  if (typeof filename !== "string" || !filename || filename === ":memory:") throw new CoreError("invalid_input");
  if (runContext.getStore()) throw new CoreError("internal_error");

  /** @type {DatabaseSync | undefined} */
  let openingWriter;
  /** @type {DatabaseSync | undefined} */
  let openingReader;
  /** @type {string | undefined} */
  let reserved;
  try {
    const path = realpathSync(filename);
    const identity = fileIdentity(path);
    if (openFiles.has(identity)) throw new CoreError("storage_busy");
    openFiles.add(identity);
    reserved = identity;
    const uri = pathToFileURL(path);
    uri.searchParams.set("mode", "rw");
    openingWriter = new DatabaseSync(uri.href);
    const journalMode = openingWriter.prepare("PRAGMA main.journal_mode = WAL").get()?.journal_mode;
    if (journalMode !== "wal") throw new CoreError("storage_error");
    openingReader = new DatabaseSync(path, { readOnly: true });
    openingReader.exec("PRAGMA query_only = ON");
    if (fileIdentity(path) !== identity) throw new CoreError("storage_error");
  } catch (error) {
    try {
      closeConnections(openingReader, openingWriter, reserved);
    } catch {
      // Keep the startup failure and reserve the file if a handle could not close.
    }
    throw toSqliteError(error);
  }
  const writer = openingWriter;
  const reader = openingReader;
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
      const work = execute(owner, options, fn);
      pending.add(work);
      const settled = () => pending.delete(work);
      void work.then(settled, settled);
      return work;
    },
  });

  /** @template T @param {OwnerId} owner @param {UnitOfWorkOptions} options @param {(tx: Tx) => Promise<T>} fn */
  async function execute(owner, options, fn) {
    const pauseLock = options.pauseLock === true;
    const readOnly = options.readOnly === true;
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
      try {
        db.exec(readOnly ? "BEGIN" : "BEGIN IMMEDIATE");
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
        if (!db.isTransaction) throw new CoreError("internal_error");
        db.exec("COMMIT");
        return result;
      } catch (error) {
        try {
          if (db.isTransaction) db.exec("ROLLBACK");
        } catch {
          unusable = true;
          try { if (db.isOpen) db.close(); } catch { /* Retry cleanup during shutdown. */ }
        }
        throw callbackFailed && !isNativeSqliteError(error) ? error : toSqliteError(error);
      }
    } finally {
      releaseConnection();
      releasePause?.();
      if (pause && --pause.users === 0) pauseLocks.delete(owner);
    }
  }

  /**
   * Adapter-private access for a trusted, synchronous storage operation. Bodies
   * only use the supplied connection for statements and return materialized data.
   * @template T
   * @param {Tx} tx
   * @param {OwnerId} owner
   * @param {{ write?: boolean, pauseLock?: boolean }} options
   * @param {(db: DatabaseSync) => T} body
   * @returns {Promise<Awaited<T>>}
   */
  function port(tx, owner, { write = false, pauseLock = false }, body) {
    const run = live.get(tx);
    if (!run || runContext.getStore() !== tx || owner !== tx.owner || (write && tx.readOnly) ||
        (pauseLock && !run.pauseLock) || unusable) {
      return Promise.reject(new CoreError("internal_error"));
    }
    try {
      // A failed statement can roll back SQLite itself. No later statement may
      // fall through to autocommit, including after a caught write error.
      if (!run.db.isTransaction || types.isAsyncFunction(body) || types.isGeneratorFunction(body)) {
        throw new CoreError("internal_error");
      }
      const result = body(run.db);
      if (types.isPromise(result)) void Promise.prototype.then.call(result, undefined, () => {});
      if (result === run.db || (result != null && typeof (/** @type {{ then?: unknown }} */ (result)).then === "function")) {
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
    closing ??= Promise.allSettled(pending).then(() => closeConnections(reader, writer, reserved));
    return closing;
  }

  return { uow, port, close };
}

/** @param {DatabaseSync | undefined} reader @param {DatabaseSync | undefined} writer @param {string | undefined} identity */
function closeConnections(reader, writer, identity) {
  try {
    try {
      if (reader?.isOpen) reader.close();
    } finally {
      if (writer?.isOpen) writer.close();
    }
  } catch (error) {
    throw toSqliteError(error);
  } finally {
    if (identity !== undefined && !reader?.isOpen && !writer?.isOpen) openFiles.delete(identity);
  }
}

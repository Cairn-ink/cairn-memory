import { lstatSync } from 'node:fs';
import { performance } from 'node:perf_hooks';
import { setTimeout as delay } from 'node:timers/promises';
import { MemoryStoreError } from './validation.mjs';

// Never inspect SQLite files through raw descriptors: closing one would release
// every POSIX record lock this process holds on the same inode (Workers included).
// Companion stats are hints only; SQLite is the authority on journal mode.
function companion(path, suffix) {
  try { lstatSync(path + suffix); return true; }
  catch (error) { if (error.code === 'ENOENT') return false; throw error; }
}
export function topicJournalMode(native, path, policy, { deferQueryErrors = false, checkAdmission } = {}) {
  const rollback = () => companion(path, '-journal');
  const hintedWal = !rollback() && (companion(path, '-wal') || companion(path, '-shm'));
  let queryFailure;
  const query = wait => {
    const db = policy.database(native, wait);
    let row;
    try { checkAdmission?.();const statement=db.prepare('PRAGMA journal_mode');checkAdmission?.();row=statement.get(); }
    catch (error) {
      // Installing a timeout happens inside the query proxy, but is configuration.
      if (error.code === 'ERR_SQLITE_ERROR' && sqliteFailureDiagnostics(error)?.stage !== 'configure') queryFailure = error;
      throw error;
    }
    return row.journal_mode.toUpperCase();
  };
  try {
    try { return query(hintedWal); }
    catch (error) {
      // Only retry the opening query, before any transaction or traversal.
      if (hintedWal || (error.errcode & 255) !== 5 || rollback()) throw error;
      return query(true);
    }
  } catch (error) {
    // Only journal-query failures may defer to legacy metadata validation.
    // The finally boundary below must propagate every timeout-reset failure.
    if (!deferQueryErrors || error !== queryFailure || [5, 6].includes(error.errcode & 255)) throw error;
  } finally {
    // A hint or fallback must never grant subsequent DELETE statements a wait.
    try { native.exec('PRAGMA busy_timeout=0'); }
    catch (error) { throw recordSqliteFailure(error, 'configure', 'reader_configuration'); }
  }
}

// The ceiling includes reply headroom: at most 980ms native waiting.
export const TOPIC_WAL_WAIT_MS = 1000;
export const TOPIC_WAL_REPLY_RESERVE_MS = 20;
const DELETE_RETRY_MS = 25;
export const SQLITE_STAGES = Object.freeze(['open', 'configure', 'prepare', 'execute', 'begin', 'commit', 'rollback', 'close']);
export const SQLITE_STATEMENTS = Object.freeze(['connection', 'reader_configuration', 'journal_mode', 'application_id', 'user_version',
  'schema_version', 'encoding', 'schema_metadata', 'snapshot_metadata', 'topic_metadata', 'transaction']);
const failures = new WeakMap();
export function recordSqliteFailure(error, stage, statement) {
  if (error?.code === 'ERR_SQLITE_ERROR' && Number.isInteger(error.errcode) &&
      SQLITE_STAGES.includes(stage) && SQLITE_STATEMENTS.includes(statement)) {
    failures.set(error, { stage, statement, sqlite: { code: error.errcode & 255, extendedCode: error.errcode } });
  }
  return error;
}
export const sqliteFailureDiagnostics = error => failures.get(error);
export function unsupportedTopicStorage(error) {
  const mapped = new MemoryStoreError('unsupported_database');
  const metadata = failures.get(error);
  if (metadata) failures.set(mapped, metadata);
  return mapped;
}
function label(sql) {
  if (/query_only|trusted_schema|busy_timeout/i.test(sql)) return 'reader_configuration';
  for (const name of ['journal_mode', 'application_id', 'user_version', 'schema_version', 'encoding']) {
    if (new RegExp('^PRAGMA\\s+' + name + '\\b', 'i').test(sql)) return name;
  }
  if (/^\s*(BEGIN|COMMIT|ROLLBACK)\b/i.test(sql)) return 'transaction';
  if (/sqlite_master|pragma_|EXPLAIN/i.test(sql)) return 'schema_metadata';
  if (/namespace_epochs|namespace_index_state|store_metadata|index_generations/i.test(sql)) return 'snapshot_metadata';
  return 'topic_metadata';
}

/** One WAL wait budget, including opening, cached statements and fences. */
export function createTopicSqlitePolicy({ diagnostics = false, now = () => performance.now(), state } = {}) {
  let until = -Infinity, checkAdmission, cleaning = false;
  return {
    admission(check, work) {
      const previous = checkAdmission;
      checkAdmission = check;
      try { return work(); } finally { checkAdmission = previous; }
    },
    cleanup(work) {
      const previous = cleaning;
      cleaning = true;
      try { return work(); } finally { cleaning = previous; }
    },
    start(deadlineAt) {
      // One absolute cutoff: reserve four normal 5ms quanta for cleanup/reply.
      // Worker startup already consumed the host's absolute request deadline.
      const cutoff = Math.min(deadlineAt, now() + TOPIC_WAL_WAIT_MS) - TOPIC_WAL_REPLY_RESERVE_MS;
      if(state)state().until=cutoff;else until=cutoff;
    },
    database(native, wal) {
      if (!wal && !diagnostics) return native;
      let installed = 0;
      function invoke(object, method, args, stage, statement) {
        if (wal && stage !== 'close') {
          const remaining = Math.max(0, Math.floor((state ? state()?.until ?? -Infinity : until) - now()));
          if (installed !== remaining) {
            try { native.exec('PRAGMA busy_timeout=' + remaining); }
            catch (error) { throw recordSqliteFailure(error, 'configure', 'reader_configuration'); }
            installed = remaining;
            // Configuration is a native call too. It can consume the opening
            // budget before the requested operation reaches native dispatch.
            if (!cleaning && stage !== 'rollback' && method !== 'return' && method !== Symbol.dispose) checkAdmission?.();
          }
        }
        try {
          const result = Reflect.apply(object[method], object, args);
          if (method !== 'iterate') return result;
          const wrapped = new Proxy(result, { get(iterator, key) {
            if (key === Symbol.iterator) return () => wrapped;
            const value = Reflect.get(iterator, key, iterator);
            if (typeof value === 'function' && ['next', 'return', 'throw'].includes(key)) return (...values) => invoke(iterator, key, values, 'execute', statement);
            return typeof value === 'function' ? value.bind(iterator) : value;
          } });
          return wrapped;
        } catch (error) { throw recordSqliteFailure(error, stage, statement); }
      }
      return new Proxy(native, { get(object, key) {
        if (key === 'constructor') return object.constructor;
        if (key === 'prepare') return sql => {
          const statement = label(sql), prepared = invoke(object, key, [sql], 'prepare', statement);
          return new Proxy(prepared, { get(target, name) {
            if (name === 'constructor') return target.constructor;
            const value = Reflect.get(target, name, target);
            return typeof value === 'function' ? (...args) => invoke(target, name, args, 'execute', statement) : value;
          } });
        };
        if (key === 'exec') return sql => {
          const verb = sql.trim().toLowerCase();
          const stage = ['begin', 'commit', 'rollback'].includes(verb) ? verb : 'configure';
          return invoke(object, key, [sql], stage, label(sql));
        };
        const value = Reflect.get(object, key, object);
        return typeof value === 'function' ? (...args) => invoke(object, key, args, 'close', 'connection') : value;
      } });
    },
  };
}

export function topicReadTransaction(db, work, isRetryableBusy) {
  db.exec('BEGIN');
  try {
    const value = work();
    db.exec('COMMIT');
    return value;
  } catch (error) {
    if (!isRetryableBusy || db.isTransaction) {
      try { db.exec('ROLLBACK'); }
      catch (rollbackError) {
        if (!isRetryableBusy) throw rollbackError;
        // ROLLBACK may already have completed. A failed cleanup must never
        // let a still-active transaction reach an async retry.
        if (db.isTransaction) {
          try {
            if (!isRetryableBusy(rollbackError)) throw rollbackError;
            db.exec('ROLLBACK');
          } catch (cleanupError) {
            db.close();
            throw cleanupError;
          }
        }
      }
    }
    throw error;
  }
}

/** Keep the DELETE retry to confirmed DELETE mode. Use a cancellable async backoff
 * within the same cutoff as WAL. Exhaustion reports the first native fault.
 * A read step can retry only before the overview generator advances. */
export function createTopicRetryPolicy({ diagnostics, isRetryableBusy, now = () => performance.now(), onRetry = () => {} }) {
  const budget = { until: -Infinity };
  const policy = createTopicSqlitePolicy({ diagnostics, now, state: () => budget }), modes = new WeakMap();
  let openingMode;
  const isDelete = db => modes.get(db) === 'DELETE';
  async function retry(work, canResume) {
    let firstBusy;
    while (true) {
      if (firstBusy && now() >= budget.until) throw firstBusy;
      try {
        const value = work();
        if (firstBusy) onRetry(null);
        return value;
      } catch (error) {
        if (!isRetryableBusy(error)) {
          if (firstBusy) onRetry(null);
          throw error;
        }
        if (!canResume()) throw firstBusy ?? error;
        if (now() + DELETE_RETRY_MS >= budget.until) throw firstBusy ?? error;
        if (!firstBusy) {
          firstBusy = error;
          onRetry(firstBusy);
        }
        await delay(DELETE_RETRY_MS);
      }
    }
  }
  return {
    ...policy,
    noteJournalMode(db, mode) { modes.set(db, mode); },
    database(native, wal) {
      const db = policy.database(native, wal);
      // The post-probe wrapper is reached only after the timeout reset succeeds.
      if (modes.has(native)) {
        openingMode = modes.get(native);
        modes.set(db, openingMode);
      }
      return db;
    },
    isDelete,
    retryRead(db, work, restore = () => true) {
      if (!isDelete(db)) return work();
      return retry(work, () => db.isOpen && !db.isTransaction && restore());
    },
    retryOpening(work) {
      return retry(() => { openingMode = undefined; return work(); }, () => openingMode === 'DELETE');
    },
  };
}

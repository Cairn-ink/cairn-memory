import { lstatSync } from 'node:fs';
import { performance } from 'node:perf_hooks';
import { MemoryStoreError } from './validation.mjs';

// Never inspect SQLite files through raw descriptors: closing one would release
// every POSIX record lock this process holds on the same inode (Workers included).
// Companion stats are hints only; SQLite is the authority on journal mode.
function companion(path, suffix) {
  try { lstatSync(path + suffix); return true; }
  catch (error) { if (error.code === 'ENOENT') return false; throw error; }
}
export function topicJournalMode(native, path, policy, { deferQueryErrors = false } = {}) {
  const rollback = () => companion(path, '-journal');
  const hintedWal = !rollback() && (companion(path, '-wal') || companion(path, '-shm'));
  let queryFailure;
  const query = wait => {
    const db = policy.database(native, wait);
    let row;
    try { row = db.prepare('PRAGMA journal_mode').get(); }
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

export const TOPIC_WAL_WAIT_MS = 100;
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

/** One request budget, including all opening, cached statements and fences.
 * Native waiting stays inside SQLite. No retry of a traversal or transaction;
 * a native BUSY keeps its original stage/code. */
export function createTopicSqlitePolicy({ diagnostics = false, now = () => performance.now() } = {}) {
  let until = -Infinity;
  return {
    start(deadlineAt) { until = Math.min(deadlineAt, now() + TOPIC_WAL_WAIT_MS); },
    database(native, wal) {
      if (!wal && !diagnostics) return native;
      let installed = 0;
      function invoke(object, method, args, stage, statement) {
        if (wal && stage !== 'close') {
          const remaining = Math.max(0, Math.floor(until - now()));
          if (installed !== remaining) {
            try { native.exec('PRAGMA busy_timeout=' + remaining); }
            catch (error) { throw recordSqliteFailure(error, 'configure', 'reader_configuration'); }
            installed = remaining;
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

import { openSync, readSync, closeSync, fstatSync, constants } from 'node:fs';
import { performance } from 'node:perf_hooks';
import { fail, MemoryStoreError } from './validation.mjs';

// Header format versions at offsets 18/19 are 2/2 for WAL, 1/1 for rollback.
// Read the main file without entering SQLite (a PRAGMA itself can need a lock).
export function topicJournalMode(path, expected) {
  const fd = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const stat = fstatSync(fd);
    if (!stat.isFile() || stat.dev !== expected.dev || stat.ino !== expected.ino) fail('unsafe_database_file');
    const header = Buffer.alloc(100);
    const size = readSync(fd, header, 0, header.length, 0);
    return size === 100 && header.subarray(0, 16).equals(Buffer.from('SQLite format 3\0')) &&
      header[18] === 2 && header[19] === 2 ? 'WAL' : 'DELETE';
  } finally { closeSync(fd); }
}

export const TOPIC_WAL_WAIT_MS = 100;
export const SQLITE_STAGES = Object.freeze(['open', 'configure', 'prepare', 'execute', 'begin', 'commit', 'rollback', 'close']);
export const SQLITE_STATEMENTS = Object.freeze(['connection', 'reader_configuration', 'application_id', 'user_version',
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
  for (const name of ['application_id', 'user_version', 'schema_version', 'encoding']) {
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

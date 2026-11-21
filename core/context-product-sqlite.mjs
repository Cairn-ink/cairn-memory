import { sqliteFileStat, probeRollbackJournal } from './sqlite-journal-probe.mjs';
import { dirname } from 'node:path';
import { createTopicSqlitePolicy, topicJournalMode } from './topic-reader-sqlite.mjs';

const unavailable = () => { throw Object.assign(Error('index_unavailable'), { code: 'index_unavailable', reason: 'storage_unavailable' }); };
const openingFailure = error => {
  if (error?.code === 'ERR_SQLITE_ERROR' && [8, 14].includes(error.errcode & 255)) unavailable();
  throw error;
};
const same = (a, b) => a.dev === b.dev && a.ino === b.ino;
const journalProbe = (path, observer) => probeRollbackJournal(path, { uncached: true, ...(observer ? { observe: observer.journalProbe } : {}) });
// The isolated nolock query refuses WAL with CANTOPEN, without creating SHM.
// This is only a routing hint: policy.open below must confirm WAL using SQLite.
const walHint = result => result.stage === 'query' && result.code === 14;

/** Default product canonical only. Keep the legacy DELETE admission (including
 * its error precedence and protected-journal BUSY) before considering WAL.
 * The Worker supplies the original pre-connection facade refusal.
 * The sidecar and explicit wal:true never use this adapter. */
export function detectProductCanonicalJournal(path, { sqlite, observer, legacyError, readHeader, expectedIdentity }) {
  const physicalMode = () => readHeader(path, observer, {
    main: sqliteFileStat(path), directory: sqliteFileStat(dirname(path)), expectedIdentity,
  });
  if (legacyError?.code !== 'index_unavailable') throw legacyError;
  try {
    // A refused DELETE core may have stray companions. Only the SQLite-free
    // header child may add work on that path; preserve the original refusal.
    if (physicalMode() !== 'wal' || !walHint(journalProbe(path, observer))) throw legacyError;
  } catch { throw legacyError; }
  const mode = 'WAL';
  let header, journal, refused = false;
  function assertWalCompanion() {
    try { sqliteFileStat(path + '-journal'); }
    catch (error) { if (error.code === 'ENOENT') return; }
    unavailable();
  }
  function assertMode(db) {
    if (refused) unavailable();
    // A rollback journal never belongs to a WAL canonical.
    assertWalCompanion();
    let current;
    try {
      // journal_mode alone can report the pager's cached mode. A header cookie
      // read first takes a fresh SQLite read transaction and refreshes page 1.
      // Never gate this on timestamps, companion existence or schema equality.
      header ??= db.prepare('PRAGMA schema_version');
      header.get();
      journal ??= db.prepare('PRAGMA journal_mode');
      current = journal.get().journal_mode.toUpperCase();
    } catch (error) {
      // Only the existing SQLite-free header child may disambiguate a
      // failed metadata guard. It never runs on the normal operation path.
      let physical;
      try { physical = physicalMode(); }
      catch { throw error; }
      current = physical === 'delete' ? 'DELETE' : physical === 'wal' ? 'WAL' : null;
      if (current === null || current === mode) {
        // Retain the original native BUSY/error instead of retrying work.
        throw error;
      }
    }
    if (current !== mode) { refused = true; unavailable(); }
  }
  // Do not tighten DELETE metadata or replace its zero-wait connection policy.
  // A WAL hint cannot admit a DELETE header with stray WAL/SHM companions.
  const canonicalSqlite = { ...sqlite, open(native, file, checkAdmission) {
    assertWalCompanion();
    const opened = sqlite.open(native, file, checkAdmission);
    if (opened.mode !== 'WAL') { opened.db.close(); unavailable(); }
    return opened;
  } };
  return { sqlite: canonicalSqlite, assertMode };
}

function protectedEntry(path, directory = false, optional = false) {
  let s;
  try { s = sqliteFileStat(path); } catch (e) { if (optional && e.code === 'ENOENT') return null; unavailable(); }
  if (s.isSymbolicLink() || !(directory ? s.isDirectory() : s.isFile()) ||
      (s.mode & 0o777n) !== (directory ? 0o700n : 0o600n) ||
      typeof process.getuid !== 'function' || s.uid !== BigInt(process.getuid()) || !directory && s.nlink !== 1n) unavailable();
  return s;
}

/** Metadata only: never acquire a raw database/companion descriptor. SQLite may
 * create/remove companions. Journal identities span a snapshot or statement,
 * not successive released snapshots; WAL/SHM identities span the connection.
 * The owner-only directory is the deployment's exclusion boundary. Concurrent
 * external mode changes and uncoordinated file replacement are unsupported. */
export function productSqliteFiles(path) {
  const directory = protectedEntry(dirname(path), true), file = protectedEntry(path);
  const companions = new Map();
  function check({ afterProbe = false, betweenSnapshots = false } = {}) {
    if (!same(directory, protectedEntry(dirname(path), true)) || !same(file, protectedEntry(path))) unavailable();
    for (const suffix of ['-wal', '-shm', '-journal']) {
      const current = protectedEntry(path + suffix, false, true), previous = companions.get(suffix);
      // A protected DELETE journal may be recreated between snapshots even
      // when no observation catches its absence. Never adopt within a native
      // statement or pinned transaction; all protection checks still run.
      // Journal presence is only a detection hint. The caller's canonical
      // read-only connection cannot perform hot-journal recovery.
      // A last writer can remove companions during the opening probe;
      // SQLite may recreate them before our next lstat. Validate and adopt
      // those new identities only at this explicit opening boundary.
      if (current && previous && !same(previous, current) && !afterProbe && !(suffix === '-journal' && betweenSnapshots)) unavailable();
      if (current) companions.set(suffix, current); else companions.delete(suffix);
    }
  }
  check();
  return check;
}

/** One operation clock, shared by every product connection. Reuse the topic
 * policy's TOPIC_WAL_WAIT_MS / TOPIC_WAL_REPLY_RESERVE_MS pair without a copy.
 * start() is called only at Worker operation admission, never at connection or
 * transaction admission. The observer remains immediately around native calls. */
export function createProductSqlitePolicy({ observer, now = () => Number(process.hrtime.bigint()) / 1e6, state } = {}) {
  const policy = createTopicSqlitePolicy({ now, state });
  return {
    start: deadlineAt => policy.start(deadlineAt),
    admission: (check, work) => policy.admission(check, work),
    cleanup: work => policy.cleanup(work),
    files: productSqliteFiles,
    openingFailure,
    initializationFailure(error) {
      // The staged file is private to initialization. These outcomes mean the
      // deployment cannot create/durably publish its required companions.
      if(error?.code==='ERR_SQLITE_ERROR' && [3,8,10,13,14].includes(error.errcode & 255) ||
        ['EACCES','EPERM','EROFS','ENOSPC','ENOTSUP','EOPNOTSUPP'].includes(error?.code))unavailable();
      openingFailure(error);
    },
    open(native, path, checkAdmission) {
      const observed = observer ? observer.database(native) : native;
      // Configuration cannot take a storage lock. The mode query is the first
      // storage statement, including on brand-new/checkpointed WAL databases.
      let mode, check;
      try {
        check = productSqliteFiles(path);
        checkAdmission?.();observed.exec('PRAGMA busy_timeout=0');
        mode = topicJournalMode(observed, path, policy, {checkAdmission});
        check({ afterProbe: true });
        if (!['DELETE', 'WAL'].includes(mode)) unavailable();
      } catch (error) {
        try { observed.close(); } catch { /* Keep the first failure and native telemetry. */ }
        openingFailure(error);
      }
      const db = policy.database(observed, mode === 'WAL');
      let activeStatements = 0;
      const activeIterators = new Set();
      // Check before and after prepare/step/transaction. Wrapping outside
      // the wait policy also covers cached statements and iterator disposal.
      function call(object, key, args, complete = value => value, disposing = false) {
        // Rollback and query_only restoration must release the pinned native
        // connection even after replacement/refusal. They read no storage.
        if (key === 'exec' && /^\s*(?:ROLLBACK\s*$|PRAGMA query_only=)/i.test(args[0])) return Reflect.apply(object[key], object, args);
        // isTransaction only reports explicit transactions. An unfinished
        // iterator can retain an implicit read snapshot while it is false.
        if (!disposing) check({betweenSnapshots: mode === 'DELETE' && !observed.isTransaction &&
          activeStatements === 0 && activeIterators.size === 0});
        let result;
        activeStatements++;
        try { result = complete(Reflect.apply(object[key], object, args)); }
        catch (error) {
          // Companion races cannot overwrite a committed native BUSY outcome.
          try { check(); } catch { /* Retain the original native outcome. */ }
          openingFailure(error);
        } finally { activeStatements--; }
        check();
        return result;
      }
      function statement(target) {
        return new Proxy(target, { get(object, key) {
          if (key === 'constructor') return object.constructor;
          const value = Reflect.get(object, key, object);
          if (typeof value !== 'function') return value;
          return (...args) => {
            return call(object, key, args, value => key === 'iterate' ? iterator(value) : value);
          };
        } });
      }
      function iterator(target) {
        activeIterators.add(target);
        const wrapped = new Proxy(target, { get(object, key) {
          if (key === Symbol.iterator) return () => wrapped;
          if (key === 'constructor') return object.constructor;
          const value = Reflect.get(object, key, object);
          if (typeof value !== 'function') return value;
          const disposing = key === 'return' || key === Symbol.dispose;
          // Iterator helpers must consume the guarded receiver, so their own
          // next()/return() calls cannot bypass snapshot tracking or checks.
          if (!['next', 'return', 'throw'].includes(key) && !disposing) {
            const helper = Reflect.get(Object.getPrototypeOf(object), key, wrapped);
            return (typeof helper === 'function' ? helper : value).bind(wrapped);
          }
          return (...args) => call(object, key, args, result => {
            if (disposing || result?.done === true) activeIterators.delete(object);
            return result;
          }, disposing);
        } });
        return wrapped;
      }
      return { mode, db: new Proxy(db, { get(object, key) {
        if (key === 'constructor') return object.constructor;
        const value = Reflect.get(object, key, object);
        if (typeof value !== 'function') return value;
        // Always dispose native connections even if a file was replaced.
        if (key === 'close' || key === Symbol.dispose) return (...args) => {
          const result = Reflect.apply(value, object, args);
          activeIterators.clear();
          return result;
        };
        return (...args) => {
          const result = call(object, key, args);
          return key === 'prepare' ? statement(result) : result;
        };
      } }) };
    },
  };
}

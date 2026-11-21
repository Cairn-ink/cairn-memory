import { DatabaseSync, StatementSync } from 'node:sqlite';
import { pathToFileURL } from 'node:url';
import { openDatabase } from '../../database.mjs';

export const isWrite = sql => /^\s*(?:CREATE|ALTER|DROP|INSERT|UPDATE|DELETE|REPLACE|REINDEX|VACUUM)\b/i.test(sql) ||
  /^\s*PRAGMA\s+(?:user_version|application_id)\s*=/i.test(sql);

// Observe executed SQL, including prepared statements, on each native connection.
// Reference-schema connections are deliberately excluded by the caller.
export function traceOpen(work, { pauseCommit = false } = {}) {
  const rows = [], owners = new WeakMap();
  const exec = DatabaseSync.prototype.exec, prepare = DatabaseSync.prototype.prepare;
  const methods = new Map(['get', 'all', 'run', 'iterate'].map(key => [key, StatementSync.prototype[key]]));
  const modes = new WeakMap();
  function record(db, sql) {
    if (/^BEGIN\b/.test(sql)) modes.set(db, sql);
    rows.push({ db, sql, mode: modes.get(db), transaction: db.isTransaction });
    if (pauseCommit && sql === 'COMMIT' && modes.get(db) === 'BEGIN IMMEDIATE') {
      // Both children are released by IPC together. Keep the winning writer in
      // its transaction long enough for the other process to contend for it.
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 300);
    }
  }
  DatabaseSync.prototype.exec = function(sql) { record(this, sql); return exec.call(this, sql); };
  DatabaseSync.prototype.prepare = function(sql) {
    const statement = prepare.call(this, sql); owners.set(statement, { db: this, sql }); return statement;
  };
  for (const [key, method] of methods) StatementSync.prototype[key] = function(...args) {
    const owner = owners.get(this); if (owner) record(owner.db, owner.sql);
    return method.apply(this, args);
  };
  try {
    const db = work();
    return { db, trace: rows.filter(row => row.db === db).map(({ db, ...row }) => row) };
  } finally {
    DatabaseSync.prototype.exec = exec; DatabaseSync.prototype.prepare = prepare;
    for (const [key, method] of methods) StatementSync.prototype[key] = method;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const [role, path] = process.argv.slice(2);
  if (role === 'migrate') {
    process.once('message', () => {
      try {
        const { db, trace } = traceOpen(() => openDatabase(path, { currentDependencies: true }), { pauseCommit: true });
        const version = db.prepare('PRAGMA user_version').get().user_version;
        db.close(); process.send({ version, trace }); process.disconnect();
      } catch (error) { console.error(error); process.exitCode = 1; process.disconnect(); }
    });
    process.send('ready');
  } else {
    const db = new DatabaseSync(path);
    let timer, closed = false;
    function release() {
      if (closed) return;
      closed = true; clearTimeout(timer);
      try { if (db.isTransaction) db.exec('ROLLBACK'); } finally { db.close(); }
      if (process.connected) process.disconnect();
    }
    process.on('disconnect', release);
    process.on('message', message => { if (message === 'release') release(); });
    db.exec('PRAGMA journal_mode=DELETE');
    db.exec(role === 'exclusive' ? 'BEGIN EXCLUSIVE' : 'BEGIN IMMEDIATE');
    // RESERVED is held for a full eight seconds even when the opener returns.
    timer = setTimeout(release, role === 'reserved' ? 8000 : 1500);
    process.send('ready');
  }
}

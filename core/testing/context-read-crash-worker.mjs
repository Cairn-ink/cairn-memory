// Real-process R09 fault injector, never imported by production modules.
import { DatabaseSync } from 'node:sqlite';
import { lstatSync, writeFileSync } from 'node:fs';
import { openContextReadSidecar } from '../context-read-sidecar.mjs';
const [path, serialized, kind, point, markerPath] = process.argv.slice(2), input = JSON.parse(serialized);
const db = new DatabaseSync(path, { readOnly: true });
const originalExec = DatabaseSync.prototype.exec, originalPrepare = DatabaseSync.prototype.prepare;
let pending, stopped = false;
function checkpoint(connection) {
  stopped = true;
  const row = originalPrepare.call(connection, 'SELECT checkpoint,published FROM generations').get();
  let journalBytes = 0;
  try { journalBytes = lstatSync(path + '.context-read-v1.sqlite-journal').size; } catch (error) { if (error.code !== 'ENOENT') throw error; }
  writeFileSync(markerPath, JSON.stringify({ kind, point, ...row, journalBytes }), { mode: 0o600 });
  // A kernel-stopped child cannot run past the checkpoint under host load.
  // The parent owns the bounded watchdog and always kills/joins this process.
  process.kill(process.pid, 'SIGSTOP');
  throw Error('checkpoint_worker_unexpectedly_resumed');
}
DatabaseSync.prototype.prepare = function(sql) {
  const statement = originalPrepare.call(this, sql), connection = this;
  const matched = /UPDATE generations SET phase=/.test(sql);
  if (!matched) return statement;
  return new Proxy(statement, { get(target, property) {
    const value = Reflect.get(target, property);
    if (property === 'run') return (...args) => { const result = value.apply(target, args); if (Number(args[2]) === (kind === 'publication' ? 1 : 0)) pending = connection; return result; };
    return typeof value === 'function' ? value.bind(target) : value;
  } });
};
DatabaseSync.prototype.exec = function(sql) {
  if (sql === 'BEGIN IMMEDIATE') originalExec.call(this, 'PRAGMA cache_size=5; PRAGMA synchronous=FULL;');
  const gate = sql === 'COMMIT' && pending === this && !stopped;
  if (gate && point === 'before') checkpoint(this);
  const result = originalExec.call(this, sql);
  if (gate && point === 'after') checkpoint(this);
  return result;
};
try {
  const index = openContextReadSidecar({ path, db, batchSize: 2 });
  for (let attempt = 0; attempt < 100; attempt++) if (index.reconcile(input).status === 'complete') break;
  throw Error('checkpoint_not_reached');
} finally { db.close(); }

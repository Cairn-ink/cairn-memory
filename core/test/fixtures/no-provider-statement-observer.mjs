import { DatabaseSync, StatementSync } from 'node:sqlite';

// Shared across the parent, reader Workers and semantic Worker. Count execution,
// including cached statements, rather than preparation. No database file I/O.
export function observeStatements(buffer) {
  const counts = new Int32Array(buffer);
  const record = sql => {
    if (!Atomics.load(counts, 0)) return;
    Atomics.add(counts, 1, 1);
    if (/\b(?:FROM|JOIN)\s+episode_controls\b/i.test(sql)) Atomics.add(counts, 2, 1);
    if (/^\s*PRAGMA\s+data_version\b/i.test(sql)) Atomics.add(counts, 3, 1);
  };
  const exec = DatabaseSync.prototype.exec;
  DatabaseSync.prototype.exec = function(sql) {
    for (const part of sql.split(';').filter(s => s.trim())) record(part);
    return Reflect.apply(exec, this, [sql]);
  };
  const originals = new Map();
  for (const key of ['get', 'all', 'iterate', 'run']) {
    const original = StatementSync.prototype[key]; originals.set(key, original);
    StatementSync.prototype[key] = function(...args) {
      record(this.sourceSQL);
      return Reflect.apply(original, this, args);
    };
  }
  return () => {
    DatabaseSync.prototype.exec = exec;
    for (const [key, original] of originals) StatementSync.prototype[key] = original;
  };
}

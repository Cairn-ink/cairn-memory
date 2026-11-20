// Test-only synchronous fault hook, installed in a supervised candidate before
// runCandidate. No production import, argv, environment option or package entry.
import { DatabaseSync } from 'node:sqlite';
export function installDaemonMidWrite({ send, afterCommit = false, pauseMs } = {}) {
  const pauseAfterCommit = afterCommit;
  const prepare = DatabaseSync.prototype.prepare, exec = DatabaseSync.prototype.exec;
  const canonical = new Set(), writes = new WeakMap();
  let armed = false, selected;
  const barrier = db => {
    armed = false;
    if (db.isTransaction) {
      // Read unrelated B-tree roots to evict the first statement's dirty pages
      // through SQLite's own small cache. This adds no second content write and
      // makes the rollback journal hot rather than leaving all changes in RAM.
      const tables = Reflect.apply(prepare, db, ["SELECT name FROM sqlite_schema WHERE type='table' ORDER BY rootpage LIMIT 64"]).all();
      for (const { name } of tables) if (/^[a-z_][a-z0-9_]*$/i.test(name))
        Reflect.apply(prepare, db, ['SELECT count(*) FROM "' + name + '"']).get();
    }
    const mode = Reflect.apply(prepare, db, ['PRAGMA journal_mode']).get().journal_mode;
    send({ kind: 'mid-write', point: pauseAfterCommit ? 'after_commit' : 'first_statement', journal_mode: mode, in_transaction: db.isTransaction });
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, pauseMs);
  };
  DatabaseSync.prototype.prepare = function(sql) {
    if (/\bFROM\s+store_metadata\b/i.test(sql)) canonical.add(this);
    const statement = Reflect.apply(prepare, this, [sql]);
    if (/^\s*(INSERT|UPDATE|DELETE|REPLACE)\b/i.test(sql)) {
      const run = statement.run, db = this;
      statement.run = function(...args) {
        const result = Reflect.apply(run, this, args);
        if (armed && canonical.has(db) && db.isTransaction) {
          const n = (writes.get(db) ?? 0) + 1; writes.set(db, n);
          if (n === 1) { selected = db; if (!pauseAfterCommit) barrier(db); }
        }
        return result;
      };
    }
    return statement;
  };
  DatabaseSync.prototype.exec = function(sql) {
    const result = Reflect.apply(exec, this, [sql]);
    if (/^\s*BEGIN\s+IMMEDIATE\b/i.test(sql)) writes.set(this, 0);
    if (armed && pauseAfterCommit && selected === this && /^\s*COMMIT\s*;?\s*$/i.test(sql)) barrier(this);
    return result;
  };
  return { arm() {
    // Make an uncommitted page spill possible through SQLite itself. No raw DB
    // or journal fd is opened by the hook or its supervising test process.
    for (const db of canonical) if (db.isOpen) Reflect.apply(exec, db, ['PRAGMA cache_size=1; PRAGMA cache_spill=1']);
    armed = true; selected = undefined;
  } };
}

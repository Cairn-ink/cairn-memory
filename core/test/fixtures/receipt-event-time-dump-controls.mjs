import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { createTestWorkspace } from '../../../tools/testing/workspace.mjs';

const dump = fileURLToPath(new URL('./receipt-event-time-dump.mjs', import.meta.url));
function child(args) {
  const result = spawnSync(process.execPath, args, { encoding: 'utf8', timeout: 30000 });
  assert.equal(result.error, undefined);
  assert.equal(result.signal, null);
  assert.equal(result.status, 0, result.stderr);
  return result.stdout.trim();
}
const databaseHash = path => child([dump, path]);
const edit = (path, sql) => child(['--input-type=module', '-e', `
  import { DatabaseSync } from 'node:sqlite';
  const db = new DatabaseSync(process.argv[1]);
  try { db.exec(process.argv[2]); } finally { db.close(); }
`, path, sql]);

export function mutationControls(t, scratch, baseline, mode) {
  // The worker's first case is the successful 18:ordinary untimed equivalent.
  // All connections have closed. Only child processes copy/open SQLite files,
  // and each mutation starts from a fresh scratch copy, never a frozen input.
  const source = join(scratch, '1.sqlite');
  assert.equal(databaseHash(source), baseline.databaseHash);
  const mutations = {
    rowid: 'UPDATE receipts SET rowid = rowid + 1000',
    rowValue: 'UPDATE namespace_epochs SET epoch = epoch + 1',
    ...(mode === 'event' ? { storedTime: `UPDATE receipts SET occurred_at = '1901-02-03T04:05:06.789Z'` } : {}),
  };
  for (const [name, sql] of Object.entries(mutations)) {
    const path = join(scratch, 'mutation-' + name + '.sqlite');
    child(['--input-type=module', '-e', `
      import { copyFileSync } from 'node:fs';
      import { DatabaseSync } from 'node:sqlite';
      copyFileSync(process.argv[1], process.argv[2]);
      const db = new DatabaseSync(process.argv[2]);
      try {
        const rows = () => JSON.stringify(db.prepare('SELECT * FROM receipts ORDER BY receipt_key,memory_id').all());
        const before = rows();
        const trigger = db.prepare("SELECT sql FROM sqlite_master WHERE name='safety_receipt_identity'").get()?.sql;
        db.exec('BEGIN');
        if (trigger) db.exec('DROP TRIGGER safety_receipt_identity');
        db.exec(process.argv[3]);
        if (db.prepare('SELECT changes() n').get().n < 1) throw Error('mutation changed no rows');
        if (trigger) db.exec(trigger);
        db.exec('COMMIT');
        if (process.argv[4] === 'rowid' && before !== rows()) throw Error('rowid control changed named columns');
      } finally { db.close(); }
    `, source, path, sql, name]);
    const mutated = { ...baseline, databaseHash: databaseHash(path) };
    assert.notEqual(mutated.databaseHash, baseline.databaseHash, name + ' must change the dump hash');
    assert.throws(() => assert.deepEqual(mutated, baseline), { code: 'ERR_ASSERTION' },
      name + ' must fail the complete-outcome comparison');
    assert.equal(databaseHash(source), baseline.databaseHash, 'source remains unchanged');
    t.diagnostic(mode + ' ' + name + ': hash changed; complete-outcome comparison rejected');
  }
}

export function dumpShapeControl(t) {
  const f = createTestWorkspace(t, { prefix: 'receipt-dump-shape-' });
  const path = join(f.path, 'shape.sqlite'), reverse = join(f.path, 'reverse.sqlite');
  const ddl = `
    CREATE TABLE aliases(rowid INTEGER PRIMARY KEY, value TEXT);
    CREATE TABLE shadowed(rowid TEXT, _rowid_ TEXT, value BLOB);
    CREATE TABLE keyed(key TEXT PRIMARY KEY, value REAL) WITHOUT ROWID;
  `;
  const inserts = [
    "INSERT INTO aliases VALUES(9, 'nine')", "INSERT INTO aliases VALUES(2, 'two')",
    "INSERT INTO shadowed(oid,rowid,_rowid_,value) VALUES(9,'r','u',X'00ff')",
    "INSERT INTO shadowed(oid,rowid,_rowid_,value) VALUES(2,'s','v',X'ff00')",
    "INSERT INTO keyed VALUES('z',1.5)", "INSERT INTO keyed VALUES('a',2.5)",
  ];
  edit(path, ddl + inserts.join(';') + ';');
  edit(reverse, ddl + inserts.toReversed().join(';') + ';');
  const baseline = databaseHash(path);
  assert.equal(databaseHash(reverse), baseline, 'insertion order does not affect canonical ordering');
  for (const sql of [
    'UPDATE aliases SET rowid = rowid + 1000',
    'UPDATE shadowed SET oid = oid + 1000',
    'UPDATE keyed SET value = value + 1',
  ]) {
    edit(path, sql);
    assert.notEqual(databaseHash(path), baseline, sql);
    // Restore a pristine database so each assertion isolates one table.
    edit(path, 'DROP TABLE aliases; DROP TABLE shadowed; DROP TABLE keyed;' + ddl + inserts.join(';') + ';');
    assert.equal(databaseHash(path), baseline);
  }
}

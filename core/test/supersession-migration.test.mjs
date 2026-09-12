import assert from 'node:assert/strict';
import { closeSync, mkdtempSync, openSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import test from 'node:test';
import { openMemoryCore } from '../contract.mjs';

// Fixture provenance: public commit 978ed2c997c153f0733b21229f588fe1e969a318,
// unmodified core, Node 22.16.0, fresh temporary SQLite database (schema v7).
// Generation: openMemoryCore with countTokens:()=>1; admit Synthetic Friday,
// Synthetic Monday and Synthetic third, each with its own same-text user receipt;
// file the first list result under Synthetic topic; claim event pending; publish
// rebuildIndex(limit:500), then stage rebuildIndex(limit:1). Save the signed
// staged cursor, list(limit:1) cursor and its next page. Export sqlite_master SQL
// and every table row ordered by rowid as JSON. UUIDs/timestamps are generated;
// all prose and identities are synthetic. No external checkout is needed to run.
const saved = JSON.parse(readFileSync(new URL('./supersession-v7-fixture.json', import.meta.url), 'utf8'));
const ok = (r) => { assert.equal(r.ok, true, JSON.stringify(r)); return r.value; };
function fixture(t) {
  const path = join(mkdtempSync(join(tmpdir(), 'cairn-supersession-migration-')), 'memory.sqlite');
  closeSync(openSync(path, 'ax', 0o600)); const db = new DatabaseSync(path); t.after(() => db.close());
  for (const type of ['table', 'index', 'view']) for (const row of saved.schema.filter((r) => r.type === type)) db.exec(row.sql);
  db.exec('BEGIN; PRAGMA defer_foreign_keys=ON');
  for (const { name, rows } of saved.tables) for (const row of rows) {
    const columns = Object.keys(row);
    db.prepare(`INSERT INTO "${name}" (${columns.map((c) => `"${c}"`).join(',')}) VALUES (${columns.map(() => '?').join(',')})`).run(...Object.values(row));
  }
  db.exec('COMMIT');
  assert.deepEqual(db.prepare('PRAGMA foreign_key_check').all(), []);
  for (const row of saved.schema.filter((r) => r.type === 'trigger')) db.exec(row.sql);
  db.exec('PRAGMA application_id=1128352082; PRAGMA user_version=7');
  return { path, db };
}
function assertPreserved(db) {
  for (const { name, rows } of saved.tables) {
    const actual = db.prepare(`SELECT * FROM "${name}" ORDER BY rowid`).all().map((row) => {
      if (name === 'memories') { assert.equal(row.currentness, 'current'); const { currentness, ...old } = row; return old; }
      return { ...row };
    });
    assert.deepEqual(actual, rows, name);
  }
}

test('B05 v7→v9 preserves all old values, published/staged generations and signed cursor continuation', (t) => {
  const { path, db } = fixture(t); const core = openMemoryCore({ path }); t.after(() => core.close());
  assert.equal(db.prepare('PRAGMA user_version').get().user_version, 9); assertPreserved(db);
  assert.deepEqual(ok(core.list({ namespace: saved.namespace, limit: 1, cursor: saved.cursor })), saved.next);
  const next = ok(core.rebuildIndex(saved.rebuild));
  let cursor = next.nextCursor;
  while (cursor) cursor = ok(core.rebuildIndex({ ...saved.rebuild, cursor })).nextCursor;
  assert.equal(db.prepare('SELECT count(*) n FROM memory_supersessions').get().n, 0);
  assert.equal(ok(core.list({ namespace: saved.namespace })).memories.length, 3);
});

test('B05 late v7 migration DDL collision preserves original schema/data and permits clean retry', (t) => {
  const { path, db } = fixture(t);
  db.exec("CREATE TABLE memory_supersessions (preserve_me TEXT); INSERT INTO memory_supersessions VALUES ('synthetic survivor')");
  const schema = db.prepare('SELECT * FROM sqlite_master ORDER BY name').all();
  assert.throws(() => openMemoryCore({ path }));
  assert.equal(db.prepare('PRAGMA user_version').get().user_version, 7);
  assert.deepEqual(db.prepare('SELECT * FROM sqlite_master ORDER BY name').all(), schema);
  for (const { name, rows } of saved.tables) assert.deepEqual(db.prepare(`SELECT * FROM "${name}" ORDER BY rowid`).all().map((r) => ({ ...r })), rows);
  assert.equal(db.prepare('SELECT preserve_me FROM memory_supersessions').get().preserve_me, 'synthetic survivor');
  db.exec('DROP TABLE memory_supersessions'); const core = openMemoryCore({ path }); t.after(() => core.close());
  assert.equal(db.prepare('PRAGMA user_version').get().user_version, 9); assertPreserved(db);
});

test('B05 competing writer prevents upgrade without changing v7 schema, then retry succeeds', (t) => {
  const { path, db } = fixture(t); const schema = db.prepare('SELECT * FROM sqlite_master ORDER BY name').all();
  db.exec('BEGIN IMMEDIATE');
  try {
    assert.throws(() => openMemoryCore({ path }));
    assert.equal(db.prepare('PRAGMA user_version').get().user_version, 7);
    assert.deepEqual(db.prepare('SELECT * FROM sqlite_master ORDER BY name').all(), schema);
  } finally { db.exec('ROLLBACK'); }
  const core = openMemoryCore({ path }); t.after(() => core.close()); assertPreserved(db);
});

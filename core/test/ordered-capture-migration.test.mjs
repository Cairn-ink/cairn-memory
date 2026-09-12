import assert from 'node:assert/strict';
import { closeSync, mkdtempSync, openSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import test from 'node:test';
import { openMemoryCore } from '../contract.mjs';

// Generated with Node22.16 from unmodified public core at
// 58e55a40045dd82e566c7f5d2d922967ee5ffa3c in a fresh synthetic SQLite file.
// Admit Synthetic Friday/Monday/third with same-text receipts, supersede Friday
// with existing Monday plus a new replacement receipt, complete an empty claim,
// publish rebuild(limit500), stage rebuild(limit1), save list(limit1) cursor/next
// page and history. Export sqlite_master SQL and all table rows ordered by rowid.
// UUIDs/timestamps are generated; all identities and content are synthetic.
const saved = JSON.parse(readFileSync(new URL('./ordered-capture-v8-fixture.json', import.meta.url), 'utf8'));
const ok = (r) => { assert.equal(r.ok, true, JSON.stringify(r)); return r.value; };
function fixture(t) {
  const path = join(mkdtempSync(join(tmpdir(), 'cairn-ordered-migration-')), 'memory.sqlite');
  closeSync(openSync(path, 'ax', 0o600)); const db = new DatabaseSync(path); t.after(() => db.close());
  for (const type of ['table', 'index', 'view']) for (const row of saved.schema.filter((r) => r.type === type)) db.exec(row.sql);
  db.exec('BEGIN; PRAGMA defer_foreign_keys=ON');
  for (const { name, rows } of saved.tables) for (const row of rows) {
    const columns = Object.keys(row);
    db.prepare(`INSERT INTO "${name}" (${columns.map((c) => `"${c}"`).join(',')}) VALUES (${columns.map(() => '?').join(',')})`).run(...Object.values(row));
  }
  db.exec('COMMIT'); assert.deepEqual(db.prepare('PRAGMA foreign_key_check').all(), []);
  for (const row of saved.schema.filter((r) => r.type === 'trigger')) db.exec(row.sql);
  db.exec('PRAGMA application_id=1128352082; PRAGMA user_version=8');
  return { path, db };
}
function preserved(db) {
  for (const { name, rows } of saved.tables)
    assert.deepEqual(db.prepare(`SELECT * FROM "${name}" ORDER BY rowid`).all().map((row) => ({ ...row })), rows, name);
}

test('O2 v8→v9 preserves every old value, history, replay, signed cursors and staged rebuild; old receipts stay unordered', (t) => {
  const { path, db } = fixture(t); const core = openMemoryCore({ path }); t.after(() => core.close());
  assert.equal(db.prepare('PRAGMA user_version').get().user_version, 9); preserved(db);
  for (const table of ['capture_streams', 'capture_events', 'receipt_causality'])
    assert.equal(db.prepare(`SELECT count(*) n FROM ${table}`).get().n, 0);
  assert.deepEqual(ok(core.get({ namespace: saved.namespace, memoryId: saved.history.memory.id })), saved.history);
  assert.deepEqual(ok(core.list({ namespace: saved.namespace, limit: 1, cursor: saved.cursor })), saved.next);
  assert.deepEqual(ok(core.claimAdmission({ ...saved.key, leaseMs: 1000 })), { duplicate: true, memoryIds: [], suppressedCount: 0 });
  let cursor = saved.rebuild.cursor;
  do { cursor = ok(core.rebuildIndex({ ...saved.rebuild, cursor })).nextCursor; } while (cursor);
});

test('O2 migration collision leaves v8 schema and data unchanged and permits a clean retry', (t) => {
  const { path, db } = fixture(t);
  db.exec("CREATE TABLE capture_streams(preserve_me TEXT); INSERT INTO capture_streams VALUES ('synthetic survivor')");
  const schema = db.prepare('SELECT * FROM sqlite_master ORDER BY name').all();
  assert.throws(() => openMemoryCore({ path })); assert.equal(db.prepare('PRAGMA user_version').get().user_version, 8);
  assert.deepEqual(db.prepare('SELECT * FROM sqlite_master ORDER BY name').all(), schema); preserved(db);
  assert.equal(db.prepare('SELECT preserve_me FROM capture_streams').get().preserve_me, 'synthetic survivor');
  db.exec('DROP TABLE capture_streams'); const core = openMemoryCore({ path }); t.after(() => core.close());
  assert.equal(db.prepare('PRAGMA user_version').get().user_version, 9); preserved(db);
});

test('O2 competing writer prevents upgrade without touching v8 state', (t) => {
  const { path, db } = fixture(t); const schema = db.prepare('SELECT * FROM sqlite_master ORDER BY name').all();
  db.exec('BEGIN IMMEDIATE');
  try {
    assert.throws(() => openMemoryCore({ path })); assert.equal(db.prepare('PRAGMA user_version').get().user_version, 8);
    assert.deepEqual(db.prepare('SELECT * FROM sqlite_master ORDER BY name').all(), schema); preserved(db);
  } finally { db.exec('ROLLBACK'); }
  const core = openMemoryCore({ path }); t.after(() => core.close());
  assert.equal(db.prepare('PRAGMA user_version').get().user_version, 9); preserved(db);
});

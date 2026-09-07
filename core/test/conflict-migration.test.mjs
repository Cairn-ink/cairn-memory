import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { closeSync, mkdtempSync, openSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import test from 'node:test';
import { openMemoryCore } from '../contract.mjs';

const namespace = { ownerId: 'conflict-upgrade', scope: 'personal', projectId: null };
const timestamp = '2025-01-01T00:00:00.000Z';
const tables = ['memories', 'receipts', 'suppressed', 'namespace_epochs', 'store_metadata',
  'mocs', 'moc_memory_refs', 'moc_edges', 'moc_title_sources', 'admission_claims'];
const snapshot = (db) => tables.map((table) => db.prepare(`SELECT * FROM ${table} ORDER BY rowid`).all());
function fixture(t) {
  const path = join(mkdtempSync(join(tmpdir(), 'cairn-conflict-v5-')), 'memory.sqlite');
  closeSync(openSync(path, 'ax', 0o600));
  const db = new DatabaseSync(path); t.after(() => db.close());
  db.exec(readFileSync(new URL('../testing/conflict-schema-v5.sql', import.meta.url), 'utf8'));
  db.exec(`INSERT INTO store_metadata VALUES (1,'synthetic-store','${'ab'.repeat(32)}');
    INSERT INTO namespace_epochs VALUES ('conflict-upgrade','personal','',17);
    INSERT INTO suppressed VALUES ('conflict-upgrade','personal','','${'c'.repeat(64)}');`);
  for (const id of ['a', 'b']) {
    db.prepare(`INSERT INTO memories VALUES (?,'conflict-upgrade','personal','',?,?,'fact','explicit',1,3,0,?,?,'filed')`)
      .run(id, id, `Synthetic memory ${id}`, timestamp, timestamp);
    db.prepare(`INSERT INTO receipts VALUES (?,?,?,'synthetic','session',?,'user',?,?)`)
      .run(`receipt-${id}`, id, id, id, `Synthetic evidence ${id}`, timestamp);
  }
  db.prepare(`INSERT INTO mocs VALUES ('moc','conflict-upgrade','personal','',1,'Topic','topic',2,?,?)`).run(timestamp, timestamp);
  db.prepare(`INSERT INTO mocs VALUES ('parent','conflict-upgrade','personal','',2,'Parent','parent',1,?,?)`).run(timestamp, timestamp);
  db.exec(`INSERT INTO moc_memory_refs VALUES ('moc',2,'a',3);
    INSERT INTO moc_title_sources VALUES ('moc','a',3);
    INSERT INTO moc_title_sources VALUES ('parent','a',3);
    INSERT INTO moc_edges VALUES ('parent',1,'moc',2);
    INSERT INTO admission_claims VALUES ('conflict-upgrade','personal','','synthetic','done','${'a'.repeat(64)}','completed',NULL,NULL,'["a"]',1);
    INSERT INTO admission_claims VALUES ('conflict-upgrade','personal','','synthetic','pending','${'b'.repeat(64)}','pending','synthetic-token',${Date.now() + 120000},NULL,NULL);`);
  return { path, db };
}
function cursor(db) {
  const identity = db.prepare('SELECT * FROM store_metadata').get();
  const sign = (s) => createHmac('sha256', identity.cursor_secret).update(s).digest('base64url');
  const body = Buffer.from(JSON.stringify({ v: 1, s: identity.store_id, n: sign(JSON.stringify(namespace)),
    o: 'list', f: 'filed,unfiled', l: 1, e: 17, a: { updatedAt: timestamp, id: 'a' } })).toString('base64url');
  return `${body}.${sign(body)}`;
}

test('K09 v5→v6 preserves all values, claims, placements, suppression and signed cursors', (t) => {
  const { path, db } = fixture(t);
  const before = snapshot(db);
  const saved = cursor(db);
  const core = openMemoryCore({ path }); t.after(() => core.close());
  assert.equal(db.prepare('PRAGMA user_version').get().user_version, 6);
  assert.deepEqual(snapshot(db), before);
  const list = core.list({ namespace, limit: 1, cursor: saved });
  assert.equal(list.ok, true, JSON.stringify(list));
  assert.deepEqual(list.value.memories.map((m) => m.id), ['b']);
  assert.deepEqual(core.get({ namespace, memoryId: 'a' }).value.conflicts, []);
  assert.equal(core.get({ namespace, memoryId: 'a' }).value.placements[0].title, 'Topic');
  assert.deepEqual(core.claimAdmission({ namespace, client: 'synthetic', eventId: 'done',
    payloadDigest: 'a'.repeat(64), leaseMs: 1000 }),
  { ok: true, value: { duplicate: true, memoryIds: ['a'], suppressedCount: 1 } });
  assert.deepEqual(core.claimAdmission({ namespace, client: 'synthetic', eventId: 'pending',
    payloadDigest: 'b'.repeat(64), leaseMs: 1000 }), { ok: true, value: { processing: true } });
  assert.deepEqual(snapshot(db), before);
  assert.equal(core.finishAdmission({ namespace, client: 'synthetic', eventId: 'pending',
    payloadDigest: 'b'.repeat(64), token: 'synthetic-token', items: [] }).ok, true);
});

test('K09 v5 DDL collision preserves schema and state then retries', (t) => {
  const { path, db } = fixture(t);
  db.exec("CREATE TABLE memory_conflicts(preserve_me TEXT); INSERT INTO memory_conflicts VALUES ('survivor')");
  const schema = db.prepare('SELECT * FROM sqlite_master ORDER BY name').all();
  const before = snapshot(db);
  assert.throws(() => openMemoryCore({ path }));
  assert.equal(db.prepare('PRAGMA user_version').get().user_version, 5);
  assert.deepEqual(db.prepare('SELECT * FROM sqlite_master ORDER BY name').all(), schema);
  assert.deepEqual(snapshot(db), before);
  assert.equal(db.prepare('SELECT preserve_me FROM memory_conflicts').get().preserve_me, 'survivor');
  db.exec('DROP TABLE memory_conflicts');
  const core = openMemoryCore({ path }); t.after(() => core.close());
  assert.equal(db.prepare('PRAGMA user_version').get().user_version, 6);
  assert.deepEqual(snapshot(db), before);
});

test('K09 v5 writer contention leaves old schema intact and retryable', (t) => {
  const { path, db } = fixture(t);
  const before = snapshot(db);
  const schema = db.prepare('SELECT * FROM sqlite_master ORDER BY name').all();
  db.exec('BEGIN IMMEDIATE');
  try {
    assert.throws(() => openMemoryCore({ path }));
    assert.equal(db.prepare('PRAGMA user_version').get().user_version, 5);
    assert.deepEqual(snapshot(db), before);
    assert.deepEqual(db.prepare('SELECT * FROM sqlite_master ORDER BY name').all(), schema);
  } finally { db.exec('ROLLBACK'); }
  const core = openMemoryCore({ path }); t.after(() => core.close());
  assert.equal(db.prepare('PRAGMA user_version').get().user_version, 6);
  assert.deepEqual(snapshot(db), before);
});

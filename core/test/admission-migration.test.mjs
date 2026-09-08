import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { closeSync, mkdtempSync, openSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import test from 'node:test';
import { openMemoryCore } from '../contract.mjs';

const namespace = { ownerId: 'upgrade-admission', scope: 'personal', projectId: null };
const timestamp = '2025-01-01T00:00:00.000Z';
function fixture(t) {
  const path = join(mkdtempSync(join(tmpdir(), 'cairn-admission-v4-')), 'memory.sqlite');
  closeSync(openSync(path, 'ax', 0o600));
  const db = new DatabaseSync(path);
  t.after(() => db.close());
  db.exec(readFileSync(new URL('../testing/admission-schema-v4.sql', import.meta.url), 'utf8'));
  db.exec(`INSERT INTO store_metadata VALUES (1, 'synthetic-store', '${'ab'.repeat(32)}');
    INSERT INTO namespace_epochs VALUES ('upgrade-admission','personal','',17);
    INSERT INTO suppressed VALUES ('upgrade-admission','personal','','${'c'.repeat(64)}');`);
  for (const id of ['a', 'b']) {
    db.prepare(`INSERT INTO memories VALUES (?, 'upgrade-admission','personal','',?,?,'fact','explicit',1,3,0,?,?,'filed')`)
      .run(id, id, `Synthetic memory ${id}`, timestamp, timestamp);
    db.prepare(`INSERT INTO receipts VALUES (?, ?, ?, 'synthetic','session',?,'user',?,?)`)
      .run(`receipt-${id}`, id, id, id, `Synthetic evidence ${id}`, timestamp);
  }
  db.prepare(`INSERT INTO mocs VALUES ('moc','upgrade-admission','personal','',1,'Synthetic topic','synthetic topic',2,?,?)`)
    .run(timestamp, timestamp);
  db.exec(`INSERT INTO moc_memory_refs VALUES ('moc',2,'a',3);
    INSERT INTO moc_title_sources VALUES ('moc','a',3);`);
  return { path, db };
}
function cursor(db) {
  const identity = db.prepare('SELECT * FROM store_metadata').get();
  const sign = (value) => createHmac('sha256', identity.cursor_secret).update(value).digest('base64url');
  const body = Buffer.from(JSON.stringify({ v: 1, s: identity.store_id, n: sign(JSON.stringify(namespace)),
    o: 'list', f: 'filed,unfiled', l: 1, e: 17, a: { updatedAt: timestamp, id: 'a' } })).toString('base64url');
  return `${body}.${sign(body)}`;
}
const tables = ['memories', 'receipts', 'suppressed', 'namespace_epochs', 'store_metadata',
  'mocs', 'moc_memory_refs', 'moc_edges', 'moc_title_sources'];
const snapshot = (db) => tables.map((table) => db.prepare(`SELECT * FROM ${table} ORDER BY rowid`).all());

test('v4→v7 preserves complete store state and authenticated cursors', (t) => {
  const { path, db } = fixture(t);
  const before = snapshot(db);
  const savedCursor = cursor(db);
  const core = openMemoryCore({ path });
  t.after(() => core.close());
  assert.equal(db.prepare('PRAGMA user_version').get().user_version, 7);
  assert.deepEqual(snapshot(db), before);
  const page = core.list({ namespace, limit: 1, cursor: savedCursor });
  assert.equal(page.ok, true, JSON.stringify(page));
  assert.deepEqual(page.value.memories.map((m) => m.id), ['b']);
  assert.equal(core.get({ namespace, memoryId: 'a' }).value.placements[0].title, 'Synthetic topic');
  const claim = core.claimAdmission({ namespace, client: 'test', eventId: 'new', payloadDigest: 'a'.repeat(64), leaseMs: 1000 });
  assert.equal(claim.ok, true, JSON.stringify(claim));
  assert.equal(core.list({ namespace, limit: 1, cursor: savedCursor }).ok, true);
  assert.deepEqual(snapshot(db), before);
});

test('v4 migration DDL collision rolls back all schema and data changes', (t) => {
  const { path, db } = fixture(t);
  db.exec('CREATE TABLE admission_claims (preserve_me TEXT); INSERT INTO admission_claims VALUES (\'synthetic survivor\')');
  const schema = db.prepare('SELECT * FROM sqlite_master ORDER BY name').all();
  const before = snapshot(db);
  assert.throws(() => openMemoryCore({ path }));
  assert.equal(db.prepare('PRAGMA user_version').get().user_version, 4);
  assert.deepEqual(db.prepare('SELECT * FROM sqlite_master ORDER BY name').all(), schema);
  assert.deepEqual(snapshot(db), before);
  assert.equal(db.prepare('SELECT preserve_me FROM admission_claims').get().preserve_me, 'synthetic survivor');
});

test('v4 upgrade blocked by another writer remains intact and retries', (t) => {
  const { path, db } = fixture(t);
  const before = snapshot(db);
  db.exec('BEGIN IMMEDIATE');
  try {
    assert.throws(() => openMemoryCore({ path }));
    assert.equal(db.prepare('PRAGMA user_version').get().user_version, 4);
    assert.deepEqual(snapshot(db), before);
  } finally { db.exec('ROLLBACK'); }
  const core = openMemoryCore({ path });
  t.after(() => core.close());
  assert.equal(db.prepare('PRAGMA user_version').get().user_version, 7);
  assert.deepEqual(snapshot(db), before);
});

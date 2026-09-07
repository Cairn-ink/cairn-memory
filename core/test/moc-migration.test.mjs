import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { closeSync, mkdtempSync, openSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { DatabaseSync } from 'node:sqlite';
import test from 'node:test';
import { openMemoryCore } from '../contract.mjs';

const namespace = { ownerId: 'upgrade', scope: 'personal', projectId: null };
const timestamp = '2025-01-01T00:00:00.000Z';
function v3() {
  const path = join(mkdtempSync(join(tmpdir(), 'cairn-v3-moc-')), 'memory.sqlite');
  closeSync(openSync(path, 'ax', 0o600));
  const db = new DatabaseSync(path);
  db.exec(readFileSync(new URL('../testing/schema-v3.sql', import.meta.url), 'utf8'));
  for (const id of ['v3-a', 'v3-b']) {
    db.prepare(`INSERT INTO memories VALUES (?, 'upgrade','personal','',?,?,'fact','explicit',1,1,0,?,?)`)
      .run(id, id, `Stored ${id}`, timestamp, timestamp);
    db.prepare(`INSERT INTO receipts VALUES (?, ?, ?, 'test','session',?,'user',?,?)`)
      .run(`receipt-${id}`, id, id, id, `Stored ${id}`, timestamp);
  }
  db.prepare(`INSERT INTO namespace_epochs VALUES ('upgrade','personal','',8)`).run();
  return { db, path };
}

test('v3→v5 retains memory, receipt IDs and authenticated S2a cursor identity', () => {
  const { db, path } = v3();
  const identity = db.prepare('SELECT * FROM store_metadata').get();
  const sign = (text) => createHmac('sha256', identity.cursor_secret).update(text).digest('base64url');
  const body = Buffer.from(JSON.stringify({ v: 1, s: identity.store_id, n: sign(JSON.stringify(namespace)),
    o: 'list', f: 'filed,unfiled', l: 1, e: 8, a: { updatedAt: timestamp, id: 'v3-a' } })).toString('base64url');
  const cursor = `${body}.${sign(body)}`;
  const receipts = db.prepare('SELECT * FROM receipts ORDER BY id').all();
  db.close();
  const core = openMemoryCore({ path });
  try {
    const page = core.list({ namespace, limit: 1, cursor });
    assert.equal(page.ok, true, JSON.stringify(page));
    assert.deepEqual(page.value.memories.map((m) => m.id), ['v3-b']);
    assert.equal(page.value.memories[0].filing.status, 'unfiled');
    const check = new DatabaseSync(path);
    try {
      assert.equal(check.prepare('PRAGMA user_version').get().user_version, 5);
      assert.deepEqual(check.prepare('SELECT * FROM store_metadata').get(), identity);
      assert.deepEqual(check.prepare('SELECT * FROM receipts ORDER BY id').all(), receipts);
      assert.equal(check.prepare('SELECT epoch FROM namespace_epochs').get().epoch, 8);
    } finally { check.close(); }
  } finally { core.close(); }
});

test('failed v3 MOC migration rolls back the added filing column and all DDL', () => {
  const { db, path } = v3();
  db.exec('CREATE TABLE mocs (preserve_me TEXT)');
  const schema = db.prepare('SELECT * FROM sqlite_master ORDER BY name').all();
  assert.throws(() => openMemoryCore({ path }));
  assert.equal(db.prepare('PRAGMA user_version').get().user_version, 3);
  assert.deepEqual(db.prepare('SELECT * FROM sqlite_master ORDER BY name').all(), schema);
  assert.equal(db.prepare('SELECT count(*) AS n FROM memories').get().n, 2);
  db.close();
});

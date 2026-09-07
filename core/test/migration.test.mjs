import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { closeSync, mkdtempSync, openSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { DatabaseSync } from 'node:sqlite';
import test from 'node:test';
import { openMemoryCore } from '../contract.mjs';
import { openMemoryStore } from '../index.mjs';

const ns = { ownerId: 'migration-user', scope: 'personal', projectId: null };
const hash = (value) => createHash('sha256').update(value).digest('hex');
function v1() {
  const path = join(mkdtempSync(join(tmpdir(), 'cairn-v1-upgrade-')), 'memory.sqlite');
  closeSync(openSync(path, 'ax', 0o600));
  const db = new DatabaseSync(path);
  db.exec(readFileSync(new URL('../testing/schema-v1.sql', import.meta.url), 'utf8'));
  const now = '2024-01-01T00:00:00.000Z';
  db.prepare(`INSERT INTO memories (id,owner_id,scope,project_id,fingerprint,content,kind,
    origin,confidence,revision,deleted,created_at,updated_at) VALUES
    ('retained','migration-user','personal','',?,'Retain source lineage','fact','explicit',1,7,0,?,?)`)
    .run(hash('retain source lineage'), now, now);
  const source = { client: 'v1', sessionId: 's', eventId: 'e', role: 'user', excerpt: 'Retain source lineage' };
  db.prepare(`INSERT INTO receipts VALUES ('retained',?,?,?,?,?,?,?)`)
    .run(hash(JSON.stringify(source)), source.client, source.sessionId, source.eventId, source.role, source.excerpt, now);
  db.prepare(`INSERT INTO suppressed VALUES ('migration-user','personal','',?)`).run(hash('retired note'));
  db.prepare(`INSERT INTO memories (id,owner_id,scope,project_id,fingerprint,content,kind,
    origin,confidence,revision,deleted,created_at,updated_at) VALUES
    ('removed','migration-user','personal','',?,NULL,'fact','explicit',1,3,1,?,?)`)
    .run(hash('retired note'), now, now);
  return { db, path, source };
}
function ok(result) { assert.equal(result.ok, true, JSON.stringify(result)); return result.value; }

test('v1 migration preserves records, revisions, sources and suppression without a second store', (t) => {
  const { db, path, source } = v1();
  const before = db.prepare('SELECT * FROM memories ORDER BY id').all();
  db.close();
  const core = openMemoryCore({ path });
  t.after(() => core.close());
  const detail = ok(core.get({ namespace: ns, memoryId: 'retained' }));
  assert.equal(detail.memory.content, 'Retain source lineage');
  assert.equal(detail.memory.revision, 7);
  assert.equal(detail.receipts[0].excerpt, source.excerpt);
  assert.ok(detail.receipts[0].id);
  const again = openMemoryCore({ path });
  t.after(() => again.close());
  assert.deepEqual(ok(again.get({ namespace: ns, memoryId: 'retained' })), detail);
  assert.equal(core.get({ namespace: ns, memoryId: 'removed' }).error.code, 'memory_not_found');
  assert.equal(core.admit({ namespace: ns, memory: { content: 'Retired note', kind: 'fact' },
    receipts: [{ ...source, excerpt: 'Retired note' }] }).error.code, 'memory_suppressed');
  const check = new DatabaseSync(path);
  t.after(() => check.close());
  assert.equal(check.prepare('PRAGMA user_version').get().user_version, 4);
  // Migration may add columns, but must preserve every original column value.
  for (const old of before) {
    const migrated = check.prepare('SELECT * FROM memories WHERE id = ?').get(old.id);
    for (const [key, value] of Object.entries(old)) assert.equal(migrated[key], value);
  }
  const legacy = openMemoryStore({ path });
  t.after(() => legacy.close());
  assert.equal(legacy.scope({ ownerId: ns.ownerId }).get('retained').revision, 7);
});

test('unmerged draft-v2 and future schemas fail closed without rewriting data', () => {
  for (const version of [2, 99]) {
    const { db, path } = v1();
    db.exec(`PRAGMA user_version = ${version}`);
    const before = db.prepare('SELECT * FROM sqlite_master ORDER BY name').all();
    assert.throws(() => openMemoryCore({ path }), (error) => error.code === 'unsupported_database');
    assert.equal(db.prepare('PRAGMA user_version').get().user_version, version);
    assert.deepEqual(db.prepare('SELECT * FROM sqlite_master ORDER BY name').all(), before);
    assert.equal(db.prepare('SELECT content FROM memories WHERE id = ?').get('retained').content, 'Retain source lineage');
    db.close();
  }
});

test('a mid-migration DDL failure restores the original receipt table and version', () => {
  const { db, path } = v1();
  // A deliberate schema collision occurs after the receipt-table migration
  // has started. Nothing from that failed transaction may become durable.
  db.exec('CREATE TABLE namespace_epochs (precious TEXT); INSERT INTO namespace_epochs VALUES (\'keep\')');
  const before = db.prepare('SELECT * FROM sqlite_master ORDER BY name').all();
  const receipts = db.prepare('SELECT * FROM receipts').all();
  assert.throws(() => openMemoryCore({ path }));
  assert.equal(db.prepare('PRAGMA user_version').get().user_version, 1);
  assert.deepEqual(db.prepare('SELECT * FROM sqlite_master ORDER BY name').all(), before);
  assert.deepEqual(db.prepare('SELECT * FROM receipts').all(), receipts);
  assert.equal(db.prepare('SELECT precious FROM namespace_epochs').get().precious, 'keep');
  db.close();
});

test('a blocked migration leaves v1 data unchanged and can retry after the lock is released', () => {
  const { db, path } = v1();
  // A second connection cannot migrate while a writer owns the transaction.
  db.exec('BEGIN EXCLUSIVE');
  try {
    assert.throws(() => openMemoryCore({ path }));
    assert.equal(db.prepare('PRAGMA user_version').get().user_version, 1);
    assert.equal(db.prepare('SELECT content FROM memories WHERE id = ?').get('retained').content, 'Retain source lineage');
  } finally { db.exec('ROLLBACK'); db.close(); }
  const core = openMemoryCore({ path });
  try { assert.equal(ok(core.get({ namespace: ns, memoryId: 'retained' })).memory.revision, 7); }
  finally { core.close(); }
});

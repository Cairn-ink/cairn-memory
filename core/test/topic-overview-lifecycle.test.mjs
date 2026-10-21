import assert from 'node:assert/strict';
import test from 'node:test';
import { DatabaseSync } from 'node:sqlite';
import { chmodSync, existsSync, readFileSync, symlinkSync } from 'node:fs';
import { join } from 'node:path';
import { Worker } from 'node:worker_threads';
import { openMemoryReader } from '../index.mjs';
import { topicOverviewFixture, overviewNamespace as namespace, unwrapOverview as ok } from '../testing/topic-overview-fixture.mjs';

function readerFor(t, f, path = f.path) {
  const reader = openMemoryReader({ path, ownerId: namespace.ownerId });
  f.workspace.defer(() => reader.close()); return reader;
}
test('read-only opener never reserves a writer and exclusive contention refuses promptly', async t => {
  const f = topicOverviewFixture(t), db = new DatabaseSync(f.path), reader = readerFor(t, f);
  f.workspace.defer(() => db.close());
  const before = readFileSync(f.path);
  db.exec('BEGIN IMMEDIATE');
  try { assert.equal((await reader.readTopicOverview({ namespace })).ok, true); }
  finally { db.exec('ROLLBACK'); }
  assert.deepEqual(readFileSync(f.path), before);
  db.exec('BEGIN EXCLUSIVE');
  const start = performance.now();
  try { assert.equal((await reader.readTopicOverview({ namespace })).error.code, 'storage_busy'); }
  finally { db.exec('ROLLBACK'); }
  assert.ok(performance.now() - start < 1000, 'no five-second native busy wait');
  db.exec('BEGIN EXCLUSIVE; ROLLBACK');
});

test('missing, symlinked, unsafe and old stores remain untouched', async t => {
  const f = topicOverviewFixture(t), missing = join(f.workspace.path, 'missing.sqlite');
  const noFile = readerFor(t, f, missing);
  assert.equal(existsSync(missing), false, 'constructor validates without file access/creation');
  assert.equal((await noFile.readTopicOverview({ namespace })).error.code, 'database_not_found');
  assert.equal(existsSync(missing), false);
  const link = join(f.workspace.path, 'linked.sqlite'); symlinkSync(f.path, link);
  assert.equal((await readerFor(t, f, link).readTopicOverview({ namespace })).error.code, 'unsafe_database_file');
  chmodSync(f.path, 0o644);
  assert.equal((await readerFor(t, f).readTopicOverview({ namespace })).error.code, 'unsafe_database_file');
  chmodSync(f.path, 0o600);
  const db = new DatabaseSync(f.path);
  try { db.exec('PRAGMA user_version=17'); } finally { db.close(); }
  const before = readFileSync(f.path);
  assert.equal((await readerFor(t, f).readTopicOverview({ namespace })).error.code, 'unsupported_database');
  assert.deepEqual(readFileSync(f.path), before);
});

test('close cancels in-flight work and concurrent close calls wait for worker termination', async t => {
  const f = topicOverviewFixture(t), reader = readerFor(t, f);
  const pending = reader.readTopicOverview({ namespace });
  await Promise.all([reader.close(), reader.close()]);
  assert.equal((await pending).error.code, 'store_closed');
  assert.equal((await reader.readTopicOverview({ namespace })).error.code, 'store_closed');
  const db = new DatabaseSync(f.path);
  try { db.exec('BEGIN EXCLUSIVE; ROLLBACK'); } finally { db.close(); }
});

test('deadline terminates and settles; idle expiry invalidates continuations', async t => {
  const f = topicOverviewFixture(t), reader = readerFor(t, f);
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const pending = reader.readTopicOverview({ namespace });
  t.mock.timers.tick(5000);
  assert.equal((await pending).error.code, 'read_timeout');
  const first = ok(await reader.readTopicOverview({ namespace, workLimit: 16 }));
  assert.ok(first.nextCursor);
  t.mock.timers.tick(60000);
  const next = await reader.readTopicOverview({ namespace, workLimit: 16, cursor: first.nextCursor });
  assert.equal(next.error.code, 'cursor_stale');
});

test('unexpected native worker exit settles a safe failure without leaking errors', async t => {
  const f = topicOverviewFixture(t), reader = readerFor(t, f);
  t.mock.method(Worker.prototype, 'postMessage', function () { void this.terminate(); });
  assert.deepEqual(await reader.readTopicOverview({ namespace }), { ok: false, error: { code: 'reader_failed' } });
});

for (const [label, sql] of [
  ['missing secondary', 'DROP INDEX index_memory_keyset'],
  ['partial secondary', `DROP INDEX index_memory_keyset; CREATE INDEX index_memory_keyset
    ON memories(owner_id,scope,project_id,id) WHERE deleted=0`],
  ['collation mismatch', `DROP INDEX index_memory_keyset; CREATE INDEX index_memory_keyset
    ON memories(owner_id,scope,project_id,id COLLATE NOCASE)`],
  ['reverse order', `DROP INDEX index_memory_keyset; CREATE INDEX index_memory_keyset
    ON memories(owner_id,scope,project_id,id DESC)`],
  ['missing primary', `ALTER TABLE moc_title_sources RENAME TO original_title_sources;
    CREATE TABLE moc_title_sources(moc_id TEXT,memory_id TEXT,memory_revision INTEGER)`],
]) test(`malformed supported schema refuses ${label} access path without modifying bytes`, async t => {
  const f = topicOverviewFixture(t), db = new DatabaseSync(f.path);
  try { db.exec(sql); } finally { db.close(); }
  const before = readFileSync(f.path);
  assert.equal((await readerFor(t, f).readTopicOverview({ namespace })).error.code, 'unsupported_database');
  assert.deepEqual(readFileSync(f.path), before);
});

test('metadata state overflow returns unknown counts once without an endlessly repeating cursor', async t => {
  const f = topicOverviewFixture(t), db = new DatabaseSync(f.path);
  try {
    db.exec('BEGIN');
    const insert = db.prepare(`INSERT INTO mocs(id,owner_id,scope,project_id,level,title,canonical_title,
      revision,created_at,updated_at) VALUES(?,?,'personal','',1,?,?,1,?,?)`);
    for (let i = 0; i < 8200; i++) {
      const id = `synthetic-limit-${String(i).padStart(5, '0')}`;
      insert.run(id, namespace.ownerId, id, id, '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z');
    }
    db.exec('COMMIT');
  } finally { if (db.isTransaction) db.exec('ROLLBACK'); db.close(); }
  const reader = readerFor(t, f);
  const page = ok(await reader.readTopicOverview({ namespace, workLimit: 50000 }));
  assert.deepEqual(page.items, []); assert.equal(page.totals, null); assert.equal(page.nextCursor, null);
  assert.deepEqual(page.coverage, { complete: false, countsComplete: false, reason: 'state_limit' });
  const empty = ok(await reader.readTopicOverview({ namespace: { ...namespace, scope: 'project', projectId: 'empty' } }));
  assert.equal(empty.totals.unique.total, 0, 'a capped traversal does not poison the reader');
});

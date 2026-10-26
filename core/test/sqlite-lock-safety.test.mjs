import assert from 'node:assert/strict';
import test from 'node:test';
import { spawnSync } from 'node:child_process';
import { DatabaseSync } from 'node:sqlite';
import { openMemoryReader } from '../memory-reader.mjs';
import { memberFixture, namespace } from '../testing/topic-members-fixture.mjs';
import { assertContextReadReadOnlyAuxiliaries, openContextReadSidecar } from '../context-read-sidecar.mjs';
import { pinStoreFile } from '../store-fence.mjs';

// A different process is essential: SQLite's in-process connection accounting
// cannot detect POSIX locks silently removed by an unrelated raw close.
function child(path, sql) {
  const run = spawnSync(process.execPath, ['--input-type=module', '-e', `
    import { DatabaseSync } from 'node:sqlite';
    const db = new DatabaseSync(process.argv[1]);
    db.exec('PRAGMA busy_timeout=0');
    try {
      if (process.argv[2] === 'exclusive-transaction') db.exec('BEGIN EXCLUSIVE');
      if (process.argv[2] === 'exclusive-read') db.exec('PRAGMA locking_mode=EXCLUSIVE; BEGIN');
      const rows = db.prepare(['exclusive-read', 'exclusive-transaction'].includes(process.argv[2]) ? 'SELECT store_id FROM store_metadata' : process.argv[2]).all();
      console.log(JSON.stringify({ rows }));
    }
    catch (e) { console.log(JSON.stringify({ code: e.errcode & 255 })); }
    finally { if (db.isTransaction) db.exec('ROLLBACK'); db.close(); }
  `, path, sql], { encoding: 'utf8', timeout: 10000 });
  assert.equal(run.error, undefined); assert.equal(run.signal, null);
  assert.equal(run.status, 0, run.stderr);
  return JSON.parse(run.stdout);
}
const locked = path => assert.deepEqual(child(path, 'BEGIN IMMEDIATE'), { code: 5 });
async function topicRead(path, members) {
  const reader = openMemoryReader({ path, ownerId: namespace.ownerId });
  try {
    const result = await (members ? reader.readTopicMembers({ namespace, selection: { type: 'unfiled' }, accessRevision: 'g' }) :
      reader.readTopicOverview({ namespace }));
    assert.equal(result.ok, true, JSON.stringify(result));
  } finally { await reader.close(); }
}
for (const mode of ['DELETE', 'WAL']) for (const members of [false, true]) {
  test(`${mode}: public topic ${members ? 'members' : 'overview'} and Worker exit preserve host writer locks`, async t => {
    const f = memberFixture(t, { mode }); f.admit('lock safety');
    f.db.exec('BEGIN IMMEDIATE');
    f.db.exec("UPDATE store_metadata SET store_id=store_id WHERE singleton=1");
    try {
      locked(f.path);
      await topicRead(f.path, members);
      locked(f.path);
      f.db.exec('COMMIT');
      assert.deepEqual(child(f.path, 'BEGIN IMMEDIATE'), { rows: [] });
    } finally { if (f.db.isTransaction) f.db.exec('ROLLBACK'); }
  });
}
test('WAL: topic reads preserve host snapshot and prevent checkpoint truncation', async t => {
  const f = memberFixture(t, { mode: 'WAL' }); f.admit('snapshot');
  f.db.exec('BEGIN');
  const before = f.db.prepare('SELECT store_id FROM store_metadata').get().store_id;
  try {
    assert.deepEqual(child(f.path, "UPDATE store_metadata SET store_id='child-store'"), { rows: [] });
    for (const members of [false, true]) {
      await topicRead(f.path, members);
      const checkpoint = child(f.path, 'PRAGMA wal_checkpoint(TRUNCATE)').rows[0];
      assert.equal(checkpoint.busy, 1, JSON.stringify(checkpoint));
      assert.equal(f.db.prepare('SELECT store_id FROM store_metadata').get().store_id, before);
      // WAL main-file SHARED locks also prevent a different process obtaining
      // exclusive locking mode. This catches loss of the main-file lock even
      // when the read-mark in SHM still happens to protect the snapshot.
      assert.deepEqual(child(f.path, 'exclusive-read'), { code: 5 });
    }
  } finally { f.db.exec('ROLLBACK'); }
  assert.equal(child(f.path, 'PRAGMA wal_checkpoint(TRUNCATE)').rows[0].busy, 0);
});
test('context read-only canonical and sidecar probes preserve other host writer locks', t => {
  const f = memberFixture(t); f.admit('context lock');
  const index = openContextReadSidecar({ path: f.path, db: f.db }); index.close();
  for (const path of [f.path, f.path + '.context-read-v1.sqlite']) {
    const db = new DatabaseSync(path); db.exec('PRAGMA busy_timeout=5000; BEGIN IMMEDIATE');
    // An actual write is required; a RESERVED lock alone creates no journal.
    db.exec(path === f.path ? 'UPDATE store_metadata SET store_id=store_id' : 'UPDATE generations SET phase=phase');
    try {
      locked(path);
      // A live rollback journal is a refusal. Probe again after deleting no data
      // by using the read-only preflight on the *other* file first.
      try { assertContextReadReadOnlyAuxiliaries(f.path); } catch (error) { assert.equal(error.code, 'index_unavailable'); }
      if (path !== f.path) {
        const other = openContextReadSidecar({ path: f.path, db: f.db }); other.close();
      }
      locked(path);
      db.exec('COMMIT'); assert.deepEqual(child(path, 'BEGIN IMMEDIATE'), { rows: [] });
    } finally { if (db.isTransaction) db.exec('ROLLBACK'); db.close(); }
  }
});
test('context canonical preflight preserves an existing host read lock', t => {
  const f = memberFixture(t); f.admit('canonical snapshot');
  const index = openContextReadSidecar({ path: f.path, db: f.db }); index.close();
  f.db.exec('BEGIN');
  const before = f.db.prepare('SELECT store_id FROM store_metadata').get();
  try {
    assert.deepEqual(child(f.path, 'exclusive-transaction'), { code: 5 });
    assertContextReadReadOnlyAuxiliaries(f.path);
    assert.deepEqual(child(f.path, 'exclusive-transaction'), { code: 5 });
    assert.deepEqual(f.db.prepare('SELECT store_id FROM store_metadata').get(), before);
  } finally { f.db.exec('ROLLBACK'); }
});
test('store fence check and close preserve same-process SQLite locks', t => {
  const f = memberFixture(t); f.admit('fence');
  const pin = pinStoreFile(f.path);
  f.db.exec('BEGIN IMMEDIATE; UPDATE store_metadata SET store_id=store_id');
  try {
    locked(f.path);
    assert.throws(() => pin.check(), { code: 'unsafe_database_file' });
    pin.close(); locked(f.path);
    f.db.exec('COMMIT'); assert.deepEqual(child(f.path, 'BEGIN IMMEDIATE'), { rows: [] });
  } finally { if (f.db.isTransaction) f.db.exec('ROLLBACK'); pin.close(); }
});

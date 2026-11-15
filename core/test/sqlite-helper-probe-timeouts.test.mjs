import { faults } from './fixtures/sqlite-helper-child-faults.mjs';
import test, { beforeEach } from 'node:test';
beforeEach(t => faults.install?.(t));
import assert from 'node:assert/strict';
import { symlinkSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { fixture } from '../testing/context-read-fixture.mjs';
import { probeRollbackJournal, sqliteFileStat } from '../sqlite-journal-probe.mjs';
import { pinStoreFile } from '../store-fence.mjs';
import { assertContextReadCanonicalDelete } from '../context-read-sidecar.mjs';
import { nativeObserver } from '../context-product-telemetry.mjs';
import { productFailure } from '../context-product-reader.mjs';
import { openDatabase } from '../database.mjs';

const openers = {
  fence: path => pinStoreFile(path).close(),
  legacy: path => assertContextReadCanonicalDelete(path),
  observed: path => assertContextReadCanonicalDelete(path, nativeObserver()),
};
for (const [label, open] of Object.entries(openers))
test(`PROBE_BUSY ${label}: cache miss timeout is retryable, uncached and leaves the next answer unchanged`, t => {
  const f = fixture(t); t.after(() => faults.reset());
  faults.reset(); open(f.path);
  assert.equal(faults.counts.probes, 1, 'one warmup probe');
  f.admit('synthetic metadata-changing write');
  const before = sqliteFileStat(f.path), files = readdirSync(f.workspace.path).sort();
  faults.arm(4);
  assert.throws(() => open(f.path), error => {
    assert.equal(faults.counts.reached, 1, 'probe reached delay after reading its answer');
    assert.equal(error.code, 'storage_busy', 'PROBE_BUSY_' + label);
    assert.equal(error.cause, 'ETIMEDOUT', 'PROBE_PRIVATE_CAUSE');
    assert.deepEqual(productFailure(error.code), { ok: false, error: { code: 'storage_busy', retryable: true } }); return true;
  });
  assert.equal(faults.counts.probes, 1);
  assert.deepEqual(readdirSync(f.workspace.path).sort(), files, 'timed-out probe creates no companions');
  for (const field of ['dev', 'ino', 'size', 'mtimeNs', 'ctimeNs']) assert.equal(sqliteFileStat(f.path)[field], before[field], 'probe preserves ' + field);
  faults.reset(); open(f.path);
  assert.equal(faults.counts.probes, 1, 'PROBE_RETRY_REPROBES');
  assert.deepEqual(probeRollbackJournal(f.path), { mode: 'delete' }, 'same journal answer after retry');
  faults.reset(); open(f.path);
  assert.equal(faults.counts.probes, 0, 'PROBE_UNCHANGED_CACHE_HIT');
  console.log(JSON.stringify({ marker: 'PROBE_RETRY_REPROBES', label, afterWrite: 1, retry: 1, unchanged: 0, files }));
});

test('PROBE_OPEN_SPAWN_COUNTS: fenced native open after write spawns one child, unchanged open spawns zero', t => {
  const f = fixture(t); t.after(() => faults.reset());
  const s = sqliteFileStat(f.path);
  const fence = { version: 'store-fence-v1', dev: String(s.dev), ino: String(s.ino),
    applicationId: f.db.prepare('PRAGMA application_id').get().application_id,
    userVersion: f.db.prepare('PRAGMA user_version').get().user_version,
    storeId: f.db.prepare('SELECT store_id FROM store_metadata WHERE singleton=1').get().store_id };
  openDatabase(f.path, { storeFence: fence }).close();
  f.admit('synthetic write after cached native open');
  faults.reset(); openDatabase(f.path, { storeFence: fence }).close();
  assert.equal(faults.counts.probes, 1, 'PROBE_OPEN_AFTER_WRITE_ONE');
  faults.reset(); openDatabase(f.path, { storeFence: fence }).close();
  assert.equal(faults.counts.probes, 0, 'PROBE_OPEN_UNCHANGED_ZERO');
  console.log('PROBE_OPEN_SPAWN_COUNTS afterWrite=1 unchanged=0');
});

for (const mode of [2, 3, 4]) for (const observed of [false, true])
test(`PROBE_OTHER_ERROR mode=${mode} observed=${observed}: only an errno or signal enters cause`, t => {
  const f = fixture(t); faults.arm(4, mode); t.after(() => faults.reset());
  assert.throws(() => probeRollbackJournal(f.path, observed ? { observe: nativeObserver().journalProbe } : undefined), error => {
    assert.equal(error.code, 'storage_error', 'PROBE_OTHER_ERROR');
    assert.equal(error.cause, mode === 2 ? 'EIO' : mode === 3 ? 'SIGTERM' : 'ENOENT', 'PROBE_OTHER_PRIVATE_CAUSE'); return true;
  });
  faults.reset(); assert.deepEqual(probeRollbackJournal(f.path), { mode: 'delete' });
  assert.equal(faults.counts.probes, 1, 'PROBE_OTHER_FAILURE_NOT_CACHED');
});

for (const shape of ['wal', 'symlink']) test(`PROBE_UNSAFE_UNCHANGED ${shape}: existing refusal survives`, t => {
  const f = fixture(t); t.after(() => faults.reset());
  let path = f.path;
  if (shape === 'wal') { const db = new DatabaseSync(path); db.exec('PRAGMA journal_mode=WAL'); db.close(); }
  else { path = join(f.workspace.path, 'linked.sqlite'); symlinkSync(f.path, path); }
  assert.throws(() => pinStoreFile(path), { code: 'unsafe_database_file' });
  assert.throws(() => assertContextReadCanonicalDelete(path), { code: 'index_unavailable', reason: shape === 'wal' ? 'auxiliary_file' : 'unsafe_file' });
});

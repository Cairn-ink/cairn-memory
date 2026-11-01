import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { existsSync } from 'node:fs';
import { fixture, ns } from '../testing/context-read-fixture.mjs';
import { openContextProductFacade } from '../context-read-facade.mjs';
import { openProductIndex } from '../context-product-index.mjs';
import { PRODUCT_SIDECAR_SUFFIX } from '../context-product-sidecar.mjs';
import { accessDigest } from '../context-product-validation.mjs';
import { createProductSqlitePolicy } from '../context-product-sqlite.mjs';
import { createMaintenanceAttribution, maintenanceKinds } from '../context-product-attribution.mjs';

const vacuum = 'PRAGMA incremental_vacuum(32)';
const input = { readSet: [ns], types: ['memory'], intent: 'current', mode: 'lexical',
  budget: { maxItems: 1024, maxMs: 1000 } };

function setup(t, mode) {
  const f = fixture(t);
  for (let i = 0; i < 8; i++) f.admit('vacuum fixture ' + i + ' ' +
    Array.from({ length: 64 }, (_, term) => 'term' + term).join(' '));
  // Zero waits in both modes: contention is controlled by rendezvous, not clocks.
  const sqlite = createProductSqlitePolicy({ now: () => 0 }); sqlite.start(0);
  const facade = openContextProductFacade(f.path, { sqlite });
  const attribution = createMaintenanceAttribution({ now: () => 0 });
  const ownerCoverage = { policy: 'recent-projects-v1', selectionRevision: 'vacuum-fixture',
    requestedNamespaces: 1, selectedNamespaces: 1, omittedNamespaces: 0 };
  let hook = () => {};
  const index = openProductIndex({ path: f.path, facade, sqlite, sidecarJournalMode: mode,
    maintenance: true, ownerCoverage, now: () => 0, attribution,
    authorize: () => ({ accessGenerations: accessDigest({ ownerId: ns.ownerId, namespaces: { readSet: [ns] } }),
      check() {}, envelope: work => work() }),
    storageOptions: { rendezvous: point => hook(point) } });
  f.workspace.defer(() => { index.close(); facade.close(); });
  const refresh = () => { attribution.reset(); return index.run('refreshContextIndex', input, {}); };
  assert.equal(refresh().value?.status, 'complete', 'initial fixture is published');
  const path = f.path + PRODUCT_SIDECAR_SUFFIX;
  function open(readOnly = false) {
    const db = new DatabaseSync(path, { readOnly }); db.exec('PRAGMA busy_timeout=0');
    f.workspace.defer(() => db.close()); return db;
  }
  return { f, path, open, refresh, attribution, setHook(value) { hook = value; } };
}

for (const mode of ['DELETE', 'WAL']) for (const blocker of ['request snapshot', 'writer'])
test(`final GC vacuum: ${mode} with ${blocker}`, t => {
  const s = setup(t, mode), inspect = s.open(), competing = s.open(blocker === 'request snapshot');
  const retired = inspect.prepare('SELECT generation FROM publications').get().generation;
  const exec = DatabaseSync.prototype.exec, attempts = [];
  let held = false, gcSlices = 0;
  t.mock.method(DatabaseSync.prototype, 'exec', function(sql) {
    if (sql !== vacuum) return exec.call(this, sql);
    const sample = { freeBefore: this.prepare('PRAGMA freelist_count').get().freelist_count };
    try { return exec.call(this, sql); }
    catch (error) { sample.busy = error.code === 'ERR_SQLITE_ERROR' && (error.errcode & 255) === 5; throw error; }
    finally {
      Object.assign(sample, { transaction: this.isTransaction, journal: existsSync(s.path + '-journal') });
      attempts.push(sample);
      if (sample.busy) {
        if (blocker === 'writer') competing.exec('ROLLBACK');
        // Check before the refresh's observation can close/reopen its handle.
        inspect.exec('BEGIN IMMEDIATE; ROLLBACK');
      }
      Object.assign(sample, { freeAfter: this.prepare('PRAGMA freelist_count').get().freelist_count,
        integrity: this.prepare('PRAGMA integrity_check').get().integrity_check });
    }
  });
  s.setHook(point => {
    if (point !== 'gc') return;
    gcSlices++;
    if (held || inspect.prepare('SELECT 1 FROM generations WHERE id=?').get(retired)) return;
    assert.ok(inspect.prepare('PRAGMA freelist_count').get().freelist_count > 0, 'GC left pages to reclaim');
    // This is the SHARED sidecar snapshot held by a request read. WAL readers
    // do not block the vacuum; a competing WAL writer supplies the BUSY case.
    competing.exec(blocker === 'request snapshot' ? 'BEGIN' : 'BEGIN IMMEDIATE');
    competing.prepare('SELECT count(*) FROM documents').get(); held = true;
  });
  s.f.admit('new committed vacuum progress');
  const result = s.refresh(), skipped = mode === 'DELETE' || blocker === 'writer';
  assert.equal(held, true, 'lock acquired only after the last GC deletion committed');
  const last = attempts.at(-1);
  t.diagnostic(JSON.stringify({ runtime: process.version, mode, blocker, ...last }));
  assert.equal(result.ok, true, 'busy optional vacuum must not fail committed refresh progress');
  assert.equal(result.value.status, 'complete');
  assert.equal(Boolean(last.busy), skipped, 'native contention reached the intended statement');
  assert.equal(last.transaction, false, 'autocommit vacuum leaves no open transaction');
  assert.equal(last.journal, false, 'failed vacuum leaves no rollback journal');
  if (skipped) assert.equal(last.freeAfter, last.freeBefore, 'skip is not a completed vacuum write');
  else assert.ok(last.freeAfter < last.freeBefore, 'WAL request-reader passing control reclaims pages');
  assert.equal(s.attribution.failure(), undefined, 'optional BUSY is not a refresh failure');
  const fields = s.attribution.snapshot();
  assert.equal(fields.gcUnits, gcSlices + attempts.length, 'GC/vacuum units count admitted attempts, including skips');
  assert.equal(fields.lastUnitKind, maintenanceKinds.indexOf('vacuum'));
  assert.equal(last.integrity, 'ok', 'same native connection is immediately usable after BUSY');
  const reader = s.open(true);
  assert.equal(reader.prepare('SELECT count(*) AS n FROM documents').get().n, 9,
    'another read-only connection immediately sees consistent committed progress');
  if (competing.isTransaction) competing.exec('ROLLBACK');
  inspect.exec('BEGIN IMMEDIATE; ROLLBACK'); // No implicit writer lock survived.
  const before = attempts.length;
  assert.equal(s.refresh().value?.status, 'complete', 'next refresh works after the skip');
  assert.ok(attempts.slice(before).some(sample => !sample.busy &&
    (!skipped || sample.freeAfter < sample.freeBefore)), 'later admitted GC opportunity vacuums successfully');
  assert.equal(attempts.at(-1).transaction, false);
  assert.equal(inspect.prepare('PRAGMA integrity_check').get().integrity_check, 'ok');
});

test('passing control: a DELETE publication COMMIT BUSY still returns storage_busy', t => {
  const s = setup(t, 'DELETE'), reader = s.open(true);
  let pinned = false;
  s.setHook(point => {
    if (point === 'precommit' && !pinned) {
      reader.exec('BEGIN'); reader.prepare('SELECT count(*) FROM documents').get(); pinned = true;
    }
  });
  s.f.admit('publication contention fixture');
  const result = s.refresh();
  assert.equal(pinned, true);
  assert.deepEqual(result, { ok: false, error: { code: 'storage_busy', retryable: true } });
  reader.exec('ROLLBACK');
  assert.equal(s.refresh().value?.status, 'complete');
});

for (const mode of ['DELETE', 'WAL'])
test(`passing control: ${mode} GC transaction BUSY still returns storage_busy`, t => {
  const s = setup(t, mode), writer = s.open();
  let held = false;
  s.setHook(point => { if (point === 'gc-candidate' && !held) { writer.exec('BEGIN IMMEDIATE'); held = true; } });
  s.f.admit('GC contention fixture');
  const result = s.refresh();
  assert.equal(held, true);
  assert.deepEqual(result, { ok: false, error: { code: 'storage_busy', retryable: true } });
  writer.exec('ROLLBACK');
  assert.equal(s.refresh().value?.status, 'complete');
});

for (const mode of ['DELETE', 'WAL']) for (const [kind, error, code] of [
  ['extended BUSY', Object.assign(new Error('synthetic busy'), { code: 'ERR_SQLITE_ERROR', errcode: 261 }), null],
  ['LOCKED', Object.assign(new Error('synthetic locked'), { code: 'ERR_SQLITE_ERROR', errcode: 6 }), 'storage_busy'],
  ['IOERR', Object.assign(new Error('synthetic I/O'), { code: 'ERR_SQLITE_ERROR', errcode: 10 }), 'storage_error'],
  ['non-SQLite', Object.assign(new TypeError('synthetic failure'), { errcode: 5 }), 'storage_error'],
]) test(`vacuum error boundary: ${mode} ${kind}`, t => {
  const s = setup(t, mode), exec = DatabaseSync.prototype.exec;
  let attempts = 0;
  t.mock.method(DatabaseSync.prototype, 'exec', function(sql) {
    if (sql === vacuum) { attempts++; throw error; }
    return exec.call(this, sql);
  });
  const result = s.refresh();
  if (code) assert.deepEqual(result, { ok: false, error: { code, retryable: code === 'storage_busy' } });
  else assert.equal(result.ok, true, 'only SQLite primary BUSY is skipped');
  assert.equal(attempts, code ? 1 : 2, 'no retry loop; each collect offers its own vacuum');
});

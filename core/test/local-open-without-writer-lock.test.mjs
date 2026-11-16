import test from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { openMemoryCore } from '../index.mjs';
import { openDatabase, transaction } from '../database.mjs';
import { createCommitDispatcher, hasCommitDispatcher } from '../commit-dispatch.mjs';
import { LOCAL_RAW_PRIVACY_DDL } from '../content-safety-schema.mjs';
import { createTestWorkspace } from '../../tools/testing/workspace.mjs';

import { localOpenFixture, observeOpen, lockChild } from './fixtures/local-open-tools.mjs';
const controls = trace => trace.filter(row => /^(BEGIN|COMMIT|ROLLBACK)\b/.test(row.sql)).map(row => row.sql);
for (const shape of [29,53]) {
  for (const full of [false,true]) test(`local open shape ${shape} ${full ? 'full' : 'init'} succeeds behind child SHARED without reader refusals`, async t => {
    const f = await localOpenFixture(t, shape), holder = lockChild('shared', f.path);
    let observer, opened, failure, report;
    try {
      assert.equal(await holder.ready, 'ready');
      observer = lockChild('observe', f.path); assert.equal(await observer.ready, 'ready');
      try { opened = full ? openMemoryCore({ ...f.config, busyTimeoutMs: 200 }) : openDatabase(f.path, { busyTimeoutMs: 200 }); }
      catch (error) { failure = error; }
    } finally {
      report = observer ? await observer.finish() : { samples: [] };
      await opened?.close(); await holder.finish();
    }
    t.diagnostic(JSON.stringify({ shape, full, result: failure ? { code: failure.code, errcode: failure.errcode } : 'ok',
      probes: report.samples.length, refusals: report.samples.filter(row => row.code !== 'ok').length }));
    assert.equal(failure, undefined);
    assert.ok(report.samples.length > 0);
    assert.equal(report.samples.filter(row => row.code !== 'ok').length, 0);
  });
  for (const full of [false,true]) test(`local open shape ${shape} ${full ? 'full' : 'init'} statement sequence has no IMMEDIATE`, async t => {
    const f = await localOpenFixture(t, shape);
    const { value, trace } = observeOpen(() => full ? openMemoryCore(f.config) : openDatabase(f.path));
    await value.close();
    t.diagnostic(JSON.stringify({ shape, full, controls: controls(trace), sequence: trace.map(row => row.sql) }));
    assert.equal(trace.some(row => row.sql === 'BEGIN IMMEDIATE'), false);
    assert.deepEqual(controls(trace), ['BEGIN','COMMIT']);
  });
  test(`local open shape ${shape} missing privacy object still installs inside IMMEDIATE`, async t => {
    const f = await localOpenFixture(t, shape);
    const sql = LOCAL_RAW_PRIVACY_DDL.find(sql => /^CREATE INDEX/.test(sql.trim()));
    const name = /INDEX IF NOT EXISTS (\w+)/.exec(sql)[1];
    const db = new DatabaseSync(f.path);
    // Seed independently of the runtime probe so its always-complete mutation
    // fails on the missing object's restoration, rather than fixture setup.
    db.exec(LOCAL_RAW_PRIVACY_DDL.join('\n'));
    db.exec(`DROP INDEX ${name}`); db.close();
    const { value, trace } = observeOpen(() => openMemoryCore(f.config)); await value.close();
    const check = new DatabaseSync(f.path);
    try { assert.ok(check.prepare("SELECT 1 FROM sqlite_master WHERE type='index' AND name=?").get(name)); }
    finally { check.close(); }
    const install = trace.findIndex(row => row.sql === LOCAL_RAW_PRIVACY_DDL.join('\n'));
    assert.ok(install > 0);
    assert.equal(trace[install].transaction, true);
    assert.equal(trace.slice(0,install).findLast(row => /^BEGIN/.test(row.sql)).sql, 'BEGIN IMMEDIATE');
    assert.equal(trace.slice(install + 1).find(row => /^(COMMIT|ROLLBACK)$/.test(row.sql)).sql, 'COMMIT');
  });
  test(`local open shape ${shape} binds deferred and IMMEDIATE connections for commit dispatch`, async t => {
    const f = await localOpenFixture(t, shape), dispatcher = createCommitDispatcher({ strict: true });
    const fresh = join(createTestWorkspace(t).path, 'fresh.sqlite');
    for (const path of [fresh,f.path]) {
      const db = dispatcher.open(() => openDatabase(path));
      try {
        assert.equal(hasCommitDispatcher(db), true);
        assert.equal(dispatcher.inspectSynchronousWrites().connections, 1);
        assert.throws(() => transaction(db, () => db.exec('CREATE TABLE unrouted_probe(n)')), { code: 'unrouted_synchronous_write' });
      } finally { db.close(); }
      assert.equal(dispatcher.inspectSynchronousWrites().connections, 0);
    }
  });
}
test('local open fresh path initializes under IMMEDIATE at layout 29', async t => {
  const path = join(createTestWorkspace(t).path, 'fresh.sqlite');
  const { value, trace } = observeOpen(() => openMemoryCore({ path, raw: true, rawSearch: false })); await value.close();
  assert.ok(controls(trace).includes('BEGIN IMMEDIATE'));
  const db = new DatabaseSync(path);
  try { assert.equal(db.prepare('PRAGMA user_version').get().user_version, 29); }
  finally { db.close(); }
});
for (const broken of ['raw_deletion_effects','local_capture_binding_insert']) test(`local open invalid layout 29 refuses ${broken}`, async t => {
  const f = await localOpenFixture(t, 29), db = new DatabaseSync(f.path);
  db.exec(`DROP ${broken === 'raw_deletion_effects' ? 'TABLE' : 'TRIGGER'} ${broken}`); db.close();
  assert.throws(() => openDatabase(f.path), { code: 'unsupported_database' });
});

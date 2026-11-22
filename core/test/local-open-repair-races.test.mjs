import assert from 'node:assert/strict';
import { once } from 'node:events';
import { DatabaseSync } from 'node:sqlite';
import test from 'node:test';
import { Worker } from 'node:worker_threads';
import { LOCAL_RAW_PRIVACY_DDL } from '../content-safety-schema.mjs';
import { openDatabase } from '../database.mjs';
import { openMemoryCore } from '../index.mjs';
import { localOpenFixture } from './fixtures/local-open-tools.mjs';

test('R1: a privacy trigger swap still repairs the missing declaration', async t => {
  const { path, config } = await localOpenFixture(t, 29);
  const guard = 'local_raw_uuid_delete_guard';
  const enqueue = 'local_raw_uuid_fence_enqueue';
  const enqueueDDL = LOCAL_RAW_PRIVACY_DDL.find(sql => sql.startsWith(`CREATE TRIGGER IF NOT EXISTS ${enqueue} `));
  assert.ok(enqueueDDL);
  const writer = new DatabaseSync(path);
  const prepare = DatabaseSync.prototype.prepare;
  let swapped = false;
  try {
    writer.exec(`DROP TRIGGER ${enqueue}`);
    DatabaseSync.prototype.prepare = function(sql) {
      const statement = prepare.call(this, sql);
      if (this !== writer && /\bsqlite_master\b/.test(sql)) {
        const get = statement.get;
        statement.get = function(...bindings) {
          const result = get.apply(this, bindings);
          if (!swapped && bindings.includes(guard)) {
            writer.exec(`BEGIN IMMEDIATE; DROP TRIGGER ${guard}; ${enqueueDDL} COMMIT;`);
            swapped = true;
          }
          return result;
        };
      }
      return statement;
    };
    const opened = openMemoryCore(config);
    await opened.close();
    assert.equal(swapped, true, 'the swap ran at the privacy lookup');
    const hasTrigger = prepare.call(writer, "SELECT 1 FROM sqlite_master WHERE type='trigger' AND name=?");
    assert.ok(hasTrigger.get(guard), 'the opener restored the missing delete guard');
    assert.ok(hasTrigger.get(enqueue));
  } finally {
    DatabaseSync.prototype.prepare = prepare;
    writer.close();
  }
});

test('R4: a layout-29 open waits for an in-flight authority trigger repair', async t => {
  const { path } = await localOpenFixture(t, 29);
  const db = new DatabaseSync(path);
  let repair;
  try {
    assert.equal(db.prepare('PRAGMA journal_mode').get().journal_mode, 'delete');
    repair = db.prepare("SELECT sql FROM sqlite_master WHERE name='local_capture_binding_insert'").get().sql;
    db.exec('DROP TRIGGER local_capture_binding_insert');
  } finally { db.close(); }

  const release = new Int32Array(new SharedArrayBuffer(4));
  const writer = new Worker(`
    const { parentPort, workerData } = require('node:worker_threads');
    const { DatabaseSync } = require('node:sqlite');
    const { path, repair, release } = workerData;
    const db = new DatabaseSync(path, { timeout: 5000 });
    try {
      db.exec('BEGIN IMMEDIATE');
      db.exec(repair);
      parentPort.postMessage('reserved');
      Atomics.wait(release, 0, 0, 10000);
      // Give the opener time to enter SQLite's busy wait before committing.
      Atomics.wait(release, 0, 1, 50);
      db.exec('COMMIT');
    } finally { db.close(); }
  `, { eval: true, workerData: { path, repair, release } });
  const exited = new Promise(resolve => writer.once('exit', resolve));
  const exec = DatabaseSync.prototype.exec;
  const allowCommit = () => {
    Atomics.store(release, 0, 1);
    Atomics.notify(release, 0);
  };
  let opened;
  try {
    assert.deepEqual(await once(writer, 'message'), ['reserved']);
    DatabaseSync.prototype.exec = function(sql) {
      if (sql === 'BEGIN IMMEDIATE') allowCommit();
      return exec.call(this, sql);
    };
    assert.doesNotThrow(() => { opened = openDatabase(path, { busyTimeoutMs: 5000 }); },
      'the opener acquired the writer lock and revalidated the repaired layout');
  } finally {
    DatabaseSync.prototype.exec = exec;
    allowCommit();
    opened?.close();
    assert.equal(await exited, 0, 'the repair worker committed successfully');
  }
});

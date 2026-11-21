import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { lstatSync, renameSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { openDatabase, isStorageBusy } from '../database.mjs';
import { openMemoryCore } from '../contract.mjs';
import { storeIdentity } from '../store-fence.mjs';
import { eventTimeFixture } from '../testing/receipt-event-time-fixture.mjs';
import { copySqliteFixture } from '../testing/content-safety-s2h-fixture.mjs';
import { createTestWorkspace } from '../../tools/testing/workspace.mjs';
import { isWrite, traceOpen } from './fixtures/deferred-open-child.mjs';

const childFile = fileURLToPath(new URL('./fixtures/deferred-open-child.mjs', import.meta.url));
const controls = trace => trace.filter(row => /^(?:BEGIN|COMMIT|ROLLBACK)\b/.test(row.sql)).map(row => row.sql);
function deferredOnly(trace) {
  assert.deepEqual(controls(trace), ['BEGIN', 'COMMIT']);
  assert.equal(trace.filter(row => isWrite(row.sql)).length, 0);
  assert.ok(trace.filter(row => !/^PRAGMA foreign_keys/.test(row.sql) && !/^(?:BEGIN|COMMIT)$/.test(row.sql))
    .every(row => row.transaction), 'all open checks run in the snapshot');
}
function migrationTrace(trace) {
  assert.deepEqual(controls(trace), ['BEGIN', 'ROLLBACK', 'BEGIN IMMEDIATE', 'COMMIT']);
  const writes = trace.filter(row => isWrite(row.sql));
  assert.ok(writes.length > 0);
  assert.ok(writes.every(row => row.mode === 'BEGIN IMMEDIATE' && row.transaction));
}
function startChild(role, path) {
  const child = spawn(process.execPath, [childFile, role, path], { stdio: ['ignore', 'ignore', 'pipe', 'ipc'] });
  let stderr = '';
  child.stderr.on('data', data => { stderr += data; });
  const ended = new Promise((resolve, reject) => {
    child.once('error', reject);
    child.once('close', (code, signal) => resolve({ code, signal }));
  });
  const message = () => new Promise((resolve, reject) => {
    const timer = setTimeout(() => finish(() => reject(Error('child readiness timeout: ' + stderr))), 15000);
    const onMessage = value => finish(() => resolve(value));
    const onExit = () => finish(() => reject(Error('child exited before message: ' + stderr)));
    function finish(work) { clearTimeout(timer); child.off('message', onMessage); child.off('exit', onExit); work(); }
    child.once('message', onMessage); child.once('exit', onExit);
  });
  const ready = message();
  return { child, ready, message, async finish({ release = false } = {}) {
    if (release && child.connected) child.send('release', () => {});
    const timer = setTimeout(() => child.kill('SIGKILL'), 15000);
    try { const result = await ended; assert.deepEqual(result, { code: 0, signal: null }, stderr); }
    finally { clearTimeout(timer); }
  } };
}
function oldFixture(t) {
  const workspace = createTestWorkspace(t, { prefix: 'deferred-open-' });
  const path = join(workspace.path, 'store.sqlite');
  openDatabase(path).close();
  return { workspace, path };
}
function shape(path) {
  const db = new DatabaseSync(path);
  try {
    return {
      version: db.prepare('PRAGMA user_version').get().user_version,
      cookie: db.prepare('PRAGMA schema_version').get().schema_version,
      tables: db.prepare("SELECT name,sql FROM sqlite_schema WHERE type='table' ORDER BY name").all(),
      // Installation markers and populations must equal a single migration.
      markers: db.prepare("SELECT name FROM sqlite_schema WHERE name IN ('method_packages','assets','role_profiles','card_current_dependencies') ORDER BY name").all(),
      metadata: db.prepare('SELECT count(*) n FROM store_metadata').get().n,
    };
  } finally { db.close(); }
}

test('deferred ordinary open: layout 53 has one deferred BEGIN and no writes on its connection', async t => {
  const f = await eventTimeFixture(t, 33);
  const { db, trace } = traceOpen(() => openDatabase(f.path, { currentDependencies: true }));
  try {
    assert.equal(db.prepare('PRAGMA user_version').get().user_version, 53);
    t.diagnostic(JSON.stringify({ controls: controls(trace), writes: trace.filter(row => isWrite(row.sql)).length, statements: trace.length }));
    deferredOnly(trace);
  } finally { db.close(); }
});

test('deferred ordinary open: separate process holds RESERVED for eight seconds; public read succeeds within 500ms', async t => {
  const f = await eventTimeFixture(t, 33), holder = startChild('reserved', f.path);
  let core, failure, elapsed;
  try {
    assert.equal(await holder.ready, 'ready');
    const start = performance.now();
    try { core = openMemoryCore({ path: f.path }); } catch (error) { failure = error; }
    elapsed = performance.now() - start;
    t.diagnostic(JSON.stringify({ elapsedMs: elapsed, error: failure ? (isStorageBusy(failure) ? 'storage_busy' : failure.code) : null }));
    assert.equal(failure, undefined);
    assert.ok(elapsed < 500, `open took ${elapsed}ms`);
    const result = core.list({ namespace: { ownerId: 'synthetic', scope: 'personal', projectId: null } });
    assert.equal(result.ok, true, JSON.stringify(result));
    assert.equal(result.value.memories.length, 0);
  } finally { core?.close(); await holder.finish(); }
});

test('deferred ordinary open: old layout rolls back the probe and installs only under IMMEDIATE', t => {
  const f = oldFixture(t);
  const { db, trace } = traceOpen(() => openDatabase(f.path, { currentDependencies: true }));
  db.close();
  const result = shape(f.path);
  t.diagnostic(JSON.stringify({ controls: controls(trace), version: result.version, markers: result.markers }));
  assert.equal(result.version, 33);
  assert.equal(result.markers.length, 4);
  migrationTrace(trace);
});

test('deferred ordinary open: two separate migrating processes double-check and install exactly once', async t => {
  const f = oldFixture(t), control = join(f.workspace.path, 'single.sqlite');
  copySqliteFixture(f.path, control);
  const single = traceOpen(() => openDatabase(control, { currentDependencies: true })); single.db.close();
  const children = [startChild('migrate', f.path), startChild('migrate', f.path)];
  let results;
  try {
    assert.deepEqual(await Promise.all(children.map(child => child.ready)), ['ready', 'ready']);
    const messages = children.map(child => child.message());
    for (const { child } of children) child.send('go');
    results = await Promise.all(messages);
  } finally { await Promise.all(children.map(child => child.finish())); }
  assert.deepEqual(results.map(result => result.version), [33, 33]);
  assert.deepEqual(shape(f.path), shape(control));
  const writes = results.flatMap(result => result.trace.filter(row => isWrite(row.sql)).map(row => row.sql)).sort();
  assert.deepEqual(writes, single.trace.filter(row => isWrite(row.sql)).map(row => row.sql).sort(), 'exactly one migration worth of writes');
  assert.equal(writes.filter(sql => /CREATE TABLE card_current_dependencies\b/.test(sql)).length, 1);
  t.diagnostic(JSON.stringify({ controls: results.map(result => controls(result.trace)), version: 33, migrationCopies: 1, writes: writes.length }));
  for (const { trace } of results) assert.deepEqual(controls(trace), ['BEGIN', 'ROLLBACK', 'BEGIN IMMEDIATE', 'COMMIT']);
});

test('deferred ordinary open: fence pins and transaction identity checks still refuse replacement and wrong identity', async t => {
  const f = await eventTimeFixture(t, 33), stat = lstatSync(f.path, { bigint: true });
  let identity;
  const source = new DatabaseSync(f.path);
  try { identity = storeIdentity(source); } finally { source.close(); }
  const fence = { version: 'store-fence-v1', dev: String(stat.dev), ino: String(stat.ino), ...identity };
  const { db, trace } = traceOpen(() => openDatabase(f.path, { storeFence: fence })); db.close();
  // Check the assertions before the new transaction-kind expectation, so the
  // baseline run also exercises both unchanged refusal codes.
  for (const field of ['applicationId', 'userVersion', 'storeId']) {
    assert.throws(() => openDatabase(f.path, { storeFence: { ...fence, [field]: field === 'storeId' ? 'wrong-store' : fence[field] + 1 } }), { code: 'unsupported_database' });
  }
  const retained = join(f.workspace.path, 'retained.sqlite'); renameSync(f.path, retained);
  copySqliteFixture(retained, f.path);
  assert.throws(() => openDatabase(f.path, { storeFence: fence }), { code: 'unsafe_database_file' });
  assert.ok(trace.some(row => /SELECT store_id FROM store_metadata WHERE singleton=1/.test(row.sql) && row.transaction));
  t.diagnostic(JSON.stringify({ controls: controls(trace), identityAssertions: 3, replacementRefused: true }));
  deferredOnly(trace);
});

test('deferred ordinary open: EXCLUSIVE holder still delays the read snapshot (documentation)', async t => {
  const f = await eventTimeFixture(t, 33), holder = startChild('exclusive', f.path);
  let db;
  try {
    assert.equal(await holder.ready, 'ready');
    const start = performance.now(); db = openDatabase(f.path);
    t.diagnostic(JSON.stringify({ exclusiveWaitMs: performance.now() - start }));
  } finally { db?.close(); await holder.finish(); }
});

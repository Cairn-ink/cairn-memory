import test from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { existsSync, writeFileSync } from 'node:fs';
import { createTestWorkspace } from '../../../tools/testing/workspace.mjs';
import { createCommitDispatcher, bindCommitConnection, withSynchronousCommitScope, dispatchCommit } from '../../../core/commit-dispatch.mjs';
import { createMemoryRuntime } from '../../../core/runtime.mjs';
import { openMemoryCore } from '../../../core/contract.mjs';
import { fixture as sidecarFixture } from '../../../core/testing/context-read-fixture.mjs';
import { host as roleHost, ns as roleNs, publish, read } from '../../../core/test/role-fixture.mjs';
import { holdWriteLock, ns, ok } from './local-shared-support.mjs';

const waited = elapsed => assert.ok(elapsed >= 250 && elapsed < 5000, 'R2G_RARE_NATIVE_WAIT');
test('daemon-start schema/privacy install retains the 5s native wait', { timeout: 15000 }, async t => {
  const w = createTestWorkspace(t), path = join(w.path, 'startup.sqlite');
  openMemoryCore({ path, raw: false }).close();
  const lock = await holdWriteLock(t, path, 500), dispatcher = createCommitDispatcher({ strict: true });
  const start = performance.now();
  const core = dispatcher.open(() => openMemoryCore({ path, raw: true, rawSearch: false })); w.defer(() => core.close());
  waited(performance.now() - start);
  assert.deepEqual(await lock.exited, [0, null]);
  assert.ok(dispatcher.inspectBusyTimeouts().every(value => value === 5000), 'R2G_TIMEOUT_RESTORE');
  ok(await dispatcher.run(() => core.list({ namespace: ns })));
});

// Arrange a *process-owned* lock precisely at the first schema transaction,
// including a repair-created replacement file. Handshake files are ordinary
// fixture files; the database and journals are opened only by node:sqlite.
function lockNextSidecarBegin(t, directory, path) {
  const go = join(directory, 'go'), ready = join(directory, 'locked');
  const child = spawn(process.execPath, ['--input-type=module', '-e', `
    import { existsSync, writeFileSync } from 'node:fs';
    import { DatabaseSync } from 'node:sqlite';
    const [path, go, ready] = process.argv.slice(1);
    const until = Date.now() + 10000;
    while (!existsSync(go)) { if (Date.now() > until) process.exit(2); Atomics.wait(new Int32Array(new SharedArrayBuffer(4)),0,0,5); }
    const db = new DatabaseSync(path); db.exec('BEGIN IMMEDIATE'); writeFileSync(ready, 'locked');
    setTimeout(() => { db.exec('ROLLBACK'); db.close(); }, 500);
  `, path, go, ready], { stdio: ['ignore', 'ignore', 'ignore'] });
  const exited = once(child, 'exit'); exited.catch(() => {});
  t.after(async () => { if (child.exitCode === null && child.signalCode === null) child.kill('SIGTERM'); await exited; });
  const original = DatabaseSync.prototype.exec; let armed = true;
  DatabaseSync.prototype.exec = function(sql) {
    if (armed && sql === 'BEGIN IMMEDIATE') {
      armed = false; writeFileSync(go, 'go');
      const end = performance.now() + 10000;
      while (!existsSync(ready)) {
        if (performance.now() >= end) throw Error('synthetic_sidecar_lock_not_acquired');
        Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 5);
      }
    }
    return Reflect.apply(original, this, [sql]);
  };
  return { exited, restore: () => { DatabaseSync.prototype.exec = original; }, armed: () => armed };
}
for (const repair of [false, true]) test(`sidecar ${repair ? 'repair/reopen' : 'create'} retains its native wait`, { timeout: 15000 }, async t => {
  const f = sidecarFixture(t), dispatcher = createCommitDispatcher({ strict: true });
  // The fixture's observer is a retained read-only canonical handle.
  f.db.exec('PRAGMA busy_timeout=5000'); dispatcher.open(() => bindCommitConnection(f.db));
  const path = f.path + '.context-read-v1.sqlite';
  if (repair) {
    f.index().close();
    const damaged = new DatabaseSync(path); damaged.exec('PRAGMA user_version=0'); damaged.close();
  }
  const lock = lockNextSidecarBegin(t, f.workspace.path, path);
  let index; const start = performance.now();
  try { index = f.index(); } finally { lock.restore(); }
  waited(performance.now() - start); assert.equal(lock.armed(), false);
  assert.deepEqual(await lock.exited, [0, null]);
  assert.ok(index);
  assert.ok(dispatcher.inspectBusyTimeouts().every(value => value === 5000), 'R2G_TIMEOUT_RESTORE');
});

test('lazy Card storage init retains native waiting outside a dispatched maintenance claim', { timeout: 15000 }, async t => {
  const w = createTestWorkspace(t), path = join(w.path, 'lazy.sqlite'), dispatcher = createCommitDispatcher({ strict: true });
  const runtime = dispatcher.open(() => createMemoryRuntime({ path }, { engineCards: true }));
  w.defer(() => runtime.close());
  const writer = openMemoryCore({ path, raw: false });
  try { ok(writer.admit({ namespace: ns, memory: { content: 'Synthetic lazy Card source', kind: 'fact' },
    receipts: [{ client: 'synthetic', sessionId: 'lazy', eventId: 'source', role: 'user', excerpt: 'Synthetic lazy source' }] })); }
  finally { writer.close(); }
  const storage = await runtime.engineCardStorage();
  const cluster = { key: 'synthetic-lazy-cluster', memories: storage.snapshot(ns, 16, () => {}).memories };
  assert.equal(cluster.memories.length, 1);
  const lock = await holdWriteLock(t, path, 500), start = performance.now();
  const attempt = withSynchronousCommitScope('lazy Card storage init', () => storage.claim(ns, cluster, new Date().toISOString(), () => {}));
  waited(performance.now() - start); assert.ok(attempt);
  assert.deepEqual(await lock.exited, [0, null]);
  assert.deepEqual(dispatcher.inspectBusyTimeouts(), [5000], 'R2G_TIMEOUT_RESTORE');
  // This fixture deliberately exercises the approved synchronous scope. The
  // production claim below exercises migration inside dispatched attempts.
});

test('read_role_task_context synchronous reconciliation retains its native wait', { timeout: 15000 }, async t => {
  const w = createTestWorkspace(t), path = join(w.path, 'role.sqlite'), h = roleHost(), dispatcher = createCommitDispatcher({ strict: true });
  const core = dispatcher.open(() => openMemoryCore({ path, raw: false, methodPackages: h.methods, assets: h.assets,
    contextRead: h.context, roleProfiles: h.options })); w.defer(() => core.close());
  ok(await dispatcher.run(() => core.publishRoleProfileRelease(publish(), {})));
  ok(await dispatcher.run(() => core.admit({ namespace: roleNs, memory: { content: 'Synthetic finance evidence', kind: 'fact' },
    receipts: [{ client: 'synthetic', sessionId: 'role', eventId: 'seed', role: 'user', excerpt: 'Synthetic finance evidence' }] })));
  const input = { ...read(), task: 'finance', deadlineMs: 5000 };
  ok(await dispatcher.run(() => withSynchronousCommitScope('read_role_task_context', () => core.readRoleTaskContext(input, {}))));
  // Advance canonical sequence so this role read must reconcile a checkpoint.
  ok(await dispatcher.run(() => core.admit({ namespace: roleNs, memory: { content: 'Synthetic finance changed evidence', kind: 'fact' },
    receipts: [{ client: 'synthetic', sessionId: 'role', eventId: 'changed', role: 'user', excerpt: 'Synthetic finance changed evidence' }] })));
  const lock = await holdWriteLock(t, path + '.context-read-v1.sqlite', 500), start = performance.now();
  ok(await dispatcher.run(() => withSynchronousCommitScope('read_role_task_context', () => core.readRoleTaskContext(input, {}))));
  waited(performance.now() - start); assert.deepEqual(await lock.exited, [0, null]);
  assert.ok(dispatcher.inspectBusyTimeouts().every(value => value === 5000), 'R2G_TIMEOUT_RESTORE');
});

test('item 8: production lazy Card claim retries its migration and leaves a complete layout', { timeout: 15000 }, async t => {
  const w = createTestWorkspace(t), path = join(w.path, 'production-lazy.sqlite');
  const seed = openMemoryCore({ path, raw: false });
  try { ok(seed.admit({ namespace: ns, memory: { content: 'Synthetic lazy Card source', kind: 'fact' },
    receipts: [{ client: 'synthetic', sessionId: 'lazy', eventId: 'source', role: 'user', excerpt: 'Synthetic lazy Card source' }] })); }
  finally { seed.close(); }
  let backoffs = 0;
  const dispatcher = createCommitDispatcher({ strict: true, onBackoff() { backoffs++; } });
  const runtime = dispatcher.open(() => createMemoryRuntime({ path }, { engineCards: true }));
  w.defer(() => runtime.close());
  const storage = await runtime.engineCardStorage();
  const memories = storage.snapshot(ns, 16, () => {}).memories;
  assert.equal(memories.length, 1, 'claim uses one real retained receipt source');
  const before = new DatabaseSync(path, { readOnly: true });
  try { assert.equal(before.prepare('PRAGMA user_version').get().user_version, 18, 'snapshot must leave migration lazy'); }
  finally { before.close(); }
  const lock = await holdWriteLock(t, path, 400);
  const attempt = await dispatchCommit(storage, () => storage.claim(ns,
    { key: 'synthetic-dispatched-cluster', memories }, new Date().toISOString(), () => {}));
  assert.ok(attempt); assert.ok(backoffs > 0);
  assert.deepEqual(await lock.exited, [0, null]);
  const observer = new DatabaseSync(path, { readOnly: true });
  try {
    assert.equal(observer.prepare('PRAGMA user_version').get().user_version, 23);
    assert.ok(observer.prepare("SELECT 1 FROM sqlite_master WHERE name='card_applicability_reviews'").get());
    assert.ok(observer.prepare("SELECT 1 FROM sqlite_master WHERE name='card_mocs'").get());
  } finally { observer.close(); }
  assert.equal(dispatcher.inspectSynchronousWrites().count, 0);
});

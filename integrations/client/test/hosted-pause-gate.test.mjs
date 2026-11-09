import test from 'node:test';
import assert from 'node:assert/strict';
import fsPromises from 'node:fs/promises';
import { syncBuiltinESMExports } from 'node:module';
import { mkdir, open, readFile, readdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { fileURLToPath } from 'node:url';
import { createTestWorkspace } from '../../../tools/testing/workspace.mjs';
import * as pause from '../hosted-pause.mjs';
import { hostedTargetId } from '../transport-hosted.mjs';
import { withWriteObserver } from '../private-state.mjs';
import { withFileLock } from '../file-lock.mjs';
import { readControlState, startIfActive } from '../control-state.mjs';

const active = { paused: false, generation: 0, enforced: true };
const paused = { paused: true, generation: 1, enforced: true };
async function fixture(t) {
  const ws = createTestWorkspace(t), root = join(ws.path, 'state');
  await mkdir(root, { mode: 0o700 });
  const config = { root, endpoint: 'http://127.0.0.1:1' };
  let remote = active;
  t.mock.method(globalThis, 'fetch', async () => Response.json(remote));
  const observe = () => pause.observeHostedPause(config, 'synthetic-token');
  await observe();
  const file = join(root, 'hosted-pause', hostedTargetId(config) + '.json');
  return { config, file, remote: value => { remote = value; }, observe };
}
async function gate(config, generation, work) {
  // An absent gate at the pre-change revision is an actual unguarded dispatch.
  return pause.withHostedPauseGate ? pause.withHostedPauseGate(config, generation, work) : work();
}
async function failedRotation(t, f) {
  const held = Promise.withResolvers(), release = Promise.withResolvers();
  const holder = withFileLock(join(f.config.root, 'control.lock'), async () => {
    held.resolve(); await release.promise;
  });
  t.after(async () => { release.resolve(); await holder; });
  await held.promise;
  f.remote(paused);
  await assert.rejects(f.observe(), /control_busy/);
  release.resolve(); await holder;
}

test('a failed rotation retains the durable intent and denies dispatch before its side effect', { timeout: 10000 }, async t => {
  const f = await fixture(t);
  await failedRotation(t, f);
  let starts = 0;
  await assert.rejects(gate(f.config, 0, () => { starts++; }), /pause_unavailable/);
  assert.equal(starts, 0, 'intent_checked_before_dispatch');
  const records = await readdir(f.file + '.intents');
  assert.deepEqual(records.filter(name => name.endsWith('.json')), ['1.true.json']);
  assert.deepEqual(JSON.parse(await readFile(join(f.file + '.intents', '1.true.json'), 'utf8')),
    { generation: 1, paused: true });
});

test('a failed pause publication retains the intent even if rename made the new bytes visible', { timeout: 10000 }, async t => {
  const f = await fixture(t);
  const handle = await open(join(f.config.root, 'probe'), 'wx', 0o600);
  const prototype = Object.getPrototypeOf(handle), sync = prototype.sync;
  await handle.close();
  const paths = new WeakMap(), nativeOpen = fsPromises.open;
  const openMock = t.mock.method(fsPromises, 'open', async function (path, ...args) {
    const file = await nativeOpen.call(this, path, ...args); paths.set(file, String(path)); return file;
  });
  syncBuiltinESMExports();
  let failed = false;
  const syncMock = t.mock.method(prototype, 'sync', async function () {
    // Fail the actual publication-directory sync after rename, independent of
    // how many intent/rotation/diagnostic syncs precede it in either revision.
    if (!failed && paths.get(this) === dirname(f.file) &&
        JSON.parse(await readFile(f.file, 'utf8')).generation === 1) {
      failed = true; throw new Error('synthetic_publication_failure');
    }
    return sync.call(this);
  });
  const restore = () => { syncMock.mock.restore(); openMock.mock.restore(); syncBuiltinESMExports(); };
  t.after(restore);
  f.remote({ ...paused, paused: false });
  await assert.rejects(f.observe(), /synthetic_publication_failure/);
  assert.deepEqual(JSON.parse(await readFile(f.file, 'utf8')), { ...paused, paused: false },
    'new_publication_visible_before_sync_failure');
  assert.notEqual((await readControlState(f.config.root)).generation, 'initial', 'rotation_completed_before_publication');
  let starts = 0;
  await assert.rejects(gate(f.config, 1, () => { starts++; }), /pause_unavailable/);
  assert.equal(starts, 0);
  restore();
  await f.observe();
  await gate(f.config, 1, () => { starts++; });
  assert.equal(starts, 1, 'repair_completes_publication_before_dispatch');
});

test('resume keeps the hosted generation and only unblocks after publication', { timeout: 10000 }, async t => {
  const f = await fixture(t);
  f.remote(paused); await f.observe();
  const local = await readControlState(f.config.root);
  let starts = 0;
  await assert.rejects(gate(f.config, 1, () => { starts++; }), /pause_unavailable/);
  f.remote({ ...paused, paused: false });
  const published = Promise.withResolvers(), release = Promise.withResolvers();
  t.after(() => release.resolve());
  const resuming = withWriteObserver(async ({ path, kind }) => {
    if (kind === 'write' && path === f.file) { published.resolve(); await release.promise; }
  }, f.observe);
  resuming.catch(() => {});
  await published.promise;
  await assert.rejects(gate(f.config, 1, () => { starts++; }), /pause_unavailable/,
    'visible_resume_without_completion_is_not_authority');
  release.resolve(); await resuming;
  assert.equal((await readControlState(f.config.root)).generation, local.generation);
  await gate(f.config, 1, () => { starts++; });
  assert.equal(starts, 1);
  await assert.rejects(gate(f.config, 0, () => { starts++; }), /pause_unavailable/);
});

for (const generation of [0, 1]) test(`unchanged validated generation ${generation} adds zero fsyncs before deferred diagnostics`, async t => {
  const f = await fixture(t);
  if (generation) { f.remote({ ...active, generation }); await f.observe(); }
  const handle = await open(join(f.config.root, 'probe'), 'wx', 0o600);
  const prototype = Object.getPrototypeOf(handle), sync = prototype.sync;
  await handle.close();
  let syncs = 0;
  t.mock.method(prototype, 'sync', async function () { syncs++; return sync.call(this); });
  const observation = pause.deferHostedPauseStatus(f.config, 'synthetic-token');
  await observation.observe(); await observation.observe();
  assert.equal(syncs, 0, 'unchanged_prefetch_fsyncs');
  const prefetchSyncs = syncs;
  await observation.publish();
  assert.equal(syncs, 2, 'diagnostic_publication_still_durable');
  t.diagnostic(JSON.stringify({ generation, prefetchSyncs, totalSyncs: syncs }));
});

test('an intent survives a process crash before rotation and blocks a stale process', { timeout: 15000 }, async t => {
  const f = await fixture(t);
  const before = await readControlState(f.config.root);
  const server = createServer((request, response) => { request.resume(); response.end(JSON.stringify(paused)); });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => { server.closeAllConnections(); server.close(); });
  // Keep the target ID fixed while using loopback for the child observation.
  const endpoint = `http://127.0.0.1:${server.address().port}`;
  const config = { root: f.config.root, endpoint };
  // Prime the exact target the child will revoke. An absent publication would
  // independently deny dispatch and would not prove that the intent survived.
  await pause.observeHostedPause(config, 'synthetic-token');
  const pauseFile = join(config.root, 'hosted-pause', hostedTargetId(config) + '.json');
  const child = spawn(process.execPath, [fileURLToPath(new URL('./fixtures/pause-intent-crash.mjs', import.meta.url)),
    config.root, endpoint], { stdio: ['ignore', 'pipe', 'pipe', 'ipc'] });
  const done = new Promise((resolve, reject) => {
    child.once('error', reject); child.once('close', (code, signal) => resolve({ code, signal }));
  });
  t.after(async () => { if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL'); await done; });
  const event = await new Promise((resolve, reject) => {
    child.once('message', resolve); child.once('close', () => reject(new Error('child_died_before_intent')));
  });
  assert.equal(event.kind, 'intent-durable');
  child.kill('SIGKILL');
  assert.equal((await done).signal, 'SIGKILL');
  assert.equal((await readControlState(config.root)).generation, before.generation, 'crashed_before_rotation');
  assert.deepEqual(JSON.parse(await readFile(pauseFile, 'utf8')), active, 'older_publication_still_active');
  let starts = 0;
  await assert.rejects(gate(config, 0, () => { starts++; }), /pause_unavailable/);
  assert.equal(starts, 0);
  f.remote(paused); await pause.observeHostedPause(config, 'synthetic-token');
  f.remote({ ...paused, paused: false }); await pause.observeHostedPause(config, 'synthetic-token');
  assert.deepEqual((await readdir(pauseFile + '.intents')).sort(),
    ['1.false.complete', '1.false.json'], 'bounded_recovery_files_after_real_crash');
});


test('the last local guard re-reads an intent after an asynchronous wait', { timeout: 10000 }, async t => {
  const f = await fixture(t);
  const entered = Promise.withResolvers(), finalCheck = Promise.withResolvers();
  t.after(() => finalCheck.resolve());
  let starts = 0;
  const pending = gate(f.config, 0, guard => startIfActive(f.config.root, 'initial', () => { starts++; }, {
    guard: async () => { entered.resolve(); await finalCheck.promise; await guard?.(); },
  }));
  const denied = assert.rejects(pending, /pause_unavailable/);
  denied.catch(() => {});
  await Promise.race([entered.promise, pending.then(() => { throw new Error('local_guard_missing'); })]);
  f.remote(paused);
  const durable = Promise.withResolvers(), continueObservation = Promise.withResolvers();
  t.after(() => continueObservation.resolve());
  const observing = withWriteObserver(async ({ path, kind }) => {
    if (kind === 'write' && path.endsWith('/1.true.json')) {
      durable.resolve(); await continueObservation.promise;
    }
  }, f.observe);
  observing.catch(() => {});
  await durable.promise;
  finalCheck.resolve(); await denied;
  assert.equal(starts, 0);
  continueObservation.resolve(); await observing;
});

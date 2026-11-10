import { deferred as createDeferred } from '../../../tools/testing/deferred.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { syncBuiltinESMExports } from 'node:module';
import { join } from 'node:path';
import { createTestWorkspace } from '../../../tools/testing/workspace.mjs';
import { observeHostedPause, withHostedPauseGate } from '../hosted-pause.mjs';
import { hostedTargetId } from '../transport-hosted.mjs';
import { readControlState, startIfActive, runIfActive } from '../control-state.mjs';
import { withWriteObserver } from '../private-state.mjs';

for (const sink of ['request', 'output']) test(`intent committed after final journal selection denies ${sink}`, { timeout: 10000 }, async t => {
  const root = join(createTestWorkspace(t).path, 'state');
  await fs.mkdir(root, {mode:0o700});
  const config = {root, endpoint:'http://127.0.0.1:1'};
  let remote = {paused:false, generation:1, enforced:true};
  t.mock.method(globalThis, 'fetch', async () => Response.json(remote));
  await observeHostedPause(config, 'synthetic-token');
  const local = await readControlState(root);
  const selected = createDeferred(), release = createDeferred(), durable = createDeferred();
  t.after(() => release.resolve());
  const originalOpen = fs.open;
  let completionReads = 0, selectedFinal = false, gatePresent = false, publicationAttempts = 0;
  const originalLink = fs.link;
  const linkMock = t.mock.method(fs, 'link', async function(source,destination) {
    if(selectedFinal && String(destination).endsWith('/hosted-pause.gate'))publicationAttempts++;
    return originalLink.call(this,source,destination);
  });
  const mocked = t.mock.method(fs, 'open', async function(path, ...args) {
    const handle = await originalOpen.call(this, path, ...args);
    // Outer check reads first; the second read is after selection inside the
    // final guard, with control.lock already held. Hold the read resolution.
    if (String(path).endsWith('/1.false.complete') && ++completionReads === 2) {
      assert.ok(await fs.stat(join(root, 'control.lock')));
      gatePresent = await fs.stat(join(root, 'hosted-pause.gate')).then(()=>true,()=>false);
      selectedFinal = true; selected.resolve(); await release.promise;
    }
    return handle;
  });
  syncBuiltinESMExports();
  t.after(() => {mocked.mock.restore(); linkMock.mock.restore(); syncBuiltinESMExports();});
  let starts=0;
  const work = guard => sink==='request'
    ? startIfActive(root, local.generation, () => {starts++;}, {guard})
    : runIfActive(root, local.generation, () => {starts++;}, {guard});
  const dispatch = withHostedPauseGate(config,1,work);
  const settled = dispatch.then(value=>({value}),error=>({error}));
  await Promise.race([selected.promise, settled.then(()=>{throw new Error('final_selection_not_reached');})]);
  remote={paused:true,generation:2,enforced:true};
  const observing=withWriteObserver(async ({path,kind})=>{
    if (kind==='write' && (path.endsWith('/2.true.json') || path.includes('/hosted-pause-pending/'))) durable.resolve();
  },()=>observeHostedPause(config,'synthetic-token'));
  const observationResult=observing.then(value=>({value}),error=>({error}));
  await durable.promise;
  release.resolve();
  const result=await settled;
  assert.equal(starts,0,'no_side_effect_after_durable_intent');
  assert.match(result.error?.message ?? '',/pause_unavailable/);
  assert.ok(gatePresent,'final_selection_inside_shared_gate');
  assert.ok(publicationAttempts>0,'intent_writer_attempted_shared_gate');
  await observationResult;
});

for (const sink of ['request', 'output']) test(`a cross-target publication fences the final ${sink} check`, { timeout: 10000 }, async t => {
  const root = join(createTestWorkspace(t).path, 'state'); await fs.mkdir(root, { mode: 0o700 });
  const a = { root, endpoint: 'http://127.0.0.1:1' }, b = { root, endpoint: 'http://127.0.0.1:2' };
  const active = { paused: false, generation: 0, enforced: true };
  // This race isolates ordering. Disk sync latency must not hide the old gap
  // by expiring its gate window first; crash suites exercise actual fsyncs.
  const probe = await fs.open(join(root, 'probe'), 'wx', 0o600);
  const sync = t.mock.method(Object.getPrototypeOf(probe), 'sync', async () => {});
  await probe.close(); t.after(() => sync.mock.restore());
  let revoked = false;
  t.mock.method(globalThis, 'fetch', async url => Response.json(revoked && url.startsWith(a.endpoint + '/')
    ? { paused: true, generation: 1, enforced: true } : active));
  await observeHostedPause(a, 'synthetic-token'); await observeHostedPause(b, 'synthetic-token');
  const entered = createDeferred(), release = createDeferred(), durable = createDeferred();
  let held = false, starts = 0;
  const original = fs.open;
  const mock = t.mock.method(fs, 'open', async function(path, ...args) {
    const handle = await original.call(this, path, ...args);
    if (!held && String(path) === join(root, 'hosted-pause', hostedTargetId(b) + '.json') &&
        await fs.stat(join(root, 'control.lock')).then(() => true, () => false)) {
      held = true; entered.resolve(); await release.promise;
    }
    return handle;
  });
  syncBuiltinESMExports();
  let observing;
  const dispatch = withHostedPauseGate(b, 0, guard => sink === 'request'
    ? startIfActive(root, 'initial', () => { starts++; }, { guard })
    : runIfActive(root, 'initial', () => { starts++; }, { guard }));
  const settled = dispatch.then(value => ({ value }), error => ({ error }));
  t.after(async () => { release.resolve(); await Promise.allSettled([dispatch, observing]); mock.mock.restore(); syncBuiltinESMExports(); });
  await Promise.race([entered.promise, settled.then(() => { throw new Error('final_check_not_reached'); })]);
  revoked = true;
  observing = withWriteObserver(async ({ path, kind }) => {
    if (kind === 'write' && (path.endsWith('/1.true.json') || path.includes('/hosted-pause-pending/'))) durable.resolve();
  }, () => observeHostedPause(a, 'synthetic-token'));
  observing.catch(() => {});
  await durable.promise; release.resolve();
  await settled; await observing;
  assert.equal(starts, 0, 'root_publication_fences_other_target');
});


// An aged publication waiter is overtaken by a young gate
// holder. Synthetic clock values isolate ordering from shared-machine timing.
for (const sink of ['request', 'output']) test(`an aged publisher fences a younger final ${sink} gate after a handoff`, { timeout: 15000 }, async t => {
  const { AsyncLocalStorage } = await import('node:async_hooks');
  const { stateLock } = await import('../state-lock.mjs');
  const scope = new AsyncLocalStorage();
  const root = join(createTestWorkspace(t).path, 'state');
  await fs.mkdir(root, { mode: 0o700 });
  const a = { root, endpoint: 'http://127.0.0.1:1' }, b = { root, endpoint: 'http://127.0.0.1:2' };
  let revoked = false;
  t.mock.method(globalThis, 'fetch', async url => Response.json(revoked && url.startsWith(a.endpoint + '/')
    ? { paused: true, generation: 1, enforced: true } : { paused: false, generation: 0, enforced: true }));
  await observeHostedPause(a, 'synthetic-token');
  await observeHostedPause(b, 'synthetic-token');
  let delivered = false;
  const finish = createDeferred();
  const before = await withHostedPauseGate(b, 0, guard => startIfActive(root, 'initial',
    () => finish.promise.then(() => { delivered = true; }), { guard }));
  assert.equal(before.started, true, 'operation_admitted_before_publication');
  let clock = 0;
  t.mock.method(performance, 'now', () => clock);
  const gate = join(root, 'hosted-pause.gate');
  const held = createDeferred(), releaseOld = createDeferred();
  const waiter = createDeferred(), releaseWaiter = createDeferred();
  const selected = createDeferred(), releaseFinal = createDeferred();
  const durable = createDeferred(), continuePublisher = createDeferred();
  let publisher, sender, hits = 0, starts = 0;
  const nativeLink = fs.link, nativeOpen = fs.open;
  const linkMock = t.mock.method(fs, 'link', async function(source, destination) {
    try { return await nativeLink.call(this, source, destination); }
    catch (error) {
      if (scope.getStore() === 'publisher' && destination === gate && error.code === 'EEXIST' && hits++ === 0) {
        waiter.resolve(); await releaseWaiter.promise;
      }
      throw error;
    }
  });
  let finalHeld = false;
  const openMock = t.mock.method(fs, 'open', async function(path, ...args) {
    const handle = await nativeOpen.call(this, path, ...args);
    if (scope.getStore() === 'sender' && !finalHeld && String(path) === join(root, 'hosted-pause', hostedTargetId(b) + '.json') &&
        await fs.stat(join(root, 'control.lock')).then(() => true, () => false)) {
      finalHeld = true; selected.resolve(); await releaseFinal.promise;
    }
    return handle;
  });
  syncBuiltinESMExports();
  const old = stateLock(gate, async () => { held.resolve(); await releaseOld.promise; });
  t.after(async () => {
    releaseOld.resolve(); releaseWaiter.resolve(); releaseFinal.resolve(); continuePublisher.resolve();
    await Promise.allSettled([old, publisher, sender]);
    openMock.mock.restore(); linkMock.mock.restore(); syncBuiltinESMExports();
  });
  await held.promise;
  revoked = true;
  publisher = scope.run('publisher', () => withWriteObserver(async ({ path, kind }) => {
    if (kind === 'write' && (path.endsWith('/1.true.json') || path.includes('/hosted-pause-pending/'))) { durable.resolve(); await continuePublisher.promise; }
  }, () => observeHostedPause(a, 'synthetic-token')));
  publisher.catch(() => {});
  await waiter.promise; // P has a 250 ms deadline, starting at synthetic time 0.
  clock = 200; releaseOld.resolve(); await old;
  sender = scope.run('sender', () => withHostedPauseGate(b, 0,
    guard => sink === 'request'
      ? startIfActive(root, 'initial', () => { starts++; }, { guard })
      : runIfActive(root, 'initial', () => { starts++; }, { guard })));
  sender.catch(() => {});
  await selected.promise; // W's final pending check finished; W deadline is 450.
  clock = 251; releaseWaiter.resolve();
  await durable.promise; // P has timed out and journaled outside W's held gate.
  assert.equal((await readControlState(root)).generation, 'initial', 'revocation_still_unrotated');
  releaseFinal.resolve();
  const result = await sender.then(value => ({ value }), error => ({ error }));
  finish.resolve(); await before.operation;
  assert.equal(delivered, true, 'already_started_operation_finishes_after_publication');
  continuePublisher.resolve(); await publisher;
  t.diagnostic(JSON.stringify({ publisherDeadline: 250, holderEntered: 200, holderDeadline: 450,
    durablePublicationAndDispatch: 251, starts }));
  assert.equal(starts, 0, 'aged_publication_must_fence_younger_holder');
  assert.match(result.error?.message ?? '', /pause_unavailable/);
});

for (const sink of ['request', 'output']) test(`a cross-process aged publisher fences a younger ${sink} holder`, { timeout: 30000 }, async t => {
  const { fork } = await import('node:child_process');
  const { stateLock } = await import('../state-lock.mjs');
  const root = join(createTestWorkspace(t).path, 'state');
  await fs.mkdir(root, { mode: 0o700 });
  const a = { root, endpoint: 'http://127.0.0.1:1' }, b = { root, endpoint: 'http://127.0.0.1:2' };
  t.mock.method(globalThis, 'fetch', async () => Response.json({ paused: false, generation: 0, enforced: true }));
  await observeHostedPause(a, 'synthetic-token'); await observeHostedPause(b, 'synthetic-token');
  const finish = createDeferred(); let delivered = false;
  const before = await withHostedPauseGate(b, 0, guard => startIfActive(root, 'initial',
    () => finish.promise.then(() => { delivered = true; }), { guard }));
  assert.equal(before.started, true);
  const children = [];
  function launch(role) {
    const child = fork(new URL('./fixtures/pause-handoff.mjs', import.meta.url), [role, root, sink],
      { stdio: ['ignore', 'ignore', 'pipe', 'ipc'] });
    const messages = new Map(), waiting = new Map(); let stderr = '';
    const done = new Promise((resolve, reject) => {
      child.once('error', reject); child.once('close', (code, signal) => resolve({ code, signal }));
    });
    child.stderr.on('data', bytes => { stderr += bytes; });
    child.on('message', message => { messages.set(message.kind, message); waiting.get(message.kind)?.resolve(message); });
    const event = kind => {
      if (messages.has(kind)) return Promise.resolve(messages.get(kind));
      const deferred = createDeferred(); waiting.set(kind, deferred);
      return Promise.race([deferred.promise, done.then(() => { throw new Error('handoff_child_closed_before_' + kind); })]);
    };
    const send = (kind, time) => child.send({ kind, time });
    const result = { child, done, event, send, stderr: () => stderr }; children.push(result); return result;
  }
  const held = createDeferred(), release = createDeferred();
  const old = stateLock(join(root, 'hosted-pause.gate'), async () => { held.resolve(); await release.promise; });
  t.after(async () => {
    release.resolve(); finish.resolve();
    for (const { child } of children) if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL');
    await Promise.allSettled([old, ...children.map(child => child.done)]);
  });
  await held.promise;
  const publisher = launch('publisher'); await publisher.event('waiter');
  release.resolve(); await old;
  const sender = launch('sender'); await sender.event('selected');
  publisher.send('release-waiter', 251); await publisher.event('durable');
  assert.equal((await readControlState(root)).generation, 'initial', 'publication_precedes_rotation');
  sender.send('release-final', 251);
  const result = await sender.event('done');
  finish.resolve(); await before.operation;
  publisher.send('continue-publisher', 251); await publisher.event('done');
  for (const child of children) {
    assert.deepEqual(await child.done, { code: 0, signal: null }); assert.equal(child.stderr(), '');
  }
  assert.equal(delivered, true, 'already_started_operation_finishes_after_publication');
  assert.equal(result.starts, 0, 'aged_publication_must_fence_younger_holder');
  assert.equal(result.error, 'pause_unavailable');
});

for (const sink of ['request', 'output']) test(`the final root read and ${sink} start share one synchronous turn`, { timeout: 15000 }, async t => {
  const { default: syncFs } = await import('node:fs');
  const { randomUUID } = await import('node:crypto');
  const root = join(createTestWorkspace(t).path, 'state'); await fs.mkdir(root, { mode: 0o700 });
  const config = { root, endpoint: 'http://127.0.0.1:1' };
  t.mock.method(globalThis, 'fetch', async () => Response.json({ paused: false, generation: 1, enforced: true }));
  await observeHostedPause(config, 'synthetic-token');
  const local = await readControlState(root), rotation = join(root, 'hosted-pause-rotation.json');
  const originalOpen = syncFs.openSync, originalRead = syncFs.readFileSync, originalClose = syncFs.closeSync;
  const paths = new Map(); let rereads = 0, published = false, starts = 0, startedBeforePublication = false;
  // Publication is queued precisely after the final synchronous root read.
  // An await inserted before start/write lets this durable rename overtake it.
  const openMock = t.mock.method(syncFs, 'openSync', function (path, ...args) {
    const fd = originalOpen.call(this, path, ...args); paths.set(fd, String(path)); return fd;
  });
  const closeMock = t.mock.method(syncFs, 'closeSync', function (fd) {
    paths.delete(fd); return originalClose.call(this, fd);
  });
  const readMock = t.mock.method(syncFs, 'readFileSync', function (fd, ...args) {
    const bytes = originalRead.call(this, fd, ...args);
    if (paths.get(fd) === rotation && ++rereads === 1) queueMicrotask(() => {
      const temporary = rotation + '.synthetic';
      const file = originalOpen(temporary, 'wx', 0o600);
      try { syncFs.writeFileSync(file, randomUUID()); syncFs.fsyncSync(file); } finally { originalClose(file); }
      syncFs.renameSync(temporary, rotation);
      const directory = originalOpen(root, 'r');
      try { syncFs.fsyncSync(directory); } finally { originalClose(directory); }
      published = true;
    });
    return bytes;
  });
  syncBuiltinESMExports();
  t.after(() => { readMock.mock.restore(); closeMock.mock.restore(); openMock.mock.restore(); syncBuiltinESMExports(); });
  const start = () => { starts++; startedBeforePublication = !published; };
  await withHostedPauseGate(config, 1, guard => sink === 'request'
    ? startIfActive(root, local.generation, start, { guard }) : runIfActive(root, local.generation, start, { guard }));
  assert.equal(rereads, 1, 'synchronous_root_reread_required');
  assert.equal(published, true, 'real_durable_publication_executed');
  assert.equal(starts, 1, 'operation_started_before_publication_is_delivered');
  assert.equal(startedBeforePublication, true, 'no_await_between_root_read_and_side_effect');
});

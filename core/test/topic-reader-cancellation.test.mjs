import assert from 'node:assert/strict';
import test from 'node:test';
import { DatabaseSync } from 'node:sqlite';
import threads, { MessageChannel } from 'node:worker_threads';
import { syncBuiltinESMExports } from 'node:module';
import { chmodSync } from 'node:fs';
import { join } from 'node:path';
import { setImmediate as turn } from 'node:timers/promises';
import { openMemoryReader } from '../memory-reader.mjs';
import { STORAGE_BUSY_TIMEOUT_MS } from '../database.mjs';
import { createTestWorkspace } from '../../tools/testing/workspace.mjs';

const namespace = { ownerId: 'native-cancellation-owner', scope: 'personal', projectId: null };
const memberInput = { namespace, selection: { type: 'unfiled' }, accessRevision: 'g', deadlineMs: 250 };
const failure = code => ({ ok: false, error: { code } });
const deferred = () => { let resolve; const promise = new Promise(r => { resolve = r; }); return { promise, resolve }; };

function nativeHarness(t, { gateTermination = true } = {}) {
  const workspace = createTestWorkspace(t), path = join(workspace.path, 'owned.sqlite');
  const holder = new DatabaseSync(path, { timeout: STORAGE_BUSY_TIMEOUT_MS });
  holder.exec('CREATE TABLE cancellation_probe(value); INSERT INTO cancellation_probe VALUES(1)');
  chmodSync(path, 0o600);
  const NativeWorker = threads.Worker, actors = [], reader = openMemoryReader({ path, ownerId: namespace.ownerId });
  threads.Worker = class extends NativeWorker {
    constructor(url, options) {
      const channel = new MessageChannel(), gate = deferred(), events = [], waiters = [];
      const index = actors.length;
      super(new URL('./fixtures/topic-reader-native-wait-worker.mjs', import.meta.url), {
        ...options, workerData: { ...options.workerData, control: channel.port2, blocked: index === 0 }, transferList: [channel.port2],
      });
      const actor = { worker: this, gate, events, requested: 0, port: channel.port1,
        event(name) {
          if (events.includes(name)) return Promise.resolve();
          return new Promise(resolve => waiters.push({ name, resolve }));
        },
        exited: new Promise(resolve => this.once('exit', resolve)),
        reply: new Promise(resolve => this.once('message', resolve)),
      };
      channel.port1.on('message', event => {
        events.push(event);
        for (const waiter of waiters) if (waiter.name === event) waiter.resolve();
      });
      this.releaseGate = gate;
      this.actor = actor; actors.push(actor);
      if (index > 0) gate.resolve();
    }
    terminate() {
      this.actor.requested++;
      // Hold termination at an explicit rendezvous so an actually blocked
      // native call can finish and send a genuine abandoned reply. No clock gate.
      return gateTermination ? this.releaseGate.promise.then(() => super.terminate()) : super.terminate();
    }
  };
  syncBuiltinESMExports();
  workspace.defer(async () => {
    if (holder.isTransaction) holder.exec('ROLLBACK');
    actors.forEach(a => a.gate.resolve());
    try { await reader.close(); }
    finally {
      actors.forEach(a => a.port.close());
      holder.close(); threads.Worker = NativeWorker; syncBuiltinESMExports();
    }
  });
  return { reader, actors, holder,
    async enter(actor) {
      await actor.event('prepared'); holder.exec('BEGIN EXCLUSIVE');
      actor.port.postMessage('go'); await actor.event('entered-native'); await turn();
      assert.equal(actor.events.includes('returned-native'), false);
    },
    unlock() { holder.exec('ROLLBACK'); },
    assertReadLockHeld() {
      // Explicit zero-wait lock probe; fixture connections otherwise use the
      // store timeout. This asserts lock ownership, never a latency threshold.
      holder.exec('PRAGMA busy_timeout=0');
      try { assert.throws(() => holder.exec('BEGIN EXCLUSIVE'), e => (e.errcode & 255) === 5); }
      finally { holder.exec('PRAGMA busy_timeout=' + STORAGE_BUSY_TIMEOUT_MS); }
    },
    assertReleased() { holder.exec('BEGIN EXCLUSIVE; ROLLBACK'); },
  };
}

for (const members of [false, true]) test(`native wait: ${members ? 'members' : 'overview'} pending close settles before close releases resources`, async t => {
  const h = nativeHarness(t);
  const pending = members ? h.reader.readTopicMembers({ ...memberInput, deadlineMs: 5000 }) : h.reader.readTopicOverview({ namespace });
  const actor = h.actors[0]; await h.enter(actor);
  let result, closed = false;
  pending.then(value => { result = value; });
  const close = h.reader.close().then(() => { closed = true; });
  const otherClose = h.reader.close();
  await turn();
  assert.deepEqual(result, failure('store_closed'));
  assert.equal(closed, false); assert.equal(actor.requested, 1);
  assert.deepEqual(await h.reader.readTopicOverview({ namespace }), failure('store_closed'));
  h.unlock();
  assert.deepEqual(await actor.reply, { ok: true, value: { from: 'abandoned', value: 1 } });
  await turn();
  assert.deepEqual(result, failure('store_closed')); assert.equal(closed, false);
  h.assertReadLockHeld(); actor.gate.resolve();
  await Promise.all([close, otherClose]); await actor.exited;
  assert.equal(closed, true); h.assertReleased();
});

test('native wait: watchdog settles independently, queued deadlines expire, late replies cannot reach replacement slots', async t => {
  const h = nativeHarness(t); t.mock.timers.enable({ apis: ['setTimeout'] });
  let timedOut;
  const pending = h.reader.readTopicMembers(memberInput).then(value => { timedOut = value; return value; });
  const actor = h.actors[0]; await h.enter(actor);
  t.mock.timers.tick(250); await turn();
  assert.deepEqual(timedOut, failure('read_timeout')); assert.equal(actor.requested, 1);
  assert.equal(actor.events.includes('returned-native'), false);
  let queuedTimeout;
  const queued = h.reader.readTopicMembers({ ...memberInput, deadlineMs: 50 }).then(value => { queuedTimeout = value; return value; });
  assert.deepEqual(await h.reader.readTopicOverview({ namespace }), failure('read_in_progress'));
  t.mock.timers.tick(50); await turn();
  assert.deepEqual(queuedTimeout, failure('read_timeout')); assert.equal(h.actors.length, 1);
  let replacementValue;
  const replacement = h.reader.readTopicOverview({ namespace }).then(value => { replacementValue = value; return value; });
  h.unlock();
  await actor.reply; await turn(); h.assertReadLockHeld();
  assert.equal(replacementValue, undefined, 'actual late reply ignored while replacement slot waits');
  assert.equal(h.actors.length, 1, 'no second live Worker during cleanup');
  actor.gate.resolve();
  assert.deepEqual(await replacement, { ok: true, value: { from: 'replacement' } });
  await actor.exited; assert.equal(h.actors.length, 2); h.assertReleased();
  assert.deepEqual(await pending, failure('read_timeout')); assert.deepEqual(await queued, failure('read_timeout'));
  await h.reader.close();
});

for (const deadline of [false, true]) test(`actual Worker termination cannot delay public ${deadline ? 'watchdog' : 'close'} settlement during a native wait`, async t => {
  const h = nativeHarness(t, { gateTermination: false });
  if (deadline) t.mock.timers.enable({ apis: ['setTimeout'] });
  const pending = deadline ? h.reader.readTopicMembers(memberInput) : h.reader.readTopicOverview({ namespace });
  const actor = h.actors[0]; await h.enter(actor);
  let result, closed = false;
  pending.then(value => { result = value; });
  if (deadline) t.mock.timers.tick(250);
  const closing = h.reader.close().then(() => { closed = true; });
  await turn();
  assert.deepEqual(result, failure(deadline ? 'read_timeout' : 'store_closed'));
  assert.equal(closed, false, 'real termination remains pending until SQLite returns');
  assert.equal(actor.requested, 1);
  h.unlock(); await closing; await actor.exited;
  assert.equal(closed, true); h.assertReleased();
});

test('close settles a request waiting for native cleanup and prevents its deferred Worker launch', async t => {
  const h = nativeHarness(t); t.mock.timers.enable({ apis: ['setTimeout'] });
  const original = h.reader.readTopicMembers(memberInput);
  const actor = h.actors[0]; await h.enter(actor);
  t.mock.timers.tick(250); await turn();
  assert.deepEqual(await original, failure('read_timeout'));
  let result, closed = false;
  const queued = h.reader.readTopicOverview({ namespace }).then(value => { result = value; return value; });
  const closing = h.reader.close().then(() => { closed = true; });
  await turn(); assert.deepEqual(result, failure('store_closed')); assert.equal(closed, false);
  h.unlock(); await actor.reply; await turn();
  assert.deepEqual(await queued, failure('store_closed'));
  actor.gate.resolve(); await closing; await actor.exited; await turn();
  assert.equal(h.actors.length, 1, 'close prevents queued launch after cleanup'); h.assertReleased();
});

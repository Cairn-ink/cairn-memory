import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { syncBuiltinESMExports } from 'node:module';
import { createServer } from 'node:net';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import threads, { MessageChannel } from 'node:worker_threads';
import { openMemoryReader } from '../memory-reader.mjs';
import { topicOverviewFixture, overviewNamespace as namespace, unwrapOverview as ok } from '../testing/topic-overview-fixture.mjs';
import { DatabaseSync } from 'node:sqlite';

const actor = new URL('./fixtures/topic-reader-busy-retry-actor.mjs', import.meta.url);
const memberInput = { namespace, selection: { type: 'unfiled' }, accessRevision: 'test', deadlineMs: 600 };
const overviewInput = { namespace };
const failure = code => ({ ok: false, error: { code } });

function readerFor(f) {
  const reader = openMemoryReader({ path: f.path, ownerId: namespace.ownerId });
  f.workspace.defer(() => reader.close());
  return reader;
}

function observedReader(t, f, { fault, onBusy, mutate } = {}) {
  const NativeWorker = threads.Worker, { port1, port2 } = new MessageChannel();
  const mutation = mutate ? new Int32Array(new SharedArrayBuffer(4)) : undefined;
  const events = [];
  let observerError;
  const receive = info => {
    events.push(info);
    try {
      onBusy?.(info);
      mutate?.();
    } catch (error) { observerError ??= error; }
    finally {
      if (mutation) { Atomics.store(mutation, 0, 1); Atomics.notify(mutation, 0); }
    }
  };
  port1.on('message', receive);
  threads.Worker = class extends NativeWorker {
    constructor(url, options) {
      super(actor, { ...options, workerData: { ...options.workerData, control: port2, fault, mutation }, transferList: [port2] });
    }
  };
  syncBuiltinESMExports();
  const reader = readerFor(f);
  f.workspace.defer(() => {
    port1.close();
    threads.Worker = NativeWorker;
    syncBuiltinESMExports();
    if (observerError) throw observerError;
  });
  return { reader, events };
}

async function holdExclusive(f) {
  const server = createServer();
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const connection = once(server, 'connection');
  const child = spawn(process.execPath, [fileURLToPath(actor), f.path, String(server.address().port)],
    { stdio: ['ignore', 'ignore', 'inherit'] });
  const exited = once(child, 'exit');
  let socket, released = false;
  function release() {
    if (!released && socket) { released = true; socket.write('release'); }
  }
  f.workspace.defer(async () => {
    release();
    if (!socket) child.kill();
    try { assert.deepEqual(await exited, [0, null]); }
    finally { socket?.destroy(); server.close(); }
  });
  [socket] = await Promise.race([connection, exited.then(() => { throw new Error('writer exited before lock'); })]);
  assert.equal((await once(socket, 'data'))[0].toString(), 'locked');
  return { release, exited };
}

for (const [method, input] of [['readTopicOverview', overviewInput], ['readTopicMembers', memberInput]]) {
  test(`DELETE ${method} resumes its original request after the first real SQLite BUSY`, { timeout: 8000 }, async t => {
    const f = topicOverviewFixture(t), quiet = readerFor(f);
    const expected = ok(await quiet[method](input));
    const writer = await holdExclusive(f);
    const { reader, events } = observedReader(t, f, { onBusy: () => writer.release() });
    const actual = await reader[method](input);
    assert.deepEqual(await writer.exited, [0, null]);
    assert.equal(events[0]?.errcode & 255, 5);
    assert.deepEqual(ok(actual).items, expected.items);
    assert.deepEqual(actual.value.coverage, expected.coverage);
    assert.equal(actual.value.nextCursor, null);
    if (method === 'readTopicOverview') {
      assert.deepEqual(actual.value.totals, expected.totals);
      assert.deepEqual(actual.value.items.map(row => row.title).sort(), ['Root', 'Topic A', 'Topic B']);
    } else assert.deepEqual(actual.value.items.map(row => row.id), [f.unfiled.id]);
  });

  test(`DELETE ${method} sustained BUSY exhausts the original deadline`, { timeout: 8000 }, async t => {
    const f = topicOverviewFixture(t), writer = await holdExclusive(f);
    const { reader, events } = observedReader(t, f);
    const deadlineMs = method === 'readTopicMembers' ? input.deadlineMs : 5000;
    const start = performance.now(), result = await reader[method](input), elapsed = performance.now() - start;
    writer.release();
    assert.deepEqual(result, failure('storage_busy'));
    assert.ok(events.length > 1, 'the request retried while the lock was held');
    assert.ok(elapsed >= deadlineMs - 110 && elapsed <= deadlineMs + 75, `deadline ${deadlineMs} ms, elapsed ${elapsed} ms`);
  });
}

for (const [name, fault] of [
  ['open', { boundary: 'open', errcode: 261 }],
  ['configure', { boundary: 'PRAGMA busy_timeout=0', errcode: 6 }],
  ['between scan quanta', { boundary: 'BEGIN', at: 3, errcode: 262 }],
  ['commit of the final fence', { boundary: 'COMMIT', at: 3, errcode: 5 }],
]) test(`DELETE overview retries ${name}`, async t => {
  const f = topicOverviewFixture(t), quiet = readerFor(f);
  if (name === 'between scan quanta') for (let i = 0; i < 50; i++) f.admit(`extra-${i}`);
  const expected = await quiet.readTopicOverview(overviewInput);
  const { reader, events } = observedReader(t, f, { fault });
  const actual = await reader.readTopicOverview(overviewInput);
  assert.equal(events.length, 1);
  assert.deepEqual(actual, expected);
});

test('DELETE members retries a partially advanced scan quantum after rollback', async t => {
  const f = topicOverviewFixture(t), quiet = readerFor(f);
  const expected = ok(await quiet.readTopicMembers(memberInput));
  const fault = { boundary: 'scan', at: 2, errcode: 6 };
  const { reader, events } = observedReader(t, f, { fault });
  const actual = ok(await reader.readTopicMembers(memberInput));
  assert.deepEqual(events, [{ boundary: 'scan', errcode: 6, transaction: true }]);
  assert.deepEqual(actual.items, expected.items);
  assert.deepEqual(actual.coverage, expected.coverage);
});

for (const [method, input, at] of [['readTopicOverview', overviewInput, 2], ['readTopicMembers', memberInput, 2]]) {
  test(`DELETE ${method} retries against its original namespace revision`, async t => {
    const f = topicOverviewFixture(t);
    const fault = { boundary: 'BEGIN', at, errcode: 261 };
    const { reader } = observedReader(t, f, { fault, mutate: () => f.admit('between-attempts') });
    assert.deepEqual(await reader[method](input), failure('cursor_stale'));
  });
}

test('WAL retains the existing native BUSY result at BEGIN', async t => {
  const f = topicOverviewFixture(t), db = new DatabaseSync(f.path);
  f.workspace.defer(() => db.close());
  assert.equal(db.prepare('PRAGMA journal_mode=WAL').get().journal_mode, 'wal');
  const { reader, events } = observedReader(t, f, { fault: { boundary: 'BEGIN', errcode: 5 } });
  assert.deepEqual(await reader.readTopicOverview(overviewInput), failure('storage_busy'));
  assert.deepEqual(events, [{ boundary: 'BEGIN', errcode: 5, transaction: false }]);
});

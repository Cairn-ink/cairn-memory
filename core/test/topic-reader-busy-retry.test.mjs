import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { syncBuiltinESMExports } from 'node:module';
import { createServer } from 'node:net';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import threads, { MessageChannel } from 'node:worker_threads';
import { openMemoryCore } from '../contract.mjs';
import { isStorageBusy } from '../database.mjs';
import { createTopicRetryPolicy, topicJournalMode, TOPIC_WAL_REPLY_RESERVE_MS, TOPIC_WAL_WAIT_MS } from '../topic-reader-sqlite.mjs';
import { openReadDatabase } from '../read-database.mjs';
import { createTestWorkspace } from '../../tools/testing/workspace.mjs';
import { openMemoryReader } from '../memory-reader.mjs';
import { topicOverviewFixture, overviewNamespace as namespace, unwrapOverview as ok } from '../testing/topic-overview-fixture.mjs';
import { DatabaseSync } from 'node:sqlite';

const actor = new URL('./fixtures/topic-reader-busy-retry-actor.mjs', import.meta.url);
const memberInput = { namespace, selection: { type: 'unfiled' }, accessRevision: 'test', deadlineMs: 600 };
const overviewInput = { namespace };
const failure = code => ({ ok: false, error: { code } });

function readerFor(f, diagnostics = false) {
  const reader = openMemoryReader({ path: f.path, ownerId: namespace.ownerId, diagnostics });
  f.workspace.defer(() => reader.close());
  return reader;
}

function observedReader(f, { faults = [], onBusy, pauseAt, diagnostics, splitScan, closingWal, exhaustAtScanCommit, holdReply } = {}) {
  const NativeWorker = threads.Worker, { port1, port2 } = new MessageChannel();
  const events = [], reloadedSuppressions = new Set();
  const backoff = Promise.withResolvers(), exited = Promise.withResolvers(), retrying = Promise.withResolvers(), replyHeld = Promise.withResolvers();
  let synced;
  port1.on('message', info => {
    if (info === 'backoff') backoff.resolve();
    else if (info === 'reply held') replyHeld.resolve();
    else if (info === 'synced') synced.resolve();
    else if (info.suppressedMemory) reloadedSuppressions.add(info.suppressedMemory);
    else { events.push(info); onBusy?.(info); }
  });
  threads.Worker = class extends NativeWorker {
    constructor(url, options) {
      super(actor, { ...options, workerData: { ...options.workerData, control: port2, faults, pauseAt, splitScan, closingWal, exhaustAtScanCommit, holdReply }, transferList: [port2] });
      this.once('exit', exited.resolve);
      this.on('message', result => { if (result.retryingStorage) retrying.resolve(result.retryingStorage); });
    }
  };
  syncBuiltinESMExports();
  const reader = readerFor(f, diagnostics);
  f.workspace.defer(() => {
    port1.close();
    threads.Worker = NativeWorker;
    syncBuiltinESMExports();
  });
  function sync(message = {}) {
    synced = Promise.withResolvers();
    port1.postMessage(message);
    return Promise.race([synced.promise, exited.promise.then(code => {
      assert.fail('Worker exited before responding on the control port: ' + code);
    })]);
  }
  return { reader, events, reloadedSuppressions, sync, backoff: backoff.promise, exited: exited.promise, retrying: retrying.promise, replyHeld: replyHeld.promise,
    release: () => port1.postMessage('release') };
}

async function expectBackoff(harness, pending) {
  await Promise.race([harness.backoff, pending.then(result => {
    assert.fail('request settled before entering the async backoff: ' + JSON.stringify(result));
  })]);
}

function mocSelection(f, moc, level) {
  const db = new DatabaseSync(f.path, { readOnly: true });
  try {
    const { revision } = db.prepare('SELECT revision FROM mocs WHERE id=?').get(moc.id);
    return { type: 'moc', mocId: moc.id, revision, level };
  } finally { db.close(); }
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
  test(`confirmed DELETE ${method} resumes after a real SQLite BUSY`, { timeout: 8000 }, async t => {
    const f = topicOverviewFixture(t);
    let writer;
    const h = observedReader(f, { onBusy: () => writer.release() });
    const expected = ok(await h.reader[method](input));
    writer = await holdExclusive(f);
    const actual = await h.reader[method](input);
    assert.deepEqual(await writer.exited, [0, null]);
    await h.sync();
    assert.equal(h.events[0]?.errcode & 255, 5);
    assert.deepEqual(ok(actual).items, expected.items);
    assert.deepEqual(actual.value.coverage, expected.coverage);
    assert.equal(actual.value.nextCursor, null);
    if (method === 'readTopicOverview') {
      assert.deepEqual(actual.value.totals, expected.totals);
      assert.deepEqual(actual.value.items.map(row => row.title).sort(), ['Root', 'Topic A', 'Topic B']);
    } else assert.deepEqual(actual.value.items.map(row => row.id), [f.unfiled.id]);
  });

  test(`confirmed DELETE ${method} exhausts sustained SQLite BUSY`, { timeout: 8000 }, async t => {
    const f = topicOverviewFixture(t), h = observedReader(f);
    ok(await h.reader[method](input));
    const writer = await holdExclusive(f);
    assert.deepEqual(await h.reader[method](input), failure('storage_busy'));
    writer.release();
    await h.sync();
    assert.ok(h.events.length > 1, 'the confirmed DELETE request retried while the lock was held');
  });
}

test('DELETE retry stops at the shared capped cutoff with room for each backoff', async () => {
  for (const duration of [600, 5000]) {
    const workerStart = 100;
    const cutoff = workerStart + Math.min(duration, TOPIC_WAL_WAIT_MS) - TOPIC_WAL_REPLY_RESERVE_MS;
    let now = workerStart, attempts = 0;
    const policy = createTopicRetryPolicy({ isRetryableBusy: isStorageBusy, now: () => now });
    const db = { isOpen: true, isTransaction: false };
    policy.start(workerStart + duration);
    policy.noteJournalMode(db, 'DELETE');
    const busy = Object.assign(new Error('native-shaped test fault'), { code: 'ERR_SQLITE_ERROR', errcode: 5 });
    await assert.rejects(policy.retryRead(db, () => {
      attempts++;
      if (attempts === 1) now = cutoff - 26;
      else if (attempts === 2) now = cutoff - 25;
      else assert.fail('a backoff cannot fit before the cutoff');
      throw busy;
    }), error => error === busy);
    assert.equal(attempts, 2);
  }
});

test('the opener records journal mode only after the probe resets the timeout', t => {
  const f = topicOverviewFixture(t);
  const events = [];
  const probe = {
    prepare() { return { get: () => ({ journal_mode: 'delete' }) }; },
    exec(sql) { assert.equal(sql, 'PRAGMA busy_timeout=0'); events.push('reset'); },
  };
  const policy = {
    database(db) { events.push('wrap'); return db; },
    noteJournalMode(db, mode) {
      if (db !== probe) assert.equal(db.prepare('PRAGMA busy_timeout').get().timeout, 0);
      events.push(mode);
    },
  };
  assert.equal(topicJournalMode(probe, f.path, policy), 'DELETE');
  assert.deepEqual(events.splice(0), ['wrap', 'reset']);
  const { db } = openReadDatabase(f.path, { topicPolicy: policy });
  try { assert.deepEqual(events, ['wrap', 'DELETE', 'wrap']); }
  finally { db.close(); }
});

for (const [name, boundary, errcode, result] of [
  ['constructor BUSY before mode evidence', 'open', 261, 'storage_busy'],
  ['timeout reset BUSY within the probe', 'PRAGMA busy_timeout=0', 6, 'storage_busy'],
  ['opening validation BUSY after confirmed DELETE', 'prepare PRAGMA application_id', 261, null],
]) test(name, async t => {
  const f = topicOverviewFixture(t), quiet = readerFor(f);
  const expected = result ? failure(result) : await quiet.readTopicOverview(overviewInput);
  const h = observedReader(f, { faults: [{ boundary, errcode }] });
  assert.deepEqual(await h.reader.readTopicOverview(overviewInput), expected);
  await h.sync();
  assert.equal(h.events.length, 1);
});

for (const [name, fault, splitScan] of [
  ['between scan quanta', { boundary: 'BEGIN', at: 3, errcode: 262 }, false],
  ['commit of the final fence', { boundary: 'final COMMIT', errcode: 5 }, true],
]) test(`DELETE overview retries ${name}`, async t => {
  const f = topicOverviewFixture(t), quiet = readerFor(f);
  if (!splitScan) for (let i = 0; i < 50; i++) f.admit(`extra-${i}`);
  const expected = await quiet.readTopicOverview(overviewInput);
  const h = observedReader(f, { faults: [fault], splitScan });
  assert.deepEqual(await h.reader.readTopicOverview(overviewInput), expected);
  await h.sync();
  assert.deepEqual(h.events, [{ boundary: fault.boundary, errcode: fault.errcode, transaction: splitScan }]);
});

test('DELETE members retries a partially advanced scan quantum after rollback', async t => {
  const f = topicOverviewFixture(t), quiet = readerFor(f);
  const expected = ok(await quiet.readTopicMembers(memberInput));
  const h = observedReader(f, { faults: [{ boundary: 'scan', at: 2, errcode: 6 }] });
  const actual = ok(await h.reader.readTopicMembers(memberInput));
  await h.sync();
  assert.deepEqual(h.events, [{ boundary: 'scan', errcode: 6, transaction: true }]);
  assert.deepEqual(actual.items, expected.items);
  assert.deepEqual(actual.coverage, expected.coverage);
});

test('fresh DELETE member target BUSY preserves the snapshot revision across admission', async t => {
  const f = topicOverviewFixture(t);
  const h = observedReader(f, { faults: [{ boundary: 'target', errcode: 261 }], pauseAt: 1 });
  const pending = h.reader.readTopicMembers({ ...memberInput, deadlineMs: 5000, selection: mocSelection(f, f.topicA, 'L1') });
  await expectBackoff(h, pending);
  assert.deepEqual(h.events, [{ boundary: 'target', errcode: 261, transaction: true }]);
  f.admit('between-attempts');
  h.release();
  assert.deepEqual(await pending, failure('cursor_stale'));
});

test('WAL retains the existing native BUSY result at BEGIN', async t => {
  const f = topicOverviewFixture(t), db = new DatabaseSync(f.path);
  f.workspace.defer(() => db.close());
  assert.equal(db.prepare('PRAGMA journal_mode=WAL').get().journal_mode, 'wal');
  const h = observedReader(f, { faults: [{ boundary: 'BEGIN', errcode: 5 }] });
  assert.deepEqual(await h.reader.readTopicOverview(overviewInput), failure('storage_busy'));
  await h.sync();
  assert.deepEqual(h.events, [{ boundary: 'BEGIN', errcode: 5, transaction: false }]);
});

test('deferred journal-mode errors leave subsequent opening BUSY unresolved', async t => {
  const f = topicOverviewFixture(t);
  const h = observedReader(f, { faults: [{ boundary: 'PRAGMA journal_mode', errcode: 1 },
    { boundary: 'prepare PRAGMA application_id', errcode: 261 }] });
  assert.deepEqual(await h.reader.readTopicOverview(overviewInput), failure('storage_busy'));
  await h.sync();
  assert.deepEqual(h.events.map(event => event.errcode), [261]);
});

test('WAL close transition with no companions uses only the original opening probe', async t => {
  const f = topicOverviewFixture(t);
  f.core.close();
  const db = new DatabaseSync(f.path);
  assert.equal(db.prepare('PRAGMA journal_mode=WAL').get().journal_mode, 'wal');
  db.close();
  // Emulate the opening lock after companion removal. The next query would
  // succeed if the reader incorrectly starts another outer attempt.
  const h = observedReader(f, { diagnostics: true, closingWal: true, faults: [{ boundary: 'PRAGMA journal_mode', errcode: 5 },
    { boundary: 'PRAGMA journal_mode', at: 2, errcode: 261 }] });
  const result = await h.reader.readTopicOverview(overviewInput);
  await h.sync();
  assert.deepEqual(h.events.map(event => event.errcode), [5, 261]);
  assert.deepEqual(result, { ok: false, error: { code: 'storage_busy', diagnostics: {
    stage: 'execute', statement: 'journal_mode', sqlite: { code: 5, extendedCode: 261 },
  } } });
});

const changingFaults = [{ boundary: 'BEGIN', errcode: 261 }, { boundary: 'snapshot', errcode: 262, repeat: true }];
const firstBusy = { ok: false, error: { code: 'storage_busy', diagnostics: {
  stage: 'begin', statement: 'transaction', sqlite: { code: 5, extendedCode: 261 },
} } };

test('DELETE Worker exhaustion reports the first SQLite stage and extended code', { timeout: 8000 }, async t => {
  const f = topicOverviewFixture(t), h = observedReader(f, { diagnostics: true, faults: changingFaults });
  assert.deepEqual(await h.reader.readTopicOverview(overviewInput), firstBusy);
  await h.sync();
  assert.deepEqual(h.events.slice(0, 2).map(event => event.errcode), [261, 262]);
});

for (const watchdog of [false, true]) {
  test(`DELETE ${watchdog ? 'watchdog' : 'Worker'} keeps the first fault after a non-resumable scan commit`, { timeout: 8000 }, async t => {
    const f = topicOverviewFixture(t), h = observedReader(f, {
      diagnostics: true, exhaustAtScanCommit: true, holdReply: watchdog,
      faults: [{ ...changingFaults[0], at: 2 }, { boundary: 'scan COMMIT', errcode: 262 }],
    });
    if (watchdog) t.mock.timers.enable({ apis: ['setTimeout'] });
    const pending = h.reader.readTopicOverview(overviewInput);
    if (watchdog) {
      await Promise.race([h.replyHeld, pending.then(() => assert.fail('Worker reply was not held'))]);
      assert.deepEqual(await h.retrying, firstBusy);
      t.mock.timers.tick(5000);
    }
    const result = await pending;
    if (watchdog) assert.equal(await h.exited, 1);
    else await h.sync();
    assert.deepEqual(h.events, [
      { boundary: 'BEGIN', errcode: 261, transaction: false },
      { boundary: 'scan COMMIT', errcode: 262, transaction: true },
    ]);
    assert.deepEqual(result, firstBusy);
  });
}

for (const watchdog of [false, true]) {
  test(`DELETE ${watchdog ? 'watchdog' : 'close'} exits the Worker while the async backoff gate is held`, { timeout: 5000 }, async t => {
    const f = topicOverviewFixture(t), h = observedReader(f, { diagnostics: true, faults: changingFaults, pauseAt: 2 });
    if (watchdog) t.mock.timers.enable({ apis: ['setTimeout'] });
    const pending = h.reader.readTopicOverview(overviewInput);
    await expectBackoff(h, pending);
    assert.deepEqual(h.events.map(event => event.errcode), [261, 262]);
    assert.deepEqual(await h.retrying, firstBusy);
    let closing;
    if (watchdog) t.mock.timers.tick(5000);
    else closing = h.reader.close();
    assert.deepEqual(await pending, watchdog ? firstBusy : failure('store_closed'));
    assert.equal(await h.exited, 1, 'Worker terminates before release');
    h.release();
    await closing;
  });
}

function suppressionFixture(t) {
  const workspace = createTestWorkspace(t, { prefix: 'cairn-topic-retry-suppression-' });
  const path = join(workspace.path, 'memory.sqlite');
  const core = openMemoryCore({ path, contentSafety: 's2h-v1' });
  const db = new DatabaseSync(path);
  workspace.defer(() => { db.close(); core.close(); });
  const admit = name => ok(core.admit({ namespace, memory: { content: name, kind: 'fact' },
    receipts: [{ client: 'synthetic', sessionId: 'fixture', eventId: name, role: 'user', excerpt: name }] }));
  const admitted = admit('Synthetic source for suppressed title');
  const source = admitted.memory, title = 'Synthetic suppressed title';
  const placed = ok(core.applyPlacement({ namespace, expectedIndexRevision: admitted.indexRevision,
    expectedMemoryRevisions: [{ memoryId: source.id, revision: source.revision }],
    proposal: { items: [{ memoryId: source.id, parentIds: [], newL1: {
      title, parentL2Ids: [], newL2Title: 'Synthetic root',
    } }] } }));
  const moc = placed.createdMocs.find(row => row.level === 'L1');
  const extra = admit('Synthetic third member');
  ok(core.applyPlacement({ namespace, expectedIndexRevision: extra.indexRevision,
    expectedMemoryRevisions: [{ memoryId: extra.memory.id, revision: extra.memory.revision }],
    proposal: { items: [{ memoryId: extra.memory.id, parentIds: [moc.id] }] } }));
  const getEpoch = db.prepare('SELECT epoch_hi, epoch_lo FROM owner_suppression_epochs WHERE owner_id=?');
  return { workspace, path, core, db, source, title, moc, getEpoch: () => getEpoch.get(namespace.ownerId) };
}

for (const method of ['readTopicOverview', 'readTopicMembers']) {
  test(`DELETE ${method} observes a title-source forget committed during async backoff`, { timeout: 8000 }, async t => {
    const f = suppressionFixture(t), quiet = readerFor(f);
    const members = method === 'readTopicMembers';
    const input = members
      ? { ...memberInput, deadlineMs: 5000, limit: 1, selection: mocSelection(f, f.moc, 'L1') }
      : { ...overviewInput, nodeLimit: 1 };
    assert.equal(ok(await quiet.readTopicOverview(overviewInput)).items.find(item => item.id === f.moc.id).title, f.title);
    const control = ok(await quiet[method](input));
    const h = observedReader(f, { pauseAt: 1 });
    const original = ok(await h.reader[method](input));
    assert.ok(original.nextCursor && control.nextCursor);
    await h.sync({ faults: [{ boundary: 'COMMIT', errcode: 261 }] });
    const pending = h.reader[method]({ ...input, cursor: original.nextCursor });
    await expectBackoff(h, pending);
    assert.deepEqual(h.events, [{ boundary: 'COMMIT', errcode: 261, transaction: true }]);
    const before = f.getEpoch();
    const current = ok(f.core.get({ namespace, memoryId: f.source.id })).memory;
    assert.equal(ok(f.core.forget({ namespace, memoryId: current.id, expectedRevision: current.revision })).forgotten, true);
    assert.notDeepEqual(f.getEpoch(), before, 'the forget advanced the owner suppression epoch');
    assert.equal(f.db.prepare("SELECT count(*) AS n FROM content_suppressions WHERE owner_id=? AND stable_key=? AND reason='user_forget'")
      .get(namespace.ownerId, current.id).n, 1);
    h.release();
    const [result, expected] = await Promise.all([pending, quiet[method]({ ...input, cursor: control.nextCursor })]);
    assert.deepEqual(expected, failure('cursor_stale'));
    assert.ok(!JSON.stringify(result).includes(f.title));
    assert.deepEqual(result, expected);
    await h.sync();
    assert.ok(h.reloadedSuppressions.has(current.id), 'retry loads the committed suppression fact');
  });
}

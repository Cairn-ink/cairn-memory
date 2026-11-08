import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { Worker } from 'node:worker_threads';
import test from 'node:test';
import { setTimeout as delay } from 'node:timers/promises';
import { openMemoryCore } from '../contract.mjs';
import * as runtime from '../runtime.mjs';
import { createTestWorkspace } from '../../tools/testing/workspace.mjs';

const namespace = { ownerId: 'recall-diagnostics-test', scope: 'personal', projectId: null };
const request = { readSet: [namespace], query: 'Synthetic note' };
const keys = ['recallMs', 'hostWaitMs', 'storageMs', 'storageCalls', 'storageMaxMs', 'storageMaxCall', 'journalMode'];
const storageNames = ['map', 'fetch', 'validateFresh', 'recentReceipts', 'finalize'];
const ok = r => { assert.equal(r.ok, true, JSON.stringify(r)); return r.value; };
const digest = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
function model() {
  return { contextWindow: 8192, countTokens: () => 1,
    select: ({ input }) => ({ refs: input.maps.flatMap(page => page.items.filter(item => item.type === 'unfiled')
      .map(item => ({ namespaceIndex: page.namespaceIndex, ...item.ref }))) }),
    rank: ({ input }) => ({ refs: input.candidates.slice(0, input.limit).map(({ namespaceIndex, memory }) =>
      ({ namespaceIndex, memoryId: memory.id, revision: memory.revision })) }) };
}
function fixture(t, options = {}) {
  const workspace = createTestWorkspace(t);
  const path = join(workspace.path, 'memory.sqlite'), port = model();
  let core = openMemoryCore({ path, model: port, ...options });
  workspace.defer(() => core.close());
  ok(core.admit({ namespace, memory: { content: 'Synthetic note', kind: 'fact' }, receipts: [
    { client: 'test', sessionId: 'test', eventId: 'test', role: 'user', excerpt: 'Synthetic note' },
  ] }));
  return { path, port, workspace, get core() { return core; },
    reopen() { core.close(); core = openMemoryCore({ path, model: port, ...options }); return core; } };
}
async function observers(call) {
  const counts = { clock: 0, timer: 0, listener: 0 };
  const methods = [[performance, 'now', 'clock'], [globalThis, 'setTimeout', 'timer'],
    [globalThis, 'setInterval', 'timer'], [EventTarget.prototype, 'addEventListener', 'listener']];
  const saved = methods.map(([target, name]) => [target, name, Object.getOwnPropertyDescriptor(target, name)]);
  const originals = methods.map(([target, name]) => target[name]);
  methods.forEach(([target, name, kind], index) => {
    Object.defineProperty(target, name, { configurable: true, writable: true, value: function(...args) {
      counts[kind]++; return Reflect.apply(originals[index], this, args);
    } });
  });
  try { return { ...await prepared(call), observers: counts }; }
  finally { for (const [target, name, descriptor] of saved) {
    if (descriptor) Object.defineProperty(target, name, descriptor); else delete target[name];
  } }
}
async function prepared(call, hook) {
  const prepare = DatabaseSync.prototype.prepare, sql = [];
  DatabaseSync.prototype.prepare = function(text, ...args) {
    sql.push(text);
    hook?.(text, this);
    return prepare.call(this, text, ...args);
  };
  try { return { result: await call(), sql }; }
  finally { DatabaseSync.prototype.prepare = prepare; }
}
function parity(plain, measured) {
  const { diagnostics, ...rest } = measured;
  assert.deepEqual(rest, plain);
  assert.equal(JSON.stringify(rest), JSON.stringify(plain));
  for (const name of ['memories', 'namespaces', 'coverage', 'recallTruncated']) {
    assert.deepEqual(measured[name], plain[name], name);
  }
  return diagnostics;
}
function shape(plain, measured) {
  const d = parity(plain, measured);
  assert.deepEqual(Object.keys(measured), [...Object.keys(plain), 'diagnostics']);
  assert.deepEqual(Object.keys(d), keys);
  assert.equal(Object.getPrototypeOf(d), Object.prototype);
  assert.ok(Object.isFrozen(d));
  for (const name of ['recallMs', 'hostWaitMs', 'storageMs', 'storageCalls', 'storageMaxMs']) {
    assert.ok(Number.isFinite(d[name]) && d[name] >= 0, name);
    if (name !== 'storageCalls') assert.equal(d[name], Math.round(d[name] * 10) / 10, name);
  }
  assert.ok(storageNames.includes(d.storageMaxCall), JSON.stringify(d));
  assert.ok(Number.isInteger(d.storageCalls) && d.storageCalls > 0);
  assert.ok(d.recallMs >= d.hostWaitMs);
  assert.ok(d.recallMs >= d.storageMs);
  assert.ok(d.recallMs + 0.2 >= d.hostWaitMs + d.storageMs, JSON.stringify(d));
  assert.ok(d.storageMs >= d.storageMaxMs);
  return d;
}

test('1 opt-out identity: omitted, false and true preserve bytes, key order and prepared SQL', async t => {
  const f = fixture(t);
  const absent = await observers(() => f.core.recall(request));
  const disabled = await observers(() => f.core.recall({ ...request, diagnostics: false }));
  assert.deepEqual(disabled, absent);
  assert.equal(JSON.stringify(disabled), JSON.stringify(absent));
  for (const observed of [absent, disabled]) {
    ok(observed.result);
    assert.deepEqual(Object.keys(observed.result.value), Object.keys(absent.result.value));
    assert.equal(Object.hasOwn(observed.result.value, 'diagnostics'), false);
    assert.equal(observed.observers.clock, 5,
      'only the mandatory scan-start, scan-page and placement-page clock reads');
    assert.equal(observed.observers.timer, 2, 'only the existing model timeout timers');
    assert.equal(observed.observers.listener, 0);
  }
  const measured = await prepared(() => f.core.recall({ ...request, diagnostics: true }));
  const d = shape(absent.result.value, ok(measured.result));
  assert.deepEqual(measured.sql, [...absent.sql, 'PRAGMA journal_mode']);
  const again = await prepared(() => f.core.recall({ ...request, diagnostics: true }));
  shape(absent.result.value, ok(again.result));
  assert.deepEqual(again.sql, absent.sql);
  t.diagnostic(JSON.stringify({ preparedCalls: absent.sql.length, output: digest(absent.result),
    sql: digest(absent.sql), observers: absent.observers, diagnostics: d }));
});

test('2 validation: only absent and booleans are accepted', async t => {
  const f = fixture(t);
  for (const diagnostics of [1, 'true', null, {}, undefined]) {
    assert.deepEqual(await f.core.recall({ ...request, diagnostics }),
      { ok: false, error: { code: 'invalid_input', retryable: false } });
  }
  ok(await f.core.recall({ ...request, diagnostics: true }));
});

test('3 shape: frozen ordered plain diagnostics, rounded times and all storage boundaries', async t => {
  const f = fixture(t);
  const plain = ok(await f.core.recall(request));
  const d = shape(plain, ok(await f.core.recall({ ...request, diagnostics: true })));
  // One map, one fetch, finalization, and freshness calls around both model calls.
  assert.ok(d.storageCalls >= 8, 'storage includes map, fetch, validateFresh and finalize');
  t.diagnostic(JSON.stringify(d));
});

test('4 host wait includes the await for both select and rank', async t => {
  const f = fixture(t), plain = ok(await f.core.recall(request));
  for (const name of ['select', 'rank']) {
    const original = f.port[name];
    f.port[name] = async input => { await delay(45); return original(input); };
    const d = shape(plain, ok(await f.core.recall({ ...request, diagnostics: true })));
    assert.ok(d.hostWaitMs >= 35, name);
    t.diagnostic(name + ' ' + JSON.stringify(d));
    f.port[name] = original;
  }
  const select = f.port.select, rank = f.port.rank;
  f.port.select = async input => { await delay(45); return select(input); };
  f.port.rank = async input => { await delay(45); return rank(input); };
  const d = shape(plain, ok(await f.core.recall({ ...request, diagnostics: true })));
  assert.ok(d.hostWaitMs >= 70, 'wait times are summed across both awaits');
});

test('5 synchronous SQLite exclusive lock is visible in storageMaxMs', async t => {
  const f = fixture(t), plain = ok(await f.core.recall(request));
  const state = new Int32Array(new SharedArrayBuffer(8));
  const worker = new Worker(`
    const { workerData } = require('node:worker_threads');
    const { DatabaseSync } = require('node:sqlite');
    const { performance } = require('node:perf_hooks');
    const state = new Int32Array(workerData.state);
    const db = new DatabaseSync(workerData.path);
    try {
      db.exec('PRAGMA busy_timeout=5000; BEGIN EXCLUSIVE');
      Atomics.store(state, 0, 1); Atomics.notify(state, 0);
      if (Atomics.wait(state, 1, 0, 10000) === 'timed-out') throw Error('reader rendezvous timed out');
      const start = performance.now();
      while (performance.now() - start < 160) Atomics.wait(state, 1, 1, 160 - (performance.now() - start));
      db.exec('COMMIT');
    } finally { db.close(); }
  `, { eval: true, workerData: { path: f.path, state: state.buffer } });
  const joined = new Promise((resolve, reject) => { worker.once('error', reject); worker.once('exit', resolve); });
  // Attach immediately, including when the main thread is inside SQLite.
  joined.catch(() => {});
  f.workspace.defer(async () => {
    Atomics.store(state, 1, 1); Atomics.notify(state, 1);
    try { assert.equal(await joined, 0); } finally { await worker.terminate(); }
  });
  if (Atomics.load(state, 0) === 0) Atomics.wait(state, 0, 0, 10000);
  assert.equal(Atomics.load(state, 0), 1, 'writer holds EXCLUSIVE');
  const observed = await prepared(() => f.core.recall({ ...request, diagnostics: true }), () => {
    // Start the hold at the reader's first actual prepare, after entry guards.
    Atomics.store(state, 1, 1); Atomics.notify(state, 1);
  });
  assert.equal(ok(observed.result).diagnostics.storageMaxCall, 'map');
  const d = shape(plain, ok(observed.result));
  assert.ok(d.storageMaxMs >= 80, JSON.stringify(d));
  assert.equal(d.journalMode, 'delete');
  assert.equal(await joined, 0);
  t.diagnostic(JSON.stringify(d));
});

test('5 freshness storage inside select and rank is excluded from host wait', async t => {
  for (const method of ['select', 'rank']) {
    const f = fixture(t), plain = ok(await f.core.recall(request));
    const holdMs = 160;
    const state = new Int32Array(new SharedArrayBuffer(12));
    const worker = new Worker(`
      const { workerData } = require('node:worker_threads');
      const { DatabaseSync } = require('node:sqlite');
      const { performance } = require('node:perf_hooks');
      const state = new Int32Array(workerData.state);
      const db = new DatabaseSync(workerData.path);
      try {
        db.exec('PRAGMA busy_timeout=5000');
        Atomics.store(state, 0, 1); Atomics.notify(state, 0);
        if (Atomics.wait(state, 1, 0, 10000) === 'timed-out') throw Error('freshness rendezvous timed out');
        db.exec('BEGIN EXCLUSIVE');
        Atomics.store(state, 2, 1); Atomics.notify(state, 2);
        const start = performance.now();
        while (performance.now() - start < workerData.holdMs)
          Atomics.wait(state, 2, 1, workerData.holdMs - (performance.now() - start));
        db.exec('COMMIT');
      } finally { db.close(); }
    `, { eval: true, workerData: { path: f.path, state: state.buffer, holdMs } });
    const joined = new Promise((resolve, reject) => { worker.once('error', reject); worker.once('exit', resolve); });
    joined.catch(() => {});
    f.workspace.defer(async () => {
      Atomics.store(state, 1, 1); Atomics.notify(state, 1);
      try { assert.equal(await joined, 0); } finally { await worker.terminate(); }
    });
    if (Atomics.load(state, 0) === 0) Atomics.wait(state, 0, 0, 10000);
    assert.equal(Atomics.load(state, 0), 1, 'writer is ready');
    let ranking = false, triggered = false;
    const countTokens = f.port.countTokens;
    f.port.countTokens = text => {
      // Rank packing begins after all select return checks have finished.
      try { if (Array.isArray(JSON.parse(text).input?.candidates)) ranking = true; } catch {}
      return countTokens(text);
    };
    const observed = await prepared(() => f.core.recall({ ...request, diagnostics: true }), () => {
      if (triggered || (method === 'rank' && !ranking)) return;
      const limit = Error.stackTraceLimit;
      let stack;
      try { Error.stackTraceLimit = 50; stack = new Error().stack; }
      finally { Error.stackTraceLimit = limit; }
      // Hook the first prepare in validateFresh during callModel's token preflight.
      // Other recall storage calls cannot start the lock, including between models.
      if (!stack.includes('at validateFresh') || !stack.includes('at callModel')) return;
      triggered = true;
      Atomics.store(state, 1, 1); Atomics.notify(state, 1);
      if (Atomics.load(state, 2) === 0) Atomics.wait(state, 2, 0, 10000);
      assert.equal(Atomics.load(state, 2), 1, 'writer holds EXCLUSIVE inside freshness');
    });
    assert.equal(triggered, true, method);
    const measured = ok(observed.result), d = parity(plain, measured);
    assert.equal(d.storageMaxCall, 'validateFresh');
    assert.ok(d.storageMaxMs >= 80, JSON.stringify(d));
    shape(plain, measured);
    assert.equal(d.journalMode, 'delete');
    assert.equal(await joined, 0);
    t.diagnostic(method + ' ' + JSON.stringify(d));
  }
});

test('5 content-safety guard SQL inside select and rank stays in the engine remainder', async t => {
  for (const method of ['select', 'rank']) {
    const f = fixture(t, { contentSafety: 's2h-v1' }), plain = ok(await f.core.recall(request));
    const holdMs = 160;
    const state = new Int32Array(new SharedArrayBuffer(12));
    const worker = new Worker(`
      const { workerData } = require('node:worker_threads');
      const { DatabaseSync } = require('node:sqlite');
      const { performance } = require('node:perf_hooks');
      const state = new Int32Array(workerData.state);
      const db = new DatabaseSync(workerData.path);
      try {
        db.exec('PRAGMA busy_timeout=5000');
        Atomics.store(state, 0, 1); Atomics.notify(state, 0);
        if (Atomics.wait(state, 1, 0, 10000) === 'timed-out') throw Error('guard rendezvous timed out');
        db.exec('BEGIN EXCLUSIVE');
        Atomics.store(state, 2, 1); Atomics.notify(state, 2);
        const start = performance.now();
        while (performance.now() - start < workerData.holdMs)
          Atomics.wait(state, 2, 1, workerData.holdMs - (performance.now() - start));
        db.exec('COMMIT');
      } finally { db.close(); }
    `, { eval: true, workerData: { path: f.path, state: state.buffer, holdMs } });
    const joined = new Promise((resolve, reject) => { worker.once('error', reject); worker.once('exit', resolve); });
    joined.catch(() => {});
    f.workspace.defer(async () => {
      Atomics.store(state, 1, 1); Atomics.notify(state, 1);
      try { assert.equal(await joined, 0); } finally { await worker.terminate(); }
    });
    if (Atomics.load(state, 0) === 0) Atomics.wait(state, 0, 0, 10000);
    assert.equal(Atomics.load(state, 0), 1, 'writer is ready');
    let ranking = false, triggered = false;
    const countTokens = f.port.countTokens;
    f.port.countTokens = text => {
      // Rank packing begins after all select return checks have finished.
      try { if (Array.isArray(JSON.parse(text).input?.candidates)) ranking = true; } catch {}
      return countTokens(text);
    };
    const observed = await prepared(() => f.core.recall({ ...request, diagnostics: true }), text => {
      if (triggered || (method === 'rank' && !ranking)) return;
      const limit = Error.stackTraceLimit;
      let stack;
      try { Error.stackTraceLimit = 50; stack = new Error().stack; }
      finally { Error.stackTraceLimit = limit; }
      // E1 after the token counter, inside callModel but outside storage closures.
      if (text !== 'SELECT epoch_hi,epoch_lo FROM owner_suppression_epochs WHERE owner_id=?' ||
          !stack.includes('at tokens') || !stack.includes('at callModel')) return;
      triggered = true;
      Atomics.store(state, 1, 1); Atomics.notify(state, 1);
      if (Atomics.load(state, 2) === 0) Atomics.wait(state, 2, 0, 10000);
      assert.equal(Atomics.load(state, 2), 1, 'writer holds EXCLUSIVE inside the safety guard');
    });
    assert.equal(triggered, true, method);
    const measured = ok(observed.result), d = parity(plain, measured);
    assert.ok(d.recallMs - d.hostWaitMs - d.storageMs >= 80, JSON.stringify(d));
    shape(plain, measured);
    assert.equal(d.journalMode, 'delete');
    assert.equal(await joined, 0);
    t.diagnostic(method + ' ' + JSON.stringify(d));
  }
});

test('6 journal mode: mapper is closed and case insensitive', () => {
  for (const mode of ['delete', 'truncate', 'persist', 'memory', 'wal', 'off', 'other', 'unknown']) {
    const expected = mode;
    assert.equal(runtime.normalizeRecallJournalMode(mode), expected);
    assert.equal(runtime.normalizeRecallJournalMode(mode.toUpperCase()), expected);
  }
  for (const value of ['unrecognized-mode', '', null, 1, {}]) assert.equal(runtime.normalizeRecallJournalMode(value), 'other');
});

test('6 journal mode: lazy once per open core, reopen resets cache, failed read retries', async t => {
  const f = fixture(t);
  const journalCalls = row => row.sql.filter(text => text === 'PRAGMA journal_mode').length;
  const off = await prepared(() => f.core.recall(request));
  assert.equal(journalCalls(off), 0);
  let row = await prepared(async () => {
    for (let i = 0; i < 2; i++) assert.equal(ok(await f.core.recall({ ...request, diagnostics: true })).diagnostics.journalMode, 'delete');
  });
  assert.equal(journalCalls(row), 1);
  f.reopen();
  row = await prepared(() => f.core.recall({ ...request, diagnostics: true }));
  assert.equal(journalCalls(row), 1);
  f.reopen();
  const plain = ok(await f.core.recall(request));
  let failRead = true;
  row = await prepared(async () => {
    const failed = ok(await f.core.recall({ ...request, diagnostics: true }));
    assert.equal(shape(plain, failed).journalMode, 'unknown');
    const retried = ok(await f.core.recall({ ...request, diagnostics: true }));
    assert.equal(shape(plain, retried).journalMode, 'delete');
    ok(await f.core.recall({ ...request, diagnostics: true }));
  }, text => { if (text === 'PRAGMA journal_mode' && failRead) { failRead = false; throw Error('injected journal read failure'); } });
  assert.equal(journalCalls(row), 2);
});

test('6 journal mode: WAL core is accepted and reports wal without changing outcomes', async t => {
  const f = fixture(t);
  const db = new DatabaseSync(f.path); f.workspace.defer(() => db.close());
  assert.equal(db.prepare('PRAGMA journal_mode=WAL').get().journal_mode, 'wal');
  f.reopen();
  const plain = ok(await f.core.recall(request));
  assert.equal(shape(plain, ok(await f.core.recall({ ...request, diagnostics: true }))).journalMode, 'wal');
});

test('7 receipt capping preserves truncation and counts recentReceipts storage', async t => {
  const f = fixture(t);
  ok(f.core.admit({ namespace, memory: { content: 'Synthetic note', kind: 'fact' }, receipts: [
    { client: 'test', sessionId: 'test', eventId: 'another', role: 'user', excerpt: 'Another source' },
  ] }));
  f.port.countTokens = text => {
    try { return JSON.parse(text).input?.candidates?.[0]?.receipts.length > 1 ? 6001 : 1; }
    catch { return 1; }
  };
  const plain = ok(await f.core.recall(request));
  assert.equal(plain.recallTruncated.receiptListsCapped, 1);
  const d = shape(plain, ok(await f.core.recall({ ...request, diagnostics: true })));
  assert.ok(d.storageCalls >= 14, 'includes the recentReceipts closure');
});

test('7 content read facade and output assertion accept diagnostics on an actual safety core', async t => {
  const { core, port } = fixture(t, { contentSafety: 's2h-v1' });
  for (const options of [{}, { includeQualification: true }, { contextMode: 'source-evidence' },
    { contextMode: 'source-evidence', selectionMode: 'bounded-source-scan' }]) {
    const input = { ...request, ...options }, plain = ok(await core.recall(input));
    assert.equal(Object.hasOwn(plain, 'diagnostics'), false);
    assert.deepEqual(await core.recall({ ...input, diagnostics: false }), { ok: true, value: plain });
    shape(plain, ok(await core.recall({ ...input, diagnostics: true })));
  }
  // Failure envelopes carry no measurements even after a model await.
  port.rank = () => { throw Error('synthetic provider failure'); };
  assert.deepEqual(await core.recall({ ...request, diagnostics: true }), await core.recall(request));
});

// Exercise the live private accumulator without adding a public test API or
// opening a database. These two blocks are the initializer and storage wrappers
// used by recall itself; no copy of their implementation is maintained here.
function accumulator() {
  const source = readFileSync(new URL('../contract.mjs', import.meta.url), 'utf8');
  const initializer = source.match(/const diagnostics = enabled \?[^;]+;/)?.[0];
  const wrappers = source.match(/if \(diagnostics\) for \(const name of Object.keys\(storage\)\) \{[\s\S]*?\n      \}(?=\n      const value = await recallMemories)/)?.[0];
  assert.ok(initializer, 'recall diagnostics initializer');
  assert.ok(wrappers, 'recall storage wrappers');
  const clock = [];
  const storage = Object.fromEntries(storageNames.map(name => [name, () => name]));
  const performance = { now: () => { assert.ok(clock.length, 'controlled clock exhausted'); return clock.shift(); } };
  const diagnostics = new Function('enabled', 'storage', 'performance',
    initializer + '\n' + wrappers + '\nreturn diagnostics;')(true, storage, performance);
  return { diagnostics, call(name, start, end) {
    clock.push(start, end);
    assert.equal(storage[name](), name);
    assert.equal(clock.length, 0, 'exactly two clock reads per storage call');
  } };
}

test('8 accumulator: zero storage calls report null and zero', () => {
  const { diagnostics: d } = accumulator();
  assert.equal(d.storageCalls, 0);
  assert.equal(d.storageMaxMs, 0);
  assert.equal(d.storageMaxCall, null);
});

test('8 accumulator: equal unrounded maxima keep the earliest call', () => {
  const { diagnostics: d, call } = accumulator();
  // Also attribute a first call whose elapsed time is exactly zero.
  call('fetch', 0, 0);
  assert.equal(d.storageMaxCall, 'fetch');
  call('map', 0, 4.03125);
  call('validateFresh', 8, 12.03125);
  assert.equal(d.storageMaxMs, 4.03125);
  assert.equal(d.storageMaxCall, 'map');
  // Both round to 4.0 ms, but the unrounded larger duration must replace it.
  call('recentReceipts', 16, 20.046875);
  assert.equal(d.storageMaxMs, 4.046875);
  assert.equal(d.storageMaxCall, 'recentReceipts');
  call('finalize', 24, 25);
  assert.equal(d.storageMaxCall, 'recentReceipts');
  assert.equal(d.storageMaxMs, 4.046875);
  assert.equal(d.storageCalls, 5);
  assert.equal(d.storageMs, 13.109375);
});

test('8 opt-out: storageMaxCall is absent without diagnostics', async t => {
  const { core } = fixture(t);
  for (const input of [request, { ...request, diagnostics: false }]) {
    const value = ok(await core.recall(input));
    assert.equal(Object.hasOwn(value, 'storageMaxCall'), false);
    assert.equal(Object.hasOwn(value, 'diagnostics'), false);
  }
});

import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { DatabaseSync } from 'node:sqlite';
import { Worker } from 'node:worker_threads';
import { gunzipSync } from 'node:zlib';
import test from 'node:test';
import { setTimeout as delay } from 'node:timers/promises';
import { openMemoryCore } from '../contract.mjs';
import * as runtime from '../runtime.mjs';
import { createTestWorkspace } from '../../tools/testing/workspace.mjs';

const base = '295eb99e1c841ab2d01f15ef9b39b292e4f32237';
const scratch = fileURLToPath(new URL('../../.research-private/recall-diagnostics/', import.meta.url));
mkdirSync(scratch, { recursive: true });
const namespace = { ownerId: 'recall-diagnostics-test', scope: 'personal', projectId: null };
const request = { readSet: [namespace], query: 'Synthetic note' };
const keys = ['recallMs', 'hostWaitMs', 'storageMs', 'storageCalls', 'storageMaxMs', 'journalMode'];
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
  const workspace = createTestWorkspace(t, { prefix: 'diagnostics-', parent: scratch });
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
  for (const name of keys.slice(0, -1)) {
    assert.ok(Number.isFinite(d[name]) && d[name] >= 0, name);
    if (name !== 'storageCalls') assert.equal(d[name], Math.round(d[name] * 10) / 10, name);
  }
  assert.ok(Number.isInteger(d.storageCalls) && d.storageCalls > 0);
  assert.ok(d.recallMs >= d.hostWaitMs);
  assert.ok(d.recallMs >= d.storageMs);
  assert.ok(d.storageMs >= d.storageMaxMs);
  return d;
}

// Restore only changed engine sources, with the remaining imports resolved to
// their unchanged originals. No live checkout source is overwritten by a test.
async function restoredBase(t) {
  const workspace = createTestWorkspace(t, { prefix: 'restored-', parent: scratch });
  const packed = readFileSync(new URL('./fixtures/recall-diagnostics-base.json.gz', import.meta.url));
  assert.equal(createHash('sha256').update(packed).digest('hex'),
    '6d2ada1c9dead8744cbaf71cf14c28e643eda0a041adb94206820d62f2e80af9');
  const frozen = JSON.parse(gunzipSync(packed));
  assert.equal(frozen.base, base);
  const names = Object.keys(frozen.files);
  for (const name of names) {
    const restored = frozen.files[name];
    assert.equal(createHash('sha256').update(restored.source).digest('hex'), restored.sha256);
    const original = new URL('../' + name, import.meta.url);
    const source = restored.source.replace(/(\bfrom\s*['"])(\.[^'"]+)(['"])/g, (_, start, specifier, end) => {
      const target = new URL(specifier, original);
      const replacement = names.includes(target.pathname.split('/').at(-1))
        ? pathToFileURL(join(workspace.path, target.pathname.split('/').at(-1))) : target;
      return start + replacement.href + end;
    }).replaceAll("new URL('./prompts/", "new URL('" + new URL('../prompts/', import.meta.url).href);
    writeFileSync(join(workspace.path, name), source);
  }
  return import(pathToFileURL(join(workspace.path, 'contract.mjs')).href);
}

test('1 opt-out identity: restored base, omitted and false preserve bytes, key order and every prepared SQL text', async t => {
  const f = fixture(t), restored = await restoredBase(t);
  const reference = restored.openMemoryCore({ path: f.path, model: f.port });
  f.workspace.defer(() => reference.close());
  const before = await observers(() => reference.recall(request));
  const absent = await observers(() => f.core.recall(request));
  const disabled = await observers(() => f.core.recall({ ...request, diagnostics: false }));
  ok(before.result);
  for (const observed of [absent, disabled]) {
    assert.deepEqual(observed, before);
    assert.equal(JSON.stringify(observed), JSON.stringify(before));
    assert.deepEqual(Object.keys(observed.result.value), Object.keys(before.result.value));
    assert.equal(Object.hasOwn(observed.result.value, 'diagnostics'), false);
  }
  writeFileSync(join(scratch, `base-${process.version}.json`), JSON.stringify(before, null, 2) + '\n');
  t.diagnostic(JSON.stringify({ base, preparedCalls: before.sql.length, output: digest(before.result), sql: digest(before.sql), observers: before.observers }));
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
  const d = shape(plain, ok(observed.result));
  assert.ok(d.storageMaxMs >= 80, JSON.stringify(d));
  assert.equal(d.journalMode, 'delete');
  assert.equal(await joined, 0);
  t.diagnostic(JSON.stringify(d));
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

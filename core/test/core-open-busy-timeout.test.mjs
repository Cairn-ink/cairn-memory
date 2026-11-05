import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { existsSync, lstatSync } from 'node:fs';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import test from 'node:test';
import { openMemoryCore, createMemoryCore } from '../contract.mjs';
import { openMemoryStore, openContextReader } from '../index.mjs';
import { createMemoryRuntime } from '../runtime.mjs';
import { openDatabase, isStorageBusy } from '../database.mjs';
import { openReadDatabase } from '../read-database.mjs';
import { openContextCore } from '../context-read-facade.mjs';
import { createTestWorkspace } from '../../tools/testing/workspace.mjs';
import { host as roleHost } from './role-fixture.mjs';

const namespace = { ownerId: 'synthetic', scope: 'personal', projectId: null };
const model = { countTokens: () => 1 };
const authority = { authorize() { return null; }, isCurrent() { return null; } };
const contextRead = { version: 'context-read-v1', authority };
const rawConversations = () => ({ mode: 'off', configureCap: false, readPolicy() { return {}; } });
const ok = result => { assert.equal(result.ok, true, JSON.stringify(result)); return result.value; };
const busy = result => assert.deepEqual(result, { ok: false, error: { code: 'storage_busy', retryable: true } });

function fixture(t, extra = {}) {
  const workspace = createTestWorkspace(t, { prefix: 'core-busy-timeout-' });
  const path = join(workspace.path, 'store.sqlite');
  const core = openMemoryCore({ path, model, ...extra });
  workspace.defer(() => core.close());
  return { workspace, path, core };
}

// The RESERVED lock belongs to a different process. Neither process uses raw
// file descriptors for the database; SQLite owns all database handles.
const writerSource = `
import { DatabaseSync } from 'node:sqlite';
const db = new DatabaseSync(process.argv[1]);
let closed = false;
function release() {
  if (closed) return;
  closed = true;
  try { if (db.isTransaction) db.exec('ROLLBACK'); } finally { db.close(); }
  if (process.connected) process.disconnect();
}
process.on('message', message => { if (message === 'release') release(); });
process.on('disconnect', release);
const watchdog = setTimeout(release, 15000);
watchdog.unref();
db.exec(process.argv[2] === 'exclusive' ? 'BEGIN EXCLUSIVE' : 'BEGIN IMMEDIATE');
process.send('ready');
`;
function writer(path, mode = 'reserved') {
  const child = spawn(process.execPath, ['--input-type=module', '--eval', writerSource, path, mode],
    { stdio: ['ignore', 'ignore', 'pipe', 'ipc'] });
  let stderr = '';
  child.stderr.on('data', data => { stderr += data; });
  const ended = new Promise(resolve => child.once('close', (code, signal) => resolve({ code, signal })));
  const ready = new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(Error('writer readiness timed out: ' + stderr)), 10000);
    const finish = work => { clearTimeout(timer); work(); };
    child.once('error', error => finish(() => reject(error)));
    child.once('message', message => finish(() => message === 'ready' ? resolve() : reject(Error('unexpected writer message'))));
    child.once('exit', () => finish(() => reject(Error('writer exited before readiness: ' + stderr))));
  });
  return { ready, async release() {
    if (child.connected) child.send('release', () => {});
    const timer = setTimeout(() => child.kill('SIGKILL'), 5000);
    try {
      const { code, signal } = await ended;
      assert.equal(signal, null, stderr);
      assert.equal(code, 0, stderr);
    } finally { clearTimeout(timer); }
  } };
}
function boundedWait(work, minimum, maximum) {
  const start = performance.now();
  work();
  const elapsed = performance.now() - start;
  // Functional pass/fail bounds, deliberately broad; no benchmark output.
  assert.ok(elapsed >= minimum, 'busy wait ended before its lower bound');
  assert.ok(elapsed < maximum, 'busy wait exceeded its upper bound');
}
function observeTimeouts(t, open) {
  const seen = new Set(), timeouts = [], files = [], exec = DatabaseSync.prototype.exec;
  const mock = t.mock.method(DatabaseSync.prototype, 'exec', function(sql) {
    const result = exec.call(this, sql);
    if (!seen.has(this)) {
      seen.add(this);
      timeouts.push(this.prepare('PRAGMA busy_timeout').get().timeout);
      files.push(this.prepare('PRAGMA database_list').get().file);
    }
    return result;
  });
  try { return { value: open(), timeouts, files }; } finally { mock.mock.restore(); }
}

for (const busyTimeoutMs of [250, 0]) {
  test(`open under cross-process RESERVED lock respects ${busyTimeoutMs}ms`, async t => {
    const f = fixture(t); f.core.close();
    const held = writer(f.path);
    try {
      await held.ready;
      boundedWait(() => assert.throws(() => openMemoryCore({ path: f.path, busyTimeoutMs }),
        // Open has always thrown the native BUSY; method facades map it below.
        error => isStorageBusy(error)), busyTimeoutMs ? 200 : 0, busyTimeoutMs ? 2500 : 250);
    } finally { await held.release(); }
    openMemoryCore({ path: f.path, busyTimeoutMs }).close();
  });

  test(`map respects ${busyTimeoutMs}ms; list/get survive RESERVED; release restores use`, async t => {
    const f = fixture(t, { busyTimeoutMs });
    const saved = ok(f.core.admit({ namespace, memory: { content: 'Synthetic retained fact.', kind: 'fact' },
      receipts: [{ client: 'synthetic', sessionId: 'session', eventId: 'event', role: 'user', excerpt: 'Synthetic retained fact.' }] }));
    const held = writer(f.path);
    try {
      await held.ready;
      boundedWait(() => busy(f.core.map({ namespace })), busyTimeoutMs ? 200 : 0, busyTimeoutMs ? 2500 : 250);
      assert.equal(ok(f.core.list({ namespace })).memories.length, 1);
      assert.equal(ok(f.core.get({ namespace, memoryId: saved.memory.id })).memory.content, 'Synthetic retained fact.');
    } finally { await held.release(); }
    ok(f.core.map({ namespace }));
    assert.equal(ok(f.core.list({ namespace })).memories.length, 1);
    ok(f.core.get({ namespace, memoryId: saved.memory.id }));
  });
}

test('default canonical writer remains 5000ms; valid bounds reach constructor before first statement', t => {
  // Reuse the runtime's existing connection seam; no production test port.
  let db;
  const runtime = createMemoryRuntime({ path: ':memory:' }, { attachRaw(connection) { db = connection; } });
  try { assert.equal(db.prepare('PRAGMA busy_timeout').get().timeout, 5000); } finally { runtime.close(); }
  for (const busyTimeoutMs of [undefined, 0, 1, 250, 5000]) {
    const { value: core, timeouts } = observeTimeouts(t, () => openMemoryCore({ path: ':memory:',
      ...(busyTimeoutMs === undefined ? {} : { busyTimeoutMs }) }));
    try { assert.deepEqual(timeouts, [busyTimeoutMs ?? 5000]); } finally { core.close(); }
  }
});

for (const busyTimeoutMs of [250, 0]) {
  test(`canonical context reader respects ${busyTimeoutMs}ms under cross-process EXCLUSIVE lock`, async t => {
    const f = fixture(t); f.core.close();
    const held = writer(f.path, 'exclusive');
    try {
      await held.ready;
      boundedWait(() => assert.throws(() => openReadDatabase(f.path, { contextRead: true, busyTimeoutMs }),
        error => isStorageBusy(error)), busyTimeoutMs ? 200 : 0, busyTimeoutMs ? 2500 : 250);
    } finally { await held.release(); }
    const reader = openReadDatabase(f.path, { contextRead: true, busyTimeoutMs });
    reader.db.close();
  });
}

test('runtime, internal core, legacy store and raw composition preserve the option', t => {
  for (const open of [createMemoryCore, createMemoryRuntime, openMemoryStore,
    input => openMemoryCore({ ...input, rawConversations: rawConversations() })]) {
    const { value: core, timeouts } = observeTimeouts(t, () => open({ path: ':memory:', busyTimeoutMs: 250 }));
    try { assert.deepEqual(timeouts, [250]); } finally { core.close(); }
  }
});

test('context wrapper and role-context variant bound both canonical connections', t => {
  const h = roleHost();
  for (const extra of [{ contextRead }, { contextRead: h.context, roleProfiles: h.options, methodPackages: h.methods, assets: h.assets }]) {
    const workspace = createTestWorkspace(t, { prefix: 'core-busy-context-' });
    const path = join(workspace.path, 'store.sqlite');
    const { value: core, timeouts, files } = observeTimeouts(t, () => openMemoryCore({ path,
      busyTimeoutMs: 250, ...extra }));
    try {
      // Method/asset/role attestation also opens private in-memory reference
      // schemas. They cannot contend with another process and keep zero wait.
      assert.deepEqual(timeouts, extra.roleProfiles ? [250, 0, 0, 0, 250] : [250, 250]);
      assert.deepEqual(files, extra.roleProfiles ? [path, '', '', '', path] : [path, path]);
    } finally { core.close(); }
  }
  const workspace = createTestWorkspace(t, { prefix: 'core-busy-default-context-' });
  const { value: core, timeouts } = observeTimeouts(t, () => openMemoryCore({
    path: join(workspace.path, 'store.sqlite'), contextRead }));
  try { assert.deepEqual(timeouts, [5000, 5000]); } finally { core.close(); }
});

test('existingStore, context preflight and standalone context reader retain lower timeouts', t => {
  const f = fixture(t, { rawConversations: rawConversations() }); f.core.close();
  const db = new DatabaseSync(f.path, { readOnly: true });
  let storeId;
  try { storeId = db.prepare('SELECT store_id FROM store_metadata').get().store_id; } finally { db.close(); }
  const existingStore = { version: 'schema29-existing-v1', storeId };
  for (const busyTimeoutMs of [0, 250, 5000]) {
    for (const extra of [{}, { contextRead }]) {
      const { value: core, timeouts } = observeTimeouts(t, () => openMemoryCore({ path: f.path, existingStore,
        busyTimeoutMs, ...extra }));
      try { assert.deepEqual(timeouts, Array(extra.contextRead ? 3 : 1).fill(busyTimeoutMs)); } finally { core.close(); }
    }
    const { value: reader, timeouts } = observeTimeouts(t, () => openContextReader({ path: f.path, contextRead, busyTimeoutMs }));
    try { assert.deepEqual(timeouts, [busyTimeoutMs]); } finally { reader.close(); }
  }
  // A non-context reader's zero wait must never be raised by the new ceiling.
  const read = openReadDatabase(f.path, { busyTimeoutMs: 250 });
  try { assert.equal(read.db.prepare('PRAGMA busy_timeout').get().timeout, 0); } finally { read.db.close(); }
});

test('storeFence writer receives the timeout at construction', t => {
  const f = fixture(t); f.core.close();
  const db = new DatabaseSync(f.path, { readOnly: true });
  let metadata;
  try { metadata = { applicationId: db.prepare('PRAGMA application_id').get().application_id,
    userVersion: db.prepare('PRAGMA user_version').get().user_version,
    storeId: db.prepare('SELECT store_id FROM store_metadata').get().store_id }; } finally { db.close(); }
  const stat = lstatSync(f.path, { bigint: true });
  const storeFence = { version: 'store-fence-v1', dev: String(stat.dev), ino: String(stat.ino), ...metadata };
  const { value: core, timeouts } = observeTimeouts(t, () => openMemoryCore({ path: f.path, storeFence, busyTimeoutMs: 250 }));
  try { assert.deepEqual(timeouts, [250]); } finally { core.close(); }
});

test('invalid values reject before filesystem effects on plain and existingStore paths', t => {
  const workspace = createTestWorkspace(t, { prefix: 'core-busy-invalid-' });
  const bad = [5001, -1, 1.5, NaN, Infinity, '250', 250n, undefined, null, true, {}, []];
  const existingStore = { version: 'schema29-existing-v1', storeId: 'synthetic' };
  let attempted = 0, accessed = 0;
  const openers = [openMemoryCore, createMemoryCore, createMemoryRuntime, openMemoryStore,
    input => { Object.defineProperty(input, 'contextRead', { value: contextRead, enumerable: true }); return openMemoryCore(input); },
    input => { Object.defineProperty(input, 'rawConversations', { value: rawConversations(), enumerable: true }); return openMemoryCore(input); },
    input => { Object.defineProperty(input, 'contextRead', { value: contextRead, enumerable: true }); return openContextReader(input); }, openDatabaseOptions, openReadDatabaseOptions];
  const h = roleHost();
  openers.push(input => {
    Object.assign(input, { contextRead: h.context, roleProfiles: h.options, methodPackages: h.methods, assets: h.assets });
    return openMemoryCore(input);
  });
  function optionsWithoutPath(input) {
    const descriptors = Object.getOwnPropertyDescriptors(input); delete descriptors.path;
    return Object.create(Object.getPrototypeOf(input), descriptors);
  }
  function openDatabaseOptions(input) { return openDatabase(input.path, optionsWithoutPath(input)); }
  function openReadDatabaseOptions(input) { return openReadDatabase(input.path, optionsWithoutPath(input)); }
  for (const open of openers) for (const managed of [false, true]) {
    // The legacy and standalone read constructors do not accept existingStore.
    // Their plain path still must reject before any filesystem access.
    if (managed && [openMemoryStore, openers[6]].includes(open)) continue;
    for (const value of [...bad, 'accessor', 'hidden-accessor', 'inherited']) {
      const parent = join(workspace.path, 'absent-' + attempted++), path = join(parent, 'store.sqlite');
      let input = { path, ...(managed ? { existingStore } : {}) };
      if (value === 'accessor' || value === 'hidden-accessor') {
        Object.defineProperty(input, 'busyTimeoutMs', { enumerable: value === 'accessor', get() { accessed++; return 250; } });
      } else if (value === 'inherited') input = Object.assign(Object.create({ busyTimeoutMs: 250 }), input);
      else input.busyTimeoutMs = value;
      assert.throws(() => { const unexpected = open(input); unexpected?.close(); }, { code: 'invalid_input' });
      assert.equal(existsSync(path), false);
      assert.equal(existsSync(parent), false);
    }
  }
  assert.equal(accessed, 0);
  t.diagnostic(`validated ${attempted} invalid constructor inputs without creating files or parent directories`);
});

test('no per-call busyTimeoutMs on map, list or get', t => {
  const f = fixture(t, { busyTimeoutMs: 250 });
  for (const [method, input] of [['map', { namespace }], ['list', { namespace }], ['get', { namespace, memoryId: 'synthetic' }]]) {
    assert.deepEqual(f.core[method]({ ...input, busyTimeoutMs: 0 }),
      { ok: false, error: { code: 'invalid_input', retryable: false } });
  }
});

test('Proxy inputs without the option retain each opener\'s existing acceptance rule', t => {
  const f = fixture(t); f.core.close();
  const openers = [
    ['openMemoryCore', { path: ':memory:' }, openMemoryCore, 'invalid_input'],
    ['createMemoryCore', { path: ':memory:' }, createMemoryCore, 'invalid_input'],
    ['createMemoryRuntime', { path: ':memory:' }, createMemoryRuntime],
    ['openMemoryStore', { path: ':memory:' }, openMemoryStore],
    ['openContextReader', { path: f.path, contextRead }, openContextReader, 'invalid_input'],
    ['openContextCore', { path: ':memory:' }, input => openContextCore(input, contextRead, () => ({ close() {} }))],
    ['openContextCore with core validation', { path: ':memory:' }, input => openContextCore(input, contextRead, openMemoryCore), 'invalid_input'],
    ['openDatabase', {}, input => openDatabase(':memory:', input)],
    ['openReadDatabase', { contextRead: true }, input => openReadDatabase(f.path, input)],
    ['context composition', { path: ':memory:', contextRead }, openMemoryCore, 'invalid_input'],
    ['raw composition', { path: ':memory:', rawConversations: rawConversations() }, openMemoryCore, 'invalid_input'],
  ];
  const h = roleHost();
  openers.push(['role-context composition', { path: ':memory:', contextRead: h.context,
    roleProfiles: h.options, methodPackages: h.methods, assets: h.assets }, openMemoryCore, 'invalid_input']);
  for (const [name, fields, open, code] of openers) {
    const input = new Proxy(fields, {});
    if (code) assert.throws(() => open(input), { code }, name);
    else {
      const value = open(input);
      (value.db ?? value).close();
    }
    // A supplied option cannot be attested as an own data property on a Proxy.
    for (const busyTimeoutMs of [250, undefined, -1, 5001]) {
      assert.throws(() => open(new Proxy({ ...fields, busyTimeoutMs }, {})), { code: 'invalid_input' }, name);
    }
    let accessed = 0;
    const accessor = Object.defineProperty({ ...fields }, 'busyTimeoutMs', {
      get() { accessed++; throw Error('timeout getter must not run'); },
    });
    assert.throws(() => open(new Proxy(accessor, {})), { code: 'invalid_input' }, name);
    const inherited = Object.assign(Object.create({ busyTimeoutMs: 250 }), fields);
    assert.throws(() => open(new Proxy(inherited, {})), { code: 'invalid_input' }, name);
    assert.equal(accessed, 0, name);
  }
});

test('reader branches whose native default is zero never raise it', t => {
  const f = fixture(t); f.core.close();
  for (const busyTimeoutMs of [undefined, 0, 250, 5000]) {
    let atOpen;
    const productSqlite = {
      files() { return () => {}; },
      open(native) {
        atOpen = native.prepare('PRAGMA busy_timeout').get().timeout;
        return { db: native };
      },
      openingFailure(error) { throw error; },
    };
    const nativeObserver = {
      invoke(_phase, _operation, open) { return open(); },
      database(native) { return native; },
    };
    for (const branch of [{ productSqlite }, { nativeObserver }, {}]) {
      const read = openReadDatabase(f.path, { contextRead: Boolean(branch.productSqlite || branch.nativeObserver),
        ...branch, ...(busyTimeoutMs === undefined ? {} : { busyTimeoutMs }) });
      try {
        if (branch.productSqlite) assert.equal(atOpen, 0, 'before branch-specific configuration');
        assert.equal(read.db.prepare('PRAGMA busy_timeout').get().timeout, 0);
      } finally { read.db.close(); }
    }
  }
});

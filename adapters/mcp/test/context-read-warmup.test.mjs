import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { spawnSync } from 'node:child_process';
import { DatabaseSync } from 'node:sqlite';
import { createTestWorkspace } from '../../../tools/testing/workspace.mjs';
import { openMemoryCore } from '../../../core/index.mjs';
import { createCairnServer } from '../server.mjs';
import { controlledClock } from '../../../core/testing/context-read-assembly-fixture.mjs';
import { createContextReadAccess } from '../context-read-access.mjs';
import { startLocalContextMaintenance } from '../../../core/local-defaults.mjs';

const ns = { ownerId: 'synthetic-owner', scope: 'personal', projectId: null };
const counter = { id: 'synthetic', countTokens: () => 1 };
for (const closeImmediately of [false, true]) test(`local lexical warm-up ${closeImmediately ? 'is cancelled by close (unchanged)' : 'publishes without a first read or embedding provider'}`, async t => {
  controlledClock(t);
  const workspace = createTestWorkspace(t), path = join(workspace.path, 'memory.sqlite');
  const core = openMemoryCore({ path });
  assert.equal(core.admit({ namespace: ns, memory: { content: 'Synthetic telescope', kind: 'fact' }, receipts: [{
    client: 'synthetic', sessionId: 'synthetic', eventId: 'synthetic', role: 'user', excerpt: 'Synthetic telescope' }] }).ok, true);
  core.close();
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const server = createCairnServer({ path, namespace: ns, raw: false, contextSemantic: false, contextCounter: counter });
  assert.equal(existsSync(path + '.context-read-v1.sqlite'), false, 'opening only schedules work');
  if (closeImmediately) await server.close();
  t.mock.timers.tick(0);
  for (let i = 0; i < 8; i++) await Promise.resolve();
  try {
    assert.equal(existsSync(path + '.context-read-v1.sqlite'), !closeImmediately);
    if (!closeImmediately) {
      const side = new DatabaseSync(path + '.context-read-v1.sqlite', { readOnly: true });
      try { assert.equal(side.prepare('SELECT published FROM generations').get().published, 1); }
      finally { side.close(); }
    }
  } finally { await server.close(); t.mock.timers.reset(); }
});

const flush = async () => { for (let i = 0; i < 80; i++) await Promise.resolve(); };
for (const semantic of [false, true]) test(`local ${semantic ? 'semantic' : 'lexical'} maintenance timing and idle cadence`, async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  let now = 0, changed = true;
  const turns = [], core = { getContextReadCapabilities: () => ({ ok: true, value: { types: ['memory'] } }) };
  const driver = startLocalContextMaintenance(core, { readSet: [ns], call(_core, method, input) {
    assert.equal(method, 'refreshContextIndex');
    turns.push({ at: now, budget: input.budget });
    const transformed = Number(changed); changed = false;
    return { ok: true, value: { status: 'complete', progress: { transformed, embeddingAttempts: 0 } } };
  } }, { semantic });
  const tick = async ms => { now += ms; t.mock.timers.tick(ms); await flush(); };
  try {
    await tick(0); assert.equal(turns.length, semantic ? 0 : 1);
    await tick(999); assert.equal(turns.length, semantic ? 0 : 1);
    await tick(1); assert.equal(turns.length, semantic ? 1 : 2);
    assert.deepEqual(turns[0].budget, { maxItems: semantic ? 16 : 1024, maxMs: semantic ? 1000 : 25 });
    if (semantic) {
      await tick(1000); await tick(1000);
      assert.deepEqual(turns.map(turn => turn.at), [1000, 2000, 3000]);
    } else {
      await tick(29_999); assert.equal(turns.length, 2, 'unchanged completion backs off');
      changed = true; await tick(1); assert.equal(turns.length, 3, 'idle observation discovers new capture/invalidation');
      await tick(1000); assert.equal(turns.length, 4, 'new work resumes the active cadence');
    }
  } finally { await driver.close(); t.mock.timers.reset(); }
});

// Main's timer (adapters/mcp/server.mjs before this helper) waits 1000 ms
// initially and 1000 ms after settlement, with 16 items / 1000 ms per turn.
// Drive the same real core/provider with that reference schedule and this lane.
test('configured recording embedder matches main sends over a fixed window', async t => {
  controlledClock(t);
  const records = [];
  for (const reference of [true, false]) {
    const workspace = createTestWorkspace(t), path = join(workspace.path, 'memory.sqlite');
    const seed = openMemoryCore({ path });
    for (let i = 0; i < 40; i++) assert.equal(seed.admit({ namespace: ns,
      memory: { content: 'Synthetic telescope ' + i, kind: 'fact' }, receipts: [{
        client: 'synthetic', sessionId: 'synthetic', eventId: 'synthetic-' + i, role: 'user', excerpt: 'Synthetic telescope' }] }).ok, true);
    seed.close();
    const access = createContextReadAccess(ns, false, { maintenance: true });
    let now = 0;
    const calls = [], embedder = { id: 'synthetic-timer-' + reference, revision: '1', dimensions: 2, normalization: 'l2',
      async embed(texts) { calls.push({ at: now, count: texts.length }); return texts.map(() => [1, 0]); } };
    const embedding = { embedder, policy: { family: 'hosted', maxRequests: 100, maxUsd: 1, maxConcurrent: 1, estimateUsd: () => 0 } };
    const core = openMemoryCore({ path, contextRead: { ...access.configuration, counter, ...embedding } });
    assert.equal((await access.call(core, 'refreshContextIndex', { readSet: [ns], types: ['memory'], intent: 'current',
      budget: { maxItems: 1024, maxMs: 5000 } })).ok, true);
    // Remove only synthetic vectors to give each schedule the same ready index.
    await core.close();
    const side = new DatabaseSync(path + '.context-read-v1.sqlite'); side.exec('DELETE FROM vectors'); side.close();
    calls.length = 0;
    t.mock.timers.enable({ apis: ['setTimeout'] });
    let server, driver, closed = false, timer, active;
    if (reference) {
      const reopened = openMemoryCore({ path, contextRead: { ...access.configuration, counter, ...embedding } });
      const arm = () => { if (!closed) timer = setTimeout(() => {
        active = Promise.resolve(access.call(reopened, 'refreshContextIndex', { readSet: [ns], types: ['memory'], intent: 'current',
          budget: { maxItems: 16, maxMs: 1000 } })).finally(() => { active = null; arm(); });
      }, 1000); };
      arm(); driver = { async close() { closed = true; clearTimeout(timer); await active; await reopened.close(); } };
    } else server = createCairnServer({ path, namespace: ns, raw: false, contextCounter: counter, contextEmbedding: embedding });
    const tick = async ms => { now += ms; t.mock.timers.tick(ms); await flush(); };
    try {
      await tick(0); await tick(250); await tick(749);
      assert.deepEqual(calls, [], 'no stored text is embedded before main first-delay point');
      await tick(1); await tick(1000); await tick(1000); await tick(1000);
      records.push(calls);
      assert.deepEqual(calls, [{ at: 1000, count: 16 }, { at: 2000, count: 16 }, { at: 3000, count: 8 }]);
    } finally { await (server ?? driver).close(); t.mock.timers.reset(); }
  }
  assert.deepEqual(records[1], records[0]);
});

for (const rejects of [false, true]) test(`close joins an active lexical refresh that ${rejects ? 'rejects' : 'settles'} late`, async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  let settle, calls = 0;
  const core = { getContextReadCapabilities: () => ({ ok: true, value: { types: ['memory'] } }) };
  const driver = startLocalContextMaintenance(core, { readSet: [ns], call() {
    calls++; return new Promise((resolve, reject) => { settle = () => rejects ? reject(Error('synthetic')) : resolve({ ok: true }); });
  } });
  t.mock.timers.tick(0); await flush();
  let closed = false; const closing = driver.close().then(() => { closed = true; });
  await flush(); assert.equal(closed, false);
  settle(); await closing;
  t.mock.timers.tick(60_000); await flush(); assert.equal(calls, 1);
  t.mock.timers.reset();
});

test('lexical warm-up yields to a queued capture after its small cooperative slice', async t => {
  const workspace = createTestWorkspace(t), path = join(workspace.path, 'memory.sqlite');
  const access = createContextReadAccess(ns, false, { maintenance: true });
  const core = openMemoryCore({ path, contextRead: { ...access.configuration, counter } });
  const admit = i => core.admit({ namespace: ns, memory: { content: 'Synthetic telescope ' + i, kind: 'fact' }, receipts: [{
    client: 'synthetic', sessionId: 'synthetic', eventId: 'synthetic-' + i, role: 'user', excerpt: 'Synthetic telescope' }] });
  for (let i = 0; i < 40; i++) assert.equal(admit(i).ok, true);
  const clock = controlledClock(t), prepare = DatabaseSync.prototype.prepare;
  let queued = false, waited, capture;
  t.mock.method(DatabaseSync.prototype, 'prepare', function(sql) {
    const statement = Reflect.apply(prepare, this, [sql]);
    if (sql.startsWith('SELECT content AS text')) {
      const get = statement.get.bind(statement);
      statement.get = (...args) => {
        const row = get(...args);
        if (!queued) { queued = true; queueMicrotask(() => { waited = clock.now(); capture = admit('queued'); }); }
        clock.advance(2); return row;
      };
    }
    return statement;
  });
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const driver = startLocalContextMaintenance(core, access);
  try {
    t.mock.timers.tick(0); await flush();
    assert.equal(queued, true); assert.equal(capture.ok, true);
    assert.equal(waited, 26, '25 ms slice plus the last synchronous 2 ms item');
  } finally { await driver.close(); await core.close(); t.mock.timers.reset(); }
});

test('server close joins a configured provider that settles after shutdown starts', async t => {
  controlledClock(t);
  const workspace = createTestWorkspace(t), path = join(workspace.path, 'memory.sqlite');
  const access = createContextReadAccess(ns, false, { maintenance: true });
  const core = openMemoryCore({ path, contextRead: { ...access.configuration, counter } });
  assert.equal(core.admit({ namespace: ns, memory: { content: 'Synthetic telescope', kind: 'fact' }, receipts: [{
    client: 'synthetic', sessionId: 'synthetic', eventId: 'synthetic', role: 'user', excerpt: 'Synthetic telescope' }] }).ok, true);
  assert.equal((await access.call(core, 'refreshContextIndex', { readSet: [ns], types: ['memory'], intent: 'current',
    budget: { maxItems: 1024, maxMs: 1000 } })).ok, true);
  await core.close();
  let settle, calls = 0;
  const embedder = { id: 'synthetic-late', revision: '1', dimensions: 2, normalization: 'l2', embed(texts) {
    calls++; return new Promise(resolve => { settle = () => resolve(texts.map(() => [1, 0])); });
  } };
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const server = createCairnServer({ path, namespace: ns, raw: false, contextCounter: counter,
    contextEmbedding: { embedder, policy: { family: 'hosted', maxRequests: 10, maxUsd: 1, estimateUsd: () => 0 } } });
  try {
    t.mock.timers.tick(1000); await flush(); assert.equal(calls, 1);
    let closed = false; const closing = server.close().then(() => { closed = true; });
    await flush(); assert.equal(closed, false);
    settle(); await closing;
    t.mock.timers.tick(60_000); await flush(); assert.equal(calls, 1);
    const side = new DatabaseSync(path + '.context-read-v1.sqlite', { readOnly: true });
    try { assert.equal(side.prepare('SELECT count(*) AS n FROM vectors').get().n, 0, 'revoked refresh cannot publish late vectors'); }
    finally { side.close(); }
  } finally { if (settle) settle(); await server.close(); t.mock.timers.reset(); }
});

// First read publishes a cold lexical projection before the semantic timer.
for (const mode of ['paused', 'disabled', 'second-process', 'enabled']) test(`cold first-read publication respects saving ${mode} at the semantic timer`, async t => {
  controlledClock(t);
  const workspace = createTestWorkspace(t), path = join(workspace.path, 'memory.sqlite');
  const seed = openMemoryCore({ path });
  assert.equal(seed.admit({ namespace: ns, memory: { content: 'Synthetic telescope', kind: 'fact' }, receipts: [{
    client: 'synthetic', sessionId: 'synthetic', eventId: 'synthetic', role: 'user', excerpt: 'Synthetic telescope' }] }).ok, true);
  await seed.close();
  const setControl = setting => {
    const child = spawnSync(process.execPath, ['--input-type=module', '-e', `
      import { DatabaseSync } from 'node:sqlite';
      const db = new DatabaseSync(process.argv[1]);
      try { db.prepare('INSERT INTO episode_controls(owner_id,scope,project_id,generation,paused,enabled) VALUES(?,?,?,?,?,?) ON CONFLICT(owner_id,scope,project_id) DO UPDATE SET paused=excluded.paused,enabled=excluded.enabled')
        .run('synthetic-owner','personal','','synthetic', Number(process.argv[2]), Number(process.argv[3])); }
      finally { db.close(); }
    `, path, String(Number(setting === 'paused')), String(Number(setting !== 'disabled'))], { encoding: 'utf8', env: {}, timeout: 10000 });
    assert.equal(child.error, undefined); assert.equal(child.status, 0, child.stderr);
  };
  if (mode === 'paused' || mode === 'disabled') setControl(mode);
  const records = [];
  for (const reference of mode === 'enabled' ? [true, false] : [false]) {
    let now = 0;
    const calls = [], embedder = { id: 'synthetic-cold', revision: '1', dimensions: 2, normalization: 'l2',
      async embed(texts) { calls.push({ at: now, count: texts.length }); return texts.map(() => [1, 0]); } };
    const access = createContextReadAccess(ns, false, { maintenance: true });
    const core = openMemoryCore({ path, contextRead: { ...access.configuration, counter, embedder,
      policy: { family: 'hosted', maxRequests: 100, maxUsd: 1, estimateUsd: () => 0 } } });
    t.mock.timers.enable({ apis: ['setTimeout'] });
    let closed = false, timer, active;
    const arm = () => { if (!closed) timer = setTimeout(() => {
      active = Promise.resolve(access.call(core, 'refreshContextIndex', { readSet: [ns], types: ['memory'], intent: 'current',
        budget: { maxItems: 16, maxMs: 1000 } })).finally(() => { active = null; arm(); });
    }, 1000); };
    // Reference is main's unchanged semantic schedule, on the same cold read.
    let driver;
    if (reference) { arm(); driver = { async close() { closed = true; clearTimeout(timer); await active; } }; }
    else driver = startLocalContextMaintenance(core, access, { semantic: true });
    try {
      const read = await access.call(core, 'contextRead', { readSet: [ns], types: ['memory'], intent: 'current', query: 'telescope', raw: false, semantic: false });
      assert.equal(read.ok, true, JSON.stringify(read)); assert.equal(read.value.metered.items.length, 1);
      const side = new DatabaseSync(path + '.context-read-v1.sqlite', { readOnly: true });
      try { assert.equal(side.prepare('SELECT published FROM generations').get().published, 1); } finally { side.close(); }
      assert.deepEqual(calls, [], 'first read never enters the provider');
      if (mode === 'second-process') setControl('paused');
      for (const ms of [999, 1, 1000, 1000]) { now += ms; t.mock.timers.tick(ms); await flush(); if (now < 1000) assert.deepEqual(calls, []); }
      if (mode === 'enabled') assert.deepEqual(calls, [{ at: 1000, count: 1 }]);
      else assert.deepEqual(calls, [], 'paused or disabled stored text never enters the provider');
      records.push(calls);
    } finally { await driver.close(); await core.close(); t.mock.timers.reset(); }
    if (reference) unlinkSync(path + '.context-read-v1.sqlite');
  }
  if (mode === 'enabled') assert.deepEqual(records[1], records[0]);
});

// Force the first read across main's deadline while it still fits the grace.
// The optional detached checkout supplies main's actual core for local parity;
// CI uses the unchanged explicit deadline path as the main reference.
for (const mode of ['paused', 'disabled', 'second-process', 'enabled']) test(`forced first-read grace preserves provider rules when saving ${mode}`, async t => {
  const clock = controlledClock(t), workspace = createTestWorkspace(t), path = join(workspace.path, 'memory.sqlite');
  const seed = openMemoryCore({ path });
  for (let i = 0; i < 40; i++) assert.equal(seed.admit({ namespace: ns,
    memory: { content: 'Synthetic telescope ' + i, kind: 'fact' }, receipts: [{ client: 'synthetic', sessionId: 'synthetic',
      eventId: 'synthetic-' + i, role: 'user', excerpt: 'Synthetic telescope' }] }).ok, true);
  await seed.close();
  const setControl = setting => {
    const child = spawnSync(process.execPath, ['--input-type=module', '-e', `
      import { DatabaseSync } from 'node:sqlite';
      const db = new DatabaseSync(process.argv[1]);
      try { db.prepare('INSERT INTO episode_controls(owner_id,scope,project_id,generation,paused,enabled) VALUES(?,?,?,?,?,?) ON CONFLICT(owner_id,scope,project_id) DO UPDATE SET paused=excluded.paused,enabled=excluded.enabled')
        .run('synthetic-owner','personal','','synthetic',Number(process.argv[2]),Number(process.argv[3])); }
      finally { db.close(); }
    `, path, String(Number(setting === 'paused')), String(Number(setting !== 'disabled'))], { encoding: 'utf8', env: {}, timeout: 10000 });
    assert.equal(child.error, undefined); assert.equal(child.status, 0, child.stderr);
  };
  if (mode === 'paused' || mode === 'disabled') setControl(mode);
  const records = [];
  for (const reference of mode === 'enabled' ? [true, false] : [false]) {
    clock.advance(-clock.now());
    const referenceRoot = reference ? process.env.CAIRN_TEST_MAIN_ROOT : undefined;
    const opener = referenceRoot ? (await import(pathToFileURL(join(referenceRoot, 'core/index.mjs')))).openMemoryCore : openMemoryCore;
    const accessFactory = referenceRoot ? (await import(pathToFileURL(join(referenceRoot, 'adapters/mcp/context-read-access.mjs')))).createContextReadAccess : createContextReadAccess;
    const access = accessFactory(ns, false, { maintenance: true }), calls = [];
    const embedder = { id: 'synthetic-forced-grace', revision: '1', dimensions: 2, normalization: 'l2',
      async embed(texts) { calls.push({ at: clock.now(), count: texts.length }); return texts.map(() => [1, 0]); } };
    t.mock.timers.enable({ apis: ['setTimeout'] });
    const core = opener({ path, contextRead: { ...access.configuration, counter, embedder,
      policy: { family: 'hosted', maxRequests: 100, maxUsd: 1, estimateUsd: () => 0 } } });
    let closed = false, active, timer, driver;
    if (reference) {
      const arm = () => { if (!closed) timer = setTimeout(() => {
        active = Promise.resolve(access.call(core, 'refreshContextIndex', { readSet: [ns], types: ['memory'], intent: 'current',
          budget: { maxItems: 16, maxMs: 1000 } })).finally(() => { active = null; arm(); });
      }, 1000); };
      arm(); driver = { async close() { closed = true; clearTimeout(timer); await active; } };
    } else driver = startLocalContextMaintenance(core, access, { semantic: true });
    try {
      let delayed = false;
      const prepare = DatabaseSync.prototype.prepare;
      const spy = t.mock.method(DatabaseSync.prototype, 'prepare', function(sql) {
        const statement = Reflect.apply(prepare, this, [sql]);
        if (sql.startsWith('SELECT content AS text')) {
          const get = statement.get.bind(statement);
          statement.get = (...args) => { const row = get(...args); if (!delayed) { delayed = true; clock.advance(1100); } return row; };
        }
        return statement;
      });
      let read;
      try {
        read = await access.call(core, 'contextRead', { readSet: [ns], types: ['memory'], intent: 'current', query: 'telescope',
          raw: false, semantic: false, ...(reference && !referenceRoot ? { deadlineMs: 1000 } : {}) });
      } finally { spy.mock.restore(); }
      assert.equal(delayed, true); assert.equal(clock.now(), 1100);
      const side = new DatabaseSync(path + '.context-read-v1.sqlite', { readOnly: true });
      let published;
      try { published = side.prepare('SELECT published FROM generations').get().published; } finally { side.close(); }
      if (reference) {
        assert.ok(!read.ok || read.value.metered.items.length === 0, 'main cold read exhausts its normal deadline');
        assert.equal(published, 0);
      } else {
        assert.equal(read.ok, true, JSON.stringify(read)); assert.ok(read.value.metered.items.length > 0);
        assert.equal(published, 1, 'grace publishes the full cold projection');
      }
      assert.deepEqual(calls, [], 'the first read only builds lexical data');
      if (mode === 'second-process') setControl('paused');
      // Deliver the already overdue first timer, then the same post-settlement
      // cadence on both cores. Provider timestamps include the first read time.
      t.mock.timers.tick(1100); await flush();
      for (let turn = 0; turn < 5; turn++) { clock.advance(1000); t.mock.timers.tick(1000); await flush(); }
      t.diagnostic('FORCED_GRACE ' + JSON.stringify({ mode, reference, actualMain: Boolean(referenceRoot), published, calls }));
      if (mode !== 'enabled') assert.deepEqual(calls, [], 'paused or disabled text never enters the provider after grace');
      records.push(calls);
    } finally { await driver.close(); await core.close(); t.mock.timers.reset(); }
    if (reference) unlinkSync(path + '.context-read-v1.sqlite');
  }
  if (mode === 'enabled') {
    const [main, branch] = records;
    assert.ok(main.length > 0); assert.equal(branch.length, main.length, 'same provider request count as main');
    assert.equal(main.reduce((n, call) => n + call.count, 0), 40);
    assert.equal(branch.reduce((n, call) => n + call.count, 0), 40);
    // A cold first read that publishes within its grace lets the unchanged semantic timer embed in turns that main
    // still spends on lexical work, so the first request may leave sooner than on main. It can never precede the
    // timer's own first delay, and the paused, disabled and second-process cases above stay at zero calls.
    assert.ok(branch.every(call => call.at >= 1000), 'no provider entry before the semantic timer\'s first delay');
  }
});

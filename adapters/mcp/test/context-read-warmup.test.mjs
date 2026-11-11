import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
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

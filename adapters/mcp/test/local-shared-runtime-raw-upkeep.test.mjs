import test from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync } from 'node:fs';
import { join } from 'node:path';
import { setImmediate as nextTurn } from 'node:timers/promises';
import { PassThrough } from 'node:stream';
import { createLocalSharedRuntime as createSharedRuntime } from '../local-shared-runtime.mjs';
import { createTestWorkspace } from '../../../tools/testing/workspace.mjs';
import { openMemoryCore } from '../../../core/contract.mjs';
import { ns, counter, query, ok, streams, connect, call, context, deferred } from './local-shared-support.mjs';
import { DatabaseSync } from 'node:sqlite';
import { createLocalRawSearch, createLocalRawSearchUpkeepControl } from '../../../core/local-raw-search.mjs';
import { openRawSearch } from '../../../core/raw-search-index.mjs';
import { sourceFixture, savedSource, request, splitRaw, ns as rawNs } from '../../../core/testing/raw-source-fixtures.mjs';
import { searchFixture } from '../../../core/testing/raw-search-fixtures.mjs';
import { installRawSearchTestClock, rawSearchTestWait } from '../../../core/testing/raw-search-clock.mjs';
import { createRawSearchMaintenance } from '../../../core/raw-search-maintenance.mjs';
import { contextReadBudgetDiagnostic } from '../../../core/context-read-budget.mjs';
import { rawSearchChunks } from '../../../core/raw-search-retrieval.mjs';
import * as idleSidecar from '../../../tools/testing/fixtures/daemon-idle-sidecar.mjs';

// Programmatic clock: callbacks advance only when the test invokes fire().
// The global interception also supplies a behavioural red on the old manager,
// which does not yet accept the host's internal scheduler seam.
function upkeepClock(t) {
  const pending = new Set(), history = [];
  const scheduler = {
    setTimer(callback, ms) {
      if (scheduler.fail || scheduler.failNext) {
        scheduler.failNext = false;
        scheduler.failures = (scheduler.failures ?? 0) + 1;
        throw Error('synthetic_schedule_failed');
      }
      const task = { callback, ms, unref() {} }; pending.add(task); history.push(task); return task;
    },
    clearTimer(task) { pending.delete(task); },
    pending, history,
    async fire(task = pending.values().next().value) {
      assert.ok(task, 'an upkeep callback is scheduled'); pending.delete(task);
      await rawSearchTestWait(1010); await task.callback();
    },
  };
  const native = globalThis.setTimeout;
  t.mock.method(globalThis, 'setTimeout', function(callback, ms, ...args) {
    if (/at arm \([^\n]*\/core\/local-raw-search.mjs:/.test(new Error().stack)) return scheduler.setTimer(callback, ms);
    return Reflect.apply(native, this, [callback, ms, ...args]);
  });
  const clear = globalThis.clearTimeout;
  t.mock.method(globalThis, 'clearTimeout', function(task) {
    if (history.includes(task)) return scheduler.clearTimer(task);
    return Reflect.apply(clear, this, [task]);
  });
  return scheduler;
}

function sidecarWrites(t) {
  const sidecars = new WeakSet(), events = [];
  if (idleSidecar.traceSidecar) {
    const trace = idleSidecar.traceSidecar(event => {
      if (event.success && ['write', 'commit'].includes(event.category)) events.push(event.category);
    });
    t.after(() => trace.close()); return events;
  }
  // Behavioural red compatibility before the shared tracer is exported.
  const prepare = DatabaseSync.prototype.prepare, exec = DatabaseSync.prototype.exec;
  t.mock.method(DatabaseSync.prototype, 'prepare', function(sql, ...args) {
    if (sql === "SELECT 1 FROM sqlite_master WHERE name='header'" || sql === 'SELECT * FROM header WHERE singleton=1') sidecars.add(this);
    const statement = prepare.call(this, sql, ...args);
    if (sidecars.has(this) && /^\s*(INSERT|UPDATE|DELETE|REPLACE)/i.test(sql)) {
      for (const method of ['run', 'get', 'all', 'iterate']) {
        const original = statement[method];
        statement[method] = function(...values) { const result = original.apply(this, values); events.push('write'); return result; };
      }
    }
    return statement;
  });
  t.mock.method(DatabaseSync.prototype, 'exec', function(sql, ...args) {
    const result = exec.call(this, sql, ...args);
    if (sidecars.has(this) && /^\s*(COMMIT|CREATE|INSERT|UPDATE|DELETE)/i.test(sql)) events.push('transaction');
    return result;
  });
  return events;
}

for (const contextRead of [undefined, false]) test(`attachment-managed Raw upkeep retains idle captures: contextRead=${contextRead}`, { timeout: 20000 }, async t => {
  installRawSearchTestClock(t);
  const clock = upkeepClock(t), writes = sidecarWrites(t), f = sourceFixture(t);
  await savedSource(f, 'Synthetic cobalt telescope initial.');
  const host = createSharedRuntime({ path: f.path, namespace: rawNs, ...(contextRead === false ? { contextRead } : { contextCounter: counter }) },
    { strict: true, manageRawUpkeep: true, rawUpkeepScheduler: clock });
  f.workspace.defer(() => host.close());
  assert.equal(clock.pending.size, 0);
  const a = await connect(t, host), b = await connect(t, host);
  assert.equal(clock.pending.size, 1, 'one tick for multiple attachments');
  assert.equal(host.inspect().runtime.rawMaintenanceTimers, 1);
  await a.handle.close(); assert.equal(clock.pending.size, 1);
  const stale = [...clock.pending][0];
  await b.handle.close();
  assert.equal(clock.pending.size, 0, 'zero idle schedules after processed detach');
  const atDetach = writes.length;
  await clock.fire(stale);
  assert.equal(writes.length, atDetach, 'cancelled callback writes nothing');
  await savedSource(f, 'Synthetic cobalt telescope idlecapturemarker.', { sessionId: 'idle' });
  assert.equal(f.db.prepare('SELECT count(*) n FROM raw_messages').get().n, 2, 'idle capture is canonical');
  assert.equal(clock.pending.size, 0);
  const c = await connect(t, host);
  assert.equal(host.inspect().runtime.rawMaintenanceTimers, 1);
  for (let i = 0; i < 8; i++) await clock.fire();
  assert.ok(writes.length > atDetach, 'reattach publishes positive sidecar work');
  if (contextRead !== false) {
    const read = await context(c.client, { ...query, query: 'idlecapturemarker' });
    assert.ok(read.value.items.some(item => item.ref.type === 'raw'), 'idle capture is searchable');
  }
  const final = [...clock.pending][0]; await host.close(); const atClose = writes.length;
  await clock.fire(final); assert.equal(writes.length, atClose); assert.equal(clock.pending.size, 0);
  assert.throws(() => host.attach(), /local_host_closed/);
  assert.equal(host.inspect().runtime.rawMaintenanceTimers, 0);
});

test('the managed timer counter drops while detached and returns on reattach', async t => {
  const clock = upkeepClock(t), w = createTestWorkspace(t);
  const host = createSharedRuntime({ path: join(w.path, 'store.sqlite'), namespace: ns, contextCounter: counter },
    { manageRawUpkeep: true, rawUpkeepScheduler: clock });
  w.defer(() => host.close());
  const a = await connect(t, host);
  assert.equal(host.inspect().runtime.rawMaintenanceTimers, 1);
  await a.handle.close();
  assert.equal(host.inspect().runtime.rawManagers, 1);
  assert.equal(host.inspect().runtime.rawMaintenanceTimers, 0);
  const b = await connect(t, host);
  assert.equal(host.inspect().runtime.rawMaintenanceTimers, 1);
  await b.handle.close();
});

test('attachment never enables --no-raw-search and an unrelated per-session manager keeps its scheduler', { timeout: 15000 }, async t => {
  installRawSearchTestClock(t);
  const clock = upkeepClock(t), w = createTestWorkspace(t);
  const host = createSharedRuntime({ path: join(w.path, 'off.sqlite'), namespace: ns, rawSearch: false, contextCounter: counter },
    { manageRawUpkeep: true, rawUpkeepScheduler: clock });
  w.defer(() => host.close());
  const a = await connect(t, host); assert.equal(clock.pending.size, 0); await a.handle.close();
  const core = openMemoryCore({ path: join(w.path, 'single.sqlite'), raw: true }); w.defer(() => core.close());
  await core.getRawSearchStatus({ namespace: ns });
  assert.equal(clock.pending.size, 1, 'ordinary runtime remains scheduled without an attach');
});

test('failed attachment rolls back to idle and repeated close seals every callback', { timeout: 15000 }, async t => {
  installRawSearchTestClock(t);
  const clock = upkeepClock(t), w = createTestWorkspace(t);
  const host = createSharedRuntime({ path: join(w.path, 'failed-attach.sqlite'), namespace: ns, contextCounter: counter },
    { manageRawUpkeep: true, rawUpkeepScheduler: clock });
  w.defer(() => host.close());
  const broken = new PassThrough(), output = new PassThrough();
  t.after(() => { broken.destroy(); output.destroy(); });
  broken.once = () => { throw Error('synthetic_attach_setup'); };
  assert.throws(() => host.attach(broken, output), /synthetic_attach_setup/);
  assert.equal(host.inspect().connections, 0); assert.equal(clock.pending.size, 0);
  const [failed, peer] = streams(); t.after(() => { failed.destroy(); peer.destroy(); });
  clock.fail = true;
  assert.throws(() => host.attach(failed, failed), /synthetic_schedule_failed/);
  assert.equal(host.inspect().connections, 0, 'failed activation rolls back the attachment');
  assert.equal(clock.pending.size, 0); clock.fail = false;
  const a = await connect(t, host); assert.equal(clock.pending.size, 1);
  const stale = [...clock.pending][0]; await a.handle.close(); await a.handle.close(); await host.close(); await host.close();
  await clock.fire(stale); assert.equal(clock.pending.size, 0);
});

test('opening cancellation is checked after imports before native storage, and retired for warm reads', { timeout: 15000 }, async t => {
  installRawSearchTestClock(t);
  const f = sourceFixture(t); await savedSource(f, 'Synthetic copper telescope.');
  const s = await searchFixture(f); await s.service.close();
  const writes = sidecarWrites(t), stop = new AbortController();
  const opening = openRawSearch(s.options, { signal: stop.signal }); stop.abort();
  await assert.rejects(opening);
  assert.equal(writes.length, 0, 'cancelled opening never initializes sidecar');
  const active = new AbortController(), service = await openRawSearch(s.options, { signal: active.signal });
  f.workspace.defer(() => service.close()); active.abort();
  await service.search({ query: 'copper' }, s.host.token);
});

for (const boundary of ['preparation', 'provider']) test(`generation cancellation at ${boundary} preserves checkpoint and excludes late work`, { timeout: 20000 }, async t => {
  installRawSearchTestClock(t);
  const arrived = deferred(), release = deferred(), completed = deferred(), controller = new AbortController();
  t.after(() => release.resolve());
  let armed = false, dispatches = 0;
  const f = sourceFixture(t), open = f.port.openRaw;
  f.port.openRaw = async input => {
    const value = await open(input);
    if (armed && boundary === 'preparation') { arrived.resolve(); await release.promise; }
    return value;
  };
  const embedder = { id: 'synthetic-upkeep-' + boundary, revision: '1', dimensions: 2, normalization: 'l2',
    async embed(texts, controls) { dispatches++; arrived.resolve(); await release.promise; completed.resolve(); return texts.map(() => [1, 0]); } };
  await savedSource(f, 'Synthetic copper telescope.');
  const s = await searchFixture(f, { embedder, policy: { family: 'local', maxBatchDocuments: 1, maxRequests: 30, maxConcurrent: 1, maxUsd: 0 } });
  if (boundary !== 'preparation') for (let i = 0; i < 8; i++) await s.tick({ maxMs: 5000 });
  const writes = sidecarWrites(t);
  armed = true;
  const turn = s.tick({ maxMs: 5000, embeddings: boundary !== 'preparation', upkeepSignal: controller.signal });
  await arrived.promise; controller.abort(); const detached = writes.length;
  release.resolve(); await turn;
  if (boundary === 'provider') await completed.promise;
  // Join the detached refresh observer without using a wall-clock sleep.
  for (let i = 0; i < 8; i++) await nextTurn();
  assert.equal(writes.length, detached, 'no sidecar writes after processed cancellation');
  assert.equal(dispatches, boundary === 'provider' ? 1 : 0);
  const status = await s.service.status(); assert.equal(status.error, null); assert.equal(status.maintenance.noProgress, 0);
  assert.equal(status.maintenance.pending, false);
  for (let i = 0; i < 8; i++) await s.tick({ maxMs: 5000 });
  assert.equal((await s.search({ query: 'copper' })).candidates.length, 1, 'fresh generation retains or publishes canonical capture');
});

for (const boundary of ['reservation', 'after-reservation', 'busy']) test(`cancellation around embedding ${boundary} is benign and never resurrected`, { timeout: 15000 }, async t => {
  installRawSearchTestClock(t);
  const arrived = deferred(), release = deferred(), stop = new AbortController();
  t.after(() => release.resolve());
  const text = 'Synthetic copper telescope.', source = { ref: { span: { start: 0 } } };
  let row = { key: 'synthetic', source, segment: 1, chunks: rawSearchChunks(text).map(({ input, ...chunk }) => chunk), embedder: null };
  let writes = 0, dispatches = 0, admissions = 0, busy = boundary === 'busy';
  let checkpoint = { after: ['', '', -1], recent: { streak: 0 }, coverageComplete: true, sweep: 0, cycles: 1, fence: 'fence', cycleFence: 'fence' };
  const storage = {
    head: () => ({ checkpoint }), tail: () => row.segment,
    async lookup() { return [row]; },
    async snapshot({ after }) { return { rows: row.segment > after ? [row] : [], partial: false }; },
    async stage(next) { return next; },
    async commitBatch({ staged = [], checkpoint: next }) {
      if (busy) { arrived.resolve(); throw Object.assign(Error('synthetic busy'), { code: 'ERR_SQLITE_ERROR', errcode: 5 }); }
      checkpoint = next;
      if (staged.length) row = { ...staged[0], segment: row.segment + 2 };
      writes++;
      if (boundary === 'after-reservation') { stop.abort(); arrived.resolve(); }
      return { sequence: row.segment + 1, removed: 0 };
    },
  };
  const authority = { identity: { storeId: 'synthetic-' + boundary, fileIdentity: 'synthetic' },
    check() {}, fence: () => 'fence', open: async () => text, disposition: () => 'allowed',
    recent: () => ({ rows: [], cursor: checkpoint.recent }), validate() {}, inventory: () => ({ rows: [], complete: true }) };
  const embedder = { id: 'synthetic-reserve-' + boundary, revision: '1', dimensions: 2, normalization: 'l2',
    async embed(texts) { dispatches++; return texts.map(() => [1, 0]); } };
  const maintenance = createRawSearchMaintenance(storage, authority, { embedder,
    policy: { family: 'local', maxBatchDocuments: 1, maxRequests: 30, maxConcurrent: 1, maxUsd: 0 },
    maintenanceTurn: { version: 1, createTurn: () => ({
      enter() {
        admissions++;
        if (boundary === 'reservation' && admissions === 2) {
          arrived.resolve();
          return release.promise.then(() => 'admitted');
        }
        return 'admitted';
      },
      release() {},
    }) } });
  t.after(() => maintenance.close());
  await maintenance.maintain({ embeddings: true, maxMs: 5000, upkeepSignal: stop.signal }, () => {});
  if (boundary === 'busy') {
    await arrived.promise; await nextTurn();
    const atBusy = admissions;
    await rawSearchTestWait(24);
    await maintenance.maintain({ embeddings: true, maxMs: 5000, upkeepSignal: stop.signal }, () => {});
    assert.equal(admissions, atBusy, 'native BUSY postpones broker admission before detach');
    stop.abort(); busy = false;
    const before = maintenance.status();
    await rawSearchTestWait(26);
    await maintenance.maintain({ embeddings: true, maxMs: 5000, upkeepSignal: stop.signal }, () => {});
    assert.equal(maintenance.status().quantum, before.quantum, 'cancelled BUSY backoff never admits another turn');
  } else { await arrived.promise; stop.abort(); release.resolve(); }
  for (let i = 0; i < 8; i++) await nextTurn();
  assert.equal(writes, boundary === 'after-reservation' ? 1 : 0);
  assert.equal(dispatches, 0);
  const status = maintenance.status(); assert.equal(status.error, null); assert.equal(status.noProgress, 0); assert.equal(status.pending, false);
  if (boundary === 'busy') {
    const fresh = new AbortController().signal;
    for (let i = 0; i < 12 && !row.chunks.every(chunk => chunk.vector); i++) {
      await rawSearchTestWait(1010);
      await maintenance.maintain({ embeddings: true, maxMs: 5000, upkeepSignal: fresh }, () => {});
    }
    assert.equal(dispatches, 1);
    assert.ok(row.chunks.every(chunk => chunk.vector), 'fresh generation publishes after backoff');
  }
});

function publishedRawSegment(s, key) {
  const sidecar = join(s.directory, readdirSync(s.directory).find(name => name.endsWith('.sqlite')));
  const db = new DatabaseSync(sidecar, { readOnly: true });
  try {
    const row = key === undefined
      ? db.prepare('SELECT segment_key, data, length(vectors) AS vectorBytes FROM segments WHERE published=1').get()
      : db.prepare('SELECT segment_key, data, length(vectors) AS vectorBytes FROM segments WHERE published=1 AND segment_key=?').get(key);
    if (!row) return null;
    const data = JSON.parse(row.data);
    return { key: row.segment_key, vectorBytes: row.vectorBytes, retry: Array.isArray(data) ? data.at(-1) : data.retry };
  } finally { db.close(); }
}

test('three cancelled attachment generations leave the embedding retry available', { timeout: 15000 }, async t => {
  installRawSearchTestClock(t);
  const upkeep = createLocalRawSearchUpkeepControl(), f = sourceFixture(t), writes = sidecarWrites(t);
  let arrivals = 0, release, providerTime = Date.UTC(2026, 0, 1, 12);
  t.mock.method(Date, 'now', () => providerTime);
  const embedder = { id: 'synthetic-cancelled-reservations', revision: '1', dimensions: 2, normalization: 'l2',
    async embed(texts) {
      arrivals++;
      if (release) await release.promise;
      return texts.map(() => [1, 0]);
    } };
  t.after(() => release?.resolve());
  await savedSource(f, 'Synthetic copper telescope.');
  const s = await searchFixture(f, { embedder, policy: { family: 'local', maxBatchDocuments: 1, maxRequests: 5, maxConcurrent: 1, maxUsd: 0 } });
  for (let i = 0; i < 8; i++) await s.tick({ maxMs: 5000 });
  const { key, retry: { attempts: originalAttempts } } = publishedRawSegment(s);
  const attempts = () => publishedRawSegment(s, key)?.retry.attempts;
  const reconciledAttempts = [];
  const tick = () => { providerTime += 6000; return s.tick({ maxMs: 5000, embeddings: true, upkeepSignal: upkeep.signal }); };
  for (let attempt = 1; attempt <= 3; attempt++) {
    release = deferred(); upkeep.resume();
    if (attempt > 1) { await tick(); reconciledAttempts.push(attempts()); }
    for (let i = 0; i < 20 && arrivals < attempt; i++) await tick();
    assert.equal(arrivals, attempt, 'provider dispatched in this attachment generation');
    upkeep.suspend(); const atDetach = writes.length;
    release.resolve(); await nextTurn();
    assert.equal(writes.length, atDetach, 'cancelled provider result never reaches SQLite');
  }
  release = null; upkeep.resume();
  await tick(); reconciledAttempts.push(attempts());
  const { id, revision, dimensions, normalization } = embedder;
  const search = () => s.search({ query: 'copper', queryVector: {
    input: 'copper', embedder: { id, revision, dimensions, normalization }, vector: [1, 0],
  } });
  for (let i = 0; i < 20 && (await search()).semantic.state !== 'ready'; i++) await tick();
  assert.deepEqual({ reconciledAttempts, arrivals }, { reconciledAttempts: Array(3).fill(originalAttempts), arrivals: 4 },
    'three charged cancellations preserve the persisted retry count and still leave the row eligible');
  assert.equal((await search()).semantic.state, 'ready');
  assert.ok(publishedRawSegment(s, key)?.vectorBytes > 0, 'fresh generation publishes vector bytes for the original segment key');
  await savedSource(f, 'Synthetic bronze telescope.', { sessionId: 'budget-check' });
  for (let i = 0; i < 12; i++) await tick();
  assert.equal(arrivals, 4, 'spent provider calls still exhaust the maintenance budget');
});

const retryPolicy = maxRequests => ({ family: 'local', maxBatchDocuments: 1, maxRequests, maxConcurrent: 1, maxUsd: 0 });

test('interrupted Raw embedding dispatches stop after three fresh service lifetimes', { timeout: 25000 }, async t => {
  installRawSearchTestClock(t);
  const f = sourceFixture(t);
  let calls = 0, held, providerTime = Date.UTC(2026, 0, 1, 12);
  t.mock.method(Date, 'now', () => providerTime);
  t.after(() => held?.resolve());
  const embedder = { id: 'synthetic-interrupted-retry', revision: '1', dimensions: 2, normalization: 'l2',
    async embed(texts) {
      calls++;
      await held.promise;
      return texts.map(() => [1, 0]);
    } };
  await savedSource(f, 'Synthetic copper telescope.');
  const s = await searchFixture(f, { embedder, policy: retryPolicy(30) });
  await s.tick({ maxMs: 5000 });
  const { key, retry } = publishedRawSegment(s);
  assert.equal(retry.attempts, 0);
  const dispatches = [];
  for (let lifetime = 0; lifetime < 5; lifetime++) {
    // Roll the real budget window over for each new service, giving the same
    // embedder a fresh ledger as it would have after an OS-process restart.
    providerTime += 24 * 60 * 60 * 1000;
    const before = calls;
    held = deferred();
    for (let turn = 0; turn < 16 && calls === before; turn++) {
      providerTime += 6000;
      await s.tick({ maxMs: 5000, embeddings: true });
    }
    dispatches.push(calls - before);
    if (calls > before) {
      const budget = contextReadBudgetDiagnostic(embedder);
      assert.equal(budget.day, new Date(providerTime).toISOString().slice(0, 10));
      assert.equal(budget.maintenance.maxRequests, 27);
      assert.equal(budget.maintenance.requests, 1);
    }
    await s.service.close();
    held.resolve();
    await nextTurn();
    if (lifetime < 4) await s.reopen();
  }
  assert.deepEqual(dispatches, [1, 1, 1, 0, 0]);
  const interrupted = publishedRawSegment(s, key);
  assert.equal(interrupted.retry.attempts, 3);
  assert.equal(interrupted.retry.terminal, true);
  assert.equal(interrupted.vectorBytes, 0);
});

test('detach and close retain the interrupted attempt for a fresh maintenance service', { timeout: 15000 }, async t => {
  installRawSearchTestClock(t);
  const upkeep = createLocalRawSearchUpkeepControl(), f = sourceFixture(t), writes = sidecarWrites(t);
  const held = deferred();
  t.after(() => held.resolve());
  let calls = 0, providerTime = Date.now();
  t.mock.method(Date, 'now', () => providerTime);
  const embedder = { id: 'synthetic-retry-after-close', revision: '1', dimensions: 2, normalization: 'l2',
    async embed(texts) {
      calls++;
      if (calls === 1) throw Object.assign(Error('provider_error'), { code: 'provider_error' });
      if (calls === 2) await held.promise;
      return texts.map(() => [1, 0]);
    } };
  await savedSource(f, 'Synthetic copper telescope.');
  const s = await searchFixture(f, { embedder, policy: retryPolicy(30) });
  await s.tick({ maxMs: 5000 });
  const { key } = publishedRawSegment(s);
  const row = () => publishedRawSegment(s, key);
  const tick = embeddings => {
    providerTime += 6000;
    return s.tick({ maxMs: 5000, embeddings, upkeepSignal: upkeep.signal });
  };
  upkeep.resume();
  for (let turn = 0; turn < 20 && calls === 0; turn++) await tick(true);
  await nextTurn();
  for (let turn = 0; turn < 12 && row().retry.error !== 'provider_error'; turn++) await tick(false);
  const before = row().retry.attempts;
  assert.equal(before, 1);
  assert.equal(row().retry.error, 'provider_error');
  for (let turn = 0; turn < 20 && calls < 2; turn++) await tick(true);
  assert.equal(calls, 2);
  upkeep.suspend();
  const atDetach = writes.length;
  const closing = s.service.close();
  held.resolve();
  await closing;
  assert.equal(writes.length, atDetach, 'no sidecar commits from detach through close');
  await s.reopen();
  assert.equal(row().retry.attempts, before + 1, 'a fresh service keeps the interrupted attempt');
  assert.equal(row().retry.terminal, false);
  upkeep.resume();
  for (let turn = 0; turn < 20 && !row().vectorBytes; turn++) await tick(true);
  assert.equal(calls, 3);
  assert.ok(row().vectorBytes > 0, 'the original key still publishes vectors');
});

test('interrupted Raw embedding calls charge the shared ledger across service restarts', { timeout: 25000 }, async t => {
  installRawSearchTestClock(t);
  const f = sourceFixture(t);
  let calls = 0, held, providerTime = Date.UTC(2026, 0, 1, 12);
  t.mock.method(Date, 'now', () => providerTime);
  t.after(() => held?.resolve());
  const embedder = { id: 'synthetic-restart-provider-budget', revision: '1', dimensions: 2, normalization: 'l2',
    async embed(texts) {
      calls++;
      await held.promise;
      return texts.map(() => [1, 0]);
    } };
  await savedSource(f, 'Synthetic copper telescope.');
  // Six requests allow five maintenance dispatches under the 90% cap.
  const s = await searchFixture(f, { embedder, policy: retryPolicy(6) });
  await s.tick({ maxMs: 5000 });
  const { key } = publishedRawSegment(s);
  const dispatches = [];
  for (let lifetime = 0; lifetime < 4; lifetime++) {
    const upkeep = createLocalRawSearchUpkeepControl();
    const before = calls;
    upkeep.resume();
    held = deferred();
    for (let turn = 0; turn < 16 && calls === before; turn++) {
      providerTime += 6000;
      await s.tick({ maxMs: 5000, embeddings: true, upkeepSignal: upkeep.signal });
    }
    dispatches.push(calls - before);
    await s.service.close();
    // The service has already torn down with this call still unresolved.
    // Retire the fake transport so the next service can take the ledger slot.
    held.resolve();
    await nextTurn();
    if (lifetime < 3) await s.reopen();
  }
  assert.deepEqual(dispatches, [1, 1, 1, 0]);
  assert.equal(publishedRawSegment(s, key).retry.attempts, 3);
  const budget = contextReadBudgetDiagnostic(embedder);
  assert.equal(budget.maintenance.requests, 3, 'the same process retains one charge for each interrupted call');
  assert.equal(budget.maintenance.active, 0);
  assert.equal(budget.lastDenial, null);
});

test('a paused cancelled source does not block lexical upkeep for another namespace', { timeout: 15000 }, async t => {
  installRawSearchTestClock(t);
  const upkeep = createLocalRawSearchUpkeepControl(), f = sourceFixture(t), held = deferred();
  t.after(() => held.resolve());
  const copper = 'Synthetic copper telescope.', bronze = 'Synthetic bronze compass.';
  const other = { ...rawNs, scope: 'project', projectId: 'synthetic-other' };
  const calls = [];
  const embedder = { id: 'synthetic-paused-reservation', revision: '1', dimensions: 2, normalization: 'l2',
    async embed(texts) {
      calls.push(...texts);
      if (calls.length === 1) await held.promise;
      return texts.map(() => [1, 0]);
    } };
  await savedSource(f, copper);
  const s = await searchFixture(f, { readSet: [rawNs, other], embedder, policy: retryPolicy(30) });
  for (let turn = 0; turn < 8; turn++) await s.tick({ maxMs: 5000 });
  const { key, retry } = publishedRawSegment(s);
  const tick = () => s.tick({ maxMs: 5000, embeddings: true, upkeepSignal: upkeep.signal });
  upkeep.resume();
  for (let turn = 0; turn < 16 && !calls.length; turn++) await tick();
  assert.deepEqual(calls, [copper]);
  upkeep.suspend();
  held.resolve();
  await nextTurn();
  const setPause = paused => f.db.prepare(`INSERT INTO episode_controls(owner_id,scope,project_id,generation,paused,enabled)
    VALUES(?,?,?,'synthetic',?,1) ON CONFLICT(owner_id,scope,project_id) DO UPDATE SET paused=excluded.paused`)
    .run(rawNs.ownerId, rawNs.scope, rawNs.projectId ?? '', Number(paused));
  setPause(true);
  await savedSource(f, bronze, { namespace: other, sessionId: 'synthetic-other' });
  upkeep.resume();
  await tick();
  assert.equal(s.indexCount(), 2, 'the first admitted turn after reattach indexes the enabled namespace');
  assert.equal((await s.search({ query: 'bronze' })).candidates.length, 1);
  assert.deepEqual(calls, [copper]);
  const paused = publishedRawSegment(s, key);
  assert.equal(paused.vectorBytes, 0);
  assert.equal(paused.retry.attempts, retry.attempts + 1, 'a paused source retains the reserved attempt');
  setPause(false);
  await tick();
  assert.deepEqual(publishedRawSegment(s, key).retry, retry, 'the first admitted turn after resume restores the prior retry');
  assert.deepEqual(calls, [copper]);
  for (let turn = 0; turn < 24 && !publishedRawSegment(s, key).vectorBytes; turn++) await tick();
  assert.equal(calls.filter(text => text === copper).length, 2);
  assert.ok(publishedRawSegment(s, key).vectorBytes > 0, 'the paused source publishes on resume');
  assert.equal(publishedRawSegment(s, key).retry.attempts, retry.attempts);
});

test('detach and reattach before the old tick settles keeps exactly one fresh successor', { timeout: 15000 }, async t => {
  installRawSearchTestClock(t);
  const clock = upkeepClock(t), f = sourceFixture(t), arrived = deferred();
  await savedSource(f, 'Synthetic cobalt telescope.');
  const native = DatabaseSync.prototype.prepare;
  let onOpening;
  // Process both lifecycle transitions while the opening tick owns the timer
  // slot. Moving this to an awaited callback can let the tick settle first.
  t.mock.method(DatabaseSync.prototype, 'prepare', function(sql, ...args) {
    const statement = native.call(this, sql, ...args);
    if (onOpening && sql.startsWith('SELECT 1 FROM sqlite_master')) {
      const observe = onOpening; onOpening = null; observe();
    }
    return statement;
  });
  const host = createSharedRuntime({ path: f.path, namespace: rawNs, contextCounter: counter },
    { manageRawUpkeep: true, rawUpkeepScheduler: clock });
  f.workspace.defer(() => host.close());
  const a = await connect(t, host);
  const [server, peer] = streams(); t.after(() => { server.destroy(); peer.destroy(); });
  let b, detaching, pendingAtReattach;
  onOpening = () => {
    detaching = a.handle.close();
    b = host.attach(server, server);
    pendingAtReattach = clock.pending.size;
    clock.failNext = true;
    arrived.resolve();
  };
  const resumed = assert.doesNotReject(clock.fire(), 'a timer callback must observe and recover its own scheduling exception');
  await arrived.promise;
  assert.equal(host.inspect().connections, 1);
  assert.equal(pendingAtReattach, 0, 'old tick still owns the deferred arm');
  await resumed;
  await detaching;
  assert.equal(clock.failures, 1, 'the successor arm actually failed');
  assert.equal(clock.pending.size, 1); await clock.fire(); assert.equal(clock.pending.size, 1);
  await b.close(); assert.equal(host.inspect().connections, 0); assert.equal(clock.pending.size, 0);
});

for (const privacy of ['forget', 'hide']) test(`idle ${privacy} is excluded on first reattached and independent reads before resumed upkeep`, { timeout: 15000 }, async t => {
  installRawSearchTestClock(t);
  const clock = upkeepClock(t), f = sourceFixture(t, { model: { extract: () => ({ items: [{ content: 'Synthetic derived engineering fact.', kind: 'fact', confidence: .8, sourceIndices: [0] }] }) } });
  const denied = await savedSource(f, 'Synthetic cobalt telescope.');
  const writer = openMemoryCore({ path: f.path, raw: true, rawSearch: false }); f.workspace.defer(() => writer.close());
  const keptText = 'Independent cobalt telescope remains searchable.';
  const keptMessage = splitRaw(keptText, { occurredAt: new Date(Date.now() - 7 * 86400000).toISOString() })[0];
  ok(await writer.captureRaw(request(keptMessage, { client: 'codex', sessionId: 'unaffected', eventId: 'unaffected' })));
  const host = createSharedRuntime({ path: f.path, namespace: rawNs, contextCounter: counter },
    { manageRawUpkeep: true, rawUpkeepScheduler: clock });
  f.workspace.defer(() => host.close());
  const a = await connect(t, host); for (let i = 0; i < 8; i++) await clock.fire();
  const baseline = JSON.stringify((await context(a.client)).value.items.filter(item => item.ref.type === 'raw'));
  assert.ok(baseline.includes('Synthetic cobalt telescope.') && baseline.includes(keptText), 'both Raw sources are warm');
  await a.handle.close(); assert.equal(clock.pending.size, 0);
  const memory = f.db.prepare('SELECT * FROM memories WHERE deleted=0').get(); assert.ok(memory);
  if (privacy === 'forget') ok(writer.forget({ namespace: rawNs, memoryId: memory.id, expectedRevision: memory.revision }));
  else {
    ok(writer.correct({ namespace: rawNs, memoryId: memory.id, expectedRevision: memory.revision,
      content: 'Synthetic safe replacement.', kind: 'fact', receipt: { client: 'synthetic', sessionId: 'independent',
        eventId: 'idle-hide', role: 'user', excerpt: 'Synthetic safe replacement.' } }));
  }
  assert.ok(f.db.prepare(`SELECT 1 FROM local_raw_hide_windows WHERE owner_id=? AND scope=? AND project_id=''
    AND start_ms<=? AND end_ms>=?`).get(rawNs.ownerId, rawNs.scope, Date.now(), Date.now()), 'canonical hide window persisted');
  assert.ok(f.db.prepare(`SELECT 1 FROM raw_session_fences f JOIN raw_conversations c
    USING (owner_id, scope, project_id, client, session_key) WHERE c.id=?`).get(denied.conversationId), 'canonical session fence persisted');
  const independent = createLocalRawSearch(f.path, f.port); f.workspace.defer(() => independent.close());
  assert.equal(ok(await independent.methods.searchRaw({ namespace: rawNs, query: 'cobalt telescope' })).candidates.length, 1);
  const b = await connect(t, host), callbacks = clock.history.length;
  const first = await context(b.client);
  assert.ok(first.value.items.some(item => item.ref.type === 'raw' && JSON.stringify(item).includes(keptText)), 'an unaffected Raw hit is returned immediately');
  assert.equal(JSON.stringify(first.value).includes('Synthetic cobalt telescope.'), false, 'hidden or forgotten content is absent from the first response');
  assert.equal(clock.history.length, callbacks, 'first read does not advance scheduled upkeep');
  assert.equal(ok(await independent.methods.searchRaw({ namespace: rawNs, query: 'cobalt telescope' })).candidates.length, 1);
});

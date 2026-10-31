import test from 'node:test';
import assert from 'node:assert/strict';
import * as internal from '../context-read-supervisor.mjs';
import * as pools from '../context-product-reader-pool.mjs';
import * as api from '../index.mjs';

const flush = async () => { for (let i = 0; i < 16; i++) await Promise.resolve(); };
// On the old interface exercise its per-supervisor factory. Baseline failures
// then identify ownership errors rather than failing to import a new symbol.
function service(t, factory) {
  const current = typeof pools.createReaderPoolRuntime === 'function', supervisors = [];
  let manager;
  const registry = internal.createSupervisorRegistry({ createPool() {
    const next = factory(); manager ??= next; return next;
  } });
  const pool = current ? pools.createReaderPoolRuntime(factory)() : Object.freeze({ close: () => manager.close() });
  t.after(async () => { await Promise.all(supervisors.map(s => s.close())); await pool.close(); });
  return { pool, registry, supervisor() {
    const s = registry.supervisor({ readerWorkerPool: current ? pool : true }); supervisors.push(s); return s;
  } };
}
const idle = () => ({ close: () => Promise.resolve(), take() {}, diagnostic: () => ({ hits: 0, misses: 0, startupFailures: 0 }) });

test('service pool factory is public, option-free and exposes only idempotent close', async () => {
  assert.equal(typeof api.createContextReaderPool, 'function', 'service_pool_exported_from_public_engine');
  assert.equal(api.createContextReaderPool, internal.createContextReaderPool);
  assert.equal(api.createContextReaderPool.length, 0);
  assert.throws(() => api.createContextReaderPool({}), { code: 'invalid_input' });
  const pool = api.createContextReaderPool();
  assert.ok(Object.isFrozen(pool)); assert.deepEqual(Reflect.ownKeys(pool), ['close']);
  assert.equal(Object.hasOwn(api, 'readerPoolDiagnostic'), false);
  assert.equal(Object.values(api).includes(internal.readerPoolDiagnostic), false);
  const closing = pool.close(); assert.equal(pool.close(), closing); await closing;
});

test('only local branded service handles are accepted, never booleans or duck typing', async t => {
  for (const value of [true, false, { close() {} }, null, 1]) {
    let unexpected;
    try {
      assert.throws(() => { unexpected = api.createContextReadSupervisor({ readerWorkerPool: value }); },
        { code: 'invalid_input' }, 'boolean_or_unbranded_pool_is_rejected');
    } finally { await unexpected?.close(); }
  }
  const pool = api.createContextReaderPool(); t.after(() => pool.close());
  const proxy = new Proxy(pool, { get() { assert.fail('proxy reflected'); }, ownKeys() { assert.fail('proxy reflected'); } });
  assert.throws(() => api.createContextReadSupervisor({ readerWorkerPool: proxy }), { code: 'invalid_input' });
  const foreign = await import('../context-product-reader-pool.mjs?foreign-service');
  const other = foreign.createContextReaderPool(); t.after(() => other.close());
  assert.throws(() => api.createContextReadSupervisor({ readerWorkerPool: other }), { code: 'invalid_input' });
  assert.throws(() => api.createContextReadSupervisor({ get readerWorkerPool() { assert.fail('getter executed'); } }), { code: 'invalid_input' });
  const supervisor = api.createContextReadSupervisor({ readerWorkerPool: pool }); await supervisor.close();
  assert.deepEqual(Object.keys(supervisor), ['getCleanupStatus', 'drain', 'ackCleanup', 'close']);
});

test('two supervisors borrow the same service ledger', async t => {
  const s = service(t, idle), first = s.supervisor(), second = s.supervisor();
  assert.equal(internal.supervisorOwner(first).owner.readerPool, internal.supervisorOwner(second).owner.readerPool,
    'supervisors_borrow_one_pool_ledger');
});

test('closing a request supervisor does not close the service pool', async t => {
  let calls = 0; const s = service(t, () => ({ ...idle(), close() { calls++; return Promise.resolve(); } }));
  const supervisor = s.supervisor(); await supervisor.close();
  assert.equal(calls, 0, 'request_close_preserves_service_pool');
});

test('request close awaits its records without waiting for idle pool reaping', async t => {
  let release; const gate = new Promise(resolve => { release = resolve; });
  const s = service(t, () => ({ ...idle(), close: () => gate })), supervisor = s.supervisor();
  const { owner } = internal.supervisorOwner(supervisor);
  const record = s.registry.register(owner, { path: 'synthetic-service-pool', domain: 'synthetic-service-pool' });
  let stop = 0; record.stop = () => { stop++; s.registry.finish(record); };
  let finished = false; const closing = supervisor.close().then(() => { finished = true; });
  try {
    await flush(); assert.equal(stop, 1);
    assert.equal(finished, true, 'request_close_does_not_wait_for_idle_pool_reaping');
  } finally { release(); await closing; }
});

test('a closed service pool remains shared without constructing a replacement', async t => {
  let created = 0; const s = service(t, () => { created++; return idle(); });
  s.supervisor(); await s.pool.close(); s.supervisor();
  assert.equal(created, 1, 'closed_pool_does_not_construct_a_replacement');
});

test('private aggregate diagnostics follow the pool rather than the supervisor', async t => {
  const s = service(t, idle), supervisor = s.supervisor();
  assert.deepEqual(internal.readerPoolDiagnostic(s.pool), { hits: 0, misses: 0, startupFailures: 0 },
    'diagnostics_follow_service_pool');
  assert.equal(internal.readerPoolDiagnostic(supervisor), undefined);
});

test('fifty request supervisors construct only one service pool', async t => {
  let created = 0; const s = service(t, () => { created++; return idle(); });
  for (let i = 0; i < 50; i++) s.supervisor();
  assert.equal(created, 1, 'fifty_supervisors_construct_one_pool');
});

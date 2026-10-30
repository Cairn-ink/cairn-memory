import test from 'node:test';
import assert from 'node:assert/strict';
import * as internal from '../context-read-supervisor.mjs';
import * as api from '../index.mjs';

test('pool opt-in creates a service-owned idle ledger; default stays absent', async t => {
  const off = api.createContextReadSupervisor(), enabled = api.createContextReadSupervisor({ readerWorkerPool: true });
  t.after(() => off.close()); t.after(() => enabled.close());
  assert.equal(internal.supervisorOwner(off).owner.readerPool, undefined);
  assert.equal(typeof internal.supervisorOwner(enabled).owner.readerPool?.take, 'function', 'pool_opt_in_creates_idle_ledger');
});

test('pool opt-in rejects request-shaped configuration and accessors', () => {
  assert.throws(() => api.createContextReadSupervisor({ readerWorkerPool: { host: 'request-selected' } }),
    { code: 'invalid_input' }, 'pool_configuration_is_service_owned_boolean');
  assert.throws(() => api.createContextReadSupervisor({ get readerWorkerPool() { assert.fail('getter executed'); } }), { code: 'invalid_input' });
});

test('pool counters are private aggregates, absent from the public API and DTO', async t => {
  const supervisor = api.createContextReadSupervisor({ readerWorkerPool: true }); t.after(() => supervisor.close());
  assert.equal(typeof internal.readerPoolDiagnostic, 'function', 'pool_private_aggregate_accessor_exists');
  assert.deepEqual(internal.readerPoolDiagnostic(supervisor), { hits: 0, misses: 0, startupFailures: 0 });
  assert.equal(Object.hasOwn(api, 'readerPoolDiagnostic'), false);
  assert.equal(Object.values(api).includes(internal.readerPoolDiagnostic), false);
  assert.deepEqual(Object.keys(supervisor), ['getCleanupStatus', 'drain', 'ackCleanup', 'close']);
});

test('supervisor close owns and awaits the idle ledger', async () => {
  const events = []; let release;
  const gate = new Promise(resolve => { release = resolve; });
  const registry = internal.createSupervisorRegistry({ createPool: () => ({ close() { events.push('close'); return gate; } }) });
  const supervisor = registry.supervisor({ readerWorkerPool: true });
  let finished = false; const closing = supervisor.close().then(() => { finished = true; });
  await Promise.resolve();
  assert.deepEqual(events, ['close'], 'supervisor_close_stops_idle_ledger');
  assert.equal(finished, false); release(); await closing; assert.equal(finished, true);
});

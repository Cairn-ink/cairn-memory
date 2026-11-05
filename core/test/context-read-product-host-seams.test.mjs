import { testClock } from '../testing/context-product-test-clock.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { Worker } from 'node:worker_threads';
import * as admission from '../context-product-admission.mjs';
import { maintenanceFailureKinds, maintenanceKinds } from '../context-product-attribution.mjs';
import { createMaintenancePumpRuntime, maintenancePumpDiagnostic, maintenancePumpPhaseDiagnostic } from '../context-product-pump.mjs';
import { createProductReaderRuntime, maintenanceObservation } from '../context-product-reader.mjs';
import { fixture, ok } from '../testing/context-read-fixture.mjs';
import { configured, personal } from '../testing/context-product-owner-fixture.mjs';

function setup(t, { seams = [], defaultOpen = false, wrap = true } = {}) {
  const f = fixture(t);
  f.admit('Synthetic host seam refresh.', personal);
  const service = configured(t, f.path, [personal], { service: true });
  const timers = new Map(), nativeHandles = new WeakMap(), calls = [], inputs = [], results = [], observations = [], workers = [];
  let serial = 0, opens = 0, closeReads = 0, publicRefreshes = 0, native, wrapped;
  const openNative = createProductReaderRuntime({ maintenance: true, spawnWorker(data) {
    const worker = new Worker(new URL('../context-product-worker.mjs', import.meta.url), {
      workerData: data, env: {}, execArgv: [],
    });
    const post = worker.postMessage.bind(worker);
    worker.postMessage = (message, ...args) => { calls.push(message); return post(message, ...args); };
    workers.push(worker);
    return worker;
  } });
  const deps = {
    now: testClock.now,
    setTimer(fn, ms) { const id = ++serial; timers.set(id, { fn, at: testClock.now() + ms }); return id; },
    clearTimer: id => timers.delete(id),
    observedAt(result) { observations.push(result); return maintenanceObservation(result); },
  };
  if (!defaultOpen) deps.open = async (...args) => {
    opens++;
    native = await openNative(...args);
    if (!wrap) return native;
    wrapped = Object.defineProperties({}, {
      ...Object.getOwnPropertyDescriptors(native),
      close: { enumerable: true, get() { closeReads++; return native.close; } },
      refreshContextIndex: { enumerable: true, value(...call) { publicRefreshes++; return native.refreshContextIndex(...call); } },
    });
    nativeHandles.set(wrapped, native);
    return wrapped;
  };
  if (seams.includes('admit')) deps.admit = (h, ...args) => admission.admitMaintenance(nativeHandles.get(h) ?? h, ...args);
  if (seams.includes('work')) deps.work = async (h, input, ...args) => {
    inputs.push(input);
    const result = await admission.refreshMaintenance(nativeHandles.get(h) ?? h, input, ...args);
    results.push(result);
    return result;
  };
  const config = { supervisor: service.supervisor, id: randomUUID(), serviceCredential: service.token,
    window: { id: randomUUID(), endsAtMonoMs: Math.floor(testClock.now()) + 60000, usedItems: 0, usedMs: 0 },
    budgets: { maxItems: 2048, maxMs: 60000 }, quantum: { maxItems: 32, maxMs: 1000 }, pollMs: 25, renewalMs: 20000,
    projections: [{ options: service.options, types: ['memory'] }] };
  const pump = createMaintenancePumpRuntime(deps)(config);
  t.after(() => pump.close());
  return { pump, service, timers, calls, inputs, results, observations, workers,
    get opens() { return opens; }, get closeReads() { return closeReads; }, get publicRefreshes() { return publicRefreshes; },
    get native() { return native; }, get wrapped() { return wrapped; },
    async turn() {
      const [id, timer] = [...timers].sort((a, b) => a[1].at - b[1].at)[0] ?? [];
      assert.ok(timer, 'scheduled lexical turn');
      timers.delete(id);
      await testClock.advance(Math.max(0, timer.at - testClock.now()));
      await timer.fn();
    } };
}

async function assertIdentityFailure(s) {
  await s.turn();
  const status = s.pump.getStatus(), diagnostic = maintenancePumpDiagnostic(status);
  assert.equal(status.error, 'invalid_input', JSON.stringify({ status, lastFailure: diagnostic.lastFailure }));
  assert.equal(status.state, 'failed');
  assert.equal((await s.pump.completion).error, 'invalid_input');
  assert.equal(diagnostic.lastFailure.cause, 'maintainer_identity_unrecognized');
  assert.equal(diagnostic.failureCounts.maintainer_identity_unrecognized, 1);
  assert.equal(diagnostic.secondaryFailure, null);
  assert.equal(diagnostic.observation, null);
  assert.ok(diagnostic.admission.every(value => value === null), 'no retry, hold or backoff');
  assert.equal(status.usedItems, 32, 'only the existing opening reservation is charged');
  assert.equal(status.usedMs, 1000, 'failed opening retains its existing reservation');
  const lane = maintenancePumpPhaseDiagnostic(status).projections[0];
  assert.equal(lane.opens, 1);
  assert.equal(lane.phases.admission.count, 0);
  assert.equal(lane.phases.refreshCall.count, 0);
  assert.equal(lane.lastFailure.cause, 'maintainer_identity_unrecognized');
  assert.equal(s.opens, 1);
  assert.equal(s.calls.filter(call => ['admitMaintenance', 'refreshMaintenance'].includes(call.method)).length, 0);
  assert.equal(s.calls.filter(call => call.method === 'close').length, 1);
  assert.equal(s.closeReads, 1, 'disposal resolves the lazy original close function once');
  assert.equal(s.publicRefreshes, 0);
  assert.equal(s.inputs.length, 0);
  assert.equal(s.observations.length, 0);
  assert.equal(s.workers[0].threadId, -1, 'native Worker disposal is confirmed');
  assert.equal(s.timers.size, 0);
  await testClock.advance(60000);
  assert.equal(s.timers.size, 0);
  assert.equal(s.opens, 1, 'terminal pump never reopens');
  await s.pump.close();
  assert.equal(s.closeReads, 1, 'repeated close does not redispose');
  assert.ok((await s.service.supervisor.drain()).every(record => record.state === 'complete'), 'existing disposal proof releases every resource');
}

test('descriptor wrapper with default dispatch fails terminally on its first open', async t => {
  await assertIdentityFailure(setup(t));
});

test('both host dispatch seams unwrap and observe real Worker refreshes', async t => {
  const s = setup(t, { seams: ['admit', 'work'] });
  await s.turn();
  assert.equal(admission.isNativeMaintenanceMaintainer(s.native), true);
  assert.equal(admission.isNativeMaintenanceMaintainer(s.wrapped), false);
  assert.equal(maintenancePumpDiagnostic(s.pump.getStatus()).observation, null);
  await s.turn(); await s.turn();
  assert.equal(s.pump.getStatus().error, null);
  assert.equal(s.opens, 1, 'both intents reuse the native resident');
  assert.deepEqual(s.inputs.map(input => input.intent), ['current', 'history']);
  for (const input of s.inputs) assert.deepEqual(input.readSet, [personal]);
  assert.equal(s.results.length, 2);
  s.results.forEach((result, index) => {
    assert.equal(ok(result).channels.lexical.state, 'ready');
    assert.equal(s.observations[index], result);
  });
  assert.equal(s.publicRefreshes, 0, 'lexical pump observes work rather than the public refresh method');
  assert.equal(s.calls.filter(call => call.method === 'admitMaintenance').length, 1);
  assert.equal(s.calls.filter(call => call.method === 'refreshMaintenance').length, 2);
});

test('default open and dispatch retain native admission and observation', async t => {
  const s = setup(t, { defaultOpen: true });
  await s.turn();
  assert.equal(maintenancePumpDiagnostic(s.pump.getStatus()).observation, null);
  await s.turn(); await s.turn();
  assert.equal(s.pump.getStatus().error, null);
  assert.equal(s.observations.length, 2);
  s.observations.forEach(ok);
  assert.equal(maintenancePumpPhaseDiagnostic(s.pump.getStatus()).projections[0].opens, 1);
});

for (const seam of ['admit', 'work']) {
  test(`wrapper with only ${seam} injected still requires native identity for the other default`, async t => {
    await assertIdentityFailure(setup(t, { seams: [seam] }));
  });
  test(`native handle with only ${seam} injected keeps working`, async t => {
    const s = setup(t, { seams: [seam], wrap: false });
    await s.turn(); await s.turn();
    assert.equal(s.pump.getStatus().error, null);
    assert.equal(s.observations.length, 1);
    ok(s.observations[0]);
  });
}

test('identity failure appends to the private vocabulary without changing stall kinds', () => {
  assert.deepEqual(maintenanceFailureKinds, ['none', 'worker_heap_limit', 'worker_exit', 'worker_error', 'protocol', 'unmapped', 'exception',
    'observation_timing', 'engine', 'spawn', 'dispatch', 'call_error', 'identity', 'worker_state', 'cleanup', 'disposal_proof',
    'open_exceeds_quantum', 'maintainer_identity_unrecognized']);
  assert.deepEqual(maintenanceKinds, ['idle', 'scan', 'item', 'verify', 'publication', 'gc', 'vacuum', 'begin', 'commit', 'save',
    'canonical-read', 'serialize', 'admission']);
});

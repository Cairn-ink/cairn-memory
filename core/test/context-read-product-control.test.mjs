import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { Worker } from 'node:worker_threads';
import { createReaderWorkerLifecycle } from '../reader-worker-lifecycle.mjs';
import { EventEmitter, getEventListeners } from 'node:events';
import { requestRecord, operationRecord, verifyRecords, credentialDigest, PRODUCT_PROFILE, boundedData, hostConfiguration, operationMessage } from '../context-product-control.mjs';
import { requestAuthority } from '../context-product-authority.mjs';
import { createProductReaderRuntime } from '../context-product-reader.mjs';
import { createSupervisorRegistry, supervisorOwner } from '../context-read-supervisor.mjs';
import { nativeTelemetry, nativeOutcome, sealNative, drainNative, NATIVE_CAPACITY } from '../context-product-telemetry.mjs';

const ns = { ownerId: 'synthetic-product', scope: 'personal', projectId: null };
const coverage = { policy: 'recent-projects-v1', selectionRevision: 'fixture', requestedNamespaces: 1, selectedNamespaces: 1, omittedNamespaces: 0 };
const deferred = () => { let resolve; const promise = new Promise(r => { resolve = r; }); return { promise, resolve }; };
const flush = async () => { for (let i = 0; i < 8; i++) await Promise.resolve(); };
function setup(expiry = null, credential = { nonce: randomUUID() }) {
  const control = { requestId: randomUUID(), handleId: randomUUID(), credentialBindingId: randomUUID(), credentialExpiresUtcMs: expiry, requestMaxMs: 5000 };
  const binding = { kind: 'request', ...control, ownerId: ns.ownerId, namespaces: { readSet: [ns], ownerCoverage: coverage }, issuedAt: 7,
    credentialDigest: credentialDigest(credential) };
  delete binding.requestMaxMs;
  return { credential, control, binding, requestReservation: new SharedArrayBuffer(4) };
}
function harness({ expiry = null, openAt = 0, stall = false, terminationFails = false, credential } = {}) {
  let time = 0n, wall = 1000, order = [], readings = [], timerFailure = false;
  const timers = new Set(), actors = [], registry = createSupervisorRegistry({ now: () => Number(time) / 1e6 });
  const state = setup(expiry, credential), supervisor = registry.supervisor();
  const options = { supervisor, path: new URL('synthetic.sqlite', import.meta.url).pathname, version: 'context-read-v1', profile: PRODUCT_PROFILE,
    readSet: [ns], ownerCoverage: coverage, requestControl: state.control,
    host: { moduleUrl: new URL('../testing/context-product-host.mjs', import.meta.url).href, configuration: { requestBinding: state.binding, requestReservation: state.requestReservation } }, diagnostics: true };
  const open = createProductReaderRuntime({
    now() { order.push('mono'); return readings.length ? readings.shift() : time; }, utc() { order.push('utc'); return wall; },
    setTimer(fn, ms) { if (timerFailure) throw Error('synthetic timer registration'); order.push('timer'); const timer = { fn, ms, unref() {} }; timers.add(timer); return timer; },
    clearTimer(timer) { timers.delete(timer); },
    spawnWorker(data) {
      order.push('spawn');
      const worker = new EventEmitter(), gate = deferred(), messages = [];
      Object.assign(worker, { data, messages, gate, ref() {}, unref() {},
        postMessage(message) {
          messages.push(message);
          if (message.method === 'close') { sealNative(data.frame); worker.emit('exit', 0); }
        },
        terminate() { return gate.promise.then(() => { if (terminationFails) throw Error('synthetic'); return 1; }); },
        reply(result, operation = messages.at(-1)?.operation ?? data.operation) { worker.emit('message', { operation, result, fileIdentity: '1:2' }); },
      });
      actors.push(worker);
      if (!stall) queueMicrotask(() => { time = BigInt(openAt) * 1000000n; worker.reply({ ok: true, value: null }); });
      return worker;
    },
  });
  return { ...state, options, open, supervisor, registry, actors, order, timers,
    set(ms) { time = BigInt(ms) * 1000000n; },
    readings(values) { readings = values.map(v => BigInt(v) * 1000000n); }, wall(ms) { wall = ms; },
    failTimers() { timerFailure = true; },
    expireIdle() { for (const timer of [...timers]) if (timer.ms === 60000) timer.fn(); },
    tick() { for (const timer of [...timers]) if (timer.ms < 60000) timer.fn(); },
  };
}
const input = { readSet: [ns], intent: 'current', refs: [{ namespace: ns, type: 'memory', memoryId: randomUUID(), revision: 1 }], deadlineMs: 5000 };
const denied = (value, code) => assert.deepEqual(value, { ok: false, error: { code, retryable: false } });

test('P2-28 admission formulas, closed records, overflow, null expiry and immutable clock domain', () => {
  const { control } = setup(5950), request = requestRecord(control, 0n, 1000, 'domain');
  assert.equal(request.credentialCutoffMonoNs, '4950000000');
  const op = operationRecord(request, 4900000000n, 5000, 1, 'operation');
  assert.equal(op.operationCutoffMonoNs, '4950000000');
  assert.ok(Object.isFrozen(request)); assert.ok(Object.isFrozen(op));
  verifyRecords(request, op, request, op);
  for (const patch of [{ clockDomainId: 'other' }, { handleId: 'other' }, { credentialBindingId: 'other' }])
    assert.throws(() => verifyRecords(request, { ...op, ...patch }, request), { code: 'authority_required' });
  assert.throws(() => verifyRecords(request, { ...op, operationCutoffMonoNs: '5000000000' }, request), { code: 'invalid_input' });
  assert.throws(() => requestRecord({ ...control, admittedMonoNs: '0' }, 0n, 1000), { code: 'invalid_input' });
  assert.throws(() => requestRecord(control, (1n << 64n) - 1n, 1000), { code: 'invalid_input' });
  assert.throws(() => requestRecord({ ...control, credentialExpiresUtcMs: 1000 }, 0n, 1000), { code: 'authority_required' });
  const noExpiry = requestRecord({ ...control, credentialExpiresUtcMs: null }, 0n, 1000);
  assert.equal(noExpiry.credentialCutoffMonoNs, null);
  assert.equal(operationRecord(noExpiry, 4900000000n, 5000, 1).operationCutoffMonoNs, '5000000000');
  // A delayed UTC sample conservatively shortens expiry; issuedAt is irrelevant.
  assert.equal(requestRecord(control, 0n, 1100).credentialCutoffMonoNs, '4850000000');
});

for (const expiry of [null, 5950]) test(`P2-29 opening consumes 4900ms, no renewed window (expiry ${expiry})`, async () => {
  const h = harness({ expiry, openAt: 4900 }), reader = await h.open(h.options);
  assert.deepEqual(h.order.slice(0, 2), ['mono', 'utc']);
  assert.ok(h.order.indexOf('timer') < h.order.indexOf('spawn'));
  const call = reader.fetchCandidateEvidence(input, h.credential);
  const actor = h.actors[0], op = actor.messages.at(-1).operation;
  assert.equal(op.operationCutoffMonoNs, expiry ? '4950000000' : '5000000000');
  h.wall(999999999); h.set(expiry ? 4950 : 5000);
  // Timer deliberately does not run: receipt itself must enforce the cutoff.
  actor.reply({ ok: true, value: { items: ['private'], snapshot: 'private' } });
  denied(await call, 'read_timeout');
  denied(await reader.fetchCandidateEvidence(input, h.credential), 'store_closed');
  actor.gate.resolve(); await reader.close(); await h.supervisor.close();
});

for (const result of [
  { ok: true, value: { items: ['partial'], nextCursor: 'page' } },
  { ok: true, value: { diagnostics: { candidates: ['private'] }, metered: {} } },
  { ok: false, error: { code: 'index_unavailable', retryable: false, details: { coverage: { count: 12 }, trace: {} } }, _meta: { private: true } },
]) test('P2-29 late data includes partial pages, assembly and diagnostic error envelopes', async () => {
  const h = harness(), reader = await h.open(h.options), actor = h.actors[0];
  const pending = reader.fetchCandidateEvidence(input, h.credential);
  const operation = actor.messages.at(-1).operation;
  actor.reply(result, { ...operation, operationId: 'old' });
  actor.reply(result, { ...operation, workerEpoch: 2 });
  h.set(5000); actor.reply(result);
  denied(await pending, 'read_timeout'); actor.gate.resolve(); await reader.close();
});

test('P2-28 earlier expiry times out stalled bootstrap before cleanup, quarantines across supervisors', async () => {
  const h = harness({ expiry: 1100, stall: true });
  const opening = h.open(h.options); let failure;
  h.set(100); h.tick();
  await opening.catch(error => { failure = error; });
  assert.equal(failure.code, 'read_timeout');
  assert.equal(h.supervisor.getCleanupStatus(failure.cleanupId).state, 'pending');
  const other = setup(null);
  const options = { ...h.options, supervisor: h.registry.supervisor(), requestControl: other.control,
    host: { ...h.options.host, configuration: { requestBinding: other.binding, requestReservation: other.requestReservation } } };
  await assert.rejects(h.open(options), { code: 'read_in_progress' });
  const draining = h.supervisor.drain(failure.cleanupId);
  assert.strictEqual(draining, h.supervisor.drain(failure.cleanupId));
  h.actors[0].gate.resolve(); const status = await draining;
  assert.equal(status.state, 'complete'); assert.equal(status.telemetry, 'incomplete');
  h.supervisor.ackCleanup(failure.cleanupId);
  assert.throws(() => h.supervisor.getCleanupStatus(failure.cleanupId), { code: 'invalid_input' });
});

test('P2-03 overlap, abort, preabort, close and first terminal event settle independently of termination', async () => {
  const h = harness(), reader = await h.open(h.options), actor = h.actors[0], controller = new AbortController();
  const pending = reader.fetchCandidateEvidence(input, h.credential, { signal: controller.signal });
  denied(await reader.fetchCandidateEvidence(input, h.credential), 'read_in_progress');
  controller.abort(); h.tick();
  denied(await pending, 'read_cancelled');
  let closed = false; const closing = reader.close().then(() => { closed = true; }); await flush(); assert.equal(closed, false);
  actor.reply({ ok: true, value: { items: ['abandoned'] } });
  actor.gate.resolve(); await closing;
  const before = harness(), pre = new AbortController(); pre.abort();
  await assert.rejects(before.open(before.options, { signal: pre.signal }), { code: 'read_cancelled' });
  assert.equal(before.actors.length, 0);
});

test('P2-16 bootstrap failure and failed cleanup retain supervision and failure quarantine', async () => {
  const h = harness({ stall: true, terminationFails: true }), opening = h.open(h.options);
  h.actors[0].reply({ ok: false, error: { code: 'unsupported_database', retryable: false } });
  let failure; await opening.catch(e => { failure = e; });
  assert.equal(failure.code, 'unsupported_database');
  h.actors[0].gate.resolve(); await flush();
  assert.equal(h.supervisor.getCleanupStatus(failure.cleanupId).state, 'failed');
  await assert.rejects(h.supervisor.drain(failure.cleanupId), { code: 'reader_failed' });
  assert.throws(() => h.supervisor.ackCleanup(failure.cleanupId), { code: 'reader_failed' });
  const other = setup(); await assert.rejects(h.open({ ...h.options, supervisor: h.registry.supervisor(), requestControl: other.control,
    host: { ...h.options.host, configuration: { requestBinding: other.binding, requestReservation: other.requestReservation } } }), { code: 'reader_failed' });
});

for (const final of [false, true]) test(`P2-14/25/26 authority denial at ${final ? 'final' : 'entry'} sample`, () => {
  const s = setup(), control = requestRecord(s.control, 0n, 1000);
  let current = false, samples = 0;
  const enter = requestAuthority({ authorize: () => s.binding, isCurrent() { samples++; return current; } }, s.binding, control);
  if (!final) assert.throws(() => enter('fetchCandidateEvidence', input, s.credential), { code: 'authority_required' });
  else { current = true; const access = enter('fetchCandidateEvidence', input, s.credential); current = false; assert.throws(() => access.check(), { code: 'scope_changed' }); }
  assert.equal(samples, final ? 2 : 1);
});

for (const method of ['findCandidates', 'contextRead', 'getContextIndexStatus']) test(`P2-27 ${method}: data-bearing errors require final-envelope sample, without a third sample`, () => {
  const s = setup(), control = requestRecord(s.control, 0n, 1000);
  let current = true, samples = 0;
  const enter = requestAuthority({ authorize: () => s.binding, isCurrent() { samples++; return current; } }, s.binding, control);
  const access = enter(method, input, s.credential);
  const observations = { counts: 12, trace: {}, coverage: {}, candidates: {} };
  current = false;
  assert.throws(() => access.envelope(() => ({ ok: false, details: observations, _meta: observations })), { code: 'scope_changed' });
  assert.equal(samples, 2);
  current = true; samples = 0;
  const allowed = enter(method, input, s.credential); allowed.check(); current = false;
  assert.deepEqual(allowed.envelope(() => observations), observations); assert.equal(samples, 2);
});

for (const response of [null, Promise.resolve(true), 'unknown', new Error('throw')]) test('P2-26 unverifiable synchronous currentness fails closed', () => {
  const s = setup(), control = requestRecord(s.control, 0n, 1000);
  const enter = requestAuthority({ authorize: () => s.binding, isCurrent() { if (response instanceof Error) throw response; return response; } }, s.binding, control);
  assert.throws(() => enter('fetchCandidateEvidence', input, s.credential), { code: 'authority_required' });
});

test('P2-17 independent committed BUSY survives discarded retrieval, missing outcomes and overflow are incomplete', async () => {
  const h = harness(), reader = await h.open(h.options), actor = h.actors[0];
  const pending = reader.fetchCandidateEvidence(input, h.credential), frame = actor.messages.at(-1).frame;
  assert.throws(() => nativeOutcome(frame, 'execute', 'context_evidence', () => { throw Object.assign(Error('private'), { code: 'ERR_SQLITE_ERROR', errcode: 261 }); }));
  sealNative(frame); h.set(5000); h.tick(); denied(await pending, 'read_timeout');
  const closing = reader.close(); actor.gate.resolve(); await closing;
  const deliveries = await h.supervisor.drain();
  const observed = deliveries.find(r => r.diagnostics.busy === 1);
  assert.equal(observed.diagnostics.records[0].sqlite.code, 5); assert.equal(observed.telemetry, 'complete');
  assert.equal(JSON.stringify(observed).includes('private'), false);
  const unfinished = nativeTelemetry('unfinished', 1); new Int32Array(unfinished.buffer)[0] = 1;
  assert.equal(drainNative(unfinished, true).coverage, 'incomplete');
  const overflow = nativeTelemetry('overflow', 1);
  for (let i = 0; i <= NATIVE_CAPACITY; i++) try { nativeOutcome(overflow, 'close', 'connection', () => { throw Error(); }); } catch {}
  sealNative(overflow); assert.equal(drainNative(overflow, true).coverage, 'incomplete');
  const gap = nativeTelemetry('gap', 1); try { nativeOutcome(gap, 'open', 'connection', () => { throw Error(); }); } catch {}
  sealNative(gap); Atomics.store(new Int32Array(gap.buffer), 10, 0);
  assert.equal(drainNative(gap, true).coverage, 'incomplete');
});

test('P2-24 10000 operations across supervisors: bounded oldest-first history, shared drains and nonrenewing expiry', async () => {
  let time = 0;
  const registry = createSupervisorRegistry({ now: () => time }), ids = [];
  for (let i = 0; i < 10000; i++) {
    const supervisor = registry.supervisor(), owner = supervisorOwner(supervisor).owner;
    const snapshot = setup(), request = requestRecord(snapshot.control, BigInt(time) * 1000000n, 1000);
    const record = registry.register(owner, { path: 'synthetic.sqlite', domain: 'host', request });
    registry.finish(record); time += 20; ids.push([supervisor, record.id]);
    await supervisor.close();
  }
  const counts = registry.counters(); assert.equal(counts.completed, 1024); assert.equal(counts.live, 0);
  assert.ok(counts.metadataBytes <= 1048576); assert.ok(counts.diagnosticBytes <= 16777216);
  assert.throws(() => ids[0][0].getCleanupStatus(ids[0][1]), { code: 'invalid_input' });
  const [last, id] = ids.at(-1), expires = last.getCleanupStatus(id).expiresAt;
  time = expires - 1; await last.drain(id); assert.equal(last.getCleanupStatus(id).expiresAt, expires);
  time = expires; assert.throws(() => last.getCleanupStatus(id), { code: 'invalid_input' });
  assert.deepEqual(registry.counters(), { live: 0, completed: 0, metadataBytes: 0, diagnosticBytes: 0, reservations: 0, records: 0 });
});

test('P2-29 second calls, replay and UTC changes reuse one admission and cutoff', async () => {
  const h = harness({ openAt: 4900 }), reader = await h.open(h.options), actor = h.actors[0];
  const first = reader.fetchCandidateEvidence(input, h.credential), firstOp = actor.messages.at(-1).operation;
  sealNative(actor.messages.at(-1).frame); actor.reply({ ok: true, value: { items: [], snapshot: 'fixture' } }); await first;
  h.wall(0); h.set(4990);
  const second = reader.fetchCandidateEvidence(input, h.credential), secondOp = actor.messages.at(-1).operation;
  assert.notEqual(firstOp.operationId, secondOp.operationId);
  assert.equal(firstOp.operationCutoffMonoNs, secondOp.operationCutoffMonoNs);
  assert.equal(actor.messages[0].request.admittedMonoNs, actor.messages[1].request.admittedMonoNs);
  actor.reply({ ok: true, value: { old: true } }, firstOp);
  h.set(5000); actor.reply({ ok: true, value: { late: true } }); denied(await second, 'read_timeout');
  actor.gate.resolve(); await reader.close();
});

test('P2-24 safety pins survive byte/count eviction and time; quota, alias quarantine and recovery are explicit', async () => {
  let time = 0;
  const limits = { live: 3, completed: 2, metadataBytes: 800, diagnosticBytes: 300, historyMs: 300000 };
  const registry = createSupervisorRegistry({ now: () => time, limits }), supervisor = registry.supervisor(), owner = supervisorOwner(supervisor).owner;
  const pending = registry.register(owner, { path: 'pending.sqlite', domain: 'host' }); registry.bind(pending, '1:9'); registry.cleanup(pending);
  const failed = registry.register(owner, { path: 'failed.sqlite', domain: 'host' }); registry.cleanup(failed); registry.finish(failed, false);
  for (let i = 0; i < 10; i++) {
    const record = registry.register(owner, { path: 'ordinary.sqlite', domain: 'host' }); registry.finish(record);
    assert.ok(registry.counters().metadataBytes <= limits.metadataBytes); assert.ok(registry.counters().diagnosticBytes <= limits.diagnosticBytes);
  }
  time = 999999999;
  assert.equal(supervisor.getCleanupStatus(pending.id).state, 'pending'); assert.equal(supervisor.getCleanupStatus(failed.id).state, 'failed');
  assert.throws(() => supervisor.ackCleanup(pending.id), { code: 'read_in_progress' });
  const alias = registry.register(owner, { path: 'alias.sqlite', domain: 'host' });
  assert.throws(() => registry.bind(alias, '1:9'), { code: 'read_in_progress' });
  assert.throws(() => registry.register(owner, { path: 'fourth.sqlite', domain: 'host' }), { code: 'read_in_progress' });
  registry.finish(alias); registry.finish(pending);
  registry.recover(failed, () => ({ workerStopped: true, nativeDisposed: true, leasesReleased: true, providersSettled: true }));
  assert.equal((await supervisor.drain(failed.id)).state, 'complete');
});

test('P2-16 outer resource attribution cannot be released by public timeout or confirmed Worker termination alone', async () => {
  const h = harness({ stall: true }); const opening = h.open(h.options), actor = h.actors[0];
  Atomics.add(new Int32Array(actor.data.resources), 0, 1);
  h.set(5000); h.tick(); let failure; await opening.catch(e => { failure = e; });
  actor.gate.resolve(); await flush();
  const status = h.supervisor.getCleanupStatus(failure.cleanupId);
  assert.equal(status.workerStopped, true); assert.equal(status.leasesReleased, false); assert.equal(status.state, 'failed');
  await assert.rejects(h.supervisor.drain(failure.cleanupId), { code: 'reader_failed' });
});

test('P2-03/29 final acceptance after validation rejects a response received just before cutoff', async () => {
  const h = harness(), reader = await h.open(h.options), actor = h.actors[0];
  const pending = reader.fetchCandidateEvidence(input, h.credential);
  h.readings([4999, 5000]); actor.reply({ ok: true, value: { private: 'held during validation' } });
  denied(await pending, 'read_timeout'); actor.gate.resolve(); await reader.close();
});

test('P2-27 failed final sampling stays latched even when a canonical/error handler tries to build diagnostics', () => {
  const s = setup(), request = requestRecord(s.control, 0n, 1000); let samples = 0, built = false;
  const access = requestAuthority({ authorize: () => s.binding, isCurrent: () => ++samples === 1 }, s.binding, request)('fetchCandidateEvidence', input, s.credential);
  assert.throws(() => access.check(), { code: 'scope_changed' });
  assert.throws(() => access.envelope(() => { built = true; return { details: 'private' }; }), { code: 'scope_changed' });
  assert.equal(built, false); assert.equal(samples, 2);
});

test('P2-01/22/25/28 constructor own-data, profile, expiry handoff and generation validation dispatch nothing', async () => {
  for (const mutate of [
    h => { delete h.options.profile; },
    h => { h.options.profile = 'context-read-product-v1'; },
    h => { h.options.host.configuration.requestBinding.ownerGeneration = 0; },
    h => { h.options.host.configuration.requestBinding.ownerGeneration = -1; },
    h => { h.options.host.configuration.requestBinding.ownerGeneration = 1.5; },
    h => { h.options.requestControl.credentialExpiresUtcMs = 999; },
    h => { h.options.host.configuration.requestBinding.credentialExpiresUtcMs = 2000; },
    h => { h.options.host.configuration.requestBinding.kind = 'service'; },
  ]) {
    const h = harness(); mutate(h); await assert.rejects(h.open(h.options)); assert.equal(h.actors.length, 0);
  }
  const h = harness(); let invoked = 0;
  Object.defineProperty(h.options, 'readSet', { get() { invoked++; return [ns]; } });
  await assert.rejects(h.open(h.options), { code: 'invalid_input' }); assert.equal(invoked, 0); assert.equal(h.actors.length, 0);
  const s = setup(), control = requestRecord(s.control, 0n, 1000), generation = { ...s.binding, ownerGeneration: 4 };
  const enter = requestAuthority({ authorize: () => s.binding, isCurrent: () => true }, generation, control);
  assert.throws(() => enter('fetchCandidateEvidence', input, s.credential), { code: 'authority_required' });
});

test('P2-17 telemetry covers comparison constructors, cached execution, iterator steps, transactions and close', async () => {
  const { nativeObserver } = await import('../context-product-telemetry.mjs');
  const frame = nativeTelemetry('native-coverage', 1), observer = nativeObserver(frame);
  class Native {
    exec() {}
    close() {}
    prepare() { return { get() { return 1; }, all() { return [1]; }, *iterate() { yield 1; yield 2; } }; }
  }
  const db = observer.database(new Native());
  const comparison = new db.constructor(':memory:'); comparison.close();
  db.exec('BEGIN'); const statement = db.prepare('SELECT private FROM memories');
  statement.get(); statement.all(); const iterator = statement.iterate();
  assert.equal(iterator[Symbol.iterator](), iterator); iterator.next(); iterator.return();
  db.exec('ROLLBACK'); db.close(); sealNative(frame);
  const diagnostic = drainNative(frame, true);
  assert.equal(diagnostic.coverage, 'complete'); assert.equal(diagnostic.begun, 11); assert.equal(diagnostic.completed, 11);
});

test('P2-03 repeated close shares one graceful disposal and does not force termination', async () => {
  const h = harness(), reader = await h.open(h.options);
  const first = reader.close(); assert.strictEqual(reader.close(), first); await first;
  assert.equal(h.actors[0].messages.filter(m => m.method === 'close').length, 1);
});

for (const outcome of [null, Promise.resolve(true), 'unknown', new Error('throw')]) test('P2-26 final throwing/unknown/Promise currentness refuses after two samples', () => {
  const s = setup(), request = requestRecord(s.control, 0n, 1000); let samples = 0;
  const enter = requestAuthority({ authorize: () => s.binding, isCurrent() {
    if (++samples === 1) return true;
    if (outcome instanceof Error) throw outcome; return outcome;
  } }, s.binding, request);
  const access = enter('fetchCandidateEvidence', input, s.credential);
  assert.throws(() => access.check(), { code: 'scope_changed' }); assert.equal(samples, 2);
});

test('P2-28 bounded own-data preserves credential byte/depth/node limits and complete IPC accounting', () => {
  assert.equal(JSON.stringify(boundedData('x'.repeat(16382), 16384)).length, 16384);
  assert.throws(() => boundedData('x'.repeat(16383), 16384), { code: 'invalid_input' });
  assert.throws(() => boundedData('字'.repeat(6000), 16384), { code: 'invalid_input' });
  assert.equal(boundedData(Array(8191).fill(0), 16384).length, 8191);
  assert.throws(() => boundedData(Array(8192).fill(0), 16384), { code: 'invalid_input' });
  let nested = 0; for (let i = 0; i < 16; i++) nested = [nested];
  assert.ok(boundedData(nested)); assert.throws(() => boundedData([nested]), { code: 'invalid_input' });
  assert.equal(hostConfiguration({ data: 'x'.repeat(200000) }).data.length, 200000);
  assert.throws(() => hostConfiguration({ data: 'x'.repeat(200000), shared: new SharedArrayBuffer(100000) }), { code: 'invalid_input' });
  let getters = 0; const data = { get secret() { getters++; return 1; } };
  assert.throws(() => boundedData(data), { code: 'invalid_input' }); assert.equal(getters, 0);
  assert.throws(() => boundedData(new Proxy({}, {})), { code: 'invalid_input' });
});

test('P2-22/28/29 null-expiry issuance cannot be renewed after registry history and ID-cache expiry', async () => {
  const h = harness(), reader = await h.open(h.options); await reader.close();
  h.set(400000); h.registry.counters();
  const copied = { ...h.options, supervisor: h.registry.supervisor(), requestControl: structuredClone(h.options.requestControl),
    host: { ...h.options.host, configuration: structuredClone(h.options.host.configuration) } };
  await assert.rejects(h.open(copied), { code: 'authority_required' });
  assert.equal(h.actors.length, 1);
  const absent = harness(); delete absent.options.host.configuration.requestReservation;
  await assert.rejects(absent.open(absent.options), { code: 'authority_required' }); assert.equal(absent.actors.length, 0);
});

for (const opening of [true, false]) test(`P2-03 abort signal brand/proxy validation before ${opening ? 'open' : 'operation'} registration`, async () => {
  let traps = 0;
  const signals = [Object.create(AbortSignal.prototype), new Proxy(new AbortController().signal, {
    getPrototypeOf() { traps++; throw Error('trap'); }, get() { traps++; throw Error('trap'); },
  })];
  for (const signal of signals) {
    const h = harness();
    if (opening) {
      await assert.rejects(h.open(h.options, { signal }), { code: 'invalid_input' });
      assert.equal(h.actors.length, 0); assert.equal(h.registry.counters().live, 0);
    } else {
      const reader = await h.open(h.options), before = h.registry.counters();
      denied(await reader.fetchCandidateEvidence(input, h.credential, { signal }), 'invalid_input');
      assert.deepEqual(h.registry.counters(), before);
      await reader.close();
    }
    await h.supervisor.close(); assert.equal(h.registry.counters().live, 0);
  }
  assert.equal(traps, 0);
});

for (const key of ['aborted', 'addEventListener', 'removeEventListener']) test(`P2-03 signal own override ${key} refuses without execution`, async () => {
  const h = harness(), controller = new AbortController(); let invoked = 0;
  Object.defineProperty(controller.signal, key, { get() { invoked++; throw Error('caller override'); } });
  await assert.rejects(h.open(h.options, { signal: controller.signal }), { code: 'invalid_input' });
  assert.equal(invoked, 0); assert.equal(h.actors.length, 0); assert.equal(h.registry.counters().live, 0);
  await h.supervisor.close();
});

test('P2-03 failed request setup cleans registered records and detachment failure cannot prevent settlement', async () => {
  const h = harness(), reader = await h.open(h.options), actor = h.actors[0];
  h.failTimers(); const pending = reader.fetchCandidateEvidence(input, h.credential);
  denied(await pending, 'reader_failed'); assert.equal(h.registry.counters().live, 2);
  actor.gate.resolve(); await reader.close(); await h.supervisor.close();
  assert.equal(h.registry.counters().live, 0);
  const lifecycle = createReaderWorkerLifecycle(); let settled;
  const slot = { resolve: result => { settled = result; }, detach() { throw Error('detachment'); } };
  lifecycle.pending = slot;
  assert.equal(lifecycle.finish(slot, 'terminal'), true);
  assert.equal(settled, 'terminal'); assert.equal(lifecycle.pending, undefined);
  assert.equal(lifecycle.finish(slot, 'late'), false); assert.equal(settled, 'terminal');
});

for (const kind of ['active-close', 'Worker-error', 'Worker-exit', 'idle-expiry']) test(`P2-03 ${kind}: public terminal, delayed disposal and late-result refusal are independent`, async () => {
  const h = harness(), reader = await h.open(h.options), actor = h.actors[0];
  let pending, settlements = 0;
  if (kind !== 'idle-expiry') pending = reader.fetchCandidateEvidence(input, h.credential).then(result => { settlements++; return result; });
  if (kind === 'Worker-error') actor.emit('error', Error('synthetic crash'));
  if (kind === 'Worker-exit') actor.emit('exit', 1);
  if (kind === 'idle-expiry') { h.set(60000); h.expireIdle(); }
  let disposed = false;
  const closing = reader.close().then(() => { disposed = true; });
  if (pending) denied(await pending, kind.startsWith('Worker') ? 'reader_failed' : 'store_closed');
  await flush(); assert.equal(disposed, false);
  assert.equal(h.registry.counters().live, kind === 'idle-expiry' ? 1 : 2);
  let drained = false; const draining = h.supervisor.drain().then(results => { drained = true; return results; });
  await flush(); assert.equal(drained, false);
  actor.reply({ ok: true, value: { private: 'late result' } });
  await flush(); assert.equal(settlements, pending ? 1 : 0); assert.equal(disposed, false);
  denied(await reader.fetchCandidateEvidence(input, h.credential), kind.startsWith('Worker') ? 'reader_failed' : 'store_closed');
  actor.gate.resolve(); await closing;
  const records = await draining;
  assert.ok(records.every(r => r.state === 'complete' && r.workerStopped && r.nativeDisposed));
  assert.equal(h.registry.counters().live, 0);
  actor.reply({ ok: true, value: { private: 'after disposal' } });
  assert.equal(settlements, pending ? 1 : 0);
});

for (const dimension of ['depth', 'nodes']) test(`P2-28 credential ${dimension} uses its own inclusive bounds through dispatch`, async () => {
  let credential = dimension === 'nodes' ? Array(8191).fill(0) : 0;
  if (dimension === 'depth') for (let i = 0; i < 16; i++) credential = [credential];
  const h = harness({ credential }), reader = await h.open(h.options), actor = h.actors[0];
  const pending = reader.fetchCandidateEvidence(input, credential);
  assert.deepEqual(actor.messages.at(-1).credential, credential);
  actor.reply({ ok: true, value: null }); assert.equal((await pending).ok, true);
  const before = actor.messages.length;
  const oversized = dimension === 'nodes' ? Array(8192).fill(0) : [credential];
  denied(await reader.fetchCandidateEvidence(input, oversized), 'invalid_input');
  assert.equal(actor.messages.length, before);
  await reader.close(); await h.supervisor.close();
});

test('P2-17 failed disposal exports known committed BUSY, frozen cleanup and incomplete coverage without losing the batch', async () => {
  const h = harness({ terminationFails: true }), reader = await h.open(h.options), actor = h.actors[0];
  const healthy = reader.getContextReadCapabilities();
  sealNative(actor.messages.at(-1).frame); actor.reply({ ok: true, value: null });
  assert.equal((await healthy).ok, true);
  const pending = reader.fetchCandidateEvidence(input, h.credential), frame = actor.messages.at(-1).frame;
  assert.throws(() => nativeOutcome(frame, 'execute', 'context_evidence', () => {
    throw Object.assign(Error('private SQL and content'), { code: 'ERR_SQLITE_ERROR', errcode: 261 });
  }));
  sealNative(frame); h.set(5000); h.tick(); denied(await pending, 'read_timeout');
  const closing = reader.close(); const rejected = assert.rejects(closing);
  actor.gate.resolve(); await rejected; await flush();
  const batch = await h.supervisor.drain();
  const observed = batch.find(r => r.diagnostics.busy === 1);
  assert.equal(observed.state, 'failed'); assert.equal(observed.telemetry, 'incomplete');
  assert.equal(observed.nativeDisposed, false); assert.equal(observed.diagnostics.coverage, 'incomplete');
  assert.equal(observed.diagnostics.records[0].sqlite.code, 5);
  assert.equal(observed.diagnostics.records[0].sqlite.extendedCode, 261);
  assert.equal(JSON.stringify(batch).includes('private'), false);
  assert.equal(batch.length, 3); assert.ok(batch.some(r => r.state === 'complete'));
  for (const value of [observed, observed.diagnostics, observed.diagnostics.records, observed.diagnostics.records[0], observed.diagnostics.records[0].sqlite]) assert.ok(Object.isFrozen(value));
  await assert.rejects(h.supervisor.drain(observed.cleanupId), error => {
    assert.equal(error.code, 'reader_failed'); assert.strictEqual(error.cleanup, observed);
    assert.strictEqual(error.diagnostics, observed.diagnostics); return true;
  });
  assert.throws(() => h.supervisor.ackCleanup(observed.cleanupId), { code: 'reader_failed' });
  await assert.rejects(h.supervisor.close(), { code: 'reader_failed' });
});

test('P2-08 all frozen errors preserve their codes and retryability across a real Worker boundary', async () => {
  const h = harness();
  const open = createProductReaderRuntime({ now: () => 0n, utc: () => 1000,
    setTimer: () => ({ unref() {} }), clearTimer() {},
    spawnWorker: data => new Worker(new URL('./fixtures/context-product-errors.mjs', import.meta.url), { workerData: data, env: {}, execArgv: [] }),
  });
  const reader = await open(h.options);
  try {
    for (const code of ['invalid_input','invalid_read_set','authority_required','scope_changed','invalid_cursor','cursor_stale',
      'invalid_snapshot','snapshot_stale','revision_conflict','evidence_unavailable','index_unavailable','token_count_unavailable',
      'context_item_too_large','storage_busy','storage_error','read_timeout','read_cancelled','read_in_progress','reader_failed',
      'store_closed','invalid_path','database_not_found','unsafe_database_file','unsupported_database']) {
      assert.deepEqual(await reader.fetchCandidateEvidence({ ...input, fixtureCode: code }, h.credential),
        { ok: false, error: { code, retryable: code === 'storage_busy' } });
    }
  } finally { await reader.close(); await h.supervisor.close(); }
});

test('P2-28 complete IPC byte cap still includes independently bounded credentials and shared buffers', () => {
  const credential = Array(8191).fill(0);
  const message = { credential, padding: '', shared: new SharedArrayBuffer(1024) };
  const overhead = Buffer.byteLength(JSON.stringify(message)) + message.shared.byteLength;
  const exact = { ...message, padding: 'x'.repeat(262144 - overhead) };
  assert.equal(operationMessage(exact).padding.length, 262144 - overhead);
  assert.throws(() => operationMessage({ ...exact, padding: exact.padding + 'x' }), { code: 'invalid_input' });
});

test('P2-03 opening setup failure releases the pre-registered record without spawning', async () => {
  const h = harness(); h.failTimers();
  let failure; await h.open(h.options).catch(error => { failure = error; });
  assert.equal(failure.code, 'reader_failed'); assert.equal(h.actors.length, 0);
  assert.equal((await h.supervisor.drain(failure.cleanupId)).state, 'complete');
  assert.equal(h.registry.counters().live, 0); await h.supervisor.close();
});

for (const opening of [true, false]) test(`P2-03 copied signal state/accessors/hooks refuse before ${opening ? 'open' : 'operation'} registration`, async () => {
  const genuine = new AbortController().signal, descriptors = Object.getOwnPropertyDescriptors(genuine);
  let invoked = 0;
  const signals = [Object.defineProperties({}, descriptors)];
  for (const key of Reflect.ownKeys(genuine)) {
    const forged = Object.defineProperties(Object.create(AbortSignal.prototype), descriptors);
    Object.defineProperty(forged, key, { get() { invoked++; throw Error('symbol accessor'); } });
    signals.push(forged);
  }
  // Discover this runtime's hook symbol instead of manufacturing a lookalike.
  const hook = Object.getOwnPropertySymbols(AbortSignal.prototype).find(key => key.description === 'kNewListener');
  assert.ok(hook);
  const h = harness(), hooked = new AbortController().signal;
  Object.defineProperty(hooked, hook, { get() { invoked++; throw Error('listener hook accessor'); } });
  signals.push(hooked);
  const reader = opening ? null : await h.open(h.options);
  for (const signal of signals) {
    const before = h.registry.counters(), spawned = h.actors.length;
    if (opening) await assert.rejects(h.open(h.options, { signal }), { code: 'invalid_input' });
    else denied(await reader.fetchCandidateEvidence(input, h.credential, { signal }), 'invalid_input');
    assert.deepEqual(h.registry.counters(), before); assert.equal(h.actors.length, spawned);
  }
  assert.equal(invoked, 0);
  await reader?.close(); await h.supervisor.close(); assert.equal(h.registry.counters().live, 0);
});

for (const opening of [true, false]) test(`P2-03 close during abort registration stops ${opening ? 'bootstrap' : 'dispatch'} and disposes the subscription`, async () => {
  const h = harness(), reader = opening ? null : await h.open(h.options), controller = new AbortController();
  const prototype = AbortSignal.prototype;
  const hook = Object.getOwnPropertySymbols(prototype).find(key => key.description === 'kNewListener');
  const original = Object.getOwnPropertyDescriptor(prototype, hook);
  let closing, pending;
  Object.defineProperty(prototype, hook, { ...original, value(...args) {
    const result = Reflect.apply(original.value, this, args);
    if (this === controller.signal) closing = h.supervisor.close();
    return result;
  } });
  try {
    pending = opening ? h.open(h.options, { signal: controller.signal })
      : reader.fetchCandidateEvidence(input, h.credential, { signal: controller.signal });
  } finally { Object.defineProperty(prototype, hook, original); }
  if (opening) await assert.rejects(pending, { code: 'store_closed' });
  else { denied(await pending, 'store_closed'); assert.equal(h.actors[0].messages.length, 0); h.actors[0].gate.resolve(); }
  assert.ok(closing); await closing; await reader?.close();
  assert.equal(h.actors.length, opening ? 0 : 1); assert.equal(h.registry.counters().live, 0);
  assert.equal(getEventListeners(controller.signal, 'abort').length, 0);
});

for (const loseNotification of [false, true]) test(`P2-03 prior stopImmediatePropagation cannot deliver success (lost notification ${loseNotification})`, async () => {
  const h = harness(), controller = new AbortController();
  const suppress = event => event.stopImmediatePropagation();
  controller.signal.addEventListener('abort', suppress);
  const reader = await h.open(h.options, { signal: controller.signal }), actor = h.actors[0];
  assert.deepEqual(getEventListeners(controller.signal, 'abort'), [suppress]);
  const pending = reader.fetchCandidateEvidence(input, h.credential, { signal: controller.signal });
  if (loseNotification) {
    // Exercise final acceptance independently of the propagation-resistant path.
    const protectedListener = getEventListeners(controller.signal, 'abort').find(listener => listener !== suppress);
    assert.ok(protectedListener);
    EventTarget.prototype.removeEventListener.call(controller.signal, 'abort', protectedListener);
  }
  controller.abort();
  if (loseNotification) actor.reply({ ok: true, value: { items: ['discarded'] } });
  denied(await pending, 'read_cancelled');
  actor.reply({ ok: true, value: { items: ['late'] } });
  assert.deepEqual(getEventListeners(controller.signal, 'abort'), [suppress]);
  actor.gate.resolve(); await reader.close(); await h.supervisor.close();
  assert.equal(h.registry.counters().live, 0);
});

test('P2-28 SharedArrayBuffer classification and descriptors execute no caller code', () => {
  let invoked = 0;
  const proxy = new Proxy({}, { getPrototypeOf() { invoked++; throw Error('prototype trap'); } });
  const unsupported = [Object.create(proxy), new Proxy(new SharedArrayBuffer(4), {
    get() { invoked++; throw Error('get trap'); }, getPrototypeOf() { invoked++; throw Error('prototype trap'); },
  })];
  for (const key of ['growable', 'byteLength']) {
    const shared = new SharedArrayBuffer(4);
    Object.defineProperty(shared, key, { get() { invoked++; throw Error('own accessor'); } });
    unsupported.push(shared);
  }
  const wrongPrototype = new SharedArrayBuffer(4); Object.setPrototypeOf(wrongPrototype, proxy); unsupported.push(wrongPrototype);
  for (const value of unsupported) assert.throws(() => hostConfiguration({ value }), { code: 'invalid_input' });
  const original = Object.getOwnPropertyDescriptor(SharedArrayBuffer.prototype, 'growable');
  Object.defineProperty(SharedArrayBuffer.prototype, 'growable', { ...original, get() { invoked++; throw Error('prototype accessor'); } });
  try { assert.equal(hostConfiguration({ value: new SharedArrayBuffer(4) }).value.byteLength, 4); }
  finally { Object.defineProperty(SharedArrayBuffer.prototype, 'growable', original); }
  assert.throws(() => hostConfiguration({ value: new SharedArrayBuffer(4, { maxByteLength: 8 }) }), { code: 'invalid_input' });
  assert.equal(invoked, 0);
});

for (const stage of ['authorize', 'entry', 'final']) test(`P2-26 rejected native Promise at ${stage} is observed through intrinsic then`, async () => {
  const s = setup(), control = requestRecord(s.control, 0n, 1000); let samples = 0, invoked = 0;
  const reject = () => {
    const promise = Promise.reject(Error('synthetic rejected authority'));
    Object.defineProperty(promise, 'then', { get() { invoked++; throw Error('own then'); } });
    return promise;
  };
  const enter = requestAuthority({ authorize: () => stage === 'authorize' ? reject() : s.binding,
    isCurrent() { samples++; return stage === 'entry' || stage === 'final' && samples === 2 ? reject() : true; },
  }, s.binding, control);
  if (stage === 'final') {
    const access = enter('fetchCandidateEvidence', input, s.credential);
    assert.throws(() => access.check(), { code: 'scope_changed' });
    assert.throws(() => access.check(), { code: 'scope_changed' });
  } else assert.throws(() => enter('fetchCandidateEvidence', input, s.credential), { code: 'authority_required' });
  assert.equal(samples, stage === 'authorize' ? 0 : stage === 'entry' ? 1 : 2); assert.equal(invoked, 0);
  // A task boundary allows the runtime's unhandled-rejection check to run.
  await new Promise(resolve => setImmediate(resolve));
});

for (const stage of ['authorize', 'entry', 'final']) test(`P2-26 non-native thenable at ${stage} is refused without calling then`, () => {
  const s = setup(), control = requestRecord(s.control, 0n, 1000); let samples = 0, invoked = 0;
  const thenable = { then() { invoked++; throw Error('thenable'); } };
  const enter = requestAuthority({ authorize: () => stage === 'authorize' ? thenable : s.binding,
    isCurrent() { samples++; return stage === 'entry' || stage === 'final' && samples === 2 ? thenable : true; },
  }, s.binding, control);
  if (stage === 'final') assert.throws(() => enter('fetchCandidateEvidence', input, s.credential).check(), { code: 'scope_changed' });
  else assert.throws(() => enter('fetchCandidateEvidence', input, s.credential), { code: 'authority_required' });
  assert.equal(samples, stage === 'authorize' ? 0 : stage === 'entry' ? 1 : 2); assert.equal(invoked, 0);
});

for (const opening of [true, false]) {
  for (const kind of ['timeout', 'any', 'any-source']) test(`P2-03 native ${kind} accepted at ${opening ? 'open' : 'operation'} entry`, async () => {
    const h = harness({ stall: opening }), controller = new AbortController(), other = new AbortController();
    const composite = AbortSignal.any([controller.signal, other.signal]);
    const signal = kind === 'timeout' ? AbortSignal.timeout(60000) : kind === 'any' ? composite : controller.signal;
    const reader = opening ? null : await h.open(h.options);
    const pending = opening ? h.open(h.options, { signal }) : reader.fetchCandidateEvidence(input, h.credential, { signal });
    const actor = h.actors[0], result = { ok: true, value: null };
    assert.ok(actor); assert.equal(actor.messages.length, opening ? 0 : 1);
    actor.reply(result);
    const opened = opening ? await pending : reader;
    if (!opening) assert.deepEqual(await pending, result);
    assert.equal(getEventListeners(signal, 'abort').length, 0);
    assert.equal(composite.aborted, false);
    await opened.close(); await h.supervisor.close(); assert.equal(h.registry.counters().live, 0);
  });

  for (const kind of ['abort', 'aborted-any']) test(`P2-03 native ${kind} cancels ${opening ? 'open' : 'operation'} without dispatch`, async () => {
    const h = harness(), reader = opening ? null : await h.open(h.options);
    const signal = kind === 'abort' ? AbortSignal.abort() : AbortSignal.any([new AbortController().signal, AbortSignal.abort()]);
    const pending = opening ? h.open(h.options, { signal }) : reader.fetchCandidateEvidence(input, h.credential, { signal });
    if (opening) await assert.rejects(pending, { code: 'read_cancelled' });
    else denied(await pending, 'read_cancelled');
    assert.equal(h.actors.length, opening ? 0 : 1);
    if (reader) { assert.equal(h.actors[0].messages.length, 0); h.actors[0].gate.resolve(); await reader.close(); }
    await h.supervisor.close(); assert.equal(h.registry.counters().live, 0);
  });

  test(`P2-03 composing a source during pending ${opening ? 'opening' : 'operation'} preserves acceptance`, async () => {
    const h = harness({ stall: opening }), reader = opening ? null : await h.open(h.options), controller = new AbortController();
    const pending = opening ? h.open(h.options, { signal: controller.signal })
      : reader.fetchCandidateEvidence(input, h.credential, { signal: controller.signal });
    const composite = AbortSignal.any([controller.signal, new AbortController().signal]);
    // Composition may leave own keys unchanged on some Node versions.
    const late = Symbol('late signal data');
    Object.defineProperty(controller.signal, late, { value: true });
    assert.ok(Reflect.ownKeys(controller.signal).includes(late));
    const actor = h.actors[0], result = { ok: true, value: null };
    actor.reply(result);
    const opened = opening ? await pending : reader;
    if (!opening) assert.deepEqual(await pending, result);
    assert.equal(composite.aborted, false); assert.equal(getEventListeners(controller.signal, 'abort').length, 0);
    await opened.close(); await h.supervisor.close(); assert.equal(h.registry.counters().live, 0);
  });

  test(`P2-03 late unused accessor during ${opening ? 'opening' : 'operation'} does not revalidate shape`, async () => {
    const h = harness({ stall: opening }), reader = opening ? null : await h.open(h.options), controller = new AbortController();
    const pending = opening ? h.open(h.options, { signal: controller.signal })
      : reader.fetchCandidateEvidence(input, h.credential, { signal: controller.signal });
    let invoked = 0;
    Object.defineProperty(controller.signal, 'late', { get() { invoked++; throw Error('unused accessor'); } });
    const result = { ok: true, value: null }; h.actors[0].reply(result);
    const opened = opening ? await pending : reader;
    if (!opening) assert.deepEqual(await pending, result);
    assert.equal(invoked, 0); assert.equal(getEventListeners(controller.signal, 'abort').length, 0);
    await opened.close(); await h.supervisor.close(); assert.equal(h.registry.counters().live, 0);
  });
}

for (const stage of ['response', 'record-finish']) test(`P2-03 unreadable final native aborted state at ${stage} cancels the operation and keeps reader usable`, async () => {
  const h = harness(), reader = await h.open(h.options), controller = new AbortController(), actor = h.actors[0];
  const pending = reader.fetchCandidateEvidence(input, h.credential, { signal: controller.signal });
  const key = Object.getOwnPropertySymbols(controller.signal).find(value => value.description === 'kAborted');
  assert.ok(key);
  const mutate = () => Object.defineProperty(controller.signal, key, { get() { throw Error('late aborted state failure'); } });
  const finish = h.registry.finish;
  if (stage === 'response') mutate();
  else h.registry.finish = (...args) => { const value = finish(...args); mutate(); return value; };
  try { actor.reply({ ok: true, value: { items: ['discarded'] } }); }
  finally { h.registry.finish = finish; }
  denied(await pending, 'read_cancelled');
  assert.equal(getEventListeners(controller.signal, 'abort').length, 0);
  assert.equal(h.registry.counters().live, 1);
  const next = reader.getContextReadCapabilities(), result = { ok: true, value: { usable: true } };
  actor.reply(result); assert.deepEqual(await next, result);
  await reader.close(); await h.supervisor.close(); assert.equal(h.registry.counters().live, 0);
});

test('P2-03 unreadable final native aborted state cancels opening with supervised cleanup', async () => {
  const h = harness({ stall: true }), controller = new AbortController();
  const opening = h.open(h.options, { signal: controller.signal }), actor = h.actors[0];
  const key = Object.getOwnPropertySymbols(controller.signal).find(value => value.description === 'kAborted');
  assert.ok(key);
  Object.defineProperty(controller.signal, key, { get() { throw Error('late aborted state failure'); } });
  actor.reply({ ok: true, value: null });
  let failure; await opening.catch(error => { failure = error; });
  assert.equal(failure.code, 'read_cancelled');
  assert.equal(getEventListeners(controller.signal, 'abort').length, 0);
  actor.gate.resolve(); assert.equal((await h.supervisor.drain(failure.cleanupId)).state, 'complete');
  await h.supervisor.close(); assert.equal(h.registry.counters().live, 0);
});

test('P2-03 final acceptance rejects an aborted opening even when notification is lost', async () => {
  const h = harness({ stall: true }), controller = new AbortController();
  const suppress = event => event.stopImmediatePropagation(); controller.signal.addEventListener('abort', suppress);
  const opening = h.open(h.options, { signal: controller.signal }), actor = h.actors[0];
  const listener = getEventListeners(controller.signal, 'abort').find(value => value !== suppress);
  assert.ok(listener); EventTarget.prototype.removeEventListener.call(controller.signal, 'abort', listener);
  controller.abort(); actor.reply({ ok: true, value: null });
  let failure; await opening.catch(error => { failure = error; });
  assert.equal(failure.code, 'read_cancelled'); actor.gate.resolve();
  assert.equal((await h.supervisor.drain(failure.cleanupId)).state, 'complete');
  await h.supervisor.close(); assert.equal(h.registry.counters().live, 0);
});

test('Fix round 4 probe reservation survives interruption and known BUSY survives missing close outcomes', async () => {
  const { nativeObserver } = await import('../context-product-telemetry.mjs');
  const frame = nativeTelemetry('probe-interrupted', 1), observer = nativeObserver(frame);
  assert.throws(() => observer.journalProbe(() => {
    assert.equal(drainNative(frame, false).inFlight, 1);
    throw Error('synthetic child interrupted');
  }));
  sealNative(frame); assert.equal(drainNative(frame, true).coverage, 'incomplete');
  const busy = nativeTelemetry('probe-busy-lost-close', 1), observed = nativeObserver(busy);
  const events = [
    { begin: { stage: 'open', statement: 'connection' } },
    { outcome: { stage: 'open', statement: 'connection', ok: true } },
    { begin: { stage: 'prepare', statement: 'journal_mode' } },
    { outcome: { stage: 'prepare', statement: 'journal_mode', ok: false, extendedCode: 261 } },
    { begin: { stage: 'close', statement: 'connection' } },
  ];
  assert.throws(() => observed.journalProbe(() => ({ events, complete: false })), { code: 'ERR_SQLITE_ERROR', errcode: 261 });
  sealNative(busy); const diagnostics = drainNative(busy, true);
  assert.equal(diagnostics.coverage, 'incomplete'); assert.equal(diagnostics.busy, 1);
  assert.equal(diagnostics.begun, 3); assert.equal(diagnostics.completed, 2); assert.equal(diagnostics.inFlight, 1);
  assert.deepEqual(diagnostics.records[0].sqlite, { code: 5, extendedCode: 261 });
  assert.throws(() => nativeObserver().journalProbe(() => ({ events, complete: false })), { code: 'ERR_SQLITE_ERROR', errcode: 261 });
});

test('Fix round 4 complete probe counts four native calls; acknowledged cache hits add none', async () => {
  const { nativeObserver } = await import('../context-product-telemetry.mjs');
  const frame = nativeTelemetry('probe-clean', 1), observer = nativeObserver(frame);
  const events = [['open', 'connection'], ['prepare', 'journal_mode'], ['execute', 'journal_mode'], ['close', 'connection']]
    .flatMap(([stage, statement]) => [{ begin: { stage, statement } }, { outcome: { stage, statement, ok: true } }]);
  assert.deepEqual(observer.journalProbe(() => ({ value: { mode: 'delete' }, events, complete: true })), { mode: 'delete' });
  assert.deepEqual(observer.journalProbe(() => ({ value: { mode: 'delete' }, events: [], complete: true, cached: true })), { mode: 'delete' });
  sealNative(frame); const diagnostic = drainNative(frame, true);
  assert.equal(diagnostic.coverage, 'complete'); assert.equal(diagnostic.begun, 4);
  assert.equal(diagnostic.completed, 4); assert.equal(diagnostic.failures, 0); assert.equal(diagnostic.busy, 0);
});

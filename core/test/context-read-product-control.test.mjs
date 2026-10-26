import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { EventEmitter } from 'node:events';
import { requestRecord, operationRecord, verifyRecords, credentialDigest, PRODUCT_PROFILE, boundedData, hostConfiguration } from '../context-product-control.mjs';
import { requestAuthority } from '../context-product-authority.mjs';
import { createProductReaderRuntime } from '../context-product-reader.mjs';
import { createSupervisorRegistry, supervisorOwner } from '../context-read-supervisor.mjs';
import { nativeTelemetry, nativeOutcome, sealNative, drainNative, NATIVE_CAPACITY } from '../context-product-telemetry.mjs';

const ns = { ownerId: 'synthetic-product', scope: 'personal', projectId: null };
const coverage = { policy: 'recent-projects-v1', selectionRevision: 'fixture', requestedNamespaces: 1, selectedNamespaces: 1, omittedNamespaces: 0 };
const deferred = () => { let resolve; const promise = new Promise(r => { resolve = r; }); return { promise, resolve }; };
const flush = async () => { for (let i = 0; i < 8; i++) await Promise.resolve(); };
function setup(expiry = null) {
  const credential = { nonce: randomUUID() };
  const control = { requestId: randomUUID(), handleId: randomUUID(), credentialBindingId: randomUUID(), credentialExpiresUtcMs: expiry, requestMaxMs: 5000 };
  const binding = { kind: 'request', ...control, ownerId: ns.ownerId, namespaces: { readSet: [ns], ownerCoverage: coverage }, issuedAt: 7,
    credentialDigest: credentialDigest(credential) };
  delete binding.requestMaxMs;
  return { credential, control, binding, requestReservation: new SharedArrayBuffer(4) };
}
function harness({ expiry = null, openAt = 0, stall = false, terminationFails = false } = {}) {
  let time = 0n, wall = 1000, order = [], readings = [];
  const timers = new Set(), actors = [], registry = createSupervisorRegistry({ now: () => Number(time) / 1e6 });
  const state = setup(expiry), supervisor = registry.supervisor();
  const options = { supervisor, path: new URL('synthetic.sqlite', import.meta.url).pathname, version: 'context-read-v1', profile: PRODUCT_PROFILE,
    readSet: [ns], ownerCoverage: coverage, requestControl: state.control,
    host: { moduleUrl: new URL('../testing/context-product-host.mjs', import.meta.url).href, configuration: { requestBinding: state.binding, requestReservation: state.requestReservation } }, diagnostics: true };
  const open = createProductReaderRuntime({
    now() { order.push('mono'); return readings.length ? readings.shift() : time; }, utc() { order.push('utc'); return wall; },
    setTimer(fn, ms) { order.push('timer'); const timer = { fn, ms, unref() {} }; timers.add(timer); return timer; },
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

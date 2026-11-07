import test from 'node:test';
import assert from 'node:assert/strict';
import { Worker } from 'node:worker_threads';
import { randomUUID } from 'node:crypto';
import { fixture } from '../testing/context-read-fixture.mjs';
import { configured, personal } from '../testing/context-product-owner-fixture.mjs';
import { createProductReaderRuntime, maintenanceFailureDiagnostic } from '../context-product-reader.mjs';
import { createMaintenancePumpRuntime, maintenancePumpDiagnostic, maintenancePumpPhaseDiagnostic } from '../context-product-pump.mjs';
import { admitMaintenance, refreshMaintenance } from '../context-product-admission.mjs';
import * as attribution from '../context-product-attribution.mjs';
const {readMaintenanceFailure, maintenanceFailureRecord} = attribution;
import * as authority from '../context-product-authority.mjs';
import { credentialDigest } from '../context-product-control.mjs';
import { fail } from '../validation.mjs';

// Eleven values are named in the brief (six authority + four Worker + other).
const causes = ['host_port','credential_missing','credential_digest','grant_mismatch','authorize_error','not_current',
  'request_binding','worker_epoch','semantic_outstanding','method_gate','other'];
const workerExecArgv = process.execArgv.filter((arg, index, args) => arg === '--experimental-loader' || args[index - 1] === '--experimental-loader');
const capture = work => {try {work();} catch (error) {return error;} assert.fail('expected refusal');};
const ownShape = error => ({keys: Reflect.ownKeys(error), prototype: Object.getPrototypeOf(error), code: error.code,
  descriptors: Object.fromEntries(Reflect.ownKeys(error).map(key => {const {value, ...descriptor} = Object.getOwnPropertyDescriptor(error, key); return [key, descriptor];}))});

for (const cause of causes) test(`maintenance authority refusal: ${cause}`, {timeout: 60000}, async t => {
  for (const gateMethod of cause === 'method_gate' ? ['fetchCandidateEvidence','contextRead'] : [undefined]) await t.test(gateMethod ?? 'check', async t => {
    const f = fixture(t), c = configured(t, f.path, [personal], {service: true});
    const calls = new SharedArrayBuffer(8), messages = [];
    c.options.host = {moduleUrl: new URL('../testing/context-product-refusal-host.mjs', import.meta.url).href,
      configuration: {serviceBinding: c.binding, mode: cause, calls}};
    const open = createProductReaderRuntime({maintenance: true, spawnWorker(data) {
      const worker = new Worker(new URL('../context-product-worker.mjs', import.meta.url), {workerData: {...data, refusalSite: gateMethod ?? cause}, execArgv: workerExecArgv, env: {}});
      worker.on('message', message => {if (message.maintenanceFailure) {messages.push(structuredClone(message)); if (cause === 'other') message.operation.workerEpoch--;}});
      const send = worker.postMessage.bind(worker);
      worker.postMessage = message => {
        if (!['close', undefined].includes(message.method)) {
          message = structuredClone(message);
          if (cause === 'credential_missing') delete message.credential;
          if (cause === 'credential_digest') message.credential = {different: true};
          if (cause === 'request_binding') message.request.clockDomainId = randomUUID();
          if (cause === 'semantic_outstanding') message.semanticOutstanding = new SharedArrayBuffer(8);
          if (cause === 'method_gate') message.method = gateMethod;
          if (cause === 'other') message.operation.workerEpoch++;
        }
        send(message);
      };
      return worker;
    }});
    let clock = Math.floor(Number(process.hrtime.bigint()) / 1e6), serial = 0;
    const timers = new Map(), setTimer = (fn, ms) => {const key = {n: ++serial, unref() {}}; timers.set(key, {fn, at: clock + ms}); return key;};
    const renew = createMaintenancePumpRuntime({open, admit: admitMaintenance, work: refreshMaintenance, now: () => clock,
      setTimer, clearTimer: key => timers.delete(key)});
    const p = renew({supervisor: c.supervisor, id: 'synthetic-refusal-' + cause + (gateMethod ?? ''),
      window: {id: 'synthetic-window', endsAtMonoMs: clock + 60000, usedItems: 0, usedMs: 0},
      budgets: {maxItems: 8, maxMs: 8000}, quantum: {maxItems: 1, maxMs: 1000}, pollMs: 1000, renewalMs: 60000,
      serviceCredential: c.token, projections: [{options: c.options, types: ['memory']}]});
    t.after(() => p.close());
    // The first scheduled admission is enough to execute every injected guard.
    const [key, timer] = [...timers].sort((a, b) => a[1].at - b[1].at)[0];
    timers.delete(key); clock = Math.max(clock, timer.at); await timer.fn();
    const final = await p.completion;
    const raw = messages.find(message => message.maintenanceFailure)?.maintenanceFailure;
    assert.equal(raw?.kind, 'engine', JSON.stringify({messages, diagnostic: maintenancePumpDiagnostic(final)})); assert.equal(raw.engineCode, 'authority_required');
    assert.equal(raw.refusal, cause, 'real Worker check identifies its refusal');
    assert.equal(readMaintenanceFailure(raw).refusal, cause, 'reader validates the tag');
    assert.equal(maintenancePumpDiagnostic(final).lastFailure.refusal, cause, 'pump captured diagnostic');
    const lane = maintenancePumpPhaseDiagnostic(final).projections.find(lane => lane.lastFailure);
    assert.equal(lane.lastFailure.refusal, cause, 'phase captured diagnostic');
    assert.equal(JSON.stringify(final).includes('"refusal":'), false, 'public pump result stays unchanged');
    assert.equal(JSON.stringify(messages[0].result).includes('"refusal":'), false, 'public error stays unchanged');
    const expectedCalls = ['host_port','credential_missing','credential_digest','request_binding','worker_epoch','semantic_outstanding','method_gate','other'].includes(cause) ? [0, 0]
      : cause === 'not_current' ? [1, 1] : [1, 0];
    assert.deepEqual([...new Int32Array(calls)], expectedCalls, 'host call counts');
    await p.close();
  });
});

test('authority refusal allowlist is closed at both boundaries and absent for other failures', () => {
  for (const refusal of [...causes, 'unknown_refusal', '', null, undefined, {}, 3]) {
    const expected = causes.includes(refusal) ? refusal : 'other';
    const detail = {engineCode: 'authority_required', refusal};
    assert.equal(readMaintenanceFailure({kind: 'engine', ...detail}).refusal, expected);
    assert.equal(maintenanceFailureRecord('engine', detail).refusal, expected);
    for (const kind of ['exception','unmapped','protocol']) {
      assert.equal(Object.hasOwn(readMaintenanceFailure({kind, ...detail}), 'refusal'), false);
      assert.equal(Object.hasOwn(maintenanceFailureRecord(kind, detail), 'refusal'), false);
    }
    assert.equal(Object.hasOwn(maintenanceFailureRecord('engine', {...detail, engineCode: 'storage_busy'}), 'refusal'), false);
  }
});

test('authority refusal preserves Error shape and samples each host only once', () => {
  const token = {opaque: 'synthetic'}, binding = {credentialDigest: credentialDigest(token), namespaces: {readSet: [], ownerCoverage: {}}, ownerId: 'synthetic'};
  const base = capture(() => fail('authority_required'));
  for (const cause of causes.slice(0, 6)) {
    let authorizations = 0, samples = 0;
    const host = {authorize() {authorizations++; if (cause === 'authorize_error') throw Error('synthetic'); return cause === 'grant_mismatch' ? null : binding;},
      isCurrent() {samples++; return cause !== 'not_current';}};
    if (cause === 'host_port') delete host.authorize;
    const error = capture(() => authority.requestAuthority(host, binding, {})('getContextIndexStatus', {}, cause === 'credential_missing' ? null : cause === 'credential_digest' ? {} : token));
    assert.deepEqual(ownShape(error), ownShape(base), cause);
    assert.equal(error.message, base.message); assert.equal(error.name, base.name);
    assert.equal(attribution.authorityRefusal?.(error), cause);
    assert.equal(authorizations, ['grant_mismatch','authorize_error','not_current'].includes(cause) ? 1 : 0);
    assert.equal(samples, cause === 'not_current' ? 1 : 0);
  }
  assert.equal(attribution.authorityRefusal?.(base), undefined);
});

test('authority async, thrown currentness and final scope failure keep their original decisions', () => {
  const token = {}, binding = {suppression: {}, credentialDigest: credentialDigest(token), namespaces: {readSet: [personal]}, ownerId: personal.ownerId};
  for (const grant of [Promise.resolve(binding), null, 1, {...binding, ownerId: 'different'}, Object.create({inherited: true})]) {
    const error = capture(() => authority.requestAuthority({authorize: () => grant, isCurrent: () => true}, binding, {})('status', {}, token));
    assert.equal(error.code, 'authority_required'); assert.equal(attribution.authorityRefusal?.(error), 'grant_mismatch');
  }
  for (const current of [() => {throw Error('synthetic');}, () => 1, () => Promise.resolve(true)]) {
    const error = capture(() => authority.requestAuthority({authorize: () => binding, isCurrent: current}, binding, {})('status', {}, token));
    assert.equal(attribution.authorityRefusal?.(error), 'not_current');
  }
  let samples = 0;
  const access = authority.requestAuthority({authorize: () => binding, isCurrent: () => ++samples === 1}, binding, {})('status', {}, token);
  const error = capture(() => access.check());
  assert.equal(error.code, 'scope_changed'); assert.equal(attribution.authorityRefusal?.(error), undefined); assert.equal(samples, 2);
});


test('serving authority failures have no maintenance details or refusal fields', {timeout: 60000}, async t => {
  for (const mode of [...causes.slice(0, 6), 'method_gate_serving']) {
    const f = fixture(t), c = configured(t, f.path, [personal]);
    c.options.host = {moduleUrl: new URL('../testing/context-product-refusal-host.mjs', import.meta.url).href,
      configuration: {requestBinding: c.binding, requestReservation: c.options.host.configuration.requestReservation, mode, calls: new SharedArrayBuffer(8)}};
    const messages = [], open = createProductReaderRuntime({spawnWorker(data) {
      const worker = new Worker(new URL('../context-product-worker.mjs', import.meta.url),
        {workerData: data, execArgv: workerExecArgv, env: {}});
      worker.on('message', message => messages.push(message));
      const send = worker.postMessage.bind(worker);
      worker.postMessage = message => {
        if (message.method === 'getContextIndexStatus') {
          message = structuredClone(message);
          if (mode === 'credential_missing') delete message.credential;
          if (mode === 'credential_digest') message.credential = {different: true};
          if (mode === 'method_gate_serving') {message.method = 'admitMaintenance'; message.input.budget = {maxMs: 5000};}
        }
        send(message);
      };
      return worker;
    }});
    const h = await open(c.options); t.after(() => h.close());
    const result = await h.getContextIndexStatus({readSet: [personal], types: ['memory'], intent: 'current', deadlineMs: 5000}, c.token);
    assert.deepEqual(result, {ok: false, error: {code: 'authority_required', retryable: false}});
    assert.equal(maintenanceFailureDiagnostic(result), undefined);
    for (const message of messages) {
      assert.equal(Object.hasOwn(message, 'maintenanceFailure'), false);
      assert.equal(JSON.stringify(message).includes('"refusal":'), false);
    }
    await h.close();
  }
});

test('an authorize callback throwing an already tagged error remains authorize_error', () => {
  const token = {}, binding = {suppression: {}, credentialDigest: credentialDigest(token), namespaces: {readSet: [personal]}, ownerId: personal.ownerId};
  const prior = capture(() => authority.requestAuthority({}, binding, {}));
  const error = capture(() => authority.requestAuthority({authorize() {throw prior;}, isCurrent: () => true}, binding, {})('status', {}, token));
  assert.equal(attribution.authorityRefusal?.(error), 'authorize_error');
});

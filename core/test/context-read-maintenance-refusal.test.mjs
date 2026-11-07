import { getEventListeners } from 'node:events';
import { readFileSync, openSync, closeSync } from 'node:fs';
import { createTestWorkspace } from '../../tools/testing/workspace.mjs';
import { join } from 'node:path';
import { runInNewContext } from 'node:vm';
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { Worker } from 'node:worker_threads';
import { randomUUID } from 'node:crypto';
import { fixture } from '../testing/context-read-fixture.mjs';
import { configured, personal } from '../testing/context-product-owner-fixture.mjs';
import { createProductReaderRuntime, maintenanceFailureDiagnostic } from '../context-product-reader.mjs';
import { createMaintenancePumpRuntime, maintenancePumpDiagnostic, maintenancePumpPhaseDiagnostic } from '../context-product-pump.mjs';
import { admitMaintenance, refreshMaintenance } from '../context-product-admission.mjs';
import * as attribution from '../context-product-attribution.mjs';
import * as refusals from '../context-product-refusal.mjs';

const {readMaintenanceFailure, maintenanceFailureRecord} = attribution;
import * as authority from '../context-product-authority.mjs';
import { credentialDigest } from '../context-product-control.mjs';
import { fail } from '../validation.mjs';

// Eleven values are named in the brief (six authority + four Worker + other).
const causes = ['host_port','credential_missing','credential_digest','grant_mismatch','authorize_error','not_current',
  'request_binding','worker_epoch','semantic_outstanding','method_gate','other'];
// Captured with the same inputs and unjoined ordinal state on the base runtime.
const baseRecords = {
  host_port: {"cause":"engine","engineCode":"authority_required","stage":"refresh","stall":{"kind":0,"runningMs":0,"unitCount":0,"unattributed":1},"number":0,"lane":0},
  credential_missing: {"cause":"engine","engineCode":"authority_required","stage":"refresh","stall":{"kind":0,"runningMs":0,"unitCount":0,"unattributed":1},"number":0,"lane":0},
  credential_digest: {"cause":"engine","engineCode":"authority_required","stage":"refresh","stall":{"kind":0,"runningMs":0,"unitCount":0,"unattributed":1},"number":0,"lane":0},
  grant_mismatch: {"cause":"engine","engineCode":"authority_required","stage":"refresh","stall":{"kind":0,"runningMs":0,"unitCount":0,"unattributed":1},"number":0,"lane":0},
  authorize_error: {"cause":"engine","engineCode":"authority_required","stage":"refresh","stall":{"kind":0,"runningMs":0,"unitCount":0,"unattributed":1},"number":0,"lane":0},
  not_current: {"cause":"engine","engineCode":"authority_required","stage":"refresh","stall":{"kind":0,"runningMs":0,"unitCount":0,"unattributed":1},"number":0,"lane":0},
  request_binding: {"cause":"engine","engineCode":"authority_required","stage":"refresh","stall":{"kind":0,"runningMs":0,"unitCount":0,"unattributed":1},"number":0,"lane":0},
  worker_epoch: {"cause":"engine","engineCode":"authority_required","stage":"refresh","stall":{"kind":0,"runningMs":0,"unitCount":0,"unattributed":1},"number":0,"lane":0},
  semantic_outstanding: {"cause":"engine","engineCode":"authority_required","stage":"refresh","stall":{"kind":0,"runningMs":0,"unitCount":0,"unattributed":1},"number":0,"lane":0},
  method_gate: {"cause":"engine","engineCode":"authority_required","stage":"refresh","stall":{"kind":0,"runningMs":0,"unitCount":0,"unattributed":1},"number":0,"lane":0},
  other: {"cause":"engine","engineCode":"authority_required","stage":"refresh","stall":{"kind":0,"runningMs":0,"unitCount":0,"unattributed":1},"number":0,"lane":0},
};
function sameBaseRecord(actual, expected) {
  const {refusal, ...rest} = actual;
  assert.deepEqual(rest, expected);
  assert.deepEqual(Object.keys(rest), Object.keys(expected), 'base key order');
  if (refusal !== undefined) assert.equal(Object.keys(actual).indexOf('refusal'), Object.keys(actual).indexOf('engineCode') + 1);
}
function unjoined(t) {
  const state = globalThis[Symbol.for('context-read-product/maintenance-dispatch-ordinal')], previous = state.next;
  state.next = Number.MAX_SAFE_INTEGER; t.after(() => {state.next = previous;});
}
const workerExecArgv = process.execArgv.filter((arg, index, args) => arg === '--experimental-loader' || args[index - 1] === '--experimental-loader');
const capture = work => {try {work();} catch (error) {return error;} assert.fail('expected refusal');};
const ownShape = error => ({keys: Reflect.ownKeys(error), prototype: Object.getPrototypeOf(error), code: error.code,
  descriptors: Object.fromEntries(Reflect.ownKeys(error).map(key => {const {value, ...descriptor} = Object.getOwnPropertyDescriptor(error, key); return [key, descriptor];}))});

for (const cause of causes) test(`maintenance authority refusal: ${cause}`, {timeout: 60000}, async t => {
  for (const gateMethod of cause === 'method_gate' ? ['fetchCandidateEvidence','contextRead'] : [undefined]) await t.test(gateMethod ?? 'check', async t => {
    unjoined(t);
    const f = fixture(t), c = configured(t, f.path, [personal], {service: true});
    const calls = new SharedArrayBuffer(8), messages = [], readerRecords = [];
    c.options.host = {moduleUrl: new URL('../testing/context-product-refusal-host.mjs', import.meta.url).href,
      configuration: {serviceBinding: c.binding, mode: cause, calls}};
    const open = createProductReaderRuntime({maintenance: true, spawnWorker(data) {
      const worker = new Worker(new URL('../context-product-worker.mjs', import.meta.url), {workerData: {...data, refusalSite: gateMethod ?? cause}, execArgv: workerExecArgv, env: {}});
      worker.on('message', message => {if (message.result?.ok === false) {messages.push(structuredClone(message)); if (cause === 'other') message.operation.workerEpoch--;}});
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
    const renew = createMaintenancePumpRuntime({open, admit: async (...args) => {
      const value = await admitMaintenance(...args), record = maintenanceFailureDiagnostic(value);
      if (record) readerRecords.push(record); return value;
    }, work: refreshMaintenance, now: () => clock,
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
    const frame = messages.find(message => message.result?.ok === false);
    const raw = frame?.maintenanceFailure ?? {kind: 'engine', engineCode: frame?.result.error.code, refusal: frame?.maintenanceRefusal};
    const recorded = maintenancePumpDiagnostic(final).lastFailure;
    sameBaseRecord(recorded, baseRecords[cause]);
    const {number, lane: laneNumber, ...readerBase} = baseRecords[cause];
    sameBaseRecord(readerRecords[0], readerBase);
    assert.equal(raw?.kind, 'engine', JSON.stringify({messages, diagnostic: maintenancePumpDiagnostic(final)})); assert.equal(raw.engineCode, 'authority_required');
    assert.equal(raw.refusal, cause, 'real Worker check identifies its refusal');
    assert.equal(readMaintenanceFailure(raw).refusal, cause, 'reader validates the tag');
    assert.equal(maintenancePumpDiagnostic(final).lastFailure.refusal, cause, 'pump captured diagnostic');
    const lane = maintenancePumpPhaseDiagnostic(final).projections.find(lane => lane.lastFailure);
    assert.equal(lane.lastFailure.refusal, cause, 'phase captured diagnostic');
    sameBaseRecord(lane.lastFailure, baseRecords[cause]);
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
    assert.equal(refusals.authorityRefusal?.(error), cause);
    assert.equal(authorizations, ['grant_mismatch','authorize_error','not_current'].includes(cause) ? 1 : 0);
    assert.equal(samples, cause === 'not_current' ? 1 : 0);
  }
  assert.equal(refusals.authorityRefusal?.(base), undefined);
});

test('authority async, thrown currentness and final scope failure keep their original decisions', () => {
  const token = {}, binding = {suppression: {}, credentialDigest: credentialDigest(token), namespaces: {readSet: [personal]}, ownerId: personal.ownerId};
  for (const grant of [Promise.resolve(binding), null, 1, {...binding, ownerId: 'different'}, Object.create({inherited: true})]) {
    const error = capture(() => authority.requestAuthority({authorize: () => grant, isCurrent: () => true}, binding, {})('status', {}, token));
    assert.equal(error.code, 'authority_required'); assert.equal(refusals.authorityRefusal?.(error), 'grant_mismatch');
  }
  for (const current of [() => {throw Error('synthetic');}, () => 1, () => Promise.resolve(true)]) {
    const error = capture(() => authority.requestAuthority({authorize: () => binding, isCurrent: current}, binding, {})('status', {}, token));
    assert.equal(refusals.authorityRefusal?.(error), 'not_current');
  }
  let samples = 0;
  const access = authority.requestAuthority({authorize: () => binding, isCurrent: () => ++samples === 1}, binding, {})('status', {}, token);
  const error = capture(() => access.check());
  assert.equal(error.code, 'scope_changed'); assert.equal(refusals.authorityRefusal?.(error), undefined); assert.equal(samples, 2);
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
      assert.equal(Object.hasOwn(message, 'maintenanceRefusal'), false);
      assert.equal(JSON.stringify(message).includes('"refusal":'), false);
    }
    await h.close();
  }
});

test('an authorize callback throwing an already tagged error remains authorize_error', () => {
  const token = {}, binding = {suppression: {}, credentialDigest: credentialDigest(token), namespaces: {readSet: [personal]}, ownerId: personal.ownerId};
  const prior = capture(() => authority.requestAuthority({}, binding, {}));
  const error = capture(() => authority.requestAuthority({authorize() {throw prior;}, isCurrent: () => true}, binding, {})('status', {}, token));
  assert.equal(refusals.authorityRefusal?.(error), 'authorize_error');
});


test('later delivery preserves the base failure classification through Worker, reader and pump', {timeout: 60000}, async t => {
  unjoined(t);
  const f = fixture(t), c = configured(t, f.path, [personal], {service: true}), messages = [];
  c.options.host = {moduleUrl: new URL('../testing/context-product-refusal-host.mjs', import.meta.url).href,
    configuration: {serviceBinding: c.binding, mode: 'later_delivery', path: f.path, calls: new SharedArrayBuffer(8)}};
  const open = createProductReaderRuntime({maintenance: true, spawnWorker(data) {
    const worker = new Worker(new URL('../context-product-worker.mjs', import.meta.url), {workerData: data, env: {}});
    worker.on('message', message => messages.push(structuredClone(message))); return worker;
  }});
  let clock = Math.floor(Number(process.hrtime.bigint()) / 1e6);
  const timers = new Map(), setTimer = (fn, ms) => {const key = {unref() {}}; timers.set(key, {fn, at: clock + ms}); return key;};
  const renew = createMaintenancePumpRuntime({open, admit: admitMaintenance, work: refreshMaintenance, now: () => clock,
    setTimer, clearTimer: key => timers.delete(key)});
  const p = renew({supervisor: c.supervisor, id: 'synthetic-delivery', window: {id: 'synthetic-window', endsAtMonoMs: clock + 60000, usedItems: 0, usedMs: 0},
    budgets: {maxItems: 8, maxMs: 8000}, quantum: {maxItems: 1, maxMs: 1000}, pollMs: 1000, renewalMs: 60000,
    serviceCredential: c.token, projections: [{options: c.options, types: ['memory']}]});
  t.after(() => p.close());
  const [key, timer] = [...timers].sort((a,b) => a[1].at - b[1].at)[0]; timers.delete(key); clock = timer.at; await timer.fn();
  const final = await p.completion, record = maintenancePumpDiagnostic(final).lastFailure;
  const expected = {cause: 'engine', engineCode: 'index_unavailable', reason: 'other', stage: 'refresh',
    stall: {kind: 0, runningMs: 0, unitCount: 0, unattributed: 1}, number: 0, lane: 0};
  assert.equal(messages.find(message => message.result?.ok === false)?.result.error.code, 'index_unavailable');
  sameBaseRecord(record, expected); assert.equal(Object.hasOwn(record, 'refusal'), false);
  assert.deepEqual(maintenancePumpPhaseDiagnostic(final).projections.find(lane => lane.lastFailure).lastFailure, expected);
  await p.close();
});

test('reader cancellation enriches the record actually chosen after acceptance', {timeout: 60000}, async t => {
  unjoined(t);
  const f = fixture(t), c = configured(t, f.path, [personal], {service: true}), controller = new AbortController();
  c.options.host = {moduleUrl: new URL('../testing/context-product-refusal-host.mjs', import.meta.url).href,
    configuration: {serviceBinding: c.binding, mode: 'authorize_error', calls: new SharedArrayBuffer(8)}};
  let raw;
  const open = createProductReaderRuntime({maintenance: true, spawnWorker(data) {
    const worker = new Worker(new URL('../context-product-worker.mjs', import.meta.url), {workerData: data, env: {}});
    worker.on('message', message => {
      if (message.result?.error?.code === 'authority_required') {
        raw = structuredClone(message);
        // Lose notification after registration. Final acceptance must still
        // replace this result using the native signal's aborted state.
        const listeners = getEventListeners(controller.signal, 'abort');
        assert.ok(listeners.length);
        for (const listener of listeners) EventTarget.prototype.removeEventListener.call(controller.signal, 'abort', listener);
        controller.abort();
      }
    }); return worker;
  }});
  const h = await open(c.options); t.after(() => h.close());
  const result = await h.getContextIndexStatus({readSet: [personal], types: ['memory'], intent: 'current', deadlineMs: 5000}, c.token, {signal: controller.signal});
  assert.equal(raw.result.error.code, 'authority_required'); assert.equal(result.error.code, 'read_cancelled');
  const record = maintenanceFailureDiagnostic(result);
  assert.equal(record.engineCode, 'read_cancelled'); assert.equal(Object.hasOwn(record, 'refusal'), false);
  assert.equal((await h.getContextReadCapabilities()).ok, true, 'acceptance replacement leaves the reader usable');
  await h.close();
});

test('unknown host refusal is normalized in the raw Worker close message', {timeout: 60000}, async t => {
  const f = fixture(t), c = configured({after: cleanup => t.after(async () => {try {await cleanup();} catch (error) {assert.equal(error.code, 'reader_failed');}})}, f.path, [personal], {service: true}), messages = [];
  c.options.host = {moduleUrl: new URL('../testing/context-product-refusal-host.mjs', import.meta.url).href,
    configuration: {serviceBinding: c.binding, mode: 'unknown_close', calls: new SharedArrayBuffer(8)}};
  const open = createProductReaderRuntime({maintenance: true, spawnWorker(data) {
    const worker = new Worker(new URL('../context-product-worker.mjs', import.meta.url), {workerData: data, env: {}});
    worker.on('message', message => messages.push(structuredClone(message))); return worker;
  }});
  const h = await open(c.options); t.after(() => h.close().catch(error => assert.equal(error.code, 'reader_failed')));
  await h.close().catch(() => {});
  const raw = messages.find(message => message.kind === 'maintenance-close-failure');
  assert.equal(raw?.maintenanceFailure?.engineCode, 'authority_required');
  assert.equal(raw.maintenanceFailure.refusal, 'other');
  sameBaseRecord(maintenanceFailureDiagnostic(h), {cause: 'engine', engineCode: 'authority_required', stage: 'close'});
});

for (const entry of ['content-suppression-reader', 'context-product-authority']) test(`cold import is inert: ${entry}`, t => {
  const code = `import assert from 'node:assert/strict';
    await import(${JSON.stringify(new URL('../', import.meta.url).href)} + ${JSON.stringify(entry + '.mjs')});
    assert.equal(Object.hasOwn(globalThis, Symbol.for('context-read-product/maintenance-dispatch-ordinal')), false);
    assert.deepEqual(process.getActiveResourcesInfo().filter(kind => kind !== 'CloseReq'), []);
    // Allow the loader's pending file-close callback to finish.
    await new Promise(resolve => setImmediate(resolve));
    await new Promise(resolve => setImmediate(resolve));
    assert.deepEqual(process.getActiveResourcesInfo(), []);`;
  const workspace = createTestWorkspace(t), stderr = join(workspace.path, 'cold-import.stderr'), descriptor = openSync(stderr, 'wx', 0o600);
  let child;
  try {child = spawnSync(process.execPath, ['--input-type=module', '-e', code], {stdio: ['ignore','ignore',descriptor]});}
  finally {closeSync(descriptor);}
  assert.equal(child.status, 0, readFileSync(stderr, 'utf8')); assert.equal(child.signal, null);
});


test('Worker detail normalizes an unexpected getter value for primary, secondary and disposal failures', () => {
  const source = readFileSync(new URL('../context-product-worker.mjs', import.meta.url), 'utf8');
  const start = source.indexOf('const noteFailure='), end = source.indexOf('const nativeFailure', start);
  assert.ok(start >= 0 && end > start);
  // Execute the production boundary with a faulted getter independently of
  // the registry's earlier normalization. Each retained detail is inspected.
  for (const value of ['unknown_value', undefined, null, {}, 3]) {
    const details = runInNewContext(`let failureDetail,secondaryFailureDetail,disposalFailureDetail;
      ${source.slice(start, end)}
      noteFailure('engine','authority_required',{},false,false);
      noteFailure('engine','authority_required',{},false,true);
      noteFailure('engine','authority_required',{},true,false);
      [failureDetail,secondaryFailureDetail,disposalFailureDetail];`, {
      workerData: {maintenance: true}, attribution: {stepKind: 0},
      maintenanceFailureCode: attribution.maintenanceFailureCode,
      authorityRefusal: () => value, refusalCause: refusals.refusalCause,
    });
    for (const detail of details) assert.equal(detail.refusal, 'other');
  }
  for (const value of ['unknown_value', undefined, null, {}, 3]) {
    const error = capture(() => refusals.refuseAuthority(value));
    assert.equal(refusals.authorityRefusal(error), 'other', 'registration normalizes unknown values');
  }
});


test('reader enrichment preserves the chosen detail and only tags an authority engine failure', () => {
  const source = readFileSync(new URL('../context-product-reader.mjs', import.meta.url), 'utf8');
  const start = source.indexOf('    function workerFailure('), end = source.indexOf('    function shutdown(', start);
  assert.ok(start >= 0 && end > start);
  const choose = runInNewContext(`${source.slice(start, end)} workerFailure;`, {
    readMaintenanceFailure, refusalCause: refusals.refusalCause, codes: new Set(['authority_required','index_unavailable','read_cancelled']),
  });
  for (const maintenanceFailure of [undefined, {kind: 'engine', engineCode: 'index_unavailable', reason: 'incompatible'},
    {kind: 'exception', errorName: 'TypeError', step: 1}, {kind: 'unmapped', engineCode: 'unknown'}]) {
    for (const code of ['index_unavailable', 'read_cancelled']) {
      const expected = readMaintenanceFailure(maintenanceFailure) ?? {kind: 'engine', engineCode: code};
      const actual = choose({maintenanceFailure, maintenanceRefusal: 'authorize_error'}, code);
      assert.deepEqual(JSON.parse(JSON.stringify(actual)), expected);
      assert.deepEqual(Object.keys(actual), Object.keys(expected));
    }
  }
  for (const maintenanceRefusal of ['authorize_error','unknown_value', undefined]) {
    assert.equal(choose({maintenanceRefusal}, 'authority_required').refusal, maintenanceRefusal === 'authorize_error' ? maintenanceRefusal : 'other');
  }
  assert.equal(choose({maintenanceFailure: {kind: 'engine', engineCode: 'authority_required', refusal: 'not_current'},
    maintenanceRefusal: 'authorize_error'}, 'read_cancelled').refusal, 'not_current', 'existing chosen detail remains authoritative');
});


test('selected refusal accessor neither consumes attribution nor changes base failure()', () => {
  const meter = attribution.createMaintenanceAttribution(), error = capture(() => refusals.refuseAuthority('authorize_error'));
  meter.captureFailure(error);
  assert.equal(meter.refusal, undefined, 'a capture is not a selection');
  meter.selectFailure(error);
  const before = meter.snapshot();
  assert.equal(meter.refusal, 'authorize_error'); assert.equal(meter.refusal, 'authorize_error');
  assert.deepEqual(meter.snapshot(), before); assert.equal(meter.failureSelected, true);
  assert.equal(meter.failure(), undefined, 'base classification of a selected authority error');
  assert.equal(meter.failure(), undefined, 'base cached result');
  meter.resetFailure(); assert.equal(meter.refusal, undefined);
});

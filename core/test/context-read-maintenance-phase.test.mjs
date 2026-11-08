import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { Worker } from 'node:worker_threads';
import { fixture, ns, ok } from '../testing/context-read-fixture.mjs';
import { configured } from '../testing/context-product-owner-fixture.mjs';
import { createProductReaderRuntime } from '../context-product-reader.mjs';
import { createMaintenancePumpRuntime } from '../context-product-pump.mjs';
import { admitMaintenance, refreshMaintenance } from '../context-product-admission.mjs';
import { requestAuthority } from '../context-product-authority.mjs';
import { credentialDigest, boundedData } from '../context-product-control.mjs';
import { contentAuthorityPort } from '../content-safety-boundary.mjs';
import { openContextProductFacade } from '../context-read-facade.mjs';
import { openProductIndex } from '../context-product-index.mjs';
import { suppressionFixture } from '../testing/content-suppression-fixture.mjs';

const baseKeys = ['method','input','ownerId','namespaces','requestControl','credentialBindingId'];
const input = {readSet:[ns], types:['memory'], intent:'current', mode:'lexical', budget:{maxItems:128, maxMs:5000}};
const status = {readSet:[ns], types:['memory'], intent:'current', deadlineMs:5000};
const denied = {ok:false, error:{code:'authority_required', retryable:false}};
function loader(settings) {
  return ['--import', 'data:text/javascript,' + encodeURIComponent(`import {register} from 'node:module'; register(${JSON.stringify(new URL('../testing/context-maintenance-phase-loader.mjs', import.meta.url).href)}, {data:${JSON.stringify(settings)}});`)];
}
function setup(t, {service=true, inject=false, identity=false, fresh=false, baseline=false, refuse=false} = {}) {
  const f = fixture(t), c = configured(t, f.path, [ns], {service}), evidence = [];
  c.options.host = {moduleUrl:new URL('../testing/context-maintenance-phase-host.mjs', import.meta.url).href,
    configuration:{[service?'serviceBinding':'requestBinding']:c.binding, refuse, baseline,
      ...(!service?{requestReservation:c.options.host.configuration.requestReservation}:{})}};
  let originalMethod, sentControl;
  const open = createProductReaderRuntime({maintenance:service, spawnWorker(data) {
    const worker = new Worker(new URL('../context-product-worker.mjs', import.meta.url),
      {workerData:data, env:{}, execArgv:loader({identity, fresh, baseline})});
    const emit = worker.emit;
    worker.emit = function(event, message, ...rest) {
      if (event === 'message' && message?.kind === 'phase-evidence') {
        evidence.push({...message, originalMethod, sentControl}); return true;
      }
      return emit.call(this, event, message, ...rest);
    };
    const send = worker.postMessage.bind(worker);
    worker.postMessage = message => {
      if (message.method && message.method !== 'close') {
        originalMethod = message.method; sentControl = structuredClone(message.request);
        if (inject) message = {...message, maintenancePhase:message.method === 'admitMaintenance'?'work':'admission'};
        if (identity) message = {...message, method:'contextRead'};
      }
      send(message);
    };
    return worker;
  }});
  return {...c, f, evidence, open:async () => {const h = await open(c.options); t.after(() => h.close()); return h;}, runtime:open};
}
function baseRequest(request, binding, payload = request.input) {
  return {method:request.method, input:payload, ownerId:binding.ownerId, namespaces:binding.namespaces,
    requestControl:request.requestControl, credentialBindingId:binding.credentialBindingId,
    ...(binding.suppression?{suppression:binding.suppression}:{})};
}
function absent(request, binding, payload) {
  assert.equal('maintenancePhase' in request, false);
  const base = baseRequest(request, binding, payload);
  assert.deepEqual(request, base);
  assert.deepEqual(Object.keys(request), Object.keys(base));
}
async function pump(t, settings={}) {
  const s = setup(t, settings);
  let clock = Math.floor(Number(process.hrtime.bigint())/1e6), serial = 0;
  const timers = new Map();
  const renew = createMaintenancePumpRuntime({open:s.runtime, now:() => clock,
    setTimer(fn, ms) {const key = {id:++serial, unref(){}}; timers.set(key, {fn, at:clock+ms}); return key;},
    clearTimer:key => timers.delete(key)});
  const p = renew({supervisor:s.supervisor, id:'synthetic-phase',
    window:{id:'synthetic-window', endsAtMonoMs:clock+60000, usedItems:0, usedMs:0},
    budgets:{maxItems:512, maxMs:60000}, quantum:{maxItems:128, maxMs:1000}, pollMs:1000, renewalMs:60000,
    serviceCredential:s.token, projections:[{options:s.options, types:['memory']}]});
  t.after(() => p.close());
  for (let turn=0; turn<12; turn++) {
    assert.ok(timers.size, 'pump must schedule a turn');
    const [key, timer] = [...timers].sort((a,b) => a[1].at-b[1].at)[0];
    timers.delete(key); clock = Math.max(clock, timer.at); await timer.fn();
    if (settings.refuse || s.evidence.some(e => e.originalMethod === 'refreshMaintenance' && e.event === 'authorize')) break;
  }
  const snapshot = p.getStatus();
  await p.close();
  return {...s, snapshot};
}

test('1 real pump and Worker: phase, method, frozen object identity and insertion order', {timeout:60000}, async t => {
  const s = await pump(t, {inject:true});
  for (const [method, phase] of [['admitMaintenance','admission'], ['refreshMaintenance','work']]) {
    const requests = s.evidence.filter(e => e.event === 'authorize' && e.originalMethod === method);
    assert.ok(requests.length, method);
    for (const {request} of requests) {
      assert.equal(request.method, 'refreshContextIndex');
      assert.equal(request.maintenancePhase, phase);
      assert.deepEqual(Object.keys(request), ['method','maintenancePhase', ...baseKeys.slice(1)]);
      const {maintenancePhase, ...rest} = request;
      assert.deepEqual(rest, baseRequest(request, s.binding));
    }
  }
  const samples = s.evidence.filter(e => e.event === 'isCurrent');
  assert.ok(samples.length > 0);
  for (const e of samples) {assert.equal(e.same, true); assert.equal(e.frozen, true);}
});

test('3 admission request keys insert phase directly after method', {timeout:60000}, async t => {
  const s = await pump(t);
  const request = s.evidence.find(e => e.event === 'authorize' && e.originalMethod === 'admitMaintenance').request;
  assert.deepEqual(Object.keys(request), ['method','maintenancePhase', ...baseKeys.slice(1)]);
});

test('2/2b direct refresh, status and serving requests retain the exact base shape; input/options cannot set phase', {timeout:60000}, async t => {
  const r = setup(t, {service:false, inject:true}), reader = await r.open();
  await reader.findCandidates({...status, query:'synthetic'}, r.token);
  const requests = r.evidence.filter(e => e.event === 'authorize');
  assert.equal(requests.length, 1); assert.equal(requests[0].request.method, 'findCandidates');
  assert.deepEqual(requests[0].request.requestControl, requests[0].sentControl);
  absent(requests[0].request, r.binding, {...status, query:'synthetic'});
  await reader.close();
  const s = setup(t, {inject:true}), h = await s.open();
  ok(await h.refreshContextIndex(input, s.token));
  ok(await h.getContextIndexStatus(status, s.token));
  for (const e of s.evidence.filter(e => e.event === 'authorize')) {
    assert.equal(e.request.method, e.originalMethod);
    assert.deepEqual(e.request.requestControl, e.sentControl);
    absent(e.request, s.binding, e.originalMethod === 'refreshContextIndex'?input:status);
  }
  for (const method of [admitMaintenance, refreshMaintenance]) {
    const before = s.evidence.length;
    assert.deepEqual(await method(h, {...input, maintenancePhase:'work'}, s.token), {ok:false,error:{code:'invalid_input',retryable:false}});
    assert.deepEqual(await method(h, input, s.token, {maintenancePhase:'admission'}), {ok:false,error:{code:'invalid_input',retryable:false}});
    assert.equal(s.evidence.length, before, 'base rejects unknown input/control before host authorization');
    ok(await method(h, input, s.token));
    const request = s.evidence.slice(before).find(e => e.event === 'authorize').request;
    assert.equal(request.maintenancePhase, method === admitMaintenance?'admission':'work');
  }
  await assert.rejects(() => s.runtime({...s.options, maintenancePhase:'work'}), {code:'invalid_input'});
  await h.close();
});

test('2 semantic maintenance and suppression pull retain the exact base shape', {timeout:60000}, async t => {
  const s = setup(t), requests = [];
  const facade = openContextProductFacade(s.f.path, {});
  const control = {synthetic:true};
  const host = {authorize(request) {requests.push(request); return s.binding;}, isCurrent:() => false};
  const enter = requestAuthority(host, s.binding, control);
  const index = openProductIndex({path:s.f.path, facade, authorize:enter, ownerCoverage:s.options.ownerCoverage,
    maintenance:true, semantic:{snapshot:async () => ({identity:null, policy:{semantic:false}})},
    operation:() => ({operationCutoffMonoNs:String(process.hrtime.bigint()+5000000000n)})});
  try {
    const payload = {...input, mode:'embeddings', budget:{...input.budget,maxUsd:'0.01'}};
    assert.deepEqual(await index.run('refreshContextIndex', payload, s.token), denied);
    assert.equal(requests.length, 1); assert.equal(requests[0].method, 'refreshContextIndex');
    absent(requests[0], s.binding, payload);
  } finally {index.close(); facade.close();}
  const f = await suppressionFixture(t), {handle,state} = await f.reader();
  const payload = {expected:f.checkpoint(0), limit:1};
  ok(await handle.listSuppressionsSince(f.service.ownerId, '0', payload, f.credential));
  assert.equal(state.requests.length, 1);
  assert.equal(state.requests[0].method, 'listSuppressionsSince');
  absent(state.requests[0], state.binding, {owner:f.service.ownerId, epoch:'0', options:payload});
  assert.deepEqual(Object.keys(state.requests[0]), [...baseKeys,'suppression']);
});

test('authority optional phase is closed; content authority bounded snapshot preserves it unchanged', () => {
  const credential = {}, binding = {ownerId:'synthetic', namespaces:{readSet:[ns]}, credentialBindingId:'synthetic', credentialDigest:credentialDigest(credential)};
  for (const phase of [undefined, null, '', 'other', 1, {}, 'admission', 'work']) {
    let request;
    const host = contentAuthorityPort({authorize(value) {request=value; return binding;}, isCurrent(_grant, value) {assert.equal(value, request); return true;}}, boundedData);
    requestAuthority(host, binding, {})('refreshContextIndex', {}, credential, phase).check();
    assert.equal('maintenancePhase' in request, phase === 'admission' || phase === 'work');
    if ('maintenancePhase' in request) {assert.equal(request.maintenancePhase, phase); assert.equal(boundedData(request).maintenancePhase, phase);}
  }
});

test('4 field-ignoring host preserves admission/work outcomes, refusals and host call counts', {timeout:60000}, async t => {
  async function sequence(baseline, refuse) {
    const s = setup(t, {baseline, refuse}), h = await s.open();
    const results = [await admitMaintenance(h,input,s.token), await refreshMaintenance(h,input,s.token)];
    const before = s.evidence.length;
    const invalid = [];
    for (const method of [admitMaintenance, refreshMaintenance]) {
      invalid.push(await method(h, {...input,maintenancePhase:'admission'}, s.token));
      invalid.push(await method(h, input, s.token, {maintenancePhase:'work'}));
    }
    for (const result of invalid) assert.deepEqual(result, {ok:false,error:{code:'invalid_input',retryable:false}});
    await assert.rejects(() => s.runtime({...s.options, maintenancePhase:'work'}), {code:'invalid_input'});
    assert.equal(s.evidence.length, before, 'unknown fields never reach a host on either runtime');
    await h.close();
    return {results, invalid, calls:s.evidence.map(e => [e.event,e.same,e.frozen])};
  }
  for (const refuse of [false,true]) {
    const current = await sequence(false, refuse), base = await sequence(true, refuse);
    assert.deepEqual(current, base);
    if (refuse) assert.deepEqual(current.results, [denied, denied]);
    else {ok(current.results[0]); ok(current.results[1]);}
  }
});

test('5 fail object identity at direct refusal, authority wrapper and Worker; fresh-error mutation is detected', {timeout:60000}, async t => {
  const script = new URL('../testing/context-maintenance-phase-identity.mjs', import.meta.url);
  const original = spawnSync(process.execPath, [script.pathname], {encoding:'utf8', env:{}, timeout:30000});
  assert.equal(original.status, 0, original.stderr);
  assert.deepEqual(JSON.parse(original.stdout), {direct:true, wrapper:true});
  const mutant = spawnSync(process.execPath, [script.pathname, 'fresh'], {encoding:'utf8', env:{}, timeout:30000});
  assert.equal(mutant.status, 1, mutant.stderr);
  assert.match(mutant.stderr, /direct refusal must throw the fail object/);
  const wrapperMutant = spawnSync(process.execPath, [script.pathname, 'fresh', 'wrapper'], {encoding:'utf8', env:{}, timeout:30000});
  assert.equal(wrapperMutant.status, 1, wrapperMutant.stderr);
  assert.match(wrapperMutant.stderr, /authority wrapper must throw the fail object/);
  for (const fresh of [false,true]) {
    const s = setup(t, {identity:true, fresh}), h = await s.open();
    assert.deepEqual(await h.getContextIndexStatus(status, s.token), denied);
    await h.close();
    const events = s.evidence.filter(e => e.event === 'refusal-identity');
    assert.equal(events.length, 1);
    if (fresh) assert.throws(() => assert.equal(events[0].same, true), {code:'ERR_ASSERTION'});
    else assert.equal(events[0].same, true, 'Worker catch must receive the fail object');
  }
});

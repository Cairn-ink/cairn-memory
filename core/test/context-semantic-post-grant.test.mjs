import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { setTimeout as delay } from 'node:timers/promises';
import { semanticPump } from '../context-semantic-pump.mjs';
import { createContextReadSupervisor } from '../context-read-supervisor.mjs';
import { credentialDigest, PRODUCT_PROFILE } from '../context-product-control.mjs';
import { semanticOutstandingStart } from '../context-semantic-client.mjs';
import { maintenanceTurnPoisoned } from '../context-maintenance-turn.mjs';
import { maintenanceAdmissionIdentity } from '../context-product-admission-policy.mjs';

const flush=async()=>{for(let i=0;i<120;i++)await Promise.resolve();};
async function bounded(promise) {
  const abort=new AbortController();
  try{return await Promise.race([promise,delay(2000,undefined,{signal:abort.signal}).then(()=>{throw Error('rendezvous timed out');})]);}
  finally{abort.abort();}
}
// Synthetic engine boundary from the post-release poison and delayed-grant
// reproductions. No native host or wall-clock scheduling chooses the outcome.
function model(t,{maxWaitMs=100}={}) {
  let time=0,serial=0,resolveProof;
  const supervisor=createContextReadSupervisor(),coordinator={},credential={opaque:'synthetic'};
  const proof=new Promise(resolve=>{resolveProof=resolve;}),calls=[],buffers=[],pumps=[];
  const readSet=[{ownerId:'turn-owner',scope:'personal',projectId:null}];
  const ownerCoverage={policy:'recent-projects-v1',selectionRevision:'synthetic',requestedNamespaces:1,selectedNamespaces:1,omittedNamespaces:0};
  const serviceBinding={kind:'service',serviceId:'synthetic',credentialBindingId:'synthetic',credentialExpiresUtcMs:null,credentialDigest:credentialDigest(credential),ownerId:readSet[0].ownerId,namespaces:{readSet,ownerCoverage},issuedAt:0};
  const options={supervisor,path:join(tmpdir(),'semantic-turn-'+randomUUID()+'.sqlite'),version:'context-read-v1',profile:PRODUCT_PROFILE,readSet,ownerCoverage,host:{moduleUrl:'file:///synthetic-host.mjs',configuration:{serviceBinding}}};
  const state={onCall:()=>{}};
  const handles=globalThis[Symbol.for('context-read-product-p2e-v1/handles')];
  handles.set(coordinator,{closed:()=>false,ownerId:readSet[0].ownerId,selection:{},ownerState:new SharedArrayBuffer(64),targets:[],validatePumpCredential(){},
    pumpTurn({semanticOutstanding}){buffers.push(semanticOutstanding);return {proof,detach(){}};},
    async pumpCall(method,input,duration,internal){
      state.onCall(method);
      calls.push({method,at:time});const view=semanticOutstandingStart(internal.semanticOutstanding);Atomics.sub(view,0,1);Atomics.notify(view,0);
      if(method==='firstCoverage')return {complete:true,pending:false,targetSetDigest:null};
      return {exhausted:true,id:'synthetic',windowId:'window',generation:0,usedItems:2048,usedMs:100,usedUsd:'0'};
    }});
  t.after(async()=>{resolveProof();for(const p of pumps)await bounded(p.close());await bounded(supervisor.close());handles.delete(coordinator);});
  function make(enter=()=> 'admitted') {
    const timers=new Map(),releases=[];
    const preQuantum={version:1,maxWaitMs,createTurn(){return {enter,release(...args){releases.push(args);}};}};
    const config={supervisor,id:randomUUID(),window:{id:'window',endsAtMonoMs:60000,usedItems:0,usedMs:0,usedUsd:'0'},budgets:{maxItems:2048,maxMs:60000,maxUsd:'0.5'},quantum:{maxItems:32,maxMs:100,maxUsd:'0.01'},pollMs:25,renewalMs:60000,projections:[{options,types:['memory']}],serviceCredential:credential,semanticServiceCredential:credential,semanticConfig:{version:'context-read-product-p2e-v1',coordinator},firstCoverageValidation:{maxTargets:1,maxMs:100},preQuantum};
    const pump=semanticPump(config,{now:()=>time,setTimer(fn,ms){const id=++serial;timers.set(id,{fn,at:time+ms});return id;},clearTimer:id=>timers.delete(id),snapshot(){},open(){throw Error('unexpected reader opening');}});
    pumps.push(pump);
    return {pump,releases,async fire(){const [id,timer]=[...timers].sort((a,b)=>a[1].at-b[1].at)[0];timers.delete(id);time=Math.max(time,timer.at);return bounded(timer.fn());}};
  }
  return Object.assign(state,{make,calls,buffers,options,set:n=>{time=n;}});
}

test('queued successor declines a grant after a released turn poisons its identity',async t=>{
  const s=model(t,{maxWaitMs:2000}),first=s.make();await first.fire();
  assert.deepEqual(first.releases,[['settled']]);await bounded(first.pump.close());
  let grant;
  const second=s.make(()=>new Promise(resolve=>{grant=resolve;})),running=second.fire();await flush();assert.equal(typeof grant,'function');
  assert.throws(()=>semanticOutstandingStart(s.buffers[0]),{code:'reader_failed'});
  await bounded((async()=>{for(let i=0;i<100;i++){if(maintenanceTurnPoisoned(maintenanceAdmissionIdentity(s.options)))return;await delay(1);}throw Error('poison was not observed');})());
  const before=s.calls.length;grant('admitted');await running;await flush();
  assert.deepEqual(s.calls.slice(before),[],'no firstCoverage or pumpReserve after poison');
  assert.deepEqual(second.releases,[['declined','stopped']]);assert.equal(second.pump.getStatus().error,'reader_failed');
});

for(const offset of [1,0])test('fresh admission deadline declines delayed continuation at offset '+offset,async t=>{
  const s=model(t);let deadline;
  const p=s.make(({untilMonoMs})=>{
    deadline=untilMonoMs;
    // The controller completes the grant before this second microtask, while
    // the pump continuation resumes after it. Its captured waitExpired=false.
    queueMicrotask(()=>queueMicrotask(()=>s.set(deadline+offset)));
    return Promise.resolve('admitted');
  });
  await p.fire();await flush();assert.equal(Number.isFinite(deadline),true);
  assert.deepEqual(s.calls,[],'admission equality and overrun start no quantum');
  assert.deepEqual(p.releases,[['declined','wait_expired']]);assert.equal(p.pump.getStatus().error,null);
  assert.equal(p.pump.getStatus().usedMs,0);
});

test('renewal expiry precedes wait expiry when both apply to a grant',async t=>{
  const s=model(t),p=s.make(()=>{s.set(60001);return Promise.resolve('admitted');});
  await p.fire();assert.deepEqual(s.calls,[]);assert.deepEqual(p.releases,[['declined','renewal_expired']]);
});

test('admission expiry after quantum start permits its settlement and release',async t=>{
  const s=model(t,{maxWaitMs:1});let deadline;
  const p=s.make(({untilMonoMs})=>{deadline=untilMonoMs;return 'admitted';});
  s.onCall=method=>{if(method==='firstCoverage')s.set(deadline+1);};
  await p.fire();
  assert.deepEqual(s.calls.map(c=>c.method),['firstCoverage','pumpReserve']);
  assert.ok(s.calls.every(c=>c.at>deadline));
  assert.deepEqual(p.releases,[['settled']]);assert.equal(p.pump.getStatus().error,null);
});

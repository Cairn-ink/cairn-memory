import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { syncBuiltinESMExports } from 'node:module';
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
  const state={onCall:()=>{},onNow:n=>n};
  const handles=globalThis[Symbol.for('context-read-product-p2e-v1/handles')];
  handles.set(coordinator,{closed:()=>false,ownerId:readSet[0].ownerId,selection:{},ownerState:new SharedArrayBuffer(64),targets:[],validatePumpCredential(){},
    pumpTurn({semanticOutstanding}){buffers.push(semanticOutstanding);return {proof,detach(){}};},
    async pumpCall(method,input,duration,internal){
      state.onCall(method);
      calls.push({method,at:time});const view=semanticOutstandingStart(internal.semanticOutstanding);Atomics.sub(view,0,1);Atomics.notify(view,0);
      if(method==='firstCoverage')return {complete:true,pending:false,targetSetDigest:null};
      return {exhausted:true,id:'synthetic',windowId:'window',generation:0,usedItems:2048,usedMs:100,usedUsd:'0'};
    }});
  t.after(async()=>{resolveProof();for(const p of pumps)await bounded(p.close()).catch(()=>{});await bounded(supervisor.close());handles.delete(coordinator);});
  function make(enter=()=> 'admitted',onRelease=()=>{}) {
    const timers=new Map(),releases=[];
    const preQuantum={version:1,maxWaitMs,createTurn(){return {enter,release(...args){releases.push(args);onRelease(...args);}};}};
    const config={supervisor,id:randomUUID(),window:{id:'window',endsAtMonoMs:60000,usedItems:0,usedMs:0,usedUsd:'0'},budgets:{maxItems:2048,maxMs:60000,maxUsd:'0.5'},quantum:{maxItems:32,maxMs:100,maxUsd:'0.01'},pollMs:25,renewalMs:60000,projections:[{options,types:['memory']}],serviceCredential:credential,semanticServiceCredential:credential,semanticConfig:{version:'context-read-product-p2e-v1',coordinator},firstCoverageValidation:{maxTargets:1,maxMs:100},preQuantum};
    const pump=semanticPump(config,{now:()=>state.onNow(time),setTimer(fn,ms){const id=++serial;timers.set(id,{fn,at:time+ms});return id;},clearTimer:id=>timers.delete(id),snapshot(){},open(){throw Error('unexpected reader opening');}});
    pumps.push(pump);
    return {pump,releases,preQuantum,config,async fire(){const [id,timer]=[...timers].sort((a,b)=>a[1].at-b[1].at)[0];timers.delete(id);time=Math.max(time,timer.at);return bounded(timer.fn());}};
  }
  return Object.assign(state,{make,calls,buffers,options,set:n=>{time=n;}});
}


const poisonKey=Symbol.for('context-read/maintenance-turn-poison/v1');
function poisonGate(t,callback){
  const state=globalThis[poisonKey]??={ports:new WeakSet(),locations:new Set(),physical:new Set()};
  const locations=state.locations;
  // Nonempty but unmatched, allowing an adversarial has() without a real poison.
  const fake=new Set(['unmatched-poison-marker']);fake.has=value=>callback(value);
  state.locations=fake;t.after(()=>{state.locations=locations;});
}
async function failedOnce(t,s,p,closing){
  await bounded(closing);await bounded(p.pump.close());await bounded(p.pump.close());
  const completion=await bounded(p.pump.completion);
  assert.equal(completion.state,'failed');assert.equal(completion.error,'reader_failed');
  assert.deepEqual(p.releases,[['withdrawn']]);
  assert.deepEqual(s.calls,[]);assert.deepEqual(s.buffers,[]);
  assert.equal(p.pump.getStatus().usedMs,0);
  t.diagnostic(JSON.stringify({releases:p.releases,calls:s.calls,buffers:s.buffers.length,error:completion.error}));
}
for(const race of ['none','before-catch','release-reentry','microtask-close'])
test('poison check itself throws; close race '+race,async t=>{
  let armed=false,closing,p,throws=0;
  poisonGate(t,()=>{
    if(!armed)return false;
    armed=false;throws++;
    if(race==='before-catch')closing=p.pump.close();
    if(race==='microtask-close')queueMicrotask(()=>{closing=p.pump.close();});
    throw Error('synthetic poison has failure');
  });
  const s=model(t);p=s.make(()=>{armed=true;return 'admitted';},()=>{
    if(race==='release-reentry')closing=p.pump.close();
  });
  await bounded(p.fire());assert.equal(throws,1);
  await failedOnce(t,s,p,closing);
});
for(const race of ['none','before-catch','release-reentry'])
test('throw after fresh clock sample; close race '+race,async t=>{
  let armed=false,postPoison=false,injected=false,closing,p;const trace=[];
  poisonGate(t,()=>{if(armed){armed=false;postPoison=true;}return false;});
  const s=model(t);p=s.make(()=>{armed=true;return 'admitted';},()=>{
    trace.push('release');if(race==='release-reentry')closing=p.pump.close();
  });
  s.onNow=n=>{
    if(!postPoison||injected)return n;
    injected=true;trace.push('sample-return');
    return {[Symbol.toPrimitive](){
      trace.push('comparison-throw');
      if(race==='before-catch')closing=p.pump.close();
      throw Error('synthetic post-sample comparison failure');
    }};
  };
  await bounded(p.fire());assert.equal(injected,true);
  assert.deepEqual(trace,['sample-return','comparison-throw','release']);
  await failedOnce(t,s,p,closing);
});
test('clock sample itself throws once and release reenters close',async t=>{
  let armed=false,postPoison=false,injected=false,closing,p;
  poisonGate(t,()=>{if(armed){armed=false;postPoison=true;}return false;});
  const s=model(t);p=s.make(()=>{armed=true;return 'admitted';},()=>{closing=p.pump.close();});
  s.onNow=n=>{if(postPoison&&!injected){injected=true;throw Error('clock failed');}return n;};
  await bounded(p.fire());assert.equal(injected,true);await failedOnce(t,s,p,closing);
});
test('identity binding throws and release reenters close',async t=>{
  let armed=false,injected=false,closing,p;
  const push=Array.prototype.push;
  t.after(()=>{Array.prototype.push=push;});
  const s=model(t);p=s.make(()=>{
    armed=true;
    Array.prototype.push=function(...items){
      if(armed&&items.length===1&&items[0]&&typeof items[0]==='object'&&
          Object.hasOwn(items[0],'key')&&Object.hasOwn(items[0],'physical')){
        armed=false;injected=true;throw Error('synthetic identity binding failure');
      }
      return Reflect.apply(push,this,items);
    };
    return 'admitted';
  },()=>{closing=p.pump.close();});
  try{await bounded(p.fire());}finally{armed=false;Array.prototype.push=push;}
  assert.equal(injected,true);await failedOnce(t,s,p,closing);
});
for(const expired of [false,true])test('wait-expiry vs changed port precedence '+expired,async t=>{
  const s=model(t);let deadline;
  const p=s.make(({untilMonoMs})=>{
    deadline=untilMonoMs;
    queueMicrotask(()=>{p.preQuantum.createTurn=()=>{throw Error('changed authority');};if(expired)s.set(deadline);});
    return 'admitted';
  });
  await bounded(p.fire());await bounded(p.pump.close());
  assert.deepEqual(p.releases,expired?[['declined','wait_expired']]:[['withdrawn']]);
  assert.equal(p.pump.getStatus().error,'authority_required');
  assert.deepEqual(s.calls,[]);assert.deepEqual(s.buffers,[]);
});
for(const expiry of ['future','equal','past'])test('one identity and no metadata after sample '+expiry,async t=>{
  const original=fs.lstatSync;let postGrant=false,lookups=0,s,deadline,sampleSeen=false;const trace=[];
  fs.lstatSync=(...args)=>{
    if(postGrant){lookups++;trace.push('stat');assert.equal(sampleSeen,false,'filesystem after sample');}
    return original(...args);
  };syncBuiltinESMExports();
  t.after(()=>{fs.lstatSync=original;syncBuiltinESMExports();});
  let armed=false;
  poisonGate(t,()=>{if(armed){armed=false;s.onNow=n=>{sampleSeen=true;trace.push('sample');s.onNow=x=>x;return n;};}return false;});
  s=model(t);const p=s.make(({untilMonoMs})=>{
    deadline=untilMonoMs;queueMicrotask(()=>{postGrant=true;armed=true;s.set(deadline+(expiry==='future'?-1:expiry==='equal'?0:1));});return 'admitted';
  });
  try{await bounded(p.fire());}finally{postGrant=false;}
  assert.equal(lookups,2);assert.deepEqual(trace,['stat','stat','sample']);
  assert.deepEqual(p.releases,expiry==='future'?[['settled']]:[['declined','wait_expired']]);
  assert.equal(s.buffers.length,expiry==='future'?1:0);
  assert.equal(p.pump.getStatus().error,null);
});

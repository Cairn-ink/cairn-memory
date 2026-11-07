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
  const state={onCall:()=>{},onNow:n=>n,onTimer:()=>{}};
  const handles=globalThis[Symbol.for('context-read-product-p2e-v1/handles')];
  handles.set(coordinator,{closed:()=>false,ownerId:readSet[0].ownerId,selection:{},ownerState:new SharedArrayBuffer(64),targets:[],validatePumpCredential(){},
    pumpTurn({semanticOutstanding}){buffers.push(semanticOutstanding);return {proof,detach(){}};},
    async pumpCall(method,input,duration,internal){
      state.onCall(method);
      calls.push({method,at:time});const view=semanticOutstandingStart(internal.semanticOutstanding);Atomics.sub(view,0,1);Atomics.notify(view,0);
      if(method==='firstCoverage')return {complete:true,pending:false,targetSetDigest:null};
      return {exhausted:true,id:'synthetic',windowId:'window',generation:0,usedItems:2048,usedMs:100,usedUsd:'0'};
    }});
  state.handle=handles.get(coordinator);
  t.after(async()=>{resolveProof();for(const p of pumps)await bounded(p.close()).catch(()=>{});await bounded(supervisor.close());handles.delete(coordinator);});
  function make(enter=()=> 'admitted',onRelease=()=>{}) {
    const timers=new Map(),releases=[];
    const preQuantum={version:1,maxWaitMs,createTurn(){return {enter,release(...args){releases.push(args);onRelease(...args);}};}};
    const config={supervisor,id:randomUUID(),window:{id:'window',endsAtMonoMs:60000,usedItems:0,usedMs:0,usedUsd:'0'},budgets:{maxItems:2048,maxMs:60000,maxUsd:'0.5'},quantum:{maxItems:32,maxMs:100,maxUsd:'0.01'},pollMs:25,renewalMs:60000,projections:[{options,types:['memory']}],serviceCredential:credential,semanticServiceCredential:credential,semanticConfig:{version:'context-read-product-p2e-v1',coordinator},firstCoverageValidation:{maxTargets:1,maxMs:100},preQuantum};
    const pump=semanticPump(config,{now:()=>state.onNow(time),setTimer(fn,ms){state.onTimer(ms);const id=++serial;timers.set(id,{fn,at:time+ms});return id;},clearTimer:id=>timers.delete(id),snapshot(){},open(){throw Error('unexpected reader opening');}});
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
for(const location of ['expiry-bookkeeping','before-start'])test('clock throws after sample at '+location,async t=>{
  let armed=false,postPoison=false,reads=0,injected=false,p,deadline;
  poisonGate(t,()=>{if(armed){armed=false;postPoison=true;}return false;});
  const s=model(t);p=s.make(({untilMonoMs})=>{
    deadline=untilMonoMs;
    queueMicrotask(()=>{armed=true;if(location==='expiry-bookkeeping')s.set(deadline);});
    return 'admitted';
  });
  s.onNow=n=>{
    if(postPoison&&++reads===2){injected=true;throw Error('synthetic clock read after admission sample');}
    return n;
  };
  const outcome=await p.fire().then(()=> 'resolved',()=> 'rejected');
  s.onNow=n=>n;
  const beforeClose=p.pump.getStatus();
  if(outcome==='rejected')await bounded(p.pump.close()).catch(()=>{});
  t.diagnostic(JSON.stringify({location,outcome,releases:p.releases,calls:s.calls,buffers:s.buffers.length,beforeClose,status:p.pump.getStatus()}));
  assert.equal(injected,true);assert.equal(outcome,'resolved','owned unstarted ticket must enter terminal failure handler');
  await failedOnce(t,s,p);
});

for(const fault of ['context-clock','ordinal','join','proof','watchdog'])
test('dispatch setup failure before ticket handoff: '+fault,async t=>{
  let armed=false,postPoison=false,reads=0,injected=false,closing,p,detached=0;
  poisonGate(t,()=>{if(armed){armed=false;postPoison=true;}return false;});
  const s=model(t),originalJoin=s.handle.pumpTurn;
  const ordinal=globalThis[Symbol.for('context-read-product/maintenance-dispatch-ordinal')];
  const descriptor=Object.getOwnPropertyDescriptor(ordinal,'next');
  const inject=()=>{injected=true;throw Error('synthetic dispatch setup failure');};
  p=s.make(()=>{queueMicrotask(()=>{
    armed=true;
    if(fault==='ordinal')Object.defineProperty(ordinal,'next',{configurable:true,get:inject});
    if(fault==='join')s.handle.pumpTurn=inject;
    if(fault==='proof')s.handle.pumpTurn=()=>({get proof(){return inject();},detach(){detached++;}});
  });return 'admitted';},()=>{closing=p.pump.close();});
  s.onNow=n=>{if(postPoison&&++reads===3&&fault==='context-clock')inject();return n;};
  s.onTimer=()=>{if(postPoison&&fault==='watchdog')inject();};
  if(fault==='watchdog')s.handle.pumpTurn=input=>{
    const join=originalJoin(input);return {...join,detach(){detached++;join.detach();}};
  };
  let outcome;
  try{outcome=await p.fire().then(()=> 'resolved',()=> 'rejected');}
  finally{
    s.onNow=n=>n;s.onTimer=()=>{};s.handle.pumpTurn=originalJoin;
    if(fault==='ordinal')Object.defineProperty(ordinal,'next',descriptor);
  }
  assert.equal(injected,true);assert.equal(outcome,'resolved');
  await bounded(closing);await bounded(p.pump.close());
  const completion=await bounded(p.pump.completion);
  assert.equal(completion.state,'failed');assert.equal(completion.error,'reader_failed');
  assert.deepEqual(p.releases,[['withdrawn']]);assert.deepEqual(s.calls,[]);
  assert.equal(completion.usedMs,0);
  if(fault==='proof'||fault==='watchdog')assert.equal(detached,1,'partial setup detaches its coordinator join');
});

test('failure after ticket handoff uses quantum settlement',async t=>{
  const s=model(t),p=s.make();
  s.onCall=()=>{throw Object.assign(Error('synthetic work failure'),{code:'reader_failed'});};
  await p.fire();await bounded(p.pump.close());
  const completion=await bounded(p.pump.completion);
  assert.equal(completion.error,'reader_failed');assert.deepEqual(p.releases,[['settled']]);
  assert.equal(s.buffers.length,1);
});

for(const read of [1,2,3])test('precedence clock failure at post-grant read '+read,async t=>{
  let armed=false,reads=0,injected=false,closing,p;
  const s=model(t);
  p=s.make(()=>{queueMicrotask(()=>{armed=true;});return 'admitted';},()=>{closing=p.pump.close();});
  s.onNow=n=>{if(armed&&++reads===read){armed=false;injected=true;throw Error('synthetic precedence clock failure');}return n;};
  try{await p.fire();}finally{s.onNow=n=>n;}
  assert.equal(injected,true);await failedOnce(t,s,p,closing);
});

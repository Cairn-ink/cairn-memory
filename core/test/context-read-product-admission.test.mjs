import { testClock } from '../testing/context-product-test-clock.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { createMaintenancePumpRuntime, maintenancePumpDiagnostic, maintenancePumpPhaseDiagnostic } from '../context-product-pump.mjs';
import { openContextIndexMaintainer, maintenanceObservation, maintenancePhaseDiagnostic } from '../context-product-reader.mjs';
import { createContextReadSupervisor } from '../context-read-supervisor.mjs';
import { credentialDigest } from '../context-product-control.mjs';
import { maintenanceQuantum } from '../context-product-quantum.mjs';
import { fixture, ns, ok } from '../testing/context-read-fixture.mjs';
import { configured } from '../testing/context-product-owner-fixture.mjs';
// Baseline discrimination reaches assertions even before the private protocol exists.
const protocol=await import('../context-product-admission.mjs').catch(()=>({}));
const policy=await import('../context-product-admission-policy.mjs').catch(()=>({}));

async function isolatedAdmissionDomains(run){
  const key=Symbol.for('context-read-product/admission-domains'),previous=globalThis[key];
  delete globalThis[key];
  try {await run(()=>globalThis[key]);}
  finally {if(previous===undefined)delete globalThis[key];else globalThis[key]=previous;}
}
const admissionIdentity=()=>{const key=randomUUID();return {key,physical:key,cache:'unchanged'};};
function assertAdmissionIndexes(all){
  const located=new Set(all.locations.values()),physical=new Set(all.physical.values());
  assert.ok([...physical].every(domain=>located.has(domain)),'physical aliases have a location');
  assert.equal(all.capacityCount,[...located].reduce((n,domain)=>n+domain.capacities.size,0));
  assert.equal(all.progressCount,[...located].reduce((n,domain)=>n+domain.noProgress.size,0));
  assert.ok(all.progressCount<=1024);
  assert.ok(all.locations.size<=1024);assert.ok(all.capacityCount<=1024);
  for(const domain of located)for(const state of domain.capacities.values())assert.equal(state.domain,domain);
}

function model(t,{q=1000,poll=25,openMs=330,admitMs=120,workMs=10,deliveryMs=0,settleMs=0,disposeMs=0,failProof=false}={}){
  let time=0,serial=0,observation,settlementPending=false,heldAdmission;
  const timers=new Map(),events=[],receipts=new WeakMap(),handles=[],domain=randomUUID();
  const supervisor=createContextReadSupervisor();t.after(()=>supervisor.close().catch(()=>{}));
  const credential={opaque:randomUUID()},readSet=[{ownerId:'synthetic-admission',scope:'personal',projectId:null}],
    ownerCoverage={policy:'recent-projects-v1',selectionRevision:'fixture',requestedNamespaces:1,selectedNamespaces:1,omittedNamespaces:0};
  const serviceBinding={kind:'service',serviceId:'synthetic',credentialBindingId:'binding',credentialExpiresUtcMs:null,
    credentialDigest:credentialDigest(credential),ownerId:readSet[0].ownerId,namespaces:{readSet,ownerCoverage},issuedAt:0};
  const options={supervisor,path:'/synthetic-admission-'+domain+'.sqlite',readSet,ownerCoverage,
    host:{moduleUrl:'file:///synthetic-admission.mjs',configuration:{serviceBinding}}};
  const config={supervisor,id:randomUUID(),serviceCredential:credential,
    window:{id:'first',endsAtMonoMs:60000,usedItems:0,usedMs:0},budgets:{maxItems:2048,maxMs:60000},
    quantum:{maxItems:32,maxMs:q},pollMs:poll,renewalMs:20000,projections:[{options,types:['memory']}]};
  const receipt=kind=>{const r={ok:true,value:null};receipts.set(r,kind);return r;};
  const deps={now:()=>{if(settlementPending){settlementPending=false;time+=settleMs;}return time;},
    setTimer:(fn,ms)=>{const id=++serial;timers.set(id,{fn,at:time+ms});return id;},clearTimer:id=>timers.delete(id),
    admissionIdentity:()=>({key:domain,cache:'unchanged'}),receiptOf:r=>receipts.get(r),observedAt:()=>observation,
    phasesOf:()=>{settlementPending=true;return {deliveryMs};},
    open:async opts=>{events.push({kind:'open',at:time,budget:opts.deadlineMs});time+=openMs;
      const h={fresh:true,async refreshContextIndex(input){return deps.work(h,input);},async close(){events.push({kind:'close',at:time});time+=disposeMs;if(failProof)throw Error('unproven disposal');}};handles.push(h);return h;},
    admit:async (h,input)=>{events.push({kind:'admission',at:time,budget:input.budget.maxMs,intent:input.intent});
      if(heldAdmission)await heldAdmission;
      time+=admitMs+deliveryMs;h.fresh=false;return receipt('admitted');},
    work:async (h,input)=>{events.push({kind:'work',at:time,budget:input.budget.maxMs,intent:input.intent});
      const cutoff=time+input.budget.maxMs;
      if(h.fresh){
        if(typeof protocol.refreshMaintenance==='function')return receipt('required');
        // Baseline-only model: public refresh used to pay fresh admission here.
        events.push({kind:'admission',at:time,budget:input.budget.maxMs,intent:input.intent});time+=admitMs;h.fresh=false;
      }
      if(typeof workMs==='function')workMs({input,cutoff,now:()=>time,spend:n=>{time+=n;}});else time+=workMs;
      observation=time;time+=deliveryMs;return {ok:true,value:{status:'complete',progress:{transformed:1}}};}};
  const renew=createMaintenancePumpRuntime(deps);
  return {config,renew,events,timers,handles,deps,now:()=>time,set:n=>{time=n;},spend:n=>{time+=n;},
    hold:p=>{heldAdmission=p;},async next(){const [id,timer]=[...timers].sort((a,b)=>a[1].at-b[1].at)[0]??[];
      assert.ok(timer,'scheduled turn');timers.delete(id);time=Math.max(time,timer.at);await timer.fn();}};
}

test('admission first turn: zero work, zero observation, original cutoff and exact zero-item settlement',async t=>{
  const s=model(t,{openMs:330,admitMs:120,deliveryMs:0,settleMs:7}),p=s.renew(s.config);t.after(()=>p.close());
  await s.next();const status=p.getStatus(),lane=maintenancePumpPhaseDiagnostic(status).projections[0];
  assert.equal(s.events.filter(e=>e.kind==='work').length,0,'cold turn must not refresh');
  assert.deepEqual(s.events.map(e=>e.kind),['open','admission']);
  assert.equal(s.events[1].budget,670,'admission gets only the remaining original cutoff');
  assert.equal(status.usedItems,0);assert.equal(status.usedMs,457,'includes pump settlement');
  assert.equal(maintenancePumpDiagnostic(status).observation,null,'admission is no observation');
  assert.equal(Object.isFrozen(maintenancePumpDiagnostic(status).admission),true);
  assert.equal(lane.first.number,0);assert.equal(lane.first.turn,'admission');assert.equal(lane.first.elapsedMs,457);
  assert.equal(lane.phases.refreshCall.count,0);assert.equal(lane.phases.epochObservation.count,0);
  assert.equal(lane.phases.open.count,1);assert.equal(lane.phases.admission.count,1);
  await s.next();assert.equal(s.events.at(-1).intent,'current');assert.equal(s.events.at(-1).budget,1000);
  assert.equal(maintenancePumpDiagnostic(p.getStatus()).observation.projection,0);
});

test('admission accounting includes delivery and settlement once; a settlement overrun has no refund',async t=>{
  for(const [settleMs,expected] of [[7,480],[528,1000]]){
    const s=model(t,{deliveryMs:23,settleMs}),p=s.renew(s.config);t.after(()=>p.close().catch(()=>{}));await s.next();
    assert.equal(p.getStatus().usedMs,expected);
    if(settleMs===7){assert.equal(p.getStatus().usedItems,0);assert.equal(p.getStatus().error,null);}
    else {assert.equal(p.getStatus().usedItems,32);assert.equal(maintenancePumpDiagnostic(p.getStatus()).lastFailure.cause,'open_exceeds_quantum');}
  }
});

test('uncertain admission receipt retains the full reservation without inventing an observation',async t=>{
  const s=model(t);s.deps.admit=async()=>({ok:true,value:null});
  const p=createMaintenancePumpRuntime(s.deps)(s.config);await s.next();await p.completion;
  assert.equal(p.getStatus().usedMs,1000);assert.equal(p.getStatus().usedItems,32);assert.equal(p.getStatus().error,'reader_failed');
  assert.equal(maintenancePumpDiagnostic(p.getStatus()).observation,null);await p.close();
});

test('resident sidecar discard yields before any fresh admission, advances fairly, then works',async t=>{
  const s=model(t),p=s.renew(s.config);t.after(()=>p.close());
  await s.next();await s.next();s.handles[0].fresh=true;
  await s.next();assert.equal(s.events.at(-1).kind,'work');assert.equal(s.events.at(-1).intent,'history');
  const previous=maintenancePumpDiagnostic(p.getStatus()).observation;
  await s.next();assert.equal(s.events.at(-1).kind,'admission');assert.equal(s.events.at(-1).intent,'current');
  assert.deepEqual(maintenancePumpDiagnostic(p.getStatus()).observation,previous);
  await s.next();assert.equal(s.events.at(-1).kind,'work');assert.equal(s.events.at(-1).intent,'current');
  await s.next();assert.equal(s.events.at(-1).intent,'history');
  assert.equal(maintenancePumpDiagnostic(p.getStatus()).admission[1],null,'accepted history observation resets its count');
  assert.equal(s.handles.length,1);
});

test('over-budget admission keeps charge, drains before retries, and holds across IDs, windows and selections',async t=>{
  const s=model(t,{admitMs:701,disposeMs:9}),p=s.renew(s.config);t.after(()=>p.close());
  await s.next();let d=maintenancePumpDiagnostic(p.getStatus());
  assert.equal(d.lastFailure.cause,'open_exceeds_quantum');assert.equal(d.observation,null);
  assert.equal(p.getStatus().usedItems,32);assert.equal(p.getStatus().usedMs,1000);
  assert.equal(d.admission[0].attempts,1);assert.equal(d.admission[0].retryAtMonoMs,s.now()+5000);
  assert.deepEqual(s.events.map(e=>e.kind),['open','admission','close']);
  await p.close();
  let config={...s.config,id:randomUUID()};let next=s.renew(config);t.after(()=>next.close());
  assert.equal(s.handles.length,1,'new ID does not recharge admission');await s.next();
  d=maintenancePumpDiagnostic(next.getStatus());assert.equal(d.admission[0].attempts,2);
  assert.equal(d.admission[0].retryAtMonoMs,s.now()+30000);
  await next.close();s.set(60000);config={...config,id:randomUUID(),window:{...config.window,id:'second',endsAtMonoMs:120000}};
  next=s.renew(config);await s.next();d=maintenancePumpDiagnostic(next.getStatus());
  assert.equal(d.admission[0].state,'held');assert.equal(d.admission[0].cause,'open_exceeds_quantum');assert.equal(d.admission[0].attempts,3);
  assert.equal(s.handles.length,3,'initial plus two bounded retries');
  await next.close();next=s.renew({...config,id:randomUUID(),projections:[{...config.projections[0],types:['memory','card']}]});
  assert.equal(maintenancePumpDiagnostic(next.getStatus()).admission[0].state,'held');
  await s.next();assert.equal(s.handles.length,3);assert.equal(maintenancePumpDiagnostic(next.getStatus()).observation,null);
  await next.close();
  const original=config.projections[0].options,readSet=original.readSet.map(ns=>({...ns,ownerId:'synthetic-other-owner'}));
  const binding=original.host.configuration.serviceBinding;
  const changedOwner={...original,readSet,host:{...original.host,configuration:{serviceBinding:{...binding,ownerId:readSet[0].ownerId,namespaces:{...binding.namespaces,readSet}}}}};
  next=s.renew({...config,id:randomUUID(),projections:[{options:changedOwner,types:['memory']}]});
  assert.equal(maintenancePumpDiagnostic(next.getStatus()).admission[0].state,'held','owner changes do not recharge physical admission');
  assert.equal(s.handles.length,3);await next.close();
  next=s.renew({...config,id:randomUUID(),quantum:{...config.quantum,maxMs:1250}});await s.next();
  assert.equal(s.handles.length,4,'meaningful capacity change admits again');assert.equal(next.getStatus().usedItems,32);
});

test('unproven admission disposal is quarantined and cannot retry after a capacity change',async t=>{
  const s=model(t,{admitMs:701,failProof:true}),p=s.renew(s.config);await s.next();await p.completion;
  const d=maintenancePumpDiagnostic(p.getStatus());assert.equal(d.admission[0].state,'quarantined');
  assert.equal(d.admission[0].attempts,1);assert.equal(p.getStatus().error,'reader_failed');
  await p.close().catch(()=>{});
  const next=s.renew({...s.config,id:randomUUID(),quantum:{maxItems:32,maxMs:1250}});t.after(()=>next.close());
  await s.next();assert.equal(s.handles.length,1,'a simulated stuck native resource is never called reaped');
});

test('admission watchdog starts disposal immediately and blocks replacement until proof',async t=>{
  assert.equal(typeof protocol.admitMaintenance,'function','private admission dispatch exists');
  let release,entered;const admitted=new Promise(resolve=>{entered=resolve;});
  const s=model(t,{openMs:0,admitMs:0});let proof;
  const disposal=new Promise(resolve=>{proof=resolve;});
  s.deps.admit=async()=>{entered();await new Promise(resolve=>{release=resolve;});return {ok:false,error:{code:'read_timeout'}};};
  s.deps.open=async()=>({close:async()=>{s.events.push({kind:'disposing'});await disposal;}});
  // Dependencies are captured at runtime creation; install an explicit model runtime.
  const p=createMaintenancePumpRuntime(s.deps)(s.config),pending=s.next();await admitted;
  try {
    const [id,timer]=[...s.timers][0];s.timers.delete(id);s.set(timer.at);timer.fn();
    assert.equal(s.events.at(-1).kind,'disposing');assert.equal(maintenancePumpDiagnostic(p.getStatus()).admission[0].state,'disposing');
    release();await Promise.resolve();assert.equal(maintenancePumpDiagnostic(p.getStatus()).admission[0].attempts,0);
    proof();await pending;assert.equal(maintenancePumpDiagnostic(p.getStatus()).admission[0].attempts,1);
  } finally {release();proof();await pending;await p.close();}
});

test('real quantum cycle model: split admission breaks the 330 + 120 + work + 140 renewal cycle',async t=>{
  function units({now,spend,maxMs,cutoff}){
    const quantum=maintenanceQuantum({now,cutoff,maxMs});let count=0;
    while(quantum.admit('copy-verification')){quantum.measure(()=>spend(10),'copy-verification');count++;}
    spend(140);return count;
  }
  let oldTime=330;oldTime+=120;
  const oldCount=units({now:()=>oldTime,spend:n=>{oldTime+=n;},maxMs:670,cutoff:1000});
  assert.equal(oldTime,1020,'old first quantum overruns with the real static reserve');assert.ok(oldCount>0);
  let useful=0;
  const s=model(t,{workMs:({input,cutoff,now,spend})=>{useful+=units({now,spend,maxMs:input.budget.maxMs,cutoff});}}),p=s.renew(s.config);t.after(()=>p.close());
  for(let n=0;n<48;n++){
    if(n===18||n===36)s.renew(s.config);
    await s.next();assert.equal(p.getStatus().error,null);
    const lanes=maintenancePumpPhaseDiagnostic(p.getStatus()).projections;
    assert.ok(lanes.every(l=>l.worstElapsedMs<=1000));
  }
  assert.ok(useful>1000);assert.equal(s.handles.length,1);
  s.set(55000);s.renew(s.config);s.set(60000);s.renew({...s.config,window:{...s.config.window,id:'next',endsAtMonoMs:120000}});await s.next();
  assert.equal(s.handles.length,1,'continuous window handoff retains admitted resident');
  assert.equal(s.events.filter(e=>e.kind==='admission').length,1,'no admission-only livelock');
});

for(const [q,accepted] of [[1000,true],[1250,true],[1251,false],[1500,false],[1600,false]])
test(`cold cadence matrix C=1 Q=${q} ${accepted?'accepted':'refused'}`,async t=>{
  const s=model(t,{q,poll:25,openMs:0,admitMs:0,workMs:0});
  if(!accepted){assert.throws(()=>s.renew(s.config),{code:'invalid_input'});assert.equal(s.events.length,0);return;}
  const p=s.renew(s.config);t.after(()=>p.close());for(let n=0;n<8;n++)await s.next();
  assert.equal(maintenancePumpDiagnostic(p.getStatus()).cadenceMisses,0);
  assert.equal(s.events.filter(e=>e.kind==='admission').length,1);
});

test('sweep slot derivation covers warm, distinct residents and incompatible writer rotations',()=>{
  assert.equal(policy.maintenanceAdmissionSlots?.([],[]),0);
  assert.equal(policy.maintenanceAdmissionSlots?.(['a','a'],['x','x'],new Map([['x','a']])),0,'warm sweep has no non-observing slot');
  assert.equal(policy.maintenanceAdmissionFits?.(2,0,1666,1666),true);
  assert.equal(policy.maintenanceAdmissionFits?.(2,1,1666,1666),false);
  assert.equal(policy.maintenanceAdmissionFits?.(4,2,700,700),true);
  assert.equal(policy.maintenanceAdmissionFits?.(4,2,715,715),false);
  assert.equal(policy.maintenanceAdmissionSlots?.(['a','a'],['x','x']),1);
  assert.equal(policy.maintenanceAdmissionSlots?.(['a','a','b','b'],['x','x','y','y']),2);
  assert.equal(policy.maintenanceAdmissionSlots?.(['a','a','b','b'],['x','x','x','x']),3);
});

test('pending lane survives incompatible round robin; every opened resident actually works',async t=>{
  const s=model(t,{q:500,openMs:0,admitMs:0,workMs:0});
  s.config.projections.push({...s.config.projections[0],options:{...s.config.projections[0].options,diagnostics:true}});
  const p=s.renew(s.config);t.after(()=>p.close());for(let n=0;n<12;n++)await s.next();
  assert.deepEqual(s.events.filter(e=>e.kind==='work').map(e=>e.intent),['current','history','current','history','current','history','current','history']);
  assert.equal(s.events.filter(e=>e.kind==='admission').length,4);
  assert.equal(maintenancePumpDiagnostic(p.getStatus()).cadenceMisses,0);
});

test('admission completion retains missed flags; delayed timers and prompt handoff keep duty',async t=>{
  const s=model(t,{openMs:0,admitMs:100}),p=s.renew(s.config);t.after(()=>p.close());s.set(6000);await s.next();
  let d=maintenancePumpDiagnostic(p.getStatus());assert.equal(d.cadenceMisses,2);assert.equal(d.observation,null);
  s.renew(s.config);await s.next();d=maintenancePumpDiagnostic(p.getStatus());
  assert.equal(d.observation.cadenceMiss,true);assert.equal(d.observation.gapMs,s.now());
  assert.equal(d.cadenceMisses,2,'admission neither resets duty nor clears a miss');
});

test('poll spacing and multiple cold slots participate in admission bounds',async t=>{
  for(const [poll,accepted] of [[1000,true],[1500,true],[1501,false]]){
    const s=model(t,{q:500,poll,openMs:0,admitMs:0,workMs:0});
    if(!accepted){assert.throws(()=>s.renew(s.config),{code:'invalid_input'});continue;}
    const p=s.renew(s.config);await s.next();await s.next();
    assert.equal(s.events.at(-1).at-s.events[0].at,poll);await p.close();
  }
  const s=model(t,{q:1000});s.config.projections.push({...s.config.projections[0],options:{...s.config.projections[0].options,diagnostics:true}});
  assert.throws(()=>s.renew(s.config),{code:'invalid_input'});
});

for(const boundary of ['window','authority'])test(`short ${boundary} tail reserves nothing and opens nothing`,async t=>{
  const s=model(t);if(boundary==='window')s.config.window.endsAtMonoMs=999;else s.config.renewalMs=999;
  const p=s.renew(s.config);t.after(()=>p.close());await s.next();
  assert.equal(s.events.length,0);assert.equal(p.getStatus().usedMs,0);assert.equal(p.getStatus().usedItems,0);
});

test('renewal during admission settles original window and preserves old and new host floors',async t=>{
  assert.equal(typeof protocol.admitMaintenance,'function','private admission dispatch exists');
  let release,entered;const start=new Promise(resolve=>{entered=resolve;});
  const s=model(t,{openMs:0,admitMs:10});s.config.window.endsAtMonoMs=2000;
  s.hold(new Promise(resolve=>{release=resolve;}));
  const admit=s.deps.admit;s.deps.admit=(...args)=>{entered();return admit(...args);};
  const renew=createMaintenancePumpRuntime(s.deps),p=renew(s.config);t.after(()=>p.close());
  const pending=s.next();await start;
  renew({...s.config,window:{...s.config.window,usedItems:7,usedMs:800}});
  s.set(2000);renew({...s.config,window:{id:'second',endsAtMonoMs:62000,usedItems:4,usedMs:300}});
  release();await pending;
  assert.equal(p.getStatus().usedItems,4);assert.equal(p.getStatus().usedMs,300,'old admission cannot refund the new ledger');
  assert.equal(maintenancePumpDiagnostic(p.getStatus()).observation,null);
});

test('real Worker: lazy construction, admission checks once, no work/observation, released transactions and fresh next-turn snapshot',async t=>{
  assert.equal(typeof protocol.admitMaintenance,'function','private admission dispatch exists');
  const f=fixture(t);f.admit('first admission evidence');
  const service=configured(t,f.path,[ns],{service:true}),control=new Int32Array(new SharedArrayBuffer(32));
  service.options.host={moduleUrl:new URL('./fixtures/context-product-admission-host.mjs',import.meta.url).href,
    configuration:{...service.options.host.configuration,admissionControl:control.buffer}};
  const h=await openContextIndexMaintainer(service.options);t.after(()=>h.close());
  assert.equal(control[0],0,'construction stays lazy');assert.equal(h.admitMaintenance,undefined);
  const input={readSet:[ns],types:['memory'],intent:'current',mode:'lexical',budget:{maxItems:32,maxMs:1000}};
  Atomics.store(control,3,1);const admitted=await protocol.admitMaintenance(h,input,service.token);
  ok(admitted);assert.equal(protocol.maintenanceAdmissionReceipt(admitted),'admitted');
  assert.equal(maintenanceObservation(admitted),undefined);assert.equal(maintenancePhaseDiagnostic(admitted).epochObservationMs,undefined);
  assert.deepEqual([...control].slice(0,3),[1,1,0],'both checks once and no corpus/maintenance reads');assert.equal(control[6],0,'no retained transaction at final authority');
  Atomics.store(control,3,0);f.admit('canonical write between admission and work');await testClock.advance(10);
  const result=await protocol.refreshMaintenance(h,input,service.token);ok(result);
  assert.equal(maintenanceObservation(result),testClock.now());assert.deepEqual([...control].slice(0,2),[1,1]);
  assert.ok(control[2]>0,'work starts only on the later call');
  // A public failed writable operation must still discard under the existing rule.
  f.admit('force another writable batch');Atomics.store(control,4,1);
  assert.equal((await h.refreshContextIndex(input,service.token)).error.code,'storage_error');
  const yielded=await protocol.refreshMaintenance(h,input,service.token);
  assert.equal(protocol.maintenanceAdmissionReceipt(yielded),'required');assert.deepEqual([...control].slice(0,2),[1,1]);
  ok(await protocol.admitMaintenance(h,input,service.token));assert.deepEqual([...control].slice(0,2),[2,2]);
  ok(await protocol.refreshMaintenance(h,input,service.token));assert.deepEqual([...control].slice(0,2),[2,2]);
  service.view[0]=0;assert.equal((await protocol.admitMaintenance(h,input,service.token)).error.code,'authority_required');
  const publicEntry=await import('../index.mjs');assert.equal(publicEntry.admitMaintenance,undefined);
});

for(const live of [false,true])test(`real Worker: ${live?'live stall':'overrun'} admission timeout is private, fully charged and confirmed before retry`,async t=>{
  const f=fixture(t);f.admit('native admission cutoff');const service=configured(t,f.path,[ns],{service:true});
  const control=new Int32Array(new SharedArrayBuffer(32));if(live)control[7]=1;else control[5]=1001;
  service.options.host={moduleUrl:new URL('./fixtures/context-product-admission-host.mjs',import.meta.url).href,
    configuration:{...service.options.host.configuration,admissionControl:control.buffer}};
  let serial=0;const timers=new Map();
  const renew=createMaintenancePumpRuntime({now:testClock.now,setTimer:(fn,ms)=>{const id=++serial;timers.set(id,{fn,at:testClock.now()+ms});return id;},clearTimer:id=>timers.delete(id)});
  const config={supervisor:service.supervisor,id:randomUUID(),serviceCredential:service.token,
    window:{id:randomUUID(),endsAtMonoMs:Math.floor(testClock.now())+60000,usedItems:0,usedMs:0},
    budgets:{maxItems:2048,maxMs:60000},quantum:{maxItems:32,maxMs:1000},pollMs:25,renewalMs:20000,projections:[{options:service.options,types:['memory']}]};
  const p=renew(config);t.after(()=>p.close());const [id,timer]=[...timers][0];timers.delete(id);await testClock.advance(timer.at-testClock.now());const pending=timer.fn();
  if(live){
    try {
      await Promise.resolve(Atomics.waitAsync(control,7,1).value);assert.equal(control[7],2,'integrity check is still live');
      await testClock.advance(1000,{waitForWorkers:false});
      for(const [key,value] of [...timers])if(value.at<=testClock.now()){timers.delete(key);value.fn();}
      assert.equal(maintenancePumpPhaseDiagnostic(p.getStatus()).projections[0].lastStall.kind,12,'live integrity work is attributed to admission');
    } finally {Atomics.store(control,7,0);Atomics.notify(control,7);}
  }
  await pending;
  assert.equal(p.getStatus().usedMs,1000);assert.equal(p.getStatus().usedItems,32);
  const d=maintenancePumpDiagnostic(p.getStatus());assert.equal(d.lastFailure.cause,'open_exceeds_quantum');
  assert.equal(d.observation,null);assert.equal(d.admission[0].attempts,1);assert.equal(d.admission[0].state,'backoff');
});

test('real Worker: read-only upgrade and repair both yield before fresh writable admission',async t=>{
  assert.equal(typeof protocol.admitMaintenance,'function','private admission dispatch exists');
  const f=fixture(t);f.admit('upgrade and repair admission');const service=configured(t,f.path,[ns],{service:true});
  const control=new Int32Array(new SharedArrayBuffer(32));
  service.options.host={moduleUrl:new URL('./fixtures/context-product-admission-host.mjs',import.meta.url).href,
    configuration:{...service.options.host.configuration,admissionControl:control.buffer}};
  const h=await openContextIndexMaintainer(service.options);t.after(()=>h.close());
  const input={readSet:[ns],types:['memory'],intent:'current',mode:'lexical',budget:{maxItems:32,maxMs:1000}};
  ok(await h.getContextIndexStatus({readSet:[ns],types:['memory'],intent:'current',deadlineMs:1000},service.token));
  assert.equal(protocol.maintenanceAdmissionReceipt(await protocol.refreshMaintenance(h,input,service.token)),'required');
  assert.deepEqual([...control].slice(0,2),[0,0],'upgrade cannot hide integrity checks in work');
  ok(await protocol.admitMaintenance(h,input,service.token));ok(await protocol.refreshMaintenance(h,input,service.token));
  assert.deepEqual([...control].slice(0,2),[1,1]);
  const db=new DatabaseSync(f.path+protocol.PRODUCT_SIDECAR_SUFFIX);
  try {db.prepare('UPDATE product_metadata SET profile=?').run('synthetic-invalid-profile');}finally{db.close();}
  Atomics.store(control,2,0);
  const yielded=await protocol.refreshMaintenance(h,input,service.token);
  assert.equal(protocol.maintenanceAdmissionReceipt(yielded),'required');assert.equal(maintenanceObservation(yielded),undefined);
  assert.deepEqual([...control].slice(0,3),[1,1,0],'repair cannot open or scan inside work');
  ok(await protocol.admitMaintenance(h,input,service.token));assert.deepEqual([...control].slice(0,3),[2,2,0]);
  ok(await protocol.refreshMaintenance(h,input,service.token));assert.deepEqual([...control].slice(0,2),[2,2]);
});

test('a work cutoff remains terminal and receives no admission retry authority',async t=>{
  const s=model(t,{workMs:1001}),p=s.renew(s.config);await s.next();await s.next();await p.completion;
  const d=maintenancePumpDiagnostic(p.getStatus());assert.equal(p.getStatus().error,'read_timeout');
  assert.equal(d.lastFailure.cause,'engine');assert.equal(d.lastFailure.engineCode,'read_timeout');
  assert.equal(d.admission[0],null);assert.equal(s.handles.length,1);await p.close();
});

test('same-window renewal floors survive a settled admission in flight',async t=>{
  assert.equal(typeof protocol.admitMaintenance,'function','private admission dispatch exists');
  let release,entered;const enteredAdmission=new Promise(resolve=>{entered=resolve;});
  const s=model(t);s.hold(new Promise(resolve=>{release=resolve;}));
  const admit=s.deps.admit;s.deps.admit=(...args)=>{entered();return admit(...args);};
  const renew=createMaintenancePumpRuntime(s.deps),p=renew(s.config);t.after(()=>p.close());const pending=s.next();await enteredAdmission;
  renew({...s.config,window:{...s.config.window,usedItems:7,usedMs:800}});release();await pending;
  assert.equal(p.getStatus().usedItems,7);assert.equal(p.getStatus().usedMs,800);
  assert.equal(maintenancePumpDiagnostic(p.getStatus()).observation,null);
});

test('a newly created cache cannot lose the pending physical admission hold',()=>{
  assert.equal(typeof policy.maintenanceAdmissionDomain,'function');
  const key=randomUUID(),physical=randomUUID(),missing={key,cache:'missing'};
  const state=policy.maintenanceAdmissionDomain(missing,1000);state.pending=true;
  const created={key,physical,cache:'created'};
  assert.equal(policy.maintenanceAdmissionDomain(created,1000),state);
  assert.equal(state.pending,true);
  policy.retainMaintenanceAdmission(created,1000,state);policy.failMaintenanceAdmission(state,1000,false);
  const alias=policy.maintenanceAdmissionDomain({key:randomUUID(),physical,cache:'created'},1250);
  assert.equal(alias.quarantined,true,'another owner/path/capacity cannot evade unproven disposal');assert.equal(policy.maintenanceAdmissionStatus(alias).attempts,1);
});

test('known replacement identity reconciles quarantine and retry profiles before rebinding',async()=>isolatedAdmissionDomains(all=>{
  const a=admissionIdentity(),b=admissionIdentity(),quarantined=policy.maintenanceAdmissionDomain(a,1000);
  policy.failMaintenanceAdmission(quarantined,100,false);
  const clean=policy.maintenanceAdmissionDomain(b,1000),replacement={...b,key:a.key};
  const merged=policy.maintenanceAdmissionDomain(replacement,1000);
  assert.equal(merged,clean);assert.equal(merged.quarantined,true);assert.equal(merged.held,true);
  assert.equal(merged.attempts,1);assert.equal(merged.until,quarantined.until);
  assert.equal(policy.maintenanceAdmissionStatus(merged).state,'quarantined');
  assert.equal(quarantined.domain,merged.domain);assert.equal(quarantined.profile,merged.profile);
  policy.failMaintenanceAdmission(quarantined,200,true);
  assert.equal(merged.attempts,2,'an outstanding reference still charges the merged profile');
  assert.equal(policy.maintenanceAdmissionDomain(a,1000),merged,'old physical alias is reconciled');
  assertAdmissionIndexes(all());
}));

test('known replacement identity reconciles held, busy, pending and maximum backoff across capacities',async()=>isolatedAdmissionDomains(all=>{
  const a=admissionIdentity(),b=admissionIdentity(),left=policy.maintenanceAdmissionDomain(a,1000);
  for(let n=0;n<3;n++)policy.failMaintenanceAdmission(left,1000,true);
  const other=policy.maintenanceAdmissionDomain(a,1250);other.busy=true;other.pending=true;
  const right=policy.maintenanceAdmissionDomain(b,1000);policy.failMaintenanceAdmission(right,0,true);
  const merged=policy.maintenanceAdmissionDomain({...b,key:a.key},1000);
  assert.equal(merged.attempts,3);assert.equal(merged.until,left.until);assert.equal(merged.held,true);
  assert.equal(merged.busy,true);assert.equal(merged.pending,true);assert.equal(other.domain,merged.domain);
  assert.equal(policy.maintenanceAdmissionDomain(b,1250),other);
  assertAdmissionIndexes(all());
}));

test('retaining admission also reconciles a replacement location domain',async()=>isolatedAdmissionDomains(all=>{
  const a=admissionIdentity(),b=admissionIdentity(),left=policy.maintenanceAdmissionDomain(a,1000);
  policy.failMaintenanceAdmission(left,0,false);
  const right=policy.maintenanceAdmissionDomain(b,1000);right.busy=true;
  policy.retainMaintenanceAdmission({...b,key:a.key},1000,right);
  assert.equal(right.quarantined,true);assert.equal(right.attempts,1);assert.equal(right.busy,true);
  assert.equal(left.domain,right.domain);assertAdmissionIndexes(all());
}));

test('known replacement identity keeps outstanding references current through repeated merges',async()=>isolatedAdmissionDomains(all=>{
  const a=admissionIdentity(),b=admissionIdentity(),c=admissionIdentity();
  const original=policy.maintenanceAdmissionDomain(a,1000);original.busy=true;
  policy.maintenanceAdmissionDomain(b,1000);policy.maintenanceAdmissionDomain(c,1000);
  policy.maintenanceAdmissionDomain({...b,key:a.key},1000);
  const latest=policy.maintenanceAdmissionDomain({...c,key:a.key},1000);
  assert.equal(original.domain,latest.domain);assert.equal(original.profile,latest.profile);
  assert.equal(latest.busy,true);
  policy.retainMaintenanceAdmission({...c,key:a.key},1000,original);
  policy.failMaintenanceAdmission(original,100,false);
  assert.equal(latest.quarantined,true);assert.equal(latest.attempts,1);
  assert.equal(policy.maintenanceAdmissionDomain(c,1250).quarantined,true);
  assertAdmissionIndexes(all());
}));

test('clean historical admission domains retire under location pressure with every alias and capacity',async()=>isolatedAdmissionDomains(all=>{
  const first=admissionIdentity(),second=admissionIdentity();
  const original=policy.maintenanceAdmissionDomain(first,1000);
  policy.maintenanceAdmissionDomain(first,1250);policy.maintenanceAdmissionDomain(second,1000);
  const merged=policy.maintenanceAdmissionDomain({...second,key:first.key},1000),retired=merged.domain;
  assert.equal(original.domain,retired);assert.equal(all().physical.size,2);
  // Fill locations without filling capacities: two aliases share each capacity.
  while(all().locations.size<1024){
    const identity=admissionIdentity();policy.maintenanceAdmissionDomain(identity,1000);
    policy.maintenanceAdmissionDomain({...identity,key:randomUUID()},1000);
  }
  assert.equal(all().locations.get(first.key),retired,'clean history stays indexed until pressure');
  policy.maintenanceAdmissionDomain(admissionIdentity(),1000);
  assert.equal(all().locations.has(first.key),false);assert.equal(all().locations.has(second.key),false);
  assert.equal(all().physical.has(first.physical),false);assert.equal(all().physical.has(second.physical),false);
  assert.equal(retired.capacities.size,0);assertAdmissionIndexes(all());
  for(let n=0;n<1100;n++)policy.maintenanceAdmissionDomain(admissionIdentity(),1000);
  assertAdmissionIndexes(all());
}));

test('clean historical admission domains retire under capacity pressure without leaking numeric cells',async()=>isolatedAdmissionDomains(all=>{
  const first=admissionIdentity(),retired=policy.maintenanceAdmissionDomain(first,1000).domain;
  policy.maintenanceAdmissionDomain(first,1250);
  while(all().capacityCount<1024){
    const identity=admissionIdentity();policy.maintenanceAdmissionDomain(identity,1000);policy.maintenanceAdmissionDomain(identity,1250);
  }
  assert.equal(all().locations.size,512);
  const identity=admissionIdentity(),fresh=policy.maintenanceAdmissionDomain(identity,1000);
  assert.equal(all().capacityCount,1023);assert.equal(retired.capacities.size,0);
  assert.equal(all().locations.has(first.key),false);assert.equal(all().physical.has(first.physical),false);
  assert.equal(all().locations.get(identity.key),fresh.domain,'the insertion domain stays indexed');
  assertAdmissionIndexes(all());
}));

for(const protectedState of ['held','quarantined','busy','pending','attempts','until'])
test(`admission pressure preserves domains with ${protectedState} on another capacity`,async()=>isolatedAdmissionDomains(all=>{
  const identity=admissionIdentity(),first=policy.maintenanceAdmissionDomain(identity,1000);
  const other=policy.maintenanceAdmissionDomain(identity,1250),value=['attempts','until'].includes(protectedState)?1:true;other[protectedState]=value;
  while(all().capacityCount<1024)policy.maintenanceAdmissionDomain(admissionIdentity(),1000).busy=true;
  for(let n=0;n<3;n++)assert.throws(()=>policy.maintenanceAdmissionDomain(admissionIdentity(),1000),{code:'read_in_progress'});
  assert.equal(policy.maintenanceAdmissionDomain(identity,1000),first);
  assert.equal(other[protectedState],value);assertAdmissionIndexes(all());
}));

test('location pressure refuses new aliases when every domain has outstanding ownership',async()=>isolatedAdmissionDomains(all=>{
  while(!all()||all().locations.size<1024){
    const identity=admissionIdentity();policy.maintenanceAdmissionDomain(identity,1000).busy=true;
    policy.maintenanceAdmissionDomain({...identity,key:randomUUID()},1000);
  }
  assert.equal(all().capacityCount,512);
  assert.throws(()=>policy.maintenanceAdmissionDomain(admissionIdentity(),1000),{code:'read_in_progress'});
  assert.equal(all().locations.size,1024);assertAdmissionIndexes(all());
}));

for(const [admitMs,confirmed,label] of [[120,true,'settled identity'],[701,true,'retry charge'],[701,false,'quarantine']])
test(`in-flight admission survives cap pressure and retains ${label}`,async t=>isolatedAdmissionDomains(async all=>{
  const identity=admissionIdentity();let release,entered;
  const waiting=new Promise(resolve=>{entered=resolve;}),s=model(t,{admitMs,failProof:!confirmed});
  s.deps.admissionIdentity=()=>identity;
  const admit=s.deps.admit;s.deps.admit=async(...args)=>{entered();await new Promise(resolve=>{release=resolve;});return admit(...args);};
  const p=createMaintenancePumpRuntime(s.deps)(s.config),pending=s.next();await waiting;
  const state=policy.maintenanceAdmissionDomain(identity,1000);assert.equal(state.busy,true);
  try {
    for(let n=0;n<2;n++){
      const replacement=admissionIdentity();policy.maintenanceAdmissionDomain(replacement,1000);
      identity.physical=replacement.physical;policy.maintenanceAdmissionDomain(identity,1000);
    }
    for(let n=0;n<1100;n++)policy.maintenanceAdmissionDomain(admissionIdentity(),1000);
    assert.equal(policy.maintenanceAdmissionDomain(identity,1000).profile,state.profile,'live admission cannot be orphaned after merges');
    release();await pending;
    const indexed=policy.maintenanceAdmissionDomain(identity,1000);
    assert.equal(indexed.domain,state.domain);assert.equal(indexed.profile,state.profile);
    assert.equal(state.attempts,admitMs===120?0:1);assert.equal(state.quarantined,!confirmed);
    assert.equal(state.until,admitMs!==120&&confirmed?s.now()+5000:0);assertAdmissionIndexes(all());
  } finally {release();await pending;await p.close().catch(()=>{});}
}));

test('work cutoff after clean retirement does not charge an orphan admission state',async t=>isolatedAdmissionDomains(async all=>{
  const identity=admissionIdentity(),s=model(t,{workMs:1001});s.deps.admissionIdentity=()=>identity;
  let release,entered;const waiting=new Promise(resolve=>{entered=resolve;}),work=s.deps.work;
  s.deps.work=async(...args)=>{entered();await new Promise(resolve=>{release=resolve;});return work(...args);};
  const p=createMaintenancePumpRuntime(s.deps)(s.config);await s.next();
  const old=policy.maintenanceAdmissionDomain(identity,1000),pending=s.next();await waiting;
  try {
    for(let n=0;n<1100;n++)policy.maintenanceAdmissionDomain(admissionIdentity(),1000);
    assert.equal(old.domain.capacities.size,0,'a work turn does not pin clean admission knowledge');
    release();await pending;await p.completion;
    assert.equal(maintenancePumpDiagnostic(p.getStatus()).lastFailure.cause,'engine');
    assert.equal(old.attempts,0);assert.equal(old.quarantined,false);
    const fresh=policy.maintenanceAdmissionDomain(identity,1000);
    assert.notEqual(fresh,old);assert.equal(fresh.attempts,0);assertAdmissionIndexes(all());
  } finally {release();await pending;await p.close();}
}));

for(const confirmed of [true,false])
test(`known replacement identity preserves a second in-flight owner after the first settles, proof=${confirmed}`,async t=>isolatedAdmissionDomains(async all=>{
  const a=admissionIdentity(),b=admissionIdentity(),first=model(t),second=model(t,{admitMs:701,failProof:!confirmed});
  const releases=[],waiting=[first,second].map((s,i)=>new Promise(entered=>{
    s.deps.admissionIdentity=()=>i===0?a:b;const admit=s.deps.admit;
    s.deps.admit=async(...args)=>{entered();await new Promise(resolve=>{releases[i]=resolve;});return admit(...args);};
  }));
  const pumps=[first,second].map(s=>createMaintenancePumpRuntime(s.deps)(s.config));
  const pending=[first.next(),second.next()];await Promise.all(waiting);
  const original=policy.maintenanceAdmissionDomain(a,1000),latest=policy.maintenanceAdmissionDomain(b,1000);
  try {
    a.physical=b.physical;policy.maintenanceAdmissionDomain(a,1000);
    assert.equal(original.domain,latest.domain);assert.equal(original.profile,latest.profile);
    releases[0]();await pending[0];
    assert.equal(latest.busy,true,'the other turn still owns admission after the first releases');
    for(let n=0;n<1100;n++)policy.maintenanceAdmissionDomain(admissionIdentity(),1000);
    assert.equal(policy.maintenanceAdmissionDomain(b,1000),latest);
    releases[1]();await pending[1];
    assert.equal(latest.busy,false);assert.equal(latest.attempts,1);assert.equal(latest.quarantined,!confirmed);
    assert.equal(policy.maintenanceAdmissionDomain(a,1000),latest);assertAdmissionIndexes(all());
  } finally {releases.forEach(release=>release());await Promise.all(pending);await Promise.all(pumps.map(p=>p.close().catch(()=>{})));}
}));

test('shared admission turns: repeated acquisitions survive merges, failure settlement and unmatched releases',async()=>isolatedAdmissionDomains(all=>{
  const a=admissionIdentity(),b=admissionIdentity(),c=admissionIdentity();
  const shared=policy.maintenanceAdmissionDomain(a,500);shared.busy=true;shared.busy=true;
  const other=policy.maintenanceAdmissionDomain(b,500);
  const idle=policy.maintenanceAdmissionDomain(c,500);
  const merged=policy.maintenanceAdmissionDomain({...b,key:a.key},500);
  policy.maintenanceAdmissionDomain({...b,key:c.key},500);
  assert.equal(shared.domain,merged.domain);assert.equal(idle.domain,merged.domain);
  assert.equal(merged.domain.busyCount,2);
  idle.busy=false;assert.equal(merged.domain.busyCount,2,'an unacquired cell cannot release another cell');
  shared.busy=false;assert.equal(merged.domain.busyCount,1);
  for(let n=0;n<1100;n++)policy.maintenanceAdmissionDomain(admissionIdentity(),500);
  assert.equal(policy.maintenanceAdmissionDomain(b,500),merged);
  policy.failMaintenanceAdmission(shared,0,true);
  assert.equal(merged.domain.busyCount,1,'charging failure does not release a turn');
  other.busy=true;assert.equal(merged.domain.busyCount,2);
  shared.busy=false;assert.equal(merged.domain.busyCount,1);assert.equal(merged.busy,true);
  shared.busy=false;assert.equal(merged.domain.busyCount,1,'excess releases cannot consume another cell');
  other.busy=false;assert.equal(merged.domain.busyCount,0);assert.equal(merged.busy,false);
  other.busy=false;assert.equal(merged.domain.busyCount,0);assertAdmissionIndexes(all());
}));

for(const mode of ['replacement','recovery'])for(const confirmed of [true,false])
test(`shared admission turns: ${mode} retains retry charge and quarantine, proof=${confirmed}`,async t=>isolatedAdmissionDomains(async all=>{
  const first=model(t,{q:500,openMs:100,admitMs:20}),second=model(t,{q:500,openMs:100,admitMs:401,failProof:!confirmed});
  const pathY=first.config.projections[0].options.path,pathX=second.config.projections[0].options.path;
  const snapshot=(options,inode)=>policy.maintenanceAdmissionIdentity(options,path=>({dev:1n,ino:path.endsWith('/.')?9n:BigInt(inode),birthtimeNs:1n,size:4096n}));
  const common=snapshot(first.config.projections[0].options,100);
  if(mode==='recovery')second.config.projections.push({...second.config.projections[0],options:{...second.config.projections[0].options,path:pathY}});
  const models=[first,second],releases=[],arrivals=[],pending=[],pumps=[];
  for(const [i,s] of models.entries()){
   if(mode==='recovery')s.deps.cutoffQualified=()=>true;
   let reads=0;
   s.deps.admissionIdentity=opts=>snapshot(opts,opts.path===pathY?100:mode==='replacement'&&++reads>=3?100:200);
   const admit=s.deps.admit;
   arrivals[i]=new Promise(entered=>{s.deps.admit=async(...args)=>{
    entered();await new Promise(resolve=>{releases[i]=resolve;});return admit(...args);
   };});
   pumps.push(createMaintenancePumpRuntime(s.deps)(s.config));
  }
  const shared=policy.maintenanceAdmissionDomain(common,500);
  const recovery=globalThis[Symbol.for('context-read-product-v1.1/pumps')].recoveryDomains;
  const domainX=JSON.stringify([pathX,second.config.projections[0].options.readSet[0].ownerId,second.config.projections[0].options.host.moduleUrl]);
  if(mode==='recovery')recovery.get(domainX).cooldownUntil=19000;
  try {
   pending[0]=first.next();await arrivals[0];
   pending[1]=second.next();await arrivals[1];
   assert.equal(policy.maintenanceAdmissionDomain(common,500),shared);
   const acquired=shared.domain.busyCount;
   releases[0]();await pending[0];
   const remaining=shared.domain.busyCount;
   let refused=0;const fillers=[];
   for(let n=0;n<1100;n++)try{const added=policy.maintenanceAdmissionDomain(admissionIdentity(),500);if(!confirmed){added.busy=true;fillers.push(added);}}catch(e){assert.equal(e.code,'read_in_progress');refused++;}
   const indexedBefore=all().locations.get(common.key);
   releases[1]();await pending[1];
   if(!confirmed)fillers[0].busy=false;
   const indexed=policy.maintenanceAdmissionDomain(common,500);
   for(const filler of fillers)filler.busy=false;
   assert.equal(indexed.attempts,1,'outstanding admission retry charge must remain indexed');
   assert.equal(indexed.quarantined,!confirmed,'failed disposal quarantine must remain reachable');
   assert.equal(indexed,shared,'outstanding admission must stay indexed until every owner releases');
   assert.equal(acquired,2);assert.equal(remaining,1);
   assert.equal(indexedBefore,shared.domain,'cap pressure cannot retire an outstanding turn');
   assert.equal(shared.domain.busyCount,0);assert.equal(shared.busy,false);
   assert.equal(refused>0,!confirmed,'only protected saturation refuses insertion');assertAdmissionIndexes(all());
  } finally {
   releases.forEach(fn=>fn?.());await Promise.allSettled(pending);await Promise.allSettled(pumps.map(p=>p.close()));
  }
}));

test('replacement admission charges disposal, open, admission, delivery and settlement once',async t=>{
  const s=model(t,{q:500,openMs:30,admitMs:20,deliveryMs:3,settleMs:7,disposeMs:5});
  s.config.projections.push({...s.config.projections[0],options:{...s.config.projections[0].options,diagnostics:true}});
  const p=s.renew(s.config);t.after(()=>p.close());
  await s.next();assert.equal(p.getStatus().usedMs,60);await s.next();await s.next();
  assert.equal(p.getStatus().usedMs,100);await s.next();
  assert.equal(p.getStatus().usedMs,165);assert.equal(p.getStatus().usedItems,2,'zero-work settlement never refunds prior transformations');
  assert.equal(s.events.at(-1).kind,'admission');
});

test('concurrent pump IDs serialize fresh admission before reserving another quantum',async t=>{
  assert.equal(typeof protocol.admitMaintenance,'function','private admission dispatch exists');
  let release,entered;const waiting=new Promise(resolve=>{entered=resolve;});
  const s=model(t);s.hold(new Promise(resolve=>{release=resolve;}));
  const admit=s.deps.admit;s.deps.admit=(...args)=>{entered();return admit(...args);};
  const renew=createMaintenancePumpRuntime(s.deps),first=renew(s.config),second=renew({...s.config,id:randomUUID()});
  const pending=s.next();await waiting;
  try {
    await s.next();assert.equal(s.handles.length,1,'another pump cannot race the physical admission');
    assert.equal(second.getStatus().usedMs,1000);assert.equal(second.getStatus().usedItems,32,'only the outstanding original reservation is charged');
  } finally {release();await pending;await first.close();await second.close();}
});

for(const [q,accepted] of [[1000,false],[700,true],[714,true],[715,false]])test(`multiple-resident cadence matrix C=2 Q=${q}`,async t=>{
  const s=model(t,{q,poll:25,openMs:0,admitMs:0,workMs:0}),first=s.config.projections[0];
  s.config.projections.push({...first,options:{...first.options,path:first.options.path+'-second'}});
  if(!accepted){assert.throws(()=>s.renew(s.config),{code:'invalid_input'});return;}
  const p=s.renew(s.config);t.after(()=>p.close());for(let n=0;n<12;n++)await s.next();
  assert.equal(s.events.filter(e=>e.kind==='admission').length,2);assert.equal(s.handles.length,2);
  assert.equal(maintenancePumpDiagnostic(p.getStatus()).cadenceMisses,0);
});

test('an over-budget predecessor drain with failed proof quarantines the replacement admission',async t=>{
  const s=model(t,{q:500,openMs:0,admitMs:0,workMs:0,disposeMs:501,failProof:true}),first=s.config.projections[0];
  s.config.projections.push({...first,options:{...first.options,diagnostics:true}});
  const p=s.renew(s.config);await s.next();await s.next();await s.next();await s.next();await p.completion;
  const d=maintenancePumpDiagnostic(p.getStatus());assert.equal(p.getStatus().error,'reader_failed');
  assert.equal(d.lastFailure.cause,'open_exceeds_quantum');assert.equal(d.admission[2].state,'quarantined');
  assert.equal(d.admission[2].attempts,1);assert.equal(s.handles.length,1,'replacement never opens after unproven predecessor disposal');
  await p.close().catch(()=>{});
});

test('another capacity cannot recharge a held capacity or bypass physical admission ownership',()=>{
  assert.equal(typeof policy.maintenanceAdmissionDomain,'function');
  const identity={key:randomUUID(),cache:'unchanged'},low=policy.maintenanceAdmissionDomain(identity,1000);
  for(let n=0;n<3;n++)policy.failMaintenanceAdmission(low,0,true);
  const high=policy.maintenanceAdmissionDomain(identity,1250);
  assert.equal(high.attempts,0);assert.equal(high.held,false);
  assert.equal(policy.maintenanceAdmissionDomain(identity,1000).attempts,3);
  assert.equal(low.held,true,'status or selection at another Q cannot recharge the original capacity');
  high.busy=true;assert.equal(low.busy,true);high.busy=false;
  policy.failMaintenanceAdmission(high,0,false);assert.equal(low.quarantined,true,'failed proof is physical, across capacities');
});


test('physical admission identity distinguishes recycled inodes without recharging on row timestamps',()=>{
  assert.equal(typeof policy.maintenanceAdmissionIdentity,'function');
  let birth=1n,row=1n;
  const stat=path=>({dev:1n,ino:path.endsWith('/.')?10n:20n,birthtimeNs:birth,size:100n,mtimeNs:row,ctimeNs:row});
  const options={path:'/synthetic-recycled/canonical.sqlite'},first=policy.maintenanceAdmissionIdentity(options,stat);
  const held=policy.maintenanceAdmissionDomain(first,1000);
  for(let n=0;n<3;n++)policy.failMaintenanceAdmission(held,n,true);
  row=2n;assert.deepEqual(policy.maintenanceAdmissionIdentity(options,stat),first);
  assert.equal(policy.maintenanceAdmissionDomain(first,1000).held,true,'ordinary writes retain the hold');
  birth=2n;const replacement=policy.maintenanceAdmissionIdentity(options,stat);
  assert.notEqual(replacement.key,first.key);assert.notEqual(replacement.physical,first.physical);
  assert.equal(policy.maintenanceAdmissionDomain(replacement,1000).attempts,0,'recycled inode is a new physical cache');
});


function requiredResult(){const r={ok:true,value:null};protocol.attachMaintenanceAdmissionReceipt(r,'required');return r;}
function cycling(t){
  const s=model(t,{openMs:0,admitMs:0}),original=s.deps.work,originalReceipt=s.deps.receiptOf;
  s.deps.receiptOf=r=>protocol.maintenanceAdmissionReceipt(r)??originalReceipt(r);
  s.deps.work=async(h,input)=>input.intent==='current'?requiredResult():original(h,input);
  s.runtime=createMaintenancePumpRuntime(s.deps);return s;
}

test('required cycles fail at three, expose their lane/count early and let history work',async t=>{
  const s=cycling(t),p=s.runtime(s.config);t.after(()=>p.close());
  let history=0;
  for(let n=0;n<20&&p.getStatus().state==='active';n++){
    await s.next();const status=p.getStatus(),d=maintenancePumpDiagnostic(status);
    if(d.observation?.projection===1)history++;
    if(d.admission[0]?.noProgress?.count===1){
      assert.deepEqual(d.admission[0],{noProgress:{lane:0,count:1}});
      assert.equal(status.state,'active');assert.equal(status.error,null);
    }
  }
  const status=await p.completion,d=maintenancePumpDiagnostic(status);
  assert.equal(status.state,'failed');assert.equal(status.error,'reader_failed');
  assert.equal(d.lastFailure.cause,'admission_no_progress');assert.equal(d.lastFailure.lane,0);assert.equal(d.lastFailure.count,3);
  assert.equal(d.failureCounts.admission_no_progress,1);assert.deepEqual(d.admission[0].noProgress,{lane:0,count:3});
  assert.ok(history>=2,'history must earn observations between current yields');
  assert.ok(s.events.filter(e=>e.kind==='work'&&e.intent==='history').length>=2);
});

test('required evidence survives renewal, a new pump ID, capacity/cache epochs and aliases',async t=>{
  const s=cycling(t),identity={key:randomUUID(),physical:randomUUID(),cache:'first'};
  s.deps.admissionIdentity=()=>identity;s.runtime=createMaintenancePumpRuntime(s.deps);
  let p=s.runtime(s.config);await s.next();await s.next();
  assert.deepEqual(maintenancePumpDiagnostic(p.getStatus()).admission[0].noProgress,{lane:0,count:1});
  assert.equal(s.runtime(s.config),p);assert.deepEqual(maintenancePumpDiagnostic(p.getStatus()).admission[0].noProgress,{lane:0,count:1});
  await p.close();identity.cache='changed';identity.key=randomUUID();
  p=s.runtime({...s.config,id:randomUUID(),quantum:{maxItems:32,maxMs:1250}});t.after(()=>p.close());
  assert.deepEqual(maintenancePumpDiagnostic(p.getStatus()).admission[0].noProgress,{lane:0,count:1});
  for(let n=0;n<20&&p.getStatus().state==='active';n++)await s.next();
  assert.equal((await p.completion).error,'reader_failed');
  assert.equal(maintenancePumpDiagnostic(p.getStatus()).lastFailure.count,3);
  await p.close();
  const next=s.runtime({...s.config,id:randomUUID()});t.after(()=>next.close());
  assert.deepEqual(maintenancePumpDiagnostic(next.getStatus()).admission[0].noProgress,{lane:0,count:3});
  const opens=s.handles.length;await s.next();
  assert.equal((await next.completion).state,'failed');assert.equal(s.handles.length,opens,'terminal evidence prevents another admission');
});

test('accepted observing work resets required evidence; successful admission alone does not',async t=>{
  const s=cycling(t),original=s.deps.work;let cycle=true;
  // History uses the original model work; current can be made genuinely observing.
  s.deps.work=async(h,input)=>cycle&&input.intent==='current'?requiredResult():
    original(h,{...input,intent:'history'});
  const p=createMaintenancePumpRuntime(s.deps)({...s.config,renewalMs:60000});t.after(()=>p.close());
  for(let repeat=0;repeat<4;repeat++){
    cycle=true;
    for(let n=0;n<8&&maintenancePumpDiagnostic(p.getStatus()).admission[0]===null;n++)await s.next();
    assert.deepEqual(maintenancePumpDiagnostic(p.getStatus()).admission[0].noProgress,{lane:0,count:1});
    await s.next();assert.equal(s.events.at(-1).kind,'admission');
    assert.deepEqual(maintenancePumpDiagnostic(p.getStatus()).admission[0].noProgress,{lane:0,count:1},'admission cannot erase evidence');
    cycle=false;
    for(let n=0;n<8&&maintenancePumpDiagnostic(p.getStatus()).admission[0]!==null;n++)await s.next();
    assert.equal(maintenancePumpDiagnostic(p.getStatus()).admission[0],null);
    assert.equal(p.getStatus().state,'active');
  }
});

test('physical-domain merges and pressure preserve outstanding required evidence',async()=>isolatedAdmissionDomains(all=>{
  const a=admissionIdentity(),b=admissionIdentity(),left=policy.maintenanceAdmissionDomain(a,1000),right=policy.maintenanceAdmissionDomain(b,1250);
  policy.maintenanceAdmissionProgress(left,'current',true);policy.maintenanceAdmissionProgress(right,'history',true);
  const merged=policy.maintenanceAdmissionDomain({...b,key:a.key},1000);
  assert.equal(policy.maintenanceAdmissionProgress(merged,'current'),1);assert.equal(policy.maintenanceAdmissionProgress(left,'history'),1);
  for(let n=0;n<1100;n++)policy.maintenanceAdmissionDomain(admissionIdentity(),1000);
  assert.equal(policy.maintenanceAdmissionProgress(policy.maintenanceAdmissionDomain(a,1000),'current'),1);
  assertAdmissionIndexes(all());
}));

test('a required work result reacquires indexed evidence after clean domain retirement',async t=>isolatedAdmissionDomains(async()=>{
  const s=cycling(t),identity=admissionIdentity();s.deps.admissionIdentity=()=>identity;
  let entered,release;const started=new Promise(resolve=>{entered=resolve;});
  s.deps.work=async()=>{entered();await new Promise(resolve=>{release=resolve;});return requiredResult();};
  const p=createMaintenancePumpRuntime(s.deps)(s.config);t.after(()=>p.close());await s.next();
  const old=policy.maintenanceAdmissionDomain(identity,1000),pending=s.next();await started;
  try{for(let n=0;n<1100;n++)policy.maintenanceAdmissionDomain(admissionIdentity(),1000);assert.equal(old.domain.capacities.size,0);}
  finally{release();await pending;}
  assert.deepEqual(maintenancePumpDiagnostic(p.getStatus()).admission[0].noProgress,{lane:0,count:1});
  assert.deepEqual([...policy.maintenanceAdmissionDomain(identity,1000).domain.noProgress.values()],[1]);
}));

test('the no-progress private failure kind is appended without renumbering earlier causes',async()=>{
  const {maintenanceFailureKinds,maintenanceFailureRecord}=await import('../context-product-attribution.mjs');
  assert.deepEqual(maintenanceFailureKinds.slice(0,18),['none','worker_heap_limit','worker_exit','worker_error','protocol','unmapped','exception','observation_timing','engine','spawn','dispatch','call_error','identity','worker_state','cleanup','disposal_proof','open_exceeds_quantum','maintainer_identity_unrecognized']);
  assert.equal(maintenanceFailureKinds[18],'admission_no_progress');
  assert.deepEqual(maintenanceFailureRecord('admission_no_progress',{count:3}),{cause:'admission_no_progress',count:3});
});

test('no-progress cells are process-bounded and merges and accepted work release capacity',async()=>isolatedAdmissionDomains(all=>{
  const a=admissionIdentity(),b=admissionIdentity(),left=policy.maintenanceAdmissionDomain(a,1000),right=policy.maintenanceAdmissionDomain(b,1000);
  policy.maintenanceAdmissionProgress(left,'shared',true);policy.maintenanceAdmissionProgress(right,'shared',true);
  assert.equal(all().progressCount,2);
  const merged=policy.maintenanceAdmissionDomain({...b,key:a.key},1000);assert.equal(all().progressCount,1);
  for(let n=0;n<1023;n++)policy.maintenanceAdmissionProgress(merged,String(n),true);
  assert.equal(all().progressCount,1024);
  assert.throws(()=>policy.maintenanceAdmissionProgress(merged,'overflow',true),{code:'read_in_progress'});
  policy.maintenanceAdmissionProgress(merged,'shared',false);assert.equal(all().progressCount,1023);
  policy.maintenanceAdmissionProgress(merged,'overflow',true);assert.equal(all().progressCount,1024);
  assertAdmissionIndexes(all());
}));

test('admission diagnostic keeps retry cause and fields beside no-progress evidence',async t=>{
  const s=cycling(t),admit=s.deps.admit;let admissions=0;
  s.deps.admit=async(...args)=>{
    const result=await admit(...args);
    if(++admissions===2)s.spend(1001);
    return result;
  };
  const p=createMaintenancePumpRuntime(s.deps)(s.config);t.after(()=>p.close());
  await s.next();await s.next(); // Current yields required; history next re-admits.
  await s.next(); // The second admission exceeds its quantum and enters backoff.
  const d=maintenancePumpDiagnostic(p.getStatus()),entry=d.admission[0];
  assert.equal(entry.cause,'open_exceeds_quantum');
  assert.equal(entry.attempts,1);assert.equal(entry.state,'backoff');
  assert.equal(entry.retryAtMonoMs,s.now()+5000);
  assert.deepEqual(entry.noProgress,{lane:0,count:1});
  assert.deepEqual(entry,{cause:'open_exceeds_quantum',attempts:1,state:'backoff',retryAtMonoMs:s.now()+5000,noProgress:{lane:0,count:1}});
  assert.equal(Object.isFrozen(entry),true);assert.equal(Object.isFrozen(entry.noProgress),true);
  assert.deepEqual(d.admission[1],{cause:'open_exceeds_quantum',attempts:1,state:'backoff',retryAtMonoMs:s.now()+5000},'retry-only lane keeps its exact status');
});

test('admission diagnostic without a retry contains only frozen no-progress evidence',async t=>{
  const s=cycling(t),p=s.runtime(s.config);t.after(()=>p.close());
  assert.deepEqual(maintenancePumpDiagnostic(p.getStatus()).admission,[null,null]);
  await s.next();await s.next();
  const entry=maintenancePumpDiagnostic(p.getStatus()).admission[0];
  assert.deepEqual(entry,{noProgress:{lane:0,count:1}});
  assert.equal(Object.hasOwn(entry,'cause'),false);
  assert.equal(Object.isFrozen(entry),true);assert.equal(Object.isFrozen(entry.noProgress),true);
});

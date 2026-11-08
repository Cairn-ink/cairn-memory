import '../testing/context-product-test-clock.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createMaintenancePumpRuntime, maintenancePumpDiagnostic, maintenancePumpPhaseDiagnostic } from '../context-product-pump.mjs';
import { createContextReadSupervisor } from '../context-read-supervisor.mjs';
import { credentialDigest } from '../context-product-control.mjs';
import { maintenanceAdmissionDomain, failMaintenanceAdmission } from '../context-product-admission-policy.mjs';
import { maintenanceDispatchControl, maintenanceControlState } from '../context-product-attribution.mjs';
import { captureMaintenanceTurnPort, createMaintenanceTurnController } from '../context-maintenance-turn.mjs';
import { setup as recoveryModel } from '../testing/context-product-cutoff-fixture.mjs';

const flush=async()=>{for(let i=0;i<40;i++)await Promise.resolve();};
const pendingGates=new Set();
const deferred=()=>{
  let fulfill,refuse;const promise=new Promise((a,b)=>{fulfill=a;refuse=b;});
  const gate={promise,resolve(value){pendingGates.delete(gate);fulfill(value);},reject(error){pendingGates.delete(gate);refuse(error);}};
  pendingGates.add(gate);return gate;
};
function model(t,{q=1000,maxWaitMs=5000,renewalMs=60000,endsAtMonoMs=60000,port=true}={}){
  let time=0,serial=0,observed,pump;
  const timers=new Map(),events=[],tickets=[],identity={key:randomUUID(),physical:randomUUID(),cache:'stable'};
  const supervisor=createContextReadSupervisor(),credential={opaque:randomUUID()},readSet=[{ownerId:'turn-test',scope:'personal',projectId:null}],
    ownerCoverage={policy:'recent-projects-v1',selectionRevision:'test',requestedNamespaces:1,selectedNamespaces:1,omittedNamespaces:0};
  const serviceBinding={kind:'service',serviceId:'test',credentialBindingId:'test',credentialExpiresUtcMs:null,
    credentialDigest:credentialDigest(credential),ownerId:readSet[0].ownerId,namespaces:{readSet,ownerCoverage},issuedAt:0};
  const options={supervisor,path:'/synthetic-turn-'+randomUUID()+'.sqlite',readSet,ownerCoverage,
    host:{moduleUrl:'file:///synthetic-turn-host.mjs',configuration:{serviceBinding}}};
  const s={events,tickets,timers,identity,supervisor,observedCalls:0,timerCount:()=>serial,now:()=>time,set:n=>{time=n;},spend:n=>{time+=n;},
    entry:()=> 'admitted',open:async()=>{},admit:async()=>{},work:async()=>{},dispose:async()=>{},release:()=>{},factory:null};
  const preQuantum={version:1,maxWaitMs,createTurn(request){
    if(s.factory)return s.factory(request);
    const ticket={request,signal:null,until:null,releases:[]};tickets.push(ticket);events.push({kind:'request',at:time,request});
    return {enter({signal,untilMonoMs}){ticket.signal=signal;ticket.until=untilMonoMs;return s.entry(ticket);},
      release(...args){ticket.releases.push(args);events.push({kind:'release',at:time,args});s.release(ticket,args);}};
  }};
  const config={supervisor,id:randomUUID(),serviceCredential:credential,
    window:{id:'first',endsAtMonoMs,usedItems:0,usedMs:0},budgets:{maxItems:2048,maxMs:60000},
    quantum:{maxItems:32,maxMs:q},pollMs:25,renewalMs,projections:[{options,types:['memory']}],...(port?{preQuantum}:{})};
  const deps={now:()=>time,setTimer:(fn,ms)=>{const id=++serial;timers.set(id,{fn,at:time+ms,ms});return id;},clearTimer:id=>timers.delete(id),
    admissionIdentity:()=>({...identity}),receiptOf:r=>r?.receipt,observedAt:()=>{s.observedCalls++;return observed;},
    open:async input=>{events.push({kind:'open',at:time,input});await s.open(input);return {async close(){events.push({kind:'dispose',at:time});await s.dispose();events.push({kind:'disposed',at:time});}};},
    admit:async(h,input)=>{events.push({kind:'admission',at:time,input});const result=await s.admit(input);return result??{ok:true,value:null,receipt:'admitted'};},
    work:async(h,input)=>{events.push({kind:'work',at:time,input});const result=await s.work(input);observed=time;return result??{ok:true,value:{progress:{transformed:1}}};}};
  const renew=createMaintenancePumpRuntime(deps),pumps=[];
  Object.assign(s,{config,deps,preQuantum,renew,
    create(patch={}){pump=renew({...config,...patch});if(!pumps.includes(pump))pumps.push(pump);return pump;},
    fire(){const [id,timer]=[...timers].sort((a,b)=>a[1].at-b[1].at)[0]??[];assert.ok(timer,'scheduled timer');timers.delete(id);time=Math.max(time,timer.at);return timer.fn();},
    async next(){await s.fire();await flush();},
    async due(n){time=n;let count=0;while([...timers.values()].some(v=>v.at<=time)){assert.ok(++count<100,'no zero-delay spin');s.fire();await flush();}},
    diagnostic:()=>maintenancePumpDiagnostic(pump.getStatus()),phases:()=>maintenancePumpPhaseDiagnostic(pump.getStatus()).projections});
  t.after(async()=>{for(const gate of [...pendingGates])gate.resolve();for(const p of pumps)await p.close().catch(()=>{});await supervisor.close().catch(()=>{});});
  return s;
}

test('turn ordering: wait beyond Q has no reservation, ordinal, sample, watchdog, drain, open or work',async t=>{
  const s=model(t),queued=deferred();s.entry=()=>queued.promise;const p=s.create();
  const ordinal=maintenanceControlState(maintenanceDispatchControl()).ordinal;
  const pending=s.fire();await flush();const started=s.now();s.set(started+1500);
  assert.equal(p.getStatus().usedItems,0);assert.equal(p.getStatus().usedMs,0);assert.equal(s.phases().reduce((n,p)=>n+p.quanta,0),0);
  assert.deepEqual(s.events.map(e=>e.kind),['request']);assert.equal(s.timers.size,1,'only admission timer');
  assert.equal(maintenanceControlState(maintenanceDispatchControl()).ordinal,ordinal+1,'no dispatch ordinal consumed');
  assert.equal(s.diagnostic().turnWaitMs,1500);assert.equal(s.diagnostic().turnPhase,'waiting');
  // Reentrant/concurrent scheduling cannot allocate a second queued ticket.
  queued.resolve('admitted');await pending;
  assert.deepEqual(s.events.map(e=>e.kind),['request','open','admission','release']);
  assert.equal(s.events.find(e=>e.kind==='open').input.deadlineMs,1000);
  assert.equal(s.events.find(e=>e.kind==='admission').input.budget.maxMs,1000);
  assert.equal(s.phases()[0].first.elapsedMs,0);assert.equal(s.tickets[0].request.phase,'admission');
  assert.equal(p.getStatus().usedItems,0);assert.equal(p.getStatus().usedMs,0);assert.equal(s.diagnostic().turnPhase,'idle');
});

test('an absent maxWaitMs gives the lexical wait a 2000 ms deadline',async t=>{
  const s=model(t),queued=deferred();delete s.preQuantum.maxWaitMs;s.entry=()=>queued.promise;
  const p=s.create(),pending=s.fire();await flush();const ticket=s.tickets[0];
  assert.equal(ticket.until-s.now(),2000);
  await s.due(ticket.until);await pending;
  assert.deepEqual(ticket.releases,[['withdrawn']]);assert.equal(s.diagnostic().deferredTurns,1);
  assert.equal(p.getStatus().state,'active');assert.equal(p.getStatus().error,null);
  assert.equal(s.events.some(e=>['open','admission','work'].includes(e.kind)),false);
});

test('turn request: separate admission/work tickets, pending lane, fresh allowance and no healthy idle ownership',async t=>{
  const s=model(t),p=s.create();await s.next();await s.next();await s.next();
  assert.deepEqual(s.tickets.map(t=>[t.request.phase,t.request.lane,t.request.intent]),[['admission',0,'current'],['work',0,'current'],['work',1,'history']]);
  for(const ticket of s.tickets){assert.deepEqual(ticket.releases,[['settled']]);assert.equal(Object.isFrozen(ticket.request),true);
    assert.deepEqual(Object.keys(ticket.request).sort(),['family','intent','kind','lane','maxMs','phase','pumpId','version','windowId']);
    assert.equal(ticket.request.maxMs,1000);assert.equal(ticket.request.family,'lexical');assert.equal(ticket.request.kind,'lexical');}
  assert.equal(s.events.filter(e=>e.kind==='open').length,1);assert.equal(s.diagnostic().turnPhase,'idle');
  assert.equal(s.diagnostic().admittedTurns,3,'one admission and two started work turns');
  assert.deepEqual(Object.keys(p.getStatus()).sort(),['error','id','maxItems','maxMs','state','usedItems','usedMs','windowId']);
});

for(const cancel of ['close','supervisor','same-window','new-window','authority','window','deadline'])
test(`turn cancellation: ${cancel} withdraws once, adds no failure or charge, ignores late admission`,async t=>{
  const s=model(t,{...(cancel==='authority'?{renewalMs:5000}:{}),...(cancel==='window'?{endsAtMonoMs:5000}:{})}),queued=deferred();
  s.entry=()=>queued.promise;const p=s.create(),pending=s.fire();await flush();const old=s.tickets[0];let closing;
  if(cancel==='close')closing=p.close();
  else if(cancel==='supervisor')closing=s.supervisor.close();
  else if(cancel==='same-window')s.renew(s.config);
  else if(cancel==='new-window'){s.set(60000);s.renew({...s.config,window:{...s.config.window,id:'next',endsAtMonoMs:120000}});}
  else if(cancel==='authority'||cancel==='window')await s.due(5000);
  else await s.due(old.until);
  await pending;await closing;assert.equal(old.signal.aborted,true);assert.deepEqual(old.releases,[['withdrawn']]);
  queued.resolve('admitted');await flush();assert.deepEqual(old.releases,[['withdrawn']]);
  assert.equal(s.events.some(e=>e.kind==='open'),false);assert.equal(p.getStatus().usedItems,0);assert.equal(p.getStatus().usedMs,0);
  assert.equal(s.diagnostic().lastFailure,null);assert.equal(s.diagnostic().observation,null);
  if(['same-window','new-window','deadline'].includes(cancel))assert.equal(p.getStatus().state,'active');
});

test('rejected renewals preserve a valid ticket, authority, floors and resident state',async t=>{
  const s=model(t),queued=deferred();s.entry=()=>queued.promise;const p=s.create(),pending=s.fire();await flush();
  const ticket=s.tickets[0],before=p.getStatus();
  for(const patch of [{preQuantum:{...s.preQuantum}},{preQuantum:undefined},{pollMs:99},
    {window:{...s.config.window,id:'overlap'}},{budgets:{...s.config.budgets,maxItems:4096}}])
    assert.throws(()=>s.renew({...s.config,...patch}),{code:'invalid_input'});
  assert.equal(ticket.signal.aborted,false);assert.deepEqual(p.getStatus(),before);assert.deepEqual(ticket.releases,[]);
  queued.resolve('admitted');await pending;assert.deepEqual(ticket.releases,[['settled']]);assert.equal(s.events.filter(e=>e.kind==='open').length,1);
});

test('adding a port to an existing unbrokered pump refuses renewal before state change',async t=>{
  const s=model(t,{port:false}),p=s.create(),before=p.getStatus();
  assert.throws(()=>s.renew({...s.config,preQuantum:s.preQuantum}),{code:'invalid_input'});assert.deepEqual(p.getStatus(),before);assert.equal(s.tickets.length,0);
});

test('repeated defer is active, uncharged, lane-stable, wall-time honest and normally spaced',async t=>{
  const s=model(t);s.entry=()=> 'defer';const p=s.create();
  for(let i=0;i<10;i++){await s.next();assert.equal(p.getStatus().state,'active');assert.equal(p.getStatus().error,null);
    assert.equal(p.getStatus().usedItems,0);assert.equal(s.diagnostic().observation,null);assert.equal(s.diagnostic().lastFailure,null);
    assert.equal(s.diagnostic().deferredTurns,i+1);assert.equal(s.tickets.at(-1).request.lane,0);
    if(i)assert.ok(s.events.filter(e=>e.kind==='request').at(-1).at-s.events.filter(e=>e.kind==='request').at(-2).at>=1000);}
  assert.equal(s.diagnostic().cadenceMisses,2);assert.equal(s.diagnostic().missedObservations,2);
  assert.equal(await Promise.race([p.completion,Promise.resolve('pending')]),'pending');assert.ok(s.timers.values().next().value.at>s.now());
  s.entry=()=> 'admitted';await s.next();assert.equal(s.diagnostic().cadenceMisses,2,'admission never resets misses');
  await s.next();assert.equal(s.diagnostic().observation.projection,0);assert.equal(s.diagnostic().missedObservations,2);
});

test('pending wait counters include current wait and preserve duty across accepted renewal',async t=>{
  const s=model(t),queued=deferred();s.entry=()=>queued.promise;const p=s.create(),pending=s.fire();await flush();const start=s.now();
  s.set(6500);assert.equal(s.diagnostic().cadenceMisses,2);assert.equal(s.diagnostic().turnWaitMs,6500-start);
  s.renew(s.config);await pending;assert.equal(s.diagnostic().cadenceMisses,2);assert.equal(s.diagnostic().missedObservations,2);
  assert.equal(s.diagnostic().lastFailure,null);assert.equal(p.getStatus().error,null);
});

test('quota floors raised while queued cancel without a reservation and retire correctly',async t=>{
  const s=model(t),queued=deferred();s.entry=()=>queued.promise;const p=s.create(),pending=s.fire();await flush();
  const first=p.completion;s.renew({...s.config,window:{...s.config.window,usedItems:2048}});await pending;
  assert.equal((await first).state,'budget_exhausted');assert.equal(p.getStatus().usedItems,2048);assert.equal(p.getStatus().usedMs,0);
  assert.equal(s.timers.size,0);assert.equal(s.events.some(e=>e.kind==='open'),false);assert.deepEqual(s.tickets[0].releases,[['withdrawn']]);
});

for(const cause of ['stopped','generation_changed','renewal_expired','budget_exhausted','admission_held'])
test(`grant recheck declines ${cause} before reserving or dispatching`,async t=>{
  const s=model(t),queued=deferred();s.entry=()=>queued.promise;const p=s.create(),pending=s.fire();await flush();
  queued.resolve('admitted');await Promise.resolve();let closing;
  if(cause==='stopped')closing=p.close();
  if(cause==='generation_changed')s.renew(s.config);
  if(cause==='renewal_expired')s.set(59500);
  if(cause==='budget_exhausted'){
    // Another pump sharing the original ledger raises its cumulative floor.
    const other=s.create({id:randomUUID(),window:{...s.config.window,usedItems:2048}});await other.close();
  }
  if(cause==='admission_held'){
    const state=maintenanceAdmissionDomain(s.identity,1000);failMaintenanceAdmission(state,s.now(),false);
  }
  await pending;await closing;
  assert.deepEqual(s.tickets[0].releases,[['declined',cause]]);assert.equal(s.events.some(e=>e.kind==='open'),false);
  assert.equal(maintenancePumpDiagnostic(p.getStatus()).declinedTurns[cause],1);assert.equal(p.getStatus().error,null);
});

for(const phase of ['admission','work'])for(const grantFirst of [true,false])
test(`short wait expiry declines ${phase}, grant settled ${grantFirst?'before':'after'} deadline abort`,async t=>{
  const s=model(t,{maxWaitMs:1000}),p=s.create();if(phase==='work')await s.next();
  const before=p.getStatus(),phases=s.phases(),observation=s.diagnostic().observation,prior=s.events.length;
  const ordinal=maintenanceControlState(maintenanceDispatchControl()).ordinal;
  const queued=deferred();s.entry=()=>queued.promise;const pending=s.fire();await flush();const ticket=s.tickets.at(-1);
  assert.equal(ticket.request.phase,phase);
  s.set(ticket.until-1);if(grantFirst)queued.resolve('admitted');
  s.set(ticket.until+1);
  for(const [id,timer] of [...s.timers])if(timer.at<=s.now()){s.timers.delete(id);timer.fn();}
  if(!grantFirst)queued.resolve('admitted');
  await pending;
  assert.equal(ticket.signal.aborted,true);assert.deepEqual(ticket.releases,[['declined','wait_expired']]);
  assert.deepEqual(s.events.slice(prior).map(e=>e.kind),['request','release']);
  assert.deepEqual(p.getStatus(),before);assert.equal(p.getStatus().state,'active');assert.equal(p.getStatus().error,null);
  assert.deepEqual(s.phases(),phases);assert.deepEqual(s.diagnostic().observation,observation);
  assert.equal(s.diagnostic().lastFailure,null);assert.equal(s.diagnostic().deferredTurns,0);
  assert.equal(s.diagnostic().declinedTurns.wait_expired,1);
  assert.equal(maintenanceControlState(maintenanceDispatchControl()).ordinal,ordinal+1,'no dispatch ordinal consumed');
  assert.equal(s.timers.size,1,'only the normal retry timer remains');
  assert.equal([...s.timers.values()][0].at,s.now()+1000);
  const count=s.tickets.length;await s.due(s.now()+999);assert.equal(s.tickets.length,count,'no early retry');
  s.entry=()=> 'admitted';await s.next();assert.deepEqual(s.tickets.at(-1).releases,[['settled']]);
  assert.equal(s.tickets.at(-1).request.phase,phase);assert.equal(s.tickets.at(-1).request.lane,ticket.request.lane);
});

for(const start of ['open','admission','refresh'])for(const offset of [-1,0,1])
test(`post-admission continuation: ${start} at deadline ${offset} uses a fresh clock`,async t=>{
  const s=model(t,{maxWaitMs:1000}),p=s.create();
  if(start==='admission'){
    s.admit=async()=>({ok:true,value:null,receipt:'required'});await s.next();s.admit=async()=>{};
  }else if(start==='refresh')await s.next();
  const before=p.getStatus(),phases=s.phases(),prior=s.events.length,admitted=s.diagnostic().admittedTurns;
  const queued=deferred();s.entry=()=>queued.promise;
  const pending=s.fire();await flush();const ticket=s.tickets.at(-1);
  assert.equal(ticket.request.phase,start==='refresh'?'work':'admission');
  s.set(ticket.until-1);queued.resolve('admitted');
  // Run the controller's entry reaction, which caches a timely grant, then
  // delay the pump continuation without firing the admission timeout timer.
  await Promise.resolve();
  assert.equal(s.diagnostic().turnPhase,'running');assert.equal(s.timers.size,0);
  s.set(ticket.until+offset);await pending;
  assert.equal(ticket.signal.aborted,false,'the controller already completed its wait');
  if(offset<0){
    assert.deepEqual(ticket.releases,[['settled']]);
    assert.deepEqual(s.events.slice(prior).map(e=>e.kind),
      start==='open'?['request','open','admission','release']:['request',start==='refresh'?'work':'admission','release']);
    assert.equal(s.diagnostic().admittedTurns,admitted+1);
  }else{
    assert.deepEqual(ticket.releases,[['declined','wait_expired']]);
    assert.deepEqual(s.events.slice(prior).map(e=>e.kind),['request','release']);
    assert.equal(s.diagnostic().declinedTurns.wait_expired,1);
    assert.equal(s.diagnostic().admittedTurns,admitted);
    assert.equal(s.diagnostic().turnPhase,'idle');
    assert.deepEqual(p.getStatus(),before);assert.deepEqual(s.phases(),phases);
  }
});

test('post-admission continuation preserves poison precedence over wait expiry',async t=>{
  const s=model(t,{maxWaitMs:1000}),queued=deferred();s.entry=()=>queued.promise;
  const p=s.create(),pending=s.fire();await flush();const ticket=s.tickets[0];
  const port={version:1,maxWaitMs:1000,createTurn:()=>({enter:()=> 'admitted',release(){throw Error('release failed');}})};
  const poisoner=createMaintenanceTurnController(captureMaintenanceTurnPort(port),s.deps);
  const grant=await poisoner.wait(ticket.request,{signal:new AbortController().signal,untilMonoMs:ticket.until,identity:s.identity});
  assert.equal(grant.status,'admitted');
  s.set(ticket.until-1);queued.resolve('admitted');await Promise.resolve();
  assert.equal(s.diagnostic().turnPhase,'running');assert.equal(s.timers.size,0);
  // A different controller poisons the same domain before the pump resumes.
  assert.equal(poisoner.release(grant.ticket,'settled'),'poisoned');
  s.set(ticket.until+1);await pending;await p.completion;
  assert.deepEqual(ticket.releases,[['declined','stopped']]);
  assert.equal(p.getStatus().error,'reader_failed');assert.equal(s.diagnostic().declinedTurns.wait_expired,0);
  assert.deepEqual(s.events.map(e=>e.kind),['request','release']);
  assert.equal(s.diagnostic().admittedTurns,0);assert.equal(s.phases().reduce((n,lane)=>n+lane.quanta,0),0);
  assert.equal(p.getStatus().usedItems,0);assert.equal(p.getStatus().usedMs,0);
});

test('post-admission continuation preserves renewal expiry precedence over wait expiry',async t=>{
  const s=model(t,{maxWaitMs:1000}),queued=deferred();s.entry=()=>queued.promise;
  const p=s.create(),pending=s.fire();await flush();const ticket=s.tickets[0];
  s.set(ticket.until-1);queued.resolve('admitted');await Promise.resolve();
  s.set(s.config.window.endsAtMonoMs);await pending;
  assert.deepEqual(ticket.releases,[['declined','renewal_expired']]);
  assert.equal(s.diagnostic().declinedTurns.renewal_expired,1);assert.equal(s.diagnostic().declinedTurns.wait_expired,0);
  assert.deepEqual(s.events.map(e=>e.kind),['request','release']);assert.equal(p.getStatus().usedMs,0);
});

test('fractional admission deadline rounds down and the fresh clock sample rounds up',async t=>{
  const s=model(t,{maxWaitMs:1000}),queued=deferred();s.entry=()=>queued.promise;
  s.create();s.set(1000.25);const pending=s.fire();await flush();const ticket=s.tickets[0];
  assert.equal(ticket.until%1,0.25,'the host still receives the original deadline');
  s.set(ticket.until-1);queued.resolve('admitted');await Promise.resolve();
  s.set(ticket.until-0.5);await pending;
  assert.deepEqual(ticket.releases,[['declined','wait_expired']]);
  assert.deepEqual(s.events.map(e=>e.kind),['request','release']);
});

test('an accepted quantum continues admission and settlement beyond the admission deadline',async t=>{
  const s=model(t,{maxWaitMs:1000}),queued=deferred();s.entry=()=>queued.promise;
  s.open=async()=>{s.spend(2);};s.create();const pending=s.fire();await flush();const ticket=s.tickets[0];
  s.set(ticket.until-1);queued.resolve('admitted');await pending;
  assert.equal(s.events.find(e=>e.kind==='open').at,ticket.until-1);
  assert.equal(s.events.find(e=>e.kind==='admission').at,ticket.until+1);
  assert.deepEqual(ticket.releases,[['settled']]);assert.equal(s.diagnostic().declinedTurns.wait_expired,0);
});

test('an always-late broker exposes missed duty and rising declines without started turns or a timer spin',async t=>{
  const s=model(t,{maxWaitMs:1000});
  s.entry=ticket=>{
    const queued=deferred();
    ticket.signal.addEventListener('abort',()=>queued.resolve('admitted'),{once:true});
    return queued.promise;
  };
  const p=s.create(),initial=s.diagnostic();let fired=0;
  // Advance each timer at its scheduled fake time, including deadline aborts.
  while(Math.min(...[...s.timers.values()].map(timer=>timer.at))<=6500){
    assert.ok(++fired<=12,'bounded timer callbacks over the duty interval');
    s.fire();await flush();
  }
  s.set(6500);const diagnostic=s.diagnostic();
  assert.equal(p.getStatus().state,'active');assert.equal(p.getStatus().error,null);
  assert.ok(diagnostic.missedObservations>=1);assert.ok(diagnostic.cadenceMisses>=1);
  assert.ok(diagnostic.declinedTurns.wait_expired>initial.declinedTurns.wait_expired);
  assert.equal(diagnostic.admittedTurns,initial.admittedTurns);assert.equal(diagnostic.admittedTurns,0);
  assert.equal(diagnostic.deferredTurns,0);assert.equal(diagnostic.lastFailure,null);
  assert.equal(s.observedCalls,0,'host freshness is never refreshed');
  assert.deepEqual(s.events.filter(e=>['open','admission','work'].includes(e.kind)),[]);
  assert.equal(p.getStatus().usedItems,0);assert.equal(p.getStatus().usedMs,0);
  assert.equal(s.phases().reduce((n,lane)=>n+lane.quanta,0),0);
  assert.ok(s.tickets.length>=2&&s.tickets.length<=4,'bounded requested turns');
  assert.ok(s.timerCount()<=13,'bounded timer creation');assert.equal(s.timers.size,1);
  for(const ticket of s.tickets)assert.deepEqual(ticket.releases,[['declined','wait_expired']]);
});

test('a real window expiry wins over a coincident wait deadline abort',async t=>{
  const s=model(t,{maxWaitMs:1000,endsAtMonoMs:3000}),queued=deferred();s.entry=()=>queued.promise;
  const p=s.create(),pending=s.fire();await flush();const ticket=s.tickets[0];
  // Deliver the wait timer at the actual window horizon before the grant reaction.
  s.set(s.config.window.endsAtMonoMs);queued.resolve('admitted');
  for(const [id,timer] of [...s.timers])if(timer.at<=s.now()){s.timers.delete(id);timer.fn();}
  await pending;
  assert.equal(ticket.signal.aborted,true);assert.deepEqual(ticket.releases,[['declined','renewal_expired']]);
  assert.equal(s.diagnostic().declinedTurns.renewal_expired,1);assert.equal(s.diagnostic().declinedTurns.wait_expired,0);
  assert.equal(s.diagnostic().deferredTurns,0);assert.equal(s.diagnostic().lastFailure,null);
  assert.equal(s.events.some(e=>['open','admission','work'].includes(e.kind)),false);
  assert.equal(p.getStatus().usedItems,0);assert.equal(p.getStatus().usedMs,0);assert.equal(p.getStatus().error,null);
});

for(const cause of ['deadline','close','supervisor','renewal'])
for(const cutoff of (cause==='deadline'?[true]:[true,false]))
for(const grantFirst of (cause==='deadline'?[true]:[true,false]))
test(`grant racing ${cause} ${cutoff?'at':'before'} the deadline, resolved ${grantFirst?'before':'after'} cancellation, is locally declined without withdrawal or deferral`,async t=>{
  const s=model(t,{renewalMs:5000,endsAtMonoMs:5000}),queued=deferred();s.entry=()=>queued.promise;
  const p=s.create(),pending=s.fire();await flush();const ticket=s.tickets[0];let closing;
  s.set(ticket.until-1);if(grantFirst)queued.resolve('admitted');
  // Deliver the abort/cutoff before the already-queued native Promise reaction.
  s.set(cutoff?ticket.until+1:ticket.until-1);
  if(cause==='close')closing=p.close();
  else if(cause==='supervisor')closing=s.supervisor.close();
  else if(cause==='renewal')s.renew(s.config);
  else await s.due(s.now());
  if(!grantFirst)queued.resolve('admitted');
  await pending;await closing;
  const reason=cause==='deadline'?'renewal_expired':cause==='renewal'?'generation_changed':'stopped';
  assert.deepEqual(ticket.releases,[['declined',reason]]);
  assert.equal(s.diagnostic().declinedTurns[reason],1);assert.equal(s.diagnostic().deferredTurns,0);
  assert.equal(s.events.some(e=>e.kind==='open'||e.kind==='admission'||e.kind==='work'),false);
  assert.equal(p.getStatus().usedItems,0);assert.equal(p.getStatus().usedMs,0);
  assert.equal(s.diagnostic().lastFailure,null);assert.equal(s.diagnostic().observation,null);
});

test('prompt window handoff cancels queued work and preserves the admitted resident',async t=>{
  const s=model(t),p=s.create();await s.next();await s.next();await s.next();
  const queued=deferred();s.entry=()=>queued.promise;s.set(58000);const pending=s.fire();await flush();
  s.set(60000);s.renew({...s.config,window:{...s.config.window,id:'next',endsAtMonoMs:120000}});await pending;
  s.entry=()=> 'admitted';await s.next();
  assert.equal(s.tickets.at(-1).request.phase,'work');assert.equal(s.events.filter(e=>e.kind==='open').length,1);assert.equal(s.events.some(e=>e.kind==='dispose'),false);
  assert.equal(p.getStatus().windowId,'next');assert.equal(s.diagnostic().observation.projection,0);
});

test('inactive epoch defers predecessor drain until the next granted admission turn',async t=>{
  const s=model(t,{renewalMs:10000}),p=s.create();await s.next();
  s.set(20000);s.renew(s.config);const queued=deferred();s.entry=()=>queued.promise;const pending=s.fire();await flush();
  assert.equal(s.events.filter(e=>e.kind==='dispose').length,0);assert.equal(s.tickets.at(-1).request.phase,'admission');
  queued.resolve('admitted');await pending;
  assert.deepEqual(s.events.slice(-6).map(e=>e.kind),['request','dispose','disposed','open','admission','release']);assert.equal(p.getStatus().error,null);
});

test('accepted renewal during running work does not cancel its turn or replace its original ledger settlement',async t=>{
  const s=model(t),p=s.create();await s.next();const work=deferred();s.work=()=>work.promise;
  const pending=s.fire();await flush();const ticket=s.tickets.at(-1);s.renew({...s.config,window:{...s.config.window,usedItems:17,usedMs:30}});
  assert.equal(ticket.signal.aborted,false);assert.deepEqual(ticket.releases,[]);work.resolve();await pending;
  assert.deepEqual(ticket.releases,[['settled']]);assert.equal(p.getStatus().usedItems,17);assert.equal(p.getStatus().usedMs,30);
});

for(const stage of ['open','admission','work'])test(`stop at ${stage} holds the grant through late result and proven disposal`,async t=>{
  const s=model(t),p=s.create();if(stage==='work')await s.next();
  const operation=deferred(),proof=deferred();s[stage==='admission'?'admit':stage]=()=>operation.promise;s.dispose=()=>proof.promise;
  const pending=s.fire();await flush();const ticket=s.tickets.at(-1),closing=p.close();await flush();
  assert.deepEqual(ticket.releases,[]);operation.resolve();await flush();assert.deepEqual(ticket.releases,[]);
  assert.equal(s.diagnostic().turnPhase,'settling');assert.equal(s.events.at(-1).kind,'dispose');
  proof.resolve();await pending;await closing;assert.deepEqual(ticket.releases,[['settled']]);
  assert.equal(s.events.at(-2).kind,'disposed');assert.equal(s.events.at(-1).kind,'release');
});

test('replacement owns predecessor disposal and the new admission in the same turn',async t=>{
  const s=model(t,{renewalMs:10000}),p=s.create();await s.next();s.set(20000);s.renew(s.config);
  const proof=deferred(),opening=deferred(),admission=deferred();s.dispose=()=>proof.promise;s.open=()=>opening.promise;s.admit=()=>admission.promise;
  const pending=s.fire();await flush();const ticket=s.tickets.at(-1);assert.equal(s.events.at(-1).kind,'dispose');assert.deepEqual(ticket.releases,[]);
  proof.resolve();await flush();assert.equal(s.events.at(-1).kind,'open');assert.deepEqual(ticket.releases,[]);
  opening.resolve();await flush();assert.equal(s.events.at(-1).kind,'admission');assert.deepEqual(ticket.releases,[]);
  admission.resolve();await pending;assert.deepEqual(ticket.releases,[['settled']]);assert.equal(p.getStatus().error,null);
});

for(const code of ['storage_busy','authority_required','read_timeout'])test(`failure ${code} retains reservation and releases after joined shutdown`,async t=>{
  const s=model(t),p=s.create();await s.next();const proof=deferred();s.dispose=()=>proof.promise;s.work=()=>({ok:false,error:{code}});
  const pending=s.fire();await flush();const ticket=s.tickets.at(-1);assert.equal(p.getStatus().error,code);assert.deepEqual(ticket.releases,[]);
  assert.equal(s.events.at(-1).kind,'dispose');assert.equal(p.getStatus().usedItems,32);assert.equal(p.getStatus().usedMs,1000);
  proof.resolve();await pending;await p.completion;assert.deepEqual(ticket.releases,[['settled']]);assert.equal(s.diagnostic().turnPhase,'idle');
});

test('parent watchdog keeps grant until returned work and shutdown disposal both settle',async t=>{
  const s=model(t),p=s.create();await s.next();const work=deferred(),proof=deferred();s.work=()=>work.promise;s.dispose=()=>proof.promise;
  const pending=s.fire();await flush();const ticket=s.tickets.at(-1);await s.due(s.now()+1000);
  assert.equal(p.getStatus().error,'read_timeout');assert.deepEqual(ticket.releases,[]);work.resolve();await flush();assert.deepEqual(ticket.releases,[]);
  proof.resolve();await pending;await p.close();assert.deepEqual(ticket.releases,[['settled']]);
});

test('failed disposal withholds release and poisons a new pump ID and a different port on the physical sidecar',async t=>{
  const s=model(t),p=s.create();await s.next();s.work=()=>({ok:false,error:{code:'read_timeout'}});s.dispose=()=>{throw Error('unproven');};
  await s.next();assert.equal(p.getStatus().error,'reader_failed');assert.equal(s.diagnostic().turnPhase,'poisoned');assert.deepEqual(s.tickets.at(-1).releases,[]);
  await p.close().catch(()=>{});const count=s.tickets.length;
  // Use a distinct canonical alias and location key so neither the old
  // supervisor path hold nor the old location key can mask physical poison.
  s.identity.key=randomUUID();
  const next=s.create({id:randomUUID(),preQuantum:{...s.preQuantum},projections:s.config.projections.map(p=>({...p,options:{...p.options,path:p.options.path+'-alias'}}))});await s.next();
  assert.equal(next.getStatus().error,'reader_failed');assert.equal(s.tickets.length,count);assert.equal(s.diagnostic().turnPhase,'poisoned');
});

test('a release throw cannot be bypassed by omitting the port on a successor pump',async t=>{
  const s=model(t),p=s.create();s.release=()=>{throw Error('release failed');};await s.next();await p.close();
  const count=s.events.filter(e=>e.kind==='open').length,next=s.create({id:randomUUID(),preQuantum:undefined});await s.next();
  assert.equal(next.getStatus().error,'reader_failed');assert.equal(s.diagnostic().turnPhase,'poisoned');
  assert.equal(s.events.filter(e=>e.kind==='open').length,count);assert.equal(s.tickets.length,1);
});

test('realm poison survives reopening and accepted renewal with the same pump ID',async t=>{
  const s=model(t),p=s.create();s.release=()=>{throw Error('release failed');};
  await s.next();await p.close();const count=s.tickets.length;
  const next=s.create();assert.notEqual(next,p);assert.equal(s.renew(s.config),next);
  await s.next();
  assert.equal(next.getStatus().error,'reader_failed');assert.equal(s.diagnostic().turnPhase,'poisoned');
  assert.equal(s.tickets.length,count,'renewal cannot allocate a successor ticket for the poisoned claim');
});

for(const mode of ['factory-throw','ticket','enter-throw','reject','thenable','outcome','port-change','release-throw'])
test(`turn fail-closed ${mode} uses only closed codes and exact release obligations`,async t=>{
  const s=model(t),hostile=new Proxy({}, {get(){assert.fail('caller error inspected');}});
  if(mode==='factory-throw')s.factory=()=>{throw hostile;};
  if(mode==='ticket')s.factory=()=>({enter(){assert.fail('malformed ticket invoked');}});
  if(mode==='enter-throw')s.entry=()=>{throw hostile;};
  if(mode==='reject')s.entry=()=>Promise.reject(hostile);
  if(mode==='thenable')s.entry=()=>({get then(){assert.fail('thenable awaited');}});
  if(mode==='outcome')s.entry=()=> 'ready';
  if(mode==='release-throw')s.release=()=>{throw hostile;};
  const p=s.create();if(mode==='port-change')s.preQuantum.maxWaitMs=1;
  await s.next();await p.completion;assert.equal(p.getStatus().error,mode==='release-throw'?'reader_failed':'authority_required');
  if(['factory-throw','ticket','port-change'].includes(mode))assert.equal(s.tickets.length,0);
  else assert.deepEqual(s.tickets[0].releases,[[mode==='release-throw'?'settled':'withdrawn']]);
  if(mode==='release-throw')assert.equal(s.diagnostic().turnPhase,'poisoned');
  else assert.equal(s.events.some(e=>e.kind==='open'),false);
});

test('invalid ports refuse activation and never fall back to unbrokered work',async t=>{
  const s=model(t);let invoked=0;
  for(const preQuantum of [null,{},new Proxy({}, {getPrototypeOf(){invoked++;throw null;}}),
    {version:1,maxWaitMs:1000,get createTurn(){invoked++;throw null;}}])
    assert.throws(()=>s.renew({...s.config,preQuantum}),{code:'invalid_input'});
  assert.equal(invoked,0);assert.equal(s.timers.size,0);assert.equal(s.events.length,0);
});

test('open-only capacity hold suppresses requests and is visible in private turn diagnostics',async t=>{
  const s=model(t),gate=maintenanceAdmissionDomain(s.identity,1000);failMaintenanceAdmission(gate,0,false);
  const p=s.create();await s.next();assert.equal(s.tickets.length,0);assert.equal(p.getStatus().error,null);
  assert.deepEqual(s.diagnostic().admissionHold,{held:true,attempts:1});assert.equal(s.diagnostic().turnPhase,'idle');
});

for(const mode of ['held','quarantined'])test(`held resident ${mode} declines a raced grant and waits without requesting or spinning`,async t=>{
  function hold(s){
    const gate=maintenanceAdmissionDomain(s.identity,1000);
    for(let n=0;n<(mode==='held'?3:1);n++)failMaintenanceAdmission(gate,s.now(),mode==='held');
  }
  const s=model(t),p=s.create();await s.next();
  const queued=deferred();s.entry=()=>queued.promise;const pending=s.fire();await flush();hold(s);
  assert.equal(s.tickets.at(-1).request.phase,'work');queued.resolve('admitted');await pending;
  assert.deepEqual(s.tickets.at(-1).releases,[['declined','admission_held']]);
  assert.equal(Math.min(...[...s.timers.values()].map(timer=>timer.at)),60000,'no immediate resident retry');
  await s.due(s.now()+10000);assert.equal(s.tickets.length,2);assert.equal(p.getStatus().error,null);
  assert.equal(p.getStatus().usedItems,0);assert.equal(p.getStatus().usedMs,0);assert.equal(s.diagnostic().observation,null);
  const before=model(t),other=before.create();await before.next();hold(before);await before.next();
  assert.equal(before.tickets.length,1,'a known hold suppresses even a resident work request');
  assert.equal(Math.min(...[...before.timers.values()].map(timer=>timer.at)),60000);
  assert.equal(other.getStatus().error,null);assert.equal(before.events.some(event=>event.kind==='work'),false);
});

test('queued factory is latched before reentrant accepted renewal or close',async t=>{
  for(const action of ['renew','close']){
    const s=model(t);let calls=0,releases=0,p,closing;
    s.factory=()=>{calls++;if(action==='renew')s.renew(s.config);else closing=p.close();
      return {enter(){assert.fail('already cancelled ticket entered');},release(outcome){releases++;assert.equal(outcome,'withdrawn');}};};
    p=s.create();await s.next();await closing;assert.equal(calls,1);assert.equal(releases,1);assert.equal(s.events.length,0);assert.equal(p.getStatus().error,null);
  }
});

test('port mutation during granted work is terminal only after captured release and disposal join',async t=>{
  const s=model(t),p=s.create();await s.next();const work=deferred(),proof=deferred();s.work=()=>work.promise;s.dispose=()=>proof.promise;
  const pending=s.fire();await flush();const ticket=s.tickets.at(-1);s.preQuantum.createTurn=()=>assert.fail('replacement invoked');work.resolve();await flush();
  assert.equal(p.getStatus().error,'authority_required');assert.deepEqual(ticket.releases,[]);assert.equal(s.events.at(-1).kind,'dispose');
  proof.resolve();await pending;await p.completion;assert.deepEqual(ticket.releases,[['settled']]);
});

test('port mutation between observed grant and dispatch withdraws without a quantum',async t=>{
  const s=model(t),queued=deferred();s.entry=()=>queued.promise;const p=s.create(),pending=s.fire();await flush();
  queued.resolve('admitted');await Promise.resolve();s.preQuantum.version=2;await pending;await p.completion;
  assert.equal(p.getStatus().error,'authority_required');assert.equal(p.getStatus().usedItems,0);assert.equal(p.getStatus().usedMs,0);
  assert.deepEqual(s.tickets[0].releases,[['withdrawn']]);assert.equal(s.events.some(e=>e.kind==='open'),false);assert.equal(s.phases()[0].quanta,0);
});

test('open exception retains grant through the supervisor cleanup ID proof',async t=>{
  const s=model(t);
  // A minimal supervised cleanup receipt exercises the pump's cleanup-ID join.
  const actual=s.config.supervisor;
  const { supervisorOwner }=await import('../context-read-supervisor.mjs');
  const {owner,registry}=supervisorOwner(actual),cleanup=registry.register(owner,{path:s.config.projections[0].options.path,domain:'turn-open-cleanup'});
  cleanup.stop=()=>{};s.open=()=>{throw Object.assign(Error('open failed'),{code:'authority_required',cleanupId:cleanup.id});};
  try{
    const pending=s.create();const turn=s.fire();await flush();const ticket=s.tickets[0];
    assert.deepEqual(ticket.releases,[]);assert.equal(actual.getCleanupStatus(cleanup.id).state,'pending');
    registry.finish(cleanup);await turn;await pending.completion;
    assert.deepEqual(ticket.releases,[['settled']]);assert.equal(pending.getStatus().error,'authority_required');
  }finally{if(cleanup.expiresAt===null)registry.finish(cleanup);}
});

test('a second owner stays queued until the first turn has settled and proved shutdown disposal',async t=>{
  const first=model(t),second=model(t),queue=[];let held=false;
  function broker(s){s.entry=()=>{if(!held){held=true;return 'admitted';}const queued=deferred();queue.push(queued);return queued.promise;};
    s.release=()=>{const next=queue.shift();if(next)next.resolve('admitted');else held=false;};}
  broker(first);broker(second);const a=first.create();await first.next();
  const result=deferred(),proof=deferred();first.work=()=>result.promise;first.dispose=()=>proof.promise;
  const work=first.fire();await flush();const b=second.create(),other=second.fire();await flush();
  assert.equal(second.events.some(e=>e.kind==='open'),false);
  result.resolve({ok:false,error:{code:'authority_required'}});await flush();assert.equal(a.getStatus().error,'authority_required');
  assert.equal(second.events.some(e=>e.kind==='open'),false,'a failure DTO is not settlement');assert.equal(first.events.at(-1).kind,'dispose');
  proof.resolve();await work;await other;assert.equal(b.getStatus().error,null);assert.equal(second.events.filter(e=>e.kind==='open').length,1);
  assert.deepEqual(first.tickets.at(-1).releases,[['settled']]);
});

for(const path of ['confirmed','deadline','failed','close','close-late'])test(`qualified test-only recovery ${path} obeys the same granted-turn proof barrier`,async t=>{
  const termination=deferred(),calls=[];
  const s=recoveryModel(t,{termination:()=>path==='failed'?Promise.reject(Error('failed proof')):termination.promise});
  const preQuantum={version:1,maxWaitMs:1000,createTurn(request){const ticket={request,releases:[]};calls.push(ticket);
    return {enter:()=> 'admitted',release:(...args)=>ticket.releases.push(args)};}};
  const p=s.create({preQuantum});await s.fire();const operation=s.fire();await flush();await s.due(s.now()+100);await flush();const ticket=calls.at(-1);
  try{
  if(path==='confirmed'){assert.deepEqual(ticket.releases,[]);termination.resolve(1);await operation;assert.deepEqual(ticket.releases,[['settled']]);assert.equal(p.getStatus().error,null);}
  else if(path==='close'){const closing=p.close();await flush();assert.deepEqual(ticket.releases,[]);termination.resolve(1);await operation;await closing;assert.deepEqual(ticket.releases,[['settled']]);}
  else if(path==='close-late'){
    const closing=p.close();await flush();await s.due(s.now()+1001);
    assert.equal(maintenancePumpDiagnostic(p.getStatus()).turnPhase,'poisoned');assert.deepEqual(ticket.releases,[]);
    termination.resolve(1);await operation;await closing;assert.equal(p.getStatus().error,'reader_failed');assert.deepEqual(ticket.releases,[]);
  }
  else if(path==='deadline'){
    await s.due(s.now()+1001);assert.equal(maintenancePumpDiagnostic(p.getStatus()).turnPhase,'poisoned');assert.deepEqual(ticket.releases,[]);
    termination.resolve(1);await operation;await p.close();assert.deepEqual(ticket.releases,[]);assert.equal(p.getStatus().error,'reader_failed');
  } else {await operation;assert.equal(p.getStatus().error,'reader_failed');assert.deepEqual(ticket.releases,[]);assert.equal(maintenancePumpDiagnostic(p.getStatus()).turnPhase,'poisoned');}
  }finally{termination.resolve(1);}
});

test('stop at predecessor drain releases only after proof and opens no successor',async t=>{
  const s=model(t,{renewalMs:10000}),p=s.create();await s.next();s.set(20000);s.renew(s.config);
  const proof=deferred();s.dispose=()=>proof.promise;const pending=s.fire();await flush();const ticket=s.tickets.at(-1),closing=p.close();
  assert.deepEqual(ticket.releases,[]);proof.resolve();await pending;await closing;
  assert.equal(s.events.filter(e=>e.kind==='open').length,1);assert.equal(s.events.filter(e=>e.kind==='admission').length,1);
  assert.deepEqual(ticket.releases,[['settled']]);assert.equal(s.events.at(-2).kind,'disposed');
});

test('admission watchdog owns a late open until its disposal is proven',async t=>{
  const s=model(t),opening=deferred(),proof=deferred();s.open=()=>opening.promise;s.dispose=()=>proof.promise;
  const p=s.create(),pending=s.fire();await flush();const ticket=s.tickets[0];await s.due(s.now()+1000);
  assert.equal(p.getStatus().error,'read_timeout');assert.deepEqual(ticket.releases,[]);opening.resolve();await flush();
  assert.equal(s.events.at(-1).kind,'dispose');assert.deepEqual(ticket.releases,[]);proof.resolve();await pending;await p.completion;
  assert.deepEqual(ticket.releases,[['settled']]);assert.equal(s.events.some(e=>e.kind==='admission'),false);
  assert.equal(s.diagnostic().observation,null);assert.equal(p.getStatus().usedItems,32);assert.equal(p.getStatus().usedMs,1000);
});

test('qualified test-only allowance exhaustion settles every grant after confirmed shutdown',async t=>{
  const s=recoveryModel(t,{stalls:Infinity}),tickets=[];
  const p=s.create({preQuantum:{version:1,maxWaitMs:1000,createTurn(request){const ticket={request,releases:[]};tickets.push(ticket);
    return {enter:()=> 'admitted',release:(...args)=>ticket.releases.push(args)};}}});
  for(let attempt=0;attempt<3;attempt++){
    const before=s.calls.length;let operation;
    do{operation=s.fire();await flush();if(s.calls.length===before)await operation;}while(s.calls.length===before);
    await s.due(s.now()+100);await operation;await flush();
    assert.deepEqual(tickets.at(-1).releases,[['settled']]);
  }
  assert.equal(p.getStatus().error,'read_timeout');assert.equal(maintenancePumpDiagnostic(p.getStatus()).turnPhase,'idle');
  assert.equal(tickets.filter(t=>t.request.phase==='work').length,3);assert.ok(tickets.every(t=>t.releases.length===1));
});

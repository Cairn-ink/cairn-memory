import { testClock } from '../testing/context-product-test-clock.mjs';
import test,{after} from 'node:test';
import assert from 'node:assert/strict';
import { Worker } from 'node:worker_threads';
import timerPromises,{ setTimeout as realDelay } from 'node:timers/promises';
import { syncBuiltinESMExports } from 'node:module';
import { randomUUID } from 'node:crypto';
import { fixture } from '../testing/context-read-fixture.mjs';
import { personal,configured } from '../testing/context-product-owner-fixture.mjs';
import { createContextReadSupervisor } from '../index.mjs';
import { supervisorOwner } from '../context-read-supervisor.mjs';
import * as readerDiagnostic from '../context-product-reader.mjs';
import * as pumpDiagnostic from '../context-product-pump.mjs';
import { createProductReaderRuntime,disposeProductReader } from '../context-product-reader.mjs';
import { createMaintenancePumpRuntime } from '../context-product-pump.mjs';
const nativeDelay=realDelay;
const retained=[];after(async()=>{for(const cleanup of retained)await cleanup();});
const hostUrl=new URL('../testing/context-product-disposal-host.mjs',import.meta.url).href;
const flush=async()=>{for(let i=0;i<40;i++)await Promise.resolve();};
function nativeTest(name,body){test(name,async t=>{
  const abort=new AbortController();
  try{await Promise.race([body(t),nativeDelay(60000,undefined,{signal:abort.signal}).then(async()=>{await testClock.advance(10000,{waitForWorkers:false});assert.fail('disposal_test_watchdog');})]);}
  finally{abort.abort();}
});}
function setup(t,{stage='open',mode='normal',request=false,tail,parentGap=false,delayedGrace,qualified=false,callGate=false}={}) {
  // Pin canonical identities until all process-wide quarantine probes finish.
  const f=fixture({after:fn=>retained.push(fn)}),memory=f.admit('Synthetic lease disposal memory.',personal),supervisors=[],pumps=[];
  // Failed cleanup is asserted explicitly, rather than hidden by an after hook.
  const owner={after:fn=>t.after(()=>Promise.resolve(fn()).catch(()=>{}))};
  const s=configured(owner,f.path,[personal],{service:!request}),disposalState=new SharedArrayBuffer(32),state=new Int32Array(disposalState);
  supervisors.push(s.supervisor);let injected=false,responses=0,spawned=0,injectEnabled=true,acceptedBetweenDeadlines=false,forced=0,readerCutoff;const resources=[],workers=[],exits=[],handles=[],openingErrors=[],closeFrames=[],closeSent=[];
  const spawnWorker=data=>{
    spawned++;const w=new Worker(new URL('../context-product-worker.mjs',import.meta.url),{workerData:data,env:{},execArgv:[],stdout:true,stderr:true});
    const post=w.postMessage.bind(w);w.postMessage=(m,...rest)=>{if(m.method==='close')closeSent.push(m);return post(m,...rest);};
    const terminate=w.terminate.bind(w);w.terminate=()=>{forced++;return terminate();};
    workers.push(w);resources.push(new Int32Array(data.resources));exits.push(new Promise(resolve=>w.once('exit',resolve)));
    w.on('message',m=>{
      if(m.kind==='maintenance-close-failure')closeFrames.push(m);
      if(m.result?.ok && m.result.value!==null)responses++;
      const selected=stage==='open'?m.result?.ok && m.result.value===null:m.result?.ok && m.result.value!==null && responses===(request||delayedGrace?1:2);
      if(injectEnabled && !injected && selected){injected=true;const cutoff=Number(BigInt(m.operation.operationCutoffMonoNs))/1e6;readerCutoff=cutoff;
        void testClock.advance(Math.max(1,Math.ceil(cutoff-testClock.now()+(delayedGrace?delayedGrace.delay-delayedGrace.gap:parentGap?-1:1))),{waitForWorkers:false});
        if(parentGap){const due=[...timers].find(([,timer])=>timer.at<=testClock.now());assert.ok(due,'parent_deadline_precedes_accepted_response');timers.delete(due[0]);due[1].fn();}}
    });return w;
  };
  const readerTimers=new Set();
  const productOpen=createProductReaderRuntime({maintenance:!request,spawnWorker,setTimer(fn,ms){const id=setTimeout(()=>{readerTimers.delete(id);fn();},ms);readerTimers.add(id);return id;},clearTimer(id){readerTimers.delete(id);clearTimeout(id);}});
  const open=(...args)=>productOpen(...args).then(handle=>{handles.push(handle);return handle;},error=>{openingErrors.push(error);throw error;}),timers=new Map();let serial=0;
  const pumpOpen=parentGap?async(...args)=>{const h=await open(...args);return {...h,refreshContextIndex(...call){void testClock.advance(2,{waitForWorkers:false});return h.refreshContextIndex(...call).then(result=>{if(injected)acceptedBetweenDeadlines=result.ok;return result;});}};}:open;
  const renew=createMaintenancePumpRuntime({open:pumpOpen,...(qualified?{cutoffQualified:()=>true}:{}),now:testClock.now,setTimer:(fn,ms)=>{const id=++serial;timers.set(id,{fn,at:testClock.now()+ms});return id;},clearTimer:id=>timers.delete(id)});
  const options={...s.options,host:{moduleUrl:hostUrl,configuration:{...s.options.host.configuration,disposalState,disposalMode:mode,bootstrapGate:stage==='bootstrap',callGate}}};
  const config={supervisor:s.supervisor,id:randomUUID(),window:{id:randomUUID(),endsAtMonoMs:testClock.now()+(tail==='window'?1056:60000),usedItems:0,usedMs:0},
    budgets:{maxItems:10000,maxMs:60000},quantum:{maxItems:1,maxMs:1000},pollMs:1000,renewalMs:tail==='renewal'?1056:60000,serviceCredential:s.token,projections:[{options,types:['memory']}]};
  async function tick(){const [id,v]=[...timers].sort((a,b)=>a[1].at-b[1].at)[0];timers.delete(id);
    await testClock.advance(Math.max(0,Math.ceil(v.at-testClock.now())),{waitForWorkers:false});const pending=v.fn();await flush();return {pending};}
  async function retries(failed,{closedOwner=false}={}){
    const before=spawned;
    for(const supervisor of closedOwner?[createContextReadSupervisor(),createContextReadSupervisor()]:[s.supervisor,createContextReadSupervisor()]){
      if(!supervisors.includes(supervisor))supervisors.push(supervisor);
      let opts={...options,supervisor};
      if(request){const fresh=configured(owner,f.path,[personal],{supervisor});opts={...fresh.options,host:{moduleUrl:hostUrl,configuration:{...fresh.options.host.configuration,disposalState}}};}
      if(failed)await assert.rejects(open(opts),{code:'reader_failed'},'same_and_new_supervisor_keep_unproven_quarantine');
      else {const h=await open(opts);await h.close();}
    }
    assert.equal(spawned,before+(failed?0:2),failed?'quarantined_retries_create_no_worker':'confirmed_disposal_allows_both_supervisors');
  }
  f.workspace.defer(async()=>{Atomics.store(state,1,1);Atomics.notify(state,1);
    Atomics.store(state,7,1);Atomics.notify(state,7);
    for(const p of pumps)await p.close().catch(()=>{});for(const supervisor of supervisors)await supervisor.close().catch(()=>{});});
  return {f,s,memory,options,open,config,renew,state,resources,workers,exits,timers,tick,retries,pumps,disableCutoff(){injectEnabled=false;},handles,openingErrors,closeFrames,closeSent,readerTimers,get spawned(){return spawned;},get injected(){return injected;},get acceptedBetweenDeadlines(){return acceptedBetweenDeadlines;},get forced(){return forced;},get readerCutoff(){return readerCutoff;}};
}
async function failedLeaseRepro(x,records){
  assert.ok(records.some(r=>r.state==='failed'&&r.workerStopped&&r.nativeDisposed&&!r.leasesReleased&&r.providersSettled));
  assert.deepEqual([...x.resources.at(-1)],[1,0,0,0]);assert.equal(await x.exits.at(-1),1);
  await x.retries(true);
}
for(const stage of ['open','refresh'])nativeTest(`disposal ${stage}: timeout releases the native host lease and permits both supervisors`,async t=>{
  const x=setup(t,{stage}),p=x.renew(x.config);x.pumps.push(p);
  for(let i=0;i<(stage==='open'?1:2);i++){const turn=await x.tick();await turn.pending;}
  const terminal=await p.completion;await p.close().catch(()=>{});const records=await x.s.supervisor.drain();
  assert.equal(x.injected,true);const failed=records.some(r=>r.state==='failed');if(failed)await failedLeaseRepro(x,records);
  assert.equal(failed,false,'timeout_disposal_releases_host_lease_without_quarantine');
  assert.equal(terminal.error,'read_timeout','confirmed_timeout_preserves_public_terminal_code');
  assert.ok(records.every(r=>['workerStopped','nativeDisposed','leasesReleased','providersSettled'].every(k=>r[k])));
  assert.deepEqual([...x.resources.at(-1)],[1,1,0,0]);assert.equal(await x.exits.at(-1),0);await x.retries(false);
});
for(const tail of ['window','renewal'])nativeTest(`disposal ${tail} tail: no truncated native quantum, reservation or Worker`,async t=>{
  const x=setup(t,{tail}),p=x.renew(x.config);x.pumps.push(p);const turn=await x.tick();await turn.pending;
  if(x.spawned){await p.completion;await p.close().catch(()=>{});await failedLeaseRepro(x,await x.s.supervisor.drain());}
  assert.equal(x.spawned,0,'short_authority_tail_never_spawns_worker');assert.equal(p.getStatus().usedItems,0);assert.equal(p.getStatus().usedMs,0);
  assert.equal(p.getStatus().state,'active');const end=await x.tick();await end.pending;assert.equal((await p.completion).state,tail==='window'?'budget_exhausted':'renewal_expired');
  x.disableCutoff();x.renew({...x.config,renewalMs:60000,window:tail==='window'?{...x.config.window,id:randomUUID(),endsAtMonoMs:testClock.now()+60000}:x.config.window});
  const resumed=await x.tick();await resumed.pending;assert.equal(p.getStatus().state,'active','authorized_handoff_resumes_full_quantum');assert.equal(x.spawned,1);
  await p.close();assert.ok((await x.s.supervisor.drain()).every(r=>r.state==='complete'),'tail_handoff_disposes_before_supervisor_close');
});
for(const stage of ['open','refresh'])nativeTest(`disposal request ${stage}: timeout releases its request host lease`,async t=>{
  const x=setup(t,{request:true,stage});
  if(stage==='open')assert.equal((await x.open(x.options).catch(e=>e)).code,'read_timeout');
  else {
    const h=await x.open(x.options),result=await h.fetchCandidateEvidence({readSet:[personal],intent:'current',deadlineMs:1000,
      refs:[{type:'memory',namespace:personal,memoryId:x.memory.id,revision:x.memory.revision}]},x.s.token);
    assert.equal(result.error.code,'read_timeout');await h.close().catch(()=>{});
  }
  const records=await x.s.supervisor.drain(),failed=records.some(r=>r.state==='failed');if(failed)await failedLeaseRepro(x,records);
  assert.equal(failed,false,'request_timeout_also_releases_registered_lease');await x.retries(false);
});
nativeTest('disposal close rendezvous: call settles before lease release and replacement waits',async t=>{
  const x=setup(t,{mode:'block'}),p=x.renew(x.config);x.pumps.push(p);const turn=await x.tick();
  while(!x.state[0] && x.workers[0].threadId!==-1)await realDelay(1);
  assert.equal(x.state[0],1,'registered_close_runs_before_forced_termination');
  assert.equal(p.getStatus().error,'read_timeout','timeout_is_visible_while_disposal_waits');
  const before=x.spawned;await assert.rejects(x.open(x.options),{code:'read_in_progress'});assert.equal(x.spawned,before);
  Atomics.store(x.state,1,1);Atomics.notify(x.state,1);await turn.pending;
  assert.equal((await p.completion).error,'read_timeout');await x.retries(false);
});
nativeTest('disposal bootstrap rendezvous: close waits for in-flight host construction',async t=>{
  const x=setup(t,{stage:'bootstrap'}),opening=x.open(x.options).catch(e=>e);
  let settled=false;void opening.then(()=>{settled=true;});
  while(!x.state[4]){assert.equal(settled,false,'bootstrap_reaches_registered_host_lease');await realDelay(1);}
  await testClock.advance(5001,{waitForWorkers:false});assert.equal((await opening).code,'read_timeout');
  while(!x.state[6] && x.workers[0].threadId!==-1)await realDelay(1);
  if(x.state[6])x.workers[0].postMessage({fixtureRelease:true});
  const records=await x.s.supervisor.drain(),failed=records.some(r=>r.state==='failed');if(failed)await failedLeaseRepro(x,records);
  assert.equal(failed,false,'bootstrap_close_waits_for_lease_acquisition_to_settle');
  assert.deepEqual([...x.resources[0]],[2,2,0,0]);assert.equal(x.state[5],1);
});
for(const mode of ['reject','block'])nativeTest(`disposal ${mode}: grace failure retains process quarantine`,async t=>{
  const x=setup(t,{mode}),p=x.renew(x.config);x.pumps.push(p);const turn=await x.tick();
  while(!x.state[0] && x.workers[0].threadId!==-1)await realDelay(1);
  await testClock.advance(10000,{waitForWorkers:false});await turn.pending;await p.completion;await p.close().catch(()=>{});
  const records=await x.s.supervisor.drain();assert.ok(records.some(r=>r.state==='failed'));await x.retries(true);
  assert.equal(x.state[0],1,'timeout_attempts_host_disposal_before_force');
});

// Parent and reader clocks differ only at dispatch; disposal cannot inherit an unbounded idle close.
// The real safety cap may win first; paused injected time is not a lower bound.
nativeTest('disposal parent deadline: accepted response between deadlines still bounds blocked close',async t=>{
  const x=setup(t,{stage:'refresh',mode:'block',parentGap:true}),p=x.renew(x.config);x.pumps.push(p);
  const first=await x.tick();await first.pending;const turn=await x.tick();
  while(!x.state[0])await realDelay(1);await flush();
  assert.equal(x.acceptedBetweenDeadlines,true,'reader_accepts_response_between_parent_and_reader_deadlines');
  await testClock.advance(9999,{waitForWorkers:false});
  await testClock.advance(1,{waitForWorkers:false});await flush();
  try{assert.equal(x.forced,1,'parent_timeout_forces_blocked_close_within_disposal_bound');}
  finally{if(!x.forced){Atomics.store(x.state,1,1);Atomics.notify(x.state,1);}}
  await x.exits[0];assert.equal(x.workers[0].threadId,-1);
  await turn.pending;assert.equal((await p.completion).error,'reader_failed');
  const records=await x.s.supervisor.drain();assert.ok(records.some(r=>r.state==='failed'&&r.workerStopped));await x.retries(true);
});
nativeTest('disposal ordinary close: blocked host cannot retain a live Worker indefinitely',async t=>{
  const x=setup(t,{mode:'block'});x.disableCutoff();const h=await x.open(x.options),closing=h.close().catch(e=>e);
  while(!x.state[0])await realDelay(1);await testClock.advance(9999,{waitForWorkers:false});
  await testClock.advance(1,{waitForWorkers:false});
  try{assert.equal(x.forced,1,'ordinary_close_forces_blocked_host_within_bound');}
  finally{if(!x.forced){Atomics.store(x.state,1,1);Atomics.notify(x.state,1);}}
  await x.exits[0];assert.equal(x.workers[0].threadId,-1);
  assert.equal((await closing).code,'reader_failed');await x.retries(true);
});
for(const mode of ['reject','block'])nativeTest(`disposal opening ${mode}: failed drain overrides the triggering timeout`,async t=>{
  const x=setup(t,{mode}),p=x.renew(x.config);x.pumps.push(p);const turn=await x.tick();
  while(!x.state[0] && x.workers[0].threadId!==-1)await realDelay(1);
  await testClock.advance(10000,{waitForWorkers:false});await turn.pending;
  assert.equal((await p.completion).error,'reader_failed','failed_opening_disposal_has_reader_failed_precedence');
  const records=await x.s.supervisor.drain();assert.ok(records.some(r=>r.state==='failed'));await x.retries(true);
});

for(const delayedGrace of [{gap:2,delay:850},{gap:900,delay:900}])nativeTest(`disposal delayed callbacks: earlier cutoff leaves disposal grace intact (${delayedGrace.gap} ms gap)`,async t=>{
  const x=setup(t,{stage:'refresh',mode:'block',delayedGrace}),h=await x.open(x.options);
  const result=await h.refreshContextIndex({readSet:[personal],types:['memory'],intent:'current',mode:'lexical',budget:{maxItems:1,maxMs:1000}},x.s.token);
  assert.equal(result.error.code,'read_timeout');while(!x.state[0])await realDelay(1);
  const parentCutoff=x.readerCutoff-delayedGrace.gap;
  const first=disposeProductReader(h,'read_timeout',delayedGrace.gap===2?parentCutoff:x.readerCutoff);
  const closed=first.catch(e=>e);
  assert.strictEqual(disposeProductReader(h,'read_timeout',parentCutoff),first,'repeated_disposal_keeps_the_owned_cleanup_promise');
  assert.strictEqual(disposeProductReader(h,'read_timeout',x.readerCutoff+1000),first);
  const disposalStarted=testClock.now();
  await testClock.advance(parentCutoff+1000-testClock.now(),{waitForWorkers:false});
  assert.equal(x.forced,0,'eligibility_deadline_never_shortens_disposal_grace');
  await testClock.advance(disposalStarted+10000-testClock.now(),{waitForWorkers:false});
  try{assert.equal(x.forced,1,'earlier_cutoff_preserves_bounded_disposal_grace');}
  finally{if(!x.forced){Atomics.store(x.state,1,1);Atomics.notify(x.state,1);}}
  await x.exits[0];assert.equal(x.workers[0].threadId,-1);assert.equal((await closed).code,'reader_failed');
  await x.retries(true);
});

// Private test replay of the unmodified native timer/monotonic imports.
function safetyReplay(){
  const originalDelay=timerPromises.setTimeout,originalHrtime=process.hrtime,wakes=[];let elapsed=0;
  const fakeHrtime=()=>[0,Math.round(elapsed*1e6)];fakeHrtime.bigint=originalHrtime.bigint;process.hrtime=fakeHrtime;
  timerPromises.setTimeout=(ms,value,{signal}={})=>new Promise((resolve,reject)=>{
    wakes.push({ms,signal,resolve:()=>resolve(value)});
    signal?.addEventListener('abort',()=>reject(Object.assign(Error('aborted'),{name:'AbortError'})),{once:true});
  });syncBuiltinESMExports();
  return {wakes,async wake(at){elapsed=at;const active=wakes.filter(w=>!w.signal.aborted).at(-1);assert.ok(active,'safety_timer_is_armed');active.resolve();await flush();},
    restore(){timerPromises.setTimeout=originalDelay;process.hrtime=originalHrtime;syncBuiltinESMExports();}};
}
for(const trigger of ['close','timeout'])nativeTest(`disposal frozen clock ${trigger}: replayed safety fallback ends a blocked host close`,async t=>{
  const x=setup(t,{mode:'block'});if(trigger==='close')x.disableCutoff();
  const h=trigger==='close'?await x.open(x.options):undefined,safety=safetyReplay();let closed;
  try{
    if(h)closed=h.close().catch(e=>e);else assert.equal((await x.open(x.options).catch(e=>e)).code,'read_timeout');
    while(!x.state[0]&&x.workers[0].threadId!==-1)await nativeDelay(1);
    const frozen=testClock.now();await safety.wake(10000);
    assert.equal(x.forced,1,'safety_fallback_terminates_with_a_frozen_injected_clock');
    await x.exits[0];assert.equal(testClock.now(),frozen,'safety_fallback_needs_no_injected_timer_delivery');
    if(closed)assert.equal((await closed).code,'reader_failed');
    assert.equal(x.readerTimers.size,0,'disposal_clears_all_operation_and_grace_timers');
    assert.ok(safety.wakes.every(w=>w.signal.aborted),'disposal_clears_safety_timers');
  }finally{safety.restore();Atomics.store(x.state,1,1);Atomics.notify(x.state,1);}
  assert.ok((await x.s.supervisor.drain()).some(r=>r.state==='failed'&&r.workerStopped));await x.retries(true);
});

// The existing P2-17/cancellation WAL timeout rendezvous exercise the native
// fallback without delivering grace callbacks; do not duplicate that real wait.

for(const earlier of [false,true])nativeTest(`disposal early safety wake: preserves 10000 ms monotonic deadline (earlier cutoff ${earlier})`,async t=>{
  const x=setup(t,{mode:'block'});x.disableCutoff();const h=await x.open(x.options);
  const grace=10000,originalDelay=timerPromises.setTimeout,originalHrtime=process.hrtime,wakes=[];let elapsed=0,closing;
  const fakeHrtime=()=>[0,Math.round(elapsed*1e6)];fakeHrtime.bigint=originalHrtime.bigint;
  process.hrtime=fakeHrtime;
  timerPromises.setTimeout=(ms,value,{signal}={})=>new Promise((resolve,reject)=>{
    const wake={ms,signal,resolve:()=>resolve(value)};wakes.push(wake);
    signal?.addEventListener('abort',()=>reject(Object.assign(Error('aborted'),{name:'AbortError'})),{once:true});
  });
  syncBuiltinESMExports();
  try{
    closing=h.close().catch(e=>e);
    if(earlier)disposeProductReader(h,'read_timeout',testClock.now()-950);
    const active=()=>wakes.filter(w=>!w.signal.aborted).at(-1);
    elapsed=grace-0.9;active().resolve();await flush();
    assert.equal(x.forced,0,'early_safety_wake_must_not_terminate_before_monotonic_deadline');
    assert.equal(active().ms,1,'early_wake_rearms_with_ceiling_of_remaining_ms');
    elapsed=grace;active().resolve();await flush();
    assert.equal(x.forced,1,'deadline_wake_terminates_exactly_once');
    for(const wake of wakes)wake.resolve();await flush();assert.equal(x.forced,1);
    assert.ok(wakes.every(w=>w.signal.aborted),'cleanup_aborts_every_safety_timer');
  }finally{
    timerPromises.setTimeout=originalDelay;process.hrtime=originalHrtime;syncBuiltinESMExports();
    Atomics.store(x.state,1,1);Atomics.notify(x.state,1);await closing;
  }
  await x.exits[0];assert.equal(x.workers[0].threadId,-1);
});

nativeTest('failure/disposal success: timeout is the only recorded failure',async t=>{
  const x=setup(t,{stage:'refresh',parentGap:true}),p=x.renew(x.config);x.pumps.push(p);
  for(let i=0;i<2;i++){const turn=await x.tick();await turn.pending;}
  const final=await p.completion;await p.close();
  assert.equal(final.error,'read_timeout','graceful disposal public timeout equals the disposal base');
  const r=readerDiagnostic.maintenanceReaderFailureDiagnostic(x.handles[0]),d=pumpDiagnostic.maintenancePumpDiagnostic(final);
  assert.equal(r.lastFailure.engineCode,'read_timeout','successful graceful disposal retains the reader timeout');
  assert.equal(d.lastFailure.engineCode,'read_timeout','successful graceful disposal retains the pump timeout');
  assert.equal(r.failureCounts.engine,1);assert.equal(d.failureCounts.engine,1);
  assert.equal(r.secondaryFailure,null,'successful graceful disposal creates no reader secondary');
  assert.equal(d.secondaryFailure,null,'successful graceful disposal creates no pump secondary');
  assert.ok(Object.values(r.secondaryFailureCounts).every(n=>n===0));assert.ok(Object.values(d.secondaryFailureCounts).every(n=>n===0));
  assert.equal(r.lastFailure.ordinal,d.lastFailure.ordinal,'graceful disposal retains the active dispatch ordinal');assert.deepEqual(d.lastFailure.stall,r.lastFailure.stall);
});

nativeTest('failure/disposal force: opening timeout keeps its primary and counts cleanup once',async t=>{
  const x=setup(t,{mode:'block'}),p=x.renew(x.config);x.pumps.push(p);const turn=await x.tick();
  while(!x.state[0]&&x.workers[0].threadId!==-1)await realDelay(1);
  await testClock.advance(9999,{waitForWorkers:false});assert.equal(x.forced,0,'host_keeps_full_disposal_grace');
  await testClock.advance(1,{waitForWorkers:false});await turn.pending;const final=await p.completion;
  assert.equal(x.forced,1,'forced disposal retains the bounded grace');assert.equal(final.error,'reader_failed','failed opening disposal public precedence equals the base');
  const r=readerDiagnostic.maintenanceReaderFailureDiagnostic(x.openingErrors[0]),d=pumpDiagnostic.maintenancePumpDiagnostic(final);
  assert.equal(r.lastFailure.engineCode,'read_timeout');assert.equal(d.lastFailure.engineCode,'read_timeout');
  assert.equal(r.secondaryFailureCounts.cleanup,1,'forced opening disposal records one reader cleanup secondary');
  assert.equal(r.secondaryFailure.cause,'cleanup');assert.equal(r.secondaryFailure.stage,'close');
  await x.retries(true);
  assert.equal(d.secondaryFailureCounts.cleanup,1,'forced opening disposal records one pump cleanup secondary');
  assert.equal(d.lastFailure.ordinal,r.lastFailure.ordinal);assert.deepEqual(d.lastFailure.stall,r.lastFailure.stall);
  await p.close().catch(()=>{});assert.equal(pumpDiagnostic.maintenancePumpDiagnostic(p.getStatus()).secondaryFailureCounts.cleanup,1,'repeated close does not recount forced disposal');
});

nativeTest('failure/disposal opening rejection: public reader_failed keeps the private timeout',async t=>{
  const x=setup(t,{mode:'reject'}),p=x.renew(x.config);x.pumps.push(p);const turn=await x.tick();await turn.pending;const final=await p.completion;
  assert.equal(final.error,'reader_failed','rejected opening disposal keeps public reader_failed');
  const r=readerDiagnostic.maintenanceReaderFailureDiagnostic(x.openingErrors[0]),d=pumpDiagnostic.maintenancePumpDiagnostic(final);
  assert.equal(r.lastFailure.engineCode,'read_timeout');assert.equal(d.lastFailure.engineCode,'read_timeout');
  assert.equal(r.secondaryFailureCounts.exception,1,'rejected_close_records_exception_once');
  assert.equal(x.closeFrames[0].maintenanceFailure.kind,'exception');assert.equal(x.closeFrames[0].maintenanceFailure.errorName,'Error');
  assert.equal(r.secondaryFailure.stage,'close');
  await x.retries(true);
  // Worker cleanup and the registry rejection are distinct K1 secondary events.
  assert.equal(r.secondaryFailureCounts.cleanup,2,'rejected opening cleanup reaches the reader private diagnostic');
  assert.equal(d.secondaryFailureCounts.cleanup,2,'rejected opening cleanup reaches the pump private diagnostic');
  assert.equal(d.lastFailure.ordinal,r.lastFailure.ordinal);assert.deepEqual(d.lastFailure.stall,r.lastFailure.stall);
});


nativeTest('failure/disposal error then exit: timeout remains primary and exit is retained',async t=>{
  const x=setup(t,{mode:'block'}),p=x.renew(x.config);x.pumps.push(p);const turn=await x.tick();
  while(!x.state[0]&&x.workers[0].threadId!==-1)await realDelay(1);
  x.workers[0].emit('error',new TypeError('synthetic disposal event'));
  await turn.pending;const final=await p.completion;
  assert.equal(final.error,'reader_failed');
  const r=readerDiagnostic.maintenanceReaderFailureDiagnostic(x.openingErrors[0]),d=pumpDiagnostic.maintenancePumpDiagnostic(final);
  assert.equal(r.lastFailure.engineCode,'read_timeout');assert.equal(d.lastFailure.engineCode,'read_timeout');
  assert.equal(r.secondaryFailureCounts.worker_exit,1,'disposal error then exit retains one reader exit secondary');
  assert.equal(d.secondaryFailureCounts.worker_exit,1,'disposal error then exit retains one pump exit secondary');
  assert.equal(r.secondaryFailureCounts.worker_error,1);assert.equal(r.secondaryFailureCounts.cleanup,1);
});

nativeTest('M2 bootstrap timeout preserves the rejected disposal cause when its promise is reused',async t=>{
  const x=setup(t,{stage:'bootstrap',mode:'bootstrap-reject'}),opening=x.open(x.options).catch(error=>error);
  while(!x.state[4])await realDelay(1);
  const closeFrames=[];x.workers[0].on('message',message=>{if(message.kind==='maintenance-close-failure')closeFrames.push(message);});
  await testClock.advance(5001,{waitForWorkers:false});const error=await opening;
  assert.equal(error.code,'read_timeout','bootstrap timeout preserves the public opening code');
  while(!x.state[6]&&x.workers[0].threadId!==-1)await realDelay(1);
  x.workers[0].postMessage({fixtureRelease:true});await x.s.supervisor.drain();await x.exits[0];
  assert.equal(x.state[5],1,'registered bootstrap close ran once');
  const d=readerDiagnostic.maintenanceReaderFailureDiagnostic(error);
  assert.equal(d.lastFailure.engineCode,'read_timeout','bootstrap cleanup retains the initiating timeout');
  assert.equal(closeFrames[0]?.maintenanceFailure?.kind,'exception','cached bootstrap disposal retains its exception metadata');
  assert.equal(closeFrames[0].maintenanceFailure.errorName,'TypeError');
  assert.equal(d.secondaryFailureCounts.exception,1,'bootstrap cleanup TypeError reaches the reader secondary diagnostic once');
  assert.equal(d.failureCounts.engine,1);assert.equal(d.failureCounts.exception,0);
});

nativeTest('P1R Worker-first bootstrap timeout keeps its disposal exception separate',async t=>{
  const x=setup(t,{stage:'bootstrap',mode:'bootstrap-reject'}),delayedTimers=new Map(),frames=[];
  let worker,exited,timerCallbacks=0;
  const open=createProductReaderRuntime({maintenance:true,
    setTimer(fn,ms){const id={unref(){}};delayedTimers.set(id,{fn:()=>{timerCallbacks++;fn();},ms});return id;},
    clearTimer:id=>delayedTimers.delete(id),
    spawnWorker(data){
      worker=new Worker(new URL('../context-product-worker.mjs',import.meta.url),{workerData:data,env:{},execArgv:[],stdout:true,stderr:true});
      worker.on('message',message=>frames.push(message));exited=new Promise(resolve=>worker.once('exit',resolve));return worker;
    }});
  const opening=open(x.options).catch(error=>error);
  while(!x.state[4])await realDelay(1);
  await testClock.advance(5001,{waitForWorkers:false});
  assert.equal(timerCallbacks,0,'parent deadline callbacks remain delayed');assert.equal(x.state[6],0,'parent close has not interrupted bootstrap');
  worker.postMessage({fixtureRelease:true});const error=await opening;
  assert.equal(error.code,'read_timeout','Worker-first bootstrap keeps the public timeout');
  await x.s.supervisor.drain();await exited;
  const initiating=frames.find(message=>message.result?.error?.code==='read_timeout');
  assert.equal(initiating?.maintenanceFailure?.engineCode,'read_timeout','Worker detected and reported its own cutoff first');
  assert.equal(timerCallbacks,0);assert.equal(x.state[5],1,'rejecting registered closer runs once');
  const d=readerDiagnostic.maintenanceReaderFailureDiagnostic(error);
  assert.equal(d.lastFailure.engineCode,'read_timeout');assert.equal(d.failureCounts.engine,1);
  assert.equal(d.secondaryFailureCounts.exception,1,'Worker-first bootstrap disposal records its TypeError once');
  assert.equal(d.secondaryFailureCounts.engine,0,'initiating timeout is never resent as a secondary');
  const disposal=frames.find(message=>message.kind==='maintenance-close-failure');
  assert.equal(disposal.maintenanceFailure.kind,'exception');assert.equal(disposal.maintenanceFailure.errorName,'TypeError');
});

// Advance only logical time at the registered host-close rendezvous. The close
// cannot finish until released, independently of machine scheduling speed.
for(const delay of [600,2000])for(const stage of ['open','refresh'])nativeTest(`disposal slow ${stage} timeout ${delay} ms: confirmed cleanup permits successors`,async t=>{
  const x=setup(t,{stage,mode:'block'}),p=x.renew(x.config);x.pumps.push(p);
  if(stage==='refresh'){const first=await x.tick();await first.pending;}
  const turn=await x.tick();while(!x.state[0]&&x.workers.at(-1).threadId!==-1)await realDelay(1);
  assert.equal(p.getStatus().error,'read_timeout','slow_close_never_delays_public_timeout');
  const before=x.spawned;await assert.rejects(x.open(x.options),{code:'read_in_progress'});assert.equal(x.spawned,before);
  await testClock.advance(delay,{waitForWorkers:false});
  assert.equal(x.forced,0,'slow_successful_close_is_not_forced_at_old_grace');
  Atomics.store(x.state,1,1);Atomics.notify(x.state,1);await turn.pending;
  assert.equal((await p.completion).error,'read_timeout','slow_confirmed_disposal_preserves_timeout');
  const records=await x.s.supervisor.drain();assert.ok(records.every(r=>r.state==='complete'&&['workerStopped','nativeDisposed','leasesReleased','providersSettled'].every(k=>r[k])));
  assert.equal(await x.exits.at(-1),0);await x.retries(false);
});

for(const delay of [600,2000])nativeTest(`disposal slow idle close ${delay} ms: confirmed cleanup permits successors`,async t=>{
  const x=setup(t,{mode:'block'});x.disableCutoff();const h=await x.open(x.options),closing=h.close().catch(e=>e);
  while(!x.state[0]&&x.workers[0].threadId!==-1)await realDelay(1);
  await testClock.advance(delay,{waitForWorkers:false});assert.equal(x.forced,0,'slow_idle_close_is_not_forced_at_old_grace');
  Atomics.store(x.state,1,1);Atomics.notify(x.state,1);assert.equal(await closing,undefined);
  assert.ok((await x.s.supervisor.drain()).every(r=>r.state==='complete'));await x.retries(false);
});

for(const {delay,earlier} of [{delay:600},{delay:1500},{delay:600,earlier:500}])nativeTest(`disposal eligibility ${delay} ms earlier ${earlier??0}: proof window is separate from cleanup grace`,async t=>{
  const x=setup(t,{stage:'refresh',mode:'block',qualified:true}),p=x.renew(x.config);x.pumps.push(p);
  const first=await x.tick();await first.pending;const turn=await x.tick();
  while(!x.state[0]&&x.workers.at(-1).threadId!==-1)await realDelay(1);
  if(earlier)disposeProductReader(x.handles.at(-1),'read_timeout',x.readerCutoff-earlier);
  await testClock.advance(delay,{waitForWorkers:false});
  assert.equal(x.forced,0,'eligibility_expiry_does_not_terminate_a_slow_close');
  for(const [id,timer]of [...x.timers])if(timer.at<=testClock.now()){x.timers.delete(id);timer.fn();}await flush();
  const late=delay>1000-(earlier??0);
  if(late)assert.equal(readerDiagnostic.maintenancePumpCutoffDiagnostic(p.getStatus()).outcome,2,'late_proof_ends_only_expedited_eligibility');
  Atomics.store(x.state,1,1);Atomics.notify(x.state,1);await turn.pending;
  const diagnostic=readerDiagnostic.maintenancePumpCutoffDiagnostic(p.getStatus());
  assert.equal(diagnostic.outcome,late?2:1,'only_timely_proof_earns_expedited_recovery');
  assert.equal(p.getStatus().state,late?'failed':'active');
  if(late)assert.equal((await p.completion).error,'read_timeout');
  assert.ok((await x.s.supervisor.drain()).every(r=>r.state==='complete'),'late_confirmed_disposal_never_quarantines');
  await p.close();await x.retries(false);
});

for(const action of ['supervisor','idle-expiry','in-flight','opening'])for(const delay of [600,2000,'hang'])
nativeTest(`disposal lifecycle ${action} ${delay}: lease cleanup controls quarantine`,async t=>{
  const x=setup(t,{request:true,stage:action==='opening'?'bootstrap':'open',mode:'block',callGate:action==='in-flight'});x.disableCutoff();
  let h,call,closing;
  if(action==='opening'){
    call=x.open(x.options).catch(e=>e);while(!x.state[4])await nativeDelay(1);
  }else h=await x.open(x.options);
  if(action==='in-flight'){
    call=h.fetchCandidateEvidence({readSet:[personal],intent:'current',deadlineMs:5000,refs:[{type:'memory',namespace:personal,memoryId:x.memory.id,revision:x.memory.revision}]},x.s.token);
    while(!x.state[3])await nativeDelay(1);
  }
  const closedOwner=action!=='idle-expiry';
  if(closedOwner)closing=x.s.supervisor.close().catch(e=>e);
  else await testClock.advance(60000,{waitForWorkers:false});
  if(call){const result=await call;assert.equal(action==='opening'?result.code:result.error.code,'store_closed','supervisor_close_settles_pending_call_before_disposal');}
  assert.equal(x.closeSent.length,1,'lifecycle_store_closed_sends_graceful_close');
  assert.equal(x.forced,0,'lifecycle_store_closed_never_forces_before_grace');
  if(action==='opening')x.workers[0].postMessage({fixtureRelease:true});
  if(action==='in-flight'){Atomics.store(x.state,7,1);Atomics.notify(x.state,7);}
  while(!x.state[0]&&x.workers[0].threadId!==-1)await nativeDelay(1);
  assert.equal(x.state[0],1,'lifecycle_shutdown_reaches_registered_host_close');
  if(!closedOwner)closing=h.close().catch(e=>e);
  assert.ok([...supervisorOwner(x.s.supervisor).owner.records].every(r=>r.cleaning&&r.state==='pending'),'opening_and_call_records_wait_for_actual_disposal');
  const freshOptions=supervisor=>{const s=configured({after(){}},x.f.path,[personal],{supervisor});return {...s.options,host:{moduleUrl:hostUrl,configuration:{...s.options.host.configuration,disposalState:x.state.buffer}}};};
  const other=createContextReadSupervisor();t.after(()=>other.close().catch(()=>{}));const before=x.spawned;
  await assert.rejects(x.open(freshOptions(x.s.supervisor)),{code:closedOwner?'store_closed':'read_in_progress'},'original_supervisor_preserves_closed_or_pending_contract');
  await assert.rejects(x.open(freshOptions(other)),{code:'read_in_progress'},'pending_disposal_blocks_request_opens_across_supervisors');assert.equal(x.spawned,before);
  if(delay==='hang'){
    await testClock.advance(9999,{waitForWorkers:false});assert.equal(x.forced,0,'lifecycle_hang_keeps_full_grace');
    await testClock.advance(1,{waitForWorkers:false});assert.equal(x.forced,1,'lifecycle_hang_forces_at_disposal_bound');
    assert.equal((await closing).code,'reader_failed');
  }else{
    await testClock.advance(delay,{waitForWorkers:false});assert.equal(x.forced,0,'lifecycle_slow_close_is_not_forced');
    Atomics.store(x.state,1,1);Atomics.notify(x.state,1);assert.notEqual((await closing)?.code,'reader_failed');
  }
  const records=await x.s.supervisor.drain();assert.equal(records.length,action==='in-flight'?2:1,'opening_and_call_records_share_disposal_proof');
  assert.ok(records.every(r=>r.workerStopped&&r.nativeDisposed));
  if(delay==='hang')assert.ok(records.some(r=>r.state==='failed'&&!r.leasesReleased),'unproven_resource_keeps_store_quarantined');
  else assert.ok(records.every(r=>r.state==='complete'&&r.leasesReleased&&r.providersSettled));
  assert.equal(await x.exits[0],delay==='hang'?1:0);assert.equal(x.readerTimers.size,0);
  await x.retries(delay==='hang',{closedOwner});
});

nativeTest('disposal lifecycle cancellation: pending request terminates immediately without graceful close',async t=>{
  const x=setup(t,{request:true,mode:'block',callGate:true});x.disableCutoff();const h=await x.open(x.options),abort=new AbortController(),frozen=testClock.now();
  const call=h.fetchCandidateEvidence({readSet:[personal],intent:'current',deadlineMs:5000,refs:[{type:'memory',namespace:personal,memoryId:x.memory.id,revision:x.memory.revision}]},x.s.token,{signal:abort.signal});
  while(!x.state[3])await nativeDelay(1);abort.abort();
  assert.equal((await call).error.code,'read_cancelled');assert.equal(x.forced,1,'cancellation_terminates_without_waiting_for_grace');
  assert.equal(x.closeSent.length,0,'cancellation_never_sends_graceful_close');await x.exits[0];
  assert.equal(testClock.now(),frozen);assert.equal(x.readerTimers.size,0);
  assert.ok((await x.s.supervisor.drain()).some(r=>r.state==='failed'&&!r.leasesReleased));await x.retries(true);
});

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
import { createProductReaderRuntime,disposeProductReader } from '../context-product-reader.mjs';
import { createMaintenancePumpRuntime } from '../context-product-pump.mjs';
const retained=[];after(async()=>{for(const cleanup of retained)await cleanup();});
const hostUrl=new URL('../testing/context-product-disposal-host.mjs',import.meta.url).href;
const flush=async()=>{for(let i=0;i<40;i++)await Promise.resolve();};
function nativeTest(name,body){test(name,async t=>{
  const abort=new AbortController();
  try{await Promise.race([body(t),realDelay(60000,undefined,{signal:abort.signal}).then(async()=>{await testClock.advance(10000,{waitForWorkers:false});assert.fail('disposal_test_watchdog');})]);}
  finally{abort.abort();}
});}
function setup(t,{stage='open',mode='normal',request=false,tail,parentGap=false,delayedGrace}={}) {
  // Pin canonical identities until all process-wide quarantine probes finish.
  const f=fixture({after:fn=>retained.push(fn)}),memory=f.admit('Synthetic lease disposal memory.',personal),supervisors=[],pumps=[];
  // Failed cleanup is asserted explicitly, rather than hidden by an after hook.
  const owner={after:fn=>t.after(()=>Promise.resolve(fn()).catch(()=>{}))};
  const s=configured(owner,f.path,[personal],{service:!request}),disposalState=new SharedArrayBuffer(32),state=new Int32Array(disposalState);
  supervisors.push(s.supervisor);let injected=false,responses=0,spawned=0,injectEnabled=true,acceptedBetweenDeadlines=false,forced=0,readerCutoff;const resources=[],workers=[],exits=[];
  const spawnWorker=data=>{
    spawned++;const w=new Worker(new URL('../context-product-worker.mjs',import.meta.url),{workerData:data,env:{},execArgv:[],stdout:true,stderr:true});
    const terminate=w.terminate.bind(w);w.terminate=()=>{forced++;return terminate();};
    workers.push(w);resources.push(new Int32Array(data.resources));exits.push(new Promise(resolve=>w.once('exit',resolve)));
    w.on('message',m=>{
      if(m.result?.ok && m.result.value!==null)responses++;
      const selected=stage==='open'?m.result?.ok && m.result.value===null:m.result?.ok && m.result.value!==null && responses===(request||delayedGrace?1:2);
      if(injectEnabled && !injected && selected){injected=true;const cutoff=Number(BigInt(m.operation.operationCutoffMonoNs))/1e6;readerCutoff=cutoff;
        void testClock.advance(Math.max(1,Math.ceil(cutoff-testClock.now()+(delayedGrace?delayedGrace.delay-delayedGrace.gap:parentGap?-1:1))),{waitForWorkers:false});
        if(parentGap){const due=[...timers].find(([,timer])=>timer.at<=testClock.now());assert.ok(due,'parent_deadline_precedes_accepted_response');timers.delete(due[0]);due[1].fn();}}
    });return w;
  };
  const open=createProductReaderRuntime({maintenance:!request,spawnWorker}),timers=new Map();let serial=0;
  const pumpOpen=parentGap?async(...args)=>{const h=await open(...args);return {...h,refreshContextIndex(...call){void testClock.advance(2,{waitForWorkers:false});return h.refreshContextIndex(...call).then(result=>{if(injected)acceptedBetweenDeadlines=result.ok;return result;});}};}:open;
  const renew=createMaintenancePumpRuntime({open:pumpOpen,now:testClock.now,setTimer:(fn,ms)=>{const id=++serial;timers.set(id,{fn,at:testClock.now()+ms});return id;},clearTimer:id=>timers.delete(id)});
  const options={...s.options,host:{moduleUrl:hostUrl,configuration:{...s.options.host.configuration,disposalState,disposalMode:mode,bootstrapGate:stage==='bootstrap'}}};
  const config={supervisor:s.supervisor,id:randomUUID(),window:{id:randomUUID(),endsAtMonoMs:testClock.now()+(tail==='window'?1056:60000),usedItems:0,usedMs:0},
    budgets:{maxItems:10000,maxMs:60000},quantum:{maxItems:1,maxMs:1000},pollMs:1000,renewalMs:tail==='renewal'?1056:60000,serviceCredential:s.token,projections:[{options,types:['memory']}]};
  async function tick(){const [id,v]=[...timers].sort((a,b)=>a[1].at-b[1].at)[0];timers.delete(id);
    await testClock.advance(Math.max(0,Math.ceil(v.at-testClock.now())),{waitForWorkers:false});const pending=v.fn();await flush();return {pending};}
  async function retries(failed){
    const before=spawned;
    for(const supervisor of [s.supervisor,createContextReadSupervisor()]){
      if(!supervisors.includes(supervisor))supervisors.push(supervisor);
      let opts={...options,supervisor};
      if(request){const fresh=configured(owner,f.path,[personal],{supervisor});opts={...fresh.options,host:{moduleUrl:hostUrl,configuration:{...fresh.options.host.configuration,disposalState}}};}
      if(failed)await assert.rejects(open(opts),{code:'reader_failed'},'same_and_new_supervisor_keep_unproven_quarantine');
      else {const h=await open(opts);await h.close();}
    }
    assert.equal(spawned,before+(failed?0:2),failed?'quarantined_retries_create_no_worker':'confirmed_disposal_allows_both_supervisors');
  }
  f.workspace.defer(async()=>{Atomics.store(state,1,1);Atomics.notify(state,1);
    for(const p of pumps)await p.close().catch(()=>{});for(const supervisor of supervisors)await supervisor.close().catch(()=>{});});
  return {f,s,memory,options,open,config,renew,state,resources,workers,exits,timers,tick,retries,pumps,disableCutoff(){injectEnabled=false;},get spawned(){return spawned;},get injected(){return injected;},get acceptedBetweenDeadlines(){return acceptedBetweenDeadlines;},get forced(){return forced;},get readerCutoff(){return readerCutoff;}};
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
  await testClock.advance(500,{waitForWorkers:false});await turn.pending;await p.completion;await p.close().catch(()=>{});
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
  await testClock.advance(499,{waitForWorkers:false});
  await testClock.advance(1,{waitForWorkers:false});await flush();
  try{assert.equal(x.forced,1,'parent_timeout_forces_blocked_close_within_proof_bound');}
  finally{if(!x.forced){Atomics.store(x.state,1,1);Atomics.notify(x.state,1);}}
  await x.exits[0];assert.equal(x.workers[0].threadId,-1);
  await turn.pending;assert.equal((await p.completion).error,'reader_failed');
  const records=await x.s.supervisor.drain();assert.ok(records.some(r=>r.state==='failed'&&r.workerStopped));await x.retries(true);
});
nativeTest('disposal ordinary close: blocked host cannot retain a live Worker indefinitely',async t=>{
  const x=setup(t,{mode:'block'});x.disableCutoff();const h=await x.open(x.options),closing=h.close().catch(e=>e);
  while(!x.state[0])await realDelay(1);await testClock.advance(499,{waitForWorkers:false});
  await testClock.advance(1,{waitForWorkers:false});
  try{assert.equal(x.forced,1,'ordinary_close_forces_blocked_host_within_bound');}
  finally{if(!x.forced){Atomics.store(x.state,1,1);Atomics.notify(x.state,1);}}
  await x.exits[0];assert.equal(x.workers[0].threadId,-1);
  assert.equal((await closing).code,'reader_failed');await x.retries(true);
});
for(const mode of ['reject','block'])nativeTest(`disposal opening ${mode}: failed drain overrides the triggering timeout`,async t=>{
  const x=setup(t,{mode}),p=x.renew(x.config);x.pumps.push(p);const turn=await x.tick();
  while(!x.state[0] && x.workers[0].threadId!==-1)await realDelay(1);
  await testClock.advance(500,{waitForWorkers:false});await turn.pending;
  assert.equal((await p.completion).error,'reader_failed','failed_opening_disposal_has_reader_failed_precedence');
  const records=await x.s.supervisor.drain();assert.ok(records.some(r=>r.state==='failed'));await x.retries(true);
});

for(const delayedGrace of [{gap:2,delay:850},{gap:900,delay:900}])nativeTest(`disposal delayed callbacks: earlier cutoff tightens running grace (${delayedGrace.gap} ms gap)`,async t=>{
  const x=setup(t,{stage:'refresh',mode:'block',delayedGrace}),h=await x.open(x.options);
  const result=await h.refreshContextIndex({readSet:[personal],types:['memory'],intent:'current',mode:'lexical',budget:{maxItems:1,maxMs:1000}},x.s.token);
  assert.equal(result.error.code,'read_timeout');while(!x.state[0])await realDelay(1);
  const parentCutoff=x.readerCutoff-delayedGrace.gap;
  const first=disposeProductReader(h,'read_timeout',delayedGrace.gap===2?parentCutoff:x.readerCutoff);
  const closed=first.catch(e=>e);
  assert.strictEqual(disposeProductReader(h,'read_timeout',parentCutoff),first,'repeated_disposal_keeps_the_owned_cleanup_promise');
  assert.strictEqual(disposeProductReader(h,'read_timeout',x.readerCutoff+1000),first);
  await testClock.advance(parentCutoff+999-testClock.now(),{waitForWorkers:false});
  await testClock.advance(1,{waitForWorkers:false});
  try{assert.equal(x.forced,1,'earlier_cutoff_tightens_running_grace_by_earliest_proof_boundary');}
  finally{if(!x.forced){Atomics.store(x.state,1,1);Atomics.notify(x.state,1);}}
  await x.exits[0];assert.equal(x.workers[0].threadId,-1);assert.equal((await closed).code,'reader_failed');
  await x.retries(true);
});

for(const trigger of ['close','timeout'])nativeTest(`disposal frozen clock ${trigger}: real safety fallback ends a blocked host close`,async t=>{
  const x=setup(t,{mode:'block'});if(trigger==='close')x.disableCutoff();
  let closed;
  if(trigger==='close'){const h=await x.open(x.options);closed=h.close().catch(e=>e);}
  else assert.equal((await x.open(x.options).catch(e=>e)).code,'read_timeout');
  while(!x.state[0] && x.workers[0].threadId!==-1)await realDelay(1);
  const frozen=testClock.now();
  // The outer hang watchdog bounds the test; initiation and native exit are
  // separate rendezvous, so parent scheduling pauses cannot win an exit race.
  while(!x.forced)await realDelay(1);
  assert.equal(x.forced,1,'real_time_fallback_terminates_with_a_frozen_injected_clock');
  await x.exits[0];
  assert.equal(testClock.now(),frozen,'safety_fallback_needs_no_injected_timer_delivery');
  assert.equal(x.forced,1);assert.equal(x.workers[0].threadId,-1);
  if(closed)assert.equal((await closed).code,'reader_failed');
  assert.ok((await x.s.supervisor.drain()).some(r=>r.state==='failed'&&r.workerStopped));await x.retries(true);
});

for(const grace of [500,50])nativeTest(`disposal early safety wake: preserves ${grace} ms monotonic deadline`,async t=>{
  const x=setup(t,{mode:'block'});x.disableCutoff();const h=await x.open(x.options);
  const originalDelay=timerPromises.setTimeout,originalHrtime=process.hrtime,wakes=[];let elapsed=0,closing;
  const fakeHrtime=()=>[0,Math.round(elapsed*1e6)];fakeHrtime.bigint=originalHrtime.bigint;
  process.hrtime=fakeHrtime;
  timerPromises.setTimeout=(ms,value,{signal}={})=>new Promise((resolve,reject)=>{
    const wake={ms,signal,resolve:()=>resolve(value)};wakes.push(wake);
    signal?.addEventListener('abort',()=>reject(Object.assign(Error('aborted'),{name:'AbortError'})),{once:true});
  });
  syncBuiltinESMExports();
  try{
    closing=h.close().catch(e=>e);
    if(grace===50)disposeProductReader(h,'read_timeout',testClock.now()-950);
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

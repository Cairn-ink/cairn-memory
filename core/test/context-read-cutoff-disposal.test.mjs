import { testClock } from '../testing/context-product-test-clock.mjs';
import test,{after} from 'node:test';
import assert from 'node:assert/strict';
import { Worker } from 'node:worker_threads';
import { setTimeout as realDelay } from 'node:timers/promises';
import { randomUUID } from 'node:crypto';
import { fixture } from '../testing/context-read-fixture.mjs';
import { personal,configured } from '../testing/context-product-owner-fixture.mjs';
import { createContextReadSupervisor } from '../index.mjs';
import { createProductReaderRuntime } from '../context-product-reader.mjs';
import { createMaintenancePumpRuntime } from '../context-product-pump.mjs';
const retained=[];after(async()=>{for(const cleanup of retained)await cleanup();});
const hostUrl=new URL('../testing/context-product-disposal-host.mjs',import.meta.url).href;
const flush=async()=>{for(let i=0;i<40;i++)await Promise.resolve();};
function nativeTest(name,body){test(name,async t=>{
  const abort=new AbortController();
  try{await Promise.race([body(t),realDelay(30000,undefined,{signal:abort.signal}).then(async()=>{await testClock.advance(10000,{waitForWorkers:false});assert.fail('disposal_test_watchdog');})]);}
  finally{abort.abort();}
});}
function setup(t,{stage='open',mode='normal',request=false,tail}={}) {
  // Pin canonical identities until all process-wide quarantine probes finish.
  const f=fixture({after:fn=>retained.push(fn)}),memory=f.admit('Synthetic lease disposal memory.',personal),supervisors=[],pumps=[];
  // Failed cleanup is asserted explicitly, rather than hidden by an after hook.
  const owner={after:fn=>t.after(()=>Promise.resolve(fn()).catch(()=>{}))};
  const s=configured(owner,f.path,[personal],{service:!request}),disposalState=new SharedArrayBuffer(32),state=new Int32Array(disposalState);
  supervisors.push(s.supervisor);let injected=false,responses=0,spawned=0,injectEnabled=true;const resources=[],workers=[],exits=[];
  const spawnWorker=data=>{
    spawned++;const w=new Worker(new URL('../context-product-worker.mjs',import.meta.url),{workerData:data,env:{},execArgv:[],stdout:true,stderr:true});
    workers.push(w);resources.push(new Int32Array(data.resources));exits.push(new Promise(resolve=>w.once('exit',resolve)));
    w.on('message',m=>{
      if(m.result?.ok && m.result.value!==null)responses++;
      const selected=stage==='open'?m.result?.ok && m.result.value===null:m.result?.ok && m.result.value!==null && responses===(request?1:2);
      if(injectEnabled && !injected && selected){injected=true;const cutoff=Number(BigInt(m.operation.operationCutoffMonoNs))/1e6;
        void testClock.advance(Math.max(1,Math.ceil(cutoff-testClock.now()+1)),{waitForWorkers:false});}
    });return w;
  };
  const open=createProductReaderRuntime({maintenance:!request,spawnWorker}),timers=new Map();let serial=0;
  const renew=createMaintenancePumpRuntime({open,now:testClock.now,setTimer:(fn,ms)=>{const id=++serial;timers.set(id,{fn,at:testClock.now()+ms});return id;},clearTimer:id=>timers.delete(id)});
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
  return {f,s,memory,options,open,config,renew,state,resources,workers,exits,timers,tick,retries,pumps,disableCutoff(){injectEnabled=false;},get spawned(){return spawned;},get injected(){return injected;}};
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

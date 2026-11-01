// Every native Worker and parent timer uses the same injected clock.
import { testClock } from '../testing/context-product-test-clock.mjs';
import assert from 'node:assert/strict';
import { linkSync } from 'node:fs';
import { join } from 'node:path';
import * as reader from '../context-product-reader.mjs';
import { nativeTest, setup, guard, until, tracked, flush } from './fixtures/context-read-registry-hold-fixture.mjs';
const bits = ['workerStopped','nativeDisposed','leasesReleased','providersSettled'];
function diagnostic(value,outcome,ms) {
  const d=reader.readerRegistryHoldDiagnostic?.(value);
  assert.ok(d,'private_hold_diagnostic_is_present');assert.equal(d.outcome,outcome);
  assert.ok(d.waits>=1);assert.equal(d.lastWaitMs,ms);assert.ok(Object.isFrozen(d));
  assert.deepEqual(Object.keys(d).sort(),['lastWaitMs','outcome','waitMs','waits']);
  assert.equal(Object.hasOwn(value,'registryHold'),false,'public_DTO_has_no_hold_field');
}

for(const service of [false,true])for(const stage of ['open','call'])nativeTest(`registry hold two owners ${service?'maintenance':'request'} ${stage}`,async t=>{
  const s=await setup(t,{global:!service&&stage==='open'}),a=s.configuration(0,{service,mode:'block'}),b=s.configuration(1,{service});
  assert.notEqual(a.binding.ownerId,b.binding.ownerId);assert.notDeepEqual(a.options.readSet,b.options.readSet);
  assert.equal(a.options.path,b.options.path);assert.equal(a.options.host.moduleUrl,b.options.host.moduleUrl);
  const ah=await s.open(a),bh=stage==='call'?await s.open(b):null,p=s.proof(a),closing=await s.closing(a,ah),before=s.captures.length;
  const pending=tracked(stage==='open'?s.open(b):bh.getContextIndexStatus({readSet:b.options.readSet,types:['memory'],intent:'current',deadlineMs:3000},b.token));
  await flush();assert.equal(pending.settled,false,'other_owner_waits_for_disposal_proof');
  assert.equal(s.captures.length,before,'held_open_never_spawns');
  if(bh)assert.equal(s.captures[1].sent.some(m=>m.method==='getContextIndexStatus'),false,'held_call_never_dispatches');
  await testClock.advance(600,{waitForWorkers:false});s.release(a);await guard(closing.promise,'proof');
  const value=await guard(pending.promise,'other owner resumes');assert.equal(pending.error,undefined,'completed_proof_admits_other_owner');
  assert.ok(bits.every(bit=>p.status()[bit]));assert.equal(p.status().state,'complete');
  diagnostic(value,1,600);if(bh)assert.equal(value.ok,true);else await value.close();
});

for(const service of [false,true])nativeTest(`registry hold same owner ${service?'writer':'request'} predecessor`,async t=>{
  const s=await setup(t),a=s.configuration(0,{service,mode:'block'}),ah=await s.open(a),closing=await s.closing(a,ah);
  const b=s.configuration(0,{service}),pending=tracked(s.open(b));await flush();
  assert.equal(pending.settled,false,'same_owner_waits_without_replacing_writer');assert.equal(s.captures.length,1);
  await testClock.advance(2000,{waitForWorkers:false});s.release(a);await closing.promise;
  const h=await guard(pending.promise,'same owner');assert.equal(pending.error,undefined,'successor_claims_writer_after_proof');diagnostic(h,1,2000);await h.close();
});

for(const alias of [false,true])nativeTest(`registry hold identity acknowledgement ${alias?'alias':'race'}`,async t=>{
  const s=await setup(t),a=s.configuration(0,{mode:'block'}),ah=await s.open(a);let close;
  const path=alias?join(s.f.workspace.path,'alias.sqlite'):s.f.path;if(alias)linkSync(s.f.path,path);
  const b=s.configuration(1,{path});if(alias)close=await s.closing(a,ah);
  const native=s.runtime(false,(m)=>{if(!alias&&m.kind==='identity'&&!close)close=tracked(ah.close());});
  const pending=tracked(native(b.options));await until(()=>a.state[0]===1&&s.captures.length===2&&s.captures[1].received.some(m=>m.kind==='identity'),'identity held');await flush();
  assert.equal(pending.settled,false,'identity_bind_waits_instead_of_refusing');
  assert.equal(s.captures[1].resources[0],0,'no_host_or_native_connection_before_identity_ack');
  assert.equal(s.captures[1].sent.some(m=>m.kind==='identity-ack'),false);
  await testClock.advance(100,{waitForWorkers:false});s.release(a);await close.promise;
  const h=await guard(pending.promise,'identity acknowledgement');assert.equal(pending.error,undefined);diagnostic(h,1,100);await h.close();
});

for(const stage of ['open','call'])nativeTest(`registry hold short ${stage} deadline has no late dispatch`,async t=>{
  const s=await setup(t),a=s.configuration(0,{mode:'block'}),b=s.configuration(1),ah=await s.open(a),bh=stage==='call'?await s.open(b):null;
  const closing=await s.closing(a,ah),before=s.captures.length;
  const pending=tracked(stage==='open'?s.open(b,{deadlineMs:100}):bh.getContextIndexStatus({readSet:b.options.readSet,types:['memory'],intent:'current',deadlineMs:100},b.token));
  await flush();assert.equal(pending.settled,false,'deadline_wait_is_pending_before_cutoff');
  await testClock.advance(99,{waitForWorkers:false});assert.equal(pending.settled,false);
  await testClock.advance(1,{waitForWorkers:false});const value=await guard(pending.promise,'hold deadline');
  assert.equal(stage==='open'?value.code:value.error.code,'read_in_progress','caller_deadline_refuses_hold');diagnostic(value,3,100);
  s.release(a);await closing.promise;await flush();assert.equal(s.captures.length,before,'expired_open_never_spawns_later');
  if(bh){assert.equal(s.captures[1].sent.some(m=>m.method==='getContextIndexStatus'),false);assert.equal((await bh.getContextIndexStatus({readSet:b.options.readSet,types:['memory'],intent:'current',deadlineMs:100},b.token)).ok,true,'undispatched_refusal_keeps_resident_healthy');}
});

for(const stage of ['open','call'])nativeTest(`registry hold failed proof wakes another owner ${stage} with reader_failed`,async t=>{
  const s=await setup(t,{failed:true}),a=s.configuration(0,{mode:'reject'}),b=s.configuration(1),ah=await s.open(a),p=s.proof(a),bh=stage==='call'?await s.open(b):null;
  const closing=tracked(ah.close()),pending=tracked(bh?bh.getContextIndexStatus({readSet:b.options.readSet,types:['memory'],intent:'current',deadlineMs:1000},b.token):s.open(b));await closing.promise;
  const failure=await guard(pending.promise,'failed hold');assert.equal(bh?failure.error.code:failure.code,'reader_failed','failed_proof_wakes_with_reader_failed');
  assert.equal(p.status().state,'failed');assert.equal(p.status().leasesReleased,false);assert.equal(s.captures.length,bh?2:1);
  if(bh)assert.equal(s.captures[1].sent.some(m=>m.method==='getContextIndexStatus'),false);
  diagnostic(failure,2,0);
});

for(const mode of ['reject','block'])nativeTest(`registry hold control: latched ${mode} quarantine still refuses`,async t=>{
  const s=await setup(t,{failed:true}),a=s.configuration(0,{mode}),ah=await s.open(a),closing=await s.closing(a,ah);
  if(mode==='block')await testClock.advance(10000,{waitForWorkers:false});await closing.promise;
  assert.equal(s.proof(a).status().state,'failed');assert.equal(s.proof(a).status().leasesReleased,false);
  const before=s.registry.counters(),b=s.configuration(1);await assert.rejects(s.open(b),{code:'reader_failed'},'unproven_file_quarantine_is_unchanged');assert.equal(s.captures.length,1);
  assert.deepEqual(s.registry.counters(),before,'failed_hold_refusal_adds_no_records_or_reservations');
});

nativeTest('registry hold rechecks a third owner entering cleanup before wake',async t=>{
  const s=await setup(t),a=s.configuration(0,{mode:'block'}),c=s.configuration(2,{mode:'block'}),b=s.configuration(1),ah=await s.open(a),ch=await s.open(c),ar=s.proof(a).record;
  const finish=s.registry.finish;let cc;
  s.registry.finish=(record,...args)=>{const value=finish(record,...args);if(record===ar&&!cc)cc=tracked(ch.close());return value;};
  const ac=await s.closing(a,ah),pending=tracked(s.open(b));await flush();assert.equal(pending.settled,false,'first_hold_waits');
  s.release(a);await ac.promise;await until(()=>c.state[0]===1,'third cleanup');await flush();
  assert.equal(pending.settled,false,'wakeup_rechecks_third_cleanup');assert.equal(s.captures.length,2);
  await testClock.advance(100,{waitForWorkers:false});s.release(c);await cc.promise;
  const h=await pending.promise;assert.equal(pending.error,undefined);diagnostic(h,1,100);await h.close();
});

nativeTest('registry hold waiters consume the live cap and detach at deadlines',async t=>{
  const s=await setup(t,{limit:3}),a=s.configuration(0,{mode:'block'}),ah=await s.open(a),closing=await s.closing(a,ah);
  const pending=[0,1].map(()=>tracked(s.open(s.configuration(1),{deadlineMs:100})));
  await flush();assert.equal(s.registry.counters().live,3,'waiting_records_consume_live_capacity');assert.equal(s.registry.waiting(),2);const arms=s.timerArms;
  for(let n=0;n<16;n++){const extra=await s.open(s.configuration(2)).catch(e=>e);assert.equal(extra.code,'read_in_progress','waiter_capacity_refuses_without_worker');}
  assert.equal(s.captures.length,1);assert.equal(s.registry.counters().records,3,'repeated_capacity_refusals_add_no_records');assert.equal(s.registry.counters().reservations,9);assert.equal(s.timerArms,arms,'capacity_refusals_add_no_wait_timers');
  await flush();assert.equal(s.timerArms,arms,'frozen_clock_has_no_polling_or_busy_loop');
  await testClock.advance(100,{waitForWorkers:false});for(const p of pending)assert.equal((await p.promise).code,'read_in_progress');
  assert.equal(s.registry.waiting(),0,'deadline_removes_every_waiter_and_timer');assert.equal(s.registry.counters().live,1);assert.equal(s.timers.size,1,'only_existing_disposal_grace_timer_remains');
  s.release(a);await closing.promise;assert.equal(s.captures.length,1,'capacity_waiters_never_open_late');assert.equal(s.timers.size,0);
});

for(const action of ['abort','supervisor'])nativeTest(`registry hold ${action} detaches a waiting opening`,async t=>{
  const s=await setup(t),a=s.configuration(0,{mode:'block'}),b=s.configuration(1),ah=await s.open(a),closing=await s.closing(a,ah),abort=new AbortController();
  const pending=tracked(s.runtime()(b.options,{signal:abort.signal}));await flush();assert.equal(pending.settled,false,'cancel_target_waits_before_dispatch');
  if(action==='abort')abort.abort();else await b.options.supervisor.close();
  assert.equal((await pending.promise).code,action==='abort'?'read_cancelled':'store_closed');assert.equal(s.registry.waiting(),0);
  s.release(a);await closing.promise;assert.equal(s.captures.length,1,'cancelled_admission_never_spawns');
});

// Passing control: queue metadata capacity retains the old hold refusal; it
// does not add a new accepted identity or an unbounded retained IPC object.
nativeTest('registry hold control: oversized identity cannot become a waiter',async t=>{
  const s=await setup(t),a=s.configuration(0,{mode:'block'}),b=s.configuration(1),ah=await s.open(a);let closing;
  const open=s.runtime(false,m=>{if(m.kind==='identity'){m.fileIdentity='1:'+ '9'.repeat(129);closing=tracked(ah.close());}});
  const error=await open(b.options).catch(e=>e);assert.equal(error.code,'read_in_progress');
  assert.equal(s.registry.waiting?.()??0,0,'oversized_wait_metadata_is_not_retained');
  assert.equal(s.captures[1].resources[0],0,'oversized_identity_never_opens_native_connection');
  s.release(a);await closing.promise;
});

for(const stage of ['open','call'])nativeTest(`registry hold forced disposal keeps ${stage} blocked to its deadline`,async t=>{
  const s=await setup(t,{failed:true}),a=s.configuration(0,{mode:'block'}),b=s.configuration(1,{service:stage==='call'}),ah=await s.open(a),bh=stage==='call'?await s.open(b):null,p=s.proof(a);
  const closing=await s.closing(a,ah),before=s.captures.length;
  const pending=tracked(bh?bh.getContextIndexStatus({readSet:b.options.readSet,types:['memory'],intent:'current',deadlineMs:100},b.token):s.open(b,{deadlineMs:100}));
  await flush();assert.equal(pending.settled,false,'forced_disposal_does_not_grant_early_admission');
  await testClock.advance(100,{waitForWorkers:false});const value=await pending.promise;assert.equal(bh?value.error.code:value.code,'read_in_progress');
  diagnostic(value,3,100);assert.equal(s.captures.length,before);
  await testClock.advance(9900,{waitForWorkers:false});await closing.promise;assert.equal(p.status().state,'failed');assert.equal(p.status().nativeDisposed,true);assert.equal(p.status().leasesReleased,false);
  const c=s.configuration(2);await assert.rejects(s.open(c),{code:'reader_failed'});assert.equal(s.captures.length,before,'unproven_native_exit_never_opens_successor');
  if(bh){const result=await bh.getContextIndexStatus({readSet:b.options.readSet,types:['memory'],intent:'current',deadlineMs:100},b.token);assert.equal(result.error.code,'reader_failed');assert.equal(s.captures[1].sent.some(m=>m.method==='getContextIndexStatus'),false);}
});

nativeTest('registry hold supervisor close detaches a waiting call before graceful disposal',async t=>{
  const s=await setup(t),a=s.configuration(0,{mode:'block'}),b=s.configuration(1),ah=await s.open(a),bh=await s.open(b),closing=await s.closing(a,ah);
  const pending=tracked(bh.getContextIndexStatus({readSet:b.options.readSet,types:['memory'],intent:'current',deadlineMs:1000},b.token));
  await flush();assert.equal(pending.settled,false,'call_waits_before_supervisor_close');
  await b.options.supervisor.close();assert.equal((await pending.promise).error.code,'store_closed');assert.equal(s.registry.waiting(),0);
  assert.equal(s.captures[1].sent.some(m=>m.method==='getContextIndexStatus'),false);assert.deepEqual([...s.captures[1].resources],[1,1,0,0]);
  s.release(a);await closing.promise;
});


nativeTest('registry hold malformed opening keeps its protocol failure before admission',async t=>{
  const s=await setup(t,{failed:true}),a=s.configuration(0,{mode:'block'}),b=s.configuration(1,{service:true}),ah=await s.open(a);let closing;
  const open=s.runtime(true,m=>{
    if(m.result?.ok===true&&m.result.value===null&&!closing){delete m.result.value;closing=tracked(ah.close());}
  });
  const pending=tracked(open({...b.options,deadlineMs:100}));
  await until(()=>a.state[0]===1&&Boolean(closing),'malformed opening during cleanup');await flush();
  await testClock.advance(100,{waitForWorkers:false});const error=await guard(pending.promise,'protocol failure');
  s.release(a);await closing.promise;
  assert.equal(error.code,'reader_failed','malformed_opening_is_protocol_failure_before_wait');
  assert.equal(reader.maintenanceReaderFailureDiagnostic(error).lastFailure.cause,'protocol','malformed_opening_retains_protocol_cause');
  assert.equal(s.registry.waiting(),0);assert.equal(s.captures.length,2);
});

for(const action of ['abort','supervisor'])for(const first of ['stop','deadline'])nativeTest(`registry hold ${action}: ${first} settles before delayed competing callback`,async t=>{
  const s=await setup(t),a=s.configuration(0,{mode:'block'}),b=s.configuration(1),ah=await s.open(a),closing=await s.closing(a,ah),abort=new AbortController();
  const pending=tracked(s.runtime()({...b.options,deadlineMs:100},{signal:abort.signal}));await flush();assert.equal(pending.settled,false);
  if(first==='stop'){
    // Advance the sampled clock without delivering the already-due timer.
    let elapsed=0;testClock.bind(t,()=>elapsed);elapsed=100;
  }else await testClock.advance(100,{waitForWorkers:false});
  if(action==='abort')abort.abort();else await b.options.supervisor.close();
  const error=await pending.promise;
  assert.equal(error.code,first==='deadline'?'read_in_progress':action==='abort'?'read_cancelled':'store_closed');
  assert.equal(reader.readerRegistryHoldDiagnostic(error).outcome,first==='deadline'?3:4,'hold_outcome_matches_first_settlement');
  assert.equal(s.registry.waiting(),0);s.release(a);await closing.promise;await flush();
  assert.equal(s.captures.length,1,'later_callback_never_admits_the_stopped_waiter');
});

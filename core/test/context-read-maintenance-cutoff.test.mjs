import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import * as pump from '../context-product-pump.mjs';
import { supervisorOwner } from '../context-read-supervisor.mjs';
import { setup,flush } from '../testing/context-product-cutoff-fixture.mjs';

test('cutoff recovery: finite stall retains charge and advances the existing scheduler',async t=>{
  const s=setup(t),p=s.create();await s.step();
  assert.equal(p.getStatus().state,'active','recovery_keeps_owned_pump_active');
  assert.equal(p.getStatus().usedItems,1,'unknown_items_remain_charged');
  assert.equal(p.getStatus().usedMs,100,'unknown_ms_remain_charged');
  assert.equal(await Promise.race([p.completion,Promise.resolve('pending')]),'pending');
  const old=s.diagnostic(p);assert.equal(old.outcome,1);
  assert.equal(old.ordinal,s.calls[0].maintenanceOrdinal,'cutoff_joins_the_actual_dispatch_ordinal');assert.equal(old.cooldownUntil,s.now()+1000);
  await s.step();assert.equal(s.calls[1].input.intent,'history','round_robin_cursor_is_carried_forward');
  assert.equal(s.opens.length,2,'dead_resident_shared_intents_invalidated');
  assert.notEqual(s.calls[0].request.requestId,s.calls[1].request.requestId,'successor_has_fresh_service_scope');
  assert.notEqual(s.calls[0].operation.operationId,s.calls[1].operation.operationId);
  assert.ok(BigInt(s.calls[1].operation.operationCutoffMonoNs)-BigInt(s.calls[1].operation.enteredMonoNs)<=100000000n,'successor_cutoff_stays_within_reserved_turn');
  assert.equal(pump.maintenancePumpDiagnostic(p.getStatus()).observation.projection,1);
  await s.step();assert.equal(s.calls[2].input.intent,'current');
  assert.equal(p.getStatus().usedItems,1,'successful_only_refunds_preserve_failed_charge');
  assert.equal(old.outcome,1);assert.ok(Object.isFrozen(old));
  assert.ok(Object.values(old).every(Number.isFinite),'private_cutoff_fields_are_fixed_numeric');
  assert.equal(JSON.stringify(p.getStatus()).includes('ordinal'),false);
});

test('cutoff recovery: persistent stalls consume two allowances then stop',async t=>{
  const s=setup(t,{stalls:Infinity}),p=s.create();await s.step();
  assert.equal(p.getStatus().state,'active','first_stall_recovers');await s.step();
  assert.equal(p.getStatus().state,'active','second_stall_recovers');await s.step();
  assert.equal((await p.completion).error,'read_timeout','third_stall_is_terminal');
  assert.equal(p.getStatus().usedItems,3);assert.equal(p.getStatus().usedMs,300);
  assert.equal(s.opens.length,3,'breaker_bounds_open_kill_loop');
});

for(const enabled of [false,true])test(`cutoff recovery: ${enabled?'enabled':'default gate'} preserves public DTO shape`,async t=>{
  const s=setup(t,{enabled}),p=s.create();await s.step();
  assert.equal(p.getStatus().state,enabled?'active':'failed',enabled?'private_factory_seam_enables_recovery':'empty_gate_preserves_terminal_cutoff');
  assert.deepEqual(Object.keys(p.getStatus()).sort(),['error','id','maxItems','maxMs','state','usedItems','usedMs','windowId']);
  if(!enabled)assert.equal(s.diagnostic(p),undefined);
  const entry=await import('../index.mjs');
  for(const name of ['createMaintenancePumpRuntime','maintenanceCutoffQualified','maintenancePumpCutoffDiagnostic'])assert.equal(entry[name],undefined);
});

test('cutoff recovery: gated disposal forbids replacement and close cancels recovery',async t=>{
  let release;const stopped=new Promise(resolve=>{release=resolve;});
  const s=setup(t,{termination:()=>stopped}),p=s.create();
  const {operation}=await s.begin();await s.due(s.now()+100);
  const pending=p.getStatus(),opens=s.opens.length,closing=p.close();await flush();const beforeRelease=s.opens.length;
  release(1);await operation;await closing;
  assert.equal(pending.state,'active','disposal_pending_keeps_pump_supervised');
  assert.equal(opens,1);assert.equal(beforeRelease,1);assert.equal(p.getStatus().state,'stopped');
  assert.equal(s.timers.size,0,'close_cancels_reopen_after_late_confirmation');
});

test('cutoff recovery: late proof ends expedited retry but permits ordinary renewal',async t=>{
  let release;const stopped=new Promise(resolve=>{release=resolve;});
  const s=setup(t,{termination:()=>stopped}),p=s.create();
  const {operation}=await s.begin();await s.due(s.now()+100);await s.due(s.now()+1001);await operation;
  const decision=s.diagnostic(p);release(1);await flush();
  assert.equal(decision?.outcome,2,'proof_deadline_ends_expedited_recovery');
  assert.equal((await p.completion).error,'read_timeout');await p.close();
  const renewed=s.create({id:randomUUID()});await s.step();
  assert.equal(renewed.getStatus().state,'active','authorized_renewal_after_safe_late_drain_remains_available');
});

for(const kind of ['terminate','lease','provider'])test(`cutoff recovery: ${kind} failure overrides public cutoff with reader_failed`,async t=>{
  const s=setup(t,{termination:kind==='terminate'?()=>Promise.reject(Error('fixture termination failure')):undefined,
    resources:kind==='terminate'?undefined:v=>Atomics.store(v,kind==='lease'?0:2,1)}),p=s.create();
  await s.step();assert.equal((await p.completion).error,'reader_failed','failed_drain_public_error_precedence');
  assert.equal(s.diagnostic(p)?.cutoff,1,'private_diagnostic_retains_triggering_cutoff');
  assert.ok((await s.supervisor.drain()).some(r=>r.state==='failed'),'uncertain_resources_remain_quarantined');
});

test('cutoff recovery: shared allowance survives replacement pump IDs and usage floors',async t=>{
  const s=setup(t,{stalls:Infinity}),a=s.create();await s.step();
  assert.equal(a.getStatus().state,'active','initial_allowance_available');await a.close();
  const b=s.create({id:randomUUID(),window:{...s.config.window,usedItems:10,usedMs:1000}});await s.step();
  assert.equal(b.getStatus().state,'active','second_id_uses_shared_second_allowance');await b.close();
  const c=s.create({id:randomUUID()});await s.step();
  assert.equal((await c.completion).error,'read_timeout','replacement_id_cannot_reset_allowance');
  assert.equal(c.getStatus().usedItems,12);assert.equal(c.getStatus().usedMs,1200);
});

for(const ending of ['quota','renewal','supervisor','restore','erasure'])test(`cutoff recovery: ${ending} prevents dispatch during cooldown`,async t=>{
  const s=setup(t),p=s.create(ending==='quota'?{budgets:{maxItems:1,maxMs:100}}:ending==='renewal'?{renewalMs:4000}:{});await s.step();
  if(ending!=='quota')assert.equal(p.getStatus().state,'active','recovery_is_active_before_admission_ends');
  if(ending==='quota')assert.equal((await p.completion).state,'budget_exhausted','retained_reservation_exhausts_quota');
  else if(ending==='renewal'){s.set(4000);s.fire();await flush();assert.equal((await p.completion).state,'renewal_expired','expiry_prevents_reopen');}
  else {if(ending==='supervisor')await s.supervisor.close();else await p.close();}
  assert.equal(s.calls.length,1,'no_dispatch_after_admission_ends');
});

test('cutoff recovery: cooling domain yields to other lanes and cadence baselines survive',async t=>{
  const s=setup(t,{domains:2,stalls:n=>n===5}),p=s.create();
  for(let i=0;i<4;i++)await s.step();assert.equal(s.opens.length,2);
  await s.step();assert.equal(p.getStatus().state,'active','isolated_cutoff_does_not_stop_other_domains');
  await s.step();assert.equal(s.calls[5].input.intent,'current');
  assert.equal(s.opens.length,2,'cooling_yields_to_the_existing_healthy_resident');
  s.set(s.now()+6000);await s.step();
  assert.ok(pump.maintenancePumpDiagnostic(p.getStatus()).cadenceMisses>0,'cooldown_does_not_invent_observations');
  assert.equal(p.getStatus().state,'active','cadence_miss_remains_nonterminal');
  await s.step();assert.equal(s.opens.length,3,'reopen_preserves_other_healthy_resident');
  assert.equal(s.closes.length,1,'only_affected_resident_was_disposed');
});

test('cutoff recovery: open cutoff and missing ordinal stay terminal',async t=>{
  const s=setup(t,{openStall:true}),p=s.create();await s.step();
  assert.equal((await p.completion).error,'read_timeout','open_cutoff_is_ineligible');
  const key=Symbol.for('context-read-product/maintenance-dispatch-ordinal'),state=globalThis[key],next=state.next;
  try {state.next=Number.MAX_SAFE_INTEGER;const r=setup(t),q=r.create();await r.step();
    assert.equal((await q.completion).error,'read_timeout','exhausted_ordinal_cannot_recover');
  } finally {state.next=next;}
});

test('cutoff recovery: new window resets allowance but retains pending cooldown',async t=>{
  const s=setup(t,{stalls:Infinity}),p=s.create({window:{id:'short',endsAtMonoMs:1500,usedItems:0,usedMs:0}});await s.step();
  assert.equal(p.getStatus().state,'active','short_window_cutoff_recovers');
  const until=s.diagnostic(p).cooldownUntil,oldCompletion=p.completion;s.set(1500);
  s.create({window:{id:'next',endsAtMonoMs:61500,usedItems:0,usedMs:0}});
  const old=await oldCompletion;assert.equal(old.usedItems,1);assert.equal(old.usedMs,100,'old_window_keeps_its_unknown_charge');
  const {operation}=await s.begin(),admitted=s.now();await s.due(admitted+100);await operation;
  assert.ok(admitted>=until,'window_handoff_carries_unexpired_cooldown');
  assert.equal(s.diagnostic(p).allowance,1,'new_window_starts_fresh_recovery_allowance');
  await s.step();assert.equal(p.getStatus().state,'active');assert.equal(s.diagnostic(p).allowance,2);
  await s.step();assert.equal((await p.completion).error,'read_timeout','new_window_still_has_a_bounded_allowance');
  assert.equal(p.getStatus().windowId,'next');assert.equal(p.getStatus().usedItems,3);assert.equal(p.getStatus().usedMs,300);
});

test('cutoff recovery: capacity pressure refuses replacement without a spin',async t=>{
  const s=setup(t),p=s.create();await s.step();
  assert.equal(p.getStatus().state,'active','dispose_before_capacity_pressure');
  const {registry,owner}=supervisorOwner(s.supervisor),records=[];
  while(registry.counters().live<256)records.push(registry.register(owner,{path:s.config.projections[0].options.path,domain:'synthetic-capacity'}));
  try {await s.step();assert.equal((await p.completion).error,'read_in_progress','capacity_refusal_is_terminal');}
  finally {for(const r of records)registry.finish(r);}
});

for(const first of ['parent','reader'])test(`cutoff recovery: ${first} deadline wins and late replies cannot refund`,async t=>{
  const s=setup(t),p=s.create(),{operation}=await s.begin();
  if(first==='reader'){
    s.set(s.now()+100);const [id,timer]=[...s.timers].filter(([,v])=>v.at<=s.now()).at(-1);
    s.timers.delete(id);timer.fn();await flush();
  } else await s.due(s.now()+100);
  await operation;assert.equal(p.getStatus().state,'active','either_deadline_recovers_with_matching_attestation');
  s.lateReply();await flush();
  assert.equal(p.getStatus().usedMs,100,'late_reply_never_refunds_unknown_usage');
  assert.equal(pump.maintenancePumpDiagnostic(p.getStatus()).observation,null,'late_reply_never_invents_observation');
});

test('cutoff recovery: unattested timeout and caller flags cannot enable recovery',async t=>{
  const s=setup(t,{stalls:0,refusal:'read_timeout'}),p=s.create();await s.step();
  assert.equal((await p.completion).error,'read_timeout','bare_timeout_is_not_deadline_attestation');
  assert.equal(s.diagnostic(p),undefined);
  assert.throws(()=>s.create({id:randomUUID(),cutoffQualified:true}),{code:'invalid_input'},'public_option_cannot_enable_recovery');
});

test('cutoff recovery: process restart resets breaker and restores charged usage',async t=>{
  const s=setup(t,{stalls:Infinity}),p=s.create();await s.step();
  assert.equal(p.getStatus().state,'active','prior_process_recovery_is_available');await s.step();
  assert.equal(p.getStatus().state,'active','prior_process_consumes_two_recovery_allowances');await p.close();
  const child=spawnSync(process.execPath,[new URL('../testing/context-product-cutoff-fixture.mjs',import.meta.url).pathname,'restart-probe',
    JSON.stringify({paths:s.config.projections.map(p=>p.options.path),items:2,ms:200})],{encoding:'utf8',timeout:10000,env:{}});
  assert.equal(child.status,0,child.stderr);const status=JSON.parse(child.stdout);
  assert.equal(status.state,'active','new_process_has_fresh_recovery_allowance');
  assert.equal(status.usedItems,3,'restart_restores_full_item_usage_floor');assert.equal(status.usedMs,300,'restart_restores_full_time_usage_floor');
});

test('cutoff recovery: late proof cannot win a delayed confirmation timer',async t=>{
  let release;const stopped=new Promise(resolve=>{release=resolve;});
  const s=setup(t,{termination:()=>stopped}),p=s.create(),{operation}=await s.begin();await s.due(s.now()+100);
  s.set(s.now()+1001);release(1);await operation;await flush();
  assert.equal(s.diagnostic(p)?.outcome,2,'proof_after_absolute_deadline_stays_terminal');
  assert.equal((await p.completion).error,'read_timeout');
});

test('cutoff recovery: cooldown never shortens minimum admission spacing',async t=>{
  const s=setup(t),p=s.create({pollMs:2400}),{operation}=await s.begin(),admitted=s.now();
  await s.due(admitted+100);await operation;
  assert.equal(p.getStatus().state,'active','spacing_case_recovers_before_successor');
  await s.step();assert.ok(s.now()-admitted>=2400,'cooldown_preserves_minimum_admission_spacing');
});

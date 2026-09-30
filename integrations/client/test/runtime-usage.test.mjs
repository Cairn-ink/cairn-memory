import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, writeFile, readFile, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { createTestWorkspace } from '../../../tools/testing/workspace.mjs';
import { createRuntimeGuard, validateUsage } from '../runtime-usage.mjs';
import { withWriteObserver } from '../private-state.mjs';

async function setup(t,extra={}) {
  const ws=createTestWorkspace(t,{prefix:'cx3-usage-'}),home=join(ws.path,'home');
  await mkdir(home,{mode:0o700});
  let clock=Date.parse('2026-09-30T12:00:00Z');
  const config={root:home,targetId:'a'.repeat(64),mode:'api-key',dailyCap:10,now:()=>clock,...extra};
  return {ws,home,config,guard:createRuntimeGuard(config),advance:ms=>clock+=ms,now:()=>clock};
}

test('A9 one shared atomic cap for Claude/Codex and all sessions; reservations and billing survive restart',async t=>{
  const f=await setup(t,{dailyCap:3});
  const claude=createRuntimeGuard(f.config),codex=createRuntimeGuard(f.config);
  const [a,b,c]=await Promise.all([claude.reserve(),codex.reserve(),claude.reserve()]);
  assert.equal([a,b,c].filter(x=>x.ok).length,2);
  assert.equal([a,b,c].find(x=>!x.ok).code,'concurrency_limited');
  const state=(await createRuntimeGuard(f.config).status()).state;
  assert.equal(state.used,2);assert.equal(state.reservations.length,2);
  for(const r of state.reservations) await f.guard.release(r.id,{terminated:true});
  assert.equal((await f.guard.reserve()).ok,true);
  assert.equal((await codex.reserve()).code,'daily_cap_reached');
  assert.equal((await f.guard.resume()).ok,false);
  assert.equal((await stat(f.guard.path)).mode&0o777,0o600);
  assert.equal((await stat(join(f.home,'usage'))).mode&0o777,0o700);
});

test('A9 unknown termination and liveness deny; dead owners reaped without refund; no age reaping',async t=>{
  let alive=true;
  const live={boot:'synthetic-boot',namespace:'synthetic-ns',isAlive:()=>alive};
  const f=await setup(t,{liveness:live});
  const a=await f.guard.reserve();await f.guard.reserve();
  assert.equal((await f.guard.release(a.id)).code,'termination_unconfirmed');
  f.advance(86400000*10); // age does not release possibly live reservations
  assert.equal((await f.guard.reserve()).code,'concurrency_limited');
  alive=undefined;assert.equal((await f.guard.reserve()).code,'worker_liveness_unknown');
  alive=false;assert.equal((await f.guard.reserve()).ok,true);
  assert.equal((await f.guard.status()).state.used,1); // only UTC day rotation reset counts
  const state=(await f.guard.status()).state;
  state.reservations[0].namespace='foreign-ns';await writeFile(f.guard.path,JSON.stringify(state),{mode:0o600});
  assert.equal((await f.guard.reserve()).code,'worker_liveness_unknown');
});

test('A9 uncertain billing stays used; UTC day rotation, reversed clocks and cap changes are closed',async t=>{
  const f=await setup(t,{dailyCap:1});
  const a=await f.guard.reserve();await f.guard.release(a.id,{terminated:true});
  assert.equal((await f.guard.reserve()).code,'daily_cap_reached');
  f.advance(86400000);assert.equal((await f.guard.resume()).ok,true);
  assert.equal((await f.guard.reserve()).ok,true);
  f.advance(-86400000*2);await assert.rejects(f.guard.reserve(),/usage_clock_reversed/);
  await assert.rejects(createRuntimeGuard({...f.config,dailyCap:2}).reserve(),/usage_policy_changed/);
});

for(const [name,threshold] of Object.entries({five_hour:.95,seven_day:.93,seven_day_opus:.93,seven_day_sonnet:.92,overage:.95}))
  test(`A9 plan threshold ${name} cancels existing calls and fences new dispatch`,async t=>{
    const f=await setup(t,{mode:'plan'}),a=await f.guard.reserve();
    assert.equal(a.code,'quota_signal_unavailable');
    const result=await f.guard.observe({observedAt:f.now(),windows:[{name,utilization:threshold,resetAt:f.now()+3600000}]});
    assert.deepEqual(result.cancel,[a.id]);
    assert.equal((await f.guard.reserve()).code,'plan_threshold');
    let dispatched=0;assert.equal((await f.guard.dispatch(a.id,()=>{dispatched++;return {};})).ok,false);
    assert.equal(dispatched,0);assert.equal((await f.guard.resume()).ok,false);
  });

test('A9 early stop near reset, stale/missing fallback, API-key exemption and absent caps',async t=>{
  const f=await setup(t,{mode:'plan'});
  assert.equal((await f.guard.reserve()).code,'quota_signal_unavailable');
  assert.equal((await f.guard.observe({observedAt:f.now()-400000,windows:[]})).code,'quota_signal_unavailable');
  assert.equal((await f.guard.observe({observedAt:f.now(),windows:[{name:'five_hour',utilization:.85,resetAt:f.now()+900000}]})).code,'plan_threshold');
  const api=await setup(t);
  await api.guard.observe({observedAt:api.now(),windows:[{name:'five_hour',utilization:1,resetAt:api.now()+900000}]});
  assert.equal((await api.guard.reserve()).ok,true);
  assert.equal((await createRuntimeGuard({...api.config,dailyCap:undefined}).reserve()).code,'automatic_cap_unconfigured');
});

for(const known of [true,false]) test(`A9 quota refusal ${known?'known':'unknown'} reset persists and resume grants one attempt`,async t=>{
  const f=await setup(t);await f.guard.refuse({resetAt:known?f.now()+1000:null});
  assert.equal((await createRuntimeGuard(f.config).reserve()).code,'quota_reached');
  if(known) {assert.equal((await f.guard.resume()).ok,false);f.advance(1000);}
  assert.equal((await f.guard.resume()).ok,true);
  const p=await f.guard.reserve();assert.equal(p.ok,true);
  assert.equal((await f.guard.reserve()).code,'quota_reached');
  await f.guard.release(p.id,{terminated:true});
  assert.equal((await f.guard.reserve()).code,'quota_reached');
  assert.equal((await f.guard.resume()).ok,true);
  const q=await f.guard.reserve();await f.guard.refuse();await f.guard.release(q.id,{terminated:true});
  assert.equal((await f.guard.reserve()).code,'quota_reached');
  const state=JSON.parse(await readFile(f.guard.path));assert.equal(state.used,2);
});

test('A9 reserve then refusal prevents dispatch, accepted resume restores ordinary eligibility',async t=>{
  const f=await setup(t),p=await f.guard.reserve();await f.guard.refuse();
  assert.equal((await f.guard.dispatch(p.id,()=>{throw new Error('must never run');})).ok,false);
  await f.guard.release(p.id,{terminated:true});await f.guard.resume();
  const q=await f.guard.reserve();await f.guard.release(q.id,{terminated:true,accepted:true});
  assert.equal((await f.guard.reserve()).ok,true);
});

test('A9 closed finite state schema rejects corruption, typos, secrets and unsafe permissions',async t=>{
  const f=await setup(t);await f.guard.status();
  const state=JSON.parse(await readFile(f.guard.path));
  for(const patch of [{used:-1},{used:11},{used:NaN},{cap:Infinity},{refusal:'raw-secret'},
    {usedd:0},{token:'fake-secret'},{reservations:[{id:'raw transcript'}]},
    {windows:[{name:'unknown',utilization:1,resetAt:0}]}]) assert.throws(()=>validateUsage({...state,...patch}));
  await writeFile(f.guard.path,'{broken');await assert.rejects(f.guard.reserve(),/usage_state_invalid/);
});

test('A9 exhaustive interruption: every durable write in reserve/dispatch/release/refuse/resume/observe',async t=>{
  let points=0;
  for(const operation of ['reserve','dispatch','release','refuse','resume','observe']) {
    async function scenario(crashAt) {
      const f=await setup(t),id=randomUUID();
      if(['release','dispatch'].includes(operation)) await f.guard.reserve({id});
      if(operation==='resume') await f.guard.refuse();
      const call=()=>operation==='reserve'?f.guard.reserve({id}):operation==='dispatch'?f.guard.dispatch(id,()=>({})):
        operation==='release'?f.guard.release(id,{terminated:true}):
        operation==='observe'?f.guard.observe({observedAt:f.now(),windows:[]}):f.guard[operation]();
      let writes=0;
      try {await withWriteObserver(()=>{if(++writes===crashAt)throw new Error('interruption');},call);}
      catch(error){assert.match(error.message,/interruption/);await call();}
      const state=(await f.guard.status()).state;
      return {writes,state:{...state,reservations:state.reservations.map(r=>({...r,id:'opaque'}))}};
    }
    const baseline=await scenario(Infinity);
    for(let k=1;k<=baseline.writes;k++) {points++;const retried=await scenario(k);assert.deepEqual(retried.state,baseline.state);}
  }
  t.diagnostic(`runtime interruption points=${points}`);
});

test('A9 one reservation can dispatch only once; refusal invalidates older unstarted permits across resume',async t=>{
  const f=await setup(t),p=await f.guard.reserve();let calls=0;
  await f.guard.dispatch(p.id,()=>{calls++;return {};});
  assert.equal((await f.guard.dispatch(p.id,()=>{calls++;return {};})).code,'reservation_already_dispatched');
  assert.equal(calls,1);await f.guard.release(p.id,{terminated:true});
  const old=await f.guard.reserve();await f.guard.refuse();await f.guard.resume();
  const fresh=await f.guard.reserve();
  assert.equal((await f.guard.dispatch(old.id,()=>{calls++;return {};})).code,'reservation_invalidated');
  assert.equal((await f.guard.dispatch(fresh.id,()=>{calls++;return {};})).ok,true);
  assert.equal(calls,2);
});

test('A9 reservation crossing UTC midnight charges the dispatch day and cannot bypass its cap',async t=>{
  const f=await setup(t,{dailyCap:1}),old=await f.guard.reserve();f.advance(86400000);
  await f.guard.dispatch(old.id,()=>({}));assert.equal((await f.guard.status()).state.used,1);
  assert.equal((await f.guard.reserve()).code,'daily_cap_reached');
  const other=await setup(t,{dailyCap:1}),pending=await other.guard.reserve();other.advance(86400000);
  await other.guard.reserve();let calls=0;
  assert.equal((await other.guard.dispatch(pending.id,()=>{calls++;return {};})).code,'daily_cap_reached');
  assert.equal(calls,0);assert.equal((await other.guard.status()).state.used,1);
});

test('A9 refused resume at capacity preserves quota latch; explicit resume recovers a dead uncertain attempt',async t=>{
  const f=await setup(t,{liveness:{boot:'synthetic',namespace:'synthetic',isAlive:pid=>pid===process.pid}});
  const a=await f.guard.reserve(),b=await f.guard.reserve();await f.guard.refuse();
  assert.equal((await f.guard.resume()).code,'concurrency_limited');
  assert.equal((await f.guard.status()).state.refusal,'quota_reached');
  await f.guard.release(a.id,{terminated:true});await f.guard.release(b.id,{terminated:true});
  await f.guard.resume();const attempt=await f.guard.reserve();
  const state=(await f.guard.status()).state;state.reservations.find(r=>r.id===attempt.id).pid=999999;
  await writeFile(f.guard.path,JSON.stringify(state),{mode:0o600});
  assert.equal((await f.guard.resume()).ok,true);
  assert.equal((await f.guard.status()).state.used,3); // no uncertain-billing refund
  assert.equal((await f.guard.reserve()).ok,true);
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { fixture } from '../testing/context-read-fixture.mjs';
import { local, workRow, inspect, snapshot, authenticate } from '../testing/context-product-verification-fixture.mjs';
import { createMaintenancePumpRuntime } from '../context-product-pump.mjs';
import { attachMaintenanceAdmissionReceipt } from '../context-product-admission.mjs';
import { setup } from '../testing/context-product-cutoff-fixture.mjs';

// Use the existing private local clock/rendezvous fixture and native exec mock.
// No sleeps, new engine seam, durability change or extra production SQL.
function staged(t, count=320) {
  const f=fixture(t);
  for(let i=0;i<count;i++)f.admit('priced orchard needle '+i+' '+Array.from({length:8},(_,j)=>'term'+j).join(' '));
  const a=local(f.path);f.workspace.defer(()=>a.close());a.prepare();
  assert.equal(JSON.parse(workRow(f.path).verify).phase,0);
  return {f,a};
}
function commitCost(t,a,ms) {
  let clock=0,commits=0;
  const exec=DatabaseSync.prototype.exec,writers=new WeakSet();
  t.mock.method(DatabaseSync.prototype,'exec',function(sql){
    const result=exec.call(this,sql);
    if(sql==='BEGIN IMMEDIATE')writers.add(this);
    // This fixture has one writable sidecar. Canonical and lifecycle reads end
    // independently; price only the writer, with no statement of our own.
    if(sql==='COMMIT'&&writers.has(this)){clock+=ms;commits++;a.setClock(clock);}
    if(sql==='COMMIT'||sql==='ROLLBACK')writers.delete(this);
    return result;
  });
  return {reset(){clock=0;commits=0;},get clock(){return clock;},get commits(){return commits;}};
}

test('whole verification COMMIT is priced before another transaction; next turn resumes',t=>{
  const {f,a}=staged(t),cost=commitCost(t,a,400),before=workRow(f.path);
  a.step();
  assert.equal(cost.commits,1,'yield before the second complete transaction cannot fit with the tail and reserve');
  assert.ok(cost.clock<=1000,'no injected quantum overrun');
  const first=inspect(f.path,snapshot);authenticate(a,first);
  assert.equal(first.generation.checkpoint,before.checkpoint+1);
  cost.reset();a.step();
  const next=inspect(f.path,snapshot);authenticate(a,next);
  assert.equal(next.generation.checkpoint,first.generation.checkpoint+1);
  assert.ok(JSON.parse(next.generation.verify).counts.documents>JSON.parse(first.generation.verify).counts.documents);
  assert.ok(cost.clock<=1000,'continuation stays inside the same quantum');
});

test('real pump accounts a priced verification turn and continues without read_timeout',async t=>{
  const {f,a}=staged(t),cost=commitCost(t,a,400),s=setup(t,{enabled:false,stalls:0});
  let time=0,serial=0,calls=0;const timers=new Map();
  const renew=createMaintenancePumpRuntime({now:()=>time,
    setTimer(fn,ms){const id=++serial;timers.set(id,{fn,at:time+ms});return id;},clearTimer:id=>timers.delete(id),
    open:async()=>({close:async()=>{}}),
    admit:async()=>{const result={ok:true,value:null};attachMaintenanceAdmissionReceipt(result,'admitted');return result;},
    work:async()=>{calls++;cost.reset();const progress=a.step();time+=cost.clock;
      // Final observation/delivery is still work in this pump quantum.
      a.observe();time+=50;return {ok:true,value:{status:'rebuilding',progress:{transformed:progress.transformed}}};},
    observedAt:()=>time});
  const p=renew({...s.config,quantum:{maxItems:32,maxMs:1000},budgets:{maxItems:1000,maxMs:60000}});t.after(()=>p.close());
  async function turn(){const [id,timer]=[...timers].sort((a,b)=>a[1].at-b[1].at)[0];timers.delete(id);time=Math.max(time,timer.at);await timer.fn();}
  await turn();await turn();
  assert.equal(calls,1);
  assert.equal(p.getStatus().error,null,'base starts a third COMMIT and the pump fails read_timeout');
  assert.equal(p.getStatus().state,'active');
  const checkpoint=workRow(f.path).checkpoint;await turn();
  assert.equal(calls,2);assert.ok(workRow(f.path).checkpoint>checkpoint);
  assert.equal(p.getStatus().error,null);
});

test('staged verification converges for both intents with bounded turns and zero injected overruns',t=>{
  const {a}=staged(t);let turns=0,overruns=0;
  const counts={};
  for(const intent of ['current','history']) {
    // Build the other lane without latency so this test isolates verification.
    if(intent==='history'){
      t.mock.restoreAll();a.p.intent=intent;a.prepare();
    }
    let complete=false,laneTurns=0;
    for(;laneTurns<150;laneTurns++){
      // Each step resets the fixture clock. Keep the injection accumulator in
      // the same call-local domain, including the history lane's replacement.
      t.mock.restoreAll();const latency=commitCost(t,a,400);
      a.step();turns++;if(latency.clock+50>1000)overruns++;
      const observed=a.observe();
      if(observed.publication){complete=true;laneTurns++;assert.equal(observed.publication.counts.byType.memory.indexed,320);break;}
    }
    assert.ok(complete,`${intent} publishes within 150 work turns`);counts[intent]=laneTurns;
  }
  t.diagnostic(JSON.stringify({turns,counts,overruns}));assert.equal(overruns,0);
});

test('private estimate keeps complete transaction and observation high-water marks on a handle',async t=>{
  const module=await import('../context-product-checkpoint-cost.mjs').catch(error=>{if(error.code==='ERR_MODULE_NOT_FOUND')return null;throw error;});
  if(!module){t.skip('private estimator absent in the base control');return;}
  const {checkpointCost}=module;
  let now=0;const cost=checkpointCost(()=>now),q={cutoff:1000,reserve:150};
  now=700;assert.equal(cost.admit(q),false,'100 transaction + 50 tail seed must fit strictly before usable cutoff');
  now=699;assert.equal(cost.admit(q),true);
  cost.transaction(400,200);now=400;assert.equal(cost.admit(q),false,'whole commit-inclusive cost is retained');
  now=0;assert.equal(cost.admit(q),true,'next turn can make progress');
  cost.tail(150);now=200;assert.equal(cost.admit(q),false,'doubled observed final tail is additional to the unchanged reserve');
  cost.transaction(1);cost.tail(1);assert.equal(cost.admit(q),false,'cheap samples cannot hide earlier expensive samples');
  now=300;assert.equal(cost.admit(q,100),true,'an elapsed freshness/scan prefix is not charged twice');
  now=450;assert.equal(cost.admit(q,50),false,'a slower prefix cannot consume the measured work still due');
  cost.commit(250);now=300;assert.equal(cost.admit(q,100),false,'elapsed work cannot consume the observed native commit floor');
  cost.transaction(1100);now=0;assert.equal(cost.admit(q),false,'an indivisible transaction beyond the quantum has no promised fit');
});

test('index learns the fresh final observation tail for the following work call',async t=>{
  const {openProductIndex}=await import('../context-product-index.mjs');
  const {openContextProductFacade}=await import('../context-read-facade.mjs');
  const {accessDigest}=await import('../context-product-validation.mjs');
  const {selection}=await import('../testing/context-product-verification-fixture.mjs');
  const {f,a}=staged(t);a.close();
  let clock=0,commits=0,checks=0;const writers=new WeakSet(),exec=DatabaseSync.prototype.exec;
  t.mock.method(DatabaseSync.prototype,'exec',function(sql){
    const result=exec.call(this,sql);if(sql==='BEGIN IMMEDIATE')writers.add(this);
    if(sql==='COMMIT'&&writers.has(this)){clock+=150;commits++;}
    if(sql==='COMMIT'||sql==='ROLLBACK')writers.delete(this);return result;
  });
  const facade=openContextProductFacade(f.path,{}),access=accessDigest({ownerId:selection.readSet[0].ownerId,namespaces:{readSet:selection.readSet}});
  const index=openProductIndex({path:f.path,facade,maintenance:true,ownerCoverage:selection.ownerCoverage,now:()=>clock,
    authorize:()=>({accessGenerations:access,check(){checks++;clock+=200;},envelope:fn=>fn()})});
  t.after(()=>{index.close();facade.close();});
  const input={readSet:selection.readSet,types:['memory'],intent:'current',mode:'lexical',budget:{maxItems:32,maxMs:1000}};
  const first=index.run('refreshContextIndex',input,{});
  assert.equal(first.ok,true);assert.equal(commits,5);assert.equal(checks,1);
  assert.equal(clock,950,'first observation still runs after the admitted checkpoint prefix');
  clock=0;commits=0;checks=0;
  const next=index.run('refreshContextIndex',input,{});
  assert.equal(next.ok,true);assert.equal(commits,2,'observed 200-ms tail is doubled and included before the next BEGIN');
  assert.equal(checks,1,'yield retains final authorization and fresh canonical observation');
  assert.equal(clock,500);
});

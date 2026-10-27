import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createMaintenancePumpRuntime } from '../context-product-pump.mjs';
import { createContextReadSupervisor } from '../context-read-supervisor.mjs';
import { credentialDigest } from '../context-product-control.mjs';

function setup(t,patch={},faults={}) {
  let now=0,serial=0;const timers=new Map(),calls=[],opened=[],closed=[];
  const supervisor=createContextReadSupervisor();t.after(()=>supervisor.close().catch(e=>{if(!faults.close)throw e;}));
  const credential={service:randomUUID()},readSet=[{ownerId:'pump',scope:'personal',projectId:null}];
  const ownerCoverage={policy:'recent-projects-v1',selectionRevision:'fixture',requestedNamespaces:1,selectedNamespaces:1,omittedNamespaces:0};
  const serviceBinding={kind:'service',serviceId:'service',credentialBindingId:'service-binding',credentialExpiresUtcMs:null,credentialDigest:credentialDigest(credential),
    ownerId:'pump',namespaces:{readSet,ownerCoverage},issuedAt:0};
  const options={supervisor,path:'/synthetic-pump-'+randomUUID()+'.sqlite',readSet,ownerCoverage,host:{moduleUrl:'file:///synthetic-host.mjs',configuration:{serviceBinding}}};
  const c={supervisor,id:randomUUID(),window:{id:'minute-1',endsAtMonoMs:60000,usedItems:0,usedMs:0},budgets:{maxItems:8,maxMs:800},
    quantum:{maxItems:1,maxMs:100},pollMs:1000,renewalMs:60000,serviceCredential:credential,
    projections:[{options,types:['memory']},{options:{...options,readSet:[{ownerId:'pump',scope:'project',projectId:'p'}],ownerCoverage,
      host:{...options.host,configuration:{serviceBinding:{...serviceBinding,namespaces:{readSet:[{ownerId:'pump',scope:'project',projectId:'p'}],ownerCoverage}}}}},types:['memory']}],...patch};
  const renew=createMaintenancePumpRuntime({now:()=>now,setTimer:(f,ms)=>{const id=++serial;timers.set(id,{f,at:now+ms});return id;},clearTimer:id=>timers.delete(id),
    open:async opts=>{opened.push(opts);return {async refreshContextIndex(input,token){calls.push([input,token]);if(faults.refresh)throw Error('refresh failed');return {ok:true,value:{status:'complete'}};},async close(){closed.push(opts);if(faults.close)throw Error('close failed');}};}});
  return {renew,c,calls,opened,closed,timers,setTime:n=>{now=n;},async next(){const [id,timer]=[...timers].sort((a,b)=>a[1].at-b[1].at)[0];timers.delete(id);now=timer.at;await timer.f();}};
}

test('pump round-robins both intents and active projections, renewal reuses one supervised writer, restart preserves exhaustion',async t=>{
  const s=setup(t),pump=s.renew(s.c);assert.equal(s.renew(s.c),pump);
  for(let i=0;i<8;i++)await s.next();
  assert.deepEqual(s.calls.map(([i])=>[i.readSet[0].scope,i.intent]),[
    ['personal','current'],['personal','history'],['project','current'],['project','history'],
    ['personal','current'],['personal','history'],['project','current'],['project','history']]);
  assert.equal(s.opened.length,2);assert.equal(pump.getStatus().state,'budget_exhausted');assert.equal(s.timers.size,0);
  assert.equal((await pump.completion).usedItems,8);
  await pump.close();assert.equal(s.closed.length,2);
  const restarted=s.renew({...s.c,id:randomUUID()});assert.equal(restarted.getStatus().state,'budget_exhausted');assert.equal(s.timers.size,0);await restarted.close();
  assert.throws(()=>s.renew({...s.c,window:{...s.c.window,id:'reset-budget'}}),{code:'invalid_input'});
});

test('supervisor shutdown closes the live pump and waits for its native handles',async t=>{
  const s=setup(t),pump=s.renew(s.c);await s.next();await s.c.supervisor.close();
  assert.equal(pump.getStatus().state,'stopped');assert.equal(s.closed.length,1);assert.equal(s.timers.size,0);
});

test('pump refuses HTTP credentials before timers, handles or index work',t=>{
  const s=setup(t);assert.throws(()=>s.renew({...s.c,serviceCredential:{request:'http'}}),{code:'authority_required'});
  const p=s.c.projections[0];p.options.host.configuration.serviceBinding.kind='request';
  assert.throws(()=>s.renew(s.c),{code:'authority_required'});assert.equal(s.opened.length,0);assert.equal(s.timers.size,0);
});

test('pump validates host bounds and refuses changed selection during renewal',async t=>{
  const s=setup(t);
  for(const patch of [{pollMs:5001},{pollMs:2000},{renewalMs:0},{quantum:{maxItems:1025,maxMs:100}},{budgets:{maxItems:1,maxMs:60001}}])assert.throws(()=>s.renew({...s.c,...patch}),{code:'invalid_input'});
  const p=s.renew(s.c);assert.throws(()=>s.renew({...s.c,projections:[s.c.projections[0]]}),{code:'read_in_progress'});await p.close();
});

test('renewal expiry is observable and a new quota window cannot overlap its predecessor',async t=>{
  const s=setup(t,{renewalMs:100}),p=s.renew(s.c);await s.next();
  assert.equal((await p.completion).state,'renewal_expired');assert.equal(s.calls.length,0);
  const expired=p.completion;s.renew({...s.c,renewalMs:60000});assert.notEqual(p.completion,expired);await s.next();assert.equal(s.calls.length,1);
  s.setTime(60000);const next={...s.c,window:{id:'minute-2',endsAtMonoMs:120000,usedItems:0,usedMs:0},renewalMs:60000};
  assert.equal(s.renew(next),p);await s.next();assert.equal(p.getStatus().windowId,'minute-2');assert.equal(s.calls.length,2);await p.close();
});


test('Fix1 domains retain charges independently across A -> A+B -> B selections',async t=>{
  const s=setup(t),a=s.c.projections[0],b={...a,options:{...a.options,path:a.options.path+'-other'}};
  const config={...s.c,projections:[a],budgets:{maxItems:1,maxMs:100}};
  const first=s.renew(config);await s.next();await first.close();
  const mixed=s.renew({...config,id:randomUUID(),projections:[a,b]});
  assert.equal(mixed.getStatus().state,'budget_exhausted');assert.equal(mixed.getStatus().usedItems,1);await mixed.close();
  const onlyB=s.renew({...config,id:randomUUID(),projections:[b]});
  assert.equal(onlyB.getStatus().usedItems,0);await s.next();await onlyB.close();
  const mixedAgain=s.renew({...config,id:randomUUID(),projections:[b,a]});
  assert.equal(mixedAgain.getStatus().state,'budget_exhausted');await mixedAgain.close();
});

test('Fix1 renewal rejects a third window overlapping another pump current window',async t=>{
  const s=setup(t),old=s.renew(s.c);s.setTime(60000);
  const current={...s.c,id:randomUUID(),window:{id:'current',endsAtMonoMs:120000,usedItems:8,usedMs:800}};
  const other=s.renew(current);
  assert.throws(()=>s.renew({...current,id:s.c.id,window:{...current.window,id:'third',usedItems:0,usedMs:0}}),{code:'invalid_input'});
  assert.equal(old.getStatus().windowId,'minute-1');await old.close();await other.close();
});

test('Fix1 boundary renewal settles every previously exposed completion before shutdown',async t=>{
  const s=setup(t),p=s.renew(s.c),first=p.completion;s.setTime(60000);
  s.renew({...s.c,window:{id:'next',endsAtMonoMs:120000,usedItems:0,usedMs:0}});
  const second=p.completion;assert.notEqual(second,first);await p.close();
  const result=await Promise.race([Promise.all([first,second]),new Promise(resolve=>setImmediate(()=>resolve('pending')))]);
  assert.notEqual(result,'pending');assert.equal(result[0].windowId,'minute-1');assert.equal(result[0].state,'budget_exhausted');assert.equal(result[1].state,'stopped');
});

for(const automatic of [true,false])test(`Fix1 ${automatic?'refresh failure':'supervisor shutdown'} consumes disposal rejection and exposes failed drain`,async t=>{
  const s=setup(t,{}, {refresh:automatic,close:true}),p=s.renew(s.c);
  await s.next();
  if(!automatic)await assert.rejects(s.c.supervisor.close(),{code:'reader_failed'});
  assert.equal((await p.completion).state,'failed');assert.equal(p.getStatus().error,'reader_failed');
  const drained=await s.c.supervisor.drain();assert.ok(drained.some(r=>r.state==='failed'));
  await assert.rejects(p.close());
});


test('Fix1 a mixed pump reserves each quantum only against its dispatched domain',async t=>{
  const s=setup(t),a=s.c.projections[0],b={...a,options:{...a.options,path:a.options.path+'-other'}};
  const mixed=s.renew({...s.c,projections:[a,b]});for(let i=0;i<3;i++)await s.next();await mixed.close();
  const onlyB=s.renew({...s.c,id:randomUUID(),projections:[b]});assert.equal(onlyB.getStatus().usedItems,1);assert.equal(onlyB.getStatus().usedMs,100);await onlyB.close();
  const onlyA=s.renew({...s.c,id:randomUUID(),projections:[a]});assert.equal(onlyA.getStatus().usedItems,2);assert.equal(onlyA.getStatus().usedMs,200);await onlyA.close();
});

for(const nextWindow of [true,false])test(`Fix2 ${nextWindow?'new window':'same window'} exhausted renewal settles completion without a timer`,async t=>{
  const s=setup(t),p=s.renew(s.c),first=p.completion;
  if(nextWindow)s.setTime(60000);
  s.renew({...s.c,window:{...s.c.window,...(nextWindow?{id:'exhausted-next',endsAtMonoMs:120000}:{}),usedItems:8}});
  const result=await Promise.race([p.completion,new Promise(resolve=>setImmediate(()=>resolve('pending')))]);
  assert.notEqual(result,'pending');assert.equal(result.state,'budget_exhausted');assert.equal(s.timers.size,0);
  if(nextWindow){assert.notEqual(p.completion,first);assert.equal((await first).state,'budget_exhausted');}
  await p.close();
});

test('Fix2 admitted options are detached from caller mutations before timer dispatch',async t=>{
  const s=setup(t),p=s.renew(s.c),admitted=s.c.projections[0].options,path=admitted.path;
  admitted.path+='-mutated';admitted.readSet[0].ownerId='mutated';admitted.host.moduleUrl='mutated';
  await s.next();
  assert.equal(s.opened[0].path,path);assert.equal(s.opened[0].readSet[0].ownerId,'pump');
  assert.equal(s.opened[0].host.moduleUrl,'file:///synthetic-host.mjs');assert.equal(p.getStatus().error,null);
  await p.close();assert.equal((await p.completion).state,'stopped');
});

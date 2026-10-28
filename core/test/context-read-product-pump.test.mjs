import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createMaintenancePumpRuntime } from '../context-product-pump.mjs';
import { createContextReadSupervisor } from '../context-read-supervisor.mjs';
import { credentialDigest } from '../context-product-control.mjs';
import { fixture, ok } from '../testing/context-read-fixture.mjs';
import { four, personal, project, configured, descriptor } from '../testing/context-product-owner-fixture.mjs';

function setup(t,patch={},faults={}) {
  let now=0,serial=0;const timers=new Map(),calls=[],opened=[],closed=[],live=new Set();
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
    open:async opts=>{const writer=JSON.stringify([opts.path,opts.readSet]);if(faults.exclusive)assert.equal(live.has(writer),false,'drain the previous writer before opening');live.add(writer);opened.push(opts);return {async refreshContextIndex(input,token){calls.push([input,token]);if(faults.refresh)throw Error('refresh failed');return {ok:true,value:{status:'complete'}};},async close(){closed.push(opts);live.delete(writer);if(faults.close)throw Error('close failed');}};}});
  return {renew,c,calls,opened,closed,timers,setTime:n=>{now=n;},async next(){const [id,timer]=[...timers].sort((a,b)=>a[1].at-b[1].at)[0];timers.delete(id);now=timer.at;await timer.f();}};
}

test('pump round-robins both intents and active projections, renewal retains pump identity, restart preserves exhaustion',async t=>{
  const s=setup(t),pump=s.renew(s.c);assert.equal(s.renew(s.c),pump);
  for(let i=0;i<8;i++)await s.next();
  assert.deepEqual(s.calls.map(([i])=>[i.readSet[0].scope,i.intent]),[
    ['personal','current'],['personal','history'],['project','current'],['project','history'],
    ['personal','current'],['personal','history'],['project','current'],['project','history']]);
  assert.equal(s.opened.length,8);assert.equal(pump.getStatus().state,'budget_exhausted');assert.equal(s.timers.size,0);
  assert.equal((await pump.completion).usedItems,8);
  await pump.close();assert.equal(s.closed.length,s.opened.length);
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
  else assert.equal(p.completion,first);
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

for(const exhausted of [true,false])test(`Fix3 settled renewal expiry gets a fresh same-window completion with ${exhausted?'exhausted budget':'budget left'}`,async t=>{
  const s=setup(t,{renewalMs:100}),p=s.renew(s.c),first=p.completion;
  await s.next();
  const expired=await first;
  assert.equal(expired.state,'renewal_expired');assert.equal(expired.usedItems,0);assert.equal(expired.usedMs,0);
  assert.equal(s.calls.length,0);assert.equal(s.timers.size,0);

  assert.equal(s.renew({...s.c,renewalMs:60000,window:{...s.c.window,usedItems:exhausted?8:3,usedMs:200}}),p);
  const renewed=p.completion;
  assert.notEqual(renewed,first);
  assert.equal(p.getStatus().state,exhausted?'budget_exhausted':'active');
  assert.equal(s.timers.size,exhausted?0:1);
  if(!exhausted){
    for(let i=0;i<5;i++)await s.next();
    assert.equal(s.calls.length,5);
  }
  const result=await Promise.race([renewed,new Promise(resolve=>setImmediate(()=>resolve('pending')))]);
  assert.notEqual(result,'pending');assert.deepEqual(result,p.getStatus());
  assert.equal(result.state,'budget_exhausted');assert.equal(result.windowId,s.c.window.id);
  assert.equal(result.usedItems,8);assert.equal(result.usedMs,exhausted?200:700);
  assert.equal(p.completion,renewed);assert.equal(s.timers.size,0);
  assert.equal(await first,expired);assert.equal(expired.state,'renewal_expired');assert.equal(expired.usedItems,0);
  await p.close();
});

// P2d: the pump forwards the same explicit deployment permission as direct
// maintenance. Renewal cannot silently change live sidecar configuration.
test('P2d pump forwards WAL opt-in and refuses journal-policy changes during renewal',async t=>{
  const s=setup(t);
  for(const p of s.c.projections)Object.assign(p.options,{wal:true,sidecarJournalMode:'WAL'});
  const pump=s.renew(s.c);await s.next();assert.equal(s.opened[0].wal,true);assert.equal(s.opened[0].sidecarJournalMode,'WAL');
  const changed={...s.c,projections:s.c.projections.map(p=>({...p,options:{...p.options,sidecarJournalMode:'DELETE'}}))};
  assert.throws(()=>s.renew(changed),{code:'read_in_progress'});
  await pump.close();
  for(const p of s.c.projections)p.options.wal='WAL';
  assert.throws(()=>s.renew({...s.c,id:randomUUID()}),{code:'invalid_input'});
});

test('P2d fix round 1 pump uses opted-out constructor for an otherwise identical projection',async t=>{
  const s=setup(t),base=s.c.projections[0];
  s.c.projections=[{...base,options:{...base.options,wal:true,sidecarJournalMode:'WAL'}},
    {...base,options:{...base.options,wal:false,sidecarJournalMode:'DELETE'}}];
  const pump=s.renew(s.c);for(let i=0;i<4;i++)await s.next();
  assert.deepEqual(s.opened.map(o=>[o.wal,o.sidecarJournalMode]),[[true,'WAL'],[true,'WAL'],[false,'DELETE'],[false,'DELETE']]);
  assert.deepEqual(s.calls.map(([i])=>i.intent),['current','history','current','history']);
  await pump.close();assert.equal(s.closed.length,s.opened.length);
});

test('P2-06/09/18 active four/32 selections prebuild both intents through the pump with mock scheduling',async t=>{
  const f=fixture(t),readSet=[personal,...Array.from({length:31},(_,i)=>project('p'+i))];
  for(const ns of [...four,readSet[1]])f.admit('pump cache '+(ns.projectId??'personal'),ns);
  const supervisor=createContextReadSupervisor();t.after(()=>supervisor.close());
  const a=configured(t,f.path,four,{service:true,supervisor});
  const ownerCoverage=descriptor(readSet,1),b=configured(t,f.path,[...readSet].reverse(),{service:true,supervisor,ownerCoverage});
  b.binding.credentialDigest=a.binding.credentialDigest;
  let now=0,serial=0;const timers=new Map();
  const renew=createMaintenancePumpRuntime({now:()=>now,setTimer:(f,ms)=>{const id=++serial;timers.set(id,{f,at:now+ms});return id;},clearTimer:id=>timers.delete(id)});
  const base={supervisor,window:{id:randomUUID(),endsAtMonoMs:60000,usedItems:0,usedMs:0},budgets:{maxItems:4096,maxMs:10000},
    quantum:{maxItems:1024,maxMs:2500},pollMs:1,renewalMs:60000,serviceCredential:a.token};
  // Activate each selection explicitly. Multi-selection round-robin is covered
  // above with the same mock scheduler; native operation cutoffs are unchanged.
  for(const options of [a.options,b.options]){
    const c={...base,id:randomUUID(),projections:[{options,types:['memory']}]},pump=renew(c);
    for(let i=0;i<2;i++){
      assert.ok(timers.size,JSON.stringify(pump.getStatus()));
      const [id,timer]=[...timers].sort((a,b)=>a[1].at-b[1].at)[0];timers.delete(id);now=timer.at;await timer.f();
      assert.equal(pump.getStatus().error,null);
    }
    const revision=structuredClone(options.host.configuration.serviceBinding);
    const ownerCoverage={...options.ownerCoverage,selectionRevision:'next-revision'};revision.namespaces.ownerCoverage=ownerCoverage;
    const changed={...c,projections:[{options:{...options,ownerCoverage,host:{...options.host,configuration:{...options.host.configuration,serviceBinding:revision}}},types:['memory']}]};
    assert.throws(()=>renew(changed),{code:'read_in_progress'});
    await pump.close();assert.equal(timers.size,0);await pump.completion;
  }
  for(const [set,coverage] of [[four,descriptor(four)],[readSet,ownerCoverage]]){
    const r=configured(t,f.path,set,{ownerCoverage:coverage}),h=await r.open();
    for(const intent of ['current','history']){
      const input={readSet:set,types:['memory'],intent,deadlineMs:5000};
      const status=ok(await h.getContextIndexStatus(input,r.token));assert.equal(status.lexical.state,'ready');
      assert.equal(status.coverage.status,set.length===32?'partial':'complete');assert.deepEqual(status.coverage.namespaces,coverage);
      assert.ok(ok(await h.findCandidates({...input,query:'cache'},r.token)).items.length>0);
    }
    assert.equal(r.view[5],0);await h.close();
  }
  assert.equal(a.view[5],0);assert.equal(b.view[5],0);
});


test('P2c fix1 pump renewal canonicalizes coverage key order and rejects a different selection',async t=>{
  const s=setup(t),pump=s.renew(s.c);
  const projections=s.c.projections.map(p=>({...p,options:{...p.options,
    ownerCoverage:Object.fromEntries(Object.entries(p.options.ownerCoverage).reverse())}}));
  assert.equal(s.renew({...s.c,projections}),pump);
  assert.equal(s.timers.size,1);assert.equal(s.opened.length,0);
  const changed=projections.map(p=>{
    const ownerCoverage={...p.options.ownerCoverage,selectionRevision:'changed'};
    const host=p.options.host,binding=host.configuration.serviceBinding;
    return {...p,options:{...p.options,ownerCoverage,host:{...host,configuration:{...host.configuration,
      serviceBinding:{...binding,namespaces:{...binding.namespaces,ownerCoverage}}}}}};
  });
  assert.throws(()=>s.renew({...s.c,projections:changed}),{code:'read_in_progress'});
  assert.throws(()=>s.renew({...s.c,projections:[projections[0]]}),{code:'read_in_progress'});
  const other=projections[1],readSet=[{ownerId:'pump',scope:'project',projectId:'different-project'}];
  const host=other.options.host,binding=host.configuration.serviceBinding;
  const selection={...other,options:{...other.options,readSet,host:{...host,configuration:{...host.configuration,
    serviceBinding:{...binding,namespaces:{...binding.namespaces,readSet}}}}}};
  assert.throws(()=>s.renew({...s.c,projections:[projections[0],selection]}),{code:'read_in_progress'});
  await pump.close();
});

// The merged identity is shared by renewal and native-handle lookup. Property
// order is irrelevant; every journal policy, type selection and intent is bound.
for(const difference of ['wal','sidecarJournalMode','ownerCoverage order','types'])
test(`P2c/P2d pump identity combines canonical coverage with ${difference}`,async t=>{
  const s=setup(t,{}, {exclusive:true}),base=s.c.projections[0];
  const first={...base,options:{...base.options,wal:true,sidecarJournalMode:'DELETE'}};
  const reordered=Object.fromEntries(Object.entries(base.options.ownerCoverage).reverse());
  const second={...first,options:{...first.options,ownerCoverage:reordered,
    ...(difference==='wal'?{wal:false}:difference==='sidecarJournalMode'?{sidecarJournalMode:'WAL'}:{})},
    types:difference==='types'?['memory','card']:first.types};
  s.c.projections=[first,second];
  const pump=s.renew(s.c);
  for(let i=0;i<4;i++)await s.next();
  const canonicalRenewal={...s.c,projections:s.c.projections.map(p=>({...p,options:{...p.options,
    ownerCoverage:Object.fromEntries(Object.entries(p.options.ownerCoverage).reverse())}}))};
  const openedBeforeRenewal=s.opened.length;
  assert.equal(s.renew(canonicalRenewal),pump);
  assert.equal(s.opened.length,openedBeforeRenewal);
  for(let i=0;i<4;i++)await s.next();
  // Eight dispatches alternate intent under one admitted native writer slot.
  // Every incompatible handle drains before its successor opens.
  assert.equal(s.opened.length,8);assert.equal(s.closed.length,7);
  assert.deepEqual(s.calls.map(([i])=>i.intent),['current','history','current','history','current','history','current','history']);
  for(const patch of [{wal:false},{sidecarJournalMode:'WAL'}]){
    const changed={...canonicalRenewal,projections:canonicalRenewal.projections.map((p,i)=>i?p:{...p,options:{...p.options,...patch}})};
    assert.throws(()=>s.renew(changed),{code:'read_in_progress'});
  }
  // A renewal that changes only one projection's types must not reuse the window.
  const typesOnly={...canonicalRenewal,projections:canonicalRenewal.projections.map((p,i)=>i?p:
    {...p,types:p.types.includes('card')?['memory']:['memory','card']})};
  assert.throws(()=>s.renew(typesOnly),{code:'read_in_progress'});
  await pump.close();assert.equal(s.closed.length,8);
});

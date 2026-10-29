import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import * as attribution from '../context-product-attribution.mjs';
import * as productReader from '../context-product-reader.mjs';
const { openContextIndexMaintainer } = productReader;
import * as productPump from '../context-product-pump.mjs';
const { createMaintenancePumpRuntime, maintenancePumpDiagnostic, maintenancePumpPhaseDiagnostic } = productPump;
import { createContextReadSupervisor } from '../context-read-supervisor.mjs';
import { credentialDigest } from '../context-product-control.mjs';
import { fixture, ok } from '../testing/context-read-fixture.mjs';
import { four, personal, project, configured, descriptor } from '../testing/context-product-owner-fixture.mjs';

const legacyStall=value=>{const {ordinal,pendingDispatch,...rest}=value;return rest;};
function setup(t,patch={},faults={}) {
  let now=0,serial=0;const timers=new Map(),calls=[],opened=[],closed=[],live=new Set(),observations=[],admissions=[];
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
  const cost=(name,n)=>typeof faults[name]==='function'?faults[name](n):faults[name]??0;
  const renew=createMaintenancePumpRuntime({phasesOf:faults.phasesOf,stallOf:faults.stallOf,now:()=>now,observedAt:()=>faults.observedAt?faults.observedAt(observations.at(-1)?.at):observations.at(-1)?.at,setTimer:(f,ms)=>{const id=++serial;timers.set(id,{f,at:now+ms});return id;},clearTimer:id=>timers.delete(id),
    open:async (opts,control)=>{if(faults.open)return faults.open(opts,control);const writer=JSON.stringify([opts.path,opts.readSet]);if(faults.exclusive)assert.equal(live.has(writer),false,'drain the previous writer before opening');live.add(writer);opened.push(opts);now+=cost('openMs',opened.length);return {async refreshContextIndex(input,token){calls.push([input,token]);if(faults.refresh)throw Error('refresh failed');now+=cost('dispatchMs',calls.length)+cost('workMs',calls.length);observations.push({at:now,input});now+=cost('deliveryMs',calls.length);return faults.result?faults.result(input):{ok:true,value:{status:'complete'}};},async close(){closed.push(opts);now+=cost('disposeMs',closed.length);if(faults.dispose)await faults.dispose(closed.length);live.delete(writer);if(faults.close)throw Error('close failed');}};}});
  return {renew,c,calls,opened,closed,timers,observations,admissions,setTime:n=>{now=n;},async next(){const [id,timer]=[...timers].sort((a,b)=>a[1].at-b[1].at)[0];timers.delete(id);now=timer.at;admissions.push(now);await timer.f();}};
}

test('pump round-robins both intents and active projections, renewal retains pump identity, restart preserves exhaustion',async t=>{
  const s=setup(t),pump=s.renew(s.c);assert.equal(s.renew(s.c),pump);
  for(let i=0;i<8;i++)await s.next();
  assert.deepEqual(s.calls.map(([i])=>[i.readSet[0].scope,i.intent]),[
    ['personal','current'],['personal','history'],['project','current'],['project','history'],
    ['personal','current'],['personal','history'],['project','current'],['project','history']]);
  assert.equal(s.opened.length,2);assert.equal(pump.getStatus().state,'budget_exhausted');assert.equal(s.timers.size,0);
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
  // End this duty interval before the deliberate jump to the next minute.
  // Leaving authority active during that jump would simulate overdue timers,
  // which must be reported rather than silently discard observation deadlines.
  const expired=p.completion;s.renew({...s.c,renewalMs:2000});assert.notEqual(p.completion,expired);await s.next();assert.equal(s.calls.length,1);
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
  assert.deepEqual(s.opened.map(o=>[o.wal,o.sidecarJournalMode]),[[true,'WAL'],[false,'DELETE']]);
  assert.deepEqual(s.calls.map(([i])=>i.intent),['current','history','current','history']);
  await pump.close();assert.equal(s.closed.length,s.opened.length);
});

test('P2-06/09/18 four/32 selection cutover prebuilds both intents and retires the closed selection',async t=>{
  const f=fixture(t),readSet=[personal,...Array.from({length:31},(_,i)=>project('p'+i))];
  for(const ns of [...four,readSet[1]])f.admit('pump cache '+(ns.projectId??'personal'),ns);
  const supervisor=createContextReadSupervisor();t.after(()=>supervisor.close());
  const a=configured(t,f.path,four,{service:true,supervisor});
  const ownerCoverage=descriptor(readSet,1),b=configured(t,f.path,[...readSet].reverse(),{service:true,supervisor,ownerCoverage});
  b.binding.credentialDigest=a.binding.credentialDigest;
  let now=0,serial=0;const timers=new Map(),attempted=new Set(),completed=new Set(),partial=new Set();
  const renew=createMaintenancePumpRuntime({now:()=>now,observedAt:()=>now,setTimer:(f,ms)=>{const id=++serial;timers.set(id,{f,at:now+ms});return id;},clearTimer:id=>timers.delete(id),
    open:async options=>{
      const h=await openContextIndexMaintainer(options);
      return {close:()=>h.close(),async refreshContextIndex(input,token){
        const key=input.readSet.length+':'+input.intent,first=!attempted.has(key);attempted.add(key);
        // Force a durable partial first quantum for both intents/selections.
        // The same native deadline applies; no machine-speed gate is needed.
        const result=await h.refreshContextIndex(first?{...input,budget:{...input.budget,maxItems:1}}:input,token);
        if(result.ok){if(first){assert.equal(result.value.status,'rebuilding');partial.add(key);}if(result.value.status==='complete')completed.add(key);}
        return result;
      }};
    }});
  const base={supervisor,window:{id:randomUUID(),endsAtMonoMs:60000,usedItems:0,usedMs:0},budgets:{maxItems:32*1024,maxMs:60000},
    quantum:{maxItems:1024,maxMs:1600},pollMs:1,renewalMs:60000,serviceCredential:a.token};
  // Activate each selection explicitly. Multi-selection round-robin is covered
  // above with the same mock scheduler; native operation cutoffs are unchanged.
  for(const options of [a.options,b.options]){
    const c={...base,id:randomUUID(),projections:[{options,types:['memory']}]},pump=renew(c);
    const ready=()=>['current','history'].every(intent=>completed.has(options.readSet.length+':'+intent));
    for(let i=0;i<12 && !ready();i++){
      assert.ok(timers.size,JSON.stringify(pump.getStatus()));
      const [id,timer]=[...timers].sort((a,b)=>a[1].at-b[1].at)[0];timers.delete(id);now=timer.at;await timer.f();
      assert.equal(pump.getStatus().error,null);
    }
    assert.equal(ready(),true,'bounded successful quanta must complete both intents');
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
      const status=ok(await h.getContextIndexStatus(input,r.token));
      if(set.length===4){
        assert.equal(status.lexical.state,'absent');assert.equal(status.lexical.reason,'missing');
        assert.equal(status.coverage.status,'unavailable');
        assert.equal((await h.findCandidates({...input,query:'cache'},r.token)).error.code,'index_unavailable');
        continue;
      }
      assert.equal(status.lexical.state,'ready');
      assert.equal(status.coverage.status,set.length===32?'partial':'complete');assert.deepEqual(status.coverage.namespaces,coverage);
      assert.ok(ok(await h.findCandidates({...input,query:'cache'},r.token)).items.length>0);
    }
    assert.equal(r.view[5],0);await h.close();
  }
  assert.equal(partial.size,4);
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
// order is irrelevant; journal policy and types bind residency, intent binds calls.
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
  // Intent alternation reuses; incompatible constructor selections still drain.
  const expected=difference==='ownerCoverage order'?1:4;
  assert.equal(s.opened.length,expected);assert.equal(s.closed.length,expected-1);
  assert.deepEqual(s.calls.map(([i])=>i.intent),['current','history','current','history','current','history','current','history']);
  for(const patch of [{wal:false},{sidecarJournalMode:'WAL'}]){
    const changed={...canonicalRenewal,projections:canonicalRenewal.projections.map((p,i)=>i?p:{...p,options:{...p.options,...patch}})};
    assert.throws(()=>s.renew(changed),{code:'read_in_progress'});
  }
  // A renewal that changes only one projection's types must not reuse the window.
  const typesOnly={...canonicalRenewal,projections:canonicalRenewal.projections.map((p,i)=>i?p:
    {...p,types:p.types.includes('card')?['memory']:['memory','card']})};
  assert.throws(()=>s.renew(typesOnly),{code:'read_in_progress'});
  await pump.close();assert.equal(s.closed.length,expected);
});

const settled = (transformed=0,status='complete') => ({ok:true,value:{status,progress:{transformed}}});

test('Fix A known usage refunds unused items and elapsed time including opening, preserving renewal/restart charges',async t=>{
  const s=setup(t,{}, {openMs:7,workMs:11,result:()=>settled(0,'rebuilding')}),p=s.renew(s.c);
  await s.next();assert.equal(p.getStatus().usedItems,0);assert.equal(p.getStatus().usedMs,18);
  s.renew(s.c);assert.equal(p.getStatus().usedMs,18);
  await p.close();
  const restarted=s.renew({...s.c,id:randomUUID()});assert.equal(restarted.getStatus().usedMs,18);
  await s.next();assert.equal(restarted.getStatus().usedItems,0);assert.equal(restarted.getStatus().usedMs,36);
  await restarted.close();
});

for(const usage of ['missing','invalid','crashed','failed','overrun'])test(`Fix A ${usage} usage retains the full reservation across renewal and restart`,async t=>{
  const faults={refresh:usage==='crashed',workMs:usage==='overrun'?101:0,result:()=>usage==='failed'?{ok:false,error:{code:'storage_error'}}:
    usage==='missing'?{ok:true,value:{status:'complete'}}:settled(usage==='invalid'?-1:0)};
  const s=setup(t,{},faults),p=s.renew(s.c);await s.next();
  if(['crashed','failed','overrun'].includes(usage))await p.completion;
  assert.equal(p.getStatus().usedItems,1);assert.equal(p.getStatus().usedMs,100);
  if(!['crashed','failed','overrun'].includes(usage))s.renew(s.c);
  await p.close();
  const restarted=s.renew({...s.c,id:randomUUID()});
  assert.equal(restarted.getStatus().usedItems,1);assert.equal(restarted.getStatus().usedMs,100);await restarted.close();
});

test('Fix A known partial usage returns only unused attempts and respects host cumulative floors',async t=>{
  const s=setup(t,{quantum:{maxItems:4,maxMs:100}}, {workMs:13,result:()=>settled(2)}),p=s.renew(s.c);
  await s.next();assert.equal(p.getStatus().usedItems,2);assert.equal(p.getStatus().usedMs,13);
  s.renew({...s.c,window:{...s.c.window,usedItems:5,usedMs:200}});
  await s.next();assert.equal(p.getStatus().usedItems,7);assert.equal(p.getStatus().usedMs,213);
  await p.close();
});

test('Fix A low-quota no-op scheduling spans the minute with every projection/intent observed within five seconds',async t=>{
  const s=setup(t,{pollMs:25,budgets:{maxItems:8,maxMs:8000}}, {result:()=>settled()}),p=s.renew(s.c);
  for(let i=0;i<60&&s.timers.size;i++)await s.next();
  assert.equal(p.getStatus().error,null);assert.equal((await p.completion).state,'budget_exhausted');
  assert.ok(s.calls.length>=47);assert.equal(p.getStatus().usedItems,0);assert.equal(p.getStatus().usedMs,0);
  assert.equal(s.observations[0].at,1250,'pace the first admission too');
  for(const scope of ['personal','project'])for(const intent of ['current','history']){
    const times=[0,...s.observations.filter(o=>o.input.readSet[0].scope===scope&&o.input.intent===intent).map(o=>o.at),60000];
    for(let i=1;i<times.length;i++)assert.ok(times[i]-times[i-1]<=5000,JSON.stringify(times));
  }
  assert.deepEqual(s.calls.slice(0,4).map(([i])=>[i.readSet[0].scope,i.intent]),[
    ['personal','current'],['personal','history'],['project','current'],['project','history']]);
  await p.close();
});

test('Fix A full known usage is paced while quota lasts and stops at exhaustion',async t=>{
  const s=setup(t,{pollMs:25}, {workMs:100,result:()=>settled(1)}),p=s.renew(s.c);
  for(let i=0;i<8;i++)await s.next();
  assert.deepEqual(s.observations.map(o=>o.at),[1350,2600,3850,5000,6250,7500,8750,10000]);
  assert.equal((await p.completion).state,'budget_exhausted');assert.equal(s.timers.size,0);
  assert.equal(p.getStatus().usedItems,8);assert.equal(p.getStatus().usedMs,800);await p.close();
});

for(const code of ['index_unavailable','authority_required','scope_changed','storage_error','storage_busy','reader_failed','store_closed'])
test(`Fix A genuine ${code} refusal stops scheduling, retains reservation and drains`,async t=>{
  // index_unavailable models a corruption refusal, never the private fence
  // rollback. The pump must not blanket-retry that sanitized public code.
  const s=setup(t,{}, {result:()=>({ok:false,error:{code}})}),p=s.renew(s.c);
  await s.next();const final=await p.completion;
  assert.equal(final.state,'failed');assert.equal(final.error,code);assert.equal(s.timers.size,0);
  assert.equal(s.calls.length,1);assert.equal(s.closed.length,1);
  assert.equal(final.usedItems,1);assert.equal(final.usedMs,100);await p.close();
});

test('Fix A in-flight renewal floors survive a later known-usage refund',async t=>{
  let release,entered;
  const dispatched=new Promise(resolve=>{entered=resolve;});
  const s=setup(t,{}, {result:()=>{entered();return new Promise(resolve=>{release=resolve;});}}),p=s.renew(s.c);
  const pending=s.next();await dispatched;
  s.renew({...s.c,window:{...s.c.window,usedItems:5,usedMs:200}});
  release(settled());await pending;
  assert.equal(p.getStatus().usedItems,5);assert.equal(p.getStatus().usedMs,200);await p.close();
});

for(const status of ['rebuilding','partial','complete'])test(`Fix A successful ${status} outcomes continue scheduling`,async t=>{
  const s=setup(t,{}, {result:()=>settled(0,status)}),p=s.renew(s.c);
  for(let i=0;i<9;i++)await s.next();
  assert.equal(p.getStatus().state,'active');assert.equal(p.getStatus().error,null);
  assert.equal(s.calls.length,9);assert.equal(s.timers.size,1);await p.close();
});

// Preserve the reviewers' quantum-5 latency stress after resident reuse removes
// their fifth open. Inject that cost into refresh instead; the third case also
// carries the former 12-ms drain + 60-ms open + 15-ms work into its 87-ms work.
// Actual incompatible-handle disposal/watchdog coverage remains below.
for(const [name,faults] of [
  ['spec reviewer',{openMs:10,workMs:n=>n===5?60:0,deliveryMs:10}],
  ['standards reviewer',{workMs:n=>n===5?90:0}],
  ['varying dispatch and refresh',{openMs:10,
    dispatchMs:n=>n===5?6:1,workMs:n=>n===5?87:n%4,deliveryMs:n=>n%3}],
  ['varying refresh and delivery',{openMs:5,dispatchMs:2,
    workMs:n=>n===5?70:3,deliveryMs:n=>n===4?50:2}],
])test(`Fix A1 actual observation cadence: ${name}`,async t=>{
  const s=setup(t,{}, {...faults,result:()=>settled()}),p=s.renew(s.c);
  for(let i=0;i<12;i++){
    await s.next();assert.equal(p.getStatus().state,'active');assert.equal(p.getStatus().error,null);
  }
  for(const scope of ['personal','project'])for(const intent of ['current','history']){
    const times=[0,...s.observations.filter(o=>o.input.readSet[0].scope===scope&&o.input.intent===intent).map(o=>o.at)];
    assert.equal(times.length,4,'three fair visits per projection');
    for(let i=1;i<times.length;i++)assert.ok(times[i]-times[i-1]<=5000,`${scope}/${intent}: ${JSON.stringify(times)}`);
  }
  assert.deepEqual(s.calls.map(([i])=>[i.readSet[0].scope,i.intent]),Array.from({length:3},()=>[
    ['personal','current'],['personal','history'],['project','current'],['project','history']]).flat());
  for(let i=1;i<s.admissions.length;i++)assert.ok(s.admissions[i]-s.admissions[i-1]>=1000,'minimum admission spacing');
  await p.close();assert.equal(s.closed.length,s.opened.length);
});

test('Fix A1 impossible observation headroom refuses before admission or quota charge',async t=>{
  const s=setup(t,{quantum:{maxItems:1,maxMs:1250},budgets:{maxItems:8,maxMs:10000}});
  // Four minimum 1,250-ms admissions already consume the entire sweep, leaving
  // no room for variation in the actual epoch observation within a quantum.
  assert.throws(()=>s.renew(s.c),{code:'invalid_input'});
  assert.equal(s.timers.size,0);assert.equal(s.opened.length,0);assert.equal(s.calls.length,0);
  const p=s.renew({...s.c,quantum:{maxItems:1,maxMs:100}});
  assert.equal(p.getStatus().usedItems,0);assert.equal(p.getStatus().usedMs,0);await p.close();
});

for(const boundary of ['authority','window'])
test(`Fix A1 continuous ${boundary} handoff preserves actual observation deadlines`,async t=>{
  const s=setup(t,{budgets:{maxItems:8,maxMs:60000},...(boundary==='authority'?{renewalMs:14000}:{})},
    {workMs:n=>n===12?99:0,result:()=>settled()});
  if(boundary==='window')s.c.window.endsAtMonoMs=14000;
  const p=s.renew(s.c);
  for(let i=0;i<11;i++)await s.next();
  s.setTime(14000);
  s.renew({...s.c,...(boundary==='window'?{window:{...s.c.window,id:'next',endsAtMonoMs:74000}}:{})});
  await s.next();assert.equal(p.getStatus().state,'active');assert.equal(p.getStatus().error,null);
  for(const scope of ['personal','project'])for(const intent of ['current','history']){
    const times=s.observations.filter(o=>o.input.readSet[0].scope===scope&&o.input.intent===intent).map(o=>o.at);
    assert.equal(times.length,3);
    for(let i=1;i<times.length;i++)assert.ok(times[i]-times[i-1]<=5000,`${boundary}: ${JSON.stringify(times)}`);
  }
  await p.close();
});

test('Fix A1 unexpected refresh overrun reports failed timeout and keeps its full reservation',async t=>{
  const s=setup(t,{}, {workMs:n=>n===5?5100:0,result:()=>settled()}),p=s.renew(s.c);
  for(let i=0;i<5;i++)await s.next();
  const final=p.getStatus();assert.equal(final.state,'failed');assert.equal(final.error,'read_timeout');
  assert.equal((await p.completion).error,'read_timeout');assert.equal(s.timers.size,0);
  assert.equal(final.usedItems,1);assert.equal(final.usedMs,100);
  await p.close();assert.equal(s.closed.length,s.opened.length);
});

for(const [name,observedAt] of [['missing',()=>undefined],['future',time=>time+1]])
test(`Fix A1 ${name} observation timing fails visibly without refund`,async t=>{
  const s=setup(t,{}, {observedAt,result:()=>settled()}),p=s.renew(s.c);
  await s.next();
  assert.equal(p.getStatus().state,'failed');assert.equal(p.getStatus().error,'reader_failed');
  assert.equal((await p.completion).error,'reader_failed');assert.equal(s.timers.size,0);
  assert.equal(p.getStatus().usedItems,1);assert.equal(p.getStatus().usedMs,100);await p.close();
});

test('Fix A2 overdue first timer reports missed observations and keeps maintaining',async t=>{
  const s=setup(t,{}, {result:()=>settled()}),p=s.renew(s.c);
  const [id,timer]=[...s.timers][0];s.timers.delete(id);s.setTime(5001);await timer.f();
  const status=p.getStatus();
  assert.equal(status.state,'active');assert.equal(status.error,null);
  const diagnostic=maintenancePumpDiagnostic(status);
  assert.equal(diagnostic.cadenceMisses,4);assert.equal(diagnostic.worstGapMs,5001);
  assert.deepEqual(diagnostic.observation,{projection:0,atMonoMs:5001,gapMs:5001,cadenceMiss:true});
  assert.equal(s.calls.length,1);assert.equal(s.opened.length,1);assert.equal(s.timers.size,1);
  for(let i=0;i<7;i++)await s.next();
  assert.equal(maintenancePumpDiagnostic(p.getStatus()).cadenceMisses,4,'one miss per overdue interval');
  assert.equal(p.getStatus().usedItems,0);assert.equal(p.getStatus().usedMs,0);await p.close();
  assert.equal(maintenancePumpDiagnostic(await p.completion).cadenceMisses,4);
});

for(const [name,delivered,workMs] of [
  ['spec late timer',6251,0],['standards late timer',6300,0],['late successful refresh',6240,20],
])test(`Fix A2 ${name} reports cadence and converges without renewal`,async t=>{
  const visits=new Map(),complete=new Set();
  const s=setup(t,{}, {workMs:n=>n===5?workMs:0,result:input=>{
    const key=JSON.stringify([input.readSet,input.intent]),count=(visits.get(key)??0)+1;
    visits.set(key,count);if(count>=3)complete.add(key);
    return settled(0,count>=3?'complete':'rebuilding');
  }}),p=s.renew(s.c);
  for(let i=0;i<4;i++)await s.next();
  assert.deepEqual(s.observations.map(o=>o.at),[1250,2500,3750,4900]);
  const before=p.getStatus(),[id,timer]=[...s.timers][0];
  assert.equal(timer.at,6150);s.timers.delete(id);s.setTime(delivered);await timer.f();
  const status=p.getStatus(),gap=delivered+workMs-1250;
  assert.equal(status.state,'active');assert.equal(status.error,null);assert.equal(s.timers.size,1);
  assert.equal(status.usedItems,0);assert.equal(status.usedMs,workMs,'known late usage is refunded');
  const diagnostic=maintenancePumpDiagnostic(status);
  assert.equal(diagnostic.cadenceMisses,1);assert.equal(diagnostic.worstGapMs,gap);
  assert.deepEqual(diagnostic.observation,{projection:0,atMonoMs:delivered+workMs,gapMs:gap,cadenceMiss:true});
  assert.deepEqual(maintenancePumpDiagnostic(before),{cadenceMisses:0,worstGapMs:0,
    observation:{projection:3,atMonoMs:4900,gapMs:4900,cadenceMiss:false}},'old status is an immutable snapshot');
  assert.deepEqual(Reflect.ownKeys(status).sort(),['error','id','maxItems','maxMs','state','usedItems','usedMs','windowId']);
  assert.equal(JSON.stringify(status).includes('cadence'),false,'internal diagnostic never enters public JSON');
  assert.ok(Object.isFrozen(diagnostic));assert.ok(Object.isFrozen(diagnostic.observation));
  assert.equal(await Promise.race([p.completion,Promise.resolve('pending')]),'pending');
  for(let i=0;i<11;i++)await s.next();
  assert.equal(complete.size,4,'all remaining projections converge from bounded successful work');
  assert.equal(p.getStatus().state,'active');assert.equal(p.getStatus().usedItems,0);assert.equal(p.getStatus().usedMs,workMs);
  assert.equal(p.getStatus().windowId,s.c.window.id);assert.equal(s.timers.size,1);
  for(const scope of ['personal','project'])for(const intent of ['current','history']){
    const times=s.observations.filter(o=>o.input.readSet[0].scope===scope&&o.input.intent===intent).map(o=>o.at);
    assert.equal(times.length,4,'fair round-robin visits');
    assert.ok(times[3]-times[2]<=5000,'actual observation deadlines recover after the delayed sweep');
  }
  const final=maintenancePumpDiagnostic(p.getStatus());
  assert.equal(final.cadenceMisses,1,'the remaining lanes recover before their deadlines');
  assert.equal(final.worstGapMs,Math.max(...s.observations.slice(4).map((o,i)=>o.at-s.observations[i].at)));
  await p.close();assert.equal(s.closed.length,s.opened.length);assert.equal(s.timers.size,0);
});

test('Fix A2 successful delivery crossing other observation deadlines keeps scheduling and refunds',async t=>{
  const s=setup(t,{}, {workMs:n=>n===1?20:0,deliveryMs:n=>n===1?40:0,result:()=>settled()}),p=s.renew(s.c);
  const [id,timer]=[...s.timers][0];s.timers.delete(id);s.setTime(4950);await timer.f();
  assert.equal(p.getStatus().state,'active');assert.equal(p.getStatus().error,null);
  assert.equal(p.getStatus().usedItems,0);assert.equal(p.getStatus().usedMs,60);
  const diagnostic=maintenancePumpDiagnostic(p.getStatus());
  assert.equal(diagnostic.cadenceMisses,3);assert.equal(diagnostic.worstGapMs,5010);
  assert.deepEqual(diagnostic.observation,{projection:0,atMonoMs:4970,gapMs:4970,cadenceMiss:false});
  for(let i=0;i<7;i++)await s.next();
  assert.equal(p.getStatus().state,'active');assert.equal(s.timers.size,1);
  assert.equal(maintenancePumpDiagnostic(p.getStatus()).cadenceMisses,3);await p.close();
});

for(const cutoff of ['native','parent'])test(`Fix A2 ${cutoff} quantum cutoff after cadence recovery still stops and drains`,async t=>{
  let attempt=0,entered,release;
  const pending=new Promise(resolve=>{entered=resolve;});
  const s=setup(t,{}, {workMs:n=>n===5?20:0,result:()=>{
    if(++attempt!==6)return settled();
    if(cutoff==='native')return {ok:false,error:{code:'read_timeout'}};
    entered();return new Promise(resolve=>{release=()=>resolve(settled());});
  }}),p=s.renew(s.c);
  for(let i=0;i<4;i++)await s.next();
  const [id,timer]=[...s.timers][0];s.timers.delete(id);s.setTime(6240);await timer.f();
  assert.equal(p.getStatus().state,'active');assert.equal(p.getStatus().usedMs,20);
  const operation=s.next();
  if(cutoff==='parent'){
    await pending;
    try{
      const [timerId,deadline]=[...s.timers][0];s.timers.delete(timerId);s.setTime(deadline.at);await deadline.f();
      assert.equal(p.getStatus().error,'read_timeout','parent cutoff is visible before operation settles');
    }finally{release();}
  }
  await operation;
  const final=await p.completion;
  assert.equal(final.state,'failed');assert.equal(final.error,'read_timeout');
  assert.equal(final.usedItems,1);assert.equal(final.usedMs,120,'uncertain cutoff retains the full reservation');
  assert.equal(maintenancePumpDiagnostic(final).cadenceMisses,1);
  assert.equal(s.timers.size,0);await p.close();assert.equal(s.closed.length,s.opened.length);
});

test('Fix A1 Worker epoch observation time stays outside the public DTO',async t=>{
  const f=fixture(t),service=configured(t,f.path,[personal],{service:true});
  const h=await openContextIndexMaintainer({...service.options,deadlineMs:5000});t.after(()=>h.close());
  const before=Number(process.hrtime.bigint())/1e6;
  const result=await h.refreshContextIndex({readSet:[personal],types:['memory'],intent:'current',mode:'lexical',
    budget:{maxItems:128,maxMs:1000}},service.token);
  assert.equal(result.ok,true);
  const time=productReader.maintenanceObservation?.(result);
  assert.ok(time>=before&&time<=Number(process.hrtime.bigint())/1e6,'timestamp from the fresh final Worker snapshot');
  assert.deepEqual(Object.keys(result).sort(),['ok','value']);
  assert.deepEqual(Object.keys(result.value).sort(),['channels','coverage','progress','status']);
});


test('Fix A1 pending disposal reports timeout before it settles and never dispatches its successor',async t=>{
  let entered,release;
  const disposing=new Promise(resolve=>{entered=resolve;});
  const s=setup(t,{}, {result:()=>settled(),dispose:n=>n===1?new Promise(resolve=>{release=resolve;entered();}):undefined});
  // A real constructor change on the same physical selection triggers disposal.
  s.c.projections=[s.c.projections[0],{...s.c.projections[0],types:['memory','card']}];
  const p=s.renew(s.c);await s.next();await s.next();
  const pending=s.next();await disposing;
  try{
    assert.equal(s.timers.size,1,'parent deadline supervises pending disposal');
    const [id,deadline]=[...s.timers][0];s.timers.delete(id);s.setTime(deadline.at);await deadline.f();
    assert.equal(p.getStatus().state,'failed');assert.equal(p.getStatus().error,'read_timeout');
    assert.equal(s.calls.length,2);assert.equal(s.opened.length,1);
  }finally{release();await pending;}
  const final=await p.completion;assert.equal(final.error,'read_timeout');
  assert.equal(final.usedItems,1);assert.equal(final.usedMs,100);assert.equal(s.timers.size,0);
  await p.close();assert.equal(s.closed.length,s.opened.length);
});

for(const recovered of [false,true])for(const boundary of ['authority','window'])for(const action of ['expiry','renew','expiry then renew'])
test(`Fix A3 ${recovered?'recovered':'unvisited'} lanes retain cadence at ${boundary} ${action}`,async t=>{
  const endpoint=recovered?8000:10000;
  const s=setup(t,{...(boundary==='authority'?{renewalMs:endpoint}:{})},
    {result:()=>settled()});
  if(boundary==='window')s.c.window.endsAtMonoMs=endpoint;
  const p=s.renew(s.c),completion=p.completion;
  if(recovered){
    for(let i=0;i<4;i++)await s.next();
    assert.deepEqual(s.observations.map(o=>o.at),[1250,2500,3750,4900]);
    const [id,timer]=[...s.timers][0];s.timers.delete(id);s.setTime(6300);await timer.f();
    assert.equal(maintenancePumpDiagnostic(p.getStatus()).cadenceMisses,1);
  }
  const [id,timer]=[...s.timers][0];s.timers.delete(id);s.setTime(endpoint+(recovered?100:1));
  const expected={cadenceMisses:recovered?2:4,worstGapMs:recovered?5500:10000};
  const check=status=>{
    const {cadenceMisses,worstGapMs}=maintenancePumpDiagnostic(status);
    assert.deepEqual({cadenceMisses,worstGapMs},expected);
  };
  if(action!=='renew'){
    await timer.f();check(await completion);
    assert.equal(s.calls.length,recovered?5:0);
    assert.equal(p.getStatus().state,boundary==='authority'?'renewal_expired':'budget_exhausted');
  }
  if(action!=='expiry'){
    s.renew({...s.c,...(boundary==='window'?{window:{...s.c.window,id:'next',endsAtMonoMs:endpoint+60000}}:{})});
    check(p.getStatus());
    if(boundary==='window')check(await completion);
    await s.next();check(p.getStatus());
    assert.equal(p.getStatus().state,'active');
  }
  check(p.getStatus());await p.close();
});

for(let residents=1;residents<=4;residents++)
test(`Fix A3 product configuration admits ${residents} resident owner pumps with separate minute windows`,async t=>{
  const pumps=[];
  for(let owner=0;owner<residents;owner++){
    const s=setup(t,{quantum:{maxItems:32,maxMs:1000},budgets:{maxItems:2048,maxMs:60000},pollMs:25,renewalMs:60000},
      {result:()=>settled()});
    const options=s.c.projections[0].options,readSet=four.map(ns=>({...ns,ownerId:'product-'+owner})),ownerCoverage=descriptor(readSet);
    const serviceBinding={...options.host.configuration.serviceBinding,ownerId:readSet[0].ownerId,namespaces:{readSet,ownerCoverage}};
    s.c.projections=[{types:['memory','card'],options:{...options,readSet,ownerCoverage,
      host:{...options.host,configuration:{serviceBinding}}}}];
    s.c.window.id='owner-'+owner+'-utc-minute';
    // One owner selection has two intent lanes: 2*max(25,1000)+1000=3000 <=5000.
    const p=s.renew(s.c);pumps.push({s,p});
    assert.equal(p.getStatus().state,'active');
  }
  assert.equal(pumps.length,residents);
  // Host nudges at 3 seconds and ticks at 20/40 seconds retain identity and
  // leave the internal cadence timer active; renewal is 60 seconds.
  for(const {s,p} of pumps){
    for(const at of [3000,20000,40000]){
      while(Math.min(...[...s.timers.values()].map(timer=>timer.at))<=at)await s.next();
      s.setTime(at);assert.equal(s.renew(s.c),p);
      assert.equal(p.getStatus().state,'active');
    }
    assert.equal(s.timers.size,1);assert.equal(maintenancePumpDiagnostic(p.getStatus()).cadenceMisses,0);
    assert.deepEqual(new Set(s.calls.map(([input])=>input.intent)),new Set(['current','history']));
    assert.equal(p.getStatus().usedItems,0);assert.equal(p.getStatus().usedMs,0);
    await p.close();
  }
});


for(const residents of [1,4])test(`B0 ${residents} owner split reuses one maintainer across intents and preserves reservations`,async t=>{
  const pumps=[];
  for(let owner=0;owner<residents;owner++){
    let pump,attempt=0;
    const s=setup(t,{quantum:{maxItems:32,maxMs:1000},budgets:{maxItems:2048,maxMs:60000},pollMs:25},
      {exclusive:true,openMs:7,workMs:11,result:()=>{
        const status=pump.getStatus();
        assert.equal(status.usedItems,32,'full item reservation before every dispatch');
        assert.equal(status.usedMs,1000+(attempt++?18:0),'full time reservation before dispatch');
        return settled();
      }});
    const options=s.c.projections[0].options,readSet=four.map(ns=>({...ns,ownerId:'resident-'+owner})),ownerCoverage=descriptor(readSet);
    const serviceBinding={...options.host.configuration.serviceBinding,ownerId:readSet[0].ownerId,namespaces:{readSet,ownerCoverage}};
    s.c.projections=[{types:['memory','card'],options:{...options,readSet,ownerCoverage,host:{...options.host,configuration:{serviceBinding}}}}];
    pump=s.renew(s.c);pumps.push({s,pump});
    await s.next();assert.equal(pump.getStatus().usedMs,18);
    await s.next();assert.equal(pump.getStatus().usedMs,29);
    assert.equal(pump.getStatus().usedItems,0);
    assert.deepEqual(s.calls.map(([input])=>input.intent),['current','history']);
    assert.equal(s.opened.length,1);assert.equal(s.closed.length,0);
  }
  for(const {s,pump} of pumps){await pump.close();assert.equal(s.closed.length,1);}
});

test('B0 bounded phase counters include opening in quantum zero, remain private and immutable',async t=>{
  const s=setup(t,{budgets:{maxItems:2048,maxMs:60000}},
    {openMs:7,workMs:11,deliveryMs:2,result:()=>settled(),phasesOf:()=>({dispatchMs:1,epochObservationMs:2,deliveryMs:3,canonicalRows:4,metadataBytes:5,reused:6,replaced:7,removed:8,copied:9,tokenized:10,retargets:11,verificationRestarts:12,verificationKept:13,path:'private-diagnostic-probe',credential:'private-diagnostic-probe'})});
  s.c.projections=[s.c.projections[0]];
  const p=s.renew(s.c);await s.next();const before=p.getStatus(),first=maintenancePumpPhaseDiagnostic(before);
  const shape=JSON.stringify(first).length;
  for(let i=0;i<20;i++)await s.next();
  const status=p.getStatus(),detail=maintenancePumpPhaseDiagnostic(status),[current,history]=detail.projections;
  assert.equal(current.first.number,0);assert.equal(current.first.elapsedMs,20);
  assert.equal(history.first.elapsedMs,13,'resident history has no open cost');
  assert.equal(current.phases.open.count,1);assert.equal(history.phases.open.count,0);
  assert.equal(current.phases.refreshCall.latestMs,13);
  assert.equal(current.phases.dispatch.latestMs,1);assert.equal(current.phases.epochObservation.latestMs,2);
  assert.equal(current.phases.settle.latestMs,3);assert.equal(current.phases.settle.count,11);
  assert.equal(current.work.canonicalRows,44);assert.equal(current.work.metadataBytes,55);
  for(const [i,name] of ['reused','replaced','removed','copied','tokenized','retargets','verificationRestarts','verificationKept'].entries())assert.equal(current.work[name],11*(i+6));
  assert.equal(JSON.stringify(detail).includes('private-diagnostic-probe'),false);
  assert.equal(current.quanta,11);assert.equal(history.quanta,10);
  assert.equal(current.elapsedBuckets.length,502);assert.equal(history.elapsedBuckets.length,502);
  assert.equal(current.elapsedBuckets.reduce((a,b)=>a+b),11);
  assert.equal(detail.projections.length,2);assert.ok(JSON.stringify(detail).length<shape+500,'fixed counters, no sample history');
  assert.equal(first.projections[0].quanta,1);assert.ok(Object.isFrozen(current.elapsedBuckets));
  assert.equal(JSON.stringify(detail).includes(s.c.projections[0].options.path),false);
  assert.equal(JSON.stringify(detail).includes(s.c.serviceCredential.service),false);
  assert.equal(JSON.stringify(status).includes('phases'),false);
  const publicEntry=await import('../index.mjs');
  assert.equal(publicEntry.maintenancePumpPhaseDiagnostic,undefined);
  assert.equal(publicEntry.maintenancePhaseDiagnostic,undefined);
  await p.close();
  assert.equal(maintenancePumpPhaseDiagnostic(await p.completion).projections[0].phases.drain.count,1);
});

test('B0 fresh native calls on a resident maintainer alternate intents, retain admission and reject foreign scope',async t=>{
  const f=fixture(t),service=configured(t,f.path,[personal],{service:true});f.admit('resident lexical evidence',personal);
  const h=await openContextIndexMaintainer(service.options);t.after(()=>h.close());
  await assert.rejects(openContextIndexMaintainer(service.options),{code:'read_in_progress'});
  await service.supervisor.drain(); // Failed admission quarantines until disposal is acknowledged.
  for(const intent of ['current','history','current','history']){
    const raw=await h.refreshContextIndex({readSet:[personal],types:['memory'],intent,mode:'lexical',budget:{maxItems:32,maxMs:1000}},service.token);
    assert.equal(raw.ok,true,JSON.stringify(raw));
    const d=productReader.maintenancePhaseDiagnostic(raw);
    for(const name of ['dispatchMs','epochObservationMs','deliveryMs'])assert.ok(Number.isFinite(d[name])&&d[name]>=0,name);
    assert.ok(Number.isSafeInteger(d.canonicalRows));assert.ok(Number.isSafeInteger(d.metadataBytes));
    for(const name of ['reused','replaced','removed','copied','tokenized','retargets','verificationRestarts','verificationKept'])assert.ok(Number.isSafeInteger(d[name]),name);
    assert.equal(JSON.stringify(raw).includes('dispatchMs'),false);
  }
  const foreign=configured(t,f.path,[project('foreign')],{service:true});
  const raw=await h.refreshContextIndex({readSet:[project('foreign')],types:['memory'],intent:'history',mode:'lexical',budget:{maxItems:32,maxMs:1000}},foreign.token);
  assert.equal(raw.error.code,'authority_required');
  service.view[0]=0;
  const revoked=await h.refreshContextIndex({readSet:[personal],types:['memory'],intent:'history',mode:'lexical',budget:{maxItems:32,maxMs:1000}},service.token);
  assert.equal(revoked.error.code,'authority_required');
  await h.close();const replacement=await openContextIndexMaintainer(service.options);await replacement.close();
});


for(const change of ['binding','shared state','diagnostics','deadline'])
test(`B0 changed ${change} drains the incompatible resident before replacement`,async t=>{
  const s=setup(t,{}, {exclusive:true,result:()=>settled()}),base=s.c.projections[0];
  const options={...base.options,diagnostics:true,deadlineMs:5000,
    host:{...base.options.host,configuration:{...base.options.host.configuration,state:new SharedArrayBuffer(4)}}};
  const next={...options,
    ...(change==='diagnostics'?{diagnostics:false}:change==='deadline'?{deadlineMs:4000}:{}),
    host:{...options.host,configuration:{...options.host.configuration,
      ...(change==='binding'?{serviceBinding:{...options.host.configuration.serviceBinding,credentialBindingId:'other-binding'}}:{}),
      ...(change==='shared state'?{state:new SharedArrayBuffer(4)}:{})}}};
  s.c.projections=[{...base,options},{...base,options:next}];
  const p=s.renew(s.c);
  await s.next();await s.next();assert.equal(s.opened.length,1);assert.equal(s.closed.length,0);
  await s.next();assert.equal(s.opened.length,2);assert.equal(s.closed.length,1);
  await s.next();assert.equal(s.opened.length,2);assert.equal(s.closed.length,1);
  assert.equal(p.getStatus().error,null);
  const renewal={...s.c,projections:[s.c.projections[0],{...base,options}]};
  assert.throws(()=>s.renew(renewal),{code:'read_in_progress'});
  await p.close();assert.equal(s.closed.length,2);
});

for(const ending of ['stop','failure','supervisor'])test(`B0 ${ending} drains the resident after intent reuse`,async t=>{
  let attempt=0;
  const s=setup(t,{}, {result:()=>++attempt===3&&ending==='failure'?{ok:false,error:{code:'storage_error'}}:settled()});
  s.c.projections=[s.c.projections[0]];
  const p=s.renew(s.c);await s.next();await s.next();
  assert.equal(s.opened.length,1);assert.equal(s.closed.length,0);
  if(ending==='failure'){
    await s.next();const final=await p.completion;assert.equal(final.error,'storage_error');
    assert.equal(final.usedItems,1);assert.equal(final.usedMs,100,'failed reused call keeps its full reservation');
  }else if(ending==='supervisor')await s.c.supervisor.close();else await p.close();
  assert.equal(s.opened.length,1);assert.equal(s.closed.length,1);assert.equal(s.timers.size,0);
  await p.close();
});


test('B0 continuous handoff retains residency; an inactive renewal replaces the possibly idle reader',async t=>{
  const s=setup(t,{renewalMs:4000},{exclusive:true,result:()=>settled()});
  s.c.projections=[s.c.projections[0]];
  const p=s.renew(s.c);await s.next();await s.next();
  assert.equal(s.opened.length,1);
  s.setTime(4000);s.renew(s.c);await s.next();
  assert.equal(s.opened.length,1,'continuous authority handoff preserves the resident');
  s.setTime(10000);s.renew({...s.c,renewalMs:60000});await s.next();
  assert.equal(p.getStatus().state,'active');assert.equal(s.opened.length,2);assert.equal(s.closed.length,1);
  await p.close();assert.equal(s.closed.length,2);
});

test('B0 mutable shared host state retains identity while a new buffer replaces it',async t=>{
  const s=setup(t,{}, {exclusive:true,result:()=>settled()}),base=s.c.projections[0];
  const state=new SharedArrayBuffer(4);
  s.c.projections=[{...base,options:{...base.options,host:{...base.options.host,
    configuration:{...base.options.host.configuration,state}}}}];
  const p=s.renew(s.c);await s.next();
  Atomics.store(new Int32Array(state),0,1);
  assert.equal(s.renew(s.c),p);await s.next();assert.equal(s.opened.length,1);assert.equal(s.closed.length,0);
  const changed={...s.c,projections:s.c.projections.map(projection=>({...projection,options:{...projection.options,
    host:{...projection.options.host,configuration:{...projection.options.host.configuration,state:new SharedArrayBuffer(4)}}}}))};
  assert.throws(()=>s.renew(changed),{code:'read_in_progress'});
  await p.close();
});

test('B1 private work counters saturate at safe integers',async t=>{
  const names=['reused','replaced','removed','copied','tokenized','retargets','verificationRestarts','verificationKept'];
  const s=setup(t,{budgets:{maxItems:2048,maxMs:60000}},
    {result:()=>settled(),phasesOf:()=>Object.fromEntries(names.map(name=>[name,Number.MAX_SAFE_INTEGER]))});
  s.c.projections=[s.c.projections[0]];const pump=s.renew(s.c);
  for(let i=0;i<4;i++)await s.next();
  for(const lane of maintenancePumpPhaseDiagnostic(pump.getStatus()).projections)
    for(const name of names)assert.equal(lane.work[name],Number.MAX_SAFE_INTEGER);
  await pump.close();
});

for(const kind of [1,2,3,4,5,6,7,8,9,10,11])
test(`stall attribution: pump watchdog retains kind ${kind}, full reservation and one bounded record`,async t=>{
  let entered,release;const rendezvous=new Promise(resolve=>{entered=resolve;});
  const s=setup(t,{}, {workMs:20,stallOf:(_value,time)=>({kind,runningMs:time-s.observations.at(-1).at,unitCount:7}),
    result:()=>{entered();return new Promise(resolve=>{release=()=>resolve({ok:false,error:{code:'read_timeout'}});});}});
  s.c.projections=[s.c.projections[0]];const p=s.renew(s.c),pending=s.next();await rendezvous;
  try {
    const [id,deadline]=[...s.timers][0];s.timers.delete(id);s.setTime(deadline.at);await deadline.f();
    const lane=maintenancePumpPhaseDiagnostic(p.getStatus()).projections[0];
    assert.deepEqual(legacyStall(lane.lastStall),{number:0,kind,runningMs:80,unitCount:7},'last stall survives parent watchdog before pending refresh returns');
    assert.equal(lane.stallCounts[kind],1);assert.equal(lane.stallCounts.reduce((a,b)=>a+b),1);
    assert.equal(p.getStatus().error,'read_timeout');assert.equal(p.getStatus().usedItems,1);assert.equal(p.getStatus().usedMs,100);
  } finally {release();await pending;await p.close();}
  const final=await p.completion,lane=maintenancePumpPhaseDiagnostic(final).projections[0];
  assert.equal(final.usedMs,100,'terminal quantum receives no refund');assert.equal(final.usedItems,1);
  assert.equal(lane.stallCounts[kind],1,'reader timeout and pump watchdog count the quantum once');
  assert.equal(s.calls.length,1,'terminal cutoff drains without another dispatch');assert.equal(s.timers.size,0);
  assert.equal(JSON.stringify(final).includes('lastStall'),false);
});

for(const boundary of ['overrun','reader cutoff'])test(`stall attribution: ${boundary} records without timer delivery`,async t=>{
  const s=setup(t,{}, {workMs:boundary==='overrun'?101:20,stallOf:()=>({kind:8,runningMs:44,unitCount:3}),
    result:()=>boundary==='overrun'?settled():{ok:false,error:{code:'read_timeout'}}});
  const p=s.renew(s.c);await s.next();const final=await p.completion;
  assert.deepEqual(legacyStall(maintenancePumpPhaseDiagnostic(final).projections[0].lastStall),{number:0,kind:8,runningMs:44,unitCount:3},'overrun/cutoff samples active operation');
  assert.equal(final.error,'read_timeout');assert.equal(final.usedItems,1);assert.equal(final.usedMs,100);await p.close();
});

test('stall attribution: per-field aggregation saturates and excludes unknown fields',async t=>{
  const names=['unitCount','scanUnits','itemUnits','verificationUnits','publicationUnits','gcUnits','scanRows','itemRows','verificationRows','publicationRows','gcRows',
    'lastUnitKind','lastUnitMs','longestUnitKind','longestUnitMs','beginWaitMaxMs','beginWaitSumMs','commitMaxMs','commitSumMs','canonicalReadWaitMaxMs',
    'saveSigningMs','gcSliceMs','vacuumMs','resultPreparationMs','serializationMs','serializationComplete','deliveryMs','returnMs'];
  const s=setup(t,{budgets:{maxItems:2048,maxMs:60000}}, {result:()=>settled(),phasesOf:()=>({...Object.fromEntries(names.map(k=>[k,Number.MAX_SAFE_INTEGER])),privateProbe:123})});
  s.c.projections=[s.c.projections[0]];const p=s.renew(s.c);for(let i=0;i<4;i++)await s.next();
  const detail=maintenancePumpPhaseDiagnostic(p.getStatus());
  for(const lane of detail.projections)for(const name of names){
    assert.equal(lane.attribution?.[name]?.total,Number.MAX_SAFE_INTEGER,name+' aggregate saturates');
    assert.equal(lane.attribution[name].count,2);assert.equal(lane.attribution[name].buckets.reduce((a,b)=>a+b),2);
    assert.equal(lane.latest.attribution[name],Number.MAX_SAFE_INTEGER,name+' latest quantum field');
  }
  assert.equal(JSON.stringify(detail).includes('privateProbe'),false);await p.close();
});

test('round 1 A3 pump captures a cutoff while maintenance open is pending',async t=>{
  let entered,rejectOpen;const waiting=new Promise(resolve=>{entered=resolve;});let active;
  const s=setup(t,{}, {open:(_opts,control)=>{active=control;entered();return new Promise((_resolve,reject)=>{rejectOpen=reject;});},stallOf:value=>value&&value===active?{kind:7,runningMs:100,unitCount:0}:undefined});
  const p=s.renew(s.c),pending=s.next();await waiting;
  const [id,deadline]=[...s.timers][0];s.timers.delete(id);s.setTime(deadline.at);await deadline.f();
  rejectOpen(Object.assign(Error('read_timeout'),{code:'read_timeout'}));await pending;const final=await p.completion;
  assert.equal(maintenancePumpPhaseDiagnostic(final).projections[0].lastStall?.kind,7,'pending-open snapshot reaches pump stall record');
  const lane=maintenancePumpPhaseDiagnostic(final).projections[0];
  assert.ok(lane.lastStall.ordinal>0);assert.equal(lane.lastStall.ordinal,lane.latest.ordinal);
  assert.equal(final.usedItems,1);assert.equal(final.usedMs,100);await p.close();
});

test('round 1 A4 independent pumps expose unique ordinals in quantum samples and stall records',async t=>{
  const fixtures=[setup(t,{}, {result:()=>settled()}),setup(t,{}, {result:()=>settled()})],values=[];
  for(const s of fixtures){const p=s.renew(s.c);await s.next();const lane=maintenancePumpPhaseDiagnostic(p.getStatus()).projections[0];
    assert.ok(Number.isSafeInteger(lane.latest.ordinal)&&lane.latest.ordinal>0,'quantum sample has dispatch join ordinal');values.push(lane.latest.ordinal);await p.close();}
  assert.equal(new Set(values).size,2,'different pumps do not reuse ordinal zero');
});


test('round 2 C1 exhausted ordinals preserve successful pump dispatch and exact refunds',async t=>{
  const state=globalThis[Symbol.for('context-read-product/maintenance-dispatch-ordinal')],saved=state.next;
  t.after(()=>{state.next=saved;});
  const results=[];
  for(const exhaustion of [0,1,2]){
    const exhausted=exhaustion>0;state.next=exhausted?Number.MAX_SAFE_INTEGER-(exhaustion===1?1:0):saved;
    const s=setup(t,{quantum:{maxItems:4,maxMs:100}},{openMs:7,workMs:11,result:()=>settled(2)}),pump=s.renew(s.c);
    await s.next();const status=pump.getStatus(),lane=maintenancePumpPhaseDiagnostic(status).projections[0];
    assert.equal(s.calls.length,1,'exhausted counter still dispatches the quantum');
    assert.equal(s.opened.length,1);assert.equal(status.error,null);assert.equal(status.usedItems,2);assert.equal(status.usedMs,18);
    if(exhausted){assert.equal(Object.hasOwn(lane.latest,'ordinal'),false,'exhausted sample has no join key');assert.equal(Object.hasOwn(lane.latest,'openingOrdinal'),false);}
    results.push({state:status.state,error:status.error,usedItems:status.usedItems,usedMs:status.usedMs,admissions:s.admissions,calls:s.calls.map(([input])=>input)});
    await pump.close();
  }
  for(const result of results.slice(1))assert.deepEqual(result,results[0],'exhausted attribution preserves healthy admission, dispatch and refund');
});

test('round 2 C1 exhausted cutoff records no join key or previous-call attribution',async t=>{
  const state=globalThis[Symbol.for('context-read-product/maintenance-dispatch-ordinal')],saved=state.next;
  t.after(()=>{state.next=saved;});state.next=Number.MAX_SAFE_INTEGER;
  const s=setup(t,{}, {workMs:101,result:()=>settled(),stallOf:()=>({ordinal:123,kind:8,runningMs:9999,unitCount:7})}),pump=s.renew(s.c);
  await s.next();const status=await pump.completion,lane=maintenancePumpPhaseDiagnostic(status).projections[0];
  assert.equal(s.calls.length,1,'exhausted cutoff still dispatches');assert.equal(status.error,'read_timeout');assert.equal(status.usedItems,1);assert.equal(status.usedMs,100);
  assert.ok(lane.lastStall,'exhausted cutoff keeps an unattributed stall record');
  for(const value of [lane.latest,lane.lastStall])assert.equal(Object.hasOwn(value,'ordinal'),false,'exhausted records have no join key');
  assert.deepEqual(lane.lastStall,{number:0,kind:0,runningMs:0,unitCount:0,unattributed:1},'exhaustion never accepts previous-call units or guesses running time');
  await pump.close();
});

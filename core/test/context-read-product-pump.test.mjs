import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createMaintenancePumpRuntime } from '../context-product-pump.mjs';
import { createContextReadSupervisor } from '../context-read-supervisor.mjs';
import { credentialDigest } from '../context-product-control.mjs';

function setup(t,patch={}) {
  let now=0,serial=0;const timers=new Map(),calls=[],opened=[],closed=[];
  const supervisor=createContextReadSupervisor();t.after(()=>supervisor.close());
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
    open:async opts=>{opened.push(opts);return {async refreshContextIndex(input,token){calls.push([input,token]);return {ok:true,value:{status:'complete'}};},async close(){closed.push(opts);}};}});
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

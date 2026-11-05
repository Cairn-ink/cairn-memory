import { admitMaintenance, refreshMaintenance, attachMaintenanceAdmissionReceipt } from '../context-product-admission.mjs';
import { testClock } from '../testing/context-product-test-clock.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { setTimeout as realDelay } from 'node:timers/promises';
import { fixture, ns, ok } from '../testing/context-read-fixture.mjs';
import { configured } from '../testing/context-product-owner-fixture.mjs';
import { credentialDigest } from '../context-product-control.mjs';
import { openContextIndexMaintainer } from '../context-product-reader.mjs';
import { createMaintenancePumpRuntime, maintenancePumpDiagnostic, maintenancePumpPhaseDiagnostic } from '../context-product-pump.mjs';

async function guard(promise) {
  const abort=new AbortController();
  try {return await Promise.race([promise,realDelay(15000,undefined,{signal:abort.signal}).then(()=>{throw Error('handoff hang guard');})]);}
  finally {abort.abort();}
}
function setup(t,{native=false,duration=7000,renewalMs=60000}={}) {
  const f=fixture(t);f.admit('resident handoff');
  const service=configured(t,f.path,[ns],{service:true});
  const token={...service.token,leaseFence:{generation:1,owner:'synthetic-service'}};
  service.binding.credentialDigest=credentialDigest(token);
  let time=0,serial=0;const timers=new Map(),opened=[],closed=[],calls=[];
  const now=()=>native?testClock.now():time,start=now();
  const renew=createMaintenancePumpRuntime({admit:async(h,...args)=>{if(native)return admitMaintenance(h.native,...args);const r={ok:true,value:null};attachMaintenanceAdmissionReceipt(r,'admitted');return r;},work:(h,...args)=>h.refreshContextIndex(...args),now,setTimer:(fn,ms)=>{const id=++serial;timers.set(id,{fn,at:now()+ms});return id;},clearTimer:id=>timers.delete(id),
    ...(native?{}:{observedAt:()=>now()}),
    open:async (...args)=>{
      const handle=native?await guard(openContextIndexMaintainer(...args)):{async close(){},async refreshContextIndex(){return {ok:true,value:{status:'complete',progress:{transformed:0}}};}};
      opened.push(handle);
      return {native:handle,async close(){closed.push(handle);await handle.close();},async refreshContextIndex(...call){calls.push({handle,call});return guard(native?refreshMaintenance(handle,...call):handle.refreshContextIndex(...call));}};
    }});
  const config={supervisor:service.supervisor,id:randomUUID(),window:{id:'first',endsAtMonoMs:start+duration,usedItems:0,usedMs:0},
    budgets:{maxItems:2048,maxMs:60000},quantum:{maxItems:32,maxMs:1000},pollMs:25,renewalMs,serviceCredential:token,
    projections:[{options:service.options,types:['memory']}]};
  const advance=async value=>{assert.ok(value>=now());if(native)await testClock.advance(value-now(),{waitForWorkers:false});else time=value;};
  return {renew,config,opened,closed,calls,timers,now,start,advance,
    successor(gap=500,patch={}) {return {...config,window:{id:'second',endsAtMonoMs:config.window.endsAtMonoMs+60000,usedItems:0,usedMs:0},...patch};},
    async next(){assert.ok(timers.size,'scheduled turn');const [id,timer]=[...timers].sort((a,b)=>a[1].at-b[1].at)[0];timers.delete(id);await advance(Math.max(now(),timer.at));await guard(timer.fn());}};
}

for(const gap of [0,1,1000])test(`${gap===0?'passing control: ':''}lexical handoff within one quantum (${gap} ms) keeps resident and cadence`,async t=>{
  const s=setup(t),p=s.renew(s.config);t.after(()=>guard(p.close()));
  for(let i=0;i<6;i++)await s.next();
  const first=p.completion,before=maintenancePumpDiagnostic(p.getStatus());
  await s.advance(s.config.window.endsAtMonoMs+gap);
  assert.equal(s.renew(s.successor(gap)),p);
  assert.notEqual(p.completion,first);assert.equal((await first).windowId,'first');
  assert.equal(maintenancePumpDiagnostic(p.getStatus()).cadenceMisses,before.cadenceMisses);
  await s.next();
  // The epoch forms part of the resident key: any epoch change opens again.
  assert.equal(s.opened.length,1,'handoff must retain the resident epoch and handle');
  assert.equal(s.closed.length,0,'handoff must not drain');
  assert.equal(s.calls.at(-1).handle,s.opened[0]);
  const diagnostic=maintenancePumpDiagnostic(p.getStatus());
  assert.equal(diagnostic.observation.gapMs,s.now()-5000,'history observation baseline survives');
  assert.equal(s.calls.at(-1).call[0].intent,'history','round-robin order survives');
  assert.equal(p.getStatus().error,null,'next refresh succeeds');
  assert.equal(maintenancePumpPhaseDiagnostic(p.getStatus()).projections.reduce((n,l)=>n+l.opens,0),1);
});

for(const cause of ['long window gap','expired renewal','spent quota'])test(`passing control: lexical handoff reopens after ${cause}`,async t=>{
  const s=setup(t,{renewalMs:cause==='expired renewal'?7000:60000}),p=s.renew(s.config);t.after(()=>guard(p.close()));
  await s.next();
  if(cause==='spent quota')s.renew({...s.config,window:{...s.config.window,usedItems:2048}});
  const gap=cause==='long window gap'?1001:1;
  await s.advance(s.config.window.endsAtMonoMs+gap);s.renew(s.successor(gap));await s.next();
  assert.equal(s.opened.length,2);assert.equal(s.closed.length,1);assert.equal(p.getStatus().error,null);
  assert.equal(maintenancePumpDiagnostic(p.getStatus()).observation,null,'new admission is no observation');
});

test('passing control: same-window renewal retains cadence and rejects an overlapping successor',async t=>{
  const s=setup(t),p=s.renew(s.config);t.after(()=>guard(p.close()));await s.next();await s.next();
  assert.throws(()=>s.renew(s.successor()),{code:'invalid_input'});
  const first=p.completion;assert.equal(s.renew(s.config),p);assert.equal(p.completion,first);await s.next();
  assert.equal(s.opened.length,1);assert.equal(s.closed.length,0);
  assert.equal(maintenancePumpDiagnostic(p.getStatus()).observation.gapMs,3000);
});

test('passing control: expired authority still reopens on a same-window renewal',async t=>{
  const s=setup(t,{duration:60000,renewalMs:2000}),p=s.renew(s.config);t.after(()=>guard(p.close()));await s.next();await s.next();
  assert.equal((await p.completion).state,'renewal_expired');await s.advance(2001);
  s.renew({...s.config,renewalMs:60000});await s.next();
  assert.equal(s.opened.length,2);assert.equal(s.closed.length,1);assert.equal(p.getStatus().error,null);
});

test('lexical handoff records the old cadence miss before succession and retains it',async t=>{
  const s=setup(t,{duration:10000}),p=s.renew(s.config);t.after(()=>guard(p.close()));await s.next();
  await s.advance(10500);s.renew(s.successor());
  const before=maintenancePumpDiagnostic(p.getStatus());assert.equal(before.cadenceMisses,2);assert.equal(before.worstGapMs,10500);
  await s.next();const after=maintenancePumpDiagnostic(p.getStatus());
  assert.equal(after.observation.cadenceMiss,true,'missed flag survives the handoff');
  assert.equal(after.observation.gapMs,10500);assert.equal(s.opened.length,1);
});

test('passing control: an idle-disposed resident is excluded even inside the window grace',async t=>{
  const s=setup(t,{native:true,duration:60000}),p=s.renew(s.config);t.after(()=>guard(p.close()));
  await s.next();
  await s.advance(s.start+40000);s.renew(s.config);
  // Renewal alone does not rearm the reader's idle timer. Deliver that timer
  // before succession, while the pump's independent authority is still live.
  await s.advance(s.start+61000);s.renew(s.successor(1000));await s.next();
  assert.equal(s.opened.length,2);assert.equal(s.closed.length,1);assert.equal(p.getStatus().error,null);
});

test('native lexical handoff retains the resident with a distinct equal-valued credential',async t=>{
  const s=setup(t,{native:true,duration:60000}),p=s.renew(s.config);t.after(()=>guard(p.close()));
  for(let i=0;i<59;i++){
    await s.next();
    if((i+1)%20===0)s.renew(s.config);
    assert.equal(p.getStatus().error,null);
  }
  const credential={leaseFence:{owner:'synthetic-service',generation:1},opaque:s.config.serviceCredential.opaque};
  assert.notEqual(credential,s.config.serviceCredential);assert.notEqual(credential.leaseFence,s.config.serviceCredential.leaseFence);
  assert.equal(credentialDigest(credential),credentialDigest(s.config.serviceCredential),'nested key order is normalized');
  await s.advance(s.config.window.endsAtMonoMs+1000);
  s.renew(s.successor(1000,{serviceCredential:credential}));
  await s.next();await s.next();
  assert.equal(s.opened.length,1,'native resident survives both intents after succession');assert.equal(s.closed.length,0);
  assert.deepEqual(s.calls.at(-1).call[1],credential);assert.equal(p.getStatus().error,null);
  const input={readSet:[ns],types:['memory'],intent:'current',mode:'lexical',budget:{maxItems:32,maxMs:1000}};
  ok(await guard(s.opened[0].refreshContextIndex(input,credential)));
  assert.throws(()=>s.renew(s.successor(1000,{serviceCredential:{...credential,leaseFence:{...credential.leaseFence,generation:2}}})),{code:'authority_required'});
  assert.equal((await guard(s.opened[0].refreshContextIndex(input,{...credential,opaque:'different'}))).error.code,'authority_required');
  const different={...credential,opaque:'different'},selection=s.config.projections[0],host=selection.options.host;
  const projections=[{...selection,options:{...selection.options,host:{...host,configuration:{...host.configuration,
    serviceBinding:{...host.configuration.serviceBinding,credentialDigest:credentialDigest(different)}}}}}];
  assert.throws(()=>s.renew(s.successor(1000,{serviceCredential:different,projections})),{code:'read_in_progress'},'changing the binding requires a new selection');
});

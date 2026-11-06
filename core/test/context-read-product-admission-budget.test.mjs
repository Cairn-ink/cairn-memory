import '../testing/context-product-test-clock.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { fixture, ns, ok } from '../testing/context-read-fixture.mjs';
import { local } from '../testing/context-product-verification-fixture.mjs';
import { productSidecar } from '../context-product-sidecar.mjs';
import { openContextProductFacade } from '../context-read-facade.mjs';
import { createProductSqlitePolicy } from '../context-product-sqlite.mjs';
import { STORAGE_BUSY_TIMEOUT_MS } from '../database.mjs';
import { createMaintenancePumpRuntime, maintenancePumpDiagnostic, maintenancePumpPhaseDiagnostic } from '../context-product-pump.mjs';
import { createContextReadSupervisor } from '../context-read-supervisor.mjs';
import { credentialDigest } from '../context-product-control.mjs';
import { maintenanceAdmissionFits, maintenanceAdmissionSlots } from '../context-product-admission-policy.mjs';

const flush=async()=>{for(let i=0;i<40;i++)await Promise.resolve();};
function model(t,{openMs=565,admitMs=535,workMs=10,failProof=false}={}){
  let time=0,serial=0,observed,pump;
  const timers=new Map(),fired=[],events=[],tickets=[],pumps=[],identity={key:randomUUID(),cache:'stable'};
  const supervisor=createContextReadSupervisor(),credential={opaque:randomUUID()},
    readSet=[{ownerId:'admission-budget-test',scope:'personal',projectId:null}],
    ownerCoverage={policy:'recent-projects-v1',selectionRevision:'test',requestedNamespaces:1,selectedNamespaces:1,omittedNamespaces:0};
  const serviceBinding={kind:'service',serviceId:'test',credentialBindingId:'test',credentialExpiresUtcMs:null,
    credentialDigest:credentialDigest(credential),ownerId:readSet[0].ownerId,namespaces:{readSet,ownerCoverage},issuedAt:0};
  const options={supervisor,path:'/synthetic-admission-budget-'+randomUUID()+'.sqlite',readSet,ownerCoverage,
    host:{moduleUrl:'file:///synthetic-admission-budget-host.mjs',configuration:{serviceBinding}}};
  const config={supervisor,id:randomUUID(),serviceCredential:credential,
    window:{id:'first',endsAtMonoMs:60000,usedItems:0,usedMs:0},budgets:{maxItems:2048,maxMs:60000},
    quantum:{maxItems:32,maxMs:1000},pollMs:25,renewalMs:20000,projections:[{options,types:['memory']}]};
  const s={config,events,tickets,timers,fired,now:()=>time,onOpen:()=>{},onAdmit:async()=>{},onWork:async()=>{},entry:()=> 'admitted',
    spend(ms){const target=time+ms;for(;;){
      const [id,timer]=[...timers].sort((a,b)=>a[1].at-b[1].at)[0]??[];
      if(!timer||timer.at>target)break;
      timers.delete(id);time=timer.at;timer.fn();
    }time=target;},
    preQuantum:{version:1,maxWaitMs:5000,createTurn(request){const ticket={request,releases:[]};tickets.push(ticket);
      return {enter(input){ticket.until=input.untilMonoMs;return s.entry(ticket);},release:(...args)=>ticket.releases.push(args)};}}};
  const deps={now:()=>time,setTimer:(fn,ms)=>{const id=++serial;timers.set(id,{fn:()=>{fired.push(time);return fn();},at:time+ms});return id;},clearTimer:id=>timers.delete(id),
    admissionIdentity:()=>identity,receiptOf:r=>r?.receipt,observedAt:()=>observed,
    open:async input=>{events.push({kind:'open',at:time,maxMs:input.deadlineMs});s.onOpen();s.spend(openMs);
      return {async close(){events.push({kind:'close',at:time});if(failProof)throw Error('unproven disposal');}};},
    admit:async(h,input)=>{events.push({kind:'admission',at:time,maxMs:input.budget.maxMs});await s.onAdmit();s.spend(admitMs);
      return {ok:true,value:null,receipt:'admitted'};},
    work:async(h,input)=>{events.push({kind:'work',at:time,maxMs:input.budget.maxMs,intent:input.intent});const result=await s.onWork();s.spend(workMs);
      observed=time;return result??{ok:true,value:{progress:{transformed:1}}};}};
  const renew=createMaintenancePumpRuntime(deps);
  Object.assign(s,{renew,create(patch={}){pump=renew({...config,...patch});if(!pumps.includes(pump))pumps.push(pump);return pump;},
    async next(){const [id,timer]=[...timers].sort((a,b)=>a[1].at-b[1].at)[0]??[];assert.ok(timer,'scheduled turn');
      timers.delete(id);time=Math.max(time,timer.at);await timer.fn();await flush();},
    status:()=>pump.getStatus(),diagnostic:()=>maintenancePumpDiagnostic(pump.getStatus()),
    lane:()=>maintenancePumpPhaseDiagnostic(pump.getStatus()).projections[0]});
  t.after(async()=>{for(const p of pumps)await p.close().catch(()=>{});await supervisor.close().catch(()=>{});assert.equal(timers.size,0);});
  return s;
}

for(const failProof of [false,true])test(`absent option preserves admission overrun and counters, disposal failure=${failProof}`,async t=>{
  const s=model(t,{failProof}),p=s.create();await s.next();await p.completion;
  const status=s.status(),d=s.diagnostic(),lane=s.lane();
  assert.equal(status.state,'failed');assert.equal(status.error,failProof?'reader_failed':'read_timeout');
  assert.equal(status.usedItems,32);assert.equal(status.usedMs,1000);
  assert.deepEqual(s.events.filter(e=>e.kind!=='close'),[
    {kind:'open',at:1000,maxMs:1000},{kind:'admission',at:1565,maxMs:435}]);
  assert.equal(d.lastFailure.cause,'open_exceeds_quantum');assert.equal(d.failureCounts.open_exceeds_quantum,1);
  assert.equal(d.secondaryFailureCounts.cleanup,failProof?1:0);
  assert.equal(d.admission[0].attempts,1);assert.equal(d.admission[0].state,failProof?'quarantined':'backoff');
  assert.equal(d.observation,null);assert.equal(d.cadenceMisses,0);
  assert.equal(lane.opens,1);assert.equal(lane.quanta,1);assert.equal(lane.latest.turn,'admission');assert.equal(lane.latest.elapsedMs,1100);
  assert.equal(lane.phases.admission.count,1);assert.equal(lane.phases.refreshCall.count,0);
});

for(const port of [false,true])test(`opt-in admission survives a slower cold open and the next turn works, broker=${port}`,async t=>{
  const s=model(t),p=s.create({admissionMs:2000,...(port?{preQuantum:s.preQuantum}:{})});
  await s.next();assert.equal(s.status().error,null);assert.equal(s.status().usedItems,0);assert.equal(s.status().usedMs,1100);
  assert.deepEqual(s.events,[{kind:'open',at:1000,maxMs:2000},{kind:'admission',at:1565,maxMs:1435}]);
  assert.equal(s.diagnostic().observation,null);assert.equal(s.lane().latest.turn,'admission');
  await s.next();assert.deepEqual(s.events.at(-1),{kind:'work',at:3000,maxMs:1000,intent:'current'});
  assert.equal(s.status().error,null);assert.equal(s.status().usedItems,1);assert.equal(s.status().usedMs,1110);
  assert.equal(s.diagnostic().observation.projection,0);
  if(port)assert.deepEqual(s.tickets.map(t=>[t.request.phase,t.request.maxMs]),[['admission',2000],['work',1000]]);
  await p.close();
});

test('admission reserves the opt-in budget before open and refunds only settled usage',async t=>{
  const s=model(t);s.onOpen=()=>{assert.equal(s.status().usedItems,32);assert.equal(s.status().usedMs,2000);};
  s.create({admissionMs:2000});await s.next();assert.equal(s.status().usedItems,0);assert.equal(s.status().usedMs,1100);
});

test('uncertain admission keeps the full opt-in reservation',async t=>{
  const s=model(t);s.onAdmit=()=>{throw Error('uncertain admission');};
  const p=s.create({admissionMs:2000});await s.next();await p.completion;
  assert.equal(s.status().error,'reader_failed');assert.equal(s.status().usedItems,32);assert.equal(s.status().usedMs,2000);
});

test('slow refresh still fires the work watchdog at the work quantum',async t=>{
  const s=model(t,{workMs:1001}),p=s.create({admissionMs:2000});await s.next();await s.next();await p.completion;
  assert.equal(s.status().error,'read_timeout');assert.equal(s.status().usedMs,2100);
  assert.equal(s.events.find(e=>e.kind==='work').maxMs,1000);
  assert.ok(s.fired.includes(4000),'the work watchdog fires at its 1000 ms deadline');
  assert.equal(s.diagnostic().failureCounts.open_exceeds_quantum,0);assert.equal(s.diagnostic().failureCounts.engine,1);
});

for(const [name,patch] of [
  ['below quantum',{admissionMs:999}],['non-integer',{admissionMs:1000.5}],['NaN',{admissionMs:NaN}],
  ['Infinity',{admissionMs:Infinity}],['negative Infinity',{admissionMs:-Infinity}],
  ['unsafe integer',{admissionMs:Number.MAX_SAFE_INTEGER+1}],['null',{admissionMs:null}],['string',{admissionMs:'2000'}],
  ['disposal grace reserve',{admissionMs:8001}],['default maintainer deadline',{admissionMs:5001}],['window budget',{admissionMs:2000,budgets:{maxItems:2048,maxMs:1999}}],
  ['infeasible cadence',{admissionMs:2001}],['full maintainer deadline cannot fit cadence',{admissionMs:5000}],
])test(`invalid admission budget: ${name}`,t=>{
  const s=model(t);assert.throws(()=>s.create(patch),{code:'invalid_input'});assert.equal(s.events.length,0);assert.equal(s.timers.size,0);
});

test('admission budget is bounded by every projection maintainer deadline',t=>{
  const s=model(t),options=s.config.projections[0].options;
  for(const projections of [[{options:{...options,deadlineMs:1500},types:['memory']}],
    [s.config.projections[0],{options:{...options,path:options.path+'-other',deadlineMs:1500},types:['memory']}]] )
    assert.throws(()=>s.create({admissionMs:2000,projections}),{code:'invalid_input'});
});

test('admission budget at the maintainer and ledger bounds is accepted',async t=>{
  const s=model(t),options={...s.config.projections[0].options,deadlineMs:2000};
  s.create({admissionMs:2000,budgets:{maxItems:32,maxMs:2000},projections:[{options,types:['memory']}]});await s.next();
  assert.equal(s.status().error,null);assert.equal(s.status().state,'budget_exhausted');assert.equal(s.status().usedMs,1100);
});

test('cadence prices cold resident replacements using admission spacing',async t=>{
  assert.equal(maintenanceAdmissionSlots(['a','a'],['x','x']),1);
  assert.equal(maintenanceAdmissionFits(2,1,1000,1000,2000),true);
  assert.equal(maintenanceAdmissionFits(2,1,1000,1000,2001),false);
  assert.equal(maintenanceAdmissionFits(4,2,500,500,1250),true);
  assert.equal(maintenanceAdmissionFits(4,2,500,500,1251),false);
  const s=model(t,{openMs:565,admitMs:1434,workMs:999});s.create({admissionMs:2000});
  await s.next();await s.next();await s.next();
  assert.equal(s.diagnostic().cadenceMisses,0);assert.equal(s.diagnostic().observation.atMonoMs,4999);
  assert.equal(s.diagnostic().observation.projection,1);
});

for(const horizon of ['renewal','window'])test(`admission cannot start without fitting the ${horizon}`,async t=>{
  const s=model(t),patch=horizon==='renewal'?{renewalMs:2999}:{window:{...s.config.window,endsAtMonoMs:2999}};
  s.create({admissionMs:2000,...patch});await s.next();
  assert.equal(s.events.length,0);assert.equal(s.status().usedMs,0);
});

test('admission cannot start with only a work quantum left in the ledger',t=>{
  const s=model(t);s.create({admissionMs:2000,budgets:{maxItems:2048,maxMs:2500},window:{...s.config.window,usedMs:501}});
  assert.equal(s.status().state,'budget_exhausted');assert.equal(s.timers.size,0);assert.equal(s.events.length,0);
});

test('broker wait cutoff stays unchanged and post-wait admission fit is separate',async t=>{
  const s=model(t);let release;
  s.entry=()=>new Promise(resolve=>{release=resolve;});
  s.create({admissionMs:2000,preQuantum:s.preQuantum,renewalMs:4000});const pending=s.next();await flush();
  assert.equal(s.tickets[0].request.maxMs,2000);assert.equal(s.tickets[0].until,3000);
  s.spend(1001);release('admitted');await pending;
  assert.equal(s.events.length,0);assert.equal(s.status().usedMs,0);
  assert.equal(s.tickets[0].releases.length,1);assert.equal(s.tickets[0].releases[0][0],'declined');
});

test('renewal cannot silently change the admission budget',async t=>{
  const s=model(t),p=s.create({admissionMs:2000});
  assert.throws(()=>s.renew({...s.config,admissionMs:1500}),{code:'invalid_input'});
  assert.equal(s.renew({...s.config,admissionMs:2000}),p);await s.next();assert.equal(s.status().error,null);
});


test('canonical forget commits during long cooperative admission with no canonical snapshot held',t=>{
  const f=fixture(t),memory=f.admit('cooperative admission privacy canary');
  const builder=local(f.path);builder.finish();builder.close();
  let clock=0,forgotten=false;
  const sqlite=createProductSqlitePolicy({now:()=>clock});sqlite.start(Infinity);
  const facade=openContextProductFacade(f.path,{sqlite});
  const storage=productSidecar({path:f.path,db:facade.port.db,identity:facade.port.identity,
    features:facade.port.features,sqlite,writable:true,now:()=>clock});
  f.workspace.defer(()=>{storage.close();facade.close();});
  const prepare=DatabaseSync.prototype.prepare;
  t.mock.method(DatabaseSync.prototype,'prepare',function(sql){
    const statement=Reflect.apply(prepare,this,[sql]);
    if(!sql.startsWith('SELECT substr(record,1,16385)'))return statement;
    return new Proxy(statement,{get(target,key){
      if(key!=='iterate'){const value=Reflect.get(target,key,target);return typeof value==='function'?value.bind(target):value;}
      return function*(){for(const row of target.iterate()){
        clock+=1200;
        assert.equal(facade.port.db.isTransaction,false,'admission released the canonical identity snapshot');
        const before=clock;
        ok(f.core.forget({namespace:ns,memoryId:memory.id,expectedRevision:memory.revision}));
        assert.ok(clock-before<STORAGE_BUSY_TIMEOUT_MS,'forget commits inside its ordinary busy bound');
        forgotten=true;yield row;
      }clock+=300;};
    }});
  });
  storage.admit(2000);
  assert.equal(forgotten,true);assert.equal(clock,1500);
  assert.equal(facade.port.db.isTransaction,false);
});

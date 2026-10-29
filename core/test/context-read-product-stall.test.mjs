import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { randomUUID } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { maintenanceQuantum } from '../context-product-quantum.mjs';
import * as reader from '../context-product-reader.mjs';
import { createContextReadSupervisor } from '../context-read-supervisor.mjs';
import { credentialDigest, PRODUCT_PROFILE } from '../context-product-control.mjs';
import { productSidecar } from '../context-product-sidecar.mjs';
import { openContextProductFacade } from '../context-read-facade.mjs';
import { fixture } from '../testing/context-read-fixture.mjs';
import { personal, project, configured, descriptor } from '../testing/context-product-owner-fixture.mjs';
import { accessDigest } from '../context-product-validation.mjs';
// Dynamic import lets these regression assertions execute on the base revision.
const attribution=await import('../context-product-attribution.mjs').catch(e=>{if(e.code!=='ERR_MODULE_NOT_FOUND')throw e;return {};});
const kinds=['idle','scan','item','verify','publication','gc','vacuum','begin','commit','save','canonical-read','serialize'];
const fields=['unitCount','scanUnits','itemUnits','verificationUnits','publicationUnits','gcUnits','scanRows','itemRows','verificationRows','publicationRows','gcRows',
  'lastUnitKind','lastUnitMs','longestUnitKind','longestUnitMs','beginWaitMaxMs','beginWaitSumMs','commitMaxMs','commitSumMs','canonicalReadWaitMaxMs',
  'saveSigningMs','gcSliceMs','vacuumMs','resultPreparationMs','serializationMs','serializationComplete','deliveryMs','returnMs'];
function transport(t,{maintenance=true}={}) {
  let time=100n*1000000n,worker,opening,action=()=>{};
  const timers=new Set(),outbound=[],supervisor=createContextReadSupervisor();t.after(()=>supervisor.close());
  const token={nonce:randomUUID()},readSet=[personal],ownerCoverage=descriptor(readSet);
  const control={requestId:randomUUID(),handleId:randomUUID(),credentialBindingId:randomUUID(),credentialExpiresUtcMs:null,requestMaxMs:5000};
  const binding={kind:maintenance?'service':'request',...(maintenance?{serviceId:randomUUID(),credentialBindingId:control.credentialBindingId,credentialExpiresUtcMs:null}:control),
    credentialDigest:credentialDigest(token),ownerId:personal.ownerId,namespaces:{readSet,ownerCoverage},issuedAt:0};
  delete binding.requestMaxMs;
  const options={supervisor,path:new URL('synthetic-stall-'+randomUUID()+'.sqlite',import.meta.url).pathname,version:'context-read-v1',profile:PRODUCT_PROFILE,
    readSet,ownerCoverage,...(maintenance?{sidecarJournalMode:'DELETE'}:{requestControl:control}),host:{moduleUrl:new URL('../testing/context-product-index-host.mjs',import.meta.url).href,
      configuration:{[maintenance?'serviceBinding':'requestBinding']:binding,...(maintenance?{}:{requestReservation:new SharedArrayBuffer(4)})}}};
  const open=reader.createProductReaderRuntime({maintenance,now:()=>time,utc:()=>1000,setTimer(fn,ms){const v={fn,ms,unref(){}};timers.add(v);return v;},clearTimer:v=>timers.delete(v),
    spawnWorker(data){opening=data;worker=new EventEmitter();Object.assign(worker,{ref(){},unref(){},terminate(){return Promise.resolve(1);},
      postMessage(message){outbound.push(message);if(message.method==='close'){queueMicrotask(()=>worker.emit('exit',0));return;}action(message);}});
      queueMicrotask(()=>worker.emit('message',{operation:data.operation,result:{ok:true,value:null},fileIdentity:'12:34'}));return worker;}});
  return {options,token,open,outbound,timers,get data(){return opening;},set(ms){time=BigInt(ms)*1000000n;},now:()=>Number(time)/1e6,
    action(fn){action=fn;},reply(message,result,extra={}){worker.emit('message',{operation:message.operation,result,...extra});},
    fire(){const timer=[...timers].find(v=>v.ms<60000);assert.ok(timer,'quantum watchdog armed');timer.fn();}};
}

for(const operation of kinds.filter(k=>k!=='idle'))test(`stall attribution: watchdog captures ${operation} in its real operation interval`,async t=>{
  const io=transport(t),h=await io.open(io.options);t.after(()=>h.close());
  assert.ok(io.data.maintenanceMarker instanceof SharedArrayBuffer,'maintenance Worker has shared stall marker');
  const f=fixture(t);f.admit('orchard maintenance evidence',personal);f.admit('second orchard evidence',personal);
  const facade=openContextProductFacade(f.path,{});t.after(()=>facade.close());
  let hit=false,armed=false,unitsAtStall;
  const meter=attribution.createMaintenanceAttribution({buffer:io.data.maintenanceMarker,now:io.now,hrtime:()=>BigInt(io.now())*1000000n,rendezvous(kind){
    if(!armed||hit||kind!==operation)return;
    hit=true;io.set(1100);unitsAtStall=attribution.readMaintenanceMarker(io.data.maintenanceMarker,1100000000n).unitCount;io.fire();
  }});
  const storage=productSidecar({path:f.path,db:facade.port.db,identity:facade.port.identity,features:facade.port.features,writable:true,now:io.now,attribution:meter});
  t.after(()=>storage.close());
  let p={readSet:[personal],types:['memory'],intent:'current',ownerCoverage:descriptor([personal])};
  const access=()=>accessDigest({ownerId:personal.ownerId,namespaces:{readSet:p.readSet}});
  if(operation==='gc'){
    storage.refresh(p,access(),{maxItems:1,maxMs:1000});
    p={...p,readSet:[personal,project('extra')],ownerCoverage:descriptor([personal,project('extra')])};
  }
  meter.reset();armed=true;
  io.action(message=>queueMicrotask(()=>{
    try {storage.refresh(p,access(),{maxItems:32,maxMs:1000});if(operation==='serialize')meter.serialize(()=>{});}
    catch(e){assert.equal(e.code,'read_timeout');}
    if(!hit)io.reply(message,{ok:true,value:null});
  }));
  const result=await h.refreshContextIndex({readSet:[personal],types:['memory'],intent:'current',mode:'lexical',budget:{maxItems:32,maxMs:1000}},io.token);
  assert.equal(hit,true,`${operation} instrumentation reached`);
  assert.equal(result.error?.code,'read_timeout');
  const stall=reader.maintenanceStallDiagnostic?.(result);
  assert.deepEqual(stall,{kind:kinds.indexOf(operation),runningMs:1000,unitCount:unitsAtStall},'operation and exact injected duration survive terminal cutoff');
  io.set(5000);assert.deepEqual(reader.maintenanceStallDiagnostic(result),stall,'cutoff snapshot does not age or depend on Worker survival');
  assert.deepEqual(Object.keys(result).sort(),['error','ok']);
  assert.equal((await h.getContextIndexStatus({readSet:[personal],types:['memory'],intent:'current',deadlineMs:1000},io.token)).error.code,'store_closed');
  await h.close();
});

test('stall attribution: reader delivery cutoff captures the marker before discarding a late response',async t=>{
  const io=transport(t),h=await io.open(io.options);t.after(()=>h.close());
  assert.ok(io.data.maintenanceMarker instanceof SharedArrayBuffer,'maintenance Worker has shared stall marker');
  const meter=attribution.createMaintenanceAttribution({buffer:io.data.maintenanceMarker,now:io.now,hrtime:()=>BigInt(io.now())*1000000n});
  io.action(message=>meter.serialize(()=>{io.set(1100);io.reply(message,{ok:true,value:null});}));
  const result=await h.refreshContextIndex({readSet:[personal],types:['memory'],intent:'current',mode:'lexical',budget:{maxItems:1,maxMs:1000}},io.token);
  assert.deepEqual(reader.maintenanceStallDiagnostic?.(result),{kind:11,runningMs:1000,unitCount:0},'late response records serialization at cutoff');
  await h.close();
});

test('stall attribution: successful native refresh fields stay in the fixed private channel',async t=>{
  const f=fixture(t);f.admit('orchard evidence',personal);const service=configured(t,f.path,[personal],{service:true});
  const h=await reader.openContextIndexMaintainer(service.options);t.after(()=>h.close());
  const result=await h.refreshContextIndex({readSet:[personal],types:['memory'],intent:'current',mode:'lexical',budget:{maxItems:32,maxMs:1000}},service.token);
  assert.equal(result.ok,true,JSON.stringify(result));const detail=reader.maintenancePhaseDiagnostic(result);
  for(const field of fields)assert.ok(Number.isFinite(detail[field])&&detail[field]>=0,`${field} private numeric field`);
  assert.ok(detail.scanUnits>0&&detail.itemUnits>0&&detail.verificationUnits>0&&detail.publicationUnits>0);
  assert.equal(detail.itemRows,1);assert.equal(detail.publicationRows,1);
  assert.equal(detail.unitCount,detail.scanUnits+detail.itemUnits+detail.verificationUnits+detail.publicationUnits+detail.gcUnits);
  for(const field of fields)assert.equal(JSON.stringify(result).includes('"'+field+'"'),false,field+' absent from public DTO');
  const entry=await import('../index.mjs');assert.equal(entry.maintenanceStallDiagnostic,undefined);
});

test('stall attribution: non-maintenance readers allocate and transport no marker',async t=>{
  const NativeSharedArrayBuffer=globalThis.SharedArrayBuffer;let allocations=0;
  globalThis.SharedArrayBuffer=new Proxy(NativeSharedArrayBuffer,{construct(target,args){if(args[0]===32)allocations++;return Reflect.construct(target,args);}});
  try {
    const io=transport(t,{maintenance:false}),h=await io.open(io.options);t.after(()=>h.close());
    assert.equal(Object.hasOwn(io.data,'maintenanceMarker'),false);
    io.action(message=>io.reply(message,{ok:true,value:null}));
    await h.getContextIndexStatus({readSet:[personal],types:['memory'],intent:'current',deadlineMs:1000},io.token);
    assert.deepEqual(Object.keys(io.outbound.at(-1)).sort(),['credential','frame','input','method','operation','request'],'request transport stays unchanged');
    assert.equal(allocations,0,'no discarded marker allocation for request readers');
    assert.equal(reader.maintenanceStallDiagnostic?.(h),undefined);await h.close();
  } finally {globalThis.SharedArrayBuffer=NativeSharedArrayBuffer;}
});

test('stall attribution: canonical wait ends at first existing step and nested marker restores original start',()=>{
  assert.equal(typeof attribution.createMaintenanceAttribution,'function','maintenance attribution API exists');
  let clock=100;const buffer=attribution.maintenanceMarker(),meter=attribution.createMaintenanceAttribution({buffer,now:()=>clock,hrtime:()=>BigInt(clock)*1000000n});
  const db=new DatabaseSync(':memory:');try{
    meter.measure('item',()=>{
      clock=105;meter.read(()=>{db.exec('BEGIN');clock=112;db.prepare('SELECT 1').get();meter.acquired();
        assert.deepEqual(attribution.readMaintenanceMarker(buffer,120000000n),{kind:2,runningMs:20,unitCount:1});clock=140;db.exec('COMMIT');});
    },true);
    assert.equal(meter.snapshot().canonicalReadWaitMaxMs,7,'only BEGIN through first step, excludes remaining transaction');
    assert.equal(meter.snapshot().lastUnitMs,40);assert.equal(meter.snapshot().longestUnitMs,40);
    assert.equal(meter.snapshot().lastUnitKind,2);assert.equal(meter.snapshot().longestUnitKind,2);
  }finally{db.close();}
});

test('stall attribution: reader copies only fixed finite fields and sends marker only at bootstrap',async t=>{
  const io=transport(t),h=await io.open(io.options);t.after(()=>h.close());
  io.action(message=>{io.set(101);io.reply(message,{ok:true,value:{}},{observedAtMonoMs:100,
    maintenancePhases:{unitCount:4,commitMaxMs:12,path:'private-probe',unknownCount:7,itemRows:'private-probe',gcRows:Infinity,finishedAtMonoMs:100}});});
  const result=await h.refreshContextIndex({readSet:[personal],types:['memory'],intent:'current',mode:'lexical',budget:{maxItems:1,maxMs:1000}},io.token);
  const detail=reader.maintenancePhaseDiagnostic(result);
  assert.equal(detail?.unitCount,4,'fixed count copied');assert.equal(detail.commitMaxMs,12);
  for(const name of ['path','unknownCount','itemRows','gcRows'])assert.equal(Object.hasOwn(detail,name),false);
  assert.equal(JSON.stringify(result).includes('unitCount'),false);
  assert.equal(Object.hasOwn(io.outbound.at(-1),'maintenanceMarker'),false,'no additional per-call transport');await h.close();
});

test('stall attribution: serialization records completed time or explicit nonblocking lower bound',()=>{
  assert.equal(typeof attribution.createMaintenanceAttribution,'function','maintenance attribution API exists');
  let clock=100;const buffer=attribution.maintenanceMarker(),meter=attribution.createMaintenanceAttribution({buffer,now:()=>clock,hrtime:()=>BigInt(clock)*1000000n});
  meter.serialize(()=>{clock=107;assert.deepEqual(attribution.serializationDiagnostic(buffer,107000000n),{serializationMs:7,serializationComplete:0});});
  clock=120;assert.deepEqual(attribution.serializationDiagnostic(buffer,120000000n),{serializationMs:7,serializationComplete:1});
  meter.add('gcRows',Number.MAX_SAFE_INTEGER);meter.add('gcRows',100);assert.equal(meter.snapshot().gcRows,Number.MAX_SAFE_INTEGER);
});

test('stall attribution: operation timing sums/maxima and last/longest units use injected clocks',()=>{
  assert.equal(typeof attribution.createMaintenanceAttribution,'function','maintenance attribution API exists');
  let clock=100;const meter=attribution.createMaintenanceAttribution({now:()=>clock,hrtime:()=>BigInt(clock)*1000000n});
  const q=maintenanceQuantum({now:()=>clock,cutoff:1100,maxMs:1000,attribution:meter});
  for(const [kind,ms,diagnosticKind] of [['scan',10],['item',17],['item',5],['verification',30],['publication',4],['gc',25],['gc',6,'vacuum']])
    q.measure(()=>{clock+=ms;},kind,diagnosticKind);
  for(const [kind,ms] of [['begin',5],['begin',7],['commit',3],['commit',13],['save',2],['save',3]])meter.measure(kind,()=>{clock+=ms;});
  const d=meter.snapshot();
  assert.equal(d.unitCount,7);assert.equal(d.scanUnits,1);assert.equal(d.itemUnits,2);assert.equal(d.verificationUnits,1);assert.equal(d.publicationUnits,1);assert.equal(d.gcUnits,2);
  assert.equal(d.lastUnitKind,6);assert.equal(d.lastUnitMs,6);assert.equal(d.longestUnitKind,3);assert.equal(d.longestUnitMs,30);
  assert.equal(d.beginWaitMaxMs,7);assert.equal(d.beginWaitSumMs,12);assert.equal(d.commitMaxMs,13);assert.equal(d.commitSumMs,16);
  assert.equal(d.saveSigningMs,5);assert.equal(d.gcSliceMs,25);assert.equal(d.vacuumMs,6);assert.equal(q.reserve,150);
  clock=941;assert.equal(q.admit('item'),false,'same reserve plus doubled item high-water estimate');
});

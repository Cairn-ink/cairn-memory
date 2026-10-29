import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { EventEmitter } from 'node:events';
import { randomUUID } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { readTransaction } from '../database.mjs';
import { maintenanceQuantum } from '../context-product-quantum.mjs';
import * as reader from '../context-product-reader.mjs';
import { createMaintenancePumpRuntime, maintenancePumpPhaseDiagnostic } from '../context-product-pump.mjs';
import { createContextReadSupervisor } from '../context-read-supervisor.mjs';
import { credentialDigest, PRODUCT_PROFILE, hostConfiguration, operationMessage } from '../context-product-control.mjs';
import { openProductIndex } from '../context-product-index.mjs';
import { nativeObserver } from '../context-product-telemetry.mjs';
import { productSidecar } from '../context-product-sidecar.mjs';
import { openContextProductFacade } from '../context-read-facade.mjs';
import { fixture } from '../testing/context-read-fixture.mjs';
import { personal, project, configured, descriptor } from '../testing/context-product-owner-fixture.mjs';
import { accessDigest } from '../context-product-validation.mjs';
// Dynamic import lets these regression assertions execute on the base revision.
const attribution=await import('../context-product-attribution.mjs').catch(e=>{if(e.code!=='ERR_MODULE_NOT_FOUND')throw e;return {};});
const legacyStall=value=>{const {ordinal,pendingDispatch,...rest}=value;return rest;};
const kinds=['idle','scan','item','verify','publication','gc','vacuum','begin','commit','save','canonical-read','serialize'];
const fields=['unitCount','scanUnits','itemUnits','verificationUnits','publicationUnits','gcUnits','scanRows','itemRows','verificationRows','publicationRows','gcRows',
  'lastUnitKind','lastUnitMs','longestUnitKind','longestUnitMs','beginWaitMaxMs','beginWaitSumMs','commitMaxMs','commitSumMs','canonicalReadWaitMaxMs',
  'saveSigningMs','gcSliceMs','vacuumMs','resultPreparationMs','serializationMs','serializationComplete','deliveryMs','returnMs'];
function transport(t,{maintenance=true,openStall=false}={}) {
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
      if(!openStall)queueMicrotask(()=>worker.emit('message',{operation:data.operation,result:{ok:true,value:null},fileIdentity:'12:34'}));return worker;}});
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
    meter.reset(message.maintenanceOrdinal);
    try {storage.refresh(p,access(),{maxItems:32,maxMs:1000});if(operation==='serialize')meter.serialize(()=>{});}
    catch(e){assert.equal(e.code,'read_timeout');}
    if(!hit)io.reply(message,{ok:true,value:null});
  }));
  const result=await h.refreshContextIndex({readSet:[personal],types:['memory'],intent:'current',mode:'lexical',budget:{maxItems:32,maxMs:1000}},io.token);
  assert.equal(hit,true,`${operation} instrumentation reached`);
  assert.equal(result.error?.code,'read_timeout');
  const stall=reader.maintenanceStallDiagnostic?.(result);
  assert.deepEqual(legacyStall(stall),{kind:kinds.indexOf(operation),runningMs:1000,unitCount:unitsAtStall},'operation and exact injected duration survive terminal cutoff');
  io.set(5000);assert.deepEqual(reader.maintenanceStallDiagnostic(result),stall,'cutoff snapshot does not age or depend on Worker survival');
  assert.deepEqual(Object.keys(result).sort(),['error','ok']);
  assert.equal((await h.getContextIndexStatus({readSet:[personal],types:['memory'],intent:'current',deadlineMs:1000},io.token)).error.code,'store_closed');
  await h.close();
});

test('stall attribution: reader delivery cutoff captures the marker before discarding a late response',async t=>{
  const io=transport(t),h=await io.open(io.options);t.after(()=>h.close());
  assert.ok(io.data.maintenanceMarker instanceof SharedArrayBuffer,'maintenance Worker has shared stall marker');
  const meter=attribution.createMaintenanceAttribution({buffer:io.data.maintenanceMarker,now:io.now,hrtime:()=>BigInt(io.now())*1000000n});
  io.action(message=>{meter.reset(message.maintenanceOrdinal);meter.serialize(()=>{io.set(1100);io.reply(message,{ok:true,value:null});});});
  const result=await h.refreshContextIndex({readSet:[personal],types:['memory'],intent:'current',mode:'lexical',budget:{maxItems:1,maxMs:1000}},io.token);
  assert.deepEqual(legacyStall(reader.maintenanceStallDiagnostic?.(result)),{kind:11,runningMs:1000,unitCount:0},'late response records serialization at cutoff');
  await h.close();
});

test('stall attribution: successful native refresh fields stay in the fixed private channel',async t=>{
  const f=fixture(t);f.admit('orchard evidence',personal);const service=configured(t,f.path,[personal],{service:true});
  const h=await reader.openContextIndexMaintainer(service.options);t.after(()=>h.close());
  const result=await h.refreshContextIndex({readSet:[personal],types:['memory'],intent:'current',mode:'lexical',budget:{maxItems:32,maxMs:1000}},service.token);
  assert.equal(result.ok,true,JSON.stringify(result));const detail=reader.maintenancePhaseDiagnostic(result);
  for(const field of fields)assert.ok(Number.isFinite(detail[field])&&detail[field]>=0,`${field} private numeric field`);
  assert.ok(Number.isSafeInteger(detail.ordinal)&&detail.ordinal>0,'native refresh has private join ordinal');
  assert.equal(JSON.stringify(result).includes('"ordinal"'),false);
  assert.ok(detail.scanUnits>0&&detail.itemUnits>0&&detail.verificationUnits>0&&detail.publicationUnits>0);
  assert.equal(detail.itemRows,1);assert.equal(detail.publicationRows,1);
  assert.equal(detail.unitCount,detail.scanUnits+detail.itemUnits+detail.verificationUnits+detail.publicationUnits+detail.gcUnits);
  for(const field of fields)assert.equal(JSON.stringify(result).includes('"'+field+'"'),false,field+' absent from public DTO');
  const entry=await import('../index.mjs');assert.equal(entry.maintenanceStallDiagnostic,undefined);
});

test('stall attribution: non-maintenance readers allocate and transport no marker',async t=>{
  const NativeSharedArrayBuffer=globalThis.SharedArrayBuffer;let allocations=0;
  globalThis.SharedArrayBuffer=new Proxy(NativeSharedArrayBuffer,{construct(target,args){if(args[0]===32||args[0]===56)allocations++;return Reflect.construct(target,args);}});
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
      clock=105;meter.transaction(db,()=>{meter.step();clock=112;db.prepare('SELECT 1').get();meter.acquired();
        assert.deepEqual(attribution.readMaintenanceMarker(buffer,120000000n),{kind:2,runningMs:20,unitCount:1});clock=140;},readTransaction);
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

for(const alternating of [false,true])test(`round 1 A1 ${alternating?'alternating intents':'no receipt'} excludes the previous dispatch marker`,async t=>{
  const io=transport(t),h=await io.open(io.options);t.after(()=>h.close());
  const meter=attribution.createMaintenanceAttribution({buffer:io.data.maintenanceMarker,now:io.now,hrtime:()=>BigInt(io.now())*1000000n});
  io.action(message=>{meter.reset(message.maintenanceOrdinal);for(let i=0;i<(alternating?7:1);i++)meter.measure('item',()=>io.set(101),true);
    io.reply(message,{ok:true,value:{}},{observedAtMonoMs:101});});
  const payload={readSet:[personal],types:['memory'],intent:'current',mode:'lexical',budget:{maxItems:32,maxMs:1000}};
  await h.refreshContextIndex(payload,io.token);io.set(5000);io.action(()=>{});
  const pending=h.refreshContextIndex({...payload,intent:alternating?'history':'current'},io.token);
  io.set(6000);io.fire();const result=await pending,stall=reader.maintenanceStallDiagnostic(result);
  assert.equal(stall.unitCount,0,'pending dispatch never accepts previous-call units');
  assert.equal(stall.runningMs,1000,'pending dispatch age starts at this call');
  assert.equal(stall.pendingDispatch,1);assert.equal(stall.ordinal,io.outbound.at(-1).maintenanceOrdinal);
  await h.close();
});

test('round 1 A2 sidecar delay before the first canonical query is excluded from canonical acquisition',t=>{
  const f=fixture(t);f.admit('orchard canonical wait evidence',personal);
  let clock=100,armed=false,observed;
  const buffer=attribution.maintenanceMarker(),meter=attribution.createMaintenanceAttribution({buffer,now:()=>clock,hrtime:()=>BigInt(clock)*1000000n});
  const observer=nativeObserver(null),facade=openContextProductFacade(f.path,{});t.after(()=>facade.close());
  // Inject only sidecar attestation time, while a canonical read transaction is open.
  const database=observer.database;
  observer.database=native=>{
    const wrapped=database(native);
    return new Proxy(wrapped,{get(target,key){
      if(key==='prepare')return sql=>{if(armed&&sql.includes('sqlite_schema')){clock+=400;observed=attribution.readMaintenanceMarker(buffer,BigInt(clock)*1000000n);armed=false;}return target.prepare(sql);};
      const value=Reflect.get(target,key,target);return typeof value==='function'?value.bind(target):value;
    }});
  };
  const storage=productSidecar({path:f.path,db:facade.port.db,identity:facade.port.identity,features:facade.port.features,writable:true,now:()=>clock,observer,attribution:meter,
    rendezvous(point){if(point==='gc-candidate')armed=false;if(point==='opened')armed=true;}});t.after(()=>storage.close());
  storage.refresh({readSet:[personal],types:['memory'],intent:'current',ownerCoverage:descriptor([personal])},accessDigest({ownerId:personal.ownerId,namespaces:{readSet:[personal]}}),{maxItems:32,maxMs:5000});
  assert.ok(observed,'sidecar attestation delay reached');
  assert.notEqual(observed.kind,10,'sidecar attestation is not canonical-read');
  assert.equal(meter.snapshot().canonicalReadWaitMaxMs,0,'canonical wait excludes 400 ms sidecar delay');
});

test('round 1 A3 opening cutoff preserves its private snapshot on the thrown error',async t=>{
  const io=transport(t,{openStall:true}),pending=io.open({...io.options,deadlineMs:1000}).catch(e=>e);
  const meter=attribution.createMaintenanceAttribution({buffer:io.data.maintenanceMarker,now:io.now,hrtime:()=>BigInt(io.now())*1000000n});
  meter.measure('begin',()=>{io.set(1100);io.fire();});
  const error=await pending;assert.equal(error.code,'read_timeout');
  const stall=reader.maintenanceStallDiagnostic(error);
  assert.equal(stall?.kind,7,'opening error carries the captured operation');
  assert.equal(stall.runningMs,1000);assert.ok(Number.isSafeInteger(stall.ordinal)&&stall.ordinal>0);
});

test('round 1 A4 dispatch ordinals are process-wide across runtime module instances',async()=>{
  assert.equal(typeof attribution.allocateMaintenanceOrdinal,'function','process-wide ordinal allocator exists');
  const other=await import('../context-product-attribution.mjs?ordinal-instance');
  const values=[attribution.allocateMaintenanceOrdinal(),other.allocateMaintenanceOrdinal(),attribution.allocateMaintenanceOrdinal()];
  assert.equal(new Set(values).size,3);assert.ok(values[0]<values[1]&&values[1]<values[2]);
});

test('round 2 C1 ordinal exhaustion disables attribution without repeating an identifier',()=>{
  const next=attribution.createMaintenanceOrdinalAllocator({next:Number.MAX_SAFE_INTEGER-1});
  assert.equal(next(),Number.MAX_SAFE_INTEGER);
  for(let i=0;i<2;i++){let ordinal;assert.doesNotThrow(()=>{ordinal=next();},'exhaustion disables attribution without throwing');assert.equal(ordinal,null,'exhaustion returns explicit no ordinal');}
});

test('round 1 A5 unit telemetry reuses admission clock samples without per-row mapping allocation',async t=>{
  let reads=0;const clock=()=>{reads++;return 100;},meter=attribution.createMaintenanceAttribution({now:clock,hrtime:()=>{reads++;return 100000000n;}});
  const q=maintenanceQuantum({now:clock,cutoff:1100,maxMs:1000,attribution:meter});reads=0;
  q.measure(()=>{},'item');assert.equal(reads,4,'unit reuses admission clock samples');
  const oracle=JSON.parse(readFileSync(new URL('../testing/context-product-admission-oracle.json',import.meta.url),'utf8'));
  let decisions=0;
  for(const {maxMs,kind,cost,times,decisions:expected} of oracle.cases){
    let time=0;const stats=attribution.createMaintenanceAttribution({now:()=>time,hrtime:()=>BigInt(Math.floor(time*1000000))});
    const unit=maintenanceQuantum({now:()=>time,cutoff:maxMs,maxMs,attribution:stats});unit.measure(()=>{time+=cost;},kind);
    for(let i=0;i<times.length;i++){time=times[i];assert.equal(unit.admit(kind),expected[i],`admission ${maxMs}/${kind}/${i} matches frozen oracle`);decisions++;}
  }
  assert.equal(decisions,84);t.diagnostic('84 frozen admission boundary decisions matched');
});

test('round 2 C3 admission regression has no runtime Git dependency',()=>{
  const source=readFileSync(new URL('./context-read-product-stall.test.mjs',import.meta.url),'utf8');
  assert.doesNotMatch(source,/\bexecFileSync\s*\(\s*['"]git['"]/,'admission regression has no Git subprocess dependency');
});

test('round 2 C2 canonical DTO preparation retains serialize timing without an instrumentation callback',async t=>{
  const f=fixture(t);f.admit('orchard preparation evidence',personal);const facade=openContextProductFacade(f.path,{});t.after(()=>facade.close());
  let clock=100,inside=0,observed;
  const buffer=attribution.maintenanceMarker(),meter=attribution.createMaintenanceAttribution({buffer,now:()=>clock,hrtime:()=>BigInt(clock)*1000000n,
    rendezvous(kind){if(kind==='serialize'&&facade.port.db.isTransaction)inside++;}});
  const index=openProductIndex({path:f.path,facade,maintenance:true,ownerCoverage:descriptor([personal]),now:()=>clock,attribution:meter,
    authorize:()=>({accessGenerations:accessDigest({ownerId:personal.ownerId,namespaces:{readSet:[personal]}}),check(){},envelope:fn=>fn()})});t.after(()=>index.close());
  const entries=Object.entries;
  // coverage() enumerates this fixed DTO map while preparing the result.
  Object.entries=value=>{
    if(!observed&&facade.port.db.isTransaction&&value?.memory&&Object.hasOwn(value.memory,'eligible')&&Object.hasOwn(value.memory,'embedded')){
      clock+=40;observed=attribution.readMaintenanceMarker(buffer,BigInt(clock)*1000000n);
    }
    return entries(value);
  };
  let result;
  try {result=index.run('refreshContextIndex',{readSet:[personal],types:['memory'],intent:'current',mode:'lexical',budget:{maxItems:32,maxMs:1000}},{});}
  finally {Object.entries=entries;}
  assert.equal(result.ok,true,JSON.stringify(result));assert.ok(observed,'DTO preparation interval reached');
  assert.equal(observed.kind,11,'DTO preparation is attributed to serialize');
  assert.equal(observed.runningMs,40,'serialize marker includes the full DTO preparation interval');
  assert.equal(meter.snapshot().resultPreparationMs,40,'resultPreparationMs preserves DTO preparation');
  assert.equal(inside,0,'transaction instrumentation invokes no rendezvous callback');
});

test('round 1 A6 internal marker preserves the legacy bootstrap capacity boundary',async t=>{
  const io=transport(t),first=await io.open(io.options);await first.close();
  const legacyKeys=['path','readSet','ownerCoverage','request','binding','maintenance','wal','sidecarJournalMode','host','operation','frame','resources','deadlineMs'];
  const legacy=Object.fromEntries(legacyKeys.map(k=>[k,io.data[k]]));
  let low=0,high=262144;
  while(low<high){const mid=Math.ceil((low+high)/2),data={...legacy,host:{...legacy.host,configuration:{...legacy.host.configuration,padding:'x'.repeat(mid)}}};
    try{hostConfiguration(data);operationMessage(data);low=mid;}catch(e){assert.equal(e.code,'invalid_input');high=mid-1;}}
  const fresh=transport(t);fresh.options.host.configuration.padding='x'.repeat(low);
  // Equal-length synthetic paths keep the independently computed old cap exact.
  const h=await fresh.open(fresh.options).catch(e=>e);
  assert.equal(typeof h.close,'function','legacy-capacity configuration still opens');if(h.close)await h.close();
});


test('round 1 A3 reader opening error reaches the pump without outer timer delivery',async t=>{
  const io=transport(t,{openStall:true}),timers=new Set();
  const renew=createMaintenancePumpRuntime({open:io.open,now:io.now,setTimer(fn,ms){const timer={fn,at:io.now()+ms};timers.add(timer);return timer;},clearTimer:timer=>timers.delete(timer)});
  const pump=renew({supervisor:io.options.supervisor,id:randomUUID(),serviceCredential:io.token,window:{id:'opening',endsAtMonoMs:60100,usedItems:0,usedMs:0},
    budgets:{maxItems:64,maxMs:2000},quantum:{maxItems:32,maxMs:1000},pollMs:25,renewalMs:60000,projections:[{options:io.options,types:['memory']}]});
  const timer=[...timers][0];timers.delete(timer);io.set(timer.at);const running=timer.fn();
  const meter=attribution.createMaintenanceAttribution({buffer:io.data.maintenanceMarker,now:io.now,hrtime:()=>BigInt(io.now())*1000000n});
  meter.measure('begin',()=>{io.set(timer.at+1000);io.fire();});
  await running;const final=await pump.completion,lane=maintenancePumpPhaseDiagnostic(final).projections[0];
  assert.equal(lane.lastStall?.kind,7,'opening error snapshot reaches pump without quantum timer');
  assert.equal(lane.lastStall.runningMs,1000);assert.equal(lane.lastStall.ordinal,lane.latest.ordinal);
  assert.equal(final.usedItems,32);assert.equal(final.usedMs,1000);assert.equal(final.error,'read_timeout');await pump.close();
});


test('round 2 C1 exhausted reader dispatch uses an explicit unjoined call and rejects old markers',async t=>{
  const io=transport(t),h=await io.open(io.options);t.after(()=>h.close());
  const buffer=io.data.maintenanceMarker,meter=attribution.createMaintenanceAttribution({buffer,now:io.now,hrtime:()=>BigInt(io.now())*1000000n});
  meter.measure('item',()=>{},true);
  const previous=io.data.maintenanceOrdinal,state=globalThis[Symbol.for('context-read-product/maintenance-dispatch-ordinal')],saved=state.next;
  t.after(()=>{state.next=saved;});state.next=Number.MAX_SAFE_INTEGER;
  const payload={readSet:[personal],types:['memory'],intent:'current',mode:'lexical',budget:{maxItems:32,maxMs:1000}};
  io.action(message=>{meter.reset(message.maintenanceOrdinal);meter.serialize(()=>{});io.reply(message,{ok:true,value:{}},{observedAtMonoMs:100,maintenancePhases:{ordinal:123}});});
  const success=await h.refreshContextIndex(payload,io.token);
  assert.equal(success.ok,true,'exhausted reader call succeeds');
  assert.equal(io.outbound.at(-1)?.maintenanceOrdinal,null,'exhausted call explicitly transports no ordinal');
  assert.equal(Object.hasOwn(reader.maintenancePhaseDiagnostic(success),'ordinal'),false,'exhausted reader sample has no join key');
  assert.deepEqual(attribution.serializationDiagnostic(buffer),{},'exhausted calls cannot accept serialization from an unjoined marker');
  meter.reset(previous);meter.measure('item',()=>{},true);io.action(()=>{});
  const pending=h.refreshContextIndex(payload,io.token);
  const expected={kind:0,runningMs:0,unitCount:0,unattributed:1};
  assert.deepEqual(attribution.readMaintenanceMarker(buffer,6000000000n),expected,'no receipt never reads previous-call data after exhaustion');
  meter.reset(previous);meter.measure('commit',()=>{},true);
  assert.deepEqual(attribution.readMaintenanceMarker(buffer,6000000000n),expected,'late previous writer remains unattributed');
  meter.reset(null);meter.measure('item',()=>{},true);
  assert.deepEqual(attribution.readMaintenanceMarker(buffer,6000000000n),expected,'received exhausted call remains unattributed');
  io.set(1100);io.fire();const result=await pending;
  assert.deepEqual(reader.maintenanceStallDiagnostic(result),expected,'reader cutoff carries only unattributed marker data');
  await h.close();
});

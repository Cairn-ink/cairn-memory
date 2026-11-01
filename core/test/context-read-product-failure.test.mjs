import test from 'node:test';
import assert from 'node:assert/strict';
import { Worker } from 'node:worker_threads';
import { EventEmitter } from 'node:events';
import { randomUUID } from 'node:crypto';
import * as reader from '../context-product-reader.mjs';
import * as pump from '../context-product-pump.mjs';
import * as attribution from '../context-product-attribution.mjs';
import { sealNative } from '../context-product-telemetry.mjs';
import { createContextReadSupervisor,createSupervisorRegistry,supervisorOwner } from '../context-read-supervisor.mjs';
import { credentialDigest,PRODUCT_PROFILE } from '../context-product-control.mjs';
import { personal,descriptor } from '../testing/context-product-owner-fixture.mjs';

const publicReaderFailure='{"ok":false,"error":{"code":"reader_failed","retryable":false}}';
function setup(t,mode,{maintenance=true,fake,observation,refreshThrows=false,closeThrows=false,isolated=false}={}){
  let clock=100,serial=0,handle,lastResult,opening;
  const timers=new Map(),supervisor=isolated?createSupervisorRegistry().supervisor():createContextReadSupervisor(),token={service:'failure-test'};
  t.after(()=>supervisor.close().catch(()=>{}));
  const readSet=[personal],ownerCoverage=descriptor(readSet),control={requestId:randomUUID(),handleId:randomUUID(),credentialBindingId:randomUUID(),credentialExpiresUtcMs:null,requestMaxMs:5000};
  const binding={kind:maintenance?'service':'request',...(maintenance?{serviceId:'failure-service',credentialBindingId:control.credentialBindingId,credentialExpiresUtcMs:null}:control),
    credentialDigest:credentialDigest(token),ownerId:personal.ownerId,namespaces:{readSet,ownerCoverage},issuedAt:0};delete binding.requestMaxMs;
  const options={supervisor,path:new URL('synthetic-failure-'+randomUUID()+'.sqlite',import.meta.url).pathname,version:'context-read-v1',profile:PRODUCT_PROFILE,readSet,ownerCoverage,
    ...(maintenance?{sidecarJournalMode:'DELETE'}:{requestControl:control}),host:{moduleUrl:new URL('../testing/context-product-failure-worker.mjs',import.meta.url).href,
      configuration:{[maintenance?'serviceBinding':'requestBinding']:binding,...(maintenance?{}:{requestReservation:new SharedArrayBuffer(4)})}}};
  const setTimer=(fn,ms)=>{const key={n:++serial,unref(){}};timers.set(key,{fn,at:clock+ms});return key;},clearTimer=key=>timers.delete(key);
  const open=reader.createProductReaderRuntime({maintenance,now:()=>BigInt(clock)*1000000n,utc:()=>1000,setTimer,clearTimer,
    spawnWorker(data){opening=data;if(fake)return fake(data);
      return new Worker(new URL('../testing/context-product-failure-worker.mjs',import.meta.url),{workerData:{...data,failureMode:mode},execArgv:[],env:{},resourceLimits:{maxOldGenerationSizeMb:16,maxYoungGenerationSizeMb:2}});}});
  const renew=pump.createMaintenancePumpRuntime({now:()=>clock,setTimer,clearTimer,...(observation?{observedAt:()=>observation(clock)}:{}),
    open:async(...args)=>{const resident=await open(...args);handle=resident;return {...resident,refreshContextIndex:async(...call)=>{if(refreshThrows)throw new TypeError('private call text');return lastResult=await resident.refreshContextIndex(...call);},close:async()=>{await resident.close();if(closeThrows)throw new Error('private cleanup text');}};}});
  const config={supervisor,id:'failure-'+mode,window:{id:'failure-window',endsAtMonoMs:60100,usedItems:0,usedMs:0},budgets:{maxItems:8,maxMs:8000},quantum:{maxItems:1,maxMs:1000},pollMs:1000,renewalMs:60000,serviceCredential:token,projections:[{options,types:['memory']}]};
  return {config,renew,open,options,token,timers,get handle(){return handle;},get result(){return lastResult;},get opening(){return opening;},now:()=>clock,
    async step(){const [key,timer]=[...timers].sort((a,b)=>a[1].at-b[1].at)[0];assert.ok(timer,'scheduled quantum exists');timers.delete(key);clock=timer.at;await timer.fn();}};
}
const cases=[['heap','worker_heap_limit'],['exit','worker_exit'],['named','worker_error'],['protocol','protocol'],['bad_observation','observation_timing'],['unmapped','unmapped:synthetic_engine_code'],['unsafe_code','unmapped:other'],['mapped','unmapped:synthetic_engine_code'],['worker_state','worker_state'],['resume','exception:TypeError'],['exception_other','exception:other']];
for(const [mode,cause] of cases)test(`failure cause: ${mode} reaches reader and pump privately`,{timeout:30000},async t=>{
  const s=setup(t,mode),p=s.renew(s.config);t.after(()=>p.close().catch(()=>{}));
  await s.step();if(mode==='resume'){await s.step();await s.step();}
  const final=await p.completion;
  assert.equal(JSON.stringify(s.result),publicReaderFailure,'public reader bytes equal the base');
  assert.equal(JSON.stringify(final),JSON.stringify({id:s.config.id,state:'failed',windowId:'failure-window',usedItems:1,usedMs:1000,maxItems:8,maxMs:8000,error:'reader_failed'}),'public pump bytes equal the base');
  const failure=reader.maintenanceFailureDiagnostic?.(s.result);
  assert.equal(failure?.cause,cause,mode+' private reader cause');
  const lane=pump.maintenancePumpPhaseDiagnostic(final).projections[mode==='resume'?0:0];
  assert.equal(lane.lastFailure?.cause,cause,mode+' private pump cause');
  assert.equal(pump.maintenancePumpDiagnostic(final).lastFailure.cause,cause);
  assert.equal(failure.ordinal,lane.latest.ordinal,'failure joins its dispatch ordinal');
  assert.deepEqual(lane.lastFailure.stall,failure.stall,'pump retains the captured stall snapshot');
  assert.ok(Object.isFrozen(failure));
  const family=cause.startsWith('unmapped:')?'unmapped':cause.startsWith('exception:')?'exception':cause;
  assert.equal(lane.failureCounts[family],1);assert.equal(reader.maintenanceReaderFailureDiagnostic(s.handle).failureCounts[family],1);
  if(mode==='exit')assert.equal(failure.exitCode,23);
  if(mode==='named')assert.equal(failure.errorName,'TypeError');
  if(mode==='resume'||mode==='exception_other')assert.equal(failure.step,3,'resume exception retains the verification step');
  assert.equal(JSON.stringify(failure).includes('synthetic private'),false);
});

test('failure cause: observation timing retains the base public bytes',async t=>{
  const s=setup(t,'observation',{observation:clock=>clock+1}),p=s.renew(s.config);t.after(()=>p.close().catch(()=>{}));await s.step();
  const final=await p.completion;
  assert.equal(JSON.stringify(final),JSON.stringify({id:s.config.id,state:'failed',windowId:'failure-window',usedItems:1,usedMs:1000,maxItems:8,maxMs:8000,error:'reader_failed'}),'invalid observation public pump bytes equal the base');
  assert.equal(pump.maintenancePumpPhaseDiagnostic(final).projections[0].lastFailure?.cause,'observation_timing','invalid clock private pump cause');
});

for(const mode of ['heap','exit','named','protocol','unmapped','resume'])test(`failure cause: request reader ${mode} gets no private metadata`,{timeout:30000},async t=>{
  const s=setup(t,mode,{maintenance:false}),h=await s.open(s.options);t.after(()=>h.close().catch(()=>{}));
  const result=await h.getContextIndexStatus({readSet:[personal],types:['memory'],intent:'current',deadlineMs:1000},s.token);
  if(mode!=='resume')assert.equal(JSON.stringify(result),publicReaderFailure,'request public bytes equal the base');
  assert.equal(reader.maintenanceFailureDiagnostic?.(result),undefined);assert.equal(reader.maintenanceReaderFailureDiagnostic?.(h),undefined);
  assert.equal(Object.hasOwn(s.opening,'maintenanceMarker'),false);assert.equal(Object.hasOwn(s.opening,'maintenanceFailure'),false);
});

for(const kind of ['scan','item','verify','publication','gc','vacuum','begin','commit','save','canonical-read','serialize'])test(`failure cause: caught ${kind} exception records the innermost step`,()=>{
  const meter=attribution.createMaintenanceAttribution({now:()=>100,hrtime:()=>100000000n});
  assert.throws(()=>meter.measure(kind,()=>{throw new TypeError('private fixture message');}),TypeError);
  assert.deepEqual(meter.failure?.(),{kind:'exception',errorName:'TypeError',step:attribution.maintenanceKinds.indexOf(kind)},kind+' caught exception private phase');
});

function fakeWorker(data,{identity=false,send=false,error=false,fileIdentity='12:34'}={}){
  const worker=new EventEmitter();Object.assign(worker,{ref(){},unref(){},terminate(){return Promise.resolve(1);},postMessage(message){
    if(message.method==='close'){queueMicrotask(()=>worker.emit('exit',0));return;}
    if(send||identity)throw new RangeError('private dispatch text');
    if(error){worker.emit('error',Object.create({constructor:{name:'unsafe / constructor'}}));return;}
    worker.emit('message',{operation:message.operation,result:{ok:true,value:{status:'complete',progress:{transformed:0}}},observedAtMonoMs:Number(BigInt(message.operation.enteredMonoNs))/1e6});
  }});
  queueMicrotask(()=>worker.emit('message',identity?{kind:'identity',operation:data.operation,fileIdentity}:{operation:data.operation,result:{ok:true,value:null},fileIdentity}));return worker;
}
for(const failedProof of [false,true])test(`opening rebind: ${failedProof?'failed proof refuses with identity cause':'waits and succeeds after the other owner proof'}`,{timeout:30000},async t=>{
  let releaseClose,identityAcknowledged,closeStarted;
  const heldClose=new Promise(resolve=>{releaseClose=resolve;}),acknowledged=new Promise(resolve=>{identityAcknowledged=resolve;}),closing=new Promise(resolve=>{closeStarted=resolve;});
  t.after(()=>releaseClose());
  let pending,firstData,ackCount=0;
  function actor(data,hold) {
    const worker=new EventEmitter();
    Object.assign(worker,{ref(){},unref(){},terminate(){return Promise.resolve(0);},postMessage(message){
      if(message.kind==='identity-ack') {
        if(hold)queueMicrotask(()=>worker.emit('message',{operation:data.operation,result:{ok:true,value:null},fileIdentity:'12:34'}));
        else {ackCount++;identityAcknowledged();}return;
      }
      if(message.method==='close') {
        if(hold){closeStarted();void heldClose.then(()=>{sealNative(data.frame);worker.emit('exit',0);});}
        else {sealNative(data.frame);queueMicrotask(()=>worker.emit('exit',0));}
      }
    }});
    queueMicrotask(()=>worker.emit('message',{kind:'identity',operation:data.operation,fileIdentity:'12:34'}));
    return worker;
  }
  const a=setup(t,'closing-owner',{maintenance:false,isolated:true,fake:data=>{firstData=data;return actor(data,true);}});
  const b=setup(t,'opening-owner',{isolated:true,fake:data=>{pending={data,worker:actor(data,false)};return pending.worker;}});
  b.options.supervisor=supervisorOwner(a.options.supervisor).registry.supervisor();t.after(()=>b.options.supervisor.close().catch(()=>{}));
  b.options.path=a.options.path;
  const namespace={...personal,ownerId:'synthetic-rebinding-owner'};b.options.readSet=[namespace];
  Object.assign(b.options.host.configuration.serviceBinding,{serviceId:'synthetic-rebind-service',ownerId:namespace.ownerId,namespaces:{readSet:[namespace],ownerCoverage:descriptor([namespace])}});
  const first=await a.open(a.options);let settled=false;
  const opening=b.open(b.options).then(value=>{settled=true;return {value};},error=>{settled=true;return {error};});
  let disposal;
  try {
    await acknowledged;assert.equal(ackCount,1,'identity is acknowledged while no owner holds cleanup');
    if(failedProof)Atomics.add(new Int32Array(firstData.resources),0,1); // Deliberately unproven lease.
    disposal=first.close().catch(error=>error);await closing;
    pending.worker.emit('message',{operation:pending.data.operation,result:{ok:true,value:null},fileIdentity:'12:34'});
    for(let i=0;i<30;i++)await Promise.resolve();
    assert.equal(settled,false,'validated opening waits for the other owner disposal proof');
    assert.equal(ackCount,1,'held rebind never acknowledges again');
    releaseClose();await disposal;
    const outcome=await opening;
    if(failedProof) {
      assert.equal(outcome.error?.code,'reader_failed','failed proof refuses the admitted bind');
      const failure=reader.maintenanceFailureDiagnostic(outcome.error);assert.equal(failure?.cause,'identity');
      assert.equal(Object.hasOwn(failure,'protocolKind'),false,'failed proof is never a result_shape protocol failure');
    } else {
      assert.equal(outcome.error,undefined,'complete proof admits the already validated opening');
      assert.ok(outcome.value);await outcome.value.close();
    }
    assert.equal(ackCount,1,'held opening sends no extra acknowledgement');
  } finally {releaseClose();await disposal;await first.close().catch(()=>{});}
});
for(const [mode,cause,fake] of [['spawn','spawn',()=>{throw new TypeError('private spawn text');}],['dispatch','dispatch',data=>fakeWorker(data,{send:true})],['identity','identity',data=>fakeWorker(data,{identity:true})],['bounded_error','worker_error',data=>fakeWorker(data,{error:true})]])
test(`failure cause: ${mode} records the collapsed parent boundary`,async t=>{
  const s=setup(t,mode,{fake}),p=s.renew(s.config);t.after(()=>p.close().catch(()=>{}));await s.step();const final=await p.completion;
  assert.equal(final.error,'reader_failed','collapsed parent failure preserves the base code');
  const record=pump.maintenancePumpPhaseDiagnostic(final).projections[0].lastFailure;
  assert.equal(record?.cause,cause,mode+' collapsed parent cause');
  if(mode==='bounded_error')assert.equal(record.errorName,'other','constructor names use a bounded identifier');
});

test('failure cause: engine errors retain known public code and retryability',async t=>{
  const s=setup(t,'engine'),p=s.renew(s.config);t.after(()=>p.close().catch(()=>{}));await s.step();const final=await p.completion;
  assert.equal(JSON.stringify(s.result),'{"ok":false,"error":{"code":"storage_busy","retryable":true}}','known engine public bytes equal the base');
  assert.equal(reader.maintenanceFailureDiagnostic?.(s.result)?.cause,'engine','known engine private cause');
  assert.equal(pump.maintenancePumpDiagnostic(final).lastFailure.engineCode,'storage_busy');
});

test('failure cause: successful calls have no failure and do not reset counts',async t=>{
  const s=setup(t,'success'),p=s.renew(s.config);t.after(()=>p.close().catch(()=>{}));await s.step();
  assert.equal(JSON.stringify(s.result),'{"ok":true,"value":{"status":"complete","progress":{"transformed":0}}}','success public bytes equal the base');
  const diagnostic=pump.maintenancePumpDiagnostic(p.getStatus());
  assert.equal(diagnostic.lastFailure,null,'success has no private failure');
  assert.ok(Object.values(diagnostic.failureCounts).every(n=>n===0));assert.equal(reader.maintenanceFailureDiagnostic(s.result),undefined);
});


test('failure cause: uncoded call failure preserves the base pump disposition',async t=>{
  const s=setup(t,'call_error',{refreshThrows:true}),p=s.renew(s.config);t.after(()=>p.close().catch(()=>{}));await s.step();const final=await p.completion;
  assert.equal(final.error,'reader_failed');assert.equal(final.usedItems,1);assert.equal(final.usedMs,1000);
  assert.equal(pump.maintenancePumpDiagnostic(final).lastFailure?.cause,'call_error','uncoded parent call private cause');
});

test('failure cause: cleanup failure is recorded without changing close rejection',async t=>{
  const s=setup(t,'cleanup',{closeThrows:true}),p=s.renew(s.config);await s.step();await assert.rejects(p.close(),Error);const final=await p.completion;
  assert.equal(final.error,'reader_failed');assert.equal(final.usedItems,0);assert.equal(final.usedMs,0);
  assert.equal(pump.maintenancePumpDiagnostic(final).lastFailure?.cause,'cleanup','cleanup private cause');
});

test('failure cause: diagnostics are absent from public exports',async()=>{
  const api=await import('../index.mjs');for(const name of ['maintenanceFailureDiagnostic','maintenanceReaderFailureDiagnostic','maintenanceFailureRecord'])assert.equal(api[name],undefined);
});


test('failure cause: a recovered exception cannot replace a later coded failure',()=>{
  const meter=attribution.createMaintenanceAttribution({now:()=>0,hrtime:()=>1000000n});
  assert.throws(()=>meter.measure('item',()=>{throw new TypeError('private recovered text');}),TypeError);
  assert.equal(typeof meter.selectFailure,'function','terminal failure selection is available');
  meter.selectFailure(Object.assign(new Error('private coded text'),{code:'storage_busy'}));
  assert.equal(meter.failure(),undefined,'only the terminal error supplies exception metadata');
});


test('failure cause: reader cleanup rejection carries a private cause without changing the Error',async t=>{
  const s=setup(t,'reader_cleanup',{fake:data=>{const worker=fakeWorker(data),send=worker.postMessage;worker.postMessage=message=>{if(message.method==='close')throw new RangeError('private close text');return send(message);};return worker;}});
  const h=await s.open(s.options);const error=await h.close().catch(error=>error);
  assert.equal(error.constructor.name,'Error','reader close Error constructor equals the base');
  assert.deepEqual(Object.keys(error),['code','cleanup','diagnostics'],'reader close Error properties equal the base');
  assert.equal(error.code,'reader_failed');
  assert.equal(reader.maintenanceFailureDiagnostic?.(error)?.cause,'cleanup','reader cleanup private cause');
});


test('failure cause: an undefined thrown value retains its bounded fallback and step',()=>{
  const meter=attribution.createMaintenanceAttribution({now:()=>0,hrtime:()=>1000000n});let caught=false;
  try {meter.measure('verify',()=>{throw undefined;});}catch{caught=true;}
  assert.equal(caught,true);
  assert.deepEqual(meter.failure?.(),{kind:'exception',errorName:'other',step:3},'uncoded non-Error private fallback and step');
});


test('K1 reader close preserves error before exit and registry cleanup',async t=>{
  const s=setup(t,'combined_close',{isolated:true,fake:data=>{
    const worker=fakeWorker(data),send=worker.postMessage;
    worker.postMessage=message=>{if(message.method!=='close')return send(message);
      worker.emit('error',new TypeError('private initiating close text'));worker.emit('exit',7);
    };return worker;
  }});
  const h=await s.open(s.options),error=await h.close().catch(error=>error);
  assert.equal(error.code,'reader_failed','combined close public code equals the base');
  assert.deepEqual(Object.keys(error),['code','cleanup','diagnostics'],'combined close public Error shape equals the base');
  const diagnostic=reader.maintenanceReaderFailureDiagnostic(h),primary=reader.maintenanceFailureDiagnostic(error);
  assert.equal(primary?.cause,'worker_error','close primary survives exit and registry cleanup');
  assert.equal(primary.errorName,'TypeError');assert.equal(primary.stage,'close');assert.equal(Object.hasOwn(primary,'ordinal'),false);assert.equal(Object.hasOwn(primary,'stall'),false);
  assert.deepEqual(diagnostic.lastFailure,primary,'eventual rejection retains the latched primary');
  assert.equal(diagnostic.failureCounts.worker_error,1);assert.equal(diagnostic.failureCounts.worker_exit,0);assert.equal(diagnostic.failureCounts.cleanup,0);
  assert.equal(diagnostic.secondaryFailure.cause,'cleanup');assert.equal(diagnostic.secondaryFailureCounts.worker_exit,1);assert.equal(diagnostic.secondaryFailureCounts.cleanup,1);
});

test('K1 pump drain preserves the initiating call and its join snapshot',async t=>{
  const s=setup(t,'engine',{closeThrows:true,isolated:true}),p=s.renew(s.config);await s.step();const final=await p.completion;
  const primary=reader.maintenanceFailureDiagnostic(s.result),diagnostic=pump.maintenancePumpDiagnostic(final),lane=pump.maintenancePumpPhaseDiagnostic(final).projections[0];
  assert.equal(final.error,'reader_failed','combined call and drain retain base public disposition');
  assert.equal(diagnostic.lastFailure?.cause,'engine','drain preserves the initiating call failure');
  assert.equal(diagnostic.lastFailure.engineCode,'storage_busy');assert.equal(diagnostic.lastFailure.ordinal,primary.ordinal);assert.deepEqual(diagnostic.lastFailure.stall,primary.stall);
  assert.equal(diagnostic.failureCounts.engine,1);assert.equal(diagnostic.failureCounts.cleanup,0);assert.equal(diagnostic.secondaryFailureCounts.cleanup,1);
  assert.equal(lane.secondaryFailure.cause,'cleanup');assert.equal(lane.secondaryFailure.number,0);
});


test('K1 supervisor disposal preserves the last failed call before shutdown',async t=>{
  const s=setup(t,'engine',{isolated:true}),h=await s.open(s.options);
  const result=await h.refreshContextIndex({readSet:[personal],types:['memory'],intent:'current',mode:'lexical',budget:{maxItems:1,maxMs:1000}},s.token);
  const primary=reader.maintenanceFailureDiagnostic(result);assert.equal(primary.engineCode,'storage_busy');
  await s.config.supervisor.close();
  assert.equal(reader.maintenanceReaderFailureDiagnostic(h).lastFailure.engineCode,'storage_busy','supervisor disposal preserves the initiating engine code');
  assert.deepEqual(reader.maintenanceReaderFailureDiagnostic(h).lastFailure,primary);assert.equal(reader.maintenanceReaderFailureDiagnostic(h).failureCounts.engine,1);
});

for(const kind of ['exception','cleanup'])test(`M1 distinct residents retain independent ${kind} close failures without ordinals`,async t=>{
  let created=0,closes=0;
  const s=setup(t,'resident_'+kind,{isolated:true,fake:data=>{
    const worker=fakeWorker(data,{fileIdentity:(kind==='exception'?'101:':'201:')+ ++created}),send=worker.postMessage;
    worker.postMessage=message=>{
      if(message.method!=='close')return send(message);
      closes++;
      worker.emit('message',{kind:'maintenance-close-failure',maintenanceFailure:kind==='exception'?{kind,errorName:'TypeError',step:0}:{kind}});
      queueMicrotask(()=>worker.emit('exit',1));
    };return worker;
  }});
  const first=s.config.projections[0],second={...first,options:{...first.options,path:first.options.path+'-second'}},replacement={...first,options:{...first.options,diagnostics:true}};
  s.config.projections=[first,second,replacement];s.config.quantum={maxItems:1,maxMs:100};s.config.pollMs=100;s.config.budgets={maxItems:600,maxMs:60000};
  const p=s.renew(s.config);t.after(()=>p.close().catch(()=>{}));for(let i=0;i<5;i++)await s.step();
  const final=await p.completion,d=pump.maintenancePumpDiagnostic(final),lanes=pump.maintenancePumpPhaseDiagnostic(final).projections;
  assert.equal(created,2);assert.equal(closes,2,'two physical resident closes were attempted');assert.equal(final.error,'reader_failed');
  // A failed registry proof adds one independent cleanup secondary per reader.
  const perResident=kind==='cleanup'?2:1;
  assert.equal(d.failureCounts[kind]+d.secondaryFailureCounts[kind],2*perResident,'distinct resident failures are both counted without ordinal equality');
  for(const lane of [0,2]){
    assert.equal(lanes[lane].failureCounts[kind]+lanes[lane].secondaryFailureCounts[kind],perResident,'each rejected resident close remains on its owning lane');
    const failure=lanes[lane].lastFailure??lanes[lane].secondaryFailure;
    assert.equal(failure.stage,'close');assert.equal(Object.hasOwn(failure,'ordinal'),false);
  }
  assert.equal(lanes[4].failureCounts[kind]+lanes[4].secondaryFailureCounts[kind],0,'replacement lane inherits no resident failure');
});

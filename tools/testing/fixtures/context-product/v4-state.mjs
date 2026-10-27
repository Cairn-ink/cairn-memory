import { isDeepStrictEqual } from 'node:util';
import threads from 'node:worker_threads';
import { syncBuiltinESMExports } from 'node:module';
import { randomUUID } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import { configure, drain, timestamp, observeLoop, validateResponse, instrumentGc } from './engine.mjs';
import { startWriter, recordedWriter } from './controller.mjs';
import { stat } from 'node:fs/promises';
import { actor, terminate, fileChild, startSampler, attributeBlocks } from './actors.mjs';
import { V4, methodProfile } from './v4-plan.mjs';
import { validateSubprobes } from './v4-validation.mjs';
const storageUrl=new URL('./storage-child.mjs',import.meta.url);
const profile=path=>path==='opening'?methodProfile('c12'):path==='status'?{method:'getContextIndexStatus'}:methodProfile({candidates:'c12',fetch:'f24-full',assembly:'a1500'}[path]);
// The production runtime receives unchanged request controls. Only these explicitly
// labelled injection Workers load the native rendezvous. No ordinary reply is held.
function injectionWorker({gate,opening,crash}) {
  const Native=threads.Worker,workers=[];let operation,request,frame;
  const flags=new Int32Array(gate,0,8),times=new BigInt64Array(gate,32,2);
  if(opening)Atomics.store(flags,0,1);
  threads.Worker=class extends Native {
    constructor(url,options){super(url,{...options,workerData:{...options.workerData,productQualificationNativeGate:gate},execArgv:[...(options.execArgv??[]),'--import',new URL('./v4-native-preload.mjs',import.meta.url).href]});
      workers.push(this);operation=options.workerData.operation;request=options.workerData.request;frame=options.workerData.frame;
    }
    postMessage(message,...rest){if(message.operation){operation=message.operation;frame=message.frame;}return super.postMessage(message,...rest);}
    terminate(){
      // Retain injected native work until the ownership/writer-progress evidence
      // has been recorded. Actual termination and exit remain mandatory.
      if(!crash&&Atomics.load(flags,1)===1&&Atomics.load(flags,2)===0)return (async()=>{while(Atomics.load(flags,2)===0)await delay(1);return super.terminate();})();
      return super.terminate();
    }
  };syncBuiltinESMExports();
  return {workers,flags,times,arm(){Atomics.store(flags,0,1);},release(){Atomics.store(flags,2,1);Atomics.notify(flags,2);},
    evidence(){return {operation,request,frame};},close(){threads.Worker=Native;syncBuiltinESMExports();}};
}
export function postCatchupHasRef(result,row) {
  if(!row)return false;const items=result?.value?.items??result?.value?.diagnostics?.items??[];
  const namespace={ownerId:row.owner_id,scope:row.scope,projectId:row.project_id};
  return items.some(i=>i.ref?.type==='memory'&&i.ref.memoryId===row.id&&i.ref.revision===row.revision&&isDeepStrictEqual(i.ref.namespace,namespace));
}
export async function stateCell(cell,{prepare,prepareInput,build,sink,input},{configure:setup=configure,readValidate=validateResponse,writer:start=startWriter,startSampler:makeSampler=startSampler,instrumentGc:makeGc=instrumentGc,observeLoop:makeLoop=observeLoop,nativeFactory=injectionWorker,makeLock=(config)=>actor('lock',{path:config.path,protocol:'P2-product-v4',supervision:config.supervision,exclusive:true},{url:storageUrl,stallMs:config.supervision.stallMs})}={}) {
  const records=[];
  for(const probe of V4.stateSubprobes[cell.injection]) {
    const path=probe.path??probe.id,resetId=randomUUID(),method=profile(path),subcell={...cell,...method,intent:'current',language:'mixed'};
    let config=await prepare(subcell,resetId);
    if(cell.injection==='post-catch-up'){
      const initialIds=new Set(config.ledger.memory.map(m=>m.id));
      const writer=await recordedWriter(()=>start({...config,operationLimit:2,syntheticProbe:input.stateProbes[cell.key+':'+probe.id]}),(s,r)=>sink.record(cell.id,s,r),'catchup-writer');writer.start(Date.now(),Date.now()+config.seriesCeilingMs);
      try{while(writer.calls.length<2){writer.flush();if(writer.child.exitCode!==null||writer.calls.some(c=>c.code))break;await delay(1);}await writer.stop();}
      finally{await writer.stop();}
      config.ledger=await config.inspectLedger();
      const inserted=config.ledger.memory.filter(m=>!initialIds.has(m.id));
      config={...config,postCatchupIdentity:inserted.length===1?inserted[0]:null,injectionProbe:input.stateProbes[cell.key+':'+probe.id]};
    }
    if(cell.injection!=='absent')await build(config);
    const canonicalBefore=cell.injection==='absent'?fileChild('hash',config.path).value[0].hash:null;
    config=await prepareInput(config,{...subcell,injectionProbe:config.injectionProbe});
    const deadlineMs=input.stateDeadlines[path];
    config={...config,deadlines:{...config.deadlines,openMs:deadlineMs,requestMs:config.deadlines.requestMs},input:{...config.input,deadlineMs}};
    const gate=new SharedArrayBuffer(48),native=nativeFactory({gate,opening:path==='opening'&&['abort','crash'].includes(cell.injection),crash:cell.injection==='crash'});
    const abort=new AbortController();let c,h,result,code=null,cleanupId,settledAt,writer,writerResult,lock,lockResult,record,gc,sampler,loop,cleanupLoop,loopFinished=false,cleanupFinished=false;
    const loops=[];let offset;
    try {
      c=await setup(config);gc=makeGc();sampler=await makeSampler([process.pid]);loop=makeLoop();offset=timestamp()-Number(process.hrtime.bigint())/1e6;
      if(cell.injection==='exhaustion'&&path==='opening'){lock=makeLock(config);await lock.wait('ready');}
      const opening=c.open({signal:abort.signal});
      let pending;
      if(path==='opening')pending=opening;
      else {h=await opening;
        if(cell.injection==='exhaustion'){lock=makeLock(config);await lock.wait('ready');}
        if(['abort','crash'].includes(cell.injection))native.arm();
        pending=h[config.method](config.input,c.token,{signal:abort.signal});
      }
      // Observe rejection immediately, even while waiting for native entry.
      let settled=false;
      const publicResult=pending.then(r=>{result=r;code=r?.ok===false?r.error.code:null;settledAt=timestamp();settled=true;},e=>{code=e.code;cleanupId=e.cleanupId;settledAt=timestamp();settled=true;});
      let abortObservedAt=null;
      if(['abort','crash'].includes(cell.injection)){
        while(!Atomics.load(native.flags,1)&&!settled)await delay(1);
        if(Atomics.load(native.flags,1)){
          if(cell.injection==='crash')void native.workers.at(-1).terminate();
          else if(probe.trigger==='abort'){abortObservedAt=timestamp();abort.abort();}
        }
      }
      await publicResult;loops.push(await loop.finish());loopFinished=true;
      let disposalSettled=false;const disposal=(h?h.close():c.supervisor.close()).then(()=>{disposalSettled=true;});disposal.catch(()=>{});
      const evidence=native.evidence(),nativeEnteredAt=native.times[0]?Number(native.times[0])/1e6+offset:null;
      const cutoffAt=evidence.operation?Number(BigInt(evidence.operation.operationCutoffMonoNs))/1e6+offset:null;
      const pendingAtSettlement=Atomics.load(native.flags,1)===1&&Atomics.load(native.flags,2)===0&&native.times[1]===0n;
      let writerCommitWhileCleanupPending=false,writerDeadlineOverrun=false;
      if(cell.injection==='abort'&&pendingAtSettlement){
        writer=await recordedWriter(()=>start({...config,operationLimit:2}),async(s,r)=>sink.record(cell.id,s,r),'state-writer');
        writer.start(Date.now(),Date.now()+config.seriesCeilingMs);while(writer.calls.length<2){writer.flush();if(writer.child.exitCode!==null||writer.calls.some(c=>c.code))break;await delay(1);}writerResult=await writer.stop();writer=null;
        const commits=writerResult.diagnostics.records.filter(r=>r.kind==='native_end'&&r.commit&&r.phase==='write');
        writerCommitWhileCleanupPending=commits.some(r=>r.at>=settledAt)&&native.times[1]===0n;
        writerDeadlineOverrun=writerResult.calls.some(r=>r.deadlineMs!==null&&r.writeElapsedMs>r.deadlineMs);
      }
      const status=cleanupId?c.supervisor.getCleanupStatus(cleanupId):null;
      const supervised=!disposalSettled;cleanupLoop=makeLoop();native.release();await disposal;
      if(lock){lock.send({type:'release'});lockResult=await lock.wait('result');lockResult.exit=await lock.exited;await sink.record(cell.id,'locker-exit',lockResult);lock=null;}
      await h?.close();h=null;await c.supervisor.close();const diagnostics=await drain(c.supervisor);
      loops.push(await cleanupLoop.finish());cleanupFinished=true;if(lockResult?.hostLoop)loops.push(lockResult.hostLoop);
      const loopRecord={maxMs:Math.max(...loops.map(l=>l.maxMs)),over100:loops.reduce((n,l)=>n+l.over100,0),blocks:loops.flatMap(l=>l.blocks)};
      const checked=result?await readValidate(result,config):{bounds:true,validated:true};
      const absentUnchanged=cell.injection==='absent'&&canonicalBefore===fileChild('hash',config.path).value[0].hash&&
        (await Promise.all(['','-wal','-shm','-journal'].map(suffix=>stat(config.path+'.context-read-product-v1.1.sqlite'+suffix).then(()=>false,e=>{if(e.code==='ENOENT')return true;throw e;})))).every(Boolean);
      const nativeFailures=diagnostics.flatMap(r=>r.diagnostics.records??[]).filter(r=>[5,6].includes(r.sqlite?.code));
      const catchupExpected=cell.injection!=='post-catch-up'||path==='status'||postCatchupHasRef(result,config.postCatchupIdentity);
      record={id:probe.id,path,trigger:probe.trigger??null,resetId,code,noLateData:!result?.ok||code===null,
        expected:checked.bounds&&checked.validated&&catchupExpected&&(result?.ok===true?(config.oracle?await config.oracle(result,{...config,code}):true):code!==null),
        loop:loopRecord,cutoffAt,settledAt,nativeEnteredAt:nativeEnteredAt??(cell.injection==='exhaustion'&&nativeFailures.length?settledAt:null),abortObservedAt,nativePendingAtSettlement:pendingAtSettlement,
        writerCommitWhileCleanupPending,writerDeadlineOverrun,supervisedUntilDisposal:cell.injection!=='abort'||supervised&&(path!=='opening'||status?.state==='pending'),
        nativeDisposed:diagnostics.length>0&&diagnostics.every(r=>r.nativeDisposed===true&&r.workerStopped===true),ownershipDrained:true,
        actualExitConfirmed:diagnostics.length>0&&diagnostics.every(r=>r.workerStopped===true),workerExitConfirmed:diagnostics.length>0&&diagnostics.every(r=>r.workerStopped===true),
        cleanupId:cleanupId??null,handleEscaped:path==='opening'&&result!=null,nativePrimary:nativeFailures[0]?.sqlite.code??null,
        nativeProvenanceComplete:diagnostics.length>0&&diagnostics.every(r=>r.diagnostics.coverage==='complete'),
        state:result?.value?.lexical?.state,progress:result?.value?.lexical?.progress??null,counts:Object.values(result?.value?.coverage?.byType??{}).every(c=>c.eligible===null&&c.indexed===null)?null:result?.value?.coverage?.byType,
        explicitBuild:cell.injection==='post-catch-up',sidecarUnchanged:absentUnchanged,diagnostics,lockerExit:lockResult?.exit,writer:writerResult??null,
        writerCoverage:writerResult?.diagnostics.coverage,writerExit:writerResult?.exit,writerProfileComplete:writerResult?.calls.every(c=>c.deadlineMs!==null),
        normalZeroBusyPopulation:false};
      const attribution=await sampler.collect();attributeBlocks({hostLoop:record.loop},attribution);record.gc=gc.entries;
      const final=await config.inspectLedger();await sink.record(cell.id,'population',{subprobe:probe.id,resetId,initial:config.initialCounts,final:{memories:final.memories,cards:final.cardCount,schema:final.schema}});
      await sink.record(cell.id,'subprobe',record);records.push(record);
    }finally{
      native.release();gc?.close();native.close();
      try {if(writer)await writer.stop();}
      finally {try {
        if(lock){if(lock.connected)lock.send({type:'release'});const exit=await lock.exited;await sink.record(cell.id,'locker-exit',{exit});await terminate(lock);}
      }finally {try {try {await h?.close();}finally{await c?.supervisor.close();}}
        finally {try {
          if(c){const exported=await c.supervisor.drain();await sink.record(cell.id,'state-reader-final-drain',exported);for(const r of exported)if(r.state==='complete')c.supervisor.ackCleanup(r.cleanupId);}
        }finally {try {if(loop&&!loopFinished)await loop.finish();if(cleanupLoop&&!cleanupFinished)await cleanupLoop.finish();}
          finally {if(sampler)await sink.record(cell.id,'attribution',await sampler.stop());}}}
      }}
      if(!record)await sink.record(cell.id,'subprobe-incomplete',{id:probe.id,path,resetId});
    }
  }
  return {...validateSubprobes(cell,records),subprobes:records.length};
}

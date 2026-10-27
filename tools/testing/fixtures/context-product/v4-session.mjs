import { AsyncLocalStorage,createHook } from 'node:async_hooks';
import { isDeepStrictEqual } from 'node:util';
import { setTimeout as delay } from 'node:timers/promises';
import { actor,terminate,startSampler,attributeBlocks } from './actors.mjs';
import { startWriter,recordedWriter } from './controller.mjs';
import { startPump } from './series.mjs';
import { methodProfile,INTENTS } from './v4-plan.mjs';
import { validateSessionRegistration,validateSessionEvidence } from './v4-validation.mjs';
import { digest } from './report.mjs';
import { availability,freshness,aggregate,PROTOCOL } from './protocol.mjs';
import { observeLoop } from './engine.mjs';
import { normalDecision } from './v4-windows.mjs';
const serializable=config=>Object.fromEntries(Object.entries(config).filter(([k,v])=>!['signal','oracle','verifySidecarUnchanged','ledger','initialCounts','maintainerDiagnostics'].includes(k)&&typeof v!=='function'));
export function sessionPopulation(cell,records,targets) {
  if(cell.kind==='availability'){
    const population=records.filter(r=>r.intent===cell.intent),metric=availability(population);
    if(population.length<PROTOCOL.availabilityMinimum)metric.decision='inconclusive';return {availability:metric};
  }
  const population=targets.filter(t=>t.type===cell.type&&t.intent===cell.intent),metric=freshness(population);
  if(population.length<PROTOCOL.freshnessMinimum)metric.decision='inconclusive';return {freshness:metric};
}
export async function sharedSession(cells,session,{config,prepareInput,sink,validateProbe},{makeLane=c=>actor('lane',c,{quietWhenIdle:true,stallMs:c.supervision.stallMs}),makeWriter=startWriter,makePump=startPump,now=Date.now,wait=delay,loopFactory=observeLoop,makeSampler=startSampler}={}) {
  const prereg=validateSessionRegistration(session,config.cell.schema);if(prereg.decision!=='passed')throw Error('v4_session_registration');
  const lanes=[],records=[],targets=[],availabilityRecords=[],attempted=new Set(),lastProbe=new Map(),pending=[],extraLoops=[];
  // The sampler buffers in its child; no sample transfer occurs until finish().
  const sampler=await makeSampler([process.pid]);
  const parentLoop=loopFactory();let parentFinished=false,sessionError;
  // A harness call owns its async descendants, not unrelated engine timers or
  // callbacks which happen while it awaits. Bracket each synchronous continuation
  // rather than pausing for the lifetime of its Promise (which would hide engine
  // renewal/drain/shutdown). No engine operation is created inside this scope.
  const scope=new AsyncLocalStorage(),stack=[];let excluded=false;
  const setExcluded=value=>{if(excluded===value)return;excluded=value;if(value)parentLoop.pause();else parentLoop.resume();};
  const enter=value=>{stack.push(excluded);setExcluded(value);};
  // Enabling mid-callback can deliver its after hook without a matching before.
  const leave=()=>{if(stack.length)setExcluded(stack.pop());};
  const hook=createHook({before(){enter(scope.getStore()===true);},after:leave}).enable();
  const run=(outside,fn)=>{enter(outside);try{return scope.run(outside,fn);}finally{leave();}};
  const harness=fn=>run(true,fn),engine=fn=>run(false,fn);
  const finishParent=async()=>{
    if(parentFinished)return;
    const hostLoop=await engine(()=>parentLoop.finish());parentFinished=true;hook.disable();scope.disable();
    let attribution;
    try{attribution=await sampler.stop();}
    catch{attribution={coverage:'incomplete',samples:[],error:'parent_sampler_failed'};}
    const record={hostPid:process.pid,hostLoop};attributeBlocks(record,attribution.samples??[]);
    for(const block of hostLoop.blocks??[])if(attribution.supported===false||attribution.coverage!=='complete'||
      !block.scheduling?.threads?.some(t=>t.tid===process.pid)||!['pswpin','pswpout','pgmajfault'].every(k=>Number.isFinite(block.scheduling?.vm?.[k])))
      block.scheduling={...block.scheduling,coverage:'incomplete'};
    extraLoops.push(hostLoop);await sink.record(config.cell.id,'session-parent-loop',record);
    await sink.record(config.cell.id,'session-parent-attribution',attribution);
  };
  let observationEndAt;let writer,pump,writerResult,probeCadenceMissed=false,omittedReleases=false,drain;
  const write=(s,r)=>harness(()=>sink.record(config.cell.id,s,r));
  const ingest=()=>{
    writer.flush();
    for(const {target} of writer.child.take('target'))if(!targets.some(t=>t.type===target.type&&t.targetId===target.targetId&&t.intent===target.intent))targets.push({...target,observedAt:null});
  };
  const dispatch=async(lane,id,prepared,metadata)=>{
    if(lane.pending){if(metadata.kind==='availability')omittedReleases=true;else probeCadenceMissed=true;await write('schedule-omission',{id,...metadata});return;}
    lane.pending=true;const message={type:'read',id,config:serializable(prepared)};engine(()=>lane.send(message));
    const p=engine(()=>lane.wait(['read-result','lane-failure'])).then(m=>harness(async()=>{
      if(m.type==='lane-failure'||m.id!==id)throw Object.assign(Error('v4_lane_failed'),{code:m.code??'lane_failed',lane:lane.pid,id});
      const r={...m.value.record,...metadata};records.push(r);
      if(metadata.kind==='availability')availabilityRecords.push(r);
      else {
        const batch=targets.filter(t=>t.batch===metadata.batch&&t.intent===metadata.intent);
        for(const t of batch){
          const ref=m.value.result?.value?.items?.find(i=>i.ref.type===t.type&&(i.ref.memoryId??i.ref.cardId)===t.id&&i.ref.revision===t.revision&&isDeepStrictEqual(i.ref.namespace,t.namespace)&&(t.type!=='card'||i.ref.bodyRevision===t.bodyRevision));
          if(ref&&m.value.record.readFinishedAt<=observationEndAt&&m.value.record.expected&&m.value.record.ok&&m.value.record.validated&&m.value.record.bounds&&await validateProbe(m.value.result,{targets:batch,config:prepared})&&t.observedAt===null)t.observedAt=r.readFinishedAt;
        }
      }
      await write(metadata.kind,r);
    })).finally(()=>{lane.pending=false;});pending.push(p);
    // Retain the rejection for the session's final drain without unhandled work.
    p.catch(error=>{sessionError??=error;probeCadenceMissed=true;});
  };
  return await harness(async()=>{try {
    for(let n=0;n<21;n++){const lane=engine(()=>makeLane({protocol:'P2-product-v4',supervision:config.supervision,oracleModule:config.oracleModule}));lanes.push(lane);const ready=await engine(()=>lane.wait('ready'));if(ready.startupLoop){extraLoops.push(ready.startupLoop);await write('lane-startup',{pid:lane.pid,startupLoop:ready.startupLoop});}}
    // Writer control/ledger/statistics run here; its engine work is in the child.
    // The pump runs engine code here and excludes its own configuration/records.
    pump=await engine(()=>makePump(config,write,{harness}));writer=await recordedWriter(()=>makeWriter({...config,session},'fresh'),write,'session-writer');
    const startAt=now()+50,endAt=startAt+180000;observationEndAt=endAt;engine(()=>writer.start(startAt,endAt));await engine(()=>wait(Math.max(0,startAt-now())));
    while(now()<endAt&&!sessionError){
      ingest();const relative=now()-startAt;
      for(const scheduled of session.availability)if(relative>=scheduled.releaseMs&&!attempted.has(scheduled.id)){
        attempted.add(scheduled.id);
        const cell={...config.cell,kind:'availability',...methodProfile(scheduled.methodLabel),language:scheduled.language,intent:scheduled.intent};
        const prepared=await prepareInput({...config,cell,method:cell.method},cell);
        await dispatch(lanes[20],scheduled.id,prepared,{kind:'availability',scheduled:true,scheduledId:scheduled.id,releaseMs:scheduled.releaseMs,method:cell.method,methodLabel:cell.methodLabel,language:cell.language,intent:cell.intent});
      }
      for(const batch of session.batches)for(const [i,intent] of INTENTS.entries()){
        const active=targets.filter(t=>t.batch===batch.ordinal&&t.intent===intent&&t.observedAt===null);
        if(!active.length)continue;
        const key=batch.ordinal+':'+intent,last=lastProbe.get(key)??Math.min(...active.map(t=>t.committedAt));
        if(now()-last<session.probeEveryMs)continue;
        if(now()-last>1000)probeCadenceMissed=true;
        lastProbe.set(key,now());
        const cell={...config.cell,kind:'freshness',...methodProfile('c24'),language:'mixed',intent,probeBatch:batch,probeTargets:targets.filter(t=>t.batch===batch.ordinal&&t.intent===intent),allCommittedTargets:targets};
        const prepared=await prepareInput({...config,cell,method:cell.method},cell);
        if(prepared.input.query!==batch.query)throw Error('frozen_probe_query_changed');
        await dispatch(lanes[2*batch.ordinal+i],key+':'+now(),prepared,{kind:'probe',batch:batch.ordinal,intent});
      }
      await engine(()=>pump.flush());await engine(()=>wait(1));
    }
    writerResult=await writer.stop();ingest();writer=null;
    const settled=await Promise.allSettled(pending);
    for(const result of settled)if(result.status==='rejected'){sessionError??=result.reason;await write('lane-failure',{code:result.reason.code??result.reason.message,id:result.reason.id,lane:result.reason.lane});}
    drain=await engine(()=>pump.stop());pump=null;await write('pump-drain',drain);await write('freshness-targets',targets);
    for(const lane of lanes){engine(()=>lane.send({type:'stop'}));const r=await engine(()=>lane.wait('result')),exit=await lane.exited;await write('lane-exit',{pid:lane.pid,exit,attribution:r.attribution});if(exit.code!==0||exit.signal)probeCadenceMissed=true;}
    await finishParent();
    if(sessionError)throw sessionError;
    if(config.inspectLedger){const final=await config.inspectLedger();await write('population',{session:session.key,initial:config.initialCounts,final:{memories:final.memories,cards:final.cardCount,schema:final.schema}});}
    for(const t of targets){const probes=records.filter(r=>r.kind==='probe'&&r.batch===t.batch&&r.intent===t.intent&&r.startedAt>=t.committedAt).sort((a,b)=>a.startedAt-b.startedAt);let last=t.committedAt;
      for(const p of probes){if(t.observedAt!==null&&last>=t.observedAt)break;if(p.startedAt-last>1000)probeCadenceMissed=true;last=p.startedAt;}if((t.observedAt??endAt)-last>1000)probeCadenceMissed=true;}
    const evidence={startAt,durationMs:180000,writer:writerResult,writerEndAt:writerResult.writerEndAt,scheduleHash:digest(session),availability:availabilityRecords,targets,probeCadenceMissed,omittedReleases:omittedReleases||attempted.size!==session.availability.length};
    const validation=validateSessionEvidence(session,evidence);await write('session-validation',{...validation,scheduleHash:evidence.scheduleHash,startAt,endAt});
    const maintenance=[...(config.maintainerDiagnostics??[]),...drain.map(r=>r.diagnostics).filter(d=>d.protocol==='context-native-v1')];
    return new Map(cells.map(cell=>{
      const metric=sessionPopulation(cell,availabilityRecords,targets);
      const d=normalDecision(cell,records,{...metric,maintenance,maintainerCoverage:config.maintainerCoverage,
        writers:writerResult.calls,writerCoverage:writerResult.diagnostics.coverage,writerBusy:writerResult.diagnostics.busy,loops:[writerResult.hostLoop,...extraLoops]});
      const reported=metric.freshness?{freshness:{...metric.freshness,...Object.fromEntries(['p50Ms','p95Ms','maxMs'].flatMap(k=>[[k,Number.isFinite(metric.freshness[k])?metric.freshness[k]:null],[k+'Infinite',metric.freshness[k]===Infinity]]))}}:metric;
      return [cell.key,{...d,decision:aggregate([d.decision,validation.decision]),sessionKey:session.key,metrics:reported,sessionValidation:validation}];
    }));
  }finally{
    try{if(writer)await writer.stop();}finally{try{if(pump)await write('pump-drain',await engine(()=>pump.stop()));}finally{
      try{for(const lane of lanes)if(lane.connected){engine(()=>lane.send({type:'stop'}));await lane.exited;await engine(()=>terminate(lane));}}
      finally{await finishParent();}
    }}
  }
  });
}

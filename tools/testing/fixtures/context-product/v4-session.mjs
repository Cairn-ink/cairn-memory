import { isDeepStrictEqual } from 'node:util';
import { setTimeout as delay } from 'node:timers/promises';
import { actor,terminate } from './actors.mjs';
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
export async function sharedSession(cells,session,{config,prepareInput,sink,validateProbe},{makeLane=c=>actor('lane',c,{quietWhenIdle:true,stallMs:c.supervision.stallMs}),makeWriter=startWriter,makePump=startPump,now=Date.now,wait=delay,loopFactory=observeLoop}={}) {
  const prereg=validateSessionRegistration(session,config.cell.schema);if(prereg.decision!=='passed')throw Error('v4_session_registration');
  const lanes=[],records=[],targets=[],availabilityRecords=[],attempted=new Set(),lastProbe=new Map(),pending=[],extraLoops=[];
  const parentLoop=loopFactory();let parentFinished=false,sessionError;
  // Exclude synchronous harness work while preserving observation during awaits.
  const harness=fn=>{parentLoop.pause?.();try{return fn();}finally{parentLoop.resume?.();}};
  const prepare=(...args)=>harness(()=>prepareInput(...args));
  let observationEndAt;let writer,pump,writerResult,probeCadenceMissed=false,omittedReleases=false,drain;
  const write=(s,r)=>harness(()=>sink.record(config.cell.id,s,r));
  const ingest=()=>{
    writer.flush();
    for(const {target} of writer.child.take('target'))if(!targets.some(t=>t.type===target.type&&t.targetId===target.targetId&&t.intent===target.intent))targets.push({...target,observedAt:null});
  };
  const dispatch=async(lane,id,prepared,metadata)=>{
    if(lane.pending){if(metadata.kind==='availability')omittedReleases=true;else probeCadenceMissed=true;await write('schedule-omission',{id,...metadata});return;}
    lane.pending=true;harness(()=>lane.send({type:'read',id,config:serializable(prepared)}));
    const p=lane.wait(['read-result','lane-failure']).then(async m=>{
      if(m.type==='lane-failure'||m.id!==id)throw Object.assign(Error('v4_lane_failed'),{code:m.code??'lane_failed',lane:lane.pid,id});
      const r={...m.value.record,...metadata};records.push(r);
      if(metadata.kind==='availability')availabilityRecords.push(r);
      else {
        const batch=targets.filter(t=>t.batch===metadata.batch&&t.intent===metadata.intent);
        for(const t of batch){
          const ref=m.value.result?.value?.items?.find(i=>i.ref.type===t.type&&(i.ref.memoryId??i.ref.cardId)===t.id&&i.ref.revision===t.revision&&isDeepStrictEqual(i.ref.namespace,t.namespace)&&(t.type!=='card'||i.ref.bodyRevision===t.bodyRevision));
          if(ref&&m.value.record.readFinishedAt<=observationEndAt&&m.value.record.expected&&m.value.record.ok&&m.value.record.validated&&m.value.record.bounds&&await harness(()=>validateProbe(m.value.result,{targets:batch,config:prepared}))&&t.observedAt===null)t.observedAt=r.readFinishedAt;
        }
      }
      await write(metadata.kind,r);
    }).finally(()=>{lane.pending=false;});pending.push(p);
    // Retain the rejection for the session's final drain without unhandled work.
    p.catch(error=>{sessionError??=error;probeCadenceMissed=true;});
  };
  try {
    for(let n=0;n<21;n++){const lane=makeLane({protocol:'P2-product-v4',supervision:config.supervision,oracleModule:config.oracleModule});lanes.push(lane);const ready=await lane.wait('ready');if(ready.startupLoop){extraLoops.push(ready.startupLoop);await write('lane-startup',{pid:lane.pid,startupLoop:ready.startupLoop});}}
    pump=await makePump(config,write);writer=await recordedWriter(()=>makeWriter({...config,session},'fresh'),write,'session-writer');
    const startAt=now()+50,endAt=startAt+180000;observationEndAt=endAt;writer.start(startAt,endAt);await wait(Math.max(0,startAt-now()));
    while(now()<endAt&&!sessionError){
      ingest();const relative=now()-startAt;
      for(const scheduled of session.availability)if(relative>=scheduled.releaseMs&&!attempted.has(scheduled.id)){
        attempted.add(scheduled.id);
        const cell={...config.cell,kind:'availability',...methodProfile(scheduled.methodLabel),language:scheduled.language,intent:scheduled.intent};
        const prepared=await prepare({...config,cell,method:cell.method},cell);
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
        const prepared=await prepare({...config,cell,method:cell.method},cell);
        if(prepared.input.query!==batch.query)throw Error('frozen_probe_query_changed');
        await dispatch(lanes[2*batch.ordinal+i],key+':'+now(),prepared,{kind:'probe',batch:batch.ordinal,intent});
      }
      await pump.flush();await wait(1);
    }
    writerResult=await writer.stop();ingest();writer=null;
    const settled=await Promise.allSettled(pending);
    for(const result of settled)if(result.status==='rejected'){sessionError??=result.reason;await write('lane-failure',{code:result.reason.code??result.reason.message,id:result.reason.id,lane:result.reason.lane});}
    drain=await pump.stop();pump=null;await write('pump-drain',drain);await write('freshness-targets',targets);
    for(const lane of lanes){lane.send({type:'stop'});const r=await lane.wait('result'),exit=await lane.exited;await write('lane-exit',{pid:lane.pid,exit,attribution:r.attribution});if(exit.code!==0||exit.signal)probeCadenceMissed=true;}
    extraLoops.push(await parentLoop.finish());parentFinished=true;await write('session-parent-loop',{hostLoop:extraLoops.at(-1)});
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
    try{if(writer)await writer.stop();}finally{try{if(pump)await write('pump-drain',await pump.stop());}finally{
      try{for(const lane of lanes)if(lane.connected){lane.send({type:'stop'});await lane.exited;await terminate(lane);}}
      finally{if(!parentFinished)await write('session-parent-loop',{hostLoop:await parentLoop.finish()});}
    }}
  }
}

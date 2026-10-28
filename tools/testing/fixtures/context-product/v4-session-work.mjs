import { rehearsalDecision,rehearsalSession } from './rehearsal-checks.mjs';
import { isDeepStrictEqual } from 'node:util';
import { setTimeout as delay } from 'node:timers/promises';
import { actor } from './actors.mjs';
import { startWriter,recordedWriter } from './controller.mjs';
import { methodProfile,INTENTS } from './v4-plan.mjs';
import { validateSessionRegistration,validateSessionEvidence } from './v4-validation.mjs';
import { digest } from './report.mjs';
import { availability,freshness,aggregate,PROTOCOL } from './protocol.mjs';
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
// Runs only in the session child. Parent observation never executes these callbacks.
export async function sessionWork(cells,session,{config,prepareInput,sink,validateProbe},{makeLane=c=>actor('lane',c,{quietWhenIdle:true,stallMs:c.supervision.stallMs}),makeWriter=startWriter,now=Date.now,wait=delay,ready=async()=>{},start=async()=>{},stopped=()=>null}={}) {
  const prereg=config.rehearsal===true?{decision:'passed'}:validateSessionRegistration(session,config.cell.schema);if(prereg.decision!=='passed')throw Error('v4_session_registration');
  const recordedExits=new Set(),lanes=[],records=[],targets=[],availabilityRecords=[],attempted=new Set(),lastProbe=new Map(),pending=[],extraLoops=[];
  let sessionError;
  let observationEndAt;let writer,writerResult,probeCadenceMissed=false,omittedReleases=false;
  const write=(s,r)=>sink.record(config.cell.id,s,r);
  const recordExit=async(lane,exit,extra={})=>{if(recordedExits.has(lane))return;await write('lane-exit',{pid:lane.pid,exit,...extra});recordedExits.add(lane);};
  const ingest=()=>{
    writer.flush();
    for(const {target} of writer.child.take('target'))if(!targets.some(t=>t.type===target.type&&t.targetId===target.targetId&&t.intent===target.intent))targets.push({...target,observedAt:null});
  };
  const dispatch=async(lane,id,prepared,metadata)=>{
    if(stopped())return;
    if(lane.pending){if(metadata.kind==='availability')omittedReleases=true;else probeCadenceMissed=true;await write('schedule-omission',{id,...metadata});return;}
    lane.pending=true;const message={type:'read',id,config:serializable(prepared)};lane.send(message);
    const p=lane.wait(['read-result','lane-failure']).then(async m=>{
      if(m.type==='lane-failure'||m.id!==id)throw Object.assign(Error('v4_lane_failed'),{code:m.code??'lane_failed',lane:lane.pid,id});
      const populationIdentities=sessionPopulations(cells,metadata,targets,config.rehearsal===true);
      const r={...m.value.record,...metadata,populationIdentities};records.push(r);
      if(metadata.kind==='availability')availabilityRecords.push(r);
      else {
        const batch=targets.filter(t=>t.batch===metadata.batch&&t.intent===metadata.intent);
        for(const t of batch){
          const ref=m.value.result?.value?.items?.find(i=>i.ref.type===t.type&&(i.ref.memoryId??i.ref.cardId)===t.id&&i.ref.revision===t.revision&&isDeepStrictEqual(i.ref.namespace,t.namespace)&&(t.type!=='card'||i.ref.bodyRevision===t.bodyRevision));
          if(ref&&m.value.record.readFinishedAt<=observationEndAt&&m.value.record.expected&&m.value.record.ok&&m.value.record.validated&&m.value.record.bounds&&await validateProbe(m.value.result,{targets:batch,config:prepared})&&t.observedAt===null)t.observedAt=r.readFinishedAt;
        }
      }
      await sink.record(populationIdentities.length===1?populationIdentities[0].cell:config.cell.id,metadata.kind,r);
    }).finally(()=>{lane.pending=false;});pending.push(p);
    // Retain the rejection for the session's final drain without unhandled work.
    p.catch(error=>{sessionError??=error;probeCadenceMissed=true;});
  };
  try {
    for(let n=0;n<(config.rehearsal===true?3:21);n++){if(stopped())throw Error(stopped());const lane=makeLane({protocol:'P2-product-v4',supervision:config.supervision,oracleModule:config.oracleModule});lanes.push(lane);const ready=await lane.wait('ready');if(ready.startupLoop){extraLoops.push(ready.startupLoop);await write('lane-startup',{pid:lane.pid,startupLoop:ready.startupLoop});}}
    if(stopped())throw Error(stopped());
    writer=await recordedWriter(()=>makeWriter({...config,session},'fresh'),write,'session-writer');
    await ready();await start();
    const startAt=now()+50,endAt=startAt+(config.rehearsal===true?6000:180000);observationEndAt=endAt;writer.start(startAt,endAt);await wait(Math.max(0,startAt-now()));
    while(now()<endAt&&!sessionError&&!stopped()){
      ingest();const relative=now()-startAt;
      for(const scheduled of session.availability)if(!stopped()&&relative>=scheduled.releaseMs&&!attempted.has(scheduled.id)){
        attempted.add(scheduled.id);
        const cell={...config.cell,kind:'availability',...methodProfile(scheduled.methodLabel),language:scheduled.language,intent:scheduled.intent};
        const prepared=await prepareInput({...config,cell,method:cell.method},cell);
        await dispatch(lanes[config.rehearsal===true?2:20],scheduled.id,prepared,{kind:'availability',scheduled:true,scheduledId:scheduled.id,releaseMs:scheduled.releaseMs,method:cell.method,methodLabel:cell.methodLabel,language:cell.language,intent:cell.intent});
      }
      for(const batch of session.batches)for(const [i,intent] of INTENTS.entries()){
        const active=targets.filter(t=>t.batch===batch.ordinal&&t.intent===intent&&t.observedAt===null);
        if(stopped()||!active.length)continue;
        const key=batch.ordinal+':'+intent,last=lastProbe.get(key)??Math.min(...active.map(t=>t.committedAt));
        if(now()-last<session.probeEveryMs)continue;
        if(now()-last>1000)probeCadenceMissed=true;
        lastProbe.set(key,now());
        const cell={...config.cell,kind:'freshness',...methodProfile('c24'),language:'mixed',intent,probeBatch:batch,probeTargets:targets.filter(t=>t.batch===batch.ordinal&&t.intent===intent),allCommittedTargets:targets};
        const prepared=await prepareInput({...config,cell,method:cell.method},cell);
        if(prepared.input.query!==batch.query)throw Error('frozen_probe_query_changed');
        await dispatch(lanes[2*batch.ordinal+i],key+':'+now(),prepared,{kind:'probe',batch:batch.ordinal,intent});
      }
      await wait(1);
    }
    writerResult=await writer.stop();ingest();writer=null;
    if(writerResult.exit&&(writerResult.exit.code!==0||writerResult.exit.signal))throw Object.assign(Error('writer_exit_failed'),{code:'writer_exit_failed',exit:writerResult.exit});
    const settled=await Promise.allSettled(pending);
    for(const result of settled)if(result.status==='rejected'){sessionError??=result.reason;await write('lane-failure',{code:result.reason.code??result.reason.message,id:result.reason.id,lane:result.reason.lane});}
    await write('freshness-targets',targets);
    for(const lane of lanes){if(lane.stalled){const exit=await lane.exited;await recordExit(lane,exit);sessionError??=Object.assign(Error('lane_exit_failed'),{code:'lane_exit_failed',exit});continue;}lane.send({type:'stop'});const r=await lane.wait('result'),exit=await lane.exited;await recordExit(lane,exit,{attribution:r.attribution});if(exit.code!==0||exit.signal)sessionError??=Object.assign(Error('lane_exit_failed'),{code:'lane_exit_failed',exit});}
    if(sessionError)throw sessionError;
    if(stopped())throw Error(stopped());
    for(const t of targets){const probes=records.filter(r=>r.kind==='probe'&&r.batch===t.batch&&r.intent===t.intent&&r.startedAt>=t.committedAt).sort((a,b)=>a.startedAt-b.startedAt);let last=t.committedAt;
      for(const p of probes){if(t.observedAt!==null&&last>=t.observedAt)break;if(p.startedAt-last>1000)probeCadenceMissed=true;last=p.startedAt;}if((t.observedAt??endAt)-last>1000)probeCadenceMissed=true;}
    const evidence={startAt,durationMs:180000,writer:writerResult,writerEndAt:writerResult.writerEndAt,scheduleHash:digest(session),availability:availabilityRecords,targets,probeCadenceMissed,omittedReleases:omittedReleases||attempted.size!==session.availability.length};
    const validation=config.rehearsal===true?rehearsalSession(session,{records,targets,availabilityRecords,writerResult,omittedReleases:evidence.omittedReleases}):validateSessionEvidence(session,evidence);if(config.rehearsal!==true&&records.some(r=>r.populationIdentities.some(p=>String(p.cell).startsWith('unregistered:')))){validation.decision='failed';validation.failures=[...(validation.failures??[]),'session_population_missing'];}await write('session-validation',{...validation,scheduleHash:evidence.scheduleHash,startAt,endAt});
    return {records,targets,availabilityRecords,writerResult,extraLoops,validation};
  }finally{
    try{
      if(writer)await writer.stop();
      await Promise.allSettled(pending);
    }finally{
      let exitFailure;for(const lane of lanes){if(lane.connected)lane.send({type:'stop'});const exit=await lane.exited;await recordExit(lane,exit);if(exit.code!==0||exit.signal)exitFailure??=Object.assign(Error('lane_exit_failed'),{code:'lane_exit_failed',exit});}if(exitFailure)throw exitFailure;
    }
  }
}
export function sessionDecision(cells,session,config,{records,targets,availabilityRecords,writerResult,extraLoops,validation},parentLoop,drain) {
  if(config.rehearsal===true)return new Map(cells.map(c=>[c.key,validation]));
  extraLoops=[...extraLoops,parentLoop];
  const maintenance=[...(config.maintainerDiagnostics??[]),...drain.map(r=>r.diagnostics).filter(d=>d.protocol==='context-native-v1')];
  return new Map(cells.map(cell=>{
      const metric=sessionPopulation(cell,availabilityRecords,targets);
      const d=normalDecision(cell,records,{...metric,maintenance,maintainerCoverage:config.maintainerCoverage,
        writers:writerResult.calls,writerCoverage:writerResult.diagnostics.coverage,writerBusy:writerResult.diagnostics.busy,loops:[writerResult.hostLoop,...extraLoops]});
      const reported=metric.freshness?{freshness:{...metric.freshness,...Object.fromEntries(['p50Ms','p95Ms','maxMs'].flatMap(k=>[[k,Number.isFinite(metric.freshness[k])?metric.freshness[k]:null],[k+'Infinite',metric.freshness[k]===Infinity]]))}}:metric;
      return [cell.key,{...d,decision:aggregate([d.decision,validation.decision]),sessionKey:session.key,metrics:reported,sessionValidation:validation}];
    }));
}

export function sessionPopulations(cells,metadata,targets,rehearsal=false) {
  const kind=metadata.kind==='availability'?'availability':'freshness';
  const types=kind==='freshness'?[...new Set(targets.filter(t=>t.batch===metadata.batch&&t.intent===metadata.intent).map(t=>t.type))]:[null];
  return types.map(type=>{
    const cell=cells.find(c=>c.kind===kind&&c.intent===metadata.intent&&(type===null||c.type===type));
    return {cell:cell?.id??[rehearsal?'rehearsal':'unregistered',kind,type,metadata.intent].join(':'),method:metadata.method??'findCandidates',intent:metadata.intent,...(type?{type}:{})};
  });
}

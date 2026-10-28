import { rehearsalDecision,readWorks,writerWorks } from './rehearsal-checks.mjs';
import { setTimeout as delay } from 'node:timers/promises';
import { attempt } from './engine.mjs';
import { startSampler,attributeBlocks } from './actors.mjs';
import { startWriter,recordedWriter } from './controller.mjs';
import { startPump } from './series.mjs';
import { population,decide,aggregate,readerLoops,maintainerCoverage,qualifies } from './protocol.mjs';
import { V4,windowSlot,rotatingCell } from './v4-plan.mjs';
import { validateExposure,validateWM,rotationCoverage,normalizeV4Decision } from './v4-validation.mjs';
export function normalDecision(cell,records,{maintenance=[],writers=[],writerCoverage='complete',baselineCoverage='complete',loops=[],maintainerCoverage:maintenanceFallback='incomplete',...extra}={}) {
  const d=decide(cell,{records,loops:[...readerLoops(records),...loops],readerCoverage:records.length&&records.every(r=>r.telemetry==='complete')?'complete':'incomplete',
    maintainerCoverage:maintainerCoverage(maintenance,maintenanceFallback),writerCoverage,baselineCoverage,
    nativeBusy:records.reduce((n,r)=>n+(r.nativeBusy??0),0)+maintenance.reduce((n,d)=>n+(d.busy??0),0)+(extra.writerBusy??0),
    publicBusy:records.reduce((n,r)=>n+(r.publicBusy??0),0)+writers.filter(w=>w.code==='storage_busy').length,writers:writers.length?writers:undefined,...extra});
  // V4 retains observed failures even when another required coverage is invalid.
  return normalizeV4Decision(d,[...readerLoops(records),...loops]);
}
export async function windowReferences(config,cell,writerStoppedAt,pump,prepare,sink,{read=attempt,now=Date.now}={}) {
  const states=cell.references.map(c=>({...c,records:[]})),records=[];
  let active=[...states];
  while(active.length){const next=[];
    for(const state of active){
      const {records:ownRecords,...population}=state;const slot=rotatingCell({...cell,...population},ownRecords.length),prepared=await prepare({...config,cell:slot},slot);
      const {record}=await read(prepared,{initialize:true,oracle:prepared.oracle});
      Object.assign(record,{methodLabel:slot.methodLabel,intent:slot.intent,language:slot.language,series:'WM'});state.records.push(record);records.push(record);
      await pump.flush();await sink.record(cell.id,'WM',record);
      if(state.records.length<(config.rehearsal===true?1:500)&&state.records.filter(r=>qualifies(r)).length<(config.rehearsal===true?1:50))next.push(state);
    }active=next;
  }
  return {states,records,writerStoppedAt,referenceFinishedAt:now(),pumpId:config.pump.id,finalWindowPumpId:config.pump.id,readinessWait:false,pumpReplaced:false};
}
export async function exposureCell(cell,{prepareClone,prepareInput,sink},{read=attempt,makeWriter=startWriter,makePump=startPump,makeSampler=startSampler,now=Date.now,wait=delay}={}) {
  const windows=[],decisions=[];let wm;
  for(let repetition=0;repetition<cell.windows;repetition++) {
    const pair={},order=repetition%2?['reader','baseline']:['baseline','reader'];
    for(const variant of order){
      const config=await prepareClone(`${repetition}-${variant}`),write=(s,r)=>sink.record(cell.id,s,s==='window-writer'?{...r,repetition,variant}:r);
      let writer,pump,sampler,result;
      const attempts=[];
      try{
        writer=await recordedWriter(()=>makeWriter(config,cell.load==='retained-target-rotation'?'retained':'fresh'),write,'window-writer');
        sampler=await makeSampler([process.pid,writer.child.pid]);if(variant==='reader')pump=await makePump(config,write);
        const startAt=now()+50,endAt=startAt+(config.rehearsal===true?5000:30000);await write('window-boundary',{repetition,variant,startAt,endAt});writer.start(startAt,endAt);await wait(Math.max(0,startAt-now()));
        while(now()<endAt){
          if(variant==='baseline'){await wait(20);writer.flush();continue;}
          const slot=windowSlot(cell,repetition,attempts.length),prepared=await prepareInput({...config,cell:slot,method:slot.method},slot);
          // Preparation can consume the remaining window. It never authorizes a
          // call admitted after endAt. An in-flight ordinary call is always awaited.
          if(now()>=endAt)break;
          const {record}=await read(prepared,{oracle:prepared.oracle});Object.assign(record,{slot:attempts.length,series:'window',methodLabel:slot.methodLabel,language:slot.language,intent:slot.intent});
          attributeBlocks(record,await sampler.collect());attempts.push(record);writer.flush();await pump.flush();await write('window',{repetition,...record});
        }
        result=await writer.stop();writer=null;
        let references;
        if(variant==='reader'&&repetition===cell.windows-1)references=await windowReferences(config,cell,now(),pump,prepareInput,sink,{read,now});
        const pumpDrain=pump?await pump.stop():[],pumpStoppedAt=now(),trace=pump?.trace??[];pump=null;await write('pump-drain',pumpDrain);
        const maintenance=[...(config.maintainerDiagnostics??[]),...pumpDrain.map(r=>r.diagnostics).filter(d=>d.protocol==='context-native-v1')];
        if(config.inspectLedger){const final=await config.inspectLedger();await write('population',{repetition,variant,initial:config.initialCounts,final:{memories:final.memories,cards:final.cardCount,schema:final.schema}});}
        pair[variant]={startAt,endAt,writer:result,attempts,maintenance,maintainerCoverage:config.maintainerCoverage,config};
        if(references){
          const evidence={...references,pumpStoppedAt,trace,telemetry:maintainerCoverage(maintenance,config.maintainerCoverage)};
          const validation=config.rehearsal===true?rehearsalDecision(references.records.length===cell.references.length&&references.records.every(r=>readWorks(r,true))?[]:['WM_functional']):validateWM(cell,evidence);
          if(config.rehearsal===true){wm={validation};await write('WM-functional',validation);}else {
          const populations=references.states.map(s=>({key:s.methodLabel+':'+s.intent,sample:population(s.records,{warmReference:true})}));
          const ds=references.states.map(s=>normalDecision({...cell,method:'findCandidates'},s.records,{maintenance,maintainerCoverage:config.maintainerCoverage,
            writers:result.calls,writerCoverage:result.diagnostics.coverage,writerBusy:result.diagnostics.busy,loops:[result.hostLoop],
            populations:{'warm-reference':population(s.records,{warmReference:true})}}));
          wm={validation,populations,decision:aggregate([validation.decision,...ds.map(d=>d.decision),...references.states.map(s=>rotationCoverage(s.records)?'passed':'inconclusive')])};
          await write('WM-evidence',{...evidence,records:undefined,states:undefined,validation,decisions:ds});
          }
        }
      }finally{try{if(writer)await writer.stop();}finally{try{if(pump)await write('pump-drain',await pump.stop());}finally{if(sampler)await write('attribution',await sampler.stop());}}}
    }
    const r=pair.reader,b=pair.baseline;
    const d=r.config.rehearsal===true?rehearsalDecision():normalDecision(cell,r.attempts,{maintenance:[...r.maintenance,...b.maintenance],writers:[...r.writer.calls,...b.writer.calls],
      writerCoverage:r.writer.diagnostics.coverage,baselineCoverage:b.writer.diagnostics.coverage,writerBusy:r.writer.diagnostics.busy+b.writer.diagnostics.busy,
      loops:[r.writer.hostLoop,b.writer.hostLoop],maintainerCoverage:[r,b].every(w=>w.maintainerCoverage==='complete')?'complete':'incomplete'});
    decisions.push(d);windows.push({repetition,...r,baseline:b});await sink.record(cell.id,'pair',{repetition,order,decision:d});
  }
  if(windows[0]?.config.rehearsal===true){const errors=[];for(const w of windows){if(!writerWorks(w.writer)||!writerWorks(w.baseline.writer))errors.push('writer');if(new Set(w.attempts.map(r=>r.methodLabel)).size!==10||w.attempts.some(r=>!readWorks(r,true)))errors.push('window_read');}if(wm?.validation.functionalPassed!==true)errors.push('WM');await sink.record(cell.id,'exposure-functional',{windows:windows.length,WM:wm?.validation});return rehearsalDecision(errors);}
  const exposure=validateExposure(cell,windows);
  await sink.record(cell.id,'exposure-final',exposure);
  return {decision:aggregate([exposure.decision,...decisions.map(d=>d.decision),wm?.decision??'invalid']),exposure,windows:decisions,wm};
}

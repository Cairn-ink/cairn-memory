import { rehearsalDecision,readWorks,writerWorks } from './rehearsal-checks.mjs';
import { performance } from 'node:perf_hooks';
import { setTimeout as delay } from 'node:timers/promises';
import { exposureMetrics, PROTOCOL as E1 } from '../../measure-topic-reader-wal.mjs';
import { attempt, configure, drain } from './engine.mjs';
import { coldAttempt, startSampler, attributeBlocks } from './actors.mjs';
import { startWriter, recordedWriter } from './controller.mjs';
import { rotationCoverage,normalizeV4Decision } from './v4-validation.mjs';
import { rotatingCell } from './v4-plan.mjs';
import { PROTOCOL, qualifies, population, exposure, decide, aggregate, maintainerCoverage, readerLoops } from './protocol.mjs';
export function windows(smoke=false) {
  // Reuse E1-C2's frozen duration/repetition/order rather than importing its
  // topic-specific write workload or claiming its surfaced failures are native coverage.
  return Array.from({length:smoke?1:E1.repetitions},(_,repetition)=>({repetition,
    windowMs:smoke?E1.smokeWindowMs:E1.windowMs,order:repetition%2?['reader','baseline']:['baseline','reader']}));
}
const overlap=(r,calls)=>calls.some(w=>r.readStartedAt<w.writeFinishedAt&&r.readFinishedAt>w.writeStartedAt);
export async function build(config,write=async()=>{}) {
  const c=await configure(config,true);let h;const calls=[];
  try {
    h=await c.open({signal:config.signal});
    for(const intent of ['current','history']) {
      let complete=false;
      for(let quantum=0;quantum<config.buildCeiling;quantum++){
        const started=performance.now(),r=await h.refreshContextIndex({readSet:config.readSet,types:config.types,intent,mode:'lexical',budget:config.pump.quantum},c.token,{signal:config.signal});
        calls.push({intent,quantum,elapsedMs:performance.now()-started,status:r.ok?r.value.status:r.error.code});
        await write('maintenance',calls.at(-1));
        if(!r.ok)throw Object.assign(Error('build_failed'),{code:r.error.code});
        if(r.value.status==='complete'){complete=true;break;}
        if(!['partial','rebuilding'].includes(r.value.status))throw Error('unknown_build_status');
      }
      if(!complete)throw Error('build_ceiling');
    }
  }finally{await h?.close();await c.supervisor.close();var diagnostics=await drain(c.supervisor);}
  return {calls,coverage:diagnostics.length&&diagnostics.every(r=>r.diagnostics.coverage==='complete')?'complete':'incomplete',diagnostics};
}
export async function startPump(config,write,{harness=fn=>fn()}={}) {
  const {renewContextMaintenancePump}=await import('../../../../core/index.mjs');
  const c=await harness(()=>configure(config,true));let pump,renewal,renewFailure,tick=0,draining=null,lastDrain=performance.now(),drainIncomplete=false;
  const recordCompletion=r=>{observations.push({tick:tick++,...r});if(r.state==='failed')renewFailure??=Object.assign(Error(r.error??'maintenance_pump_failed'),{code:r.error??'maintenance_pump_failed'});};
  const exported=[],pending=[],observations=[],trace=harness(()=>[{kind:'start',at:Date.now(),id:config.pump.id,settings:config.pump}]);
  // Engine calls stay in the caller's observed scope; only harness preparation
  // and diagnostic record construction cross this optional boundary.
  const traceEvent=(kind,extra={})=>{const at=harness(()=>Date.now()),status=pump.getStatus();harness(()=>trace.push({kind,at,...extra,status}));};
  const exportNow=()=>draining??=(async()=>{
    if(performance.now()-lastDrain>500)drainIncomplete=true;
    const records=await c.supervisor.drain();
    for(const record of records){harness(()=>{exported.push(record);pending.push(record);});c.supervisor.ackCleanup(record.cleanupId);}
    lastDrain=performance.now();
  })().catch(()=>{drainIncomplete=true;}).finally(()=>{draining=null;});
  const windowBase=Number(process.hrtime.bigint()/1000000n);
  const renew=()=>{
    const now=Number(process.hrtime.bigint()/1000000n),windowId=Math.floor((now-windowBase)/60000),endsAtMonoMs=windowBase+(windowId+1)*60000;
    const previous=pump;pump=renewContextMaintenancePump({supervisor:c.supervisor,id:config.pump.id,window:{id:String(windowId),endsAtMonoMs,usedItems:0,usedMs:0},
      budgets:config.pump.budgets,quantum:config.pump.quantum,pollMs:config.pump.pollMs,renewalMs:config.pump.renewalMs,
      projections:[{options:c.options,types:config.types}],serviceCredential:c.token});
    if(config.protocol==='P2-product-v4')traceEvent('renew',{replaced:previous!==undefined&&pump!==previous});
    // Every completion is observed, including expiry/exhaustion/failure. No
    // detached background task promises supervision after the caller returns.
    pump.completion.then(r=>harness(()=>recordCompletion(r))).catch(error=>{drainIncomplete=true;harness(()=>recordCompletion({state:'failed',error:error.code??error.message}));});
  };
  try{renew();}catch(error){await c.supervisor.close();await drain(c.supervisor);throw error;}
  renewal=setInterval(()=>{try{renew();}catch(error){renewFailure??=error;}},config.pump.cronMs);
  // Only public engine drain/ack and minimal queueing run on this timer. Record
  // validation and serialization are deferred until between reader observations.
  const drainTimer=setInterval(()=>{void exportNow();},PROTOCOL.pumpDrainMs);
  const flush=async()=>{if(config.protocol==='P2-product-v4')traceEvent('quantum');await exportNow();if(pending.length)await harness(()=>write('maintenance-drain',pending.splice(0)));for(const observation of observations.splice(0))await harness(()=>write('pump',observation));};
  return {flush,trace,async stop(){if(config.protocol==='P2-product-v4')traceEvent('stopping');clearInterval(renewal);clearInterval(drainTimer);await draining;let closeError;try{try{await pump.close();}catch(error){closeError=error;}const finalStatus=pump.getStatus?.();if(finalStatus)harness(()=>recordCompletion({...finalStatus,final:true}));else if(config.protocol==='P2-product-v4')throw Error('pump_final_status_missing');}finally{try{await c.supervisor.close();}finally{await flush();}}if(closeError)throw closeError;if(config.protocol==='P2-product-v4')traceEvent('stop');
    if(drainIncomplete)harness(()=>exported.push({diagnostics:{protocol:'context-native-v1',coverage:'incomplete',busy:0,records:[]}}));if(renewFailure)throw renewFailure;return exported;}};
}
export async function requestSeries(config,{cell,sink,oracle,smoke=false},{attempt:readAttempt=attempt,coldAttempt:readCold=coldAttempt,startPump:makePump=startPump,startWriter:makeWriter=startWriter,startSampler:makeSampler=startSampler,prepareAttempt=async c=>c}={}) {
  const records={warmups:[],main:[],cold:[]},decisions=[];let writer,writerResult,pump,sampler;
  const seriesEnd=Date.now()+config.seriesCeilingMs;
  const concurrency=cell.load!=='idle',life=cell.load.startsWith('retained')?'retained':'fresh';
  const write=async(series,record)=>sink.record(cell.id,series,record);
  try {
    if(concurrency){pump=await makePump(config,write);writer=await recordedWriter(()=>makeWriter(config,life),write);writer.start(Date.now(),Date.now()+config.seriesCeilingMs);}
    sampler=await makeSampler([process.pid,...(writer?[writer.child.pid]:[])]);
    const sample=async(series,cold=false)=>{
      const slot=cell.protocol==='P2-product-v4'?rotatingCell(cell,records[series].length):cell;
      const prepared=await prepareAttempt({...config,cell:slot},slot);
      const value=cold?await readCold(prepared,{signal:config.signal}):await readAttempt(prepared,{oracle,signal:config.signal});
      if(cell.protocol==='P2-product-v4')Object.assign(value.record,{language:slot.language,intent:slot.intent,methodLabel:slot.methodLabel});
      writer?.flush();await pump?.flush();value.record.overlap=!concurrency||overlap(value.record,writer?.calls??[]);records[series].push(value.record);
      if(writer)for(const list of Object.values(records))for(const r of list)r.overlap=overlap(r,writer.calls);if(!cold)attributeBlocks(value.record,await sampler.collect());else await sampler.collect();await write(series,value.record);return value.record;
    };
    const rules=cell.sampleRules??{warmups:{minimum:3},main:{minimum:50,ceiling:500},cold:{minimum:10,ceiling:100},'warm-reference':{minimum:50,ceiling:500}};
    for(let i=0;i<rules.warmups.minimum;i++)await sample('warmups');
    // Live overlap cannot be certified until writer intervals have arrived. Keep
    // every attempt and collect to a fixed ceiling if necessary; never select speed.
    const collect=async(series,cold,target,ceiling)=>{
      while(records[series].filter(r=>qualifies(r,concurrency)).length<target&&records[series].length<ceiling&&Date.now()<seriesEnd&&!config.signal?.aborted)await sample(series,cold);
    };
    await collect('main',false,smoke?1:rules.main.minimum,smoke?3:rules.main.ceiling);
    if(!cell.series||cell.series.includes('cold'))await collect('cold',true,smoke?1:rules.cold.minimum,smoke?3:rules.cold.ceiling);else delete records.cold;
    if(writer){writerResult=await writer.stop();writer=null;}
    for(const [series,list] of Object.entries(records))for(const [index,r] of list.entries()){r.overlap=!concurrency||overlap(r,writerResult?.calls??[]);await write('overlap-final',{series,index,overlap:r.overlap});}
    // Warm candidate reference: initialization occurs outside the measured read
    // window, and each record still includes its engine host loop.
    if((cell.series??['warm-reference']).includes('warm-reference')&&cell.method==='findCandidates'&&!smoke) {
      records['warm-reference']=[];
      for(let i=0;i<rules['warm-reference'].ceiling&&records['warm-reference'].filter(r=>qualifies(r,false)).length<rules['warm-reference'].minimum;i++){
        const slot=cell.protocol==='P2-product-v4'?rotatingCell(cell,i):cell;
        const prepared=await prepareAttempt({...config,cell:slot},slot);
        const value=await readAttempt(prepared,{oracle,initialize:true,signal:config.signal});
        if(cell.protocol==='P2-product-v4')Object.assign(value.record,{language:slot.language,intent:slot.intent,methodLabel:slot.methodLabel});
        records['warm-reference'].push(value.record);await write('warm-reference',value.record);
      }
    }
    const pumpDrain=pump?await pump.stop():[];pump=null;await write('pump-drain',pumpDrain);
    const maintenance=[...(config.maintainerDiagnostics??[]),...pumpDrain.map(r=>r.diagnostics).filter(d=>d.protocol==='context-native-v1')];
    const all=Object.values(records).flat(),populations=Object.fromEntries(Object.entries(records).filter(([s])=>s!=='warmups').map(([s,r])=>[s,population(r,{cold:s==='cold',concurrent:concurrency&&s!=='warm-reference',warmReference:s==='warm-reference',rule:rules[s]})]));
    if(config.rehearsal===true)return {decision:rehearsalDecision(all.length&&all.every(r=>readWorks(r))&&(!writerResult||writerWorks(writerResult))?[]:['request_functional']),populations:{},languageCoverage:true};
    const decision=decide(cell,{smoke,records:all,populations,warmups:records.warmups.length,
      ownerCoverage:config.ownerCoverage,loops:[...readerLoops(all),...(writerResult?[writerResult.hostLoop]:[])],
      readerCoverage:all.every(r=>r.telemetry==='complete')?'complete':'incomplete',maintainerCoverage:maintainerCoverage(maintenance,config.maintainerCoverage),
      writerCoverage:writerResult?.diagnostics.coverage??'complete',baselineCoverage:writerResult?.diagnostics.coverage??'complete',
      nativeBusy:all.reduce((n,r)=>n+r.nativeBusy,0)+(writerResult?.diagnostics.busy??0)+maintenance.reduce((n,d)=>n+(d.busy??0),0),publicBusy:all.reduce((n,r)=>n+r.publicBusy,0),
      writers:concurrency?writerResult?.calls:undefined,production:config.production});
    if(cell.protocol==='P2-product-v4')normalizeV4Decision(decision,[...readerLoops(all),...(writerResult?[writerResult.hostLoop]:[])]);
    return {decision,populations,languageCoverage:cell.language!=='language-rotation-v4'||Object.entries(records).filter(([s])=>s!=='warmups').every(([series,rs])=>rotationCoverage(rs,concurrency&&series!=='warm-reference')),writer:writerResult?{exit:writerResult.exit,coverage:writerResult.diagnostics.coverage}:null};
  }finally {
    try {if(writer)await writer.stop();}
    finally {try {if(pump)await write('pump-drain',await pump.stop());}
      finally {if(sampler)await write('attribution',await sampler.stop());}}
  }
}
export async function contentionWindow(config,{cell,sink,oracle,baseline=false,windowMs=30000}) {
  const write=(series,record)=>sink.record(cell.id,series,record);
  const writer=await recordedWriter(()=>startWriter(config,cell.load.startsWith('retained')?'retained':'fresh'),write,'window-writer');
  const attempts=[];let result,sampler,pump,maintenance=[];
  try {
    sampler=await startSampler([process.pid,writer.child.pid]);
    if(!baseline)pump=await startPump(config,write);
    const startAt=Date.now()+50,endAt=startAt+windowMs;writer.start(startAt,endAt);await delay(Math.max(0,startAt-Date.now()));
    while(Date.now()<endAt&&!config.signal?.aborted){
      if(baseline){await delay(20);writer.flush();continue;}
      const {record}=await attempt(config,{oracle,signal:config.signal});attributeBlocks(record,await sampler.collect());attempts.push(record);writer.flush();await pump?.flush();await sink.record(cell.id,'window',record);
    }
    result=await writer.stop();
    if(pump){maintenance=await pump.stop();pump=null;await sink.record(cell.id,'pump-drain',maintenance);}
    const commits=result.diagnostics.records.filter(r=>r.kind==='native_end'&&r.commit&&r.phase==='write').map(r=>r.at);
    // E1-C2 clips both calls and commits to the immutable window. Its measured
    // reader intervals are adapted to public read-call intervals here.
    const measured=exposureMetrics(attempts.map(r=>({...r,startedAt:r.readStartedAt,finishedAt:r.readFinishedAt})),result.calls,commits,startAt,endAt);
    const exp=exposure(baseline?'baseline':cell.load.startsWith('retained')?'retained':'fresh',measured);
    const diagnostics=[...(config.maintainerDiagnostics??[]),...maintenance.map(r=>r.diagnostics).filter(d=>d.protocol==='context-native-v1')];
    return {startAt,endAt,measured,exposure:exp,writer:result,attempts,maintenance:diagnostics,
      maintainerCoverage:config.maintainerCoverage==='complete'?maintainerCoverage(diagnostics,config.maintainerCoverage):'incomplete'};
  }finally{try {if(!result)await writer.stop();}
    finally {try {if(pump)await write('pump-drain',await pump.stop());}
      finally {if(sampler)await write('attribution',await sampler.stop());}}}
}
export async function pairedWindows(config,options,prepareClone) {
  if(options.cell.pairedBaseline===false)throw Error('paired_baseline_required');
  const decisions=[];
  for(const window of options.smoke?windows(true):Array.from({length:options.cell.windows??PROTOCOL.repetitions},(_,repetition)=>({repetition,windowMs:options.cell.windowMs??PROTOCOL.windowMs,order:repetition%2?['reader','baseline']:['baseline','reader']}))) {
    const pair={};
    for(const variant of window.order) {
      // Separate quiescent seed clone/build for each member of every pair.
      const fresh=await prepareClone(`${window.repetition}-${variant}`);
      pair[variant]=await contentionWindow({...config,...fresh},{...options,baseline:variant==='baseline',windowMs:window.windowMs});
    }
    const reader=pair.reader,base=pair.baseline;
    const exp=exposure(options.cell.load.startsWith('retained')?'retained':'fresh',reader.measured,base.measured.commits);
    const records=reader.attempts,writer=reader.writer;
    const d=decide(options.cell,{smoke:options.smoke,records,exposure:exp,
      loops:[...records.flatMap(r=>[r.hostLoop,...(r.launcherLoop?[r.launcherLoop]:[]),...(r.startupLoop?[r.startupLoop]:[])]),writer.hostLoop,base.writer.hostLoop],
      readerCoverage:records.every(r=>r.telemetry==='complete')?'complete':'incomplete',
      maintainerCoverage:[reader,base].every(w=>w.maintainerCoverage==='complete')?'complete':'incomplete',
      writerCoverage:writer.diagnostics.coverage,baselineCoverage:base.writer.diagnostics.coverage,
      nativeBusy:records.reduce((n,r)=>n+r.nativeBusy,0)+writer.diagnostics.busy+base.writer.diagnostics.busy+[...reader.maintenance,...base.maintenance].reduce((n,d)=>n+(d.busy??0),0),
      publicBusy:records.reduce((n,r)=>n+r.publicBusy,0)+[...writer.calls,...base.writer.calls].filter(w=>w.code==='storage_busy').length,
      writers:[...writer.calls,...base.writer.calls],production:config.production});
    decisions.push(d);await options.sink.record(options.cell.id,'pair',{repetition:window.repetition,order:window.order,decision:d,
      exposure:exp,baselineExposure:base.exposure,throughputRatio:base.measured.commits?reader.measured.commits/base.measured.commits:null});
  }
  return {decision:aggregate(decisions.map(d=>d.decision)),decisions};
}

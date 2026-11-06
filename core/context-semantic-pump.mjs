import { hrtime } from 'node:process';
import { admitMaintenance, refreshMaintenance, isNativeMaintenanceMaintainer } from './context-product-admission.mjs';
import { captureMaintenanceTurnPort, createMaintenanceTurnController, maintenanceTurnPoisoned } from './context-maintenance-turn.mjs';
import { maintenanceAdmissionIdentity } from './context-product-admission-policy.mjs';
import { ownData } from './local-authority-input.mjs';
import { boundedData, coverage, credentialDigest, PRODUCT_PROFILE, hostConfiguration } from './context-product-control.mjs';
import { contextReadSet } from './context-read-input.mjs';
import { serviceIssuance } from './context-product-service.mjs';
import { semanticConfiguration } from './context-semantic-coordinator.mjs';
import { supervisorOwner } from './context-read-supervisor.mjs';
import { integer, usd, dollars, exact } from './context-semantic-input.mjs';
import { fail } from './validation.mjs';
import { productFailure, disposeProductReader, maintenanceObservation, maintenanceFailureDiagnostic, maintenanceReaderFailureDiagnostic, semanticMaintenanceRequest } from './context-product-reader.mjs';
import { add, maintenanceDispatchControl, maintenanceControlState, maintenanceFailureCounts, maintenanceFailureRecord, maintenanceFailureKind, maintenanceErrorName } from './context-product-attribution.mjs';
import { resolve } from 'node:path';

const key=Symbol.for('context-read-product-p2e-v1/pumps');
// Constructor identity follows shared buffers, never their changing contents.
const sharedOptions=new WeakMap();let sharedSerial=0;
function optionIdentity(value) {
  // Host validation rejects other JSON-lossy scalars; retain signed zero.
  if(Object.is(value,-0))return ['number','-0'];
  if(value instanceof SharedArrayBuffer){if(!sharedOptions.has(value))sharedOptions.set(value,++sharedSerial);return ['shared',sharedOptions.get(value)];}
  if(Array.isArray(value))return ['array',value.map(optionIdentity)];
  if(value&&typeof value==='object')return ['object',Object.keys(value).sort().map(k=>[k,optionIdentity(value[k])])];
  return value;
}
export function semanticPump(original,{now,setTimer,clearTimer,open,admit=admitMaintenance,work=refreshMaintenance,observedAt=maintenanceObservation,snapshot}) {
  const c=ownData(original,['supervisor','id','window','budgets','quantum','pollMs','renewalMs','projections','serviceCredential','semanticConfig','semanticServiceCredential','firstCoverageValidation','preQuantum']);
  const selected=semanticConfiguration(c.semanticConfig,{maintenance:true}),coordinator=c.semanticConfig.coordinator,handle=selected.handle;
  handle.validatePumpCredential(c.semanticServiceCredential);
  const credential=boundedData(c.serviceCredential,16384),semanticCredential=boundedData(c.semanticServiceCredential,16384);
  const first=exact(boundedData(c.firstCoverageValidation),'maxTargets,maxMs');integer(first.maxTargets,1,64);integer(first.maxMs,1,5000);
  if(typeof c.id!=='string'||!c.id.length||c.id.length>200)fail('invalid_input');
  const w=exact(boundedData(c.window),'id,endsAtMonoMs,usedItems,usedMs,usedUsd'),b=exact(boundedData(c.budgets),'maxItems,maxMs,maxUsd'),q=exact(boundedData(c.quantum),'maxItems,maxMs,maxUsd');
  if(typeof w.id!=='string'||!w.id.length||w.id.length>200||w.endsAtMonoMs<=now()||w.endsAtMonoMs>now()+60000)fail('invalid_input');
  integer(w.endsAtMonoMs);integer(w.usedItems);integer(w.usedMs);usd(w.usedUsd);integer(b.maxItems,1);integer(b.maxMs,1,60000);usd(b.maxUsd);
  integer(q.maxItems,1,1024);integer(q.maxMs,1,5000);if(usd(q.maxUsd)>usd('0.50'))fail('invalid_input');integer(c.pollMs,1,5000);integer(c.renewalMs,1,60000);
  if(!Array.isArray(c.projections)||c.projections.length<1||c.projections.length>32)fail('invalid_input');
  const projections=c.projections.flatMap(value=>{
    const p=ownData(value,['options','types','modes']),modes=p.modes??['lexical'];
    if(!['["lexical"]','["lexical","embeddings"]'].includes(JSON.stringify(boundedData(modes))))fail('invalid_input');
    const raw=ownData(p.options,['supervisor','path','version','profile','readSet','ownerCoverage','requestControl','host','diagnostics','deadlineMs','sidecarJournalMode','wal','semanticConfig']);
    const {supervisor,semanticConfig,...data}=raw,options={...hostConfiguration(data),supervisor,semanticConfig:c.semanticConfig};
    if(supervisor!==c.supervisor||options.version!=='context-read-v1'||options.profile!==PRODUCT_PROFILE)fail('invalid_input');
    options.readSet=contextReadSet(options.readSet,PRODUCT_PROFILE);options.ownerCoverage=coverage(options.ownerCoverage,options.readSet);
    const binding=serviceIssuance(options.host.configuration.serviceBinding,options.readSet,options.ownerCoverage);
    if(binding.ownerId!==handle.ownerId||credentialDigest(credential)!==binding.credentialDigest)fail('authority_required');
    const types=boundedData(p.types);if(!Array.isArray(types)||!types.length||types.length>2||new Set(types).size!==types.length||types.some(t=>!['memory','card'].includes(t)))fail('invalid_input');
    return ['current','history'].flatMap(intent=>modes.map(mode=>({options,types,intent,mode,bindingId:binding.credentialBindingId})));
  });
  const hasEmbeddings=projections.some(p=>p.mode==='embeddings');
  if((projections.length+1+2*handle.targets.length)*Math.max(c.pollMs,q.maxMs,first.maxMs)>5000)fail('invalid_input');
  // Initial targets need their independently issued public projection grants.
  if(handle.targets.some(t=>!projections.some(p=>p.options.path===t.canonicalPath&&JSON.stringify(p.options.readSet)===JSON.stringify(t.readSet)&&JSON.stringify(p.types)===JSON.stringify(t.types))))fail('invalid_input');
  // Intent and mode belong to calls; all constructor policies belong to a resident.
  const residentKey=p=>{const {supervisor,semanticConfig,...options}=p.options;return JSON.stringify([p.types,optionIdentity(options)]);};
  const residentKeys=new Map(projections.map(p=>[p,residentKey(p)]));
  const all=globalThis[key]??=new Map(),fingerprint=JSON.stringify(projections.map(p=>[residentKeys.get(p),p.intent,p.mode,p.bindingId]));
  const old=all.get(c.id);
  if(old&&old.preQuantum!==c.preQuantum)fail('invalid_input');
  const turnPort=old?old.turnPort:captureMaintenanceTurnPort(c.preQuantum);
  if(old){if(old.fingerprint!==fingerprint||old.supervisor!==c.supervisor||old.coordinator!==coordinator||old.semanticCredentialDigest!==credentialDigest(semanticCredential)||JSON.stringify(old.first)!==JSON.stringify(first))fail('read_in_progress');old.renew(c,w,b);return old.api;}
  const turns=turnPort?createMaintenanceTurnController(turnPort,{now,setTimer,clearTimer}):undefined;
  const {owner,registry}=supervisorOwner(c.supervisor),record=registry.register(owner,{path:projections[0].options.path,domain:'context-read-product-p2e-v1/pump/'+c.id});
  let window=w,budgets=b,usedItems=w.usedItems,usedMs=w.usedMs,usedUsd=w.usedUsd,cursor=0,timer,running,closing,stopped=false,error=null,renewedUntil=now()+c.renewalMs,lastTick=now(),validationPending=false;
  let resolveCompletion,completion,settled=false,completionEpoch=0;
  function cycle(){const epoch=++completionEpoch;settled=false;completion=new Promise(resolve=>{resolveCompletion=value=>{if(epoch===completionEpoch)settled=true;resolve(value);};});}cycle();
  const handles=new Map(),writers=new Map(),completeTargets=new Set();let targetSetDigest=null,firstComplete=false,startupAt=0,residentEpoch=0,parkedUntil;
  const spacing=Math.max(c.pollMs,q.maxMs,first.maxMs);
  const startupProjections=handle.targets.flatMap(target=>['current','history'].map(intent=>projections.find(p=>
    p.options.path===target.canonicalPath&&JSON.stringify(p.options.readSet)===JSON.stringify(target.readSet)&&JSON.stringify(p.types)===JSON.stringify(target.types)&&p.intent===intent)));
  // Startup is a finite cursor, interleaved with regular work. Validation gets
  // one slot per sweep and keeps the coordinator's bounded validation cursor.
  const slots=[];
  for(let i=0;i<Math.max(projections.length,startupProjections.length);i++){
    if(i<startupProjections.length)slots.push({kind:'startup',index:i,p:startupProjections[i]});
    if(i<projections.length)slots.push({kind:'regular',index:i,p:projections[i]});
  }
  slots.push({kind:'validation'});
  const startup=()=>startupAt<startupProjections.length;
  const lexical=projections.map((p,i)=>p.mode==='lexical'?i:-1).filter(i=>i>=0);
  const observations=projections.map(()=>lastTick),missed=projections.map(()=>false);
  let cadenceMisses=0,worstGapMs=0,lastObservation=null,cadenceUntil=usedItems>=b.maxItems?now():Infinity;
  function checkCadence(time){
    const until=Math.min(time,dutyEnd(),cadenceUntil);
    for(const i of lexical){
      const gap=until-observations[i];if(gap<=5000)continue;
      if(!missed[i]){missed[i]=true;cadenceMisses=add(cadenceMisses,1);turns?.missedObservation();}
      worstGapMs=Math.max(worstGapMs,gap);
    }
  }
  function plan(lookahead=false){
    return slots.map((_,offset)=>(cursor+offset)%slots.length).filter(index=>{
      const slot=slots[index];return slot.kind==='startup'?slot.index>=startupAt:
        slot.kind==='validation'?lookahead||validationRequired():usedItems<budgets.maxItems;
    });
  }
  const accountingWindow=w=>{
    // Sample the shared clock first: conversion may shorten, never extend the
    // parent's window, even if scheduling pauses between the two samples.
    const mono=process.hrtime.bigint(),at=now();
    return {id:w.id,endsAtMonoMs:w.endsAtMonoMs,endsMonoNs:String(mono+BigInt(Math.floor((w.endsAtMonoMs-at)*1e6))),items:w.usedItems,ms:w.usedMs,usd:w.usedUsd,floorItems:w.usedItems,floorMs:w.usedMs};
  };
  let account=accountingWindow(w),windowExhausted=false,pendingUsage;
  // Lifecycle ownership is independent of accounting-window settlement.
  let pendingAdmission,retryNotBefore=0,awaitingProof=false;
  let generation=0,activeTurn,turnNumber=0,lastFailure=null,secondaryFailure=null,drainFailed=false,timeoutDisposal=false;
  const failureCounts=maintenanceFailureCounts(),secondaryFailureCounts=maintenanceFailureCounts();
  const drains=new Map(),disposed=new WeakMap(),openings=new Set(),seenFailures=new WeakSet(),readerCounts=new WeakMap();
  const interrupted=Symbol('retired turn');
  const attach=value=>{
    snapshot(value,Object.freeze({cadenceMisses,worstGapMs,observation:lastObservation,lastFailure,failureCounts:Object.freeze({...failureCounts}),secondaryFailure,secondaryFailureCounts:Object.freeze({...secondaryFailureCounts}),...(turns?turns.snapshot():{})}));return value;
  };
  const status=()=>{
    const value=Object.freeze({id:c.id,state:error?'failed':stopped?'stopped':exhausted()?'budget_exhausted':now()>=renewedUntil?'renewal_expired':'active',windowId:window.id,
      usedItems,usedMs,usedUsd,maxItems:budgets.maxItems,maxMs:budgets.maxMs,maxUsd:budgets.maxUsd,error});
    return attach(value);
  };
  const exhausted=()=>windowExhausted||now()>=window.endsAtMonoMs||usedMs>=budgets.maxMs||usedItems>=budgets.maxItems&&!validationRequired()&&!startup();
  const dutyEnd=()=>Math.min(window.endsAtMonoMs,renewedUntil);
  const validationRequired=()=>validationPending||completeTargets.size===handle.targets.length*2&&!firstComplete;
  const turnMs=()=>slots[plan()[0]]?.kind==='validation'?first.maxMs:q.maxMs;
  const observeCoverage=observation=>{firstComplete=observation.complete;validationPending=observation.pending;};
  // Preserve coordinator codes already exposed by the pump. Normalize only
  // transport timeout/unavailability and codes outside the existing vocabularies.
  const controlCodes=Object.freeze({timeout:'timeout',ledger_unavailable:'reader_failed',not_enabled:'not_enabled',purge_pending:'purge_pending',backfill_ceiling:'backfill_ceiling',price_unavailable:'price_unavailable',budget_denied:'budget_denied',provider_error:'provider_error',rate_limited:'rate_limited',dimension_mismatch:'dimension_mismatch',provider_unavailable:'provider_unavailable'});
  const publicCode=code=>Object.hasOwn(controlCodes,code)?controlCodes[code]:productFailure(code).error.code;
  const terminalCode=code=>{const value=publicCode(code);timeoutDisposal=value==='timeout'||value==='read_timeout';return value;};
  function saveFailure(failure,secondary=false,counts) {
    const {stall,...fields}=failure;failure=Object.freeze(fields); // Causes only; no stall reporting.
    const kind=maintenanceFailureKind(failure),target=secondary?secondaryFailureCounts:failureCounts;
    if(secondary)secondaryFailure=failure;else lastFailure=failure;
    for(const key of Object.keys(target)){const n=counts?.[key]??(key===kind?1:0);if(Number.isSafeInteger(n)&&n>0)target[key]=add(target[key],n);}
  }
  function readerSecondary(value,ctx) {
    const state=maintenanceReaderFailureDiagnostic(value);if(!state?.secondaryFailure)return;
    const identity=maintenanceFailureDiagnostic(value)??value,prior=readerCounts.get(identity),counts={};let changed=false;
    for(const key of Object.keys(secondaryFailureCounts)){counts[key]=Math.max(0,state.secondaryFailureCounts[key]-(prior?.[key]??0));changed ||= counts[key]>0;}
    readerCounts.set(identity,state.secondaryFailureCounts);
    if(changed)saveFailure(Object.freeze({...state.secondaryFailure,number:ctx.number}),true,counts);
  }
  function note(value,ctx,stage,kind,code) {
    const found=maintenanceFailureDiagnostic(value),captured=found&&(stage==='open'||stage==='close'||found.ordinal===undefined||found.ordinal===ctx.ordinal)?found:undefined;
    const samePrimary=stage==='close'&&captured&&Number.isSafeInteger(captured.ordinal)&&captured.ordinal>0&&lastFailure&&['cause','ordinal','engineCode','errorName','step','stage'].every(key=>captured[key]===lastFailure[key]);
    if(captured&&(seenFailures.has(captured)||samePrimary)){seenFailures.add(captured);readerSecondary(value,ctx);return;}
    const raw=code??value?.error?.code??value?.code;
    const source=captured??maintenanceFailureRecord(kind??(raw===undefined?'call_error':publicCode(raw)===raw||raw==='timeout'?'engine':'unmapped'),
      {engineCode:raw,errorName:maintenanceErrorName(value),ordinal:ctx.ordinal,stage});
    // Identity catches propagation; the closed key also catches reconstructed copies.
    // Distinct same-family failures retain their code, stage and dispatch join.
    const identity=captured??(value&&typeof value==='object'?value:source);
    const record=Object.freeze({...source,stage:source.stage??stage,number:ctx.number});
    const key=JSON.stringify(['cause','engineCode','errorName','exitCode','step','stage','ordinal','number'].map(field=>record[field]));
    if(!ctx.failures.has(identity)&&!ctx.failures.has(key))saveFailure(record,ctx.failures.size>0||stage==='close'&&lastFailure!==null);
    ctx.failures.add(identity);ctx.failures.add(key);
    if(captured)seenFailures.add(captured);readerSecondary(value,ctx);
  }
  function drain(identity,close,ctx) {
    if(drains.has(identity))return drains.get(identity);
    if(typeof identity==='object'&&disposed.has(identity))return disposed.get(identity);
    const disposal={...ctx,ordinal:identity===ctx.handle?ctx.ordinal:undefined,failures:new Set()};
    const pending=Promise.resolve().then(close).then(()=>readerSecondary(identity,disposal),failure=>{
      note(failure,disposal,'close','cleanup');drainFailed=true;error=terminalCode('reader_failed');throw failure;
    });
    drains.set(identity,pending);if(typeof identity==='object')disposed.set(identity,pending);
    void pending.finally(()=>drains.delete(identity)).catch(()=>{});return pending;
  }
  const dispose=(h,ctx)=>drain(h,()=>disposeProductReader(h,timeoutDisposal?'read_timeout':'store_closed',ctx.until,ctx.handle===h?lastFailure:undefined),ctx);
  function owns(ctx){return !stopped&&!error&&generation===ctx.generation&&now()<ctx.end;}
  function check(ctx){if(stopped||error)throw interrupted;if(now()>=ctx.until){expire(ctx);throw interrupted;}if(generation!==ctx.generation||now()>=ctx.end)throw interrupted;}
  function expire(ctx){
    if(activeTurn!==ctx||stopped||error)return;
    if(now()<ctx.until){clearTimer(ctx.watchdog);ctx.watchdog=setTimer(()=>expire(ctx),Math.ceil(ctx.until-now()));return;}
    const code=ctx.coordinator?'timeout':'read_timeout';
    note(undefined,ctx,ctx.stage,'engine',code);error=terminalCode(code);ctx.cancel();void stop();
  }
  async function wait(ctx,work,stage,coordinator=false) {
    ctx.stage=stage;ctx.coordinator=coordinator;check(ctx);
    const result=await Promise.race([Promise.resolve().then(()=>{check(ctx);return work();}),ctx.cancelled]);check(ctx);return result;
  }
  async function turn(maxMs,work,ticket,takeTicket) {
    maxMs=Math.min(maxMs,budgets.maxMs-usedMs);if(maxMs<1)return;
    const control=maintenanceDispatchControl(),ctx={control,ordinal:maintenanceControlState(control).ordinal,number:turnNumber,generation,account,end:dutyEnd(),until:now()+maxMs,stage:'call',failures:new Set()};
    let quantumOwnsTicket=false;
    function prepare(){
      if(ticket){
        ctx.ticket=ticket;ctx.semanticOutstanding=new SharedArrayBuffer(8);
        ctx.join=handle.pumpTurn({semanticOutstanding:ctx.semanticOutstanding});
        void ctx.join.proof.catch(()=>{ctx.coordinatorFailed=true;});
      }
      turnNumber=add(turnNumber,1);ctx.cancelled=new Promise((_,reject)=>{ctx.cancel=()=>reject(interrupted);});
      if(ticket)void ctx.cancelled.catch(()=>{}); // Close may reenter during setup.
      activeTurn=ctx;
      ctx.watchdog=setTimer(()=>expire(ctx),maxMs);
    }
    if(!ticket)prepare();
    try{
      if(ticket){
        prepare();
        turns.started(ticket);
        // The release guard is active and dispatch setup is complete. This is
        // the sole handoff from the post-grant owner to quantum settlement.
        quantumOwnsTicket=takeTicket();
      }
      return await work(ctx);
    }catch(e){
      if(ticket&&!quantumOwnsTicket)throw e;
      if(e!==interrupted){note(e,ctx,ctx.stage);error??=terminalCode(e.code);}
    }finally{
      try{clearTimer(ctx.watchdog);}
      finally{
        try{if(ticket){if(quantumOwnsTicket)await finalizeTurn(ctx);else ctx.join?.detach?.();}}
        finally{if(activeTurn===ctx)activeTurn=undefined;}
      }
    }
  }
  function turnFailure(code){error=terminalCode(code);void stop().catch(()=>{});}
  function releaseTurn(ticket,outcome,reason){
    const result=turns.release(ticket,outcome,reason);
    if(result==='poisoned'||result==='authority_required')turnFailure(result==='poisoned'?'reader_failed':'authority_required');
  }
  function poisonTurn(ctx){turns.poison(ctx.ticket);turnFailure('reader_failed');}
  const settlementNow=()=>{const [seconds,nanos]=hrtime();return seconds*1000+nanos/1e6;};
  async function finalizeTurn(ctx){
    const state=new Int32Array(ctx.semanticOutstanding),until=settlementNow()+5000;
    turns.settling(ctx.ticket);
    if(error||stopped)for(const h of handles.values())void dispose(h,ctx);
    // Seal under the same lock used by caller increments. A stalled caller is
    // bounded too: the host disposal proof becomes the only release authority.
    let sealed=false;
    while(settlementNow()<until){
      const flag=Atomics.compareExchange(state,1,0,1);
      if(flag===0){sealed=true;break;}
      if(flag===2){poisonTurn(ctx);return;}
      if(await Atomics.waitAsync(state,1,flag,Math.max(1,until-settlementNow())).value==='timed-out'){ctx.requireCoordinatorProof=true;break;}
    }
    const late=()=>{if(Atomics.load(state,1)===2)poisonTurn(ctx);};
    if(sealed){
      // The unreferenced atomic waiter observes violations even after release;
      // coordinator disposal closes its lifetime without adding a polling timer.
      void Promise.resolve(Atomics.waitAsync(state,1,1).value).then(late);
      void ctx.join.proof.finally(()=>{Atomics.notify(state,1);}).catch(()=>{});
    }
    while(sealed&&!ctx.requireCoordinatorProof&&Atomics.load(state,0)!==0&&settlementNow()<until&&!stopped){
      const count=Atomics.load(state,0);if(count===0)break;
      if(await Atomics.waitAsync(state,0,count,Math.max(1,until-settlementNow())).value==='timed-out')ctx.requireCoordinatorProof=true;
      if(Atomics.load(state,1)===2){poisonTurn(ctx);return;}
    }
    // Expiry is irreversible even if the final notification races this check.
    if(settlementNow()>=until)ctx.requireCoordinatorProof=true;
    // Required reader cleanup is part of this grant, including late opens.
    await Promise.allSettled([...openings]);
    const disposals=await Promise.allSettled([...drains.values()]);
    if(ctx.coordinatorFailed||drainFailed||disposals.some(r=>r.status==='rejected')||Atomics.load(state,1)===2){poisonTurn(ctx);return;}
    if(settlementNow()>=until)ctx.requireCoordinatorProof=true;
    if(sealed&&Atomics.load(state,0)===0&&!ctx.requireCoordinatorProof){ctx.join.detach?.();releaseTurn(ctx.ticket,'settled');return;}
    awaitingProof=true;
    // Pump close never closes a host coordinator. This continuation is owned
    // by its already registered delivery proof and survives pump completion.
    void ctx.join.proof.then(()=>{
      if(Atomics.load(state,1)===2){poisonTurn(ctx);return;}
      releaseTurn(ctx.ticket,'settled');awaitingProof=false;
      if(!stopped&&!error)schedule();
    },()=>poisonTurn(ctx));
  }
  async function brokered(index,slot){
    const epoch=residentEpoch,enteredGeneration=generation,controller=new AbortController();
    const pending={controller};pendingAdmission=pending;
    let result,untilMonoMs;
    try{
      const maxMs=turnMs(),identity=maintenanceAdmissionIdentity((slot.p??projections[0]).options);
      result=await turns.wait({version:1,pumpId:c.id,windowId:window.id,lane:index,family:'semantic',
        kind:slot.kind==='startup'?'status':slot.kind==='validation'?'validation':slot.p.mode,phase:'work',intent:slot.kind==='regular'&&slot.p.mode==='lexical'?slot.p.intent:null,maxMs},
        {signal:controller.signal,identity,untilMonoMs:untilMonoMs=Math.min(now()+turnPort.maxWaitMs,dutyEnd()-maxMs)});
    }catch{result={status:'failed',error:'reader_failed'};}
    if(pendingAdmission===pending)pendingAdmission=undefined;
    if(result.status==='failed'){turnFailure(result.error);return;}
    if(result.status!=='admitted'){retryNotBefore=now()+spacing;return;}
    const ticket=result.ticket;
    let reason,portUnchanged,ownsTicket=true;
    try{
      if(stopped||error)reason='stopped';
      else if(generation!==enteredGeneration)reason='generation_changed';
      else if(dutyEnd()-now()<turnMs())reason='renewal_expired';
      else if(exhausted())reason='budget_exhausted';
      else if(now()<lastTick+spacing)reason='spacing';
      else if(epoch!==residentEpoch||plan()[0]!==index)reason='lane_changed';
      const currentIdentity=maintenanceAdmissionIdentity((slot.p??projections[0]).options);
      if(turns.isPoisoned(currentIdentity)){reason??='stopped';error='reader_failed';}
      if(!reason){
        portUnchanged=turns.portUnchanged();
        if(portUnchanged)turns.bindIdentity(ticket,currentIdentity);
        // All metadata/port validation precedes this sample. Expiry retains
        // its decline precedence, including over a changed port.
        const admittedAt=now();
        if(result.waitExpired||admittedAt>=untilMonoMs)reason='wait_expired';
      }
      if(reason){retryNotBefore=now()+spacing;releaseTurn(ticket,'declined',reason);if(error)turnFailure(error);return;}
      if(!portUnchanged){releaseTurn(ticket,'withdrawn');turnFailure('authority_required');return;}
      // Await also catches rejected async setup before the quantum takes the
      // ticket. Returning its Promise here would end this guard too early.
      const selectedResult=await runSelected(index,slot,ticket,()=>{ownsTicket=false;return true;});
      if(ownsTicket)releaseTurn(ticket,'withdrawn');
      return selectedResult;
    }catch(e){
      if(!ownsTicket)throw e;
      releaseTurn(ticket,'withdrawn');turnFailure('reader_failed');
    }
  }
  function interval(count){
    const turns=Math.min(budgets.maxItems/q.maxItems,budgets.maxMs/Math.max(q.maxMs,first.maxMs));
    return Math.max(spacing,Math.min(5000/Math.max(projections.length+1,count),60000/Math.max(1,turns)));
  }
  function schedule(){
    if(exhausted()||usedItems>=budgets.maxItems)cadenceUntil=Math.min(cadenceUntil,now());
    checkCadence(now());
    if(awaitingProof)return;
    if(stopped||error||exhausted()||now()>=renewedUntil){if(!stopped&&!error)resolveCompletion(status());return;}
    fits(turnMs());
    if(parkedUntil!==undefined){timer=setTimer(tick,Math.max(1,parkedUntil-now()));return;}
    const order=plan(true);
    // Only lexical refreshes discharge canonical selection/intent duty. Include
    // status, embedding and the potential validation slot in that lookahead.
    // The initial last lexical slot precedes validation; after the first status
    // slot, at most N+2T slots remain. The existing (N+1+2T)*S guard therefore
    // leaves a full Q of headroom without changing arithmetic admission.
    const due=Math.min(...order.map((index,position)=>{
      const slot=slots[index];return slot.kind==='regular'&&slot.p.mode==='lexical'
        ?observations[slot.index]+5000-q.maxMs-position*spacing:Infinity;
    }));
    const next=Math.min(Math.max(lastTick+spacing,Math.min(lastTick+interval(order.length),due)),dutyEnd());
    timer=setTimer(tick,Math.max(0,Math.max(next,retryNotBefore)-now()));
  }
  function fits(maxMs){const end=dutyEnd();parkedUntil=end-now()>=maxMs?undefined:end;return parkedUntil===undefined;}
  async function control(ctx,method,input) {
    const result=await wait(ctx,()=>handle.pumpCall(method,input,Math.max(1,Math.ceil(ctx.until-now())),...(ctx.semanticOutstanding?[{semanticOutstanding:ctx.semanticOutstanding}]:[])),'call',true);check(ctx);return result;
  }
  function apply(ctx,result) {
    const a=ctx.account;
    if(result.windowId!==a.id||result.generation!==ctx.generation)fail('reader_failed');
    // A renewed generation cannot apply a stale reply, even in the same window.
    if(a===account&&generation!==ctx.generation)return;
    a.floorItems=Math.max(a.floorItems,result.floors?.items??0);a.floorMs=Math.max(a.floorMs,result.floors?.ms??0);
    a.items=Math.max(a.floorItems,result.usedItems);a.ms=Math.max(a.floorMs,result.usedMs);a.usd=result.usedUsd;
    if(a===account){usedItems=a.items;usedMs=a.ms;usedUsd=a.usd;}
  }
  const floors=a=>({items:a.floorItems,ms:a.floorMs});
  async function reserve(ctx,mode,maxItems,maxMs,maxUsd,bindingId) {
    ctx.reservedAt=now();
    const a=ctx.account,remainingMs=Math.max(0,Math.floor(a.endsAtMonoMs-ctx.reservedAt));
    const pending=pendingUsage,sentWindow={...window,usedItems,usedMs,usedUsd};
    // Charge locally before transport too. A lost reserve reply is unknown,
    // and its captured window keeps the reservation across any renewal.
    a.items+=maxItems;a.ms+=maxMs;usedItems=a.items;usedMs=a.ms;
    const result=await control(ctx,'pumpReserve',{mode,maxItems,maxMs,bindingId,window:sentWindow,budgets,maxUsd,remainingMs,...(pending?{reconcile:{...pending.input,floors:floors(pending.account)}}:{}),
      accounting:{version:1,generation:ctx.generation,floors:floors(a),endsMonoNs:a.endsMonoNs}});
    apply(ctx,result);check(ctx);if(result.exhausted){windowExhausted=true;throw interrupted;}if(pendingUsage===pending)pendingUsage=undefined;return {...result,mode,maxItems,maxMs};
  }
  async function finish(ctx,reservation,known,items) {
    const input={id:reservation.id,known,windowId:ctx.account.id,generation:ctx.generation,floors:floors(ctx.account)};
    const result=await control(ctx,'pumpFinish',input);apply(ctx,result);check(ctx);
    // The receipt closes the measured span, including its own delivery. The
    // next reserved admission persists this acknowledgement inside that next
    // charge; no reconciliation RPC escapes both measured spans. Losing the
    // acknowledgement leaves the durable original reservation charged.
    const elapsedMs=Math.ceil(now()-ctx.reservedAt);
    const usage=known&&Number.isSafeInteger(items)&&items>=0&&items<=reservation.maxItems&&elapsedMs>=0&&elapsedMs<=reservation.maxMs
      ?{version:1,items,elapsedMs}:null;
    pendingUsage={account:ctx.account,input:{...input,usage}};
    if(usage){
      const a=ctx.account;a.items=Math.max(a.floorItems,a.items-reservation.maxItems+items);a.ms=Math.max(a.floorMs,a.ms-reservation.maxMs+elapsedMs);
      usedItems=a.items;usedMs=a.ms;
    }
  }

  async function maintainer(ctx,p) {
    const id=JSON.stringify([residentKeys.get(p),residentEpoch]),writer=JSON.stringify([resolve(p.options.path),p.options.readSet]);let h=handles.get(id);
    if(!h){
      const previous=writers.get(writer);
      if(previous!==undefined){
        const predecessor=handles.get(previous);
        await wait(ctx,async()=>{
          await dispose(predecessor,ctx);
          // Eviction follows confirmed disposal even when dispatch ownership ends.
          if(handles.get(previous)===predecessor){
            handles.delete(previous);if(writers.get(writer)===previous)writers.delete(writer);
          }
        },'close');check(ctx);
      }
      check(ctx);ctx.stage='open';
      // Observe rejection before finish can replace it. A late open belongs to
      // completion even after its turn has lost dispatch authority.
      const opening=Promise.resolve().then(()=>{check(ctx);const remaining=Math.floor(ctx.until-now());if(remaining<1)fail('read_timeout');return open({...p.options,deadlineMs:remaining},ctx.control);}).then(async opened=>{
        if(!owns(ctx)||now()>=ctx.until){await dispose(opened,ctx);return opened;}
        handles.set(id,opened);writers.set(writer,id);
        // Match lexical dispatch: either default bridge requires native identity.
        if(ctx.semanticOutstanding&&(admit===admitMaintenance||work===refreshMaintenance)&&!isNativeMaintenanceMaintainer(opened)){
          note(opened,ctx,'open','maintainer_identity_unrecognized');error='invalid_input';throw interrupted;
        }
        return opened;
      },failure=>{
        if(failure!==interrupted)note(failure,ctx,'open');
        if(failure.cleanupId)void drain(failure.cleanupId,()=>c.supervisor.drain(failure.cleanupId),ctx);
        throw failure;
      });
      openings.add(opening);void opening.finally(()=>openings.delete(opening)).catch(()=>{});
      h=await wait(ctx,()=>opening,'open');check(ctx);
    }return h;
  }
  async function operation(ctx,p,method,input,reservation) {
    let result,failure,invalidTiming=false;
    try {
      const h=await maintainer(ctx,p),remaining=Math.floor(ctx.until-now());check(ctx);if(remaining<1)fail('read_timeout');
      // Opening claims its control; later calls require their own joined ordinal.
      if(maintenanceControlState(ctx.control).claimed){ctx.control=maintenanceDispatchControl();ctx.ordinal=maintenanceControlState(ctx.control).ordinal;}
      ctx.handle=h;ctx.stage=method==='refreshContextIndex'?'refresh':'call';
      const args=method==='refreshContextIndex'?{...input,budget:{...input.budget,maxMs:remaining}}:{...input,deadlineMs:remaining};
      result=await wait(ctx,()=>ctx.semanticOutstanding?semanticMaintenanceRequest(h,method,args,credential,ctx.control,{semanticOutstanding:ctx.semanticOutstanding,dispatch:method==='getContextIndexStatus'?admit:work}):h[method](args,credential,ctx.control),ctx.stage);check(ctx);
      if(!result.ok)note(result,ctx,ctx.stage);
      if(result.ok&&method==='refreshContextIndex'&&reservation.mode==='lexical'){
        ctx.observedAt=observedAt(result);
        // Invalid observation timing is uncertain work, so validate before
        // known settlement can refund any of the reservation.
        invalidTiming=!Number.isFinite(ctx.observedAt)||ctx.observedAt<lastTick||ctx.observedAt>now();
        if(invalidTiming)note(result,ctx,'observation','observation_timing');
      }
    }catch(e){failure=e;if(e!==interrupted)note(e,ctx,ctx.stage);}
    // A still-owned failed operation settles conservatively. Lost ownership
    // leaves its full reservation charged; no late dispatch or known refund.
    if(generation===ctx.generation&&!stopped&&now()<ctx.until&&now()<ctx.end){
      try {
        await finish(ctx,reservation,!failure&&!invalidTiming&&result?.ok===true,method==='getContextIndexStatus'?0:result?.value?.progress?.[reservation.mode==='embeddings'?'embeddingAttempts':'transformed']);
      }catch(e){if(e!==interrupted){note(e,ctx,'call');error=terminalCode(e.code);}if(!failure)failure=e;}
    }
    // A known failure survives retirement of its accounting await.
    if(result&&!result.ok)error??=terminalCode(result.error?.code);
    if(invalidTiming)error??='reader_failed';
    if(failure)throw failure;return result;
  }
  async function validation(ctx) {
    if(!targetSetDigest||firstComplete)return;
    if(!fits(first.maxMs))return;
    const maxMs=Math.min(first.maxMs,budgets.maxMs-usedMs,Math.floor(window.endsAtMonoMs-now()),Math.floor(renewedUntil-now()));
    if(maxMs<1)return;const reservation=await reserve(ctx,'validation',0,maxMs,'0');check(ctx);
    const result=await wait(ctx,()=>ctx.join?ctx.join.validate({ownerId:handle.ownerId,expectedTargetDigest:targetSetDigest,budget:{maxTargets:first.maxTargets,maxMs:Math.max(1,Math.floor(ctx.until-now()))}},semanticCredential):coordinator.validateOwnerSemanticCoverage({ownerId:handle.ownerId,expectedTargetDigest:targetSetDigest,budget:{maxTargets:first.maxTargets,maxMs:Math.max(1,Math.floor(ctx.until-now()))}},semanticCredential),'call',true);check(ctx);
    // This API's own deadline returns read_timeout without retiring the coordinator.
    // Keep that private origin; public classification follows coordinator timeouts.
    const code=!result.ok&&result.error.code==='read_timeout'?'timeout':result.error?.code;
    if(!result.ok){note(result,ctx,'call');if(code==='timeout')timeoutDisposal=true;}
    try{await finish(ctx,reservation,result.ok===true,0);}
    catch(failure){if(failure!==interrupted)error=terminalCode(failure.code);throw failure;}
    finally{if(!result.ok)error??=terminalCode(code);}
    if(!result.ok)return;check(ctx);firstComplete=result.value.status==='complete';const current=await control(ctx,'firstCoverage');check(ctx);observeCoverage(current);
  }
  async function regular(ctx,slot) {
    if(error||stopped||exhausted()||usedItems>=budgets.maxItems||parkedUntil!==undefined||!fits(q.maxMs))return;
    const p=slot.p,isEmbedding=p.mode==='embeddings';
    if(isEmbedding){const admission=await control(ctx,'embeddingAdmission');check(ctx);if(!admission.allowed||usd(usedUsd)>=usd(budgets.maxUsd)){cursor=(slots.indexOf(slot)+1)%slots.length;return;}}
    check(ctx);if(!fits(q.maxMs))return;
    const maxItems=Math.min(q.maxItems,budgets.maxItems-usedItems),maxMs=Math.min(q.maxMs,budgets.maxMs-usedMs,Math.floor(window.endsAtMonoMs-now()),Math.floor(renewedUntil-now()));
    if(maxItems<1||maxMs<1)return;
    const reservation=await reserve(ctx,p.mode,maxItems,maxMs,isEmbedding?dollars(usd(q.maxUsd)<usd(budgets.maxUsd)-usd(usedUsd)?usd(q.maxUsd):usd(budgets.maxUsd)-usd(usedUsd)):'0',p.bindingId);check(ctx);cursor=(slots.indexOf(slot)+1)%slots.length;
    const result=await operation(ctx,p,'refreshContextIndex',{readSet:p.options.readSet,types:p.types,intent:p.intent,mode:p.mode,budget:{maxItems,...(isEmbedding?{maxUsd:reservation.maxUsd}:{})}},reservation);check(ctx);
    if(!result?.ok||error||stopped)return;
    if(!isEmbedding){
      const time=ctx.observedAt,finished=now();
      checkCadence(time);
      lastObservation=Object.freeze({projection:slot.index,atMonoMs:time,gapMs:time-observations[slot.index],cadenceMiss:missed[slot.index]});
      observations[slot.index]=time;missed[slot.index]=false;checkCadence(finished);
    }
    if(isEmbedding){const current=await control(ctx,'firstCoverage');check(ctx);observeCoverage(current);if(result.value.status==='complete')completeTargets.add(JSON.stringify([p.options.path,p.types,p.intent]));}
  }
  async function tick() {
    if(stopped||error||running||pendingAdmission||awaitingProof)return;
    if(projections.some(p=>turns?turns.isPoisoned(maintenanceAdmissionIdentity(p.options)):maintenanceTurnPoisoned(()=>maintenanceAdmissionIdentity(p.options)))){turnFailure('reader_failed');return;}
    checkCadence(now());
    if(exhausted()||now()>=renewedUntil){resolveCompletion(status());return;}
    parkedUntil=undefined;
    // Early callbacks and renewal cannot bypass minimum start spacing.
    if(now()<lastTick+spacing){schedule();return;}
    const index=plan()[0],slot=slots[index];if(!slot){schedule();return;}
    if(!fits(turnMs())){schedule();return;}
    if(turns){
      // Latch before the host's synchronous factory can reenter this pump.
      const task=Promise.resolve().then(()=>brokered(index,slot));running=task;
      return task.finally(()=>{if(running===task){running=null;if(error)void stop().catch(()=>{});else schedule();}});
    }
    return running=runSelected(index,slot);
  }
  function runSelected(index,slot,ticket,takeTicket){
    lastTick=now();return turn(turnMs(),async ctx=>{
      const current=await control(ctx,'firstCoverage');check(ctx);targetSetDigest=current.targetSetDigest;observeCoverage(current);
      if(slot.kind==='validation'){
        await validation(ctx);check(ctx);cursor=(index+1)%slots.length;
      }else if(slot.kind==='startup'){
        if(!fits(q.maxMs))return;
        const reservation=await reserve(ctx,'validation',0,Math.min(q.maxMs,budgets.maxMs-usedMs),'0');
        const p=slot.p,result=await operation(ctx,p,'getContextIndexStatus',{readSet:p.options.readSet,types:p.types,intent:p.intent},reservation);check(ctx);
        if(result?.ok&&!error){
          if(result.value.lexical.state==='ready'&&result.value.semantic.coverage.status==='complete')completeTargets.add(JSON.stringify([p.options.path,p.types,p.intent]));
          startupAt++;cursor=(index+1)%slots.length;
        }
      }else await regular(ctx,slot);
    },ticket,takeTicket).finally(async()=>{await Promise.allSettled([...openings]);if(turns)return;running=null;if(error){void stop();return;}schedule();});
  }
  function stop() {
    if(closing)return closing;stopped=true;generation++;pendingAdmission?.controller.abort();activeTurn?.cancel();if(activeTurn?.semanticOutstanding){const state=new Int32Array(activeTurn.semanticOutstanding);if(Atomics.load(state,0)!==0)activeTurn.requireCoordinatorProof=true;Atomics.notify(state,0);}clearTimer(timer);registry.cleanup(record);
    const ctx=activeTurn??{number:turnNumber,until:now(),failures:new Set()};
    // Cancel/dispose residents before waiting for an outstanding call to settle.
    for(const h of handles.values())void dispose(h,ctx);
    closing=(async()=>{
      await running;await Promise.allSettled([...openings]);
      const results=await Promise.allSettled([...drains.values()]);
      if(drainFailed||results.some(r=>r.status==='rejected'))throw Error('reader_failed');
      registry.finish(record);all.delete(c.id);resolveCompletion(status());
    })();
    closing.catch(()=>{error=terminalCode('reader_failed');registry.finish(record,false);all.delete(c.id);resolveCompletion(status());});return closing;
  }
  function completePrevious() {
    const report=resolveCompletion,value=status(),work=running;
    if(!work&&!openings.size&&!drains.size){report(value);return;}
    void (async()=>{
      await Promise.allSettled([work]);await Promise.allSettled([...openings]);await Promise.allSettled([...drains.values()]);
      report(attach(Object.freeze({...value,...(error?{state:'failed',error}:{})})));
    })();
  }
  record.stop=()=>{void stop();};
  const api=Object.freeze({getStatus:status,get completion(){return completion;},close:stop});
  const entry={api,fingerprint,preQuantum:c.preQuantum,turnPort,supervisor:c.supervisor,coordinator,semanticCredentialDigest:credentialDigest(semanticCredential),first,renew(next,w,b){
    if(stopped)fail('store_closed');if(JSON.stringify(next.quantum)!==JSON.stringify(c.quantum)||next.pollMs!==c.pollMs)fail('invalid_input');
    // Settled item exhaustion ends resident duty even if validation can continue.
    const inactive=now()>renewedUntil||now()>window.endsAtMonoMs||!running&&(windowExhausted||usedMs>=budgets.maxMs||usedItems>=budgets.maxItems);
    checkCadence(now());
    if(w.id!==window.id){if(now()<window.endsAtMonoMs)fail('invalid_input');completePrevious();window=w;budgets=b;account=accountingWindow(w);windowExhausted=false;usedItems=w.usedItems;usedMs=w.usedMs;usedUsd=w.usedUsd;cycle();}
    else{if(JSON.stringify(b)!==JSON.stringify(budgets)||w.endsAtMonoMs!==window.endsAtMonoMs)fail('invalid_input');usedItems=Math.max(usedItems,w.usedItems);usedMs=Math.max(usedMs,w.usedMs);usedUsd=dollars(usd(usedUsd)>usd(w.usedUsd)?usd(usedUsd):usd(w.usedUsd));}
    account.floorItems=Math.max(account.floorItems,w.usedItems);account.floorMs=Math.max(account.floorMs,w.usedMs);
    account.items=usedItems;account.ms=usedMs;account.usd=usedUsd;
    generation++;pendingAdmission?.controller.abort();
    if(inactive){residentEpoch++;observations.fill(now());missed.fill(false);cadenceUntil=Infinity;}
    if(settled)cycle();renewedUntil=now()+next.renewalMs;parkedUntil=undefined;clearTimer(timer);if(!running)schedule();
  }};
  all.set(c.id,entry);schedule();return api;
}

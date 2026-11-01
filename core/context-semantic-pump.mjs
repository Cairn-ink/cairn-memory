import { ownData } from './local-authority-input.mjs';
import { boundedData, coverage, credentialDigest, PRODUCT_PROFILE, hostConfiguration } from './context-product-control.mjs';
import { contextReadSet } from './context-read-input.mjs';
import { serviceIssuance } from './context-product-service.mjs';
import { semanticConfiguration } from './context-semantic-coordinator.mjs';
import { supervisorOwner } from './context-read-supervisor.mjs';
import { integer, usd, dollars, exact } from './context-semantic-input.mjs';
import { fail } from './validation.mjs';
import { productFailure, disposeProductReader, maintenanceFailureDiagnostic, maintenanceReaderFailureDiagnostic } from './context-product-reader.mjs';
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
export function semanticPump(original,{now,setTimer,clearTimer,open,snapshot}) {
  const c=ownData(original,['supervisor','id','window','budgets','quantum','pollMs','renewalMs','projections','serviceCredential','semanticConfig','semanticServiceCredential','firstCoverageValidation']);
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
  if(old){if(old.fingerprint!==fingerprint||old.supervisor!==c.supervisor||old.coordinator!==coordinator||old.semanticCredentialDigest!==credentialDigest(semanticCredential)||JSON.stringify(old.first)!==JSON.stringify(first))fail('read_in_progress');old.renew(c,w,b);return old.api;}
  const {owner,registry}=supervisorOwner(c.supervisor),record=registry.register(owner,{path:projections[0].options.path,domain:'context-read-product-p2e-v1/pump/'+c.id});
  let window=w,budgets=b,usedItems=w.usedItems,usedMs=w.usedMs,usedUsd=w.usedUsd,at=0,timer,running,closing,stopped=false,error=null,renewedUntil=now()+c.renewalMs,lastTick=now(),validationPending=false;
  let resolveCompletion,completion,settled=false,completionEpoch=0;
  function cycle(){const epoch=++completionEpoch;settled=false;completion=new Promise(resolve=>{resolveCompletion=value=>{if(epoch===completionEpoch)settled=true;resolve(value);};});}cycle();
  const handles=new Map(),writers=new Map(),completeTargets=new Set();let targetSetDigest=null,firstComplete=false,startup=true,residentEpoch=0,parkedUntil;
  // Lifecycle ownership is independent of accounting-window settlement (PR D).
  let generation=0,activeTurn,turnNumber=0,lastFailure=null,secondaryFailure=null,drainFailed=false;
  const failureCounts=maintenanceFailureCounts(),secondaryFailureCounts=maintenanceFailureCounts();
  const drains=new Map(),disposed=new WeakMap(),openings=new Set(),seenFailures=new WeakSet(),readerCounts=new WeakMap();
  const interrupted=Symbol('retired turn');
  const attach=value=>{
    snapshot(value,Object.freeze({lastFailure,failureCounts:Object.freeze({...failureCounts}),secondaryFailure,secondaryFailureCounts:Object.freeze({...secondaryFailureCounts})}));return value;
  };
  const status=()=>{
    const value=Object.freeze({id:c.id,state:error?'failed':stopped?'stopped':exhausted()?'budget_exhausted':now()>=renewedUntil?'renewal_expired':'active',windowId:window.id,
      usedItems,usedMs,usedUsd,maxItems:budgets.maxItems,maxMs:budgets.maxMs,maxUsd:budgets.maxUsd,error});
    return attach(value);
  };
  const exhausted=()=>now()>=window.endsAtMonoMs||usedMs>=budgets.maxMs||usedItems>=budgets.maxItems&&!validationPending&&!startup;
  const dutyEnd=()=>Math.min(window.endsAtMonoMs,renewedUntil);
  const validationRequired=()=>validationPending||completeTargets.size===handle.targets.length*2&&!firstComplete;
  const turnMs=()=>!startup&&validationRequired()?first.maxMs:q.maxMs;
  const observeCoverage=observation=>{firstComplete=observation.complete;validationPending=observation.pending;};
  // Preserve coordinator codes already exposed by the pump. Normalize only
  // transport timeout/unavailability and codes outside the existing vocabularies.
  const controlCodes=Object.freeze({timeout:'read_timeout',ledger_unavailable:'reader_failed',not_enabled:'not_enabled',purge_pending:'purge_pending',backfill_ceiling:'backfill_ceiling',price_unavailable:'price_unavailable',budget_denied:'budget_denied',provider_error:'provider_error',rate_limited:'rate_limited',dimension_mismatch:'dimension_mismatch',provider_unavailable:'provider_unavailable'});
  const publicCode=code=>Object.hasOwn(controlCodes,code)?controlCodes[code]:productFailure(code).error.code;
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
    const family=maintenanceFailureKind(source);
    if(!ctx.failures.has(family)){saveFailure(Object.freeze({...source,stage:source.stage??stage,number:ctx.number}),ctx.failures.size>0||stage==='close'&&lastFailure!==null);ctx.failures.add(family);}
    if(captured)seenFailures.add(captured);readerSecondary(value,ctx);
  }
  function drain(identity,close,ctx) {
    if(drains.has(identity))return drains.get(identity);
    if(typeof identity==='object'&&disposed.has(identity))return disposed.get(identity);
    const disposal={...ctx,ordinal:identity===ctx.handle?ctx.ordinal:undefined,failures:new Set()};
    const pending=Promise.resolve().then(close).then(()=>readerSecondary(identity,disposal),failure=>{
      note(failure,disposal,'close','cleanup');drainFailed=true;error='reader_failed';throw failure;
    });
    drains.set(identity,pending);if(typeof identity==='object')disposed.set(identity,pending);
    void pending.finally(()=>drains.delete(identity)).catch(()=>{});return pending;
  }
  const dispose=(h,ctx)=>drain(h,()=>disposeProductReader(h,error==='read_timeout'?'read_timeout':'store_closed',ctx.until,ctx.handle===h?lastFailure:undefined),ctx);
  function owns(ctx){return !stopped&&!error&&generation===ctx.generation&&now()<ctx.end;}
  function check(ctx){if(stopped||error)throw interrupted;if(now()>=ctx.until){expire(ctx);throw interrupted;}if(generation!==ctx.generation||now()>=ctx.end)throw interrupted;}
  function expire(ctx){
    if(activeTurn!==ctx||stopped||error)return;
    if(now()<ctx.until){clearTimer(ctx.watchdog);ctx.watchdog=setTimer(()=>expire(ctx),Math.ceil(ctx.until-now()));return;}
    note(undefined,ctx,ctx.stage,'engine','read_timeout');error='read_timeout';ctx.cancel();void stop();
  }
  async function wait(ctx,work,stage) {
    check(ctx);ctx.stage=stage;
    const result=await Promise.race([Promise.resolve().then(()=>{check(ctx);return work();}),ctx.cancelled]);check(ctx);return result;
  }
  async function turn(maxMs,work) {
    maxMs=Math.min(maxMs,budgets.maxMs-usedMs);if(maxMs<1)return;
    const control=maintenanceDispatchControl(),ctx={control,ordinal:maintenanceControlState(control).ordinal,number:turnNumber,generation,end:dutyEnd(),until:now()+maxMs,stage:'call',failures:new Set()};
    turnNumber=add(turnNumber,1);ctx.cancelled=new Promise((_,reject)=>{ctx.cancel=()=>reject(interrupted);});activeTurn=ctx;
    ctx.watchdog=setTimer(()=>expire(ctx),maxMs);
    try{return await work(ctx);}catch(e){if(e!==interrupted){note(e,ctx,ctx.stage);error??=publicCode(e.code);}}finally{clearTimer(ctx.watchdog);if(activeTurn===ctx)activeTurn=undefined;}
  }
  function schedule(){
    if(stopped||error||exhausted()||now()>=renewedUntil){if(!stopped&&!error)resolveCompletion(status());return;}
    fits(turnMs());
    timer=setTimer(tick,parkedUntil===undefined?Math.max(0,c.pollMs-(now()-lastTick)):Math.max(1,Math.min(parkedUntil,dutyEnd())-now()));
  }
  function fits(maxMs){const end=dutyEnd();parkedUntil=end-now()>=maxMs?undefined:end;return parkedUntil===undefined;}
  async function control(ctx,method,input) {
    const result=await wait(ctx,()=>handle.pumpCall(method,input,Math.max(1,Math.ceil(ctx.until-now()))),'call');check(ctx);return result;
  }
  async function reserve(ctx,mode,maxItems,maxMs,maxUsd,bindingId) {
    const result=await control(ctx,'pumpReserve',{mode,maxItems,maxMs,bindingId,window:{...window,usedItems,usedMs,usedUsd},budgets,maxUsd,remainingMs:Math.floor(window.endsAtMonoMs-now())});
    check(ctx);usedItems=result.usedItems;usedMs=result.usedMs;usedUsd=result.usedUsd;return result;
  }
  async function finish(ctx,reservation,known) {
    const result=await control(ctx,'pumpFinish',{id:reservation.id,known});check(ctx);usedItems=result.usedItems;usedMs=result.usedMs;usedUsd=result.usedUsd;
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
        handles.set(id,opened);writers.set(writer,id);return opened;
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
    let result,failure;
    try {
      const h=await maintainer(ctx,p),remaining=Math.floor(ctx.until-now());check(ctx);if(remaining<1)fail('read_timeout');
      // Opening claims its control; later calls require their own joined ordinal.
      if(maintenanceControlState(ctx.control).claimed){ctx.control=maintenanceDispatchControl();ctx.ordinal=maintenanceControlState(ctx.control).ordinal;}
      ctx.handle=h;ctx.stage=method==='refreshContextIndex'?'refresh':'call';
      const args=method==='refreshContextIndex'?{...input,budget:{...input.budget,maxMs:remaining}}:{...input,deadlineMs:remaining};
      result=await wait(ctx,()=>h[method](args,credential,ctx.control),ctx.stage);check(ctx);
      if(!result.ok)note(result,ctx,ctx.stage);
    }catch(e){failure=e;if(e!==interrupted)note(e,ctx,ctx.stage);}
    // A still-owned failed operation settles conservatively. Lost ownership
    // leaves its full reservation charged; no late dispatch or known refund.
    if(generation===ctx.generation&&!stopped&&now()<ctx.until&&now()<ctx.end){
      try {
        const settled=await control(ctx,'pumpFinish',{id:reservation.id,known:!failure&&result?.ok===true});
        check(ctx);usedItems=settled.usedItems;usedMs=settled.usedMs;usedUsd=settled.usedUsd;
      }catch(e){if(e!==interrupted){note(e,ctx,'call');error=publicCode(e.code);}if(!failure)failure=e;}
    }
    // A known failure survives retirement of its accounting await.
    if(result&&!result.ok)error??=publicCode(result.error?.code);
    if(failure)throw failure;return result;
  }
  async function validation(ctx) {
    const observation=await control(ctx,'firstCoverage');check(ctx);targetSetDigest=observation.targetSetDigest;observeCoverage(observation);
    if(!targetSetDigest||firstComplete)return;
    if(!fits(first.maxMs))return;
    const maxMs=Math.min(first.maxMs,budgets.maxMs-usedMs,Math.floor(window.endsAtMonoMs-now()),Math.floor(renewedUntil-now()));
    if(maxMs<1)return;const reservation=await reserve(ctx,'validation',0,maxMs,'0');check(ctx);
    const result=await wait(ctx,()=>coordinator.validateOwnerSemanticCoverage({ownerId:handle.ownerId,expectedTargetDigest:targetSetDigest,budget:{maxTargets:first.maxTargets,maxMs:Math.max(1,Math.floor(ctx.until-now()))}},semanticCredential),'call');check(ctx);
    if(!result.ok)note(result,ctx,'call');
    try{await finish(ctx,reservation,result.ok===true);}
    catch(failure){if(failure!==interrupted)error=publicCode(failure.code);throw failure;}
    finally{if(!result.ok)error??=publicCode(result.error.code);}
    if(!result.ok)return;check(ctx);firstComplete=result.value.status==='complete';const current=await control(ctx,'firstCoverage');check(ctx);observeCoverage(current);
  }
  async function regular(ctx) {
    if(error||stopped||exhausted()||usedItems>=budgets.maxItems||parkedUntil!==undefined||!fits(q.maxMs))return;
    const p=projections[at%projections.length],isEmbedding=p.mode==='embeddings';
    if(isEmbedding){const admission=await control(ctx,'embeddingAdmission');check(ctx);if(!admission.allowed||usd(usedUsd)>=usd(budgets.maxUsd)){at++;return;}}
    check(ctx);if(!fits(q.maxMs))return;
    const maxItems=Math.min(q.maxItems,budgets.maxItems-usedItems),maxMs=Math.min(q.maxMs,budgets.maxMs-usedMs,Math.floor(window.endsAtMonoMs-now()),Math.floor(renewedUntil-now()));
    if(maxItems<1||maxMs<1)return;
    const reservation=await reserve(ctx,p.mode,maxItems,maxMs,isEmbedding?dollars(usd(q.maxUsd)<usd(budgets.maxUsd)-usd(usedUsd)?usd(q.maxUsd):usd(budgets.maxUsd)-usd(usedUsd)):'0',p.bindingId);check(ctx);at++;
    const result=await operation(ctx,p,'refreshContextIndex',{readSet:p.options.readSet,types:p.types,intent:p.intent,mode:p.mode,budget:{maxItems,...(isEmbedding?{maxUsd:reservation.maxUsd}:{})}},reservation);check(ctx);
    if(!result?.ok||error||stopped)return;
    if(isEmbedding){const current=await control(ctx,'firstCoverage');check(ctx);observeCoverage(current);if(result.value.status==='complete')completeTargets.add(JSON.stringify([p.options.path,p.types,p.intent]));}
  }
  async function tick() {
    if(stopped||error||running)return;if(exhausted()||now()>=renewedUntil){resolveCompletion(status());return;}
    const tickGeneration=generation;parkedUntil=undefined;return running=(async()=>{
      if(!fits(turnMs()))return;lastTick=now();
      if(startup){
        for(const target of handle.targets)for(const intent of ['current','history']){
          if(stopped||error||exhausted()||!fits(q.maxMs))return;
          const p=projections.find(p=>p.options.path===target.canonicalPath&&JSON.stringify(p.options.readSet)===JSON.stringify(target.readSet)&&JSON.stringify(p.types)===JSON.stringify(target.types)&&p.intent===intent);
          await turn(Math.min(q.maxMs,budgets.maxMs-usedMs),async ctx=>{
            const reservation=await reserve(ctx,'validation',0,Math.min(q.maxMs,budgets.maxMs-usedMs),'0');
            const result=await operation(ctx,p,'getContextIndexStatus',{readSet:p.options.readSet,types:p.types,intent},reservation);check(ctx);
            if(result?.ok&&!error&&result.value.lexical.state==='ready'&&result.value.semantic.coverage.status==='complete')completeTargets.add(JSON.stringify([p.options.path,p.types,intent]));
          });
          if(stopped||error||generation!==tickGeneration)return;
        }startup=false;
      }
      if(stopped||error||usedMs>=budgets.maxMs||now()>=dutyEnd())return;
      let validated=false;
      await turn(turnMs(),async ctx=>{const current=await control(ctx,'firstCoverage');check(ctx);observeCoverage(current);validated=validationRequired();});
      if(validated&&!error&&!stopped&&generation===tickGeneration){
        await turn(first.maxMs,validation);
      }
      // Select a fresh regular context after observing the actual phase.
      if(!error&&!stopped&&generation===tickGeneration&&parkedUntil===undefined&&fits(q.maxMs))await turn(q.maxMs,regular);
    })().finally(async()=>{await Promise.allSettled([...openings]);running=null;if(error){void stop();return;}schedule();});
  }
  function stop() {
    if(closing)return closing;stopped=true;generation++;activeTurn?.cancel();clearTimer(timer);registry.cleanup(record);
    const ctx=activeTurn??{number:turnNumber,until:now(),failures:new Set()};
    // Cancel/dispose residents before waiting for an outstanding call to settle.
    for(const h of handles.values())void dispose(h,ctx);
    closing=(async()=>{
      await running;await Promise.allSettled([...openings]);
      const results=await Promise.allSettled([...drains.values()]);
      if(drainFailed||results.some(r=>r.status==='rejected'))throw Error('reader_failed');
      registry.finish(record);all.delete(c.id);resolveCompletion(status());
    })();
    closing.catch(()=>{error='reader_failed';registry.finish(record,false);all.delete(c.id);resolveCompletion(status());});return closing;
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
  const entry={api,fingerprint,supervisor:c.supervisor,coordinator,semanticCredentialDigest:credentialDigest(semanticCredential),first,renew(next,w,b){
    if(stopped)fail('store_closed');if(JSON.stringify(next.quantum)!==JSON.stringify(c.quantum)||next.pollMs!==c.pollMs)fail('invalid_input');
    // Settled item exhaustion ends resident duty even if validation can continue.
    const inactive=now()>renewedUntil||now()>window.endsAtMonoMs||!running&&(usedMs>=budgets.maxMs||usedItems>=budgets.maxItems);
    if(w.id!==window.id){if(now()<window.endsAtMonoMs)fail('invalid_input');completePrevious();window=w;budgets=b;usedItems=w.usedItems;usedMs=w.usedMs;usedUsd=w.usedUsd;cycle();}
    else{if(JSON.stringify(b)!==JSON.stringify(budgets)||w.endsAtMonoMs!==window.endsAtMonoMs)fail('invalid_input');usedItems=Math.max(usedItems,w.usedItems);usedMs=Math.max(usedMs,w.usedMs);usedUsd=dollars(usd(usedUsd)>usd(w.usedUsd)?usd(usedUsd):usd(w.usedUsd));}
    generation++;
    if(inactive)residentEpoch++;
    if(settled)cycle();renewedUntil=now()+next.renewalMs;parkedUntil=undefined;clearTimer(timer);if(!running)schedule();
  }};
  all.set(c.id,entry);schedule();return api;
}

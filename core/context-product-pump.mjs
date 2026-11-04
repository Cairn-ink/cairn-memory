import { captureMaintenanceTurnPort, createMaintenanceTurnController, maintenanceTurnPoisoned } from './context-maintenance-turn.mjs';
import { admitMaintenance, refreshMaintenance, maintenanceAdmissionReceipt, isNativeMaintenanceMaintainer } from './context-product-admission.mjs';
import { maintenanceAdmissionIdentity, maintenanceAdmissionDomain, retainMaintenanceAdmission, failMaintenanceAdmission, maintenanceAdmissionStatus, maintenanceAdmissionSlots, maintenanceAdmissionFits } from './context-product-admission-policy.mjs';
import { maintenanceFailureCounts, maintenanceFailureRecord, maintenanceFailureKind, maintenanceErrorName } from './context-product-attribution.mjs';
import { attributionFields, maintenanceWorkFields, maintenanceKinds, add, maintenanceDispatchControl, maintenanceControlState } from './context-product-attribution.mjs';
import { maintenanceComparison } from './context-product-attribution.mjs';
import { openContextIndexMaintainer, disposeProductReader, maintenanceObservation, maintenancePhaseDiagnostic, maintenanceStallDiagnostic, maintenanceCutoffQualified, authorizeMaintenanceCutoff, snapshotMaintenanceCutoff, maintenanceFailureDiagnostic, maintenanceReaderFailureDiagnostic } from './context-product-reader.mjs';
import { supervisorOwner } from './context-read-supervisor.mjs';
import { ownData } from './local-authority-input.mjs';
import { boundedData, hostConfiguration, coverage, PRODUCT_PROFILE } from './context-product-control.mjs';
import { contextReadSet } from './context-read-input.mjs';
import { fail } from './validation.mjs';
import { resolve } from 'node:path';
import { serviceIssuance } from './context-product-service.mjs';
import { credentialDigest } from './context-product-control.mjs';
import { canonicalJson } from './context-product-validation.mjs';
import { semanticPump } from './context-semantic-pump.mjs';

const processKey=Symbol.for('context-read-product-v1.1/pumps');
const state=()=>globalThis[processKey]??={entries:new Map(),ledgers:new Map()};
const integer=(n,max)=>{if(!Number.isSafeInteger(n)||n<1||n>max)fail('invalid_input');return n;};
// Fixed internal diagnostic, attached to each status/completion observation.
// Keep the closed public DTO (including its error/state semantics) unchanged.
// No history, paths, credentials or callbacks; snapshots die with their DTOs.
const pumpDiagnostics=new WeakMap(), phaseDiagnostics=new WeakMap();
export const maintenancePumpPhaseDiagnostic=observation=>phaseDiagnostics.get(observation);
const phaseNames=['drain','open','dispatch','epochObservation','refreshCall','settle','admission'];
const phaseCounter=()=>({count:0,totalMs:0,worstMs:0,latestMs:0});
const recordPhase=(counter,ms)=>{if(Number.isFinite(ms)&&ms>=0){ms=Math.min(Number.MAX_SAFE_INTEGER,ms);counter.count=add(counter.count,1);counter.totalMs=add(counter.totalMs,ms);counter.worstMs=Math.max(counter.worstMs,ms);counter.latestMs=ms;}};
// Log2 buckets: zero, (0,1], (1,2], ...; final bucket includes saturation.
const fieldCounter=()=>({count:0,total:0,max:0,latest:0,buckets:Array(55).fill(0)});
const recordField=(counter,n)=>{counter.count=add(counter.count,1);counter.total=add(counter.total,n);counter.max=Math.max(counter.max,n);counter.latest=n;const bucket=n===0?0:Math.min(54,Math.max(1,Math.ceil(Math.log2(n))+1));counter.buckets[bucket]=add(counter.buckets[bucket],1);};
const freezeTree=value=>{if(value&&typeof value==='object'){Object.values(value).forEach(freezeTree);Object.freeze(value);}return value;};
// Shared configuration is identified by its buffer, never its mutable contents.
// Tagged containers avoid collisions with ordinary host configuration values.
const sharedOptionIds=new WeakMap();let sharedOptionSerial=0;
function optionIdentity(value){
  if(value instanceof SharedArrayBuffer){
    if(!sharedOptionIds.has(value))sharedOptionIds.set(value,++sharedOptionSerial);
    return ['shared',sharedOptionIds.get(value)];
  }
  if(Array.isArray(value))return ['array',value.map(optionIdentity)];
  if(value&&typeof value==='object')return ['object',Object.keys(value).sort().map(k=>[k,optionIdentity(value[k])])];
  return value;
}
export const maintenancePumpDiagnostic=observation=>pumpDiagnostics.get(observation);
// Quotas and renewal identity are host configuration. The process ledger lives
// beyond handle shutdown; a host persists the same monotonic window/quota state
// across process restarts before reopening admission (see the product guide).
export function createMaintenancePumpRuntime({now=()=>Number(process.hrtime.bigint())/1e6,setTimer=setTimeout,clearTimer=clearTimeout,
  open=openContextIndexMaintainer,admit=admitMaintenance,work=refreshMaintenance,receiptOf=maintenanceAdmissionReceipt,admissionIdentity=maintenanceAdmissionIdentity,observedAt=maintenanceObservation,phasesOf=maintenancePhaseDiagnostic,stallOf=maintenanceStallDiagnostic,cutoffQualified=maintenanceCutoffQualified}={}) {
  // Supported host seams and test-only dependencies are documented in
  // docs/context-read-product.md, Amendment v2.1; public renewal adds no options.
  const recoveryEnabled=cutoffQualified();
  return function renewContextMaintenancePump(original) {
    if(ownData(original,['supervisor','id','window','budgets','quantum','pollMs','renewalMs','projections','serviceCredential','semanticConfig','semanticServiceCredential','firstCoverageValidation','preQuantum']).semanticConfig!==undefined)return semanticPump(original,{now,setTimer,clearTimer,open,snapshot:(value,diagnostic)=>pumpDiagnostics.set(value,diagnostic)});
    const c=ownData(original,['supervisor','id','window','budgets','quantum','pollMs','renewalMs','projections','serviceCredential','preQuantum']);
    const previous=state().entries.get(c.id);
    if(previous&&previous.preQuantum!==c.preQuantum)fail('invalid_input');
    const turnPort=previous?previous.turnPort:captureMaintenanceTurnPort(c.preQuantum);
    const {owner,registry}=supervisorOwner(c.supervisor);
    if(owner.closed)fail('store_closed');
    if(typeof c.id!=='string'||!c.id.length||c.id.length>200)fail('invalid_input');
    let window=ownData(c.window,['id','endsAtMonoMs','usedItems','usedMs']);
    if(typeof window.id!=='string'||!window.id.length||window.id.length>200 || !Number.isSafeInteger(window.endsAtMonoMs)||window.endsAtMonoMs<=now()||window.endsAtMonoMs>now()+60000||
      ['usedItems','usedMs'].some(k=>!Number.isSafeInteger(window[k])||window[k]<0))fail('invalid_input');
    let budgets=ownData(c.budgets,['maxItems','maxMs']);
    const quantum=ownData(c.quantum,['maxItems','maxMs']);
    integer(budgets.maxItems,Number.MAX_SAFE_INTEGER);integer(budgets.maxMs,60000);
    integer(quantum.maxItems,1024);integer(quantum.maxMs,5000);integer(c.pollMs,5000);integer(c.renewalMs,60000);
    const credential=boundedData(c.serviceCredential,16384);
    if(!Array.isArray(c.projections)||!c.projections.length||c.projections.length>32)fail('invalid_input');
    // Each active selection includes both intents; host supplies physical type
    // capability explicitly (v18 memory only). Never downgrade a Card request.
    const projections=c.projections.flatMap(p=>{
      const admitted=ownData(p,['options','types']),types=admitted.types;
      const {supervisor,...data}=ownData(admitted.options,['supervisor','path','version','profile','readSet','ownerCoverage','requestControl','host','diagnostics','deadlineMs','sidecarJournalMode','wal']);
      const options={...hostConfiguration(data),supervisor};
      if(options.wal!==undefined && typeof options.wal!=='boolean')fail('invalid_input');
      options.readSet=contextReadSet(options.readSet,PRODUCT_PROFILE);
      options.ownerCoverage=coverage(options.ownerCoverage,options.readSet);
      if(options.supervisor!==c.supervisor)fail('invalid_input');
      const binding=serviceIssuance(options.host.configuration.serviceBinding,options.readSet,options.ownerCoverage);
      if(credentialDigest(credential)!==binding.credentialDigest)fail('authority_required');
      const selected=boundedData(types);
      if(!selected.length||selected.length>2||new Set(selected).size!==selected.length||selected.some(t=>!['memory','card'].includes(t)))fail('invalid_input');
      return ['current','history'].map(intent=>({options,types:selected,intent}));
    });
    // Each fresh admission consumes a non-observing slot. Reserve the final
    // full work quantum as well as every intervening start-to-start spacing.
    const spacing=Math.max(c.pollMs,quantum.maxMs);
    const projectionKey=p=>JSON.stringify([p.options.path,p.options.readSet,canonicalJson(p.options.ownerCoverage),p.types,p.intent,p.options.host.moduleUrl,p.options.wal===true,p.options.sidecarJournalMode]);
    // Intent belongs to each call, not to the resident Worker. Keep all other
    // constructor/scope options in its identity; incompatible policies still drain.
    const residentKey=p=>{const {supervisor,ownerCoverage,...options}=p.options;return JSON.stringify([projectionKey({...p,intent:undefined}),optionIdentity(options)]);};
    const residentKeys=projections.map(residentKey);
    const writerKeys=projections.map(p=>JSON.stringify([resolve(p.options.path),p.options.readSet]));
    const coldSlots=maintenanceAdmissionSlots(residentKeys,writerKeys);
    if(!maintenanceAdmissionFits(projections.length,coldSlots,spacing,quantum.maxMs))fail('invalid_input');
    const admissionDomain=p=>maintenanceAdmissionDomain(admissionIdentity(p.options),quantum.maxMs);
    const fingerprint=JSON.stringify(projections.map((p,i)=>[projectionKey(p),residentKeys[i]]));
    const domainOf=p=>JSON.stringify([resolve(p.options.path),p.options.readSet[0].ownerId,p.options.host.moduleUrl]);
    const domains=[...new Set(projections.map(domainOf))];
    const all=state(), old=all.entries.get(c.id);
    // Recovery state outlives quota ledgers, including unrelated retirement.
    const recoveryDomains=recoveryEnabled ? all.recoveryDomains??=new Map() : null;
    if(old) {
      if(old.fingerprint!==fingerprint || old.supervisor!==c.supervisor)fail('read_in_progress');
      old.renew(c,window,budgets,credential); return old.api;
    }
    function admitLedger(w,b) {
      for(const [key,l] of all.ledgers)if(now()>=l.endsAt)all.ledgers.delete(key);
      if(recoveryEnabled)for(const [domain,r] of recoveryDomains){
        if(!r.pending && r.cooldownUntil<=now() && ![...all.ledgers.values()].some(l=>l.domain===domain) &&
          ![...all.entries.values()].some(e=>e.cutoffDomains?.includes(domain)))recoveryDomains.delete(domain);
      }
      // Validate the entire admission before changing any domain's ledger.
      const candidates=domains.map(domain=>{
        const key=JSON.stringify([domain,w.id]),existing=all.ledgers.get(key);
        if(existing) {
          if(existing.endsAt!==w.endsAtMonoMs||existing.maxItems!==b.maxItems||existing.maxMs!==b.maxMs)fail('invalid_input');
        } else if([...all.ledgers.values()].some(l=>l.domain===domain))fail('invalid_input');
        return {key,ledger:existing??{domain,endsAt:w.endsAtMonoMs,maxItems:b.maxItems,maxMs:b.maxMs,items:w.usedItems,ms:w.usedMs}};
      });
      if(all.ledgers.size+candidates.filter(x=>!all.ledgers.has(x.key)).length>1024)fail('read_in_progress');
      if(recoveryEnabled && recoveryDomains.size+domains.filter(d=>!recoveryDomains.has(d)).length>1024)fail('read_in_progress');
      for(const {key,ledger} of candidates){
        ledger.floorItems=Math.max(ledger.floorItems??0,w.usedItems);ledger.floorMs=Math.max(ledger.floorMs??0,w.usedMs);
        ledger.items=Math.max(ledger.items,ledger.floorItems);ledger.ms=Math.max(ledger.ms,ledger.floorMs);
        if(recoveryEnabled && !recoveryDomains.has(ledger.domain))recoveryDomains.set(ledger.domain,{pending:0,pendingUntil:0,cooldownUntil:0});
        all.ledgers.set(key,ledger);
      }
      return new Map(candidates.map(({ledger})=>[ledger.domain,ledger]));
    }
    let ledgers=admitLedger(window,budgets);
    const record=registry.register(owner,{path:projections[0].options.path,domain:'context-read-product-v1.1/pump/'+c.id});
    let timer,closing,stopped=false,running,disposalCutoff,lastTick=now(),at=0,renewedUntil=now()+c.renewalMs,error=null,grant=credential;
    const turns=turnPort?createMaintenanceTurnController(turnPort,{now,setTimer,clearTimer}):undefined;
    let pendingAdmission,admissionGeneration=0,retryNotBefore=0,unbrokeredPoison=false;
    let report,completion,settled=false;
    function cycle(){settled=false;completion=new Promise(resolve=>{report=value=>{settled=true;resolve(value);};});}cycle();
    const handles=new Map(),writers=new Map(),handleLanes=new Map(),admittedHandles=new WeakSet();
    let cutoffDiagnostic,cancelRecovery,lastFailure=null;const failureCounts=maintenanceFailureCounts(),secondaryFailureCounts=maintenanceFailureCounts();let secondaryFailure=null;
    const pendingDrains=new Map(),failedDrains=new Map(),drainErrors=new WeakSet(),seenReaderFailures=new WeakSet(),readerSecondaryCounts=new WeakMap(),readerSources=new WeakMap(),cutoffFailures=new WeakMap();
    // Fixed 10-ms elapsed counters (last bucket is >5000 ms), never samples.
    // At most 64 lanes; no identities, paths, grants or content enter snapshots.
    let quantumNumber=0,residentEpoch=0;
    const phases=projections.map(()=>({phases:Object.fromEntries(phaseNames.map(k=>[k,phaseCounter()])),
      opens:0,quanta:0,first:null,latest:null,worstElapsedMs:0,elapsedBuckets:Array(502).fill(0),work:{},attribution:Object.fromEntries(attributionFields.map(k=>[k,fieldCounter()])),lastFailure:null,failureCounts:maintenanceFailureCounts(),secondaryFailure:null,secondaryFailureCounts:maintenanceFailureCounts(),lastStall:null,stallCounts:Array(maintenanceKinds.length).fill(0)}));
    function saveFailure(index,failure){
      if(!failure||!phases[index])return;
      const kind=maintenanceFailureKind(failure);if(!Object.hasOwn(failureCounts,kind))return;
      lastFailure=Object.freeze({...failure,lane:index});phases[index].lastFailure=lastFailure;
      phases[index].failureCounts[kind]=add(phases[index].failureCounts[kind],1);failureCounts[kind]=add(failureCounts[kind],1);
    }
    function saveSecondary(index,failure,counts){
      if(!failure||!phases[index])return;
      secondaryFailure=Object.freeze({...failure,lane:index});phases[index].secondaryFailure=secondaryFailure;
      for(const kind of Object.keys(secondaryFailureCounts)){
        const n=counts?.[kind]??(kind===maintenanceFailureKind(failure)?1:0);
        if(Number.isSafeInteger(n)&&n>0){phases[index].secondaryFailureCounts[kind]=add(phases[index].secondaryFailureCounts[kind],n);secondaryFailureCounts[kind]=add(secondaryFailureCounts[kind],n);}
      }
    }
    function readerSecondary(index,value,number){
      const diagnostic=maintenanceReaderFailureDiagnostic(value),identity=maintenanceFailureDiagnostic(value);
      if(!diagnostic?.secondaryFailure||!identity)return;
      const previous=readerSecondaryCounts.get(identity),counts={};let changed=false;
      for(const kind of Object.keys(secondaryFailureCounts)){counts[kind]=Math.max(0,diagnostic.secondaryFailureCounts[kind]-(previous?.[kind]??0));changed ||= counts[kind]>0;}
      readerSecondaryCounts.set(identity,diagnostic.secondaryFailureCounts);
      if(changed)saveSecondary(index,{...diagnostic.secondaryFailure,...(number===undefined?{}:{number})},counts);
    }
    async function drain(key,index=handleLanes.get(key),number,cause){
      // Attribution follows the resident being disposed, not its replacement.
      const failureLane=handleLanes.get(key)??index;
      const started=now();
      try{const handle=handles.get(key);await disposeProductReader(handle,cause??(error==='read_timeout'?error:'store_closed'),disposalCutoff,cutoffFailures.get(handle));readerSecondary(failureLane,maintenanceFailureDiagnostic(handle)?handle:readerSources.get(handle),number);handles.delete(key);handleLanes.delete(key);}
      catch(error){
        if(error&&typeof error==='object')drainErrors.add(error);
        if(!failedDrains.has(key)){
          failedDrains.set(key,true);
          const found=maintenanceFailureDiagnostic(error),failure={...(found??maintenanceFailureRecord('cleanup',{stage:'close'})),...(number===undefined?{}:{number})};
          const primary=number!==undefined&&lastFailure?.number===number?lastFailure:undefined;
          // Equal values identify one call only with a valid shared ordinal.
          const samePrimary=found&&primary&&Number.isSafeInteger(found.ordinal)&&found.ordinal>0&&['cause','ordinal','engineCode','errorName','step','stage'].every(field=>found[field]===primary[field]);
          if(!found||!seenReaderFailures.has(found)&&!samePrimary){if(primary)saveSecondary(failureLane,failure);else saveFailure(failureLane,failure);}
          if(found)seenReaderFailures.add(found);
          readerSecondary(failureLane,error,number);
        }
        throw error;
      }
      finally{recordPhase(phases[index].phases.drain,now()-started);}
    }
    // Initial observations are due within five seconds of activation. Expired
    // authority/quota starts a new duty interval when explicitly renewed.
    const observations=projections.map(()=>lastTick);
    const missed=projections.map(()=>false);
    let cadenceMisses=0,worstGapMs=0,lastObservation=null;
    function checkCadence(time){
      for(let i=0;i<observations.length;i++){
        // Duty ends at authority/window expiry, even if delivery is later.
        const until=Math.min(time,renewedUntil,ledgers.get(domainOf(projections[i])).endsAt);
        const gap=until-observations[i];
        if(gap<=5000)continue;
        if(!missed[i]){missed[i]=true;cadenceMisses++;turns?.missedObservation();}
        worstGapMs=Math.max(worstGapMs,gap);
      }
    }
    function observation(){
      if(poisonedClaim()){error='reader_failed';if(!stopped)void stop();}
      checkCadence(now());
      const value=Object.freeze({id:c.id,state:error?'failed':stopped?'stopped':exhausted()?'budget_exhausted':now()>=renewedUntil?'renewal_expired':'active',
        windowId:window.id,usedItems:Math.max(...[...ledgers.values()].map(l=>l.items)),usedMs:Math.max(...[...ledgers.values()].map(l=>l.ms)),maxItems:budgets.maxItems,maxMs:budgets.maxMs,error});
      pumpDiagnostics.set(value,Object.freeze({cadenceMisses,worstGapMs,observation:lastObservation,lastFailure,failureCounts:Object.freeze({...failureCounts}),secondaryFailure,secondaryFailureCounts:Object.freeze({...secondaryFailureCounts}),...(turns?turns.snapshot(admissionHold()):unbrokeredPoison?{turnPhase:'poisoned'}:{}),admission:Object.freeze(projections.map(p=>{const state=admissionDomain(p);return state.attempts||state.pending||state.quarantined||state.held?maintenanceAdmissionStatus(state):null;}))}));
      phaseDiagnostics.set(value,freezeTree(structuredClone({elapsedBucketMs:10,projections:phases})));
      snapshotMaintenanceCutoff(value,cutoffDiagnostic);
      return value;
    }
    function admissionHold(){
      const states=projections.map(admissionDomain);
      return {held:states.some(s=>s.held||s.quarantined),attempts:Math.max(...states.map(s=>s.quarantined?maintenanceAdmissionStatus(s).attempts:s.attempts))};
    }
    function poisonedClaim(){
      if(turns)return projections.some(p=>turns.isPoisoned(admissionIdentity(p.options)));
      return unbrokeredPoison ||= projections.some(p=>maintenanceTurnPoisoned(()=>admissionIdentity(p.options)));
    }
    // Stop this selection conservatively at its first exhausted domain; a new
    // selection can still use another domain, but cannot recharge this one.
    function exhausted(){return [...ledgers.values()].some(l=>now()>=l.endsAt||l.maxItems-l.items<quantum.maxItems||l.maxMs-l.ms<quantum.maxMs);}
    function stop(){
      if(closing)return closing;
      let resolveClose,rejectClose;
      if(turns)closing=new Promise((resolve,reject)=>{resolveClose=resolve;rejectClose=reject;});
      stopped=true;clearTimer(timer);pendingAdmission?.controller.abort();cancelRecovery?.();registry.cleanup(record);
      const cleanup=(async()=>{
        if(turns)await pendingAdmission?.done;
        await running;
        const disposed=await Promise.allSettled([...handles.keys()].map(key=>pendingDrains.get(key)??(turns&&failedDrains.has(key)?Promise.reject(Error('reader_failed')):drain(key,undefined,error?lastFailure?.number:undefined))));
        if(disposed.some(r=>r.status==='rejected'))throw Error('reader_failed');
        registry.finish(record);all.entries.delete(c.id);report(observation());
      })();
      if(turns)cleanup.then(resolveClose,rejectClose);else closing=cleanup;
      // Return the observed promise itself. An async wrapper would create an
      // additional rejecting promise when timer/supervisor callers discard it.
      closing.catch(()=>{error='reader_failed';registry.finish(record,false);all.entries.delete(c.id);report(observation());});
      return closing;
    }
    record.stop=()=>{void stop();};
    function interval(){
      // Spread nominal full reservations over a minute, capped by the
      // five-second round-robin sweep. Small host budgets may still exhaust
      // before the minute ends; pacing cannot manufacture quota.
      const turns=Math.min(...[...ledgers.values()].map(l=>{
        const lanes=projections.filter(p=>domainOf(p)===l.domain).length;
        const slots=Math.min(l.maxItems/quantum.maxItems,l.maxMs/quantum.maxMs);
        return slots*projections.length/lanes;
      }));
      return Math.max(spacing,Math.min(5000/projections.length,60000/Math.max(1,turns)));
    }
    const needsAdmission=index=>!admittedHandles.has(handles.get(JSON.stringify([residentKeys[index],residentEpoch])));
    function schedule(){
      if(turns&&(pendingAdmission||running))return;
      if(stopped||error||exhausted()||now()>=renewedUntil)return;
      if(Math.min(window.endsAtMonoMs,renewedUntil)-now()<quantum.maxMs){
        timer=setTimer(tick,Math.max(1,Math.min(window.endsAtMonoMs,renewedUntil)-now()));return;
      }
      // Simulate the pending lane's work and all resident replacements before
      // each observation. An admission consumes spacing but earns no deadline.
      const cache=new Map([...writers].filter(([,key])=>admittedHandles.has(handles.get(key))));
      let slots=0;const deadlines=[];
      for(let n=0;n<projections.length;n++){
        const i=(at+n)%projections.length,key=JSON.stringify([residentKeys[i],residentEpoch]),writer=writerKeys[i];
        if(cache.get(writer)!==key){slots++;cache.set(writer,key);}
        deadlines.push(observations[i]+5000-quantum.maxMs-slots*spacing);slots++;
      }
      let due=Math.min(...deadlines);
      if(recoveryEnabled){
        const order=projections.map((_,i)=>(at+i)%projections.length).filter(i=>!cooling(i));
        if(!order.length){
          const next=Math.min(Math.max(lastTick+spacing,Math.min(...[...ledgers.keys()].map(eligibleAt))),renewedUntil,window.endsAtMonoMs);
          timer=setTimer(tick,Math.max(1,next-now()));return;
        }
        due=Math.min(due,...order.map((i,position)=>observations[i]+5000-quantum.maxMs-(position+coldSlots)*spacing));
      }
      // After a cadence miss the old deadline can be in the past. Recover in
      // round-robin order without violating spacing or spinning overdue timers.
      const gate=admissionDomain(projections[at%projections.length]);
      // A sidecar hold also blocks brokered resident work. Park at the
      // horizon so an overdue work lane cannot spin on declined grants.
      const eligible=turns&&(gate.held||gate.quarantined)?Math.min(renewedUntil,window.endsAtMonoMs):!needsAdmission(at%projections.length)?0:gate.held||gate.quarantined||gate.pending?Math.min(renewedUntil,window.endsAtMonoMs):gate.busy?now()+spacing:gate.until;
      timer=setTimer(tick,Math.max(0,Math.min(Math.max(eligible,turns?retryNotBefore:0,lastTick+spacing,Math.min(lastTick+interval(),due)),renewedUntil,window.endsAtMonoMs)-now()));
    }
    const eligibleAt=domain=>{const r=recoveryDomains.get(domain);return Math.max(r?.cooldownUntil??0,r?.pending?Math.max(r.pendingUntil,now()+spacing):0);};
    const cooling=index=>recoveryEnabled && eligibleAt(domainOf(projections[index]))>now();
    function selectedLane(){
      let index=at%projections.length;
      if(recoveryEnabled){let skipped=0;while(cooling(index)&&++skipped<projections.length)index=(index+1)%projections.length;}
      return index;
    }
    function turnFailure(code){error=code;void stop();}
    function requestTurn(){
      if(pendingAdmission||running)return;
      const index=selectedLane(),epoch=residentEpoch,generation=admissionGeneration,p=projections[index];
      let finishAdmission;
      const controller=new AbortController(),attempt={controller,done:new Promise(resolve=>{finishAdmission=resolve;})};
      // Install the latch before invoking any host callback (including a
      // synchronous/reentrant factory). Waiting is never a reservation.
      pendingAdmission=attempt;
      const task=(async()=>{
        let identity,result;
        try{
          identity=admissionIdentity(p.options);
          result=await turns.wait({version:1,pumpId:c.id,windowId:window.id,lane:index,family:'lexical',kind:'lexical',
            phase:needsAdmission(index)?'admission':'work',intent:p.intent,maxMs:quantum.maxMs},
          {signal:controller.signal,identity,untilMonoMs:Math.min(now()+turnPort.maxWaitMs,Math.min(window.endsAtMonoMs,renewedUntil)-quantum.maxMs)});
        }catch{result={status:'failed',error:'reader_failed'};}
        checkCadence(now());
        pendingAdmission=undefined;
        if(result.status==='failed'){turnFailure(result.error);return;}
        if(result.status!=='admitted'){
          if(result.status==='defer')retryNotBefore=now()+interval();
          if(exhausted()||now()>=renewedUntil)report(observation());
          schedule();return;
        }
        attempt.ticket=result.ticket;
        if(!turns.portUnchanged()){
          const released=turns.release(result.ticket,'withdrawn');
          turnFailure(released==='poisoned'?'reader_failed':'authority_required');return;
        }
        const currentIdentity=admissionIdentity(p.options),currentGate=maintenanceAdmissionDomain(currentIdentity,quantum.maxMs);
        turns.bindIdentity(result.ticket,currentIdentity);
        let reason;
        // Recompute every amount and condition synchronously from current
        // state. No captured ledger, grant or elapsed origin crosses the wait.
        if(stopped||error)reason='stopped';
        else if(generation!==admissionGeneration)reason='generation_changed';
        else if(Math.min(window.endsAtMonoMs,renewedUntil)-now()<quantum.maxMs)reason='renewal_expired';
        else if(exhausted())reason='budget_exhausted';
        else if(now()<lastTick+spacing||now()<retryNotBefore)reason='spacing';
        else if(index!==selectedLane()||epoch!==residentEpoch)reason='lane_changed';
        else {
          const gate=currentGate;
          if(gate.held||gate.quarantined||needsAdmission(index)&&(gate.pending||gate.busy||gate.until>now()))reason='admission_held';
        }
        if(turns.isPoisoned(currentIdentity)){reason??='stopped';error='reader_failed';}
        if(reason){
          const released=turns.release(result.ticket,'declined',reason);
          if(released==='poisoned')error='reader_failed';else if(released==='authority_required')error='authority_required';
          if(error){void stop();return;}
          if(exhausted()||now()>=renewedUntil)report(observation());schedule();return;
        }
        return tick(result.ticket,index);
      })();
      task.then(finishAdmission,()=>{
        if(attempt.ticket)turns.poison(attempt.ticket);
        if(pendingAdmission===attempt)pendingAdmission=undefined;
        turnFailure('reader_failed');finishAdmission();
      });
      return attempt.done;
    }
    function tick(ownedTurn,selectedIndex){
      if(turns&&!ownedTurn&&(pendingAdmission||running))return;
      if(!ownedTurn){
        if(stopped||error)return;
        checkCadence(now());
        if(exhausted()||now()>=renewedUntil){report(observation());return;}
        if(Math.min(window.endsAtMonoMs,renewedUntil)-now()<quantum.maxMs){schedule();return;}
        if(poisonedClaim()){turnFailure('reader_failed');return;}
        const gate=admissionDomain(projections[at%projections.length]);
        if((turns&&(gate.held||gate.quarantined))||needsAdmission(at%projections.length)&&(gate.held||gate.quarantined||gate.pending||gate.busy||gate.until>now())){schedule();return;}
        if(recoveryEnabled && projections.every((_,i)=>cooling(i))){schedule();return;}
        if(turns&&!ownedTurn){
          if(now()<lastTick+spacing||now()<retryNotBefore){schedule();return;}
          return requestTurn();
        }
      }
      lastTick=now();
      let disposalUnproven=false,recoveryDisposal,recoveryDeadline;
      let quantumTimer,lane,sequence,settleStarted,deliveryMs=0,activeHandle,activeControl,ordinal,openingOrdinal,quantumDetail={},stallRecorded=false,capability,recovery,activeStage='open',admissionTurn=false,admissionTimedOut=false,admissionState,admissionSucceeded=false,originalLedger,reservedItems,reservedMs,activeKey,admissionDrain;
      const recordedFailures=new Set();
      function recordFailure(value,kind='engine',detail={}){
        if(!lane||value&&typeof value==='object'&&drainErrors.has(value))return;
        const found=maintenanceFailureDiagnostic(value),captured=kind!=='disposal_proof'&&(found?.ordinal===undefined||found.ordinal===ordinal)?found:undefined,stamp=now();
        if(kind==='cleanup'&&captured&&seenReaderFailures.has(captured)&&recordedFailures.has('open_exceeds_quantum')){readerSecondary(phases.indexOf(lane),value,sequence);return;}
        const source=kind==='open_exceeds_quantum'?maintenanceFailureRecord(kind,{...detail,ordinal,stall:captured?.stall??stallOf(value,stamp)??stallOf(activeHandle??activeControl,stamp)}):captured??maintenanceFailureRecord(kind,{...detail,ordinal,stall:stallOf(value,stamp)??stallOf(activeHandle??activeControl,stamp)});
        const key=maintenanceFailureKind(source);if(recordedFailures.has(key)){
          // A later reader copy joins the already-recorded admission cutoff;
          // retain its cleanup deltas without recounting that initiating error.
          if(kind==='open_exceeds_quantum'&&captured){seenReaderFailures.add(captured);if(activeHandle)readerSources.set(activeHandle,value);readerSecondary(phases.indexOf(lane),value,sequence);}
          return;
        }
        const secondary=recordedFailures.size>0;recordedFailures.add(key);
        const index=phases.indexOf(lane),failure=Object.freeze({...source,stage:source.stage??activeStage,number:sequence});
        if(secondary)saveSecondary(index,failure);else saveFailure(index,failure);
        if(activeHandle&&failure.cause==='engine'&&failure.engineCode==='read_timeout')cutoffFailures.set(activeHandle,failure);
        if(captured){seenReaderFailures.add(captured);if(activeHandle)readerSources.set(activeHandle,value);}
        readerSecondary(index,value,sequence);
      }
      function recordStall(value){
        if(stallRecorded||!lane)return;
        const stall=ordinal===null?{kind:0,runningMs:0,unitCount:0,unattributed:1}:stallOf(value??activeControl,now());
        if(stall?.ordinal!==undefined&&stall.ordinal!==ordinal)return;
        if(!stall||!Number.isInteger(stall.kind)||!maintenanceKinds[stall.kind]||!Number.isFinite(stall.runningMs)||stall.runningMs<0||!Number.isSafeInteger(stall.unitCount)||stall.unitCount<0)return;
        lane.lastStall={number:sequence,...(ordinal===null?{}:{ordinal}),kind:stall.kind,runningMs:Math.min(Number.MAX_SAFE_INTEGER,stall.runningMs),unitCount:stall.unitCount,...(stall.pendingDispatch===undefined?{}:{pendingDispatch:stall.pendingDispatch}),...(stall.unattributed===1?{unattributed:1}:{})};
        lane.stallCounts[stall.kind]=add(lane.stallCounts[stall.kind],1);stallRecorded=true;
      }
      function exceedAdmission(value){admissionTimedOut=true;admissionState.pending=true;error='read_timeout';recordFailure(value,'open_exceeds_quantum');}
      let resolveTurn,rejectTurn;
      const ownedRunning=ownedTurn?new Promise((resolve,reject)=>{resolveTurn=resolve;rejectTurn=reject;}):undefined;
      if(ownedTurn)running=ownedRunning;
      const execution=(async()=>{
        try {
          let index=ownedTurn?selectedIndex:at%projections.length;
          if(recoveryEnabled&&!ownedTurn){
            let skipped=0;while(cooling(index)&&++skipped<projections.length)index=++at%projections.length;
            if(cooling(index))return;
          }
          const p=projections[index],dispatchEpoch=residentEpoch,key=JSON.stringify([residentKeys[index],dispatchEpoch]),ledger=ledgers.get(domainOf(p));
          const maxItems=quantum.maxItems,maxMs=quantum.maxMs;
          if(maxItems<1||maxMs<1)return;
          disposalCutoff=lastTick+maxMs;
          // Reserve the full quantum before dispatch. Unknown usage remains
          // charged after crash/timeout; restarting or renewing cannot refund it.
          ledger.items+=maxItems;ledger.ms+=maxMs;
          originalLedger=ledger;reservedItems=maxItems;reservedMs=maxMs;activeKey=key;
          const existing=handles.get(key);admissionTurn=!existing||!admittedHandles.has(existing);admissionState=admissionDomain(p);if(admissionTurn)admissionState.busy=true;
          lane=phases[index];sequence=quantumNumber;quantumNumber=add(quantumNumber,1);
          // Disposal can await a Worker/host resource. Expose timeout even if
          // that await has not settled; supervision still owns the drain.
          activeControl=maintenanceDispatchControl();ordinal=maintenanceControlState(activeControl).ordinal;
          // Outcomes: pending, recovered, proof deadline, failed proof, closed, allowance spent.
          const describeCutoff=outcome=>cutoffDiagnostic={ordinal,lane:index,quantum:sequence,resident:dispatchEpoch,cutoff:1,
            chargedItems:maxItems,chargedMs:maxMs,disposalMs:0,outcome,allowance:ledger.recoveries??0,cooldownUntil:0};
          const recover=()=>recovery??= (async()=>{
            const started=now(),proofDeadline=()=>Math.min(capability.cutoffAt,Number(BigInt(capability.operation.operationCutoffMonoNs))/1e6)+1000;
            const domainRecovery=recoveryDomains.get(domainOf(p));
            domainRecovery.pending++;domainRecovery.pendingUntil=Math.max(domainRecovery.pendingUntil,proofDeadline());
            let confirmationTimer;describeCutoff(0);
            try {
              const drainPromise=drain(key,index,sequence);pendingDrains.set(key,drainPromise);
              const forget=()=>{if(pendingDrains.get(key)===drainPromise)pendingDrains.delete(key);};
              drainPromise.then(forget,forget);
              const disposal=drainPromise.then(()=>capability.proof());
              if(ownedTurn){recoveryDisposal=disposal;recoveryDeadline=proofDeadline;disposal.catch(()=>{});}
              const confirmed=await Promise.race([disposal.then(()=>true),new Promise(resolve=>{
                capability.rescheduleProof=()=>{clearTimer(confirmationTimer);confirmationTimer=setTimer(()=>resolve(false),Math.max(0,proofDeadline()-now()));};
                capability.rescheduleProof();
              }),new Promise(resolve=>{cancelRecovery=()=>{clearTimer(confirmationTimer);resolve(null);};})]);
              cutoffDiagnostic.disposalMs=Math.max(0,now()-started);
              if(confirmed===null){cutoffDiagnostic.outcome=4;return;}
              if(!confirmed || now()>proofDeadline()){if(ownedTurn){disposalUnproven=true;turns.poison(ownedTurn);}cutoffDiagnostic.outcome=2;error=ownedTurn?'reader_failed':'read_timeout';return;}
              for(const [writer,handle] of writers)if(handle===key)writers.delete(writer);
              if(stopped){cutoffDiagnostic.outcome=4;return;}
              if((ledger.recoveries??0)>=2){cutoffDiagnostic.outcome=5;error='read_timeout';return;}
              ledger.recoveries=(ledger.recoveries??0)+1;
              const until=now()+1000;
              domainRecovery.cooldownUntil=Math.max(domainRecovery.cooldownUntil,until);
              cutoffDiagnostic.allowance=ledger.recoveries;cutoffDiagnostic.cooldownUntil=until;cutoffDiagnostic.outcome=1;
            } catch(failure){if(ownedTurn)disposalUnproven=true;recordFailure(failure,'disposal_proof',{stage:'disposal'});cutoffDiagnostic.outcome=3;error='reader_failed';}
            finally {domainRecovery.pending--;clearTimer(confirmationTimer);capability.rescheduleProof=undefined;cancelRecovery=undefined;}
          })();
          quantumTimer=setTimer(()=>{
            recordStall(activeHandle);
            if(admissionTurn){
              exceedAdmission();
              if(activeHandle){admissionDrain=drain(key,index,sequence,'read_timeout');admissionDrain.catch(()=>{});}
              return;
            }
            recordFailure(activeHandle,'engine',{engineCode:'read_timeout'});
            if(capability && (capability.attested||capability.expire?.())){
              if((ledger.recoveries??0)<2){void recover();return;}describeCutoff(5);
            }
            error='read_timeout';void stop();
          },Math.max(0,maxMs-(now()-lastTick)));
          let h=handles.get(key),openedHere=false;
          if(!h){
            // Native admission permits one maintainer per physical selection,
            // across intents/types/journal policies. Drain before replacing its
            // full-key handle; never weaken admission to populate this cache.
            const writer=JSON.stringify([resolve(p.options.path),p.options.readSet]),previous=writers.get(writer);
            if(previous!==undefined){activeStage='close';await drain(previous,index,sequence);writers.delete(writer);activeStage='open';}
            if(stopped||error||admissionTimedOut)return;
            const openingMs=Math.min(maxMs,Math.floor(maxMs-(now()-lastTick)));
            if(openingMs<1){exceedAdmission();return;}
            const opening=now();openingOrdinal=ordinal;
            try{h=await open({...p.options,deadlineMs:openingMs},activeControl);openedHere=true;lane.opens=add(lane.opens,1);handles.set(key,h);handleLanes.set(key,index);writers.set(writer,key);}
            finally{recordPhase(lane.phases.open,now()-opening);}
            // Either default dispatch needs native identity. Hosts wrapping the
            // handle must bridge both calls; terminal stop owns its disposal.
            if((admit===admitMaintenance||work===refreshMaintenance)&&!isNativeMaintenanceMaintainer(h)){
              recordFailure(h,'maintainer_identity_unrecognized',{stage:'open'});error='invalid_input';return;
            }
          }
          activeHandle=h;activeStage=admissionTurn?'admission':'refresh';
          if(stopped||error)return;
          const remainingMs=Math.min(maxMs,Math.floor(maxMs-(now()-lastTick)));
          if(remainingMs<1){recordStall(h);if(admissionTurn){exceedAdmission();return;}recordFailure(h,'engine',{engineCode:'read_timeout'});error='read_timeout';return;}
          if(openedHere){
            activeControl=maintenanceDispatchControl();ordinal=maintenanceControlState(activeControl).ordinal;
          }
          if(!admissionTurn && recoveryEnabled && ordinal!==null)capability=authorizeMaintenanceCutoff(activeControl,{pumpEpoch:record.id,ordinal,ledger,cutoffAt:lastTick+maxMs,quantum:sequence,resident:dispatchEpoch,lane:index});
          if(!admissionTurn)at=index+1;
          const refreshing=now();let result;
          try{result=await (admissionTurn?admit:work)(h,{readSet:p.options.readSet,types:p.types,intent:p.intent,mode:'lexical',budget:{maxItems,maxMs:remainingMs}},grant,activeControl);}
          finally{settleStarted=now();recordPhase(lane.phases[admissionTurn?'admission':'refreshCall'],settleStarted-refreshing);}
          if(admissionTurn) {
            const detail=phasesOf(result);
            if(detail){recordPhase(lane.phases.dispatch,detail.dispatchMs);if(Number.isFinite(detail.deliveryMs)&&detail.deliveryMs>=0)deliveryMs=detail.deliveryMs;}
            if(admissionTimedOut||now()-lastTick>maxMs||result?.error?.code==='read_timeout'){exceedAdmission(result);return;}
            if(!result?.ok){recordFailure(result,'engine',{engineCode:result?.error?.code});error=result?.error?.code??'reader_failed';return;}
            // This private receipt is deliberately independent of observation.
            if(receiptOf(result)!=='admitted'){recordFailure(result,'protocol',{protocolKind:'result_shape'});error='reader_failed';return;}
            admittedHandles.add(h);admissionSucceeded=true;return;
          }
          if(receiptOf(result)==='required'){at=index;admittedHandles.delete(h);return;}
          // dispatch: call entry to Worker receipt; epochObservation: the final
          // fresh snapshot transaction. refreshCall includes both. settle adds
          // Worker response delivery/validation and pump accounting. These
          // overlapping durations must not be summed as a quantum breakdown.
          const detail=phasesOf(result);
          const comparison=maintenanceComparison(result);
          if(comparison)lane.comparison={status:comparison.status,rows:comparison.rows,bytes:comparison.bytes};
          if(detail){
            recordPhase(lane.phases.dispatch,detail.dispatchMs);
            recordPhase(lane.phases.epochObservation,detail.epochObservationMs);
            if(Number.isFinite(detail.deliveryMs)&&detail.deliveryMs>=0)deliveryMs=detail.deliveryMs;
            for(const name of maintenanceWorkFields){
              const n=detail[name];if(Number.isSafeInteger(n)&&n>=0)lane.work[name]=Math.min(Number.MAX_SAFE_INTEGER,(lane.work[name]??0)+n);
            }
          }
          for(const name of attributionFields){const n=detail?.[name];if(Number.isFinite(n)&&n>=0){quantumDetail[name]=Math.min(Number.MAX_SAFE_INTEGER,n);recordField(lane.attribution[name],quantumDetail[name]);}}
          if(result?.ok===false)recordFailure(result,'engine',{engineCode:result.error?.code});
          if(result?.error?.code==='read_timeout')recordStall(result);
          if(recovery){await recovery;return;}
          if(result?.error?.code==='read_timeout' && capability?.attested){
            if((ledger.recoveries??0)<2){await recover();return;}describeCutoff(5);
          }
          if(error)return;
          if(!result.ok){error=result.error.code;return;}
          const time=observedAt(result),finished=now();
          // Missing timing is uncertain, never an invented observation at
          // admission/delivery. A quantum overrun retains its full reservation.
          if(finished-lastTick>maxMs){recordStall(h);recordFailure(h,'engine',{engineCode:'read_timeout'});error='read_timeout';return;}
          if(!Number.isFinite(time)||time<lastTick||time>finished){recordFailure(result,'observation_timing',{stage:'observation'});error='reader_failed';return;}
          checkCadence(time);
          lastObservation=Object.freeze({projection:index,atMonoMs:time,gapMs:time-observations[index],cadenceMiss:missed[index]});
          at=index+1;
          observations[index]=time;
          missed[index]=false;
          checkCadence(finished);
          // A successful settled quantum reports all transformation attempts,
          // including rolled-back work. Elapsed time includes opening/draining
          // and delivery. Missing/invalid usage or any failed settlement keeps
          // the full reservation. Host floors applied during renewal also stay.
          const items=result.value?.progress?.transformed,elapsed=Math.ceil(now()-lastTick);
          if(Number.isSafeInteger(items)&&items>=0&&items<=maxItems&&Number.isSafeInteger(elapsed)&&elapsed>=0&&elapsed<=maxMs){
            ledger.items=Math.max(ledger.items-maxItems+items,ledger.floorItems);
            ledger.ms=Math.max(ledger.ms-maxMs+elapsed,ledger.floorMs);
          }
        } catch(e){
          if(admissionTurn&&admissionState&&(admissionTimedOut||e.code==='read_timeout'||now()-lastTick>reservedMs))exceedAdmission(e);
          else recordFailure(e,'call_error',{errorName:maintenanceErrorName(e),stage:'call'});
          if(admissionTimedOut&&e&&typeof e==='object'&&drainErrors.has(e)){admissionState.quarantined=true;admissionState.held=true;}
          if(e.code==='read_timeout')recordStall(e);if(!admissionTimedOut)error=e.code??'reader_failed';
          // An opening failure returns no handle; its cleanup ID still owns disposal.
          if(e.cleanupId)try{await c.supervisor.drain(e.cleanupId);}catch(failure){if(ownedTurn)disposalUnproven=true;if(admissionTimedOut){admissionState.quarantined=true;admissionState.held=true;}recordFailure(failure,'cleanup',{stage:'close'});readerSecondary(phases.indexOf(lane),e,sequence);error='reader_failed';}
        }
      })().finally(async()=>{
        if(ownedTurn)turns.settling(ownedTurn);
        async function rejectAdmission(){
          exceedAdmission();admissionSucceeded=false;
          let confirmed=!admissionState.quarantined;
          try {
            if(admissionDrain)await admissionDrain;
            else if(handles.has(activeKey))await drain(activeKey,phases.indexOf(lane),sequence,'read_timeout');
            for(const [writer,id] of writers)if(id===activeKey)writers.delete(writer);
          }
          catch {confirmed=false;error='reader_failed';if(ownedTurn)disposalUnproven=true;}
          try {retainMaintenanceAdmission(admissionIdentity(projections[phases.indexOf(lane)].options),quantum.maxMs,admissionState);}
          catch(failure){confirmed=false;recordFailure(failure,'identity',{stage:'admission'});}
          failMaintenanceAdmission(admissionState,now(),confirmed);
          error=confirmed?'read_timeout':'reader_failed';
        }
        if(admissionTurn&&admissionTimedOut)await rejectAdmission();
        // Admission never alters observation timestamps or missed flags.
        checkCadence(now());
        if(lane){
          if(settleStarted!==undefined)recordPhase(lane.phases.settle,deliveryMs+now()-settleStarted);
          const elapsedMs=now()-lastTick;
          const sample={number:sequence,turn:admissionTurn?'admission':'work',...(ordinal==null?{}:{ordinal}),...(ordinal===null||openingOrdinal==null?{}:{openingOrdinal}),elapsedMs,attribution:quantumDetail};
          lane.quanta=add(lane.quanta,1);lane.first??=sample;lane.latest=sample;
          lane.worstElapsedMs=Math.max(lane.worstElapsedMs,elapsedMs);
          const bucket=Math.min(501,Math.ceil(elapsedMs/10));lane.elapsedBuckets[bucket]=add(lane.elapsedBuckets[bucket],1);
        }
        clearTimer(quantumTimer);
        if(admissionSucceeded&&!admissionTimedOut&&!error){
          try {retainMaintenanceAdmission(admissionIdentity(projections[phases.indexOf(lane)].options),quantum.maxMs,admissionState);}
          catch(failure){admissionSucceeded=false;error='reader_failed';recordFailure(failure,'identity',{stage:'admission'});}
          const elapsed=Math.ceil(now()-lastTick);
          if(elapsed>reservedMs){await rejectAdmission();checkCadence(now());}
          else if(admissionSucceeded&&Number.isSafeInteger(elapsed)&&elapsed>=0){
            originalLedger.items=Math.max(originalLedger.items-reservedItems,originalLedger.floorItems);
            originalLedger.ms=Math.max(originalLedger.ms-reservedMs+elapsed,originalLedger.floorMs);
          }
        }
        if(admissionTurn&&admissionState)admissionState.busy=false;
        if(ownedTurn){
          if(!turns.portUnchanged())error='authority_required';
          if(recoveryDisposal){
            // Closing can cancel the expedited recovery wait, never the
            // granted claim's proof deadline or its underlying disposal join.
            const proofTimer=setTimer(()=>{disposalUnproven=true;turns.poison(ownedTurn);error='reader_failed';},Math.max(0,Math.ceil(recoveryDeadline()-now())));
            try{await recoveryDisposal;if(now()>recoveryDeadline())disposalUnproven=true;}
            catch{disposalUnproven=true;}
            finally{clearTimer(proofTimer);}
          }
          // This finalizer owns shutdown cleanup itself. Calling stop() here
          // would deadlock: stop joins running, which includes this finalizer.
          if(error||stopped){
            const disposed=await Promise.allSettled([...handles.keys()].map(key=>pendingDrains.get(key)??(failedDrains.has(key)?Promise.reject(Error('reader_failed')):drain(key,undefined,lastFailure?.number))));
            if(disposed.some(r=>r.status==='rejected'))disposalUnproven=true;
          }
          if(failedDrains.size||admissionState?.quarantined)disposalUnproven=true;
          try{turns.bindIdentity(ownedTurn,admissionIdentity(projections[selectedIndex].options));}
          catch{disposalUnproven=true;}
          checkCadence(now());
          if(disposalUnproven){turns.poison(ownedTurn);error='reader_failed';}
          else {
            const released=turns.release(ownedTurn,'settled');
            if(released==='poisoned')error='reader_failed';else if(released==='authority_required')error='authority_required';
          }
        }
        running=null;if(error){void stop();return;}if(exhausted() || now()>=renewedUntil)report(observation());schedule();});
      if(ownedTurn){execution.then(resolveTurn,rejectTurn);return ownedRunning;}
      return running=execution;
    }
    const api=Object.freeze({getStatus:observation,get completion(){return completion;},close:stop});
    const entry={api,supervisor:c.supervisor,fingerprint,preQuantum:c.preQuantum,turnPort,...(recoveryEnabled?{cutoffDomains:domains}:{}),renew(next,w,b,g){
      if(stopped)fail('store_closed');
      // Lexical window succession tolerates at most one quantum of delivery
      // delay. Observation timestamps precede reader idle arming: after 60 s
      // without one, its independent disposal may already have fired. Keep
      // that conservative cutoff even when authority was renewed meanwhile.
      // An in-flight reservation alone is not exhausted actual usage.
      const inactive=now()>renewedUntil||[...ledgers.values()].some(l=>(w.id===window.id ? now()>l.endsAt :
        now()-l.endsAt>quantum.maxMs||observations.some(time=>now()-time>=60000))||
        (!running&&(l.items>=l.maxItems||l.ms>=l.maxMs)));
      if(next.pollMs!==c.pollMs||JSON.stringify(next.quantum)!==JSON.stringify(c.quantum))fail('invalid_input');
      // Account against the old authority and ledgers before any replacement
      // or inactive reset can erase this duty interval's overdue evidence.
      checkCadence(now());
      if(w.id!==window.id){
        if([...ledgers.values()].some(l=>now()<l.endsAt))fail('invalid_input');
        const nextLedgers=admitLedger(w,b);
        // Retire the old observer before exposing the new window's promise.
        report(observation());ledgers=nextLedgers;window=w;budgets=b;cycle();
      } else ledgers=admitLedger(w,b);
      // A settled observer cannot report renewed usage, even at exhaustion.
      if(settled)cycle();
      if(inactive){
        observations.fill(now());missed.fill(false);
        // An inactive reader may have hit its independent idle/lifecycle cutoff.
        // Drain it in the next fully reserved quantum before opening a successor.
        residentEpoch++;
      }
      if(turns)admissionGeneration++;
      renewedUntil=now()+next.renewalMs;grant=g;clearTimer(timer);if(turns)pendingAdmission?.controller.abort();if(exhausted())report(observation());else if(!running)schedule();
    }};
    all.entries.set(c.id,entry);if(exhausted())report(observation());schedule();return api;
  };
}
export const renewContextMaintenancePump=createMaintenancePumpRuntime();

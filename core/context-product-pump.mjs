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
const phaseNames=['drain','open','dispatch','epochObservation','refreshCall','settle'];
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
  open=openContextIndexMaintainer,observedAt=maintenanceObservation,phasesOf=maintenancePhaseDiagnostic,stallOf=maintenanceStallDiagnostic,cutoffQualified=maintenanceCutoffQualified}={}) {
  // Test-only dependency seam on this internal factory; public renewal never reaches it.
  const recoveryEnabled=cutoffQualified();
  return function renewContextMaintenancePump(original) {
    if(ownData(original,['supervisor','id','window','budgets','quantum','pollMs','renewalMs','projections','serviceCredential','semanticConfig','semanticServiceCredential','firstCoverageValidation']).semanticConfig!==undefined)return semanticPump(original,{now,setTimer,clearTimer,open});
    const c=ownData(original,['supervisor','id','window','budgets','quantum','pollMs','renewalMs','projections','serviceCredential']);
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
    // Reserve one entire quantum for drain/open/dispatch and the epoch read,
    // beyond the minimum admission sweep. Latency is variable, not free.
    const spacing=Math.max(c.pollMs,quantum.maxMs);
    if(projections.length*spacing+quantum.maxMs>5000)fail('invalid_input');
    const projectionKey=p=>JSON.stringify([p.options.path,p.options.readSet,canonicalJson(p.options.ownerCoverage),p.types,p.intent,p.options.host.moduleUrl,p.options.wal===true,p.options.sidecarJournalMode]);
    // Intent belongs to each call, not to the resident Worker. Keep all other
    // constructor/scope options in its identity; incompatible policies still drain.
    const residentKey=p=>{const {supervisor,ownerCoverage,...options}=p.options;return JSON.stringify([projectionKey({...p,intent:undefined}),optionIdentity(options)]);};
    const residentKeys=projections.map(residentKey);
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
    function admit(w,b) {
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
    let ledgers=admit(window,budgets);
    const record=registry.register(owner,{path:projections[0].options.path,domain:'context-read-product-v1.1/pump/'+c.id});
    let timer,closing,stopped=false,running,disposalCutoff,lastTick=now(),at=0,renewedUntil=now()+c.renewalMs,error=null,grant=credential;
    let report,completion,settled=false;
    function cycle(){settled=false;completion=new Promise(resolve=>{report=value=>{settled=true;resolve(value);};});}cycle();
    const handles=new Map(),writers=new Map(),handleLanes=new Map();
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
    async function drain(key,index=handleLanes.get(key),number){
      // Attribution follows the resident being disposed, not its replacement.
      const failureLane=handleLanes.get(key)??index;
      const started=now();
      try{const handle=handles.get(key);await disposeProductReader(handle,error==='read_timeout'?error:'store_closed',disposalCutoff,cutoffFailures.get(handle));readerSecondary(failureLane,maintenanceFailureDiagnostic(handle)?handle:readerSources.get(handle),number);handles.delete(key);handleLanes.delete(key);}
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
        if(!missed[i]){missed[i]=true;cadenceMisses++;}
        worstGapMs=Math.max(worstGapMs,gap);
      }
    }
    function observation(){
      const value=Object.freeze({id:c.id,state:error?'failed':stopped?'stopped':exhausted()?'budget_exhausted':now()>=renewedUntil?'renewal_expired':'active',
        windowId:window.id,usedItems:Math.max(...[...ledgers.values()].map(l=>l.items)),usedMs:Math.max(...[...ledgers.values()].map(l=>l.ms)),maxItems:budgets.maxItems,maxMs:budgets.maxMs,error});
      pumpDiagnostics.set(value,Object.freeze({cadenceMisses,worstGapMs,observation:lastObservation,lastFailure,failureCounts:Object.freeze({...failureCounts}),secondaryFailure,secondaryFailureCounts:Object.freeze({...secondaryFailureCounts})}));
      phaseDiagnostics.set(value,freezeTree(structuredClone({elapsedBucketMs:10,projections:phases})));
      snapshotMaintenanceCutoff(value,cutoffDiagnostic);
      return value;
    }
    // Stop this selection conservatively at its first exhausted domain; a new
    // selection can still use another domain, but cannot recharge this one.
    function exhausted(){return [...ledgers.values()].some(l=>now()>=l.endsAt||l.items>=l.maxItems||l.ms>=l.maxMs);}
    function stop(){
      if(closing)return closing;
      stopped=true;clearTimer(timer);cancelRecovery?.();registry.cleanup(record);
      closing=(async()=>{
        await running;
        const disposed=await Promise.allSettled([...handles.keys()].map(key=>pendingDrains.get(key)??drain(key,undefined,error?lastFailure?.number:undefined)));
        if(disposed.some(r=>r.status==='rejected'))throw Error('reader_failed');
        registry.finish(record);all.entries.delete(c.id);report(observation());
      })();
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
    function schedule(){
      if(stopped||error||exhausted()||now()>=renewedUntil)return;
      if(Math.min(window.endsAtMonoMs,renewedUntil)-now()<quantum.maxMs){
        timer=setTimer(tick,Math.max(1,Math.min(window.endsAtMonoMs,renewedUntil)-now()));return;
      }
      // Look ahead through the unchanged round-robin order. Each future turn
      // needs its full pre-observation quantum plus minimum admission spacing
      // for intervening turns. A fixed admission period cannot bound reads.
      // N*S+Q <= 5000 makes this deadline at least lastTick+S after each
      // punctual, in-budget turn, so advancing it preserves minimum spacing.
      let due=Math.min(...observations.map((time,i)=>time+5000-quantum.maxMs-
        ((i-at%projections.length+projections.length)%projections.length)*spacing));
      if(recoveryEnabled){
        const order=projections.map((_,i)=>(at+i)%projections.length).filter(i=>!cooling(i));
        if(!order.length){
          const next=Math.min(Math.max(lastTick+spacing,Math.min(...[...ledgers.keys()].map(eligibleAt))),renewedUntil,window.endsAtMonoMs);
          timer=setTimer(tick,Math.max(1,next-now()));return;
        }
        due=Math.min(...order.map((i,position)=>observations[i]+5000-quantum.maxMs-position*spacing));
      }
      // After a cadence miss the old deadline can be in the past. Recover in
      // round-robin order without violating spacing or spinning overdue timers.
      timer=setTimer(tick,Math.max(0,Math.min(Math.max(lastTick+spacing,Math.min(lastTick+interval(),due)),renewedUntil,window.endsAtMonoMs)-now()));
    }
    const eligibleAt=domain=>{const r=recoveryDomains.get(domain);return Math.max(r?.cooldownUntil??0,r?.pending?Math.max(r.pendingUntil,now()+spacing):0);};
    const cooling=index=>recoveryEnabled && eligibleAt(domainOf(projections[index]))>now();
    function tick(){
      if(stopped||error)return;
      checkCadence(now());
      if(exhausted()||now()>=renewedUntil){report(observation());return;}
      if(Math.min(window.endsAtMonoMs,renewedUntil)-now()<quantum.maxMs){schedule();return;}
      if(recoveryEnabled && projections.every((_,i)=>cooling(i))){schedule();return;}
      lastTick=now();
      let quantumTimer,lane,sequence,settleStarted,deliveryMs=0,activeHandle,activeControl,ordinal,openingOrdinal,quantumDetail={},stallRecorded=false,capability,recovery,activeStage='open';
      const recordedFailures=new Set();
      function recordFailure(value,kind='engine',detail={}){
        if(!lane||value&&typeof value==='object'&&drainErrors.has(value))return;
        const found=maintenanceFailureDiagnostic(value),captured=kind!=='disposal_proof'&&(found?.ordinal===undefined||found.ordinal===ordinal)?found:undefined,stamp=now(),source=captured??maintenanceFailureRecord(kind,{...detail,ordinal,stall:stallOf(value,stamp)??stallOf(activeHandle??activeControl,stamp)});
        const key=maintenanceFailureKind(source);if(recordedFailures.has(key))return;
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
      return running=(async()=>{
        try {
          let index=at++%projections.length;
          if(recoveryEnabled){
            let skipped=0;while(cooling(index)&&++skipped<projections.length)index=at++%projections.length;
            if(cooling(index))return;
          }
          const p=projections[index],dispatchEpoch=residentEpoch,key=JSON.stringify([residentKeys[index],dispatchEpoch]),ledger=ledgers.get(domainOf(p));
          const maxItems=Math.min(quantum.maxItems,ledger.maxItems-ledger.items),maxMs=Math.min(quantum.maxMs,ledger.maxMs-ledger.ms,Math.floor(ledger.endsAt-now()),Math.floor(renewedUntil-now()));
          if(maxItems<1||maxMs<1)return;
          disposalCutoff=lastTick+maxMs;
          // Reserve the full quantum before dispatch. Unknown usage remains
          // charged after crash/timeout; restarting or renewing cannot refund it.
          ledger.items+=maxItems;ledger.ms+=maxMs;
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
              const confirmed=await Promise.race([disposal.then(()=>true),new Promise(resolve=>{
                capability.rescheduleProof=()=>{clearTimer(confirmationTimer);confirmationTimer=setTimer(()=>resolve(false),Math.max(0,proofDeadline()-now()));};
                capability.rescheduleProof();
              }),new Promise(resolve=>{cancelRecovery=()=>{clearTimer(confirmationTimer);resolve(null);};})]);
              cutoffDiagnostic.disposalMs=Math.max(0,now()-started);
              if(confirmed===null){cutoffDiagnostic.outcome=4;return;}
              if(!confirmed || now()>proofDeadline()){cutoffDiagnostic.outcome=2;error='read_timeout';return;}
              for(const [writer,handle] of writers)if(handle===key)writers.delete(writer);
              if(stopped){cutoffDiagnostic.outcome=4;return;}
              if((ledger.recoveries??0)>=2){cutoffDiagnostic.outcome=5;error='read_timeout';return;}
              ledger.recoveries=(ledger.recoveries??0)+1;
              const until=now()+1000;
              domainRecovery.cooldownUntil=Math.max(domainRecovery.cooldownUntil,until);
              cutoffDiagnostic.allowance=ledger.recoveries;cutoffDiagnostic.cooldownUntil=until;cutoffDiagnostic.outcome=1;
            } catch(failure){recordFailure(failure,'disposal_proof',{stage:'disposal'});cutoffDiagnostic.outcome=3;error='reader_failed';}
            finally {domainRecovery.pending--;clearTimer(confirmationTimer);capability.rescheduleProof=undefined;cancelRecovery=undefined;}
          })();
          quantumTimer=setTimer(()=>{
            recordStall(activeHandle);recordFailure(activeHandle,'engine',{engineCode:'read_timeout'});
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
            if(stopped||error)return;
            const openingMs=Math.min(maxMs,Math.floor(maxMs-(now()-lastTick)));
            if(openingMs<1){recordFailure(activeControl,'engine',{engineCode:'read_timeout',stage:'open'});error='read_timeout';return;}
            const opening=now();openingOrdinal=ordinal;
            try{h=await open({...p.options,deadlineMs:openingMs},activeControl);openedHere=true;lane.opens=add(lane.opens,1);handles.set(key,h);handleLanes.set(key,index);writers.set(writer,key);}
            finally{recordPhase(lane.phases.open,now()-opening);}
          }
          activeHandle=h;activeStage='refresh';
          if(stopped||error)return;
          const remainingMs=Math.min(maxMs,Math.floor(maxMs-(now()-lastTick)));
          if(remainingMs<1){recordStall(h);recordFailure(h,'engine',{engineCode:'read_timeout'});error='read_timeout';return;}
          if(openedHere){
            activeControl=maintenanceDispatchControl();ordinal=maintenanceControlState(activeControl).ordinal;
          }
          if(recoveryEnabled && ordinal!==null)capability=authorizeMaintenanceCutoff(activeControl,{pumpEpoch:record.id,ordinal,ledger,cutoffAt:lastTick+maxMs,quantum:sequence,resident:dispatchEpoch,lane:index});
          const refreshing=now();let result;
          try{result=await h.refreshContextIndex({readSet:p.options.readSet,types:p.types,intent:p.intent,mode:'lexical',budget:{maxItems,maxMs:remainingMs}},grant,activeControl);}
          finally{settleStarted=now();recordPhase(lane.phases.refreshCall,settleStarted-refreshing);}
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
          recordFailure(e,'call_error',{errorName:maintenanceErrorName(e),stage:'call'});
          if(e.code==='read_timeout')recordStall(e);error=e.code??'reader_failed';
          // An opening failure returns no handle; its cleanup ID still owns disposal.
          if(e.cleanupId)try{await c.supervisor.drain(e.cleanupId);}catch(failure){recordFailure(failure,'cleanup',{stage:'close'});readerSecondary(phases.indexOf(lane),e,sequence);error='reader_failed';}
        }
      })().finally(()=>{
        if(lane){
          if(settleStarted!==undefined)recordPhase(lane.phases.settle,deliveryMs+now()-settleStarted);
          const elapsedMs=now()-lastTick;
          const sample={number:sequence,...(ordinal==null?{}:{ordinal}),...(ordinal===null||openingOrdinal==null?{}:{openingOrdinal}),elapsedMs,attribution:quantumDetail};
          lane.quanta=add(lane.quanta,1);lane.first??=sample;lane.latest=sample;
          lane.worstElapsedMs=Math.max(lane.worstElapsedMs,elapsedMs);
          const bucket=Math.min(501,Math.ceil(elapsedMs/10));lane.elapsedBuckets[bucket]=add(lane.elapsedBuckets[bucket],1);
        }
        clearTimer(quantumTimer);running=null;if(error){void stop();return;}if(exhausted() || now()>=renewedUntil)report(observation());schedule();});
    }
    const api=Object.freeze({getStatus:observation,get completion(){return completion;},close:stop});
    const entry={api,supervisor:c.supervisor,fingerprint,...(recoveryEnabled?{cutoffDomains:domains}:{}),renew(next,w,b,g){
      if(stopped)fail('store_closed');
      // Renewal exactly at expiry is a continuous handoff. Only an elapsed
      // authority/window gap or settled spent quota resets observation duty;
      // an in-flight reservation alone is not exhausted actual usage.
      const inactive=now()>renewedUntil||[...ledgers.values()].some(l=>now()>l.endsAt||
        (!running&&(l.items>=l.maxItems||l.ms>=l.maxMs)));
      if(next.pollMs!==c.pollMs||JSON.stringify(next.quantum)!==JSON.stringify(c.quantum))fail('invalid_input');
      // Account against the old authority and ledgers before any replacement
      // or inactive reset can erase this duty interval's overdue evidence.
      checkCadence(now());
      if(w.id!==window.id){
        if([...ledgers.values()].some(l=>now()<l.endsAt))fail('invalid_input');
        const nextLedgers=admit(w,b);
        // Retire the old observer before exposing the new window's promise.
        report(observation());ledgers=nextLedgers;window=w;budgets=b;cycle();
      } else ledgers=admit(w,b);
      // A settled observer cannot report renewed usage, even at exhaustion.
      if(settled)cycle();
      if(inactive){
        observations.fill(now());missed.fill(false);
        // An inactive reader may have hit its independent idle/lifecycle cutoff.
        // Drain it in the next fully reserved quantum before opening a successor.
        residentEpoch++;
      }
      renewedUntil=now()+next.renewalMs;grant=g;clearTimer(timer);if(exhausted())report(observation());else if(!running)schedule();
    }};
    all.entries.set(c.id,entry);if(exhausted())report(observation());schedule();return api;
  };
}
export const renewContextMaintenancePump=createMaintenancePumpRuntime();

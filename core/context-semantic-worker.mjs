import { parentPort, workerData as c } from 'node:worker_threads';
import { randomUUID } from 'node:crypto';
import { performance } from 'node:perf_hooks';
import { isDeepStrictEqual, types } from 'node:util';
import { AsyncLocalStorage } from 'node:async_hooks';
import { semanticGate } from './context-semantic-gate.mjs';
import { createExclusiveSqliteFile, sqliteFileStat } from './sqlite-journal-probe.mjs';
import { boundedData, credentialDigest, mono, verifyRecords, operationRecord, deadline } from './context-product-control.mjs';
import { canonicalJson, digest } from './context-product-validation.mjs';
import { createProductSqlitePolicy } from './context-product-sqlite.mjs';
import { exact, integer, opaque, hash, usd, dollars, tokenCost, semanticOperationInput, numericUsd, targetSetDigest } from './context-semantic-input.mjs';
import { vectorIdentity } from './context-vector-validation.mjs';
import { validateEmbedder, validateVector } from './context-read-embedder.mjs';
import { productFailure } from './context-product-reader.mjs';
import { fail } from './validation.mjs';

const ownerId=c.binding.ownerId,resources=new Int32Array(c.resources),owned=[],active=new Set(),clients=new Set(),operations=new Map();
const sqlContext=new AsyncLocalStorage();sqlContext.enterWith({until:-Infinity});
const sqlite=createProductSqlitePolicy({state:()=>sqlContext.getStore()});let host,ledger,port,policy,maintenance,closed=false,queue=Promise.resolve(),pendingSeal,lastState;
const controllers=new Set();
const gate=semanticGate(c.ownerState);
let providerUnavailable=false;
const ownershipPath=c.ledgerPath+'.semantic-owner-'+digest(ownerId)+'.lock.sqlite';let ownership;
const utc=()=>{const t=Date.now();if(!Number.isSafeInteger(t)||t<0)fail('price_unavailable');return t;};
const within=op=>{if(closed)fail('store_closed');if(process.hrtime.bigint()>=mono(op.operationCutoffMonoNs))fail('read_timeout');};
let queued=0;
const serial=work=>{if(queued>=128)fail('read_in_progress');queued++;const result=queue.then(work).finally(()=>queued--);queue=result.catch(()=>{});return result;};
const failure=error=>productFailure(error?.code==='ERR_SQLITE_ERROR'?[5,6].includes(error.errcode&255)?'storage_busy':'storage_error':error?.code);
async function admission() {
  if(pendingSeal) {
    if(await host.semanticLedgerAuthority.compareAndSwap(pendingSeal.prepared,pendingSeal.sealed)!==true)fail('index_unavailable');pendingSeal=null;
  }
  const result=await ledger.authenticate(ownerId);lastState=result.state;return result;
}
const change=(fn,guard)=>serial(async()=>{guard?.();const result=await ledger.mutate(await admission(),n=>{guard?.();fn(n);},undefined,guard);lastState=result.state;gate.publish(lastState);return result;});
const current=()=>serial(admission);
function refreshExposure(state,day) {
  let itemsCharged=0,itemsReserved=0,charged=0n,reserved=0n,lifetimeCharged=0n,lifetimeReserved=0n;
  for(const r of Object.values(state.reservations)) {
    if(r.kind!=='refresh'||r.status==='released')continue;
    const outstanding=['reserved','may_transmit'].includes(r.status),cost=BigInt(r.cost);
    if(r.day===day){if(outstanding){itemsReserved+=r.items;reserved+=cost;}else{itemsCharged+=r.items;charged+=cost;}}
    if(r.phase==='backfill'){if(outstanding)lifetimeReserved+=cost;else lifetimeCharged+=cost;}
  }
  return {itemsCharged,itemsReserved,charged,reserved,lifetimeCharged,lifetimeReserved};
}
function snapshot(state) {
  return {policy:state.policy,identity:identityMetadata(),
    blocked:state.blocked,purgePending:['pending','running','failed'].includes(state.purge.state),validationPending:state.validationPending,
    firstCoverageComplete:state.firstCoverageComplete,targetSetDigest:state.targetSetDigest,providerUnavailable};
}
function identityMetadata() {if(!port)return null;const {id,revision,dimensions,normalization}=port;return {provider:'openai',model:c.provider.model,id,revision,dimensions,normalization};}
function coverageStatus(s) {
  return s.targets===null?null:{state:s.firstCoverageComplete?'complete':Object.keys(s.receipts).length||s.validationPending?'validating':'pending',targetSetDigest:s.targetSetDigest,
    validatedTargets:s.firstCoverageComplete?s.targets.length:Object.keys(s.receipts).length,totalTargets:s.targets.length,checkpoint:s.firstCoverageComplete||!Object.keys(s.receipts).length&&!s.validationPending?null:digest({receipts:s.receipts,pending:s.validationPending})};
}
function status(s) {
  const day=Math.max(Math.floor(utc()/86400000),s.dayHighWater),e=refreshExposure(s,day),limits=c.refreshCaps[s.firstCoverageComplete?'steady':'backfill'];
  return {extension:c.version??'context-read-product-p2e-v1',owner:s.policy,refresh:{phase:s.blocked?'blocked':s.firstCoverageComplete?'steady':'backfill',utcDay:new Date(day*86400000).toISOString().slice(0,10),
    itemsCharged:e.itemsCharged,itemsReserved:e.itemsReserved,itemLimit:limits.maxItemsPerUtcDay,usdCharged:dollars(e.charged),usdReserved:dollars(e.reserved),usdLimit:limits.maxUsdPerUtcDay,
    backfillUsdCharged:dollars(e.lifetimeCharged),backfillUsdReserved:dollars(e.lifetimeReserved),backfillUsdLimit:c.refreshCaps.backfill.maxUsdTotal,
    firstCoverageComplete:s.firstCoverageComplete,blockedReason:s.blocked?'backfill_ceiling':null},purge:s.purge,firstCoverage:coverageStatus(s)};
}
function price(state) {
  try {
    const p=c.priceTable,time=utc();
    if(time<p.effectiveFromUtcMs||time>=p.effectiveUntilUtcMs)fail('price_unavailable');
    const r=host.semanticPriceAuthority.current({authorityId:p.authorityId,model:c.provider.model,utcMs:time});
    if(types.isPromise(r)){r.catch(()=>{});fail('price_unavailable');}
    exact(r,'authorityId,revision,sequence,tableDigest,effectiveFromUtcMs,effectiveUntilUtcMs');
    const assertion={authorityId:p.authorityId,revision:p.revision,sequence:p.sequence,tableDigest:digest(p),effectiveFromUtcMs:p.effectiveFromUtcMs,effectiveUntilUtcMs:p.effectiveUntilUtcMs};
    if(!isDeepStrictEqual(boundedData(r),boundedData(assertion)))fail('price_unavailable');
    const high=state.prices[p.authorityId];
    if(high&&(high.sequence>p.sequence||high.sequence===p.sequence&&!isDeepStrictEqual(high,assertion)))fail('price_unavailable');
    return assertion;
  }catch{fail('price_unavailable');}
}
function checkState(s,expected) {
  if(!s.policy.semantic)fail('not_enabled');
  if(s.policy.purgeEpoch!==expected.purgeEpoch||s.policy.revision!==expected.revision||['pending','running','failed'].includes(s.purge.state))fail('purge_pending');
  if(s.blocked)fail('backfill_ceiling');
  if(s.validationPending&&!s.firstCoverageComplete)fail('budget_denied');
}
function inputBound(texts) {
  if(!Array.isArray(texts)||!texts.length||texts.length>c.provider.maxBatchDocuments)fail('invalid_input');
  let tokens=0;
  for(const text of texts){if(typeof text!=='string'||!text.trim()||!text.isWellFormed()||text.includes('\0'))fail('invalid_input');const n=Buffer.byteLength(text)+16;if(n>8192)fail('context_item_too_large');tokens+=n;}
  if(tokens>300000||Buffer.byteLength(JSON.stringify({model:c.provider.model,dimensions:1536,encoding_format:'float',input:texts}))>2097152)fail('context_item_too_large');return tokens;
}
function globalPolicy(db,next,id) {
  let requests=0,money=0n,concurrent=0;
  for(const row of db.prepare('SELECT owner_id,state FROM semantic_owners').iterate()) {
    const s=row.owner_id===ownerId?next:JSON.parse(row.state);
    if(s.identities[id]?.blocked)fail('provider_error');
    for(const r of Object.values(s.reservations))if(r.identity===id&&r.status!=='released') {
      requests++;money+=BigInt(r.cost);if(['reserved','may_transmit'].includes(r.status))concurrent++;
    }
  }
  if(requests>policy.maxRequests||money>usd(numericUsd(policy.maxUsd))||concurrent>policy.maxConcurrent)fail('budget_denied');
}
async function embed(input,op,metadata) {
  const {texts,kind,expected,maxUsd,window}=input;
  if(!['query','refresh'].includes(kind)||kind==='query'&&texts.length!==1)fail('invalid_input');
  within(op);if(!port)fail('provider_unavailable');
  const bound=inputBound(texts),id=digest(identityMetadata()),cost=tokenCost(bound,c.priceTable.usdPerMillionInputTokens[c.provider.model]),reservationId=randomUUID();
  const controller=new AbortController();operations.get(op.operationId)?.controllers.add(controller);
  controllers.add(controller);
  let transmitted=false,invoked=false,usage,protocolFailure=false;
  const cutoff=Math.min(Number(mono(op.operationCutoffMonoNs))/1e6,Number(process.hrtime.bigint())/1e6+c.provider.requestTimeoutMs);
  const deadlineAt=performance.now()+cutoff-Number(process.hrtime.bigint())/1e6;
  await serial(async()=>{
    const admitted=await admission(),s=admitted.state;checkState(s,expected);const p=price(s),day=Math.floor(utc()/86400000);
    if(day<s.dayHighWater)fail('budget_denied');
    const phase=s.firstCoverageComplete?'steady':'backfill',limits=c.refreshCaps[phase],e=refreshExposure(s,day);
    const quantumId=kind==='refresh'?s.pumpBindings[metadata.bindingId]:null;
    const quantum=quantumId?s.windows[s.activeWindowId]?.quanta[quantumId]:null;
    if(quantumId&&(!quantum||quantum.status!=='reserved'||utc()>=s.windows[s.activeWindowId].endsUtcMs||cost+BigInt(quantum.planned)>BigInt(quantum.maxUsd)))fail('budget_denied');
    if(s.identities[id]?.blocked)fail('provider_error');
    if(kind==='refresh') {
      if(texts.length+e.itemsCharged+e.itemsReserved>limits.maxItemsPerUtcDay||cost+e.charged+e.reserved>usd(limits.maxUsdPerUtcDay)||cost>usd(maxUsd))fail('budget_denied');
      if(phase==='backfill'&&cost+e.lifetimeCharged+e.lifetimeReserved>usd(c.refreshCaps.backfill.maxUsdTotal)) {
        if(e.lifetimeCharged+e.lifetimeReserved>=usd(c.refreshCaps.backfill.maxUsdTotal)){await ledger.mutate(admitted,n=>{n.blocked=true;});fail('backfill_ceiling');}
        fail('budget_denied');
      }
    }
    within(op);
    let r=await ledger.mutate(admitted,n=>{
      n.dayHighWater=Math.max(n.dayHighWater,day);n.prices[p.authorityId]=p;
      n.reservations[reservationId]={id:reservationId,kind,items:kind==='refresh'?texts.length:0,day,phase,identity:id,price:{...p,rate:c.priceTable.usdPerMillionInputTokens[c.provider.model]},tokensBound:bound,cost:String(cost),status:'reserved',usage:'unknown',epoch:expected.purgeEpoch,incarnation:op.operationId};
      if(quantum){n.windows[n.activeWindowId].quanta[quantumId].planned=String(BigInt(quantum.planned)+cost);n.reservations[reservationId].quantumId=quantumId;}
    },(db,n)=>globalPolicy(db,n,id),()=>within(op));
    r=await ledger.mutate(r,n=>{n.reservations[reservationId].status='may_transmit';},undefined,()=>within(op));
  });
  function checkDispatch() {
    within(op);if(controller.signal.aborted||performance.now()>=deadlineAt)fail('timeout');
    const s=ledger.read(ownerId).state;checkState(s,expected);price(s);
    gate.check(expected);
    maintenance.transmission(input,metadata,s);
    if(metadata.cancellation&&Atomics.load(new Int32Array(metadata.cancellation),0)!==0)fail('timeout');
    const r=s.reservations[reservationId];
    if(!r||r.status!=='may_transmit'||r.incarnation!==op.operationId||r.epoch!==s.policy.purgeEpoch||r.phase==='backfill'&&s.firstCoverageComplete)fail('budget_denied');
    if(r.quantumId){const w=Object.values(s.windows).find(w=>w.quanta[r.quantumId]);if(!w||w.quanta[r.quantumId].status!=='reserved'||utc()>=w.endsUtcMs)fail('budget_denied');}
    within(op);if(controller.signal.aborted||performance.now()>=deadlineAt)fail('timeout');
    if(utc()<c.priceTable.effectiveFromUtcMs||utc()>=c.priceTable.effectiveUntilUtcMs)fail('price_unavailable');
  }
  function beforeDispatch(){if(transmitted)fail('budget_denied');checkDispatch();transmitted=true;}
  const settleInputTokens=value=>{
    if(usage!==undefined||!Number.isSafeInteger(value)||value<0||value>bound){protocolFailure=true;fail('provider_error');}usage=value;
  };
  let underlying;
  Atomics.add(resources,2,1);
  try {checkDispatch();invoked=true;const operation=operations.get(op.operationId);if(operation){operation.attempts=1;if(operation.attemptState)Atomics.store(new Int32Array(operation.attemptState),0,1);}underlying=Promise.resolve(port.embed(Object.freeze([...texts]),{signal:controller.signal,deadlineAt,beforeDispatch,settleInputTokens}));}
  catch(error){underlying=Promise.reject(error);}
  const settled=underlying.then(value=>({value}),error=>({error})).then(async result=>{
    if(result.error?.code==='provider_unavailable')providerUnavailable=true;
    if(result.error?.usageBoundExceeded===true)protocolFailure=true;
    if(protocolFailure)usage=undefined;
    try {
      await serial(async()=>{
        const a=await admission();await ledger.mutate(a,s=>{
          const r=s.reservations[reservationId];if(!r||!['reserved','may_transmit'].includes(r.status))return;
          r.status=!invoked?'released':usage===undefined?'unknown':'settled';r.usage=usage===undefined?'unknown':'validated';
          if(usage!==undefined)r.cost=String(tokenCost(usage,r.price.rate));
          if(protocolFailure)s.identities[id]={blocked:true};
          const e=refreshExposure(s,r.day);
          if(!s.firstCoverageComplete&&e.lifetimeCharged+e.lifetimeReserved>=usd(c.refreshCaps.backfill.maxUsdTotal))s.blocked=true;
        });
      });
    } finally {Atomics.add(resources,3,1);active.delete(settled);controllers.delete(controller);}
    if(result.error){if(['not_enabled','purge_pending','backfill_ceiling','price_unavailable','budget_denied','provider_error','rate_limited','dimension_mismatch','timeout','provider_unavailable','index_unavailable','read_timeout'].includes(result.error.code))throw result.error;fail('provider_error');}
    if(!transmitted||protocolFailure||!Array.isArray(result.value)||result.value.length!==texts.length)fail('provider_error');
    return result.value.map(v=>validateVector(v,port));
  });
  active.add(settled);settled.catch(()=>{});
  let timer;
  try {
    const values=await Promise.race([settled,new Promise((_,reject)=>{timer=setTimeout(()=>{controller.abort();reject(Object.assign(Error('timeout'),{code:'timeout'}));},Math.max(0,deadlineAt-performance.now()));})]);
    within(op);const s=(await current()).state;checkState(s,expected);return {vectors:values,chargedUsd:dollars(BigInt(s.reservations[reservationId].cost)),attempts:1};
  } finally {clearTimeout(timer);}
}
function authorize(message,extra={}) {
  const {method,input,credential,request}=message;
  if(!c.binding.methods.includes(method)||input.ownerId!==ownerId||credentialDigest(credential)!==c.binding.credentialDigest)fail('authority_required');
  const query=boundedData({method,input,ownerId,requestControl:request,credentialBindingId:c.binding.credentialBindingId,...extra});
  let grant;try{grant=host.authorize(query,credential);if(types.isPromise(grant)){grant.catch(()=>{});fail('authority_required');}if(!isDeepStrictEqual(boundedData(grant),boundedData(c.binding)))fail('authority_required');}catch{fail('authority_required');}
  function sample(code) {try{if(host.isCurrent(grant,query)===true)return;}catch{}fail(code);}
  sample('authority_required');return ()=>sample('scope_changed');
}
async function dataCall(message) {
  const {input,method,operation}=message;within(operation);const scopedChange=fn=>change(fn,()=>within(operation));
  semanticOperationInput(method,input);
  // Credential/method/owner checks precede every private ledger observation.
  const final=authorize(message,method==='validateOwnerSemanticCoverage'?{targetSetDigest:lastState?.targetSetDigest,identity:identityMetadata(),purgeEpoch:lastState?.policy.purgeEpoch}:{});
  let a;
  try{a=await current();}catch(error){
    if(method!=='getOwnerSemanticStatus'||!['ERR_SQLITE_ERROR','storage_busy','storage_error'].includes(error.code))throw error;
    const refresh=Object.fromEntries(['phase','utcDay','itemsCharged','itemsReserved','itemLimit','usdCharged','usdReserved','usdLimit','backfillUsdCharged','backfillUsdReserved','backfillUsdLimit','firstCoverageComplete','blockedReason'].map(k=>[k,null]));
    const purge={state:'failed',epoch:null,deletedVectors:null,checkpoint:null,remainingVectors:null,reason:'storage_unavailable'};
    within(operation);final();return {ok:true,value:{extension:'context-read-product-p2e-v1',owner:null,refresh,purge,firstCoverage:null}};
  }
  within(operation);
  if(a.state.ledgerEpoch!==c.binding.ledgerEpoch||a.state.bindingRevision!==c.binding.bindingRevision)fail('authority_required');
  let value;
  if(method==='getOwnerSemanticStatus') {
    exact(input,Object.hasOwn(input,'deadlineMs')?'ownerId,deadlineMs':'ownerId');value=status(a.state);
  }else if(method==='setOwnerSemantic') {
    exact(input,Object.hasOwn(input,'deadlineMs')?'ownerId,semantic,expectedRevision,deadlineMs':'ownerId,semantic,expectedRevision');integer(input.expectedRevision);
    if(typeof input.semantic!=='boolean')fail('invalid_input');
    if(a.state.policy.revision!==input.expectedRevision)fail('revision_conflict');
    if(a.state.policy.semantic===input.semantic){value=a.state.policy;within(operation);final();return {ok:true,value};}
    const prepared=input.semantic&&a.state.targets===null?await maintenance.targets(c.backfillTargets):null;
    const release=input.semantic?()=>{}:await gate.stop();
    let changed;
    try{changed=await scopedChange(s=>{
      if(s.policy.revision!==input.expectedRevision)fail('revision_conflict');
      if(s.policy.semantic===input.semantic)return;
      if(input.semantic&&['pending','running','failed'].includes(s.purge.state))fail('read_in_progress');
      if(input.semantic&&s.targets===null){s.targets=prepared;s.targetSetDigest=targetSetDigest(prepared);}
      s.policy.semantic=input.semantic;s.policy.revision++;
      if(!input.semantic){s.policy.purgeEpoch++;s.purge={state:'pending',epoch:s.policy.purgeEpoch,deletedVectors:0,checkpoint:null,remainingVectors:null,reason:null};}
    });}finally{release();}
    if(input.semantic)gate.publish(changed.state,true);
    if(!input.semantic)for(const controller of controllers)controller.abort();
    value=changed.state.policy;
  }else if(method==='validateOwnerSemanticCoverage') {
    exact(input,'ownerId,expectedTargetDigest,budget');hash(input.expectedTargetDigest);const b=exact(input.budget,'maxTargets,maxMs');integer(b.maxTargets,1,64);integer(b.maxMs,1,5000);
    // The maintenance engine owns the final callback-free canonical pass.
    return maintenance.validate({input,operation,final,current,change:scopedChange,ledger,identity:identityMetadata(),coverageStatus,
      prepare:async next=>serial(async()=>{const a=await admission();if(next.sequence!==a.state.sequence)fail('read_in_progress');return ledger.prepare(a,next);}),pending:preparation=>{pendingSeal=preparation;}});
  }else if(method==='purgeOwnerVectors') {
    exact(input,'ownerId,budget');const b=exact(input.budget,'maxItems,maxMs');integer(b.maxItems,1,1024);integer(b.maxMs,1,5000);
    if(a.state.policy.semantic)fail('invalid_input');
    try{value=await maintenance.purge({input,operation,current,change:scopedChange});}catch(error){
      try{await change(n=>{n.purge.state='failed';n.purge.reason=error.code==='index_unavailable'?'validation_invalid':'storage_unavailable';});}catch{}
      throw error;
    }
  }else fail('invalid_input');
  within(operation);final();return {ok:true,value};
}
async function internalCall(message,metadata) {
  const {method,input,operation}=message;within(operation);
  if(metadata.ownerId!==ownerId)fail('authority_required');
  if(method==='snapshot') {const s=(await current()).state;return {...snapshot(s),identity:identityMetadata()};}
  if(method==='embed')return embed(input,operation,metadata);
  if(metadata.pump&&method==='firstCoverage') {
    const s=(await current()).state;return {targetSetDigest:s.targetSetDigest,complete:s.firstCoverageComplete,pending:s.validationPending};
  }
  if(metadata.pump&&method==='embeddingAdmission') {
    const s=(await current()).state;return {allowed:s.policy.semantic&&!s.blocked&&!s.validationPending&&!['pending','running','failed'].includes(s.purge.state)};
  }
  if(metadata.pump&&method==='pumpReserve') {
    const id=randomUUID();let result;
    await change(s=>{
      const time=utc(),old=s.activeWindowId&&s.windows[s.activeWindowId];
      if(old&&old.id!==input.window.id&&time<old.endsUtcMs)fail('invalid_input');
      let w=s.windows[input.window.id];
      const maxUsd=usd(input.budgets.maxUsd),floor=usd(input.window.usedUsd);
      if(!w)w=s.windows[input.window.id]={id:input.window.id,endsUtcMs:time+Math.max(0,input.remainingMs),maxItems:input.budgets.maxItems,maxMs:input.budgets.maxMs,maxUsd:String(maxUsd),usedItems:input.window.usedItems,usedMs:input.window.usedMs,usedUsd:String(floor),quanta:{}};
      if(w.maxItems!==input.budgets.maxItems||w.maxMs!==input.budgets.maxMs||w.maxUsd!==String(maxUsd))fail('invalid_input');
      w.usedItems=Math.max(w.usedItems,input.window.usedItems);w.usedMs=Math.max(w.usedMs,input.window.usedMs);w.usedUsd=String(BigInt(w.usedUsd)>floor?BigInt(w.usedUsd):floor);
      const amount=usd(input.maxUsd),reserved=Object.values(w.quanta).filter(q=>q.status==='reserved').reduce((sum,q)=>sum+BigInt(q.maxUsd),0n);
      if(time>=w.endsUtcMs||w.usedItems+input.maxItems>w.maxItems||w.usedMs+input.maxMs>w.maxMs||amount+reserved+BigInt(w.usedUsd)>maxUsd)fail('budget_denied');
      w.usedItems+=input.maxItems;w.usedMs+=input.maxMs;
      w.quanta[id]={id,bindingId:input.bindingId??null,maxUsd:String(amount),planned:'0',status:'reserved'};
      if(input.bindingId&&input.mode==='embeddings')s.pumpBindings[input.bindingId]=id;
      s.activeWindowId=w.id;result={id,maxUsd:dollars(amount),usedItems:w.usedItems,usedMs:w.usedMs,usedUsd:dollars(BigInt(w.usedUsd)+reserved+amount)};
    });return result;
  }
  if(metadata.pump&&method==='pumpFinish') {
    let result;
    await change(s=>{
      const w=Object.values(s.windows).find(w=>w.quanta[input.id]),q=w?.quanta[input.id];if(!q)fail('invalid_input');
      if(q.status==='reserved') {
        const actual=Object.values(s.reservations).filter(r=>r.quantumId===q.id&&r.status!=='released').reduce((sum,r)=>sum+BigInt(r.cost),0n);
        w.usedUsd=String(BigInt(w.usedUsd)+(input.known?actual:BigInt(q.maxUsd)));q.status='settled';
        if(q.bindingId&&s.pumpBindings[q.bindingId]===q.id)delete s.pumpBindings[q.bindingId];
      }
      const reserved=Object.values(w.quanta).filter(q=>q.status==='reserved').reduce((sum,q)=>sum+BigInt(q.maxUsd),0n);
      result={usedUsd:dollars(BigInt(w.usedUsd)+reserved),usedItems:w.usedItems,usedMs:w.usedMs};
    });return result;
  }
  if(method==='catalog') {
    await maintenance.catalog(input,metadata);
    await change(s=>{if(['pending','running','failed'].includes(s.purge.state)||!s.policy.semantic)fail('purge_pending');s.catalog[input.catalogId]=input;});return null;
  }
  if(method==='hint') {
    await change(s=>{
      if(s.firstCoverageComplete||!s.targets)return;
      const ordinal=s.targets.findIndex(t=>digest(t)===input.targetDigest);if(ordinal<0)return;
      if(input.complete&&input.purgeEpoch===s.policy.purgeEpoch&&s.policy.semantic)s.hints[ordinal]={certificate:input.certificate,epoch:s.policy.purgeEpoch,identity:digest(identityMetadata())};else delete s.hints[ordinal];
      if(s.targets.every((_,i)=>s.hints[i]))s.validationPending=true;
    });return null;
  }
  fail('invalid_input');
}
let disposing;
function dispose() {return disposing??=(async()=>{
  closed=true;let failed=false,release;
  for(const controller of controllers)controller.abort();
  for(const op of operations.values())for(const controller of op.controllers)controller.abort();
  await Promise.allSettled([...active]);await queue;
  try{release=await gate.stop();}catch{failed=true;}
  for(const port of clients)port.close();
  for(const close of [()=>maintenance?.close(),()=>ledger?.close()])try{close();}catch{failed=true;}
  for(const resource of owned.reverse())try{await resource.close();Atomics.add(resources,resource.at+1,1);}catch{failed=true;}
  if(ownership){try{if(ownership.isTransaction)ownership.exec('ROLLBACK');}catch{failed=true;}finally{try{ownership.close();}catch{failed=true;}ownership=null;}}
  release?.();if(failed)fail('reader_failed');
})();}
try {
  sqlite.start(Number(mono(c.operation.operationCutoffMonoNs))/1e6);within(c.operation);
  verifyRecords(c.request,c.operation,c.request,c.operation);
  sqlite.files(c.ledgerPath);
  const physical=sqliteFileStat(c.ledgerPath),permission=new Promise((resolve,reject)=>parentPort.once('message',message=>{
    if(message.kind==='identity-ack'&&JSON.stringify(message.operation)===JSON.stringify(c.operation))resolve();else reject(Object.assign(Error('reader_failed'),{code:'reader_failed'}));
  }));
  parentPort.postMessage({kind:'identity',identity:String(physical.dev)+':'+String(physical.ino),operation:c.operation});await permission;within(c.operation);
  const module=await import(c.host.moduleUrl);
  host=await module.createContextReadHost(Object.freeze({...c.host.configuration,resourceOwner:Object.freeze({
    sqlitePolicy:Object.freeze({open:(native,path)=>sqlite.open(native,path),files:path=>sqlite.files(path)}),
    register(kind,close){const at=kind==='provider'?2:kind==='lease'?0:-1;if(at<0||typeof close!=='function'||owned.length>=64)fail('invalid_input');Atomics.add(resources,at,1);owned.push({at,close});}})}));
  if(typeof host.close==='function'){Atomics.add(resources,0,1);owned.push({at:0,close:()=>host.close()});}
  const embeddingDescriptor=Object.getOwnPropertyDescriptor(host,'contextEmbedding');
  if(embeddingDescriptor&&!Object.hasOwn(embeddingDescriptor,'value'))fail('invalid_input');
  if(typeof host?.authorize!=='function'||typeof host?.isCurrent!=='function'||!host.semanticLedgerAuthority||typeof host.semanticPriceAuthority?.current!=='function')fail('invalid_input');
  if(host.contextEmbedding) {
    const e=ownEmbedding(host.contextEmbedding);port=validateEmbedder(e.embedder);vectorIdentity({provider:'openai',model:c.provider.model,id:port.id,revision:port.revision,dimensions:port.dimensions,normalization:port.normalization});
    policy=e.policy;
  }
  const {openSemanticLedger}=await import('./context-semantic-ledger.mjs');ledger=openSemanticLedger({path:c.ledgerPath,identity:c.ledgerIdentity,authority:host.semanticLedgerAuthority,policy:sqlite});
  lastState=(await ledger.authenticate(ownerId,{recoverPrepared:true})).state;
  if(lastState.ledgerEpoch!==c.binding.ledgerEpoch||lastState.bindingRevision!==c.binding.bindingRevision)fail('authority_required');
  try{sqliteFileStat(ownershipPath);}catch(error){if(error.code!=='ENOENT')throw error;try{createExclusiveSqliteFile(ownershipPath);}catch(error){if(error.code!=='EEXIST')throw error;}}
  const {DatabaseSync}=await import('node:sqlite');
  ownership=sqlite.open(new DatabaseSync(ownershipPath),ownershipPath).db;
  ownership.exec('BEGIN EXCLUSIVE');ownership.prepare('PRAGMA schema_version').get();
  if(Object.values(lastState.reservations).some(r=>['reserved','may_transmit'].includes(r.status))) {
    const a=await admission();
    if(typeof host.semanticLedgerAuthority.confirmDisposed!=='function'||await host.semanticLedgerAuthority.confirmDisposed(a.anchor)!==true)fail('read_in_progress');
    const recovered=await ledger.mutate(a,s=>{
      for(const r of Object.values(s.reservations))if(r.status==='reserved')r.status='released';else if(r.status==='may_transmit'){r.status='unknown';r.usage='unknown';}
      for(const w of Object.values(s.windows))for(const q of Object.values(w.quanta))if(q.status==='reserved'){
        const exposure=Object.values(s.reservations).filter(r=>r.quantumId===q.id&&r.status!=='released').reduce((sum,r)=>sum+BigInt(r.cost),0n);
        w.usedUsd=String(BigInt(w.usedUsd)+exposure);q.status='settled';
      }
      s.pumpBindings={};
    });lastState=recovered.state;
  }
  gate.publish(lastState,true);
  const {semanticMaintenance}=await import('./context-semantic-maintenance.mjs');maintenance=semanticMaintenance({c,sqlite,identity:identityMetadata,secretState:()=>ledger.read(ownerId).state});
  if(lastState.targets&&!lastState.firstCoverageComplete){const configured=maintenance.targets(c.backfillTargets),ids=new Set(configured.map(digest));if(lastState.targets.some(t=>!ids.has(digest(t))))fail('revision_conflict');}
  within(c.operation);parentPort.postMessage({kind:'ready',result:{ok:true,value:null}});
}catch(error){try{await dispose();}catch{}parentPort.postMessage({kind:'ready',result:failure(error)});}
function ownEmbedding(value) {
  // Runtime functions are inspected separately from own-data configuration.
  const descriptors=Object.getOwnPropertyDescriptors(value);
  if(types.isProxy(value)||Object.keys(descriptors).sort().join(',')!=='embedder,policy'||Object.values(descriptors).some(d=>!Object.hasOwn(d,'value')))fail('invalid_input');
  const p=descriptors.policy.value;
  if(types.isProxy(p)||typeof p!=='object')fail('invalid_input');
  const d=Object.getOwnPropertyDescriptors(p),keys=Object.keys(d);
  if(keys.some(k=>!['family','maxRequests','maxConcurrent','maxUsd','estimateUsd'].includes(k))||Object.values(d).some(v=>!Object.hasOwn(v,'value')))fail('invalid_input');
  if(p.family!=='hosted'||!Number.isSafeInteger(p.maxRequests)||p.maxRequests<1||!Number.isSafeInteger(p.maxConcurrent)||p.maxConcurrent<1||p.maxConcurrent>1024||!Number.isFinite(p.maxUsd)||p.maxUsd<=0)fail('invalid_input');
  numericUsd(p.maxUsd);return {embedder:descriptors.embedder.value,policy:{...p,maxUsd:p.maxUsd,estimateUsd:texts=>Number(dollars(tokenCost(inputBound(texts),c.priceTable.usdPerMillionInputTokens[c.provider.model])))}};
}
parentPort.on('message',async message=>{
  if(message.kind==='close'){try{await dispose();parentPort.close();}catch{process.exitCode=1;parentPort.close();}return;}
  if(message.kind==='cancel'){const op=operations.get(message.id);if(op)for(const controller of op.controllers)controller.abort();return;}
  if(message.kind==='cancel-operation'){const op=operations.get(message.operationId);if(op)for(const controller of op.controllers)controller.abort();return;}
  if(message.kind==='attach') {
    const p=message.port,attached=new Set();clients.add(p);p.on('close',()=>{clients.delete(p);for(const op of attached)for(const controller of op.controllers)controller.abort();});
    p.on('message',m=>sqlContext.run({until:-Infinity},async()=>{
      sqlite.start(Number(mono(m.operation.operationCutoffMonoNs))/1e6);
      const op={controllers:new Set(),attempts:0,attemptState:m.attemptState};operations.set(m.operation.operationId,op);attached.add(op);
      try{const value=await internalCall(m,message.metadata);
        if(value?.vectors?.length>32){const parts=Math.ceil(value.vectors.length/32);for(let part=0;part<parts;part++)p.postMessage({id:m.id,ok:true,part,parts,value:{...value,vectors:value.vectors.slice(part*32,(part+1)*32)}});}
        else p.postMessage({id:m.id,ok:true,value});}
      catch(error){p.postMessage({id:m.id,ok:false,attempts:op.attempts,code:['not_enabled','purge_pending','backfill_ceiling','price_unavailable','budget_denied','provider_error','rate_limited','dimension_mismatch','timeout','provider_unavailable'].includes(error.code)?error.code:['context_item_too_large','invalid_vector'].includes(error.code)?'provider_error':error.code==='read_timeout'?'timeout':'ledger_unavailable'});}
      finally{operations.delete(m.operation.operationId);attached.delete(op);}
    }));return;
  }
  if(message.kind!=='call')return;
  const op={controllers:new Set()};operations.set(message.id,op);operations.set(message.operation.operationId,op);
  await sqlContext.run({until:-Infinity},async()=>{
    let result;
    try{
      if(message.request.clockDomainId!==c.request.clockDomainId||message.request.credentialBindingId!==c.binding.credentialBindingId||message.request.credentialExpiresUtcMs!==c.binding.credentialExpiresUtcMs)fail('authority_required');
      verifyRecords(message.request,message.operation,message.request,operationRecord(message.request,mono(message.operation.enteredMonoNs),deadline(message.input?.budget?.maxMs??message.input?.deadlineMs??5000),1,message.operation.operationId));
      sqlite.start(Number(mono(message.operation.operationCutoffMonoNs))/1e6);result=await dataCall(message);
    }catch(error){result=failure(error);}
    operations.delete(message.id);operations.delete(message.operation.operationId);parentPort.postMessage({id:message.id,result});
  });
});

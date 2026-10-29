import { performance } from 'node:perf_hooks';
import { randomUUID, createHash } from 'node:crypto';
import { productSidecar } from './context-product-sidecar.mjs';
import { digest } from './context-product-validation.mjs';
import { contextInput, namespaceKey, ASSEMBLY_DEFAULTS, ASSEMBLY_POLICIES, ASSEMBLY_LIMITS } from './context-read-input.mjs';
import { ownData } from './local-authority-input.mjs';
import { deadline, PRODUCT_PROFILE } from './context-product-control.mjs';
import { fuseCandidates } from './context-read-fusion.mjs';
import { assembleContext } from './context-read-assembly.mjs';
import { validateSourceReceipt } from './source-evidence.mjs';
import { TOKENIZER_VERSION, REPRESENTATION_VERSION } from './context-read-tokenize.mjs';
import { fail } from './validation.mjs';
import { productVectors } from './context-product-vectors.mjs';
import { canonicalProductIdentity, productFile, PRODUCT_SIDECAR_SUFFIX } from './context-product-sidecar.mjs';
import { mono } from './context-product-control.mjs';
import { maintenanceQuantum } from './context-product-quantum.mjs';
import { usd, dollars, queryEmbeddingCutoff } from './context-semantic-input.mjs';

const success = value => ({ok:true,value});
const failure = code => ({ok:false,error:{code,retryable:code==='storage_busy'}});
const same = (a,b) => JSON.stringify(a)===JSON.stringify(b);
const channels = ready => ({lexical:{state:ready?'ready':'unavailable',causes:ready?[]:['unavailable']},semantic:{state:'disabled',causes:['disabled']}});
const trace = semantic => ({requested:semantic?'hybrid':'lexical',effective:'lexical',family:'local',preset:'rrf-k60-d12',embedder:null,
  tokenizer:TOKENIZER_VERSION,representation:REPRESENTATION_VERSION,
  timings:{maintenanceMs:0,lexicalMs:0,semanticPreflightMs:0,embeddingMs:0,fusionMs:0}});
export function openProductIndex({ path, facade, authorize, ownerCoverage, observer, sqlite, sidecarJournalMode, maintenance, counter, semantic, operation, now = () => performance.now(), storageOptions = {} }) {
  const { db,read,evidence,bind,encode,identity,features,canonicalFence } = facade.port;
  const storage = productSidecar({path,db,identity,features,observer,sqlite,sidecarJournalMode,writable:maintenance,now,...storageOptions}), rankings=new Map();
  const vectors=semantic?productVectors({storage,facade}):null;
  const types=facade.capabilities.types;
  // Selection provenance is request coverage, never part of lexical identity.
  const selectionTrace = semantic => ({ ...trace(semantic), ...(ownerCoverage.omittedNamespaces > 0
    ? { namespaceSelection: { ...ownerCoverage } } : {}) });
  function validate(method,original) {
    if (method==='getContextIndexStatus') {
      const payload=ownData(original,['readSet','types','intent','deadlineMs']); deadline(payload.deadlineMs);
      const {input}=contextInput('findCandidates',{readSet:payload.readSet,types:payload.types,intent:payload.intent,query:'status'},types,undefined,PRODUCT_PROFILE);
      return {payload:original,input};
    }
    if (method==='refreshContextIndex') {
      if (!maintenance) fail('invalid_input');
      const {mode,...rest}=ownData(original,['readSet','types','intent','mode','budget']);
      if (!['lexical','embeddings'].includes(mode)) fail('invalid_input');
      if(semantic&&mode==='embeddings') {
        const b=ownData(rest.budget,['maxItems','maxMs','maxUsd']);
        if(Object.keys(b).length!==3||usd(b.maxUsd)>usd('0.50'))fail('invalid_input');
        const parsed=contextInput(method,{...rest,budget:{maxItems:b.maxItems,maxMs:b.maxMs}},types,undefined,PRODUCT_PROFILE);
        return {payload:original,input:{...parsed.input,mode,budget:{...parsed.input.budget,maxUsd:b.maxUsd}}};
      }
      const parsed=contextInput(method,rest,types,undefined,PRODUCT_PROFILE); return {payload:original,input:{...parsed.input,mode}};
    }
    // The flag cannot enable a provider. The default product policy always
    // reports disabled semantics and preserves the fully validated lexical list.
    return contextInput(method,original,types,undefined,PRODUCT_PROFILE);
  }
  function coverage(dto) {
    const ready=dto.lexical.state==='ready';
    return {...dto.coverage,byType:Object.fromEntries(Object.entries(dto.coverage.byType).map(([t,c])=>[t,{...c,scanned:0,
      embeddedFraction:null,scannedFraction:ready?c.eligible?0:1:null}])),
      maintenance:{available:maintenance,state:ready?'ready':'rebuilding',buildState:ready?'ready':'rebuilding',reason:dto.lexical.reason,progress:dto.lexical.progress},
      depths:{lexical:ready?24:0,semantic:0},omitted:{lexical:null,semantic:null,horizon:null},stops:{deadline:false,budget:false}};
  }
  function unavailable(access,dto,assembly=false,semantic=false) {
    const details={channels:channels(false),coverage:coverage(dto),trace:selectionTrace(semantic)};
    return access.envelope(()=>({ok:false,error:{code:'index_unavailable',retryable:false,details:assembly?{candidates:details}:details}}));
  }
  function final(p,access,publication,work,code='index_unavailable') {
    access.check();
    return read(()=>{
      const current=storage.observe(p,access.accessGenerations);
      if (current.dto.lexical.state!=='ready' || current.publication.publicationId!==publication.publicationId) fail(code);
      if(p.vectorPublication) {
        try{semantic.gate.check(p.semanticSnapshot.policy);}catch{fail(code);}
        const vector=vectors.observe(p,current.publication,p.semanticSnapshot);
        if(vector.status!=='complete'||vector.record.publicationId!==p.vectorPublication) {
          if(!p.freshSemantic)fail(code);
          return work(false);
        }
      }
      return work(true);
    });
  }
  function page(r,position,limit) {
    let end=Math.min(r.items.length,position+limit);
    do {
      const value={version:'context-read-v1',items:r.items.slice(position,end),channels:r.channels,coverage:r.coverage,trace:r.trace,
        nextCursor:end===r.items.length?null:encode('cursor',{v:1,id:r.id,binding:r.binding,publication:r.publication.publicationId,position:end},8192)};
      if (Buffer.byteLength(JSON.stringify(success(value)))<=65536) return success(value);
      end--;
    } while(end>position);
    fail('context_item_too_large');
  }
  function candidates(p,access,prepareOnly=false) {
    const observed=read(()=>storage.observe(p,access.accessGenerations));
    if (observed.dto.lexical.state!=='ready') return {observed};
    const detail=selectionTrace(p.semantic),started=performance.now();
    const ranked=storage.lexical(p,observed.publication,p.query);
    detail.timings.lexicalMs=performance.now()-started;
    const fusionStarted=performance.now();
    const fused=prepareOnly?{unionSize:ranked.rows.length,rows:ranked.rows.map((row,i)=>({...row,fusionScore:null,channels:{lexical:{rank:i+1,rawScore:row.score},semantic:null}}))}:
      fuseCandidates(ranked.rows,[],{preset:detail.preset,limit:24,semanticState:'disabled',coverageComplete:false});
    detail.timings.fusionMs=performance.now()-fusionStarted;
    const covered=coverage(observed.dto);
    covered.omitted={lexical:Math.max(0,ranked.matched-24),semantic:null,horizon:Math.max(0,fused.unionSize-24)};
    return {observed,items:fused.rows.map((row,i)=>({ref:row.ref,rank:i+1,fusionScore:row.fusionScore,channels:row.channels})),
      channels:channels(true),coverage:covered,trace:detail,...(prepareOnly?{lexical:ranked}:{})};
  }
  function assemble(p,access,c,prepareOnly=false) {
    if (!counter) fail('token_count_unavailable');
    const prepared=read(()=>{
      const generations=canonicalFence(p.readSet,p.types),items=[]; let unavailable=0;
      for(const candidate of c.items) {
        const ref=candidate.ref; let item;
        try {item=evidence.itemsInside(ref.namespace,[ref],p.intent,p.readSet)[0];}
        catch(e) {if(['evidence_unavailable','revision_conflict'].includes(e.code)){unavailable++;continue;}throw e;}
        const sources=item.type==='memory' && item.provenance.sourceAccess==='available'
          ? db.prepare('SELECT * FROM receipts WHERE memory_id=? ORDER BY created_at,id LIMIT 16').all(ref.memoryId).map((row,index)=>{
            const {role,excerpt}=validateSourceReceipt(ref.memoryId,row,source=>createHash('sha256').update(JSON.stringify(source)).digest('hex'));
            return {index,role,excerpt};
          }):[];
        items.push({type:item.type,ref,ns:p.readSet.findIndex(ns=>namespaceKey(ns)===namespaceKey(ref.namespace)),rank:candidate.rank,
          metadata:item.type==='memory'?{state:item.state,reviewState:item.reviewState,filing:item.filing,kind:item.kind,origin:item.origin,confidence:item.confidence}
            :{state:item.state,support:item.support,origin:item.origin},text:item.type==='memory'?item.content:item.title+'\n'+item.body,
          sources,sourceAccess:item.type==='memory'?item.provenance.sourceAccess:'unsupported',sourcesComplete:item.type==='memory' && item.provenance.coverage.status==='complete',fence:bind('snapshot-item',item)});
      }
      return {generations,items,unavailable};
    });
    const generationsFor=items=>prepared.generations.map(g=>({memory:g.memory,...(items.some(i=>i.type==='card')?{card:g.card}:{})}));
    const {selected:delivered,...assembled}=assembleContext({prepared:prepared.items,counter,policy:p.policy,budget:p.budget,deadlineAt:p.deadlineAt,
      snapshotOf:items=>encode('snapshot',{v:1,scope:bind('snapshot-scope',p.readSet),intent:p.intent,
        refs:items.map(({ref,ns})=>[ns,ref.type,ref.memoryId??ref.cardId,ref.revision,...(ref.type==='card'?[ref.bodyRevision]:[])]),
        generations:generationsFor(items),access:access.accessGenerations,fences:items.map(i=>i.fence)},16384)});
    assembled.diagnostics.omitted.unavailable=prepared.unavailable;
    assembled.diagnostics.candidates={count:c.items.length,channels:c.channels,coverage:c.coverage,trace:c.trace};
    const result=success(assembled);
    if(Buffer.byteLength(JSON.stringify(result))>65536)fail('context_item_too_large');
    const complete=()=>{
      if(delivered.length && !same(canonicalFence(p.readSet,[...new Set(delivered.map(i=>i.type))]),generationsFor(delivered)))fail('snapshot_stale');
      for(const item of delivered){
        let current;
        try{current=evidence.itemsInside(item.ref.namespace,[item.ref],p.intent,p.readSet)[0];}
        catch(e){if(['evidence_unavailable','revision_conflict'].includes(e.code))fail('snapshot_stale');throw e;}
        if(bind('snapshot-item',current)!==item.fence)fail('snapshot_stale');
      }
      return result;
    };
    return prepareOnly?{complete,result}:final(p,access,c.observed.publication,complete,'snapshot_stale');
  }
  function run(method,original,credential,cutoff=Infinity,observation) {
    if(semantic&&(method==='getContextIndexStatus'||method==='refreshContextIndex'&&original.mode==='embeddings'||['findCandidates','contextRead'].includes(method)&&original.semantic===true&&original.cursor===undefined))return runSemantic(method,original,credential,cutoff);
    let access;
    try {
      facade.port.ready();
      const {payload,input}=validate(method,original);
      access=authorize(method,payload,credential);
      const p={...input,ownerCoverage,deadlineAt:Math.min(cutoff,now()+ (input.deadlineMs??input.budget?.maxMs??1000))};
      if(method==='getContextIndexStatus') {
        const knownFailure=storage.prepareObservation();access.check(); return read(()=>{
          db.prepare('SELECT store_id FROM store_metadata WHERE singleton=1').get();
          return success(storage.observe(p,access.accessGenerations,{knownFailure}).dto);
        });
      }
      if(method==='refreshContextIndex') {
        const m=p.mode==='lexical'?storage.refresh(p,access.accessGenerations,p.budget):{transformed:0};
        if(observation)for(const name of ['transformed','canonicalRows','metadataBytes','textRows','textBytes','supportLookups','supportBytes','verifiedRows']){
          if(Number.isSafeInteger(m[name])&&m[name]>=0)observation[name]=m[name];
        }
        const knownFailure=storage.prepareObservation();access.check();
        const epochStarted=Number(process.hrtime.bigint())/1e6;
        try{return read(()=>{
          // This first canonical read acquires the fresh snapshot (§6.1.2).
          // Sample at its entry so acquisition/native-read latency cannot move
          // the previous observation's deadline later. This is a conservative
          // bound on the actual snapshot time, not admission or result delivery.
          // No host callback or await; only successful comparisons transport it.
          if(observation)observation.at=Number(process.hrtime.bigint())/1e6;
          db.prepare('SELECT store_id FROM store_metadata WHERE singleton=1').get();
          const observed=storage.observe(p,access.accessGenerations,{knownFailure}),ready=observed.dto.lexical.state==='ready';
          const covered=coverage(observed.dto);covered.stops.budget=m.transformed>=p.budget.maxItems;
          return success({status:ready?p.mode==='embeddings'?'partial':'complete':'rebuilding',
            progress:{lexical:observed.dto.lexical.progress,transformed:m.transformed,embeddingAttempts:0,embedded:0},coverage:covered,channels:channels(ready)});
        });}finally{if(observation)observation.epochObservationMs=Number(process.hrtime.bigint())/1e6-epochStarted;}
      }
      const binding=digest({readSet:p.readSet,types:p.types,intent:p.intent,query:p.query,semantic:p.semantic,access:access.accessGenerations});
      if(p.cursor!==undefined) {
        // decode is an internal bounded HMAC port; never interpret legacy tokens.
        const token=facade.port.decode('cursor',p.cursor,8192,'invalid_cursor');
        if(!token || token.v!==1 || token.binding!==binding || !Number.isSafeInteger(token.position) || token.position<1)fail('invalid_cursor');
        const r=rankings.get(token.id);
        if(!r || r.expires<=Date.now() || token.publication!==r.publication.publicationId || token.position>=r.items.length)fail('cursor_stale');
        const result=page(r,token.position,p.limit);
        if(r.trace.semantic) {result.value.trace={...r.trace};delete result.value.trace.semantic;}
        if(r.vectorPublication){p.vectorPublication=r.vectorPublication;p.semanticSnapshot=r.semanticSnapshot;}
        try{return final(p,access,r.publication,()=>{
          for(const candidate of result.value.items)evidence.itemsInside(candidate.ref.namespace,[candidate.ref],p.intent,p.readSet);
          return result;
        });}catch(e){if(e.code==='index_unavailable')fail('cursor_stale');throw e;}
      }
      const c=candidates(p,access);
      if(!c.items)return unavailable(access,c.observed.dto,method==='contextRead',p.semantic);
      if(method==='contextRead')return assemble(p,access,c);
      for(const [id,r] of rankings)if(r.expires<=Date.now())rankings.delete(id);
      while(rankings.size>=128)rankings.delete(rankings.keys().next().value);
      const r={...c,id:randomUUID(),binding,publication:c.observed.publication,expires:Date.now()+300000};rankings.set(r.id,r);
      const result=page(r,0,p.limit);
      return final(p,access,r.publication,()=>{
        for(const candidate of result.value.items)evidence.itemsInside(candidate.ref.namespace,[candidate.ref],p.intent,p.readSet);
        return result;
      });
    } catch(e) {
      const code=e.code==='ERR_SQLITE_ERROR'?[5,6].includes(e.errcode&255)?'storage_busy':'storage_error':e.code??'storage_error';
      return failure(code);
    }
  }
  const channelFor=reason=>reason===null?'ready':reason==='not_enabled'?'disabled':['missing_vectors','validation_invalid','identity_changed','capacity_exceeded'].includes(reason)?'partial_coverage':
    ['ledger_unavailable','backfill_ceiling','purge_pending','price_unavailable','budget_denied'].includes(reason)?'budget_denied':reason==='not_configured'?'absent':reason==='index_not_ready'?'stale_index':reason==='provider_unavailable'?'unavailable':reason;
  function semanticReason(snapshot,ready) {
    return snapshot.unavailable?'ledger_unavailable':snapshot.policy?.semantic===false?'not_enabled':snapshot.purgePending?'purge_pending':snapshot.blocked?'backfill_ceiling':
      !snapshot.identity?'not_configured':!ready?'index_not_ready':snapshot.providerUnavailable?'provider_unavailable':null;
  }
  function scopedStatus(p,observed,snapshot) {
    let reason=semanticReason(snapshot,observed.dto.lexical.state==='ready'),v=null;
    if(!reason||reason==='provider_unavailable'){v=vectors.observe(p,observed.publication,snapshot);if(!reason)reason=v.reason;}
    const enabled=snapshot.policy?.semantic??null;
    const state=reason===null?'ready':reason==='not_enabled'?'disabled':reason==='not_configured'?'absent':reason==='index_not_ready'?'stale_index':['missing_vectors','identity_changed'].includes(reason)?'partial_coverage':'unavailable';
    const byType=Object.fromEntries(p.types.map(t=>[t,{eligible:v?.record?.counts.byType[t].eligible??null,embedded:v?.record?.counts.byType[t].embedded??null}]));
    const dto=observed.dto;
    dto.semantic={state,reason,extension:'context-read-product-p2e-v1',enabled,ownerPolicyRevision:snapshot.policy?.revision??null,identity:snapshot.identity,coverage:{status:v?.status??'unavailable',byType}};
    for(const t of p.types)dto.coverage.byType[t].embedded=byType[t].embedded;
    return dto;
  }
  async function runSemantic(method,original,credential,parentCutoff) {
    let access;
    try {
      facade.port.ready();const {payload,input}=validate(method,original);access=authorize(method,payload,credential);
      const cutoff=mono(operation().operationCutoffMonoNs),remaining=()=>Number(cutoff-process.hrtime.bigint())/1e6;
      const p={...input,ownerCoverage,deadlineAt:Math.min(parentCutoff,now()+remaining())};
      if(method==='getContextIndexStatus') {
        const snapshot=await semantic.snapshot(),knownFailure=storage.prepareObservation();access.check();
        return read(()=>{db.prepare('SELECT store_id FROM store_metadata WHERE singleton=1').get();return success(scopedStatus(p,storage.observe(p,access.accessGenerations,{knownFailure}),snapshot));});
      }
      if(method==='refreshContextIndex')return await embeddingRefresh(p,access,cutoff);
      const c=candidates(p,access,true);
      const preflightStart=performance.now(),snapshot=await semantic.snapshot();
      if(!c.items) {
        const reason=semanticReason(snapshot,false),state=channelFor(reason),detail={channels:channels(false),coverage:coverage(c.observed.dto),trace:{...selectionTrace(true),family:'hosted',preset:'rrf-k10',embedder:snapshot.identity&&(({id,revision,dimensions,normalization})=>({id,revision,dimensions,normalization}))(snapshot.identity),
          semantic:{extension:'context-read-product-p2e-v1',coverage:'unavailable',queryEmbeddingAttempts:0,queryEmbeddingBudgetMs:0,queryEmbeddingMs:0,degradedReason:reason}}};
        detail.channels.semantic={state,causes:state==='ready'?[]:[state]};
        return access.envelope(()=>({ok:false,error:{code:'index_unavailable',retryable:false,details:method==='contextRead'?{candidates:detail}:detail}}));
      }
      const detail=c.trace,lexicalItems=c.items;
      p.freshSemantic=true;
      const lifecycleReason=semanticReason(snapshot,true);let reason=lifecycleReason,preflight;
      detail.family='hosted';detail.preset='rrf-k10';detail.embedder=snapshot.identity&&(({id,revision,dimensions,normalization})=>({id,revision,dimensions,normalization}))(snapshot.identity);
      if(!reason||reason==='provider_unavailable'){preflight=vectors.observe(p,c.observed.publication,snapshot,{load:!reason});if(!reason)reason=preflight.reason;}
      detail.timings.semanticPreflightMs=performance.now()-preflightStart;
      const diagnostic={extension:'context-read-product-p2e-v1',coverage:preflight?.status??'unavailable',queryEmbeddingAttempts:0,queryEmbeddingBudgetMs:0,queryEmbeddingMs:0,degradedReason:reason};
      let ranked=[];
      if(!reason) {
        const t=process.hrtime.bigint(),sub=queryEmbeddingCutoff({now:t,cutoff,maxMs:semantic.configuration.queryEmbeddingMaxMs,timeoutMs:semantic.configuration.selection.requestTimeoutMs,finalizeReserveMs:semantic.configuration.finalizeReserveMs});
        if(sub<=t)reason='timeout';
        else {
          diagnostic.queryEmbeddingBudgetMs=Number(sub-t)/1e6;const started=performance.now();
          try {
            const result=await semantic.call('embed',{texts:[p.query],kind:'query',expected:snapshot.policy,projection:{readSet:p.readSet,types:p.types,intent:p.intent,accessDigest:c.observed.publication.accessDigest,lexicalValidationDigest:digest(c.observed.publication),vectorValidationDigest:digest(preflight.record)}},sub);
            diagnostic.queryEmbeddingAttempts=1;
            ranked=vectors.rank(preflight,result.vectors[0]);p.vectorPublication=preflight.record.publicationId;p.semanticSnapshot=snapshot;
          }catch(error){reason=['not_enabled','purge_pending','backfill_ceiling','ledger_unavailable','price_unavailable','timeout','provider_error','rate_limited','budget_denied','dimension_mismatch','provider_unavailable'].includes(error.code)?error.code:'provider_error';diagnostic.queryEmbeddingAttempts=error.attempts??0;}
          diagnostic.queryEmbeddingMs=diagnostic.queryEmbeddingAttempts?performance.now()-started:0;detail.timings.embeddingMs=diagnostic.queryEmbeddingMs;
        }
      }
      if(p.vectorPublication) {
        const current=read(()=>{const lexical=storage.observe(p,access.accessGenerations);return vectors.observe(p,lexical.publication,snapshot);});
        if(current.status!=='complete'||current.record.publicationId!==p.vectorPublication) {
          reason=current.reason??'validation_invalid';ranked=[];delete p.vectorPublication;
          diagnostic.coverage=current.status;
        }
      }
      diagnostic.degradedReason=reason;detail.semantic=diagnostic;
      const channel=channelFor(reason),causes=[...new Set([lifecycleReason,preflight?.reason,reason].filter(Boolean).map(channelFor))];c.channels.semantic={state:channel,causes};
      if(preflight?.record)for(const t of p.types){const count=preflight.record.counts.byType[t];c.coverage.byType[t].embedded=count.embedded;c.coverage.byType[t].embeddedFraction=count.eligible?count.embedded/count.eligible:1;}
      const fusionStarted=performance.now(),lexical=c.lexical,fused=fuseCandidates(lexical.rows,ranked,{preset:'rrf-k10',limit:24,semanticState:channel,coverageComplete:preflight?.status==='complete'});
      detail.timings.fusionMs=performance.now()-fusionStarted;
      c.items=fused.rows.map((row,i)=>({ref:row.ref,rank:i+1,fusionScore:row.fusionScore,channels:row.channels}));
      detail.effective=fused.mode;c.coverage.depths.semantic=reason===null?24:0;
      c.coverage.omitted={lexical:Math.max(0,lexical.matched-24),semantic:reason===null?Math.max(0,ranked.length-24):null,horizon:Math.max(0,fused.unionSize-24)};
      const lexicalFallback=source=>({...source,items:lexicalItems,
        trace:{...source.trace,effective:'lexical',semantic:{...diagnostic,degradedReason:'validation_invalid',coverage:'unavailable'}},
        channels:{...source.channels,semantic:{state:'partial_coverage',causes:['partial_coverage']}},
        coverage:{...source.coverage,depths:{...source.coverage.depths,semantic:0},omitted:{lexical:Math.max(0,lexical.matched-24),semantic:null,horizon:0}}});
      if(method==='contextRead') {
        if(!p.vectorPublication)return assemble(p,access,c);
        // Freeze publication only for synchronous assembly/final validation;
        // no provider/authority await or SQLite transaction spans the gate.
        // Choose one horizon before counting, preserving the single-assembly
        // counter bound even when the two horizons have no shared units.
        let release;
        try {release=semantic.gate.enter(snapshot.policy);}catch {
          delete p.vectorPublication;
          return assemble(p,access,lexicalFallback(c));
        }
        try {
          const current=read(()=>{const lexical=storage.observe(p,access.accessGenerations);return vectors.observe(p,lexical.publication,snapshot);});
          if(current.status!=='complete'||current.record.publicationId!==p.vectorPublication) {
            delete p.vectorPublication;
            return assemble(p,access,lexicalFallback(c));
          }
          const delivery=assemble(p,access,c,true);
          return final(p,access,c.observed.publication,valid=>{
            // Out-of-protocol evidence damage cannot authorize stale vectors.
            if(!valid)fail('snapshot_stale');
            return delivery.complete();
          },'snapshot_stale');
        }finally{release();}
      }
      for(const [id,r] of rankings)if(r.expires<=Date.now())rankings.delete(id);while(rankings.size>=128)rankings.delete(rankings.keys().next().value);
      const binding=digest({readSet:p.readSet,types:p.types,intent:p.intent,query:p.query,semantic:p.semantic,access:access.accessGenerations});
      const r={...c,id:randomUUID(),binding,publication:c.observed.publication,expires:Date.now()+300000,vectorPublication:p.vectorPublication,semanticSnapshot:snapshot};rankings.set(r.id,r);
      return final(p,access,r.publication,valid=>{
        if(!valid){Object.assign(r,lexicalFallback(r));delete r.vectorPublication;}
        const result=page(r,0,p.limit);
        for(const candidate of result.value.items)evidence.itemsInside(candidate.ref.namespace,[candidate.ref],p.intent,p.readSet);
        return result;
      });
    }catch(error){return failure(error.code==='ERR_SQLITE_ERROR'?[5,6].includes(error.errcode&255)?'storage_busy':'storage_error':error.code??'storage_error');}
  }
  async function embeddingRefresh(p,access,cutoff) {
    // Start before opening or any authority/provider work; the parent window
    // cannot be reset by dispatch, expensive open or asynchronous settlement.
    const quantum=maintenanceQuantum({now,cutoff:Math.min(p.deadlineAt,now()+p.budget.maxMs),maxMs:p.budget.maxMs});
    const localProviderCutoff=process.hrtime.bigint()+BigInt(Math.max(0,Math.floor((quantum.cutoff-now()-quantum.reserve)*1e6)));
    const parentProviderCutoff=cutoff-BigInt(Math.ceil(quantum.reserve*1e6));
    const providerCutoff=localProviderCutoff<parentProviderCutoff?localProviderCutoff:parentProviderCutoff;
    const observed=read(()=>storage.observe(p,access.accessGenerations)),snapshot=await semantic.snapshot();
    const ready=observed.dto.lexical.state==='ready';let reason=semanticReason(snapshot,ready),attempts=0,embedded=0,spent=0n;
    const physical=read(()=>canonicalProductIdentity(path,db));
    if(ready&&!reason) {
      const sidecarIdentity=productFile(path+PRODUCT_SIDECAR_SUFFIX);
      const catalog={catalogId:digest({storeId:identity.storeId,canonicalIdentity:physical,sidecarIdentity}),ownerId:p.readSet[0].ownerId,storeId:identity.storeId,canonicalPath:path,canonicalIdentity:physical,sidecarIdentity,sidecarJournalMode:sidecarJournalMode??'DELETE'};
      try{await semantic.call('catalog',catalog);}catch(error){if(!['not_enabled','purge_pending','ledger_unavailable','timeout'].includes(error.code))throw error;reason=error.code;}
      let maximum=Math.min(p.budget.maxItems,semantic.configuration.selection.maxBatchDocuments,64);
      while(!reason&&attempts<p.budget.maxItems&&quantum.admit('embedding-item')&&quantum.admit('vector-scan')) {
        let rows=vectors.plan(p,observed.publication,snapshot,Math.min(maximum,p.budget.maxItems-attempts),quantum);if(!rows.length||!quantum.admit('embedding-item'))break;
        try {
          await quantum.measureAsync(async()=>{
            const texts=read(()=>rows.map(r=>{const item=evidence.itemsInside(r.ref.namespace,[r.ref],p.intent,p.readSet)[0];return item.type==='memory'?item.content:item.title+'\n'+item.body;}));
            while(texts.length>1&&Buffer.byteLength(JSON.stringify(texts))>240000){texts.pop();rows.pop();}
            const result=await semantic.call('embed',{texts,kind:'refresh',expected:snapshot.policy,projection:{readSet:p.readSet,types:p.types,intent:p.intent,accessDigest:observed.publication.accessDigest,lexicalValidationDigest:digest(observed.publication)},maxUsd:dollars(usd(p.budget.maxUsd)-spent)},providerCutoff);
            attempts+=rows.length;spent+=usd(result.chargedUsd);
            const guard=await semantic.snapshot();
            if(guard.policy?.purgeEpoch!==snapshot.policy.purgeEpoch||!guard.policy?.semantic){reason='purge_pending';return;}
            read(()=>{const current=storage.observe(p,access.accessGenerations);if(current.dto.lexical.state!=='ready'||current.publication.publicationId!==observed.publication.publicationId)fail('index_unavailable');});
            const release=semantic.gate.enter(snapshot.policy);
            try{vectors.put(p,observed.publication,snapshot,rows,result.vectors);}finally{release();}embedded+=rows.length;
          },'embedding-item');
        }catch(error) {
          if(error.code==='budget_denied'&&!error.attempts&&rows.length>1){maximum=Math.max(1,Math.floor(rows.length/2));continue;}
          attempts+=(error.attempts??0)?rows.length:0;reason=error.code;break;
        }
      }
      if((!reason||attempts>0)&&quantum.admit('vector-scan')&&quantum.admit('vector-verification')) {
        let release;
        try{release=semantic.gate.enter(snapshot.policy);vectors.certify(p,observed.publication,snapshot,quantum);}catch(error){reason=error.reason==='validation_invalid'||error.code==='index_unavailable'?'validation_invalid':error.code==='read_timeout'?'timeout':error.code;}finally{release?.();}
      }
    }
    if(!snapshot.unavailable) {
      const vector=ready&&snapshot.identity&&snapshot.policy.semantic?vectors.observe(p,observed.publication,snapshot):null;
      const target={storeId:identity.storeId,canonicalIdentity:physical,readSet:p.readSet,types:p.types,intent:p.intent};
      await semantic.call('hint',{targetDigest:digest(target),purgeEpoch:snapshot.policy?.purgeEpoch??0,complete:vector?.status==='complete',certificate:vector?.record?digest(vector.record):null});
    }
    const finalSnapshot=await semantic.snapshot(),knownFailure=storage.prepareObservation();access.check();
    return read(()=>{
      db.prepare('SELECT store_id FROM store_metadata WHERE singleton=1').get();
      const current=storage.observe(p,access.accessGenerations,{knownFailure}),dto=scopedStatus(p,current,finalSnapshot),covered=coverage(dto),isReady=dto.lexical.state==='ready',complete=dto.semantic.state==='ready';
      covered.stops.budget=attempts>=p.budget.maxItems||reason==='budget_denied';
      return success({status:isReady?complete?'complete':'partial':'rebuilding',progress:{lexical:dto.lexical.progress,transformed:0,embeddingAttempts:attempts,embedded},coverage:covered,channels:{lexical:channels(isReady).lexical,semantic:{state:complete?'ready':channelFor(isReady?reason??dto.semantic.reason:dto.semantic.reason),causes:complete?[]:[channelFor(isReady?reason??dto.semantic.reason:dto.semantic.reason)]}}});
    });
  }
  return {run,close(){storage.close();rankings.clear();},assembly:{representation:'representation-v2',defaults:ASSEMBLY_DEFAULTS,policies:ASSEMBLY_POLICIES,
    defaultPolicy:'rank-first-whole-v1',counter:counter?{id:counter.id}:null,limits:ASSEMBLY_LIMITS}};
}

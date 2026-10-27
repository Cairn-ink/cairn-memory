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

const success = value => ({ok:true,value});
const failure = code => ({ok:false,error:{code,retryable:code==='storage_busy'}});
const same = (a,b) => JSON.stringify(a)===JSON.stringify(b);
const channels = ready => ({lexical:{state:ready?'ready':'unavailable',causes:ready?[]:['unavailable']},semantic:{state:'disabled',causes:['disabled']}});
const trace = semantic => ({requested:semantic?'hybrid':'lexical',effective:'lexical',family:'local',preset:'rrf-k60-d12',embedder:null,
  tokenizer:TOKENIZER_VERSION,representation:REPRESENTATION_VERSION,
  timings:{maintenanceMs:0,lexicalMs:0,semanticPreflightMs:0,embeddingMs:0,fusionMs:0}});
export function openProductIndex({ path, facade, authorize, ownerCoverage, observer, sqlite, sidecarJournalMode, maintenance, counter }) {
  const { db,read,evidence,bind,encode,identity,features,canonicalFence } = facade.port;
  const storage = productSidecar({path,db,identity,features,observer,sqlite,sidecarJournalMode,writable:maintenance}), rankings=new Map();
  const types=facade.capabilities.types;
  function validate(method,original) {
    if (method==='getContextIndexStatus') {
      const payload=ownData(original,['readSet','types','intent','deadlineMs']); deadline(payload.deadlineMs);
      const {input}=contextInput('findCandidates',{readSet:payload.readSet,types:payload.types,intent:payload.intent,query:'status'},types);
      return {payload:original,input};
    }
    if (method==='refreshContextIndex') {
      if (!maintenance) fail('invalid_input');
      const {mode,...rest}=ownData(original,['readSet','types','intent','mode','budget']);
      if (!['lexical','embeddings'].includes(mode)) fail('invalid_input');
      const parsed=contextInput(method,rest,types); return {payload:original,input:{...parsed.input,mode}};
    }
    // The flag cannot enable a provider. The default product policy always
    // reports disabled semantics and preserves the fully validated lexical list.
    return contextInput(method,original,types);
  }
  function coverage(dto) {
    const ready=dto.lexical.state==='ready';
    return {...dto.coverage,byType:Object.fromEntries(Object.entries(dto.coverage.byType).map(([t,c])=>[t,{...c,scanned:0,
      embeddedFraction:null,scannedFraction:ready?c.eligible?0:1:null}])),
      maintenance:{available:maintenance,state:ready?'ready':'rebuilding',buildState:ready?'ready':'rebuilding',reason:dto.lexical.reason,progress:dto.lexical.progress},
      depths:{lexical:ready?24:0,semantic:0},omitted:{lexical:null,semantic:null,horizon:null},stops:{deadline:false,budget:false}};
  }
  function unavailable(access,dto,assembly=false,semantic=false) {
    const details={channels:channels(false),coverage:coverage(dto),trace:trace(semantic)};
    return access.envelope(()=>({ok:false,error:{code:'index_unavailable',retryable:false,details:assembly?{candidates:details}:details}}));
  }
  function final(p,access,publication,work,code='index_unavailable') {
    access.check();
    return read(()=>{
      const current=storage.observe(p,access.accessGenerations);
      if (current.dto.lexical.state!=='ready' || current.publication.publicationId!==publication.publicationId) fail(code);
      return work();
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
  function candidates(p,access) {
    const observed=read(()=>storage.observe(p,access.accessGenerations));
    if (observed.dto.lexical.state!=='ready') return {observed};
    const detail=trace(p.semantic),started=performance.now();
    const ranked=storage.lexical(p,observed.publication,p.query);
    detail.timings.lexicalMs=performance.now()-started;
    const fusionStarted=performance.now();
    const fused=fuseCandidates(ranked.rows,[],{});
    detail.timings.fusionMs=performance.now()-fusionStarted;
    const covered=coverage(observed.dto);
    covered.omitted={lexical:Math.max(0,ranked.matched-24),semantic:null,horizon:Math.max(0,fused.unionSize-24)};
    return {observed,items:fused.rows.map((row,i)=>({ref:row.ref,rank:i+1,fusionScore:row.fusionScore,channels:row.channels})),
      channels:channels(true),coverage:covered,trace:detail};
  }
  function assemble(p,access,c) {
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
    return final(p,access,c.observed.publication,()=>{
      if(delivered.length && !same(canonicalFence(p.readSet,[...new Set(delivered.map(i=>i.type))]),generationsFor(delivered)))fail('snapshot_stale');
      for(const item of delivered){
        let current;
        try{current=evidence.itemsInside(item.ref.namespace,[item.ref],p.intent,p.readSet)[0];}
        catch(e){if(['evidence_unavailable','revision_conflict'].includes(e.code))fail('snapshot_stale');throw e;}
        if(bind('snapshot-item',current)!==item.fence)fail('snapshot_stale');
      }
      return result;
    },'snapshot_stale');
  }
  function run(method,original,credential) {
    let access;
    try {
      facade.port.ready();
      const {payload,input}=validate(method,original);
      access=authorize(method,payload,credential);
      const p={...input,ownerCoverage,deadlineAt:performance.now()+ (input.deadlineMs??input.budget?.maxMs??1000)};
      if(method==='getContextIndexStatus') {
        const knownFailure=storage.prepareObservation();access.check(); return read(()=>{
          db.prepare('SELECT store_id FROM store_metadata WHERE singleton=1').get();
          return success(storage.observe(p,access.accessGenerations,{knownFailure}).dto);
        });
      }
      if(method==='refreshContextIndex') {
        const m=p.mode==='lexical'?storage.refresh(p,access.accessGenerations,p.budget):{transformed:0};
        const knownFailure=storage.prepareObservation();access.check();
        return read(()=>{
          db.prepare('SELECT store_id FROM store_metadata WHERE singleton=1').get();
          const observed=storage.observe(p,access.accessGenerations,{knownFailure}),ready=observed.dto.lexical.state==='ready';
          const covered=coverage(observed.dto);covered.stops.budget=m.transformed>=p.budget.maxItems;
          return success({status:ready?p.mode==='embeddings'?'partial':'complete':'rebuilding',
            progress:{lexical:observed.dto.lexical.progress,transformed:m.transformed,embeddingAttempts:0,embedded:0},coverage:covered,channels:channels(ready)});
        });
      }
      const binding=digest({readSet:p.readSet,types:p.types,intent:p.intent,query:p.query,semantic:p.semantic,access:access.accessGenerations});
      if(p.cursor!==undefined) {
        // decode is an internal bounded HMAC port; never interpret legacy tokens.
        const token=facade.port.decode('cursor',p.cursor,8192,'invalid_cursor');
        if(!token || token.v!==1 || token.binding!==binding || !Number.isSafeInteger(token.position) || token.position<1)fail('invalid_cursor');
        const r=rankings.get(token.id);
        if(!r || r.expires<=Date.now() || token.publication!==r.publication.publicationId || token.position>=r.items.length)fail('cursor_stale');
        const result=page(r,token.position,p.limit);
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
  return {run,close(){storage.close();rankings.clear();},assembly:{representation:'representation-v2',defaults:ASSEMBLY_DEFAULTS,policies:ASSEMBLY_POLICIES,
    defaultPolicy:'rank-first-whole-v1',counter:counter?{id:counter.id}:null,limits:ASSEMBLY_LIMITS}};
}

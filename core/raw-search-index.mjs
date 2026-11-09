import { withContentSuppressionRequest } from './content-suppression-storage.mjs';
import { rawSearchOptions,searchInput,immutable,same,RAW_SEARCH_VERSION,RAW_SEARCH_LIMITS } from './raw-search-input.mjs';
import { fail } from './validation.mjs';
import { performance } from 'node:perf_hooks';
import { contextBudget } from './context-read-budget.mjs';
import { randomUUID } from 'node:crypto';
import { dirname } from 'node:path';
import { createRawSearchCache } from './raw-search-cache.mjs';
import { rawSearchSqlite, rawSearchDeadline } from './raw-search-sqlite.mjs';

const publicCodes = new Set(['invalid_input','invalid_query','invalid_read_set','authority_required','scope_changed',
  'stale_publication','store_closed','read_in_progress','maintenance_authority_required','raw_search_backend_unavailable']);
const pageAllowanceMs=100;
const expired = at => {if(performance.now()>=at)rawSearchDeadline();};
const interrupted = error => ['source_busy','search_deadline'].includes(error?.code);
const emptyPartial = () => immutable({version:RAW_SEARCH_VERSION,publication:null,candidates:[],
  coverage:{status:'partial',scanned:null,expanded:null,causes:['deadline']},semantic:{state:'unknown',reason:null}});
const safeFailure = error => { fail(publicCodes.has(error?.code) ? error.code : 'raw_search_unavailable'); };

/** Open the configured Raw store; enabled:false explicitly disables search. */
export async function openRawSearch(value) {
  if (value === undefined || value === false || value?.enabled === false) return null;
  const options=rawSearchOptions(value);
  let openingDeadlineAt=performance.now()+1000;
  const openingCheck=()=>expired(openingDeadlineAt);
  const [{openReadDatabase},{createRawSearchAuthority},{openRawSearchStorage},{createRawSearchMaintenance},retrieval,embedding,{sqliteFileStat}]=await Promise.all([
    import('./read-database.mjs'),import('./raw-search-authority.mjs'),import('./raw-search-storage.mjs'),
    import('./raw-search-maintenance.mjs'),import('./raw-search-retrieval.mjs'),import('./context-read-embedder.mjs'),import('./sqlite-journal-probe.mjs')]);
  let database,storage;
  try {
    const canonicalFile=()=>{
      if(sqliteFileStat(options.path).nlink!==1n)fail('unsafe_database_file');
      for(let path=options.path;;path=dirname(path)){
        if(sqliteFileStat(path).isSymbolicLink())fail('unsafe_database_file');
        if(dirname(path)===path)break;
      }
    };
    canonicalFile();
    database=openReadDatabase(options.path,{contextRead:true,busyTimeoutMs:0,preflight:openingCheck,
      nativeObserver:{invoke(_kind,_label,work){openingCheck();return work();},database:native=>rawSearchSqlite(native,openingCheck)}});
    const assertFile=database.assertFile;
    database.assertFile=()=>{assertFile();canonicalFile();};
    const authority=createRawSearchAuthority(database,options);
    storage=await openRawSearchStorage({directory:options.directory,identity:authority.identity,bind:authority.bind,quotaBytes:options.quotaBytes,deadlineAt:openingDeadlineAt});
    openingCheck();openingDeadlineAt=Infinity;
    const metadata=options.embedder&&{id:options.embedder.id,revision:options.embedder.revision,
      dimensions:options.embedder.dimensions,normalization:options.embedder.normalization};
    const cacheEnabled=options.policy?.family==='local'&&!!metadata;
    const cache=createRawSearchCache({enabled:cacheEnabled,checkKey:()=>{
      return withContentSuppressionRequest(()=>{database.assertFile();return authority.cacheKey(storage.publication({shape:false}),metadata);},{fresh:true});
    }});
    const maintenance=createRawSearchMaintenance(storage,authority,options),prepared=new Map(),searches=new Map();
    const dispatch=options.embedder&&contextBudget({budgetConfigured:true,policy:options.policy,embedder:options.embedder});
    const releaseResidency=embedding.selectRawVectorResidency();
    const instance=randomUUID();
    let closed=false,serial=0;
    const operations=new Set();
    const ready=()=>{if(closed)fail('store_closed');database.assertFile();};
    const tracked=work=>(...args)=>{
      const operation=withContentSuppressionRequest(async()=>{try{ready();return await work(...args);}catch(error){safeFailure(error);}},{fresh:true});
      operations.add(operation);operation.then(()=>operations.delete(operation),()=>operations.delete(operation));return operation;
    };
    function retain(map,key,entry,limit) {
      for(const [id,value] of map)if(value.expires<performance.now())map.delete(id);
      while(map.size>=limit)map.delete(map.keys().next().value);
      map.set(key,{...entry,expires:performance.now()+5000});
    }
    const checkSources=(sources,intent,at=Infinity)=>{for(const source of sources)authority.check(source,intent,at);};
    async function retry(work,at,onExhausted) {
      while(true)try{expired(at);return await work(at);}catch(error){
        if(!interrupted(error))throw error;
        cache.drop();authority.reset();
        if(error.code==='search_deadline')return onExhausted();
        const wait=error.code==='source_busy'?Math.max(0,authority.resume()-performance.now()):0;
        if(at-performance.now()<wait+pageAllowanceMs)return onExhausted();
        if(wait)await new Promise(resolve=>setTimeout(resolve,wait));
        try{authority.refresh(at);}catch(next){if(!interrupted(next))throw next;}
      }
    }
    async function search(value,token) {
      const at=performance.now()+1000;
      return retry(deadlineAt=>searchAttempt(value,token,deadlineAt),at,emptyPartial);
    }
    async function searchAttempt(value,token,deadlineAt) {
      const input=searchInput(value),access=authority.authorize('rawSearch',input,token);access();
      expired(deadlineAt);
      let cacheProof,borrowed,residency,vectors=null;
      try {
        let state=null;
        if(cacheEnabled)try{
          const publication=storage.publication({shape:false,deadlineAt});
          cacheProof={publication,metadata,key:authority.cacheKey(publication,metadata,deadlineAt)};
          borrowed=cache.acquire(cacheProof.key);
          if(borrowed){
            state=storage.publication({deadlineAt});
            if(state.sequence!==publication.sequence||state.revision!==publication.revision){
              borrowed.release();borrowed=null;cache.drop();cacheProof=undefined;
            }
          }
        }catch(error){borrowed?.release();borrowed=null;cache.drop();cacheProof=undefined;if(interrupted(error))throw error;}
        const snapshot=borrowed?{...state,rows:borrowed.rows}:await storage.search({deadlineAt});expired(deadlineAt);access();
        // A concurrent publication between the optional header read and the
        // payload snapshot only defers caching. It adds no new search error.
        if(cacheProof&&snapshot.sequence!==cacheProof.publication.sequence){cache.drop();cacheProof=undefined;}
        // Scope before scoring: no foreign owner or namespace enters a corpus.
        const scopeKeys=new Set(options.readSet.map(ns=>JSON.stringify(ns)));
        const scopedRows=snapshot.rows.filter(row=>{expired(deadlineAt);return scopeKeys.has(JSON.stringify(row.source.ref.namespace));});
        const guard=()=>{ready();expired(deadlineAt);access();};
        let semantic={state:'bm25-only',reason:options.embedder?'partial_coverage':'disabled'},queryVector=null;
        const port=options.embedder;let query=input.queryVector;
        const chunks=scopedRows.reduce((n,row)=>{expired(deadlineAt);return n+row.chunks.length;},0);
        const complete=!snapshot.partial&&scopedRows.every(row=>same(row.embedder,metadata)&&row.chunks.every(c=>c.vector));
        if(port&&!query&&complete&&scopedRows.length&&embedding.semanticCapacity(chunks,port).eligible){
          try{
            if(Buffer.byteLength(input.query)+64>8192)fail('provider_error');
            const result=await dispatch(port,[input.query],{signal:new AbortController().signal,deadlineAt,guard});
            if(!Array.isArray(result)||result.length!==1)fail('invalid_vector');
            query={input:input.query,embedder:metadata,vector:result[0]};
          }catch(error){guard();semantic={state:'bm25-only',reason:['budget_denied','timeout','rate_limited'].includes(error.code)?error.code:'provider_error'};}
        }
        if(port&&query&&query.input===input.query&&same(query.embedder,metadata)&&embedding.semanticCapacity(chunks,port).eligible&&complete){
          try {
            // Another search may have populated the same reader while this
            // operation awaited its query provider. Reuse that reservation.
            if(!borrowed&&cacheProof)borrowed=cache.acquire(cacheProof.key);
            if(!borrowed){residency=embedding.reserveSharedVectors(chunks,port);if(!residency)fail('partial_coverage');}
            queryVector=embedding.validateVector(query.vector,port);
            vectors=borrowed?borrowed.vectors:retrieval.loadRawVectorBlocks(scopedRows,port,()=>expired(deadlineAt));
            if(!vectors)fail('partial_coverage');
            semantic={state:'ready',reason:null};
          }catch(error){if(interrupted(error))throw error;vectors=null;queryVector=null;semantic={state:'bm25-only',reason:error.code==='partial_coverage'?'partial_coverage':'invalid_vector'};}
        }
        expired(deadlineAt);
        const checked=new Map(),verifiedTurns=new Map(),candidateSources=new Map();
        const allows=source=>{
          const key=JSON.stringify(source.ref);
          if(!checked.has(key))try{authority.check(source,input.intent,deadlineAt);checked.set(key,true);}
          catch(error){if(!['source_unavailable','source_excluded','raw_crypto_unavailable','source_budget_exceeded'].includes(error.code))throw error;checked.set(key,false);}
          return checked.get(key);
        };
        const verifyTurn=turn=>{
          if(!verifiedTurns.has(turn.id)){
            const segments=turn.segments.filter(segment=>allows(segment.source));
            const spans=segments.map(s=>s.source.ref.span).sort((a,b)=>a.start-b.start);let through=0;
            for(const span of spans){if(span.start!==through)break;through=span.end;}
            const total=segments[0]?.source.totalUnits??segments[0]?.source.manifest?.message.total_units;
            verifiedTurns.set(turn.id,{...turn,segments,complete:segments.length>0&&(total===undefined||through===total)});
          }
          return verifiedTurns.get(turn.id);
        };
        const result=retrieval.retrieveRaw(scopedRows,input.query,{vectors,queryVector,check:()=>expired(deadlineAt),
          accept(row,center){
            const turn=verifyTurn(row.turn),verifiedCenter=verifyTurn(center);
            if(!turn.segments.length||!verifiedCenter.segments.length)return false;
            const sources=[...new Map([...turn.segments,...verifiedCenter.segments].map(s=>[JSON.stringify(s.source.ref),s.source])).values()];
            candidateSources.set(row.id,sources);return {...row,turn};
          }});
        expired(deadlineAt);
        const publication=authority.bind('raw-search-publication-v1',[authority.identity,snapshot.sequence]);
        const proof=authority.bind('raw-search-proof-v1',[instance,publication,++serial]);
        let candidates=result.rows.map(row=>{expired(deadlineAt);
          const sources=row.turn.segments.map(s=>{expired(deadlineAt);return s.source;}),source=sources[0],ref=source.ref;
          const historical=sources.some(s=>s.classification.kind==='history-only');
          const bare=sources.some(s=>s.classification.kind==='current-eligible-bare');
          const classification=historical?{kind:'history-only',reason:'history-contributor'}:bare?
            {kind:'current-eligible-bare',reason:'complete-privacy-no-memory-link'}:{kind:'current-eligible-linked',reason:'current-memory-links'};
          if(classification.kind==='current-eligible-bare'&&sources.some(s=>s.classification.reason==='host-session-ancestry'))classification.reason='host-session-ancestry';
          return {id:row.id,namespace:ref.namespace,conversationId:ref.conversationId,messageId:ref.messageId,
            ordinal:source.ordinal,role:source.role,occurredAt:source.occurredAt,ranges:sources.map(s=>s.ref),score:row.score,
            centerId:row.centerId,neighbor:row.neighbor,currentness:historical?source.currentness:bare?'unknown':'current',
            classification,
            rangeClassifications:sources.map(s=>s.classification),publication,proof};
        });
        const coverage=result.coverage;
        if(snapshot.partial){coverage.status='partial';coverage.causes.push(snapshot.partialReason);}
        // Work/population counters can describe denied/stale rows. Public coverage
        // reports limits and availability only; operational counts stay internal.
        coverage.scanned=null;coverage.expanded=null;
        // Final predicates share one canonical snapshot. A newly denied hit is
        // dropped without refusing the allowed remainder of the page.
        candidates=authority.validate(candidates.map(candidate=>({sources:candidateSources.get(candidate.id),
          intent:input.intent,access,value:candidate})),deadlineAt,{dropDenied:true});
        const output=immutable({version:RAW_SEARCH_VERSION,publication,candidates,coverage,semantic},()=>expired(deadlineAt));
        if(cacheProof&&!borrowed&&(vectors||snapshot.partial)){
          residency?.release();residency=null;
          borrowed=cache.install(cacheProof.key,scopedRows,vectors,metadata,snapshot.hintBytes,()=>expired(deadlineAt));
        }
        expired(deadlineAt);
        retain(searches,proof,{candidateSources,intent:input.intent,access,candidates},4);
        return output;
      }finally{vectors=null;borrowed?.release();residency?.release();}
    }
    const refused=()=>fail('source_unavailable');
    const classify=(candidate,settings,token)=>retry(at=>classifyAttempt(candidate,settings,token,at),performance.now()+1000,
      ()=>immutable({kind:'denied',reason:'source-or-authority-unavailable'}));
    const prepare=(candidate,settings,token)=>retry(at=>prepareAttempt(candidate,settings,token,at),performance.now()+1000,refused);
    function candidateEntry(candidate,intent) {
      const entry=searches.get(candidate?.proof);
      if(!entry||entry.expires<performance.now()||entry.intent!==intent||!entry.candidates.some(row=>same(row,candidate)))fail('stale_publication');
      return {...entry,sources:entry.candidateSources.get(candidate.id)};
    }
    async function classifyAttempt(candidate,{intent='current'}={},token,at) {
      if(!['current','history'].includes(intent))fail('invalid_input');
      try {
        const entry=candidateEntry(candidate,intent);
        const canonical=()=>checkSources(entry.sources,intent,at);
        canonical();
        const access=authority.authorize('rawSearchSource',{publication:candidate.publication,intent},token,
          canonical);
        access();
        return authority.validate([{sources:entry.sources,intent,access,value:candidate.classification}],at)[0];
      }catch(error){if(interrupted(error))throw error;return immutable({kind:'denied',reason:'source-or-authority-unavailable'});}
    }
    async function prepareAttempt(candidate,{intent='current'}={},token,at) {
      if(!['current','history'].includes(intent))fail('invalid_input');
      const entry=candidateEntry(candidate,intent);
      const canonical=()=>checkSources(entry.sources,intent,at);
      canonical();
      const access=authority.authorize('rawSearchSource',{candidate,intent},token,canonical);
      const guard=()=>{canonical();access(canonical);};guard();
      const snapshot=storage.publication({shape:false,deadlineAt:at});guard();
      if(candidate.publication!==authority.bind('raw-search-publication-v1',[authority.identity,snapshot.sequence]))fail('stale_publication');
      // The private proof retains authenticated refs; text is opened canonically.
      // Preparing a page must not decode the entire ranking index per hit.
      const rows=entry.sources.map(source=>({source})).filter(row=>candidate.ranges.some(ref=>same(ref,row.source.ref)))
        .sort((a,b)=>a.source.ref.span.start-b.source.ref.span.start);
      if(!rows.length||rows.length!==candidate.ranges.length||rows.length>1024)fail('source_unavailable');
      const bytes=rows.reduce((n,row)=>n+row.source.bytes,0);
      if(bytes>256*1024)fail('source_budget_exceeded');
      const ranges=[];
      for(const row of rows){
        guard();const text=await authority.open(row.source,intent,guard);ready();guard();
        ranges.push({source:row.source.ref,text,classification:row.source.classification});
      }
      const source=rows[0].source;
      const output=immutable({namespace:source.ref.namespace,conversationId:source.ref.conversationId,messageId:source.ref.messageId,
        ordinal:source.ordinal,role:source.role,occurredAt:source.occurredAt,classification:candidate.classification,ranges});
      const ticket=authority.bind('raw-search-prepared-v1',[candidate.proof,++serial]);
      const handle=Object.freeze({value:output,ticket,validate(){return revalidate([ticket])[0];}});
      retain(prepared,ticket,{sources:entry.sources,intent,access,value:output,handle},RAW_SEARCH_LIMITS.preparations);
      try{revalidate([ticket]);}catch(error){prepared.delete(ticket);throw error;}return handle;
    }
    async function prepareMany(candidates,{intent='current',deadlineAt=performance.now()+1000,onPrepared=()=>{}}={},token) {
      if(!Array.isArray(candidates)||candidates.length>24||!['current','history'].includes(intent)||
          typeof deadlineAt!=='number'||Number.isNaN(deadlineAt)||typeof onPrepared!=='function')fail('invalid_input');
      const at=Math.min(deadlineAt,performance.now()+1000),handles=[];
      if(!candidates.length)return {handles,complete:true};
      const check=()=>{expired(at);if(closed)fail('store_closed');};
      try {
        check();
        // One search proof, authorization and publication header for the page.
        // Invalid entries retain their own null outcome without poisoning it.
        const proof=candidates.find(candidate=>searches.has(candidate?.proof))?.proof;
        const entries=candidates.map(candidate=>{
          try{if(candidate?.proof!==proof)fail('stale_publication');return candidateEntry(candidate,intent);}
          catch{return null;}
        });
        const access=authority.authorize('rawSearchSource',{candidates,intent},token);access();check();
        const publication=storage.publication({shape:false,deadlineAt:at});
        const binding=authority.bind('raw-search-publication-v1',[authority.identity,publication.sequence]);
        for(let i=0;i<entries.length;i++)if(candidates[i]?.publication!==binding)entries[i]=null;
        const batch=authority.prepareBatch(entries,intent,at);
        for(let index=0;index<candidates.length;index++){
          check();let handle=null;
          try {
            const candidate=candidates[index],entry=entries[index];
            if(!batch.allowed[index])fail('source_unavailable');
            const rows=entry.sources.filter(source=>candidate.ranges.some(ref=>same(ref,source.ref)))
              .sort((a,b)=>a.ref.span.start-b.ref.span.start);
            if(!rows.length||rows.length!==candidate.ranges.length||rows.length>1024)fail('source_unavailable');
            if(rows.reduce((bytes,source)=>bytes+source.bytes,0)>256*1024)fail('source_budget_exceeded');
            const ranges=[];
            for(const source of rows){
              const text=await batch.open(source,check);check();
              ranges.push({source:source.ref,text,classification:source.classification});
            }
            const source=rows[0],output=immutable({namespace:source.ref.namespace,conversationId:source.ref.conversationId,
              messageId:source.ref.messageId,ordinal:source.ordinal,role:source.role,occurredAt:source.occurredAt,
              classification:candidate.classification,ranges},check);
            check();
            const ticket=authority.bind('raw-search-prepared-v1',[candidate.proof,++serial]);
            handle=Object.freeze({value:output,ticket,validate(){return revalidate([ticket])[0];}});
            retain(prepared,ticket,{sources:entry.sources,intent,access,value:output,handle},RAW_SEARCH_LIMITS.preparations);
          }catch(error){if(interrupted(error))throw error;}
          check();handles.push(handle);onPrepared(handle,index);
        }
        return {handles,complete:true};
      }catch(error){
        if(!interrupted(error))throw error;
        return {handles:handles.slice(),complete:false};
      }
    }
    async function prepareSource(ref,{intent='current'}={},token) {
      if(!['current','history'].includes(intent))fail('invalid_input');
      const source=authority.inspect(ref,intent),canonical=()=>authority.check(source,intent);
      const access=authority.authorize('rawSearchSource',{source:source.ref,intent},token,canonical);
      const guard=()=>{canonical();access(canonical);};
      const text=await authority.open(source,intent,guard);guard();
      const output=immutable({namespace:source.ref.namespace,conversationId:source.ref.conversationId,messageId:source.ref.messageId,
        ordinal:source.ordinal,role:source.role,occurredAt:source.occurredAt,classification:source.classification,
        ranges:[{source:source.ref,text,classification:source.classification}]});
      const ticket=authority.bind('raw-search-source-prepared-v1',[instance,++serial,source.ref]);
      const handle=Object.freeze({value:output,ticket,validate(){return revalidate([ticket])[0];}});
      retain(prepared,ticket,{sources:[source],intent,access,value:output,handle},RAW_SEARCH_LIMITS.preparations);
      revalidate([ticket]);return handle;
    }
    function revalidate(handles) {
      return withContentSuppressionRequest(()=>revalidateInside(handles),{fresh:true});
    }
    function revalidateInside(handles) {
      const at=performance.now()+1000;let busy=0;
      try {
        ready();if(!Array.isArray(handles)||handles.length>RAW_SEARCH_LIMITS.preparations)fail('invalid_input');
        const entries=handles.map(handle=>{const entry=prepared.get(typeof handle==='string'?handle:handle?.ticket);
          if(!entry||entry.expires<performance.now()||typeof handle!=='string'&&entry.handle!==handle)fail('source_unavailable');return entry;});
        while(true)try{return authority.validate(entries,at);}catch(error){
          if(!interrupted(error))throw error;
          cache.drop();authority.reset();
          if(error.code==='search_deadline'||error.code==='source_busy'&&busy++>=1)throw error;
          const wait=error.code==='source_busy'?Math.max(0,authority.resume()-performance.now()):0;
          if(at-performance.now()<wait+pageAllowanceMs)throw error;
          // This API is synchronous. The bounded backoff owns no read snapshot.
          if(wait)Atomics.wait(new Int32Array(new SharedArrayBuffer(4)),0,0,wait);
          authority.refresh(at);
        }
      }catch{fail('raw_search_unavailable');}
    }
    const status=()=>{
      const progress=maintenance.status();
      return {state:progress.phase==='failed'?'unavailable':'unknown',eligible:null,indexed:null,embedded:null,
        coverage:'unknown',error:progress.error?['quota_exhausted','no_progress','maintenance_release_failed'].includes(progress.error)?progress.error:'raw_search_unavailable':null,
        maintenance:{phase:progress.phase,quantum:progress.quantum,noProgress:progress.noProgress,pending:progress.pending,
          checkpoint:authority.bind('raw-search-progress-v1',progress.checkpointAdvances),lastActualWork:progress.lastActualWork}};
    };
    return Object.freeze({search:tracked(search),prepare:tracked(prepare),prepareMany:tracked(prepareMany),prepareSource:tracked(prepareSource),classify:tracked(classify),validate:revalidate,revalidate,
      maintain:tracked(async(input,token)=>{const access=authority.authorize('rawSearchMaintenance',{},token);
        cache.maintain();
        await maintenance.maintain(input,access);return status();}),
      status:()=>withContentSuppressionRequest(async()=>{try{ready();await storage.status();return status();}catch{return {state:'unavailable',eligible:null,indexed:null,embedded:null,coverage:'unknown',error:'raw_search_unavailable'};}},{fresh:true}),
      purge:tracked(async()=>{cache.close();await maintenance.close();await storage.dropOwner();prepared.clear();searches.clear();}),
      close:()=>withContentSuppressionRequest(async()=>{if(closed)return;closed=true;
        try{cache.close();await maintenance.close();await Promise.allSettled([...operations]);prepared.clear();searches.clear();}
        finally{try{await storage.close();}finally{try{database.db.close();}finally{releaseResidency();}}}},{fresh:true})});
  }catch(error){await storage?.close();database?.db.close();safeFailure(error);}
}

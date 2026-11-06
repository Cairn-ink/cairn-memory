import { rawSearchOptions,searchInput,immutable,same,RAW_SEARCH_VERSION,RAW_SEARCH_LIMITS } from './raw-search-input.mjs';
import { fail } from './validation.mjs';
import { performance } from 'node:perf_hooks';
import { contextBudget } from './context-read-budget.mjs';
import { randomUUID } from 'node:crypto';
import { dirname } from 'node:path';
import { createRawSearchCache } from './raw-search-cache.mjs';

const publicCodes = new Set(['invalid_input','invalid_query','invalid_read_set','authority_required','scope_changed',
  'stale_publication','store_closed','read_in_progress','maintenance_authority_required','raw_search_backend_unavailable']);
const safeFailure = error => { fail(publicCodes.has(error?.code) ? error.code : 'raw_search_unavailable'); };

/** SQLite remains behind selection. Old engine constructors never call here. */
export async function openRawSearch(value) {
  if (value === undefined || value?.enabled === false) return null;
  const options=rawSearchOptions(value);
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
    database=openReadDatabase(options.path,{contextRead:true,busyTimeoutMs:0});
    const assertFile=database.assertFile;
    database.assertFile=()=>{assertFile();canonicalFile();};
    const authority=createRawSearchAuthority(database,options);
    storage=await openRawSearchStorage({directory:options.directory,identity:authority.identity,bind:authority.bind,quotaBytes:options.quotaBytes});
    const metadata=options.embedder&&{id:options.embedder.id,revision:options.embedder.revision,
      dimensions:options.embedder.dimensions,normalization:options.embedder.normalization};
    const cacheEnabled=options.policy?.family==='local'&&!!metadata;
    const cache=createRawSearchCache({enabled:cacheEnabled,checkKey:()=>{
      database.assertFile();return authority.cacheKey(storage.publication({shape:false}),metadata);
    }});
    const maintenance=createRawSearchMaintenance(storage,authority,options),prepared=new Map(),searches=new Map();
    const dispatch=options.embedder&&contextBudget({budgetConfigured:true,policy:options.policy,embedder:options.embedder});
    const releaseResidency=embedding.selectRawVectorResidency();
    const instance=randomUUID();
    let closed=false,serial=0;
    const operations=new Set();
    const ready=()=>{if(closed)fail('store_closed');database.assertFile();};
    const tracked=work=>(...args)=>{
      const operation=(async()=>{try{ready();return await work(...args);}catch(error){safeFailure(error);}})();
      operations.add(operation);operation.then(()=>operations.delete(operation),()=>operations.delete(operation));return operation;
    };
    function retain(map,key,entry,limit) {
      for(const [id,value] of map)if(value.expires<performance.now())map.delete(id);
      while(map.size>=limit)map.delete(map.keys().next().value);
      map.set(key,{...entry,expires:performance.now()+5000});
    }
    const checkSources=(sources,intent)=>{for(const source of sources)authority.check(source,intent);};
    async function search(value,token) {
      const input=searchInput(value),access=authority.authorize('rawSearch',input,token);access();
      const deadlineAt=performance.now()+1000;
      let cacheProof,borrowed,residency,vectors=null;
      try {
        let state=null;
        if(cacheEnabled)try{
          const publication=storage.publication();
          cacheProof={publication,metadata,key:authority.cacheKey(publication,metadata)};
          state=publication;borrowed=cache.acquire(cacheProof.key);
        }catch{cache.drop();cacheProof=undefined;}
        const snapshot=borrowed?{...state,rows:borrowed.rows}:await storage.search();access();
        // A concurrent publication between the optional header read and the
        // payload snapshot only defers caching. It adds no new search error.
        if(state&&snapshot.sequence!==state.sequence){cache.drop();cacheProof=undefined;}
        let current=false;
        let fence;
        try{fence=authority.fence();current=snapshot.checkpoint.coverageComplete&&snapshot.checkpoint.fence===fence;}
        catch(error){if(error.code!=='source_budget_exceeded')throw error;}
        const {eligible,denied,timedOut}=authority.select(snapshot.rows,input.intent,deadlineAt);
        const dependencies=eligible.map(row=>row.source);
        const canonical=()=>{if(fence)authority.checkFence(fence);else checkSources(dependencies,input.intent);};
        const guard=()=>{ready();canonical();access(canonical);};
        let semantic={state:'bm25-only',reason:options.embedder?'partial_coverage':'disabled'},queryVector=null;
        const port=options.embedder;let query=input.queryVector;
        const chunks=eligible.reduce((n,row)=>n+row.chunks.length,0);
        const complete=current&&!denied&&!snapshot.partial&&!timedOut&&eligible.every(row=>same(row.embedder,metadata)&&row.chunks.every(c=>c.vector));
        if(port&&!query&&complete&&eligible.length&&embedding.semanticCapacity(chunks,port).eligible){
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
            vectors=borrowed?borrowed.vectors:retrieval.loadRawVectorBlocks(eligible,port);
            if(!vectors)fail('partial_coverage');
            semantic={state:'ready',reason:null};
          }catch(error){vectors=null;queryVector=null;semantic={state:'bm25-only',reason:error.code==='partial_coverage'?'partial_coverage':'invalid_vector'};}
        }
        const result=retrieval.retrieveRaw(eligible,input.query,{vectors,queryVector});
        const sources=fence?result.sources:dependencies;
        const publication=authority.bind('raw-search-publication-v1',[authority.identity,snapshot.sequence]);
        const proof=authority.bind('raw-search-proof-v1',[instance,publication,++serial]);
        const candidates=result.rows.map(row=>{
          const sources=row.turn.segments.map(s=>s.source),source=sources[0],ref=source.ref;
          const historical=sources.some(s=>s.classification.kind==='history-only');
          const bare=sources.some(s=>s.classification.kind==='current-eligible-bare');
          return {id:row.id,namespace:ref.namespace,conversationId:ref.conversationId,messageId:ref.messageId,
            ordinal:source.ordinal,role:source.role,occurredAt:source.occurredAt,ranges:sources.map(s=>s.ref),score:row.score,
            centerId:row.centerId,neighbor:row.neighbor,currentness:historical?source.currentness:bare?'unknown':'current',
            classification:historical?{kind:'history-only',reason:'history-contributor'}:bare?
              {kind:'current-eligible-bare',reason:'complete-privacy-no-memory-link'}:{kind:'current-eligible-linked',reason:'current-memory-links'},
            rangeClassifications:sources.map(s=>s.classification),publication,proof};
        });
        const coverage=result.coverage;
        if(snapshot.partial||denied||timedOut||!current){coverage.status='partial';coverage.causes.push(timedOut?'deadline':snapshot.partial?snapshot.partialReason:'stale_index');}
        // Work/population counters can describe denied/stale rows. Public coverage
        // reports limits and availability only; operational counts stay internal.
        coverage.scanned=null;coverage.expanded=null;
        const output=immutable({version:RAW_SEARCH_VERSION,publication,candidates,coverage,semantic});
        retain(searches,proof,{dependencies,sources,fence,intent:input.intent,access,candidates},4);
        // Corpus statistics, rank competition, readiness and coverage use the
        // eligible snapshot plus its complete commitment. Direct contributors
        // additionally receive full predicates in the final canonical snapshot.
        authority.validate([{sources,fence,cache:cacheProof,intent:input.intent,access,value:output}]);
        if(cacheProof&&!borrowed&&!denied&&!timedOut&&(vectors||snapshot.partial)){
          // Transfer the operation's reservation synchronously. Admission failure
          // only leaves this operation uncached; it cannot change its result.
          residency?.release();residency=null;
          borrowed=cache.install(cacheProof.key,eligible,vectors,metadata,snapshot.hintBytes);
        }
        return output;
      }finally{vectors=null;borrowed?.release();residency?.release();}
    }
    function candidateEntry(candidate,intent) {
      const entry=searches.get(candidate?.proof);
      if(!entry||entry.expires<performance.now()||entry.intent!==intent||!entry.candidates.some(row=>same(row,candidate)))fail('stale_publication');
      return entry;
    }
    async function classify(candidate,{intent='current'}={},token) {
      if(!['current','history'].includes(intent))fail('invalid_input');
      try {
        const entry=candidateEntry(candidate,intent);
        const canonical=()=>entry.fence?authority.checkFence(entry.fence):checkSources(entry.dependencies,intent);
        canonical();
        const access=authority.authorize('rawSearchSource',{publication:candidate.publication,intent},token,
          canonical);
        access();
        return authority.validate([{sources:entry.sources,fence:entry.fence,intent,access,value:candidate.classification}])[0];
      }catch {return immutable({kind:'denied',reason:'source-or-authority-unavailable'});}
    }
    async function prepare(candidate,{intent='current'}={},token) {
      if(!['current','history'].includes(intent))fail('invalid_input');
      const entry=candidateEntry(candidate,intent),dependencies=entry.dependencies;
      const canonical=()=>entry.fence?authority.checkFence(entry.fence):checkSources(dependencies,intent);
      canonical();
      const access=authority.authorize('rawSearchSource',{candidate,intent},token,canonical);
      const guard=()=>{canonical();access(canonical);};guard();
      const snapshot=await storage.snapshot();guard();
      if(candidate.publication!==authority.bind('raw-search-publication-v1',[authority.identity,snapshot.sequence]))fail('stale_publication');
      const rows=snapshot.rows.filter(row=>candidate.ranges.some(ref=>same(ref,row.source.ref)))
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
      retain(prepared,ticket,{sources:entry.sources,fence:entry.fence,intent,access,value:output,handle},RAW_SEARCH_LIMITS.preparations);
      revalidate([ticket]);return handle;
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
      try {
        ready();if(!Array.isArray(handles)||handles.length>RAW_SEARCH_LIMITS.preparations)fail('invalid_input');
        const entries=handles.map(handle=>{const entry=prepared.get(typeof handle==='string'?handle:handle?.ticket);
          if(!entry||entry.expires<performance.now()||typeof handle!=='string'&&entry.handle!==handle)fail('source_unavailable');return entry;});
        return authority.validate(entries);
      }catch{fail('raw_search_unavailable');}
    }
    const status=()=>{
      const progress=maintenance.status();
      return {state:progress.phase==='failed'?'unavailable':'unknown',eligible:null,indexed:null,embedded:null,
        coverage:'unknown',error:progress.error?['quota_exhausted','no_progress','maintenance_release_failed'].includes(progress.error)?progress.error:'raw_search_unavailable':null,
        maintenance:{phase:progress.phase,quantum:progress.quantum,noProgress:progress.noProgress,pending:progress.pending,
          checkpoint:authority.bind('raw-search-progress-v1',progress.checkpointAdvances),lastActualWork:progress.lastActualWork}};
    };
    return Object.freeze({search:tracked(search),prepare:tracked(prepare),prepareSource:tracked(prepareSource),classify:tracked(classify),validate:revalidate,revalidate,
      maintain:tracked(async(input,token)=>{const access=authority.authorize('rawSearchMaintenance',{},token);
        cache.maintain();
        await maintenance.maintain(input,access);return status();}),
      async status(){try{ready();await storage.status();return status();}catch{return {state:'unavailable',eligible:null,indexed:null,embedded:null,coverage:'unknown',error:'raw_search_unavailable'};}},
      purge:tracked(async()=>{cache.close();await maintenance.close();await storage.dropOwner();prepared.clear();searches.clear();}),
      async close(){if(closed)return;closed=true;cache.close();await maintenance.close();await Promise.allSettled([...operations]);prepared.clear();searches.clear();
        try{await storage.close();}finally{database.db.close();releaseResidency();}}});
  }catch(error){await storage?.close();database?.db.close();safeFailure(error);}
}

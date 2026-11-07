import {errorSummary} from './raw-search-window-summary.mjs';
import {measurementError,takeInternalErrors,takeOperationOvershoots,takeInternalErrorCounts} from './raw-search-phase-ledger.mjs';
import {seedSessionFences,sessionFenceCount} from './raw-search-session-fences.mjs';
import assert from 'node:assert/strict';
import {sharedOverlapMs} from './raw-search-writer-observer.mjs';
import { performance } from 'node:perf_hooks';
import { fork } from 'node:child_process';
import { DatabaseSync } from 'node:sqlite';
import { reserveSharedVectors } from '../../core/context-read-embedder.mjs';
import { cpus,totalmem } from 'node:os';
import { mkdirSync,writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { createHmac } from 'node:crypto';
import { openDatabase,transaction } from '../../core/database.mjs';
import { openReadDatabase } from '../../core/read-database.mjs';
import { localPlainPort,rawNamespace as ns } from '../../core/testing/raw-fixtures.mjs';
import { createTestWorkspace } from './workspace.mjs';

if(process.env.CAIRN_MEASURE_RAW_SEARCH==='1')(await import('./raw-search-phase-loader.mjs')).installPhaseMeasurement();
const [{createRawSearchAuthority},{openRawSearchStorage},{rawSearchChunks,rawSearchPostings,retrieveRaw,loadRawVectorBlocks,scoreRawVectorBlocks},
  {openRawSearch},{rawSearchHost,broker}]=await Promise.all([
  import('../../core/raw-search-authority.mjs'),import('../../core/raw-search-storage.mjs'),import('../../core/raw-search-retrieval.mjs'),
  import('../../core/raw-search-index.mjs'),import('../../core/testing/raw-search-fixtures.mjs')]);

const summary=values=>{const sorted=[...values].sort((a,b)=>a-b),at=q=>sorted[Math.min(sorted.length-1,Math.ceil(sorted.length*q)-1)];
  return {p50:at(.5),p95:at(.95),p99:at(.99),max:sorted.at(-1),samples:sorted.length};};
export async function measureRawColdSearch(factory,search,now=()=>performance.now()){
  const openedAt=now(),service=await factory(),searchAt=now();
  const value=await search(service),endedAt=now();
  return {value,ms:endedAt-searchAt,factoryMs:searchAt-openedAt,totalMs:endedAt-openedAt};
}
// The original full-read profile: payload, lexical hierarchy, commitment, then
// canonical check/open for every returned physical segment. Preparations remain
// a separate API measurement so retained-fixture runs stay comparable.
export async function measureRawFullRead(storage,authority){
  takeInternalErrors();const start=performance.now(),snapshot=await storage.search(),rankStart=performance.now();
  const result=retrieveRaw(snapshot.rows,'copper telescope'),retrievalMs=performance.now()-rankStart;
  const fenceStart=performance.now();
  try{authority.fence();}catch(error){assert.equal(error.code,'source_budget_exceeded');}
  const fenceMs=performance.now()-fenceStart,selected=[],opening=[];
  for(const row of result.rows)for(const segment of row.turn.segments){
    const checkStart=performance.now();authority.check(segment.source);selected.push(performance.now()-checkStart);
    const openStart=performance.now();await authority.open(segment.source);opening.push(performance.now()-openStart);
  }
  return {ms:performance.now()-start,retrievalMs,fenceMs,selected,opening,work:result.coverage.scanned,snapshot:snapshot.timings};
}
export async function measureRawSearch(t,targets) {
  const profile=process.env.CAIRN_RAW_MEASURE_PROFILE;
  if(profile&&!['commitment-cost','cadence','fixture-only'].includes(profile))throw Error('invalid_measurement_profile');
  const lineageTools=profile?await import('./measure-raw-search-lineage.mjs'):null;
  const reports=[];
  t.diagnostic(JSON.stringify({hardware:{cpu:cpus()[0].model,cores:cpus().length,memoryBytes:totalmem()},node:process.version,targets}));
  const scenarios=[...targets.sizes.map(count=>({count,cap:false})),{count:Math.ceil(targets.rawCapBytes/4000),cap:true}];
  for(const scenario of scenarios.filter(s=>(!profile||!s.cap&&(profile!=='cadence'||s.count===10000))&&(!process.env.CAIRN_RAW_MEASURE_TURNS||process.env.CAIRN_RAW_MEASURE_TURNS.split(',').map(Number).includes(s.count)))){
    takeInternalErrors();takeInternalErrorCounts();const {count,cap}=scenario;console.log('measurement phase=seed turns='+count);
    const ws=createTestWorkspace(null,{prefix:'raw-search-measure-'}),path=join(ws.path,'canonical.sqlite'),directory=join(ws.path,'index');
    mkdirSync(directory,{mode:0o700});
    let db,reader,storage,service,retained=false;
    const originalExec=DatabaseSync.prototype.exec,starts=new WeakMap(),configured=new WeakSet(),sections=[],readWaits=[],sharedIntervals=[],sharedStarts=new WeakMap();
    DatabaseSync.prototype.exec=function(sql){
      const began=performance.now(),value=originalExec.call(this,sql);
      if(sql==='BEGIN'){
        if(!configured.has(this)){
          this.function('raw_search_measure_read',value=>{starts.set(this,performance.now());sharedStarts.set(this,process.hrtime.bigint());return value;});
          configured.add(this);
        }
        // Measurement-only engine-owned probe: BEGIN alone owns no SHARED lock.
        // Reading the canonical singleton establishes it before sampling time.
        this.prepare('SELECT raw_search_measure_read(store_id) FROM store_metadata WHERE singleton=1').get();
        readWaits.push(starts.get(this)-began);
      }else if((sql==='COMMIT'||sql==='ROLLBACK')&&starts.has(this)){
        sections.push(performance.now()-starts.get(this));sharedIntervals.push([sharedStarts.get(this),process.hrtime.bigint()]);starts.delete(this);sharedStarts.delete(this);
      }
      return value;
    };
    try{
      db=openDatabase(path,profile?{rawSources:true,currentDependencies:true,contentSafety:'s2h-v1'}:{rawSources:true});
      const secret=db.prepare('SELECT secret FROM episode_identity WHERE singleton=1').get().secret;
      const key=Buffer.from(secret,'hex'),timestamp='2026-01-02T00:00:00.000Z';
      const conversation=db.prepare('INSERT INTO raw_conversations VALUES(?,?,?,?,?,?,1,?,?)');
      const message=db.prepare(`INSERT INTO raw_messages VALUES(?,?,?,?,?,?,?,?,?,?,'complete',NULL,0,?)`);
      const map=db.prepare('INSERT INTO raw_source_maps VALUES(?,?,?,?,?,?)');
      const part=db.prepare('INSERT INTO raw_parts VALUES(?,?,?,?,?,?,?,?,1,NULL,?,NULL,?)');
      let rawBytes=0;
      const buildStart=performance.now();
      transaction(db,()=>{
        for(let i=0;i<count;i++){
          const session='session-'+String(Math.floor(i/50)).padStart(5,'0'),id='message-'+String(i).padStart(6,'0'),ordinal=i%50+1;
          const prefix='Synthetic copper telescope '+i+' ';
          const text=cap?prefix+'x'.repeat(Math.min(4000,targets.rawCapBytes-i*4000)-prefix.length):prefix+('sample '.repeat(i%100===0?1000:20));
          if(i%50===0)conversation.run(session,ns.ownerId,ns.scope,'','codex','key-'+session,timestamp,timestamp);
          const bytes=Buffer.byteLength(text),parts=[];
          for(let start=0;start<text.length;start+=4000)parts.push({start,end:Math.min(start+4000,text.length)});
          message.run(session,id,ordinal,'user',null,text.length,bytes,parts.length,text.length,bytes,'event-'+id);
          map.run(session,id,'synthetic-canonical-source',0,Math.min(4000,text.length),'exact');
          for(const [index,{start,end}] of parts.entries()){
            const value=text.slice(start,end),digest=createHmac('sha256',key).update(JSON.stringify(['raw-part-v1',id,ordinal,'user',null,
              index,start,text.length,bytes,value])).digest('hex');
            part.run(session,id,index,start,end,Buffer.byteLength(value),digest,'event-'+id,'local-plain-v1',Buffer.from(value));
          }
          rawBytes+=bytes;
        }
        db.prepare('INSERT INTO raw_owner_usage VALUES(?,1,?, ?,0)').run(ns.ownerId,targets.rawCapBytes,rawBytes);
      });
      const lineage=profile?lineageTools.seedMeasurementLineage(db,count):null;
      const sessionFences=sessionFenceCount();seedSessionFences(path,ns,sessionFences);
      if(profile==='fixture-only') {
        assert.ok(process.env.CAIRN_RAW_MEASURE_FIXTURE_OUTPUT,'fixture output required');
        const own=(await import('node:fs')).statSync(ws.path);
        writeFileSync(process.env.CAIRN_RAW_MEASURE_FIXTURE_OUTPUT,JSON.stringify({path:ws.path,dev:own.dev,inode:own.ino,count,lineage},null,2)+'\n');
        retained=true;reports.push({profile,count,lineage});continue;
      }
      const canonicalBuildMs=performance.now()-buildStart;console.log('measurement phase=index turns='+count);
      reader=openReadDatabase(path,{contextRead:true});
      const options={ownerId:ns.ownerId,readSet:[ns],crypto:localPlainPort(),authority:rawSearchHost().authority};
      const authority=createRawSearchAuthority(reader,options);
      storage=await openRawSearchStorage({directory,identity:authority.identity,bind:authority.bind,quotaBytes:targets.quotaBytes});
      let after=['','',-1],checkpoint={after,sweep:0,cycles:1},built=0,quota=false;
      const payload=Buffer.alloc(1536*4);payload.writeFloatLE(1);
      const vectorHex=payload.toString('hex');
      const rebuildStart=performance.now(),inventoryTimes=[],fenceTimes=[],selectedTimes=[],openingTimes=[],encodingTimes=[],snapshotTimes=[];
      while(true){
        const start=performance.now(),inventory=authority.inventory(after,16);inventoryTimes.push(performance.now()-start);
        const staged=[];
        for(const entry of inventory.rows){
          if(profile&&!entry.source){after=entry.key;continue;}
          assert.ok(entry.source);
          const text=await authority.open(entry.source),chunks=rawSearchChunks(text,entry.source.ref.span.start);
          const segment={key:JSON.stringify(entry.key),source:entry.source,fingerprint:authority.fingerprint(entry.source),
            postings:rawSearchPostings(text),chunks:chunks.map(({input,...chunk})=>({...chunk,vector:vectorHex})),embedder:{id:'synthetic-measurement',revision:'1',dimensions:1536,normalization:'l2'},retry:{attempts:0,nextAt:0,terminal:false}};
          const encodeStart=performance.now();staged.push({...await storage.stage(segment),expected:null});encodingTimes.push(performance.now()-encodeStart);after=entry.key;
        }
        if(staged.length)try{await storage.commitBatch({staged,checkpoint});built+=staged.length;}catch(error){if((error.errcode&255)!==13)throw error;quota=true;break;}
        if(inventory.complete)break;
      }
      const rebuildMs=performance.now()-rebuildStart;console.log('measurement phase=reads turns='+count);
      checkpoint={after:['','',-1],sweep:0,cycles:1,coverageComplete:!quota};
      let checkpointError;
      try{checkpoint.fence=authority.fence();}catch(error){
        if(!profile)assert.equal(error.code,'source_budget_exceeded');
        checkpointError={code:error.code,message:error.message};checkpoint.coverageComplete=false;
      }
      await storage.commitBatch({checkpoint});
      const openStart=performance.now(),snapshot=await storage.search(),coldMs=performance.now()-openStart;
      const host=rawSearchHost(),queryVector=Array(1536).fill(0);queryVector[0]=1;
      const provider={id:'synthetic-measurement',revision:'1',dimensions:1536,normalization:'l2',async embed(texts,controls){controls.beforeDispatch();return texts.map(()=>queryVector);}};
      const factoryStart=performance.now();
      const serviceOptions={version:'raw-search-v1',enabled:true,backend:'local',path,directory,ownerId:ns.ownerId,readSet:[ns],
        authority:host.authority,crypto:localPlainPort(),maintenanceTurn:broker(),embedder:provider,policy:{family:'local',maxBatchDocuments:1,maxRequests:100,maxConcurrent:1,maxUsd:0}};
      takeInternalErrors();service=await openRawSearch(serviceOptions);
      const factoryMs=performance.now()-factoryStart;
      const searchInput={query:'copper telescope',queryVector:{input:'copper telescope',embedder:{id:provider.id,revision:provider.revision,dimensions:1536,normalization:'l2'},vector:queryVector}};
      if(profile){
        const report=await lineageTools.measureLineageProfile({profile,count,path,authority,service,host,input:searchInput,sections,sharedIntervals,lineage});
        report.maxOperationDeadlineOvershootMs=Math.max(0,...takeOperationOvershoots());report.internalErrors=takeInternalErrorCounts();
        report.indexedParts=built;report.sessionFences=sessionFences;
        report.checkpointError=checkpointError;
        report.measurement='synthetic lineage with native statement and exception observation';
        report.stopThreshold=profile==='commitment-cost'&&(report.shared.p99>50||count===10000&&report.rebuild.p95!==null&&report.rebuild.p95>500);
        if(process.env.CAIRN_RAW_MEASURE_OUTPUT){
          mkdirSync(process.env.CAIRN_RAW_MEASURE_OUTPUT,{recursive:true});
          writeFileSync(join(process.env.CAIRN_RAW_MEASURE_OUTPUT,profile+'-'+count+'.json'),JSON.stringify(report,null,2)+'\n');
        }
        const {samples,pages,pageTimeByIndex,rebuildErrors,searchErrors,warmOutcomes,cadences,...totals}=report;
        console.log('measurement lineage-result='+JSON.stringify({...totals,
          rebuildErrors:rebuildErrors?.map(row=>({...errorSummary(row),cause:row.cause,ms:row.ms})),
          searchErrors:searchErrors?.map(row=>({...errorSummary(row),cause:row.cause,ms:row.ms})),
          cadences:cadences?.map(row=>({cadenceMs:row.cadenceMs,commits:row.commits,searches:row.searches.length,afterCommit:row.afterCommit,withoutCommit:row.withoutCommit,cache:row.cache,
            errors:['searches','prepares','revalidations'].flatMap(stage=>row[stage].filter(error=>!error.ok).map(error=>({stage,...errorSummary(error)})))}))}));
        if(process.env.CAIRN_RAW_MEASURE_FIXTURE_OUTPUT){
          const own=(await import('node:fs')).statSync(ws.path);
          writeFileSync(process.env.CAIRN_RAW_MEASURE_FIXTURE_OUTPUT,JSON.stringify({path:ws.path,dev:own.dev,inode:own.ino,count,lineage},null,2)+'\n');retained=true;
        }
        reports.push(report);continue;
      }
      const apiErrors=[],prepareErrors=[],failedApiTimes=[];
      let coldApi,coldApiMs,coldApiError=null;
      takeInternalErrors();const coldApiStart=performance.now();
      try{coldApi=await service.search(searchInput,host.token);}
      catch(error){coldApiError=measurementError(error);console.log('measurement call-failed='+JSON.stringify({turns:count,stage:'cold-search',error:error.code}));}
      coldApiMs=performance.now()-coldApiStart;
      let warmup=0;
      for(;warmup<targets.warmupSearches;warmup++){
        takeInternalErrors();let actual;
        try{actual=await service.search(searchInput,host.token);}
        catch(error){apiErrors.push({stage:'warmup',...measurementError(error)});break;}
        if(actual.semantic.state==='ready'||snapshot.partial||quota||count>targets.completeHybridTurns)break;
      }
      const warm=[],full=[],work=[],api=[],prepareTimes=[];let apiCoverage,apiSemantic;
      for(let sample=0;sample<(cap?5:targets.searchSamples);sample++){
        const begin=performance.now(),next=await storage.search();snapshotTimes.push(next.timings);
        const rankStart=performance.now(),result=retrieveRaw(next.rows,'copper telescope');warm.push(performance.now()-rankStart);
        const start=performance.now();try{authority.fence();}catch(error){assert.equal(error.code,'source_budget_exceeded');}fenceTimes.push(performance.now()-start);
        for(const row of result.rows)for(const segment of row.turn.segments){
          const checkStart=performance.now();authority.check(segment.source);selectedTimes.push(performance.now()-checkStart);
          const openStart=performance.now();await authority.open(segment.source);openingTimes.push(performance.now()-openStart);
        }
        full.push(performance.now()-begin);work.push(result.coverage.scanned);
        takeInternalErrors();const apiStart=performance.now();let actual;
        try{actual=await service.search(searchInput,host.token);}
        catch(error){failedApiTimes.push(performance.now()-apiStart);apiErrors.push({stage:'search',...measurementError(error)});
          console.log('measurement call-failed='+JSON.stringify({turns:count,sample,stage:'search',error:error.code}));continue;}
        api.push(performance.now()-apiStart);apiCoverage=actual.coverage;apiSemantic=actual.semantic;
        console.log('measurement search='+JSON.stringify({turns:count,sample,ms:api.at(-1),coverage:actual.coverage.status,semantic:actual.semantic.state}));
        // Raw-cap measures retrieval and failure bounds. Projection/packing is
        // a later consumer's surface; representative source preparation is
        // measured separately for the turn profiles.
        if(!cap&&actual.candidates.length){takeInternalErrors();const start=performance.now();
          try{await service.prepare(actual.candidates[0],{},host.token);prepareTimes.push(performance.now()-start);}
          catch(error){prepareErrors.push({...measurementError(error),ms:performance.now()-start});}}
      }
      if(!quota)assert.equal(built,cap?count:count+Math.ceil(count/100));
      assert.equal(db.prepare('SELECT saved_bytes FROM raw_owner_usage').get()?.saved_bytes,rawBytes);
      // Trusted synthetic harness only, independent of all public status and
      // coverage paths. Probes reserve/release capacity without keeping blocks.
      const cacheResidency=measureResidency(provider);
      const vectorScan=await scanVectors(storage,provider,queryVector);
      let coldApiDistribution,coldApiErrors,residencyAfterClose;
      if(!cap){
        // Fresh reader each time: no eligibility, inventory or block reuse.
        // Keep the original cold observation too for comparisons with older
        // measurements, whose cold API metric had only a single sample.
        await service.close();service=null;
        const coldTimes=[],coldErrors=[];
        for(let sample=0;sample<targets.searchSamples;sample++){
          takeInternalErrors();let cold,start=performance.now();
          try{cold=await openRawSearch(serviceOptions);takeInternalErrors();start=performance.now();await cold.search(searchInput,host.token);coldTimes.push(performance.now()-start);}
          catch(error){coldErrors.push({...measurementError(error),ms:performance.now()-start});}
          finally{await cold?.close();}
          if((sample+1)%5===0)console.log('measurement cold-progress='+JSON.stringify({turns:count,samples:sample+1}));
        }
        coldApiDistribution=summary(coldTimes);coldApiErrors=coldErrors;
        residencyAfterClose=measureResidency(provider);
        takeInternalErrors();service=await openRawSearch(serviceOptions);
        for(let i=0;i<targets.warmupSearches;i++){takeInternalErrors();const result=await service.search(searchInput,host.token);if(result.semantic.state==='ready'||snapshot.partial)break;}
      }
      console.log('measurement phase=capture turns='+count);
      const readsCheckpoint={turns:count,cap,indexedParts:built,returnedParts:snapshot.rows.length,hintBytes:snapshot.hintBytes,
        rebuildMs,coldMs,api:summary(api),apiCoverage,apiSemantic,warm:summary(warm),full:summary(full),vectorScan,
        canonical:summary(sections),canonicalReadWait:summary(readWaits),snapshotWork:snapshotTimes,
        hintEncoding:summary(encodingTimes),rssBytes:process.memoryUsage().rss,...await storage.status()};
      console.log('measurement reads='+JSON.stringify(readsCheckpoint));
      let capture=null;
      if(!cap)try{capture=await captureContention(path,service,host.token,targets);}
      catch(error){capture={unavailable:true,error:error.message};console.log('measurement capture-failed='+JSON.stringify({turns:count,error:error.message}));}
      const state=await storage.status(),report={scenario:cap?'raw-cap':'turns',quotaExhausted:quota,indexedParts:built,partial:snapshot.partial||quota,returnedParts:snapshot.rows.length,vectorPayloadBytes:built*6144,turns:count,chunks:snapshot.rows.reduce((n,r)=>n+r.chunks.length,0),rawBytes,
        canonicalBuildMs,rebuildMs,coldMs,factoryMs,api:summary(api),apiCoverage,apiSemantic,warm:summary(warm),full:summary(full),canonical:summary(sections),canonicalReadWait:summary(readWaits),canonicalMeasurement:'first-read-probe-to-commit',authorityWork:{inventory:summary(inventoryTimes),fence:summary(fenceTimes),selected:summary(selectedTimes)},opening:summary(openingTimes),hintBytes:snapshot.hintBytes,snapshotWork:{sqlite:summary(snapshotTimes.map(t=>t.sqliteMs)),authentication:summary(snapshotTimes.map(t=>t.authenticationMs)),decode:summary(snapshotTimes.map(t=>t.decodeMs))},hintEncoding:summary(encodingTimes),coldApiMs,coldApiCoverage:coldApi?.coverage,coldApiError,apiErrors,prepareErrors,failedApi:summary(failedApiTimes),warmupSearches:Math.min(warmup+1,targets.warmupSearches),prepare:summary(prepareTimes),semanticProfile:apiSemantic?.state==='ready'?'complete-hybrid':'bm25-only',scanWork:Math.max(...work),
        vectorScan,capture,cacheResidency,coldApiDistribution,coldApiErrors,residencyAfterClose,...state,rssBytes:process.memoryUsage().rss,bytesPerTurn:state.allocatedBytes/count,failures:[]};
      // Preserve the original timing/RSS distributions above. This additional
      // capture profile samples live tickets within their unchanged lifetime.
      if(!cap)report.proofCapture=await captureProofStability(path,service,host.token,authority,searchInput,targets);
      if(count===10000&&report.api.p95>targets.warmRetrievalP95Ms)report.failures.push('warm_search_api');
      if(!cap&&count<=targets.completeHybridTurns&&(apiCoverage?.status!=='complete'||apiSemantic?.state!=='ready'))report.failures.push('complete_hybrid');
      if(!cap&&(report.full.p95>targets.fullReadP95Ms||report.api.p95>targets.fullReadP95Ms))report.failures.push('full_read');
      if(!cap&&(report.canonical.p95>targets.canonicalP95Ms||report.canonical.p99>targets.canonicalP99Ms))report.failures.push('canonical_section');
      if(capture?.overlap?.samples&&capture.overlap.p95>Math.max(capture.baseline.p95+targets.captureP95AllowanceMs,capture.baseline.p95*(1+targets.captureP95AllowanceFraction)))report.failures.push('capture_contention');
      if(capture?.overlap&&capture.overlap.samples<targets.minCaptureOverlap)report.failures.push('capture_overlap_unobserved');
      if(capture?.sharedSections&&(capture.sharedSections.p95>targets.canonicalP95Ms||capture.sharedSections.p99>targets.canonicalP99Ms))report.failures.push('contended_canonical_section');
      if(capture?.maintenanceError)report.failures.push('maintenance_concurrent_capture');
      if(capture?.unavailable)report.failures.push('capture_unavailable');
      if(apiErrors.length||coldApiError)report.failures.push('search_unavailable');
      if(prepareErrors.length)report.failures.push('source_prepare_unavailable');
      report.maxOperationDeadlineOvershootMs=Math.max(0,...takeOperationOvershoots());report.internalErrors=takeInternalErrorCounts();
      reports.push(report);console.log('measurement result='+JSON.stringify(report));t.diagnostic(JSON.stringify(report));
    }finally{DatabaseSync.prototype.exec=originalExec;await service?.close();await storage?.close();reader?.db.close();db?.close();if(!retained)await ws.cleanup();}
  }
  if(!profile)assert.deepEqual(reports.flatMap(report=>report.failures),[],'frozen performance targets');
}

function measureResidency(metadata){
  const probe={...metadata,dimensions:1},available=(count,bytes=0)=>{
    const lease=reserveSharedVectors(count,probe,bytes);if(!lease)return false;lease.release();return true;
  };
  const maximum=(limit,predicate)=>{let low=0,high=limit;
    while(low<high){const mid=Math.ceil((low+high)/2);if(predicate(mid))low=mid;else high=mid-1;}return low;};
  return {vectors:20000-maximum(20000,n=>available(n)),accountedBytes:128*1024*1024-maximum(128*1024*1024,n=>available(0,n))};
}

async function scanVectors(storage,provider,query){
  let after=0,scanned=0,sum=0,loadMs=0,scoreMs=0,pagingMs=0;const start=performance.now();
  while(true){const pageStart=performance.now(),page=await storage.snapshot({after,limit:512});pagingMs+=performance.now()-pageStart;
    const count=page.rows.reduce((n,r)=>n+r.chunks.length,0),lease=reserveSharedVectors(count,provider);assert.ok(lease);
    try{
      const loadStart=performance.now(),blocks=loadRawVectorBlocks(page.rows,provider);loadMs+=performance.now()-loadStart;
      const scoreStart=performance.now(),scores=scoreRawVectorBlocks(blocks,query);scoreMs+=performance.now()-scoreStart;
      sum+=scores.reduce((a,b)=>a+b,0);scanned+=count;
    }finally{lease.release();}
    if(!page.partial)break;assert.ok(page.rows.length);after=page.rows.at(-1).segment;
  }
  return {method:'paged-fp32-blocks',ms:performance.now()-start,pagingMs,loadMs,scoreMs,scannedChunks:scanned,vectorBytes:scanned*provider.dimensions*4,scoreSum:sum};
}
export const captureTimeoutMs=count=>Math.max(90000,30000+count*1500);
async function captureBurst(path,phase,count){
  const child=fork(new URL('../../core/testing/raw-search-mutation-child.mjs',import.meta.url),[path],{stdio:['ignore','ignore','pipe','ipc']});
  let stderr='',resolveStarted,rejectStarted;child.stderr.on('data',value=>{stderr+=value;});
  const started=new Promise((resolve,reject)=>{resolveStarted=resolve;rejectStarted=reject;});
  const exited=new Promise(resolve=>child.once('exit',(code,signal)=>resolve({code,signal})));
  let timer;const done=new Promise((resolve,reject)=>{
    child.once('exit',(code,signal)=>{const error=Error('capture_exit:'+phase+':'+code+':'+signal+':'+stderr);rejectStarted(error);reject(error);});
    timer=setTimeout(()=>{child.kill();const error=Error('capture_timeout:'+phase);rejectStarted(error);reject(error);},captureTimeoutMs(count));
    child.on('error',reject);child.on('message',value=>{
      if(value.ready)child.send({operation:'capture-burst',input:{namespace:ns,phase,count}});
      else if(value.started)resolveStarted();else if(value.progress)console.log('measurement capture-progress='+JSON.stringify(value.progress));else if(value.ok)resolve(value.value.samples);else reject(Error(JSON.stringify(value)));
    });
  });
  // The caller may still be waiting for startup or collecting reader intervals.
  // Preserve failures until its joined await without an unhandled rejection.
  done.catch(()=>{});
  const finish=async()=>{try{const rows=await done;assert.deepEqual(await exited,{code:0,signal:null},stderr);return rows;}finally{clearTimeout(timer);child.kill();}};
  return {started,finish};
}
export async function captureContention(path,service,token,targets){
  const baselineRun=await captureBurst(path,'baseline',targets.captureSamples);await baselineRun.started;const baseline=await baselineRun.finish();
  const original=DatabaseSync.prototype.exec,active=new WeakMap(),intervals=[],configured=new WeakSet();
  DatabaseSync.prototype.exec=function(sql){
    const value=original.call(this,sql);
    if(sql==='BEGIN'){
      if(!configured.has(this)){this.function('raw_search_capture_hold',value=>{active.set(this,process.hrtime.bigint());return value;});configured.add(this);}
      this.prepare('SELECT raw_search_capture_hold(store_id) FROM store_metadata WHERE singleton=1').get();
    }
    else if((sql==='COMMIT'||sql==='ROLLBACK')&&active.has(this)){
      intervals.push([active.get(this),process.hrtime.bigint()]);active.delete(this);
    }
    return value;
  };
  let rows,maintenanceError=null,maintenanceStatus=null,maintainCalls=0;
  try{const run=await captureBurst(path,'contended',targets.captureSamples);await run.started;
    let finished=false;
    const writing=run.finish().then(value=>{finished=true;return value;}),until=performance.now()+25000;
    writing.catch(()=>{});
    while(!finished&&performance.now()<until){
      takeInternalErrors();maintainCalls++;
      try{await service.maintain({maxItems:16,maxMs:5000},token);}
      catch(error){maintenanceError=measurementError(error);takeInternalErrors();maintenanceStatus=await service.status();break;}
      await new Promise(resolve=>setTimeout(resolve,5));
    }
    rows=await writing;
  }finally{DatabaseSync.prototype.exec=original;}
  const overlap=rows.filter(row=>intervals.some(([start,end])=>BigInt(row.start)<end&&BigInt(row.end)>start));
  const annotate=values=>values.flatMap(row=>(row.transactions??[]).map(tx=>({...tx,
    sharedOverlapMs:sharedOverlapMs(tx.start,tx.end,intervals),
    commitSharedOverlapMs:sharedOverlapMs(tx.commitStart,tx.end,intervals)})));
  const baselineCommits=annotate(baseline),contendedCommits=annotate(rows),overlapCommits=contendedCommits.filter(tx=>tx.sharedOverlapMs>0);
  const components=values=>Object.fromEntries(['lockWaitMs','commitLockWaitMs','commitAndFsyncMs','checkpointMs','sharedOverlapMs','commitSharedOverlapMs']
    .map(key=>[key,summary(values.map(row=>row[key]))]));
  return {writerAttribution:{method:'zero-timeout bounded lock retries; successful COMMIT includes fsync; DELETE journal checkpoint is zero',
    baseline:components(baselineCommits),contended:components(contendedCommits),overlap:components(overlapCommits),
    commits:{baseline:baselineCommits,contended:contendedCommits}},baseline:summary(baseline.map(row=>row.ms)),contended:summary(rows.map(row=>row.ms)),overlap:summary(overlap.map(row=>row.ms)),
    writerBegin:{baseline:summary(baseline.map(r=>r.beginMs)),contended:summary(rows.map(r=>r.beginMs))},writerCommit:{baseline:summary(baseline.map(r=>r.commitMs)),contended:summary(rows.map(r=>r.commitMs))},sharedSections:summary(intervals.map(([start,end])=>Number(end-start)/1e6)),maintenanceError,maintenanceStatus,maintainCalls};
}

async function captureProofStability(path,service,token,authority,input,targets){
  const result={captureCalls:0,fenceChecks:0,fenceChanges:0,fenceUnavailable:0,ticketChecks:0,ticketRefusals:0,
    expiredChecksSkipped:0,settledTicketChecks:0,settledTicketRefusals:0,overlapCalls:0,setupErrors:[]};
  for(let group=0;group<6;group++){
    await new Promise(resolve=>setTimeout(resolve,30));
    let search;
    // A newly invalidated cold reader may first return a deadline-partial set.
    // This setup is outside the original warm/cold timing distributions.
    for(let attempt=0;attempt<3&&!search?.candidates.length;attempt++){takeInternalErrors();search=await service.search(input,token);}
    if(!search?.candidates.length){result.setupErrors.push('no_candidate');break;}
    takeInternalErrors();const ticket=await service.prepare(search.candidates[0],{},token),created=performance.now();takeInternalErrors();const expected=authority.fence();
    const intervals=[],exec=DatabaseSync.prototype.exec,active=new WeakMap();
    DatabaseSync.prototype.exec=function(sql){const value=exec.call(this,sql);
      if(sql==='BEGIN')active.set(this,process.hrtime.bigint());
      else if((sql==='COMMIT'||sql==='ROLLBACK')&&active.has(this)){
        intervals.push([active.get(this),process.hrtime.bigint()]);active.delete(this);
      }return value;};
    let rows;
    try{
      const run=await captureBurst(path,'proof-'+group,Math.ceil(targets.captureSamples/6));await run.started;
      let finished=false;const writing=run.finish().then(rows=>{finished=true;return rows;},error=>{finished=true;throw error;});writing.catch(()=>{});
      while(!finished){
        takeInternalErrors();result.fenceChecks++;
        try{if(authority.fence(expected)!==expected)result.fenceChanges++;}catch{result.fenceUnavailable++;}
        if(performance.now()-created<4500){result.ticketChecks++;
          try{takeInternalErrors();service.revalidate([ticket]);}catch{result.ticketRefusals++;}
        }else result.expiredChecksSkipped++;
        await new Promise(resolve=>setTimeout(resolve,20));
      }
      rows=await writing;
      if(performance.now()-created<4500){result.settledTicketChecks++;
        try{takeInternalErrors();service.revalidate([ticket]);}catch{result.settledTicketRefusals++;}}
      console.log('measurement proof-progress='+JSON.stringify({...result,group,captureCalls:result.captureCalls+rows.length}));
    }finally{DatabaseSync.prototype.exec=exec;}
    result.captureCalls+=rows.length;
    result.overlapCalls+=rows.filter(row=>intervals.some(([start,end])=>BigInt(row.start)<end&&BigInt(row.end)>start)).length;
  }
  const measured=result.fenceChecks-result.fenceUnavailable;
  return {...result,fenceChangeRate:measured?result.fenceChanges/measured:null,
    ticketRefusalRate:result.ticketChecks?result.ticketRefusals/result.ticketChecks:null};
}

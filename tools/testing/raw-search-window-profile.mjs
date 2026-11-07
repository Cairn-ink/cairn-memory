import assert from 'node:assert/strict';
import {readFileSync,writeFileSync,statSync} from 'node:fs';
import {join,resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {performance} from 'node:perf_hooks';
import {createHash} from 'node:crypto';
import {DatabaseSync} from 'node:sqlite';
import {runInNewContext} from 'node:vm';

const args=Object.fromEntries(process.argv.slice(2).map(value=>{const at=value.indexOf('=');return [value.slice(0,at),value.slice(at+1)];}));
for(const name of ['--worktree','--fixture','--profile','--output','--targets','--density'])assert.ok(args[name],name);
const load=name=>import(pathToFileURL(join(resolve(args['--worktree']),name)));
const profile=args['--profile'],record=JSON.parse(readFileSync(args['--fixture'],'utf8')),actual=statSync(record.path);
assert.equal(actual.dev,record.dev);assert.equal(actual.ino,record.inode);
const frozen=readFileSync(args['--targets'],'utf8');
assert.equal(createHash('sha256').update(frozen).digest('hex'),'6421ff87e4c7ae852b20dac2a09168113e57ef24a0e73eb05be6f527971c87ac');
const targetLiteral=frozen.match(/RAW_SEARCH_TARGETS=Object\.freeze\((\{[\s\S]*?\})\);/);assert.ok(targetLiteral);
const targets=runInNewContext('('+targetLiteral[1]+')');
const phases=profile==='cold';
if(phases)(await load('tools/testing/raw-search-phase-loader.mjs')).installPhaseMeasurement();
const {takePhases}=await load('tools/testing/raw-search-phase-ledger.mjs');
const {createRawSearchAuthority}=await load('core/raw-search-authority.mjs');
const {openReadDatabase}=await load('core/read-database.mjs');
const {openRawSearchStorage}=await load('core/raw-search-storage.mjs');
const {openRawSearch}=await load('core/raw-search-index.mjs');
const {rawSearchHost,broker}=await load('core/testing/raw-search-fixtures.mjs');
const {localPlainPort,rawNamespace:ns}=await load('core/testing/raw-fixtures.mjs');
const {measureLineageProfile}=await load('tools/testing/measure-raw-search-lineage.mjs');
const {captureContention,measureRawFullRead,measureRawColdSearch}=await load('tools/testing/measure-raw-search.mjs');
const summary=values=>{const sorted=values.toSorted((a,b)=>a-b),at=q=>sorted[Math.ceil(sorted.length*q)-1]??null;
  return {samples:sorted.length,p50:at(.5),p95:at(.95),p99:at(.99),max:sorted.at(-1)??null};};
const path=join(record.path,'canonical.sqlite'),directory=join(record.path,'index');
const sections=[],intervals=[],starts=new WeakMap(),configured=new WeakSet(),exec=DatabaseSync.prototype.exec;
DatabaseSync.prototype.exec=function(sql){const value=exec.call(this,sql);
  if(sql==='BEGIN'){
    if(!configured.has(this)){this.function('raw_search_measure_read',value=>{starts.set(this,process.hrtime.bigint());return value;});configured.add(this);}
    this.prepare('SELECT raw_search_measure_read(store_id) FROM store_metadata WHERE singleton=1').get();
  }else if((sql==='COMMIT'||sql==='ROLLBACK')&&starts.has(this)){
    const start=starts.get(this),end=process.hrtime.bigint();sections.push(Number(end-start)/1e6);intervals.push([start,end]);starts.delete(this);
  }return value;};
const reader=openReadDatabase(path,{contextRead:true});let service,storage;
try{
  const count=reader.db.prepare("SELECT count(*) n FROM raw_messages WHERE conversation_id LIKE 'session-%'").get().n;
  const density=JSON.parse(readFileSync(args['--density'],'utf8')).lineage;
  for(const [table,key] of [['memories','memories'],['receipts','receipts'],['raw_receipt_lineage','edges'],['content_suppressions','facts']])
    assert.equal(reader.db.prepare('SELECT count(*) n FROM '+table).get().n,density[key],'fixture lineage changed: '+table);
  const authority=createRawSearchAuthority(reader,{ownerId:ns.ownerId,readSet:[ns],crypto:localPlainPort(),authority:rawSearchHost().authority});
  storage=await openRawSearchStorage({directory,identity:authority.identity,bind:authority.bind,quotaBytes:512*1024*1024});
  const host=rawSearchHost(),vector=Array(1536).fill(0);vector[0]=1;
  const provider={id:'synthetic-measurement',revision:'1',dimensions:1536,normalization:'l2',async embed(texts,controls){controls.beforeDispatch();return texts.map(()=>vector);}};
  const options={version:'raw-search-v1',enabled:true,backend:'local',path,directory,ownerId:ns.ownerId,readSet:[ns],
    authority:host.authority,crypto:localPlainPort(),maintenanceTurn:broker(),embedder:provider,
    policy:{family:'local',maxBatchDocuments:1,maxRequests:100,maxConcurrent:1,maxUsd:0}};
  const input={query:'copper telescope',queryVector:{input:'copper telescope',embedder:{id:provider.id,revision:provider.revision,dimensions:1536,normalization:'l2'},vector}};
  service=await openRawSearch(options);let report;
  if(['commitment-cost','cadence'].includes(profile))report=await measureLineageProfile({profile,count,path,authority,service,host,input,sections,sharedIntervals:intervals,lineage:density});
  else if(profile==='cold'){
    await service.close();service=null;
    const cold=[],coldWithFactory=[],warm=[],full=[],preparedFull=[],rawRetrieval=[],prepare=[],errors=[],phaseTimes={},outcomes={};
    for(let sample=0;sample<20;sample++){
      takePhases();const start=performance.now();let coldService,searchAt,stage='factory',coldRecorded=false;
      try{
        const measured=await measureRawColdSearch(async()=>{coldService=await openRawSearch(options);return coldService;},instance=>{
          stage='cold';searchAt=performance.now();return instance.search(input,host.token);
        });
        const result=measured.value;cold.push(measured.ms);coldWithFactory.push(measured.totalMs);coldRecorded=true;
        const values=takePhases();for(const [name,ms] of Object.entries(values))(phaseTimes[name]??=[]).push(ms);
        const outcome=result.coverage.status==='complete'?'complete':result.candidates.length?'partial-with-candidates':'empty-partial';outcomes[outcome]=(outcomes[outcome]??0)+1;
        stage='warm';const warmStart=performance.now(),next=await coldService.search(input,host.token);warm.push(performance.now()-warmStart);
        stage='full';
        const original=await measureRawFullRead(storage,authority);full.push(original.ms);rawRetrieval.push(original.retrievalMs);
        const fullStart=performance.now();let preparations=0;
        for(const candidate of next.candidates){try{const at=performance.now(),handle=await coldService.prepare(candidate,{},host.token);prepare.push(performance.now()-at);coldService.revalidate([handle]);preparations++;}catch(error){errors.push({stage:'prepare',code:error.code});}}
        preparedFull.push(warm.at(-1)+performance.now()-fullStart);
        console.log(JSON.stringify({profile,count,sample,coldMs:cold.at(-1),outcome,preparations}));
      }catch(error){errors.push({stage,code:error.code,ms:performance.now()-start});
        if(stage==='cold'&&!coldRecorded){cold.push(performance.now()-searchAt);coldWithFactory.push(performance.now()-start);}}
      finally{await coldService?.close();}
    }
    report={profile,turns:count,cold:summary(cold),coldWithFactory:summary(coldWithFactory),warm:summary(warm),fullRead:summary(full),rawRetrieval:summary(rawRetrieval),fullPreparedRead:summary(preparedFull),preparations:summary(prepare),errors,outcomes,
      phases:Object.fromEntries(Object.entries(phaseTimes).map(([name,values])=>[name,summary(values)])),shared:summary(sections),gate:{coldP95:cold.length===20&&summary(cold).p95<=1100,noErrors:errors.length===0}};
  }else if(profile==='capture'){
    const capture=await captureContention(path,service,host.token,targets);
    report={profile,turns:count,capture,gate:{overlap:capture.overlap.samples>=targets.minCaptureOverlap,
      allowance:capture.overlap.p95<=Math.max(capture.baseline.p95+targets.captureP95AllowanceMs,capture.baseline.p95*(1+targets.captureP95AllowanceFraction))}};
  }else if(profile==='burst'){
    const {fork}=await import('node:child_process');
    const child=fork(new URL('./raw-search-cadence-writer.mjs',import.meta.url),[path],{stdio:['ignore','ignore','pipe','ipc']});
    let ready;const started=new Promise(resolve=>{ready=resolve;});let serial=0;const pending=new Map();
    child.on('message',value=>{if(value.ready)ready();else{const entry=pending.get(value.id);pending.delete(value.id);value.error?entry.reject(Error(value.error)):entry.resolve(value);}});
    const exited=new Promise(resolve=>child.once('exit',(code,signal)=>{for(const entry of pending.values())entry.reject(Error('writer_exit'));resolve({code,signal});}));
    const call=operation=>new Promise((resolve,reject)=>{const id=++serial;pending.set(id,{resolve,reject});child.send({id,operation});});
    let comparisons=0,wrong=0,refusals=0;const errors=[];
    try{
      await Promise.race([started,new Promise((_,reject)=>setTimeout(()=>reject(Error('writer_start_timeout')),15000))]);
      // Establish the post-capture semantic state before comparing scores.
      // A declared hybrid-to-lexical downgrade is not a wrong comparison.
      await call('capture');await service.search(input,host.token);
      for(let burst=0;burst<20;burst++){
        const before=await service.search(input,host.token);
        const writing=Promise.all(Array.from({length:5},()=>call('capture')));writing.catch(()=>{});
        let during;try{during=await service.search(input,host.token);}catch(error){errors.push({code:error.code});}
        await writing;
        const after=await service.search(input,host.token);
        const canonical=result=>result.candidates.map(({proof,publication,...row})=>row);
        if(before.candidates.length&&after.candidates.length){comparisons++;try{assert.deepEqual(canonical(before),canonical(after));}catch{wrong++;}}
        if(during?.candidates.length&&after.candidates.length){comparisons++;try{assert.deepEqual(canonical(during),canonical(after));}catch{wrong++;}}
        if(after.candidates.length)try{const handle=await service.prepare(after.candidates[0],{},host.token);service.revalidate([handle]);}catch{refusals++;}
      }
      report={profile,turns:count,comparisons,silentWrongComparisons:wrong,refusals,errors,gate:{noSilentWrong:comparisons>0&&wrong===0}};
      await call('stop');assert.deepEqual(await exited,{code:0,signal:null});
    }finally{child.kill();await exited;}
  }else throw Error('invalid_profile');
  writeFileSync(args['--output'],JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify({profile,count,output:args['--output'],gate:report.gate}));
}finally{await service?.close();await storage?.close();reader.db.close();DatabaseSync.prototype.exec=exec;}

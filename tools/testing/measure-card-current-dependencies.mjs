// Opt-in §16 card-current-dependencies contention gates; synthetic data, no provider calls.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { openSync,closeSync,writeFileSync,readFileSync,existsSync,renameSync } from 'node:fs';
import { join,resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';
import { DatabaseSync } from 'node:sqlite';
import { monitorEventLoopDelay, performance } from 'node:perf_hooks';
import { openMemoryCore } from '../../core/contract.mjs';
import { openContextReadSidecar } from '../../core/context-read-sidecar.mjs';
import { createTestWorkspace } from './workspace.mjs';
import { retryStorageBusy,contentionStats,contentionReport,assertMethodGate,MEASUREMENT_BOUNDS } from './measure-method-packages.mjs';
import { appendTimings,readTimings,overlapPageReport,waitForActiveOverlap,CONTENTION_STRESS_BOUNDS,
  stressReaderOptions,stressWriterStopReason,waitForStressObservation,assertStressObservation } from './measure-contention.mjs';

const ns={ownerId:'synthetic-card-dependency-measurement',scope:'personal',projectId:null};
const authored={title:'Finance report',body:'Finance monthly report uses the adopted method'};
const absoluteNow=()=>performance.timeOrigin+performance.now();
const publish=(path,value)=>{writeFileSync(path+'.tmp',JSON.stringify(value));renameSync(path+'.tmp',path);};
const ok=result=>{assert.equal(result.ok,true,JSON.stringify(result));return result.value;};
const pagesPerPass=200;
function host(path){
 const token={},grants=new WeakMap(),authority={authorize(request,supplied){if(supplied!==token)return null;const grant={}, {input,...binding}=request;grants.set(grant,{...binding,accessGeneration:1});return grant;},isCurrent(grant){return grants.get(grant)??null;}};
 const core=openMemoryCore({path,methodPackages:{version:'method-packages-local-v1',storage:'local-plain-v1',authority},
  privateCards:{version:'private-cards-local-v1',source:'submitted-note-v1',storage:'local-plain-v1',disclosure:'explicit-submitted-note-v1',authority,currentDependencies:{version:'card-current-dependencies-v1'}},
  contextRead:{version:'context-read-v1',authority,counter:{id:'synthetic-byte-counter',countTokens:text=>Math.ceil(Buffer.byteLength(text)/4)}}});
 return {core,call:(method,input)=>core[method](input,token)};
}
async function until(predicate,deadlineAt){while(!predicate()){assert.ok(Date.now()<deadlineAt,'measurement rendezvous deadline');await delay(5);}}
async function readPass(f,config,stats,observe,statuses){
 const start=performance.now();let pages=0;
 for(let i=0;i<pagesPerPass;i++){
  const mode=i%2?'history':'detail',input=mode==='detail'?{namespace:ns,cardId:config.ref.cardId}:{namespace:ns,intent:'history',refs:[config.ref]};
  const startedAt=absoluteNow();
  const wrapped=await retryStorageBusy(()=>f.call(mode==='detail'?'getCard':'fetchEvidence',input),stats,config),finishedAt=absoluteNow();
  const value=ok(wrapped),card=mode==='detail'?value.card:value.items[0];
  assert.equal(card.title,authored.title);assert.equal(card.body,authored.body);
  assert.equal(card.revision??card.ref.revision,config.ref.revision);
  assert.ok(['current','needs-review'].includes(card.support.currentDependency.status));
  statuses[mode+'Ok']=(statuses[mode+'Ok']??0)+1;
  observe?.({startedAt,finishedAt,elapsedMs:finishedAt-startedAt});pages++;
 }
 return {pages,elapsedMs:performance.now()-start};
}
function rescan(path){
 const db=new DatabaseSync(path);db.exec('PRAGMA busy_timeout=5000;PRAGMA trusted_schema=OFF');
 const projection={readSet:[ns],types:['card'],intent:'current',accessGenerations:[1]};
 const side=openContextReadSidecar({path,db,readOnly:false,authorizedProjection:projection});
 try {const started=performance.now(),result=side.reconcile({...projection,budget:{maxItems:1024,maxMs:5000}},{isCurrent:()=>true});return {elapsedMs:performance.now()-started,...result};}
 finally{side.close();db.close();}
}
const main=process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url);
if(main&&['--writer','--reader'].includes(process.argv[2])){
 const loop=monitorEventLoopDelay({resolution:10});loop.enable();
 const probes={dependency:0,binding:0,metadataBytes:0,rescans:0};
 const originalPrepare=DatabaseSync.prototype.prepare;
 DatabaseSync.prototype.prepare=function(sql){
  const statement=originalPrepare.call(this,sql);
  return new Proxy(statement,{get(target,key){const value=Reflect.get(target,key,target);if(!['get','all'].includes(key))return typeof value==='function'?value.bind(target):value;return(...args)=>{
   if(/FROM card_current_dependencies WHERE card_id=/.test(sql))probes.dependency++;
   if(/FROM method_bindings WHERE/.test(sql))probes.binding++;
   const result=value.apply(target,args);for(const row of Array.isArray(result)?result:[result])for(const field of Object.values(row??{}))if(typeof field==='string')probes.metadataBytes+=Buffer.byteLength(field);return result;};}});
 };
 const kind=process.argv[2].slice(2),config=JSON.parse(readFileSync(process.argv[3],'utf8')),f=host(config.path),stats=contentionStats(),calls=[],pages=[],statuses={};
 let committed=0,passes=0,status='complete',reason=null,startedAt,finishedAt,flushed=0,stopReason=null;
 try{
  if(kind==='reader'){const baselineStats=contentionStats(),baseline=await readPass(f,config,baselineStats,null,{});publish(config.baseline,{...baseline,...contentionReport(baselineStats)});}
  writeFileSync(config.ready,String(process.pid));await until(()=>existsSync(config.start),config.deadlineAt);
  if(kind==='writer')await until(()=>existsSync(config.readerActive),config.deadlineAt);
  startedAt=absoluteNow();
  if(kind==='writer'){
   publish(config.writerEntered,{at:startedAt});
   while(config.scenario==='unpaced'||committed<100||!existsSync(config.stop)){
    if(config.scenario==='unpaced'){stopReason=stressWriterStopReason(config,startedAt);if(stopReason)break;}
    if(committed&&config.intervalMs>0)await delay(config.intervalMs);
    const input={bindingNamespace:ns,package:config.method.package,version:config.method.version,readSet:[ns],roleId:null,actionId:config.scenario+'-'+committed,expectedRevision:committed+1};
    const result=await retryStorageBusy(()=>{
     const startedAt=absoluteNow();try{return f.call('adoptMethodVersion',input);}
     finally{const finishedAt=absoluteNow();calls.push({startedAt,finishedAt,elapsedMs:finishedAt-startedAt});}
    },stats,{...config,failOnBusy:true});
    committed++;assert.equal(ok(result).binding.revision,committed+1);
    if(calls.length-flushed>=8){appendTimings(config.writerCalls,calls.slice(flushed));flushed=calls.length;publish(config.progress,{status:'running',committed,intervalMs:config.intervalMs,...contentionReport(stats)});}
   }
  }else{
   do{
    await readPass(f,config,stats,timing=>{
     pages.push(timing);if(pages.length===1)writeFileSync(config.readerActive,String(process.pid));
     if(pages.length-flushed>=16){appendTimings(config.readerPages,pages.slice(flushed));flushed=pages.length;publish(config.progress,{status:'running',pages:pages.length,passes,...contentionReport(stats)});}
    },statuses);
    passes++;if(passes===1)publish(config.readerPassDone,{at:absoluteNow()});
   }while(config.scenario==='unpaced'?!(statuses.detailOk&&statuses.historyOk):!existsSync(config.writerDone));
  }
 }catch(error){status='incomplete';reason=error.reason??error.message;process.exitCode=1;}
 finally{
  appendTimings(kind==='writer'?config.writerCalls:config.readerPages,(kind==='writer'?calls:pages).slice(flushed));
  finishedAt=absoluteNow();loop.disable();DatabaseSync.prototype.prepare=originalPrepare;f.core.close();if(kind==='writer')publish(config.writerDone,{at:finishedAt});
  const entered=existsSync(config.writerEntered)?JSON.parse(readFileSync(config.writerEntered,'utf8')):null,done=existsSync(config.writerDone)?JSON.parse(readFileSync(config.writerDone,'utf8')):null;
  const during=entered?overlapPageReport(pages,{startedAt:entered.at,finishedAt:done?.at??finishedAt}):overlapPageReport([],{}),active=overlapPageReport(pages,readTimings(config.writerCalls));
  publish(config.result,{probes,eventLoop:{p50Ms:loop.percentile(50)/1e6,p95Ms:loop.percentile(95)/1e6},status,reason,pid:process.pid,committed,passes,pages:pages.length,intervalMs:config.intervalMs??null,stopReason,
   readCompleted:passes>=1,byteExact:passes>=1&&Boolean(statuses.detailOk&&statuses.historyOk),pagesDuringWriter:during.pages,pagesDuringActiveWrites:active.pages,
   duringOverlap:during,duringActiveWrites:active,statuses,...contentionReport(stats)});
 }
}else if(main){
 const workspace=createTestWorkspace(null,{prefix:'card-current-dependencies-measurement-'}),children={},observations={};
 const bounds={overallMs:MEASUREMENT_BOUNDS.overallMs,deadlineAt:Date.now()+MEASUREMENT_BOUNDS.overallMs,stress:CONTENTION_STRESS_BOUNDS,pagesPerPass};
 try{
  for(const scenario of ['paced','unpaced']){
   const path=join(workspace.path,scenario+'.sqlite'),f=host(path);let method,ref;
   try{
    method=ok(f.call('importMethodVersion',{namespace:ns,actionId:'import',title:'Synthetic method',files:[{path:'guide.txt',text:'Synthetic method v1',mediaType:'text/plain'}]}));
    ok(f.call('adoptMethodVersion',{bindingNamespace:ns,package:method.package,version:method.version,readSet:[ns],roleId:null,expectedRevision:null,actionId:'adopt'}));
    const resolution=ok(f.call('resolveMethod',{readSet:[ns],roleId:'finance',package:method.package}));
    const draft=ok(f.call('createCardDraft',{namespace:ns,actionId:'draft',drafting:'authored',input:{...authored,authoredInput:{text:'Synthetic submitted source',occurredAt:null}}}));
    const confirmed=ok(f.call('confirmCardDraft',{namespace:ns,cardId:draft.id,expectedRevision:1,actionId:'confirm',applicability:'current',currentDependencies:{context:{readSet:[ns],roleId:'finance'},packages:[{package:method.package,snapshot:resolution.snapshot}]}}));
    ref={type:'card',namespace:ns,cardId:confirmed.id,revision:confirmed.revision,bodyRevision:confirmed.bodyRevision};
   }finally{f.core.close();}
   const config={path,scenario,method,ref,deadlineAt:bounds.deadlineAt,maxBusyRetries:MEASUREMENT_BOUNDS.maxBusyRetries,failOnBusy:true,stressWriterMs:bounds.stress.writerMs,
    ...Object.fromEntries(['start','stop','readerActive','readerPassDone','writerEntered','writerDone','readerPages','writerCalls'].map(name=>[name,join(workspace.path,scenario+'-'+name)]))};
   const initialRescan=rescan(path);
   if(process.argv.includes('--observe-only')){
    const observed=host(path),stats=contentionStats(),times=[],statuses={},loop=monitorEventLoopDelay({resolution:10}),probes={dependency:0,binding:0};
    const prepare=DatabaseSync.prototype.prepare;
    DatabaseSync.prototype.prepare=function(sql){if(/FROM card_current_dependencies WHERE card_id=/.test(sql))probes.dependency++;if(/FROM method_bindings WHERE/.test(sql))probes.binding++;return prepare.call(this,sql);};
    loop.enable();await delay(20);
    try{await readPass(observed,config,stats,timing=>times.push(timing.elapsedMs),statuses);await delay(20);}finally{loop.disable();DatabaseSync.prototype.prepare=prepare;observed.core.close();}
    times.sort((a,b)=>a-b);observations.observation={probes,eventLoop:{p50Ms:loop.percentile(50)/1e6,p95Ms:loop.percentile(95)/1e6},pages:times.length,p50Ms:times[Math.floor(times.length*.5)],p95Ms:times[Math.floor(times.length*.95)],initialRescan,warmRescan:rescan(path),statuses,...contentionReport(stats)};break;
   }
   function launch(kind,extra={}){
    const name=scenario+'-'+kind,settings={...config,ready:join(workspace.path,name+'.ready'),result:join(workspace.path,name+'.result'),progress:join(workspace.path,name+'.progress'),...extra},file=join(workspace.path,name+'.json');writeFileSync(file,JSON.stringify(settings));
    const stderr=join(workspace.path,name+'.stderr'),out=openSync(join(workspace.path,name+'.stdout'),'wx',0o600),err=openSync(stderr,'wx',0o600),env={...process.env};delete env.NODE_TEST_CONTEXT;
    let child;try{child=spawn(process.execPath,[fileURLToPath(import.meta.url),'--'+kind,file],{env,stdio:['ignore',out,err]});}finally{closeSync(out);closeSync(err);}
    const state={child,config:settings,stderr,exit:null};children[name]=state;
    state.closed=new Promise((resolve,reject)=>{child.once('error',reject);child.once('close',(code,signal)=>{state.exit={code,signal};resolve(state.exit);});});
    workspace.defer(async()=>{if(!state.exit)child.kill('SIGKILL');await state.closed;});return state;
   }
   const reader=launch('reader',{baseline:join(workspace.path,scenario+'-baseline'),...(scenario==='unpaced'?stressReaderOptions(bounds.deadlineAt):{})});
   const alive=()=>{for(const state of [reader,children[scenario+'-writer']])if(state?.exit&&(state.exit.code!==0||state.exit.signal!==null))throw Error('measurement child failed: '+JSON.stringify(state.exit)+' '+readFileSync(state.stderr,'utf8'));};
   await until(()=>{alive();return existsSync(reader.config.ready);},bounds.deadlineAt);
   const baseline=JSON.parse(readFileSync(reader.config.baseline,'utf8'));assert.equal(baseline.storageBusy,0);observations[scenario]={baseline};
   // Like asset byte pages, Card reads are small: spread 100 transitions
   // across ten baseline passes rather than saturating the rollback journal.
   const writer=launch('writer',{intervalMs:scenario==='paced'?Math.max(1,baseline.elapsedMs/10):0});
   await until(()=>{alive();return existsSync(writer.config.ready);},bounds.deadlineAt);writeFileSync(config.start,'go');
   const complete=async state=>{const exit=await state.closed;assert.deepEqual(exit,{code:0,signal:null},readFileSync(state.stderr,'utf8'));return exit;};
   const supervise=scenario==='paced'?waitForActiveOverlap:waitForStressObservation;let timer;
   try{
    const [,exits]=await Promise.race([Promise.all([supervise(config,alive),Promise.all([complete(reader),complete(writer)])]),new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error('Card dependency measurement overall deadline')),Math.max(1,bounds.deadlineAt-Date.now()));})]);
    const report={rescan:{initial:initialRescan,afterWriter:rescan(path)},scenario,kind:scenario==='paced'?'gate':'stress-observation',baseline,reader:JSON.parse(readFileSync(reader.config.result,'utf8')),writer:JSON.parse(readFileSync(writer.config.result,'utf8')),exits:{reader:exits[0],writer:exits[1]}};
    (scenario==='paced'?assertMethodGate:assertStressObservation)(report);observations[scenario]=report;
    console.error(JSON.stringify({scenario,kind:report.kind,commits:report.writer.committed,activelyOverlappingPages:report.reader.pagesDuringActiveWrites,writerP95Ms:report.writer.p95Ms,readerBusy:report.reader.storageBusy,writerBusy:report.writer.storageBusy}));
   }finally{clearTimeout(timer);}
  }
  console.log(JSON.stringify({mode:process.argv.includes('--observe-only')?'observation-only':'paced-and-stress',status:'complete',node:process.version,bounds,scenarios:observations,
   methodology:'synthetic canonical dependency detail/history reads, 200 alternating detail/history pages per pass; separate reader/writer processes and checked exits; paced writer pauses baseline elapsedMs / 10, >=100 commits and >=200 distinct pages overlapping actual writer calls, zero busy and writer p95 <=250 ms; unpaced stress has no latency/throughput/reader-busy gate, stops writer on reader completion or after 10 seconds, retries the same read with bounded backoff and checks eventual canonical authored body/revision equality; no provider'},null,2));
 }catch(error){
  process.exitCode=1;for(const state of Object.values(children))if(!state.exit)state.child.kill('SIGKILL');await Promise.allSettled(Object.values(children).map(state=>state.closed));
  const partial=Object.fromEntries(Object.entries(children).map(([name,state])=>{const file=existsSync(state.config.result)?state.config.result:state.config.progress;return [name,{exit:state.exit,...(existsSync(file)?JSON.parse(readFileSync(file,'utf8')):{})}];}));
  console.error(JSON.stringify({status:'failed',node:process.version,reason:error.message,bounds,scenarios:observations,partial},null,2));
 }finally{await workspace.cleanup();}
}

// Opt-in §16 role-profile contention gates; synthetic data, no provider calls.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { openSync,closeSync,writeFileSync,readFileSync,existsSync,renameSync } from 'node:fs';
import { join,resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';
import { performance } from 'node:perf_hooks';
import { openMemoryCore } from '../../core/contract.mjs';
import { createTestWorkspace } from './workspace.mjs';
import { retryStorageBusy,contentionStats,contentionReport,assertMethodGate,MEASUREMENT_BOUNDS } from './measure-method-packages.mjs';
import { appendTimings,readTimings,overlapPageReport,waitForActiveOverlap,CONTENTION_STRESS_BOUNDS,
  stressReaderOptions,stressWriterStopReason,waitForStressObservation,assertStressObservation } from './measure-contention.mjs';

const ns={ownerId:'synthetic-role-measurement',scope:'personal',projectId:null};
const fields={duties:['Review canonical records'],requiredOutputs:['Report sourced decisions'],methods:[],related:[],appliesTo:null};
const absoluteNow=()=>performance.timeOrigin+performance.now();
const publish=(path,value)=>{writeFileSync(path+'.tmp',JSON.stringify(value));renameSync(path+'.tmp',path);};
const ok=result=>{assert.equal(result.ok,true,JSON.stringify(result));return result.value;};
const pagesPerPass=200;
function host(path){
 const token={},grants=new WeakMap(),authority={authorize(request,supplied){if(supplied!==token)return null;const grant={}, {input,...binding}=request;grants.set(grant,{...binding,accessGeneration:1});return grant;},isCurrent(grant){return grants.get(grant)??null;}};
 const core=openMemoryCore({path,methodPackages:{version:'method-packages-local-v1',storage:'local-plain-v1',authority},
  roleProfiles:{version:'role-profiles-local-v1',storage:'local-plain-v1',authority,attribution:{actorId:'synthetic-actor',agentId:'synthetic-agent'}},
  contextRead:{version:'context-read-v1',authority,counter:{id:'synthetic-byte-counter',countTokens:text=>Math.ceil(Buffer.byteLength(text)/4)}}});
 return {core,call:(method,input)=>core[method](input,token)};
}
async function until(predicate,deadlineAt){while(!predicate()){assert.ok(Date.now()<deadlineAt,'measurement rendezvous deadline');await delay(5);}}
async function readPass(f,config,stats,observe,statuses){
 const start=performance.now();let pages=0;
 for(let i=0;i<pagesPerPass;i++){
  const mode=i%2?'then':'now',input=mode==='now'?{mode,roleKey:'finance',readSet:[ns]}:{mode,receipt:config.receipt,readSet:[ns]};
  const startedAt=absoluteNow();
  const wrapped=await retryStorageBusy(()=>{
   const result=f.call('readRoleTaskContext',input);
   return result.ok||result.error.code==='snapshot_stale'?{ok:true,value:result}:result;
  },stats,config),result=ok(wrapped),finishedAt=absoluteNow();
  const status=result.ok?'ok':result.error.code;statuses[status]=(statuses[status]??0)+1;
  if(result.ok){statuses[mode+'Ok']=(statuses[mode+'Ok']??0)+1;const value=result.value.metered;assert.deepEqual(value.profile.release.ref,config.release);assert.deepEqual(value.profile.release.fields,fields);if(mode==='then')assert.equal(value.receipt,config.receipt);}
  else {assert.equal(result.error.code,'snapshot_stale');assert.equal(result.value,undefined);}
  observe?.({startedAt,finishedAt,elapsedMs:finishedAt-startedAt});pages++;
 }
 return {pages,elapsedMs:performance.now()-start};
}
const main=process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url);
if(main&&['--writer','--reader'].includes(process.argv[2])){
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
    const input={namespace:ns,roleKey:'finance',actionId:config.scenario+'-'+committed,expectedCurrentRelease:config.release,expectedRegistryRevision:committed+1};
    const result=await retryStorageBusy(()=>{
     const startedAt=absoluteNow();try{return f.call('disableRoleProfile',input);}
     finally{const finishedAt=absoluteNow();calls.push({startedAt,finishedAt,elapsedMs:finishedAt-startedAt});}
    },stats,{...config,failOnBusy:true});
    committed++;assert.equal(ok(result).registry.revision,committed+1);
    if(calls.length-flushed>=8){appendTimings(config.writerCalls,calls.slice(flushed));flushed=calls.length;publish(config.progress,{status:'running',committed,intervalMs:config.intervalMs,...contentionReport(stats)});}
   }
  }else{
   do{
    await readPass(f,config,stats,timing=>{
     pages.push(timing);if(pages.length===1)writeFileSync(config.readerActive,String(process.pid));
     if(pages.length-flushed>=16){appendTimings(config.readerPages,pages.slice(flushed));flushed=pages.length;publish(config.progress,{status:'running',pages:pages.length,passes,...contentionReport(stats)});}
    },statuses);
    passes++;if(passes===1)publish(config.readerPassDone,{at:absoluteNow()});
   }while(config.scenario==='unpaced'?!(statuses.nowOk&&statuses.thenOk):!existsSync(config.writerDone));
  }
 }catch(error){status='incomplete';reason=error.reason??error.message;process.exitCode=1;}
 finally{
  appendTimings(kind==='writer'?config.writerCalls:config.readerPages,(kind==='writer'?calls:pages).slice(flushed));
  finishedAt=absoluteNow();f.core.close();if(kind==='writer')publish(config.writerDone,{at:finishedAt});
  const entered=existsSync(config.writerEntered)?JSON.parse(readFileSync(config.writerEntered,'utf8')):null,done=existsSync(config.writerDone)?JSON.parse(readFileSync(config.writerDone,'utf8')):null;
  const during=entered?overlapPageReport(pages,{startedAt:entered.at,finishedAt:done?.at??finishedAt}):overlapPageReport([],{}),active=overlapPageReport(pages,readTimings(config.writerCalls));
  publish(config.result,{status,reason,pid:process.pid,committed,passes,pages:pages.length,intervalMs:config.intervalMs??null,stopReason,
   readCompleted:passes>=1,byteExact:passes>=1&&Boolean(statuses.nowOk&&statuses.thenOk),pagesDuringWriter:during.pages,pagesDuringActiveWrites:active.pages,
   duringOverlap:during,duringActiveWrites:active,statuses,...contentionReport(stats)});
 }
}else if(main){
 const workspace=createTestWorkspace(null,{prefix:'role-profile-measurement-'}),children={},observations={};
 const bounds={overallMs:MEASUREMENT_BOUNDS.overallMs,deadlineAt:Date.now()+MEASUREMENT_BOUNDS.overallMs,stress:CONTENTION_STRESS_BOUNDS,pagesPerPass};
 try{
  for(const scenario of ['paced','unpaced']){
   const path=join(workspace.path,scenario+'.sqlite'),f=host(path);let release,receipt;
   try{const {appliesTo,...input}=fields;release=ok(f.call('publishRoleProfileRelease',{namespace:ns,roleKey:'finance',actionId:'initial',expectedCurrentRelease:null,expectedRegistryRevision:null,fields:input})).release;
    receipt=ok(f.call('readRoleTaskContext',{mode:'now',roleKey:'finance',readSet:[ns]})).metered.receipt;
   }finally{f.core.close();}
   const config={path,scenario,release,receipt,deadlineAt:bounds.deadlineAt,maxBusyRetries:MEASUREMENT_BOUNDS.maxBusyRetries,failOnBusy:true,stressWriterMs:bounds.stress.writerMs,
    ...Object.fromEntries(['start','stop','readerActive','readerPassDone','writerEntered','writerDone','readerPages','writerCalls'].map(name=>[name,join(workspace.path,scenario+'-'+name)]))};
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
   // Like asset byte pages, role pages are small: spread 100 transitions
   // across ten baseline passes rather than saturating the rollback journal.
   const writer=launch('writer',{intervalMs:scenario==='paced'?Math.max(1,baseline.elapsedMs/10):0});
   await until(()=>{alive();return existsSync(writer.config.ready);},bounds.deadlineAt);writeFileSync(config.start,'go');
   const complete=async state=>{const exit=await state.closed;assert.deepEqual(exit,{code:0,signal:null},readFileSync(state.stderr,'utf8'));return exit;};
   const supervise=scenario==='paced'?waitForActiveOverlap:waitForStressObservation;let timer;
   try{
    const [,exits]=await Promise.race([Promise.all([supervise(config,alive),Promise.all([complete(reader),complete(writer)])]),new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error('role measurement overall deadline')),Math.max(1,bounds.deadlineAt-Date.now()));})]);
    const report={scenario,kind:scenario==='paced'?'gate':'stress-observation',baseline,reader:JSON.parse(readFileSync(reader.config.result,'utf8')),writer:JSON.parse(readFileSync(writer.config.result,'utf8')),exits:{reader:exits[0],writer:exits[1]}};
    (scenario==='paced'?assertMethodGate:assertStressObservation)(report);observations[scenario]=report;
    console.error(JSON.stringify({scenario,kind:report.kind,commits:report.writer.committed,activelyOverlappingPages:report.reader.pagesDuringActiveWrites,writerP95Ms:report.writer.p95Ms,readerBusy:report.reader.storageBusy,writerBusy:report.writer.storageBusy}));
   }finally{clearTimeout(timer);}
  }
  console.log(JSON.stringify({status:'complete',node:process.version,bounds,scenarios:observations,
   methodology:'synthetic canonical profile/receipt reads, 200 alternating now/then pages per pass; separate reader/writer processes and checked exits; paced writer pauses baseline elapsedMs / 10, >=100 commits and >=200 distinct pages overlapping actual writer calls, zero busy and writer p95 <=250 ms; unpaced stress has no latency/throughput/reader-busy gate, stops writer on reader completion or after 10 seconds, retries the same read with bounded backoff and checks eventual canonical field/receipt equality; no provider'},null,2));
 }catch(error){
  process.exitCode=1;for(const state of Object.values(children))if(!state.exit)state.child.kill('SIGKILL');await Promise.allSettled(Object.values(children).map(state=>state.closed));
  const partial=Object.fromEntries(Object.entries(children).map(([name,state])=>{const file=existsSync(state.config.result)?state.config.result:state.config.progress;return [name,{exit:state.exit,...(existsSync(file)?JSON.parse(readFileSync(file,'utf8')):{})}];}));
  console.error(JSON.stringify({status:'failed',node:process.version,reason:error.message,bounds,scenarios:observations,partial},null,2));
 }finally{await workspace.cleanup();}
}

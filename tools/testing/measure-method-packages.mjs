// Opt-in synthetic U2c C04 concurrency gate; no provider or product benchmark.
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {createHash} from 'node:crypto';
import {openSync,closeSync,existsSync,readFileSync,writeFileSync,renameSync} from 'node:fs';
import {join,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {setTimeout as delay} from 'node:timers/promises';
import {DatabaseSync} from 'node:sqlite';
import {openMemoryCore} from '../../core/contract.mjs';
import {METHOD_LIMITS} from '../../core/method-package-input.mjs';
import {createTestWorkspace} from './workspace.mjs';
import {appendTimings,readTimings,overlapPageReport,waitForActiveOverlap,CONTENTION_STRESS_BOUNDS,
  stressReaderOptions,stressWriterStopReason,waitForStressObservation,assertStressObservation} from './measure-contention.mjs';
export {overlapPageReport} from './measure-contention.mjs';

const ns={ownerId:'synthetic-measurement',scope:'personal',projectId:null},project={...ns,scope:'project',projectId:'writer'};
function host(path){
  const token={},grants=new WeakMap(),authority={authorize(request,supplied){if(supplied!==token)return null;const grant={}, {input,...binding}=request;grants.set(grant,{...binding,accessGeneration:1});return grant;},isCurrent(grant){return grants.get(grant)??null;}};
  const core=openMemoryCore({path,methodPackages:{version:'method-packages-local-v1',storage:'local-plain-v1',authority}});
  return {core,call:(method,input)=>core[method](input,token)};
}
const ok=result=>{assert.equal(result.ok,true,JSON.stringify(result));return result.value;};
const percentile=(values,fraction)=>[...values].sort((a,b)=>a-b)[Math.min(values.length-1,Math.floor(values.length*fraction))];
export const MEASUREMENT_BOUNDS=Object.freeze({overallMs:600_000,maxBusyRetries:32});
export class MeasurementBound extends Error {constructor(reason){super(reason);this.reason=reason;}}
function checkDeadline(deadlineAt){if(Date.now()>=deadlineAt)throw new MeasurementBound('run-deadline');}
async function until(predicate,deadlineAt,maximumMs=30000){const end=Date.now()+maximumMs;while(!predicate()){checkDeadline(deadlineAt);assert.ok(Date.now()<end,'measurement start barrier');await delay(5);}}
// The callback owns one frozen operation/page, including its cursor/action ID.
// Busy outcomes leave that operation unchanged; only a successful result advances.
export async function retryStorageBusy(call,stats,{deadlineAt=Date.now()+MEASUREMENT_BOUNDS.overallMs,maxBusyRetries=MEASUREMENT_BOUNDS.maxBusyRetries,
  failOnBusy=false,retryBackoffMs=1,maxRetryBackoffMs=retryBackoffMs}={}) {
  assert.ok(Number.isSafeInteger(deadlineAt)&&Number.isSafeInteger(maxBusyRetries)&&maxBusyRetries>=0);
  assert.ok(Number.isFinite(retryBackoffMs)&&retryBackoffMs>=1&&Number.isFinite(maxRetryBackoffMs)&&maxRetryBackoffMs>=retryBackoffMs);
  let retries=0;
  for(;;){
    checkDeadline(deadlineAt);
    const start=performance.now(),result=call(),elapsed=performance.now()-start;
    stats.attempts++;stats.times.push(elapsed);
    if(result.ok){checkDeadline(deadlineAt);return result;}
    assert.equal(result.error.code,'storage_busy',JSON.stringify(result));
    assert.equal(result.error.retryable,true,JSON.stringify(result));
    stats.storageBusy++;stats.busyWaits.push(elapsed);
    if(failOnBusy)throw new MeasurementBound('busy-gate');
    checkDeadline(deadlineAt);
    if(retries++>=maxBusyRetries)throw new MeasurementBound('operation-retry-limit');
    const backoff=Math.min(maxRetryBackoffMs,retryBackoffMs*2**Math.min(retries-1,30),deadlineAt-Date.now());
    const pause=performance.now();await delay(backoff);stats.retryDelayMs+=performance.now()-pause;
  }
}
export const contentionStats=()=>({attempts:0,storageBusy:0,times:[],busyWaits:[],retryDelayMs:0});
export function contentionReport(stats) {
  const waits=stats.busyWaits;
  return {attempts:stats.attempts,storageBusy:stats.storageBusy,
    busyWaitMs:waits.reduce((sum,value)=>sum+value,0),busyP50Ms:waits.length?percentile(waits,.5):0,
    busyP95Ms:waits.length?percentile(waits,.95):0,busyMaxMs:waits.reduce((max,value)=>Math.max(max,value),0),
    retryDelayMs:stats.retryDelayMs,p50Ms:stats.times.length?percentile(stats.times,.5):0,p95Ms:stats.times.length?percentile(stats.times,.95):0,
    maxMs:stats.times.reduce((max,value)=>Math.max(max,value),0)};
}
export function assertMethodGate({reader,writer,exits}) {
  for(const name of ['reader','writer']){
    assert.equal(exits[name].signal,null,name+' signal');assert.equal(exits[name].code,0,name+' exit code');
    assert.equal(({reader,writer})[name].status,'complete',name+' completed');
    assert.equal(({reader,writer})[name].storageBusy,0,name+' had a busy outcome, including retries');
  }
  assert.notEqual(reader.pid,writer.pid,'independent processes');
  assert.ok(reader.passes>=1,'complete maximum-version read');
  assert.ok(reader.pagesDuringWriter>=200,'at least 200 reader pages overlap writer activity');
  assert.ok(reader.pagesDuringActiveWrites>=200,'at least 200 reader pages overlap actual writer calls');
  assert.ok(writer.committed>=100,'at least 100 committed binding transitions');
  assert.ok(writer.p95Ms<=250,'writer p95 exceeds 250 ms');
}
const absoluteNow=()=>performance.timeOrigin+performance.now();
const publish=(path,value)=>{writeFileSync(path+'.tmp',JSON.stringify(value));renameSync(path+'.tmp',path);};
export function methodWriterInterval(baselineMs){
  assert.ok(Number.isFinite(baselineMs)&&baselineMs>0,'finite positive reader baseline');
  return Math.max(1,baselineMs/100);
}
async function maximumPass(f,config,stats,observe,stop=()=>false){
  const started=performance.now(),hash=createHash('sha256');let units=0,bytes=0,pages=0;
  for(const path of config.files){
    let cursor;
    do{
      if(stop())return {complete:false,pages,elapsedMs:performance.now()-started};
      const input={version:config.receipt.version,intent:'history',path,...(cursor?{cursor}:{})};
      const startedAt=absoluteNow(),result=await retryStorageBusy(()=>f.call('readMethodFile',input),stats,config),finishedAt=absoluteNow(),page=ok(result);
      observe?.({startedAt,finishedAt,elapsedMs:finishedAt-startedAt});
      assert.ok(Buffer.byteLength(JSON.stringify(result))<=65536);
      for(const part of page.parts){units+=part.text.length;bytes+=Buffer.byteLength(part.text);hash.update(part.text);}
      cursor=page.nextCursor;pages++;
    }while(cursor);
  }
  assert.equal(units,METHOD_LIMITS.versionUnits);assert.equal(bytes,config.bytes);assert.equal(hash.digest('hex'),config.sha256);
  return {complete:true,pages,elapsedMs:performance.now()-started,units,bytes,sha256:config.sha256};
}
const main=process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url);
if(main&&process.argv[2]==='--writer'){
  const config=JSON.parse(readFileSync(process.argv[3],'utf8')),f=host(config.path),stats=contentionStats();
  let revision=0,status='complete',reason=null,startedAt,flushed=0,stopReason=null;const callTimes=[];
  try{
    writeFileSync(config.ready,String(process.pid));await until(()=>existsSync(config.start),config.deadlineAt);
    if(config.gate)await until(()=>existsSync(config.readerActive),config.deadlineAt);
    startedAt=absoluteNow();publish(config.entered,{pid:process.pid,at:startedAt});
    while(config.scenario==='unpaced'||(config.gate?revision<100||!existsSync(config.stop):!existsSync(config.stop))){
      checkDeadline(config.deadlineAt);
      if(config.scenario==='unpaced') {
        stopReason=stressWriterStopReason(config,startedAt);if(stopReason)break;
      }
      // A fixed pause derived from the reader baseline leaves reads between
      // commits. Continue through the first complete contended reader pass.
      if(config.gate&&revision>0&&config.intervalMs>0){checkDeadline(config.deadlineAt);await delay(config.intervalMs);}
      const method=revision%2===0?'adoptMethodVersion':'disableMethodBinding';
      const input={bindingNamespace:project,actionId:'measurement-'+(config.scenario??'legacy')+'-'+revision,package:config.receipt.package,
        roleId:'measurement',expectedRevision:revision||null,readSet:[project],...(method==='adoptMethodVersion'?{version:config.receipt.version}:{})};
      const result=await retryStorageBusy(()=>{
        const startedAt=absoluteNow();try{return f.call(method,input);}
        finally{const finishedAt=absoluteNow();callTimes.push({startedAt,finishedAt,elapsedMs:finishedAt-startedAt});}
      },stats,{...config,...(config.scenario==='unpaced'?{failOnBusy:true}:{})});
      revision++;assert.equal(result.value.binding.revision,revision);
      if(callTimes.length-flushed>=8){appendTimings(config.writerCalls,callTimes.slice(flushed));flushed=callTimes.length;
        if(config.progress)publish(config.progress,{pid:process.pid,status:'running',committed:revision,...contentionReport(stats)});}
      if(!config.gate)await delay(1);
    }
  }catch(error){
    if(!(error instanceof MeasurementBound))throw error;status='incomplete';reason=error.reason;
  }finally{appendTimings(config.writerCalls,callTimes.slice(flushed));f.core.close();}
  const finishedAt=absoluteNow();
  writeFileSync(config.result,JSON.stringify({pid:process.pid,status,reason,deadlineAt:config.deadlineAt,maxBusyRetries:config.maxBusyRetries,
    intervalMs:config.intervalMs??null,stressWriterMs:config.stressWriterMs??null,stopReason,
    activeElapsedMs:startedAt===undefined?0:finishedAt-startedAt,
    calls:callTimes.length,activeCallMs:callTimes.reduce((sum,call)=>sum+call.elapsedMs,0),committed:revision,...contentionReport(stats)}));
  if(config.gate){publish(config.writerDone,{pid:process.pid,at:finishedAt});if(status!=='complete')process.exitCode=1;}
}else if(main&&process.argv[2]==='--reader'){
  const config=JSON.parse(readFileSync(process.argv[3],'utf8')),f=host(config.path),stats=contentionStats(),pageTimes=[];
  let status='complete',reason=null,passes=0,pages=0,started,flushed=0;
  try{
    if(config.baseline){
      const baselineStats=contentionStats(),baseline=await maximumPass(f,config,baselineStats);
      publish(config.baseline,{...baseline,pid:process.pid,...contentionReport(baselineStats)});
    }
    writeFileSync(config.ready,String(process.pid));await until(()=>existsSync(config.start),config.deadlineAt);started=performance.now();
    do{
      const pass=await maximumPass(f,config,stats,timing=>{
        pageTimes.push(timing);pages++;
        if(pageTimes.length-flushed>=32){appendTimings(config.readerPages,pageTimes.slice(flushed));flushed=pageTimes.length;}
        if(pages===1)writeFileSync(config.readerActive,String(process.pid));
        if(pages%100===0)console.error(JSON.stringify({measurement:'reader',passes,pages,elapsedMs:performance.now()-started}));
      },()=>passes>=1&&existsSync(config.writerDone));
      if(pass.complete){passes++;if(passes===1&&config.readerPassDone)publish(config.readerPassDone,{at:absoluteNow()});}
    }while(config.scenario!=='unpaced'&&!existsSync(config.writerDone));
  }catch(error){if(!(error instanceof MeasurementBound))throw error;status='incomplete';reason=error.reason;}
  finally{appendTimings(config.readerPages,pageTimes.slice(flushed));f.core.close();}
  const entered=config.writerEntered&&existsSync(config.writerEntered)?JSON.parse(readFileSync(config.writerEntered,'utf8')):null;
  const done=config.writerDone&&existsSync(config.writerDone)?JSON.parse(readFileSync(config.writerDone,'utf8')):null;
  const duringOverlap=entered?overlapPageReport(pageTimes,{startedAt:entered.at,finishedAt:done?.at??absoluteNow()}):overlapPageReport([],{});
  const duringActiveWrites=overlapPageReport(pageTimes,readTimings(config.writerCalls));
  writeFileSync(config.result,JSON.stringify({pid:process.pid,status,reason,passes,pages,readCompleted:passes>=1,byteExact:passes>=1,
    maxPageMs:pageTimes.reduce((max,page)=>Math.max(max,page.elapsedMs),0),pagesDuringWriter:duringOverlap.pages,duringOverlap,
    pagesDuringActiveWrites:duringActiveWrites.pages,duringActiveWrites,files:config.files.length,
    elapsedMs:started===undefined?0:performance.now()-started,deadlineAt:config.deadlineAt,maxBusyRetries:config.maxBusyRetries,
    ...(passes?{units:METHOD_LIMITS.versionUnits,bytes:config.bytes,sha256:config.sha256}:{}),...contentionReport(stats)}));
  if(status!=='complete')process.exitCode=1;
}else if(main){
  const workspace=createTestWorkspace(null,{prefix:'method-package-measurement-'});
  const bounds={...MEASUREMENT_BOUNDS,stress:CONTENTION_STRESS_BOUNDS,failOnBusy:true,deadlineAt:Date.now()+MEASUREMENT_BOUNDS.overallMs},children={},observations={scenarios:{}};
  try{
    const path=join(workspace.path,'store.sqlite'),f=host(path);workspace.defer(()=>f.core.close());
    const files=Array.from({length:METHOD_LIMITS.files},(_,i)=>({path:'file-'+String(i).padStart(3,'0')+'.txt',mediaType:'text/plain',text:i<10?'界'.repeat(METHOD_LIMITS.fileUnits):''}));
    const imported=ok(f.call('importMethodVersion',{namespace:ns,actionId:'maximum',title:'Synthetic maximum',files}));
    const targets=Object.fromEntries(['paced','unpaced'].map(scenario=>[scenario,ok(f.call('importMethodVersion',{namespace:project,actionId:'writer-version-'+scenario,title:'Synthetic writer',files:[{path:'SKILL.md',text:'writer',mediaType:'text/plain'}]}))]));
    const hash=createHash('sha256');for(const file of files)hash.update(file.text);
    const sha256=hash.digest('hex');f.core.close();
    function launch(name,role,config){
      config={path,gate:true,failOnBusy:true,deadlineAt:bounds.deadlineAt,maxBusyRetries:bounds.maxBusyRetries,
        ready:join(workspace.path,name+'.ready'),result:join(workspace.path,name+'.result'),progress:join(workspace.path,name+'.progress'),...config};
      const configuration=join(workspace.path,name+'.json');writeFileSync(configuration,JSON.stringify(config));
      const stdout=join(workspace.path,name+'.stdout'),stderr=join(workspace.path,name+'.stderr'),out=openSync(stdout,'wx'),err=openSync(stderr,'wx');
      const env={...process.env};delete env.NODE_TEST_CONTEXT;let child;
      try{child=spawn(process.execPath,[fileURLToPath(import.meta.url),'--'+role,configuration],{env,stdio:['ignore',out,err]});}
      finally{closeSync(out);closeSync(err);}
      const state={child,config,stdout,stderr,exit:null};children[name]=state;
      state.closed=new Promise((resolve,reject)=>{child.once('error',reject);child.once('close',(code,signal)=>{state.exit={code,signal};resolve(state.exit);});});
      workspace.defer(async()=>{if(!state.exit)child.kill('SIGKILL');await state.closed;});return state;
    }
    for(const scenario of ['paced','unpaced']) {
      const shared={scenario,stressWriterMs:bounds.stress.writerMs,...Object.fromEntries(['start','stop','readerActive','readerPassDone','writerEntered','writerDone','readerPages','writerCalls'].map(name=>[name,join(workspace.path,scenario+'-'+name)]))};
      const reader=launch(scenario+'-reader','reader',{...shared,...(scenario==='unpaced'?stressReaderOptions(bounds.deadlineAt):{}),
        receipt:imported,files:files.map(file=>file.path),bytes:12000000,sha256,baseline:join(workspace.path,scenario+'-baseline.result')});
      let writer;
      const alive=()=>{for(const [name,state]of [['reader',reader],['writer',writer]])if(state?.exit&&
        (state.exit.code!==0||state.exit.signal!==null||!existsSync(name==='reader'?shared.readerPassDone:shared.writerDone)))
        throw Error(scenario+' '+name+' exited before completion: '+JSON.stringify(state.exit)+' '+readFileSync(state.stderr,'utf8'));};
      await until(()=>{alive();return existsSync(reader.config.ready);},bounds.deadlineAt,MEASUREMENT_BOUNDS.overallMs);
      const baseline=JSON.parse(readFileSync(reader.config.baseline,'utf8'));
      assert.equal(baseline.complete,true);assert.equal(baseline.storageBusy,0,'reader baseline busy');
      writer=launch(scenario+'-writer','writer',{...shared,receipt:targets[scenario],entered:shared.writerEntered,intervalMs:scenario==='paced'?methodWriterInterval(baseline.elapsedMs):0});
      await until(()=>{alive();return existsSync(writer.config.ready);},bounds.deadlineAt);
      writeFileSync(shared.start,'start');
      const completed=Promise.all([['reader',reader],['writer',writer]].map(async([name,state])=>{
        const exit=await state.closed;
        assert.equal(exit.signal,null,name+' signal');assert.equal(exit.code,0,name+' exit '+readFileSync(state.stderr,'utf8'));return [name,exit];
      }));
      let timer;
      const workload=async()=>{const supervise=scenario==='paced'?waitForActiveOverlap:waitForStressObservation;
        const [,results]=await Promise.all([supervise({...shared,deadlineAt:bounds.deadlineAt},alive),completed]);return Object.fromEntries(results);};
      const exits=await Promise.race([workload(),new Promise((_,reject)=>{timer=setTimeout(()=>reject(new MeasurementBound('run-deadline')),Math.max(1,bounds.deadlineAt-Date.now()));})]).finally(()=>clearTimeout(timer));
      const report={scenario,kind:scenario==='paced'?'gate':'stress-observation',baseline,reader:JSON.parse(readFileSync(reader.config.result,'utf8')),writer:JSON.parse(readFileSync(writer.config.result,'utf8')),exits};
      observations.scenarios[scenario]=report;(scenario==='paced'?assertMethodGate:assertStressObservation)(report);
    }
    const db=new DatabaseSync(path);
    try{
      assert.equal(db.prepare('SELECT count(*) n FROM method_binding_events').get().n,Object.values(observations.scenarios).reduce((sum,report)=>sum+report.writer.committed,0));
      for(const scenario of ['paced','unpaced'])assert.equal(db.prepare('SELECT revision FROM method_bindings WHERE package_id=?').get(targets[scenario].package.packageId)?.revision??0,observations.scenarios[scenario].writer.committed);
      assert.deepEqual(db.prepare('PRAGMA foreign_key_check').all(),[]);
    }finally{db.close();}
    console.log(JSON.stringify({node:process.version,status:'complete',bounds,...observations,...observations.scenarios.paced,
      methodology:'real SQLite; paced gate: continuous maximum-version reader and independent binding writer, baseline elapsedMs / 100 pauses, >=100 commits, complete read, >=200 distinct pages overlapping actual writer calls (excluding sleeps/reporting), zero busy, writer p95 <=250 ms, both exits checked; unpaced stress observation: no writer delay, writer stops on reader completion or after 10 seconds (plus an in-flight bounded SQLite call), same page/cursor retried with 10–250 ms bounded backoff within the shared deadline; report pages, busy counts/waits, maximum page latency and eventual exact-byte completion; only corruption, byte mismatch, writer errors or deadline breaches fail stress; reader whole-run, lifetime-overlap and active-overlap p50/p95/max observations; no provider'},null,2));
  }catch(error){
    process.exitCode=1;
    for(const state of Object.values(children))if(!state.exit)state.child.kill('SIGKILL');
    await Promise.allSettled(Object.values(children).map(state=>state.closed));
    for(const [name,state] of Object.entries(children)){
      const report=existsSync(state.config.result)?state.config.result:state.config.progress;
      if(existsSync(report))try{observations[name]=JSON.parse(readFileSync(report,'utf8'));}catch{/* A killed child may leave an incomplete report. */}
    }
    console.error(JSON.stringify({node:process.version,status:'failed',reason:error.reason??error.message,bounds,...observations,
      exits:Object.fromEntries(Object.entries(children).map(([name,state])=>[name,state.exit]))},null,2));
  }finally{await workspace.cleanup();}
}

// Opt-in synthetic U2c C04 concurrency gate; no provider or product benchmark.
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {createHash} from 'node:crypto';
import {openSync,closeSync,existsSync,readFileSync,writeFileSync} from 'node:fs';
import {join,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {setTimeout as delay} from 'node:timers/promises';
import {DatabaseSync} from 'node:sqlite';
import {openMemoryCore} from '../../core/contract.mjs';
import {METHOD_LIMITS} from '../../core/method-package-input.mjs';
import {createTestWorkspace} from './workspace.mjs';

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
async function until(predicate,deadlineAt){const end=Date.now()+30000;while(!predicate()){checkDeadline(deadlineAt);assert.ok(Date.now()<end,'measurement start barrier');await delay(5);}}
// The callback owns one frozen operation/page, including its cursor/action ID.
// Busy outcomes leave that operation unchanged; only a successful result advances.
export async function retryStorageBusy(call,stats,{deadlineAt=Date.now()+MEASUREMENT_BOUNDS.overallMs,maxBusyRetries=MEASUREMENT_BOUNDS.maxBusyRetries}={}) {
  assert.ok(Number.isSafeInteger(deadlineAt)&&Number.isSafeInteger(maxBusyRetries)&&maxBusyRetries>=0);
  let retries=0;
  for(;;){
    checkDeadline(deadlineAt);
    const start=performance.now(),result=call(),elapsed=performance.now()-start;
    stats.attempts++;stats.times.push(elapsed);
    if(result.ok)return result;
    assert.equal(result.error.code,'storage_busy',JSON.stringify(result));
    assert.equal(result.error.retryable,true,JSON.stringify(result));
    stats.storageBusy++;stats.busyWaits.push(elapsed);
    checkDeadline(deadlineAt);
    if(retries++>=maxBusyRetries)throw new MeasurementBound('operation-retry-limit');
    const pause=performance.now();await delay(1);stats.retryDelayMs+=performance.now()-pause;
  }
}
export const contentionStats=()=>({attempts:0,storageBusy:0,times:[],busyWaits:[],retryDelayMs:0});
export function contentionReport(stats) {
  const waits=stats.busyWaits;
  return {attempts:stats.attempts,storageBusy:stats.storageBusy,
    busyWaitMs:waits.reduce((sum,value)=>sum+value,0),busyP50Ms:waits.length?percentile(waits,.5):0,
    busyP95Ms:waits.length?percentile(waits,.95):0,busyMaxMs:waits.length?Math.max(...waits):0,
    retryDelayMs:stats.retryDelayMs,p50Ms:stats.times.length?percentile(stats.times,.5):0,p95Ms:stats.times.length?percentile(stats.times,.95):0,maxMs:stats.times.length?Math.max(...stats.times):0};
}
export function assertMethodGate({reader,writer,exits}) {
  for(const name of ['reader','writer']){
    assert.equal(exits[name].signal,null,name+' signal');assert.equal(exits[name].code,0,name+' exit code');
    assert.equal(({reader,writer})[name].status,'complete',name+' completed');
    assert.equal(({reader,writer})[name].storageBusy,0,name+' had a busy outcome, including retries');
  }
  assert.notEqual(reader.pid,writer.pid,'independent processes');
  assert.ok(reader.passes>=1,'complete maximum-version read');
  assert.ok(reader.pagesDuringWriter>0,'reader and writer overlap');
  assert.ok(writer.committed>=100,'at least 100 committed binding transitions');
  assert.ok(writer.p95Ms<=250,'writer p95 exceeds 250 ms');
}
const main=process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url);
if(main&&process.argv[2]==='--writer'){
  const config=JSON.parse(readFileSync(process.argv[3],'utf8')),f=host(config.path),stats=contentionStats();
  let revision=0,status='complete',reason=null;
  try{
    writeFileSync(config.ready,String(process.pid));await until(()=>existsSync(config.start),config.deadlineAt);
    if(config.gate)await until(()=>existsSync(config.readerActive),config.deadlineAt);
    writeFileSync(config.entered,String(process.pid));
    while(config.gate?revision<100:!existsSync(config.stop)){
      const method=revision%2===0?'adoptMethodVersion':'disableMethodBinding';
      const input={bindingNamespace:project,actionId:'measurement-'+revision,package:config.receipt.package,
        roleId:'measurement',expectedRevision:revision||null,readSet:[project],...(method==='adoptMethodVersion'?{version:config.receipt.version}:{})};
      const result=await retryStorageBusy(()=>f.call(method,input),stats,config);
      revision++;assert.equal(result.value.binding.revision,revision);
      await delay(1);
    }
  }catch(error){
    if(!(error instanceof MeasurementBound))throw error;status='incomplete';reason=error.reason;
  }finally{f.core.close();}
  writeFileSync(config.result,JSON.stringify({pid:process.pid,status,reason,deadlineAt:config.deadlineAt,maxBusyRetries:config.maxBusyRetries,committed:revision,...contentionReport(stats)}));
  if(config.gate){writeFileSync(config.writerDone,'done');if(status!=='complete')process.exitCode=1;}
}else if(main&&process.argv[2]==='--reader'){
  const config=JSON.parse(readFileSync(process.argv[3],'utf8')),f=host(config.path),stats=contentionStats();
  let status='complete',reason=null,passes=0,pages=0,pagesDuringWriter=0;
  const started=performance.now();
  try{
    writeFileSync(config.ready,String(process.pid));await until(()=>existsSync(config.start),config.deadlineAt);
    do{
      const hash=createHash('sha256');let units=0,bytes=0;
      for(const path of config.files){
        let cursor;
        do{
          const input={version:config.receipt.version,intent:'history',path,...(cursor?{cursor}:{})};
          const result=await retryStorageBusy(()=>f.call('readMethodFile',input),stats,config),page=ok(result);
          assert.ok(Buffer.byteLength(JSON.stringify(result))<=65536);
          for(const part of page.parts){units+=part.text.length;bytes+=Buffer.byteLength(part.text);hash.update(part.text);}
          cursor=page.nextCursor;pages++;
          if(existsSync(config.writerEntered)&&!existsSync(config.writerDone))pagesDuringWriter++;
          if(pages===1)writeFileSync(config.readerActive,String(process.pid));
          if(pages%100===0)console.error(JSON.stringify({measurement:'reader',passes,pages,elapsedMs:performance.now()-started}));
        }while(cursor);
      }
      assert.equal(units,METHOD_LIMITS.versionUnits);assert.equal(bytes,config.bytes);assert.equal(hash.digest('hex'),config.sha256);passes++;
    }while(!existsSync(config.writerDone));
  }catch(error){if(!(error instanceof MeasurementBound))throw error;status='incomplete';reason=error.reason;}
  finally{f.core.close();}
  writeFileSync(config.result,JSON.stringify({pid:process.pid,status,reason,passes,pages,pagesDuringWriter,files:config.files.length,
    elapsedMs:performance.now()-started,deadlineAt:config.deadlineAt,
    ...(passes?{units:METHOD_LIMITS.versionUnits,bytes:config.bytes,sha256:config.sha256}:{}),...contentionReport(stats)}));
  if(status!=='complete')process.exitCode=1;
}else if(main){
  const workspace=createTestWorkspace(null,{prefix:'method-package-measurement-'});
  const bounds={...MEASUREMENT_BOUNDS,deadlineAt:Date.now()+MEASUREMENT_BOUNDS.overallMs},children={},observations={};
  try{
    const path=join(workspace.path,'store.sqlite'),f=host(path);workspace.defer(()=>f.core.close());
    const files=Array.from({length:METHOD_LIMITS.files},(_,i)=>({path:'file-'+String(i).padStart(3,'0')+'.txt',mediaType:'text/plain',text:i<10?'界'.repeat(METHOD_LIMITS.fileUnits):''}));
    const imported=ok(f.call('importMethodVersion',{namespace:ns,actionId:'maximum',title:'Synthetic maximum',files}));
    const receipt=ok(f.call('importMethodVersion',{namespace:project,actionId:'writer-version',title:'Synthetic writer',files:[{path:'SKILL.md',text:'writer',mediaType:'text/markdown'}]}));
    const hash=createHash('sha256');for(const file of files)hash.update(file.text);
    f.core.close();
    const shared={path,gate:true,deadlineAt:bounds.deadlineAt,maxBusyRetries:bounds.maxBusyRetries,
      ...Object.fromEntries(['start','readerActive','writerEntered','writerDone'].map(name=>[name,join(workspace.path,name)]))};
    for(const name of ['reader','writer']){
      const config={...shared,ready:join(workspace.path,name+'.ready'),result:join(workspace.path,name+'.result'),
        ...(name==='writer'?{receipt,entered:shared.writerEntered}:{receipt:imported,files:files.map(file=>file.path),bytes:12_000_000,sha256:hash.digest('hex')})};
      const configuration=join(workspace.path,name+'.json');writeFileSync(configuration,JSON.stringify(config));
      const stdout=join(workspace.path,name+'.stdout'),stderr=join(workspace.path,name+'.stderr'),out=openSync(stdout,'wx'),err=openSync(stderr,'wx');
      const env={...process.env};delete env.NODE_TEST_CONTEXT;let child;
      try{child=spawn(process.execPath,[fileURLToPath(import.meta.url),'--'+name,configuration],{env,stdio:['ignore',out,err]});}
      finally{closeSync(out);closeSync(err);}
      const state={child,config,stdout,stderr,exit:null};children[name]=state;
      state.closed=new Promise((resolve,reject)=>{child.once('error',reject);child.once('close',(code,signal)=>{state.exit={code,signal};resolve(state.exit);});});
      workspace.defer(async()=>{if(!state.exit)child.kill('SIGKILL');await state.closed;});
    }
    const alive=()=>{for(const [name,state] of Object.entries(children))if(state.exit)throw Error(name+' exited before barrier: '+JSON.stringify(state.exit)+' '+readFileSync(state.stderr,'utf8'));};
    await until(()=>{alive();return Object.values(children).every(state=>existsSync(state.config.ready));},bounds.deadlineAt);
    writeFileSync(shared.start,'start');
    const completed=Promise.all(Object.entries(children).map(async([name,state])=>{
      const exit=await state.closed;
      if(existsSync(state.config.result))observations[name]=JSON.parse(readFileSync(state.config.result,'utf8'));
      assert.equal(exit.signal,null,name+' signal');assert.equal(exit.code,0,name+' exit '+readFileSync(state.stderr,'utf8'));return [name,exit];
    }));
    let timer;
    const exits=Object.fromEntries(await Promise.race([completed,new Promise((_,reject)=>{timer=setTimeout(()=>reject(new MeasurementBound('run-deadline')),Math.max(1,bounds.deadlineAt-Date.now()));})]).finally(()=>clearTimeout(timer)));
    const db=new DatabaseSync(path);
    try{
      assert.equal(db.prepare('SELECT count(*) n FROM method_binding_events').get().n,observations.writer.committed);
      assert.equal(db.prepare('SELECT revision FROM method_bindings').get().revision,observations.writer.committed);
      assert.deepEqual(db.prepare('PRAGMA foreign_key_check').all(),[]);
    }finally{db.close();}
    const report={node:process.version,status:'complete',bounds,...observations,exits,
      methodology:'real SQLite; metadata plus requested-file verification per page; continuous maximum-version reader and 100 independent project binding transitions in separate processes; ready/start/reader-active barrier; identical operations retried on busy but any busy fails; writer p95 <=250 ms; no provider'};
    assertMethodGate(report);console.log(JSON.stringify(report,null,2));
  }catch(error){
    process.exitCode=1;
    // A failed child must not leave its peer waiting until the overall deadline.
    for(const state of Object.values(children))if(!state.exit)state.child.kill('SIGKILL');
    await Promise.allSettled(Object.values(children).map(state=>state.closed));
    for(const [name,state] of Object.entries(children))if(existsSync(state.config.result)){
      try{observations[name]=JSON.parse(readFileSync(state.config.result,'utf8'));}
      catch{/* A killed child may leave an incomplete report; retain its actual exit code below. */}
    }
    console.error(JSON.stringify({node:process.version,status:'failed',reason:error.reason??error.message,bounds,...observations,
      exits:Object.fromEntries(Object.entries(children).map(([name,state])=>[name,state.exit]))},null,2));
  }finally{await workspace.cleanup();}
}

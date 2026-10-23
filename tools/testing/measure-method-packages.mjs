// Opt-in synthetic measurement, not a latency assertion or product benchmark.
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
const main=process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url);
if(main&&process.argv[2]==='--writer'){
  const config=JSON.parse(readFileSync(process.argv[3],'utf8')),f=host(config.path),stats=contentionStats();
  let revision=0,status='complete',reason=null;
  try{
    writeFileSync(config.ready,String(process.pid));await until(()=>existsSync(config.start),config.deadlineAt);writeFileSync(config.entered,String(process.pid));
    while(!existsSync(config.stop)){
      const method=revision%2===0?'adoptMethodVersion':'disableMethodBinding';
      const input={bindingNamespace:project,actionId:'measurement-'+revision,package:config.receipt.package,
        roleId:'measurement',expectedRevision:revision||null,readSet:[project],...(method==='adoptMethodVersion'?{version:config.receipt.version}:{})};
      const result=await retryStorageBusy(()=>f.call(method,input),stats,config);
      revision++;assert.equal(result.value.binding.revision,revision);
      await delay(1);
    }
  }catch(error){if(!(error instanceof MeasurementBound))throw error;status='incomplete';reason=error.reason;}
  finally{f.core.close();}
  writeFileSync(config.result,JSON.stringify({pid:process.pid,status,reason,deadlineAt:config.deadlineAt,maxBusyRetries:config.maxBusyRetries,committed:revision,...contentionReport(stats)}));
}else if(main){
  const workspace=createTestWorkspace(null,{prefix:'method-package-measurement-'});
  const bounds={...MEASUREMENT_BOUNDS,deadlineAt:Date.now()+MEASUREMENT_BOUNDS.overallMs},observations={};let phase='setup',activeStats;
  try{
    const path=join(workspace.path,'store.sqlite'),f=host(path);workspace.defer(()=>f.core.close());
    const files=Array.from({length:METHOD_LIMITS.files},(_,i)=>({path:'file-'+String(i).padStart(3,'0')+'.txt',mediaType:'text/plain',text:i<10?'界'.repeat(METHOD_LIMITS.fileUnits):''}));
    const imported=ok(f.call('importMethodVersion',{namespace:ns,actionId:'maximum',title:'Synthetic maximum',files}));
    async function readAll(label){
      phase=label;
      const start=performance.now(),stats=contentionStats(),hash=createHash('sha256');let units=0,bytes=0,pages=0;activeStats=stats;
      for(const file of files){
        let cursor;
        do{
          const input={version:imported.version,intent:'history',path:file.path,...(cursor?{cursor}:{})};
          const result=await retryStorageBusy(()=>f.call('readMethodFile',input),stats,bounds),page=ok(result);
          assert.ok(Buffer.byteLength(JSON.stringify(result))<=65536);
          for(const part of page.parts){units+=part.text.length;bytes+=Buffer.byteLength(part.text);hash.update(part.text);}cursor=page.nextCursor;pages++;
          if(pages%100===0)console.error(JSON.stringify({measurement:label,pages,elapsedMs:performance.now()-start}));
        }while(cursor);
      }
      assert.equal(units,METHOD_LIMITS.versionUnits);
      return {elapsedMs:performance.now()-start,files:files.length,units,bytes,pages,...contentionReport(stats),sha256:hash.digest('hex')};
    }
    const baseline=observations.baseline=await readAll('baseline');
    const receipt=ok(f.call('importMethodVersion',{namespace:project,actionId:'writer-version',title:'Synthetic writer',files:[{path:'SKILL.md',text:'writer',mediaType:'text/markdown'}]}));
    const config={path,receipt,deadlineAt:bounds.deadlineAt,maxBusyRetries:bounds.maxBusyRetries,...Object.fromEntries(['ready','start','entered','stop','result'].map(name=>[name,join(workspace.path,name)]))};
    const configuration=join(workspace.path,'writer.json');writeFileSync(configuration,JSON.stringify(config));
    const out=openSync(join(workspace.path,'writer.stdout'),'wx'),err=openSync(join(workspace.path,'writer.stderr'),'wx');
    const env={...process.env};delete env.NODE_TEST_CONTEXT;let child;
    try{child=spawn(process.execPath,[fileURLToPath(import.meta.url),'--writer',configuration],{env,stdio:['ignore',out,err]});}finally{closeSync(out);closeSync(err);}
    const closed=new Promise((resolve,reject)=>{child.once('error',reject);child.once('close',(code,signal)=>resolve({code,signal}));});
    workspace.defer(async()=>{if(child.exitCode===null&&child.signalCode===null)child.kill('SIGKILL');await closed;});
    await until(()=>existsSync(config.ready),bounds.deadlineAt);writeFileSync(config.start,'start');await until(()=>existsSync(config.entered),bounds.deadlineAt);
    const concurrent=observations.concurrent=await readAll('concurrent');writeFileSync(config.stop,'stop');
    checkDeadline(bounds.deadlineAt);
    let stopTimer;
    const state=await Promise.race([closed,new Promise((resolve,reject)=>{stopTimer=setTimeout(()=>reject(new MeasurementBound('run-deadline')),Math.max(1,bounds.deadlineAt-Date.now()));})]).finally(()=>clearTimeout(stopTimer));assert.equal(state.signal,null);assert.equal(state.code,0,readFileSync(join(workspace.path,'writer.stderr'),'utf8'));
    const writer=JSON.parse(readFileSync(config.result,'utf8'));assert.equal(concurrent.sha256,baseline.sha256);
    const db=new DatabaseSync(path);try{assert.equal(db.prepare('SELECT count(*) n FROM method_binding_events').get().n,writer.committed);assert.deepEqual(db.prepare('PRAGMA foreign_key_check').all(),[]);}finally{db.close();}
    console.log(JSON.stringify({node:process.version,status:writer.status,bounds,baseline,concurrent,writer,methodology:'real SQLite; full immutable-version verification on every page; independent project binding writer; ready/start/entered file barrier; retryable storage_busy retries the identical reader page/writer operation; busyWaitMs measures failed SQLite call time and retryDelayMs measures subsequent pauses; no provider'},null,2));
  }catch(error){
    if(!(error instanceof MeasurementBound))throw error;
    console.log(JSON.stringify({node:process.version,status:'incomplete',reason:error.reason,phase,bounds,
      ...observations,...(activeStats?{interruptedReader:contentionReport(activeStats)}:{})},null,2));
  }finally{await workspace.cleanup();}
}


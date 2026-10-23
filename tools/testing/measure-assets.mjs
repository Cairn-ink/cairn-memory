// Opt-in K13 gates. Synthetic bytes, real SQLite and independent processes.
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { createHash } from 'node:crypto';
import { syncBuiltinESMExports } from 'node:module';
import { spawn } from 'node:child_process';
import { existsSync,readFileSync,writeFileSync,openSync,closeSync,renameSync } from 'node:fs';
import { join,resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';
import { DatabaseSync } from 'node:sqlite';
import { openMemoryCore } from '../../core/contract.mjs';
import { ASSET_METHODS,ASSET_LIMITS } from '../../core/asset-input.mjs';
import { METHOD_METHODS } from '../../core/method-package-input.mjs';
import { createTestWorkspace } from './workspace.mjs';
import { overlapPageReport,assertMethodGate,retryStorageBusy,contentionStats,contentionReport } from './measure-method-packages.mjs';
import { appendTimings,readTimings,waitForActiveOverlap,CONTENTION_STRESS_BOUNDS,stressReaderOptions,
  stressWriterStopReason,waitForStressObservation,assertStressObservation } from './measure-contention.mjs';

export const ASSET_MEASUREMENT_BOUNDS=Object.freeze({overallMs:600000,baselinePassesPer100Transitions:10,importTransactionMs:2000,rssGrowthBytes:134217728,minimumTransitions:100,minimumOverlapPages:200,writerP95Ms:250});
// Byte pages have much less metadata than maximum text pages. Spread the
// minimum 100 transitions across ten baseline complete byte reads, keeping a
// fixed reader-derived pause and sustained overlap without a saturated writer.
export function assetWriterInterval(baselineMs) {
  assert.ok(Number.isFinite(baselineMs)&&baselineMs>0);
  return Math.max(1,baselineMs*ASSET_MEASUREMENT_BOUNDS.baselinePassesPer100Transitions/100);
}
const ns={ownerId:'synthetic-asset-measurement',scope:'personal',projectId:null},project={...ns,scope:'project',projectId:'binding-writer'};
const methods=new Set([...ASSET_METHODS,...METHOD_METHODS]);
const absoluteNow=()=>performance.timeOrigin+performance.now();
const peakRSS=()=>process.resourceUsage().maxRSS*1024;
const publish=(path,value)=>{writeFileSync(path+'.tmp',JSON.stringify(value));renameSync(path+'.tmp',path);};
function checkDeadline(deadlineAt){assert.ok(Date.now()<deadlineAt,'K13 finite overall run deadline');}
async function until(predicate,deadlineAt){while(!predicate()){checkDeadline(deadlineAt);await delay(5);}}
function host(path,onAuthorize) {
  const token={},grants=new WeakMap(),authority={authorize(request,supplied){
    onAuthorize?.(request);if(supplied!==token||!methods.has(request.method))return null;
    const grant={},{input,...binding}=request;grants.set(grant,{...binding,accessGeneration:1});return grant;
  },isCurrent(grant){return grants.get(grant)??null;}};
  const core=openMemoryCore({path,assets:{version:'assets-local-v1',storage:'sqlite-blob-v1',authority},methodPackages:{version:'method-packages-local-v1',storage:'local-plain-v1',authority}});
  return {core,call:(method,input)=>core[method](input,token)};
}
const ok=value=>{assert.equal(value.ok,true,JSON.stringify(value));return value.value;};
function assertImportGate(report,bytes) {
  assert.equal(report.status,'complete');assert.equal(report.bytes,bytes);
  assert.equal(report.writeTransactions,1);assert.equal(report.allMACsBeforeCallbacksAndLock,true);
  assert.ok(report.transactionMs<=ASSET_MEASUREMENT_BOUNDS.importTransactionMs,'maximum import transaction exceeds 2000 ms');
  assert.ok(report.rssGrowthBytes<=ASSET_MEASUREMENT_BOUNDS.rssGrowthBytes,'RSS growth exceeds 128 MiB from pre-core-call baseline');
}
export const assertAssetImportGate=report=>assertImportGate(report,ASSET_LIMITS.versionBytes);
export function assertMixedAssetImportGate(report) {
  assertImportGate(report,67108864);assert.equal(report.binaryEntries,2);assert.equal(report.entries,256);
  assert.equal(report.textUnits,4000000);assert.equal(report.hmacCalls,2306);
}
const stats=contentionStats,timings=contentionReport;
async function pass(f,config,s,observe) {
  const hash=createHash('sha256'),started=performance.now();let cursor,total=0,pages=0;
  do {
    const input={version:config.receipt.version,...(cursor?{cursor}:{})},startedAt=absoluteNow();
    const page=ok(await retryStorageBusy(()=>f.call('readAssetBytes',input),s,config)),finishedAt=absoluteNow();
    const bytes=Buffer.from(page.bytes,'base64');hash.update(bytes);total+=bytes.length;pages++;
    assert.equal(page.totalByteCount,ASSET_LIMITS.versionBytes);assert.equal(page.index,pages-1);
    assert.equal(page.complete,page.nextCursor===null);assert.ok(Buffer.byteLength(JSON.stringify({ok:true,value:page}))<=65536);
    observe?.({startedAt,finishedAt,elapsedMs:finishedAt-startedAt});cursor=page.nextCursor;
  }while(cursor);
  assert.equal(total,ASSET_LIMITS.versionBytes);assert.equal(hash.digest('hex'),config.sha256);
  return {complete:true,pages,bytes:total,elapsedMs:performance.now()-started,...timings(s)};
}
const main=process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url);
if(main&&['--import','--mixed-import'].includes(process.argv[2])) {
  const mixed=process.argv[2]==='--mixed-import';
  const config=JSON.parse(readFileSync(process.argv[3],'utf8'));let preparationPeakRSS=0,phase='setup',hmacCalls=0,writeTransactions=0,started,transactionMs;
  const f=host(config.path,()=>{assert.ok(['prepare','authorized'].includes(phase));if(phase==='prepare')preparationPeakRSS=peakRSS();phase='authorized';});
  const beforeCallerRSS=process.memoryUsage().rss,bytes=Buffer.alloc(mixed?67108864:ASSET_LIMITS.versionBytes,0x61);bytes.set(Buffer.from('%PDF-1.7'));
  if(mixed)bytes.set(Buffer.from('%PDF-1.7'),ASSET_LIMITS.versionBytes);
  const files=mixed?[
    ...Array.from({length:254},(_,i)=>({kind:'text',path:'p'.repeat(500)+'/'+String(i).padStart(3,'0')+'.txt',mediaType:'text/plain',
      text:'界'.repeat(Math.floor(4000000/254)+(i<4000000%254?1:0))})),
    ...[0,1].map(i=>({kind:'binary',path:'maximum-'+i+'.pdf',mediaType:'application/pdf',bytes:bytes.subarray(i*ASSET_LIMITS.versionBytes,(i+1)*ASSET_LIMITS.versionBytes)})),
  ]:null;
  const textUnits=mixed?files.filter(file=>file.kind==='text').reduce((sum,file)=>sum+file.text.length,0):0;
  const callerTextUTF8Bytes=mixed?files.filter(file=>file.kind==='text').reduce((sum,file)=>sum+Buffer.byteLength(file.text),0):0;
  const afterCallerRSS=process.memoryUsage().rss,sha256=createHash('sha256').update(bytes).digest('hex'),preCoreCallRSS=process.memoryUsage().rss;
  const originalHmac=crypto.createHmac,originalExec=DatabaseSync.prototype.exec;
  crypto.createHmac=function(...args){assert.equal(phase,'prepare','MAC preparation must precede host callbacks and locks');hmacCalls++;return originalHmac(...args);};syncBuiltinESMExports();
  DatabaseSync.prototype.exec=function(sql){
    if(sql==='BEGIN IMMEDIATE'){assert.equal(phase,'authorized');phase='transaction';writeTransactions++;started=performance.now();}
    const result=originalExec.call(this,sql);
    if(sql==='COMMIT'&&phase==='transaction'){transactionMs=performance.now()-started;phase='committed';}
    return result;
  };
  let report;
  try {
    phase='prepare';const receipt=mixed?ok(f.call('importMethodVersion',{namespace:ns,actionId:'maximum-mixed',title:'t'.repeat(200),submittedBy:'s'.repeat(200),manifestFormat:'mixed-v1',files})):
      ok(f.call('importAssetVersion',{namespace:ns,actionId:'maximum-asset',title:'Synthetic maximum asset',filename:'maximum.pdf',mediaType:'application/pdf',bytes}));
    const processPeakRSS=peakRSS();report={status:'complete',pid:process.pid,node:process.version,bytes:bytes.length,callerAllocationBytes:bytes.length,beforeCallerRSS,afterCallerRSS,
      preCoreCallRSS,preparationPeakRSS,processPeakRSS,rssGrowthBytes:Math.max(0,processPeakRSS-preCoreCallRSS),hmacCalls,allMACsBeforeCallbacksAndLock:phase==='committed'&&hmacCalls===(mixed?2306:1026),
      ...(mixed?{binaryEntries:2,entries:files.length,textUnits,callerTextUTF8Bytes}:{}),writeTransactions,transactionMs,receipt,sha256};(mixed?assertMixedAssetImportGate:assertAssetImportGate)(report);
  }catch(error){report={...report,status:'failed',reason:error.message};process.exitCode=1;}
  finally{crypto.createHmac=originalHmac;syncBuiltinESMExports();DatabaseSync.prototype.exec=originalExec;f.core.close();}
  publish(config.result,report);
}else if(main&&['--reader','--writer'].includes(process.argv[2])) {
  const kind=process.argv[2].slice(2),config=JSON.parse(readFileSync(process.argv[3],'utf8')),f=host(config.path),s=stats(),pageTimes=[];
  let status='complete',reason=null,passes=0,pages=0,committed=0,startedAt,finishedAt,flushed=0,stopReason=null;const callTimes=[];
  try {
    if(kind==='reader')publish(config.baseline,await pass(f,config,stats()));
    writeFileSync(config.ready,String(process.pid));await until(()=>existsSync(config.start),config.deadlineAt);
    if(kind==='writer')await until(()=>existsSync(config.readerActive),config.deadlineAt);
    startedAt=absoluteNow();
    if(kind==='reader') {
      do {
        await pass(f,config,s,timing=>{pageTimes.push(timing);pages++;if(pages===1)writeFileSync(config.readerActive,String(process.pid));
          if(pageTimes.length-flushed>=32){appendTimings(config.readerPages,pageTimes.slice(flushed));flushed=pageTimes.length;}
          if(pages%500===0)console.error(JSON.stringify({kind,pages,passes}));});
        passes++;if(passes===1)publish(config.readerPassDone,{at:absoluteNow()});
      }while(config.scenario!=='unpaced'&&!existsSync(config.writerDone));
    } else {
      publish(config.writerEntered,{at:startedAt});
      while(config.scenario==='unpaced'||committed<100||!existsSync(config.stop)) {
        checkDeadline(config.deadlineAt);
        if(config.scenario==='unpaced') {
          stopReason=stressWriterStopReason(config,startedAt);if(stopReason)break;
        }
        if(committed>0&&config.intervalMs>0){checkDeadline(config.deadlineAt);await delay(config.intervalMs);}
        const method=committed%2===0?'adoptMethodVersion':'disableMethodBinding';
        const input={bindingNamespace:project,package:config.binding.package,roleId:'measurement',readSet:[project],actionId:'asset-writer-'+config.scenario+'-'+committed,
          expectedRevision:committed||null,...(method==='adoptMethodVersion'?{version:config.binding.version}:{})};
        const value=ok(await retryStorageBusy(()=>{
          const startedAt=absoluteNow();try{return f.call(method,input);}
          finally{const finishedAt=absoluteNow();callTimes.push({startedAt,finishedAt,elapsedMs:finishedAt-startedAt});}
        },s,{...config,failOnBusy:true}));
        committed++;assert.equal(value.binding.revision,committed);
        if(callTimes.length-flushed>=8){appendTimings(config.writerCalls,callTimes.slice(flushed));flushed=callTimes.length;
          if(config.progress)publish(config.progress,{pid:process.pid,status:'running',committed,...timings(s)});}
      }
    }
  }catch(error){status='failed';reason=error.message;process.exitCode=1;}
  finally{appendTimings(kind==='reader'?config.readerPages:config.writerCalls,(kind==='reader'?pageTimes:callTimes).slice(flushed));
    finishedAt=absoluteNow();f.core.close();if(kind==='writer')publish(config.writerDone,{at:finishedAt});}
  const entered=existsSync(config.writerEntered)?JSON.parse(readFileSync(config.writerEntered,'utf8')):null;
  const done=existsSync(config.writerDone)?JSON.parse(readFileSync(config.writerDone,'utf8')):null;
  const duringOverlap=entered?overlapPageReport(pageTimes,{startedAt:entered.at,finishedAt:done?.at??finishedAt}):overlapPageReport([],{});
  const duringActiveWrites=overlapPageReport(pageTimes,readTimings(config.writerCalls));
  publish(config.result,{status,reason,pid:process.pid,startedAt,finishedAt,elapsedMs:finishedAt-startedAt,intervalMs:config.intervalMs??null,
    stressWriterMs:config.stressWriterMs??null,stopReason,deadlineAt:config.deadlineAt,
    maxBusyRetries:config.maxBusyRetries,passes,pages,committed,readCompleted:passes>=1,byteExact:passes>=1,
    maxPageMs:pageTimes.reduce((max,page)=>Math.max(max,page.elapsedMs),0),
    calls:callTimes.length,activeCallMs:callTimes.reduce((sum,call)=>sum+call.elapsedMs,0),pagesDuringWriter:duringOverlap.pages,duringOverlap,
    pagesDuringActiveWrites:duringActiveWrites.pages,duringActiveWrites,...timings(s)});
}else if(main) {
  const workspace=createTestWorkspace(null,{prefix:'asset-measurement-'}),bounds={...ASSET_MEASUREMENT_BOUNDS,stress:CONTENTION_STRESS_BOUNDS,deadlineAt:Date.now()+ASSET_MEASUREMENT_BOUNDS.overallMs},children={},observations={scenarios:{}};
  try {
    const path=join(workspace.path,'store.sqlite'),shared={path,deadlineAt:bounds.deadlineAt,...Object.fromEntries(['start','readerActive','readerPassDone','writerEntered','writerDone'].map(name=>[name,join(workspace.path,name)]))};
    function launch(name,options={},role=name) {
      const config={...shared,failOnBusy:true,ready:join(workspace.path,name+'.ready'),result:join(workspace.path,name+'.result'),progress:join(workspace.path,name+'.progress'),...options},file=join(workspace.path,name+'.json');writeFileSync(file,JSON.stringify(config));
      const stdout=join(workspace.path,name+'.stdout'),stderr=join(workspace.path,name+'.stderr'),out=openSync(stdout,'wx'),err=openSync(stderr,'wx'),env={...process.env};delete env.NODE_TEST_CONTEXT;
      let child;try{child=spawn(process.execPath,[fileURLToPath(import.meta.url),'--'+role,file],{env,stdio:['ignore',out,err]});}finally{closeSync(out);closeSync(err);}
      const state={child,config,exit:null,stderr};children[name]=state;
      state.closed=new Promise((resolve,reject)=>{child.once('error',reject);child.once('close',(code,signal)=>{state.exit={code,signal};resolve(state.exit);});});
      workspace.defer(async()=>{if(!state.exit)child.kill('SIGKILL');await state.closed;});return state;
    }
    async function complete(name) {
      const state=children[name];await state.closed;
      if(existsSync(state.config.result))observations[name]=JSON.parse(readFileSync(state.config.result,'utf8'));
      assert.deepEqual(state.exit,{code:0,signal:null},name+' exit '+JSON.stringify(observations[name])+' '+readFileSync(state.stderr,'utf8'));
      return state.exit;
    }
    launch('import');
    let timer;const deadline=new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error('K13 overall deadline')),Math.max(1,bounds.deadlineAt-Date.now()));});
    try {
      await Promise.race([complete('import'),deadline]);assertAssetImportGate(observations.import);
      launch('mixed-import');await Promise.race([complete('mixed-import'),deadline]);assertMixedAssetImportGate(observations['mixed-import']);
      const f=host(path);let targets;
      try{
        const hash=createHash('sha256');let bytes=0,pages=0;
        for(let i=0;i<2;i++) {
          let cursor;
          do{checkDeadline(bounds.deadlineAt);const page=ok(f.call('readMethodAttachmentBytes',{version:observations['mixed-import'].receipt.version,path:'maximum-'+i+'.pdf',intent:'history',...(cursor?{cursor}:{})}));
            const value=Buffer.from(page.bytes,'base64');hash.update(value);bytes+=value.length;pages++;assert.equal(page.totalByteCount,ASSET_LIMITS.versionBytes);
            assert.equal(page.complete,page.nextCursor===null);assert.ok(Buffer.byteLength(JSON.stringify({ok:true,value:page}))<=65536);cursor=page.nextCursor;
          }while(cursor);
        }
        assert.equal(bytes,67108864);assert.equal(pages,2048);assert.equal(hash.digest('hex'),observations['mixed-import'].sha256);
        observations.mixedVerification={bytes,pages,exactBytes:true,independentProcess:true};
        targets=Object.fromEntries(['paced','unpaced'].map(scenario=>[scenario,ok(f.call('importMethodVersion',{namespace:project,actionId:'binding-target-'+scenario,title:'Synthetic writer',files:[{path:'SKILL.md',text:'Synthetic binding writer',mediaType:'text/plain'}]}))]));
      }finally{f.core.close();}
      for(const scenario of ['paced','unpaced']) {
        const markers={scenario,stressWriterMs:bounds.stress.writerMs,...Object.fromEntries(['start','stop','readerActive','readerPassDone','writerEntered','writerDone','readerPages','writerCalls'].map(name=>[name,join(workspace.path,scenario+'-'+name)]))};
        const readerName=scenario+'-reader',writerName=scenario+'-writer';
        const reader=launch(readerName,{...markers,...(scenario==='unpaced'?stressReaderOptions(bounds.deadlineAt):{}),
          receipt:observations.import.receipt,sha256:observations.import.sha256,baseline:join(workspace.path,scenario+'-baseline.result')},'reader');
        const alive=()=>{for(const name of [readerName,writerName])if(children[name]?.exit&&
          (children[name].exit.code!==0||children[name].exit.signal!==null||!existsSync(name===readerName?markers.readerPassDone:markers.writerDone)))
          throw Error(name+' exited before completion '+readFileSync(children[name].stderr,'utf8'));};
        await until(()=>{alive();return existsSync(reader.config.ready);},bounds.deadlineAt);
        const baseline=JSON.parse(readFileSync(reader.config.baseline,'utf8'));assert.equal(baseline.storageBusy,0);
        const writer=launch(writerName,{...markers,binding:targets[scenario],intervalMs:scenario==='paced'?assetWriterInterval(baseline.elapsedMs):0},'writer');
        await until(()=>{alive();return existsSync(writer.config.ready);},bounds.deadlineAt);writeFileSync(markers.start,'go');
        const completed=Promise.all([readerName,writerName].map(async name=>[name===readerName?'reader':'writer',await complete(name)]));
        const workload=async()=>{const supervise=scenario==='paced'?waitForActiveOverlap:waitForStressObservation;
          const [,result]=await Promise.all([supervise({...markers,deadlineAt:bounds.deadlineAt},alive),completed]);return Object.fromEntries(result);};
        const exits=await Promise.race([workload(),deadline]);
        const report={scenario,kind:scenario==='paced'?'gate':'stress-observation',baseline,reader:observations[readerName],writer:observations[writerName],exits};
        observations.scenarios[scenario]=report;(scenario==='paced'?assertMethodGate:assertStressObservation)(report);delete observations[readerName];delete observations[writerName];
      }
      const db=new DatabaseSync(path);try{assert.equal(db.prepare('SELECT count(*) n FROM method_binding_events').get().n,Object.values(observations.scenarios).reduce((sum,report)=>sum+report.writer.committed,0));
        for(const scenario of ['paced','unpaced'])assert.equal(db.prepare('SELECT revision FROM method_bindings WHERE package_id=?').get(targets[scenario].package.packageId)?.revision??0,observations.scenarios[scenario].writer.committed);
        assert.equal(db.prepare('SELECT byte_count FROM binary_owner_usage').get().byte_count,ASSET_LIMITS.versionBytes+67108864);assert.deepEqual(db.prepare('PRAGMA foreign_key_check').all(),[]);}finally{db.close();}
      console.log(JSON.stringify({status:'complete',node:process.version,bounds,...observations,...observations.scenarios.paced,
        exits:{...observations.scenarios.paced.exits,...Object.fromEntries(Object.entries(children).map(([name,state])=>[name,state.exit]))},
        methodology:'one 32-MiB standalone and one 64-MiB mixed import with 256 entries and 4,000,000 text units in separate fresh processes; caller allocation and pre-core-call RSS baseline include caller bytes and text; process high-water RSS includes synchronous preparation; every input MAC precedes callbacks/BEGIN IMMEDIATE; independent complete mixed-byte verification; paced gate: continuous maximum-byte reader and independent binding writer, baseline elapsedMs / 10 pauses, >=100 commits, complete read, >=200 distinct pages overlapping actual writer calls (excluding sleeps/reporting), zero busy, writer p95 <=250 ms, both exits checked; unpaced stress observation: no writer delay, writer stops on reader completion or after 10 seconds (plus an in-flight bounded SQLite call), same page/cursor retried with 10–250 ms bounded backoff within shared deadline; report pages, busy counts/waits, maximum page latency and eventual exact-byte completion; only corruption, byte mismatch, writer errors or deadline breaches fail stress; reader whole-run, lifetime-overlap and active-overlap latencies observational'},null,2));
    }finally{clearTimeout(timer);}
  }catch(error){
    process.exitCode=1;for(const child of Object.values(children))if(!child.exit)child.child.kill('SIGKILL');await Promise.allSettled(Object.values(children).map(child=>child.closed));
    for(const [name,state]of Object.entries(children)){
      const report=existsSync(state.config.result)?state.config.result:state.config.progress;
      if(existsSync(report))observations[name]=JSON.parse(readFileSync(report,'utf8'));
    }
    console.error(JSON.stringify({status:'failed',node:process.version,reason:error.message,bounds,...observations,exits:Object.fromEntries(Object.entries(children).map(([name,state])=>[name,state.exit]))},null,2));
  }finally{await workspace.cleanup();}
}

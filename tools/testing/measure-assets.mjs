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
import { overlapPageReport,assertMethodGate } from './measure-method-packages.mjs';

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
const percentile=(values,p)=>[...values].sort((a,b)=>a-b)[Math.min(values.length-1,Math.floor(values.length*p))]??0;
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
export function assertAssetImportGate(report) {
  assert.equal(report.status,'complete');assert.equal(report.bytes,ASSET_LIMITS.versionBytes);
  assert.equal(report.writeTransactions,1);assert.equal(report.allMACsBeforeCallbacksAndLock,true);
  assert.ok(report.transactionMs<=ASSET_MEASUREMENT_BOUNDS.importTransactionMs,'32-MiB import transaction exceeds 2000 ms');
  assert.ok(report.rssGrowthBytes<=ASSET_MEASUREMENT_BOUNDS.rssGrowthBytes,'RSS growth exceeds 128 MiB from pre-core-call baseline');
}
function stats(){return {storageBusy:0,times:[]};}
function measured(f,method,input,s,deadlineAt){
  checkDeadline(deadlineAt);const at=performance.now(),result=f.call(method,input);s.times.push(performance.now()-at);
  if(result.error?.code==='storage_busy')s.storageBusy++;
  return ok(result);
}
const timings=s=>({storageBusy:s.storageBusy,p50Ms:percentile(s.times,.5),p95Ms:percentile(s.times,.95),maxMs:s.times.reduce((max,t)=>Math.max(max,t),0)});
async function pass(f,config,s,observe) {
  const hash=createHash('sha256'),started=performance.now();let cursor,total=0,pages=0;
  do {
    const startedAt=absoluteNow(),page=measured(f,'readAssetBytes',{version:config.receipt.version,...(cursor?{cursor}:{})},s,config.deadlineAt),finishedAt=absoluteNow();
    const bytes=Buffer.from(page.bytes,'base64');hash.update(bytes);total+=bytes.length;pages++;
    assert.equal(page.totalByteCount,ASSET_LIMITS.versionBytes);assert.equal(page.index,pages-1);
    assert.equal(page.complete,page.nextCursor===null);assert.ok(Buffer.byteLength(JSON.stringify({ok:true,value:page}))<=65536);
    observe?.({startedAt,finishedAt,elapsedMs:finishedAt-startedAt});cursor=page.nextCursor;
  }while(cursor);
  assert.equal(total,ASSET_LIMITS.versionBytes);assert.equal(hash.digest('hex'),config.sha256);
  return {complete:true,pages,bytes:total,elapsedMs:performance.now()-started,...timings(s)};
}
const main=process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url);
if(main&&process.argv[2]==='--import') {
  const config=JSON.parse(readFileSync(process.argv[3],'utf8'));let preparationPeakRSS=0,phase='setup',hmacCalls=0,writeTransactions=0,started,transactionMs;
  const f=host(config.path,()=>{preparationPeakRSS=peakRSS();assert.equal(phase,'prepare');phase='authorized';});
  const beforeCallerRSS=process.memoryUsage().rss,bytes=Buffer.alloc(ASSET_LIMITS.versionBytes,0x61);bytes.set(Buffer.from('%PDF-1.7'));
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
    phase='prepare';const receipt=ok(f.call('importAssetVersion',{namespace:ns,actionId:'maximum-asset',title:'Synthetic maximum asset',filename:'maximum.pdf',mediaType:'application/pdf',bytes}));
    const processPeakRSS=peakRSS();report={status:'complete',pid:process.pid,node:process.version,bytes:bytes.length,callerAllocationBytes:bytes.length,beforeCallerRSS,afterCallerRSS,
      preCoreCallRSS,preparationPeakRSS,processPeakRSS,rssGrowthBytes:Math.max(0,processPeakRSS-preCoreCallRSS),hmacCalls,allMACsBeforeCallbacksAndLock:phase==='committed'&&hmacCalls===1026,
      writeTransactions,transactionMs,receipt,sha256};assertAssetImportGate(report);
  }catch(error){report={...report,status:'failed',reason:error.message};process.exitCode=1;}
  finally{crypto.createHmac=originalHmac;syncBuiltinESMExports();DatabaseSync.prototype.exec=originalExec;f.core.close();}
  publish(config.result,report);
}else if(main&&['--reader','--writer'].includes(process.argv[2])) {
  const kind=process.argv[2].slice(2),config=JSON.parse(readFileSync(process.argv[3],'utf8')),f=host(config.path),s=stats(),pageTimes=[];
  let status='complete',reason=null,passes=0,pages=0,committed=0,startedAt,finishedAt;
  try {
    if(kind==='reader')publish(config.baseline,await pass(f,config,stats()));
    writeFileSync(config.ready,String(process.pid));await until(()=>existsSync(config.start),config.deadlineAt);
    if(kind==='writer')await until(()=>existsSync(config.readerActive),config.deadlineAt);
    startedAt=absoluteNow();
    if(kind==='reader') {
      do {
        await pass(f,config,s,timing=>{pageTimes.push(timing);pages++;if(pages===1)writeFileSync(config.readerActive,String(process.pid));
          if(pages%500===0)console.error(JSON.stringify({kind,pages,passes}));});
        passes++;if(passes===1)publish(config.readerPassDone,{at:absoluteNow()});
      }while(!existsSync(config.writerDone));
    } else {
      publish(config.writerEntered,{at:startedAt});
      while(committed<100||!existsSync(config.readerPassDone)) {
        if(committed>0){checkDeadline(config.deadlineAt);await delay(config.intervalMs);}
        const method=committed%2===0?'adoptMethodVersion':'disableMethodBinding';
        const value=measured(f,method,{bindingNamespace:project,package:config.binding.package,roleId:'measurement',readSet:[project],actionId:'asset-writer-'+committed,
          expectedRevision:committed||null,...(method==='adoptMethodVersion'?{version:config.binding.version}:{})},s,config.deadlineAt);
        committed++;assert.equal(value.binding.revision,committed);
      }
    }
  }catch(error){status='failed';reason=error.message;process.exitCode=1;}
  finally{finishedAt=absoluteNow();f.core.close();if(kind==='writer')publish(config.writerDone,{at:finishedAt});}
  const entered=existsSync(config.writerEntered)?JSON.parse(readFileSync(config.writerEntered,'utf8')):null;
  const done=existsSync(config.writerDone)?JSON.parse(readFileSync(config.writerDone,'utf8')):null;
  const duringOverlap=entered?overlapPageReport(pageTimes,{startedAt:entered.at,finishedAt:done?.at??finishedAt}):overlapPageReport([],{});
  publish(config.result,{status,reason,pid:process.pid,startedAt,finishedAt,elapsedMs:finishedAt-startedAt,intervalMs:config.intervalMs??null,passes,pages,committed,pagesDuringWriter:duringOverlap.pages,duringOverlap,...timings(s)});
}else if(main) {
  const workspace=createTestWorkspace(null,{prefix:'asset-measurement-'}),bounds={...ASSET_MEASUREMENT_BOUNDS,deadlineAt:Date.now()+ASSET_MEASUREMENT_BOUNDS.overallMs},children={},observations={};
  try {
    const path=join(workspace.path,'store.sqlite'),shared={path,deadlineAt:bounds.deadlineAt,...Object.fromEntries(['start','readerActive','readerPassDone','writerEntered','writerDone'].map(name=>[name,join(workspace.path,name)]))};
    function launch(name,options={}) {
      const config={...shared,ready:join(workspace.path,name+'.ready'),result:join(workspace.path,name+'.result'),...options},file=join(workspace.path,name+'.json');writeFileSync(file,JSON.stringify(config));
      const stdout=join(workspace.path,name+'.stdout'),stderr=join(workspace.path,name+'.stderr'),out=openSync(stdout,'wx'),err=openSync(stderr,'wx'),env={...process.env};delete env.NODE_TEST_CONTEXT;
      let child;try{child=spawn(process.execPath,[fileURLToPath(import.meta.url),'--'+name,file],{env,stdio:['ignore',out,err]});}finally{closeSync(out);closeSync(err);}
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
      const f=host(path);let binding;
      try{binding=ok(f.call('importMethodVersion',{namespace:project,actionId:'binding-target',title:'Synthetic writer',files:[{path:'SKILL.md',text:'Synthetic binding writer',mediaType:'text/plain'}]}));}finally{f.core.close();}
      const reader=launch('reader',{receipt:observations.import.receipt,sha256:observations.import.sha256,baseline:join(workspace.path,'baseline.result')});
      const alive=()=>{for(const name of ['reader','writer'])if(children[name]?.exit)throw Error(name+' exited before barrier '+readFileSync(children[name].stderr,'utf8'));};
      await until(()=>{alive();return existsSync(reader.config.ready);},bounds.deadlineAt);
      const baseline=observations.baseline=JSON.parse(readFileSync(reader.config.baseline,'utf8'));assert.equal(baseline.storageBusy,0);
      launch('writer',{binding,intervalMs:assetWriterInterval(baseline.elapsedMs)});
      await until(()=>{alive();return existsSync(children.writer.config.ready);},bounds.deadlineAt);writeFileSync(shared.start,'go');
      const exits=Object.fromEntries(await Promise.race([Promise.all(['reader','writer'].map(async name=>[name,await complete(name)])),deadline]));
      assertMethodGate({...observations,exits});
      const db=new DatabaseSync(path);try{assert.equal(db.prepare('SELECT count(*) n FROM method_binding_events').get().n,observations.writer.committed);
        assert.equal(db.prepare('SELECT byte_count FROM binary_owner_usage').get().byte_count,ASSET_LIMITS.versionBytes);assert.deepEqual(db.prepare('PRAGMA foreign_key_check').all(),[]);}finally{db.close();}
      console.log(JSON.stringify({status:'complete',node:process.version,bounds,...observations,exits:{import:children.import.exit,...exits},
        methodology:'one 32-MiB standalone import; caller allocation and pre-core-call RSS baseline include caller bytes; process high-water RSS includes synchronous preparation; every MAC precedes callbacks/BEGIN IMMEDIATE; independent continuous maximum-byte reader; writer fixed pause = baseline byte-read elapsedMs / 10, spreading at least 100 transitions across ten baseline passes; reader overlap p95/max observational; gates zero busy, >=100 commits, >=200 overlap pages, writer p95 <=250 ms'},null,2));
    }finally{clearTimeout(timer);}
  }catch(error){
    process.exitCode=1;for(const child of Object.values(children))if(!child.exit)child.child.kill('SIGKILL');await Promise.allSettled(Object.values(children).map(child=>child.closed));
    for(const [name,state]of Object.entries(children))if(existsSync(state.config.result))observations[name]=JSON.parse(readFileSync(state.config.result,'utf8'));
    console.error(JSON.stringify({status:'failed',node:process.version,reason:error.message,bounds,...observations,exits:Object.fromEntries(Object.entries(children).map(([name,state])=>[name,state.exit]))},null,2));
  }finally{await workspace.cleanup();}
}

import assert from 'node:assert/strict';
import test from 'node:test';
import {join} from 'node:path';
import {DatabaseSync} from 'node:sqlite';
import {spawnSync} from 'node:child_process';
import {openSync,closeSync,writeFileSync,readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {privateFailure} from '../../core/private-card-facade.mjs';
import {createTestWorkspace} from './workspace.mjs';
import {retryStorageBusy,contentionStats,contentionReport} from './measure-method-packages.mjs';

for(const operation of ['reader-page','writer-operation'])test(`measurement retries the identical ${operation} after real SQLite busy waits`,async t=>{
  const workspace=createTestWorkspace(t),path=join(workspace.path,'busy.sqlite');
  const db=new DatabaseSync(path,{timeout:2}),locker=new DatabaseSync(path);
  workspace.defer(()=>db.close());workspace.defer(()=>locker.close());
  db.exec('CREATE TABLE sample(n INTEGER); INSERT INTO sample VALUES(0)');
  locker.exec('BEGIN IMMEDIATE');
  const input=Object.freeze({cursor:'same-page-cursor',actionId:'same-writer-action'}),seen=[],stats=contentionStats();
  const attempt=payload=>{
    seen.push(payload);
    if(seen.length===3)locker.exec('ROLLBACK');
    try{
      db.exec('BEGIN IMMEDIATE');
      if(operation==='writer-operation')db.exec('UPDATE sample SET n=n+1');
      const value=db.prepare('SELECT n FROM sample').get().n;db.exec('COMMIT');
      return {ok:true,value};
    }catch(error){return privateFailure(error);}
  };
  const result=await retryStorageBusy(()=>attempt(input),stats),report=contentionReport(stats);
  assert.equal(result.ok,true);assert.equal(result.value,operation==='writer-operation'?1:0);
  assert.equal(seen.length,3);assert.ok(seen.every(value=>value===input));
  assert.equal(report.attempts,3);assert.equal(report.storageBusy,2);
  assert.ok(report.busyWaitMs>0);assert.ok(report.busyMaxMs>0);assert.ok(report.retryDelayMs>0);
  assert.equal(db.prepare('SELECT count(*) n FROM sample').get().n,1);
});

test('measurement refuses non-retryable failures instead of counting them as contention',async()=>{
  for(const error of [{code:'invalid_input',retryable:false},{code:'storage_busy',retryable:false}]){
    const stats=contentionStats();
    await assert.rejects(retryStorageBusy(()=>({ok:false,error}),stats));
    assert.equal(stats.attempts,1);assert.equal(stats.storageBusy,0);
  }
});

test('measurement caps busy retries per operation and reports the bound',async()=>{
  const stats=contentionStats(),deadlineAt=Date.now()+10000;
  await assert.rejects(retryStorageBusy(()=>({ok:false,error:{code:'storage_busy',retryable:true}}),stats,{deadlineAt,maxBusyRetries:2}),error=>error.reason==='operation-retry-limit');
  assert.equal(stats.attempts,3);assert.equal(stats.storageBusy,3);
});

test('measurement overall deadline prevents another SQLite attempt',async()=>{
  const stats=contentionStats();let invoked=false;
  await assert.rejects(retryStorageBusy(()=>{invoked=true;return {ok:true};},stats,{deadlineAt:Date.now()-1,maxBusyRetries:2}),error=>error.reason==='run-deadline');
  assert.equal(invoked,false);assert.equal(stats.attempts,0);
  assert.deepEqual(contentionReport(stats),{attempts:0,storageBusy:0,busyWaitMs:0,busyP50Ms:0,busyP95Ms:0,busyMaxMs:0,retryDelayMs:0,p50Ms:0,p95Ms:0,maxMs:0});
});

test('measurement writer reports an expired overall deadline as observational incomplete data with exit zero',t=>{
  const workspace=createTestWorkspace(t),path=join(workspace.path,'store.sqlite');
  closeSync(openSync(path,'wx',0o600));
  // The normal measurement host initializes its own synthetic store. No fixture
  // injection changes its call/retry logic; the shared deadline is already past.
  const config={path,receipt:{},deadlineAt:Date.now()-1,maxBusyRetries:2,
    ...Object.fromEntries(['ready','start','entered','stop','result'].map(name=>[name,join(workspace.path,name)]))};
  const configPath=join(workspace.path,'writer.json');writeFileSync(configPath,JSON.stringify(config));writeFileSync(config.start,'start');
  const stdout=join(workspace.path,'writer.stdout'),stderr=join(workspace.path,'writer.stderr'),out=openSync(stdout,'wx'),err=openSync(stderr,'wx');let child;
  const env={...process.env};delete env.NODE_TEST_CONTEXT;
  try{child=spawnSync(process.execPath,[fileURLToPath(new URL('./measure-method-packages.mjs',import.meta.url)),'--writer',configPath],{env,timeout:15000,stdio:['ignore',out,err]});}
  finally{closeSync(out);closeSync(err);}
  assert.equal(child.error,undefined);assert.equal(child.status,0,readFileSync(stderr,'utf8'));
  const reported=JSON.parse(readFileSync(config.result,'utf8'));
  assert.equal(reported.status,'incomplete');assert.equal(reported.reason,'run-deadline');
  assert.equal(reported.deadlineAt,config.deadlineAt);assert.equal(reported.maxBusyRetries,2);
  assert.equal(reported.attempts,0);assert.equal(reported.committed,0);
});

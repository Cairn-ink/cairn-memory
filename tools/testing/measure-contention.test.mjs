import test from 'node:test';
import assert from 'node:assert/strict';
import { appendFileSync,existsSync,writeFileSync,readFileSync } from 'node:fs';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { privateFailure } from '../../core/private-card-facade.mjs';
import { createTestWorkspace } from './workspace.mjs';
import { appendTimings,readTimings,overlapPageReport,waitForActiveOverlap,CONTENTION_STRESS_BOUNDS,
  stressReaderOptions,stressWriterStopReason,waitForStressObservation,assertStressObservation } from './measure-contention.mjs';
import { assertMethodGate,retryStorageBusy,contentionStats,contentionReport } from './measure-method-packages.mjs';

const calls=Array.from({length:100},(_,i)=>({startedAt:i*100,finishedAt:i*100+1,elapsedMs:1}));
const sleepingPages=Array.from({length:200},(_,i)=>({startedAt:10+i/10,finishedAt:10+i/10+.01,elapsedMs:.01}));
const activePages=calls.flatMap(call=>[.1,.5].map(offset=>({startedAt:call.startedAt+offset,finishedAt:call.startedAt+offset+.1,elapsedMs:.1})));
test('K13/C04 pages entirely inside writer sleeps cannot satisfy the active-call overlap gate',()=>{
  const lifetime=overlapPageReport(sleepingPages,{startedAt:0,finishedAt:10000}),active=overlapPageReport(sleepingPages,calls);
  assert.equal(lifetime.pages,200);assert.equal(active.pages,0);
  const report={reader:{pid:1,status:'complete',storageBusy:0,passes:1,pagesDuringWriter:lifetime.pages,pagesDuringActiveWrites:active.pages},
    writer:{pid:2,status:'complete',storageBusy:0,committed:100,p95Ms:1},exits:{reader:{code:0,signal:null},writer:{code:0,signal:null}}};
  assert.throws(()=>assertMethodGate(report),/actual writer calls/);
  assertMethodGate({...report,reader:{...report.reader,pagesDuringActiveWrites:overlapPageReport(activePages,calls).pages}});
});
test('K13/C04 active overlap counts a reader page once even if it spans multiple calls',()=>{
  const pages=[{startedAt:0,finishedAt:250,elapsedMs:250},...activePages];
  assert.equal(overlapPageReport(pages,calls).pages,201);
  assert.equal(overlapPageReport(pages,calls).maxMs,250);
  assert.deepEqual(overlapPageReport([],[...calls]),{pages:0,p50Ms:0,p95Ms:0,maxMs:0});
  assert.equal(overlapPageReport([{startedAt:1,finishedAt:2,elapsedMs:1}], [{startedAt:0,finishedAt:1}]).pages,0,'touching endpoints are not active overlap');
  assert.equal(overlapPageReport([{startedAt:1,finishedAt:1,elapsedMs:0}], [{startedAt:0,finishedAt:2}]).pages,0,'zero-duration pages cannot establish contention');
  assert.equal(overlapPageReport([{startedAt:0,finishedAt:2,elapsedMs:2}], [{startedAt:1,finishedAt:1}]).pages,0,'zero-duration writer calls cannot establish contention');
});
test('K13/C04 live timing logs consume only complete records',t=>{
  const w=createTestWorkspace(t),file=join(w.path,'timings');
  appendTimings(file,calls.slice(0,2));appendFileSync(file,'{"startedAt":');
  assert.deepEqual(readTimings(file),calls.slice(0,2));
});
test('K13/C04 supervisor keeps the writer running during sleep-only overlap, then stops after actual-call overlap',async t=>{
  const w=createTestWorkspace(t),config={deadlineAt:Date.now()+5000,...Object.fromEntries(['readerPages','writerCalls','readerPassDone','stop'].map(name=>[name,join(w.path,name)]))};
  appendTimings(config.writerCalls,calls);appendTimings(config.readerPages,sleepingPages);writeFileSync(config.readerPassDone,'complete');
  let checks=0;
  await waitForActiveOverlap(config,()=>{checks++;assert.equal(existsSync(config.stop),false);
    if(checks===2)appendTimings(config.readerPages,activePages);
  });
  assert.equal(checks,2);assert.equal(existsSync(config.stop),true);
});
test('K13/C04 active-overlap supervision has a finite deadline',async t=>{
  const w=createTestWorkspace(t),config={deadlineAt:Date.now()-1,...Object.fromEntries(['readerPages','writerCalls','readerPassDone','stop'].map(name=>[name,join(w.path,name)]))};
  await assert.rejects(waitForActiveOverlap(config,()=>{}),/deadline/);assert.equal(existsSync(config.stop),false);
});
test('C04 gate records and immediately refuses busy rather than retrying a doomed measurement',async()=>{
  const stats=contentionStats();
  await assert.rejects(retryStorageBusy(()=>({ok:false,error:{code:'storage_busy',retryable:true}}),stats,{failOnBusy:true}),error=>error.reason==='busy-gate');
  assert.equal(stats.storageBusy,1);assert.equal(stats.attempts,1);
});

test('§16 stress has no latency/overlap/transition gate, but requires exact completion and successful independent exits',()=>{
  const report={reader:{pid:1,status:'complete',passes:1,pages:1,readCompleted:true,byteExact:true,
    storageBusy:3,busyWaitMs:15000,maxPageMs:16000,pagesDuringWriter:1,pagesDuringActiveWrites:0},
    writer:{pid:2,status:'complete',storageBusy:0,committed:1,p95Ms:1000},
    exits:{reader:{code:0,signal:null},writer:{code:0,signal:null}}};
  assertStressObservation(report);assert.throws(()=>assertMethodGate(report));
  for(const [side,patch] of [['reader',{status:'failed'}],['reader',{passes:0}],['reader',{readCompleted:false}],
    ['reader',{byteExact:false}],['writer',{status:'failed'}],['writer',{storageBusy:1}],['writer',{pid:1}]])
    assert.throws(()=>assertStressObservation({...report,[side]:{...report[side],...patch}}));
  for(const side of ['reader','writer'])for(const exit of [{code:1,signal:null},{code:null,signal:'SIGKILL'}])
    assert.throws(()=>assertStressObservation({...report,exits:{...report.exits,[side]:exit}}));
});
test('§16 stress writer stops on exact reader completion or its own duration, without overlap prerequisites',async t=>{
  const w=createTestWorkspace(t),config={deadlineAt:Date.now()+5000,stressWriterMs:CONTENTION_STRESS_BOUNDS.writerMs,
    ...Object.fromEntries(['writerEntered','readerPassDone','stop'].map(name=>[name,join(w.path,name)]))};
  assert.equal(stressWriterStopReason(config,100,101),null);
  assert.equal(stressWriterStopReason(config,100,100+config.stressWriterMs),'writer-duration');
  writeFileSync(config.writerEntered,JSON.stringify({at:Date.now()-config.stressWriterMs}));
  assert.equal(await waitForStressObservation(config,()=>{}),'writer-duration');
  assert.equal(readFileSync(config.stop,'utf8'),'writer-duration');
  const completed={...config,stop:join(w.path,'reader-stop')};writeFileSync(config.readerPassDone,'exact bytes');
  assert.equal(await waitForStressObservation(completed,()=>{}),'reader-complete');
  assert.equal(readFileSync(completed.stop,'utf8'),'reader-complete');
});
test('§16 stress supervision refuses failed children and expired overall deadlines',async t=>{
  const w=createTestWorkspace(t),config={deadlineAt:Date.now()+5000,stressWriterMs:10,
    ...Object.fromEntries(['writerEntered','readerPassDone','stop'].map(name=>[name,join(w.path,name)]))};
  await assert.rejects(waitForStressObservation(config,()=>{throw Error('writer failed');}),/writer failed/);
  await assert.rejects(waitForStressObservation({...config,deadlineAt:Date.now()-1},()=>{}),/deadline/);
  assert.equal(existsSync(config.stop),false);
});
test('§16 stress retries a real locked SQLite read with the identical page/cursor and records waits before byte-exact completion',async t=>{
  const w=createTestWorkspace(t),path=join(w.path,'locked.sqlite'),db=new DatabaseSync(path,{timeout:2}),locker=new DatabaseSync(path,{timeout:2});
  w.defer(()=>db.close());w.defer(()=>locker.close());
  const expected=Buffer.from([0,1,2,255]);db.exec('CREATE TABLE page(bytes BLOB)');db.prepare('INSERT INTO page VALUES(?)').run(expected);
  locker.exec('BEGIN EXCLUSIVE');
  const input=Object.freeze({cursor:'unchanged-cursor'}),seen=[],stats=contentionStats(),options=stressReaderOptions(Date.now()+5000);
  assert.equal(options.failOnBusy,false);assert.equal(options.retryBackoffMs,10);assert.equal(options.maxRetryBackoffMs,250);
  const read=page=>{
    seen.push(page);if(seen.length===3)locker.exec('ROLLBACK');
    try{return {ok:true,value:db.prepare('SELECT bytes FROM page').get().bytes};}catch(error){return privateFailure(error);}
  };
  const result=await retryStorageBusy(()=>read(input),stats,options),report=contentionReport(stats);
  assert.deepEqual(Buffer.from(result.value),expected);assert.equal(seen.length,3);assert.ok(seen.every(page=>page===input));
  assert.equal(report.storageBusy,2);assert.equal(report.attempts,3);
  assert.ok(report.busyWaitMs>0);assert.ok(report.retryDelayMs>0);
});
test('§16 a continuously busy stress reader ends at the overall deadline with bounded backoff',async()=>{
  const stats=contentionStats(),options=stressReaderOptions(Date.now()+100);
  await assert.rejects(retryStorageBusy(()=>({ok:false,error:{code:'storage_busy',retryable:true}}),stats,options),
    error=>error.reason==='run-deadline');
  assert.ok(stats.storageBusy>=1);assert.ok(stats.attempts<=options.maxBusyRetries+1);
});
test('§16 stress never retries corruption, byte errors or nonretryable busy outcomes',async()=>{
  for(const error of [{code:'storage_corrupt',retryable:false},{code:'invalid_input',retryable:false},{code:'storage_busy',retryable:false}]) {
    const stats=contentionStats();await assert.rejects(retryStorageBusy(()=>({ok:false,error}),stats,stressReaderOptions(Date.now()+5000)));
    assert.equal(stats.attempts,1);assert.equal(stats.storageBusy,0);
  }
});

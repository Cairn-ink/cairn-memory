import { testClock } from '../testing/context-product-test-clock.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { setTimeout as watchdog } from 'node:timers/promises';
import { fixture, ns } from '../testing/context-read-fixture.mjs';
import { configured } from '../testing/context-product-owner-fixture.mjs';
import { DatabaseSync } from 'node:sqlite';
import { local, inspect, snapshot } from '../testing/context-product-verification-fixture.mjs';
import { createProductReaderRuntime, maintenancePhaseDiagnostic, maintenanceFailureDiagnostic, maintenanceReaderFailureDiagnostic } from '../context-product-reader.mjs';
import { createMaintenancePumpRuntime } from '../context-product-pump.mjs';
import * as diagnostics from '../context-product-attribution.mjs';

test('passing control: gated native verification cutoff stays terminal with the full reservation',async t=>{
  const f=fixture(t);for(let i=0;i<12;i++)f.admit('native verification cutoff '+i);
  const warm=local(f.path);try{warm.prepare();}finally{warm.close();}
  const service=configured(t,f.path,[ns],{service:true}),control=new Int32Array(new SharedArrayBuffer(32));control[0]=1;
  const options={...service.options,host:{...service.options.host,
    moduleUrl:new URL('../testing/context-product-cutoff-host.mjs',import.meta.url).href,
    configuration:{...service.options.host.configuration,cutoffBarrier:control.buffer,cutoffPayload:new SharedArrayBuffer(192*1024),cutoffPhase:'verification',cutoffPoint:'before'}}};
  const timers=new Map(),setTimer=(fn,ms)=>{const id={unref(){}};timers.set(id,{fn,at:testClock.now()+ms});return id;},clearTimer=id=>timers.delete(id);
  let gates=0;const open=createProductReaderRuntime({maintenance:true,setTimer,clearTimer,verificationQualified:()=>{gates++;return true;}});
  const renew=createMaintenancePumpRuntime({now:testClock.now,setTimer,clearTimer,open});
  const p=renew({supervisor:service.supervisor,id:'verification-cutoff',window:{id:'window',endsAtMonoMs:testClock.now()+60000,usedItems:0,usedMs:0},
    budgets:{maxItems:2048,maxMs:10000},quantum:{maxItems:1024,maxMs:1000},pollMs:1000,renewalMs:60000,
    serviceCredential:service.token,projections:[{options,types:['memory']}]});
  f.workspace.defer(async()=>{Atomics.store(control,2,1);Atomics.notify(control,2);await p.close().catch(()=>{});await service.supervisor.close();});
  const abort=new AbortController();
  try {await Promise.race([(async()=>{
    const [id,timer]=[...timers].sort((a,b)=>a[1].at-b[1].at)[0];timers.delete(id);
    if(timer.at>testClock.now())await testClock.advance(Math.ceil(timer.at-testClock.now()));
    const operation=Promise.resolve(timer.fn());
    await Promise.resolve(Atomics.waitAsync(control,1,0).value);
    assert.equal(control[1],1,'real signed verification reaches COMMIT');
    assert.equal(gates>0,typeof diagnostics.verificationBatchingQualified==='function','final runtime uses its internal gate; base is an unbatched control');
    const fire=()=>{for(const [key,value]of [...timers])if(value.at<=testClock.now()){timers.delete(key);value.fn();}};
    await testClock.advance(1000,{waitForWorkers:false});fire();for(let i=0;i<30;i++)await Promise.resolve();
    await testClock.advance(10000,{waitForWorkers:false});fire();await operation;
    const result=await p.completion;assert.equal(result.error,'read_timeout');assert.equal(result.state,'failed');
    assert.equal(result.usedItems,1024);assert.equal(result.usedMs,1000,'uncertain work keeps the entire admitted allowance');
    assert.ok((await service.supervisor.drain()).every(value=>value.state==='complete'));
  })(),watchdog(30000,undefined,{signal:abort.signal}).then(()=>assert.fail('verification cutoff watchdog'))]);}finally{abort.abort();}
});

async function realWatchdog(work) {
  const abort=new AbortController();
  try{return await Promise.race([work(),watchdog(60000,undefined,{signal:abort.signal}).then(()=>{throw Error('verification Worker watchdog');})]);}finally{abort.abort();}
}

test('Worker gate and fixed private commit transport; shortage cap survives reopening',async t=>realWatchdog(async()=>{
  const f=fixture(t);for(let i=0;i<2;i++)f.admit('worker batch orchard '+i);
  const db=new DatabaseSync(f.path);try{db.prepare('UPDATE memories SET content=?,revision=revision+1 WHERE id=(SELECT min(id) FROM memories)').run('x'.repeat(120000));db.exec('UPDATE namespace_epochs SET epoch=epoch+1');}finally{db.close();}
  const service=configured(t,f.path,[ns],{service:true}),open=createProductReaderRuntime({maintenance:true,verificationQualified:()=>true});
  const pauses=new SharedArrayBuffer(4),options={...service.options,host:{...service.options.host,moduleUrl:new URL('../testing/context-product-verification-fault-host.mjs',import.meta.url).href,configuration:{...service.options.host.configuration,verificationStartupPause:pauses}}};
  let h=await open(options);f.workspace.defer(()=>h.close());let result;
  for(let i=0;i<20;i++){result=await h.refreshContextIndex({readSet:[ns],types:['memory'],intent:'current',mode:'lexical',budget:{maxItems:1024,maxMs:5000}},service.token);assert.equal(result.ok,true);if(result.value.status==='complete')break;}
  assert.equal(result.value.status,'complete');
  assert.ok(maintenancePhaseDiagnostic(result).verificationCommits>0,'Worker carries per-kind private commit counters');
  assert.equal(Object.hasOwn(result.value,'verificationCommits'),false);
  const state=diagnostics.verificationBatchControl(service.supervisor);assert.equal(new Int32Array(state)[0],0,'live calibration stays call-local');assert.ok(new Int32Array(state)[1]>0,'Worker executed gated length preflight');
  new Int32Array(state)[0]=-1;await h.close();h=await open(options);
  assert.equal(diagnostics.verificationBatchControl(service.supervisor),state);assert.equal(new Int32Array(state)[0],-1);
  assert.equal(new Int32Array(pauses)[0],2,'both real Worker startups completed the controlled pause');
}));

for(const mode of ['DELETE','WAL'])for(const coded of [false,true])test(`verification Worker preserves ${coded?'coded ':''}primary and rollback causes ${mode}`,async t=>realWatchdog(async()=>{
  const f=fixture(t);for(let i=0;i<40;i++)f.admit('verification failure evidence '+i);
  const warm=local(f.path,{mode});try{warm.prepare();}finally{warm.close();}
  const before=inspect(f.path,snapshot),service=configured(t,f.path,[ns],{service:true}),faults=new Int32Array(new SharedArrayBuffer(32));
  const options={...service.options,...(mode==='WAL'?{wal:true}:{}),sidecarJournalMode:mode,host:{...service.options.host,
    moduleUrl:new URL('../testing/context-product-verification-fault-host.mjs',import.meta.url).href,
    configuration:{...service.options.host.configuration,verificationFault:faults.buffer,verificationCodedPrimary:coded}}};
  const open=createProductReaderRuntime({maintenance:true,verificationQualified:()=>true}),h=await open(options);t.after(()=>h.close());
  const result=await h.refreshContextIndex({readSet:[ns],types:['memory'],intent:'current',mode:'lexical',budget:{maxItems:1024,maxMs:5000}},service.token);
  assert.equal(faults[1],1,'verification COMMIT fault executed');assert.equal(faults[2],1,'rollback fault executed');
  assert.equal(JSON.stringify(result),'{"ok":false,"error":{"code":"storage_error","retryable":false}}','public result is unchanged');
  if(!coded)assert.equal(maintenanceFailureDiagnostic(result)?.cause,'exception:TypeError','initiating exception stays primary');
  const diagnostic=maintenanceReaderFailureDiagnostic(result);
  assert.equal(diagnostic?.secondaryFailure?.cause,'exception:RangeError','rollback exception reaches the bounded private secondary channel');
  if(!coded)assert.equal(diagnostic.failureCounts.exception,1);assert.equal(diagnostic.secondaryFailureCounts.exception,1);
  assert.equal(faults[3],0,'secondary error is not inspected under a SQLite transaction');assert.ok(faults[4]>0);
  assert.deepEqual(inspect(f.path,snapshot),before,'closing after rollback failure leaves the durable checkpoint intact');
}));

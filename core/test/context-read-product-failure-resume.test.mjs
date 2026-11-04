import { testClock } from '../testing/context-product-test-clock.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { fixture,ok } from '../testing/context-read-fixture.mjs';
import { configured,personal } from '../testing/context-product-owner-fixture.mjs';
import { createSupervisorRegistry } from '../context-read-supervisor.mjs';
import * as reader from '../context-product-reader.mjs';
import { createMaintenancePumpRuntime,maintenancePumpPhaseDiagnostic } from '../context-product-pump.mjs';

const deferredFixtures=[];
test.after(async()=>{for(const cleanup of deferredFixtures.reverse())await cleanup();});

test('failure cause: native signed checkpoint resume preserves its public mapping and captures TypeError',async t=>{
  const f=fixture(t);f.admit('synthetic resume first',personal);f.admit('synthetic resume second',personal);
  const service=configured(t,f.path,[personal],{service:true}),control=new Int32Array(new SharedArrayBuffer(8));
  const options={...service.options,host:{...service.options.host,moduleUrl:new URL('../testing/context-product-failure-resume-host.mjs',import.meta.url).href,
    configuration:{...service.options.host.configuration,resumeFailure:control.buffer}}};
  const warm=await reader.openContextIndexMaintainer(options);
  try {ok(await warm.refreshContextIndex({readSet:[personal],types:['memory'],intent:'current',mode:'lexical',budget:{maxItems:1,maxMs:1000}},service.token));}
  finally {await warm.close();}
  Atomics.store(control,0,1);
  const timers=new Map();let handle,result;
  const setTimer=(fn,ms)=>{const id={unref(){}};timers.set(id,{fn,at:testClock.now()+ms});return id;},clearTimer=id=>timers.delete(id);
  const open=reader.createProductReaderRuntime({maintenance:true,setTimer,clearTimer});
  const renew=createMaintenancePumpRuntime({now:testClock.now,setTimer,clearTimer,open:async(...args)=>{handle=await open(...args);return {...handle,refreshContextIndex:async(...call)=>result=await handle.refreshContextIndex(...call)};}});
  const pump=renew({supervisor:service.supervisor,id:'resume-failure',window:{id:'resume-window',endsAtMonoMs:Math.floor(testClock.now())+60000,usedItems:0,usedMs:0},
    budgets:{maxItems:8,maxMs:8000},quantum:{maxItems:1,maxMs:1000},pollMs:1000,renewalMs:60000,serviceCredential:service.token,projections:[{options,types:['memory']}]});
  t.after(()=>pump.close().catch(()=>{}));
  const [key,timer]=[...timers][0];timers.delete(key);await testClock.advance(timer.at-testClock.now());await timer.fn();
  const final=await pump.completion;
  assert.equal(Atomics.load(control,1),1,'real signed checkpoint resume query reached');
  assert.equal(JSON.stringify(result),'{"ok":false,"error":{"code":"storage_error","retryable":false}}','native resume public bytes equal the base');
  const failure=reader.maintenanceFailureDiagnostic?.(result);
  assert.equal(failure?.cause,'exception:TypeError','native resume private exception cause');
  assert.equal(failure.step,0,'resume validation outside an admitted unit retains the idle kind');
  assert.equal(maintenancePumpPhaseDiagnostic(final).projections[0].lastFailure.cause,'exception:TypeError');
});


test('K1 Worker opening latches storage_busy before failed disposal',async t=>{
  // Keep deliberately quarantined file identities alive until file teardown.
  const f=fixture({after:fn=>deferredFixtures.push(fn)}),supervisor=createSupervisorRegistry().supervisor();
  const service=configured({after:fn=>t.after(()=>assert.rejects(fn(),{code:'reader_failed'}))},f.path,[personal],{service:true,supervisor});
  const options={...service.options,host:{...service.options.host,moduleUrl:new URL('../testing/context-product-failure-resume-host.mjs',import.meta.url).href,
    configuration:{...service.options.host.configuration,openingFailure:true}}};
  const error=await reader.openContextIndexMaintainer(options).catch(error=>error);
  assert.equal(error.code,'storage_busy','combined opening public code equals the base');
  const primary=reader.maintenanceFailureDiagnostic(error),diagnostic=reader.maintenanceReaderFailureDiagnostic(error);
  assert.equal(primary?.cause,'engine','opening primary survives failed disposal');assert.equal(primary.engineCode,'storage_busy');assert.equal(primary.stage,'open');assert.ok(primary.ordinal>0);assert.ok(primary.stall);
  assert.equal(diagnostic.failureCounts.engine,1);assert.equal(diagnostic.secondaryFailure.cause,'cleanup');assert.equal(diagnostic.secondaryFailureCounts.cleanup,1);
});

test('K3 transaction failure inspection runs only after rollback',async t=>{
  const f=fixture(t);f.admit('synthetic transaction evidence',personal);
  const service=configured(t,f.path,[personal],{service:true,supervisor:createSupervisorRegistry().supervisor()}),state=new Int32Array(new SharedArrayBuffer(12));
  const options={...service.options,host:{...service.options.host,moduleUrl:new URL('../testing/context-product-failure-transaction-host.mjs',import.meta.url).href,
    configuration:{...service.options.host.configuration,transactionFailure:state.buffer}}};
  const h=await reader.openContextIndexMaintainer(options);t.after(()=>h.close());
  const result=await h.refreshContextIndex({readSet:[personal],types:['memory'],intent:'current',mode:'lexical',budget:{maxItems:32,maxMs:1000}},service.token);
  assert.equal(result.error.code,'storage_error','Proxy failure public code equals the base');assert.equal(Atomics.load(state,0),1,'real sidecar commit failure reached');
  assert.equal(Atomics.load(state,1),0,'no exception reflection trap runs while SQLite transaction is open');
  assert.ok(Atomics.load(state,2)>0,'exception is inspected after rollback');
  const primary=reader.maintenanceFailureDiagnostic(result);assert.equal(primary.cause,'exception:TypeError');assert.equal(primary.step,8,'raw slot retains the commit step');
});


test('K1 Worker close carries the caught exception before exit and registry cleanup',async t=>{
  // Keep deliberately quarantined file identities alive until file teardown.
  const f=fixture({after:fn=>deferredFixtures.push(fn)}),supervisor=createSupervisorRegistry().supervisor();
  const service=configured({after:fn=>t.after(()=>assert.rejects(fn(),{code:'reader_failed'}))},f.path,[personal],{service:true,supervisor});
  const options={...service.options,host:{...service.options.host,moduleUrl:new URL('../testing/context-product-failure-resume-host.mjs',import.meta.url).href,
    configuration:{...service.options.host.configuration,closingFailure:true}}};
  const h=await reader.openContextIndexMaintainer(options),error=await h.close().catch(error=>error);
  assert.equal(error.code,'reader_failed','Worker disposal public code equals the base');
  const primary=reader.maintenanceFailureDiagnostic(error),diagnostic=reader.maintenanceReaderFailureDiagnostic(h);
  assert.equal(primary.cause,'exception:TypeError','Worker close primary survives exit and registry cleanup');
  assert.equal(primary.step,0);assert.equal(primary.stage,'close');assert.equal(diagnostic.failureCounts.exception,1);
  assert.equal(diagnostic.secondaryFailureCounts.worker_exit,1);assert.equal(diagnostic.secondaryFailureCounts.cleanup,2,'Worker and registry cleanup failures are distinct secondary events');
});

import { testClock } from '../testing/context-product-test-clock.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { setTimeout as watchdog } from 'node:timers/promises';
import { fixture, ns } from '../testing/context-read-fixture.mjs';
import { configured } from '../testing/context-product-owner-fixture.mjs';
import { local } from '../testing/context-product-verification-fixture.mjs';
import { createProductReaderRuntime } from '../context-product-reader.mjs';
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

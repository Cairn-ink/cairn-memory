import test from 'node:test';
import assert from 'node:assert/strict';
import { performance, monitorEventLoopDelay } from 'node:perf_hooks';
import { createContextCounter } from '../../adapters/openai/context-counter.mjs';
import { fixture,host,ns,publish,read,ok } from './role-fixture.mjs';
test('C03 observed now/then latency, exact counter calls, receipt size and event-loop delay (real local o200k_base)',async t=>{
 const counter=await createContextCounter(),f=fixture(t,{h:host({counter})});ok(f.call('publishRoleProfileRelease',publish()));
 const receipt=ok(f.call('readRoleTaskContext',read())).metered.receipt,delay=monitorEventLoopDelay({resolution:10});delay.enable();await new Promise(resolve=>setTimeout(resolve,20));
 const measurements={};for(const mode of ['now','then']){
  const samples=[],calls=[];
  for(let i=0;i<20;i++){const start=performance.now(),result=ok(f.call('readRoleTaskContext',mode==='now'?read():{mode,readSet:[ns],receipt}));samples.push(performance.now()-start);calls.push(result.diagnostics.trace.counterCalls);assert.ok(result.diagnostics.budget.used<=4000);}
  samples.sort((a,b)=>a-b);measurements[mode]={p50Ms:samples[9],p95Ms:samples[18],counterCalls:[Math.min(...calls),Math.max(...calls)]};
 }
 await new Promise(resolve=>setTimeout(resolve,20));delay.disable();t.diagnostic(JSON.stringify({counter:counter.id,receiptBytes:Buffer.byteLength(receipt),...measurements,eventLoopDelayP95Ms:delay.percentile(95)/1e6}));
});

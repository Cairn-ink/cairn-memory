import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { randomUUID } from 'node:crypto';
import { createProductReaderRuntime } from '../context-product-reader.mjs';
import { createContextReadSupervisor } from '../context-read-supervisor.mjs';
import { credentialDigest,PRODUCT_PROFILE } from '../context-product-control.mjs';
function fixture(t,{stall=false}={}){
  let time=0n,release;const stopped=new Promise(resolve=>{release=resolve;}),timers=new Set(),messages=[];
  const supervisor=createContextReadSupervisor();t.after(()=>supervisor.close());
  const credential={service:randomUUID()},readSet=[{ownerId:'service',scope:'personal',projectId:null}],ownerCoverage={policy:'recent-projects-v1',selectionRevision:'fixture',requestedNamespaces:1,selectedNamespaces:1,omittedNamespaces:0};
  const serviceBinding={kind:'service',serviceId:randomUUID(),credentialBindingId:randomUUID(),credentialExpiresUtcMs:null,credentialDigest:credentialDigest(credential),ownerId:'service',namespaces:{readSet,ownerCoverage},issuedAt:0};
  const options={supervisor,path:new URL('synthetic-service.sqlite',import.meta.url).pathname,version:'context-read-v1',profile:PRODUCT_PROFILE,readSet,ownerCoverage,sidecarJournalMode:'DELETE',host:{moduleUrl:new URL('../testing/context-product-index-host.mjs',import.meta.url).href,configuration:{serviceBinding}}};
  const open=createProductReaderRuntime({maintenance:true,now:()=>time,utc:()=>1000+Number(time/1000000n),setTimer:(fn,ms)=>{const timer={fn,ms,unref(){}};timers.add(timer);return timer;},clearTimer:timer=>timers.delete(timer),spawnWorker:data=>{
    const w=new EventEmitter();Object.assign(w,{ref(){},unref(){},terminate:()=>stopped,postMessage(m){messages.push(m);if(m.method==='close'){
      // Hold either disposal acknowledgement; an immediate exit already proves cleanup.
      if(stall)void stopped.then(()=>w.emit('exit',0));else queueMicrotask(()=>w.emit('exit',0));return;}
      queueMicrotask(()=>w.emit('message',{operation:m.operation,result:{ok:true,value:null}}));}});
    if(!stall)queueMicrotask(()=>w.emit('message',{operation:data.operation,result:{ok:true,value:null},fileIdentity:'42:43'}));return w;
  }});
  return {options,open,credential,messages,timers,set:n=>{time=BigInt(n)*1000000n;},release:()=>release(1)};
}
test('P2-22 independent service quantum after original five-second opening window receives its own bounded control',async t=>{
  const f=fixture(t),h=await f.open(f.options);t.after(()=>h.close());f.set(10000);
  assert.equal((await h.getContextIndexStatus({readSet:f.options.readSet,types:['memory'],intent:'current',deadlineMs:4000},f.credential)).ok,true);
  const m=f.messages.at(-1);assert.equal(m.request.admittedMonoNs,'10000000000');assert.equal(m.operation.operationCutoffMonoNs,'14000000000');
  assert.equal(m.request.credentialBindingId,f.options.host.configuration.serviceBinding.credentialBindingId);await h.close();
});
test('P2-16 failed maintainer opening settles before delayed termination and supervisor owns quarantine',async t=>{
  const f=fixture(t,{stall:true}),pending=f.open({...f.options,deadlineMs:10}).catch(e=>e);
  f.set(10);for(const timer of [...f.timers])timer.fn();const error=await pending;
  assert.equal(error.code,'read_timeout');assert.equal(f.options.supervisor.getCleanupStatus(error.cleanupId).state,'pending');
  const other=createContextReadSupervisor();t.after(()=>other.close());
  await assert.rejects(f.open({...f.options,supervisor:other}),{code:'read_in_progress'});
  f.release();assert.equal((await f.options.supervisor.drain(error.cleanupId)).state,'complete');
});

// Test-only lease owner. Synchronous close rendezvous exercises forced fallback.
import { parentPort } from 'node:worker_threads';
import { createContextReadHost as base } from './context-product-index-host.mjs';
export async function createContextReadHost(c) {
  const host=await base(c),state=new Int32Array(c.disposalState);
  if(c.bootstrapGate){
    c.resourceOwner.register('lease',()=>{Atomics.add(state,5,1);if(c.disposalMode==='bootstrap-reject')throw new TypeError('synthetic bootstrap disposal refusal');});
    await new Promise(resolve=>{const release=m=>{if(m.fixtureRelease){parentPort.off('message',release);resolve();}
      else if(m.method==='close')Atomics.store(state,6,1);};parentPort.on('message',release);Atomics.store(state,4,1);});
  }
  return {...host,close(){
    Atomics.store(state,0,1);Atomics.notify(state,0);
    if(c.disposalMode==='reject')throw Error('synthetic disposal refusal');
    if(c.disposalMode==='block')while(!Atomics.load(state,1))Atomics.wait(state,1,0);
    Atomics.store(state,2,1);
  }};
}

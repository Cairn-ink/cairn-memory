import { fail } from './validation.mjs';

// Process-local physical-store domains. Workers receive one reserved slot;
// only proven Worker termination may reclaim a slot on their behalf.
const stores=new Map();
export function reserveSidecarHandle(identity) {
  let domain=stores.get(identity);
  if(!domain){domain={buffer:new SharedArrayBuffer(4096),slots:new Set()};stores.set(identity,domain);}
  let slot=0;while(domain.slots.has(slot))slot++;
  if(slot>=1024)fail('storage_busy');
  domain.slots.add(slot);
  let released=false;
  return {buffer:domain.buffer,slot,release(){
    if(released)return;released=true;
    Atomics.store(new Int32Array(domain.buffer),slot,0);
    domain.slots.delete(slot);if(!domain.slots.size)stores.delete(identity);
  }};
}
export function sidecarHandleGuard({buffer,slot}) {
  const states=new Int32Array(buffer);let open=false;
  const other=state=>{for(let i=0;i<states.length;i++)if(i!==slot&&state(Atomics.load(states,i)))return true;return false;};
  return {
    opening(){
      // Announce before opening. An overlapping replacement either sees this
      // reservation and refuses, or this opener sees its exclusion and refuses.
      open=true;Atomics.store(states,slot,1);
      if(other(s=>s===2)){open=false;Atomics.store(states,slot,0);fail('storage_busy');}
    },
    closed(){if(open){open=false;Atomics.store(states,slot,0);}},
    replace(work,refuse){
      Atomics.store(states,slot,2);
      try {if(other(s=>s!==0))return refuse();return work();}
      finally {Atomics.store(states,slot,0);}
    },
  };
}

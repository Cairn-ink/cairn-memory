import { fail } from './validation.mjs';

// A synchronous publication gate is shared by all borrowed projection Workers.
// The coordinator announces disablement before waiting for an existing native
// commit, so a stream of new commits cannot starve the off switch.
export function semanticGate(buffer,writer=1n) {
  const state=new BigInt64Array(buffer);
  const check=policy=>{
    if(Atomics.load(state,0)!==1n||Atomics.load(state,2)!==BigInt(policy.purgeEpoch)||Atomics.load(state,1)!==BigInt(policy.revision)||Atomics.load(state,6)!==0n)fail('purge_pending');
  };
  return {check,
    enter(policy){check(policy);if(Atomics.compareExchange(state,5,0n,writer)!==0n)fail('purge_pending');try{check(policy);}catch(error){Atomics.store(state,5,0n);Atomics.notify(state,5);throw error;}return ()=>{Atomics.store(state,5,0n);Atomics.notify(state,5);};},
    async stop(){
      Atomics.store(state,6,1n);
      for(;;){const previous=Atomics.compareExchange(state,5,0n,-1n);if(previous===0n)return ()=>{Atomics.store(state,5,0n);Atomics.notify(state,5);};if(previous===-1n)fail('read_in_progress');await Atomics.waitAsync(state,5,previous).value;}
    },
    publish(owner,reopen=false){Atomics.store(state,0,owner.policy.semantic?1n:0n);Atomics.store(state,1,BigInt(owner.policy.revision));Atomics.store(state,2,BigInt(owner.policy.purgeEpoch));Atomics.store(state,3,owner.blocked?1n:0n);if(!owner.policy.semantic||reopen)Atomics.store(state,6,owner.policy.semantic?0n:1n);},
  };
}

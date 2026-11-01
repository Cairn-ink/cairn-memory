// Offline coordinator authority fault after an admitted reservation.
import { createContextReadHost as base } from './context-semantic-pump-cutoff-host.mjs';
export async function createContextReadHost(configuration) {
  const host=await base(configuration),state=new Int32Array(configuration.state);
  if(!configuration.semanticServiceBinding)return host;
  const authority=host.semanticLedgerAuthority;
  return {...host,semanticLedgerAuthority:{...authority,async load(...args) {
    if(Atomics.compareExchange(state,3,2,0)===2){
      Atomics.store(state,10,1);Atomics.notify(state,10);
      while(Atomics.load(state,11)===0)await Atomics.waitAsync(state,11,0).value;
    }
    return authority.load(...args);
  },compareAndSwap(...args) {
    if(Atomics.exchange(state,3,0)===1)throw Object.assign(Error('synthetic accounting timeout'),{code:'timeout'});
    return authority.compareAndSwap(...args);
  }}};
}

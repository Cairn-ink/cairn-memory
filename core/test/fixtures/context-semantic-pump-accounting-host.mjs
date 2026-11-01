// Offline coordinator authority fault after an admitted reservation.
import { createContextReadHost as base } from './context-semantic-pump-cutoff-host.mjs';
export async function createContextReadHost(configuration) {
  const host=await base(configuration),state=new Int32Array(configuration.state);
  if(!configuration.semanticServiceBinding)return host;
  const authority=host.semanticLedgerAuthority;
  return {...host,semanticLedgerAuthority:{...authority,compareAndSwap(...args) {
    if(Atomics.exchange(state,3,0)===1)throw Object.assign(Error('synthetic accounting timeout'),{code:'timeout'});
    return authority.compareAndSwap(...args);
  }}};
}

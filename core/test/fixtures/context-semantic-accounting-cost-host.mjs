// Charge a deterministic native resident close without a wall-clock sleep.
import { createContextReadHost as base } from './context-semantic-pump-cutoff-host.mjs';
import { testClock } from '../../testing/context-product-test-clock.mjs';
export async function createContextReadHost(configuration) {
  const host=await base(configuration);let closed=false;
  return {...host,async close(){
    if(!closed){closed=true;await testClock.advance(configuration.closeCostMs,{waitForWorkers:false});}
    await host.close();
  }};
}

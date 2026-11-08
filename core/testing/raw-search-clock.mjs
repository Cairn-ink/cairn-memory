import {performance} from 'node:perf_hooks';

const clocks=new WeakMap();
// Install before constructing fixtures: setup must not consume a real opening
// budget on a loaded runner. Individual deadline tests may replace this clock.
export function installRawSearchTestClock(t) {
  const own=Object.getOwnPropertyDescriptor(performance,'now');let now=100;
  const read=()=>now;clocks.set(read,ms=>{now+=ms;});
  Object.defineProperty(performance,'now',{configurable:true,value:read});
  t.after(()=>{if(own)Object.defineProperty(performance,'now',own);else delete performance.now;});
}
export async function rawSearchTestWait(ms) {
  const advance=clocks.get(performance.now);
  if(advance){advance(ms);await new Promise(resolve=>setImmediate(resolve));}
  else await new Promise(resolve=>setTimeout(resolve,ms));
}

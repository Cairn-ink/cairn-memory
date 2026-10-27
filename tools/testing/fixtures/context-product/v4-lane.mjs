import { attempt,observeLoop } from './engine.mjs';
import { startSampler,attributeBlocks } from './actors.mjs';
export async function laneProcess(config) {
  const send=m=>new Promise((resolve,reject)=>process.send(m,e=>e?reject(e):resolve()));
  let running=null,stopping=false;
  const startup=globalThis[Symbol.for('product-cold-startup-loop')];startup?.pause();
  const oracle=(await import(config.oracleModule)).validate,sampler=await startSampler([process.pid]);
  const startupLoop=await startup?.finish();
  process.on('message',m=>{
    if(m.type==='stop'){stopping=true;return;}
    if(m.type!=='read'||running)return;
    running=(async()=>{
      const value=await attempt(m.config,{oracle});attributeBlocks(value.record,await sampler.collect());
      await send({type:'read-result',id:m.id,value});
    })().catch(async()=>{await send({type:'lane-failure',id:m.id});}).finally(()=>{running=null;});
  });
  await send({type:'ready',startupLoop});
  while(!stopping)await new Promise(r=>setTimeout(r,10));
  await running;const attribution=await sampler.stop();await send({type:'result',attribution});process.disconnect();
}

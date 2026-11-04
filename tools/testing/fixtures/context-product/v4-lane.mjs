import { attempt,observeLoop } from './engine.mjs';
import { startSampler,attributeBlocks } from './actors.mjs';
export async function laneProcess(config,{channel=process,makeSampler=startSampler,read=attempt,wait=ms=>new Promise(r=>setTimeout(r,ms))}={}) {
  const send=m=>new Promise((resolve,reject)=>channel.send(m,e=>e?reject(e):resolve()));
  let running=null,stopping=channel.connected===false;
  const disconnect=()=>{stopping=true;};channel.once('disconnect',disconnect);
  const startup=globalThis[Symbol.for('product-cold-startup-loop')];startup?.pause();
  const oracle=(await import(config.oracleModule)).validate,sampler=await makeSampler([process.pid]);
  const startupLoop=await startup?.finish();
  const receive=m=>{
    if(m.type==='stop'){stopping=true;return;}
    if(m.type!=='read'||running)return;
    running=(async()=>{
      const value=await read(m.config,{oracle});attributeBlocks(value.record,await sampler.collect());
      await send({type:'read-result',id:m.id,value});
    })().catch(async error=>{await send({type:'lane-failure',id:m.id,code:error.code??'lane_attempt_failed'});}).finally(()=>{running=null;});
  };channel.on('message',receive);
  try{
    await send({type:'ready',startupLoop});
    while(!stopping)await wait(10);
    await running;
  }finally{
    const attribution=await sampler.stop();
    channel.off('message',receive);channel.off('disconnect',disconnect);
    if(channel.connected!==false){await send({type:'result',attribution});channel.disconnect();}
  }
}

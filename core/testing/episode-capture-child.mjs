// Synthetic IPC barriers; no sleeps, provider, key or user store.
import { openMemoryCore } from '../index.mjs';
import { createMemoryRuntime } from '../runtime.mjs';
import { captureEpisodeMessages } from '../episode-capture.mjs';
import { model,input,options,ns,interpretation } from './episode-capture-helpers.mjs';
const [path,mode]=process.argv.slice(2);
const send=value=>new Promise(resolve=>process.send(value,resolve));
if(mode.startsWith('heavy-')) {
  const port=model({interpretEpisode:r=>{if(mode.includes('failure'))throw Error('scripted failure');return interpretation(r);}});
  const core=openMemoryCore({path,...options,sessionEpisodes:{mode:'episode-v1',draftEveryBatches:16},model:port});
  await send({stage:'ready'});await new Promise(resolve=>process.once('message',resolve));
  let admitted=0;
  for(let n=1;n<=70;n++) {
    const value=input(n,mode);value.messages=Array.from({length:20},(_,i)=>({id:`m-${n}-${i}`,role:'user',content:`Batch ${n} `+'x'.repeat(780)}));
    let result;
    for(let tries=0;tries<1000;tries++) {
      result=await core.capture(value);
      if (!(result.ok && result.value.processing) && !['episode_processing','storage_busy'].includes(result.error?.code)) break;
      const resume=new Promise(resolve=>process.once('message',resolve));
      await send({stage:'retry'});await resume;
    }
    if(!result.ok || !result.value.admission || result.value.processing)throw Error(JSON.stringify(result));
    admitted++;
  }
  core.close();await send({stage:'result',admitted,calls:port.calls.filter(c=>c.method==='interpretEpisode').length});process.disconnect();
} else if(mode==='crash-after-draft') {
  const runtime=createMemoryRuntime({path,sessionEpisodes:{mode:'episode-v1'}});
  await captureEpisodeMessages({runtime,ns,model:model(),input:input(),startAdmission(){
    process.send({stage:'drafted'});
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)),0,0);
  }});
} else {
  const port=model(mode==='hold'?{interpretEpisode:async request=>{
    await send({stage:'interpreting'});
    await new Promise(resolve=>process.once('message',resolve));return interpretation(request);
  }}:{});
  const core=openMemoryCore({path,...options,model:port});
  const result=await core.capture(input());core.close();await send({stage:'result',result,calls:port.calls.map(call=>call.method)});process.disconnect();
}

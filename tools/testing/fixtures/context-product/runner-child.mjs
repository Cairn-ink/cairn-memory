import { attempt } from './engine.mjs';
import { startSampler, attributeBlocks } from './actors.mjs';
import { writerProcess } from './writer.mjs';
const startup=globalThis[Symbol.for('product-cold-startup-loop')];startup?.pause();
const kind=process.argv[2];const chunks=[];let bytes=0;for await(const chunk of process.stdin){bytes+=chunk.length;if(bytes>1048576)throw Error('child_configuration_size');chunks.push(chunk);}const encoded=Buffer.concat(chunks).toString('utf8');
const config=JSON.parse(encoded);startup?.resume();
try {
  if(kind==='session')await (await import('./v4-session-child.mjs')).sessionChild(config);
  else if(kind==='lane')await (await import('./v4-lane.mjs')).laneProcess(config);
  else if(kind==='writer-v4')await (await import('./v4-writer.mjs')).writerV4(config);
  else if(kind==='writer')await writerProcess(config);
  else if(kind==='cold') {
    // The fresh process imports the oracle before starting the engine window.
    startup?.pause();const oracle=config.oracleModule?(await import(config.oracleModule)).validate:undefined;
    const sampler=await startSampler([process.pid]);startup?.resume();
    let value,attribution,startupLoop;try{value=await attempt(config,{oracle,onWindowStart:async()=>{startupLoop=await startup?.finish();},onWindowEnd:async()=>{
      await new Promise((resolve,reject)=>process.send({type:'window_end'},e=>e?reject(e):resolve()));
      await new Promise(resolve=>process.once('message',resolve));
    }});}finally{attribution=await sampler.stop();}
    if(startupLoop)value.record.startupLoop=startupLoop;attributeBlocks(value.record,attribution.samples);value.record.attribution=attribution;
    await new Promise((resolve,reject)=>process.send({type:'result',value:{record:value.record}},e=>e?reject(e):resolve()));process.disconnect();
  }else throw Error('child_kind');
}catch {await startup?.finish();process.exitCode=1;if(process.connected)process.disconnect();}

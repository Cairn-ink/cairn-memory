import { actor,terminate,startSampler,attributeBlocks } from './actors.mjs';
import { prepareSessionPump } from './v4-session-pump.mjs';
import { observeLoop } from './engine.mjs';
import { sessionDecision } from './v4-session-work.mjs';
export { sessionPopulation } from './v4-session-work.mjs';
// All variable-size encoding, actor startup and pump configuration precede the
// window. IPC re-encodes these fixed tiny strings (<= 7 JSON bytes), never a
// lane input or a writer ledger. No async-context ownership classification.
const START='start',EXPORT='export',CANCEL='cancel';
export async function sharedSession(cells,session,{config,sink},{makeSession=c=>actor('session',c,{monitor:false,encoded:true}),preparePump=prepareSessionPump,loopFactory=observeLoop,makeSampler=startSampler}={}) {
  const {signal,oracle,inspectLedger,verifySidecarUnchanged,ledger,initialCounts,maintainerDiagnostics,input,responseSchema,schemas,oracleData,...transfer}=config;
  let child,pump,parentLoop,hostLoop,attribution,writerLease,driver,exported,sampler,failure,childDone=false;
  const buffered=[];
  try {
    writerLease=await sink.delegate();
    const encoded=JSON.stringify({config:transfer,cells,session,journal:writerLease});
    if(Buffer.byteLength(encoded)>1048576)throw Error('session_configuration_size');
    child=makeSession(encoded);const ready=await child.wait(['ready','done']);
    if(ready.type==='done'){childDone=true;throw Error('session_startup_failed');}
    driver=await preparePump(config);
    sampler=await makeSampler([process.pid],null,{monitor:false});
    parentLoop=loopFactory();
    try {
      pump=driver.start();child.send(START);await child.wait('done');childDone=true;
    }finally{
      // Includes renewal, drain, pump close, supervisor close and the session
      // child's writer/lane shutdown. Every parent callback is counted.
      try{if(pump)buffered.push(await pump.stop());else await driver.dispose?.();}catch(e){failure??=e;}finally{hostLoop=await parentLoop.finish();parentLoop=null;}
      try{attribution=await sampler.stop();}catch{attribution={coverage:'incomplete',samples:[],error:'parent_sampler_failed'};}
    }
  }catch(e){failure??=e;}finally{
    if(parentLoop){hostLoop=await parentLoop.finish();parentLoop=null;}
    if(!hostLoop&&driver)try{await driver.dispose?.();}catch(e){failure??=e;}
    // Export can serialize variable data only after observation has finished.
    if(child){
      try{
        if(child.connected){
          if(!childDone){child.send(CANCEL);await child.wait('done');}
          child.send(EXPORT);exported=await child.wait('result');
        }
        const exit=await child.exited;if(exit.code!==0||exit.signal)failure??=Error('session_child_failed');
      }catch(e){failure??=e;}finally{await terminate(child);}
    }
    if(writerLease)await sink.reclaim(exported?.sequence);
  }
  if(!hostLoop)throw failure??Error('session_startup_failed');
  attribution??={coverage:'incomplete',samples:[]};
  const record={hostPid:process.pid,hostLoop};attributeBlocks(record,attribution.samples??[]);
  for(const block of hostLoop.blocks??[])if(attribution.supported===false||attribution.coverage!=='complete'||
    !block.scheduling?.threads?.some(t=>t.tid===process.pid)||!['pswpin','pswpout','pgmajfault'].every(k=>Number.isFinite(block.scheduling?.vm?.[k])))
    block.scheduling={...block.scheduling,coverage:'incomplete'};
  await sink.record(config.cell.id,'session-parent-loop',record);
  await sink.record(config.cell.id,'session-parent-attribution',attribution);
  const drain=buffered.flat(2);drain.push(...await driver.report((s,r)=>sink.record(config.cell.id,s,r)));
  await sink.record(config.cell.id,'pump-drain',drain);
  if(failure)throw failure;
  if(exported?.error)throw Object.assign(Error(exported.error),{code:exported.error});
  if(inspectLedger){const final=await inspectLedger();await sink.record(config.cell.id,'population',{session:session.key,initial:config.initialCounts,final:{memories:final.memories,cards:final.cardCount,schema:final.schema}});}
  return sessionDecision(cells,session,config,exported.value,hostLoop,drain);
}

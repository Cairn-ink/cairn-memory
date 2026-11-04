import { persistFailure } from './report.mjs';
import { actor,terminate,startSampler,attributeBlocks } from './actors.mjs';
import { prepareSessionPump } from './v4-session-pump.mjs';
import { observeLoop } from './engine.mjs';
import { sessionDecision } from './v4-session-work.mjs';
export { sessionPopulation } from './v4-session-work.mjs';
// All variable-size encoding, actor startup and pump configuration precede the
// window. IPC re-encodes these fixed tiny strings (<= 7 JSON bytes), never a
// lane input or a writer ledger. No async-context ownership classification.
const START='start',EXPORT='export',CANCEL='cancel';
export async function sharedSession(cells,session,{config,sink},{makeSession=c=>actor('session',c,{monitor:false,encoded:true}),preparePump=prepareSessionPump,loopFactory=observeLoop,makeSampler=startSampler,schedule=setTimeout,cancel=clearTimeout}={}) {
  const {signal,oracle,inspectLedger,verifySidecarUnchanged,ledger,initialCounts,maintainerDiagnostics,input,responseSchema,schemas,oracleData,...transfer}=config;
  let child,pump,parentLoop,hostLoop,attribution,writerLease,driver,exported,sampler,failure,childDone=false,cleanupFailure;
  let cleaning,preparation,prepared=false,shutdown,pumpClosed=false,resultReceived=false;
  const buffered=[],cancellation=new AbortController();
  const cleanup=()=>child?(cleaning??=(async()=>{try{await terminate(child);}catch(e){e.cleanup={descendantsUnconfirmed:true};cleanupFailure=e;throw e;}})()):Promise.resolve();
  const stopPump=()=>shutdown??=(async()=>{if(pump)buffered.push(await pump.stop());else await driver.dispose?.();pumpClosed=true;})();
  let deadline,expired=false,rejectTerminal;
  const terminal=new Promise((_,reject)=>{rejectTerminal=reject;});terminal.catch(()=>{});
  // IPC delivery can precede the result await's continuation. Observe delivery
  // itself, after export is requested, so a same-turn disconnect is orderly.
  const received=m=>{if(m?.type==='result')resultReceived=true;};
  const lost=()=>{if(!resultReceived){cancellation.abort();rejectTerminal(Error('session_child_disconnected'));}};
  const bounded=p=>Promise.race([p,terminal]);
  const wait=type=>bounded(child.wait(type));
  const budget={progressMs:15000,drainAllowanceMs:1000,...config.supervision};
  // Independent of child IPC and its event loop. Keep it armed through export
  // and confirmed descendant exit; the runner's absolute reservation also caps it.
  const arm=active=>{
    cancel(deadline);const allowance=(active?180050:180000)+budget.progressMs+budget.drainAllowanceMs;
    deadline=schedule(()=>{expired=true;const error=Error('session_parent_timeout');failure??=error;rejectTerminal(error);cancellation.abort();void cleanup().catch(()=>{});},Math.max(1,Math.min(allowance,(config.sessionDeadlineAt??Infinity)-Date.now())));
  };arm(false);
  try {
    await sink.sessionOpen?.(config.cell.id);
    writerLease=await sink.delegate();
    const encoded=JSON.stringify({config:transfer,cells,session,journal:writerLease});
    if(Buffer.byteLength(encoded)>1048576)throw Error('session_configuration_size');
    child=makeSession(encoded);child.on?.('disconnect',lost);const ready=await wait(['ready','done']);
    if(ready.type==='done'){childDone=true;throw Error('session_startup_failed');}
    preparation=Promise.resolve().then(()=>preparePump(config));
    preparation.then(value=>{
      prepared=true;driver=value;
      // A late preparation cannot start a session or release its retained lease.
      if(cancellation.signal.aborted)void stopPump().catch(()=>{});
    },()=>{prepared=true;});
    driver=await bounded(preparation);
    sampler=await makeSampler([process.pid],null,{monitor:false,signal:cancellation.signal});
    parentLoop=loopFactory();
    try {
      pump=driver.start();arm(true);child.send(START);await wait('done');childDone=true;
    }finally{
      // Includes renewal, drain, pump close, supervisor close and the session
      // child's writer/lane shutdown. Every parent callback is counted.
      try{await bounded(stopPump());}catch(e){failure??=e;}finally{try{if(!childDone)await cleanup();}finally{hostLoop=await parentLoop.finish();parentLoop=null;}}
      try{attribution=await sampler.stop();}catch{attribution={coverage:'incomplete',samples:[],error:'parent_sampler_failed'};}
    }
  }catch(e){failure??=e;}finally{
    if(parentLoop){hostLoop=await parentLoop.finish();parentLoop=null;}
    if(driver&&!shutdown)try{await bounded(stopPump());}catch(e){failure??=e;}
    // Export can serialize variable data only after observation has finished.
    if(child){
      try{
        if(child.connected&&!expired){
          if(!childDone){child.send(CANCEL);await wait('done');}
          child.on?.('message',received);child.send(EXPORT);exported=await wait('result');
        }
        const exit=await Promise.race([child.exited,terminal]);if(exit.code!==0||exit.signal)failure??=Error('session_child_failed');
      }catch(e){failure??=e;}finally{
        try{await cleanup();}catch{}
        child.off?.('disconnect',lost);
        child.off?.('message',received);
      }
    }
    if(sampler&&!attribution)try{attribution=await sampler.stop();}catch{attribution={coverage:'incomplete',samples:[]};}
    cancel(deadline);
    // A pending engine preparation/close still owns this workspace even after
    // every descendant is confirmed dead. Never reclaim or delete beneath it.
    if((preparation&&!prepared)||(driver&&!pumpClosed)){
      cleanupFailure??=Object.assign(Error('session_pump_shutdown_unconfirmed_workspace_retained'),{cause:failure,cleanup:{descendantsUnconfirmed:true,pumpUnconfirmed:true}});
    }
    if(cleanupFailure){
      // Observation has ended, but the child may still own the main journal.
      // Export buffered pump evidence via the independent SQLite-free owner.
      try{if(driver?.report)await driver.report((series,record)=>persistFailure(sink,config.cell.id,series,record));
      await persistFailure(sink,config.cell.id,'failure',{stage:'shared-session',code:cleanupFailure.code??cleanupFailure.message,cause:failure?.code??failure?.message??null,cleanup:cleanupFailure.cleanup});
      }catch(journalError){cleanupFailure.journalError=journalError.code??journalError.message;}
      throw cleanupFailure;
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
  const decisions=sessionDecision(cells,session,config,exported.value,hostLoop,drain);
  await sink.sessionClosed?.(config.cell.id);
  return decisions;
}

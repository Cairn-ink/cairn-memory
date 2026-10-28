import { sessionWork } from './v4-session-work.mjs';
import { appendSessionRecords } from './report.mjs';
import { escalateActor } from './session-supervision.mjs';
import { prepareInput,storage } from '../../measure-context-read-product.mjs';
export async function sessionChild({config,cells,session,journal},{work=sessionWork,append=appendSessionRecords,prepare=prepareInput,inspect=storage,channel=process,
  schedule=setTimeout,cancel=clearTimeout,repeat=setInterval,clearRepeat=clearInterval,escalate=escalateActor}={}) {
  const queue=[],waiters=[],actors=new Set(),escalations=new Map();
  globalThis[Symbol.for('product-qualification-actors')]=actors;
  let supervisionError,watchdog,drainTimer,monitor,sink,value,error,rejectTerminal;
  const terminal=new Promise((_,reject)=>{rejectTerminal=reject;});terminal.catch(()=>{});
  const rejectWaits=code=>{for(const w of waiters.splice(0))w.reject(Error(code));};
  const escalateOnce=child=>{if(!escalations.has(child)){const p=escalate(child);p.catch(()=>{});escalations.set(child,p);}return escalations.get(child);};
  const fail=code=>{
    if(supervisionError)return;
    supervisionError=code;
    // Stop all admission, but preserve ordinary settlement and telemetry on
    // healthy actors. Only known stalled actors are escalated immediately.
    for(const child of actors){if(child.stalled)void escalateOnce(child);else if(child.connected)child.send({type:'stop'});}
    rejectWaits(code);
    drainTimer=schedule(()=>{
      for(const child of actors)void escalateOnce(child);
      rejectTerminal(Error(code));
    },config.supervision.drainAllowanceMs);
  };
  const receive=m=>{
    if(m==='start'){
      cancel(watchdog);watchdog=schedule(()=>fail('session_progress_timeout'),180050+config.supervision.progressMs);
    }
    if(m==='cancel'){fail('session_cancelled');return;}
    const i=waiters.findIndex(w=>w.type===m);if(i<0)queue.push(m);else waiters.splice(i,1)[0].resolve();
  };
  const wait=type=>{if(supervisionError&&type==='start')return Promise.reject(Error(supervisionError));const i=queue.indexOf(type);return i<0?new Promise((resolve,reject)=>waiters.push({type,resolve,reject})):Promise.resolve(queue.splice(i,1));};
  const send=m=>new Promise((resolve,reject)=>channel.send(m,e=>e?reject(e):resolve()));
  const disconnected=()=>{fail('parent_disconnected');rejectWaits('parent_disconnected');rejectTerminal(Error('parent_disconnected'));};
  channel.on('message',receive);channel.once('disconnect',disconnected);
  watchdog=schedule(()=>fail('session_progress_timeout'),180000+config.supervision.progressMs);
  monitor=repeat(()=>{if([...actors].some(c=>c.stalled))fail('stalled_child_activity');},Math.min(1000,config.supervision.stallMs??1000));
  try{
    // The cancellation race covers preparation too, including unresolved awaits.
    await Promise.race([terminal,(async()=>{
      sink=await append(journal);const adapter=await import(config.oracleModule);
      config.ledger=(await inspect('inspect',{path:config.path})).value;
      if(supervisionError)throw Error(supervisionError);
      value=await work(cells,session,{config,sink,prepareInput:c=>prepare(c,adapter),validateProbe:adapter.validateProbe},
        {ready:()=>send({type:'ready'}),start:()=>wait('start'),stopped:()=>supervisionError});
    })()]);
  }catch(e){error=e.code??e.message;if(sink)await sink.record(config.cell.id,'lane-failure',{code:error});}
  finally{
    clearRepeat(monitor);cancel(watchdog);cancel(drainTimer);rejectWaits(supervisionError??'session_finished');
    for(const child of actors)await escalateOnce(child);
    await Promise.all(escalations.values());
    delete globalThis[Symbol.for('product-qualification-actors')];
    if(supervisionError&&sink)await sink.record(config.cell.id,'session-supervision',{code:supervisionError});
    await sink?.close();
  }
  error=supervisionError??error;
  try{
    if(channel.connected===false)return;
    // Fixed terminal control is deliverable even when preparation was cancelled.
    await send({type:'done'});
    watchdog=schedule(()=>{rejectWaits('session_export_timeout');},config.supervision.progressMs);
    await wait('export');await send({type:'result',value,error,sequence:sink?.sequence});
  }finally{
    cancel(watchdog);rejectWaits('session_finished');channel.off('message',receive);channel.off('disconnect',disconnected);
    if(channel.connected!==false)channel.disconnect();
  }
}

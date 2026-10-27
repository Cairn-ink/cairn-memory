import { sessionWork } from './v4-session-work.mjs';
import { appendSessionRecords } from './report.mjs';
import { terminate } from './actors.mjs';
import { prepareInput,storage } from '../../measure-context-read-product.mjs';
export async function sessionChild({config,cells,session,journal},{work=sessionWork,append=appendSessionRecords,prepare=prepareInput,inspect=storage,channel=process}={}) {
  const queue=[],waiters=[];let cancelled=false;
  const receive=m=>{
    if(m==='start'){clearTimeout(watchdog);watchdog=setTimeout(timeout,180050+config.supervision.progressMs+config.supervision.drainAllowanceMs);}
    if(m==='cancel'){
      cancelled=true;for(const child of globalThis[Symbol.for('product-qualification-actors')]??[])void terminate(child);
      for(const w of waiters.splice(0))w.reject(Error('session_cancelled'));return;
    }
    const i=waiters.findIndex(w=>w.type===m);if(i<0)queue.push(m);else waiters.splice(i,1)[0].resolve();
  };
  channel.on('message',receive);
  const wait=type=>{if(cancelled&&type==='start')return Promise.reject(Error('session_cancelled'));const i=queue.indexOf(type);return i<0?new Promise((resolve,reject)=>waiters.push({type,resolve,reject})):Promise.resolve(queue.splice(i,1));};
  const send=m=>new Promise((resolve,reject)=>channel.send(m,e=>e?reject(e):resolve()));
  const sink=await append(journal),adapter=await import(config.oracleModule);
  const actors=new Set();globalThis[Symbol.for('product-qualification-actors')]=actors;
  let supervisionError;
  const fail=code=>{supervisionError??=code;for(const child of actors)void terminate(child);};
  const disconnected=()=>fail('parent_disconnected');channel.once('disconnect',disconnected);
  const timeout=()=>{fail('session_progress_timeout');if(channel.connected!==false)channel.disconnect();process.exitCode=1;};
  let watchdog=setTimeout(timeout,180000+config.supervision.progressMs+config.supervision.drainAllowanceMs);
  const monitor=setInterval(()=>{if([...actors].some(c=>c.stalled))fail('stalled_child_activity');},1000);
  let value,error;
  try{
    // Refresh metadata via the established storage child before any writer starts.
    config.ledger=(await inspect('inspect',{path:config.path})).value;
    value=await work(cells,session,{config,sink,prepareInput:c=>prepare(c,adapter),validateProbe:adapter.validateProbe},{ready:()=>send({type:'ready'}),start:()=>wait('start')});
  }catch(e){error=e.code??e.message;await sink.record(config.cell.id,'lane-failure',{code:error});}
  finally{clearInterval(monitor);for(const child of actors)await terminate(child);delete globalThis[Symbol.for('product-qualification-actors')];await sink.close();}
  error??=supervisionError;
  // No variable-size result, validation, ledger or diagnostic message reaches
  // the engine parent during observation. Lanes and writer have shut down.
  await send({type:'done'});await wait('export');
  await send({type:'result',value,error,sequence:sink.sequence});
  clearTimeout(watchdog);channel.off('message',receive);channel.off('disconnect',disconnected);channel.disconnect();
}

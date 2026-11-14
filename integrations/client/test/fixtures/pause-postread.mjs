import { deferred } from '../../../../tools/testing/deferred.mjs';
import fs from 'node:fs';
import promises from 'node:fs/promises';
import { syncBuiltinESMExports } from 'node:module';
import { join } from 'node:path';
import { observeHostedPause, withHostedPauseGate } from '../../hosted-pause.mjs';
import { startIfActive, runIfActive } from '../../control-state.mjs';
import { withWriteObserver } from '../../private-state.mjs';
const [role, root, sink, localGeneration, endpoint] = process.argv.slice(2);
const a = {root, endpoint:'http://127.0.0.1:1'}, b = {root, endpoint:'http://127.0.0.1:2'};
let clock = role === 'publisher' ? 0 : 200;
Object.defineProperty(performance, 'now', {value:()=>clock});
const commands = new Map();
process.on('message', ({kind,time})=>{if(time!==undefined)clock=time;commands.get(kind)?.resolve();});
const wait = kind => {const p=deferred();commands.set(kind,p);return p.promise;};
const notify = (kind, details={})=>process.send({kind,...details});
try {
 if(role==='publisher') {
  globalThis.fetch=async()=>Response.json({paused:true,generation:2,enforced:true});
  const link=promises.link;let hits=0;
  promises.link=async function(source,destination){
   try{return await link.call(this,source,destination);}
   catch(error){
    if(destination===join(root,'hosted-pause.gate')&&error.code==='EEXIST'&&hits++===0){
     const release=wait('release-waiter');notify('waiter');await release;
    }
    throw error;
   }
  };
  syncBuiltinESMExports();
  await withWriteObserver(async({path,kind})=>{
   if(kind==='write'&&path.includes('/hosted-pause-pending/'))notify('pending');
   if(kind==='write'&&path.endsWith('/2.true.json')&&!path.includes('/hosted-pause-pending/')){
    const release=wait('continue-publisher');notify('durable');await release;
   }
  },()=>observeHostedPause(a,'synthetic-token'));
  notify('done');
 } else {
  const nativeOpen=fs.openSync,nativeClose=fs.closeSync;
  const paths=new Map();let held=false,starts=0,afterCommit=0;
  fs.openSync=function(path,...args){const fd=nativeOpen.call(this,path,...args);paths.set(fd,String(path));return fd;};
  fs.closeSync=function(fd){
   const path=paths.get(fd);paths.delete(fd);const result=nativeClose.call(this,fd);
   if(!held&&path===join(root,'hosted-pause-rotated.json')){
    held=true;
    // Simulate OS preemption after the last authority read: no await,
    // microtask, callback hop, or production-code mutation is introduced.
    fs.writeFileSync(join(root,'sender-after-read'),'ready',{mode:0o600});
    const until=Date.now()+10000;
    while(!fs.existsSync(join(root,'release-sender'))){
     if(Date.now()>until)throw Error('synchronous_rendezvous_timeout');
     Atomics.wait(new Int32Array(new SharedArrayBuffer(4)),0,0,2);
    }
    clock=251;
   }
   return result;
  };
  syncBuiltinESMExports();
  const start=()=>{
   starts++;if(fs.existsSync(join(root,'committed')))afterCommit++;
   if(sink==='request')return fetch(endpoint+'/capture',{method:'POST',body:'synthetic paused-period text'});
   process.stdout.write('synthetic recalled context');
  };
  const result=await withHostedPauseGate(b,0,guard=>sink==='request'
   ? startIfActive(root,localGeneration,start,{guard})
   : runIfActive(root,localGeneration,start,{guard}));
  if(result.operation)await result.operation;
  notify('done',{starts,afterCommit});
 }
} catch(error){notify('failed',{error:error.message});process.exitCode=1;}
process.disconnect();

import { fork, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { performance } from 'node:perf_hooks';
import { observeLoop } from './engine.mjs';
import { stopSessionGroup } from './session-supervision.mjs';
const childUrl=new URL('./runner-child.mjs',import.meta.url);
export function actor(kind,config, {url=childUrl,stallMs=15000,forkChild=fork,quietWhenIdle=false,monitor:monitorEnabled=true,encoded:alreadyEncoded=false}={}) {
  const encoded=typeof config==='string'?config:JSON.stringify(config);
  const child=forkChild(fileURLToPath(url),[kind],{execArgv:['cold','writer-v4','lane'].includes(kind)?['--import',new URL('./startup-loop.mjs',import.meta.url).href]:[],env:{},detached:kind==='session',stdio:['pipe','ignore','pipe','ipc']});
  child.stdin.on('error',()=>{});child.stdin.end(encoded);
  const registry=(alreadyEncoded||typeof config==='object'&&config?.protocol==='P2-product-v4')?globalThis[Symbol.for('product-qualification-actors')]:null;registry?.add(child);
  const messages=[],waiters=[];let lastProgress=Date.now(),closed=false;
  child.stderr.on('data',()=>{});
  const deliver=m=>{lastProgress=Date.now();const i=waiters.findIndex(w=>(Array.isArray(w.type)?w.type.includes(m.type):w.type===m.type));
    if(i<0)messages.push(m);else waiters.splice(i,1)[0].resolve(m);};
  child.on('message',deliver);
  let resolveExit;
  child.exited=new Promise(r=>{resolveExit=r;});
  const finish=(code,signal)=>{if(closed)return;closed=true;registry?.delete(child);clearInterval(monitor);
    for(const w of waiters.splice(0))w.reject(Object.assign(Error('child_exit'),{code:'child_failed',exitCode:code,signal}));
    resolveExit({code,signal,disconnected:!child.connected});};
  child.on('error',error=>{
    child.ipcError=error;
    for(const w of waiters.splice(0))w.reject(error);
    // A failed spawn has no PID; an IPC error on a live process is not exit.
    if(child.pid===undefined)finish(null,null);
  });
  // stdio close may lag confirmed exit. Finish once exit and IPC disconnect are
  // both known, preserving final IPC delivery and the watchdog until real exit.
  let confirmedExit;
  child.on('exit',(code,signal)=>{confirmedExit={code,signal};if(!child.connected)finish(code,signal);});
  child.on('disconnect',()=>{
    for(const w of waiters.splice(0))w.reject(Error('child_disconnected'));
    if(confirmedExit)finish(confirmedExit.code,confirmedExit.signal);});
  child.on('close',finish);
  const monitor=monitorEnabled?setInterval(()=>{if((!quietWhenIdle||waiters.length||child.ipcError)&&Date.now()-lastProgress>stallMs){
    if(typeof config==='object'&&config?.protocol==='P2-product-v4'){child.stalled=true;child.emit('qualification-stalled',{kind,lastProgress});}
    else child.kill('SIGKILL');}},1000):null;
  child.wait=type=>{const i=messages.findIndex(m=>(Array.isArray(type)?type.includes(m.type):m.type===type));return i>=0?Promise.resolve(messages.splice(i,1)[0]):
    closed?Promise.reject(Error('child_closed')):!child.connected?Promise.reject(Error('child_disconnected')):child.ipcError?Promise.reject(child.ipcError):new Promise((resolve,reject)=>{
      if(quietWhenIdle&&!waiters.length)lastProgress=Date.now();waiters.push({type,resolve,reject});});};
  child.take=type=>{const found=messages.filter(m=>m.type===type);for(let i=messages.length-1;i>=0;i--)if(messages[i].type===type)messages.splice(i,1);return found;};
  if(kind==='session'){let stoppingTree;child.stopTree=()=>stoppingTree??=stopSessionGroup(child);}
  return child;
}
export async function terminate(child) {
  if(!child)return;
  if(child.stopTree){await child.stopTree();await child.exited;return;}
  if(child.exitCode===null&&child.signalCode===null)child.kill('SIGKILL');
  await child.exited;
}
export function fileChild(kind,...paths) {
  const r=spawnSync(process.execPath,[fileURLToPath(new URL('./io-child.mjs',import.meta.url)),kind,...paths],{env:{},encoding:'utf8',timeout:30000});
  if(r.status!==0||r.signal||r.error)throw Object.assign(Error('file_child_failed'),{code:'child_failed',exitCode:r.status});
  return {exitCode:r.status,value:JSON.parse(r.stdout)};
}
export async function coldAttempt(config,{signal}={}) {
  const {ledger,initialCounts,maintainerDiagnostics,signal:ignoredSignal,...runtimeConfig}=config;
  const encoded=JSON.stringify(runtimeConfig);
  if(Buffer.byteLength(encoded)>262144)throw Error('cold_configuration_size');
  const loop=observeLoop(),started=performance.now();let child,value,exit,launcherLoop;
  const abort=()=>child?.kill('SIGKILL');signal?.addEventListener('abort',abort,{once:true});
  try {child=actor('cold',config.protocol==='P2-product-v4'?runtimeConfig:encoded,{stallMs:config.protocol==='P2-product-v4'?config.supervision.stallMs:30000});await child.wait('window_end');launcherLoop=await loop.finish();child.send({type:'window_ack'});
    value=(await child.wait('result')).value;exit=await child.exited;
    if(exit.code!==0||exit.signal||!exit.disconnected)throw Error('cold_child_failed');}
  finally{signal?.removeEventListener('abort',abort);await terminate(child);launcherLoop??=await loop.finish();}
  return {...value,record:{...value.record,launcherLoop,processExit:exit,outerProcessLaunchAndSampleMs:performance.now()-started}};
}
export function attributeBlocks(record,samples,pid=process.pid) {
  if(record.hostPid!==undefined&&record.hostPid!==pid)return record;
  const source=samples.filter(s=>s.pid===pid);
  for(const block of record.hostLoop?.blocks??[]) {
    const before=source.findLast(s=>s.at<=block.startedAt),after=source.find(s=>s.at>=block.finishedAt);
    if(!before||!after){block.scheduling={coverage:'incomplete'};continue;}
    const threads=after.threads.flatMap(t=>{const old=before.threads.find(o=>o.tid===t.tid);return old?[{tid:t.tid,
      runtimeNs:t.runtimeNs-old.runtimeNs,runqueueNs:t.runqueueNs-old.runqueueNs,slices:t.slices-old.slices}]:[];});
    // A thread seen in only one bracketing sample has unknown scheduling for this block.
    const missingTids=[...new Set([...before.threads,...after.threads].map(t=>t.tid))].filter(tid=>!threads.some(t=>t.tid===tid));
    block.scheduling={coverage:missingTids.length?'incomplete':'complete',...(missingTids.length?{missingTids}:{}),
      sampleStartAt:before.at,sampleEndAt:after.at,threads,
      vm:Object.fromEntries(Object.keys(after.vm).map(k=>[k,after.vm[k]-before.vm[k]]))};
  }
  return record;
}
export async function startSampler(pids,directory=null,{monitor=true,signal}={}) {
  if(process.platform!=='linux')return {supported:false,async collect(){return [];},async stop(){return {supported:false,samples:[]};}};
  const child=actor('sample',null,{url:new URL('./io-child.mjs',import.meta.url),quietWhenIdle:true,monitor});
  const abort=()=>{if(child.exitCode===null&&child.signalCode===null)child.kill('SIGKILL');};
  signal?.addEventListener('abort',abort,{once:true});if(signal?.aborted)abort();
  try{await child.wait('ready');child.send({type:'start',pids,directory});await child.wait('started');}
  catch(e){signal?.removeEventListener('abort',abort);await terminate(child);throw e;}
  let previous=[],missing=0,dropped=0;
  const flush=()=>{const samples=child.take('samples').flatMap(m=>m.samples);
    for(const c of child.take('sample_coverage')){missing+=c.missing;dropped+=c.dropped;}
    const result=[...previous,...samples];previous=pids.flatMap(pid=>{const last=samples.findLast(s=>s.pid===pid);return last?[last]:[];});return result;};
  return {supported:true,async collect(){child.send({type:'collect'});await child.wait('collected');return flush();},
    async stop(){const watchdog=monitor?null:setTimeout(()=>child.kill('SIGKILL'),15000);try{child.send({type:'stop'});await child.wait('stopped');const exit=await child.exited;
      return {supported:true,exit,samples:flush(),missing,dropped,coverage:missing||dropped?'incomplete':'complete'};
    }finally{signal?.removeEventListener('abort',abort);clearTimeout(watchdog);await terminate(child);}}};
}

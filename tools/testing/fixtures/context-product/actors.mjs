import { fork, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { performance } from 'node:perf_hooks';
import { observeLoop } from './engine.mjs';
const childUrl=new URL('./runner-child.mjs',import.meta.url);
export function actor(kind,config, {url=childUrl,stallMs=15000}={}) {
  const encoded=typeof config==='string'?config:JSON.stringify(config);
  const child=fork(fileURLToPath(url),[kind],{execArgv:kind==='cold'?['--import',new URL('./startup-loop.mjs',import.meta.url).href]:[],env:{},stdio:['pipe','ignore','pipe','ipc']});
  child.stdin.on('error',()=>{});child.stdin.end(encoded);
  const messages=[],waiters=[];let lastProgress=Date.now(),closed=false;
  child.stderr.on('data',()=>{});
  const deliver=m=>{lastProgress=Date.now();const i=waiters.findIndex(w=>w.type===m.type);
    if(i<0)messages.push(m);else waiters.splice(i,1)[0].resolve(m);};
  child.on('message',deliver);
  let resolveExit;
  child.exited=new Promise(r=>{resolveExit=r;});
  const finish=(code,signal)=>{if(closed)return;closed=true;clearInterval(monitor);
    for(const w of waiters.splice(0))w.reject(Object.assign(Error('child_exit'),{code:'child_failed',exitCode:code}));
    resolveExit({code,signal,disconnected:!child.connected});};
  child.on('error',()=>finish(1,null));child.on('close',finish);
  const monitor=setInterval(()=>{if(Date.now()-lastProgress>stallMs){child.kill('SIGKILL');}},1000);
  child.wait=type=>{const i=messages.findIndex(m=>m.type===type);return i>=0?Promise.resolve(messages.splice(i,1)[0]):
    closed?Promise.reject(Error('child_closed')):new Promise((resolve,reject)=>waiters.push({type,resolve,reject}));};
  child.take=type=>{const found=messages.filter(m=>m.type===type);for(let i=messages.length-1;i>=0;i--)if(messages[i].type===type)messages.splice(i,1);return found;};
  return child;
}
export async function terminate(child) {
  if(!child)return;
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
  try {child=actor('cold',encoded,{stallMs:30000});await child.wait('window_end');launcherLoop=await loop.finish();child.send({type:'window_ack'});
    value=(await child.wait('result')).value;exit=await child.exited;
    if(exit.code!==0||exit.signal||!exit.disconnected)throw Error('cold_child_failed');}
  finally{signal?.removeEventListener('abort',abort);await terminate(child);launcherLoop??=await loop.finish();}
  return {...value,record:{...value.record,launcherLoop,processExit:exit,outerProcessLaunchAndSampleMs:performance.now()-started}};
}
export function attributeBlocks(record,samples,pid=process.pid) {
  const source=samples.filter(s=>s.pid===pid);
  for(const block of record.hostLoop?.blocks??[]) {
    const before=source.findLast(s=>s.at<=block.startedAt),after=source.find(s=>s.at>=block.finishedAt);
    if(!before||!after){block.scheduling={coverage:'incomplete'};continue;}
    const threads=after.threads.flatMap(t=>{const old=before.threads.find(o=>o.tid===t.tid);return old?[{tid:t.tid,
      runtimeNs:t.runtimeNs-old.runtimeNs,runqueueNs:t.runqueueNs-old.runqueueNs,slices:t.slices-old.slices}]:[];});
    block.scheduling={coverage:'complete',sampleStartAt:before.at,sampleEndAt:after.at,threads,
      vm:Object.fromEntries(Object.keys(after.vm).map(k=>[k,after.vm[k]-before.vm[k]]))};
  }
  return record;
}
export async function startSampler(pids,directory=null) {
  if(process.platform!=='linux')return {supported:false,current(){return [];},async stop(){return {supported:false,samples:[]};}};
  const child=actor('sample',null,{url:new URL('./io-child.mjs',import.meta.url)});await child.wait('ready');child.send({type:'start',pids,directory});
  const samples=[],flush=()=>{samples.push(...child.take('sample').map(m=>m.sample));return samples;};
  return {supported:true,current:flush,async stop(){try{child.send({type:'stop'});await child.wait('stopped');const exit=await child.exited;
    return {supported:true,exit,samples:flush(),missing:child.take('sample_missing').length};}finally{await terminate(child);}}};
}

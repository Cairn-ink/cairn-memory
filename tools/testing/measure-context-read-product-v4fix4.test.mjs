import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { EventEmitter } from 'node:events';
import { spawnSync,fork } from 'node:child_process';
import { readFile,writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { createTestWorkspace } from './workspace.mjs';
const base=process.env.P2D_V4FIX4_BASE,directory=new URL('./fixtures/context-product/',import.meta.url);
const settle=()=>new Promise(r=>setImmediate(r));
async function load(name,overrides={},context){
  const url=new URL(name,directory);let source;
  if(base){const r=spawnSync('git',['show',base+':tools/testing/fixtures/context-product/'+name],{encoding:'utf8'});assert.equal(r.status,0,r.stderr);source=r.stdout;}
  else source=await readFile(url,'utf8');
  const dependency=async spec=>{
    const ns=overrides[spec]??await import(spec.startsWith('.')?new URL(spec,url).href:spec);
    const m=new vm.SyntheticModule(Object.keys(ns),function(){for(const [key,value] of Object.entries(ns))this.setExport(key,value);},{context});await m.link(()=>{});await m.evaluate();return m;
  };
  const m=new vm.SourceTextModule(source,{context,identifier:url.href,initializeImportMeta:meta=>{meta.url=url.href;},importModuleDynamically:dependency});
  await m.link(dependency);await m.evaluate();return m.namespace;
}
if(!vm.SourceTextModule){
  test('round4 regressions in VM-enabled isolated runner',()=>{
    const env={...process.env};delete env.NODE_TEST_CONTEXT;
    const r=spawnSync(process.execPath,['--experimental-vm-modules','--test',fileURLToPath(import.meta.url)],{encoding:'utf8',env});assert.equal(r.status,0,r.stdout+r.stderr);
  });
}else{
function timers(){
  const timeouts=new Set(),intervals=new Set();
  const schedule=(fn,ms)=>{const t={fn,ms};timeouts.add(t);return t;},cancel=t=>timeouts.delete(t);
  return {timeouts,intervals,schedule,cancel,repeat:fn=>{intervals.add(fn);return fn;},clearRepeat:fn=>intervals.delete(fn),fire(t){timeouts.delete(t);t.fn();}};
}
function channel(){const c=new EventEmitter();c.connected=true;c.messages=[];c.send=(m,cb)=>{c.messages.push(m);cb?.();};c.disconnect=()=>{c.connected=false;c.emit('disconnect');};return c;}
function native(pid){const c=channel();c.pid=pid;c.exitCode=null;c.signalCode=null;c.stdin={on(){},end(){}};c.stderr=new EventEmitter();c.kills=[];
  c.kill=s=>{c.kills.push(s);c.exitCode=null;c.signalCode=s;c.connected=false;c.emit('exit',null,s);c.emit('disconnect');};return c;}
async function childCase({work,inspect=async()=>({value:{}})}){
  const c=channel(),clock=timers(),rows=[];
  const ctx=vm.createContext({process:{exitCode:0},console,setTimeout:clock.schedule,clearTimeout:clock.cancel,setInterval:clock.repeat,clearInterval:clock.clearRepeat});
  const mod=await load('v4-session-child.mjs',{},ctx);
  const run=mod.sessionChild({config:{cell:{id:0},supervision:{stallMs:100,progressMs:200,drainAllowanceMs:50},oracleModule:'data:text/javascript,export const validateProbe=()=>true;'},journal:{},cells:[],session:{}},{channel:c,work:(a,b,c,d)=>work(a,b,c,d,ctx),inspect,
    append:async()=>({sequence:rows.length,record:async(...row)=>rows.push(row),close:async()=>{}}),
    schedule:clock.schedule,cancel:clock.cancel,repeat:clock.repeat,clearRepeat:clock.clearRepeat});
  run.catch(()=>{});await settle();return {c,clock,rows,ctx,run};
}
test('round4 stall preserves healthy lane settlement and writer telemetry until bounded drain',async()=>{
  let finish,actors;
  const stalled=native(11),healthy=native(12),writer=native(13),events=[];
  for(const child of [stalled,healthy,writer]){child.exited=new Promise(r=>child.once('exit',(code,signal)=>r({code,signal})));child.kill=s=>{child.kills.push(s);child.signalCode=s;child.connected=false;child.emit('exit',null,s);};}
  stalled.stalled=true;
  const f=await childCase({work:async(c,s,{sink},hooks,ctx)=>{
    actors=vm.runInContext("globalThis[Symbol.for('product-qualification-actors')]",ctx);for(const a of [stalled,healthy,writer])actors.add(a);
    await new Promise(r=>{finish=r;});
    events.push('settled');await sink.record(0,'healthy-read',{});await sink.record(0,'writer-seal',{});
    for(const a of [healthy,writer]){actors.delete(a);a.exitCode=0;a.emit('exit',0,null);}
    actors.delete(stalled);throw Object.assign(Error('child_exit'),{code:'child_failed'});
  }});
  for(const tick of f.clock.intervals)tick();await settle();
  try{assert.deepEqual(healthy.kills,[]);assert.deepEqual(writer.kills,[]);assert.deepEqual(stalled.kills,['SIGTERM']);}
  finally{finish?.();}
  await settle();assert.deepEqual(events,['settled']);assert.ok(f.rows.some(r=>r[1]==='healthy-read'));assert.ok(f.rows.some(r=>r[1]==='writer-seal'));
  f.c.emit('message','export');await f.run;assert.equal(f.c.messages.at(-1).error,'stalled_child_activity');assert.ok(f.rows.some(r=>r[1]==='session-supervision'&&r[2].code==='stalled_child_activity'));
});
test('round4 drain allowance escalates only actors still unresponsive at its boundary',async()=>{
  const stalled=native(15),unresponsive=native(16);stalled.stalled=true;
  for(const child of [stalled,unresponsive])child.exited=new Promise(r=>child.once('exit',(code,signal)=>r({code,signal})));
  const f=await childCase({work:async(a,b,c,d,ctx)=>{
    const actors=vm.runInContext("globalThis[Symbol.for('product-qualification-actors')]",ctx);actors.add(stalled);actors.add(unresponsive);
    await new Promise(()=>{});
  }});
  for(const tick of f.clock.intervals)tick();await settle();assert.deepEqual(unresponsive.kills,[]);assert.deepEqual(stalled.kills,['SIGTERM']);
  f.clock.fire([...f.clock.timeouts].find(t=>t.ms===50));await settle();assert.deepEqual(unresponsive.kills,['SIGTERM']);assert.ok(f.c.messages.some(m=>m.type==='done'));
  f.c.emit('message','export');await f.run;assert.equal(f.clock.intervals.size,0);assert.equal(f.clock.timeouts.size,0);
});
test('round4 stop during input preparation prevents further lane admission',async()=>{
  const validation=await import('./fixtures/context-product/v4-validation.mjs');
  const {sessionWork}=await load('v4-session-work.mjs',{'./v4-validation.mjs':{...validation,validateSessionRegistration:()=>({decision:'passed'})}});
  let stopReason,clock=0,reads=0;const lanes=[];
  const run=sessionWork([],{availability:[{id:'a',releaseMs:0,methodLabel:'c12',language:'mixed',intent:'current'}],batches:[]},{config:{cell:{id:0,schema:18}},sink:{record:async()=>{}},prepareInput:async c=>{stopReason='stalled_child_activity';return c;}},{
    now:()=>clock,wait:async ms=>{clock+=ms===1?180001:ms;},stopped:()=>stopReason,
    makeLane:()=>{let exit;const lane={connected:true,pid:lanes.length,exited:new Promise(r=>{exit=r;}),send:m=>{if(m.type==='read')reads++;if(m.type==='stop'){lane.connected=false;exit({code:0});}},wait:async type=>type==='ready'?{}:type==='result'?{attribution:{}}:{type:'read-result',id:'a',value:{record:{}}}};lanes.push(lane);return lane;},
    makeWriter:async()=>({child:{take:()=>[]},flush(){},start(){},stop:async()=>({writerEndAt:clock,calls:[],diagnostics:{}})}),
  });
  await assert.rejects(run,/stalled_child_activity/);assert.equal(reads,0);assert.ok(lanes.every(l=>!l.connected));
});
test('round4 watchdog terminates unresolved preparation, sends done, settles waits and clears monitors',async()=>{
  const f=await childCase({inspect:()=>new Promise(()=>{}),work:()=>assert.fail('preparation unresolved')});
  const deadline=[...f.clock.timeouts][0];f.clock.fire(deadline);await settle();
  for(const timer of [...f.clock.timeouts])f.clock.fire(timer);await settle();
  // A terminal message is required before export, even if preparation never settles.
  assert.ok(f.c.messages.some(m=>m.type==='done'));assert.equal(f.clock.intervals.size,0);
  f.c.emit('message','export');await f.run;assert.equal(f.c.messages.at(-1).error,'session_progress_timeout');assert.equal(f.clock.timeouts.size,0);
});
test('round4 independent parent deadline ends a connected child that never sends done',async()=>{
  const clock=timers(),c=native(41),actors=await load('actors.mjs'),child=actors.actor('control',null,{forkChild:()=>c,monitor:false});
  c.emit('message',{type:'ready'});let ended=false,reclaimed=false;
  const mod=await load('v4-session.mjs',{'./actors.mjs':actors});
  const run=mod.sharedSession([],{},{config:{cell:{id:0},supervision:{progressMs:200,drainAllowanceMs:50}},sink:{delegate:async()=>({}),reclaim:async()=>{reclaimed=true;},record:async()=>{}}},{makeSession:()=>child,
    schedule:clock.schedule,cancel:clock.cancel,preparePump:async()=>({start:()=>({stop:async()=>[]}),report:async()=>[]}),makeSampler:async()=>({stop:async()=>({samples:[]})}),loopFactory:()=>({finish:async()=>({blocks:[]})})});
  run.then(()=>{ended=true;},()=>{ended=true;});await settle();
  for(const timer of [...clock.timeouts])clock.fire(timer);await settle();
  try{assert.equal(ended,true);assert.equal(reclaimed,true);}finally{if(!ended)c.kill('SIGKILL');}
  await assert.rejects(run,/session_parent_timeout|child_exit/);assert.equal(clock.timeouts.size,0);
});
test('round4 escalation uses TERM then KILL and confirms exit',async()=>{
  const {escalateActor}=await import('./fixtures/context-product/session-supervision.mjs'),clock=timers(),signals=[];let exit;
  const child={exitCode:null,signalCode:null,exited:new Promise(r=>{exit=r;}),kill:s=>{signals.push(s);if(s==='SIGKILL')exit({signal:s});}};
  const stopping=escalateActor(child,{schedule:clock.schedule,cancel:clock.cancel});
  assert.deepEqual(signals,['SIGTERM']);for(const timer of [...clock.timeouts])clock.fire(timer);await stopping;
  assert.deepEqual(signals,['SIGTERM','SIGKILL']);assert.equal(clock.timeouts.size,0);
});
test('round4 lost export recovers durable journal sequence and exact total',async t=>{
  const w=createTestWorkspace(t),path=join(w.path,'report.jsonl');
  const mod=await load('report.mjs'),sink=await mod.createReportSink(path,{});
  await sink.record(0,'before',{});const lease=await sink.delegate(),child=await mod.appendSessionRecords(lease);
  await child.record(0,'child',{});await child.close();await sink.reclaim(undefined);
  await sink.record(0,'after',{});await sink.finish('inconclusive');
  const rows=(await readFile(path+'.records.jsonl','utf8')).trim().split('\n').map(JSON.parse).filter(r=>r.type==='record');
  assert.deepEqual(rows.map(r=>r.sequence),[1,2,3]);assert.equal(JSON.parse((await readFile(path,'utf8')).trim().split('\n').at(-1)).records,rows.length);
});
test('round4 IPC loss rejects pending and future actor waits before confirmed exit',async()=>{
  const mod=await load('actors.mjs'),c=native(21),child=mod.actor('control',null,{monitor:false,forkChild:()=>c});
  const waiting=child.wait('done');let rejected=false;waiting.catch(()=>{rejected=true;});c.disconnect();await settle();
  try{assert.equal(rejected,true);}finally{c.kill('SIGKILL');}
  await assert.rejects(waiting,/disconnect|child_exit/);await assert.rejects(child.wait('done'));await child.exited;
});
test('round4 session group ownership survives coordinator exit and confirms every descendant',async()=>{
  const mod=await load('actors.mjs'),c=native(31);let options;
  const child=mod.actor('session','{}',{monitor:false,encoded:true,forkChild:(url,args,o)=>{options=o;return c;}});
  assert.equal(options.detached,true);assert.equal(typeof child.stopTree,'function');
  let confirmed=false,release;child.stopTree=()=>new Promise(r=>{release=()=>{confirmed=true;r();};});
  c.kill('SIGKILL');await child.exited;let returned=false;
  const cleanup=mod.terminate(child).then(()=>{returned=true;});await settle();assert.equal(returned,false);release();await cleanup;assert.equal(confirmed,true);
});
test('round4 production parent waits for descendant confirmation before reclaim or return',async()=>{
  const actors=await load('actors.mjs'),mod=await load('v4-session.mjs',{'./actors.mjs':actors}),c=native(51);
  const child=actors.actor('control',null,{monitor:false,forkChild:()=>c});let release,reclaimed=false,returned=false,cleanupStarted=false;
  child.stopTree=()=>{cleanupStarted=true;return new Promise(r=>{release=r;});};
  // A coordinator may have exited while its lane group remains alive.
  const run=mod.sharedSession([],{},{config:{cell:{id:0}},sink:{delegate:async()=>({}),reclaim:async()=>{reclaimed=true;},record:async()=>{}}},{makeSession:()=>child,
    preparePump:async()=>({start:()=>({stop:async()=>[]}),report:async()=>[]}),makeSampler:async()=>({stop:async()=>({samples:[]})}),loopFactory:()=>({finish:async()=>({blocks:[]})})});
  run.then(()=>{returned=true;},()=>{returned=true;});await settle();c.kill('SIGKILL');await settle();
  try{assert.equal(cleanupStarted,true);assert.equal(reclaimed,false);assert.equal(returned,false);}
  finally{release?.();child.stopTree=async()=>{};}
  await assert.rejects(run);assert.equal(reclaimed,true);
});
test('round4 unconfirmed descendant cleanup retains journal lease and clears parent monitors',async()=>{
  const actors=await load('actors.mjs'),mod=await load('v4-session.mjs',{'./actors.mjs':actors}),c=native(61),clock=timers();
  const child=actors.actor('control',null,{monitor:false,forkChild:()=>c});let reclaimed=false,samplerStopped=false;
  child.stopTree=async()=>{throw Error('descendants_unconfirmed');};c.emit('message',{type:'ready'});
  const run=mod.sharedSession([],{},{config:{cell:{id:0}},sink:{delegate:async()=>({}),reclaim:async()=>{reclaimed=true;},record:async()=>{}}},{makeSession:()=>child,
    schedule:clock.schedule,cancel:clock.cancel,preparePump:async()=>({start:()=>({stop:async()=>[]}),report:async()=>[]}),makeSampler:async()=>({stop:async()=>{samplerStopped=true;return {samples:[]};}}),loopFactory:()=>({finish:async()=>({blocks:[]})})});
  run.catch(()=>{});await settle();c.kill('SIGKILL');
  await assert.rejects(run,e=>e.cleanup?.descendantsUnconfirmed===true);assert.equal(reclaimed,false);assert.equal(samplerStopped,true);assert.equal(clock.timeouts.size,0);
});
test('round4 aborted sampler startup confirms exit instead of leaving an unowned child',async()=>{
  const actors=await load('actors.mjs'),controller=new AbortController();controller.abort();let sampler,error;
  try{sampler=await actors.startSampler([process.pid],null,{monitor:false,signal:controller.signal});}catch(e){error=e;}
  finally{await sampler?.stop();}
  assert.ok(error);assert.equal(sampler,undefined);
});
test('round4 lane stops on IPC loss and confirms sampler stop',async()=>{
  const c=channel();let samplerStopped=false,wake;
  const clock={setTimeout:fn=>{wake=fn;}};
  const ctx=vm.createContext({process:c,console,setTimeout:clock.setTimeout});
  const actors=await import('./fixtures/context-product/actors.mjs');
  const mod=await load('v4-lane.mjs',{'./actors.mjs':{...actors,startSampler:async()=>({stop:async()=>{samplerStopped=true;return {};}})}},ctx);
  const run=mod.laneProcess({oracleModule:'data:text/javascript,export const validate=()=>true;'}, {channel:c,makeSampler:async()=>({stop:async()=>{samplerStopped=true;return {};}}),wait:()=>new Promise(r=>{wake=r;})});
  run.catch(()=>{});await settle();c.disconnect();wake();await settle();
  assert.equal(samplerStopped,true);await run;
});
// Actual subprocess lifecycle only: no engine workload or timing qualification.
test('round4 crashed coordinator cannot leave lane, sampler or writer running',async t=>{
  const w=createTestWorkspace(t),path=join(w.path,'tree.mjs');
  await writeFile(path,`import {fork} from 'node:child_process';
const role=process.argv[2];
if(role==='lane'){
 const sampler=fork(new URL(import.meta.url),['sampler'],{execArgv:[],env:{},stdio:['ignore','ignore','ignore','ipc']});
 sampler.once('message',()=>process.send({type:'ready',pids:[process.pid,sampler.pid]}));setInterval(()=>{},1000);
}else if(role==='session'){
 const children=['lane','writer'].map(role=>fork(new URL(import.meta.url),[role],{execArgv:[],env:{},stdio:['ignore','ignore','ignore','ipc']}));
 const rows=await Promise.all(children.map(c=>new Promise(r=>c.once('message',r))));process.send({type:'ready',pids:rows.flatMap(r=>r.pids)});setInterval(()=>{},1000);
}else{process.send({type:'ready',pids:[process.pid]});setInterval(()=>{},1000);}
`);
  const mod=await load('actors.mjs'),child=mod.actor('session',null,{url:new URL('file://'+path),monitor:false,
    // Isolate the counterfactual too, so assertion failure cannot orphan actors.
    forkChild:(url,args,options)=>fork(url,args,{...options,detached:true})});let pids=[];
  const watchdog=setTimeout(()=>child.kill('SIGKILL'),5000);
  try{
    pids=(await child.wait('ready')).pids;child.kill('SIGKILL');await child.exited;await mod.terminate(child);
    for(const pid of pids){let alive=true;try{const stat=await readFile('/proc/'+pid+'/stat','utf8');alive=!['Z','X'].includes(stat.slice(stat.lastIndexOf(')')+2).split(' ')[0]);}catch(e){if(e.code!=='ENOENT')throw e;alive=false;}assert.equal(alive,false,'descendant '+pid+' still running');}
  }finally{clearTimeout(watchdog);for(const pid of pids)try{process.kill(pid,'SIGKILL');}catch(e){if(e.code!=='ESRCH')throw e;}if(child.exitCode===null&&child.signalCode===null)child.kill('SIGKILL');const {stopSessionGroup}=await import('./fixtures/context-product/session-supervision.mjs');await stopSessionGroup(child);await child.exited;}
});
}

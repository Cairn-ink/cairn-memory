import test from 'node:test';
import assert from 'node:assert/strict';
import { fork } from 'node:child_process';
import { once } from 'node:events';
import { EventEmitter } from 'node:events';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { createTestWorkspace } from './workspace.mjs';
import { createReportSink,appendSessionRecords } from './fixtures/context-product/report.mjs';
import { actor } from './fixtures/context-product/actors.mjs';
import { sessionChild } from './fixtures/context-product/v4-session-child.mjs';
const settle=()=>new Promise(resolve=>setImmediate(resolve));
test('round3 leased journal streams child records without overwriting prior or subsequent records',async t=>{
  const w=createTestWorkspace(t),path=join(w.path,'report.jsonl'),sink=await createReportSink(path,{protocol:{version:'P2-product-v4'}});
  await sink.record(0,'before',{value:1});const lease=await sink.delegate();
  await assert.rejects(sink.record(0,'forbidden',{}),/journal_delegated/);
  const child=await appendSessionRecords(lease);await child.record(0,'child',{value:2});
  // Raw evidence is durable before the parent reclaims the lease.
  assert.equal((await readFile(path+'.records.jsonl','utf8')).trim().split('\n').length,3);
  await child.close();await sink.reclaim(child.sequence);await sink.record(0,'after',{value:3});await sink.finish('passed');
  const rows=(await readFile(path+'.records.jsonl','utf8')).trim().split('\n').map(JSON.parse).filter(r=>r.type==='record');
  assert.deepEqual(rows.map(r=>r.sequence),[1,2,3]);assert.deepEqual(rows.map(r=>r.record.value),[1,2,3]);
  assert.equal(JSON.parse((await readFile(path,'utf8')).trim().split('\n').at(-1)).records,3);
});
for(const failed of [false,true])test(`round3 session child ${failed?'failure':'success'} exports variable data only after shutdown and export control`,async()=>{
  const channel=new EventEmitter(),messages=[],records=[];let started=false,closed=false,disconnected=false;
  channel.send=(message,callback)=>{messages.push(message);callback();};channel.disconnect=()=>{disconnected=true;};
  const run=sessionChild({config:{cell:{id:0},oracleModule:'data:text/javascript,export const validateProbe=()=>true;',supervision:{progressMs:1000,drainAllowanceMs:100}},cells:[],session:{},journal:{}},{channel,inspect:async()=>({value:{}}),
    append:async()=>({sequence:1,record:async(...args)=>records.push(args),close:async()=>{closed=true;}}),
    work:async(cells,session,callbacks,{ready,start})=>{await ready();await start();started=true;await callbacks.sink.record(0,'raw',{payload:'x'.repeat(4096)});if(failed)throw Error('lane_failed');return {payload:'x'.repeat(4096)};},
  });
  await settle();assert.deepEqual(messages,[{type:'ready'}]);assert.equal(started,false);
  channel.emit('message','start');await settle();assert.equal(closed,true);assert.equal(started,true);
  assert.deepEqual(messages,[{type:'ready'},{type:'done'}]);assert.ok(records.length>0);assert.equal(disconnected,false);
  channel.emit('message','export');await run;assert.equal(messages.at(-1).type,'result');assert.equal(messages.at(-1).sequence,1);
  assert.equal(messages.at(-1).error,failed?'lane_failed':undefined);assert.equal(disconnected,true);
});

import { sharedSession } from './fixtures/context-product/v4-session.mjs';
import { observeLoop } from './fixtures/context-product/engine.mjs';
for(const phase of ['sync-engine','async-engine','post-await-validation','parent-serialization','drain','pump-close','supervisor-close','lane-shutdown'])test(`round3 unfiltered parent window: ${phase}`,async()=>{
  let clock=0,active=false,finished=false,resolveExit;const rows=[],controls=[];
  const block=name=>{if(phase===name)clock+=150;};
  const sink={async delegate(){return {};},async reclaim(){assert.equal(active,false);},async record(cell,series,record){await Promise.resolve();assert.equal(finished,true);if(series==='session-parent-loop'){assert.ok(Number.isFinite(record.hostLoop.maxMs));block('post-await-validation');}rows.push({series,record});}};
  const config={cell:{id:0},toJSON(){assert.equal(active,false);block('parent-serialization');return {cell:{id:0}};}};
  const child={connected:true,exited:new Promise(resolve=>{resolveExit=resolve;}),send(m){controls.push(m);if(m==='export'){assert.equal(finished,true);child.connected=false;resolveExit({code:0,signal:null});}},async wait(type){
    if(type==='done'){assert.equal(active,true);block('sync-engine');await Promise.resolve().then(()=>block('async-engine'));block('lane-shutdown');}
    if(type==='result')return {sequence:0,value:{records:[],targets:[],availabilityRecords:[],writerResult:{calls:[],hostLoop:{},diagnostics:{}},extraLoops:[],validation:{decision:'passed'}}};
    return {type:'ready'};
  }};
  await sharedSession([],{},{config,sink},{makeSession:encoded=>{assert.equal(active,false);JSON.parse(encoded);return child;},
    preparePump:async()=>({start(){assert.equal(active,true);return {async stop(){block('drain');await Promise.resolve();block('pump-close');await Promise.resolve();block('supervisor-close');return [];}};},async report(){assert.equal(finished,true);return [];}}),
    makeSampler:async()=>({async stop(){assert.equal(finished,true);return {coverage:'complete',samples:[]};}}),
    loopFactory:()=>{active=true;const observed=observeLoop({timers:false,now:()=>clock});return {pause(){assert.fail('observer exclusion');},resume(){assert.fail('observer exclusion');},async finish(){const value=await observed.finish();active=false;finished=true;return value;}};},
  });
  const observed=rows.find(r=>r.series==='session-parent-loop').record.hostLoop;
  assert.equal(observed.maxMs,['post-await-validation','parent-serialization'].includes(phase)?0:150);
  assert.equal(clock,150);assert.deepEqual(controls,['start','export']);
});

test('round3 startup cancellation drains the child before export',async()=>{
  const channel=new EventEmitter(),messages=[];let closed=false;
  channel.send=(message,callback)=>{messages.push(message);callback();};channel.disconnect=()=>{};
  const run=sessionChild({config:{cell:{id:0},oracleModule:'data:text/javascript,export const validateProbe=()=>true;',supervision:{progressMs:1000,drainAllowanceMs:100}},cells:[],session:{},journal:{}},{channel,inspect:async()=>({value:{}}),
    append:async()=>({sequence:0,record:async()=>{},close:async()=>{closed=true;}}),
    work:async(cells,session,callbacks,{ready,start})=>{await ready();await start();assert.fail('cancelled session started');},
  });
  await settle();channel.emit('message','cancel');await settle();assert.equal(closed,true);
  assert.deepEqual(messages,[{type:'ready'},{type:'done'}]);channel.emit('message','export');await run;
  assert.equal(messages.at(-1).error,'session_cancelled');
});
test('round3 parent startup failure cancels before observation and releases the journal lease',async()=>{
  const controls=[];let reclaimed=false,resolveExit;
  const child={connected:true,exited:new Promise(resolve=>{resolveExit=resolve;}),send(m){controls.push(m);if(m==='export'){child.connected=false;resolveExit({code:0,signal:null});}},async wait(type){return type==='result'?{sequence:0,error:'session_cancelled'}:{type:typeof type==='string'?type:'ready'};}};
  await assert.rejects(sharedSession([],{},{config:{cell:{id:0}},sink:{delegate:async()=>({}),reclaim:async()=>{reclaimed=true;}}},{makeSession:()=>child,preparePump:async()=>{throw Error('configure_failed');},loopFactory:()=>assert.fail('startup entered observation')}),/configure_failed/);
  assert.deepEqual(controls,['cancel','export']);assert.equal(reclaimed,true);
});

test('round3 simultaneous child journal records retain complete ordered frames',async t=>{
  const w=createTestWorkspace(t),path=join(w.path,'report.jsonl'),sink=await createReportSink(path,{}),lease=await sink.delegate(),child=await appendSessionRecords(lease);
  await Promise.all(Array.from({length:16},(_,i)=>child.record(0,'parallel',{i,payload:'x'.repeat(16384)})));
  await child.close();await sink.reclaim(child.sequence);await sink.finish('passed');
  const rows=(await readFile(path+'.records.jsonl','utf8')).trim().split('\n').map(JSON.parse).slice(1);
  assert.deepEqual(rows.map(r=>r.sequence),Array.from({length:16},(_,i)=>i+1));
  assert.deepEqual(rows.map(r=>r.record.i),Array.from({length:16},(_,i)=>i));assert.ok(rows.every(r=>r.record.payload.length===16384));
});

test('round3 sampler cancels its active timer when its lane parent exits',async()=>{
  const child=fork(new URL('./fixtures/context-product/io-child.mjs',import.meta.url),['sample'],{env:{},execArgv:[],stdio:['ignore','ignore','pipe','ipc']});
  const exited=once(child,'exit');let watchdog,stderr='';child.stderr.on('data',chunk=>{stderr+=chunk;});
  const message=()=>Promise.race([once(child,'message'),exited.then(([code,signal])=>{throw Error('sampler_exit '+code+' '+signal+' '+stderr);})]);
  try{
    watchdog=setTimeout(()=>child.kill('SIGKILL'),5000);
    await message();const started=message();child.send({type:'start',pids:[]});assert.equal((await started)[0].type,'started');
    child.disconnect();const [code,signal]=await exited;assert.equal(code,0);assert.equal(signal,null);
  }finally{clearTimeout(watchdog);if(child.exitCode===null&&child.signalCode===null)child.kill('SIGKILL');await exited;}
});

test('round3 actor retains final IPC and waits for confirmed exit independently of stdio close',async()=>{
  const native=new EventEmitter();native.pid=123;native.connected=true;native.stdin={on(){},end(){}};native.stderr=new EventEmitter();
  const child=actor('control',null,{forkChild:()=>native,monitor:false});let exited=false;
  child.exited.then(()=>{exited=true;});native.emit('exit',0,null);await Promise.resolve();assert.equal(exited,false);
  native.emit('message',{type:'result',value:42});native.connected=false;native.emit('disconnect');
  assert.equal((await child.wait('result')).value,42);assert.equal((await child.exited).code,0);
  const other=new EventEmitter();other.pid=124;other.connected=true;other.stdin={on(){},end(){}};other.stderr=new EventEmitter();
  const pending=actor('control',null,{forkChild:()=>other,monitor:false});let confirmed=false;pending.exited.then(()=>{confirmed=true;});
  other.connected=false;other.emit('disconnect');await Promise.resolve();assert.equal(confirmed,false);
  other.emit('exit',1,null);assert.equal((await pending.exited).code,1);
});

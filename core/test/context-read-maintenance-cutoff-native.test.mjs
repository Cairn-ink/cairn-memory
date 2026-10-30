import { testClock } from '../testing/context-product-test-clock.mjs';
import test from 'node:test';
import { spawn,spawnSync } from 'node:child_process';
import { existsSync,readFileSync,statSync } from 'node:fs';
import { setTimeout as realDelay } from 'node:timers/promises';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { fixture,ok } from '../testing/context-read-fixture.mjs';
import { personal,configured } from '../testing/context-product-owner-fixture.mjs';
import { createMaintenancePumpRuntime } from '../context-product-pump.mjs';
import * as productReader from '../context-product-reader.mjs';
const { createProductReaderRuntime,openContextIndexMaintainer } = productReader;
import { PRODUCT_SIDECAR_SUFFIX } from '../context-product-sidecar.mjs';
function nativeTest(name,body) {
  test(name,async t=>{
    const abort=new AbortController();
    try {await Promise.race([body(t),realDelay(30000,undefined,{signal:abort.signal}).then(()=>assert.fail('native_real_time_watchdog'))]);}
    finally {abort.abort();}
  });
}
const flush=async()=>{for(let i=0;i<30;i++)await Promise.resolve();};
async function reached(control,drive) {
  const deadline=new Date().getTime()+30000;
  while(!Atomics.load(control,1)){
    await drive();
    if(new Date().getTime()>deadline)throw Error('native_commit_barrier_not_reached');
    await realDelay(5);
  }
}
for(const mode of ['DELETE','WAL'])for(const phase of ['batch','verification','publication'])for(const point of ['before','after'])
nativeTest(`cutoff native ${mode} ${phase} ${point} COMMIT: atomic SQL oracle and resumable generation`,async t=>{
  const f=fixture(t);for(let i=0;i<12;i++)f.admit('cutoff orchard '+i+' '+Array.from({length:30},(_,n)=>'term'+n).join(' '),personal);
  const service=configured(t,f.path,[personal],{service:true}),control=new Int32Array(new SharedArrayBuffer(32));control[0]=1;
  const payload=new SharedArrayBuffer(192*1024),options={...service.options,wal:mode==='WAL',sidecarJournalMode:mode,
    host:{moduleUrl:new URL('../testing/context-product-cutoff-host.mjs',import.meta.url).href,
      configuration:{...service.options.host.configuration,cutoffBarrier:control.buffer,cutoffPayload:payload,cutoffPhase:phase,cutoffPoint:point}}};
  // Initialize the cache outside the pump turn; this is fixture setup, not uncharged production work.
  // The killed turn resumes a real signed checkpoint and still pays its own resident open.
  const warm=await openContextIndexMaintainer({...options,host:service.options.host});
  try {ok(await warm.refreshContextIndex({readSet:[personal],types:['memory'],intent:'current',mode:'lexical',budget:{maxItems:1,maxMs:5000}},service.token));}
  finally {await warm.close();}
  let serial=0;const now=testClock.now;
  const timers=new Map(),setTimer=(fn,ms)=>{const id={n:++serial,unref(){}};timers.set(id,{fn,at:now()+ms});return id;};
  const clearTimer=id=>timers.delete(id),reader=createProductReaderRuntime({maintenance:true,now:()=>BigInt(Math.floor(now()*1e6)),setTimer,clearTimer});
  let pause=mode==='DELETE' && phase==='batch' && point==='before';
  const open=(...args)=>{if(pause){pause=false;Atomics.wait(new Int32Array(new SharedArrayBuffer(4)),0,0,2000);}return reader(...args);};
  const renew=createMaintenancePumpRuntime({now,setTimer,clearTimer,open,cutoffQualified:()=>true});
  const p=renew({supervisor:service.supervisor,id:'native-cutoff',window:{id:'window',endsAtMonoMs:Math.floor(now())+60000,usedItems:0,usedMs:0},
    budgets:{maxItems:10000,maxMs:60000},quantum:{maxItems:1024,maxMs:1500},pollMs:1000,renewalMs:60000,
    serviceCredential:service.token,projections:[{options,types:['memory']}]});
  f.workspace.defer(async()=>{Atomics.store(control,2,1);Atomics.notify(control,2);
    await p.close().catch(()=>{});await service.supervisor.close();});
  let operation,settled=true,turnError;
  await reached(control,async()=>{
    if(turnError)throw turnError;
    if(!settled)return;
    const [id,timer]=[...timers].sort((a,b)=>a[1].at-b[1].at)[0]??[];
    if(timer && timer.at>now())await testClock.advance(Math.ceil(timer.at-now()));
    const status=p.getStatus();assert.notEqual(status.state,'failed','native_startup_clock_ignores_real_scheduling_pause');
    if(timer){
      timers.delete(id);settled=false;
      operation=Promise.resolve(timer.fn()).finally(()=>{settled=true;});operation.catch(e=>{turnError=e;});
    }
  });
  const old=JSON.parse(new TextDecoder().decode(new Uint8Array(payload,0,control[3])));
  const candidate=JSON.parse(new TextDecoder().decode(new Uint8Array(payload,payload.byteLength/2,control[4])));
  // Fire parent/reader deadline barriers; no timing measurements or wall-time heuristic kills.
  const deadline=Math.min(...[...timers.values()].map(v=>v.at));
  // The blocked Worker cannot acknowledge a clock tick; publish shared time and
  // let the branded parent deadline terminate it, without waiting for its port.
  await testClock.advance(Math.max(0,Math.ceil(deadline-now())),{waitForWorkers:false});
  for(const [key,timer] of [...timers])if(timer.at<=now()){timers.delete(key);timer.fn();}
  await flush();
  // This Worker is blocked in the COMMIT rendezvous, so expire only the
  // injected disposal grace; the independent proof deadline is still future.
  await testClock.advance(500,{waitForWorkers:false});
  for(const [key,timer] of [...timers])if(timer.at<=now()){timers.delete(key);timer.fn();}
  await operation;await flush();
  assert.equal(p.getStatus().state,'active','native_confirmed_disposal_recovers_without_renewal');
  assert.equal(productReader.maintenancePumpCutoffDiagnostic?.(p.getStatus()).outcome,1,'native_exit_and_complete_records_prove_disposal');
  await p.close();
  // Inspect through the successor's own writable open, before it changes recovered work.
  // DELETE uses the default legacy journal probe; no parent read-only preflight repairs it first.
  const resumed=await openContextIndexMaintainer({...options,host:{...options.host,
    configuration:{...options.host.configuration,cutoffInspect:true}}});
  try {
    for(const intent of ['current','history']){
      let complete=false;
      for(let i=0;i<100;i++){
        const r=ok(await resumed.refreshContextIndex({readSet:[personal],types:['memory'],intent,mode:'lexical',budget:{maxItems:1024,maxMs:5000}},service.token));
        if(r.status==='complete'){complete=true;break;}
      }
      assert.equal(complete,true,'last_signed_checkpoint_resumes_to_publication');
    }
    assert.equal(control[6],1,'writable_recovery_precedes_durable_state_inspection');
    const recovered=JSON.parse(new TextDecoder().decode(new Uint8Array(payload,0,control[5])));
    assert.deepEqual(recovered,point==='before'?old:candidate,'recovered_transaction_is_exactly_old_or_new');
    const db=new DatabaseSync(f.path+PRODUCT_SIDECAR_SUFFIX,{readOnly:true});
    try {assert.deepEqual(db.prepare('SELECT count(*) AS n FROM documents d JOIN generations g ON d.generation=g.storage_id JOIN publications p ON p.generation=g.id GROUP BY g.id').all().map(r=>r.n),[12,12],'complete_generation_has_every_document_once');}
    finally {db.close();}
  } finally {await resumed.close();}
});

// These complement Worker disposal: SIGKILL bypasses native SQLite destructors.
for(const mode of ['DELETE','WAL'])for(const phase of ['batch','verification','publication'])for(const point of ['before','after'])
nativeTest(`cutoff process crash ${mode} ${phase} ${point} COMMIT: signal and atomic SQL oracle`,async t=>{
  const f=fixture(t);for(let i=0;i<12;i++)f.admit('crash orchard '+i+' '+Array.from({length:30},(_,n)=>'term'+n).join(' '),personal);
  const service=configured(t,f.path,[personal],{service:true}),p={readSet:[personal],types:['memory'],intent:'current',ownerCoverage:service.options.ownerCoverage};
  const entry=new URL('../testing/context-product-cutoff-process.mjs',import.meta.url),marker=f.path+'.crash-marker';
  const seed=spawnSync(process.execPath,[entry.pathname,f.path,JSON.stringify(p),mode,'seed'],{env:{},encoding:'utf8',timeout:30000});
  assert.equal(seed.status,0,seed.stderr);
  const child=spawn(process.execPath,[entry.pathname,f.path,JSON.stringify(p),mode,phase,point,marker],{env:{},stdio:['ignore','ignore','pipe']});
  let done=false,stderr='';child.stderr.on('data',b=>{stderr+=b;});
  const exited=new Promise((resolve,reject)=>{child.once('error',reject);child.once('close',(code,signal)=>{done=true;resolve({code,signal});});});
  f.workspace.defer(async()=>{if(!done){child.kill('SIGKILL');await exited;}});
  const watchdog=new Date().getTime()+30000;
  while(!existsSync(marker)){
    assert.equal(done,false,'crash_child_reaches_requested_commit_barrier: '+stderr);
    assert.ok(new Date().getTime()<watchdog,'crash_barrier_watchdog');await realDelay(5);
  }
  const captured=JSON.parse(readFileSync(marker,'utf8'));assert.equal(captured.phase,phase);assert.equal(captured.point,point);
  assert.equal(child.kill('SIGKILL'),true,'crash_sigkill_delivered');assert.deepEqual(await exited,{code:null,signal:'SIGKILL'},'crash_child_died_by_sigkill_at_barrier');
  const side=f.path+PRODUCT_SIDECAR_SUFFIX;
  if(mode==='DELETE' && point==='before'){
    assert.ok(captured.journalBytes>512 && statSync(side+'-journal').size>512,'crash_leaves_nonempty_delete_journal');
    const probe=spawnSync(process.execPath,['--input-type=module','-e',
      "import {DatabaseSync} from 'node:sqlite';let d;try{d=new DatabaseSync(process.argv[1],{readOnly:true});d.prepare('SELECT * FROM product_metadata').get();console.log('no-hot-journal');}catch(e){console.log(e.errcode);}finally{d?.close();}",side],{env:{},encoding:'utf8',timeout:30000});
    assert.equal(probe.status,0,probe.stderr);
    assert.equal(probe.stdout.trim(),'776','sqlite_reports_hot_delete_journal_requires_writable_rollback');
    assert.equal(statSync(side+'-journal').size,captured.journalBytes,'read_only_probe_cannot_repair_hot_journal');
  }
  if(mode==='WAL'){
    assert.equal(statSync(side+'-wal').size,captured.walBytes,'crash_preserves_wal_before_writable_recovery');
    assert.equal((captured.walBytes-32)%(captured.pageSize+24),0,'crash_wal_has_whole_frames');
    if(point==='before'){
      assert.equal(captured.inTransaction,true);assert.ok(captured.walBytes>captured.walAtBegin,'crash_wal_contains_frames_after_last_commit');
    }
  }
  const control=new Int32Array(new SharedArrayBuffer(32)),payload=new SharedArrayBuffer(192*1024);
  const resumed=await openContextIndexMaintainer({...service.options,wal:mode==='WAL',sidecarJournalMode:mode,
    host:{moduleUrl:new URL('../testing/context-product-cutoff-host.mjs',import.meta.url).href,
      configuration:{...service.options.host.configuration,cutoffBarrier:control.buffer,cutoffPayload:payload,cutoffInspect:true}}});
  try {
    let complete=false;
    for(let i=0;i<100;i++)if(ok(await resumed.refreshContextIndex({readSet:p.readSet,types:p.types,intent:p.intent,mode:'lexical',budget:{maxItems:1024,maxMs:5000}},service.token)).status==='complete'){complete=true;break;}
    assert.equal(complete,true,'crash_checkpoint_resumes_to_publication');assert.equal(control[6],1,'crash_recovery_uses_successor_writable_open');
    const recovered=JSON.parse(new TextDecoder().decode(new Uint8Array(payload,0,control[5])));
    assert.deepEqual(recovered,point==='before'?captured.old:captured.candidate,'crash_recovered_sql_is_exactly_old_or_new');
  }finally{await resumed.close();}
});

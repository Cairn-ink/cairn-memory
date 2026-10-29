import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { fixture,ok } from '../testing/context-read-fixture.mjs';
import { personal,configured } from '../testing/context-product-owner-fixture.mjs';
import { createMaintenancePumpRuntime } from '../context-product-pump.mjs';
import * as productReader from '../context-product-reader.mjs';
const { createProductReaderRuntime,openContextIndexMaintainer } = productReader;
import { PRODUCT_SIDECAR_SUFFIX } from '../context-product-sidecar.mjs';
const flush=async()=>{for(let i=0;i<30;i++)await Promise.resolve();};
async function reached(control,drive) {
  const deadline=Date.now()+30000;
  while(!Atomics.load(control,1)){
    drive();
    if(Date.now()>deadline)throw Error('native_commit_barrier_not_reached');
    await new Promise(resolve=>setTimeout(resolve,5));
  }
}
for(const mode of ['DELETE','WAL'])for(const phase of ['batch','verification','publication'])for(const point of ['before','after'])
test(`cutoff native ${mode} ${phase} ${point} COMMIT: atomic SQL oracle and resumable generation`,async t=>{
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
  let frozen,serial=0;const now=()=>frozen??Number(process.hrtime.bigint())/1e6;
  const timers=new Map(),setTimer=(fn,ms)=>{const id={n:++serial,unref(){}};timers.set(id,{fn,at:now()+ms});return id;};
  const clearTimer=id=>timers.delete(id),open=createProductReaderRuntime({maintenance:true,now:()=>BigInt(Math.floor(now()*1e6)),setTimer,clearTimer});
  const renew=createMaintenancePumpRuntime({now,setTimer,clearTimer,open,cutoffQualified:()=>true});
  const p=renew({supervisor:service.supervisor,id:'native-cutoff',window:{id:'window',endsAtMonoMs:Math.floor(now())+60000,usedItems:0,usedMs:0},
    budgets:{maxItems:10000,maxMs:60000},quantum:{maxItems:1024,maxMs:1500},pollMs:1000,renewalMs:60000,
    serviceCredential:service.token,projections:[{options,types:['memory']}]});
  f.workspace.defer(async()=>{Atomics.store(control,2,1);Atomics.notify(control,2);
    await p.close().catch(()=>{});await service.supervisor.close();});
  let operation,settled=true,turnError;
  await reached(control,()=>{
    if(turnError)throw turnError;
    if(!settled)return;
    const [id,timer]=[...timers].sort((a,b)=>a[1].at-b[1].at)[0]??[];
    if(timer && timer.at>now())return;
    const status=p.getStatus();if(status.state==='failed')throw Error('native_turn_failed_before_barrier:'+status.error);
    if(timer){
      timers.delete(id);settled=false;
      operation=Promise.resolve(timer.fn()).finally(()=>{settled=true;});operation.catch(e=>{turnError=e;});
    }
  });
  const old=JSON.parse(new TextDecoder().decode(new Uint8Array(payload,0,control[3])));
  const candidate=JSON.parse(new TextDecoder().decode(new Uint8Array(payload,payload.byteLength/2,control[4])));
  // Fire parent/reader deadline barriers; no timing measurements or wall-time heuristic kills.
  const deadline=Math.min(...[...timers.values()].map(v=>v.at));frozen=Math.max(now(),deadline);
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

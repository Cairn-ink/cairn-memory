import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { spawnSync } from 'node:child_process';
import { renameSync, unlinkSync, writeFileSync } from 'node:fs';
import { setTimeout as realDelay } from 'node:timers/promises';
import { fixture, ns, ok, readTransaction } from '../testing/context-read-fixture.mjs';
import { configured, descriptor } from '../testing/context-product-owner-fixture.mjs';
import { openContextProductFacade } from '../context-read-facade.mjs';
import { productSidecar, PRODUCT_SIDECAR_SUFFIX } from '../context-product-sidecar.mjs';
import { createProductSqlitePolicy } from '../context-product-sqlite.mjs';
import { accessDigest } from '../context-product-validation.mjs';
import * as memoryComparison from '../context-product-comparison.mjs';
import { createProductReaderRuntime } from '../context-product-reader.mjs';

const budget={maxItems:32,maxMs:1000};
async function guard(promise) {
  const abort=new AbortController();
  try {return await Promise.race([promise,realDelay(15000,undefined,{signal:abort.signal}).then(()=>{throw Error('reuse hang guard');})]);}
  finally {abort.abort();}
}
function child(role,path,mode) {
  const r=spawnSync(process.execPath,[new URL('./fixtures/context-product-wal-process.mjs',import.meta.url).pathname,role,path,mode],{env:{},encoding:'utf8',timeout:10000,maxBuffer:1024});
  assert.equal(r.status,0,r.stderr);assert.equal(r.error,undefined);
}
function setup(t,{mode='DELETE',policy=false,rendezvous=()=>{}}={}) {
  const f=fixture(t);f.admit('healthy resident reuse');
  const facade=openContextProductFacade(f.path,{}),p={readSet:[ns],types:['memory'],intent:'current',ownerCoverage:descriptor([ns])};
  const access=accessDigest({ownerId:ns.ownerId,namespaces:{readSet:[ns]}}),path=f.path+PRODUCT_SIDECAR_SUFFIX;
  const sqlite=policy?createProductSqlitePolicy({now:()=>0}):undefined;sqlite?.start(5000);
  const options={path:f.path,db:facade.port.db,identity:facade.port.identity,features:facade.port.features,writable:true,sidecarJournalMode:mode,sqlite,now:()=>0};
  const builder=productSidecar(options);
  try {let ready=false;for(let i=0;i<100&&!ready;i++){builder.refresh(p,access,budget);ready=builder.observe(p,access).dto.lexical.state==='ready';}assert.equal(ready,true);}
  finally {builder.close();}
  const checks={quick:0,foreign:0},handles=new Set(),prepare=DatabaseSync.prototype.prepare;
  t.mock.method(DatabaseSync.prototype,'prepare',function(sql){
    const stmt=Reflect.apply(prepare,this,[sql]),kind=sql==='PRAGMA quick_check'?'quick':sql==='PRAGMA foreign_key_check'?'foreign':null;
    if(!kind)return stmt;
    const db=this;
    return new Proxy(stmt,{get(target,key){const value=Reflect.get(target,key,target);if(typeof value!=='function')return value;
      return (...args)=>{if(key==='get'){checks[kind]++;handles.add(db);}return Reflect.apply(value,target,args);};}});
  });
  const storage=productSidecar({...options,rendezvous,memoryComparison});
  t.after(()=>{storage.close();facade.close();});
  return {f,facade,p,access,path,storage,checks,handles,
    refresh:()=>storage.refresh(p,access,budget),
    observe:()=>readTransaction(facade.port.db,()=>storage.observe(p,access)),
    step(){storage.refresh(p,access,budget);assert.equal(storage.prepareObservation(),null);return readTransaction(facade.port.db,()=>storage.observe(p,access));}};
}

for(const config of [{mode:'DELETE',policy:false},{mode:'DELETE',policy:true},{mode:'WAL',policy:true}])
test(`healthy maintainer checks integrity once across quanta and reads (${config.mode}, policy ${config.policy})`,t=>{
  const s=setup(t,config);
  for(let i=0;i<4;i++){
    assert.equal(s.step().dto.lexical.state,'ready');
    assert.match(s.storage.compare(s.p,s.access,budget).comparison.status,/^complete\//);
  }
  assert.deepEqual(s.checks,{quick:1,foreign:1},'read steps must retain the checked writable connection');
  assert.equal(s.handles.size,1);assert.equal([...s.handles][0].isTransaction,false,'no snapshot retained between quanta');
  s.f.admit('canonical writer after released observation');
  const fresh=s.observe();assert.equal(fresh.dto.lexical.state,'stale');assert.equal(fresh.dto.lexical.reason,'fence_changed','observation acquires a fresh canonical snapshot');
  const side=new DatabaseSync(s.path);try {side.prepare('DELETE FROM validation_records').run();}finally {side.close();}
  assert.equal(s.observe().dto.lexical.reason,'validation_missing','observation acquires a fresh sidecar snapshot');
});

for(const fault of ['refresh','cutoff','rollback','rollback failure','close failure'])
test(`sidecar ${fault} forces integrity checks on the next writable open`,t=>{
  let armed=false;const code=fault==='cutoff'?'read_timeout':'storage_error';
  const s=setup(t,{rendezvous(point){if(armed&&point===(fault.startsWith('rollback')?'batch':'opened')){armed=false;throw Object.assign(Error('synthetic refresh failure'),{code});}}});
  s.step();const before={...s.checks};
  if(fault.startsWith('rollback'))s.f.admit('changed source requiring a transaction');
  armed=true;
  if(fault==='rollback failure') {
    const exec=DatabaseSync.prototype.exec;let once=true;
    t.mock.method(DatabaseSync.prototype,'exec',function(sql){if(sql==='ROLLBACK'&&once){once=false;throw Object.assign(Error('synthetic rollback failure'),{code});}return Reflect.apply(exec,this,[sql]);});
  }
  let failClose=fault==='close failure';
  if(failClose) {
    const close=DatabaseSync.prototype.close;
    t.mock.method(DatabaseSync.prototype,'close',function(){if(failClose&&s.handles.has(this)){failClose=false;throw Object.assign(Error('synthetic close failure'),{code});}return Reflect.apply(close,this,[]);});
  }
  assert.throws(s.refresh,{code});
  failClose=false;
  const failed={...s.checks};assert.ok(failed.quick>=before.quick);
  let observed;
  assert.doesNotThrow(()=>{observed=s.step();},'a failed transaction must be discarded before the next writable use');
  assert.equal(observed.dto.lexical.state,'ready');
  assert.equal(s.checks.quick,failed.quick+1,'failed writable connection must not be reused');
  assert.equal(s.checks.foreign,failed.foreign+1,'reopen includes foreign-key checking');
});

test('passing control: an unavailable observation discards the connection before recovery',t=>{
  const s=setup(t);s.refresh();
  const side=new DatabaseSync(s.path);
  try {
    side.prepare('UPDATE product_metadata SET profile=?').run('synthetic-incompatible');
    assert.equal(s.observe().dto.lexical.reason,'incompatible');
    side.prepare('UPDATE product_metadata SET profile=?').run('context-read-product-v1.1');
  } finally {side.close();}
  const before={...s.checks};assert.equal(s.step().dto.lexical.state,'ready');
  assert.equal(s.checks.quick,before.quick+1);assert.equal(s.checks.foreign,before.foreign+1);
});

test('a caught fence rollback returning progress still forces the next writable open to check integrity',t=>{
  let armed=false,raced=false;
  const s=setup(t,{rendezvous(point){if(armed&&point==='transformed'){armed=false;raced=true;s.f.admit('writer during the comparison transaction');}}});
  s.step();s.f.admit('source requiring comparison work');armed=true;
  assert.ok(s.refresh().transformed>0);assert.equal(raced,true,'fence change rolls back an actual transformed batch');
  const before={...s.checks};s.step();
  assert.equal(s.checks.quick,before.quick+1,'caught rollback cannot leave a reusable connection');
  assert.equal(s.checks.foreign,before.foreign+1);
});

test('passing control: identity replacement reopens and refuses the old certificate',t=>{
  const s=setup(t);s.refresh();
  child('copy',s.path,s.path+'.replacement');renameSync(s.path,s.path+'.previous');renameSync(s.path+'.replacement',s.path);
  const observed=s.observe();assert.equal(observed.dto.lexical.state,'unavailable');assert.equal(observed.dto.lexical.reason,'validation_invalid');
  const before={...s.checks};assert.equal(s.step().dto.lexical.state,'ready');
  assert.ok(s.checks.quick>=before.quick+1);assert.equal(s.checks.quick-before.quick,s.checks.foreign-before.foreign);
});

for(const suffix of ['-journal','-wal','-shm'])test(`passing control: writable reuse retains non-write companion refusal (${suffix})`,t=>{
  const s=setup(t);s.refresh();writeFileSync(s.path+suffix,'synthetic protected companion',{mode:0o600});
  try {
    if(suffix==='-journal')assert.throws(s.observe,{code:'storage_busy'});
    else assert.equal(s.observe().dto.lexical.reason,'storage_unavailable');
  } finally {unlinkSync(s.path+suffix);}
  const before={...s.checks};assert.equal(s.step().dto.lexical.state,'ready');
  assert.equal(s.checks.quick,before.quick+1);assert.equal(s.checks.foreign,before.foreign+1);
});

test('passing control: writable reuse preserves the non-write header mode refusal',t=>{
  const s=setup(t);s.refresh();child('mode',s.path,'WAL');
  assert.equal(s.observe().dto.lexical.reason,'incompatible');
});

for(const code of ['storage_error','read_timeout'])test(`native maintainer ${code} result forces a checked writable reopen`,async t=>{
  const f=fixture(t);f.admit('native connection failure');const c=configured(t,f.path,[ns],{service:true});
  const control=new Int32Array(new SharedArrayBuffer(16));
  c.options.host={moduleUrl:new URL('./fixtures/context-product-reuse-host.mjs',import.meta.url).href,configuration:{...c.options.host.configuration,reuseControl:control.buffer}};
  const h=await guard(c.open());t.after(()=>guard(h.close()));
  const input={readSet:[ns],types:['memory'],intent:'current',mode:'lexical',budget:{maxItems:32,maxMs:5000}};
  let ready=false;for(let i=0;i<100&&!ready;i++)ready=ok(await guard(h.refreshContextIndex(input,c.token))).status==='complete';assert.equal(ready,true);
  f.admit('changed native source requiring a transaction');control[2]=code==='read_timeout'?2:1;
  assert.equal((await guard(h.refreshContextIndex(input,c.token))).error.code,code);
  const quick=control[0],foreign=control[1];
  ok(await guard(h.refreshContextIndex(input,c.token)));
  assert.equal(control[0],quick+1,'worker result failure invalidates its sidecar connection');assert.equal(control[1],foreign+1);
});

test('passing control: a reader watchdog cutoff disposes the connection and its successor checks integrity',async t=>{
  const f=fixture(t);f.admit('native watchdog connection');const c=configured(t,f.path,[ns],{service:true});
  const control=new Int32Array(new SharedArrayBuffer(16)),timers=new Set();let offset=0n;
  c.options.host={moduleUrl:new URL('./fixtures/context-product-reuse-host.mjs',import.meta.url).href,configuration:{...c.options.host.configuration,reuseControl:control.buffer}};
  const open=createProductReaderRuntime({maintenance:true,now:()=>process.hrtime.bigint()+offset,
    setTimer(fn,ms){const timer={fn,ms,unref(){}};timers.add(timer);return timer;},clearTimer:timer=>timers.delete(timer)});
  const h=await guard(open(c.options)),input={readSet:[ns],types:['memory'],intent:'current',mode:'lexical',budget:{maxItems:32,maxMs:5000}};
  try {
    let ready=false;for(let i=0;i<100&&!ready;i++)ready=ok(await guard(h.refreshContextIndex(input,c.token))).status==='complete';assert.equal(ready,true);
    f.admit('watchdog source requiring a transaction');control[2]=3;
    const entered=Atomics.waitAsync(control,3,0),pending=h.refreshContextIndex(input,c.token);
    await guard(entered.value);
    assert.equal(control[3],1,'worker is at the native transaction boundary');
    offset=6000000000n;
    for(const timer of [...timers])if(timer.ms<60000)timer.fn();
    assert.equal((await guard(pending)).error.code,'read_timeout','reader watchdog is terminal');
  } finally {
    Atomics.store(control,3,2);Atomics.notify(control,3);await guard(h.close());
  }
  const quick=control[0],foreign=control[1],next=await guard(c.open());
  try {ok(await guard(next.refreshContextIndex(input,c.token)));}
  finally {await guard(next.close());}
  assert.equal(control[0],quick+1);assert.equal(control[1],foreign+1);
});

test('passing control: explicit close requires full integrity checks in a fresh resident',t=>{
  const s=setup(t);s.step();s.storage.close();const before={...s.checks};
  assert.throws(s.refresh,{code:'store_closed'});
  const storage=productSidecar({path:s.f.path,db:s.facade.port.db,identity:s.facade.port.identity,features:s.facade.port.features,writable:true,now:()=>0});
  try {storage.refresh(s.p,s.access,budget);}finally {storage.close();}
  assert.equal(s.checks.quick,before.quick+1);assert.equal(s.checks.foreign,before.foreign+1);
});

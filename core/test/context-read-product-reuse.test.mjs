import '../testing/context-product-test-clock.mjs';
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
import { suppressOwnerInside } from '../content-suppression-storage.mjs';
import { installContentSafetyInside, contentSafetyInventory } from '../content-safety-migration.mjs';
import { transaction } from '../database.mjs';
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
function setup(t,{mode='DELETE',policy=false,suppression=false,rendezvous=()=>{},openFacade=openContextProductFacade,createSidecar=productSidecar}={}) {
  const f=fixture(t);f.admit('healthy resident reuse');
  if(suppression){
    const db=new DatabaseSync(f.path);
    try {transaction(db,()=>installContentSafetyInside(db,18,contentSafetyInventory(db)));}
    finally {db.close();}
  }
  const facade=openFacade(f.path,{});
  f.workspace.defer(()=>facade.close());
  const p={readSet:[ns],types:['memory'],intent:'current',ownerCoverage:descriptor([ns])};
  const access=accessDigest({ownerId:ns.ownerId,namespaces:{readSet:[ns]}}),path=f.path+PRODUCT_SIDECAR_SUFFIX;
  const sqlite=policy?createProductSqlitePolicy({now:()=>0}):undefined;sqlite?.start(5000);
  const options={path:f.path,db:facade.port.db,identity:facade.port.identity,features:facade.port.features,writable:true,sidecarJournalMode:mode,sqlite,now:()=>0};
  const builder=createSidecar(options);
  f.workspace.defer(()=>builder.close());
  try {let ready=false;for(let i=0;i<100&&!ready;i++){builder.refresh(p,access,budget);ready=builder.observe(p,access).dto.lexical.state==='ready';}assert.equal(ready,true);}
  finally {builder.close();}
  const checks={quick:0,foreign:0,attested:0},handles=new Set(),prepare=DatabaseSync.prototype.prepare;
  t.mock.method(DatabaseSync.prototype,'prepare',function(sql){
    const stmt=Reflect.apply(prepare,this,[sql]),kind=sql==='PRAGMA quick_check'?'quick':sql==='PRAGMA foreign_key_check'?'foreign':sql==='SELECT m.*,CAST(a.stamp AS TEXT) AS attestation_stamp,typeof(a.stamp) AS attestation_type,a.record AS attestation_record,a.singleton AS attestation_present FROM product_metadata m LEFT JOIN product_attestation a ON a.singleton=1 WHERE m.singleton=1'?'attested':null;
    if(!kind)return stmt;
    const db=this;
    return new Proxy(stmt,{get(target,key){const value=Reflect.get(target,key,target);if(typeof value!=='function')return value;
      return (...args)=>{if(key==='get'){checks[kind]++;handles.add(db);}return Reflect.apply(value,target,args);};}});
  });
  const storage=createSidecar({...options,rendezvous,memoryComparison});
  f.workspace.defer(()=>storage.close());
  return {f,facade,p,access,path,storage,checks,handles,
    refresh:()=>storage.refresh(p,access,budget),
    observe:()=>readTransaction(facade.port.db,()=>storage.observe(p,access)),
    step(){storage.refresh(p,access,budget);assert.equal(storage.prepareObservation(),null);return readTransaction(facade.port.db,()=>storage.observe(p,access));}};
}

for(const fault of ['setup','storage.close'])test(`reuse setup closes the facade independently after ${fault} failure`,async t=>{
  const cleanups=[],context={mock:t.mock,after:fn=>cleanups.push(fn)},errors=[];
  const cleanup=async()=>{while(cleanups.length)try{await cleanups.pop()();}catch(error){errors.push(error);}};
  t.after(cleanup);
  let facadeClosed=0,storageClosed=0,acquired=0;
  const injected=Error('synthetic '+fault+' failure');
  const options={
    openFacade(...args){const facade=openContextProductFacade(...args);t.after(()=>facade.close());return {...facade,close(){facadeClosed++;facade.close();}};},
    createSidecar(...args){
      if(fault==='setup')throw injected;
      const sidecar=productSidecar(...args);
      if(++acquired===1)return sidecar;
      return {...sidecar,close(){storageClosed++;sidecar.close();throw injected;}};
    }
  };
  if(fault==='setup')assert.throws(()=>setup(context,options),error=>error===injected);
  else setup(context,options);
  await cleanup();
  assert.equal(facadeClosed,1,'canonical facade cleanup survives setup and storage cleanup failures');
  assert.equal(storageClosed,fault==='setup'?0:1);
  assert.equal(errors.length,fault==='setup'?0:1);
  if(errors.length)assert.ok(errors[0].errors.includes(injected),'storage cleanup failure remains visible');
});

for(const config of [{mode:'DELETE',policy:false},{mode:'DELETE',policy:true},{mode:'WAL',policy:true}])
test(`healthy maintainer attests once across quanta and reads (${config.mode}, policy ${config.policy})`,t=>{
  const s=setup(t,config);
  for(let i=0;i<4;i++){
    assert.equal(s.step().dto.lexical.state,'ready');
    assert.match(s.storage.compare(s.p,s.access,budget).comparison.status,/^complete\//);
  }
  assert.deepEqual(s.checks,{quick:0,foreign:0,attested:1},'read steps must retain the checked writable connection');
  assert.equal(s.handles.size,1);assert.equal([...s.handles][0].isTransaction,false,'no snapshot retained between quanta');
  s.f.admit('canonical writer after released observation');
  const fresh=s.observe();assert.equal(fresh.dto.lexical.state,'stale');assert.equal(fresh.dto.lexical.reason,'fence_changed','observation acquires a fresh canonical snapshot');
  const side=new DatabaseSync(s.path);try {side.prepare('DELETE FROM validation_records').run();}finally {side.close();}
  assert.equal(s.observe().dto.lexical.reason,'validation_missing','observation acquires a fresh sidecar snapshot');
});

for(const fault of ['refresh','cutoff','rollback','rollback failure','close failure'])
test(`sidecar ${fault} forces attestation on the next writable open`,t=>{
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
  assert.equal(s.checks.attested,failed.attested+1,'failed writable connection must not be reused');
  assert.equal(s.checks.foreign,failed.foreign,'attested reopen skips foreign-key checking');
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
  assert.equal(s.checks.attested,before.attested+1);assert.equal(s.checks.foreign,before.foreign);
});

test('a caught fence rollback returning progress still forces the next writable open to attest',t=>{
  let armed=false,raced=false;
  const s=setup(t,{rendezvous(point){if(armed&&point==='transformed'){armed=false;raced=true;s.f.admit('writer during the comparison transaction');}}});
  s.step();s.f.admit('source requiring comparison work');armed=true;
  assert.ok(s.refresh().transformed>0);assert.equal(raced,true,'fence change rolls back an actual transformed batch');
  const before={...s.checks};s.step();
  assert.equal(s.checks.attested,before.attested+1,'caught rollback cannot leave a reusable connection');
  assert.equal(s.checks.foreign,before.foreign);
});

test('passing control: identity replacement reopens and refuses the old certificate',t=>{
  const s=setup(t);s.refresh();
  child('copy',s.path,s.path+'.replacement');renameSync(s.path,s.path+'.previous');renameSync(s.path+'.replacement',s.path);
  const observed=s.observe();assert.equal(observed.dto.lexical.state,'unavailable');assert.equal(observed.dto.lexical.reason,'storage_unavailable','the copied file has a different identity and an untrusted seal');
  const before={...s.checks};assert.equal(s.step().dto.lexical.state,'ready');
  assert.ok(s.checks.attested>=before.attested+1);assert.equal(s.checks.quick-before.quick,s.checks.foreign-before.foreign);
});

for(const suffix of ['-journal','-wal','-shm'])test(`passing control: writable reuse retains non-write companion refusal (${suffix})`,t=>{
  const s=setup(t);s.refresh();writeFileSync(s.path+suffix,'synthetic protected companion',{mode:0o600});
  try {
    if(suffix==='-journal')assert.throws(s.observe,{code:'storage_busy'});
    else assert.equal(s.observe().dto.lexical.reason,'storage_unavailable');
  } finally {unlinkSync(s.path+suffix);}
  const before={...s.checks};assert.equal(s.step().dto.lexical.state,'ready');
  assert.equal(s.checks.attested,before.attested+1);assert.equal(s.checks.foreign,before.foreign);
});

test('passing control: writable reuse preserves the non-write header mode refusal',t=>{
  const s=setup(t);s.refresh();child('mode',s.path,'WAL');
  assert.equal(s.observe().dto.lexical.reason,'incompatible');
});

for(const code of ['storage_error','read_timeout'])test(`native maintainer ${code} result forces a checked writable reopen`,async t=>{
  const f=fixture(t);f.admit('native connection failure');const c=configured(t,f.path,[ns],{service:true});
  const control=new Int32Array(new SharedArrayBuffer(48));
  c.options.host={moduleUrl:new URL('./fixtures/context-product-reuse-host.mjs',import.meta.url).href,configuration:{...c.options.host.configuration,reuseControl:control.buffer}};
  const h=await guard(c.open());t.after(()=>guard(h.close()));
  const input={readSet:[ns],types:['memory'],intent:'current',mode:'lexical',budget:{maxItems:32,maxMs:5000}};
  let ready=false;for(let i=0;i<100&&!ready;i++)ready=ok(await guard(h.refreshContextIndex(input,c.token))).status==='complete';assert.equal(ready,true);
  f.admit('changed native source requiring a transaction');control[2]=code==='read_timeout'?2:1;
  assert.equal((await guard(h.refreshContextIndex(input,c.token))).error.code,code);
  const quick=control[0],foreign=control[1],attested=control[11];
  ok(await guard(h.refreshContextIndex(input,c.token)));
  assert.equal(control[11],attested+1,'failure requires a fresh attested connection');
  assert.equal(control[0],quick,'worker result failure invalidates its sidecar connection');assert.equal(control[1],foreign);
});

for(const splitInitialization of [false,true])
for(const failure of ['final authority','Worker exception'])test(`native ${failure} failure after committed sidecar work forces a checked writable reopen${splitInitialization?' (split initialization)':''}`,async t=>{
  const f=fixture(t);f.admit('native final authority failure');const c=configured(t,f.path,[ns],{service:true});
  const control=new Int32Array(new SharedArrayBuffer(48));
  c.options.host={moduleUrl:new URL('./fixtures/context-product-reuse-host.mjs',import.meta.url).href,configuration:{...c.options.host.configuration,reuseControl:control.buffer,reuseSidePath:f.path+PRODUCT_SIDECAR_SUFFIX,reuseSplitInitialization:splitInitialization}};
  const h=await guard(c.open());t.after(()=>guard(h.close()));
  const input={readSet:[ns],types:['memory'],intent:'current',mode:'lexical',budget:{maxItems:32,maxMs:5000}};
  const counts=[];
  const refresh=async()=>{const before=control[10],response=await guard(h.refreshContextIndex(input,c.token));counts.push(control[10]-before);return response;};
  const initialization=[];
  for(let i=0;i<100&&initialization.at(-1)!=='complete';i++)initialization.push(ok(await refresh()).status);
  assert.deepEqual(initialization,splitInitialization?['rebuilding','complete']:['complete'],'selection completes before failure instrumentation starts');
  assert.deepEqual(counts,splitInitialization?[155,285]:[300],'production Worker SQL executions during initialization');
  counts.length=0;Atomics.store(control,10,0);
  assert.deepEqual([control[8],control[9]],[1,0],'initial writable admission is retained');
  f.admit('changed source committed before final authority validation');
  const commits=control[4];
  assert.deepEqual([control[0],control[1]],[0,0]);
  if(failure==='final authority')c.view[2]=c.view[1]+2;
  else {control[7]=commits;control[6]=1;}
  const failed=await refresh();
  assert.equal(failed.ok,false);
  assert.equal(failed.error.code,failure==='final authority'?'scope_changed':'reader_failed');
  assert.deepEqual([control[8],control[9]],[1,1],'Worker failure disposes the admitted writable handle');
  if(failure==='Worker exception')assert.equal(control[6],3,'exception was thrown after index.run returned to the Worker');
  assert.ok(control[4]>commits,'sidecar transactions committed successfully before the failure');
  assert.equal(control[5],control[4],'final authority sample occurs after those commits');
  const quick=control[0],foreign=control[1],attested=control[11];
  assert.deepEqual([quick,foreign],[0,0],'successful sidecar work has not reopened before Worker disposal');
  c.view[0]=1;c.view[2]=0;
  assert.equal(ok(await refresh()).status,'complete');
  assert.equal(control[11],attested+1,'Worker disposal requires a fresh attested connection');
  assert.equal(control[0],quick,'Worker failure discard skips quick_check after committed sidecar work');
  assert.equal(control[1],foreign,'Worker failure discard skips foreign_key_check after committed sidecar work');
  assert.deepEqual([control[8],control[9]],[2,1],'one fresh sidecar admission follows Worker disposal');
  assert.deepEqual(counts,failure==='final authority'?[333,108]:[364,108],'production Worker SQL executions for failure and recovery');
});

for(const service of [false,true])test(`real Worker keeps a read-only handle across owner-suppression denials (maintainer ${service})`,async t=>{
  const s=setup(t,{policy:true,suppression:true});
  const c=configured(t,s.f.path,[ns],{service}),control=new Int32Array(new SharedArrayBuffer(48));
  c.options.host={moduleUrl:new URL('./fixtures/context-product-reuse-host.mjs',import.meta.url).href,
    configuration:{...c.options.host.configuration,reuseControl:control.buffer,reuseSidePath:s.path}};
  const h=await guard(c.open());t.after(()=>guard(h.close()));
  const input={readSet:[ns],types:['memory'],intent:'current',deadlineMs:5000};
  const counts=[];let before=control[10];
  assert.equal(ok(await guard(h.getContextIndexStatus(input,c.token))).lexical.state,'ready');
  counts.push(control[10]-before);
  assert.equal(control[8],1);assert.equal(control[9],0);
  assert.equal(control[0],0,'status-only maintainer admitted no writable connection');
  const db=new DatabaseSync(s.f.path);
  try {transaction(db,()=>suppressOwnerInside(db,{ownerId:ns.ownerId,reason:'account_erasure',actionId:'synthetic-worker-denial'}));}
  finally {db.close();}
  for(let i=0;i<3;i++) {
    before=control[10];
    const response=await guard(service||i===2?h.getContextIndexStatus(input,c.token):h.findCandidates({...input,query:'healthy',limit:4},c.token));
    counts.push(control[10]-before);
    assert.equal(response.ok,false);assert.equal(response.error.code,'evidence_unavailable');
    assert.equal(control[8],1,'denial must not repeat sidecar admission');
    assert.equal(control[9],0,'denial must retain the read-only handle');
  }
  // B1 downward ratchet: the folded status and owner-suppression checks retain
  // the admitted handle without repeating eligibility queries after denial.
  assert.deepEqual(counts,service?[52,40,40,40]:[52,36,36,40],'production Worker SQL executions retain the folded denial counts');
});

test('passing control: a reader watchdog cutoff disposes the connection and its successor attests',async t=>{
  const f=fixture(t);f.admit('native watchdog connection');const c=configured(t,f.path,[ns],{service:true});
  const control=new Int32Array(new SharedArrayBuffer(48)),timers=new Set();let offset=0n;
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
  const quick=control[0],foreign=control[1],attested=control[11],next=await guard(c.open());
  try {ok(await guard(next.refreshContextIndex(input,c.token)));}
  finally {await guard(next.close());}
  assert.equal(control[11],attested+1,'watchdog successor attests a fresh connection');
  assert.equal(control[0],quick);assert.equal(control[1],foreign);
});

test('passing control: explicit close requires attestation in a fresh resident',t=>{
  const s=setup(t);s.step();s.storage.close();const before={...s.checks};
  assert.throws(s.refresh,{code:'store_closed'});
  const storage=productSidecar({path:s.f.path,db:s.facade.port.db,identity:s.facade.port.identity,features:s.facade.port.features,writable:true,now:()=>0});
  try {storage.refresh(s.p,s.access,budget);}finally {storage.close();}
  assert.equal(s.checks.attested,before.attested+1);assert.equal(s.checks.foreign,before.foreign);
});

// Reuse the native-prepare injection used by the read-only disposal audit;
// policy mapping and real transaction cleanup remain in the exercised path.
function injectedRead(t, error) {
  const prepare=DatabaseSync.prototype.prepare;
  let armed=false;
  t.mock.method(DatabaseSync.prototype,'prepare',function(sql){
    if(armed&&sql==='SELECT 1 AS failure_disposal_probe'){armed=false;throw error;}
    return Reflect.apply(prepare,this,[sql]);
  });
  return storage=>{armed=true;return storage.vectors(db=>db.prepare('SELECT 1 AS failure_disposal_probe').get());};
}
const nativeFailure=errcode=>Object.assign(Error('synthetic native failure'),{code:'ERR_SQLITE_ERROR',...(errcode===undefined?{}:{errcode})});

test('two denied read-only reads retain the same admitted handle',t=>{
  const s=setup(t,{policy:true,suppression:true});let handle,admissions=0;
  const prepare=DatabaseSync.prototype.prepare;
  t.mock.method(DatabaseSync.prototype,'prepare',function(sql){if(sql==='PRAGMA user_version')admissions++;return Reflect.apply(prepare,this,[sql]);});
  s.storage.vectors(db=>{handle=db;return null;});
  const publication=s.observe().publication;
  const canonical=new DatabaseSync(s.f.path);
  try {
    canonical.exec('BEGIN IMMEDIATE');
    suppressOwnerInside(canonical,{ownerId:ns.ownerId,reason:'account_erasure',actionId:'synthetic-reuse-denial'});
    canonical.exec('COMMIT');
  } finally {if(canonical.isTransaction)canonical.exec('ROLLBACK');canonical.close();}
  const before=admissions;
  for(let i=0;i<2;i++){
    assert.throws(()=>s.storage.lexical(s.p,publication,'healthy'),{code:'evidence_unavailable'});
    assert.equal(handle.isOpen,true,'ordinary denial must retain the read-only handle');
    s.storage.vectors(db=>{assert.equal(db,handle,'denied reads share the admitted handle');return null;});
    assert.equal(admissions,before,'denial must not repeat opening identity checks');
  }
});

const readOnlyFailures=[
  ...[10,266,522,11,13,26,8,14].map(code=>({name:'native '+code,error:()=>nativeFailure(code),discard:true})),
  {name:'storage_unavailable',error:()=>Object.assign(Error('synthetic storage refusal'),{code:'index_unavailable',reason:'storage_unavailable'}),discard:true},
  ...[5,6].map(code=>({name:'native '+code,error:()=>nativeFailure(code),discard:false})),
  ...['evidence_unavailable','read_timeout','memory_not_found'].map(code=>({name:code==='evidence_unavailable'?'suppression denial (evidence_unavailable)':code,error:()=>Object.assign(Error('synthetic denial'),{code}),discard:false})),
  {name:'native without errcode',error:()=>nativeFailure(),discard:false},
  {name:'wrapped without native code',error:()=>Object.assign(Error('synthetic wrapped failure'),{code:'storage_error',cause:nativeFailure(11)}),discard:false}
];
for(const row of readOnlyFailures)test(`read-only failure disposal: ${row.name} => ${row.discard?'discard':'keep'}`,t=>{
  const s=setup(t,{policy:true});let handle;
  s.storage.vectors(db=>{handle=db;return null;});
  const inject=injectedRead(t,row.error());
  assert.throws(()=>inject(s.storage));
  assert.equal(handle.isOpen,!row.discard,'read-only disposal must follow the native primary code or storage reason');
  if(handle.isOpen)assert.equal(handle.isTransaction,false,'failed read released its transaction');
  s.storage.vectors(db=>{assert.equal(db===handle,!row.discard,'next read confirms disposal versus reuse');handle=db;return null;});
  // observe() catches and maps native errors after read(); that status mapping
  // must neither erase a disposal decision nor invent one from a mapped DTO.
  const prepare=DatabaseSync.prototype.prepare;let armed=true;
  t.mock.method(DatabaseSync.prototype,'prepare',function(sql){
    if(armed&&sql==='SELECT * FROM product_metadata WHERE singleton=1'){armed=false;throw row.error();}
    return Reflect.apply(prepare,this,[sql]);
  });
  try{s.observe();}catch(error){assert.ok(error.code);}
  assert.equal(armed,false,'observation reached the injected native read');
  assert.equal(handle.isOpen,!row.discard,'mapped observation follows the original failure, including missing-code fallback');
});

test('failure inside read on a reused writable handle forces a second attested open',t=>{
  const s=setup(t,{policy:true});s.step();let handle;
  s.storage.vectors(db=>{handle=db;return null;});
  assert.deepEqual(s.checks,{quick:0,foreign:0,attested:1});
  const inject=injectedRead(t,Object.assign(Error('synthetic content-safety denial'),{code:'evidence_unavailable'}));
  assert.throws(()=>inject(s.storage),{code:'evidence_unavailable'});
  assert.equal(handle.isOpen,false,'the same denial discards when the read started on a writable connection');
  s.storage.reset();assert.deepEqual(s.checks,{quick:0,foreign:0,attested:2});
});

for(const site of ['refresh','vectors','reset'])test(`failure after read-only upgrade at ${site} forces a checked writable reopen`,t=>{
  let armed=false;
  const error=Object.assign(Error('synthetic upgraded operation failure'),{code:'evidence_unavailable'});
  const s=setup(t,{policy:true,rendezvous(point){if(armed&&site==='refresh'&&point==='opened'){armed=false;throw error;}}});
  let old;s.storage.vectors(db=>{old=db;return null;});
  assert.deepEqual(s.checks,{quick:0,foreign:0,attested:1});
  const prepare=DatabaseSync.prototype.prepare,exec=DatabaseSync.prototype.exec;
  t.mock.method(DatabaseSync.prototype,'prepare',function(sql){
    if(armed&&site==='vectors'&&sql==="SELECT 1 FROM sqlite_schema WHERE name='vector_publications' AND type='table'"){armed=false;throw error;}
    return Reflect.apply(prepare,this,[sql]);
  });
  t.mock.method(DatabaseSync.prototype,'exec',function(sql){if(armed&&site==='reset'&&sql==='BEGIN IMMEDIATE'){armed=false;throw error;}return Reflect.apply(exec,this,[sql]);});
  armed=true;
  assert.throws(()=>site==='refresh'?s.refresh():site==='vectors'?s.storage.vectors(()=>null,true):s.storage.reset(),{code:'evidence_unavailable'});
  assert.equal(armed,false,'fault occurs after writable admission');assert.equal(old.isOpen,false);
  assert.deepEqual(s.checks,{quick:0,foreign:0,attested:2});
  s.storage.reset();assert.deepEqual(s.checks,{quick:0,foreign:0,attested:3},'next write uses another attested handle');
});

test('persistently corrupt sidecar has one opening attempt per query and preserves main statuses',t=>{
  const s=setup(t,{policy:true});s.storage.close();
  // No sidecar connection is live; only this child opens a raw file handle.
  const damage=spawnSync(process.execPath,['--input-type=module','-e',
    "import {writeFileSync} from 'node:fs';writeFileSync(process.argv[1],Buffer.alloc(4096,120));",s.path],{env:{},encoding:'utf8',timeout:10000});
  assert.equal(damage.status,0,damage.stderr);assert.equal(damage.error,undefined);
  let opens=0;
  const observer={invoke(kind,category,work){if(kind==='open')opens++;return work();},database:db=>db};
  const sqlite=createProductSqlitePolicy({now:()=>0});sqlite.start(5000);
  const storage=productSidecar({path:s.f.path,db:s.facade.port.db,identity:s.facade.port.identity,features:s.facade.port.features,sqlite,observer,now:()=>0});
  t.after(()=>storage.close());
  const statuses=[],attempts=[];
  for(let i=0;i<4;i++){
    const before=opens;
    statuses.push(readTransaction(s.facade.port.db,()=>storage.observe(s.p,s.access)).dto.lexical.reason);
    // The first invocation also opens the separate lifecycle-lock database.
    attempts.push(opens-before-(i===0?1:0));
    assert.ok(attempts[i]<=1,'no query retries a persistent corruption');
  }
  assert.ok(attempts.reduce((a,b)=>a+b,0)<=statuses.length);
  assert.deepEqual(statuses,['corrupt','corrupt','corrupt','corrupt'],'same sequence was measured on main');
  t.diagnostic(JSON.stringify({statuses,sidecarOpeningAttempts:attempts}));
});

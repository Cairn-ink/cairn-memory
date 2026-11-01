import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import childProcess, { spawnSync } from 'node:child_process';
import { syncBuiltinESMExports } from 'node:module';
import { Worker } from 'node:worker_threads';
import { DatabaseSync } from 'node:sqlite';
import { lstatSync,existsSync,writeFileSync,unlinkSync,symlinkSync,linkSync,renameSync,chmodSync } from 'node:fs';
import { fixture,ns,ok } from '../testing/context-read-fixture.mjs';
import { configured } from '../testing/context-product-owner-fixture.mjs';
import { createProductReaderRuntime,maintenanceFailureDiagnostic,maintenanceReaderFailureDiagnostic } from '../context-product-reader.mjs';
import * as attribution from '../context-product-attribution.mjs';
import { PRODUCT_SIDECAR_SUFFIX } from '../context-product-sidecar.mjs';
import { assertContextReadCanonicalDelete } from '../context-read-sidecar.mjs';

const other={...ns,ownerId:'synthetic-journal-writer'};
const input={readSet:[ns],types:['memory'],intent:'current',deadlineMs:5000};
const refresh={readSet:[ns],types:['memory'],intent:'current',mode:'lexical',budget:{maxItems:1024,maxMs:5000}};
const indexReasons=['storage_unavailable','auxiliary_file','unsafe_file','incompatible','wrong_store','missing','corrupt','validation_missing','validation_invalid',
  'memory_store','replaced','stale_index','rebuilding','timeout'];
async function build(h,token) {
  for(let i=0;i<100;i++)if(ok(await h.refreshContextIndex(refresh,token)).status==='complete')return;
  assert.fail('fixture build incomplete');
}
async function prepared(t) {
  const f=fixture(t),memory=f.admit('classification needle');f.admit('another owner needle',other);
  const c=configured(t,f.path,[ns],{service:true}),h=await c.open();await build(h,c.token);await h.close();
  return {...f,memory};
}
async function writer(t,f,kind) {
  const state=new SharedArrayBuffer(4),view=new Int32Array(state);
  const w=new Worker(new URL('./fixtures/context-product-journal-writer.mjs',import.meta.url),{
    workerData:{path:f.path,namespace:other,kind,state},env:{},execArgv:[]});
  const exited=once(w,'exit');exited.catch(()=>{});let done=false;w.once('exit',()=>{done=true;});
  t.after(async()=>{Atomics.store(view,0,1);Atomics.notify(view,0);if(!done)await w.terminate();await exited.catch(()=>{});});
  assert.equal((await once(w,'message'))[0].held,true,'real writer holds a journal before the read');
  return async()=>{const committed=once(w,'message');Atomics.store(view,0,1);Atomics.notify(view,0);
    assert.equal((await committed)[0].committed,true);assert.equal((await exited)[0],0);};
}
function call(h,token,method,memory) {
  if(method==='refreshContextIndex')return h.refreshContextIndex(refresh,token);
  if(method==='fetchCandidateEvidence')return h.fetchCandidateEvidence({readSet:[ns],intent:'current',deadlineMs:5000,
    refs:[{type:'memory',namespace:ns,memoryId:memory.id,revision:memory.revision}]},token);
  if(method==='contextRead')return h.contextRead({...input,query:'needle',budget:{maxItems:8,maxTokens:2000}},token);
  if(method==='findCandidates')return h.findCandidates({...input,query:'needle'},token);
  return h.getContextIndexStatus(input,token);
}
for(const kind of ['canonical','sidecar'])for(const method of ['findCandidates','contextRead','fetchCandidateEvidence','getContextIndexStatus','refreshContextIndex'])
test(`journal classification: ${kind} live writer, ${method}, then commit recovery`,async t=>{
  const f=await prepared(t),service=method==='refreshContextIndex';
  const c=configured(t,f.path,[ns],{service}),h=await c.open();
  ok(await h.getContextIndexStatus(input,c.token)); // Also exercise the reused sidecar connection.
  const release=await writer(t,f,kind),result=await call(h,c.token,method,f.memory);
  if(kind==='sidecar'&&method==='fetchCandidateEvidence') {
    assert.equal(result.ok,true,'passing control: exact canonical fetch does not acquire the sidecar');
  } else assert.deepEqual(result,{ok:false,error:{code:'storage_busy',retryable:true}},'journal contention must be retryable');
  await release();assert.equal((await call(h,c.token,method,f.memory)).ok,true,'same handle recovers after the writer commits');
  await h.close();
});

test('journal classification: cold sidecar status refuses retryably and recovers',async t=>{
  const f=await prepared(t),c=configured(t,f.path,[ns]),h=await c.open();
  const release=await writer(t,f,'sidecar');
  assert.deepEqual(await h.getContextIndexStatus(input,c.token),{ok:false,error:{code:'storage_busy',retryable:true}});
  await release();assert.equal(ok(await h.getContextIndexStatus(input,c.token)).lexical.state,'ready');await h.close();
});

for(const suffix of ['-wal','-shm'])for(const location of ['canonical','sidecar'])
test(`journal control: ${location} ${suffix} keeps its non-retryable code and private reason`,async t=>{
  const f=await prepared(t),c=configured(t,f.path,[ns],{service:true}),h=await c.open();
  const path=(location==='canonical'?f.path:f.path+PRODUCT_SIDECAR_SUFFIX)+suffix;
  writeFileSync(path,'synthetic companion',{mode:0o600});
  try {
    const result=await h.refreshContextIndex(refresh,c.token);
    assert.deepEqual(result,{ok:false,error:{code:'index_unavailable',retryable:false}},'passing control: companion refusal code stays unchanged');
    assert.equal(maintenanceFailureDiagnostic(result)?.reason,location==='canonical'?'auxiliary_file':'storage_unavailable','closed private reason crosses the real Worker');
    assert.equal(Object.hasOwn(result,'reason'),false);assert.equal(Object.hasOwn(result.error,'reason'),false);
  } finally {unlinkSync(path);await h.close();}
});

for(const location of ['canonical','sidecar'])
test(`journal control: unsafe ${location} journal stays index_unavailable`,async t=>{
  const f=await prepared(t),c=configured(t,f.path,[ns],{service:true}),h=await c.open();
  const path=(location==='canonical'?f.path:f.path+PRODUCT_SIDECAR_SUFFIX)+'-journal';
  writeFileSync(path,'synthetic unsafe journal',{mode:0o644});
  try {
    const result=await h.refreshContextIndex(refresh,c.token);
    assert.deepEqual(result,{ok:false,error:{code:'index_unavailable',retryable:false}},'passing control: unsafe journal is not contention');
    assert.equal(maintenanceFailureDiagnostic(result)?.reason,location==='canonical'?'unsafe_file':'storage_unavailable');
  } finally {unlinkSync(path);await h.close();}
});

test('journal controls: WAL header, symlink and hard-linked journal retain guard refusals',t=>{
  const f=fixture(t);f.admit('guard control');
  const journal=f.path+'-journal';
  symlinkSync(f.path,journal);assert.throws(()=>assertContextReadCanonicalDelete(f.path),{code:'index_unavailable',reason:'unsafe_file'});unlinkSync(journal);
  linkSync(f.path,journal);assert.throws(()=>assertContextReadCanonicalDelete(f.path),{code:'index_unavailable',reason:'auxiliary_file'});unlinkSync(journal);
  writeFileSync(journal,'synthetic journal',{mode:0o600});chmodSync(f.path,0o400);
  try {assert.throws(()=>assertContextReadCanonicalDelete(f.path),{code:'index_unavailable',reason:'auxiliary_file'});}
  finally {chmodSync(f.path,0o600);unlinkSync(journal);}
  const d=new DatabaseSync(f.path);d.exec('PRAGMA journal_mode=WAL');d.close();
  assert.throws(()=>assertContextReadCanonicalDelete(f.path),{code:'index_unavailable',reason:'auxiliary_file'});
  writeFileSync(journal,'synthetic journal',{mode:0o600});
  try {assert.throws(()=>assertContextReadCanonicalDelete(f.path),{code:'index_unavailable',reason:'auxiliary_file'});}
  finally {unlinkSync(journal);}
});

const instrumented=maintenance=>createProductReaderRuntime({maintenance,spawnWorker:data=>new Worker(
  new URL('./fixtures/context-product-classification-worker.mjs',import.meta.url),{workerData:data,env:{},execArgv:[],stdout:true,stderr:true})});
for(const reason of [...indexReasons,undefined,'outside the closed vocabulary'])
test('private index reason: '+String(reason),async t=>{
  const f=fixture(t);f.admit('private diagnostic fixture');
  const c=configured(t,f.path,[ns],{service:true});Object.assign(c.options.host.configuration,{faultIndex:true,...(reason===undefined?{}:{faultReason:reason})});
  const h=await instrumented(true)(c.options);t.after(()=>h.close());
  const result=await h.getContextIndexStatus(input,c.token);
  assert.deepEqual(result,{ok:false,error:{code:'index_unavailable',retryable:false}},'public result has no private reason field');
  const expected=indexReasons.includes(reason)?reason:'other',record=maintenanceFailureDiagnostic(result);
  assert.equal(record?.reason,expected,'engine failure retains only the closed reason');
  assert.equal(record.engineCode,'index_unavailable');assert.equal(record.cause,'engine');assert.ok(Object.isFrozen(record));
  await h.close();assert.equal(maintenanceReaderFailureDiagnostic(h).lastFailure.reason,expected,'disposal keeps the captured reason');
});

test('private index reason: getter is never evaluated',async t=>{
  const f=fixture(t),c=configured(t,f.path,[ns],{service:true});Object.assign(c.options.host.configuration,{faultIndex:true,reasonGetter:true});
  const h=await instrumented(true)(c.options);t.after(()=>h.close());
  const result=await h.getContextIndexStatus(input,c.token);
  assert.equal(result.error.code,'index_unavailable');assert.equal(maintenanceFailureDiagnostic(result)?.reason,'other');
  assert.equal(c.view[7],0,'private sanitization does not call a reason getter');
});

test('private index reason: mapped failures preserve original exception attribution and closed reason',()=>{
  const m=attribution.createMaintenanceAttribution(),original=new TypeError('synthetic raw failure');m.captureFailure(original);
  const mapped=Object.assign(Error('synthetic mapped failure'),{code:'index_unavailable',reason:'validation_invalid'});
  m.mapFailure(original,mapped);m.selectFailure(mapped);
  const detail=m.failure();
  assert.deepEqual(detail,{kind:'exception',errorName:'TypeError',reason:'validation_invalid',step:0});
  assert.equal(attribution.maintenanceFailureRecord(detail.kind,detail).cause,'exception:TypeError');
  assert.equal(attribution.readMaintenanceFailure(detail).reason,'validation_invalid');
});

for(const kind of ['frame_conflict','identity_shape','result_bounds','result_clone','result_shape','open_identity'])
test('private protocol sub-kind: '+kind,async t=>{
  const f=fixture(t),c=configured(t,f.path,[ns],{service:true});c.options.host.configuration.protocolTest=kind;
  let h,result;
  if(kind==='identity_shape'||kind==='open_identity') result=await instrumented(true)(c.options).catch(error=>error);
  else {
    h=await instrumented(true)(c.options);t.after(()=>h.close());
    if(kind==='result_clone') {
      const clone=globalThis.structuredClone;
      t.mock.method(globalThis,'structuredClone',function(value,...rest){if(value?.value?.cloneFailure)throw new DOMException('synthetic clone failure','DataCloneError');return clone(value,...rest);});
    }
    result=await h.getContextIndexStatus(input,c.token);
    assert.deepEqual(result,{ok:false,error:{code:'reader_failed',retryable:false}},'protocol public bytes stay unchanged');
  }
  const record=maintenanceFailureDiagnostic(result);
  assert.equal(record?.cause,'protocol');assert.equal(record?.protocolKind,kind,'protocol failure retains the precise closed boundary');
  assert.equal(Object.hasOwn(result,'protocolKind'),false);if(h)await h.close();
});

test('private classification fields sanitize unknown values and stay off public exports',async()=>{
  const reason=attribution.maintenanceFailureRecord('engine',{engineCode:'index_unavailable',reason:'not allowed'});
  const protocol=attribution.maintenanceFailureRecord('protocol',{protocolKind:'not allowed'});
  assert.equal(reason.reason,'other');assert.equal(protocol.protocolKind,'other');
  assert.equal(attribution.readMaintenanceFailure({kind:'protocol',protocolKind:'not allowed'}).protocolKind,'other');
  assert.equal(attribution.maintenanceFailureRecord('protocol').protocolKind,'other');
  assert.equal(attribution.readMaintenanceFailure({kind:'engine',engineCode:'index_unavailable',reason:{}}).reason,'other');
  const api=await import('../index.mjs');for(const name of ['maintenanceIndexFailure','maintenanceFailureReason','contextReadDeleteJournal'])assert.equal(api[name],undefined);
});

test('journal classification: a crashed DELETE writer stays busy until read-write recovery',async t=>{
  const f=await prepared(t),c=configured(t,f.path,[ns]),h=await c.open();
  const child=spawnSync(process.execPath,[new URL('./fixtures/context-product-wal-process.mjs',import.meta.url).pathname,'hot',f.path],{env:{},encoding:'utf8',timeout:10000});
  assert.equal(child.status,0,child.stderr);assert.equal(child.error,undefined);
  const journal=f.path+'-journal',before=lstatSync(journal,{bigint:true});
  assert.deepEqual(await h.getContextIndexStatus(input,c.token),{ok:false,error:{code:'storage_busy',retryable:true}},'hot journal remains a retryable refusal');
  const after=lstatSync(journal,{bigint:true});for(const key of ['dev','ino','size','mtimeNs','ctimeNs'])assert.equal(after[key],before[key],'read-only refusal leaves the hot journal untouched');
  const recovery=new DatabaseSync(f.path);try{recovery.prepare('SELECT count(*) FROM memories').get();}finally{recovery.close();}
  assert.equal(existsSync(journal),false,'only a read-write connection performs recovery');
  assert.equal(ok(await h.getContextIndexStatus(input,c.token)).lexical.state,'ready');await h.close();
});

for(const [sql,reason] of [["UPDATE product_metadata SET store_id='synthetic-other-store'; PRAGMA user_version=99",'wrong_store'],["PRAGMA user_version=99",'incompatible']])
test('private index reason from real sidecar metadata: '+reason,async t=>{
  const f=await prepared(t),c=configured(t,f.path,[ns],{service:true}),h=await c.open();
  const db=new DatabaseSync(f.path+PRODUCT_SIDECAR_SUFFIX);try{db.exec(sql);}finally{db.close();}
  const result=await h.refreshContextIndex(refresh,c.token);
  assert.deepEqual(result,{ok:false,error:{code:'index_unavailable',retryable:false}});
  assert.equal(maintenanceFailureDiagnostic(result)?.reason,reason,'real metadata refusal keeps its private reason');await h.close();
});

test('journal control: sidecar WAL header with a journal keeps storage_unavailable',async t=>{
  const f=await prepared(t),c=configured(t,f.path,[ns],{service:true}),h=await c.open(),path=f.path+PRODUCT_SIDECAR_SUFFIX;
  const db=new DatabaseSync(path);try{assert.equal(db.prepare('PRAGMA journal_mode=WAL').get().journal_mode,'wal');}finally{db.close();}
  writeFileSync(path+'-journal','synthetic journal',{mode:0o600});
  try {
    const result=await h.getContextIndexStatus(input,c.token);
    assert.equal(ok(result).lexical.reason,'storage_unavailable','passing control: WAL header is never contention');
  } finally {unlinkSync(path+'-journal');await h.close();}
});

test('journal classification: a writer commit during the header check remains retryable',t=>{
  const f=fixture(t);f.admit('commit boundary control');
  const db=new DatabaseSync(f.path),native=childProcess.spawnSync;let committed=false;
  db.exec('BEGIN IMMEDIATE; UPDATE namespace_epochs SET epoch=epoch+1');
  t.mock.method(childProcess,'spawnSync',function(...args){
    if(!committed&&args[1]?.[2]?.includes('header[18]')){db.exec('COMMIT');committed=true;}
    return Reflect.apply(native,this,args);
  });syncBuiltinESMExports();
  try {
    assert.throws(()=>assertContextReadCanonicalDelete(f.path),{code:'storage_busy'},'content changes do not reclassify observed journal contention');
    assert.equal(committed,true,'real writer commits after the header-check metadata sample');
  } finally {t.mock.restoreAll();syncBuiltinESMExports();if(db.isTransaction)db.exec('ROLLBACK');db.close();}
  assert.doesNotThrow(()=>assertContextReadCanonicalDelete(f.path),'next admission succeeds after commit');
});

test('private index reason on Worker opening comes from the real canonical guard',async t=>{
  const f=fixture(t);f.admit('opening failure control');
  const c=configured(t,f.path,[ns],{service:true}),wal=f.path+'-wal';
  writeFileSync(wal,'synthetic companion',{mode:0o600});
  try {
    const error=await c.open().then(()=>assert.fail('unsafe opening was admitted'),error=>error);
    assert.equal(error.code,'index_unavailable','passing control: opening refusal code stays unchanged');
    assert.equal(maintenanceFailureDiagnostic(error)?.reason,'auxiliary_file','Worker bootstrap keeps the closed source reason');
    assert.equal(Object.hasOwn(error,'reason'),false,'the reason remains outside the public error');
  } finally {unlinkSync(wal);}
});

test('journal control: a replaced sidecar with a live journal keeps its refusal',async t=>{
  const f=await prepared(t),c=configured(t,f.path,[ns]),h=await c.open();
  ok(await h.getContextIndexStatus(input,c.token));
  const path=f.path+PRODUCT_SIDECAR_SUFFIX,replacement=path+'.replacement';
  const copy=spawnSync(process.execPath,[new URL('./fixtures/context-product-wal-process.mjs',import.meta.url).pathname,'copy',path,replacement],{env:{},encoding:'utf8',timeout:10000});
  assert.equal(copy.status,0,copy.stderr);assert.equal(copy.error,undefined);renameSync(replacement,path);
  const release=await writer(t,f,'sidecar'),result=await h.findCandidates({...input,query:'needle'},c.token);
  assert.equal(result.error?.code,'index_unavailable','passing control: replacement is not journal-only contention');
  assert.equal(result.error.retryable,false);assert.equal(result.error.details.coverage.maintenance.reason,'storage_unavailable');
  await release();await h.close();
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { Worker } from 'node:worker_threads';
import { DatabaseSync } from 'node:sqlite';
import { fixture, ns, ok, readTransaction } from '../testing/context-read-fixture.mjs';
import { configured, descriptor } from '../testing/context-product-owner-fixture.mjs';
import { createProductReaderRuntime } from '../context-product-reader.mjs';
import { productSidecar, PRODUCT_SIDECAR_SUFFIX } from '../context-product-sidecar.mjs';
import { openContextProductFacade } from '../context-read-facade.mjs';
import { accessDigest } from '../context-product-validation.mjs';
import { boundedData } from '../context-product-control.mjs';
import { createMaintenanceAttribution } from '../context-product-attribution.mjs';
import { nativeObserver } from '../context-product-telemetry.mjs';
import { fixture as dependencyFixture, ns as dependencyNamespace } from './card-current-fixture.mjs';

const input = readSet => ({readSet, types:['memory'], intent:'current', deadlineMs:5000});
const refresh = readSet => ({readSet,types:['memory'],intent:'current',mode:'lexical',budget:{maxItems:1,maxMs:5000}});
const reasons = {
  absent:['missing'], building:['initial_build','rebuild'], ready:[null],
  stale:['access_changed','dependency_changed','fence_changed'], catching_up:['resume_pending'],
  unavailable:['wrong_store','incompatible','corrupt','validation_missing','validation_invalid','storage_unavailable'],
};
function checked(dto, state, reason) {
  let bounded;
  assert.doesNotThrow(()=>{bounded=boundedData(dto,65536);},'status DTO must pass strict transport validation');
  assert.deepEqual(bounded,dto);
  assert.ok(reasons[dto.lexical.state].includes(dto.lexical.reason),'closed reason for '+dto.lexical.state);
  assert.notEqual(dto.lexical.progress,undefined);
  if (state) assert.equal(dto.lexical.state,state);
  if (arguments.length===3) assert.equal(dto.lexical.reason,reason);
  if (dto.lexical.state==='unavailable') assert.equal(dto.lexical.progress,null);
  return dto;
}
function local(t, f, extra={}) {
  const facade=openContextProductFacade(f.path,{});
  const storage=productSidecar({path:f.path,db:facade.port.db,identity:facade.port.identity,features:facade.port.features,writable:true,...extra});
  t.after(()=>{storage.close();facade.close();});
  const p={...input([ns]),ownerCoverage:descriptor([ns])}, access=accessDigest({ownerId:ns.ownerId,namespaces:{readSet:[ns]}});
  return {storage,facade,p,access,observe:()=>readTransaction(facade.port.db,()=>storage.observe(p,access)).dto};
}
function build(s) {
  for(let i=0;i<100;i++) {
    s.storage.refresh(s.p,s.access,{maxItems:1024,maxMs:5000});
    if(checked(s.observe()).lexical.state==='ready') return;
  }
  assert.fail('fixture build incomplete');
}

test('status polling survives a real shared DELETE sidecar change during its journal probe',async t=>{
  const f=fixture(t), owners=Array.from({length:4},(_,i)=>({...ns,ownerId:'synthetic-status-owner-'+i}));
  for(const owner of owners) for(let i=0;i<2;i++) f.admit('shared status fixture '+owner.ownerId+' '+i,owner);
  assert.equal(f.db.prepare('PRAGMA journal_mode').get().journal_mode,'delete');
  for(const owner of [owners[0],owners[2],owners[3]]) {
    const seed=configured(t,f.path,[owner],{service:true}), initial=await seed.open();
    for(let i=0;i<100;i++) {
      const result=ok(await initial.refreshContextIndex(refresh([owner]),seed.token));
      if(owner===owners[3]) {assert.equal(result.status,'rebuilding');break;}
      if(result.status==='complete') break;
      assert.notEqual(i,99,'seed complete');
    }
    await initial.close();
  }
  const side=new DatabaseSync(f.path+PRODUCT_SIDECAR_SUFFIX,{readOnly:true});
  assert.equal(side.prepare('PRAGMA journal_mode').get().journal_mode,'delete');side.close();
  const writer=configured(t,f.path,[owners[1]],{service:true}), maintainer=await writer.open();
  const request=configured(t,f.path,[owners[3]]), barrier=new SharedArrayBuffer(8), state=new Int32Array(barrier);
  request.options.host.configuration.statusProbeState=barrier;
  assert.equal(Object.hasOwn(request.options,'wal'),false);
  const frames=[];
  const open=createProductReaderRuntime({spawnWorker:data=>{
    const worker=new Worker(new URL('./fixtures/context-product-status-probe-worker.mjs',import.meta.url),{
      workerData:data,env:{},execArgv:[],stdout:true,stderr:true});
    worker.on('message',message=>{if(message.result?.value?.lexical) frames.push(message.result.value.lexical);});
    return worker;
  }});
  const reader=await open(request.options);t.after(()=>reader.close());
  let finished=false, result;
  const pending=reader.getContextIndexStatus(input([owners[3]]),request.token).then(value=>{result=value;}).finally(()=>{finished=true;});
  let commits=0;
  try {
    while(!finished) {
      const sequence=Atomics.load(state,0);
      if(sequence>commits) {
        ok(await maintainer.refreshContextIndex(refresh([owners[1]]),writer.token));
        commits=sequence;Atomics.store(state,1,commits);Atomics.notify(state,1);
      } else await Atomics.waitAsync(state,0,sequence,25).value;
    }
    await pending;
  } finally {Atomics.store(state,1,100);Atomics.notify(state,1);await reader.close();await maintainer.close();}
  assert.ok(commits>0,'real maintenance committed inside the probe fingerprint interval');
  const inventory=new DatabaseSync(f.path+PRODUCT_SIDECAR_SUFFIX,{readOnly:true});
  try {assert.equal(inventory.prepare('SELECT DISTINCT owner FROM generations').all().length,owners.length);}
  finally {inventory.close();}
  t.diagnostic('coordinated maintenance commits: '+commits+'; result frame reasons: '+frames.map(lexical=>String(lexical.reason)).join(','));
  assert.equal(result.ok,true,'status must succeed instead of reader_failed: '+JSON.stringify(result));
  checked(result.value,'unavailable','storage_unavailable');
});

for(const reason of [undefined,null,'unexpected','missing','fence_changed'])
test('status normalizes an out-of-vocabulary observe error: '+String(reason),t=>{
  const captured=[],attribution=createMaintenanceAttribution(),capture=attribution.captureFailure;
  attribution.captureFailure=error=>{captured.push(error);capture(error);};
  const f=fixture(t), s=local(t,f,{attribution});f.admit('reason normalization');build(s);
  const prepare=DatabaseSync.prototype.prepare, error=Object.assign(Error('synthetic observation failure'),{code:'index_unavailable',reason});
  t.mock.method(DatabaseSync.prototype,'prepare',function(sql){
    if(sql==='SELECT store_id FROM store_metadata WHERE singleton=1') throw error;
    return prepare.call(this,sql);
  });
  checked(s.observe(),'unavailable','storage_unavailable');
  assert.equal(captured.at(-1),error,'private failure capture keeps the original error');
});

test('status outer observe wrapper normalizes a reasonless opening failure',t=>{
  const f=fixture(t), seed=local(t,f);f.admit('outer wrapper');build(seed);
  const observer=nativeObserver();
  observer.invoke=()=>{throw Object.assign(Error('synthetic opening failure'),{code:'index_unavailable'});};
  const s=local(t,f,{observer});
  checked(s.observe(),'unavailable','storage_unavailable');
});

test('status keeps an existing storage_unavailable DTO unchanged',t=>{
  const f=fixture(t),s=local(t,f);f.admit('storage control');build(s);
  const dto=s.storage.observe(s.p,s.access,{knownFailure:'storage_unavailable'}).dto;
  checked(dto,'unavailable','storage_unavailable');
  assert.deepEqual(dto,{profile:'context-read-product-v1.1',lexical:{state:'unavailable',reason:'storage_unavailable',progress:null},
    semantic:{state:'disabled',reason:'not_enabled'},coverage:{status:'unavailable',freshness:'unverified',
      byType:{memory:{eligible:null,indexed:null,embedded:null}},namespaces:descriptor([ns])}});
});

test('status lifecycle and unavailable branches obey the bounded closed DTO contract',t=>{
  const f=fixture(t),s=local(t,f);
  checked(s.observe(),'absent','missing');
  f.admit('lifecycle first');f.admit('lifecycle second');
  s.storage.refresh(s.p,s.access,{maxItems:1,maxMs:5000});checked(s.observe(),'building','initial_build');
  build(s);checked(s.observe(),'ready',null);
  f.admit('lifecycle delta first');f.admit('lifecycle delta second');checked(s.observe(),'stale','fence_changed');
  checked(readTransaction(s.facade.port.db,()=>s.storage.observe(s.p,accessDigest({ownerId:ns.ownerId,namespaces:{readSet:[ns]},ownerGeneration:2}))).dto,'stale','access_changed');
  s.storage.refresh(s.p,s.access,{maxItems:1,maxMs:5000});checked(s.observe(),'catching_up','resume_pending');
  for(const reason of reasons.unavailable) checked(s.storage.observe(s.p,s.access,{knownFailure:reason}).dto,'unavailable',reason);
  build(s);
  const d=new DatabaseSync(f.path+PRODUCT_SIDECAR_SUFFIX);d.exec('DELETE FROM validation_records');d.close();
  checked(s.observe(),'unavailable','validation_missing');
  s.storage.refresh(s.p,s.access,{maxItems:1,maxMs:5000});
  const hide=new DatabaseSync(f.path+PRODUCT_SIDECAR_SUFFIX);hide.exec('DELETE FROM publications');hide.close();
  checked(s.observe(),'building','rebuild');
});

for(const method of ['journalProbe','creation'])
test(method+' rejects an incomplete native transcript with a closed storage reason',()=>{
  assert.throws(()=>nativeObserver()[method](()=>({complete:false,events:[],value:{mode:'delete'}})),
    error=>error.code==='index_unavailable'&&error.reason==='storage_unavailable');
});

for(const [damage,reason] of [
  ["UPDATE product_metadata SET store_id='other'",'wrong_store'],
  ['PRAGMA user_version=99','incompatible'],
  ['DELETE FROM validation_records','validation_missing'],
  ["UPDATE validation_records SET record='{}'",'validation_invalid'],
  [11,'corrupt'],[10,'storage_unavailable'],
]) test('status metadata/record/native denial is bounded: '+reason,t=>{
  const f=fixture(t),s=local(t,f);f.admit('closed denial');build(s);
  if(typeof damage==='string') {
    const side=new DatabaseSync(f.path+PRODUCT_SIDECAR_SUFFIX);side.exec(damage);side.close();
  } else {
    const prepare=DatabaseSync.prototype.prepare;
    t.mock.method(DatabaseSync.prototype,'prepare',function(sql){
      if(sql==='SELECT * FROM product_metadata WHERE singleton=1') throw Object.assign(Error('synthetic native failure'),{code:'ERR_SQLITE_ERROR',errcode:damage});
      return prepare.call(this,sql);
    });
  }
  checked(s.observe(),'unavailable',reason);
});

test('status dependency mismatch stays in the stale closed vocabulary',t=>{
  const f=dependencyFixture(t);f.card();
  const facade=openContextProductFacade(f.path,{}),storage=productSidecar({path:f.path,db:facade.port.db,
    identity:facade.port.identity,features:facade.port.features,writable:true});
  t.after(()=>{storage.close();facade.close();});
  const readSet=[dependencyNamespace],p={...input(readSet),types:['card'],ownerCoverage:descriptor(readSet)};
  const access=accessDigest({ownerId:dependencyNamespace.ownerId,namespaces:{readSet}});
  const observe=()=>readTransaction(facade.port.db,()=>storage.observe(p,access)).dto;
  build({storage,p,access,observe});checked(observe(),'ready',null);
  f.change();checked(observe(),'stale','dependency_changed');
});

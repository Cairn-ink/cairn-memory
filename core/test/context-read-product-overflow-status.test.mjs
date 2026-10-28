import test from 'node:test';
import assert from 'node:assert/strict';
import { Worker } from 'node:worker_threads';
import { DatabaseSync } from 'node:sqlite';
import { createProductReaderRuntime } from '../context-product-reader.mjs';
import { openContextProductFacade } from '../context-read-facade.mjs';
import { productSidecar, PRODUCT_SIDECAR_SUFFIX } from '../context-product-sidecar.mjs';
import { accessDigest } from '../context-product-validation.mjs';
import { PRODUCT_PROFILE } from '../context-product-control.mjs';
import { fixture, ok, readTransaction } from '../testing/context-read-fixture.mjs';
import { personal, project, configured, descriptor, denied } from '../testing/context-product-owner-fixture.mjs';
import { fixture as dependencyFixture, ns as dependencyNamespace } from './card-current-fixture.mjs';

const selected = [personal, ...Array.from({length:31},(_,i)=>project('p'+String(i).padStart(2,'0')))];
const input = readSet => ({readSet,types:['memory'],intent:'current',deadlineMs:5000});
const refresh = (readSet,maxItems=1024) => ({readSet,types:['memory'],intent:'current',mode:'lexical',budget:{maxItems,maxMs:5000}});
// Expected values are supplied explicitly by each case, independently of the
// engine's state-to-coverage logic. Embedded counts stay null on this profile.
const golden = (namespaces,state,reason,progress,status,freshness,counts=null,types=['memory']) => ({
  profile:PRODUCT_PROFILE,lexical:{state,reason,progress},semantic:{state:'disabled',reason:'not_enabled'},
  coverage:{status,freshness,byType:Object.fromEntries(types.map(type=>[type,{eligible:counts,indexed:counts,embedded:null}])),namespaces},
});
const instrumented = maintenance => createProductReaderRuntime({maintenance,spawnWorker:data=>new Worker(
  new URL('./fixtures/context-product-index-worker.mjs',import.meta.url),{workerData:data,env:{},execArgv:[],stdout:true,stderr:true})});
async function complete(h,config,readSet=selected){
  for(let i=0;i<100;i++)if(ok(await h.refreshContextIndex(refresh(readSet),config.token)).status==='complete')return;
  assert.fail('build did not complete');
}

for(const omitted of [0,1])test(`P2c fix1 P2-18 selected/omitted=${omitted} durable initial/delta crash and rebuild goldens`,async t=>{
  const f=fixture(t),namespaces=descriptor(selected,omitted);
  f.admit('overflow status first',personal);f.admit('overflow status second',personal);
  const s=configured(t,f.path,selected,{service:true,ownerCoverage:namespaces});let h=await s.open();
  const status=()=>h.getContextIndexStatus(input(selected),s.token).then(ok);
  assert.deepEqual(await status(),golden(namespaces,'absent','missing',null,'unavailable','unverified'));
  const checkpoint={phase:0,checkpoint:1,sequence:1,baseSequence:0};
  await h.close();
  const initial=configured(t,f.path,selected,{service:true,ownerCoverage:namespaces});initial.options.host.configuration.crashAtCheckpoint=1;
  const initialWorker=await instrumented(true)(initial.options);t.after(()=>initialWorker.close());
  denied(await initialWorker.refreshContextIndex(refresh(selected,1),initial.token),'reader_failed');await initialWorker.close();
  h=await s.open();
  assert.deepEqual(await status(),golden(namespaces,'building','initial_build',checkpoint,'unavailable','unverified'));
  await h.close();h=await s.open();
  assert.deepEqual(await status(),golden(namespaces,'building','initial_build',checkpoint,'unavailable','unverified'));
  await complete(h,s);
  // 32 scan streams + three verification phases + publication. The first
  // personal batch was split across two quanta, adding one checkpoint.
  const published={phase:35,checkpoint:37,sequence:1,baseSequence:0};
  assert.deepEqual(await status(),golden(namespaces,'ready',null,published,omitted?'partial':'complete','current',2));
  // Change a selected namespace after publication, without changing selection.
  const delta=[f.admit('overflow status delta A',personal),f.admit('overflow status delta B',personal)];
  assert.deepEqual(await status(),golden(namespaces,'stale','fence_changed',published,'unavailable','stale'));
  await h.close();
  // Kill the actual product Worker after committing one transformed delta
  // checkpoint. There is no timer-based race.
  const crash=configured(t,f.path,selected,{service:true,ownerCoverage:namespaces});
  crash.options.host.configuration.crashAtCheckpoint=1;
  const worker=await instrumented(true)(crash.options);t.after(()=>worker.close());
  denied(await worker.refreshContextIndex(refresh(selected,1),crash.token),'reader_failed');await worker.close();
  const durable={phase:0,checkpoint:1,sequence:2,baseSequence:1};
  // At least one newly transformed document belongs to the durable delta.
  const side=new DatabaseSync(f.path+PRODUCT_SIDECAR_SUFFIX,{readOnly:true});
  try{
    const row=side.prepare('SELECT g.phase,g.checkpoint,g.sequence,g.base_sequence FROM generations g JOIN work w ON w.generation=g.id').get();
    assert.deepEqual({...row},{phase:durable.phase,checkpoint:durable.checkpoint,sequence:2,base_sequence:1});
    const ids=side.prepare('SELECT d.id FROM documents d JOIN generations g ON g.storage_id=d.generation JOIN work w ON w.generation=g.id').all().map(r=>r.id);
    assert.equal(delta.filter(m=>ids.includes(m.id)).length,1);
  }finally{side.close();}
  const expected=golden(namespaces,'catching_up','resume_pending',durable,'unavailable','stale');
  for(let reopen=0;reopen<2;reopen++){
    const r=configured(t,f.path,selected,{ownerCoverage:namespaces}),reader=await r.open();
    assert.deepEqual(ok(await reader.getContextIndexStatus(input(selected),r.token)),expected);
    const refused=await reader.findCandidates({...input(selected),query:'overflow'},r.token);denied(refused,'index_unavailable');
    assert.deepEqual(refused.error.details.coverage.namespaces,namespaces);
    assert.equal(refused.error.details.coverage.byType.memory.eligible,null);
    await reader.close();denied(await reader.getContextIndexStatus(input(selected),r.token),'store_closed');
  }
  const resume=configured(t,f.path,selected,{service:true,ownerCoverage:namespaces}),maintainer=await resume.open();
  await complete(maintainer,resume);await maintainer.close();
  // Force a rebuild with bounded incomplete progress, then remove the invalid
  // publication pointer so the independently signed rebuild record is exposed.
  const damage=new DatabaseSync(f.path+PRODUCT_SIDECAR_SUFFIX);damage.exec('DELETE FROM validation_records');damage.close();
  h=await s.open();ok(await h.refreshContextIndex(refresh(selected,1),s.token));
  assert.deepEqual(await status(),golden(namespaces,'unavailable','validation_missing',null,'unavailable','unverified'));
  const hide=new DatabaseSync(f.path+PRODUCT_SIDECAR_SUFFIX);hide.exec('DELETE FROM publications');hide.close();
  assert.deepEqual(await status(),golden(namespaces,'building','rebuild',{phase:0,checkpoint:1,sequence:1,baseSequence:0},'unavailable','unverified'));
  f.admit('invalidate incomplete target',selected[31]);
  assert.deepEqual(await status(),golden(namespaces,'stale','fence_changed',null,'unavailable','stale'));
  await h.close();
});

function completeLocal(storage,p,access){
  for(let i=0;i<100;i++){
    storage.refresh(p,access,{maxItems:1024,maxMs:5000});
    if(storage.observe(p,access).dto.lexical.state==='ready')return;
  }
  assert.fail('local build did not complete');
}

const failures=[
  ["UPDATE product_metadata SET store_id='other'; PRAGMA user_version=99; DELETE FROM validation_records",'wrong_store'],
  ['PRAGMA user_version=99; DELETE FROM validation_records','incompatible'],
  ['DELETE FROM validation_records','validation_missing'],
  ["UPDATE validation_records SET record='{}'",'validation_invalid'],
  ['native-corrupt','corrupt'],
  ['native-storage','storage_unavailable'],
];
for(const omitted of [0,1])for(const [damage,reason] of failures)test(`P2c fix1 P2-18 selected/omitted=${omitted} ${reason} precedes stale`,t=>{
  const f=fixture(t);f.admit('overflow precedence',personal);
  const facade=openContextProductFacade(f.path,{}),storage=productSidecar({path:f.path,db:facade.port.db,
    identity:facade.port.identity,features:facade.port.features,writable:true});
  t.after(()=>{storage.close();facade.close();});
  const namespaces=descriptor(selected,omitted),p={...input(selected),ownerCoverage:namespaces};
  const access=accessDigest({ownerId:personal.ownerId,namespaces:{readSet:selected}});
  completeLocal(storage,p,access);
  f.admit('selected epoch changed',selected[31]);
  if(damage.startsWith('native-')){
    const prepare=DatabaseSync.prototype.prepare;
    t.mock.method(DatabaseSync.prototype,'prepare',function(sql){
      if(sql==='SELECT * FROM product_metadata WHERE singleton=1')throw Object.assign(Error('synthetic native failure'),{code:'ERR_SQLITE_ERROR',errcode:damage==='native-corrupt'?11:10});
      return prepare.call(this,sql);
    });
  }else{
    const side=new DatabaseSync(f.path+PRODUCT_SIDECAR_SUFFIX);side.exec(damage);side.close();
  }
  const actual=readTransaction(facade.port.db,()=>storage.observe(p,access)).dto;
  assert.deepEqual(actual,golden(namespaces,'unavailable',reason,null,'unavailable','unverified'));
});

for(const omitted of [0,1])test(`P2c fix1 P2-18 selected/omitted=${omitted} access/dependency/canonical mismatch priority`,t=>{
  const f=dependencyFixture(t);f.card();
  const readSet=[dependencyNamespace,
    ...Array.from({length:31},(_,i)=>({ownerId:dependencyNamespace.ownerId,scope:'project',projectId:'overflow-'+i}))];
  const namespaces=descriptor(readSet,omitted),p={...input(readSet),types:['card'],ownerCoverage:namespaces};
  const facade=openContextProductFacade(f.path,{}),storage=productSidecar({path:f.path,db:facade.port.db,
    identity:facade.port.identity,features:facade.port.features,writable:true});
  t.after(()=>{storage.close();facade.close();});
  const access=accessDigest({ownerId:dependencyNamespace.ownerId,namespaces:{readSet}});
  completeLocal(storage,p,access);
  const observe=(a=access)=>readTransaction(facade.port.db,()=>storage.observe(p,a)).dto;
  const progress={phase:131,checkpoint:133,sequence:1,baseSequence:0};
  assert.deepEqual(observe(),golden(namespaces,'ready',null,progress,omitted?'partial':'complete','current',1,['card']));
  f.db.prepare('UPDATE card_epochs SET generation=generation+1 WHERE owner_id=?').run(dependencyNamespace.ownerId);
  assert.deepEqual(observe(),golden(namespaces,'stale','fence_changed',progress,'unavailable','stale',null,['card']));
  f.change();
  assert.deepEqual(observe(),golden(namespaces,'stale','dependency_changed',progress,'unavailable','stale',null,['card']));
  const changed=accessDigest({ownerId:dependencyNamespace.ownerId,namespaces:{readSet},ownerGeneration:2});
  assert.deepEqual(observe(changed),golden(namespaces,'stale','access_changed',progress,'unavailable','stale',null,['card']));
  // Untrusted publication evidence wins over all three current-fence mismatches.
  const side=new DatabaseSync(f.path+PRODUCT_SIDECAR_SUFFIX);side.exec("UPDATE validation_records SET record='{}'");side.close();
  assert.deepEqual(observe(changed),golden(namespaces,'unavailable','validation_invalid',null,'unavailable','unverified',null,['card']));
});

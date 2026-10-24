import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync,writeFileSync } from 'node:fs';
import { openMemoryCore } from '../contract.mjs';
import { fixture,ns,input,pdf,ok,error,child,childHost,moduleURL,corrupt } from '../testing/asset-fixtures.mjs';
import { mixedInput,derivativeInput as derive } from '../testing/asset-mixed-fixtures.mjs';
import { race,launch,until } from '../testing/asset-race.mjs';
const retained=db=>db.prepare('SELECT coalesce(sum(byte_count),0) n FROM binary_objects').get().n+
  db.prepare('SELECT coalesce(sum(byte_count),0) n FROM asset_derivatives').get().n;
for(const kind of ['Version','Package'])test(`K09/K11 feature-off deleteMethod${kind} purges corrupt attachments without binary grants or payload verification`,t=>{
  const f=fixture(t,{methods:true}),saved=ok(f.call('importMethodVersion',mixedInput())),standalone=ok(f.call('importAssetVersion',input())),d=ok(f.call('createAssetDerivative',derive(standalone.version)));
  const object=f.db.prepare('SELECT id FROM binary_objects WHERE method_version_id=?').get(saved.version.versionId);
  corrupt(f.db,'binary_chunk_immutable','UPDATE binary_chunks SET bytes=? WHERE object_id=? AND chunk_index=0',Buffer.alloc(32768),object.id);
  const methodOnly=openMemoryCore({path:f.path,methodPackages:f.trusted.methods});t.after(()=>methodOnly.close());
  const deletion={actionId:'purge-mixed',ref:kind==='Version'?saved.version:saved.package,expectedRevision:1},method='deleteMethod'+kind;
  const result=ok(f.trusted.call(methodOnly,method,deletion));assert.equal(result.effectCount,1);
  assert.equal(f.db.prepare('SELECT count(*) n FROM method_mixed_entries').get().n,0);
  assert.equal(f.db.prepare('SELECT count(*) n FROM method_files').get().n,0);
  assert.equal(f.db.prepare('SELECT count(*) n FROM binary_objects WHERE method_version_id IS NOT NULL').get().n,0);
  assert.equal(f.db.prepare('SELECT byte_count FROM binary_owner_usage').get().byte_count,retained(f.db));
  assert.equal(f.db.prepare('SELECT count(*) n FROM method_effects').get().n,1);assert.equal(f.db.prepare('SELECT count(*) n FROM asset_effects').get().n,2);
  const row=f.db.prepare('SELECT * FROM method_versions').get();assert.equal(row.state,'deleted');assert.equal(row.title,null);assert.equal(row.submitted_by,null);assert.equal(row.byte_count,0);
  child(`import assert from 'node:assert/strict';import {openMemoryCore} from ${JSON.stringify(moduleURL('core/contract.mjs'))};${childHost}
    const [path,method,remove,result,create,imported]=process.argv.slice(1),core=openMemoryCore({path,methodPackages:methods});
    try{assert.deepEqual(ok(core[method](JSON.parse(remove),token)),JSON.parse(result));assert.equal(ok(core.getMethodVersion({version:JSON.parse(imported).version,intent:'history'},token)).status,'unavailable');}
    finally{core.close();}
    const both=openMemoryCore({path,methodPackages:methods,assets:{version:'assets-local-v1',storage:'sqlite-blob-v1',authority}});
    try{const value=JSON.parse(create);value.files[1].bytes=Buffer.alloc(33000,0x61);value.files[1].bytes.set(Buffer.from('%PDF-1.7'));assert.deepEqual(ok(both.importMethodVersion(value,token)),JSON.parse(imported));assert.equal(ok(both.readMethodAttachmentBytes({version:JSON.parse(imported).version,path:'reference.pdf',intent:'history'},token)).status,'unavailable');}finally{both.close();}`,
    [f.path,method,JSON.stringify(deletion),JSON.stringify(result),JSON.stringify({...mixedInput(),files:[mixedInput().files[0],{kind:'binary',path:'reference.pdf',mediaType:'application/pdf'}]}),JSON.stringify(saved)]);
  assert.equal(ok(f.call('readAssetDerivative',{ref:d.derivative})).status,'available');
  assert.equal(f.db.prepare('SELECT count(*) n FROM binary_objects').get().n,1);assert.deepEqual(f.db.prepare('PRAGMA foreign_key_check').all(),[]);
});
for(const kind of ['Asset','AssetVersion'])test(`K09 delete${kind} purges every derivative and source byte exactly once with one target effect`,t=>{
  const f=fixture(t),first=ok(f.call('importAssetVersion',input())),a=ok(f.call('createAssetDerivative',derive(first.version))),
    second=ok(f.call('importAssetVersion',input('second',{asset:first.asset,expectedAssetRevision:1,bytes:pdf(9)}))),b=ok(f.call('createAssetDerivative',derive(second.version,'second-derive',{text:'é😀'})));
  const before=retained(f.db),method='delete'+kind,request={actionId:'purge-parent',ref:kind==='Asset'?first.asset:first.version,expectedRevision:kind==='Asset'?2:1},result=ok(f.call(method,request));
  assert.equal(result.effectCount,1);assert.equal(ok(f.call('readAssetDerivative',{ref:a.derivative})).status,'unavailable');
  if(kind==='Asset')assert.equal(retained(f.db),0);else{assert.equal(retained(f.db),9+Buffer.byteLength('é😀'));assert.equal(ok(f.call('readAssetDerivative',{ref:b.derivative})).status,'available');}
  assert.ok(before>retained(f.db));assert.equal(f.db.prepare('SELECT byte_count FROM binary_owner_usage').get().byte_count,retained(f.db));
  f.reopen();assert.deepEqual(ok(f.call(method,request)),result);assert.equal(f.db.prepare('SELECT byte_count FROM binary_owner_usage').get().byte_count,retained(f.db));
  const effects=ok(f.call('listAssetEffects',{namespace:ns})).effects;assert.equal(effects.length,5);assert.equal(effects.filter(item=>item.kind==='asset_derivative_deleted').length,0);
  assert.deepEqual(f.db.prepare('PRAGMA foreign_key_check').all(),[]);
});
test('K09 independent derivative-create/source-delete race leaves only tombstones, exact reservations and replayable receipts',async t=>{
  const f=fixture(t),source=ok(f.call('importAssetVersion',input())),operations=[{method:'createAssetDerivative',input:derive(source.version)},
    {method:'deleteAssetVersion',input:{actionId:'delete-source',ref:source.version,expectedRevision:1}}];
  const results=await race(f,operations);assert.equal(results[1].ok,true);if(!results[0].ok)error(results[0],'revision_conflict');
  assert.equal(retained(f.db),0);assert.equal(f.db.prepare('SELECT byte_count FROM binary_owner_usage').get().byte_count,0);
  assert.equal(f.db.prepare("SELECT count(*) n FROM asset_derivatives WHERE state='available'").get().n,0);
  for(const [i,result]of results.entries())if(result.ok)assert.deepEqual(ok(f.call(operations[i].method,operations[i].input)),result.value);
  assert.equal(f.db.prepare('SELECT count(*) n FROM asset_effects').get().n,1+Number(results[0].ok)+1);
  assert.deepEqual(f.db.prepare('PRAGMA foreign_key_check').all(),[]);
});
test('K05/K09 a real derivative creator killed before COMMIT leaves no text, quota reservation, receipt or effect',async t=>{
  const f=fixture(t),source=ok(f.call('importAssetVersion',input())),before=f.db.prepare('SELECT byte_count FROM binary_owner_usage').get().byte_count;
  const worker=launch(f,{method:'createAssetDerivative',input:derive(source.version),killBeforeCommit:true});
  await until(()=>existsSync(worker.config.ready),'creator ready');writeFileSync(worker.config.start,'go');
  await until(()=>existsSync(worker.config.beforeCommit),'complete staged derivative');assert.equal(existsSync(worker.config.result),false);
  worker.child.kill('SIGKILL');assert.deepEqual(await worker.closed,{code:null,signal:'SIGKILL'});f.reopen();
  assert.equal(f.db.prepare('SELECT count(*) n FROM asset_derivatives').get().n,0);assert.equal(f.db.prepare('SELECT byte_count FROM binary_owner_usage').get().byte_count,before);
  for(const table of ['asset_operations','asset_effects'])assert.equal(f.db.prepare('SELECT count(*) n FROM '+table).get().n,1);
  assert.deepEqual(f.db.prepare('PRAGMA foreign_key_check').all(),[]);
});
test('K04 mixed and derivative reservations share the real owner cap and roll back text quota, parents and ledger on refusal',{timeout:90000},t=>{
  const f=fixture(t,{methods:true}),maximum=pdf(33554432);let first;
  for(let i=0;i<5;i++){const value=ok(f.call('importAssetVersion',input('fill-'+i,{bytes:maximum})));first??=value;}
  ok(f.call('importAssetVersion',input('fill-final',{bytes:pdf(200000000-5*maximum.length)})));
  assert.equal(retained(f.db),200000000);
  const before=f.db.prepare('SELECT count(*) n FROM asset_operations').get().n;
  error(f.call('importMethodVersion',mixedInput('quota-mixed')),'quota_reached');
  error(f.call('createAssetDerivative',derive(first.version,'quota-derivative',{text:'é'})),'quota_reached');
  for(const table of ['method_packages','method_versions','method_files','method_operations','method_owner_usage','method_mixed_entries','asset_derivatives'])
    assert.equal(f.db.prepare('SELECT count(*) n FROM '+table).get().n,0,table+' has no refused partial mutation');
  assert.equal(f.db.prepare('SELECT count(*) n FROM asset_operations').get().n,before);
  assert.equal(f.db.prepare('SELECT byte_count FROM binary_owner_usage').get().byte_count,200000000);
  ok(f.call('deleteAsset',{actionId:'free-capacity',ref:first.asset,expectedRevision:1}));
  const mixed=ok(f.call('importMethodVersion',mixedInput('quota-mixed')));
  assert.equal(f.db.prepare('SELECT byte_count FROM binary_owner_usage').get().byte_count,200000000-maximum.length+33000);
  ok(f.call('deleteMethodVersion',{actionId:'release-mixed',ref:mixed.version,expectedRevision:1}));
  assert.equal(f.db.prepare('SELECT byte_count FROM binary_owner_usage').get().byte_count,retained(f.db));
  assert.equal(retained(f.db),200000000-maximum.length);assert.deepEqual(f.db.prepare('PRAGMA foreign_key_check').all(),[]);
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { openMemoryCore } from '../contract.mjs';
import { openReadDatabase } from '../read-database.mjs';
import { validateAssets,assertNoAssets } from '../asset-schema.mjs';
import { fixture as localFixture } from '../../adapters/local/test/fixtures/workspace.mjs';
import { setupFixture } from '../../integrations/client/test/fixtures/local-setup-workspace.mjs';
import { preflight } from '../../adapters/local/configuration.mjs';
import { checkHostPermission } from '../../integrations/client/raw/local-host-permission.mjs';
import { fixture,assetHost,ns,input,ok,bytes,child,childHost,moduleURL } from '../testing/asset-fixtures.mjs';
import { mixedInput,derivativeInput } from '../testing/asset-mixed-fixtures.mjs';

const rows=(db,table)=>db.prepare('SELECT * FROM '+table).all();
function replace(db,table,row,patch={}) {
  const value={...row,...patch},keys=Object.keys(value);
  return db.prepare(`INSERT OR REPLACE INTO ${table} (${keys.join(',')}) VALUES (${keys.map(()=>'?').join(',')})`).run(...Object.values(value));
}
function unchanged(db,work,expected) {
  const before=db.prepare('SELECT name FROM sqlite_master WHERE type=\'table\' ORDER BY name').all()
    .map(({name})=>[name,rows(db,name)]);
  assert.throws(work,expected);
  for(const [name,saved]of before)assert.deepEqual(rows(db,name),saved,name);
  assert.deepEqual(db.prepare('PRAGMA foreign_key_check').all(),[]);
}

test('K09 REPLACE cannot restore asset/version/derivative tombstones or their purged objects and chunks with recursive_triggers off',t=>{
  const f=fixture(t);assert.equal(f.db.prepare('PRAGMA recursive_triggers').get().recursive_triggers,0);
  const imported=ok(f.call('importAssetVersion',input())),derivative=ok(f.call('createAssetDerivative',derivativeInput(imported.version)));
  const asset=rows(f.db,'assets')[0],version=rows(f.db,'asset_versions')[0],derived=rows(f.db,'asset_derivatives')[0];
  const rowid=table=>f.db.prepare('SELECT rowid FROM '+table+' LIMIT 1').get().rowid;
  const assetRowid=rowid('assets'),versionRowid=rowid('asset_versions'),derivativeRowid=rowid('asset_derivatives');
  const object=rows(f.db,'binary_objects')[0],chunk=rows(f.db,'binary_chunks')[0];
  for(const [table,row]of [['assets',asset],['asset_versions',version],['asset_derivatives',derived],['binary_objects',object],['binary_chunks',chunk]])
    unchanged(f.db,()=>replace(f.db,table,row));
  ok(f.call('deleteAssetDerivative',{actionId:'delete-derived',ref:derivative.derivative,expectedRevision:1}));
  unchanged(f.db,()=>replace(f.db,'asset_derivatives',derived));
  assert.throws(()=>replace(f.db,'asset_derivatives',derived,{rowid:derivativeRowid,id:'alias-derivative'}),/asset_derivative_immutable/);
  ok(f.call('deleteAssetVersion',{actionId:'delete-version',ref:imported.version,expectedRevision:1}));
  // Reproduce the reviewer's complete rebuild transaction. A one-statement
  // restore could fail only because its deferred object FK is not filled yet.
  unchanged(f.db,()=>{
    f.db.exec('BEGIN IMMEDIATE');
    try {
      replace(f.db,'asset_versions',version);replace(f.db,'binary_objects',object);replace(f.db,'binary_chunks',chunk);
      f.db.exec('COMMIT');
    } catch(error) {f.db.exec('ROLLBACK');throw error;}
  });
  for(const [table,row]of [['asset_versions',version],['asset_derivatives',derived],['binary_objects',object],['binary_chunks',chunk]])
    unchanged(f.db,()=>replace(f.db,table,row));
  assert.throws(()=>replace(f.db,'asset_versions',version,{id:'alias-version',content_identity:'a'.repeat(43),object_id:'alias-object'}),/asset_version_immutable/);
  assert.throws(()=>replace(f.db,'asset_versions',version,{rowid:versionRowid,id:'rowid-alias',ordinal:2,object_id:'rowid-object'}),/asset_version_immutable/);
  assert.equal(ok(f.call('readAssetBytes',{version:imported.version})).status,'unavailable');
  ok(f.call('deleteAsset',{actionId:'delete-parent',ref:imported.asset,expectedRevision:2}));
  unchanged(f.db,()=>replace(f.db,'assets',asset));
  assert.throws(()=>replace(f.db,'assets',asset,{rowid:assetRowid,id:'alias-asset'}),/asset_terminal/);
  f.reopen();assert.deepEqual(ok(f.call('getAssetVersion',{version:imported.version})),{version:null,status:'unavailable'});
  assert.equal(ok(f.call('getAssetUsage',{namespace:ns})).retainedBinaryBytes,0);
  child(`import assert from 'node:assert/strict';import {openMemoryCore} from ${JSON.stringify(moduleURL('core/contract.mjs'))};${childHost}
    const core=openMemoryCore({path:process.argv[1],assets:{version:'assets-local-v1',storage:'sqlite-blob-v1',authority}});
    try{assert.equal(ok(core.readAssetBytes({version:JSON.parse(process.argv[2])},token)).status,'unavailable');}
    finally{core.close();}`,[f.path,JSON.stringify(imported.version)]);
});

test('K09 immutable binary and mixed-manifest unique keys refuse replacement rather than changing ownership or quota',t=>{
  const f=fixture(t,{methods:true}),asset=ok(f.call('importAssetVersion',input())),mixed=ok(f.call('importMethodVersion',mixedInput()));
  const object=rows(f.db,'binary_objects').find(row=>row.asset_version_id),chunk=rows(f.db,'binary_chunks').find(row=>row.object_id===object.id);
  unchanged(f.db,()=>replace(f.db,'binary_objects',object,{id:'alias-owner'}));
  unchanged(f.db,()=>replace(f.db,'binary_chunks',chunk,{chunk_mac:'tampered',bytes:Buffer.alloc(chunk.bytes.length)}));
  const format=rows(f.db,'method_manifest_formats')[0],entries=rows(f.db,'method_mixed_entries');
  unchanged(f.db,()=>replace(f.db,'method_manifest_formats',format));
  for(const entry of entries)unchanged(f.db,()=>replace(f.db,'method_mixed_entries',entry));
  const text=entries.find(row=>row.kind==='text');
  unchanged(f.db,()=>replace(f.db,'method_mixed_entries',text,{position:200}));
  assert.deepEqual(bytes(f,asset.version),input().bytes);
  ok(f.call('deleteMethodVersion',{actionId:'purge-mixed',ref:mixed.version,expectedRevision:1}));
  unchanged(f.db,()=>replace(f.db,'method_manifest_formats',format));
  for(const entry of entries)unchanged(f.db,()=>replace(f.db,'method_mixed_entries',entry));
});

test('K09 v31 method guards reject stale packages, version ordinals, files and changes while preserving v30 definitions',t=>{
  const f=fixture(t,{methods:true}),first=ok(f.call('importMethodVersion',{namespace:ns,actionId:'first',title:'Synthetic',files:[{path:'a.txt',text:'first',mediaType:'text/plain'}]}));
  const second=ok(f.call('importMethodVersion',{namespace:ns,actionId:'second',package:first.package,expectedPackageRevision:1,basedOn:first.version,
    title:'Second',files:[{path:'a.txt',text:'second',mediaType:'text/plain'}],change:{items:[{summary:'Synthetic change',paths:['a.txt']}],reasonRefs:[]}}));
  const pkg=rows(f.db,'method_packages')[0],version=rows(f.db,'method_versions').find(row=>row.id===second.version.versionId);
  const packageRowid=f.db.prepare('SELECT rowid FROM method_packages WHERE id=?').get(pkg.id).rowid;
  const versionRowid=f.db.prepare('SELECT rowid FROM method_versions WHERE id=?').get(version.id).rowid;
  const file=rows(f.db,'method_files').find(row=>row.version_id===version.id),change=rows(f.db,'method_changes')[0];
  unchanged(f.db,()=>replace(f.db,'method_files',file,{position:200}));
  unchanged(f.db,()=>replace(f.db,'method_versions',version,{id:'alias-method',manifest_identity:'b'.repeat(43)}));
  ok(f.call('deleteMethodVersion',{actionId:'delete-version',ref:second.version,expectedRevision:1}));
  for(const [table,row]of [['method_versions',version],['method_files',file],['method_changes',change]])unchanged(f.db,()=>replace(f.db,table,row));
  assert.throws(()=>replace(f.db,'method_versions',version,{rowid:versionRowid,id:'rowid-method',ordinal:3}),/method_version_terminal/);
  unchanged(f.db,()=>f.db.prepare("UPDATE method_versions SET state='available',title='stale' WHERE id=?").run(version.id));
  ok(f.call('deleteMethodPackage',{actionId:'delete-package',ref:first.package,expectedRevision:3}));
  unchanged(f.db,()=>replace(f.db,'method_packages',pkg));
  unchanged(f.db,()=>replace(f.db,'method_packages',pkg,{revision:1,next_ordinal:1}));
  assert.throws(()=>replace(f.db,'method_packages',pkg,{rowid:packageRowid,id:'rowid-package',revision:1,next_ordinal:1}),/method_package_terminal/);
  unchanged(f.db,()=>f.db.prepare("UPDATE method_packages SET state='available' WHERE id=?").run(pkg.id));
  unchanged(f.db,()=>replace(f.db,'method_versions',version,{id:'late-child',ordinal:3}));
  f.reopen();assert.equal(ok(f.call('getMethodVersion',{version:second.version,intent:'history'})).status,'unavailable');
});

test('K09 disabled bindings and generations resist stale replacement; legitimate CAS re-adoption still advances history',t=>{
  const f=fixture(t,{methods:true}),target=ok(f.call('importMethodVersion',{namespace:ns,actionId:'target',title:'Synthetic',files:[{path:'a.txt',text:'target',mediaType:'text/plain'}]}));
  const common={bindingNamespace:ns,package:target.package,roleId:null,readSet:[ns]};
  ok(f.call('adoptMethodVersion',{...common,actionId:'adopt',version:target.version,expectedRevision:null}));
  const binding=rows(f.db,'method_bindings')[0],generation=rows(f.db,'method_binding_generations')[0],event=rows(f.db,'method_binding_events')[0];
  const bindingRowid=f.db.prepare('SELECT rowid FROM method_bindings').get().rowid;
  ok(f.call('disableMethodBinding',{...common,actionId:'disable',expectedRevision:1}));
  for(const [table,row]of [['method_bindings',binding],['method_binding_generations',generation],['method_binding_events',event]])
    unchanged(f.db,()=>replace(f.db,table,row));
  assert.throws(()=>replace(f.db,'method_bindings',binding,{rowid:bindingRowid,role_key:'alias-role',generation:2}),/method_binding_revision/);
  unchanged(f.db,()=>replace(f.db,'method_binding_events',event,{event_id:'alias-event',ordinal:100}));
  unchanged(f.db,()=>f.db.exec('DELETE FROM method_bindings'));
  assert.equal(ok(f.call('resolveMethod',{readSet:[ns],package:target.package,roleId:null})).status,'disabled');
  ok(f.call('adoptMethodVersion',{...common,actionId:'readopt',version:target.version,expectedRevision:2}));
  assert.equal(ok(f.call('resolveMethod',{readSet:[ns],package:target.package,roleId:null})).status,'current');
  assert.equal(rows(f.db,'method_binding_events').length,3);
});

test('K09 UPDATE OR REPLACE cannot evict asset tombstones through a live row or its hidden rowid',t=>{
  const f=fixture(t),first=ok(f.call('importAssetVersion',input('one')));
  const second=ok(f.call('importAssetVersion',input('two',{asset:first.asset,expectedAssetRevision:1})));
  const firstRowid=f.db.prepare('SELECT rowid FROM asset_versions WHERE id=?').get(first.version.versionId).rowid;
  const derived=ok(f.call('createAssetDerivative',derivativeInput(second.version,'derive-one')));
  ok(f.call('createAssetDerivative',derivativeInput(second.version,'derive-two')));
  const derivativeRowid=f.db.prepare('SELECT rowid FROM asset_derivatives WHERE id=?').get(derived.derivative.derivativeId).rowid;
  ok(f.call('deleteAssetDerivative',{actionId:'purge-derived',ref:derived.derivative,expectedRevision:1}));
  unchanged(f.db,()=>f.db.prepare("UPDATE OR REPLACE asset_derivatives SET rowid=?,state='deleted',revision=2,kind=NULL,text=NULL,provenance=NULL,language=NULL,timecodes=NULL,byte_count=0 WHERE id!=?")
    .run(derivativeRowid,derived.derivative.derivativeId),/asset_derivative_rowid_immutable/);
  ok(f.call('deleteAssetVersion',{actionId:'purge-version',ref:first.version,expectedRevision:1}));
  unchanged(f.db,()=>f.db.prepare("UPDATE OR REPLACE asset_versions SET rowid=?,state='deleted',revision=2,title=NULL,filename=NULL,media_type=NULL,byte_count=0,object_id=NULL WHERE id=?")
    .run(firstRowid,second.version.versionId),/asset_version_rowid_immutable/);
  const other=ok(f.call('importAssetVersion',input('other'))),parentRowid=f.db.prepare('SELECT rowid FROM assets WHERE id=?').get(first.asset.assetId).rowid;
  ok(f.call('deleteAsset',{actionId:'purge-parent',ref:first.asset,expectedRevision:3}));
  unchanged(f.db,()=>f.db.prepare('UPDATE OR REPLACE assets SET rowid=? WHERE id=?').run(parentRowid,other.asset.assetId),/asset_rowid_immutable/);
});

test('K09 v31 method identity updates cannot replace tombstones or move disabled barriers',t=>{
  const f=fixture(t,{methods:true});
  const make=actionId=>ok(f.call('importMethodVersion',{namespace:ns,actionId,title:'Synthetic',files:[{path:'a.txt',text:'Synthetic',mediaType:'text/plain'}]}));
  const first=make('one'),second=make('two');
  const common={bindingNamespace:ns,package:second.package,readSet:[ns]};
  ok(f.call('disableMethodBinding',{...common,roleId:'barrier',actionId:'barrier',expectedRevision:null}));
  ok(f.call('adoptMethodVersion',{...common,roleId:'live',actionId:'live',expectedRevision:null,version:second.version}));
  unchanged(f.db,()=>f.db.exec("UPDATE OR REPLACE method_bindings SET role_key='barrier',revision=revision+1,generation=generation+1 WHERE role_key='live'"),/method_binding_revision/);
  const event=rows(f.db,'method_binding_events')[0];
  unchanged(f.db,()=>f.db.prepare('UPDATE OR REPLACE method_binding_events SET ordinal=? WHERE event_id!=?').run(event.ordinal,event.event_id),/method_binding_event_immutable/);
  ok(f.call('deleteMethodPackage',{actionId:'delete-one',ref:first.package,expectedRevision:1}));
  unchanged(f.db,()=>f.db.prepare('UPDATE OR REPLACE method_packages SET id=? WHERE id=?').run(first.package.packageId,second.package.packageId),/method_package_terminal/);
  unchanged(f.db,()=>f.db.prepare('UPDATE OR REPLACE method_versions SET id=? WHERE id=?').run(first.version.versionId,second.version.versionId),/method_version_terminal/);
  unchanged(f.db,()=>f.db.prepare('UPDATE method_files SET version_id=? WHERE version_id=?').run(first.version.versionId,second.version.versionId),/method_file_immutable/);
  assert.equal(ok(f.call('resolveMethod',{readSet:[ns],package:second.package,roleId:'barrier'})).status,'disabled');
});

test('K09 a purged change edge cannot be rebuilt after its source version is deleted while its target stays live',t=>{
  const f=fixture(t,{methods:true}),files=[{path:'a.txt',text:'Synthetic',mediaType:'text/plain'}];
  const first=ok(f.call('importMethodVersion',{namespace:ns,actionId:'one',title:'One',files}));
  const second=ok(f.call('importMethodVersion',{namespace:ns,actionId:'two',package:first.package,expectedPackageRevision:1,basedOn:first.version,title:'Two',files,
    change:{items:[{summary:'Purged prose',paths:['a.txt']}],reasonRefs:[]}}));
  const change=rows(f.db,'method_changes')[0];
  ok(f.call('deleteMethodVersion',{actionId:'purge-source',ref:first.version,expectedRevision:1}));
  assert.equal(rows(f.db,'method_changes').length,0);
  unchanged(f.db,()=>replace(f.db,'method_changes',change));
  assert.deepEqual(ok(f.call('getMethodVersion',{version:second.version,intent:'history'})).version.ref,second.version);
});

async function refusesEveryOpener(t,f) {
  const h=assetHost(),path=f.databasePath,before=readFileSync(path),storeId=f.config.authority.storeId;
  const db=new DatabaseSync(path,{readOnly:true}),version=db.prepare('PRAGMA user_version').get().user_version;db.close();
  for(const options of [{},{assets:h.options},{methodPackages:h.methods},{existingStore:{version:`schema${version}-existing-v1`,storeId}}])
    assert.throws(()=>openMemoryCore({path,...options}),{code:'unsupported_database'});
  assert.throws(()=>openReadDatabase(path),{code:'unsupported_database'});
  await assert.rejects(preflight(f.config),{code:'invalid_local_capture_configuration'});
  await assert.rejects(checkHostPermission(f.config));
  const setup=await setupFixture(t);setup.request.databasePath=path;
  const outcome=await setup.setup();assert.equal(outcome.status,'blocked',JSON.stringify(outcome));assert.equal(outcome.reason,'store_invalid');
  assert.deepEqual(readFileSync(path),before);
}
for(const table of ['binary_objects','asset_derivatives','method_versions','method_files','method_bindings'])
  test(`K01 unexpected trigger on ${table} is refused by ordinary, read-only, managed, setup and local validation`,async t=>{
    const f=localFixture(t),h=assetHost(),core=openMemoryCore({path:f.databasePath,assets:h.options});core.close();
    const db=new DatabaseSync(f.databasePath);
    db.exec(table==='binary_objects'?"CREATE TRIGGER extra_release AFTER DELETE ON binary_objects BEGIN UPDATE binary_owner_usage SET byte_count=byte_count-OLD.byte_count WHERE owner_id=OLD.owner_id; END":
      `CREATE TRIGGER extra_owned_trigger AFTER INSERT ON ${table} BEGIN SELECT 1; END`);
    assert.throws(()=>validateAssets(db),{code:'unsupported_database'});db.close();await refusesEveryOpener(t,f);
  });

for(const name of ['asset_no_replace','method_binary_package_insert','method_binary_binding_insert'])
  test(`K01 weakened v31 guard ${name} is refused through every opener`,async t=>{
    const f=localFixture(t),h=assetHost(),core=openMemoryCore({path:f.databasePath,assets:h.options});core.close();
    const db=new DatabaseSync(f.databasePath),table=db.prepare('SELECT tbl_name FROM sqlite_master WHERE name=?').get(name).tbl_name;
    db.exec(`DROP TRIGGER ${name}; CREATE TRIGGER ${name} BEFORE INSERT ON ${table} BEGIN SELECT 1; END`);
    assert.throws(()=>validateAssets(db),{code:'unsupported_database'});db.close();await refusesEveryOpener(t,f);
  });

for(const version of [29,30])for(const [kind,sql]of [
  ['uppercase table','CREATE TABLE ASSETS(id TEXT) STRICT'],
  ['mixed-case table','CREATE TABLE BiNaRy_ChUnKs(id TEXT) STRICT'],
  ['uppercase index','CREATE INDEX ASSET_SCOPE ON memories(id)'],
  ['mixed-case index','CREATE INDEX MeThOd_MiXeD_extra ON memories(id)'],
  ['uppercase trigger','CREATE TRIGGER METHOD_BINARY_EXTRA AFTER INSERT ON memories BEGIN SELECT 1; END'],
  ['mixed-case trigger','CREATE TRIGGER AsSeT_extra AFTER INSERT ON memories BEGIN SELECT 1; END'],
  ['index owned through mixed-case tbl_name','CREATE TABLE AsSeTs(id TEXT) STRICT; CREATE INDEX innocuous_index ON AsSeTs(id)'],
  ['trigger owned through mixed-case tbl_name','CREATE TABLE BiNaRy_ChUnKs(id TEXT) STRICT; CREATE TRIGGER innocuous_trigger AFTER INSERT ON BiNaRy_ChUnKs BEGIN SELECT 1; END'],
])test(`K02 pre-v31 v${version} ${kind} refuses through every opener without repair`,async t=>{
  const f=localFixture(t);
  if(version===30){const core=openMemoryCore({path:f.databasePath,methodPackages:assetHost().methods});core.close();}
  const db=new DatabaseSync(f.databasePath);db.exec(sql);assert.throws(()=>assertNoAssets(db),{code:'unsupported_database'});db.close();
  await refusesEveryOpener(t,f);
});

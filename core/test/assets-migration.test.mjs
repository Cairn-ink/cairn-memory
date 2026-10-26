import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { DatabaseSync } from 'node:sqlite';
import { openMemoryCore } from '../contract.mjs';
import { openReadDatabase } from '../read-database.mjs';
import { ASSET_TABLES,validateAssets } from '../asset-schema.mjs';
import { installedImportClosure } from '../../packaging/test/fixtures/installed-import-closure.mjs';
import { createTestWorkspace } from '../../tools/testing/workspace.mjs';
import { fixture as localFixture } from '../../adapters/local/test/fixtures/workspace.mjs';
import { setupFixture } from '../../integrations/client/test/fixtures/local-setup-workspace.mjs';
import { preflight } from '../../adapters/local/configuration.mjs';
import { checkHostPermission } from '../../integrations/client/raw/local-host-permission.mjs';
import { host as methodHost,input as methodInput,ns as methodNamespace } from '../testing/method-package-fixtures.mjs';
import { assetHost,restoreV30,materializeV30,restoreHistoricalStore,historicalFixtures,child,moduleURL,childHost,ok } from '../testing/asset-fixtures.mjs';
const frozenLayout=JSON.parse(readFileSync(new URL('../testing/asset-v31-layout.json',import.meta.url),'utf8'));
const snapshot=db=>db.prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name").all().map(({name})=>({name,columns:db.prepare('PRAGMA table_info("'+name+'")').all().map(row=>row.name),rows:db.prepare('SELECT * FROM "'+name+'"').all()}));
test('K01 default v18, method-only v30 and asset-selected fresh v31 preserve opt-in surfaces',t=>{
  const w=createTestWorkspace(t),path=join(w.path,'store.sqlite'),h=assetHost();
  let c=openMemoryCore({path});const keys=Object.keys(c);assert.equal(c.getAssetCapabilities,undefined);c.close();
  let d=new DatabaseSync(path);assert.equal(d.prepare('PRAGMA user_version').get().user_version,18);d.close();
  c=openMemoryCore({path,methodPackages:h.methods});assert.equal(c.getAssetCapabilities,undefined);c.close();
  d=new DatabaseSync(path);assert.equal(d.prepare('PRAGMA user_version').get().user_version,30);d.close();
  c=openMemoryCore({path,assets:h.options});assert.equal(c.getMethodPackageCapabilities,undefined);c.close();
  d=new DatabaseSync(path);assert.equal(d.prepare('PRAGMA user_version').get().user_version,31);
  for(const table of ASSET_TABLES)assert.equal(d.prepare('SELECT count(*) n FROM '+table).get().n,0);
  assert.equal(d.prepare("SELECT count(*) n FROM pragma_table_list WHERE name IN ("+ASSET_TABLES.map(()=>'?').join(',')+") AND strict=1").get(...ASSET_TABLES).n,11);
  validateAssets(d);
  const names=new Set(frozenLayout.objects.map(row=>row.name));
  assert.deepEqual(d.prepare('SELECT name,type,tbl_name,sql FROM sqlite_master WHERE sql IS NOT NULL ORDER BY name').all().filter(row=>names.has(row.name)).map(row=>({...row})),frozenLayout.objects);
  d.close();
  const before=readFileSync(path);c=openMemoryCore({path});assert.deepEqual(Object.keys(c),keys);c.close();assert.deepEqual(readFileSync(path),before);
  c=openMemoryCore({path,methodPackages:h.methods});assert.equal(c.getAssetCapabilities,undefined);c.close();
  const fresh=join(w.path,'fresh.sqlite');c=openMemoryCore({path:fresh,assets:h.options});c.close();
  d=new DatabaseSync(fresh);assert.equal(d.prepare('PRAGMA user_version').get().user_version,31);d.close();
});
for(const version of [...historicalFixtures.layouts.map(layout=>layout.version),30])test(`K01 populated actual historical v${version} migrates atomically once; all openers validate v31`,t=>{
  const w=createTestWorkspace(t),path=join(w.path,'store.sqlite'),h=assetHost();
  if(version===30)restoreV30(path);else restoreHistoricalStore(path,version);
  let db=new DatabaseSync(path);const before=snapshot(db);db.close();
  let core=openMemoryCore({path,assets:h.options});core.close();
  db=new DatabaseSync(path);assert.equal(db.prepare('PRAGMA user_version').get().user_version,31);
  for(const table of before)assert.deepEqual(db.prepare('SELECT '+table.columns.map(column=>'"'+column+'"').join(',')+' FROM "'+table.name+'"').all(),table.rows,table.name);
  const storeId=db.prepare('SELECT store_id FROM store_metadata').get().store_id,after=snapshot(db);db.close();
  const bytes=readFileSync(path);core=openMemoryCore({path,assets:h.options});core.close();
  core=openMemoryCore({path,methodPackages:h.methods});core.close();
  const read=openReadDatabase(path);read.db.close();
  for(const version of ['schema29-existing-v1','schema30-existing-v1','schema31-existing-v1']){core=openMemoryCore({path,assets:h.options,methodPackages:h.methods,existingStore:{version,storeId}});core.close();}
  db=new DatabaseSync(path);assert.deepEqual(snapshot(db),after);db.close();assert.deepEqual(readFileSync(path),bytes);
});
test('K01 migration rollback after v31 DDL in an independent process leaves rows, schema and version unchanged; v19 refuses',t=>{
  const w=createTestWorkspace(t),path=join(w.path,'rollback.sqlite');restoreV30(path);const before=readFileSync(path);
  child(`import assert from 'node:assert/strict';import {DatabaseSync} from 'node:sqlite';import {openMemoryCore} from ${JSON.stringify(moduleURL('core/contract.mjs'))};${childHost}
    const original=DatabaseSync.prototype.exec;DatabaseSync.prototype.exec=function(sql){const result=original.call(this,sql);if(sql.includes('CREATE TABLE assets'))throw Error('injected');return result;};
    assert.throws(()=>openMemoryCore({path:process.argv[1],assets:{version:'assets-local-v1',storage:'sqlite-blob-v1',authority}}),/injected/);`,[path]);
  assert.deepEqual(readFileSync(path),before);
  const db=new DatabaseSync(path);db.exec('PRAGMA user_version=19');db.close();const nineteen=readFileSync(path);
  assert.throws(()=>openMemoryCore({path,assets:assetHost().options}),{code:'unsupported_database'});assert.deepEqual(readFileSync(path),nineteen);
});
test('K02 actual frozen v30 opener and complete installed closure reject v31 without changing it, with no git dependency',t=>{
  const w=createTestWorkspace(t),root=materializeV30(w.path),path=join(w.path,'v31.sqlite'),old=join(w.path,'v30.sqlite'),h=assetHost();
  restoreV30(old);let core=openMemoryCore({path,assets:h.options});core.close();const before=readFileSync(path),oldBefore=readFileSync(old);
  const closure=installedImportClosure(root,['bin/cairn-memory.mjs','core/contract.mjs','core/read-database.mjs']);
  assert.ok(closure.required.includes('core/database.mjs'));assert.ok(closure.required.includes('core/method-package-storage.mjs'));
  assert.ok(!closure.required.some(path=>path.startsWith('core/asset-')));
  child(`import assert from 'node:assert/strict';import {openDatabase} from ${JSON.stringify(pathToFileURL(join(root,'core/database.mjs')).href)};
    import {openMemoryCore} from ${JSON.stringify(pathToFileURL(join(root,'core/contract.mjs')).href)};
    import {openReadDatabase} from ${JSON.stringify(pathToFileURL(join(root,'core/read-database.mjs')).href)};
    const d=openDatabase(process.argv[2]);assert.equal(d.prepare('PRAGMA user_version').get().user_version,30);d.close();
    assert.throws(()=>openDatabase(process.argv[1]),{code:'unsupported_database'});
    assert.throws(()=>openMemoryCore({path:process.argv[1]}),{code:'unsupported_database'});
    assert.throws(()=>openReadDatabase(process.argv[1]),{code:'unsupported_database'});`,[path,old]);
  assert.deepEqual(readFileSync(path),before);assert.deepEqual(readFileSync(old),oldBefore);
});
for(const table of ASSET_TABLES)test(`K02 premature pre-v31 artifact ${table} refuses without repair, even with assets off`,t=>{
  const w=createTestWorkspace(t),path=join(w.path,'premature.sqlite');restoreV30(path);
  const db=new DatabaseSync(path);db.exec('CREATE TABLE '+table+'(id TEXT) STRICT');const storeId=db.prepare('SELECT store_id FROM store_metadata').get().store_id;db.close();const before=readFileSync(path),h=assetHost();
  for(const options of [{},{assets:h.options},{methodPackages:h.methods},{existingStore:{version:'schema30-existing-v1',storeId}}])assert.throws(()=>openMemoryCore({path,...options}),{code:'unsupported_database'});
  assert.throws(()=>openReadDatabase(path),{code:'unsupported_database'});assert.deepEqual(readFileSync(path),before);
});
for(const corruption of ['check','trigger','index','foreign-key','unique'])test(`K01 weakened same-named ${corruption} refuses on ordinary, read-only, managed and local preflights`,async t=>{
  const f=localFixture(t),h=assetHost();let c=openMemoryCore({path:f.databasePath,assets:h.options});c.close();
  const db=new DatabaseSync(f.databasePath);
  if(corruption==='trigger')db.exec("DROP TRIGGER binary_object_release;CREATE TRIGGER binary_object_release AFTER DELETE ON binary_objects BEGIN SELECT 1;END");
  else if(corruption==='index')db.exec('DROP INDEX binary_object_method;CREATE INDEX binary_object_method ON binary_objects(position,method_version_id)');
  else {
    const name=corruption==='check'?'binary_chunks':'asset_versions';const old=db.prepare('SELECT sql FROM sqlite_master WHERE name=?').get(name).sql;
    const sql=corruption==='check'?old.replace('length(bytes) BETWEEN 1 AND 32768','length(bytes)>=0'):
      corruption==='foreign-key'?old.replace('REFERENCES assets(id)','REFERENCES method_packages(id)'):old.replace('UNIQUE(asset_id,ordinal)','UNIQUE(asset_id,ordinal,id)');
    assert.notEqual(sql,old);
    // Node 24 enables SQLite defensive mode. Recreate the empty test table
    // through real DDL, restoring every same-named index and trigger; do not
    // depend on writable_schema or disable the runtime's defenses.
    const dependents=db.prepare("SELECT sql FROM sqlite_master WHERE tbl_name=? AND type!='table' AND sql IS NOT NULL").all(name);
    assert.equal(db.prepare('SELECT count(*) n FROM '+name).get().n,0);
    db.exec('PRAGMA foreign_keys=OFF');db.exec('DROP TABLE '+name);db.exec(sql);
    for(const object of dependents)db.exec(object.sql);db.exec('PRAGMA foreign_keys=ON');
  }
  db.close();const before=readFileSync(f.databasePath);
  for(const options of [{},{assets:h.options},{methodPackages:h.methods},{existingStore:{version:'schema31-existing-v1',storeId:f.config.authority.storeId}}])assert.throws(()=>openMemoryCore({path:f.databasePath,...options}),{code:'unsupported_database'});
  assert.throws(()=>openReadDatabase(f.databasePath),{code:'unsupported_database'});
  await assert.rejects(preflight(f.config),{code:'invalid_local_capture_configuration'});
  await assert.rejects(checkHostPermission(f.config));assert.deepEqual(readFileSync(f.databasePath),before);
});
test('K01 local setup, preflight and managed host permissions recognize v31 without migrating or writing',async t=>{
  const f=localFixture(t),h=assetHost();let core=openMemoryCore({path:f.databasePath,assets:h.options});core.close();const before=readFileSync(f.databasePath);
  await preflight(f.config);await checkHostPermission(f.config);assert.deepEqual(readFileSync(f.databasePath),before);
  const setup=await setupFixture(t);core=openMemoryCore({path:setup.request.databasePath,assets:h.options});core.close();
  const prepared=await setup.setup();assert.equal(prepared.status,'prepared',JSON.stringify(prepared));
  const db=new DatabaseSync(setup.request.databasePath);assert.equal(db.prepare('PRAGMA user_version').get().user_version,31);db.close();
});
test('K01 full prerequisite migration rollback from populated v18 runs in a separate process',t=>{
  const w=createTestWorkspace(t),path=join(w.path,'rollback-v18.sqlite');restoreHistoricalStore(path,18);const before=readFileSync(path);
  child(`import assert from 'node:assert/strict';import {DatabaseSync} from 'node:sqlite';import {openMemoryCore} from ${JSON.stringify(moduleURL('core/contract.mjs'))};${childHost}
    const original=DatabaseSync.prototype.exec;DatabaseSync.prototype.exec=function(sql){const result=original.call(this,sql);if(sql.includes('CREATE TABLE assets'))throw Error('injected_after_all_prerequisites');return result;};
    assert.throws(()=>openMemoryCore({path:process.argv[1],assets:{version:'assets-local-v1',storage:'sqlite-blob-v1',authority}}),/injected_after_all_prerequisites/);`,[path]);
  assert.deepEqual(readFileSync(path),before);
});
test('K02 local preflight/host permission refuse premature v29 asset artifacts without repair',async t=>{
  const f=localFixture(t),db=new DatabaseSync(f.databasePath);db.exec('CREATE TABLE assets(id TEXT) STRICT');db.close();const before=readFileSync(f.databasePath);
  await assert.rejects(preflight(f.config),{code:'invalid_local_capture_configuration'});await assert.rejects(checkHostPermission(f.config));assert.deepEqual(readFileSync(f.databasePath),before);
});
test('K01 assets selected through a managed existing-store opener refuses v30 without migration',t=>{
  const w=createTestWorkspace(t),path=join(w.path,'managed-v30.sqlite');restoreV30(path);
  const db=new DatabaseSync(path),storeId=db.prepare('SELECT store_id FROM store_metadata').get().store_id;db.close();const before=readFileSync(path),h=assetHost();
  assert.throws(()=>openMemoryCore({path,assets:h.options,existingStore:{version:'schema30-existing-v1',storeId}}),{code:'unsupported_database'});assert.deepEqual(readFileSync(path),before);
});
test('K01/K04 actual pre-v31 method identities and authorized replay survive migration and method-only reopening',t=>{
  const w=createTestWorkspace(t),path=join(w.path,'legacy-method.sqlite'),saved=restoreV30(path),assets=assetHost(),methods=methodHost();
  let core=openMemoryCore({path,assets:assets.options,methodPackages:methods.options});
  const replay=()=>{
    assert.deepEqual(ok(methods.call(core,'importMethodVersion',methodInput('frozen-v30-import'))),saved.receipt);
    const version=ok(methods.call(core,'getMethodVersion',{version:saved.receipt.version,intent:'history'})).version;
    assert.deepEqual(version.ref,saved.receipt.version);
    const resolved=ok(methods.call(core,'resolveMethod',{readSet:[methodNamespace],package:saved.receipt.package,roleId:null}));
    assert.equal(resolved.status,'current');assert.deepEqual(resolved.version,saved.receipt.version);
  };
  try{replay();}finally{core.close();}
  core=openMemoryCore({path,methodPackages:methods.options});try{replay();assert.equal(core.getAssetCapabilities,undefined);}finally{core.close();}
});

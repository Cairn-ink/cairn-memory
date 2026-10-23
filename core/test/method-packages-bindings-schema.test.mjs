import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import test from 'node:test';
import { openMemoryCore } from '../contract.mjs';
import { openReadDatabase } from '../read-database.mjs';
import { preflight } from '../../adapters/local/configuration.mjs';
import { fixture as localFixture } from '../../adapters/local/test/fixtures/workspace.mjs';
import { fixture,host,ns,project,foreign,ok,error,input,history,child,moduleURL } from '../testing/method-package-fixtures.mjs';

// This is the complete v30 allocation, including U2b's storage. Do not refresh
// the golden layout for U2b: a later layout change needs a new schema version.
const frozen=JSON.parse(readFileSync(new URL('../testing/method-package-v30-layout.json',import.meta.url),'utf8'));
const bindingTables=['method_bindings','method_binding_generations','method_binding_events'];
const timestamp='2026-10-23T00:00:00.000Z';
const boundary=namespace=>({owner_id:namespace.ownerId,scope:namespace.scope,project_id:namespace.projectId??''});
function insert(db,table,row){
  return db.prepare(`INSERT INTO ${table}(${Object.keys(row).join(',')}) VALUES(${Object.keys(row).map(()=>'?').join(',')})`).run(...Object.values(row));
}
const generation=(namespace,ref,value=1)=>({...boundary(namespace),package_id:ref.packageId,generation:value});
const binding=(namespace,ref,patch={})=>({...boundary(namespace),package_id:ref.packageId,role_key:'*',state:'active',
  version_id:ref.versionId,manifest_identity:ref.manifestIdentity,revision:1,generation:1,created_at:timestamp,updated_at:timestamp,...patch});
const event=(namespace,ref,patch={})=>({event_id:'event-one',...boundary(namespace),package_id:ref.packageId,role_key:'*',kind:'binding_changed',
  revision:1,generation:1,state:'active',version_id:ref.versionId,manifest_identity:ref.manifestIdentity,
  action_id:'synthetic-transition',created_at:timestamp,reason_refs:'[]',ordinal:1,...patch});
const snapshot=db=>bindingTables.map(table=>[table,db.prepare(`SELECT * FROM ${table} ORDER BY rowid`).all().map(row=>({...row}))]);

function seeded(t){
  const f=fixture(t);f.db.exec('PRAGMA foreign_keys=ON');
  const first=ok(f.call('importMethodVersion',input('first')));
  const second=ok(f.call('importMethodVersion',input('second',{package:first.package,expectedPackageRevision:1,basedOn:first.version})));
  insert(f.db,'method_binding_generations',generation(ns,first.version));
  return {...f,first,second};
}

test('M01 complete v30 binding allocation is initially empty, frozen, and unchanged by U2a imports',t=>{
  const f=fixture(t);
  assert.equal(frozen.schemaVersion,30);
  const schema=()=>f.db.prepare("SELECT name,type,tbl_name AS tableName,sql FROM sqlite_master WHERE name GLOB 'method_*' AND sql IS NOT NULL ORDER BY name").all().map(row=>({...row}));
  assert.deepEqual(schema(),frozen.objects);
  for(const table of bindingTables)assert.equal(f.db.prepare(`SELECT count(*) n FROM ${table}`).get().n,0,table);
  ok(f.call('importMethodVersion',input()));
  for(const table of bindingTables)assert.equal(f.db.prepare(`SELECT count(*) n FROM ${table}`).get().n,0,table);
  f.reopen();assert.deepEqual(schema(),frozen.objects);
});

test('M01 binding schema enforces canonical scope, role keys, version refs, state, revisions and generations',t=>{
  const f=seeded(t),ref=f.first.version;
  for(const patch of [{generation:0},{generation:-1},{scope:'unknown'},{scope:'personal',project_id:'not-empty'},
    {scope:'project',project_id:''},{owner_id:foreign.ownerId},{package_id:'missing'}]){
    assert.throws(()=>insert(f.db,'method_binding_generations',{...generation(ns,ref),...patch}));
  }
  insert(f.db,'method_binding_generations',generation(project,ref)); // same-owner project -> personal is canonical.
  const projectPackage=ok(f.call('importMethodVersion',input('project',{namespace:project})));
  assert.throws(()=>insert(f.db,'method_binding_generations',generation(ns,projectPackage.version)));
  assert.throws(()=>insert(f.db,'method_binding_generations',generation({...project,projectId:'other-project'},projectPackage.version)));
  assert.throws(()=>f.db.prepare('UPDATE method_binding_generations SET owner_id=? WHERE owner_id=?').run(foreign.ownerId,ns.ownerId));
  for(const role of [null,'','two words','*role','role/one','é','a'.repeat(201)]){
    assert.throws(()=>insert(f.db,'method_bindings',binding(ns,ref,{role_key:role})));
  }
  for(const patch of [{state:'unknown'},{state:'disabled'},{version_id:null},{manifest_identity:null},
    {revision:0},{generation:0},{version_id:'missing'},{manifest_identity:'a'.repeat(43)},
    {version_id:projectPackage.version.versionId,manifest_identity:projectPackage.version.manifestIdentity}]){
    assert.throws(()=>insert(f.db,'method_bindings',binding(ns,ref,patch)));
  }
  insert(f.db,'method_bindings',binding(ns,ref));
  assert.throws(()=>insert(f.db,'method_bindings',binding(ns,f.second.version))); // unique canonical binding key.
  insert(f.db,'method_bindings',binding(ns,ref,{role_key:'A-z_0.9-',state:'disabled',version_id:null,manifest_identity:null}));
  insert(f.db,'method_bindings',binding(ns,ref,{role_key:'r'.repeat(200)}));
  insert(f.db,'method_bindings',binding(project,ref));
  assert.deepEqual(f.db.prepare('PRAGMA foreign_key_check').all(),[]);
});

test('M01 binding-event schema supports content-free transition history and enforces canonical event identities',t=>{
  const f=seeded(t),ref=f.first.version;
  insert(f.db,'method_bindings',binding(ns,ref));
  insert(f.db,'method_bindings',binding(ns,ref,{role_key:'role'}));
  insert(f.db,'method_binding_events',event(ns,ref));
  const invalid=[{kind:'binding_unavailable'},{state:'disabled'},{version_id:null},{manifest_identity:'a'.repeat(43)},
    {revision:0},{generation:0},{ordinal:0},{role_key:'missing-binding'},{reason_refs:'{}'},
    {reason_refs:'null'},{reason_refs:'invalid-json'},{reason_refs:JSON.stringify(Array.from({length:17},()=>({type:'memory'})))},
    {revision:1},{generation:1,role_key:'role'}];
  invalid.forEach((patch,i)=>assert.throws(()=>insert(f.db,'method_binding_events',event(ns,ref,{
    event_id:'bad-event-'+i,revision:i+2,generation:i+2,ordinal:i+2,...patch}))));
  f.db.prepare('UPDATE method_binding_generations SET generation=2').run();
  f.db.prepare("UPDATE method_bindings SET state='disabled',version_id=NULL,manifest_identity=NULL,revision=2,generation=2 WHERE role_key='*'").run();
  const reasons=Array.from({length:16},(_,i)=>({type:'memory',namespace:ns,memoryId:'synthetic-memory-'+i,revision:1}));
  insert(f.db,'method_binding_events',event(ns,ref,{event_id:'event-two',revision:2,generation:2,ordinal:2,state:'disabled',
    version_id:null,manifest_identity:null,reason_refs:JSON.stringify(reasons)}));
  const columns=f.db.prepare("SELECT name FROM pragma_table_info('method_binding_events')").all().map(row=>row.name);
  assert.ok(!columns.some(column=>/title|label|text|summary|paths|prose/.test(column)));
  assert.deepEqual(f.db.prepare('SELECT state,revision,generation FROM method_binding_events ORDER BY ordinal').all().map(row=>({...row})),[
    {state:'active',revision:1,generation:1},{state:'disabled',revision:2,generation:2}]);
  assert.deepEqual(f.db.prepare('PRAGMA foreign_key_check').all(),[]);
});

for(const missing of ['method_bindings','method_binding_generations','method_binding_events','method_version_ref','method_binding_namespace_insert']){
  test(`M01 incomplete v30 lacking ${missing} is refused by every applicable opener without repair`,async t=>{
    const f=localFixture(t),trusted=host();
    const core=openMemoryCore({path:f.databasePath,methodPackages:trusted.options});core.close();
    const db=new DatabaseSync(f.databasePath);
    const kind=db.prepare('SELECT type FROM sqlite_master WHERE name=?').get(missing).type;
    db.exec(`DROP ${kind} ${missing}`);db.close();const before=readFileSync(f.databasePath);
    assert.throws(()=>openMemoryCore({path:f.databasePath}),{code:'unsupported_database'});
    assert.throws(()=>openMemoryCore({path:f.databasePath,methodPackages:trusted.options}),{code:'unsupported_database'});
    assert.throws(()=>openMemoryCore({path:f.databasePath,existingStore:{version:'schema30-existing-v1',storeId:f.config.authority.storeId}}),{code:'unsupported_database'});
    assert.throws(()=>openReadDatabase(f.databasePath),{code:'unsupported_database'});
    await assert.rejects(preflight(f.config),{code:'invalid_local_capture_configuration'});
    assert.deepEqual(readFileSync(f.databasePath),before);
  });
}

test('M08 imports and deletion never enumerate bindings, advance binding generations or emit binding effects',t=>{
  const f=seeded(t),ref=f.first.version;
  insert(f.db,'method_bindings',binding(ns,ref));
  insert(f.db,'method_binding_events',event(ns,ref));
  insert(f.db,'method_binding_generations',generation(project,ref,7));
  insert(f.db,'method_bindings',binding(project,ref,{generation:7}));
  insert(f.db,'method_binding_events',event(project,ref,{event_id:'project-event',generation:7,ordinal:2}));
  const before=snapshot(f.db);
  for(const table of bindingTables)for(const operation of ['INSERT','UPDATE','DELETE']){
    f.db.exec(`CREATE TRIGGER guard_${table}_${operation} BEFORE ${operation} ON ${table}
      BEGIN SELECT RAISE(ABORT,'unexpected_binding_write'); END`);
  }
  const prepare=DatabaseSync.prototype.prepare;
  DatabaseSync.prototype.prepare=function(sql,...args){
    if(/\bmethod_(?:bindings|binding_generations|binding_events)\b/i.test(sql))throw Error('unexpected_binding_enumeration');
    return prepare.call(this,sql,...args);
  };
  try{
    const third=ok(f.call('importMethodVersion',input('third',{package:f.first.package,expectedPackageRevision:2,basedOn:f.first.version})));
    assert.equal(third.packageRevision,3);
    const removeVersion={actionId:'delete-version',ref,expectedRevision:1};
    assert.equal(ok(f.call('deleteMethodVersion',removeVersion)).effectCount,1);
    assert.equal(ok(f.call('deleteMethodVersion',removeVersion)).effectCount,1);
    const removePackage={actionId:'delete-package',ref:f.first.package,expectedRevision:4};
    assert.equal(ok(f.call('deleteMethodPackage',removePackage)).effectCount,1);
    assert.equal(ok(f.call('deleteMethodPackage',removePackage)).effectCount,1);
  }finally{DatabaseSync.prototype.prepare=prepare;}
  assert.deepEqual(snapshot(f.db),before);
  assert.deepEqual(ok(f.call('listMethodEffects',{namespace:ns})).effects.map(effect=>effect.kind),['method_version_deleted','method_package_deleted']);
  assert.equal(ok(f.call('getMethodVersion',history(ref))).status,'unavailable');
  assert.equal(f.db.prepare('SELECT revision FROM method_packages WHERE id=?').get(ref.packageId).revision,5);
  assert.deepEqual(f.db.prepare('PRAGMA foreign_key_check').all(),[]);
  f.core.close();
  child(`import assert from 'node:assert/strict';import {DatabaseSync} from 'node:sqlite';
    const [path,encoded]=process.argv.slice(1),expected=JSON.parse(encoded),db=new DatabaseSync(path,{readOnly:true});
    const actual=${JSON.stringify(bindingTables)}.map(table=>[table,db.prepare('SELECT * FROM '+table+' ORDER BY rowid').all()]);
    assert.equal(JSON.stringify(actual),JSON.stringify(expected));db.close();`,[f.path,JSON.stringify(before)]);
});

test('M01/M03 U2 capabilities and context-free history stay bounded even with canonical bindings present',t=>{
  const f=seeded(t);insert(f.db,'method_bindings',binding(ns,f.first.version));
  const capabilities=ok(f.core.getMethodPackageCapabilities());
  assert.deepEqual(capabilities.methods,['importMethodVersion','getMethodVersion','listMethodManifest','readMethodFile',
    'listMethodPackages','listMethodVersions','compareMethodVersions','deleteMethodVersion','deleteMethodPackage','listMethodEffects','getMethodPackageUsage','adoptMethodVersion','disableMethodBinding','resolveMethod','resolveMethodsForRole','listMethodBindingEvents','checkMethodReasonRefs']);
  assert.deepEqual(capabilities.intents,['history','current']);assert.equal(capabilities.context,true);assert.equal(capabilities.snapshots,true);assert.equal(capabilities.adoptionBindings,true);
  for(const method of ['adoptMethodVersion','disableMethodBinding','resolveMethod','resolveMethodsForRole','listMethodBindingEvents'])assert.equal(typeof f.core[method],'function');
  for(const method of ['getMethodVersion','listMethodManifest','readMethodFile']){
    const payload={...history(f.first.version),...(method==='readMethodFile'?{path:'SKILL.md'}:{})};
    const result=ok(f.call(method,payload));assert.equal(method==='getMethodVersion'?result.version.adoptionStatus:result.adoptionStatus,'unassessed');
    for(const patch of [{intent:'current'},{snapshot:'opaque'},{context:null},{snapshot:null}]){
      error(f.call(method,{...payload,...patch}),'invalid_input');
    }
  }
});

// Same names and columns are insufficient: keep the rest of the canonical
// allocation and weaken exactly one definition per case.
const weakenedDefinitions=[
  ['generation CHECK','method_binding_generations',sql=>sql.replace('CHECK(generation>0)','CHECK(generation>=0)')],
  ['package revision CHECK','method_packages',sql=>sql.replace('CHECK(revision>0)','CHECK(revision>=0)')],
  ['version purge CHECK','method_versions',sql=>sql.replace('byte_count=0','byte_count>=0')],
  ['file byte CHECK','method_files',sql=>sql.replace('CHECK(byte_count>=0)','CHECK(1)')],
  ['binding role CHECK','method_bindings',sql=>sql.replace("role_key NOT GLOB '*[^A-Za-z0-9._-]*'",'1')],
  ['binding state CHECK','method_bindings',sql=>sql.replace("state IN ('active','disabled')","state IN ('active','disabled','unknown')")],
  ['binding target CHECK','method_bindings',sql=>sql.replace('manifest_identity IS NOT NULL','1')],
  ['event reason CHECK','method_binding_events',sql=>sql.replace('json_array_length(reason_refs)<=16','json_array_length(reason_refs)<=32')],
  ['binding primary key','method_bindings',sql=>sql.replace('PRIMARY KEY(owner_id,scope,project_id,package_id,role_key)','PRIMARY KEY(owner_id,scope,project_id,package_id,role_key,revision)')],
  ['ledger primary key','method_operations',sql=>sql.replace('PRIMARY KEY(owner_id,scope,project_id,action_id)','PRIMARY KEY(owner_id,scope,project_id,action_id,method)')],
  ['version ordinal uniqueness','method_versions',sql=>sql.replace('UNIQUE(package_id,ordinal)','UNIQUE(package_id,ordinal,id)')],
  ['file path uniqueness','method_files',sql=>sql.replace('UNIQUE(version_id,path)','UNIQUE(version_id,path,position)')],
  ['effect ordinal uniqueness','method_effects',sql=>sql.replace('ordinal INTEGER NOT NULL UNIQUE','ordinal INTEGER NOT NULL')],
  ['package foreign key','method_binding_generations',sql=>sql.replace(' REFERENCES method_packages(id)','')],
  ['file foreign key','method_files',sql=>sql.replace(' REFERENCES method_versions(id)','')],
  ['binding foreign key action','method_bindings',sql=>sql.replace('REFERENCES method_versions(package_id,id,manifest_identity)','REFERENCES method_versions(package_id,id,manifest_identity) ON DELETE CASCADE')],
  ['event foreign key action','method_binding_events',sql=>sql.replace('REFERENCES method_bindings(owner_id,scope,project_id,package_id,role_key)','REFERENCES method_bindings(owner_id,scope,project_id,package_id,role_key) ON UPDATE CASCADE')],
  ...frozen.objects.filter(object=>object.type==='index').map(object=>[
    object.name+' definition',object.name,sql=>sql.includes('CREATE UNIQUE INDEX')?sql.replace('CREATE UNIQUE INDEX','CREATE INDEX'):sql.replace(/\)$/,') WHERE ordinal>0').replace('WHERE ordinal>0','WHERE 1')]),
  ...['insert','update'].map(operation=>['namespace '+operation+' guard','method_binding_namespace_'+operation,
    ()=>`CREATE TRIGGER method_binding_namespace_${operation} BEFORE ${operation.toUpperCase()} ON method_binding_generations BEGIN SELECT 1; END`]),
];
for(const [label,name,weaken] of weakenedDefinitions)test(`M01 same-named weakened v30 ${label} is refused by every opener`,async t=>{
  const f=localFixture(t),trusted=host();
  const core=openMemoryCore({path:f.databasePath,methodPackages:trusted.options});core.close();
  const db=new DatabaseSync(f.databasePath);
  try{
    db.exec('PRAGMA foreign_keys=OFF');
    for(const object of frozen.objects.filter(object=>object.type==='table'))db.exec('DROP TABLE '+object.name);
    for(const type of ['table','index','trigger'])for(const object of frozen.objects.filter(object=>object.type===type)){
      const sql=object.name===name?weaken(object.sql):object.sql;
      if(object.name===name)assert.notEqual(sql,object.sql,'mutation must alter canonical definition');
      db.exec(sql);
    }
  }finally{db.close();}
  const before=readFileSync(f.databasePath);
  assert.throws(()=>openMemoryCore({path:f.databasePath}),{code:'unsupported_database'});
  assert.throws(()=>openMemoryCore({path:f.databasePath,methodPackages:trusted.options}),{code:'unsupported_database'});
  for(const version of ['schema29-existing-v1','schema30-existing-v1'])assert.throws(()=>openMemoryCore({path:f.databasePath,
    existingStore:{version,storeId:f.config.authority.storeId}}),{code:'unsupported_database'});
  assert.throws(()=>openReadDatabase(f.databasePath),{code:'unsupported_database'});
  await assert.rejects(preflight(f.config),{code:'invalid_local_capture_configuration'});
  assert.deepEqual(readFileSync(f.databasePath),before,'refusal must not repair or write');
});

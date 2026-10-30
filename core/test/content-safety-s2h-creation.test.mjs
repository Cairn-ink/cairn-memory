import test from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { mkdirSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { randomUUID } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { openDatabase, transaction } from '../database.mjs';
import { openReadDatabase } from '../read-database.mjs';
import { openMemoryCore, openMemoryStore } from '../index.mjs';
import { validateContextProductLayout } from '../context-product-schema.mjs';
import { validateExistingStore } from '../existing-store.mjs';
import { resolveContentLayout, contentSafetyPin } from '../content-safety-layout.mjs';
import { createTopicSession } from '../topic-members-session.mjs';
import { storeIdentity } from '../store-fence.mjs';
import { migrateMethodPrerequisites } from '../method-package-migration.mjs';
import { contentSafetyInventory } from '../content-safety-migration.mjs';
import { safetyFixture } from '../testing/content-safety-s2h-fixture.mjs';

const options = base => base===18?{}:base===23?{privateCards:true}:{currentDependencies:true};
const schema = db => JSON.stringify(db.prepare('SELECT type,name,tbl_name,sql FROM sqlite_schema ORDER BY type,name').all());
for(const base of [18,23,33])test(`creation S2h ${base}: atomic opt-in equals empty migration and every opener attests`,async t=>{
  const f=safetyFixture(t,base),path=join(f.workspace.path,'created.sqlite');
  const pristine=f.connect(),inventory=contentSafetyInventory(pristine);pristine.close();await f.migrate();const migrated=f.connect();t.after(()=>migrated.close());
  const exec=DatabaseSync.prototype.exec;let capturedInventory;
  DatabaseSync.prototype.exec=function(sql){if(sql.startsWith('CREATE TABLE content_safety_control'))capturedInventory=contentSafetyInventory(this);return exec.call(this,sql);};
  let create;try{create=openDatabase(path,{...options(base),contentSafety:'s2h-v1'});}finally{DatabaseSync.prototype.exec=exec;}const storeId=create.prepare('SELECT store_id FROM store_metadata').get().store_id;
  const control=create.prepare('SELECT * FROM content_safety_control').get(),other=migrated.prepare('SELECT * FROM content_safety_control').get();
  assert.equal(schema(create),schema(migrated));assert.equal(other.inventory_digest,inventory);
  for(const field of ['singleton','base_layout','suppression_revision','card_lineage_revision','migration_state'])assert.equal(control[field],other[field]);
  for(const field of ['suppression_domain','migration_id']){assert.match(control[field],/^[0-9a-f-]{36}$/);assert.notEqual(control[field],other[field]);}
  assert.match(control.inventory_digest,/^[0-9a-f]{64}$/);assert.equal(control.inventory_digest,capturedInventory);assert.equal(control.migration_state,'complete');
  for(const table of ['content_suppressions','content_identity_reservations','owner_suppression_epochs'])assert.equal(create.prepare(`SELECT count(*) n FROM ${table}`).get().n,0);
  const physical=base===18?34:base===23?38:48,pin=contentSafetyPin(resolveContentLayout(physical),storeId),before=schema(create);
  assert.equal(create.prepare('PRAGMA user_version').get().user_version,physical);
  create.close();const db=new DatabaseSync(path);db.exec('PRAGMA busy_timeout=5000');t.after(()=>db.close());
  const ordinary=openDatabase(path);ordinary.close();const read=openReadDatabase(path);read.db.close();
  const product=openReadDatabase(path,{contextRead:true,validateProduct:validateContextProductLayout});product.db.close();
  const topic=createTopicSession(path);try{topic.prepare({charge(){},request:{}});}finally{topic.dispose();}
  validateExistingStore(db,pin);assert.equal(storeIdentity(db).storeId,storeId);
  const existing=openDatabase(path,{existingStore:pin});existing.close();
  assert.throws(()=>openDatabase(path,{...options(base),contentSafety:'s2h-v1'}),{code:'unsupported_database'});
  for(const version of ['schema29-existing-v1','schema30-existing-v1','schema31-existing-v1','schema32-existing-v1','schema33-existing-v1'])assert.throws(()=>openDatabase(path,{existingStore:{version,storeId}}),{code:'unsupported_database'});
  assert.throws(()=>transaction(db,()=>migrateMethodPrerequisites(db)),{code:'unsupported_database'});assert.equal(schema(db),before);
  const frozen=join(f.workspace.path,'frozen');mkdirSync(frozen);
  const unpack=spawnSync('tar',['-xf',fileURLToPath(new URL('./fixtures/content-safety-openers.tgz',import.meta.url)),'-C',frozen,'legacy'],{encoding:'utf8'});assert.equal(unpack.status,0,unpack.stderr);
  const load=name=>import(pathToFileURL(join(frozen,'legacy','core',name)).href);
  const [oldWrite,oldRead,oldProduct,oldExisting,oldTopic]=await Promise.all(['database.mjs','read-database.mjs','context-product-schema.mjs','existing-store.mjs','topic-members-session.mjs'].map(load));
  assert.throws(()=>oldWrite.openDatabase(path),{code:'unsupported_database'});assert.throws(()=>oldRead.openReadDatabase(path),{code:'unsupported_database'});
  assert.throws(()=>oldProduct.validateContextProductLayout(db),{code:'unsupported_database'});assert.throws(()=>oldExisting.validateExistingStore(db,{storeId}),{code:'unsupported_database'});
  const oldSession=oldTopic.createTopicSession(path);try{assert.throws(()=>oldSession.prepare({charge(){},request:{}}),{code:'unsupported_database'});}finally{oldSession.dispose();}

});
test('creation S2h inventories the pristine base in its creation transaction and rolls back on verification failure',t=>{
  const f=safetyFixture(t),path=join(f.workspace.path,'failed.sqlite');let captured;
  const prepare=DatabaseSync.prototype.prepare;
  DatabaseSync.prototype.prepare=function(sql){
    const statement=prepare.call(this,sql);
    if(sql.startsWith('INSERT INTO content_safety_control')){
      assert.equal(this.isTransaction,true);
      return new Proxy(statement,{get(target,key){if(key==='run')return(...args)=>{captured=args[3];throw Error('synthetic_control_failure');};const value=Reflect.get(target,key,target);return typeof value==='function'?value.bind(target):value;}});
    }
    if(sql==='SELECT type,name,tbl_name,sql FROM sqlite_schema ORDER BY type,name')assert.equal(this.isTransaction,true);
    return statement;
  };
  try{assert.throws(()=>openDatabase(path,{contentSafety:'s2h-v1'}),/synthetic_control_failure/);}finally{DatabaseSync.prototype.prepare=prepare;}
  assert.match(captured,/^[0-9a-f]{64}$/);
  const db=new DatabaseSync(path);try{assert.equal(db.prepare('SELECT count(*) n FROM sqlite_schema').get().n,0);assert.equal(db.prepare('PRAGMA user_version').get().user_version,0);}finally{db.close();}
  assert.throws(()=>openDatabase(path,{contentSafety:'s2h-v1'}),{code:'unsupported_database'});
});
test('creation S2h public constructors forward the explicit option; unsupported bases refuse before creating',t=>{
  const f=safetyFixture(t),path=join(f.workspace.path,'core.sqlite');const core=openMemoryCore({path,contentSafety:'s2h-v1'});core.close();
  const store=openMemoryStore({path:join(f.workspace.path,'legacy.sqlite'),contentSafety:'s2h-v1'});store.close();
  for(const patch of [{rawConversations:true},{methodPackages:true},{assets:true},{roleProfiles:true}])assert.throws(()=>openDatabase(join(f.workspace.path,randomUUID()+'.sqlite'),{...patch,contentSafety:'s2h-v1'}),{code:'unsupported_database'});
  assert.throws(()=>openDatabase(':memory:',{contentSafety:'s2h-v1'}),{code:'unsupported_database'});
  assert.throws(()=>openMemoryCore({path:join(f.workspace.path,'bad.sqlite'),contentSafety:true}),{code:'invalid_input'});
});

test('creation S2h refuses a legacy store raced into the exclusively created empty file',t=>{
  const f=safetyFixture(t),path=join(f.workspace.path,'raced.sqlite'),exec=DatabaseSync.prototype.exec;let armed=true;
  DatabaseSync.prototype.exec=function(sql){if(armed&&sql==='BEGIN IMMEDIATE'){armed=false;const winner=openDatabase(path);winner.close();}return exec.call(this,sql);};
  try{assert.throws(()=>openDatabase(path,{contentSafety:'s2h-v1'}),{code:'unsupported_database'});}finally{DatabaseSync.prototype.exec=exec;}
  const db=openDatabase(path);try{assert.equal(db.prepare('PRAGMA user_version').get().user_version,18);assert.equal(db.prepare("SELECT count(*) n FROM sqlite_schema WHERE name GLOB 'content_safety_*'").get().n,0);}finally{db.close();}
});

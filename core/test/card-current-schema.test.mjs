import { fixture as localFixture } from '../../adapters/local/test/fixtures/workspace.mjs';
import { setupFixture } from '../../integrations/client/test/fixtures/local-setup-workspace.mjs';
import { preflight } from '../../adapters/local/configuration.mjs';
import { checkHostPermission } from '../../integrations/client/raw/local-host-permission.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, mkdtempSync, chmodSync, rmSync, openSync, closeSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { DatabaseSync } from 'node:sqlite';
import { openMemoryCore } from '../index.mjs';
import { openReadDatabase } from '../read-database.mjs';
import { validateAssets } from '../asset-schema.mjs';
import { validateRoleProfiles } from '../role-profile-schema.mjs';
import { validateCardCurrentDependencies } from '../card-current-schema.mjs';
import { restoreHistoricalStore, restoreV30, historicalFixtures } from '../testing/asset-fixtures.mjs';
import { fixture, host, cardOptions, ok, ns, project } from './card-current-fixture.mjs';
const options=h=>({privateCards:cardOptions(h.authority),methodPackages:h.methods});
function workspace(t){const dir=mkdtempSync(join(tmpdir(),'card-current-schema-'));chmodSync(dir,0o700);t.after(()=>rmSync(dir,{recursive:true,force:true}));return {dir,path:join(dir,'store.sqlite')};}
const content=db=>db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name").all().map(({name})=>({name,columns:db.prepare('SELECT name FROM pragma_table_info(?) ORDER BY cid').all(name).map(r=>r.name),rows:db.prepare('SELECT * FROM "'+name+'"').all()}));
for(const version of [...historicalFixtures.layouts.map(l=>l.version),30,31,32])test(`C24/C25 populated v${version} -> v33 preserves rows and identity; openers validate only`,t=>{
 const w=workspace(t),h=host();if(version<30)restoreHistoricalStore(w.path,version);else restoreV30(w.path);
 if(version===31)openMemoryCore({path:w.path,assets:h.assets}).close();if(version===32)openMemoryCore({path:w.path,roleProfiles:h.options}).close();
 let db=new DatabaseSync(w.path);const before=content(db),roleDDL=db.prepare("SELECT name,sql FROM sqlite_master WHERE name GLOB 'role_*' ORDER BY name").all(),storeId=db.prepare('SELECT store_id FROM store_metadata').get().store_id;db.close();
 openMemoryCore({path:w.path,...options(h)}).close();db=new DatabaseSync(w.path);assert.equal(db.prepare('PRAGMA user_version').get().user_version,33);
 for(const item of before)assert.deepEqual(db.prepare('SELECT '+item.columns.map(c=>'"'+c+'"').join(',')+' FROM "'+item.name+'"').all(),item.rows,item.name);
 if(version===32)assert.deepEqual(db.prepare("SELECT name,sql FROM sqlite_master WHERE name GLOB 'role_*' ORDER BY name").all(),roleDDL);
 validateAssets(db);validateRoleProfiles(db);validateCardCurrentDependencies(db);db.close();const bytes=readFileSync(w.path),files=readdirSync(w.dir);
 for(const extra of [{},{assets:h.assets},{roleProfiles:h.options},{methodPackages:h.methods},...['schema29-existing-v1','schema30-existing-v1','schema33-existing-v1'].map(version=>({existingStore:{version,storeId},...options(h)}))])openMemoryCore({path:w.path,...extra}).close();
 openReadDatabase(w.path).db.close();assert.deepEqual(readdirSync(w.dir),files);assert.deepEqual(readFileSync(w.path),bytes);
 for(const version of ['schema31-existing-v1','schema32-existing-v1'])assert.throws(()=>openMemoryCore({path:w.path,existingStore:{version,storeId}}),{code:'unsupported_database'});
});
for(const stage of ['CREATE TABLE method_packages','CREATE TABLE assets','CREATE TABLE role_profiles','CREATE TABLE card_current_dependencies','PRAGMA user_version=33'])test('C25 fresh rollback at '+stage,t=>{
 const w=workspace(t),h=host(),original=DatabaseSync.prototype.exec;
 DatabaseSync.prototype.exec=function(sql){const result=original.call(this,sql);if(sql.includes(stage))throw Error('card-current injection');return result;};
 try{assert.throws(()=>openMemoryCore({path:w.path,...options(h)}),/card-current injection/);}finally{DatabaseSync.prototype.exec=original;}
 const db=new DatabaseSync(w.path);assert.equal(db.prepare('PRAGMA user_version').get().user_version,0);assert.equal(db.prepare('PRAGMA application_id').get().application_id,0);assert.deepEqual(db.prepare('SELECT name FROM sqlite_master').all(),[]);db.close();
});
test('C24 every dependency unique-key/rowid, update/delete, parent replacement and terminal resurrection guard survives recursive_triggers=0',t=>{
 const f=fixture(t),ref=f.card(),d=f.db;d.exec('PRAGMA recursive_triggers=OFF');const row=d.prepare('SELECT rowid,* FROM card_current_dependencies').get();
 for(const sql of [
  'INSERT OR REPLACE INTO card_current_dependencies SELECT * FROM card_current_dependencies',
  "UPDATE card_current_dependencies SET rowid=rowid+100,revision=revision+1",
  "UPDATE card_current_dependencies SET card_id='other',revision=revision+1",
  'UPDATE card_current_dependencies SET revision=revision+2',
  "UPDATE card_current_dependencies SET owner_id='foreign',revision=revision+1",
  "UPDATE card_current_dependencies SET vector='[]',revision=revision+1",
  'DELETE FROM card_current_dependencies',
  'INSERT OR REPLACE INTO private_cards SELECT * FROM private_cards',
  'UPDATE private_cards SET rowid=rowid+100',
  "UPDATE private_cards SET project_id='wrong'",
  'DELETE FROM private_cards',
 ])assert.throws(()=>d.exec(sql),undefined,sql);
 const columns=Object.keys(row).join(','),values=Object.values(row);values[1]='other';assert.throws(()=>d.prepare('INSERT OR REPLACE INTO card_current_dependencies('+columns+') VALUES('+values.map(()=>'?').join(',')+')').run(...values));
 const parent=d.prepare('SELECT rowid,* FROM private_cards').get();const pValues=Object.values(parent);pValues[1]='other';assert.throws(()=>d.prepare('INSERT OR REPLACE INTO private_cards('+Object.keys(parent).join(',')+') VALUES('+pValues.map(()=>'?').join(',')+')').run(...pValues));
 f.reopen(false);ok(f.call('deleteKnowledgeCard',{namespace:ns,cardId:ref.cardId,expectedRevision:2,actionId:'off-delete'}));assert.equal(d.prepare('SELECT count(*) n FROM card_current_dependencies').get().n,0);
 assert.throws(()=>d.exec("UPDATE private_cards SET state='confirmed',title='resurrected',body='resurrected'"));assert.throws(()=>d.exec('DELETE FROM private_cards'));
 assert.throws(()=>d.exec('INSERT OR REPLACE INTO private_cards SELECT * FROM private_cards'));assert.equal(d.prepare('PRAGMA foreign_key_check').get(),undefined);
});
for(const mutation of ["UPDATE card_current_dependencies SET owner_id='foreign'", "DELETE FROM private_cards", "DROP INDEX card_current_namespace", "DROP TRIGGER card_current_admit_insert"])test('C24 every opener refuses malformed persisted relationships/layouts: '+mutation,t=>{
 const f=fixture(t);f.card();const triggers=f.db.prepare("SELECT sql FROM sqlite_master WHERE type='trigger' AND name IN ('card_current_update','card_current_admit_update','card_current_parent_delete','card_current_delete')").all();const storeId=f.db.prepare('SELECT store_id FROM store_metadata').get().store_id;
 if(mutation.startsWith('UPDATE'))f.db.exec('DROP TRIGGER card_current_update;DROP TRIGGER card_current_admit_update');
 if(mutation==='DELETE FROM private_cards')f.db.exec('PRAGMA foreign_keys=OFF;DROP TRIGGER card_current_parent_delete;DROP TRIGGER card_current_delete');
 f.db.exec(mutation);if(mutation.startsWith('UPDATE'))for(const row of triggers.filter(r=>/CREATE TRIGGER card_current_(?:update|admit_update) /.test(r.sql)))f.db.exec(row.sql);if(mutation==='DELETE FROM private_cards')for(const row of triggers.filter(r=>/CREATE TRIGGER card_current_(?:parent_delete|delete) /.test(r.sql)))f.db.exec(row.sql);const bytes=readFileSync(f.path);
 for(const extra of [{},options(f.h),{existingStore:{version:'schema33-existing-v1',storeId}}])assert.throws(()=>openMemoryCore({path:f.path,...extra}),{code:'unsupported_database'});
 assert.throws(()=>openReadDatabase(f.path),{code:'unsupported_database'});assert.deepEqual(readFileSync(f.path),bytes);
});
test('C24 legitimate stale revision observations remain openable; C25 partial/premature/unsupported stores refuse without repair',t=>{
 const f=fixture(t),ref=f.card();f.db.exec('UPDATE private_cards SET revision=revision+1,body_revision=body_revision+1');openMemoryCore({path:f.path}).close();openReadDatabase(f.path).db.close();
 for(const v of [18,19,32]){const w=workspace(t),c=openMemoryCore({path:w.path});c.close();const d=new DatabaseSync(w.path);d.exec(`PRAGMA user_version=${v};CREATE TABLE card_current_dependencies(card_id TEXT) STRICT`);d.close();const bytes=readFileSync(w.path);assert.throws(()=>openMemoryCore({path:w.path,...options(f.h)}),{code:'unsupported_database'});assert.deepEqual(readFileSync(w.path),bytes);}
});
test('C25 personal-only projection has zero denied-scope lookup, identifiers or dependency-count disclosure',t=>{
 const f=fixture(t),ref=f.card({context:{readSet:[ns,project],roleId:'finance'}});let deniedLookups=0;const original=DatabaseSync.prototype.prepare;
 const spy=t.mock.method(DatabaseSync.prototype,'prepare',function(sql){const statement=original.call(this,sql);if(!/method_(?:bindings|binding_generations|packages|versions)/.test(sql))return statement;return new Proxy(statement,{get(target,key){const value=Reflect.get(target,key,target);if(typeof value!=='function')return value;return(...args)=>{deniedLookups++;return value.apply(target,args);};}});});
 const card=ok(f.call('getCard',{namespace:ns,cardId:ref.cardId})).card;assert.deepEqual(card.support.currentDependency,{revision:1,status:'needs-review',reasons:['access_revoked']});assert.equal(deniedLookups,0);spy.mock.restore();
});

for(const version of [18,29,30,31,32])test(`C25 real-process populated v${version} rollback leaves identity/data/DDL/version unchanged`,t=>{
 const w=workspace(t),h=host();if(version<30)restoreHistoricalStore(w.path,version);else restoreV30(w.path);
 if(version===31)openMemoryCore({path:w.path,assets:h.assets}).close();if(version===32)openMemoryCore({path:w.path,roleProfiles:h.options}).close();const before=readFileSync(w.path);
 const out=openSync(join(w.dir,'child.out'),'wx',0o600),err=openSync(join(w.dir,'child.err'),'wx',0o600);let result;
 try{result=spawnSync(process.execPath,[new URL('./fixtures/card-current-migrate.mjs',import.meta.url).pathname,w.path,'PRAGMA user_version=33'],{stdio:['ignore',out,err],timeout:20000});}finally{closeSync(out);closeSync(err);}
 assert.equal(result.error,undefined);assert.equal(result.signal,null);assert.equal(result.status,0,readFileSync(join(w.dir,'child.err'),'utf8'));assert.deepEqual(readFileSync(w.path),before);console.log(JSON.stringify({C25:{startVersion:version,childExit:result.status}}));
});


test('C25 local preflight, permission and setup accept validated v33 without migration',async t=>{
 const h=host(),f=localFixture(t);openMemoryCore({path:f.databasePath,...options(h)}).close();const before=readFileSync(f.databasePath);
 await preflight(f.config);await checkHostPermission(f.config);assert.deepEqual(readFileSync(f.databasePath),before);
 const setup=await setupFixture(t);openMemoryCore({path:setup.request.databasePath,...options(h)}).close();assert.equal((await setup.setup()).status,'prepared');
 const db=new DatabaseSync(setup.request.databasePath);assert.equal(db.prepare('PRAGMA user_version').get().user_version,33);db.close();
});

test('C24 SQL admission rejects missing parent, namespace mismatch, malformed prefix and extra shape fields',t=>{
 const f=fixture(t),ref=f.card(),other=f.card({declare:false}),d=f.db;
 const original=d.prepare('SELECT * FROM card_current_dependencies WHERE card_id=?').get(ref.cardId),columns=Object.keys(original);
 const insert=value=>d.prepare('INSERT INTO card_current_dependencies('+columns.join(',')+') VALUES('+columns.map(()=>'?').join(',')+')').run(...columns.map(key=>value[key]));
 assert.throws(()=>insert({...original,card_id:'missing'}));assert.throws(()=>insert({...original,card_id:other.cardId,owner_id:'other'}));
 const vector=JSON.parse(original.vector);vector[0].consulted[0].revision=1;assert.throws(()=>insert({...original,card_id:other.cardId,vector:JSON.stringify(vector)}));
 const extra=JSON.parse(original.vector);extra[0].prose='forbidden';assert.throws(()=>insert({...original,card_id:other.cardId,vector:JSON.stringify(extra)}));
 assert.equal(d.prepare('SELECT count(*) n FROM card_current_dependencies').get().n,1);
});

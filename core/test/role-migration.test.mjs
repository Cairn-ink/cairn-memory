import { fixture as localFixture } from '../../adapters/local/test/fixtures/workspace.mjs';
import { setupFixture } from '../../integrations/client/test/fixtures/local-setup-workspace.mjs';
import { preflight } from '../../adapters/local/configuration.mjs';
import { checkHostPermission } from '../../integrations/client/raw/local-host-permission.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync,mkdtempSync,rmSync,openSync,closeSync,chmodSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { DatabaseSync } from 'node:sqlite';
import { openMemoryCore } from '../index.mjs';
import { openReadDatabase } from '../read-database.mjs';
import { validateAssets } from '../asset-schema.mjs';
import { restoreV30,restoreHistoricalStore,historicalFixtures } from '../testing/asset-fixtures.mjs';
import { host,ns,publish,ok } from './role-fixture.mjs';
const index=new URL('../index.mjs',import.meta.url).href,helper=new URL('./role-fixture.mjs',import.meta.url).href;
function workspace(t){const dir=mkdtempSync(join(tmpdir(),'role-migration-'));chmodSync(dir,0o700);t.after(()=>rmSync(dir,{recursive:true,force:true}));return {dir,path:join(dir,'store.sqlite')};}
function rows(db){return db.prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name").all().map(({name})=>({name,columns:db.prepare('SELECT name FROM pragma_table_info(?) ORDER BY cid').all(name).map(r=>r.name),rows:db.prepare('SELECT * FROM "'+name+'"').all()}));}
for(const version of [...historicalFixtures.layouts.map(l=>l.version),30,31])test(`C04 populated v${version} -> v32 preserves canonical rows and identities; all openers validate only`,t=>{
 const w=workspace(t),h=host();if(version<30)restoreHistoricalStore(w.path,version);else restoreV30(w.path);
 if(version===31){const c=openMemoryCore({path:w.path,assets:h.assets});c.close();}
 const db=new DatabaseSync(w.path),before=rows(db),storeId=db.prepare('SELECT store_id FROM store_metadata').get().store_id;db.close();
 const core=openMemoryCore({path:w.path,roleProfiles:h.options});core.close();
 const d=new DatabaseSync(w.path);assert.equal(d.prepare('PRAGMA user_version').get().user_version,32);
 for(const old of before)assert.deepEqual(d.prepare('SELECT '+old.columns.map(c=>'"'+c+'"').join(',')+' FROM "'+old.name+'"').all(),old.rows,old.name);
 validateAssets(d);assert.equal(d.prepare("SELECT count(*) n FROM pragma_table_list WHERE name GLOB 'role_profile*' AND strict=1").get().n,7);d.close();
 const bytes=readFileSync(w.path);for(const extra of [{},{roleProfiles:h.options},{assets:h.assets},{methodPackages:h.methods},...['schema29-existing-v1','schema30-existing-v1','schema32-existing-v1'].map(version=>({existingStore:{version,storeId},roleProfiles:h.options,assets:h.assets}))])openMemoryCore({path:w.path,...extra}).close();
 openReadDatabase(w.path).db.close();assert.deepEqual(readFileSync(w.path),bytes);
 assert.throws(()=>openMemoryCore({path:w.path,existingStore:{version:'schema31-existing-v1',storeId}}),{code:'unsupported_database'});
});
for(const version of [18,29,30,31])for(const stage of ['method','asset','role','version'])test(`C04 child injected failure v${version}/${stage} rolls identity, data, DDL and version back`,t=>{
 if(version>=30&&stage==='method'||version>=31&&stage==='asset'){t.skip('stage already present at this starting version');return;}
 const w=workspace(t),h=host();if(version<30)restoreHistoricalStore(w.path,version);else restoreV30(w.path);
 if(version===31)openMemoryCore({path:w.path,assets:h.assets}).close();const before=readFileSync(w.path);
 const out=openSync(join(w.dir,'stdout'),'w',0o600),err=openSync(join(w.dir,'stderr'),'w',0o600);let r;
 try{r=spawnSync(process.execPath,['--input-type=module','-e',`import assert from 'node:assert/strict';import {DatabaseSync} from 'node:sqlite';import {openMemoryCore} from ${JSON.stringify(index)};import {host} from ${JSON.stringify(helper)};
 const original=DatabaseSync.prototype.exec;DatabaseSync.prototype.exec=function(sql){const value=original.call(this,sql);if(sql.includes(${JSON.stringify({method:'CREATE TABLE method_packages',asset:'CREATE TABLE assets',role:'CREATE TABLE role_profiles',version:'PRAGMA user_version=32'}[stage])}))throw Error('injected');return value;};assert.throws(()=>openMemoryCore({path:process.argv[1],roleProfiles:host().options}),/injected/);`,w.path],{stdio:['ignore',out,err],timeout:15000});}finally{closeSync(out);closeSync(err);}
 assert.equal(r.error,undefined);assert.equal(r.status,0,readFileSync(join(w.dir,'stderr'),'utf8'));assert.deepEqual(readFileSync(w.path),before);
});
test('C04/C05 fresh opt-in, premature/partial schemas, unsupported v19 and validation-only managed openers',t=>{
 const w=workspace(t),h=host();openMemoryCore({path:w.path}).close();let d=new DatabaseSync(w.path);assert.equal(d.prepare('PRAGMA user_version').get().user_version,18);d.close();
 let before=readFileSync(w.path);assert.throws(()=>openMemoryCore({path:w.path,roleProfiles:h.options,existingStore:{version:'schema32-existing-v1',storeId:'store'}}),{code:'unsupported_database'});assert.deepEqual(readFileSync(w.path),before);
 d=new DatabaseSync(w.path);d.exec('PRAGMA user_version=19');d.close();before=readFileSync(w.path);assert.throws(()=>openMemoryCore({path:w.path,roleProfiles:h.options}),{code:'unsupported_database'});assert.deepEqual(readFileSync(w.path),before);
 d=new DatabaseSync(w.path);d.exec('PRAGMA user_version=18;CREATE TABLE role_profiles(id TEXT) STRICT');d.close();before=readFileSync(w.path);for(const options of [{},{roleProfiles:h.options}])assert.throws(()=>openMemoryCore({path:w.path,...options}),{code:'unsupported_database'});assert.deepEqual(readFileSync(w.path),before);
 const fresh=join(w.dir,'fresh.sqlite');openMemoryCore({path:fresh,roleProfiles:h.options}).close();d=new DatabaseSync(fresh);d.exec('DROP TRIGGER role_profile_releases_insert');d.close();before=readFileSync(fresh);assert.throws(()=>openMemoryCore({path:fresh}),{code:'unsupported_database'});assert.throws(()=>openReadDatabase(fresh),{code:'unsupported_database'});assert.deepEqual(readFileSync(fresh),before);
});
test('C05 feature-off bytes and DTOs stay identical; flag-off writers retain v32 and guards',t=>{
 const w=workspace(t),h=host();const saved=restoreHistoricalStore(w.path,'compatibility').expected;
 let c=openMemoryCore({path:w.path});assert.deepEqual(Object.keys(c),saved.keys);assert.equal(JSON.stringify(c.get({namespace:{ownerId:'synthetic-method-owner',scope:'personal',projectId:null},memoryId:saved.id})),JSON.stringify(saved.get));c.close();
 c=openMemoryCore({path:w.path,roleProfiles:h.options});ok(c.publishRoleProfileRelease(publish(),{}));c.close();const before=readFileSync(w.path);c=openMemoryCore({path:w.path});assert.equal(c.readRoleTaskContext,undefined);c.close();assert.deepEqual(readFileSync(w.path),before);
 const db=new DatabaseSync(w.path);assert.equal(db.prepare('PRAGMA user_version').get().user_version,32);assert.throws(()=>db.exec('INSERT OR REPLACE INTO role_profiles SELECT * FROM role_profiles'));validateAssets(db);db.close();
});

test('C05 local preflight, permission and setup recognize v32 without migration',async t=>{
 const f=localFixture(t),h=host();openMemoryCore({path:f.databasePath,roleProfiles:h.options}).close();const before=readFileSync(f.databasePath);
 await preflight(f.config);await checkHostPermission(f.config);assert.deepEqual(readFileSync(f.databasePath),before);
 const setup=await setupFixture(t);openMemoryCore({path:setup.request.databasePath,roleProfiles:h.options}).close();assert.equal((await setup.setup()).status,'prepared');
 const db=new DatabaseSync(setup.request.databasePath);assert.equal(db.prepare('PRAGMA user_version').get().user_version,32);db.close();
});

for(const stage of ['CREATE TABLE method_packages','CREATE TABLE assets','CREATE TABLE role_profiles','PRAGMA user_version=32'])test('C04 fresh-store failure rolls back identity/DDL/version at '+stage,t=>{
 const {path}=workspace(t),original=DatabaseSync.prototype.exec;
 DatabaseSync.prototype.exec=function(sql){const result=original.call(this,sql);if(sql.includes(stage))throw Error('fresh rollback injection');return result;};
 try{assert.throws(()=>openMemoryCore({path,roleProfiles:host().options}),/fresh rollback injection/);}finally{DatabaseSync.prototype.exec=original;}
 const db=new DatabaseSync(path);try{assert.equal(db.prepare('PRAGMA user_version').get().user_version,0);assert.equal(db.prepare('PRAGMA application_id').get().application_id,0);assert.deepEqual(db.prepare('SELECT name FROM sqlite_master').all(),[]);}finally{db.close();}
 openMemoryCore({path,roleProfiles:host().options}).close();const retry=new DatabaseSync(path);assert.equal(retry.prepare('PRAGMA user_version').get().user_version,32);retry.close();
});

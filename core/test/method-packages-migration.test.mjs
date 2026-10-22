import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { DatabaseSync } from 'node:sqlite';
import test from 'node:test';
import { openMemoryCore } from '../contract.mjs';
import { openReadDatabase } from '../read-database.mjs';
import { createTestWorkspace } from '../../tools/testing/workspace.mjs';
import { fixture as localFixture } from '../../adapters/local/test/fixtures/workspace.mjs';
import { setupFixture } from '../../integrations/client/test/fixtures/local-setup-workspace.mjs';
import { preflight } from '../../adapters/local/configuration.mjs';
import { checkHostPermission } from '../../integrations/client/raw/local-host-permission.mjs';
import { host,ns,ok,input,child,childHost,moduleURL,materialize } from '../testing/method-package-fixtures.mjs';

// Every historical layout is made by its actual historical API/opt-in, with
// retained Memory and (where implemented) submitted Card and Raw rows. No
// PRAGMA relabeling or manually invented populated schema is used.
const frozenMethodLayout=JSON.parse(readFileSync(new URL('../testing/method-package-v30-layout.json',import.meta.url),'utf8'));
const bindingTables=['method_bindings','method_binding_generations','method_binding_events'];
const revisions = [[18,'b8fa224'],[20,'73980ab'],[21,'08dfe24'],[22,'d7d46ef'],[23,'8fed09d'],
  [24,'91846e6'],[25,'05f4a94'],[26,'efbf9aa'],[27,'6596b2e'],[28,'63098c1'],[29,'b8fa224']];
function populated(root,version,path) {
  const code = `
import { openMemoryCore } from ${JSON.stringify(pathToFileURL(join(root,'core/contract.mjs')).href)};
import { DatabaseSync } from 'node:sqlite';
${childHost}
const path=process.argv[1], ns=${JSON.stringify(ns)}, version=${version};
let core;
const options={path,...(version>=20?{privateCards:cards}:{})};
const raw={mode:'raw-v1',capBytes:1000000,readPolicy:()=>({generation:'synthetic',reason:null}),
port:{version:'raw-seal-v1',async sealRaw({text}){return {format:'local-plain-v1',keyVersion:null,sealed:Buffer.from(text)};},async openRaw({sealed}){return {text:Buffer.from(sealed).toString()};}}};
if(version>=25&&version<29){const {openRawCaptureCore}=await import(${JSON.stringify(pathToFileURL(join(root,'core/raw-capture.mjs')).href)});
 core=openRawCaptureCore({...options,model:{extract:()=>({items:[]})}},{...raw,...(version>=26?{lineage:true}:{}),...(version>=27?{deletion:true}:{}),...(version>=28?{sources:true}:{})});}
else if(version===29)core=openMemoryCore({...options,model:{extract:()=>({items:[]})},rawConversations:raw});
else core=openMemoryCore(options);
ok(core.admit({namespace:ns,memory:{content:'Synthetic preserved Memory.',kind:'fact'},receipts:[{client:'manual',sessionId:'synthetic',eventId:'one',role:'user',excerpt:'Synthetic explicit excerpt.'}]}));
if(version>=20){const source=ok(core.submitSourceNote({namespace:ns,actionId:'note',text:'Synthetic retained note.',occurredAt:null},token)).source;
ok(core.createCardDraft({namespace:ns,actionId:'draft',drafting:'authored',input:{sources:[source],title:'Synthetic retained Card',body:'Synthetic retained body.'}},token));}
const request={namespace:ns,client:'claude-code',sessionId:'synthetic-raw',eventId:'raw-event',messages:[{id:'raw-message',role:'user',occurredAt:null,messageOrdinal:1,content:'Synthetic Raw.',part:{index:0,start:0,totalUnits:14,totalBytes:14}}]};
if(version>=25)ok(await core.captureRaw(request));
core.close();
if(version===24){const {openDatabase}=await import(${JSON.stringify(pathToFileURL(join(root,'core/database.mjs')).href)});
const {createRawJournal}=await import(${JSON.stringify(pathToFileURL(join(root,'core/raw-journal.mjs')).href)});
const db=openDatabase(path,{rawConversations:true});const journal=createRawJournal({db,...raw});await journal.register(request);db.close();}
const db=new DatabaseSync(path);if(db.prepare('PRAGMA user_version').get().user_version!==version)throw Error('wrong historical layout');
if(version===29){db.close();const c=openMemoryCore({...options,rawConversations:{mode:'off',readPolicy:raw.readPolicy}});
const before=ok(c.getLocalCaptureControl({namespace:ns,client:'codex'}));ok(c.setLocalCaptureControl({namespace:ns,client:'codex',targetId:'synthetic-target',expectedStoreId:before.storeId,expectedRevision:before.revision,automaticCaptureEnabled:false,rawNoticeVersion:null}));c.close();}else db.close();
`;
  child(code,[path]);
}
function snapshot(db) {
  return db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name").all()
    .map(({name}) => ({ name, columns:db.prepare(`PRAGMA table_info("${name}")`).all().map(row=>row.name), rows:db.prepare(`SELECT * FROM "${name}"`).all() }));
}

test('M01 default stays v18 and selected fresh store is v30 without runtime prerequisites enabled', t => {
  const workspace=createTestWorkspace(t),path=join(workspace.path,'default.sqlite');
  let core=openMemoryCore({path});const keys=Object.keys(core);assert.equal(core.importMethodVersion,undefined);core.close();
  let db=new DatabaseSync(path);assert.equal(db.prepare('PRAGMA user_version').get().user_version,18);db.close();
  const trusted=host();core=openMemoryCore({path,methodPackages:trusted.options});
  for(const method of ['captureRaw','submitSourceNote','getLocalCaptureControl'])assert.equal(core[method],undefined);
  assert.equal(ok(core.getMethodPackageCapabilities()).context,false);core.close();
  db=new DatabaseSync(path);assert.equal(db.prepare('PRAGMA user_version').get().user_version,30);
  for(const name of ['raw_capture_events','local_capture_controls','card_notes',...bindingTables])assert.equal(db.prepare(`SELECT count(*) n FROM ${name}`).get().n,0);
  const before=readFileSync(path);db.close();core=openMemoryCore({path});assert.deepEqual(Object.keys(core),keys);core.close();
  assert.deepEqual(readFileSync(path),before);
  const fresh=join(workspace.path,'selected-fresh.sqlite');core=openMemoryCore({path:fresh,methodPackages:trusted.options});core.close();
  db=new DatabaseSync(fresh);assert.equal(db.prepare('PRAGMA user_version').get().user_version,30);db.close();
});

for(const [version,revision] of revisions)test(`M01 actual populated v${version} upgrades once and preserves every existing row`,t=>{
  const workspace=createTestWorkspace(t,{prefix:'method-layout-'}),root=materialize(workspace.path,revision),path=join(workspace.path,'store.sqlite');
  populated(root,version,path);
  let db=new DatabaseSync(path);const before=snapshot(db);db.close();
  const trusted=host();let core=openMemoryCore({path,methodPackages:trusted.options});core.close();
  db=new DatabaseSync(path);assert.equal(db.prepare('PRAGMA user_version').get().user_version,30);
  for(const table of bindingTables)assert.equal(db.prepare(`SELECT count(*) n FROM ${table}`).get().n,0);
  assert.deepEqual(db.prepare("SELECT name,type,tbl_name AS tableName,sql FROM sqlite_master WHERE name GLOB 'method_*' AND sql IS NOT NULL ORDER BY name").all().map(row=>({...row})),frozenMethodLayout.objects);
  for(const table of before)assert.deepEqual(db.prepare(`SELECT ${table.columns.map(name=>'"'+name+'"').join(',')} FROM "${table.name}"`).all(),table.rows,table.name);
  const migrated=snapshot(db);db.close();
  core=openMemoryCore({path,methodPackages:trusted.options});core.close();db=new DatabaseSync(path);assert.deepEqual(snapshot(db),migrated);db.close();
  const opened=openReadDatabase(path);opened.db.close();
  const storeId=migrated.find(table=>table.name==='store_metadata').rows[0].store_id;
  const bytes=readFileSync(path);core=openMemoryCore({path,methodPackages:trusted.options,existingStore:{version:'schema30-existing-v1',storeId}});core.close();
  assert.deepEqual(readFileSync(path),bytes);
});

test('M01 migration rollback injected in a separate process preserves schema, rows and user_version',t=>{
  const workspace=createTestWorkspace(t),path=join(workspace.path,'rollback.sqlite'),core=openMemoryCore({path});
  ok(core.admit({namespace:ns,memory:{content:'Synthetic rollback sentinel.',kind:'fact'},receipts:[{client:'manual',sessionId:'one',eventId:'one',role:'user',excerpt:'Synthetic note.'}]}));core.close();
  const before=readFileSync(path);
  child(`import assert from 'node:assert/strict';import {DatabaseSync} from 'node:sqlite';
  import {openMemoryCore} from ${JSON.stringify(moduleURL('core/contract.mjs'))};${childHost}
  const original=DatabaseSync.prototype.exec;DatabaseSync.prototype.exec=function(sql){const result=original.call(this,sql);if(sql.includes('CREATE TABLE method_packages'))throw Error('synthetic_failure_with_private_prose');return result;};
  assert.throws(()=>openMemoryCore({path:process.argv[1],methodPackages:methods}),/synthetic_failure/);
  `,[path]);
  assert.deepEqual(readFileSync(path),before);
});

test('M01 actual pre-v30 binary refuses v30 in a separate process; v19 and managed prerequisites refuse unchanged',t=>{
  const workspace=createTestWorkspace(t),root=materialize(workspace.path,'b8fa224'),path=join(workspace.path,'store.sqlite'),trusted=host();
  let core=openMemoryCore({path,methodPackages:trusted.options});const receipt=ok(trusted.call(core,'importMethodVersion',input()));core.close();
  const before=readFileSync(path);
  child(`import assert from 'node:assert/strict';import {openMemoryCore} from ${JSON.stringify(pathToFileURL(join(root,'core/contract.mjs')).href)};
  assert.throws(()=>openMemoryCore({path:process.argv[1]}),{code:'unsupported_database'});`,[path]);
  assert.deepEqual(readFileSync(path),before);
  const db=new DatabaseSync(path);db.exec('PRAGMA user_version=19');db.close();const nineteen=readFileSync(path);
  assert.throws(()=>openMemoryCore({path,methodPackages:trusted.options}),{code:'unsupported_database'});assert.deepEqual(readFileSync(path),nineteen);
  const older=join(workspace.path,'older.sqlite');core=openMemoryCore({path:older});core.close();
  assert.throws(()=>openMemoryCore({path:older,methodPackages:trusted.options,existingStore:{version:'schema29-existing-v1',storeId:'missing'}}),{code:'unsupported_database'});
  assert.ok(receipt.version.manifestIdentity);
});

test('M01 upgraded v30 passes local read-only preflight and permission without migration',async t=>{
  const f=localFixture(t),trusted=host();
  const core=openMemoryCore({path:f.databasePath,methodPackages:trusted.options});core.close();
  const before=readFileSync(f.databasePath);
  await preflight(f.config);await checkHostPermission(f.config);
  assert.deepEqual(readFileSync(f.databasePath),before);
});

test('M01 local setup accesses upgraded v30 through managed-existing controls',async t=>{
  const f=await setupFixture(t),trusted=host();
  const core=openMemoryCore({path:f.request.databasePath,methodPackages:trusted.options});core.close();
  const prepared=await f.setup();assert.equal(prepared.status,'prepared',JSON.stringify(prepared));
  const db=new DatabaseSync(f.request.databasePath);assert.equal(db.prepare('PRAGMA user_version').get().user_version,30);db.close();
});

test('M01 selected managed opener refuses a complete v29 prerequisite store without migration',t=>{
  const f=localFixture(t),trusted=host(),before=readFileSync(f.databasePath);
  assert.throws(()=>openMemoryCore({path:f.databasePath,methodPackages:trusted.options,
    existingStore:{version:'schema29-existing-v1',storeId:f.config.authority.storeId}}),{code:'unsupported_database'});
  assert.deepEqual(readFileSync(f.databasePath),before);
});

test('M01 actual old default API and Memory DTOs remain byte-for-byte identical on the same unselected store',t=>{
  const workspace=createTestWorkspace(t),root=materialize(workspace.path,'b8fa224'),path=join(workspace.path,'default.sqlite');
  const previous=JSON.parse(child(`import {openMemoryCore} from ${JSON.stringify(pathToFileURL(join(root,'core/contract.mjs')).href)};
    const ns=${JSON.stringify(ns)},core=openMemoryCore({path:process.argv[1]});
    const admitted=core.admit({namespace:ns,memory:{content:'Synthetic unchanged default DTO.',kind:'fact'},receipts:[{
      client:'manual',sessionId:'synthetic',eventId:'one',role:'user',excerpt:'Synthetic default excerpt.'}]});
    const id=admitted.value.memory.id;
    console.log(JSON.stringify({keys:Object.keys(core),id,get:core.get({namespace:ns,memoryId:id}),list:core.list({namespace:ns}),map:core.map({namespace:ns})}));core.close();`,[path]));
  const core=openMemoryCore({path});
  try{assert.deepEqual(Object.keys(core),previous.keys);assert.equal(JSON.stringify(core.get({namespace:ns,memoryId:previous.id})),JSON.stringify(previous.get));
    assert.equal(JSON.stringify(core.list({namespace:ns})),JSON.stringify(previous.list));assert.equal(JSON.stringify(core.map({namespace:ns})),JSON.stringify(previous.map));}
  finally{core.close();}
});

test('M01 missing prerequisites roll back and damaged v30 openers validate without repair',t=>{
  const workspace=createTestWorkspace(t),path=join(workspace.path,'missing.sqlite'),trusted=host();
  let core=openMemoryCore({path,privateCards:trusted.cards});core.close();
  let db=new DatabaseSync(path);db.exec('DROP TABLE card_operations');db.close();const before=readFileSync(path);
  assert.throws(()=>openMemoryCore({path,methodPackages:trusted.options}),{code:'unsupported_database'});assert.deepEqual(readFileSync(path),before);
  const upgraded=join(workspace.path,'upgraded.sqlite');core=openMemoryCore({path:upgraded,methodPackages:trusted.options});core.close();
  db=new DatabaseSync(upgraded);const storeId=db.prepare('SELECT store_id FROM store_metadata').get().store_id;db.exec('DROP INDEX method_effect_scope');db.close();
  const damaged=readFileSync(upgraded);
  assert.throws(()=>openReadDatabase(upgraded),{code:'unsupported_database'});
  assert.throws(()=>openMemoryCore({path:upgraded}),{code:'unsupported_database'});
  assert.throws(()=>openMemoryCore({path:upgraded,existingStore:{version:'schema29-existing-v1',storeId}}),{code:'unsupported_database'});
  assert.deepEqual(readFileSync(upgraded),damaged);
});

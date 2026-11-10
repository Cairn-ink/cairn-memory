import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';
import { openMemoryCore } from '../index.mjs';
import { createTestWorkspace } from '../../tools/testing/workspace.mjs';

const root=fileURLToPath(new URL('../../',import.meta.url)),revision='35a29c14';
const model={contextWindow:8192,countTokens:()=>1,extract:({input})=>({items:[{content:input.messages[0].content,kind:'fact',confidence:.9,sourceIndices:[0]}]})};
async function firstWrite(core){
 for(const [eventId,content] of [['lazy-one','My breakfast is oats.'],['lazy-two','My breakfast is eggs.']]){
  const r=await core.capture({namespace:ns,client:'synthetic',sessionId:'session',eventId,messages:[{id:eventId,role:'user',content}]});
  assert.equal(r.ok,true,JSON.stringify(r));
 }
}
const ns={ownerId:'synthetic-migration',scope:'personal',projectId:null};
function previous(t){
 const available=spawnSync('git',['cat-file','-e',revision+'^{commit}'],{cwd:root});
 if(available.status!==0){t.skip('Previous engine archive is unavailable in this checkout');return null;}
 const workspace=createTestWorkspace(t,{prefix:'memory-relation-migration-'}),baseline=join(workspace.path,'baseline');mkdirSync(baseline,{mode:0o700});
 const archive=spawnSync('git',['archive',revision,'--','core','plugins/cairn-memory/lib'],{cwd:root,maxBuffer:64*1024*1024,timeout:30000});assert.equal(archive.status,0,String(archive.error??archive.stderr));
 const unpack=spawnSync('tar',['-xC',baseline],{input:archive.stdout});assert.equal(unpack.status,0,String(unpack.stderr));
 const path=join(workspace.path,'store.sqlite');
 const child=spawnSync(process.execPath,['--input-type=module','-e',`
 import {openMemoryCore} from ${JSON.stringify(join(baseline,'core/index.mjs'))};
 import {DatabaseSync} from 'node:sqlite';
 const ns=${JSON.stringify(ns)},c=openMemoryCore({path:process.argv[1]});
 const receipt=id=>({client:'synthetic',sessionId:'s',eventId:id,role:'user',excerpt:id});
 const a=c.admit({namespace:ns,memory:{content:'First value',kind:'fact'},receipts:[receipt('a')]}).value.memory;
 const b=c.admit({namespace:ns,memory:{content:'Second value',kind:'fact'},receipts:[receipt('b')],conflictHints:[{memoryId:a.id,expectedRevision:a.revision,relation:'contradicts'}]}).value.memory;
 await c.close();const db=new DatabaseSync(process.argv[1]);
 db.exec("INSERT INTO memory_conflicts SELECT left_memory_id,left_revision,right_memory_id,right_revision,relation,'inferred-hint' FROM memory_conflicts");db.close();
 console.log(JSON.stringify({a,b}));
 `,path],{encoding:'utf8',timeout:30000});assert.equal(child.status,0,child.stderr);
 return {path,baseline,...JSON.parse(child.stdout)};
}
function hash(path){
 const child=spawnSync(process.execPath,['--input-type=module','-e',"import{readFileSync}from'node:fs';import{createHash}from'node:crypto';console.log(createHash('sha256').update(readFileSync(process.argv[1])).digest('hex'))",path],{encoding:'utf8'});
 assert.equal(child.status,0,child.stderr);return child.stdout.trim();
}
test('additive migration retains both caller sources; previous engine refuses without changing bytes',async t=>{
 const f=previous(t);if(!f)return;
 const core=openMemoryCore({path:f.path,model});
 const untouched=new DatabaseSync(f.path);assert.equal(untouched.prepare('PRAGMA user_version').get().user_version,18);untouched.close();
 const result=core.get({namespace:ns,memoryId:f.a.id});assert.equal(result.ok,true,JSON.stringify(result));
 assert.deepEqual(result.value.conflicts.map(row=>row.source),['explicit-hint','inferred-hint']);
 await firstWrite(core);await core.close();
 const db=new DatabaseSync(f.path);
 assert.equal(db.prepare('PRAGMA user_version').get().user_version,218);
 assert.ok(db.prepare("SELECT name FROM pragma_index_list('memories') WHERE name='index_memory_keyset'").get());
 assert.deepEqual(db.prepare("SELECT name FROM pragma_index_info('index_memory_keyset') ORDER BY seqno").all().map(row=>row.name),['owner_id','scope','project_id','id']);
 assert.equal(db.prepare('SELECT count(*) n FROM memory_relations').get().n,3);
 assert.ok(db.prepare("SELECT decided_by FROM memory_relations WHERE relation='contradicts'").all().every(row=>row.decided_by==='user'));
 assert.equal(db.prepare("SELECT type FROM sqlite_schema WHERE name='memory_conflicts'").get().type,'view');db.close();
 const before=hash(f.path);
 const old=spawnSync(process.execPath,['--input-type=module','-e',`
 import {openMemoryCore} from ${JSON.stringify(join(f.baseline,'core/index.mjs'))};
 try{openMemoryCore({path:process.argv[1]});process.exitCode=1;}catch(error){console.log(error.code);if(error.code!=='unsupported_database')process.exitCode=1;}
 `,f.path],{encoding:'utf8',timeout:30000});
 assert.equal(old.status,0,old.stderr);assert.equal(old.stdout.trim(),'unsupported_database');assert.equal(hash(f.path),before);
});
test('migration collision rolls back the rename, legacy rows, layout and all new objects',async t=>{
 const f=previous(t);if(!f)return;
 let db=new DatabaseSync(f.path);db.exec('CREATE TABLE memory_relations(preserved TEXT)');
 const schema=db.prepare('SELECT * FROM sqlite_schema ORDER BY name').all();db.close();
 const opened=openMemoryCore({path:f.path,model});await firstWrite(opened);await opened.close();
 db=new DatabaseSync(f.path);assert.equal(db.prepare('PRAGMA user_version').get().user_version,18);
 assert.deepEqual(db.prepare('SELECT * FROM sqlite_schema ORDER BY name').all(),schema);
 assert.equal(db.prepare('SELECT count(*) n FROM memory_conflicts').get().n,2);
 db.exec('DROP TABLE memory_relations');db.close();
 const core=openMemoryCore({path:f.path,model});assert.equal(core.get({namespace:ns,memoryId:f.a.id}).value.conflicts.length,2);
 const r=await core.capture({namespace:ns,client:'synthetic',sessionId:'session',eventId:'lazy-three',messages:[{id:'lazy-three',role:'user',content:'My breakfast is toast.'}]});assert.equal(r.ok,true,JSON.stringify(r));await core.close();
});

for(const writer of ['capture','explicit-hint'])test('the earlier four-label package upgrades lazily on '+writer+', retaining typed edges and discarding obsolete rule assertions',async t=>{
 const workspace=createTestWorkspace(t,{prefix:'relation-package-upgrade-'}),baseline=join(workspace.path,'previous');mkdirSync(baseline);
 const archive=spawnSync('git',['archive','02e2f9b2','--','core','plugins/cairn-memory/lib'],{cwd:root,maxBuffer:64*1024*1024,timeout:30000});
 if(archive.status!==0){t.skip('Previous relation package archive unavailable');return;}
 assert.equal(spawnSync('tar',['-xC',baseline],{input:archive.stdout}).status,0);
 const path=join(workspace.path,'store.sqlite');
 const child=spawnSync(process.execPath,['--input-type=module','-e',`
  import {openMemoryCore} from ${JSON.stringify(join(baseline,'core/index.mjs'))};
  import {DatabaseSync} from 'node:sqlite';
  const ns=${JSON.stringify(ns)},core=openMemoryCore({path:process.argv[1]});
  const admit=(content,eventId)=>core.admit({namespace:ns,memory:{content,kind:'fact'},receipts:[{client:'synthetic',sessionId:'session',eventId,role:'user',excerpt:content}]}).value.memory;
  const a=admit('Earlier breakfast','a'),b=admit('Later breakfast','b');await core.close();
  const db=new DatabaseSync(process.argv[1]);
  const insert=db.prepare("INSERT INTO memory_relations(id,from_memory_id,from_revision,to_memory_id,to_revision,relation,confidence,decided_by,created_at) VALUES(?,?,?,?,?,'contradicts',1,?,'now')");
  insert.run('typed',b.id,b.revision,a.id,a.revision,'llm');insert.run('obsolete-rule',a.id,a.revision,b.id,b.revision,'rule');db.close();
 `,path],{encoding:'utf8',timeout:30000});assert.equal(child.status,0,child.stderr);
 const core=openMemoryCore({path,model});
 const untouched=new DatabaseSync(path);assert.equal(untouched.prepare('PRAGMA user_version').get().user_version,118);const earlier=untouched.prepare("SELECT id FROM memories WHERE content='Earlier breakfast'").get().id;untouched.close();
 const read=core.get({namespace:ns,memoryId:earlier});assert.equal(read.ok,true);
 assert.equal(read.value.conflicts.length,1,'obsolete polarity rules are omitted before upgrade');assert.ok(!read.value.relations);
 if(writer==='capture')await firstWrite(core);
 else{const prior=core.get({namespace:ns,memoryId:earlier}).value.memory;const r=core.admit({namespace:ns,memory:{content:'Synthetic explicit relation',kind:'fact'},receipts:[{client:'synthetic',sessionId:'session',eventId:'hint',role:'user',excerpt:'Synthetic explicit relation'}],conflictHints:[{memoryId:prior.id,expectedRevision:prior.revision,relation:'contradicts'}]});assert.equal(r.ok,true,JSON.stringify(r));}
 await core.close();
 const db=new DatabaseSync(path);assert.equal(db.prepare('PRAGMA user_version').get().user_version,218);
 assert.deepEqual(db.prepare("SELECT id,relation,decided_by FROM memory_relations WHERE id IN ('typed','obsolete-rule')").all().map(row=>({...row})),[{id:'typed',relation:'contradicts',decided_by:'llm'}]);
 assert.ok(db.prepare("SELECT name FROM pragma_table_info('memory_relations')").all().some(row=>row.name==='reason'));db.close();
 const before=hash(path);
 const refused=spawnSync(process.execPath,['--input-type=module','-e',`
  import {openMemoryCore} from ${JSON.stringify(join(baseline,'core/index.mjs'))};
  try{openMemoryCore({path:process.argv[1]});process.exitCode=1;}catch(error){console.log(error.code);if(error.code!=='unsupported_database')process.exitCode=1;}
 `,path],{encoding:'utf8',timeout:30000});
 assert.equal(refused.status,0,refused.stderr);assert.equal(refused.stdout.trim(),'unsupported_database');assert.equal(hash(path),before);
});

test('relation layouts retain the earlier base guards against unexpected future feature objects',async t=>{
 const {openReadDatabase}=await import('../read-database.mjs');
 for(const sql of ["CREATE TABLE AsSeTs(id TEXT) STRICT",
  "CREATE TRIGGER ROLE_PROFILE_extra AFTER INSERT ON memories BEGIN SELECT 1; END",
  "CREATE TABLE card_current_extra(id TEXT) STRICT"]){
  const workspace=createTestWorkspace(t,{prefix:'relation-layout-guard-'}),path=join(workspace.path,'store.sqlite');
  const core=openMemoryCore({path,model,rawConversations:{mode:'off',readPolicy:()=>({generation:'synthetic',reason:null})}});await firstWrite(core);await core.close();
  const db=new DatabaseSync(path),storeId=db.prepare('SELECT store_id FROM store_metadata WHERE singleton=1').get().store_id;
  workspace.defer(()=>{if(db.isOpen)db.close();});
  db.exec(sql);const before=db.prepare('SELECT * FROM sqlite_schema ORDER BY name').all();
  for(const options of [{},{existingStore:{version:'schema29-existing-v1',storeId}}]){
   assert.throws(()=>openMemoryCore({path,...options}),{code:'unsupported_database'});
   assert.deepEqual(db.prepare('SELECT * FROM sqlite_schema ORDER BY name').all(),before);
  }
  assert.throws(()=>openReadDatabase(path),{code:'unsupported_database'});
  assert.deepEqual(db.prepare('SELECT * FROM sqlite_schema ORDER BY name').all(),before);db.close();
 }
});

test('relation layouts retain exact owned feature definitions when reopened',async t=>{
 const {assetHost}=await import('../testing/asset-fixtures.mjs');
 const {openReadDatabase}=await import('../read-database.mjs');
 const workspace=createTestWorkspace(t,{prefix:'relation-owned-guard-'}),path=join(workspace.path,'store.sqlite');
 const core=openMemoryCore({path,model,assets:assetHost().options});await firstWrite(core);await core.close();
 const db=new DatabaseSync(path);workspace.defer(()=>{if(db.isOpen)db.close();});
 const storeId=db.prepare('SELECT store_id FROM store_metadata WHERE singleton=1').get().store_id;
 db.exec('DROP TRIGGER asset_no_replace; CREATE TRIGGER asset_no_replace BEFORE INSERT ON assets BEGIN SELECT 1; END;');
 const before=db.prepare('SELECT * FROM sqlite_schema ORDER BY name').all();
 for(const options of [{},{assets:assetHost().options},{existingStore:{version:'schema31-existing-v1',storeId}}]){
  assert.throws(()=>openMemoryCore({path,...options}),{code:'unsupported_database'});
  assert.deepEqual(db.prepare('SELECT * FROM sqlite_schema ORDER BY name').all(),before);
 }
 assert.throws(()=>openReadDatabase(path),{code:'unsupported_database'});
 assert.deepEqual(db.prepare('SELECT * FROM sqlite_schema ORDER BY name').all(),before);
});

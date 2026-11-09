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
const ns={ownerId:'synthetic-migration',scope:'personal',projectId:null};
function previous(t){
 const available=spawnSync('git',['cat-file','-e',revision+'^{commit}'],{cwd:root});
 if(available.status!==0){t.skip('Previous engine archive is unavailable in this checkout');return null;}
 const workspace=createTestWorkspace(t,{prefix:'memory-relation-migration-'}),baseline=join(workspace.path,'baseline');mkdirSync(baseline,{mode:0o700});
 const archive=spawnSync('git',['archive',revision],{cwd:root,maxBuffer:64*1024*1024});assert.equal(archive.status,0,String(archive.stderr));
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
 const core=openMemoryCore({path:f.path});
 const result=core.get({namespace:ns,memoryId:f.a.id});assert.equal(result.ok,true,JSON.stringify(result));
 assert.deepEqual(result.value.conflicts.map(row=>row.source),['explicit-hint','inferred-hint']);
 await core.close();
 const db=new DatabaseSync(f.path);
 assert.equal(db.prepare('PRAGMA user_version').get().user_version,118);
 assert.equal(db.prepare('SELECT count(*) n FROM memory_relations').get().n,2);
 assert.ok(db.prepare('SELECT decided_by FROM memory_relations').all().every(row=>row.decided_by==='user'));
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
 assert.throws(()=>openMemoryCore({path:f.path}));
 db=new DatabaseSync(f.path);assert.equal(db.prepare('PRAGMA user_version').get().user_version,18);
 assert.deepEqual(db.prepare('SELECT * FROM sqlite_schema ORDER BY name').all(),schema);
 assert.equal(db.prepare('SELECT count(*) n FROM memory_conflicts').get().n,2);
 db.exec('DROP TABLE memory_relations');db.close();
 const core=openMemoryCore({path:f.path});assert.equal(core.get({namespace:ns,memoryId:f.a.id}).value.conflicts.length,2);await core.close();
});

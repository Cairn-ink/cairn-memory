import assert from 'node:assert/strict';
import test from 'node:test';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { openMemoryCore } from '../index.mjs';
import { createMemoryRuntime } from '../runtime.mjs';
import { migrateVersion14 } from '../episode-schema.mjs';
import { transaction } from '../database.mjs';

const ns={ownerId:'migration',scope:'personal',projectId:null};
const options={sessionEpisodes:{mode:'episode-v1'},captureEvidence:'staged-v1',captureQualification:'source-bound-v2'};
function directory(t) {const dir=mkdtempSync(join(tmpdir(),'se1-migration-'));t.after(()=>rmSync(dir,{recursive:true,force:true}));return dir;}
function legacy(t) {
  const path=join(directory(t),'store.sqlite'),runtime=createMemoryRuntime({path});
  const nsInternal={...ns,projectId:''},key={client:'synthetic',eventId:'old',payloadDigest:'a'.repeat(64),leaseMs:125000};
  const view={messages:[{id:'message',role:'user',content:'Synthetic old evidence'}],retainedSourceWindow:{maxUnitsPerMessage:800,truncatedMessageIndices:[]}};
  const claim=runtime.claimCaptureEvidence(nsInternal,{...key,view});
  runtime.finishCapturedAdmission(nsInternal,{...key,token:claim.token,items:[]});runtime.close();
  const db=new DatabaseSync(path);db.exec('PRAGMA foreign_keys=ON');t.after(()=>db.close());return{path,db};
}
const oldTables=['admission_claims','staged_capture_evidence','capture_initial_classification'];

test('E11 fresh v15 and current-v14 transactional child-first migration preserve rows/FKs/journal',t=>{
  const fresh=openMemoryCore({path:join(directory(t),'fresh.sqlite'),...options});fresh.close();
  const f=legacy(t),before=oldTables.map(name=>f.db.prepare(`SELECT * FROM ${name}`).all());
  assert.equal(f.db.prepare('PRAGMA user_version').get().user_version,14);
  const core=openMemoryCore({path:f.path,...options});t.after(()=>core.close());
  assert.equal(f.db.prepare('PRAGMA user_version').get().user_version,15);
  for(let i=0;i<oldTables.length;i++) for(const [j,row]of before[i].entries()) {
    const actual=f.db.prepare(`SELECT * FROM ${oldTables[i]}`).all()[j];for(const [key,value]of Object.entries(row))assert.equal(actual[key],value);
  }
  assert.deepEqual(f.db.prepare('PRAGMA foreign_key_check').all(),[]);
  assert.throws(()=>f.db.exec("INSERT INTO staged_capture_evidence(owner_id,scope,project_id,client,event_id,state,created_at,expires_at,payload_bytes) VALUES('x','personal','','x','missing','pending',0,0,0)"),/FOREIGN KEY/);
  assert.equal(core.inspectAdmission({namespace:ns,client:'synthetic',eventId:'old',includeInitialClassification:true}).value.initialClassification.status,'skipped_empty');
});

test('E11 failed rebuild rolls back parent, every child and version; FK-off caller rejects',t=>{
  const f=legacy(t);f.db.exec('CREATE TABLE episode_identity(precious TEXT); INSERT INTO episode_identity VALUES(\'keep\')');
  const schema=f.db.prepare('SELECT * FROM sqlite_master ORDER BY name').all(),rows=oldTables.map(name=>f.db.prepare(`SELECT * FROM ${name}`).all());
  assert.throws(()=>openMemoryCore({path:f.path,...options}));
  assert.equal(f.db.prepare('PRAGMA user_version').get().user_version,14);
  assert.deepEqual(f.db.prepare('SELECT * FROM sqlite_master ORDER BY name').all(),schema);
  assert.deepEqual(oldTables.map(name=>f.db.prepare(`SELECT * FROM ${name}`).all()),rows);
  assert.deepEqual(f.db.prepare('PRAGMA foreign_key_check').all(),[]);
  f.db.exec('PRAGMA foreign_keys=OFF');assert.throws(()=>transaction(f.db,()=>migrateVersion14(f.db)),/storage_error/);
});

function frozenBase(t) {
  const dir=directory(t);
  const archive=execFileSync('git',['archive','93e52b7','core','plugins/cairn-memory/lib/redact.mjs'],{maxBuffer:16*1024*1024});
  execFileSync('tar',['-x','-C',dir],{input:archive});return dir;
}

test('E11 prior binary rejects v15; E10 mode-off prompt/request/output/stored-field/digest parity against 93e52b7',t=>{
  const base=frozenBase(t),directoryPath=directory(t);
  const harness=join(directoryPath,'parity.mjs');
  writeFileSync(harness,`import {pathToFileURL} from 'node:url';
import {DatabaseSync} from 'node:sqlite';
const {openMemoryCore}=await import(pathToFileURL(process.argv[2]+'/core/index.mjs'));
const {rationaleModel}=await import(pathToFileURL(process.argv[2]+'/core/testing/rationale-model.mjs'));
const path=process.argv[3],calls=[];
const model=rationaleModel();
for(const method of ['extract','qualifyCandidates','classify']){const run=model[method];if(run)model[method]=request=>{calls.push([method,request]);return run(request);};}
const core=openMemoryCore({path,model,...JSON.parse(process.argv[4])});
const input={namespace:{ownerId:'parity',scope:'personal',projectId:null},client:'scripted',sessionId:'legacy-session',eventId:'event',messages:[{id:'source',role:'user',content:'I prefer offline tools.'}]};
const result=await core.capture(input),replay=await core.capture(input);if(!result.ok)throw new Error(JSON.stringify(result));core.close();
const db=new DatabaseSync(path);
const rows=Object.fromEntries(['memories','receipts','admission_claims','staged_capture_evidence'].map(name=>[name,db.prepare('SELECT * FROM '+name).all()]));db.close();
const clean=value=>JSON.stringify(value,(key,item)=>['signal'].includes(key)?undefined:typeof item==='string'?item.replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/g,'UUID').replace(/\\d{4}-\\d\\d-\\d\\dT\\d\\d:\\d\\d:\\d\\d\\.\\d{3}Z/g,'TIME'):['created_at','expires_at'].includes(key)&&typeof item==='number'?0:item);
console.log(clean({calls,result,replay,rows}));`);
  const run=(root,config,index)=>execFileSync(process.execPath,[harness,root,join(directoryPath,(root===base?'base':'new')+index+'.sqlite'),JSON.stringify(config)],{encoding:'utf8'}).trim();
  const current=new URL('../../',import.meta.url).pathname;
  for (const [index,config] of [{},{captureQualification:'source-bound-v2'},{captureQualification:'source-bound-v2',captureEvidence:'staged-v1'}].entries()) assert.equal(run(current,config,index),run(base,config,index));
  const path=join(directoryPath,'upgraded.sqlite');openMemoryCore({path,...options}).close();
  const script=`import {openMemoryCore} from ${JSON.stringify(new URL('file://'+base+'/core/index.mjs').href)};try{openMemoryCore({path:${JSON.stringify(path)}});process.exit(2)}catch(error){if(error.code!=='unsupported_database')throw error}`;
  execFileSync(process.execPath,['--input-type=module','-e',script]);
});

test('E10 unexpected automatic tag output is still rejected with episodes off',async t=>{
  const core=openMemoryCore({path:join(directory(t),'automatic.sqlite'),model:{countTokens:()=>1,contextWindow:8192,
    extract:()=>({items:[{content:'Do reviews',kind:'instruction',confidence:0.8,sourceIndices:[0],procedural:true}]})}});t.after(()=>core.close());
  const result=await core.capture({namespace:ns,client:'synthetic',sessionId:'session',eventId:'tag-output',messages:[{id:'m',role:'user',content:'Always review changes.'}]});
  assert.equal(result.ok,false);assert.equal(result.error.code,'invalid_model_output');
});

test('E11 original v13 synthetic schema migrates through v14 journal into v15',t=>{
  const f=legacy(t);f.db.exec('DROP TABLE capture_initial_classification; PRAGMA user_version=13');
  const before=f.db.prepare('SELECT * FROM admission_claims').all();
  openMemoryCore({path:f.path,...options}).close();
  assert.equal(f.db.prepare('PRAGMA user_version').get().user_version,15);
  assert.deepEqual(f.db.prepare('SELECT * FROM admission_claims').all(),before);
  assert.deepEqual(f.db.prepare('PRAGMA foreign_key_check').all(),[]);
});

test('E11 reserved parent and released staging CHECK constraints enforce non-leased/content-free shapes',t=>{
  const f=legacy(t);openMemoryCore({path:f.path,...options}).close();
  assert.throws(()=>f.db.exec("UPDATE admission_claims SET state='reserved'"),/CHECK/);
  f.db.exec("UPDATE admission_claims SET state='reserved',memory_ids=NULL,suppressed_count=NULL");
  assert.throws(()=>f.db.exec("UPDATE admission_claims SET token='fake-lease'"),/CHECK/);
  assert.throws(()=>f.db.exec("UPDATE staged_capture_evidence SET state='released'"),/CHECK/);
  f.db.exec("UPDATE staged_capture_evidence SET event_mode='episode-v1',state='released',payload=NULL,payload_bytes=0,release_reason='capacity'");
  assert.deepEqual(f.db.prepare('PRAGMA foreign_key_check').all(),[]);
});

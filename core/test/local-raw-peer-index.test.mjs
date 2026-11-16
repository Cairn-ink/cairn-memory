import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { syncBuiltinESMExports } from 'node:module';
import { dirname, join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { createTestWorkspace } from '../../tools/testing/workspace.mjs';
import { openMemoryCore } from '../index.mjs';
import { attestContentSafety, attestedLocalRawPackage, LOCAL_RAW_PACKAGES, LOCAL_RAW_PRIVACY_DDL, LOCAL_RAW_PEER_INDEX_DDL } from '../content-safety-schema.mjs';
import { installLocalRawPeerIndex, localRawPeerIndexState } from '../local-authority-schema.mjs';
import { inspectExistingStorePin } from '../existing-store.mjs';
import { readSqliteFixture } from '../testing/content-safety-s2h-fixture.mjs';
import { safetyFixture } from '../testing/content-safety-s2h-fixture.mjs';
import { createCommitDispatcher } from '../commit-dispatch.mjs';
import { transaction } from '../database.mjs';

const indexDDL = LOCAL_RAW_PEER_INDEX_DDL.join('\n');
const schema = db => JSON.stringify(db.prepare('SELECT type,name,tbl_name,sql FROM sqlite_schema ORDER BY type,name').all());
const localNames = db => db.prepare("SELECT name FROM sqlite_schema WHERE sql IS NOT NULL AND name GLOB 'local_raw_*' ORDER BY name").all().map(row=>row.name);
const packageNames = version => LOCAL_RAW_PACKAGES[version].map(sql=>/IF NOT EXISTS (\w+)/.exec(sql)[1]).sort();
function space(t, path, available = 1e12) {
  const mock = t.mock.method(fs, 'statfsSync', directory => {
    assert.equal(directory, dirname(path));
    return { bavail: available, bsize: 1 };
  });
  syncBuiltinESMExports();
  t.after(()=>{ mock.mock.restore(); syncBuiltinESMExports(); });
  return mock;
}
function trace(t) {
  const statements=[], prepare=DatabaseSync.prototype.prepare, exec=DatabaseSync.prototype.exec;
  t.mock.method(DatabaseSync.prototype, 'exec', function(sql) { statements.push(sql); return exec.call(this,sql); });
  t.mock.method(DatabaseSync.prototype, 'prepare', function(sql) {
    const statement=prepare.call(this,sql);
    return new Proxy(statement,{get(target,key){
      const value=Reflect.get(target,key,target);
      return typeof value!=='function'?value:(...args)=>{
        if(['get','all','run','iterate'].includes(key))statements.push(sql);
        return value.apply(target,args);
      };
    }});
  });
  return statements;
}
async function store(t) {
  const workspace=createTestWorkspace(t), path=join(workspace.path,'peer.sqlite');
  const core=openMemoryCore({path,raw:true,rawSearch:false});await core.close();
  const db=new DatabaseSync(path,{timeout:5000});workspace.defer(()=>db.close());
  db.exec('DROP INDEX local_raw_message_peers');
  const storeId=db.prepare('SELECT store_id FROM store_metadata').get().store_id;
  const pin=await inspectExistingStorePin(path,storeId);
  return {path,db,pin};
}
function seed(db, rowid) {
  db.exec("INSERT INTO raw_conversations VALUES('peer-conversation','peer-owner','personal','','codex','peer-session',1,'2026','2026')");
  db.prepare(`INSERT INTO raw_messages(rowid,conversation_id,message_id,ordinal,role,total_units,total_bytes,assembly_state,first_event_id)
    VALUES(?,'peer-conversation','peer-message',1,'user',1,1,'complete','peer-event')`).run(rowid);
}

for(const contentSafety of [undefined,'s2h-v1']) test(`fresh local open builds exactly v2 (${contentSafety??'ordinary'})`, async t=>{
  const workspace=createTestWorkspace(t),path=join(workspace.path,'fresh.sqlite');
  space(t,path);
  const statements=trace(t);
  const core=openMemoryCore({path,raw:true,rawSearch:false,...(contentSafety?{contentSafety}:{})});await core.close();
  const db=new DatabaseSync(path);try {
    assert.deepEqual(localNames(db),packageNames('v2'));
    assert.ok(statements.includes("SELECT 1 FROM sqlite_schema WHERE type='index' AND name='local_raw_message_peers'"));
    assert.ok(statements.includes('SELECT max(rowid) AS n FROM raw_messages'));
    assert.equal(statements.filter(sql=>sql===indexDDL).length,1);
  } finally {db.close();}
});

for(const rowid of [0,2_000_000,2_000_001]) test(`writable v1 open uses rowid threshold (${rowid})`,async t=>{
  const f=await store(t);if(rowid)seed(f.db,rowid);
  const before=schema(f.db),statfs=space(t,f.path),statements=trace(t);
  const core=openMemoryCore({path:f.path,raw:true,rawSearch:false,existingStore:f.pin});await core.close();
  assert.deepEqual(localNames(f.db),packageNames(rowid>2_000_000?'v1':'v2'));
  assert.equal(statements.filter(sql=>sql===indexDDL).length,rowid>2_000_000?0:1);
  if(rowid>2_000_000) {
    assert.equal(statfs.mock.callCount(),0);assert.equal(schema(f.db),before);
    attestContentSafety(f.db);statements.length=0;
    assert.equal(installLocalRawPeerIndex(f.db,f.path,transaction),'over_threshold');
    assert.ok(!statements.some(sql=>/BEGIN|PRAGMA|CREATE/.test(sql)));
  }
});

test('attested v2 build path executes zero SQL and no filesystem probe',async t=>{
  // The adversarial matrix tests v2's full-schema cache; use that inherited
  // fixture here too, without loading a fixed historical git revision.
  const {spawnSync}=await import('node:child_process');
  const workspace=createTestWorkspace(t),path=join(workspace.path,'attested.sqlite');
  const child=spawnSync(process.execPath,[new URL('../testing/create-existing-safety-store.mjs',import.meta.url).pathname,path],{encoding:'utf8',timeout:30000});
  assert.equal(child.status,0,child.stderr);
  const db=new DatabaseSync(path);try {
    db.exec(LOCAL_RAW_PACKAGES.v2.join('\n'));attestContentSafety(db);
    assert.equal(attestedLocalRawPackage(db),'v2');
    const statfs=space(t,path,0),statements=trace(t);
    assert.equal(installLocalRawPeerIndex(db,path,transaction),'present');assert.deepEqual(statements,[]);
    assert.equal(statfs.mock.callCount(),0);
    const core=openMemoryCore({path,raw:true,rawSearch:false});await core.close();
    assert.ok(!statements.some(sql=>sql===indexDDL || sql==='SELECT max(rowid) AS n FROM raw_messages' || sql.includes("type='index' AND name='local_raw_message_peers'")));
  } finally {db.close();}
});

for(const available of [0,167,168]) test(`empty-table space floor is 168 bytes (${available})`,async t=>{
  const f=await store(t),before=schema(f.db),statfs=space(t,f.path,available),statements=trace(t);
  const core=openMemoryCore({path:f.path,raw:true,rawSearch:false,existingStore:f.pin});await core.close();
  assert.equal(statfs.mock.callCount(),1);
  assert.equal(statements.filter(sql=>sql===indexDDL).length,available<168?0:1);
  if(available<168)assert.equal(schema(f.db),before);
  assert.deepEqual(localNames(f.db),packageNames(available<168?'v1':'v2'));
});

test('space estimate scales with max(rowid), and the status helper is SELECT-only',async t=>{
  const f=await store(t);seed(f.db,2_000_001);attestContentSafety(f.db);
  const statfs=space(t,f.path,0),statements=trace(t);
  assert.deepEqual(localRawPeerIndexState(f.db),{present:false,overThreshold:true});
  assert.deepEqual(statements,["SELECT 1 FROM sqlite_schema WHERE type='index' AND name='local_raw_message_peers'",'SELECT max(rowid) AS n FROM raw_messages']);
  assert.equal(statfs.mock.callCount(),0);
  f.db.exec(indexDDL);statements.length=0;
  assert.deepEqual(localRawPeerIndexState(f.db),{present:true,overThreshold:true});
  assert.equal(statements.length,2);assert.equal(statfs.mock.callCount(),0);
});

test('nonempty space requirement uses twice 84 bytes per maximum rowid before BEGIN',async t=>{
  const f=await store(t);seed(f.db,10);attestContentSafety(f.db);
  const before=schema(f.db);space(t,f.path,1679);const statements=trace(t);
  assert.equal(installLocalRawPeerIndex(f.db,f.path,transaction),'insufficient_space');
  assert.ok(!statements.some(sql=>/BEGIN|PRAGMA|CREATE/.test(sql)));
  assert.equal(schema(f.db),before);
});

test('lineage-zero presence path builds without changing the layout cell',async t=>{
  const f=safetyFixture(t,33);await f.migrate();
  const db=f.connect();try {
    assert.equal(db.prepare('SELECT card_lineage_revision FROM content_safety_control').get().card_lineage_revision,0);
    db.exec(LOCAL_RAW_PRIVACY_DDL.join('\n'));attestContentSafety(db);
    assert.equal(attestedLocalRawPackage(db),null);
    const physical=db.prepare('PRAGMA user_version').get().user_version;
    space(t,f.path);const statements=trace(t);
    const core=openMemoryCore({path:f.path,raw:true,rawSearch:false});await core.close();
    assert.deepEqual(localNames(db),packageNames('v2'));
    assert.ok(statements.includes("SELECT 1 FROM sqlite_schema WHERE type='index' AND name='local_raw_message_peers'"));
    assert.equal(db.prepare('PRAGMA user_version').get().user_version,physical);
  } finally {db.close();}
});

for(const stage of ['BEGIN','DDL','COMMIT']) for(const errcode of [5,6,9,10,13,10|(3<<8)])
test(`local open defers native ${errcode} at ${stage} and rolls back exactly v1`,async t=>{
  const f=await store(t),before=schema(f.db);space(t,f.path);
  const exec=DatabaseSync.prototype.exec,statements=[];
  let installed=false,ready=false,building=false,injections=0;
  t.mock.method(DatabaseSync.prototype,'exec',function(sql){
    statements.push(sql);
    if(sql===LOCAL_RAW_PRIVACY_DDL.join('\n'))installed=true;
    else if(installed && sql==='COMMIT' && !ready){const result=exec.call(this,sql);ready=true;return result;}
    if(ready && sql==='BEGIN IMMEDIATE')building=true;
    if(building && (stage==='BEGIN' && sql==='BEGIN IMMEDIATE' || stage==='DDL' && sql===indexDDL || stage==='COMMIT' && sql==='COMMIT')) {
      if(stage==='DDL')exec.call(this,sql);
      injections++;throw Object.assign(Error('synthetic build failure'),{code:'ERR_SQLITE_ERROR',errcode});
    }
    return exec.call(this,sql);
  });
  const core=openMemoryCore({path:f.path,raw:true,rawSearch:false,existingStore:f.pin});await core.close();
  assert.equal(injections,1);assert.equal(schema(f.db),before);
  assert.deepEqual(localNames(f.db),packageNames('v1'));
  const build=statements.slice(statements.lastIndexOf('BEGIN IMMEDIATE'));
  assert.ok(!build.some(sql=>/^PRAGMA\b/.test(sql)));
  if(stage!=='BEGIN')assert.ok(build.includes('ROLLBACK'));
});

test('unexpected build errors propagate after rollback',async t=>{
  const f=await store(t),before=schema(f.db);space(t,f.path);
  const exec=DatabaseSync.prototype.exec;
  t.mock.method(DatabaseSync.prototype,'exec',function(sql){
    if(sql===indexDDL)throw Object.assign(Error('unexpected'),{code:'ERR_SQLITE_ERROR',errcode:1});
    return exec.call(this,sql);
  });
  assert.throws(()=>openMemoryCore({path:f.path,raw:true,rawSearch:false,existingStore:f.pin}),{errcode:1});
  assert.equal(schema(f.db),before);
});

test('reader held across build makes COMMIT busy after 5 seconds; local open succeeds with unchanged v1 bytes',async t=>{
  const f=await store(t);space(t,f.path);
  const reader=new DatabaseSync(f.path,{readOnly:true});
  reader.exec('BEGIN');reader.prepare('SELECT * FROM raw_messages').all();
  const before=schema(f.db),bytes=readSqliteFixture(f.path),exec=DatabaseSync.prototype.exec;
  let built=false,busy=false,rolledBack=false;
  t.mock.method(DatabaseSync.prototype,'exec',function(sql){
    if(sql===indexDDL)built=true;
    if(built && sql==='ROLLBACK')rolledBack=true;
    try{return exec.call(this,sql);}catch(error){if(built && sql==='COMMIT'){assert.equal(error.errcode&255,5);busy=true;}throw error;}
  });
  const started=performance.now();
  try {
    const core=openMemoryCore({path:f.path,raw:true,rawSearch:false,existingStore:f.pin});await core.close();
    assert.ok(performance.now()-started>=5000);
    assert.ok(built && busy && rolledBack);assert.equal(schema(f.db),before);
    assert.deepEqual(readSqliteFixture(f.path),bytes);
  } finally {reader.exec('ROLLBACK');reader.close();}
});

test('daemon build uses the existing synchronous opening scope',async t=>{
  const workspace=createTestWorkspace(t),path=join(workspace.path,'daemon.sqlite');space(t,path);
  const dispatcher=createCommitDispatcher({strict:true});
  const core=dispatcher.open(()=>openMemoryCore({path,raw:true,rawSearch:false}));
  try {assert.equal(dispatcher.inspectSynchronousWrites().count,0);}
  finally {await core.close();}
});

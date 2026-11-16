import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { syncBuiltinESMExports } from 'node:module';
import { basename, dirname, join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { Worker } from 'node:worker_threads';
import { DatabaseSync } from 'node:sqlite';
import { createTestWorkspace } from '../../tools/testing/workspace.mjs';
import { openMemoryCore } from '../index.mjs';
import { attestContentSafety, attestedContentSafetyControl, attestedLocalRawPackage, contentSafetyDDL, LOCAL_RAW_PACKAGES, LOCAL_RAW_PRIVACY_DDL, LOCAL_RAW_PEER_INDEX_DDL } from '../content-safety-schema.mjs';
import { installLocalRawPeerIndex, buildLocalRawPeerIndex, readLocalRawPeerIndexStatus } from '../local-authority-schema.mjs';
import { inspectExistingStorePin } from '../existing-store.mjs';
import { openDatabase, localRawPeerIndexAdmission } from '../database.mjs';
import { copySqliteFixture, readSqliteFixture } from '../testing/content-safety-s2h-fixture.mjs';
import { safetyFixture } from '../testing/content-safety-s2h-fixture.mjs';
import { installCardMemoryInvalidation } from '../private-card-schema.mjs';
import { createCommitDispatcher } from '../commit-dispatch.mjs';
import { localPlainPort } from '../testing/raw-fixtures.mjs';
import { rationaleModel } from '../testing/rationale-model.mjs';
import { installRawSearchTestClock, rawSearchTestWait } from '../testing/raw-search-clock.mjs';

const namespace = { ownerId: 'synthetic-owner', scope: 'personal', projectId: null };
const retryPrefix = path => basename(path) + '.peer-index-retry.';
const retryNames = path => fs.readdirSync(dirname(path)).filter(name=>name.startsWith(retryPrefix(path)));
const retryPath = (path, {notBefore,delayMs,reason}) => path + '.peer-index-retry.' + notBefore + '.' + delayMs + '.' + reason;
const putRetry = (path, value) => { const marker=retryPath(path,value);fs.writeFileSync(marker,'');return marker; };
const retry = path => {
  const names=retryNames(path);assert.equal(names.length,1);
  const [notBefore,delayMs,reason]=names[0].slice(retryPrefix(path).length).split('.');
  return {notBefore:Number(notBefore),delayMs:Number(delayMs),reason};
};
const offlineCommand = path => "cairn-memory raw index --db '" + path.replaceAll("'", "'\\''") + "'";
const offlineArgv = path => ['cairn-memory','raw','index','--db',path];
const packageProbe = sql => sql.startsWith('SELECT name,type,sql FROM sqlite_schema WHERE sql IS NOT NULL AND (name GLOB');
const identitySQL = 'SELECT store_id,(SELECT user_version FROM pragma_user_version) AS physical FROM store_metadata WHERE singleton=1';
const nativeError = errcode => Object.assign(Error('synthetic native failure'), { code: 'ERR_SQLITE_ERROR', errcode });
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
async function store(t, { l1 = false } = {}) {
  const workspace=createTestWorkspace(t), path=join(workspace.path,'peer.sqlite');
  if (l1) {
    const child=spawnSync(process.execPath,[new URL('../testing/create-existing-safety-store.mjs',import.meta.url).pathname,path],{encoding:'utf8',timeout:30000});
    assert.equal(child.error,undefined);assert.equal(child.status,0,child.stderr);
  } else {
    const core=openMemoryCore({path,raw:true,rawSearch:false});await core.close();
  }
  const db=new DatabaseSync(path,{timeout:5000});workspace.defer(()=>db.close());
  if (l1) db.exec(LOCAL_RAW_PRIVACY_DDL.join('\n'));
  else db.exec('DROP INDEX local_raw_message_peers');
  attestContentSafety(db);
  assert.equal(attestedLocalRawPackage(db),l1?'v1':null);
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
    assert.ok(statements.some(packageProbe));
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
    assert.deepEqual(installLocalRawPeerIndex(f.db,f.path),{status:'skipped',reason:'over_threshold'});
    assert.ok(!statements.some(sql=>/BEGIN|PRAGMA|CREATE/.test(sql)));
  }
});

test('attested v2 helper executes zero SQL and no space probe',async t=>{
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
    assert.deepEqual(installLocalRawPeerIndex(db,path),{status:'present',reason:null});assert.deepEqual(statements,[]);
    assert.equal(statfs.mock.callCount(),0);
    const core=openMemoryCore({path,raw:true,rawSearch:false});await core.close();
    assert.ok(!statements.some(sql=>sql===indexDDL || sql==='SELECT max(rowid) AS n FROM raw_messages' || packageProbe(sql)));
  } finally {db.close();}
});

test('attested control helper returns frozen value copies without SQL, including the optional receipt field',async t=>{
  const f=await store(t,{l1:true}),ordinary=await store(t);
  const row=f.db.prepare('SELECT * FROM content_safety_control WHERE singleton=1').get();
  const expected=[row.singleton,row.base_layout,row.suppression_revision,row.card_lineage_revision,
    row.migration_state,row.suppression_domain,row.migration_id,row.inventory_digest,row.receipt_event_time];
  const legacy=safetyFixture(t,33);await legacy.migrate();
  const legacyDB=legacy.connect();t.after(()=>legacyDB.close());attestContentSafety(legacyDB);
  const legacyRow=legacyDB.prepare('SELECT * FROM content_safety_control WHERE singleton=1').get();
  const statements=trace(t),first=attestedContentSafetyControl(f.db),second=attestedContentSafetyControl(f.db);
  assert.deepEqual(first,expected);assert.deepEqual(second,expected);assert.notEqual(first,second);
  assert.equal(Object.isFrozen(first),true);assert.equal(Object.isFrozen(second),true);
  assert.throws(()=>{first[3]=0;},TypeError);
  assert.deepEqual(attestedContentSafetyControl(f.db),expected);
  assert.equal(attestedContentSafetyControl(ordinary.db),null);
  assert.deepEqual(attestedContentSafetyControl(legacyDB),[legacyRow.singleton,legacyRow.base_layout,
    legacyRow.suppression_revision,legacyRow.card_lineage_revision,legacyRow.migration_state,
    legacyRow.suppression_domain,legacyRow.migration_id,legacyRow.inventory_digest]);
  assert.deepEqual(statements,[]);
});

for(const available of [0,167,168]) test(`empty-table space floor is 168 bytes (${available})`,async t=>{
  const f=await store(t),before=schema(f.db),statfs=space(t,f.path,available),statements=trace(t);
  const core=openMemoryCore({path:f.path,raw:true,rawSearch:false,existingStore:f.pin});await core.close();
  assert.equal(statfs.mock.callCount(),1);
  assert.equal(statements.filter(sql=>sql===indexDDL).length,available<168?0:1);
  if(available<168)assert.equal(schema(f.db),before);
  assert.deepEqual(localNames(f.db),packageNames(available<168?'v1':'v2'));
});

test('status is read-only and returns the documented present / threshold / deferral shape',async t=>{
  const f=await store(t);seed(f.db,2_000_001);attestContentSafety(f.db);
  const statfs=space(t,f.path,0),statements=trace(t);
  const expected={present:false,overThreshold:true,deferredReason:null,deferredUntil:null,
    offlineCommand:offlineCommand(f.path),offlineArgv:offlineArgv(f.path)};
  assert.deepEqual(readLocalRawPeerIndexStatus(f.db,f.path),expected);
  assert.equal(statements.length,2);assert.ok(statements.every(sql=>sql.startsWith('SELECT')));
  assert.equal(statfs.mock.callCount(),0);
  const notBefore=Date.now()+6*60*60*1000;
  putRetry(f.path,{notBefore,delayMs:6*60*60*1000,reason:'busy'});
  statements.length=0;
  assert.deepEqual(readLocalRawPeerIndexStatus(f.db,f.path),{...expected,deferredReason:'busy',deferredUntil:notBefore});
  assert.equal(statements.length,2);assert.equal(retry(f.path).notBefore,notBefore);
  f.db.exec(indexDDL);statements.length=0;
  assert.deepEqual(readLocalRawPeerIndexStatus(f.db,f.path),{...expected,present:true});
  assert.equal(statements.length,2);assert.equal(statfs.mock.callCount(),0);
});

test('nonempty space requirement uses twice 84 bytes per maximum rowid before BEGIN',async t=>{
  const f=await store(t);seed(f.db,10);attestContentSafety(f.db);
  const before=schema(f.db);space(t,f.path,1679);const statements=trace(t);
  assert.deepEqual(installLocalRawPeerIndex(f.db,f.path),{status:'skipped',reason:'space'});
  assert.equal(retry(f.path).reason,'space');
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
    assert.ok(statements.some(packageProbe));
    assert.equal(db.prepare('PRAGMA user_version').get().user_version,physical);
  } finally {db.close();}
});

// Select the builder by connection identity, never by the runtime's attestation
// headers: injected side errors cannot mark the returned runtime refused.
function interceptBuild(t, { stage, errcode, programmingError, failRollback = false } = {}) {
  const exec=DatabaseSync.prototype.exec,prepare=DatabaseSync.prototype.prepare,close=DatabaseSync.prototype.close;
  let runtime,side,injections=0,closed=false;
  const statements=[];
  t.mock.method(DatabaseSync.prototype,'exec',function(sql){
    if(sql===LOCAL_RAW_PRIVACY_DDL.join('\n'))runtime=this;
    if(runtime && this!==runtime && sql==='BEGIN IMMEDIATE')side=this;
    if(this===side) {
      statements.push(sql);
      if(stage==='BEGIN' && sql==='BEGIN IMMEDIATE' || stage==='DDL' && sql===indexDDL || stage==='COMMIT' && sql==='COMMIT') {
        if(stage==='DDL')exec.call(this,sql);
        injections++;throw programmingError ?? nativeError(errcode);
      }
      if(failRollback && sql==='ROLLBACK')throw nativeError(10);
    }
    return exec.call(this,sql);
  });
  t.mock.method(DatabaseSync.prototype,'prepare',function(sql){
    if(this===side && packageProbe(sql)) {
      statements.push(sql);
      if(stage==='verify'){injections++;throw nativeError(errcode);}
    }
    return prepare.call(this,sql);
  });
  t.mock.method(DatabaseSync.prototype,'close',function(){
    const result=close.call(this);if(this===side)closed=true;return result;
  });
  return {statements,get runtime(){return runtime;},get side(){return side;},get injections(){return injections;},get closed(){return closed;}};
}
for(const stage of ['BEGIN','verify','DDL','COMMIT']) for(const errcode of [5,6,9,10,778,13,1,11])
test(`L1 open defers native ${errcode} at side ${stage}, preserving exact v1 bytes and runtime reads`,async t=>{
  const f=await store(t,{l1:true}),before=schema(f.db),bytes=readSqliteFixture(f.path);space(t,f.path);
  const build=interceptBuild(t,{stage,errcode});
  const core=openMemoryCore({path:f.path,raw:true,rawSearch:false});
  try {
    assert.equal(build.injections,1);assert.notEqual(build.side,build.runtime);assert.equal(build.closed,true);
    assert.equal(schema(f.db),before);assert.deepEqual(readSqliteFixture(f.path),bytes);
    assert.deepEqual(localNames(f.db),packageNames('v1'));
    assert.equal(core.list({namespace}).ok,true);
    assert.equal(attestedLocalRawPackage(build.runtime),'v1');
    assert.equal(retry(f.path).reason,({5:'busy',6:'busy',9:'interrupt',10:'io',778:'io',13:'full'})[errcode]??'error');
    assert.ok(!build.statements.some(sql=>/^PRAGMA\b/.test(sql)));
    if(stage!=='BEGIN')assert.ok(build.statements.includes('ROLLBACK'));
  } finally {await core.close();}
});

test('non-SQLite programming errors propagate after side rollback and close',async t=>{
  const f=await store(t,{l1:true}),before=schema(f.db),bytes=readSqliteFixture(f.path);space(t,f.path);
  const build=interceptBuild(t,{stage:'DDL',programmingError:new TypeError('synthetic programming error')});
  assert.throws(()=>openMemoryCore({path:f.path,raw:true,rawSearch:false}),{name:'TypeError',message:'synthetic programming error'});
  assert.equal(build.injections,1);assert.equal(build.closed,true);
  assert.equal(schema(f.db),before);assert.deepEqual(readSqliteFixture(f.path),bytes);
  assert.deepEqual(retryNames(f.path),[]);
});

test('native ROLLBACK failure retires the builder and leaves the runtime usable at v1',async t=>{
  const f=await store(t,{l1:true}),before=schema(f.db),bytes=readSqliteFixture(f.path);space(t,f.path);
  const build=interceptBuild(t,{stage:'DDL',errcode:1,failRollback:true});
  const core=openMemoryCore({path:f.path,raw:true,rawSearch:false});
  try {
    assert.equal(build.injections,1);assert.equal(build.closed,true);
    assert.equal(schema(f.db),before);assert.deepEqual(readSqliteFixture(f.path),bytes);
    assert.equal(core.list({namespace}).ok,true);assert.equal(attestedLocalRawPackage(build.runtime),'v1');
  } finally {await core.close();}
});

test('reader held across build makes COMMIT busy after 5 seconds; local open succeeds with unchanged v1 bytes',async t=>{
  const f=await store(t);space(t,f.path);
  const before=schema(f.db),bytes=readSqliteFixture(f.path),exec=DatabaseSync.prototype.exec;
  let reader;
  let built=false,busy=false,rolledBack=false;
  t.mock.method(DatabaseSync.prototype,'exec',function(sql){
    if(sql===indexDDL) {
      // Installation has committed; the builder now holds RESERVED.
      reader=new DatabaseSync(f.path,{readOnly:true});
      reader.exec('BEGIN');reader.prepare('SELECT * FROM raw_messages').all();
      built=true;
    }
    if(built && sql==='ROLLBACK')rolledBack=true;
    try{return exec.call(this,sql);}catch(error){if(built && sql==='COMMIT'){assert.equal(error.errcode&255,5);busy=true;}throw error;}
  });
  const started=performance.now();
  try {
    const core=openMemoryCore({path:f.path,raw:true,rawSearch:false,existingStore:f.pin});await core.close();
    assert.ok(performance.now()-started>=5000);
    assert.ok(built && busy && rolledBack);assert.equal(schema(f.db),before);
    assert.deepEqual(readSqliteFixture(f.path),bytes);
  } finally {if(reader){try{reader.exec('ROLLBACK');}finally{reader.close();}}}
});

test('daemon build uses the existing synchronous opening scope',async t=>{
  const workspace=createTestWorkspace(t),path=join(workspace.path,'daemon.sqlite');space(t,path);
  const dispatcher=createCommitDispatcher({strict:true});
  const core=dispatcher.open(()=>openMemoryCore({path,raw:true,rawSearch:false}));
  try {
    assert.equal(dispatcher.inspectSynchronousWrites().count,0);
    const db=new DatabaseSync(path);try{assert.deepEqual(localNames(db),packageNames('v2'));}finally{db.close();}
    assert.ok(dispatcher.inspectSynchronousWrites().scopes.includes('daemon start install'));
  }
  finally {await core.close();}
});

for(const code of ['ENOSYS','EIO','EPERM']) test(`L1 statfs ${code} defers without touching v1 or refusing the runtime`,async t=>{
  const f=await store(t,{l1:true}),before=schema(f.db),bytes=readSqliteFixture(f.path);
  const statfs=space(t,f.path);statfs.mock.mockImplementation(()=>{throw Object.assign(Error(code),{code,errno:-1});});
  const build=interceptBuild(t);
  const core=openMemoryCore({path:f.path,raw:true,rawSearch:false});
  try {
    assert.equal(build.side,undefined);assert.equal(retry(f.path).reason,'io');
    assert.equal(schema(f.db),before);assert.deepEqual(readSqliteFixture(f.path),bytes);
    assert.equal(core.list({namespace}).ok,true);assert.equal(attestedLocalRawPackage(build.runtime),'v1');
  } finally {await core.close();}
});

for(const probe of ['presence','size']) for(const errcode of [5,9,10,778,13,1,11])
test(`native ${errcode} on ${probe} probe defers and preserves a usable v1 runtime`,async t=>{
  const f=await store(t,{l1:probe==='size'}),before=schema(f.db),bytes=readSqliteFixture(f.path);
  const statfs=space(t,f.path),prepare=DatabaseSync.prototype.prepare;
  let injections=0;
  const mock=t.mock.method(DatabaseSync.prototype,'prepare',function(sql){
    if(probe==='presence'?packageProbe(sql):sql==='SELECT max(rowid) AS n FROM raw_messages') {
      injections++;throw nativeError(errcode);
    }
    return prepare.call(this,sql);
  });
  const core=openMemoryCore({path:f.path,raw:true,rawSearch:false});
  mock.mock.restore();
  try {
    assert.equal(injections,1);assert.equal(statfs.mock.callCount(),0);assert.ok(retry(f.path).notBefore>Date.now());
    assert.equal(schema(f.db),before);assert.deepEqual(readSqliteFixture(f.path),bytes);
    assert.deepEqual(localNames(f.db),packageNames('v1'));assert.equal(core.list({namespace}).ok,true);
  } finally {await core.close();}
});

for(const phase of ['prepare','get']) for(const errcode of [9,10,778])
test(`native ${errcode} in optional identity ${phase} leaves a readable admitted v1 open`,async t=>{
  const f=await store(t,{l1:true}),before=schema(f.db);
  const physical=f.db.prepare('PRAGMA user_version').get().user_version;
  space(t,f.path);const statements=trace(t),prepare=DatabaseSync.prototype.prepare;
  let runtime,injections=0;
  t.mock.method(DatabaseSync.prototype,'prepare',function(sql){
    if(sql!==identitySQL)return prepare.call(this,sql);
    runtime=this;
    const inject=()=>{injections++;throw nativeError(errcode);};
    if(phase==='prepare')return inject();
    prepare.call(this,sql);
    return {get:inject};
  });
  const core=openMemoryCore({path:f.path,raw:true,rawSearch:false});
  try {
    assert.equal(injections,1);assert.equal(runtime.isOpen,true);
    assert.equal(localRawPeerIndexAdmission(runtime),undefined);
    assert.equal(runtime.prepare('PRAGMA user_version').get().user_version,physical);
    assert.equal(statements.filter(sql=>sql===indexDDL).length,0);
    assert.equal(schema(f.db),before);
    assert.deepEqual(localNames(f.db),packageNames('v1'));assert.equal(core.list({namespace}).ok,true);
    assert.equal(attestedLocalRawPackage(runtime),'v1');assert.equal(retry(f.path).reason,'error');
  } finally {await core.close();}
});

test('dropped identity admission preserves public Raw lifecycle and privacy rows exactly as a v1 threshold skip',async t=>{
  installRawSearchTestClock(t);
  const f=await store(t,{l1:true}),workspace=createTestWorkspace(t),controlPath=join(workspace.path,'control.sqlite');
  // Share only the initial synthetic identity/secret, so stored fence keys can
  // be compared exactly while newly generated memory/conversation IDs may differ.
  fs.copyFileSync(f.path,controlPath);
  const controlDB=new DatabaseSync(controlPath);workspace.defer(()=>controlDB.close());
  // Identical inert content in another namespace; only the physical rowid differs.
  seed(f.db,1);seed(controlDB,2_000_001);
  assert.equal(f.db.prepare('SELECT max(rowid) AS n FROM raw_messages').get().n,1);
  assert.equal(controlDB.prepare('SELECT max(rowid) AS n FROM raw_messages').get().n,2_000_001);
  const statfs=space(t,f.path),statements=trace(t),prepare=DatabaseSync.prototype.prepare;
  let droppedRuntime,controlRuntime,injections=0,drop=true;
  const capture=t.mock.method(DatabaseSync.prototype,'prepare',function(sql){
    if(sql!==identitySQL)return prepare.call(this,sql);
    if(!drop){controlRuntime=this;return prepare.call(this,sql);}
    droppedRuntime=this;prepare.call(this,sql);
    return {get(){injections++;throw nativeError(9);}};
  });
  const dropped=openMemoryCore({path:f.path,raw:true,model:rationaleModel()});
  let control;
  try {
    drop=false;control=openMemoryCore({path:controlPath,raw:true,model:rationaleModel()});
    capture.mock.restore();
    assert.equal(injections,1);assert.equal(localRawPeerIndexAdmission(droppedRuntime),undefined);
    assert.ok(localRawPeerIndexAdmission(controlRuntime));assert.equal(statfs.mock.callCount(),1);
    assert.equal(retry(f.path).reason,'error');assert.deepEqual(retryNames(controlPath),[]);
    for(const runtime of [droppedRuntime,controlRuntime])assert.equal(attestedLocalRawPackage(runtime),'v1');

    const ok=result=>{assert.equal(result.ok,true,JSON.stringify(result));return result.value;};
    const texts=['Synthetic amber telescope.','Synthetic birch telescope.','Synthetic cedar telescope.'];
    const start=Date.parse('2026-01-01T00:00:00.000Z');
    t.mock.timers.enable({apis:['Date'],now:start});
    async function sequence(core,db) {
      const sources=[];
      for(const [index,content] of texts.entries()) {
        // Separate receipt anchors so forgetting one cannot hide the survivors.
        t.mock.timers.setTime(start+index*2*60*60*1000);
        const occurredAt=new Date().toISOString();
        const saved=ok(await core.capture({namespace,client:'claude-code',sessionId:'equality-session-'+index,
          eventId:'equality-event-'+index,messages:[{id:'equality-message-'+index,role:'user',content,
            occurredAt}]}));
        assert.equal(saved.admission.memories.length,1);
        const conversation=ok(core.listRawConversations({namespace,client:'claude-code'})).conversations
          .find(row=>row.firstReceivedAt===occurredAt);
        assert.ok(conversation);
        sources.push({memoryId:saved.admission.memories[0].id,conversationId:conversation.id,
          revision:conversation.revision});
      }
      async function search(count) {
        let found;
        for(let attempt=0;attempt<16;attempt++) {
          await rawSearchTestWait(1010);ok(await core.maintainRawSearch({namespace}));
          found=ok(await core.searchRaw({namespace,query:'telescope',semantic:false}));
          if(found.coverage.status==='complete' && found.candidates.length===count)break;
        }
        assert.equal(found.coverage.status,'complete');assert.equal(found.candidates.length,count);
        return {coverage:found.coverage,semantic:found.semantic,candidates:found.candidates.map(hit=>({
          content:texts[Number(hit.messageId.slice('equality-message-'.length))],namespace:hit.namespace,
          messageId:hit.messageId,ordinal:hit.ordinal,role:hit.role,occurredAt:hit.occurredAt,
          currentness:hit.currentness,classification:hit.classification,
          spans:hit.ranges.map(range=>range.span),
        })).sort((a,b)=>a.content.localeCompare(b.content))};
      }
      const before=await search(3);
      const forgotten=ok(core.get({namespace,memoryId:sources[0].memoryId})).memory;
      const forget=ok(core.forget({namespace,memoryId:forgotten.id,expectedRevision:forgotten.revision}));
      const {conversationId,...deletion}=ok(core.deleteConversation({namespace,conversationId:sources[1].conversationId,
        expectedRevision:sources[1].revision,actionId:'equality-delete'}));
      assert.equal(conversationId,sources[1].conversationId);assert.equal(deletion.forgottenMemories,1);
      const page=ok(core.list({namespace}));assert.equal(page.memories.length,1);
      const memories=page.memories.map(row=>{
        const {id,...metadata}=row;
        return {...metadata,content:ok(core.get({namespace,memoryId:id})).memory.content};
      }).sort((a,b)=>a.content.localeCompare(b.content));
      assert.deepEqual(memories.map(row=>row.content),texts.slice(2));
      const after=await search(1);assert.equal(after.candidates[0].content,texts[2]);
      const privacy=Object.fromEntries(['raw_session_fences','local_raw_hide_windows','local_raw_uuid_fences',
        'local_raw_uuid_jobs','local_raw_uuid_backfill'].map(table=>[table,
        db.prepare('SELECT * FROM '+table).all().sort((a,b)=>JSON.stringify(a).localeCompare(JSON.stringify(b)))]));
      assert.equal(privacy.raw_session_fences.length,2);assert.equal(privacy.local_raw_hide_windows.length,2);
      assert.equal(privacy.local_raw_uuid_fences.length,2);assert.equal(privacy.local_raw_uuid_jobs.length,2);
      assert.ok(privacy.local_raw_uuid_jobs.every(row=>row.complete===1));
      return {forget,deletion,memories,nextCursor:page.nextCursor,exhausted:page.exhausted,before,after,privacy};
    }
    const actual=await sequence(dropped,f.db),expected=await sequence(control,controlDB);
    assert.deepEqual(actual,expected);
    assert.equal(localRawPeerIndexAdmission(droppedRuntime),undefined);
    assert.equal(statements.filter(sql=>sql===indexDDL).length,0);
    for(const db of [f.db,controlDB]) {
      assert.deepEqual(localNames(db),packageNames('v1'));
      attestContentSafety(db);assert.equal(attestedLocalRawPackage(db),'v1');
    }
  } finally {capture.mock.restore();await control?.close();await dropped.close();}
});

for(const phase of ['prepare','get'])
test(`non-SQLite optional identity ${phase} errors still fail construction`,async t=>{
  const f=await store(t,{l1:true}),prepare=DatabaseSync.prototype.prepare,error=Error('identity programming failure');
  let runtime;
  t.mock.method(DatabaseSync.prototype,'prepare',function(sql){
    if(sql!==identitySQL)return prepare.call(this,sql);
    runtime=this;
    if(phase==='prepare')throw error;
    return {get(){throw error;}};
  });
  assert.throws(()=>openMemoryCore({path:f.path,raw:true,rawSearch:false}),value=>value===error);
  assert.equal(runtime.isOpen,false);assert.equal(localRawPeerIndexAdmission(runtime),undefined);
});

for(const fenced of [false,true])
test(`public explicit Raw without localAuthority has identical SQL/fs and refusals with the feature off or v1 (fenced=${fenced})`,async t=>{
  const workspace=createTestWorkspace(t),path=join(workspace.path,'explicit.sqlite');
  const config={path,rawSearch:false,rawConversations:{mode:'raw-v1',capBytes:1000000,
    port:localPlainPort(),readPolicy:()=>({generation:'synthetic-notice',reason:null})}};
  const initial=openMemoryCore(config);await initial.close();
  const db=new DatabaseSync(path);workspace.defer(()=>db.close());
  assert.equal(localNames(db).length,0);
  if(fenced){
    const stat=fs.lstatSync(path);
    config.storeFence={version:'store-fence-v1',dev:String(stat.dev),ino:String(stat.ino),applicationId:0x43414952,
      userVersion:db.prepare('PRAGMA user_version').get().user_version,
      storeId:db.prepare('SELECT store_id FROM store_metadata WHERE singleton=1').get().store_id};
  }
  const calls=[],mocks=[],denied=Object.assign(Error('mandatory leaf denied'),{code:'EPERM'});
  let failLeaf=false;
  for(const operation of ['realpathSync','lstatSync','readdirSync','statfsSync']){
    const original=fs[operation];
    mocks.push(t.mock.method(fs,operation,function(target,...args){
      calls.push({operation,path:String(target)});
      if(failLeaf && operation==='lstatSync' && target===path)throw denied;
      return original.call(this,target,...args);
    }));
  }
  syncBuiltinESMExports();t.after(()=>{for(const mock of mocks)mock.mock.restore();syncBuiltinESMExports();});
  const statements=trace(t),snapshots=[];
  for(const enabled of [false,true]){
    if(enabled)db.exec(LOCAL_RAW_PRIVACY_DDL.join('\n'));
    calls.length=statements.length=0;
    const core=openMemoryCore(config);
    try {assert.equal(core.list({namespace}).ok,true);} finally {await core.close();}
    snapshots.push({sql:[...statements],fs:[...calls]});
    assert.ok(!statements.includes(identitySQL));
    assert.ok(!statements.some(sql=>packageProbe(sql)||sql===indexDDL||sql==='SELECT max(rowid) AS n FROM raw_messages'));
    for(const operation of ['realpathSync','readdirSync','statfsSync'])assert.equal(calls.filter(call=>call.operation===operation).length,0);
    assert.ok(calls.some(call=>call.operation==='lstatSync'),'mandatory leaf checks still run');
    failLeaf=true;
    assert.throws(()=>openMemoryCore(config),error=>error===denied);
    failLeaf=false;
    calls.length=statements.length=0;
    assert.throws(()=>openMemoryCore({...config,rawConversations:{...config.rawConversations,port:{}}}),{code:'raw_crypto_unavailable'});
    assert.deepEqual(statements,[]);assert.deepEqual(calls,[]);
  }
  assert.deepEqual(snapshots[1],snapshots[0],'zero added SQL executions or filesystem calls');
  assert.deepEqual(localNames(db),packageNames('v1'));
});

test('successful L1 side build leaves the same runtime readable and cookie-attested v2',async t=>{
  const f=await store(t,{l1:true});space(t,f.path);
  const build=interceptBuild(t);
  const core=openMemoryCore({path:f.path,raw:true,rawSearch:false});
  try {
    assert.notEqual(build.side,build.runtime);assert.equal(build.closed,true);
    assert.equal(build.statements.filter(sql=>sql===indexDDL).length,1);
    assert.equal(readLocalRawPeerIndexStatus(build.runtime,f.path).present,true);
    assert.equal(core.list({namespace}).ok,true);
    assert.equal(attestedLocalRawPackage(build.runtime),'v2');
    attestContentSafety(f.db);assert.equal(attestedLocalRawPackage(f.db),'v2');
  } finally {await core.close();}
});

test('busy COMMIT backoff survives a process boundary, doubles to 24h, retries on expiry and clears on success',async t=>{
  const f=await store(t,{l1:true});space(t,f.path);
  let now=Date.now();t.mock.method(Date,'now',()=>now);
  const exec=DatabaseSync.prototype.exec;
  let runtime,side,inject=true,attempts=0;
  t.mock.method(DatabaseSync.prototype,'exec',function(sql){
    if(sql===LOCAL_RAW_PRIVACY_DDL.join('\n'))runtime=this;
    if(runtime && this!==runtime && sql==='BEGIN IMMEDIATE'){side=this;attempts++;}
    if(this===side && sql==='COMMIT' && inject)throw nativeError(5);
    return exec.call(this,sql);
  });
  for(const hours of [6,12,24,24]) {
    runtime=side=undefined;
    const core=openMemoryCore({path:f.path,raw:true,rawSearch:false});
    try {assert.equal(core.list({namespace}).ok,true);} finally {await core.close();}
    const marker=retry(f.path);
    assert.deepEqual(marker,{notBefore:now+hours*60*60*1000,delayMs:hours*60*60*1000,reason:'busy'});
    if(hours===6) {
      const child=spawnSync(process.execPath,['--input-type=module','-e',`
        import fs from 'node:fs';import {syncBuiltinESMExports} from 'node:module';
        import {DatabaseSync} from 'node:sqlite';
        import {openMemoryCore} from ${JSON.stringify(new URL('../index.mjs',import.meta.url).href)};
        let sqlProbes=0,statfs=0;const handles=new Set();
        fs.statfsSync=()=>{statfs++;throw Error('unexpected statfs');};syncBuiltinESMExports();
        const prepare=DatabaseSync.prototype.prepare,exec=DatabaseSync.prototype.exec;
        DatabaseSync.prototype.prepare=function(sql){
          handles.add(this);
          if(sql.startsWith('SELECT max(rowid)') || sql.startsWith('SELECT name,type,sql FROM sqlite_schema WHERE sql IS NOT NULL AND (name GLOB')){sqlProbes++;throw Error('unexpected probe');}
          return prepare.call(this,sql);
        };
        DatabaseSync.prototype.exec=function(sql){handles.add(this);return exec.call(this,sql);};
        const core=openMemoryCore({path:process.argv[1],raw:true,rawSearch:false});
        const read=core.list({namespace:${JSON.stringify(namespace)}});await core.close();
        console.log(JSON.stringify({sqlProbes,statfs,connections:handles.size,read:read.ok}));
      `,f.path],{encoding:'utf8',timeout:30000});
      assert.equal(child.error,undefined);assert.equal(child.status,0,child.stderr);
      assert.deepEqual(JSON.parse(child.stdout),{sqlProbes:0,statfs:0,connections:1,read:true});
      assert.deepEqual(retry(f.path),marker);
    }
    now=marker.notBefore+1; // Ordinary retries occur after expiry and retain delay history.
  }
  assert.equal(attempts,4);inject=false;
  runtime=side=undefined;
  const core=openMemoryCore({path:f.path,raw:true,rawSearch:false});
  try {assert.equal(core.list({namespace}).ok,true);} finally {await core.close();}
  assert.equal(attempts,5);assert.deepEqual(retryNames(f.path),[]);
  attestContentSafety(f.db);assert.equal(attestedLocalRawPackage(f.db),'v2');
});

test('deferral writes exactly one empty private regular encoded marker and no temporary files',async t=>{
  const f=await store(t,{l1:true});space(t,f.path,0);
  const now=Date.now();t.mock.method(Date,'now',()=>now);
  putRetry(f.path,{notBefore:now-1,delayMs:21600000,reason:'busy'});
  const unrelated=f.path+'.peer-index-retry.invalid';fs.writeFileSync(unrelated,'');
  const core=openMemoryCore({path:f.path,raw:true,rawSearch:false});
  try {assert.equal(core.list({namespace}).ok,true);} finally {await core.close();}
  const expected={notBefore:now+43200000,delayMs:43200000,reason:'space'};
  assert.deepEqual(retryNames(f.path).sort(),[basename(unrelated),basename(retryPath(f.path,expected))].sort());
  const stat=fs.lstatSync(retryPath(f.path,expected));
  assert.equal(stat.isFile(),true);assert.equal(stat.size,0);assert.equal(stat.mode&0o777,0o600);
  assert.deepEqual(localNames(f.db),packageNames('v1'));
  assert.deepEqual(fs.readdirSync(dirname(f.path)).filter(name=>name.endsWith('.tmp')),[]);
});

test('far-future retry names cannot override expired six-hour history on failure',async t=>{
  const f=await store(t,{l1:true});let now=Date.now();t.mock.method(Date,'now',()=>now);
  const farFuture=putRetry(f.path,{notBefore:Number.MAX_SAFE_INTEGER,delayMs:86400000,reason:'busy'});
  putRetry(f.path,{notBefore:now-1,delayMs:21600000,reason:'busy'});
  assert.equal(readLocalRawPeerIndexStatus(f.db,f.path).deferredUntil,null);
  const statfs=space(t,f.path,0);
  const core=openMemoryCore({path:f.path,raw:true,rawSearch:false});
  try {assert.equal(core.list({namespace}).ok,true);} finally {await core.close();}
  const expected={notBefore:now+43200000,delayMs:43200000,reason:'space'};
  assert.equal(statfs.mock.callCount(),1);
  assert.deepEqual(retryNames(f.path).sort(),[basename(farFuture),basename(retryPath(f.path,expected))].sort());
  assert.equal(readLocalRawPeerIndexStatus(f.db,f.path).deferredUntil,expected.notBefore);
  // Full-grammar ownership is unchanged: a subsequent successful build clears both.
  statfs.mock.restore();space(t,f.path);now=expected.notBefore+1;
  const successful=openMemoryCore({path:f.path,raw:true,rawSearch:false});
  try {assert.deepEqual(localNames(f.db),packageNames('v2'));} finally {await successful.close();}
  assert.deepEqual(retryNames(f.path),[]);
});

for(const [suffix,reserved=false] of [
  ['broken'],['1.21600000.busy.extra'],['-1.21600000.busy'],['later.21600000.busy'],
  ['9007199254740992.21600000.busy'],['NOW.21600000.unknown'],['NOW.21600000.5'],
  ['NOW.21600000.'],['NOW.0.busy',true],['NOW.21599999.busy',true],['NOW.86400001.busy',true],
  ['NOW.21600000x.busy'],['NOW.21600000.5.busy'],['NOW.9007199254740992.busy'],
  ['PAST.21600000.busy',true],['FUTURE.21600000.busy',true],['NOW.21600000.busy\n'],
]) test(`invalid or inactive retry name is ignored (${JSON.stringify(suffix)})`,async t=>{
  const f=await store(t,{l1:true}),now=Date.now();t.mock.method(Date,'now',()=>now);
  const name=suffix.replace('NOW',String(now+21600000)).replace('PAST',String(now-1)).replace('FUTURE',String(now+86400001));
  fs.writeFileSync(f.path+'.peer-index-retry.'+name,'content is never consulted');
  assert.equal(readLocalRawPeerIndexStatus(f.db,f.path).deferredUntil,null);
  const statfs=space(t,f.path),statements=trace(t);
  const core=openMemoryCore({path:f.path,raw:true,rawSearch:false});
  try {assert.equal(core.list({namespace}).ok,true);} finally {await core.close();}
  assert.equal(statfs.mock.callCount(),1);assert.equal(statements.filter(sql=>sql===indexDDL).length,1);
  assert.deepEqual(retryNames(f.path),reserved?[]:[retryPrefix(f.path)+name]);
});

test('name-only reader selects the largest valid deadline within 24h and never inspects entries',async t=>{
  const f=await store(t,{l1:true}),now=Date.now();t.mock.method(Date,'now',()=>now);
  const markers=[
    {notBefore:now,delayMs:21600000,reason:'busy'},
    {notBefore:now+21600000,delayMs:21600000,reason:'io'},
    {notBefore:now+86400000,delayMs:86400000,reason:'full'},
    {notBefore:now+86400001,delayMs:86400000,reason:'error'},
  ];
  for(const marker of markers)putRetry(f.path,marker);
  const statfs=space(t,f.path),statements=trace(t);
  const mocks=[];
  for(const operation of ['open','openSync','read','readSync','readFile','readFileSync','readlink','readlinkSync','stat','statSync','lstatSync']){
    const original=fs[operation];
    mocks.push(t.mock.method(fs,operation,function(path,...args){
      assert.ok(!String(path).includes('.peer-index-retry.'),'marker '+operation);
      return original.call(this,path,...args);
    }));
  }
  syncBuiltinESMExports();t.after(()=>{for(const mock of mocks)mock.mock.restore();syncBuiltinESMExports();});
  const status=readLocalRawPeerIndexStatus(f.db,f.path);
  assert.equal(status.deferredUntil,markers[2].notBefore);assert.equal(status.deferredReason,'full');
  statements.length=0;
  for(let i=0;i<3;i++)assert.deepEqual(installLocalRawPeerIndex(f.db,f.path),{status:'skipped',reason:'backoff'});
  assert.deepEqual(statements,[]);assert.equal(statfs.mock.callCount(),0);
});

for(const kind of ['swapped symlink','companion hard link','FIFO']) for(const encoded of [false,true])
test(`marker ${kind} never opens its entry or target across two runtime opens (encoded=${encoded})`,async t=>{
  const f=await store(t,{l1:true}),statfs=space(t,f.path),statements=trace(t);
  // An encoded name can defer regardless of inode type; invalid names cannot.
  // In either case the entry/target itself is never inspected.
  const now=Date.now();t.mock.method(Date,'now',()=>now);
  const marker=encoded?retryPath(f.path,{notBefore:now+21600000,delayMs:21600000,reason:'busy'})
    :f.path+'.peer-index-retry.'+kind.replaceAll(' ','-');
  const companion=f.path+'-journal';
  if(kind==='swapped symlink')fs.symlinkSync(f.path,marker);
  if(kind==='companion hard link'){
    // A rollback leaves an empty persistent journal, created through SQLite.
    f.db.exec('PRAGMA journal_mode=PERSIST; BEGIN IMMEDIATE; UPDATE store_metadata SET store_id=store_id; ROLLBACK');
    fs.linkSync(companion,marker);
  }
  if(kind==='FIFO'){
    const child=spawnSync('mkfifo',[marker],{encoding:'utf8'});assert.equal(child.status,0,child.stderr);
  }
  const mocks=[];
  for(const operation of ['open','openSync','read','readSync','readFile','readFileSync','readlink','readlinkSync','stat','statSync','lstatSync']){
    const original=fs[operation];
    mocks.push(t.mock.method(fs,operation,function(path,...args){
      assert.notEqual(String(path),marker,'marker '+operation);
      return original.call(this,path,...args);
    }));
  }
  const readdir=fs.readdirSync;let scans=0;
  mocks.push(t.mock.method(fs,'readdirSync',function(path,...args){
    const names=readdir.call(this,path,...args);
    if(path===dirname(f.path)&&names.includes(basename(marker))&&kind==='swapped symlink'){
      // Swap after enumeration, before the reader can consume the name.
      fs.unlinkSync(marker);fs.symlinkSync(++scans%2?companion:f.path,marker);
    }
    return names;
  }));
  syncBuiltinESMExports();t.after(()=>{for(const mock of mocks)mock.mock.restore();syncBuiltinESMExports();});
  for(let i=0;i<2;i++){
    if(i&&!encoded){fs.unlinkSync(marker);fs.symlinkSync(f.path,marker);}
    const core=openMemoryCore({path:f.path,raw:true,rawSearch:false});
    try {assert.equal(core.list({namespace}).ok,true);} finally {await core.close();}
    assert.deepEqual(retryNames(f.path),[basename(marker)]);
  }
  assert.equal(statements.filter(sql=>sql===indexDDL).length,encoded?0:1);assert.equal(statfs.mock.callCount(),encoded?0:1);
});

test('success unlinks only full-grammar names, tolerates reserved directories, and leaves unrelated names',async t=>{
  const f=await store(t,{l1:true});f.db.exec(indexDDL);attestContentSafety(f.db);
  const now=Date.now();
  const dir=retryPath(f.path,{notBefore:now,delayMs:21600000,reason:'io'});fs.mkdirSync(dir);
  const marker=putRetry(f.path,{notBefore:Date.now()+21600000,delayMs:21600000,reason:'busy'});
  const expired=putRetry(f.path,{notBefore:now-1,delayMs:43200000,reason:'space'});
  const inactive=putRetry(f.path,{notBefore:now+86400001,delayMs:0,reason:'error'});
  const unrelated=['malformed','backup','directory','9007199254740992.21600000.busy',now+'.21600000.busy\n']
    .map(suffix=>f.path+'.peer-index-retry.'+suffix);
  for(const path of unrelated)fs.writeFileSync(path,'unrelated content');
  const unlink=fs.unlinkSync,removed=[];
  const mock=t.mock.method(fs,'unlinkSync',function(path){removed.push(path);return unlink.call(this,path);});
  syncBuiltinESMExports();t.after(()=>{mock.mock.restore();syncBuiltinESMExports();});
  assert.deepEqual(installLocalRawPeerIndex(f.db,f.path),{status:'present',reason:null});
  assert.deepEqual(removed.sort(),[dir,marker,expired,inactive].sort());assert.equal(fs.lstatSync(dir).isDirectory(),true);
  assert.deepEqual(retryNames(f.path).sort(),[dir,...unrelated].map(path=>basename(path)).sort());
  fs.rmdirSync(dir);removed.length=0;
  assert.deepEqual(installLocalRawPeerIndex(f.db,f.path),{status:'present',reason:null});
  assert.deepEqual(removed,[]);
  assert.deepEqual(retryNames(f.path).sort(),unrelated.map(path=>basename(path)).sort());
});

for(const operation of ['readdirSync','writeFileSync','renameSync','unlinkSync'])
test(`marker ${operation} failure cannot fail an L1 open`,async t=>{
  const f=await store(t,{l1:true}),before=schema(f.db),bytes=readSqliteFixture(f.path);
  const statfs=space(t,f.path,0);
  putRetry(f.path,{notBefore:Date.now()-1,delayMs:21600000,reason:'busy'});
  const original=fs[operation];let reached=0;
  const mock=t.mock.method(fs,operation,function(path,...args){
    if(operation==='readdirSync'?path===dirname(f.path):String(path).includes('.peer-index-retry.')){
      reached++;throw Object.assign(Error('marker denied'),{code:'EPERM'});
    }
    return original.call(this,path,...args);
  });
  syncBuiltinESMExports();t.after(()=>{mock.mock.restore();syncBuiltinESMExports();});
  const core=openMemoryCore({path:f.path,raw:true,rawSearch:false});
  try {
    assert.equal(core.list({namespace}).ok,true);assert.equal(schema(f.db),before);
    assert.deepEqual(readSqliteFixture(f.path),bytes);assert.ok(reached>0);assert.equal(statfs.mock.callCount(),1);
  } finally {await core.close();}
});

test('competing failure publishers preserve both markers across identical read and cleanup snapshots',async t=>{
  const f=await store(t,{l1:true});space(t,f.path,0);
  const start=Date.now();let now=start;t.mock.method(Date,'now',()=>now);
  const expired=putRetry(f.path,{notBefore:start-1,delayMs:21600000,reason:'busy'});
  const initial=[basename(expired)],first={notBefore:start+43200000,delayMs:43200000,reason:'space'},
    second={notBefore:start+1+43200000,delayMs:43200000,reason:'space'};
  const reads=[],cleanups=[],removed=[],readdir=fs.readdirSync,rename=fs.renameSync,unlink=fs.unlinkSync;
  let nested=false,otherResult,cleanupSnapshot;
  const mocks=[
    t.mock.method(fs,'readdirSync',function(path,...args){
      if(path!==dirname(f.path))return readdir.call(this,path,...args);
      if(reads.length<2){reads.push([...initial]);return [...initial];}
      cleanupSnapshot??=readdir.call(this,path,...args);
      cleanups.push([...cleanupSnapshot]);return [...cleanupSnapshot];
    }),
    t.mock.method(fs,'renameSync',function(from,to){
      const result=rename.call(this,from,to);
      if(!nested){nested=true;now=start+1;otherResult=buildLocalRawPeerIndex(f.db,f.path);}
      return result;
    }),
    t.mock.method(fs,'unlinkSync',function(path){removed.push(path);return unlink.call(this,path);}),
  ];
  syncBuiltinESMExports();t.after(()=>{for(const mock of mocks)mock.mock.restore();syncBuiltinESMExports();});
  assert.deepEqual(buildLocalRawPeerIndex(f.db,f.path),{status:'skipped',reason:'space'});
  assert.deepEqual(otherResult,{status:'skipped',reason:'space'});
  assert.deepEqual(reads,[initial,initial]);assert.equal(cleanups.length,2);assert.deepEqual(cleanups[0],cleanups[1]);
  const published=[retryPath(f.path,first),retryPath(f.path,second)];
  for(const path of published){assert.ok(cleanups[0].includes(basename(path)));assert.ok(!removed.includes(path));}
  assert.deepEqual(removed,[expired,expired]); // Stale cleanup snapshots may retry only the expired leaf.
  for(const mock of mocks)mock.mock.restore();syncBuiltinESMExports();
  assert.deepEqual(retryNames(f.path).sort(),published.map(path=>basename(path)).sort());
  const status=readLocalRawPeerIndexStatus(f.db,f.path);
  assert.equal(status.deferredUntil,second.notBefore);assert.equal(status.deferredReason,'space');
  assert.deepEqual(installLocalRawPeerIndex(f.db,f.path),{status:'skipped',reason:'backoff'});
});

test('a failure publisher keeps unexpired and equal-deadline publications',async t=>{
  const f=await store(t,{l1:true});space(t,f.path,0);
  const now=Date.now();t.mock.method(Date,'now',()=>now);
  const markers=[
    {notBefore:now-1,delayMs:21600000,reason:'busy'},
    {notBefore:now,delayMs:21600000,reason:'interrupt'},
    {notBefore:now+43200000,delayMs:21600000,reason:'io'},
  ];
  for(const marker of markers)putRetry(f.path,marker);
  assert.deepEqual(buildLocalRawPeerIndex(f.db,f.path),{status:'skipped',reason:'space'});
  const own={notBefore:now+43200000,delayMs:43200000,reason:'space'};
  assert.deepEqual(retryNames(f.path).sort(),[...markers.slice(1),own].map(marker=>basename(retryPath(f.path,marker))).sort());
});

test('two competing L1 runtime openers commit exactly one CREATE; the loser ends present',{timeout:45000},async t=>{
  const f=await store(t,{l1:true}),barrier=new SharedArrayBuffer(8),words=new Int32Array(barrier);
  const workers=[],ready=[],done=[];
  for(let i=0;i<2;i++){
    const worker=new Worker(new URL('../testing/local-raw-peer-index-worker.mjs',import.meta.url),{workerData:{path:f.path,barrier}});
    workers.push(worker);
    ready.push(new Promise((resolve,reject)=>{
      worker.on('message',message=>{if(message==='ready')resolve();});worker.on('error',reject);
      worker.on('exit',code=>reject(Error('builder exited before barrier: '+code)));
    }));
    done.push(new Promise((resolve,reject)=>{
      let result;
      worker.on('message',message=>{if(message!=='ready')result=message;});worker.on('error',reject);
      worker.on('exit',code=>{if(code===0 && result)resolve(result);else reject(Error('builder exit '+code));});
    }));
  }
  const finished=Promise.all(done);finished.catch(()=>{});
  // Both workers must have committed the mandatory package install, attested
  // v1 and reached the side BEGIN before either builder can acquire RESERVED.
  try {
    await Promise.all(ready);assert.equal(Atomics.load(words,0),2);
    Atomics.store(words,1,1);Atomics.notify(words,1,2);
    const results=await finished;
    assert.deepEqual(results.map(r=>r.status).sort(),['built','present']);
    assert.equal(results.reduce((sum,r)=>sum+r.creates,0),1);
    assert.ok(results.every(r=>r.read && r.closed && r.version==='v2'));
    attestContentSafety(f.db);assert.equal(attestedLocalRawPackage(f.db),'v2');
  } finally {await Promise.all(workers.map(worker=>worker.terminate()));}
});

for(const timeout of [0,37,5000]) test(`side builder inherits the runtime effective busy timeout (${timeout})`,async t=>{
  const f=await store(t,{l1:true});space(t,f.path);
  const exec=DatabaseSync.prototype.exec;let runtime,side,observed;
  t.mock.method(DatabaseSync.prototype,'exec',function(sql){
    if(sql===LOCAL_RAW_PRIVACY_DDL.join('\n'))runtime=this;
    if(runtime && this!==runtime && sql==='BEGIN IMMEDIATE'){
      side=this;observed=this.prepare('PRAGMA busy_timeout').get().timeout;
    }
    return exec.call(this,sql);
  });
  const core=openMemoryCore({path:f.path,raw:true,rawSearch:false,busyTimeoutMs:timeout});
  try {
    assert.equal(observed,timeout);assert.notEqual(side,runtime);assert.equal(side.isOpen,false);
    assert.equal(runtime.prepare('PRAGMA busy_timeout').get().timeout,timeout);
    assert.equal(core.list({namespace}).ok,true);
  } finally {await core.close();}
});

test('side re-verification defers mismatched local objects without executing DDL',async t=>{
  const f=await store(t,{l1:true}),before=schema(f.db),bytes=readSqliteFixture(f.path);space(t,f.path);
  const build=interceptBuild(t),prepare=DatabaseSync.prototype.prepare;
  let altered=0;
  t.mock.method(DatabaseSync.prototype,'prepare',function(sql){
    const statement=prepare.call(this,sql);
    if(this!==build.side || !packageProbe(sql))return statement;
    return {all(){altered++;return statement.all().map(row=>row.name==='local_raw_uuid_pending'?{...row,sql:row.sql+' WHERE complete=0'}:row);}};
  });
  const core=openMemoryCore({path:f.path,raw:true,rawSearch:false});
  try {
    assert.equal(altered,1);assert.equal(build.closed,true);
    assert.ok(build.statements.includes('ROLLBACK'));assert.ok(!build.statements.includes(indexDDL));
    assert.equal(retry(f.path).reason,'error');assert.equal(schema(f.db),before);
    assert.deepEqual(readSqliteFixture(f.path),bytes);assert.equal(core.list({namespace}).ok,true);
  } finally {await core.close();}
});

test('attested v2 status has the documented shape and present clears an expired marker without SQL',async t=>{
  const f=await store(t,{l1:true});f.db.exec(indexDDL);attestContentSafety(f.db);
  const statfs=space(t,f.path),statements=trace(t);
  assert.deepEqual(readLocalRawPeerIndexStatus(f.db,f.path),{
    present:true,overThreshold:false,deferredReason:null,deferredUntil:null,
    offlineCommand:offlineCommand(f.path),offlineArgv:offlineArgv(f.path),
  });
  assert.equal(statements.length,2);assert.ok(packageProbe(statements[0]));assert.equal(statements[1],'SELECT max(rowid) AS n FROM raw_messages');
  putRetry(f.path,{notBefore:Date.now()-1,delayMs:21600000,reason:'busy'});
  statements.length=0;
  assert.deepEqual(installLocalRawPeerIndex(f.db,f.path),{status:'present',reason:null});
  assert.deepEqual(statements,[]);assert.equal(statfs.mock.callCount(),0);
  assert.deepEqual(retryNames(f.path),[]);
});

for(const existing of [false,true]) test(`side builder defers a valid replacement store without DDL (existingStore=${existing})`,async t=>{
  const a=await store(t,{l1:true}),b=await store(t,{l1:true});space(t,a.path);
  const beforeA=schema(a.db),beforeB=schema(b.db),bytesA=readSqliteFixture(a.path),bytesB=readSqliteFixture(b.path);
  const held=join(dirname(a.path),'admitted.sqlite'),exec=DatabaseSync.prototype.exec;
  let runtime,installed=false,replaced=false,creates=0;
  t.mock.method(DatabaseSync.prototype,'exec',function(sql){
    if(sql===LOCAL_RAW_PRIVACY_DDL.join('\n')){runtime=this;installed=true;}
    if(sql===indexDDL)creates++;
    const result=exec.call(this,sql);
    if(this===runtime&&installed&&sql==='COMMIT'&&!replaced){
      installed=false;replaced=true;fs.renameSync(a.path,held);fs.renameSync(b.path,a.path);
    }
    return result;
  });
  const core=openMemoryCore({path:a.path,raw:true,rawSearch:false,...(existing?{existingStore:a.pin}:{})});
  try {
    assert.equal(replaced,true);assert.equal(creates,0);assert.equal(retry(a.path).reason,'error');
    assert.equal(schema(a.db),beforeA);assert.equal(schema(b.db),beforeB);
    assert.deepEqual(readSqliteFixture(held),bytesA);assert.deepEqual(readSqliteFixture(a.path),bytesB);
    assert.equal(core.list({namespace}).ok,true);
  } finally {await core.close();}
});

// Keep the copy independently attestable: a lineage-zero control must have
// the matching safety declarations, rather than failing full attestation first.
function changeCopiedControl(db, field) {
  const row=db.prepare('SELECT * FROM content_safety_control WHERE singleton=1').get();
  if(field==='card_lineage_revision') {
    const baseTriggers=new Set([...contentSafetyDDL(row.base_layout,false,true).matchAll(/CREATE TRIGGER (\w+)/g)].map(match=>match[1]));
    const objects=db.prepare(`SELECT type,name FROM sqlite_schema WHERE name GLOB 'card_body_*'
      OR name='card_operations_owner_action' OR name GLOB 'safety_*'
      ORDER BY CASE type WHEN 'trigger' THEN 0 WHEN 'index' THEN 1 ELSE 2 END`).all();
    db.exec('PRAGMA foreign_keys=OFF');
    for(const object of objects)if(!baseTriggers.has(object.name))db.exec(`DROP ${object.type} "${object.name}"`);
    db.exec('DROP TRIGGER card_memory_revision_invalidation');installCardMemoryInvalidation(db,true);
  }
  const guard=db.prepare("SELECT sql FROM sqlite_schema WHERE name='safety_control_update'").get().sql;
  db.exec('DROP TRIGGER safety_control_update');
  const value=field==='card_lineage_revision'?0:field==='migration_id'
    ? (row[field][0]==='0'?'1':'0')+row[field].slice(1)
    : (row[field][0]==='a'?'b':'a')+row[field].slice(1);
  db.prepare(`UPDATE content_safety_control SET ${field}=? WHERE singleton=1`).run(value);
  db.exec(guard);
}

for(const existing of [false,true])for(const field of [null,'card_lineage_revision','migration_id','inventory_digest'])
test(`side compares a copied store's attested control by value (${field??'equal tuple'}, existingStore=${existing})`,async t=>{
  const f=await store(t,{l1:true});space(t,f.path);
  const admittedFile=fs.lstatSync(f.path),held=join(dirname(f.path),'admitted.sqlite'),copyPath=join(dirname(f.path),'control-copy.sqlite');
  const before=schema(f.db),bytes=readSqliteFixture(f.path),control=attestedContentSafetyControl(f.db);
  copySqliteFixture(f.path,copyPath);
  const copy=new DatabaseSync(copyPath);let copySchema,copyBytes,copyControl;
  try {
    if(field)changeCopiedControl(copy,field);
    const layout=attestContentSafety(copy);
    assert.equal(layout.physical,f.pin.physical);
    assert.equal(copy.prepare('SELECT store_id FROM store_metadata WHERE singleton=1').get().store_id,f.pin.storeId);
    assert.deepEqual(localNames(copy),packageNames('v1'));
    copyControl=attestedContentSafetyControl(copy);copySchema=schema(copy);
    assert.deepEqual(copyControl.flatMap((value,i)=>value===control[i]?[]:[i]),
      field?[['singleton','base_layout','suppression_revision','card_lineage_revision','migration_state',
        'suppression_domain','migration_id','inventory_digest','receipt_event_time'].indexOf(field)]:[]);
  } finally {copy.close();}
  copyBytes=readSqliteFixture(copyPath);
  const exec=DatabaseSync.prototype.exec,lstat=fs.lstatSync;
  let runtime,side,installed=false,replaced=false,creates=0,rollbacks=0,identityChecks=0;
  t.mock.method(DatabaseSync.prototype,'exec',function(sql){
    if(sql===LOCAL_RAW_PRIVACY_DDL.join('\n')){runtime=this;installed=true;}
    if(runtime&&this!==runtime&&sql==='BEGIN IMMEDIATE')side=this;
    if(this===side&&sql===indexDDL)creates++;
    if(this===side&&sql==='ROLLBACK'){assert.equal(this.isTransaction,true);rollbacks++;}
    const result=exec.call(this,sql);
    if(this===runtime&&installed&&sql==='COMMIT'&&!replaced){
      installed=false;replaced=true;fs.renameSync(f.path,held);fs.renameSync(copyPath,f.path);
    }
    return result;
  });
  // Isolate the control fence while presenting the copy at the same canonical
  // path and admitted file identity used by the replacement-store tests above.
  const mock=t.mock.method(fs,'lstatSync',function(path,...args){
    if(replaced&&path===f.path){identityChecks++;return admittedFile;}
    return lstat.call(this,path,...args);
  });
  syncBuiltinESMExports();t.after(()=>{mock.mock.restore();syncBuiltinESMExports();});
  const core=openMemoryCore({path:f.path,raw:true,rawSearch:false,...(existing?{existingStore:f.pin}:{})});
  try {
    assert.equal(replaced,true);assert.ok(identityChecks>=2);assert.ok(side);assert.equal(side.isOpen,false);
    // This also proves full side attestation succeeded before the comparison.
    assert.deepEqual(attestedContentSafetyControl(side),copyControl);
    assert.deepEqual(attestedContentSafetyControl(runtime),control);
    assert.equal(rollbacks,field?1:0);assert.equal(creates,field?0:1);
    assert.equal(schema(f.db),before);assert.deepEqual(readSqliteFixture(held),bytes);
    assert.equal(attestedLocalRawPackage(runtime),'v1');assert.equal(core.list({namespace}).ok,true);
    const reopened=new DatabaseSync(f.path,{readOnly:true});
    try {
      assert.deepEqual(localNames(reopened),packageNames(field?'v1':'v2'));
      if(field){assert.equal(schema(reopened),copySchema);assert.deepEqual(readSqliteFixture(f.path),copyBytes);}
    } finally {reopened.close();}
    if(field)assert.equal(retry(f.path).reason,'error');
    else assert.deepEqual(retryNames(f.path),[]);
  } finally {await core.close();}
});

for(const existing of [false,true]) test(`leaf removed after the side precheck is never recreated (existingStore=${existing})`,async t=>{
  const f=await store(t,{l1:true}),before=schema(f.db);space(t,f.path);
  const exec=DatabaseSync.prototype.exec,lstat=fs.lstatSync;let runtime,installed=false,armed=false,removed=false,creates=0;
  t.mock.method(DatabaseSync.prototype,'exec',function(sql){
    if(sql===LOCAL_RAW_PRIVACY_DDL.join('\n')){runtime=this;installed=true;}
    if(sql===indexDDL)creates++;
    const result=exec.call(this,sql);
    if(this===runtime&&installed&&sql==='COMMIT'){installed=false;armed=true;}
    return result;
  });
  const mock=t.mock.method(fs,'lstatSync',function(path,...args){
    const result=lstat.call(this,path,...args);
    if(armed&&path===f.path){armed=false;removed=true;fs.unlinkSync(f.path);}
    return result;
  });
  syncBuiltinESMExports();t.after(()=>{mock.mock.restore();syncBuiltinESMExports();});
  const core=openMemoryCore({path:f.path,raw:true,rawSearch:false,...(existing?{existingStore:f.pin}:{})});
  try {
    assert.equal(removed,true);assert.equal(fs.existsSync(f.path),false);assert.equal(creates,0);
    assert.equal(schema(f.db),before);assert.equal(retry(f.path).reason,'error');
    assert.equal(core.list({namespace}).ok,true);
  } finally {await core.close();}
});

for(const drift of ['inherited index','store_id'])
test(`side transaction refuses ${drift} drift before any DDL and leaves runtime unpoisoned`,async t=>{
  const f=await store(t,{l1:true});space(t,f.path);
  const exec=DatabaseSync.prototype.exec;
  let runtime,installed=false,changed=false,side,creates=0,rollbacks=0,drifted;
  t.mock.method(DatabaseSync.prototype,'exec',function(sql){
    if(sql===LOCAL_RAW_PRIVACY_DDL.join('\n')){runtime=this;installed=true;}
    if(runtime&&this!==runtime&&sql==='BEGIN IMMEDIATE')side=this;
    if(this===side&&sql===indexDDL)creates++;
    if(this===side&&sql==='ROLLBACK')rollbacks++;
    const result=exec.call(this,sql);
    if(this===runtime&&installed&&sql==='COMMIT'&&!changed){
      installed=false;changed=true;
      if(drift==='inherited index')f.db.exec('CREATE INDEX unadmitted_raw_index ON raw_messages(role)');
      else f.db.prepare("UPDATE store_metadata SET store_id=? WHERE singleton=1").run('different-admitted-store');
      drifted=schema(f.db);
    }
    return result;
  });
  const core=openMemoryCore({path:f.path,raw:true,rawSearch:false});
  try {
    assert.equal(changed,true);assert.ok(side);assert.equal(side.isOpen,false);
    assert.equal(rollbacks,1);assert.equal(creates,0);assert.equal(retry(f.path).reason,'error');
    assert.equal(schema(f.db),drifted);
    // This accessor throws if optional side admission poisoned the runtime.
    assert.equal(attestedLocalRawPackage(runtime),'v1');
    if(drift==='inherited index')f.db.exec('DROP INDEX unadmitted_raw_index');
    else f.db.prepare('UPDATE store_metadata SET store_id=? WHERE singleton=1').run(f.pin.storeId);
    assert.equal(core.list({namespace}).ok,true);
  } finally {await core.close();}
});

for(const existing of [false,true]) test(`post-BEGIN inode check refuses a replacement before DDL (existingStore=${existing})`,async t=>{
  const a=await store(t,{l1:true}),b=await store(t,{l1:true});space(t,a.path);
  const beforeA=schema(a.db),beforeB=schema(b.db),exec=DatabaseSync.prototype.exec;
  let runtime,side,replaced=false,creates=0,rolledBack=false;
  t.mock.method(DatabaseSync.prototype,'exec',function(sql){
    if(sql===LOCAL_RAW_PRIVACY_DDL.join('\n'))runtime=this;
    if(runtime&&this!==runtime&&sql==='BEGIN IMMEDIATE')side=this;
    if(this===side&&sql===indexDDL)creates++;
    if(this===side&&sql==='ROLLBACK')rolledBack=true;
    const result=exec.call(this,sql);
    if(this===side&&sql==='BEGIN IMMEDIATE'&&!replaced){
      replaced=true;fs.renameSync(a.path,join(dirname(a.path),'admitted.sqlite'));fs.renameSync(b.path,a.path);
    }
    return result;
  });
  const core=openMemoryCore({path:a.path,raw:true,rawSearch:false,...(existing?{existingStore:a.pin}:{})});
  try {
    assert.equal(replaced,true);assert.equal(rolledBack,true);assert.equal(creates,0);assert.equal(side.isOpen,false);
    assert.equal(retry(a.path).reason,'error');assert.equal(schema(a.db),beforeA);assert.equal(schema(b.db),beforeB);
    assert.equal(core.list({namespace}).ok,true);
  } finally {await core.close();}
});

test('side connection uses both runtime safety pragmas before full admission',async t=>{
  const f=await store(t,{l1:true});space(t,f.path);
  const exec=DatabaseSync.prototype.exec;let runtime,settings;
  t.mock.method(DatabaseSync.prototype,'exec',function(sql){
    if(sql===LOCAL_RAW_PRIVACY_DDL.join('\n'))runtime=this;
    if(runtime&&this!==runtime&&sql==='BEGIN IMMEDIATE'){
      settings={trusted:this.prepare('PRAGMA trusted_schema').get().trusted_schema,
        foreignKeys:this.prepare('PRAGMA foreign_keys').get().foreign_keys};
    }
    return exec.call(this,sql);
  });
  const core=openMemoryCore({path:f.path,raw:true,rawSearch:false});
  try {assert.deepEqual(settings,{trusted:0,foreignKeys:1});} finally {await core.close();}
});

test('current-schema status handles a stale v2 cache, leftover marker and shell metacharacters',async t=>{
  const workspace=createTestWorkspace(t),path=join(workspace.path,"a space 'quote';$(name).sqlite");
  space(t,path);
  const exec=DatabaseSync.prototype.exec;let runtime;
  t.mock.method(DatabaseSync.prototype,'exec',function(sql){
    if(sql===LOCAL_RAW_PRIVACY_DDL.join('\n'))runtime=this;
    return exec.call(this,sql);
  });
  const core=openMemoryCore({path,raw:true,rawSearch:false});
  try {
    assert.equal(readLocalRawPeerIndexStatus(runtime,path).present,true);
    attestContentSafety(runtime);
    putRetry(path,{notBefore:Date.now()+21600000,delayMs:21600000,reason:'busy'});
    const expected={present:true,overThreshold:false,deferredReason:null,deferredUntil:null,
      offlineCommand:offlineCommand(path),offlineArgv:offlineArgv(path)};
    assert.deepEqual(readLocalRawPeerIndexStatus(runtime,path),expected);
    assert.equal(retryNames(path).length,1); // Read-only status does not clear it.
    const other=new DatabaseSync(path);
    try {other.exec('DROP INDEX local_raw_message_peers');} finally {other.close();}
    assert.equal(readLocalRawPeerIndexStatus(runtime,path).present,false);
    assert.equal(readLocalRawPeerIndexStatus(runtime,path).deferredReason,'busy');
  } finally {await core.close();}
});

for(const route of ['ordinary','existing','fence'])
test(`side admission retains canonical file and runtime store identity (${route})`,async t=>{
  const f=await store(t,{l1:true}),stat=fs.lstatSync(f.path);space(t,f.path);
  const options=route==='existing'?{existingStore:f.pin}:route==='fence'?{storeFence:{
    version:'store-fence-v1',dev:String(stat.dev),ino:String(stat.ino),applicationId:0x43414952,
    userVersion:f.pin.physical,storeId:f.pin.storeId,
  }}:{};
  const exec=DatabaseSync.prototype.exec;let runtime;
  t.mock.method(DatabaseSync.prototype,'exec',function(sql){
    if(sql===LOCAL_RAW_PRIVACY_DDL.join('\n'))runtime=this;
    return exec.call(this,sql);
  });
  const core=openMemoryCore({path:f.path,raw:true,rawSearch:false,...options});
  try {
    const admission=localRawPeerIndexAdmission(runtime);
    assert.equal(admission.path,fs.realpathSync(f.path));
    assert.deepEqual(admission.identity,{dev:String(stat.dev),ino:String(stat.ino)});
    assert.equal(admission.storeId,f.pin.storeId);assert.match(admission.uri,/mode=rw$/);
    assert.equal(readLocalRawPeerIndexStatus(runtime,f.path).present,true);
    assert.equal(core.list({namespace}).ok,true);
  } finally {await core.close();}
});

test('offline existing-store admission uses the complete ordinary validator inside its side transaction',async t=>{
  const f=await store(t),before=schema(f.db);space(t,f.path);
  const runtime=openDatabase(f.path,{existingStore:f.pin});
  // This table is part of the opener validation, outside the local package.
  f.db.exec('DROP TRIGGER card_raw_purge');
  const drifted=schema(f.db),statements=trace(t);
  try {
    assert.deepEqual(installLocalRawPeerIndex(runtime,f.path,localRawPeerIndexAdmission(runtime)),{status:'deferred',reason:'error'});
    assert.ok(statements.includes('BEGIN IMMEDIATE'));assert.ok(statements.includes('ROLLBACK'));
    assert.ok(!statements.includes(indexDDL));assert.equal(schema(f.db),drifted);assert.notEqual(drifted,before);
  } finally {runtime.close();}
});

for(const build of [installLocalRawPeerIndex,buildLocalRawPeerIndex])
test(`${build.name} defers without an explicitly supplied admission`,async t=>{
  const f=await store(t);space(t,f.path);
  const runtime=openDatabase(f.path,{existingStore:f.pin});
  try {
    assert.ok(localRawPeerIndexAdmission(runtime));
    const before=schema(f.db),statements=trace(t);
    assert.deepEqual(build(runtime,f.path),{status:'deferred',reason:'error'});
    assert.ok(!statements.some(sql=>/BEGIN|PRAGMA|CREATE/.test(sql)));
    assert.equal(schema(f.db),before);assert.equal(retry(f.path).reason,'error');
  } finally {runtime.close();}
});

test('status is current immediately after a direct side build while runtime attestation remains v1',async t=>{
  const f=await store(t,{l1:true});space(t,f.path);
  const runtime=openDatabase(f.path,{existingStore:f.pin});
  try {
    assert.equal(attestedLocalRawPackage(runtime),'v1');
    assert.deepEqual(installLocalRawPeerIndex(runtime,f.path,localRawPeerIndexAdmission(runtime)),{status:'built',reason:null});
    assert.equal(attestedLocalRawPackage(runtime),'v1');
    assert.equal(readLocalRawPeerIndexStatus(runtime,f.path).present,true);
    assert.equal(attestedLocalRawPackage(runtime),'v1'); // Status probes current rows without reattesting.
  } finally {runtime.close();}
});

test('fenced side admission retains the checked fence store_id if metadata changes before handoff',async t=>{
  const f=await store(t,{l1:true}),stat=fs.lstatSync(f.path);space(t,f.path);
  const prepare=DatabaseSync.prototype.prepare,exec=DatabaseSync.prototype.exec;
  let changed=false,creates=0;
  t.mock.method(DatabaseSync.prototype,'prepare',function(sql){
    const statement=prepare.call(this,sql);
    if(!sql.startsWith('SELECT store_id,(SELECT user_version'))return statement;
    return {get(){
      changed=true;f.db.prepare('UPDATE store_metadata SET store_id=? WHERE singleton=1').run('changed-after-fence');
      return statement.get();
    }};
  });
  t.mock.method(DatabaseSync.prototype,'exec',function(sql){if(sql===indexDDL)creates++;return exec.call(this,sql);});
  const core=openMemoryCore({path:f.path,raw:true,rawSearch:false,storeFence:{
    version:'store-fence-v1',dev:String(stat.dev),ino:String(stat.ino),applicationId:0x43414952,
    userVersion:f.pin.physical,storeId:f.pin.storeId,
  }});
  try {
    assert.equal(changed,true);assert.equal(creates,0);assert.equal(retry(f.path).reason,'error');
  } finally {await core.close();}
});

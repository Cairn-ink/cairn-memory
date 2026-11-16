import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { syncBuiltinESMExports } from 'node:module';
import { dirname, join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { Worker } from 'node:worker_threads';
import { DatabaseSync } from 'node:sqlite';
import { createTestWorkspace } from '../../tools/testing/workspace.mjs';
import { openMemoryCore } from '../index.mjs';
import { attestContentSafety, attestedLocalRawPackage, LOCAL_RAW_PACKAGES, LOCAL_RAW_PRIVACY_DDL, LOCAL_RAW_PEER_INDEX_DDL } from '../content-safety-schema.mjs';
import { installLocalRawPeerIndex, readLocalRawPeerIndexStatus } from '../local-authority-schema.mjs';
import { inspectExistingStorePin } from '../existing-store.mjs';
import { readSqliteFixture } from '../testing/content-safety-s2h-fixture.mjs';
import { safetyFixture } from '../testing/content-safety-s2h-fixture.mjs';
import { createCommitDispatcher } from '../commit-dispatch.mjs';

const namespace = { ownerId: 'synthetic-owner', scope: 'personal', projectId: null };
const retryPath = path => path + '.peer-index-retry';
const retry = path => JSON.parse(fs.readFileSync(retryPath(path), 'utf8'));
const packageProbe = sql => sql.startsWith('SELECT name,type,sql FROM sqlite_schema WHERE sql IS NOT NULL AND (name GLOB');
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
    assert.deepEqual(installLocalRawPeerIndex(db,path),{status:'present',reason:null});assert.deepEqual(statements,[]);
    assert.equal(statfs.mock.callCount(),0);
    const core=openMemoryCore({path,raw:true,rawSearch:false});await core.close();
    assert.ok(!statements.some(sql=>sql===indexDDL || sql==='SELECT max(rowid) AS n FROM raw_messages' || packageProbe(sql)));
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

test('status is read-only and returns the documented present / threshold / deferral shape',async t=>{
  const f=await store(t);seed(f.db,2_000_001);attestContentSafety(f.db);
  const statfs=space(t,f.path,0),statements=trace(t);
  const expected={present:false,overThreshold:true,deferredReason:null,deferredUntil:null,
    offlineCommand:'cairn-memory raw index --db '+f.path};
  assert.deepEqual(readLocalRawPeerIndexStatus(f.db,f.path),expected);
  assert.equal(statements.length,2);assert.ok(statements.every(sql=>sql.startsWith('SELECT')));
  assert.equal(statfs.mock.callCount(),0);
  const notBefore=Date.now()+6*60*60*1000;
  fs.writeFileSync(retryPath(f.path),JSON.stringify({notBefore,delayMs:6*60*60*1000,reason:'busy'}));
  statements.length=0;
  assert.deepEqual(readLocalRawPeerIndexStatus(f.db,f.path),{...expected,deferredReason:'busy',deferredUntil:notBefore});
  assert.equal(statements.length,2);assert.equal(retry(f.path).notBefore,notBefore);
  f.db.exec(indexDDL);statements.length=0;
  assert.deepEqual(readLocalRawPeerIndexStatus(f.db,f.path),{...expected,present:true,deferredReason:'busy',deferredUntil:notBefore});
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
  assert.equal(fs.existsSync(retryPath(f.path)),false);
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

test('successful L1 side build leaves the same runtime readable and cookie-attested v2',async t=>{
  const f=await store(t,{l1:true});space(t,f.path);
  const build=interceptBuild(t);
  const core=openMemoryCore({path:f.path,raw:true,rawSearch:false});
  try {
    assert.notEqual(build.side,build.runtime);assert.equal(build.closed,true);
    assert.equal(build.statements.filter(sql=>sql===indexDDL).length,1);
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
    now=marker.notBefore+1;
  }
  assert.equal(attempts,4);inject=false;
  const core=openMemoryCore({path:f.path,raw:true,rawSearch:false});
  try {assert.equal(core.list({namespace}).ok,true);} finally {await core.close();}
  assert.equal(attempts,5);assert.equal(fs.existsSync(retryPath(f.path)),false);
  attestContentSafety(f.db);assert.equal(attestedLocalRawPackage(f.db),'v2');
});

for(const contents of ['{broken','null','{}','{"notBefore":"later","delayMs":21600000,"reason":"busy"}'])
test(`malformed retry marker is ignored (${contents})`,async t=>{
  const f=await store(t,{l1:true});space(t,f.path);fs.writeFileSync(retryPath(f.path),contents);
  const core=openMemoryCore({path:f.path,raw:true,rawSearch:false});
  try {assert.equal(core.list({namespace}).ok,true);} finally {await core.close();}
  assert.equal(fs.existsSync(retryPath(f.path)),false);
  attestContentSafety(f.db);assert.equal(attestedLocalRawPackage(f.db),'v2');
});

for(const operation of ['readFileSync','writeFileSync','renameSync','rmSync'])
test(`marker ${operation} failure cannot fail an L1 open`,async t=>{
  const f=await store(t,{l1:true}),before=schema(f.db),bytes=readSqliteFixture(f.path);
  const statfs=space(t,f.path,operation==='readFileSync'?1e12:0);
  if(operation==='readFileSync')fs.writeFileSync(retryPath(f.path),'{}');
  const original=fs[operation];let reached=0;
  const mock=t.mock.method(fs,operation,function(path,...args){
    if(String(path).startsWith(retryPath(f.path))){reached++;throw Object.assign(Error('marker denied'),{code:'EPERM'});}
    return original.call(this,path,...args);
  });
  syncBuiltinESMExports();
  t.after(()=>{mock.mock.restore();syncBuiltinESMExports();});
  const core=openMemoryCore({path:f.path,raw:true,rawSearch:false});
  try {
    assert.equal(core.list({namespace}).ok,true);
    if(operation!=='readFileSync'){
      assert.equal(schema(f.db),before);assert.deepEqual(readSqliteFixture(f.path),bytes);
    }
    assert.ok(reached>0);assert.equal(statfs.mock.callCount(),1);
  } finally {await core.close();}
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
    offlineCommand:'cairn-memory raw index --db '+f.path,
  });
  assert.deepEqual(statements,['SELECT max(rowid) AS n FROM raw_messages']);
  fs.writeFileSync(retryPath(f.path),JSON.stringify({notBefore:Date.now()-1,delayMs:21600000,reason:'busy'}));
  statements.length=0;
  assert.deepEqual(installLocalRawPeerIndex(f.db,f.path),{status:'present',reason:null});
  assert.deepEqual(statements,[]);assert.equal(statfs.mock.callCount(),0);
  assert.equal(fs.existsSync(retryPath(f.path)),false);
});

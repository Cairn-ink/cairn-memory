import { DatabaseSync } from 'node:sqlite';
import { openReadDatabase } from '../read-database.mjs';
import fs from 'node:fs';
import { syncBuiltinESMExports } from 'node:module';
import test from 'node:test';
import assert from 'node:assert/strict';
import { safetyFixture, ns, ok, receipt } from '../testing/content-safety-s2h-fixture.mjs';
import { openMemoryCore } from '../index.mjs';
import { transaction } from '../database.mjs';
import { attestContentSafety, installedContentLayout, checkInstalledContentSafety, bindContentSafetyConnection } from '../content-safety-schema.mjs';

// Carried from the integrated R4/R5 review regressions. These are capability
// attestation tests; they do not install any fact-based read enforcement.
test('S2h attestation: restoring guards never revives the native connection through fresh adapters', async t => {
  const f = safetyFixture(t); await f.migrate(); const db = f.connect(), core = openMemoryCore({path:f.path});
  t.after(() => { core.close(); db.close(); });
  const memory = ok(core.admit({namespace:ns,memory:{content:'Synthetic attestation content',kind:'fact'},receipts:[receipt('attestation')]})).memory;
  const guard = db.prepare("SELECT sql FROM sqlite_schema WHERE name='safety_memories_insert'").get().sql;
  attestContentSafety(db); db.exec('DROP TRIGGER safety_memories_insert');
  assert.throws(() => installedContentLayout(db),{code:'unsupported_database'});
  assert.equal(core.get({namespace:ns,memoryId:memory.id}).error.code,'unsupported_database');
  db.exec(guard);
  for (let i=0;i<2;i++) {
    const adapter = bindContentSafetyConnection({prepare:sql=>db.prepare(sql)},db);
    assert.throws(() => attestContentSafety(adapter),{code:'unsupported_database'});
    assert.throws(() => installedContentLayout(adapter),{code:'unsupported_database'});
    assert.throws(() => checkInstalledContentSafety(adapter),{code:'unsupported_database'});
  }
  assert.equal(core.get({namespace:ns,memoryId:memory.id}).error.code,'unsupported_database');
  const before = db.prepare('SELECT count(*) n FROM memories').get().n;
  assert.equal(core.admit({namespace:ns,memory:{content:'Synthetic refused write',kind:'fact'},receipts:[receipt('refused')]}).error.code,'unsupported_database');
  assert.equal(db.prepare('SELECT count(*) n FROM memories').get().n,before);
  const fresh = f.connect(); try { assert.equal(attestContentSafety(fresh).physical,34); } finally { fresh.close(); }
});

test('S2h attestation: metadata failure before association propagates permanently to the native handle', async t => {
  const f=safetyFixture(t); await f.migrate(); const db=f.connect(); t.after(()=>db.close()); let failHeader=true;
  const adapter={prepare(sql){if(failHeader&&sql==='PRAGMA user_version'){failHeader=false;throw Error('synthetic_header_failure');}return db.prepare(sql);}};
  assert.throws(()=>attestContentSafety(adapter),{code:'unsupported_database'});
  bindContentSafetyConnection(adapter,db);
  assert.throws(()=>attestContentSafety(db),{code:'unsupported_database'});
  assert.throws(()=>transaction(db,()=>assert.fail('refused native writer reached work')),{code:'unsupported_database'});
});

test('S2h attestation: deterministic DDL interleaving cannot bind old guards to a new cookie', async t => {
  const f=safetyFixture(t); await f.migrate(); const db=f.connect(),other=f.connect(); t.after(()=>{other.close();db.close();}); let fired=false;
  const adapter=bindContentSafetyConnection({prepare(sql){
    const statement=db.prepare(sql);
    if(!sql.includes("name GLOB 'content_safety_*'"))return statement;
    return new Proxy(statement,{get(target,key){
      if(key==='iterate')return function*(...args){yield* target.iterate(...args);other.exec('DROP TRIGGER safety_memories_insert');fired=true;};
      const value=Reflect.get(target,key,target);return typeof value==='function'?value.bind(target):value;
    }});
  }},db);
  assert.throws(()=>attestContentSafety(adapter,34),{code:'unsupported_database'}); assert.equal(fired,true);
  assert.throws(()=>installedContentLayout(db),{code:'unsupported_database'});
});

test('S2h fixture isolation: backups and byte reads stay in SQLite-free children',async t=>{
  const first=safetyFixture(t),db=first.connect();t.after(()=>db.close());
  const copy=fs.copyFileSync,read=fs.readFileSync;let attempted=0;
  fs.copyFileSync=()=>{attempted++;throw Error('parent_sqlite_file_access');};
  fs.readFileSync=(path,...args)=>{if(String(path).endsWith('.sqlite')){attempted++;throw Error('parent_sqlite_file_access');}return read(path,...args);};
  syncBuiltinESMExports();
  try{const second=safetyFixture(t);await second.migrate();assert.equal(attempted,0);}
  finally{fs.copyFileSync=copy;fs.readFileSync=read;syncBuiltinESMExports();}
});

for(const migrated of [false,true])test(`S2h attestation: final ordinary-open fence refuses interleaved canonical DDL (${migrated?'safety':'legacy'})`,async t=>{
  const f=safetyFixture(t);if(migrated)await f.migrate();const other=f.connect();t.after(()=>other.close());
  const prepare=DatabaseSync.prototype.prepare;let fired=false;
  DatabaseSync.prototype.prepare=function(sql){
    const statement=prepare.call(this,sql);
    if(sql!=="SELECT name,type,pk FROM pragma_table_info('store_metadata') WHERE pk!=0")return statement;
    return new Proxy(statement,{get(target,key){
      if(key==='all')return(...args)=>{const rows=target.all(...args);other.exec('DROP INDEX index_memory_keyset');fired=true;return rows;};
      const value=Reflect.get(target,key,target);return typeof value==='function'?value.bind(target):value;
    }});
  };
  try{assert.throws(()=>openReadDatabase(f.path),{code:'unsupported_database'});assert.equal(fired,true);}
  finally{DatabaseSync.prototype.prepare=prepare;}
});

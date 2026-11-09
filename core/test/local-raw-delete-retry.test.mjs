import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { openMemoryCore } from '../index.mjs';
import { sourceFixture,savedSource,ns,ok } from '../testing/raw-source-fixtures.mjs';
import { safetySourceFixture } from '../testing/raw-search-fixtures.mjs';

for(const mode of ['off','local']) test(`${mode} deletion exposes bounded UUID progress as retryable and preserves source until durable`,async t=>{
  const f=sourceFixture(t),local=openMemoryCore({path:f.path,raw:true,rawSearch:false});f.workspace.defer(()=>local.close());
  const source=await savedSource(f,'Synthetic pending delete source',{client:'claude-code'});
  const row=f.db.prepare('SELECT * FROM raw_messages').get(),keys=Object.keys(row);
  const insert=f.db.prepare('INSERT INTO raw_messages('+keys.join(',')+') VALUES('+keys.map(()=>'?').join(',')+')');
  f.db.exec('BEGIN');
  for(let n=2;n<=300;n++)insert.run(...keys.map(key=>key==='message_id'?'copy-'+n:key==='ordinal'?n:row[key]));
  f.db.exec('COMMIT');
  const core=mode==='local'?local:openMemoryCore({path:f.path,rawSearch:false,rawConversations:{mode:'off',configureCap:false,
    readPolicy(){throw Error('no capture');}}});if(core!==local)f.workspace.defer(()=>core.close());
  const input={namespace:ns,conversationId:source.conversationId,expectedRevision:source.expectedConversationRevision,actionId:'delete-large'};
  for(const hashes of [128,256]){
    assert.deepEqual(core.deleteConversation(input),{ok:false,error:{code:'local_raw_privacy_write_failed',retryable:true}});
    assert.equal(f.db.prepare('SELECT count(*) n FROM raw_messages').get().n,300);
    assert.equal(f.db.prepare('SELECT count(*) n FROM local_raw_uuid_fences').get().n,hashes);
  }
  const result=ok(core.deleteConversation(input));assert.deepEqual(ok(core.deleteConversation(input)),result);
  assert.equal(f.db.prepare('SELECT count(*) n FROM raw_messages').get().n,0);
  assert.equal(f.db.prepare('SELECT count(*) n FROM local_raw_uuid_fences').get().n,300);
  assert.equal(core.listRawConversations({namespace:ns,client:'claude-code'}).ok,true,'connection remains usable');
});

for(const safety of [false,true])test(`native uuid guard caps at two attempts without a safety refusal (safety=${safety})`,async t=>{
  const f=safety?safetySourceFixture(t):sourceFixture(t),local=openMemoryCore({path:f.path,raw:true,rawSearch:false});f.workspace.defer(()=>local.close());
  const source=await savedSource(f,'Synthetic capped source',{client:'claude-code'});
  // Capture the native error shape from SQLite itself, without damaging the
  // attested package. Inject only at the exact destructive statement boundary.
  const probe=new DatabaseSync(':memory:');
  probe.exec("CREATE TABLE t(x); INSERT INTO t VALUES(1); CREATE TRIGGER guard BEFORE DELETE ON t BEGIN SELECT RAISE(ABORT,'local_raw_uuid_pending'); END");
  let native;try{probe.exec('DELETE FROM t');}catch(error){native=error;}finally{probe.close();}
  assert.equal(native.code,'ERR_SQLITE_ERROR');assert.equal(native.errcode,1811);assert.equal(native.message,'local_raw_uuid_pending');
  const original=DatabaseSync.prototype.prepare;let attempts=0;
  DatabaseSync.prototype.prepare=function(sql,...args){
    const statement=original.call(this,sql,...args);
    if(sql==='DELETE FROM raw_messages WHERE conversation_id=?')return {run(){attempts++;throw native;}};
    return statement;
  };
  let result;
  try {result=f.core.deleteConversation({namespace:ns,conversationId:source.conversationId,
    expectedRevision:source.expectedConversationRevision,actionId:'bounded-guard'});}
  finally{DatabaseSync.prototype.prepare=original;}
  assert.equal(attempts,2);assert.deepEqual(result,{ok:false,error:{code:'local_raw_privacy_write_failed',retryable:true}});
  assert.equal(f.db.prepare('SELECT count(*) n FROM raw_messages').get().n,1);
  assert.equal(f.db.prepare('SELECT count(*) n FROM local_raw_uuid_fences').get().n,1);
  assert.equal(f.core.listRawConversations({namespace:ns,client:'claude-code'}).ok,true);
  ok(f.core.deleteConversation({namespace:ns,conversationId:source.conversationId,
    expectedRevision:source.expectedConversationRevision,actionId:'after-cap'}));
});

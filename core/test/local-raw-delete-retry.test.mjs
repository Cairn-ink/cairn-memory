import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { openMemoryCore } from '../index.mjs';
import { sourceFixture,savedSource,ns,ok } from '../testing/raw-source-fixtures.mjs';
import { safetySourceFixture,searchFixture } from '../testing/raw-search-fixtures.mjs';
import { createLocalUuidFence,UUID_HASH_CHUNK } from '../local-authority-uuid.mjs';
import { createRawDeletionStorage } from '../raw-deletion-storage.mjs';
import { createRawSourceRoots } from '../raw-source-roots.mjs';
import { request,splitRaw,denied } from '../testing/raw-source-fixtures.mjs';

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

const internal = { ...ns, projectId: ns.projectId ?? '' };
const snapshot = db => db.prepare("SELECT name FROM sqlite_schema WHERE type='table' ORDER BY name").all()
  .map(({name}) => [name,db.prepare('SELECT * FROM "'+name+'"').all()]);
const deleteKey = source => ({ namespace:ns,conversationId:source.conversationId,
  expectedRevision:source.expectedConversationRevision,actionId:'synthetic-delete' });
function local(t,f) {
  const core=openMemoryCore({path:f.path,raw:true,rawSearch:false});f.workspace.defer(()=>core.close());return core;
}
function episodeKey(f) {
  const row=f.db.prepare('SELECT id,revision FROM session_episodes WHERE deleted=0').get();
  return {namespace:ns,episodeId:row.id,expectedRevision:row.revision};
}

for(const path of ['conversation','episode']) test(`local ${path} revision conflict and missing target make no preflight writes`,async t=>{
  const f=sourceFixture(t,{kind:'episode'}),core=local(t,f);
  const source=await savedSource(f,'Synthetic live evidence.',{client:'claude-code',episodeContext:{clientLabel:'Synthetic',generation:'initial',origin:'ordinary'}});
  const input=path==='conversation'?deleteKey(source):episodeKey(f),method=path==='conversation'?'deleteConversation':'forgetEpisode';
  for(const change of [{expectedRevision:input.expectedRevision+1},path==='conversation'?{conversationId:'missing'}:{episodeId:'missing'}]) {
    const before=snapshot(f.db);
    denied(core[method]({...input,...change}),change.expectedRevision?'revision_conflict':path+'_not_found');
    assert.deepEqual(snapshot(f.db),before);
  }
});

test('local replay and conflicting action binding make no preflight writes even with a live target',async t=>{
  const f=sourceFixture(t),core=local(t,f),gone=await savedSource(f,'Synthetic deleted evidence.',{client:'claude-code',sessionId:'gone'});
  const input=deleteKey(gone),result=ok(core.deleteConversation(input));
  const live=await savedSource(f,'Synthetic live evidence.',{client:'claude-code',sessionId:'live'});
  const storage=createRawDeletionStorage({db:f.db,roots:createRawSourceRoots(f.db),
    localRawPrivacy:{beforeDelete(){assert.fail('replay must not invoke privacy preflight');}}});
  const replayBefore=snapshot(f.db);
  assert.deepEqual(storage.remove(input),result);assert.deepEqual(snapshot(f.db),replayBefore);
  const before=snapshot(f.db);
  denied(core.deleteConversation({...deleteKey(live),actionId:input.actionId}),'event_payload_conflict');
  assert.deepEqual(snapshot(f.db),before);
  assert.deepEqual(ok(core.deleteConversation(input)),result);assert.deepEqual(snapshot(f.db),before);
});

for(const path of ['conversation','episode']) test(`local ${path} hashes every UUID before the first message deletion across chunks`,async t=>{
  const f=sourceFixture(t,{kind:'episode'}),core=local(t,f),source=await savedSource(f,'Synthetic chunk evidence.',
    {client:'claude-code',episodeContext:{clientLabel:'Synthetic',generation:'initial',origin:'ordinary'}});
  const row=f.db.prepare('SELECT * FROM raw_messages').get(),keys=Object.keys(row),total=UUID_HASH_CHUNK*2+1;
  const insert=f.db.prepare('INSERT INTO raw_messages('+keys.join(',')+') VALUES('+keys.map(()=>'?').join(',')+')');
  f.db.exec('BEGIN');
  try {for(let n=2;n<=total;n++)insert.run(...keys.map(key=>key==='message_id'?'synthetic-copy-'+n:key==='ordinal'?n:row[key]));f.db.exec('COMMIT');}
  catch(error){f.db.exec('ROLLBACK');throw error;}
  const prepare=DatabaseSync.prototype.prepare,uuid=createLocalUuidFence(f.db);let deleted=0;
  DatabaseSync.prototype.prepare=function(sql,...args){
    const statement=prepare.call(this,sql,...args);
    if(sql==='DELETE FROM raw_messages WHERE conversation_id=?')return {run(...values){
      assert.equal(f.db.prepare('SELECT count(*) n FROM raw_messages').get().n,total);
      assert.equal(f.db.prepare('SELECT count(*) n FROM local_raw_uuid_fences').get().n,total);
      assert.equal(f.db.prepare('SELECT complete FROM local_raw_uuid_jobs').get().complete,1);
      assert.equal(f.db.prepare('SELECT count(*) n FROM raw_session_fences').get().n,1);
      for(let n=1;n<=total;n++)assert.equal(uuid.matches(internal,'claude-code',[{id:n===1?row.message_id:'synthetic-copy-'+n}]),true);
      deleted++;return statement.run(...values);
    }};
    return statement;
  };
  const input=path==='conversation'?deleteKey(source):episodeKey(f),method=path==='conversation'?'deleteConversation':'forgetEpisode';
  try {
    for(let n=1;n<=2;n++){
      denied(core[method](input),'local_raw_privacy_write_failed');
      assert.equal(f.db.prepare('SELECT count(*) n FROM local_raw_uuid_fences').get().n,UUID_HASH_CHUNK*n);
      assert.equal(f.db.prepare('SELECT count(*) n FROM raw_messages').get().n,total);assert.equal(deleted,0);
    }
    ok(core[method](input));assert.equal(deleted,1);
  } finally {DatabaseSync.prototype.prepare=prepare;}
  assert.equal(f.db.prepare('SELECT count(*) n FROM raw_messages').get().n,0);
  denied(await core.captureRaw(request(splitRaw('Synthetic copied evidence.',{id:row.message_id})[0],{sessionId:'fork',eventId:'fork'})),'conversation_deleted');
});

for(const path of ['conversation','episode']) test(`local ${path} concurrent revision refusal keeps only conservative target fences`,async t=>{
  const f=sourceFixture(t,{kind:'episode'});local(t,f);
  async function capture(sessionId) {
    const result=ok(await f.core.captureRaw(request(splitRaw('Synthetic '+sessionId+' evidence.',{id:sessionId})[0],
      {sessionId,eventId:sessionId,episodeContext:{clientLabel:'Synthetic',generation:'initial',origin:'ordinary'}},'episode')));
    return {conversationId:result.raw.conversationId,expectedConversationRevision:f.db.prepare('SELECT revision FROM raw_conversations WHERE id=?').get(result.raw.conversationId).revision};
  }
  const target=await capture('target'),other=await capture('other'),hidden=await capture('hidden');
  const uuid=createLocalUuidFence(f.db),hiddenRow=f.db.prepare('SELECT * FROM raw_conversations WHERE id=?').get(hidden.conversationId);
  uuid.beforeDelete(internal,hiddenRow.client,hiddenRow.session_key);
  const search=await searchFixture(f);await search.maintain();
  assert.deepEqual((await search.search({query:'evidence',intent:'history'})).candidates.map(hit=>hit.conversationId).sort(),
    [target.conversationId,other.conversationId].sort());
  const beforeMessages=f.db.prepare('SELECT * FROM raw_messages ORDER BY conversation_id,ordinal').all();
  const beforeFences=f.db.prepare('SELECT * FROM local_raw_uuid_fences').all();
  const beforeJobs=f.db.prepare('SELECT * FROM local_raw_uuid_jobs').all();
  const beforeSessions=f.db.prepare('SELECT * FROM raw_session_fences').all();
  const targetRow=f.db.prepare('SELECT * FROM raw_conversations WHERE id=?').get(target.conversationId);
  const targetEpisode=f.db.prepare('SELECT id,revision FROM session_episodes WHERE session_key=?').get(targetRow.session_key);
  const input=path==='conversation'?deleteKey(target):{namespace:ns,episodeId:targetEpisode.id,expectedRevision:targetEpisode.revision};
  // The seam is immediately after the completed read-only snapshot and before
  // the transaction's recheck; the synthetic writer changes only this target.
  let preflights=0;
  const storage=createRawDeletionStorage({db:f.db,roots:createRawSourceRoots(f.db),localRawPrivacy:{beforeDelete(...args){
    preflights++;uuid.beforeDelete(...args);
    if(path==='conversation')f.db.prepare('UPDATE raw_conversations SET revision=revision+1 WHERE id=?').run(target.conversationId);
    else f.db.prepare('UPDATE session_episodes SET revision=revision+1 WHERE id=?').run(input.episodeId);
  }}});
  assert.throws(()=>path==='conversation'?storage.remove(input):storage.forgetEpisode(internal,input),{code:'revision_conflict'});
  assert.equal(preflights,1);assert.deepEqual(f.db.prepare('SELECT * FROM raw_messages ORDER BY conversation_id,ordinal').all(),beforeMessages);
  assert.equal(uuid.matches(internal,'claude-code',[{id:'target'}]),true);
  assert.equal(uuid.matches(internal,'claude-code',[{id:'other'}]),false);
  assert.equal(uuid.matches(internal,'claude-code',[{id:'hidden'}]),true);
  for(const [table,before] of [['local_raw_uuid_fences',beforeFences],['local_raw_uuid_jobs',beforeJobs],['raw_session_fences',beforeSessions]]) {
    const after=f.db.prepare('SELECT * FROM '+table).all();
    for(const row of before)assert.ok(after.some(value=>JSON.stringify(value)===JSON.stringify(row)));
    assert.equal(after.length,before.length+1);
    if(table!=='local_raw_uuid_fences')assert.deepEqual(after.filter(row=>row.session_key!==targetRow.session_key),before);
  }
  assert.deepEqual((await search.search({query:'evidence',intent:'history'})).candidates.map(hit=>hit.conversationId),[other.conversationId]);
  assert.equal((await search.search({query:'hidden',intent:'history'})).candidates.length,0);
});

test('guard retry rechecks a changed target before writing privacy fences',async t=>{
  const f=sourceFixture(t);local(t,f);
  const source=await savedSource(f,'Synthetic retry evidence.',{client:'claude-code'});
  const prepare=DatabaseSync.prototype.prepare,exec=DatabaseSync.prototype.exec;let aborted=false,changed=false;
  DatabaseSync.prototype.prepare=function(sql,...args){
    const statement=prepare.call(this,sql,...args);
    if(sql==='DELETE FROM raw_messages WHERE conversation_id=?')return {run(...values){
      try{return statement.run(...values);}catch(error){aborted=error.message==='local_raw_uuid_pending';throw error;}
    }};
    return statement;
  };
  DatabaseSync.prototype.exec=function(sql,...args){
    const result=exec.call(this,sql,...args);
    if(sql==='ROLLBACK'&&aborted&&!changed){changed=true;
      f.db.prepare('UPDATE raw_conversations SET revision=revision+1 WHERE id=?').run(source.conversationId);
    }
    return result;
  };
  try{denied(f.core.deleteConversation(deleteKey(source)),'revision_conflict');}
  finally{DatabaseSync.prototype.prepare=prepare;DatabaseSync.prototype.exec=exec;}
  assert.equal(aborted,true);assert.equal(changed,true);
  for(const table of ['raw_session_fences','local_raw_uuid_jobs','local_raw_uuid_fences'])assert.equal(f.db.prepare('SELECT count(*) n FROM '+table).get().n,0);
  assert.equal(f.db.prepare('SELECT count(*) n FROM raw_messages').get().n,1);
});

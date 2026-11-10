import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { openMemoryCore } from '../index.mjs';
import { transaction } from '../database.mjs';
import { checkRawCardDeletion, createRawCardInvalidation } from '../card-raw-sources.mjs';
import { sourceFixture, savedSource, ns, ok, denied, request, splitRaw } from '../testing/raw-source-fixtures.mjs';
import { searchFixture } from '../testing/raw-search-fixtures.mjs';
import { installRawSearchTestClock } from '../testing/raw-search-clock.mjs';
import { spawnSync } from 'node:child_process';

const internal = { ...ns, projectId: ns.projectId ?? '' };
const snapshot = db => db.prepare("SELECT name FROM sqlite_schema WHERE type='table' ORDER BY name").all()
  .map(({name}) => [name,db.prepare('SELECT * FROM "'+name+'"').all().map(row => JSON.stringify(row)).sort()]);
const model = { extract: ({input}) => ({items:['north','south'].map(direction => ({
  content:'Synthetic '+direction+' '+input.messages[0].content,kind:'fact',confidence:.8,sourceIndices:[0],
}))}) };
async function fixture(t, route) {
  const f=sourceFixture(t,{kind:'episode',model});
  const local=openMemoryCore({path:f.path,raw:true,rawSearch:false});f.workspace.defer(()=>local.close());
  const source=await savedSource(f,'Synthetic copper deletion evidence.',{client:'claude-code',sessionId:'target',
    episodeContext:{clientLabel:'Synthetic',generation:'initial',origin:'ordinary'}});
  const memories=f.db.prepare('SELECT id FROM memories WHERE deleted=0 ORDER BY id').all().map(row=>({...row,forget:true}));
  assert.equal(memories.length,2);
  const second=await savedSource(f,'Synthetic independent raw support.',{client:'claude-code',sessionId:'second',episodeContext:{clientLabel:'Synthetic',generation:'initial',origin:'ordinary'}});
  const third=await savedSource(f,'Synthetic other raw support.',{client:'claude-code',sessionId:'third',episodeContext:{clientLabel:'Synthetic',generation:'initial',origin:'ordinary'}});
  const episode=f.db.prepare('SELECT id,revision FROM session_episodes WHERE session_key=(SELECT session_key FROM raw_conversations WHERE id=?)').get(source.conversationId);
  return {...f,local,source,memories,second,third,episode,route};
}
function seed(f,count,{inactive=0,queued=0}={}) {
  const stamp='2020-01-01T00:00:00.000Z';
  const card=f.db.prepare('INSERT INTO private_cards VALUES(?,?,?,?,1,?,?,?,?,?,?,NULL)');
  const memory=f.db.prepare('INSERT INTO card_memory_bindings VALUES(?,?,1,?,?,0)');
  const raw=f.db.prepare('INSERT INTO card_raw_bindings VALUES(?,?,?,?,0,8,?,0)');
  f.db.exec('BEGIN');
  try {
  for(let index=0;index<count+inactive;index++) {
    const id='synthetic-card-'+index,active=index<count,state=active?(index%2?'confirmed':'draft'):'cancelled';
    card.run(id,ns.ownerId,ns.scope,ns.projectId??'',state,active?'Synthetic title':null,active?'Synthetic body':null,1,stamp,stamp);
    if(f.route!=='raw')memory.run(id,f.memories[f.route==='memory'?0:index%2].id,'receipt-'+index,'{}');
    if(f.route!=='memory') {
      const source=f.route==='raw'?f.source:index%2?f.second:f.third;
      raw.run(id,'binding-'+index,source.conversationId,source.messageId,'{}');
    }
    if(index<queued)f.db.prepare('INSERT INTO card_raw_pending_invalidations VALUES(?,1)').run(id);
  }
  f.db.exec('COMMIT');
  } catch(error){if(f.db.isTransaction)f.db.exec('ROLLBACK');throw error;}
}
const deletion = f => ({namespace:ns,conversationId:f.source.conversationId,
  expectedRevision:f.source.expectedConversationRevision,actionId:'synthetic-delete'});
async function remove(f,path) {
  if(path==='conversation')return f.local.deleteConversation(deletion(f));
  if(path==='episode')return f.local.forgetEpisode({namespace:ns,episodeId:f.episode.id,expectedRevision:f.episode.revision});
  const child=spawnSync(process.execPath,[new URL('../../adapters/mcp/cli.mjs',import.meta.url).pathname,
    'raw','delete','--db',f.path,'--owner',ns.ownerId,'--conversation',f.source.conversationId,'--yes'],
    {encoding:'utf8',env:{NODE_NO_WARNINGS:'1'},timeout:15000});
  assert.equal(child.error,undefined);assert.equal(child.stderr,'');
  const result=JSON.parse(child.stdout);
  assert.equal(child.status,result.ok?0:1);
  return result;
}
for(const path of ['conversation','episode','cli'])for(const route of path==='cli'?['raw']:['memory','aggregate','raw'])for(const count of [128,129]) {
  test(`local ${path} ${route} Card boundary ${count} preserves visibility on refusal`,async t=>{
    installRawSearchTestClock(t);
    const f=await fixture(t,route);seed(f,count);
    const search=await searchFixture(f);await search.maintain();
    const visible=async()=>assert.ok((await search.search({query:'copper',intent:'history'})).candidates.some(row=>row.conversationId===f.source.conversationId));
    await visible();
    const before=snapshot(f.db),result=await remove(f,path);
    if(count===128) {
      assert.equal(result.ok,true,JSON.stringify(result));
      assert.equal(f.db.prepare('SELECT 1 FROM raw_conversations WHERE id=?').get(f.source.conversationId),undefined);
      assert.ok(f.db.prepare('SELECT count(*) n FROM local_raw_uuid_fences').get().n>0);
    } else {
      denied(result,'dependency_limit_reached');assert.deepEqual(snapshot(f.db),before);
      for(const table of ['raw_session_fences','local_raw_uuid_fences','local_raw_uuid_jobs'])assert.equal(f.db.prepare('SELECT count(*) n FROM '+table).get().n,0);
      await visible();
      ok(await f.local.captureRaw(request(splitRaw('Synthetic subsequent live capture.',{id:'subsequent',ordinal:2})[0],
        {client:'claude-code',sessionId:'target',eventId:'subsequent'})));
    }
  });
}
function decision(work) {
  try {work();return 'proceed';}catch(error){if(error.code==='dependency_limit_reached')return error.code;throw error;}
}
for(const route of ['memory','aggregate','raw','queued'])for(const count of [128,129])test(`Card deletion agreement ${route} ${count} with inactive bindings and existing queue`,async t=>{
  const f=await fixture(t,route);seed(f,count,{inactive:2,queued:route==='aggregate'?2:0});
  if(route==='queued') {
    const id='synthetic-card-'+(count-1);
    f.db.prepare('DELETE FROM card_memory_bindings WHERE card_id=?').run(id);
    f.db.prepare('INSERT INTO card_raw_pending_invalidations VALUES(?,1)').run(id);
  }
  if(route==='memory') {
    f.db.exec('BEGIN');
    try {
      for(let index=0;index<count;index++)f.db.prepare('INSERT INTO card_memory_bindings VALUES(?,?,1,?,?,1)')
        .run('synthetic-card-'+index,f.memories[0].id,'duplicate-receipt-'+index,'{}');
      f.db.exec('COMMIT');
    } catch(error){if(f.db.isTransaction)f.db.exec('ROLLBACK');throw error;}
  }
  const before=snapshot(f.db);
  const planned=decision(()=>{
    f.db.exec('SAVEPOINT check_cards');
    try {checkRawCardDeletion({prepare(sql){assert.match(sql,/^SELECT /);return f.db.prepare(sql);}},internal,f.source.conversationId,f.memories);}
    finally {f.db.exec('ROLLBACK TO check_cards');f.db.exec('RELEASE check_cards');}
  });
  assert.deepEqual(snapshot(f.db),before);
  const rollback=new Error('synthetic rollback'),cards=createRawCardInvalidation(f.db);
  let enforced;
  try {
    transaction(f.db,()=>{
      cards.mutate(internal,'synthetic-agreement',()=>{
        cards.collect(internal,[{conversationId:f.source.conversationId}]);
        for(const memory of f.memories)f.db.prepare('UPDATE memories SET revision=revision+1 WHERE id=?').run(memory.id);
      });
      throw rollback;
    });
  } catch(error) {if(error===rollback)enforced='proceed';else if(error.code==='dependency_limit_reached')enforced=error.code;else throw error;}
  assert.equal(enforced,count===128?'proceed':'dependency_limit_reached');
  assert.equal(planned,enforced);assert.deepEqual(snapshot(f.db),before);
});

test('Card deletion precheck is inert without Card tables',()=>{
  const db=new DatabaseSync(':memory:');
  try {checkRawCardDeletion(db,internal,'absent',[{id:'absent',forget:true}]);assert.deepEqual(db.prepare('SELECT name FROM sqlite_schema').all(),[]);}
  finally {db.close();}
});

test('guard retry checks Card refusal before any new privacy writes',async t=>{
  const f=await fixture(t,'raw');
  const prepare=DatabaseSync.prototype.prepare,exec=DatabaseSync.prototype.exec;
  let aborted=false,changed=false,before;
  DatabaseSync.prototype.prepare=function(sql,...args){
    const statement=prepare.call(this,sql,...args);
    if(sql==='DELETE FROM raw_messages WHERE conversation_id=?')return {run(...values){
      try{return statement.run(...values);}catch(error){aborted=error.message==='local_raw_uuid_pending';throw error;}
    }};
    return statement;
  };
  DatabaseSync.prototype.exec=function(sql,...args){
    const result=exec.call(this,sql,...args);
    if(sql==='ROLLBACK'&&aborted&&!changed){changed=true;seed(f,129);before=snapshot(f.db);}
    return result;
  };
  try {denied(f.core.deleteConversation(deletion(f)),'dependency_limit_reached');}
  finally {DatabaseSync.prototype.prepare=prepare;DatabaseSync.prototype.exec=exec;}
  assert.equal(aborted,true);assert.equal(changed,true);assert.deepEqual(snapshot(f.db),before);
  for(const table of ['raw_session_fences','local_raw_uuid_fences','local_raw_uuid_jobs'])assert.equal(f.db.prepare('SELECT count(*) n FROM '+table).get().n,0);
});

for(const count of [128,129])test(`local deletion includes foreign-conversation receipt spans in the ${count}-Card union`,async t=>{
  const f=await fixture(t,'raw');seed(f,count);
  f.db.prepare('UPDATE card_raw_bindings SET conversation_id=?,message_id=? WHERE card_id=?')
    .run(f.second.conversationId,f.second.messageId,'synthetic-card-'+(count-1));
  const receipt=f.db.prepare('SELECT receipt_id FROM raw_receipt_lineage WHERE conversation_id=? LIMIT 1').get(f.source.conversationId);
  f.db.prepare("INSERT INTO raw_receipt_lineage VALUES(?,?,?,?,?,'exact')")
    .run(receipt.receipt_id,f.second.conversationId,f.second.messageId,0,8);
  const before=snapshot(f.db),result=f.local.deleteConversation(deletion(f));
  if(count===129){denied(result,'dependency_limit_reached');assert.deepEqual(snapshot(f.db),before);}
  else ok(result);
});

for(const failure of ['role','source-map','clock'])test(`local deletion checks forgotten receipt ${failure} prerequisites before privacy writes`,async t=>{
  const f=await fixture(t,'memory');
  if(failure==='clock') {
    f.db.prepare("UPDATE receipts SET created_at='invalid' WHERE memory_id=?").run(f.memories[0].id);
    f.db.prepare("UPDATE memories SET created_at='invalid',updated_at='invalid' WHERE id=?").run(f.memories[0].id);
  } else {
    f.db.prepare('DELETE FROM raw_receipt_lineage WHERE receipt_id IN (SELECT id FROM receipts WHERE memory_id=?)').run(f.memories[0].id);
    f.db.prepare(failure==='role'?"UPDATE receipts SET role='assistant' WHERE memory_id=?":"UPDATE receipts SET excerpt='Synthetic unmatched legacy source' WHERE memory_id=?")
      .run(f.memories[0].id);
  }
  const before=snapshot(f.db);
  denied(f.local.deleteConversation(deletion(f)),failure==='clock'?'local_raw_hide_anchor_missing':failure==='role'?'event_payload_conflict':'raw_lineage_unavailable');
  assert.deepEqual(snapshot(f.db),before);
});

for(const count of [128,129])test(`Card deletion agreement fallback spans without a Raw root ${count}`,async t=>{
  const f=await fixture(t,'raw');seed(f,count);
  const sourceKey=f.db.prepare('SELECT source_key FROM raw_source_maps WHERE conversation_id=? LIMIT 1').get(f.source.conversationId).source_key;
  const fallback=[[f.source.conversationId,f.source.messageId,sourceKey,0,f.source.text.length]];
  const before=snapshot(f.db),planned=decision(()=>checkRawCardDeletion(f.db,internal,undefined,[],fallback));
  const rollback=new Error('synthetic rollback'),cards=createRawCardInvalidation(f.db);let enforced;
  try {
    transaction(f.db,()=>{
      cards.mutate(internal,'synthetic-fallback',()=>cards.collect(internal,[{conversationId:f.source.conversationId,messageId:f.source.messageId,start:0,end:8}]));
      throw rollback;
    });
  } catch(error){if(error===rollback)enforced='proceed';else if(error.code==='dependency_limit_reached')enforced=error.code;else throw error;}
  assert.equal(enforced,count===128?'proceed':'dependency_limit_reached');assert.equal(planned,enforced);assert.deepEqual(snapshot(f.db),before);
});

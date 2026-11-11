import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { openMemoryCore } from '../index.mjs';
import { transaction } from '../database.mjs';
import { withContentWriteOperation, registerContentWriteGuard } from '../content-write-context.mjs';
import { beginContentWriteSafety } from '../content-write-safety.mjs';
import { hasContentSuppressionRequestInside, withContentSuppressionRequest } from '../content-suppression-storage.mjs';
import { createMemoryRuntime } from '../runtime.mjs';
import { createRawSourceRoots } from '../raw-source-roots.mjs';
import { createLocalUuidFence } from '../local-authority-uuid.mjs';
import { sourceFixture, savedSource, resolve, draft, ns, ok, denied, request, splitRaw } from '../testing/raw-source-fixtures.mjs';
import { safetyFixture } from '../testing/content-safety-s2h-fixture.mjs';
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
for(const route of ['memory','aggregate','raw','queued'])for(const count of [128,129])test(`Card deletion agreement ${route} ${count} with inactive bindings and existing queue`,async t=>{
  const f=await fixture(t,route);seed(f,count,{inactive:2,queued:route==='aggregate'?2:0});
  if(route==='queued') {
    const id='synthetic-card-'+(count-1);
    f.db.prepare('DELETE FROM card_memory_bindings WHERE card_id=?').run(id);
    f.db.prepare('INSERT INTO card_raw_pending_invalidations VALUES(?,1)').run(id);
  }
  if(route==='memory')for(let index=0;index<count;index++)
    f.db.prepare('INSERT INTO card_memory_bindings VALUES(?,?,1,?,?,1)')
      .run('synthetic-card-'+index,f.memories[0].id,'duplicate-receipt-'+index,'{}');
  prepareForgetAgreement(f);
  assertForgetAgreement(f,count===128?'proceed':'dependency_limit_reached');
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

// Observe the production dry run at its privacy handoff. Construction has
// finished before instrumentation; the next BEGIN would be beforeDelete.
function forgetPrecheck(f,path='conversation') {
  const runtime=createMemoryRuntime({path:f.path,sessionEpisodes:{mode:'episode-v1'}},
    {rawCapture:true,rawLineage:true,rawDeletion:true,rawSources:true,localRawPrivacy:true});
  const handoff=new Error('synthetic privacy handoff'),exec=DatabaseSync.prototype.exec;
  let rolledBack=false;
  DatabaseSync.prototype.exec=function(sql,...args){
    if(sql==='BEGIN IMMEDIATE'&&rolledBack)throw handoff;
    const result=exec.call(this,sql,...args);
    if(sql==='ROLLBACK')rolledBack=true;
    return result;
  };
  try {
    if(path==='episode')runtime.forgetEpisode(internal,{episodeId:f.episode.id,expectedRevision:f.episode.revision});
    else runtime.deleteConversation(deletion(f));
    assert.fail('precheck must reach the handoff or refuse');
  } catch(error){if(error===handoff)return 'proceed';if(error.code)return error.code;throw error;}
  finally{DatabaseSync.prototype.exec=exec;runtime.close();}
}
function forgetCascade(f,path='conversation') {
  // A child loader bypasses only precheck, leaving the actual transaction,
  // callbacks, UUID guard, triggers and post-callback validation unchanged.
  const loader=String.raw`export async function load(url,context,next){
    const result=await next(url,context);
    if(url.endsWith('/core/raw-deletion-storage.mjs')){
      let source=String(result.source);
      for(const [call,selection] of [
        ['precheck(ns, () => conversationTarget(ns, value, binding).row, deleteConversationInside)','conversationTarget(ns, value, binding).row'],
        ['precheck(ns, () => episodeTarget(ns, value), forgetEpisodeInside)','episodeTarget(ns, value)']
      ]) {
        if(source.split(call).length!==2)throw Error('probe_call_missing');
        source=source.replace(call,selection);
      }
      return {...result,source};
    }
    return result;
  }`;
  const script=`import {DatabaseSync} from 'node:sqlite';
    import {createMemoryRuntime} from './core/runtime.mjs';
    const [file,path,input,namespace]=process.argv.slice(1);
    const runtime=createMemoryRuntime({path:file,sessionEpisodes:{mode:'episode-v1'}},
      {rawCapture:true,rawLineage:true,rawDeletion:true,rawSources:true,localRawPrivacy:true});
    const rollback={},exec=DatabaseSync.prototype.exec;let transactions=0;
    DatabaseSync.prototype.exec=function(sql,...args){
      if(sql==='BEGIN IMMEDIATE')transactions++;
      if(sql==='COMMIT'&&transactions===2)throw rollback;
      return exec.call(this,sql,...args);
    };
    let outcome;
    try{if(path==='episode')runtime.forgetEpisode(JSON.parse(namespace),JSON.parse(input));else runtime.deleteConversation(JSON.parse(input));
      throw Error('probe_committed');
    }catch(error){if(error===rollback)outcome='proceed';else if(error.code)outcome=error.code;else throw error;}
    finally{DatabaseSync.prototype.exec=exec;runtime.close();}
    process.stdout.write(JSON.stringify({outcome,transactions}));`;
  const input=path==='episode'?{episodeId:f.episode.id,expectedRevision:f.episode.revision}:deletion(f);
  const child=spawnSync(process.execPath,['--no-warnings','--loader','data:text/javascript,'+encodeURIComponent(loader),
    '--input-type=module','-e',script,f.path,path,JSON.stringify(input),JSON.stringify(internal)],{encoding:'utf8',timeout:30000});
  assert.equal(child.status,0,child.stderr);assert.equal(child.error,undefined);
  const result=JSON.parse(child.stdout);assert.equal(result.transactions,2,'privacy handoff then real deletion transaction');
  return result.outcome;
}
function prepareForgetAgreement(f) {
  // Complete the real UUID jobs before the comparison snapshot. The local
  // cascade can then reach all predicates and COMMIT without a retry guard.
  const uuid=createLocalUuidFence(f.db);
  for(const row of f.db.prepare('SELECT client,session_key FROM raw_conversations UNION SELECT client,session_key FROM session_episodes').all())
    uuid.beforeDelete(internal,row.client,row.session_key);
}
function assertForgetAgreement(f,expected,path='conversation') {
  const before=snapshot(f.db),planned=forgetPrecheck(f,path);
  assert.deepEqual(snapshot(f.db),before,'precheck leaves every table unchanged');
  const enforced=forgetCascade(f,path);
  assert.deepEqual(snapshot(f.db),before,'real cascade rolls back every table');
  assert.equal(planned,enforced,'forget prerequisite agreement');
  assert.equal(enforced,expected,'real cascade outcome');
}

for(const failure of ['role','source-map','ambiguous','clock','unknown-keep'])
  test(`forget prerequisite agreement ${failure} refusal and passing control`,async t=>{
    const f=await fixture(t,'memory'),memory=f.memories.at(-1);
    const receipts=f.db.prepare('SELECT * FROM receipts WHERE memory_id=?').all(memory.id);
    let repair;
    if(failure==='clock') {
      f.db.prepare("UPDATE receipts SET created_at='invalid' WHERE memory_id=?").run(memory.id);
      f.db.prepare("UPDATE memories SET created_at='invalid',updated_at='invalid' WHERE id=?").run(memory.id);
      // A valid Memory fallback clock suffices even with invalid receipt clocks.
      repair=()=>f.db.prepare('UPDATE memories SET updated_at=? WHERE id=?').run('2020-01-01T00:00:00.000Z',memory.id);
    } else if(failure==='role'||failure==='source-map') {
      f.db.prepare('DELETE FROM raw_receipt_lineage WHERE receipt_id IN (SELECT id FROM receipts WHERE memory_id=?)').run(memory.id);
      f.db.prepare(failure==='role'?"UPDATE receipts SET role='assistant' WHERE memory_id=?":"UPDATE receipts SET excerpt='Synthetic unmatched legacy source' WHERE memory_id=?")
        .run(memory.id);
      repair=()=>{for(const receipt of receipts)f.db.prepare('UPDATE receipts SET role=?,excerpt=? WHERE id=?').run(receipt.role,receipt.excerpt,receipt.id);};
    } else {
      const consumer=f.db.prepare('SELECT * FROM session_episodes WHERE session_key=(SELECT session_key FROM raw_conversations WHERE id=?)').get(f.second.conversationId);
      // Only this Memory uses the proof: no earlier mutation can consume it.
      installLegacyProof({...f,memories:[memory]},consumer);
      for(const earlier of f.memories.slice(0,-1))
        f.db.prepare('DELETE FROM episode_memory_links WHERE memory_id=?').run(earlier.id);
      if(failure==='unknown-keep') {
        f.db.prepare('UPDATE episode_keep_actions SET keep_source_ids=?').run(JSON.stringify(['synthetic-missing-source']));
        repair=()=>f.db.prepare('UPDATE episode_keep_actions SET keep_source_ids=?').run(JSON.stringify(['synthetic-shared-keep-source']));
      } else {
        const roots=createRawSourceRoots(f.db),source=f.db.prepare('SELECT * FROM raw_conversations WHERE id=?').get(f.source.conversationId);
        const alias=roots.keys(internal,source.client,source.session_key)[1];
        const copy=(table,row)=>f.db.prepare('INSERT INTO '+table+' ('+Object.keys(row).join(',')+') VALUES ('+Object.keys(row).map(()=>'?').join(',')+')').run(...Object.values(row));
        copy('raw_conversations',{...source,id:'synthetic-ambiguous-conversation',session_key:alias});
        const message=f.db.prepare('SELECT * FROM raw_messages WHERE conversation_id=? AND message_id=?').get(source.id,f.source.messageId);
        copy('raw_messages',{...message,conversation_id:'synthetic-ambiguous-conversation',reserved_bytes:0});
        // KEEP authority resolves uniquely, while anchors sees both Raw aliases.
        assert.equal(roots.receipt(internal,receipts[0]).roots.length,1);
        repair=()=>f.db.prepare('DELETE FROM raw_messages WHERE conversation_id=?').run('synthetic-ambiguous-conversation');
      }
    }
    prepareForgetAgreement(f);
    assertForgetAgreement(f,failure==='clock'?'local_raw_hide_anchor_missing':failure==='role'?'event_payload_conflict':'raw_lineage_unavailable');
    repair();
    assertForgetAgreement(f,'proceed');
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

for(const count of [128,129])test(`Card deletion agreement fallback spans without an exact Raw root ${count}`,async t=>{
  const f=await fixture(t,'raw');seed(f,count);
  // The episode's original key remains authoritative through legacy KEEP,
  // while the Raw message is reachable only through its hashed alias.
  const source=f.db.prepare('SELECT * FROM raw_conversations WHERE id=?').get(f.source.conversationId);
  const alias=createRawSourceRoots(f.db).keys(internal,source.client,source.session_key)[1];
  const consumer=f.db.prepare('SELECT * FROM session_episodes WHERE session_key=(SELECT session_key FROM raw_conversations WHERE id=?)').get(f.second.conversationId);
  installLegacyProof({...f,memories:[f.memories[0]]},consumer);
  f.db.prepare('UPDATE raw_conversations SET session_key=? WHERE id=?').run(alias,source.id);
  prepareForgetAgreement(f);
  assertForgetAgreement(f,count===128?'proceed':'dependency_limit_reached','episode');
});

function installLegacyProof(f,consumer) {
  const sourceId='synthetic-shared-keep-source',eventId='synthetic-legacy-keep';
  f.db.exec('BEGIN');
  try {
    f.db.prepare('INSERT INTO episode_sources VALUES(?,?,?,?,?,?,?,?,0,1)')
      .run(sourceId,consumer.id,f.episode.id,eventId,f.source.messageId,'a'.repeat(64),'user',f.source.text);
    for(const [index,memory]of f.memories.entries()) {
      const receipts=f.db.prepare('SELECT id FROM receipts WHERE memory_id=?').all(memory.id).map(row=>row.id);
      f.db.prepare('DELETE FROM raw_receipt_lineage WHERE receipt_id IN (SELECT id FROM receipts WHERE memory_id=?)').run(memory.id);
      f.db.prepare('INSERT INTO episode_memory_links VALUES(?,?,?,?,1,?)')
        .run('synthetic-keep-link-'+index,consumer.id,memory.id,eventId,JSON.stringify(receipts));
    }
    f.db.prepare(`INSERT INTO episode_keep_actions VALUES(?,?,?,?,?,?,?,?,?,'completed',NULL,NULL,?,0,'completed',NULL,?,?,?,1,?)`)
      .run('b'.repeat(64),'synthetic-keep',consumer.id,ns.ownerId,ns.scope,ns.projectId??'',consumer.client,eventId,'c'.repeat(64),
        JSON.stringify(f.memories.map(memory=>memory.id)),JSON.stringify([sourceId]),consumer.revision,consumer.source_fence,'2020-01-01T00:00:00.000Z');
    f.db.exec('COMMIT');
  } catch(error){if(f.db.isTransaction)f.db.exec('ROLLBACK');throw error;}
}

for(const path of ['conversation','episode'])test(`local ${path} forget prerequisite agreement for ordered legacy KEEP proof loss`,async t=>{
  const f=await fixture(t,'memory');
  const consumer=f.db.prepare('SELECT * FROM session_episodes WHERE session_key=(SELECT session_key FROM raw_conversations WHERE id=?)').get(f.second.conversationId);
  // Isolate the earlier mutation's direct link to the proof consumer.
  f.db.prepare('DELETE FROM episode_memory_links WHERE memory_id=?').run(f.memories[0].id);
  installLegacyProof(f,consumer);
  prepareForgetAgreement(f);
  assertForgetAgreement(f,'raw_lineage_unavailable',path);
  const before=snapshot(f.db);
  // The retained handle proves the refusal comes from real cascade ordering,
  // before its UUID guard. The local handle must decide it before preflight.
  denied(f.core.deleteConversation(deletion(f)),'raw_lineage_unavailable');assert.deepEqual(snapshot(f.db),before);
  denied(await remove(f,path),'raw_lineage_unavailable');assert.deepEqual(snapshot(f.db),before);
  f.db.prepare('DELETE FROM episode_memory_links WHERE memory_id=? AND episode_id=?').run(f.memories[0].id,consumer.id);
  assertForgetAgreement(f,'proceed',path);
});

test('local episode-only deletion keeps the no-Raw source exclusion shortcut for shared legacy KEEP proofs',async t=>{
  const base=sourceFixture(t,{kind:'episode',model}),local=openMemoryCore({path:base.path,raw:true,rawSearch:false});
  base.workspace.defer(()=>local.close());
  const input=sessionId=>({namespace:ns,client:'claude-code',sessionId,eventId:'episode-'+sessionId,
    messages:[{id:'message',role:'user',content:'Synthetic '+sessionId+' episode evidence.',occurredAt:'2020-01-01T00:00:00.000Z'}],
    episodeContext:{clientLabel:'Synthetic',generation:'initial',origin:'ordinary'}});
  const target=input('target'),episode=ok(await base.core.capture(target)).episode;
  const memories=base.db.prepare('SELECT id FROM memories WHERE deleted=0 ORDER BY id').all().map(row=>({...row,forget:true}));
  assert.equal(memories.length,2);
  const consumerId=ok(await base.core.capture(input('consumer'))).episode.id;
  const consumer=base.db.prepare('SELECT * FROM session_episodes WHERE id=?').get(consumerId);
  const f={...base,local,episode,memories,source:{messageId:target.messages[0].id,text:target.messages[0].content}};
  installLegacyProof(f,consumer);
  assert.equal(f.db.prepare('SELECT count(*) n FROM raw_conversations').get().n,0);
  const current=f.db.prepare('SELECT revision FROM session_episodes WHERE id=?').get(episode.id);
  ok(local.forgetEpisode({namespace:ns,episodeId:episode.id,expectedRevision:current.revision}));
  for(const memory of memories)assert.equal(f.db.prepare('SELECT deleted FROM memories WHERE id=?').get(memory.id).deleted,1);
});

for(const path of ['conversation','episode'])for(const negative of [false,true])test(`local ${path} catches post-callback ${negative?'denied':'live'} Card evidence before privacy writes`,async t=>{
  installRawSearchTestClock(t);
  const safety=safetyFixture(t,33);await safety.migrate();
  const base=sourceFixture(t,{kind:'episode',model,coreOptions:{path:safety.path}}),db=safety.connect();
  const local=openMemoryCore({path:safety.path,raw:true,rawSearch:false});
  t.after(()=>{local.close();db.close();});
  const f={...base,path:safety.path,db,local};
  f.source=await savedSource(f,'Synthetic copper deletion evidence.',{client:'claude-code',sessionId:'target',
    episodeContext:{clientLabel:'Synthetic',generation:'initial',origin:'ordinary'}});
  f.episode=db.prepare('SELECT id,revision FROM session_episodes WHERE session_key=(SELECT session_key FROM raw_conversations WHERE id=?)').get(f.source.conversationId);
  assert.equal(db.prepare('SELECT card_lineage_revision FROM content_safety_control').get().card_lineage_revision,0);
  const note=ok(f.call('submitSourceNote',{namespace:ns,actionId:'independent-note',text:'Synthetic independent contributor.',occurredAt:null})).source;
  const raw=(await resolve(f,[{rawAnchor:{conversationId:f.source.conversationId,messageId:f.source.messageId,start:0,end:8,precision:'exact'},
    expectedConversationRevision:f.source.expectedConversationRevision}]))[0];
  let card=ok(draft(f,[raw,note],'dependent-card'));
  card=ok(f.call('confirmCardDraft',{namespace:ns,actionId:'confirm-dependent',cardId:card.id,expectedRevision:card.revision}));
  if(!negative){
    const control=snapshot(db);assert.equal(forgetPrecheck(f,path),'proceed','live independent contributor permits the full validated UUID probe');
    assert.deepEqual(snapshot(db),control);return;
  }
  ok(f.call('deleteSourceNote',{namespace:ns,actionId:'delete-independent',sourceId:note.sourceId,expectedRevision:note.revision}));
  const search=await searchFixture(f);await search.maintain();
  const visible=async()=>assert.ok((await search.search({query:'copper',intent:'history'})).candidates.some(row=>row.conversationId===f.source.conversationId));
  await visible();
  const before=snapshot(db);denied(await remove(f,path),'evidence_unavailable');assert.deepEqual(snapshot(db),before);
  for(const table of ['raw_session_fences','local_raw_uuid_fences','local_raw_uuid_jobs'])assert.equal(db.prepare('SELECT count(*) n FROM '+table).get().n,0);
  await visible();
  ok(await local.captureRaw(request(splitRaw('Synthetic continued capture.',{id:'continued',ordinal:2})[0],
    {client:'claude-code',sessionId:'target',eventId:'continued'})));
});

test('local dry run proceeds without changing any table',async t=>{
  const f=await fixture(t,'raw');seed(f,1);
  const before=snapshot(f.db);assert.equal(forgetPrecheck(f),'proceed');assert.deepEqual(snapshot(f.db),before);
});

test('CLI successful deletion retains every Memory revision, deleted flag and receipt',async t=>{
  const f=await fixture(t,'memory');seed(f,129);
  const memoryTables=()=>snapshot(f.db).filter(([name])=>['memories','receipts','raw_receipt_lineage','raw_receipt_origins'].includes(name));
  const before=memoryTables();ok(await remove(f,'cli'));
  // Raw lineage is removed with its conversation; canonical Memories and their
  // receipts retain every column, including revision and deleted state.
  assert.deepEqual(memoryTables().filter(([name])=>['memories','receipts'].includes(name)),
    before.filter(([name])=>['memories','receipts'].includes(name)));
});

for(const route of ['overlap','split','foreign'])test(`local deletion agrees with real cascade on receipt-only ${route} graph`,async t=>{
  const f=await fixture(t,'memory');seed(f,129);
  if(route==='overlap') {
    f.db.prepare("UPDATE private_cards SET state='draft'").run();
    f.db.prepare('UPDATE card_memory_bindings SET memory_id=?').run(f.memories[1].id);
    f.db.prepare('INSERT INTO card_memory_bindings VALUES(?,?,1,?,?,0)')
      .run('synthetic-card-0',f.memories[0].id,'shared-receipt','{}');
  } else if(route==='split') {
    f.db.prepare('UPDATE card_memory_bindings SET memory_id=? WHERE card_id IN (SELECT id FROM private_cards ORDER BY rowid LIMIT 64)')
      .run(f.memories[1].id);
  } else {
    f.db.prepare("UPDATE private_cards SET owner_id='synthetic-foreign-owner' WHERE id='synthetic-card-128'").run();
  }
  assert.equal(f.db.prepare('SELECT count(*) n FROM card_raw_bindings').get().n,0);
  prepareForgetAgreement(f);assertForgetAgreement(f,'proceed');
  ok(await remove(f,'conversation'));
});

test('transaction preserves the private rollback sentinel after validation and close under a write context',async t=>{
  const f=safetyFixture(t,33);await f.migrate();const db=f.connect();t.after(()=>db.close());
  const sentinel=Object.freeze({}),order=[];
  registerContentWriteGuard((db,operation)=>{
    const state=beginContentWriteSafety(db,operation);assert.ok(state);
    return {...state,validate(result){order.push('validate');state.validate(result);},close(){order.push('close');state.close();}};
  });
  try {
    assert.throws(()=>withContentSuppressionRequest(()=>{
      assert.equal(hasContentSuppressionRequestInside(db),true);
      return withContentWriteOperation('setRawCaptureControl',[internal],()=>transaction(db,()=>{
        assert.equal(hasContentSuppressionRequestInside(db),false,'write wrapper disables the provisional read cache');
        order.push('work');return {};
      },()=>{order.push('check');if(order.length>1)throw sentinel;}));
    }),error=>error===sentinel);
  } finally {registerContentWriteGuard(beginContentWriteSafety);}
  assert.deepEqual(order,['check','work','validate','close','check']);assert.equal(db.isTransaction,false);
});

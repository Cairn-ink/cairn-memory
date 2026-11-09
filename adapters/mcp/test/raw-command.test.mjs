import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { openMemoryCore } from '../../../core/index.mjs';
import { rawCommand } from '../raw-command.mjs';
import { sourceFixture,ns,ok,request,splitRaw,anchor,resolve,draft } from '../../../core/testing/raw-source-fixtures.mjs';
import { searchFixture } from '../../../core/testing/raw-search-fixtures.mjs';
import { installRawSearchTestClock } from '../../../core/testing/raw-search-clock.mjs';
import { episodeHost,call as toolCall } from './fixtures/episode-server.mjs';

const secret='Synthetic copper private conversation sentinel';
const args=(f,owner=ns.ownerId)=>['--db',f.path,'--owner',owner];
const snapshot=db=>db.prepare("SELECT name FROM sqlite_schema WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name").all()
  .map(({name})=>[name,db.prepare('SELECT * FROM "'+name+'"').all().map(row=>JSON.stringify(row)).sort()]);
async function command(argv){const lines=[];const code=await rawCommand(argv,line=>lines.push(line));return{code,lines,output:lines.join('\n'),rows:lines.map(JSON.parse)};}
function localHandle(f){const core=openMemoryCore({path:f.path,raw:true,rawSearch:false});f.workspace.defer(()=>core.close());return core;}
async function capture(f,session,id,text=secret,episode=false,namespace=ns){
  const part=splitRaw(text,{id,occurredAt:'2020-01-01T00:00:00.000Z'})[0];
  const result=ok(await f.core.captureRaw(request(part,{namespace,client:'claude-code',sessionId:session,eventId:'event-'+id},episode?'episode':'ordinary')));
  return {conversationId:result.raw.conversationId,messageId:id,text,
    expectedConversationRevision:f.db.prepare('SELECT revision FROM raw_conversations WHERE id=?').get(result.raw.conversationId).revision};
}

test('raw list and dry run are text-free, inert, namespace-bound and reachable through CLI',async t=>{
  const f=sourceFixture(t),core=localHandle(f),source=await capture(f,'target','private');
  const foreign=await capture(f,'foreign','other','Synthetic foreign sentinel',false,{...ns,ownerId:'foreign'});
  const before=snapshot(f.db);
  const listed=await command(['list',...args(f)]);
  assert.equal(listed.code,0);assert.equal(listed.rows.length,1);assert.equal(listed.rows[0].id,source.conversationId);
  assert.deepEqual(listed.rows[0],{id:source.conversationId,client:'claude-code',firstEventAt:'2020-01-01T00:00:00.000Z',
    lastEventAt:'2020-01-01T00:00:00.000Z',messageCount:1,byteCount:Buffer.byteLength(secret),fenced:false,hidden:false});
  const dry=await command(['delete',...args(f),'--conversation',source.conversationId]);
  assert.equal(dry.code,0);assert.equal(dry.rows[0].dryRun,true);assert.deepEqual(snapshot(f.db),before);
  for(const id of ['absent',foreign.conversationId]) {
    const result=await command(['delete',...args(f),'--conversation',id,'--yes']);
    assert.equal(result.code,1);assert.equal(result.rows[0].error.code,'conversation_not_found');assert.deepEqual(snapshot(f.db),before);
  }
  const child=spawnSync(process.execPath,[new URL('../cli.mjs',import.meta.url).pathname,'raw','list',...args(f)],{encoding:'utf8',env:{NODE_NO_WARNINGS:'1'},timeout:15000});
  assert.equal(child.status,0,child.stderr);assert.equal(child.stdout.trim(),listed.output);
  assert.doesNotMatch(listed.output+dry.output+child.stdout,/private conversation sentinel|foreign sentinel/);
  ok(core.fenceSession({namespace:ns,client:'claude-code',sessionId:'target'}));
  const hidden=await command(['list',...args(f)]);assert.equal(hidden.rows[0].fenced,true);assert.equal(hidden.rows[0].hidden,true);
  assert.equal((await command(['delete',...args(f),'--conversation',source.conversationId])).code,0);
  assert.equal((await command(['delete',...args(f),'--conversation',source.conversationId,'--yes'])).code,0);
});

test('raw delete --yes removes Raw, Episodes and dependent Cards, fences copies and retains separate Memories',async t=>{
  installRawSearchTestClock(t);
  const f=sourceFixture(t,{kind:'episode',model:{extract:({input})=>({items:[{
    content:'Synthetic extracted from '+input.messages[0].content,kind:'fact',confidence:.8,sourceIndices:[0]}]})}}),local=localHandle(f);
  const source=await capture(f,'target','copied',secret,true),control=await capture(f,'control','fresh','Synthetic copper visible control',true);
  const ref=(await resolve(f,[anchor(source,0,8)]))[0];
  const card=ok(draft(f,[ref],'source-card'));
  ok(f.call('confirmCardDraft',{namespace:ns,cardId:card.id,expectedRevision:card.revision,actionId:'confirm-source',applicability:'current'}));
  const memory=ok(local.admit({namespace:ns,memory:{content:'Synthetic separately extracted memory',kind:'fact'},
    receipts:[{client:'claude-code',sessionId:'target',eventId:'memory',role:'user',excerpt:'Synthetic separate memory receipt'}]})).memory;
  const extracted=f.db.prepare('SELECT DISTINCT m.id FROM memories m JOIN receipts r ON r.memory_id=m.id JOIN raw_receipt_lineage l ON l.receipt_id=r.id WHERE l.conversation_id=?').all(source.conversationId);
  assert.ok(extracted.length>0,'real extracted Memory lineage exists');
  const search=await searchFixture(f);await search.maintain();assert.equal(search.indexCount(),2);
  const result=await command(['delete',...args(f),'--conversation',source.conversationId,'--yes']);
  assert.equal(result.code,0,result.output);assert.equal(result.rows[0].dryRun,false);assert.doesNotMatch(result.output,/private conversation sentinel/);
  for(const table of ['raw_messages','raw_parts','raw_source_maps','raw_receipt_lineage','raw_events','raw_capture_events'])
    assert.equal(f.db.prepare('SELECT count(*) n FROM '+table+' WHERE conversation_id=?').get(source.conversationId).n,0,table);
  assert.equal(f.db.prepare('SELECT count(*) n FROM session_episodes WHERE deleted=0').get().n,1);
  assert.equal(ok(f.call('getCard',{namespace:ns,cardId:card.id})).card,null);
  assert.equal(ok(local.get({namespace:ns,memoryId:memory.id})).memory.content,'Synthetic separately extracted memory');
  for(const {id}of extracted)assert.ok(ok(local.get({namespace:ns,memoryId:id})).memory,'extracted Memory keeps its own forget');
  assert.ok(f.db.prepare('SELECT count(*) n FROM local_raw_uuid_fences').get().n>0);
  for(const intent of ['current','history']) {
    const hits=(await search.search({query:'copper',intent})).candidates;
    assert.ok(hits.some(row=>row.conversationId===control.conversationId));assert.ok(hits.every(row=>row.conversationId!==source.conversationId));
  }
  await search.tick();assert.equal(search.indexCount(),1,'denied search index row removed by maintenance');
  for(const sessionId of ['target','fork']) {
    const copy=await local.captureRaw(request(splitRaw(secret,{id:'copied',occurredAt:'2025-01-01T00:00:00.000Z'})[0],
      {client:'claude-code',sessionId,eventId:'resent-'+sessionId}));
    assert.equal(copy.ok,false);assert.equal(copy.error.code,'conversation_deleted');
  }
});

test('raw CLI uses the MCP project binding and rejects bulk or ambiguous arguments',async t=>{
  const f=sourceFixture(t),local=localHandle(f);
  const project={ownerId:ns.ownerId,scope:'project',projectId:'synthetic-project'};
  const source=await capture(f,'project','project-id','Synthetic project private sentinel',false,project);
  const h=await episodeHost(t,f.path,{home:f.workspace.path,ns:project,cli:true,flags:['--session-episodes-access','episode-v1']});
  const remembered=ok(await toolCall(h,'remember_memory',{content:'Synthetic project namespace binding'}));
  assert.equal(ok(local.get({namespace:project,memoryId:remembered.memory.id})).memory.content,'Synthetic project namespace binding');
  // The CLI-derived project namespace is exactly the server's startup binding.
  assert.equal((await h.client.listTools()).tools.some(tool=>tool.name==='raw_delete'),false);
  assert.equal((await command(['list',...args(f)])).rows.length,0);
  assert.equal((await command(['list',...args(f),'--project',project.projectId])).rows[0].id,source.conversationId);
  const before=snapshot(f.db);
  for(const flags of [[],['--conversation','*'],['--conversation','a','--conversation','b'],['--conversation','a','b'],['--conversation','a','--all']])
    assert.equal((await command(['delete',...args(f),...flags])).code,2);
  assert.deepEqual(snapshot(f.db),before);
});

test('--no-raw MCP forget_session_episode recovers the local guard after rollback',async t=>{
  const f=sourceFixture(t,{kind:'episode'});localHandle(f);
  await capture(f,'target','episode-copy',secret,true);await capture(f,'control','episode-control','Synthetic visible episode control',true);
  const message=f.db.prepare("SELECT m.* FROM raw_messages m JOIN raw_conversations c ON c.id=m.conversation_id WHERE m.message_id='episode-copy'").get();
  const columns=Object.keys(message),insert=f.db.prepare('INSERT INTO raw_messages('+columns.join(',')+') VALUES('+columns.map(()=>'?').join(',')+')');
  f.db.exec('BEGIN');
  for(let n=2;n<=300;n++)insert.run(...columns.map(key=>key==='message_id'?'episode-copy-'+n:key==='ordinal'?n:message[key]));
  f.db.exec('COMMIT');
  const target=f.db.prepare('SELECT id,revision FROM session_episodes WHERE deleted=0 ORDER BY rowid').get();
  const h=await episodeHost(t,f.path,{home:f.workspace.path,ns,cli:true,flags:['--session-episodes-access','episode-v1','--no-context-read']});
  for(const hashes of [128,256]){
    const progress=await toolCall(h,'forget_session_episode',{episodeId:target.id,expectedRevision:target.revision});
    assert.deepEqual(progress.error,{code:'local_raw_privacy_write_failed',retryable:true});
    assert.equal(f.db.prepare('SELECT count(*) n FROM local_raw_uuid_fences').get().n,hashes);
    assert.equal(f.db.prepare('SELECT count(*) n FROM raw_messages').get().n,301);
  }
  const response=await toolCall(h,'forget_session_episode',{episodeId:target.id,expectedRevision:target.revision});
  assert.equal(response.ok,true,JSON.stringify(response));
  assert.equal(f.db.prepare('SELECT count(*) n FROM raw_messages').get().n,1);
  assert.equal(f.db.prepare('SELECT count(*) n FROM local_raw_uuid_fences').get().n,300);
  assert.equal(f.db.prepare('SELECT count(*) n FROM session_episodes WHERE deleted=0').get().n,1);
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { DatabaseSync } from 'node:sqlite';
import { MemoryStoreError } from '../../../core/validation.mjs';
import { createLocalUuidFence } from '../../../core/local-authority-uuid.mjs';
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
async function command(argv,options){
  const lines=[],errors=[],write=process.stderr.write;
  process.stderr.write=function(chunk){errors.push(String(chunk));return true;};
  try {const code=await rawCommand(argv,line=>lines.push(line),options);
    return{code,lines,output:lines.join('\n'),rows:lines.map(JSON.parse),stderr:errors.join('')};}
  finally{process.stderr.write=write;}
}
function localHandle(f){const core=openMemoryCore({path:f.path,raw:true,rawSearch:false});f.workspace.defer(()=>core.close());return core;}
async function capture(f,session,id,text=secret,episode=false,namespace=ns,client='claude-code'){
  const part=splitRaw(text,{id,occurredAt:'2020-01-01T00:00:00.000Z'})[0];
  const result=ok(await f.core.captureRaw(request(part,{namespace,client,sessionId:session,eventId:'event-'+id},episode?'episode':'ordinary')));
  return {conversationId:result.raw.conversationId,messageId:id,text,
    expectedConversationRevision:f.db.prepare('SELECT revision FROM raw_conversations WHERE id=?').get(result.raw.conversationId).revision};
}

test('raw --help prints both commands and no conversation text',async t=>{
  const f=sourceFixture(t);localHandle(f);await capture(f,'help-target','help-private');
  const before=snapshot(f.db);
  const child=spawnSync(process.execPath,[new URL('../cli.mjs',import.meta.url).pathname,'raw','--help'],{encoding:'utf8',env:{},timeout:15000});
  assert.equal(child.error,undefined);assert.equal(child.status,0,child.stderr);assert.equal(child.stderr,'');
  assert.equal(child.stdout,`Cairn Memory — local Raw conversation commands

Usage:
  cairn-memory raw list --db ABS --owner ID [--project ID]
  cairn-memory raw delete --db ABS --owner ID [--project ID] --conversation ID [--yes]

List and delete print metadata only. Delete is a dry run unless --yes is supplied.
See docs/raw-local-journal.md for deletion and retention details.
`);
  assert.doesNotMatch(child.stdout,/Synthetic copper private conversation sentinel/);
  assert.deepEqual(snapshot(f.db),before);
});

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

async function largeConversation(t,total=1008) {
  const f=sourceFixture(t),local=localHandle(f),source=await capture(f,'large-target','large-first');
  const row=f.db.prepare('SELECT * FROM raw_messages WHERE conversation_id=?').get(source.conversationId),keys=Object.keys(row);
  const insert=f.db.prepare('INSERT INTO raw_messages('+keys.join(',')+') VALUES('+keys.map(()=>'?').join(',')+')');
  f.db.exec('BEGIN');
  try {
    // Sparse ordinals ensure the progress numerator counts messages, not slots.
    for(let n=2;n<=total;n++)insert.run(...keys.map(key=>key==='message_id'?'large-copy-'+n:key==='ordinal'?n*2:row[key]));
    f.db.exec('COMMIT');
  } catch(error){f.db.exec('ROLLBACK');throw error;}
  return {f,local,source,total,argv:['delete',...args(f),'--conversation',source.conversationId,'--yes']};
}
function countsOnly(stderr,{capped=false}={}) {
  const lines=stderr.trim().split('\n');
  if(capped)assert.equal(lines.pop(),'rerun the same command to continue');
  assert.ok(lines.length>0);
  for(const line of lines)assert.match(line,/^(?:[1-9]\d{0,2}(?:,\d{3})*|0)\/(?:[1-9]\d{0,2}(?:,\d{3})*|0) prepared$/);
  assert.doesNotMatch(stderr,/Synthetic|sentinel|large-first|large-copy|large-target/);
  return lines;
}
async function deleted({f,local,source,total}) {
  assert.equal(f.db.prepare('SELECT count(*) n FROM raw_conversations WHERE id=?').get(source.conversationId).n,0);
  assert.equal(f.db.prepare('SELECT count(*) n FROM raw_messages').get().n,0);
  assert.equal(f.db.prepare('SELECT count(*) n FROM raw_session_fences').get().n,1);
  assert.equal(f.db.prepare('SELECT count(*) n FROM local_raw_uuid_fences').get().n,total);
  assert.equal(f.db.prepare('SELECT complete FROM local_raw_uuid_jobs').get().complete,1);
  for(const sessionId of ['large-target','resent-fork']) {
    const result=await local.captureRaw(request(splitRaw(secret,{id:'large-copy-1000'})[0],
      {client:'claude-code',sessionId,eventId:'resent-'+sessionId}));
    assert.deepEqual(result,{ok:false,error:{code:'conversation_deleted',retryable:false}});
  }
}

test('one raw delete CLI invocation prepares over a thousand Claude messages and fences resends',async t=>{
  const fixture=await largeConversation(t);
  const child=spawnSync(process.execPath,[new URL('../cli.mjs',import.meta.url).pathname,'raw',...fixture.argv],
    {encoding:'utf8',env:{NODE_NO_WARNINGS:'1'},timeout:30000});
  assert.equal(child.error,undefined);assert.equal(child.status,0,child.stderr);
  assert.equal(JSON.parse(child.stdout).dryRun,false);
  assert.deepEqual(countsOnly(child.stderr),[...Array.from({length:7},(_,i)=>`${(128*(i+1)).toLocaleString('en-US')}/1,008 prepared`),'1,008/1,008 prepared']);
  assert.doesNotMatch(child.stdout+child.stderr,/Synthetic|sentinel|large-first|large-copy|large-target/);
  await deleted(fixture);
});

for(const debt of ['job','backfill'])for(const fenced of [false,true])
  test(`raw delete finishes Codex with ${debt} pending and initially fenced=${fenced}`,async t=>{
    const {f,local,source,total}=await largeConversation(t,300);
    const codex=await capture(f,'codex-target','codex-message',secret,false,ns,'codex');
    const session=f.db.prepare('SELECT session_key FROM raw_conversations WHERE id=?').get(source.conversationId).session_key;
    // Simulate an old store's unfinished scan separately from a known job.
    f.db.exec('BEGIN');
    if(debt==='job') {
      createLocalUuidFence(f.db).advanceInside();
      createLocalUuidFence(f.db).enqueueInside(ns,'claude-code',session);
    } else f.db.exec('DELETE FROM local_raw_uuid_backfill');
    f.db.prepare('INSERT OR IGNORE INTO raw_session_fences VALUES(?,?,?,?,?)').run(ns.ownerId,ns.scope,'','claude-code',session);
    f.db.exec('COMMIT');
    if(fenced)ok(local.fenceSession({namespace:ns,client:'codex',sessionId:'codex-target'}));
    assert.equal(f.db.prepare('SELECT complete FROM local_raw_uuid_backfill').get()?.complete??0,debt==='job'?1:0);
    const result=await command(['delete',...args(f),'--conversation',codex.conversationId,'--yes']);
    assert.equal(result.code,0,result.output);assert.equal(result.rows[0].ok,true);assert.equal(result.rows[0].dryRun,false);
    assert.equal(result.rows[0].conversationId,codex.conversationId);
    assert.equal(f.db.prepare('SELECT count(*) n FROM raw_conversations WHERE id=?').get(codex.conversationId).n,0);
    assert.equal(f.db.prepare('SELECT count(*) n FROM raw_messages WHERE conversation_id=?').get(source.conversationId).n,total);
    assert.equal(f.db.prepare('SELECT complete FROM local_raw_uuid_jobs WHERE session_key=?').get(session).complete,1);
    assert.equal(f.db.prepare('SELECT complete FROM local_raw_uuid_backfill').get().complete,1);
    assert.equal(f.db.prepare('SELECT count(*) n FROM local_raw_uuid_fences').get().n,total);
    assert.equal(f.db.prepare("SELECT count(*) n FROM local_raw_uuid_jobs WHERE client='codex'").get().n,0);
    const copy=await local.captureRaw(request(splitRaw(secret,{id:'large-copy-2'})[0],
      {client:'claude-code',sessionId:'claude-fork',eventId:'claude-resent'}));
    assert.deepEqual(copy,{ok:false,error:{code:'conversation_deleted',retryable:false}});
    assert.equal(f.db.prepare('PRAGMA integrity_check').get().integrity_check,'ok');
  });

test('raw delete caps a fenced Codex refusal that makes no UUID progress',async t=>{
  const f=sourceFixture(t),local=localHandle(f),source=await capture(f,'codex-stalled','codex-stalled-message',secret,false,ns,'codex');
  ok(local.fenceSession({namespace:ns,client:'codex',sessionId:'codex-stalled'}));
  const before=snapshot(f.db),prepare=DatabaseSync.prototype.prepare;let passes=0;
  DatabaseSync.prototype.prepare=function(sql,...args){
    const statement=prepare.call(this,sql,...args);
    if(sql.startsWith('SELECT * FROM raw_deletion_actions WHERE'))return {get(){passes++;throw new MemoryStoreError('local_raw_privacy_write_failed');}};
    return statement;
  };
  let result;
  try {result=await command(['delete',...args(f),'--conversation',source.conversationId,'--yes'],{testDeleteCapMs:0});}
  finally {DatabaseSync.prototype.prepare=prepare;}
  assert.equal(result.code,3);assert.equal(passes,1);
  assert.deepEqual(result.rows,[{ok:false,error:{code:'local_raw_privacy_write_failed',retryable:true}}]);
  assert.deepEqual(countsOnly(result.stderr,{capped:true}),['0/1 prepared']);
  assert.deepEqual(snapshot(f.db),before);
});

test('raw delete cap preserves durable progress and one rerun completes',async t=>{
  const fixture=await largeConversation(t),{f,argv}=fixture;
  const first=await command(argv,{testDeleteCapMs:0});
  assert.equal(first.code,3);assert.deepEqual(first.rows,[{ok:false,error:{code:'local_raw_privacy_write_failed',retryable:true}}]);
  assert.deepEqual(countsOnly(first.stderr,{capped:true}),['128/1,008 prepared']);
  assert.equal(f.db.prepare('SELECT count(*) n FROM raw_messages').get().n,1008);
  assert.equal(f.db.prepare('SELECT count(*) n FROM local_raw_uuid_fences').get().n,128);
  const second=await command(argv);assert.equal(second.code,0,second.output);
  assert.equal(countsOnly(second.stderr)[0],'256/1,008 prepared');
  assert.doesNotMatch(first.output+second.output+first.stderr+second.stderr,/Synthetic|sentinel|large-copy/);
  await deleted(fixture);
});

for(const code of ['evidence_unavailable','local_raw_privacy_write_failed'])
  test(`raw delete stops after one refused pass: ${code}`,async t=>{
    const fixture=await largeConversation(t),{f,local,source,argv}=fixture;
    // The evidence refusal already has real pending work. A generic retry
    // mutant must still stop on either kind of unrelated error.
    if(code!=='local_raw_privacy_write_failed') {
      const progress=local.deleteConversation({namespace:ns,conversationId:source.conversationId,
        expectedRevision:source.expectedConversationRevision,actionId:'synthetic-prime',retainMemories:true});
      assert.equal(progress.error.code,'local_raw_privacy_write_failed');
    } else {
      // Finish the empty historical backfill without creating any hash job.
      f.db.exec('BEGIN');createLocalUuidFence(f.db).advanceInside();f.db.exec('COMMIT');
    }
    const before=snapshot(f.db),prepare=DatabaseSync.prototype.prepare;let passes=0;
    DatabaseSync.prototype.prepare=function(sql,...args){
      const statement=prepare.call(this,sql,...args);
      // Refuse at the API's first target read, before any bounded preparation.
      // A DELETE injector runs only on the final probe after middle-pass work.
      if(sql.startsWith('SELECT * FROM raw_deletion_actions WHERE'))return {get(...values){
        passes++;if(passes===1)throw new MemoryStoreError(code);return statement.get(...values);
      }};
      return statement;
    };
    let result;
    try {result=await command(argv);}finally{DatabaseSync.prototype.prepare=prepare;}
    assert.equal(result.code,code==='evidence_unavailable'?1:3,result.output);
    assert.deepEqual(result.rows,[{ok:false,error:{code,retryable:code!=='evidence_unavailable'}}]);
    assert.equal(passes,1);assert.equal(result.stderr,'');assert.deepEqual(snapshot(f.db),before);
  });

test('raw delete re-reads revisions, uses fresh action ids and releases the writer between passes',async t=>{
  const {f,argv}=await largeConversation(t),prepare=DatabaseSync.prototype.prepare,write=process.stderr.write;
  const actions=new Set(),times=[],metadataTimeouts=[],heartbeats=[];let progress=0,heartbeat=0;
  const timer=setInterval(()=>heartbeat++,10);
  DatabaseSync.prototype.prepare=function(sql,...args){
    const statement=prepare.call(this,sql,...args);
    if(sql.startsWith('SELECT c.id,c.client,c.revision,')||sql.startsWith('SELECT EXISTS(SELECT 1 FROM raw_session_fences f WHERE'))
      metadataTimeouts.push(prepare.call(this,'PRAGMA busy_timeout').get().timeout);
    if(sql.startsWith('SELECT * FROM raw_deletion_actions WHERE'))return {get(...values){actions.add(values.at(-1));return statement.get(...values);}};
    return statement;
  };
  process.stderr.write=function(chunk){
    assert.match(String(chunk),/^[\d,]+\/1,008 prepared\n$/);
    // A separate connection can take the writer, and change the next revision.
    f.db.exec('BEGIN IMMEDIATE');
    f.db.exec('UPDATE raw_conversations SET revision=revision+1');
    f.db.exec('COMMIT');times.push(performance.now());heartbeats.push(heartbeat);progress++;return true;
  };
  const lines=[];let code;
  try {code=await rawCommand(argv,line=>lines.push(line));}
  finally{clearInterval(timer);DatabaseSync.prototype.prepare=prepare;process.stderr.write=write;}
  assert.equal(code,0,lines.join('\n'));assert.equal(progress,8);assert.equal(actions.size,9);
  assert.deepEqual(metadataTimeouts,[5000,5000],'both metadata queries retain the capture contention timeout');
  for(let i=1;i<times.length;i++){
    assert.ok(times[i]-times[i-1]>=245,'timer yields at least 250 ms between passes (5 ms clock tolerance)');
    assert.ok(heartbeats[i]>heartbeats[i-1],'in-process heartbeat fires between consecutive passes');
  }
});

for(const point of ['between passes','inside a transaction'])
  test(`SIGINT ${point} preserves committed chunks and rerun matches uninterrupted deletion`,async t=>{
    const fixture=await largeConversation(t),{f,argv}=fixture;
    const script=`
      import { DatabaseSync } from 'node:sqlite';
      import { rawCommand } from ${JSON.stringify(new URL('../raw-command.mjs',import.meta.url).href)};
      const inside=${JSON.stringify(point==='inside a transaction')};
      let progressed=false;
      const stop=()=>{process.send({ready:true});Atomics.wait(new Int32Array(new SharedArrayBuffer(4)),0,0);};
      const write=process.stderr.write;
      process.stderr.write=function(chunk){const result=write.call(this,chunk);progressed=true;if(!inside)stop();return result;};
      const exec=DatabaseSync.prototype.exec;
      DatabaseSync.prototype.exec=function(sql,...args){
        const result=exec.call(this,sql,...args);
        if(inside && progressed && sql==='BEGIN IMMEDIATE') {
          // This uncommitted synthetic revision must disappear on interruption.
          this.prepare('UPDATE raw_conversations SET revision=revision+1').run();stop();
        }
        return result;
      };
      process.exitCode=await rawCommand(JSON.parse(process.argv[1]));`;
    const child=spawn(process.execPath,['--input-type=module','-e',script,JSON.stringify(argv)],
      {env:{NODE_NO_WARNINGS:'1'},stdio:['ignore','pipe','pipe','ipc']});
    let stdout='',stderr='',ready=false;
    child.stdout.on('data',chunk=>stdout+=chunk);child.stderr.on('data',chunk=>stderr+=chunk);
    child.on('message',message=>{if(message.ready){ready=true;child.kill('SIGINT');}});
    const timer=setTimeout(()=>child.kill('SIGKILL'),15000);
    t.after(()=>{clearTimeout(timer);if(child.exitCode===null && child.signalCode===null)child.kill('SIGKILL');});
    const result=await new Promise((resolve,reject)=>{child.once('error',reject);child.once('close',(code,signal)=>resolve({code,signal}));});
    clearTimeout(timer);assert.equal(ready,true);assert.deepEqual(result,{code:null,signal:'SIGINT'});
    assert.equal(stdout,'');assert.deepEqual(countsOnly(stderr),['128/1,008 prepared']);
    assert.equal(f.db.prepare('SELECT revision FROM raw_conversations').get().revision,fixture.source.expectedConversationRevision);
    assert.equal(f.db.prepare('SELECT count(*) n FROM raw_messages').get().n,1008);
    assert.equal(f.db.prepare('SELECT count(*) n FROM local_raw_uuid_fences').get().n,128);
    const resumed=await command(argv);assert.equal(resumed.code,0,resumed.output);
    assert.equal(countsOnly(resumed.stderr)[0],'256/1,008 prepared');
    assert.doesNotMatch(stdout+stderr+resumed.output+resumed.stderr,/Synthetic|sentinel|large-copy/);
    await deleted(fixture);
  });

test('raw delete completes after the final prepared batch has no pending UUID work',async t=>{
  const fixture=await largeConversation(t),{f,argv}=fixture,prepare=DatabaseSync.prototype.prepare;
  const observations=[];
  DatabaseSync.prototype.prepare=function(sql,...args){
    const statement=prepare.call(this,sql,...args);
    if(sql.startsWith('SELECT EXISTS(SELECT 1 FROM raw_session_fences f WHERE'))return {get(...values){
      const counts=statement.get(...values);observations.push({...counts});
      assert.equal(f.db.prepare('SELECT count(*) n FROM raw_conversations WHERE id=?').get(fixture.source.conversationId).n,1);
      return counts;
    }};
    return statement;
  };
  let result;
  try{result=await command(argv);}finally{DatabaseSync.prototype.prepare=prepare;}
  assert.equal(result.code,0,result.output);assert.equal(result.rows[0].ok,true);assert.equal(result.rows[0].dryRun,false);
  assert.deepEqual(observations.at(-1),{fenced:1,total:1008,prepared:1008,pending:0});
  await deleted(fixture);
});

for(const point of ['before preparation','final probe','final transaction'])
  test(`raw delete retries non-hashing SQLite BUSY ${point} and reports completion`,async t=>{
    const fixture=await largeConversation(t),{f,argv}=fixture,prepare=DatabaseSync.prototype.prepare;
    let injections=0,deletions=0;
    DatabaseSync.prototype.prepare=function(sql,...args){
      const statement=prepare.call(this,sql,...args),writer=this;
      if(point==='before preparation'&&sql.startsWith('SELECT * FROM raw_deletion_actions WHERE'))return {get(...values){
        if(injections===0){injections++;throw Object.assign(Error('synthetic busy'),{code:'ERR_SQLITE_ERROR',errcode:5});}
        return statement.get(...values);
      }};
      if(sql==='DELETE FROM raw_messages WHERE conversation_id=?')return {run(...values){
        deletions++;
        assert.equal(writer.prepare('SELECT count(*) n FROM local_raw_uuid_fences').get().n,1008);
        assert.equal(writer.prepare('SELECT complete FROM local_raw_uuid_jobs').get().complete,1);
        // First probe rolls back; second probe follows the durable last batch;
        // only the third cascade may commit the actual deletion.
        const selected=point==='final probe'?2:point==='final transaction'?3:0;
        if(deletions===selected){injections++;throw Object.assign(Error('synthetic busy'),{code:'ERR_SQLITE_ERROR',errcode:5});}
        return statement.run(...values);
      }};
      return statement;
    };
    let result;
    try{result=await command(argv);}finally{DatabaseSync.prototype.prepare=prepare;}
    assert.equal(injections,1);assert.equal(result.code,0,result.output);
    assert.equal(result.rows[0].ok,true);assert.equal(result.rows[0].dryRun,false);
    assert.equal(result.stderr.split('storage busy; waiting to retry\n').length-1,1);
    assert.doesNotMatch(result.stderr,/rerun/);
    await deleted(fixture);assert.equal(f.db.prepare('PRAGMA integrity_check').get().integrity_check,'ok');
  });

test('raw delete capped on non-hashing BUSY reports the reason and retains the conversation',async t=>{
  const {f,argv,source}=await largeConversation(t),prepare=DatabaseSync.prototype.prepare;
  DatabaseSync.prototype.prepare=function(sql,...args){
    const statement=prepare.call(this,sql,...args);
    if(sql.startsWith('SELECT * FROM raw_deletion_actions WHERE'))return {get(){
      throw Object.assign(Error('synthetic busy'),{code:'ERR_SQLITE_ERROR',errcode:5});
    }};
    return statement;
  };
  let result;
  try{result=await command(argv,{testDeleteCapMs:0});}finally{DatabaseSync.prototype.prepare=prepare;}
  assert.equal(result.code,3);assert.deepEqual(result.rows,[{ok:false,error:{code:'storage_busy',retryable:true}}]);
  assert.equal(result.stderr,'storage busy; waiting to retry\nrerun the same command to continue\n');
  assert.equal(f.db.prepare('SELECT count(*) n FROM raw_conversations WHERE id=?').get(source.conversationId).n,1);
  assert.equal(f.db.prepare('SELECT count(*) n FROM raw_messages').get().n,1008);
  assert.equal(f.db.prepare('SELECT count(*) n FROM raw_session_fences').get().n,0);
});

test('raw delete reports done when another deleter finishes before the progress query',async t=>{
  const fixture=await largeConversation(t),{f,local,source,argv}=fixture,prepare=DatabaseSync.prototype.prepare;
  let observations=0;
  DatabaseSync.prototype.prepare=function(sql,...args){
    const statement=prepare.call(this,sql,...args);
    if(sql.startsWith('SELECT EXISTS(SELECT 1 FROM raw_session_fences f WHERE'))return {get(...values){
      observations++;
      let result;
      for(let pass=0;pass<16;pass++){
        result=local.deleteConversation({namespace:ns,conversationId:source.conversationId,
          expectedRevision:source.expectedConversationRevision,retainMemories:true,actionId:'synthetic-other-delete-'+pass});
        if(result.ok)break;
        assert.deepEqual(result.error,{code:'local_raw_privacy_write_failed',retryable:true});
      }
      assert.equal(result.ok,true,JSON.stringify(result));
      const counts=statement.get(...values);
      assert.deepEqual({...counts},{fenced:0,total:0,prepared:0,pending:0});
      assert.equal(f.db.prepare('SELECT count(*) n FROM raw_conversations WHERE id=?').get(source.conversationId).n,0);
      return counts;
    }};
    return statement;
  };
  let result;
  try{result=await command(argv);}finally{DatabaseSync.prototype.prepare=prepare;}
  assert.equal(observations,1);assert.equal(result.code,0,result.output);
  assert.equal(result.rows[0].ok,true);assert.equal(result.rows[0].dryRun,false);
  assert.equal(result.rows[0].conversationId,source.conversationId);
  assert.equal(result.stderr,'');await deleted(fixture);
});

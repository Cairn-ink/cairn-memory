import {installRawSearchTestClock} from '../testing/raw-search-clock.mjs';
import assert from 'node:assert/strict';
import test from 'node:test';
test.beforeEach(installRawSearchTestClock);
import { fork } from 'node:child_process';
import { DatabaseSync } from 'node:sqlite';
import { readdirSync,renameSync } from 'node:fs';
import { join } from 'node:path';
import { sourceFixture,savedSource,ns,ok,localPlainPort } from '../testing/raw-source-fixtures.mjs';
import { searchFixture,safetySourceFixture,attestRawSearchCopy } from '../testing/raw-search-fixtures.mjs';

const receipt={client:'synthetic',sessionId:'independent',eventId:'replacement',role:'user',excerpt:'Synthetic replacement.'};
const model={extract:()=>({items:[{content:'Synthetic copper fact.',kind:'fact',confidence:.8,sourceIndices:[0]}]})};

for(const mode of ['DELETE','WAL'])test(`cached inventory observes unchanged-epoch terminal fences in ${mode} mode`,async t=>{
  const f=sourceFixture(t);await savedSource(f,'Synthetic copper telescope.');
  assert.equal(f.db.prepare('PRAGMA journal_mode='+mode).get().journal_mode,mode.toLowerCase());
  const s=await searchFixture(f);await s.maintain();
  const hit=(await s.search({query:'copper'})).candidates[0],prepared=await s.prepare(hit);
  const epochs=f.db.prepare('SELECT * FROM namespace_epochs').all(),mutate=await mutator(t,f.path);
  await mutate('fence',{conversationId:hit.conversationId});
  assert.deepEqual(f.db.prepare('SELECT * FROM namespace_epochs').all(),epochs);
  assert.throws(()=>prepared.validate(),{code:'raw_search_unavailable'});
  await assert.rejects(s.prepare(hit),{code:'raw_search_unavailable'});
  assert.equal((await s.search({query:'copper'})).candidates.length,0);
});

for(const mode of ['DELETE','WAL'])test(`paged inventory refuses a writer commit between snapshots in ${mode} mode`,async t=>{
  const f=sourceFixture(t),source=await savedSource(f,'Synthetic copper telescope.');
  f.db.prepare('PRAGMA journal_mode='+mode).get();
  f.db.prepare(`WITH RECURSIVE n(i) AS (SELECT 1 UNION ALL SELECT i+1 FROM n WHERE i<300)
    INSERT INTO raw_conversations SELECT 'empty-'||i,?,?,?,'codex','empty-'||i,1,'synthetic','synthetic' FROM n`)
    .run(ns.ownerId,ns.scope,ns.projectId??'');
  const s=await searchFixture(f),{openReadDatabase}=await import('../read-database.mjs'),
    {createRawSearchAuthority}=await import('../raw-search-authority.mjs');
  const database=openReadDatabase(f.path,{contextRead:true});f.workspace.defer(()=>database.db.close());
  const authority=createRawSearchAuthority(database,s.options),epochs=f.db.prepare('SELECT * FROM namespace_epochs').all();
  const exec=DatabaseSync.prototype.exec,prepare=DatabaseSync.prototype.prepare;let armed=false,moved=false;
  DatabaseSync.prototype.prepare=function(sql){
    if(this===database.db&&sql.startsWith('SELECT * FROM (SELECT client,session_key,id FROM raw_conversations WHERE'))armed=true;
    return prepare.call(this,sql);
  };
  DatabaseSync.prototype.exec=function(sql){const value=exec.call(this,sql);
    if(this===database.db&&sql==='COMMIT'&&armed&&!moved){moved=true;
      f.db.prepare(`INSERT INTO raw_session_fences SELECT owner_id,scope,project_id,client,session_key FROM raw_conversations WHERE id=?`).run(source.conversationId);
    }
    return value;
  };
  try{assert.throws(()=>authority.fence(),{code:'source_unavailable'});assert.equal(moved,true);}
  finally{DatabaseSync.prototype.exec=exec;DatabaseSync.prototype.prepare=prepare;}
  assert.deepEqual(f.db.prepare('SELECT * FROM namespace_epochs').all(),epochs);
  assert.equal(typeof authority.fence(),'string');
});
async function mutator(t,path) {
  const child=fork(new URL('../testing/raw-search-mutation-child.mjs',import.meta.url),[path],{stdio:['ignore','ignore','pipe','ipc']});
  t.after(()=>child.kill());let stderr='';child.stderr.on('data',data=>{stderr+=data;});
  const exited=new Promise(resolve=>child.once('exit',(code,signal)=>resolve({code,signal})));
  async function message(send) {
    let timer;
    try{return await new Promise((resolve,reject)=>{
      timer=setTimeout(()=>{child.kill();reject(Error('mutation_timeout'));},10000);
      child.once('message',resolve);child.once('error',reject);if(send)child.send(send);
    });}finally{clearTimeout(timer);}
  }
  assert.deepEqual(await message(),{ready:true});
  return async(operation,input)=>{
    const result=await message({operation,input});assert.equal(result.ok,true,JSON.stringify(result));
    assert.deepEqual(await exited,{code:0,signal:null},stderr);return result;
  };
}
function mutation(f,source,operation) {
  const memory=f.db.prepare('SELECT id,revision FROM memories WHERE deleted=0').get();
  if(operation==='forget'||operation==='correct')return {namespace:ns,memoryId:memory.id,expectedRevision:memory.revision,
    ...(operation==='correct'?{content:'Synthetic replacement.',kind:'fact',receipt}:{})};
  if(operation==='forgetEpisode') {const row=f.db.prepare('SELECT id,revision FROM session_episodes WHERE deleted=0').get();
    return {namespace:ns,episodeId:row.id,expectedRevision:row.revision};}
  if(operation==='deleteConversation')return {namespace:ns,conversationId:source.conversationId,
    expectedRevision:source.expectedConversationRevision,actionId:'delete'};
  return {namespace:ns,conversationId:source.conversationId,messageId:source.messageId,start:1,end:3};
}

for(const operation of ['forget','correct','deleteConversation','forgetEpisode','exclude','fence'])test(`separate process ${operation} commits during opening and denies both intents`,{timeout:30000},async t=>{
  const port=localPlainPort();let armed=false,entered,release;
  const arrived=new Promise(resolve=>{entered=resolve;}),gate=new Promise(resolve=>{release=resolve;});t.after(()=>release());
  const open=port.openRaw;port.openRaw=async input=>{if(armed){entered();await gate;}return open(input);};
  const f=sourceFixture(t,{port,model,kind:operation==='forgetEpisode'?'episode':'ordinary'});
  const source=operation==='forgetEpisode'?await savedSource(f,'Synthetic copper telescope.',{episodeContext:{clientLabel:'Synthetic client',generation:'initial',origin:'ordinary'}}):await savedSource(f,'Synthetic copper telescope.'),s=await searchFixture(f);await s.maintain();
  const intent=operation==='forgetEpisode'?'history':'current';
  const hit=(await s.search({query:'copper',intent})).candidates[0];assert.ok(hit);
  const mutate=await mutator(t,f.path);armed=true;
  const opening=s.prepare(hit,intent);const refused=assert.rejects(opening);
  await arrived;
  await mutate(operation,mutation(f,source,operation));release();await refused;
  for(const intent of ['current','history'])assert.equal((await s.search({query:'copper',intent})).candidates.length,0);
  await s.tick();assert.equal((await s.service.status()).indexed,null);
});

for(const failure of ['missing','full','busy','broken'])test(`source delete commits with ${failure} sidecar and final validation denies stale preparation`,{timeout:30000},async t=>{
  const f=sourceFixture(t,{model}),source=await savedSource(f,'Synthetic copper telescope.'),s=await searchFixture(f,failure==='full'?{quotaBytes:65536}:{});
  await s.maintain();const hit=(await s.search({query:'copper'})).candidates[0],prepared=await s.prepare(hit);
  const path=join(s.directory,readdirSync(s.directory).find(name=>name.endsWith('.sqlite')));
  let index;
  if(failure==='missing')renameSync(path,path+'.offline');
  else {index=new DatabaseSync(path);t.after(()=>index.close());
    if(failure==='busy')index.exec('BEGIN EXCLUSIVE');
    if(failure==='full'){
      index.exec('CREATE TABLE quota_fill(data BLOB)');
      const pages=index.prepare('PRAGMA page_count').get().page_count;index.exec(`PRAGMA max_page_count=${pages+4}`);
      let full=false;for(let i=0;i<100;i++)try{index.exec('INSERT INTO quota_fill VALUES(zeroblob(4096))');}catch(error){
        assert.equal(error.errcode&255,13);full=true;break;}
      assert.ok(full,'actual SQLITE_FULL reached');
    }
    if(failure==='broken')index.exec('DROP TABLE segments');
  }
  const mutate=await mutator(t,f.path);
  // Legacy episode deletion routes through the canonical conversation cascade.
  const deleter=await import('../raw-capture.mjs');
  const core=deleter.openRawCaptureCore({path:f.path},{mode:'off',deletion:true,readPolicy:()=>{throw Error('unused');}});
  ok(core.deleteConversation({namespace:ns,conversationId:source.conversationId,
    expectedRevision:source.expectedConversationRevision,actionId:'delete'}));core.close();
  // A second real writer still commits an ordinary mutation while the derived
  // database remains broken or locked.
  await mutate('admit',{namespace:ns,memory:{content:'Independent synthetic fact.',kind:'fact'},receipts:[receipt]});
  assert.throws(()=>prepared.validate());assert.equal(f.db.prepare('SELECT count(*) n FROM raw_parts').get().n,0);
  if(failure==='busy')index.exec('ROLLBACK');
});

test('superseded overlap is history-only and final current validation rereads lineage',async t=>{
  const f=sourceFixture(t,{model}),source=await savedSource(f,'Synthetic copper telescope.'),s=await searchFixture(f);
  await s.maintain();const hit=(await s.search({query:'copper'})).candidates[0],prepared=await s.prepare(hit);
  const memory=f.db.prepare('SELECT id,revision FROM memories WHERE deleted=0').get();
  ok(f.core.supersede({namespace:ns,memoryId:memory.id,expectedRevision:memory.revision,
    replacement:{content:'Synthetic replacement.',kind:'fact'},receipts:[receipt]}));
  assert.throws(()=>prepared.validate());assert.equal((await s.search({query:'copper'})).candidates.length,0);
  // Old publication is a hint only; a fresh maintenance pass stamps history.
  await s.tick();const history=await s.search({query:'copper',intent:'history'});
  assert.equal(history.candidates.length,1);assert.equal(history.candidates[0].currentness,'historical');
  assert.equal((await s.prepare(history.candidates[0],'history')).validate().ranges[0].text,source.text);
});

// Each amended boundary has a named, deterministic cross-connection fixture.
// No transport is installed here; its consumer seam is exercised by tickets.
for(const safety of [false,true])for(const operation of ['forget','correct','exclude','deleteConversation','fence','revoke'])
test(`provider transmission after queue wait: ${operation}, suppression ${safety?'installed-empty':'absent'}`,{timeout:30000},async t=>{
  let arrived,release,armed=false,transmitted=0;
  const waiting=new Promise(resolve=>{arrived=resolve;}),gate=new Promise(resolve=>{release=resolve;});t.after(()=>release());
  const port={id:'synthetic-document-'+operation+'-'+safety,revision:'1',dimensions:2,normalization:'l2',async embed(texts,controls){
    if(armed){arrived();await gate;}
    controls.beforeDispatch();transmitted+=texts.length;return texts.map(()=>[1,0]);
  }};
  const f=safety?safetySourceFixture(t,{model}):sourceFixture(t,{model});
  const source=await savedSource(f,'Synthetic copper telescope.'),s=await searchFixture(f,{embedder:port,
    policy:{family:'local',maxBatchDocuments:1,maxRequests:12,maxConcurrent:1,maxUsd:0}});
  await s.maintain();
  const mutate=operation==='revoke'?null:await mutator(t,f.path);
  armed=true;
  const refreshing=s.tick({embeddings:true,maxMs:5000});
  assert.equal(await Promise.race([waiting.then(()=>true),refreshing.then(()=>false)]),true,'document refresh reaches queued adapter');
  if(operation==='revoke')s.host.revoke();else await mutate(operation,mutation(f,source,operation));
  release();await refreshing.catch(error=>assert.equal(error.code,'raw_search_unavailable'));
  assert.equal(transmitted,0,'actual adapter dispatch sends no denied document');
  assert.equal((await s.service.status()).indexed,null);
});

test('successive opener and counter/authority ports stop after an unchanged-epoch terminal fence',{timeout:30000},async t=>{
  const f=sourceFixture(t),source=await savedSource(f,'copper '.repeat(900)),open=f.port.openRaw;
  let calls=0,armed=false,mutate;
  f.port.openRaw=async input=>{if(armed){calls++;if(calls===1)await mutate('fence',mutation(f,source,'fence'));}return open(input);};
  const s=await searchFixture(f);await s.maintain();
  const hit=(await s.search({query:'copper'})).candidates[0];assert.ok(hit.ranges.length>1);
  mutate=await mutator(t,f.path);armed=true;
  await assert.rejects(s.prepare(hit),{code:'raw_search_unavailable'});
  assert.equal(calls,1,'no later opener receives retained ciphertext or metadata');
  assert.equal((await s.service.classify(hit,{},s.host.token)).kind,'denied');
});

test('fusion dependency manifest refuses a changed nonselected lexical child',{timeout:30000},async t=>{
  const f=sourceFixture(t),source=await savedSource(f,'Synthetic copper telescope.');
  ok(await f.core.captureRaw((await import('../testing/raw-source-fixtures.mjs')).request(
    (await import('../testing/raw-source-fixtures.mjs')).splitRaw('Synthetic copper adjacent.',{id:'sibling',ordinal:2})[0],{client:'codex',eventId:'sibling'})));
  const s=await searchFixture(f);await s.maintain();
  const hit=(await s.search({query:'copper'})).candidates.find(row=>row.messageId==='sibling');assert.ok(hit);
  const prepared=await s.prepare(hit),mutate=await mutator(t,f.path);
  await mutate('exclude',mutation(f,source,'exclude'));
  assert.throws(()=>s.service.revalidate([prepared.ticket]),{code:'raw_search_unavailable'});
  assert.equal((await s.service.classify(hit,{},s.host.token)).kind,'denied');
  // Fresh preparation can use independently valid data, without stale scores.
  const next=await s.search({query:'copper'});assert.equal(next.candidates.some(row=>row.messageId===source.messageId),false);
});

for(const whole of [false,true])test(`sibling and neighbor range exclusion: ${whole?'whole-message':'exact-disjoint'}`,{timeout:30000},async t=>{
  const f=sourceFixture(t),source=await savedSource(f,'copper '.repeat(900)),s=await searchFixture(f);
  await s.maintain();const hit=(await s.search({query:'copper'})).candidates[0],prepared=await s.prepare(hit);
  const mutate=await mutator(t,f.path);
  await mutate('exclude',{...mutation(f,source,'exclude'),start:whole?0:1,end:whole?source.text.length:3});
  assert.throws(()=>prepared.validate(),{code:'raw_search_unavailable'});
  const fresh=await s.search({query:'copper'});
  if(whole)assert.equal(fresh.candidates.length,0);
  else {assert.equal(fresh.candidates.length,1);assert.ok(fresh.candidates[0].ranges.every(ref=>ref.span.start>=4000));
    const survivor=await s.prepare(fresh.candidates[0]);assert.equal(survivor.value.ranges.length,1);
    assert.equal(survivor.value.ranges[0].text,source.text.slice(4000));}
});

test('offline reconciliation and stale coverage cannot republish after a fence without epoch movement',{timeout:30000},async t=>{
  const f=sourceFixture(t),source=await savedSource(f),s=await searchFixture(f);await s.maintain();
  const old=await s.search({query:'retained'});await s.service.close();
  const epoch=f.db.prepare('SELECT * FROM namespace_epochs').all(),mutate=await mutator(t,f.path);
  await mutate('fence',mutation(f,source,'fence'));assert.deepEqual(f.db.prepare('SELECT * FROM namespace_epochs').all(),epoch);
  await s.reopen();assert.equal((await s.search({query:'retained'})).candidates.length,0);
  await assert.rejects(s.prepare(old.candidates[0]),{code:'stale_publication'});
  await s.tick();assert.equal((await s.service.status()).coverage,'unknown');
});

test('status errors and maintenance acknowledgement contain no stale population or source details',{timeout:30000},async t=>{
  const f=sourceFixture(t,{model}),source=await savedSource(f,'Synthetic copper telescope.'),s=await searchFixture(f);await s.maintain();
  const mutate=await mutator(t,f.path);await mutate('forget',mutation(f,source,'forget'));
  const index=new DatabaseSync(join(s.directory,readdirSync(s.directory).find(name=>name.endsWith('.sqlite'))));t.after(()=>index.close());
  index.exec('DROP TABLE segments');
  const status=await s.service.status();assert.equal(status.state,'unavailable');assert.equal(status.indexed,null);
  let error;try{await s.tick();}catch(failure){error=failure;}
  assert.equal(error.code,'raw_search_unavailable');assert.equal(error.message,'raw_search_unavailable');
  for(const denied of ['copper',source.conversationId,source.messageId,'segments'])assert.equal(JSON.stringify(status).includes(denied),false);
});

test('snapshot reuse and consumer wait call fresh ticket validation; restart and scope changes refuse',{timeout:30000},async t=>{
  const f=sourceFixture(t),source=await savedSource(f),s=await searchFixture(f);await s.maintain();
  const candidate=(await s.search({query:'retained'})).candidates[0],prepared=await s.prepare(candidate);
  const ticket=structuredClone(prepared.ticket),mutate=await mutator(t,f.path);
  let sends=0;
  // Simulated IPC/host queue: the consumer retains the ticket, not authority.
  await mutate('fence',mutation(f,source,'fence'));
  assert.throws(()=>{s.service.revalidate([ticket]);sends++;},{code:'raw_search_unavailable'});assert.equal(sends,0);
  await s.reopen();assert.throws(()=>s.service.revalidate([ticket]),{code:'raw_search_unavailable'});
});

for(const state of ['removed-binding','unreadable','same-body-growth'])test(`denied dependent Card does not veto privacy with broken cleanup: ${state}`,{timeout:30000},async t=>{
  const {resolve,anchor,draft}=await import('../testing/raw-source-fixtures.mjs');
  const f=sourceFixture(t,{model}),source=await savedSource(f),refs=await resolve(f,[anchor(source)]);
  const card=ok(draft(f,refs,'card-'+state));
  if(state==='same-body-growth'){
    const second=await savedSource(f,'Synthetic additional source.',{sessionId:'second'});
    const extra=await resolve(f,[anchor(second)]);
    const before=f.db.prepare('SELECT title,body FROM private_cards WHERE id=?').get(card.id);
    ok(f.call('editCardDraft',{namespace:ns,cardId:card.id,expectedRevision:card.revision,actionId:'grow',
      title:before.title,body:before.body,bindings:[...refs,...extra]}));
    assert.equal(f.db.prepare('SELECT body FROM private_cards WHERE id=?').get(card.id).body,before.body);
  }
  if(state==='removed-binding')f.db.prepare('DELETE FROM card_raw_bindings WHERE card_id=?').run(card.id);
  if(state==='unreadable'){const row=f.db.prepare('SELECT source_ref FROM card_raw_bindings WHERE card_id=?').get(card.id);
    const ref=JSON.parse(row.source_ref);ref.contentIdentity='x'.repeat(43);
    f.db.prepare('UPDATE card_raw_bindings SET source_ref=? WHERE card_id=?').run(JSON.stringify(ref),card.id);}
  // Lineage-zero Cards are never consumed by this service; current bindings
  // cannot prove same-body ancestry. Mutation safety remains independent.
  const s=await searchFixture(f);await s.maintain();
  const index=new DatabaseSync(join(s.directory,readdirSync(s.directory).find(name=>name.endsWith('.sqlite'))));t.after(()=>index.close());
  index.exec('DROP TABLE segments');
  const mutate=await mutator(t,f.path);await mutate('forget',mutation(f,source,'forget'));
  assert.equal(f.db.prepare('SELECT deleted FROM memories LIMIT 1').get().deleted,1);
});

test('derived copy restore and upload remain non-serving without canonical validation',{timeout:30000},async t=>{
  const f=sourceFixture(t),source=await savedSource(f),s=await searchFixture(f);await s.maintain();
  assert.equal(s.service.export,undefined);assert.equal(s.service.upload,undefined);
  const candidate=(await s.search({query:'retained'})).candidates[0],mutate=await mutator(t,f.path);
  await s.service.close();
  const path=join(s.directory,readdirSync(s.directory).find(name=>name.endsWith('.sqlite'))),backup=path+'.backup';
  const {copySqliteFixture}=await import('../testing/content-safety-s2h-fixture.mjs');
  copySqliteFixture(path,backup);
  await mutate('fence',mutation(f,source,'fence'));
  renameSync(path,path+'.inactive');renameSync(backup,path);
  // An actual offline copy is restored; its stale rows cannot grant authority.
  attestRawSearchCopy(f,path);
  await s.reopen();assert.equal((await s.search({query:'retained'})).candidates.length,0);
  assert.equal((await s.service.classify(candidate,{},s.host.token)).kind,'denied');
});

for(const damaged of ['missing-maps','missing-lineage','unknown-origin','foreign-ancestry'])
test(`unknown privacy ancestry denies both intents: ${damaged}`,async t=>{
  const f=sourceFixture(t,{model}),source=await savedSource(f),s=await searchFixture(f);await s.maintain();
  const candidate=(await s.search({query:'retained'})).candidates[0];assert.ok(candidate);
  if(damaged==='missing-maps')f.db.exec('DELETE FROM raw_source_maps');
  else if(damaged==='missing-lineage')f.db.exec('DELETE FROM raw_receipt_lineage');
  else if(damaged==='unknown-origin')f.db.exec("UPDATE raw_receipt_origins SET kind='unknown'");
  else f.db.exec("UPDATE memories SET owner_id='foreign-owner'");
  for(const intent of ['current','history'])assert.equal((await s.search({query:'retained',intent})).candidates.length,0);
  assert.equal((await s.service.classify(candidate,{},s.host.token)).kind,'denied');
});

for(const failure of ['missing','full','busy','broken'])for(const operation of ['forget','correct','deleteConversation','forgetEpisode'])
test(`canonical ${operation} commits independently of ${failure} index`,{timeout:30000},async t=>{
  const f=sourceFixture(t,{model,kind:operation==='forgetEpisode'?'episode':'ordinary'});
  const source=await savedSource(f,'Synthetic copper telescope.',operation==='forgetEpisode'?
    {episodeContext:{clientLabel:'Synthetic client',generation:'initial',origin:'ordinary'}}:{});
  const s=await searchFixture(f,failure==='full'?{quotaBytes:65536}:{});await s.maintain();
  const intent=operation==='forgetEpisode'?'history':'current';
  const candidate=(await s.search({query:'copper',intent})).candidates[0],prepared=await s.prepare(candidate,intent);
  const path=join(s.directory,readdirSync(s.directory).find(name=>name.endsWith('.sqlite')));
  let index;
  if(failure==='missing')renameSync(path,path+'.offline');
  else {index=new DatabaseSync(path);t.after(()=>index.close());
    if(failure==='busy')index.exec('BEGIN EXCLUSIVE');
    if(failure==='broken')index.exec('DROP TABLE segments');
    if(failure==='full'){
      index.exec('CREATE TABLE fill(data BLOB)');
      const pages=index.prepare('PRAGMA page_count').get().page_count;index.exec(`PRAGMA max_page_count=${pages+3}`);
      let full=false;for(let i=0;i<10;i++)try{index.exec('INSERT INTO fill VALUES(zeroblob(16384))');}catch(error){assert.equal(error.errcode&255,13);full=true;break;}
      assert.ok(full);
    }
  }
  const mutate=await mutator(t,f.path);await mutate(operation,mutation(f,source,operation));
  assert.throws(()=>prepared.validate(),{code:'raw_search_unavailable'});
  const status=await s.service.status();assert.equal(status.indexed,null);assert.equal(status.embedded,null);
  if(failure==='busy')index.exec('ROLLBACK');
});

for(const result of ['valid','throws','invalid'])test(`consumer counter callback ${result} cannot pass retained text to a later port`,{timeout:30000},async t=>{
  const f=sourceFixture(t),source=await savedSource(f),s=await searchFixture(f);await s.maintain();
  const candidate=(await s.search({query:'retained'})).candidates[0],prepared=await s.prepare(candidate),mutate=await mutator(t,f.path);
  let calls=0;
  async function count(){const [value]=s.service.revalidate([prepared.ticket]);calls++;
    assert.equal(value.ranges[0].text,source.text);
    await mutate('fence',mutation(f,source,'fence'));
    if(result==='throws')throw Error('synthetic counter failure');return result==='invalid'?NaN:1;
  }
  await count().catch(()=>{});
  assert.throws(()=>{s.service.revalidate([prepared.ticket]);calls++;},{code:'raw_search_unavailable'});
  assert.equal(calls,1);
});

test('authority callback that commits a fence blocks the next source-bearing authority callback',async t=>{
  const f=sourceFixture(t),source=await savedSource(f);let armed=false,after=0;
  const s=await searchFixture(f,{setupHost(host){const current=host.authority.isCurrent;
    host.authority.isCurrent=(grant,request)=>{if(armed){after++;const row=f.db.prepare('SELECT * FROM raw_conversations WHERE id=?').get(source.conversationId);
      f.db.prepare('INSERT OR IGNORE INTO raw_session_fences VALUES(?,?,?,?,?)').run(row.owner_id,row.scope,row.project_id,row.client,row.session_key);}
      return current(grant,request);};}});
  await s.maintain();const candidate=(await s.search({query:'retained'})).candidates[0];armed=true;
  await assert.rejects(s.prepare(candidate),{code:'raw_search_unavailable'});assert.equal(after,1);
  assert.equal(f.db.prepare('SELECT count(*) n FROM raw_session_fences').get().n,1);
});

test('owner erasure from an initially empty fact set denies stale hints in both intents',{timeout:30000},async t=>{
  const f=safetySourceFixture(t),source=await savedSource(f),s=await searchFixture(f);await s.maintain();
  assert.equal(f.db.prepare('SELECT count(*) n FROM content_suppressions').get().n,0);
  const candidate=(await s.search({query:'retained'})).candidates[0],prepared=await s.prepare(candidate),mutate=await mutator(t,f.path);
  await mutate('erase',mutation(f,source,'erase'));assert.throws(()=>prepared.validate(),{code:'raw_search_unavailable'});
  for(const intent of ['current','history'])assert.equal((await s.search({query:'retained',intent})).candidates.length,0);
  assert.equal((await s.service.status()).indexed,null);await s.tick();assert.equal(s.indexCount(),0);
});

test('hosted price callback fence blocks the following document provider dispatch',{timeout:30000},async t=>{
  const f=sourceFixture(t),source=await savedSource(f,'Synthetic copper telescope.');let calls=0,armed=false;
  const port={id:'synthetic-priced-document',revision:'1',dimensions:2,normalization:'l2',async embed(texts,controls){
    controls.beforeDispatch();calls++;return texts.map(()=>[1,0]);}};
  const s=await searchFixture(f,{embedder:port,policy:{family:'hosted',maxRequests:10,maxConcurrent:1,maxUsd:1,
    estimateUsd(texts){assert.ok(texts[0].includes('copper'));if(armed){const row=f.db.prepare('SELECT * FROM raw_conversations WHERE id=?').get(source.conversationId);
      f.db.prepare('INSERT OR IGNORE INTO raw_session_fences VALUES(?,?,?,?,?)').run(row.owner_id,row.scope,row.project_id,row.client,row.session_key);}return 0;}}});
  await s.maintain();armed=true;await s.tick({embeddings:true,maxMs:5000});assert.equal(calls,0);
  assert.equal((await s.search({query:'copper'})).candidates.length,0);
});

test('queued multi-chunk hosted document batch denies every child before transmission',{timeout:30000},async t=>{
  let entered,release,armed=false,sent=0,batch=0;
  const arrived=new Promise(resolve=>{entered=resolve;}),gate=new Promise(resolve=>{release=resolve;});t.after(()=>release());
  const port={id:'synthetic-document-batch',revision:'1',dimensions:2,normalization:'l2',async embed(texts,controls){batch=texts.length;
    if(armed){entered();await gate;}controls.beforeDispatch();sent+=texts.length;return texts.map(()=>[1,0]);}};
  const f=sourceFixture(t),source=await savedSource(f,'copper '+'铜'.repeat(3000)),s=await searchFixture(f,{embedder:port,
    policy:{family:'hosted',maxRequests:10,maxConcurrent:1,maxUsd:1,estimateUsd:()=>0}});
  await s.maintain();const mutate=await mutator(t,f.path);armed=true;
  const refreshing=s.tick({embeddings:true,maxMs:5000});assert.equal(await Promise.race([arrived.then(()=>true),refreshing.then(()=>false)]),true);
  await mutate('exclude',mutation(f,source,'exclude'));release();await refreshing;
  assert.ok(batch>1);assert.equal(sent,0);
});

test('a disjoint small source ref cannot send a denied containing part to the Raw opener',{timeout:30000},async t=>{
  const {resolve,anchor}=await import('../testing/raw-source-fixtures.mjs');
  const f=sourceFixture(t),source=await savedSource(f,'Synthetic copper telescope.'),refs=await resolve(f,[anchor(source,0,4)]);
  let opens=0;const open=f.port.openRaw;f.port.openRaw=async input=>{opens++;return open(input);};
  const s=await searchFixture(f),mutate=await mutator(t,f.path);
  await mutate('exclude',{...mutation(f,source,'exclude'),start:8,end:10});
  await assert.rejects(s.service.prepareSource(refs[0],{},s.host.token),{code:'raw_search_unavailable'});
  assert.equal(opens,0);
});

import {installRawSearchTestClock} from '../testing/raw-search-clock.mjs';
import test from 'node:test';
test.beforeEach(installRawSearchTestClock);
import assert from 'node:assert/strict';
import {fork,spawnSync} from 'node:child_process';
import {DatabaseSync} from 'node:sqlite';
import {performance} from 'node:perf_hooks';
import {readdirSync,lstatSync} from 'node:fs';
import {join} from 'node:path';
import {sourceFixture,savedSource,ns,ok,request,splitRaw,resolve,anchor} from '../testing/raw-source-fixtures.mjs';
import {searchFixture,attestRawSearchCopy} from '../testing/raw-search-fixtures.mjs';
import {openRawSearch} from '../raw-search-index.mjs';
import {reserveSharedVectors} from '../context-read-embedder.mjs';

async function writer(t,path){
  const child=fork(new URL('../testing/raw-search-mutation-child.mjs',import.meta.url),[path],{stdio:['ignore','ignore','pipe','ipc']});
  t.after(()=>child.kill());let stderr='';child.stderr.on('data',d=>stderr+=d);
  const exited=new Promise(resolve=>child.once('exit',(code,signal)=>resolve({code,signal})));
  async function next(value){let timer;try{return await new Promise((resolve,reject)=>{
    timer=setTimeout(()=>{child.kill();reject(Error('synthetic_writer_timeout'));},10000);
    child.once('message',resolve);child.once('error',reject);if(value)child.send(value);
  });}finally{clearTimeout(timer);}}
  assert.deepEqual(await next(),{ready:true});
  return async(operation,input)=>{assert.equal((await next({operation,input})).ok,true);assert.deepEqual(await exited,{code:0,signal:null},stderr);};
}
function withoutLocks(t){
  const exec=DatabaseSync.prototype.exec,connections=new Set();
  DatabaseSync.prototype.exec=function(sql){connections.add(this);return exec.call(this,sql);};
  t.after(()=>{DatabaseSync.prototype.exec=exec;});
  return ()=>{for(const db of connections)if(db.isOpen)assert.equal(db.isTransaction,false,'caller port must not run under a SQLite transaction');};
}
const model={extract:()=>({items:[{content:'Synthetic copper fact.',kind:'fact',confidence:.8,sourceIndices:[0]}]})};

function filesystemChild(code,args){
  const result=spawnSync(process.execPath,['--input-type=module','-e',code,...args],{encoding:'utf8',timeout:5000,maxBuffer:8192});
  assert.equal(result.error,undefined);assert.equal(result.signal,null);assert.equal(result.status,0,result.stderr);
}
const journalAlias=(target,link)=>filesystemChild("import {symlinkSync} from 'node:fs';symlinkSync(process.argv[1],process.argv[2]);",[target,link]);

function functionalClock(t){
  const descriptor=Object.getOwnPropertyDescriptor(performance,'now'),at=performance.now();
  Object.defineProperty(performance,'now',{configurable:true,value:()=>at});
  t.after(()=>{if(descriptor)Object.defineProperty(performance,'now',descriptor);else delete performance.now;});
}

test('G1 actual document transmission after unchanged-epoch fence, multi-chunk batch',{timeout:30000},async t=>{
  const noLocks=withoutLocks(t);let enter,release,armed=false,sent=0,batch=0;
  const arrived=new Promise(r=>enter=r),gate=new Promise(r=>release=r);t.after(()=>release());
  const port={id:'synthetic-provider',revision:'1',dimensions:2,normalization:'l2',async embed(texts,controls){
    noLocks();batch=texts.length;if(armed){enter();await gate;}
    noLocks();controls.beforeDispatch();sent+=texts.length;return texts.map(()=>[1,0]);
  }};
  const f=sourceFixture(t),source=await savedSource(f,'copper '+'铜'.repeat(3000)),s=await searchFixture(f,{embedder:port,
    policy:{family:'hosted',maxRequests:12,maxConcurrent:1,maxUsd:1,estimateUsd:()=>0}});
  await s.maintain();const mutate=await writer(t,f.path),epochs=f.db.prepare('SELECT * FROM namespace_epochs').all();armed=true;
  const work=s.tick({embeddings:true,maxMs:5000});
  assert.equal(await Promise.race([arrived.then(()=>true),work.then(()=>false)]),true);
  await mutate('fence',{conversationId:source.conversationId});assert.deepEqual(f.db.prepare('SELECT * FROM namespace_epochs').all(),epochs);
  release();await work;assert.ok(batch>1);assert.equal(sent,0);
});

test('G4 semantic plus lexical dependency denied while another candidate opens',{timeout:30000},async t=>{
  const f=sourceFixture(t),source=await savedSource(f,'copper alpha '+'x'.repeat(4100)),open=f.port.openRaw;
  ok(await f.core.captureRaw(request(splitRaw('copper beta',{id:'sibling',ordinal:2})[0],{client:'codex',eventId:'sibling'})));
  assert.equal(f.db.prepare("SELECT conversation_id FROM raw_messages WHERE message_id='sibling'").get().conversation_id,source.conversationId);
  const port={id:'synthetic-fusion',revision:'1',dimensions:2,normalization:'l2',async embed(texts,c){c.beforeDispatch();return texts.map(()=>[1,0]);}};
  const s=await searchFixture(f,{embedder:port,policy:{family:'local',maxBatchDocuments:1,maxRequests:30,maxConcurrent:1,maxUsd:0}});
  await s.maintain();for(let i=0;i<6;i++)await s.tick({embeddings:true});
  const result=await s.search({query:'copper'});assert.equal(result.semantic.state,'ready');
  const candidate=result.candidates.find(c=>c.messageId==='sibling');assert.ok(candidate);
  assert.deepEqual(candidate.namespace,ns);assert.equal(candidate.conversationId,source.conversationId);
  const dependency=result.candidates.find(c=>c.messageId===source.messageId);assert.ok(dependency);
  assert.equal(dependency.ranges.length,2);
  assert.ok(dependency.ranges.every(ref=>ref.messageId===source.messageId&&ref.conversationId===candidate.conversationId));
  const mutate=await writer(t,f.path);let opens=0;
  f.port.openRaw=async input=>{opens++;await mutate('exclude',{conversationId:source.conversationId,messageId:source.messageId,start:0,end:source.text.length});return open(input);};
  await s.reopen();const again=await s.search({query:'copper'});assert.equal(again.semantic.state,'ready');
  const fresh=again.candidates.find(c=>c.messageId==='sibling');assert.ok(fresh);assert.deepEqual(fresh.namespace,ns);
  await assert.rejects(s.prepare(fresh),{code:'raw_search_unavailable'});assert.equal(opens,1);
  f.port.openRaw=open;
  const next=await s.search({query:'copper'});assert.ok(next.candidates.every(c=>c.messageId!==source.messageId));
});

test('G2 stale count and source-bearing index errors stay private',{timeout:30000},async t=>{
  const f=sourceFixture(t,{model}),source=await savedSource(f,'copper confidential specimen'),s=await searchFixture(f);await s.maintain();
  const memory=f.db.prepare('SELECT id,revision FROM memories WHERE deleted=0').get(),mutate=await writer(t,f.path);
  await mutate('forget',{namespace:ns,memoryId:memory.id,expectedRevision:memory.revision});
  let status=await s.service.status();assert.equal(status.indexed,null);assert.equal(status.eligible,null);assert.equal(status.coverage,'unknown');
  const db=new DatabaseSync(join(s.directory,readdirSync(s.directory).find(n=>n.endsWith('.sqlite'))));t.after(()=>db.close());db.exec('DROP TABLE segments');
  status=await s.service.status();assert.equal(status.state,'unavailable');
  await assert.rejects(s.tick(),e=>e.code==='raw_search_unavailable'&&e.message==='raw_search_unavailable');
  const json=JSON.stringify(status);for(const value of [source.conversationId,source.messageId,'copper','segments'])assert.equal(json.includes(value),false);
});

test('G3 unknown ancestry history and direct source expansion both refuse',{timeout:30000},async t=>{
  const f=sourceFixture(t,{model}),source=await savedSource(f),refs=await resolve(f,[anchor(source)]),s=await searchFixture(f);await s.maintain();
  f.db.exec('DELETE FROM raw_receipt_lineage');
  for(const intent of ['current','history']){
    assert.equal((await s.search({query:'retained',intent})).candidates.length,0);
    await assert.rejects(s.service.prepareSource(refs[0],{intent},s.host.token),{code:'raw_search_unavailable'});
  }
});

test('G5 repeated ticket validation remains fresh after a different read refreshes its cache',{timeout:30000},async t=>{
  const f=sourceFixture(t),source=await savedSource(f),s=await searchFixture(f);await s.maintain();
  const candidate=(await s.search({query:'retained'})).candidates[0],prepared=await s.prepare(candidate);
  assert.equal(s.service.revalidate([prepared.ticket])[0].ranges[0].text,source.text);
  const mutate=await writer(t,f.path);await mutate('fence',{conversationId:source.conversationId});
  assert.equal((await s.search({query:'retained'})).candidates.length,0);
  assert.throws(()=>s.service.revalidate([prepared.ticket]),{code:'raw_search_unavailable'});
});

test('G6 no export or hosted backend; restored offline sidecar cannot authorize',{timeout:30000},async t=>{
  const f=sourceFixture(t),source=await savedSource(f),s=await searchFixture(f);await s.maintain();
  for(const method of ['export','upload','backup'])assert.equal(s.service[method],undefined);
  await assert.rejects(openRawSearch({...s.options,backend:'hosted'}),{code:'raw_search_backend_unavailable'});
  await s.service.close();const path=join(s.directory,readdirSync(s.directory).find(n=>n.endsWith('.sqlite')));
  const {copySqliteFixture}=await import('../testing/content-safety-s2h-fixture.mjs');copySqliteFixture(path,path+'.backup');
  const mutate=await writer(t,f.path);await mutate('fence',{conversationId:source.conversationId});filesystemChild("import {renameSync} from 'node:fs';const p=process.argv[1];renameSync(p,p+'.old');renameSync(p+'.backup',p);",[path]);
  attestRawSearchCopy(f,path);
  await s.reopen();assert.equal((await s.search({query:'retained'})).candidates.length,0);
});

test('G7 capture controls preserve saved prefix and never backfill skipped suffix',{timeout:30000},async t=>{
  const f=sourceFixture(t),parts=splitRaw('copper '.repeat(900));
  ok(await f.core.captureRaw(request(parts[0],{eventId:'first'})));
  f.policy.reason='notice_required';ok(await f.core.captureRaw(request(parts[1],{eventId:'second'})));
  const before=f.db.prepare('SELECT part_index,saved,sealed FROM raw_parts ORDER BY part_index').all();assert.equal(before[0].saved,1);assert.equal(before[1].saved,0);
  f.policy.reason=null;const s=await searchFixture(f);await s.maintain();
  const c=(await s.search({query:'copper'})).candidates[0];assert.equal(c.ranges.length,1);
  const p=await s.prepare(c);assert.equal(p.value.ranges[0].text,parts[0].content);
  await s.tick();assert.deepEqual(f.db.prepare('SELECT part_index,saved,sealed FROM raw_parts ORDER BY part_index').all(),before);
});

test('sidecar rejects a companion symlink introduced after attachment',{timeout:30000},async t=>{
  const f=sourceFixture(t);await savedSource(f);const s=await searchFixture(f);await s.maintain();
  const path=join(s.directory,readdirSync(s.directory).find(n=>n.endsWith('.sqlite')));
  journalAlias(f.path,path+'-journal');assert.equal(lstatSync(path+'-journal').isSymbolicLink(),true);
  const status=await s.service.status();assert.equal(status.state,'unavailable','unsafe post-open companions must refuse before using SQLite');
});

test('G1 G2 maintenance inventory cannot publish after an opener commits a terminal fence',{timeout:30000},async t=>{
  const f=sourceFixture(t),source=await savedSource(f),mutate=await writer(t,f.path),open=f.port.openRaw;
  const epochs=f.db.prepare('SELECT * FROM namespace_epochs').all();let opens=0;
  f.port.openRaw=async input=>{if(opens++===0)await mutate('fence',{conversationId:source.conversationId});return open(input);};
  const s=await searchFixture(f);await s.maintain().catch(error=>assert.equal(error.code,'raw_search_unavailable'));
  assert.equal(opens,1,'the fence lands in the opener after the inventory read');
  assert.equal(f.db.prepare('SELECT count(*) n FROM raw_session_fences').get().n,1);
  assert.deepEqual(f.db.prepare('SELECT * FROM namespace_epochs').all(),epochs);
  assert.equal(s.indexCount(),0);assert.equal((await s.service.status()).coverage,'unknown');
  assert.equal((await s.search({query:'retained'})).candidates.length,0);
});

test('G4 contributor manifest remains complete when the global inventory bound is exhausted',{timeout:60000},async t=>{
  const f=sourceFixture(t),source=await savedSource(f,'copper alpha');
  ok(await f.core.captureRaw(request(splitRaw('copper beta',{id:'sibling',ordinal:2})[0],{client:'codex',eventId:'sibling'})));
  assert.equal(f.db.prepare("SELECT conversation_id FROM raw_messages WHERE message_id='sibling'").get().conversation_id,source.conversationId);
  const s=await searchFixture(f);await s.maintain();
  // Freeze only the functional test clock: source authority and every SQLite
  // row/commit stay real, and machine throughput cannot decide this privacy test.
  const clock=Object.getOwnPropertyDescriptor(performance,'now'),at=performance.now();
  Object.defineProperty(performance,'now',{configurable:true,value:()=>at});
  t.after(()=>{if(clock)Object.defineProperty(performance,'now',clock);else delete performance.now;});
  // Exhaust only the metadata inventory. There are still just two search rows.
  f.db.prepare(`WITH RECURSIVE n(i) AS (SELECT 1 UNION ALL SELECT i+1 FROM n WHERE i<50001)
    INSERT INTO raw_conversations SELECT 'empty-'||i,?,?,?,'codex','empty-'||i,1,'synthetic','synthetic' FROM n`)
    .run(ns.ownerId,ns.scope,ns.projectId??'');
  const {openReadDatabase}=await import('../read-database.mjs'),{createRawSearchAuthority}=await import('../raw-search-authority.mjs');
  const reader=openReadDatabase(f.path,{contextRead:true});
  try{assert.throws(()=>createRawSearchAuthority(reader,s.options).fence(),{code:'source_budget_exceeded'});}finally{reader.db.close();}
  const candidate=(await s.search({query:'copper'})).candidates.find(c=>c.messageId==='sibling');assert.ok(candidate);
  assert.deepEqual(candidate.namespace,ns);assert.equal(candidate.conversationId,source.conversationId);
  const prepared=await s.prepare(candidate),mutate=await writer(t,f.path);
  await mutate('exclude',{conversationId:source.conversationId,messageId:source.messageId,start:0,end:source.text.length});
  await assert.rejects(s.prepare(candidate),{code:'raw_search_unavailable'});
  assert.throws(()=>s.service.revalidate([prepared.ticket]),{code:'raw_search_unavailable'});
});

test('journal aliases cannot drop another live canonical SQLite read lock',{timeout:30000},async t=>{
  const f=sourceFixture(t);await savedSource(f);const s=await searchFixture(f);await s.maintain();
  const path=join(s.directory,readdirSync(s.directory).find(n=>n.endsWith('.sqlite')));
  const child=`import {DatabaseSync} from 'node:sqlite';
import {performance} from 'node:perf_hooks';
    const db=new DatabaseSync(process.argv[1]);db.exec('PRAGMA busy_timeout=0');
    try{db.exec('BEGIN EXCLUSIVE');db.exec('ROLLBACK');process.exitCode=0;}
    catch(error){process.exitCode=(error.errcode&255)===5?2:3;}
    finally{db.close();}`;
  const attempt=()=>spawnSync(process.execPath,['--input-type=module','-e',child,f.path],{encoding:'utf8',timeout:5000});
  // Every operation while the canonical read is open is synchronous. Its
  // transaction is closed before awaiting the status Promise.
  f.db.exec('BEGIN');f.db.prepare('SELECT * FROM store_metadata').get();
  let before,after,status;
  try{
    before=attempt();assert.equal(before.status,2,before.stderr);
    journalAlias(f.path,path+'-journal');
    status=s.service.status();
    after=attempt();
  }finally{f.db.exec('ROLLBACK');}
  const view=await status;t.diagnostic(JSON.stringify({before:before.status,after:after.status,state:view.state}));
  assert.equal(after.status,2,'sidecar journal open/close must preserve the canonical SHARED lock');
});

for(const cache of [false,true])for(const intent of ['current','history'])for(const change of ['receipt-text','foreign-edge'])
test(`fresh search cannot revive old classification or sibling ticket: ${change}, ${intent}, cache ${cache}`,{timeout:30000},async t=>{
  let extractions=0;
  const onlyFirst={extract:()=>({items:extractions++===0?
    [{content:'Synthetic copper fact.',kind:'fact',confidence:.8,sourceIndices:[0]}]:[]})};
  const f=sourceFixture(t,{model:onlyFirst}),source=await savedSource(f,'copper alpha');
  ok(await f.core.captureRaw(request(splitRaw('copper beta',{id:'sibling',ordinal:2})[0],{client:'codex',eventId:'sibling'})));
  assert.equal(f.db.prepare("SELECT conversation_id FROM raw_messages WHERE message_id='sibling'").get().conversation_id,source.conversationId);
  const port={id:'synthetic-refresh',revision:'1',dimensions:2,normalization:'l2',async embed(texts,c){c.beforeDispatch();return texts.map(()=>[1,0]);}};
  const s=await searchFixture(f,{embedder:port,policy:{family:cache?'local':'hosted',maxBatchDocuments:1,
    maxRequests:30,maxConcurrent:1,maxUsd:1,estimateUsd:()=>0}});
  await s.maintain();for(let i=0;i<4;i++)await s.tick({embeddings:true});
  functionalClock(t); // Ticket expiry must not hide a failed dependency check.
  const old=await s.search({query:'copper',intent});assert.equal(old.semantic.state,'ready');
  const capacity=reserveSharedVectors(20000,port);
  if(cache)assert.equal(capacity,null,'local search actually retains vector blocks');
  else{assert.ok(capacity,'hosted policy actually leaves the cache off');capacity.release();}
  const a=old.candidates.find(c=>c.messageId===source.messageId),b=old.candidates.find(c=>c.messageId==='sibling');assert.ok(a);assert.ok(b);
  assert.deepEqual(a.namespace,ns);assert.deepEqual(b.namespace,ns);
  assert.equal(a.classification.kind,'current-eligible-linked');assert.equal(b.classification.kind,'current-eligible-bare');
  const prepared=await s.prepare(b,intent),receipt=f.db.prepare('SELECT r.* FROM receipts r JOIN raw_receipt_lineage l ON l.receipt_id=r.id WHERE l.message_id=?').get(source.messageId);assert.ok(receipt);
  // This fixture connection is distinct from the service's read-only connection.
  assert.equal(f.db.prepare('PRAGMA foreign_keys').get().foreign_keys,1);
  if(change==='receipt-text'){
    f.db.prepare("UPDATE receipts SET excerpt=excerpt||' damaged' WHERE id=?").run(receipt.id);
    assert.equal(f.db.prepare('SELECT receipt_key FROM receipts WHERE id=?').get(receipt.id).receipt_key,receipt.receipt_key);
  }else{
    f.db.exec('BEGIN IMMEDIATE');
    try{
      const foreign='foreign-conversation';
      f.db.prepare('INSERT INTO raw_conversations VALUES(?,?,?,?,?,?,1,?,?)').run(foreign,'foreign-owner',ns.scope,'','codex','foreign-session','synthetic','synthetic');
      const row=f.db.prepare('SELECT * FROM raw_messages WHERE conversation_id=? AND message_id=?').get(source.conversationId,source.messageId);
      row.conversation_id=foreign;
      f.db.prepare('INSERT INTO raw_messages VALUES('+Object.values(row).map(()=>'?').join(',')+')').run(...Object.values(row));
      f.db.prepare('INSERT INTO raw_receipt_lineage VALUES(?,?,?,?,?,?)').run(receipt.id,foreign,source.messageId,0,source.text.length,'exact');
      f.db.exec('COMMIT');
    }catch(error){f.db.exec('ROLLBACK');throw error;}
  }
  assert.deepEqual(f.db.prepare('PRAGMA foreign_key_check').all(),[]);
  // Refresh both eligibility and vector-cache state before checking old proofs.
  const fresh=await s.search({query:'copper',intent});
  assert.ok(fresh.candidates.every(c=>c.messageId!==source.messageId));
  assert.ok(fresh.candidates.some(c=>c.messageId==='sibling'));
  assert.deepEqual(await s.service.classify(a,{intent},s.host.token),{kind:'denied',reason:'source-or-authority-unavailable'});
  assert.throws(()=>s.service.revalidate([prepared.ticket]),{code:'raw_search_unavailable'});
});

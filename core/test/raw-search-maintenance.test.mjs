import {installRawSearchTestClock} from '../testing/raw-search-clock.mjs';
import assert from 'node:assert/strict';
import test from 'node:test';
test.beforeEach(installRawSearchTestClock);
import { sourceFixture,savedSource,ns,ok,request,splitRaw } from '../testing/raw-source-fixtures.mjs';
import { searchFixture } from '../testing/raw-search-fixtures.mjs';
import { createFakeEmbedder } from '../context-read-embedder.mjs';

test('append/replay, restart and no-change reconciliation do not reopen unchanged text',async t=>{
  const f=sourceFixture(t),source=await savedSource(f,'Synthetic copper telescope.');
  const open=f.port.openRaw;let opened=0;f.port.openRaw=async input=>{opened++;return open(input);};
  const s=await searchFixture(f);await s.maintain();const first=opened;
  assert.ok(first>0);await s.tick();assert.equal(opened,first);
  await s.reopen();await s.tick();assert.equal(opened,first);
  ok(await f.core.captureRaw(request(splitRaw('Synthetic copper continuation.',{id:'second',ordinal:2})[0],{eventId:'second'})));
  await s.tick();assert.equal((await s.search({query:'copper'})).candidates.length,2);
  const usage=ok(f.core.getRawUsage({ownerId:ns.ownerId}));
  await s.tick();assert.deepEqual(ok(f.core.getRawUsage({ownerId:ns.ownerId})),usage);
  assert.equal(s.indexCount(),2);assert.equal((await s.service.status()).indexed,null);assert.equal(source.messageId,'message');
});
test('denial cleanup, quota and owner purge change no canonical Raw usage',async t=>{
  const f=sourceFixture(t),source=await savedSource(f,'Synthetic copper telescope.'),s=await searchFixture(f);
  await s.maintain();
  ok(f.core.deleteConversation({namespace:ns,conversationId:source.conversationId,
    expectedRevision:source.expectedConversationRevision,actionId:'delete'}));
  assert.equal((await s.search({query:'copper',intent:'history'})).candidates.length,0);
  await s.tick();assert.equal(s.indexCount(),0);assert.equal((await s.service.status()).indexed,null);
  await s.service.purge();assert.equal((await s.service.status()).indexed,null);
});
test('explicit embedding refresh uses shared selected port and query identity; partial degrades',async t=>{
  const port=createFakeEmbedder(),f=sourceFixture(t);await savedSource(f,'Synthetic copper telescope.');
  const s=await searchFixture(f,{embedder:port,policy:{family:'local',maxBatchDocuments:1,maxRequests:30,maxConcurrent:1,maxUsd:0}});
  await s.maintain();assert.equal((await s.search({query:'copper'})).semantic.state,'bm25-only');
  await s.tick({embeddings:true});await s.tick();
  const {id,revision,dimensions,normalization}=port;
  const [vector]=await port.embed(['copper']);
  const result=await s.search({query:'copper',queryVector:{input:'copper',embedder:{id,revision,dimensions,normalization},vector}});
  assert.equal(result.semantic.state,'ready');assert.equal(result.candidates.length,1);
  const mismatch=await s.search({query:'copper',queryVector:{input:'other',embedder:{id,revision,dimensions,normalization},vector}});
  assert.equal(mismatch.semantic.state,'bm25-only');
});

test('malformed document vectors require repair and do not inline retry or fail lexical reads',async t=>{
  let calls=0;
  const port={id:'synthetic-invalid-document',revision:'1',dimensions:2,normalization:'l2',async embed(texts,controls){
    controls.beforeDispatch();calls++;return texts.map(()=>[NaN,0]);}};
  const f=sourceFixture(t);await savedSource(f,'Synthetic copper telescope.');
  const s=await searchFixture(f,{embedder:port,policy:{family:'local',maxBatchDocuments:1,maxRequests:10,maxConcurrent:1,maxUsd:0}});
  await s.maintain();await s.tick({embeddings:true});await s.tick();await s.tick({embeddings:true});
  assert.equal(calls,1);const read=await s.search({query:'copper'});assert.equal(read.semantic.state,'bm25-only');assert.equal(read.candidates.length,1);
});

test('budget refusal creates no transmitted retry attempt and preserves lexical service',async t=>{
  let calls=0;const port={...createFakeEmbedder(),id:'synthetic-no-document-budget',async embed(){calls++;throw Error('unused');}};
  const f=sourceFixture(t);await savedSource(f,'Synthetic copper telescope.');
  const s=await searchFixture(f,{embedder:port,policy:{family:'local',maxBatchDocuments:1,maxRequests:0,maxConcurrent:1,maxUsd:0}});
  await s.maintain();await s.tick({embeddings:true});await s.reopen();
  assert.equal(calls,0);const result=await s.search({query:'copper'});assert.equal(result.semantic.state,'bm25-only');assert.equal(result.candidates.length,1);
});

test('local capture-only control revision reconciles without deleting or reopening saved ranges',async t=>{
  const {safetySourceFixture}=await import('../testing/raw-search-fixtures.mjs');
  const {createLocalAuthorityStorage}=await import('../local-authority-storage.mjs');
  const f=safetySourceFixture(t);await savedSource(f,'Synthetic copper telescope.');
  let opens=0;const open=f.port.openRaw;f.port.openRaw=async input=>{opens++;return open(input);};
  const s=await searchFixture(f);await s.maintain();const initial=opens;
  const controls=createLocalAuthorityStorage(f.db),storeId=f.db.prepare('SELECT store_id FROM store_metadata').get().store_id;
  const input={namespace:ns,client:'codex',targetId:'synthetic-target',expectedStoreId:storeId,
    expectedRevision:0,automaticCaptureEnabled:true,rawNoticeVersion:'local-plain-v1'};
  const before=controls.set(input),epoch=f.db.prepare('SELECT * FROM namespace_epochs').all();
  controls.set({...input,expectedRevision:before.revision,automaticCaptureEnabled:false,rawNoticeVersion:null});
  assert.deepEqual(f.db.prepare('SELECT * FROM namespace_epochs').all(),epoch);
  assert.equal((await s.search({query:'copper'})).candidates.length,1);await s.tick();
  assert.equal(opens,initial);assert.equal(s.indexCount(),1);
});

test('quota exhaustion stops positive work while denial reconciliation remains available',async t=>{
  const f=sourceFixture(t),text='copper '+Array.from({length:120},(_,i)=>'word'+i).join(' ');
  for(let i=1;i<=4;i++)ok(await f.core.captureRaw(request(splitRaw(text,{id:'message-'+i,ordinal:i})[0],{client:'codex',eventId:'event-'+i})));
  const s=await searchFixture(f,{quotaBytes:65536});await s.maintain({maxItems:1});
  let exhausted=false;
  for(let i=0;i<6;i++){const status=await s.tick({maxItems:1});if(status.error==='quota_exhausted'){exhausted=true;break;}}
  assert.equal(exhausted,true);assert.ok(s.indexCount()>0);
  for(let i=0;i<3;i++)await s.tick({maxItems:1});
  const row=f.db.prepare('SELECT id,revision FROM raw_conversations LIMIT 1').get();
  ok(f.core.deleteConversation({namespace:ns,conversationId:row.id,expectedRevision:row.revision,actionId:'quota-delete'}));
  for(let i=0;i<4&&s.indexCount();i++)await s.tick({maxItems:16});
  assert.equal(s.indexCount(),0);assert.equal((await s.service.status()).indexed,null);
});

test('canonical movement during an opener discards a quantum and permits the next host turn',async t=>{
  const f=sourceFixture(t);await savedSource(f,'Synthetic copper telescope.');
  const open=f.port.openRaw;let moved=false;
  f.port.openRaw=async input=>{
    if(!moved){moved=true;
      ok(await f.core.captureRaw(request(splitRaw('Synthetic copper continuation.',{id:'second',ordinal:2})[0],{eventId:'second'})));
    }
    return open(input);
  };
  const s=await searchFixture(f),first=await s.maintain();
  assert.equal(first.error,null);assert.equal(first.maintenance.phase,'idle');assert.equal(s.indexCount(),0);
  const next=await s.tick();assert.equal(next.error,null);assert.equal(s.indexCount(),2);
  assert.equal((await s.search({query:'copper'})).candidates.length,2);
});

test('a stable rebuild advances each inventory page after one denial sweep',async t=>{
  const f=sourceFixture(t);
  for(let i=1;i<=3;i++)ok(await f.core.captureRaw(request(splitRaw('Synthetic copper '+i,{id:'part-'+i,ordinal:i})[0],{eventId:'part-'+i})));
  const s=await searchFixture(f);await s.maintain({maxItems:1});
  await s.tick({maxItems:1});await s.tick({maxItems:1});
  assert.equal(s.indexCount(),3);
});

test('a pending canonical writer defers maintenance without stopping the lane',async t=>{
  const f=sourceFixture(t);await savedSource(f,'Synthetic copper telescope.');const s=await searchFixture(f);
  f.db.exec('BEGIN EXCLUSIVE');
  try{const status=await s.maintain();assert.equal(status.error,null);assert.equal(status.maintenance.phase,'idle');}
  finally{f.db.exec('ROLLBACK');}
  await s.tick();assert.equal(s.indexCount(),1);
});

test('embedding refresh advances beyond a fully embedded first page',async t=>{
  const f=sourceFixture(t),port=createFakeEmbedder();
  for(let i=1;i<=3;i++)ok(await f.core.captureRaw(request(splitRaw('Synthetic copper '+i,{id:'vector-'+i,ordinal:i})[0],{eventId:'vector-'+i})));
  const s=await searchFixture(f,{embedder:port,policy:{family:'local',maxBatchDocuments:1,maxRequests:20,maxConcurrent:1,maxUsd:0}});
  await s.maintain();
  for(let i=0;i<6;i++)await s.tick({maxItems:1,embeddings:true});
  assert.equal((await s.search({query:'copper'})).semantic.state,'ready');
});

import {installRawSearchTestClock} from '../testing/raw-search-clock.mjs';
import assert from 'node:assert/strict';
import test from 'node:test';
test.beforeEach(installRawSearchTestClock);
import { rawSearchChunks,rawSearchPostings,retrieveRaw,rawSearchRrf } from '../raw-search-retrieval.mjs';
import { createBM25 } from '../context-read-bm25.mjs';
import { sourceFixture,savedSource } from '../testing/raw-source-fixtures.mjs';
import { searchFixture } from '../testing/raw-search-fixtures.mjs';
import { openRawSearch } from '../index.mjs';
import { openRawSearchStorage } from '../raw-search-storage.mjs';
import { createHmac } from 'node:crypto';
import { createTestWorkspace } from '../../tools/testing/workspace.mjs';
import { readdirSync } from 'node:fs';

const segment=(id,text,ordinal=1,conversationId='conversation')=>({key:id,postings:rawSearchPostings(text),chunks:[],source:{
  ref:{namespace:{ownerId:'synthetic-owner',scope:'personal',projectId:null},conversationId,messageId:id},ordinal,role:'user'}});

test('bounded chunks retain exact Unicode offsets under normalization expansion',()=>{
  const text='😀ﬃ'.repeat(2200),chunks=rawSearchChunks(text,7);
  assert.ok(chunks.length>1);assert.equal(chunks[0].start,7);assert.equal(chunks.at(-1).end,7+text.length);
  for(const [i,c] of chunks.entries()){
    assert.ok(c.input.isWellFormed());assert.ok(c.input.length<=4000);assert.ok(Buffer.byteLength(c.input)<=8000);
    if(i)assert.equal(c.start,chunks[i-1].end);
    assert.ok(text.slice(c.start-7,c.end-7).isWellFormed());
  }
});
test('lexical hierarchy preserves global, session centers, neighbor weight and gaps',()=>{
  const rows=[segment('a','copper telescope',1),segment('b','unrelated neighbor',2),segment('c','copper telescope copper',3),
    segment('d','unrelated across missing ordinal',8),segment('e','telescope',1,'other')];
  const result=retrieveRaw(rows,'copper telescope');
  assert.ok(result.rows.length>=4);assert.equal(result.rows.some(row=>row.turn.segments[0].key==='d'),false);
  assert.equal(result.rows.find(row=>row.turn.segments[0].key==='b').neighbor,true);
  assert.ok(result.rows.every(row=>Number.isFinite(row.score)));assert.equal(result.coverage.status,'complete');
  const bm=createBM25(rows.map(s=>({id:s.key,text:s.key==='c'?'copper telescope copper':s.key==='a'?'copper telescope':'unrelated'})));
  assert.equal(bm.search('copper')[0].id,'c');
  assert.deepEqual(rawSearchRrf([{id:'a'},{id:'b'}],[{id:'b'},{id:'a'}]).map(r=>r.id),['a','b']);
});
test('full semantic hierarchy takes maximum chunk cosine and reports bounded expansion',()=>{
  const rows=Array.from({length:300},(_,i)=>segment(String(i).padStart(3,'0'),'copper',i+1,'s'+Math.floor(i/3)));
  const vectors=new Map(rows.map(s=>[s.key,[Float32Array.of(0,1),Float32Array.of(1,0)]]));
  const result=retrieveRaw(rows,'copper',{vectors,queryVector:Float32Array.of(1,0),maxTurns:5});
  assert.ok(result.rows.length<=5);assert.equal(result.coverage.status,'partial');assert.ok(result.coverage.expanded<=5);
  const limited=retrieveRaw(rows,'copper',{maxWork:4});assert.equal(limited.coverage.status,'partial');
});
test('local index materializes only canonical ranges and refuses untrusted candidates',async t=>{
  const f=sourceFixture(t),source=await savedSource(f,'Synthetic copper telescope.');
  const s=await searchFixture(f);await s.maintain();
  const hit=await s.search({query:'copper'});assert.equal(hit.candidates.length,1);
  assert.equal(JSON.stringify(hit).includes('Synthetic copper telescope.'),false);
  const prepared=await s.prepare(hit.candidates[0]);
  assert.equal(prepared.validate().ranges[0].text,source.text);
  await assert.rejects(s.service.search({query:'copper'},{}),{code:'authority_required'});
  await assert.rejects(s.prepare({...hit.candidates[0],conversationId:'forged'}),{code:'stale_publication'});
  await assert.rejects(s.prepare({...hit.candidates[0],publication:'forged'}),{code:'stale_publication'});
  s.host.revoke();assert.throws(()=>prepared.validate(),{code:'raw_search_unavailable'});
});
test('unsupported backend and unavailable prerequisites fail closed without upgrade',async t=>{
  const f=sourceFixture(t),s=await searchFixture(f);
  await assert.rejects(openRawSearch({...s.options,backend:'hosted'}),{code:'raw_search_backend_unavailable'});
  assert.equal(await openRawSearch(),null);assert.equal(await openRawSearch({enabled:false,path:'unused'}),null);
});
test('immutable segment CAS refuses stale, forged and foreign publications',async t=>{
  const ws=createTestWorkspace(t,{prefix:'raw-segment-'}),bind=(purpose,value)=>createHmac('sha256','synthetic-secret')
    .update(JSON.stringify([purpose,value])).digest('base64url');
  const options={directory:ws.path,identity:{storeId:'synthetic-store',fileIdentity:'1:2',ownerId:'synthetic-owner',readSet:[]},bind,quotaBytes:65536};
  const a=await openRawSearchStorage(options),b=await openRawSearchStorage(options);ws.defer(()=>a.close());ws.defer(()=>b.close());
  const staged=await a.stage({key:'one',postings:{length:1,terms:[['copper',1]]}});
  const generation=await a.publish(staged,null);assert.ok(generation>0);
  await assert.rejects(b.publish(await b.stage({key:'one',postings:{length:1,terms:[['tin',1]]}}),null),{code:'stale_publication'});
  await assert.rejects(a.publish({...staged,key:'forged'},null),{code:'forged_index'});
  const foreign=await openRawSearchStorage({...options,identity:{...options.identity,ownerId:'foreign-owner'}});ws.defer(()=>foreign.close());
  await assert.rejects(foreign.publish(staged,null),{code:'forged_index'});
  assert.equal((await a.snapshot()).rows.length,1);
});

test('a second same-owner projection cannot allocate another index quota',async t=>{
  const ws=createTestWorkspace(t,{prefix:'raw-owner-quota-'}),bind=(purpose,value)=>createHmac('sha256','synthetic-secret')
    .update(JSON.stringify([purpose,value])).digest('base64url');
  const identity={storeId:'synthetic-store',fileIdentity:'1:2',ownerId:'synthetic-owner',readSet:[]};
  const options={directory:ws.path,identity,bind,quotaBytes:65536},storage=await openRawSearchStorage(options);
  ws.defer(()=>storage.close());
  await assert.rejects(openRawSearchStorage({...options,identity:{...identity,readSet:[{ownerId:identity.ownerId,scope:'personal',projectId:null}]}}),{code:'foreign_index'});
  assert.equal(readdirSync(ws.path).filter(name=>name.endsWith('.sqlite')).length,1);
});

test('a corrupt index fails closed and an explicitly replaced backend rebuilds from canonical Raw',async t=>{
  const {DatabaseSync}=await import('node:sqlite'),{renameSync}=await import('node:fs'),{join}=await import('node:path');
  const f=sourceFixture(t),source=await savedSource(f,'Synthetic copper telescope.'),s=await searchFixture(f);
  await s.maintain();const usage=f.db.prepare('SELECT * FROM raw_owner_usage').all();
  const path=join(s.directory,readdirSync(s.directory).find(name=>name.endsWith('.sqlite'))),broken=new DatabaseSync(path);
  try{broken.exec('DROP TABLE segments');}finally{broken.close();}
  await assert.rejects(s.search({query:'copper'}),{code:'raw_search_unavailable'});
  await s.service.close();renameSync(path,path+'.quarantined');await s.reopen();await s.tick();
  const hit=(await s.search({query:'copper'})).candidates[0];assert.ok(hit);
  assert.equal((await s.prepare(hit)).validate().ranges[0].text,source.text);
  assert.deepEqual(f.db.prepare('SELECT * FROM raw_owner_usage').all(),usage);
});

test('full batches roll back atomically and owner purge bounds each deletion transaction',async t=>{
  const {DatabaseSync}=await import('node:sqlite'),ws=createTestWorkspace(t,{prefix:'raw-purge-bounds-'});
  const bind=(purpose,value)=>createHmac('sha256','synthetic-secret').update(JSON.stringify([purpose,value])).digest('base64url');
  const storage=await openRawSearchStorage({directory:ws.path,identity:{storeId:'synthetic-store',fileIdentity:'1:2',ownerId:'synthetic-owner',readSet:[]},bind,quotaBytes:4*1024*1024});
  ws.defer(()=>storage.close());
  for(let i=0;i<4097;i+=128){const staged=[];
    for(let j=i;j<Math.min(i+128,4097);j++)staged.push({...await storage.stage({key:'row-'+j}),expected:null});
    await storage.commitBatch({staged,checkpoint:{}});
  }
  const large=[];for(let i=0;i<128;i++)large.push({...await storage.stage({key:'large-'+i,padding:'x'.repeat(32768)}),expected:null});
  await assert.rejects(storage.commitBatch({staged:large,checkpoint:{}}),error=>(error.errcode&255)===13);
  assert.equal((await storage.status()).segments,4097);
  const prepare=DatabaseSync.prototype.prepare,deletions=[];
  DatabaseSync.prototype.prepare=function(sql){const stmt=prepare.call(this,sql);
    if(sql.startsWith('DELETE FROM segments WHERE id IN (SELECT id FROM segments LIMIT')){
      const run=stmt.run;stmt.run=function(...args){const value=run.apply(this,args);deletions.push(value.changes);return value;};
    }
    return stmt;
  };
  try{await storage.dropOwner();}finally{DatabaseSync.prototype.prepare=prepare;}
  assert.equal(deletions.reduce((n,v)=>n+v,0),4097);assert.ok(deletions.every(value=>value<=1024));
  assert.equal((await storage.status()).segments,0);
});

test('synthetic hierarchy parity pins k60 round-robin fusion and strongest neighbor score',()=>{
  const result=retrieveRaw([segment('a','copper',1),segment('b','unrelated',2)],'copper');
  assert.deepEqual(result.rows.map(row=>[row.turn.segments[0].key,row.score,row.neighbor]),
    [['a',2/61,false],['b',.65*2/61,true]]);
});
test('Raw keys keep namespace/owner collisions separate through fusion',()=>{
  const a=segment('same','copper'),b=segment('same','copper'),c=segment('same','copper');
  b.source.ref.namespace={ownerId:'other-owner',scope:'personal',projectId:null};
  c.source.ref.namespace={ownerId:'synthetic-owner',scope:'project',projectId:'project'};
  const result=retrieveRaw([a,b,c],'copper');assert.equal(result.rows.length,3);
  assert.equal(new Set(result.rows.map(row=>row.id)).size,3);
});
test('per-candidate policy distinguishes bare unknown, linked current and unresolved privacy',async t=>{
  const f=sourceFixture(t),source=await savedSource(f),s=await searchFixture(f);await s.maintain();
  const candidate=(await s.search({query:'retained'})).candidates[0];
  assert.deepEqual(candidate.classification,{kind:'current-eligible-bare',reason:'complete-privacy-no-memory-link'});
  assert.equal(candidate.currentness,'unknown');
  assert.deepEqual(await s.service.classify(candidate,{},s.host.token),candidate.classification);
  assert.deepEqual(await s.service.classify({...candidate,messageId:'foreign'}, {},s.host.token),
    {kind:'denied',reason:'source-or-authority-unavailable'});
  assert.equal(source.messageId,candidate.messageId);
});

test('joint vector residency counts actual chunks and releases reservations',async()=>{
  const {reserveSharedVectors}=await import('../context-read-embedder.mjs');
  const metadata={id:'synthetic-residency',revision:'1',dimensions:1536,normalization:'l2'};
  const full=reserveSharedVectors(20000,metadata);assert.ok(full);
  assert.equal(reserveSharedVectors(1,metadata),null);full.release();full.release();
  const again=reserveSharedVectors(1,metadata);assert.ok(again);again.release();
});

test('Memory source expansion can prepare an exact authenticated ref without an index hit',async t=>{
  const {resolve,anchor}=await import('../testing/raw-source-fixtures.mjs');
  const f=sourceFixture(t),source=await savedSource(f),refs=await resolve(f,[anchor(source)]),s=await searchFixture(f);
  assert.equal((await s.search({query:'retained'})).candidates.length,0);
  const prepared=await s.service.prepareSource(refs[0],{},s.host.token);
  assert.equal(prepared.validate().ranges[0].text,source.text);
  await assert.rejects(s.service.prepareSource({...refs[0],contentIdentity:'forged'}, {},s.host.token));
  const ticket=prepared.ticket;await s.reopen();
  const next=await s.service.prepareSource(refs[0],{},s.host.token);assert.notEqual(next.ticket,ticket);
  assert.throws(()=>s.service.revalidate([ticket]),{code:'raw_search_unavailable'});
});

test('bounded snapshots stop before decoding excess segments and authenticate coverage headers',async t=>{
  const {DatabaseSync}=await import('node:sqlite');const {readdirSync}=await import('node:fs');const {join}=await import('node:path');
  const ws=createTestWorkspace(t,{prefix:'raw-bounded-segments-'}),bind=(purpose,value)=>createHmac('sha256','synthetic-secret')
    .update(JSON.stringify([purpose,value])).digest('base64url');
  const storage=await openRawSearchStorage({directory:ws.path,identity:{storeId:'synthetic-bounds',fileIdentity:'1:2',ownerId:'synthetic-owner',readSet:[]},bind,quotaBytes:64*1024*1024});
  ws.defer(()=>storage.close());
  const staged=[];for(let i=0;i<32;i++)staged.push({...await storage.stage({key:String(i),vector:'00'.repeat(150000)}),expected:null});
  await storage.commitBatch({staged,checkpoint:{coverageComplete:false}});
  const result=await storage.snapshot();assert.equal(result.partial,true);assert.equal(result.partialReason,'snapshot_byte_limit');assert.ok(result.rows.length<32);
  const db=new DatabaseSync(join(ws.path,readdirSync(ws.path).find(name=>name.endsWith('.sqlite'))));ws.defer(()=>db.close());
  db.exec("UPDATE header SET checkpoint='{}'");
  await assert.rejects(storage.snapshot(),{code:'forged_index'});
});

test('search requires existing source prerequisites and never upgrades a legacy layout',async t=>{
  const {openDatabase}=await import('../database.mjs');const {DatabaseSync}=await import('node:sqlite');
  const {join}=await import('node:path');const {readdirSync}=await import('node:fs');
  const {rawSearchHost}=await import('../testing/raw-search-fixtures.mjs');
  const {localPlainPort}=await import('../testing/raw-source-fixtures.mjs');
  const ws=createTestWorkspace(t,{prefix:'raw-legacy-unavailable-'}),path=join(ws.path,'canonical.sqlite'),db=openDatabase(path);
  const before=db.prepare('SELECT type,name,sql FROM sqlite_master ORDER BY type,name').all();db.close();const host=rawSearchHost();
  await assert.rejects(openRawSearch({version:'raw-search-v1',enabled:true,backend:'local',path,directory:ws.path,
    ownerId:'synthetic-owner',readSet:[{ownerId:'synthetic-owner',scope:'personal',projectId:null}],authority:host.authority,crypto:localPlainPort()}),
    {code:'raw_search_unavailable'});
  const check=new DatabaseSync(path);try{assert.deepEqual(check.prepare('SELECT type,name,sql FROM sqlite_master ORDER BY type,name').all(),before);}finally{check.close();}
  assert.deepEqual(readdirSync(ws.path),['canonical.sqlite']);
});

test('selected canonical files refuse hardlink and directory-symlink aliases',async t=>{
  const {symlinkSync,linkSync,unlinkSync}=await import('node:fs');const {join}=await import('node:path');
  const f=sourceFixture(t),s=await searchFixture(f),alias=join(f.workspace.path,'alias');
  symlinkSync(f.workspace.path,alias,'dir');
  await assert.rejects(openRawSearch({...s.options,path:join(alias,'store.sqlite')}),{code:'raw_search_unavailable'});
  const hard=join(f.workspace.path,'hard.sqlite');linkSync(f.path,hard);
  try{await assert.rejects(openRawSearch({...s.options,path:hard}),{code:'raw_search_unavailable'});}
  finally{unlinkSync(hard);}
});

test('candidate projection keeps more than the final item count available for validation',async t=>{
  const f=sourceFixture(t);await savedSource(f);const s=await searchFixture(f);await s.maintain();
  const candidate=(await s.search({query:'retained'})).candidates[0],handles=[];
  for(let i=0;i<25;i++)handles.push(await s.prepare(candidate));
  assert.equal(s.service.revalidate([handles[0],handles.at(-1)]).length,2);
});

test('fp32 blocks preserve cosine maxima and hierarchy across block boundaries without decoding during scoring',async()=>{
  const {loadRawVectorBlocks,scoreRawVectorBlocks}=await import('../raw-search-retrieval.mjs');
  const {encodeVector,cosine}=await import('../context-read-embedder.mjs');
  const metadata={id:'synthetic-blocks',revision:'1',dimensions:3,normalization:'none'},query=Float32Array.of(.4,.7,-.2);
  const rows=Array.from({length:270},(_,i)=>segment(String(i),'copper',i+1));
  const vectors=new Map();
  for(const [i,row] of rows.entries()){
    const values=[Float32Array.of(i+1,1,-2),Float32Array.of(-1,i+1,3)];vectors.set(row.key,values);
    row.chunks=values.map(vector=>({vector:encodeVector(vector,metadata)}));
  }
  const blocks=loadRawVectorBlocks(rows,metadata),parse=JSON.parse;
  let scores;
  JSON.parse=()=>{throw Error('scoring must not decode');};
  try{scores=scoreRawVectorBlocks(blocks,query);}finally{JSON.parse=parse;}
  for(const [i,row] of rows.entries())assert.ok(Math.abs(scores[i]-Math.max(...vectors.get(row.key).map(v=>cosine(query,v))))<1e-12);
  assert.deepEqual(retrieveRaw(rows,'copper',{vectors:blocks,queryVector:query}),retrieveRaw(rows,'copper',{vectors,queryVector:query}));
  rows[0].chunks[0].vector=Buffer.alloc(12);
  assert.throws(()=>loadRawVectorBlocks(rows,metadata),{code:'invalid_vector'});
});

test('binary vector bytes are authenticated independently of compact hint decoding',async t=>{
  const {DatabaseSync}=await import('node:sqlite'),{join}=await import('node:path');
  const {createFakeEmbedder}=await import('../context-read-embedder.mjs');
  const port=createFakeEmbedder(),f=sourceFixture(t);await savedSource(f,'Synthetic copper telescope.');
  const s=await searchFixture(f,{embedder:port,policy:{family:'local',maxBatchDocuments:1,maxRequests:10,maxConcurrent:1,maxUsd:0}});
  await s.maintain();await s.tick({embeddings:true});await s.tick();
  assert.equal((await s.search({query:'copper'})).semantic.state,'ready');
  const db=new DatabaseSync(join(s.directory,readdirSync(s.directory).find(name=>name.endsWith('.sqlite'))));
  try{db.exec('UPDATE segments SET vectors=zeroblob(length(vectors))');}finally{db.close();}
  await assert.rejects(s.search({query:'copper'}),{code:'raw_search_unavailable'});
});

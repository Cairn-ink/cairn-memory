import {installRawSearchTestClock} from '../testing/raw-search-clock.mjs';
import assert from 'node:assert/strict';
import test from 'node:test';
test.beforeEach(installRawSearchTestClock);
import { DatabaseSync } from 'node:sqlite';
import { Worker } from 'node:worker_threads';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { readdirSync } from 'node:fs';
import { join } from 'node:path';
import { createRawSearchCache, RAW_SEARCH_CADENCE_MS, RAW_SEARCH_CACHE_IDLE_MS } from '../raw-search-cache.mjs';
import { createFakeEmbedder, reserveSharedVectors, MAX_CACHE_BYTES } from '../context-read-embedder.mjs';
import { createRawSearchAuthority } from '../raw-search-authority.mjs';
import { openReadDatabase } from '../read-database.mjs';
import { transaction } from '../database.mjs';
import { suppressOwnerInside, writeContentSuppressionInside } from '../content-suppression-storage.mjs';
import { openRawSearchStorage } from '../raw-search-storage.mjs';
import { sourceFixture, savedSource, ns, ok } from '../testing/raw-source-fixtures.mjs';
import { searchFixture, safetySourceFixture } from '../testing/raw-search-fixtures.mjs';

const metadata={id:'synthetic-cache',revision:'1',dimensions:2,normalization:'l2'};
const rows=[{key:'synthetic',chunks:[{vector:Buffer.alloc(8)}]}];
const blocks={count:1,offsets:new Uint32Array([0,1]),blocks:[Float32Array.of(1,0)]};
function cacheFixture() {
  let time=0,key='initial',callback,scheduled=0;
  const cache=createRawSearchCache({enabled:true,checkKey:()=>key,now:()=>time,
    setTimer(fn,ms){assert.equal(ms,RAW_SEARCH_CADENCE_MS);callback=fn;scheduled++;return 1;},clearTimer(){scheduled--;}});
  return {cache,tick(ms){time+=ms;callback?.();},key(value){key=value;},get scheduled(){return scheduled;}};
}
function assertReleased(port=metadata) {const lease=reserveSharedVectors(20000,port);assert.ok(lease);lease.release();}

test('key mismatch evicts before scoring; borrowed blocks retain their shared reservation',()=>{
  const f=cacheFixture(),borrowed=f.cache.install('initial',rows,blocks,metadata,50);
  assert.equal(reserveSharedVectors(20000,metadata),null);
  assert.equal(f.cache.acquire('replacement'),null);assert.equal(f.scheduled,0);
  assert.equal(reserveSharedVectors(20000,metadata),null);
  borrowed.release();borrowed.release();assertReleased();f.cache.close();
});
test('maintenance invalidation, idle timeout and close drop without another search',()=>{
  for(const reason of ['key','idle','close','unavailable']){
    const f=cacheFixture();f.cache.install('initial',rows,blocks,metadata,50).release();
    if(reason==='key'){f.key('forgotten');f.tick(RAW_SEARCH_CADENCE_MS);}
    else if(reason==='idle')f.tick(RAW_SEARCH_CACHE_IDLE_MS);
    else if(reason==='close')f.cache.close();
    else {f.key(null);f.tick(RAW_SEARCH_CADENCE_MS);}
    assert.equal(f.cache.acquire('initial'),null);assert.equal(f.scheduled,0);assertReleased();f.cache.close();
  }
});
test('cache and Memory share both byte and count ceilings, including hint overhead',()=>{
  const f=cacheFixture(),lease=reserveSharedVectors(1,metadata,MAX_CACHE_BYTES-8);assert.ok(lease);
  assert.equal(f.cache.install('initial',rows,blocks,metadata,50),null);lease.release();
  f.cache.install('initial',rows,blocks,metadata,50).release();
  assert.equal(reserveSharedVectors(19999,metadata,MAX_CACHE_BYTES-160000),null);
  f.cache.close();assertReleased();
});
test('disabled cache allocates no timer or reservation and never checks a key',()=>{
  const cache=createRawSearchCache({enabled:false,checkKey(){assert.fail('disabled key read');},setTimer(){assert.fail('disabled timer');}});
  assert.equal(cache.install('initial',rows,blocks,metadata,50),null);assert.equal(cache.acquire('initial'),null);
  cache.maintain();cache.close();assertReleased();
});

async function embeddedFixture(t,patch={}) {
  const {fixtureOptions,...settings}=patch;
  const f=sourceFixture(t,fixtureOptions),source=await savedSource(f,'Synthetic copper telescope.',{namespace:settings.readSet?.[0]??ns});
  const port=settings.embedder??{...createFakeEmbedder(),id:'synthetic-cache-'+t.name};
  const s=await searchFixture(f,{embedder:port,policy:{family:'local',maxBatchDocuments:1,maxRequests:50,maxConcurrent:1,maxUsd:0},...settings});
  await s.maintain();await s.tick({embeddings:true});await s.tick();
  const {id,revision,dimensions,normalization}=port,embedder={id,revision,dimensions,normalization};
  const input={query:'copper',queryVector:{input:'copper',embedder,vector:(await port.embed(['copper']))[0]}};
  return {f,s,source,port,input};
}
function observeLoads(t) {
  const prepare=DatabaseSync.prototype.prepare;let loads=0;
  DatabaseSync.prototype.prepare=function(sql){if(sql.includes('SELECT s.*,h.sequence'))loads++;return prepare.call(this,sql);};
  t.after(()=>{DatabaseSync.prototype.prepare=prepare;});return ()=>loads;
}
test('local warm search reuses fp32 and hints; coverage and status reveal no cache state',async t=>{
  const {s,port,input}=await embeddedFixture(t),loads=observeLoads(t),before=await s.service.status();
  const cold=await s.search(input),first=loads();assert.ok(first>0);assert.equal(cold.semantic.state,'ready');
  assert.equal(reserveSharedVectors(20000,port),null);
  const warm=await s.search(input);assert.equal(loads(),first);
  assert.deepEqual(warm.coverage,cold.coverage);assert.deepEqual(warm.semantic,cold.semantic);
  assert.deepEqual(warm.candidates.map(({proof,...c})=>c),cold.candidates.map(({proof,...c})=>c));
  assert.deepEqual(await s.service.status(),before);
  assert.equal(JSON.stringify(warm).includes('Synthetic copper telescope.'),false);
  await s.service.close();assertReleased(port);
});
test('hosted policy never retains a block or reuses cached hints',async t=>{
  const {s,port,input}=await embeddedFixture(t,{policy:{family:'hosted',maxRequests:50,maxConcurrent:1,maxUsd:1,estimateUsd:()=>0}});
  const loads=observeLoads(t);await s.search(input);const first=loads();await s.search(input);assert.ok(loads()>first);assertReleased(port);
});
test('a concurrent query wait reuses a newly populated block without double reservation',async t=>{
  const fake=createFakeEmbedder();let arrived,release,armed=false;
  const entered=new Promise(resolve=>{arrived=resolve;}),gate=new Promise(resolve=>{release=resolve;});
  const port={...fake,id:'synthetic-concurrent-cache',async embed(texts,controls={}){
    controls.beforeDispatch?.();if(armed&&texts[0]==='copper'){arrived();await gate;}return fake.embed(texts,controls);
  }};
  const {s,input}=await embeddedFixture(t,{embedder:port});armed=true;
  const memory=reserveSharedVectors(19999,metadata);assert.ok(memory);
  let waiting;
  try{
    waiting=s.search({query:'copper'});await entered;
    assert.equal((await s.search(input)).semantic.state,'ready');release();
    assert.equal((await waiting).semantic.state,'ready');
  }finally{release();await waiting?.catch(()=>{});memory.release();await s.service.close();}
  assertReleased();
});
test('a changed sidecar publication drops the cache before next scoring',async t=>{
  const {s,f,input}=await embeddedFixture(t);await s.search(input);const loads=observeLoads(t);
  const reader=openReadDatabase(f.path,{contextRead:true}),authority=createRawSearchAuthority(reader,s.options);
  const storage=await openRawSearchStorage({directory:s.directory,identity:authority.identity,bind:authority.bind,quotaBytes:s.options.quotaBytes??512*1024*1024});
  try{await storage.commitBatch({checkpoint:(await storage.status()).checkpoint});await s.search(input);assert.ok(loads()>0);}
  finally{await storage.close();reader.db.close();}
});
test('native sidecar changes cannot hide authentication failure behind a hit',async t=>{
  const {s,input}=await embeddedFixture(t);await s.search(input);
  const db=new DatabaseSync(join(s.directory,readdirSync(s.directory).find(name=>name.endsWith('.sqlite'))));
  try{db.exec('UPDATE segments SET vectors=zeroblob(length(vectors))');}finally{db.close();}
  await assert.rejects(s.search(input),{code:'raw_search_unavailable'});
});
test('publication movement between an optional key read and payload snapshot leaves search uncached',async t=>{
  const {s,f,input,port}=await embeddedFixture(t),reader=openReadDatabase(f.path,{contextRead:true});
  const authority=createRawSearchAuthority(reader,s.options),storage=await openRawSearchStorage({directory:s.directory,
    identity:authority.identity,bind:authority.bind,quotaBytes:512*1024*1024});
  const checkpoint=(await storage.status()).checkpoint,prepare=DatabaseSync.prototype.prepare,exec=DatabaseSync.prototype.exec;
  let target,armed=false,moved;
  DatabaseSync.prototype.prepare=function(sql){
    if(sql.startsWith('SELECT length(CAST(data AS BLOB))')){target=this;armed=true;}
    return prepare.call(this,sql);
  };
  DatabaseSync.prototype.exec=function(sql){const result=exec.call(this,sql);
    if(armed&&this===target&&sql==='COMMIT'){armed=false;moved=storage.commitBatch({checkpoint});}
    return result;
  };
  try{const result=await s.search(input);assert.ok(moved);await moved;
    assert.equal(result.semantic.state,'ready');assert.equal(result.candidates.length,1);assertReleased(port);
  }finally{DatabaseSync.prototype.prepare=prepare;DatabaseSync.prototype.exec=exec;await moved;await storage.close();reader.db.close();}
});
test('a busy idle key check drops silently without changing the next search error or coverage',async t=>{
  t.mock.timers.enable({apis:['setInterval']});
  const {f,s,input}=await embeddedFixture(t);
  try{
    const before=await s.search(input);
    f.db.exec('BEGIN EXCLUSIVE');
    try{t.mock.timers.tick(RAW_SEARCH_CADENCE_MS);}finally{f.db.exec('ROLLBACK');}
    const after=await s.search(input);assert.deepEqual(after.coverage,before.coverage);assert.deepEqual(after.semantic,before.semantic);
  }finally{await s.service.close();t.mock.timers.reset();}
});

test('all key components are read in one canonical snapshot and evict before reuse',async t=>{
  const f=safetySourceFixture(t);await savedSource(f,'Synthetic copper telescope.');const s=await searchFixture(f);
  const reader=openReadDatabase(f.path,{contextRead:true});t.after(()=>reader.db.close());
  const authority=createRawSearchAuthority(reader,s.options),publication={generation:'one',sequence:1,revision:1};
  const initial=authority.cacheKey(publication,metadata),fCache=cacheFixture();t.after(()=>fCache.cache.close());
  const different=(next,before=initial)=>{
    fCache.cache.install(before,rows,blocks,metadata,50).release();assert.notEqual(next,before);
    assert.equal(fCache.cache.acquire(next),null);assertReleased();
  };
  different(authority.cacheKey({...publication,generation:'two'},metadata));
  different(authority.cacheKey({...publication,sequence:2},metadata));
  different(authority.cacheKey({...publication,revision:2},metadata));
  for(const next of [{...metadata,id:'other-provider'},{...metadata,revision:'other-model'},
    {...metadata,dimensions:3},{...metadata,normalization:'none'}])different(authority.cacheKey(publication,next));
  const exec=DatabaseSync.prototype.exec,prepare=DatabaseSync.prototype.prepare;let active=false,components=0;
  DatabaseSync.prototype.exec=function(sql){const result=exec.call(this,sql);if(this===reader.db){if(sql==='BEGIN')active=true;if(sql==='COMMIT')active=false;}return result;};
  DatabaseSync.prototype.prepare=function(sql){
    if(this===reader.db&&(sql.includes('FROM raw_exclusion_clocks')||sql.includes('FROM raw_session_fences')||sql.includes('FROM owner_suppression_epochs'))){assert.equal(active,true);components++;}
    return prepare.call(this,sql);
  };
  try{assert.equal(authority.cacheKey(publication,metadata),initial);assert.ok(components>=3);}
  finally{DatabaseSync.prototype.exec=exec;DatabaseSync.prototype.prepare=prepare;}
  const changed=mutate=>{const before=authority.cacheKey(publication,metadata);mutate();
    different(authority.cacheKey(publication,metadata),before);};
  changed(()=>f.db.prepare('UPDATE namespace_epochs SET epoch=epoch+1 WHERE owner_id=?').run(ns.ownerId));
  changed(()=>f.db.prepare('INSERT INTO raw_exclusion_clocks VALUES(?,?,?,1)').run(ns.ownerId,ns.scope,''));
  changed(()=>transaction(f.db,()=>suppressOwnerInside(f.db,{ownerId:ns.ownerId,reason:'account_erasure',actionId:'synthetic-cache-erasure'})));
  const before=authority.cacheKey(publication,metadata),epochs=f.db.prepare('SELECT * FROM namespace_epochs').all();
  f.db.exec('INSERT INTO raw_session_fences SELECT owner_id,scope,project_id,client,session_key FROM raw_conversations');
  assert.deepEqual(f.db.prepare('SELECT * FROM namespace_epochs').all(),epochs);
  different(authority.cacheKey(publication,metadata),before);
});
test('late forget after the key read is refused by the final delivery snapshot',async t=>{
  let f,armed=false,calls=0,forgotten=false;
  const fixture=await embeddedFixture(t,{fixtureOptions:{model:{extract:()=>({items:[{content:'Synthetic copper fact.',kind:'fact',confidence:.8,sourceIndices:[0]}]})}},
    setupHost(host){const current=host.authority.isCurrent;host.authority.isCurrent=function(...args){
      // Final access follows authorization and post-sidecar access, after the
      // cached blocks have supplied scores and before the delivery snapshot.
      if(armed&&++calls===4){const memory=f.db.prepare('SELECT id,revision FROM memories WHERE deleted=0').get();
        ok(f.core.forget({namespace:ns,memoryId:memory.id,expectedRevision:memory.revision}));forgotten=true;}
      return current.apply(this,args);
    };}});
  f=fixture.f;const {s,input}=fixture;await s.search(input);armed=true;
  await assert.rejects(s.search(input),{code:'raw_search_unavailable'});assert.equal(forgotten,true);
});
test('forgotten-derived blocks drop within one real cadence with no search or maintenance call',async t=>{
  const {f,s,input,port}=await embeddedFixture(t,{fixtureOptions:{model:{extract:()=>({items:[{content:'Synthetic copper fact.',kind:'fact',confidence:.8,sourceIndices:[0]}]})}}});await s.search(input);assert.equal(reserveSharedVectors(20000,port),null);
  const memory=f.db.prepare('SELECT id,revision FROM memories WHERE deleted=0').get();
  ok(f.core.forget({namespace:ns,memoryId:memory.id,expectedRevision:memory.revision}));
  await new Promise(resolve=>setTimeout(resolve,RAW_SEARCH_CADENCE_MS+100));assertReleased(port);
});
test('owner-scoped readers never reuse another owner block, including identical provider identities',async t=>{
  const a=await embeddedFixture(t),b=await embeddedFixture(t,{ownerId:'other-owner',readSet:[{...ns,ownerId:'other-owner'}]});const loads=observeLoads(t);
  await a.s.search(a.input);const first=loads();await b.s.search(b.input);assert.ok(loads()>first);
  // Distinct canonical stores/owners have no shared block registry.
  await a.s.service.close();assert.equal(reserveSharedVectors(20000,b.port),null);await b.s.service.close();assertReleased();
});
for(const scope of ['owner','namespace'])test(`Raw handle inventory and warm cache deny pending ${scope} erasure`,async t=>{
  const f=safetySourceFixture(t);await savedSource(f,'Synthetic copper telescope.');
  let opens=0;const open=f.port.openRaw;f.port.openRaw=async input=>{opens++;return open(input);};
  const port={...createFakeEmbedder(),id:'synthetic-cache-erasure-'+scope};
  const s=await searchFixture(f,{embedder:port,policy:{family:'local',maxBatchDocuments:1,maxRequests:20,maxConcurrent:1,maxUsd:0}});
  await s.maintain();await s.tick({embeddings:true});await s.tick();
  const entries=[];
  for(const intent of ['current','history']){const candidate=(await s.search({query:'copper',intent})).candidates[0];
    entries.push({intent,candidate,prepared:await s.prepare(candidate,intent)});}
  const before=opens;
  const gated=['search','prepare','prepareSource','classify','validate','revalidate'],lifecycle=['maintain','status','purge','close'];
  assert.deepEqual(Object.keys(s.service).sort(),[...gated,...lifecycle].sort());
  transaction(f.db,()=>scope==='owner'?suppressOwnerInside(f.db,{ownerId:ns.ownerId,reason:'account_erasure',actionId:'synthetic-erasure'}):
    writeContentSuppressionInside(f.db,{namespace:ns,kind:'namespace',matchMode:'namespace',reason:'privacy_erase',actionId:'synthetic-erasure'}));
  for(const {intent,candidate,prepared} of entries){
    assert.equal((await s.search({query:'copper',intent})).candidates.length,0);
    await assert.rejects(s.prepare(candidate,intent),{code:'raw_search_unavailable'});
    await assert.rejects(s.service.prepareSource(candidate.ranges[0],{intent},s.host.token),{code:'raw_search_unavailable'});
    assert.deepEqual(await s.service.classify(candidate,{intent},s.host.token),{kind:'denied',reason:'source-or-authority-unavailable'});
    for(const method of ['validate','revalidate'])assert.throws(()=>s.service[method]([prepared]),{code:'raw_search_unavailable'});
    assert.throws(()=>prepared.validate(),{code:'raw_search_unavailable'});
  }
  for(const status of [await s.service.status(),await s.maintain()])for(const key of ['eligible','indexed','embedded'])assert.equal(status[key],null);
  await s.service.purge();await s.service.close();assert.equal(opens,before);assertReleased(port);
});
test('forced Worker termination leaves no blocks for a successor instance',async t=>{
  const {s,input,port}=await embeddedFixture(t);await s.service.close();
  const module=new URL('../raw-search-index.mjs',import.meta.url).href,embedderModule=new URL('../context-read-embedder.mjs',import.meta.url).href;
  const fixtureModule=new URL('../testing/raw-search-fixtures.mjs',import.meta.url).href,sourceModule=new URL('../testing/raw-source-fixtures.mjs',import.meta.url).href;
  const workerSource=`const {parentPort,workerData}=require('node:worker_threads');(async()=>{
    const {performance}=require('node:perf_hooks');
    Object.defineProperty(performance,'now',{configurable:true,value:()=>100});
    const {openRawSearch}=await import(workerData.module),{rawSearchHost,broker}=await import(workerData.fixtureModule),{localPlainPort}=await import(workerData.sourceModule);
    const {reserveSharedVectors}=await import(workerData.embedderModule),host=rawSearchHost();
    const metadata=workerData.input.queryVector.embedder;
    const service=await openRawSearch({...workerData.options,authority:host.authority,crypto:localPlainPort(),maintenanceTurn:broker(),embedder:{...metadata,embed(){throw Error('unused');}}});
    const before=reserveSharedVectors(20000,metadata);if(before)before.release();
    await service.search(workerData.input,host.token);const after=reserveSharedVectors(20000,metadata);if(after)after.release();
    parentPort.postMessage({emptyBefore:!!before,residentAfter:!after});parentPort.on('message',()=>{});
  })().catch(error=>{throw error;});`;
  const {authority,crypto,maintenanceTurn,embedder,policy,...options}=s.options;
  for(let i=0;i<2;i++){
    const worker=new Worker(workerSource,{eval:true,workerData:{module,fixtureModule,sourceModule,embedderModule,input,
      options:{...options,policy:{family:'local',maxBatchDocuments:1,maxRequests:1,maxConcurrent:1,maxUsd:0}}}});
    t.after(()=>worker.terminate());
    const message=await new Promise((resolve,reject)=>{worker.once('message',resolve);worker.once('error',reject);});
    assert.deepEqual(message,{emptyBefore:true,residentAfter:true});assert.equal(await worker.terminate(),1);
  }
  assertReleased(port);
});
test('Worker clocks cover opening and search independently of the parent clock',()=>{
  const observer=new URL('../testing/raw-search-worker-clock-observer.mjs',import.meta.url).href;
  const childEnv={...process.env};delete childEnv.NODE_TEST_CONTEXT;
  const child=spawnSync(process.execPath,['--import='+observer,'--test','--test-reporter=tap','--test-name-pattern=forced Worker termination',
    '--test-timeout=110000',fileURLToPath(import.meta.url)],{encoding:'utf8',timeout:120000,env:childEnv});
  assert.equal(child.status,0,child.stdout+child.stderr);assert.equal(child.signal,null);
  assert.match(child.stdout,/# pass 1\b/);
});

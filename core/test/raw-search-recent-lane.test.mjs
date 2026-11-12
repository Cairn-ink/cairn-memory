import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readdirSync } from 'node:fs';
import { join } from 'node:path';
import { sourceFixture,savedSource,ns,ok,request,splitRaw } from '../testing/raw-source-fixtures.mjs';
import { searchFixture,safetySourceFixture } from '../testing/raw-search-fixtures.mjs';
import { rawSessionKeys } from '../raw-source-roots.mjs';
import { installRawSearchTestClock } from '../testing/raw-search-clock.mjs';
import { createRawSearchAuthority } from '../raw-search-authority.mjs';
import { openReadDatabase } from '../read-database.mjs';
import { createRawSearchMaintenance } from '../raw-search-maintenance.mjs';
import { openRawSearch } from '../raw-search-index.mjs';
import { transaction } from '../database.mjs';
import { suppressOwnerInside,writeContentSuppressionInside } from '../content-suppression-storage.mjs';
import { openRawSearchStorage } from '../raw-search-storage.mjs';

test.beforeEach(installRawSearchTestClock);
function seed(f,id,session){
  const secret=f.db.prepare('SELECT secret FROM episode_identity').get().secret;
  f.db.prepare('INSERT INTO raw_conversations VALUES(?,?,?,?,?,?,1,?,?)')
    .run(id,ns.ownerId,ns.scope,ns.projectId??'','codex',rawSessionKeys(ns,'codex',session,secret)[1],'synthetic','synthetic');
}
async function save(f,id,ordinal,session='prefix'){
  return ok(await f.core.captureRaw(request(splitRaw('copper marker '+id,{id,ordinal})[0],{client:'codex',sessionId:session,eventId:id})));
}
function sidecar(s,work){
  const db=new DatabaseSync(join(s.directory,readdirSync(s.directory).find(name=>name.endsWith('.sqlite'))));
  try{return work(db);}finally{db.close();}
}
const checkpoint=s=>sidecar(s,db=>JSON.parse(db.prepare('SELECT checkpoint FROM header').get().checkpoint));
async function ports(t,f,s,patch={}){
  const reader=openReadDatabase(f.path,{contextRead:true}),authority=createRawSearchAuthority(reader,{...s.options,...patch});
  const storage=await openRawSearchStorage({directory:s.directory,identity:authority.identity,bind:authority.bind,quotaBytes:512*1024*1024});
  t.after(async()=>{await storage.close();reader.db.close();});return {authority,storage};
}
async function finish(s){for(let i=0;i<50;i++){await s.tick({maxMs:5000});if(checkpoint(s).coverageComplete)return;}assert.fail('bounded stable reconciliation');}
function pause(f,value){f.db.prepare('INSERT INTO episode_controls(owner_id,scope,project_id,generation,paused,enabled) VALUES(?,?,?,?,?,1) ON CONFLICT(owner_id,scope,project_id) DO UPDATE SET generation=excluded.generation,paused=excluded.paused')
  .run(ns.ownerId,ns.scope,ns.projectId??'',value?'paused':'resumed',+value);}

for(const size of [1000,10000])test(`late save is searchable within four turns during continuous appends, population ${size}`,async t=>{
  const f=sourceFixture(t);seed(f,'a-prefix','prefix');seed(f,'z-target','target');
  // Batch only fixture construction. The newest preexisting event is a
  // single part, so live arrivals can outrank older recovery batches.
  for(let start=0;start<size-1;start+=24){
    const messages=Array.from({length:Math.min(24,size-1-start)},(_,offset)=>{
      const i=start+offset;return splitRaw('copper marker prefix '+i,{id:'prefix-'+String(i).padStart(5,'0'),ordinal:i+1})[0];});
    ok(await f.core.captureRaw({...request(messages[0],{client:'codex',sessionId:'prefix',eventId:'prefix-batch-'+start}),messages}));
  }
  await save(f,'prefix-'+String(size-1).padStart(5,'0'),size);
  const s=await searchFixture(f);await s.maintain({maxItems:1});
  await save(f,'target',1,'target');
  assert.equal(f.db.prepare("SELECT count(*) AS n FROM raw_parts WHERE conversation_id<'z-target'").get().n,size);
  let hit;
  for(let turn=0;turn<4;turn++){
    await save(f,'append-'+turn,size+turn+1);
    await s.tick({maxMs:5000});const result=await s.search({query:'target'});
    assert.equal(result.coverage.status,'partial');assert.ok(result.coverage.causes.includes('index_incomplete'));
    hit=result.candidates.find(c=>c.messageId==='target');if(hit)break;
  }
  assert.ok(hit);const prepared=await s.prepare(hit);
  assert.equal(prepared.validate().ranges.map(range=>range.text).join(''),'copper marker target');
});

test('consumed publication survives pause cleanup and resume with continuing saves',async t=>{
  const f=sourceFixture(t);seed(f,'a-prefix','prefix');seed(f,'z-target','target');
  for(let i=0;i<8;i++)await save(f,'prefix-'+i,i+1);
  await save(f,'target',1,'target');const s=await searchFixture(f);await finish(s);
  const before=(await s.search({query:'target'})).candidates[0];assert.ok(before);
  const prepared=await s.prepare(before);
  assert.equal(Object.keys(checkpoint(s).recent.active).length,0);
  const {authority}=await ports(t,f,s);let visits=0,targetCleanup=0,prepare=DatabaseSync.prototype.prepare;
  const beforePause=authority.fence();pause(f,true);
  const pausedFence=authority.fence();assert.notEqual(pausedFence,beforePause);
  const stackLimit=Error.stackTraceLimit;Error.stackTraceLimit=50;
  DatabaseSync.prototype.prepare=function(sql){
    if(sql.startsWith('SELECT paused,enabled FROM episode_controls'))visits++;
    const statement=prepare.call(this,sql);
    if(/raw_parts|raw_messages/.test(sql))for(const method of ['get','all']){
      const execute=statement[method];statement[method]=function(...args){
        if(args.includes('z-target')&&new Error().stack.includes('disposition'))targetCleanup++;
        return execute.apply(this,args);
      };
    }return statement;
  };
  try{
    for(let i=0;i<6;i++){await s.tick({maxMs:5000});
      for(const intent of ['current','history'])assert.equal((await s.search({query:'target',intent})).candidates.length,0);}
  }finally{DatabaseSync.prototype.prepare=prepare;Error.stackTraceLimit=stackLimit;}
  assert.ok(visits>0);assert.ok(targetCleanup>0,'cleanup must visit the consumed late source during pause');assert.equal(s.indexCount(),9,'pause-only cleanup must preserve publications');
  assert.throws(()=>prepared.validate(),{code:'raw_search_unavailable'});
  await assert.rejects(s.prepare(before));
  assert.throws(()=>authority.inspect(before.ranges[0]),{code:'source_unavailable'});
  pause(f,false);assert.notEqual(authority.fence(),pausedFence);
  for(let i=0;i<4;i++){await save(f,'resumed-'+i,9+i);await s.tick({maxMs:5000});
    assert.equal((await s.search({query:'target',intent:'history'})).candidates.length,1);}
});

for(const barrier of ['pause','disabled'])test(`${barrier} disposition preserves bytes but permanent denial still removes`,async t=>{
  const f=sourceFixture(t),source=await savedSource(f,'copper target');const s=await searchFixture(f);await finish(s);
  const {authority,storage}=await ports(t,f,s);const row=(await storage.snapshot()).rows[0];
  pause(f,true);if(barrier==='disabled')f.db.prepare('UPDATE episode_controls SET paused=0,enabled=0').run();
  assert.equal(authority.disposition(row.source),'paused');
  assert.throws(()=>authority.check(row.source),{code:'source_unavailable'});
  assert.throws(()=>authority.validate([{sources:[row.source],intent:'history',access(){},value:null}]),{code:'source_unavailable'});
  await assert.rejects(authority.open(row.source),{code:'source_unavailable'});
  f.db.prepare('INSERT INTO raw_source_exclusions VALUES(?,?,?,?,1)').run(source.conversationId,source.messageId,0,source.text.length);
  assert.equal(authority.disposition(row.source),'remove');for(let i=0;i<8&&s.indexCount();i++)await s.tick({maxMs:5000});assert.equal(s.indexCount(),0);
});

for(const change of ['missing-anchor','reused-highest','regressed-tip','binding','version'])test(`journal continuity recovers newest tail after ${change}`,async t=>{
  const f=sourceFixture(t);await save(f,'first',1);
  if(change==='regressed-tip'){await save(f,'second',2);await save(f,'third',3);}
  const s=await searchFixture(f);await s.maintain();
  const {storage,authority}=await ports(t,f,s),initial=checkpoint(s),position=initial.recent.examined;
  if(change==='binding'||change==='version'){
    const next=structuredClone(initial);if(change==='binding')next.recent.binding='different';else next.recent.version=0;
    await storage.commitBatch({checkpoint:next});
  }else if(change==='reused-highest'){
    const row=f.db.prepare('SELECT id,revision FROM raw_conversations').get();
    ok(f.core.deleteConversation({namespace:ns,conversationId:row.id,expectedRevision:row.revision,actionId:'synthetic-delete-anchor'}));
  }else{
    // Synthetic deletion of only journal hints isolates continuity from source
    // denial. Canonical capture ancestry and parts remain fully authenticated.
    f.db.exec('PRAGMA foreign_keys=OFF');
    f.db.prepare('DELETE FROM raw_events WHERE rowid=?').run(BigInt(position));
    if(change==='regressed-tip')f.db.prepare('DELETE FROM raw_events').run();
    f.db.exec('PRAGMA foreign_keys=ON');
  }
  if(change==='missing-anchor'){await save(f,'gap',2);await save(f,'replacement',3);}
  else if(change==='reused-highest')await save(f,'replacement',1,'replacement');
  else await save(f,'replacement',change==='regressed-tip'?4:2);
  const tip=f.db.prepare('SELECT CAST(max(rowid) AS TEXT) AS tip FROM raw_events').get().tip;
  if(change==='reused-highest')assert.equal(tip,position);
  if(change==='regressed-tip')assert.ok(BigInt(tip)<BigInt(position));
  if(change==='missing-anchor')assert.ok(BigInt(tip)>BigInt(position));
  const recent=authority.recent(checkpoint(s).recent);assert.equal(recent.recovered,true);
  assert.ok(recent.rows.some(entry=>entry.key[1]==='replacement'));
  await s.tick({maxMs:5000});assert.ok((await s.search({query:'replacement'})).candidates.some(candidate=>candidate.messageId==='replacement'));
});

test('cursor and multipart offsets replay after an uncommitted publication; commit survives reopen',async t=>{
  const f=sourceFixture(t),messages=Array.from({length:12},(_,i)=>splitRaw('copper batch '+i,{id:'batch-'+i,ordinal:i+1})[0]);
  const input={...request(messages[0]),messages};ok(await f.core.captureRaw(input));
  const s=await searchFixture(f),{authority,storage}=await ports(t,f,s);
  const first=authority.recent(undefined,{limit:4});assert.equal(first.rows.length,4);
  assert.deepEqual(authority.recent(undefined,{limit:4}),first,'no commit replays exactly');
  let attempted=false;
  const interrupted=createRawSearchMaintenance({...storage,async commitBatch(){attempted=true;throw Object.assign(Error('synthetic interrupted commit'),{code:'source_busy'});}},authority,s.options);
  try{await interrupted.maintain({maxMs:5000},()=>{});}finally{await interrupted.close();}
  assert.equal(attempted,true);assert.equal(s.indexCount(),0);assert.equal(checkpoint(s).recent,undefined);
  await s.maintain({maxMs:5000});assert.equal(s.indexCount(),4);assert.equal(Object.values(checkpoint(s).recent.active)[0].partOffset,4);
  await s.reopen();for(let i=0;i<6;i++)await s.tick({maxMs:5000});assert.equal(s.indexCount(),12);
  const keys=(await storage.snapshot()).rows.map(row=>row.key);assert.equal(new Set(keys).size,12);
});

test('a source denial in the final callback prevents recent publication and cursor acknowledgement',async t=>{
  const f=sourceFixture(t);await save(f,'target',1);await save(f,'sibling',2);const s=await searchFixture(f);
  const {storage,authority}=await ports(t,f,s);const staged=[];let callbacks=0,changed=false,selected=false;
  const maintenance=createRawSearchMaintenance({...storage,async stage(row){const result=await storage.stage(row);staged.push(row);return result;}},{...authority,recent(...args){selected=true;return authority.recent(...args);}},s.options);
  t.after(()=>maintenance.close());
  await maintenance.maintain({maxMs:5000},guard=>{
    guard?.();
    // The last per-source callback denies the source checked just before it.
    // Only the final whole-batch snapshot can catch that earlier contributor.
    if(staged.length===2&&++callbacks===2){changed=true;const ref=staged[0].source.ref;
      f.db.prepare('INSERT INTO raw_source_exclusions VALUES(?,?,?,?,1)').run(ref.conversationId,ref.messageId,ref.span.start,ref.span.end);}
  });
  assert.equal(selected,true,'fixture must exercise the recent selector');
  assert.equal(changed,true);assert.equal(s.indexCount(),0);assert.equal(checkpoint(s).recent,undefined);
  assert.equal((await s.search({query:'target'})).candidates.length,0);
});

test('journal seeks are rowid bounded and a surviving anchor tolerates unrelated deletion',async t=>{
  const f=sourceFixture(t);for(let i=0;i<3;i++)await save(f,'event-'+i,i+1);
  const s=await searchFixture(f);await s.maintain();const {authority}=await ports(t,f,s);
  f.db.exec('PRAGMA foreign_keys=OFF');f.db.prepare('DELETE FROM raw_events WHERE rowid=1').run();f.db.exec('PRAGMA foreign_keys=ON');
  await save(f,'next',4);const result=authority.recent(checkpoint(s).recent);assert.equal(result.recovered,false);assert.ok(result.headers<=64);assert.ok(result.attempts<=4);
  for(const sql of ['SELECT rowid FROM raw_events WHERE rowid>1 AND rowid<=100 ORDER BY rowid LIMIT 32','SELECT rowid FROM raw_events WHERE rowid<=100 ORDER BY rowid DESC LIMIT 32']){
    const plan=f.db.prepare('EXPLAIN QUERY PLAN '+sql).all().map(row=>row.detail).join('\n');assert.match(plan,/INTEGER PRIMARY KEY/);assert.doesNotMatch(plan,/TEMP B-TREE|SCAN raw_events/);
  }
});

test('bootstrap bounds its newest tail and polls live saves before older recovery',async t=>{
  const f=sourceFixture(t);for(let i=0;i<72;i++)await save(f,'tail-'+String(i).padStart(2,'0'),i+1);
  const s=await searchFixture(f),{authority}=await ports(t,f,s);
  const first=authority.recent(undefined,{limit:1});assert.equal(first.rows[0].key[1],'tail-71');
  await save(f,'live',73);const next=authority.recent(first.cursor,{limit:1});
  assert.equal(next.rows[0].key[1],'live');assert.equal(next.recovered,false);
  let cursor=next.cursor;const found=new Set(['tail-71']);let headers=first.headers+next.headers;
  for(let i=0;i<100&&cursor.recovery;i++){
    const batch=authority.recent(cursor);assert.ok(batch.headers<=64);headers+=batch.headers;
    batch.rows.forEach(row=>found.add(row.key[1]));cursor=batch.cursor;
  }
  assert.equal(cursor.recovery,null);assert.ok(headers>=64);assert.equal(found.has('tail-00'),false);
  assert.equal(found.has('tail-08'),true);
});

test('reserved cleanup advances independently of appends and removes a late denied publication',async t=>{
  const f=sourceFixture(t);seed(f,'a-prefix','prefix');
  for(let i=0;i<24;i++)await save(f,'old-'+String(i).padStart(2,'0'),i+1);
  const s=await searchFixture(f);await finish(s);const {storage}=await ports(t,f,s);
  const old=(await storage.snapshot()).rows.at(-1);assert.ok(old);
  f.db.prepare('INSERT INTO raw_source_exclusions VALUES(?,?,?,?,1)').run(old.source.ref.conversationId,old.source.ref.messageId,
    old.source.ref.span.start,old.source.ref.span.end);
  let removed=false;
  for(let turn=0;turn<24;turn++){
    await save(f,'new-'+turn,25+turn);await s.tick({maxItems:4,maxMs:5000});
    assert.equal((await s.search({query:old.source.ref.messageId,intent:'history'})).candidates.some(c=>c.messageId===old.source.ref.messageId),false);
    if(!(await storage.lookup([old.key])).length){removed=true;break;}
  }
  assert.equal(removed,true);
});

test('an unavailable inventory commitment does not block recent publication or certify coverage',async t=>{
  const f=sourceFixture(t);f.db.exec('BEGIN IMMEDIATE');
  try{const insert=f.db.prepare('INSERT INTO raw_conversations VALUES(?,?,?,?,?,?,1,?,?)');
    for(let i=0;i<50001;i++)insert.run('a-empty-'+String(i).padStart(6,'0'),ns.ownerId,ns.scope,ns.projectId??'','codex','synthetic-empty-'+i,'synthetic','synthetic');
    f.db.exec('COMMIT');
  }catch(error){f.db.exec('ROLLBACK');throw error;}
  seed(f,'z-target','target');await save(f,'target',1,'target');
  const s=await searchFixture(f),{authority}=await ports(t,f,s);assert.throws(()=>authority.fence(),{code:'source_budget_exceeded'});
  const prepare=DatabaseSync.prototype.prepare;let census=0;
  DatabaseSync.prototype.prepare=function(sql){if(/json_group_array|coalesce\(max\(rowid\),0\) AS last FROM raw_conversations/.test(sql))census++;return prepare.call(this,sql);};
  let result;
  try{await s.maintain({maxMs:5000});result=await s.search({query:'target'});}
  finally{DatabaseSync.prototype.prepare=prepare;}
  assert.equal(census,0,'recent service and search must precede and avoid the full census');
  assert.ok(result.candidates.some(candidate=>candidate.messageId==='target'));
  assert.equal(result.coverage.status,'partial');assert.ok(result.coverage.causes.includes('index_incomplete'));
});

test('a paused namespace parks its offset without blocking another allowed namespace',async t=>{
  const f=sourceFixture(t),other={...ns,scope:'project',projectId:'synthetic-other'};
  await save(f,'paused',1);pause(f,true);
  ok(await f.core.captureRaw(request(splitRaw('copper allowed',{id:'allowed',ordinal:1})[0],{namespace:other,client:'codex',sessionId:'other',eventId:'other'})));
  const s=await searchFixture(f,{readSet:[ns,other]});await s.maintain({maxMs:5000});
  assert.ok((await s.search({query:'allowed'})).candidates.some(candidate=>candidate.messageId==='allowed'));
  assert.equal((await s.search({query:'paused'})).candidates.some(candidate=>candidate.messageId==='paused'),false);
  assert.ok(checkpoint(s).recent.active[JSON.stringify(ns)]);
  pause(f,false);for(let i=0;i<4;i++)await s.tick({maxMs:5000});
  assert.ok((await s.search({query:'paused'})).candidates.some(candidate=>candidate.messageId==='paused'));
});

for(const denial of ['forget','delete','exclusion','fence','namespace','owner'])test(`recent publications obey permanent ${denial} denial and are removed during pause`,async t=>{
  const model={extract:()=>({items:[{content:'Synthetic copper fact',kind:'fact',confidence:.8,sourceIndices:[0]}]})};
  const f=safetySourceFixture(t,{model}),source=await savedSource(f,'copper target'),s=await searchFixture(f);
  await s.maintain({maxMs:5000});assert.ok(checkpoint(s).recent);
  const candidate=(await s.search({query:'target'})).candidates[0];assert.ok(candidate);const handle=await s.prepare(candidate);
  const {authority,storage}=await ports(t,f,s),row=(await storage.snapshot()).rows[0];
  if(denial==='forget'){
    const memory=f.db.prepare('SELECT id,revision FROM memories WHERE deleted=0').get();
    ok(f.core.forget({namespace:ns,memoryId:memory.id,expectedRevision:memory.revision}));
  }else if(denial==='delete')ok(f.core.deleteConversation({namespace:ns,conversationId:source.conversationId,
    expectedRevision:source.expectedConversationRevision,actionId:'synthetic-delete'}));
  else if(denial==='exclusion')f.db.prepare('INSERT INTO raw_source_exclusions VALUES(?,?,?,?,1)').run(source.conversationId,source.messageId,0,source.text.length);
  else if(denial==='fence')f.db.prepare('INSERT INTO raw_session_fences SELECT owner_id,scope,project_id,client,session_key FROM raw_conversations WHERE id=?').run(source.conversationId);
  else transaction(f.db,()=>denial==='owner'?suppressOwnerInside(f.db,{ownerId:ns.ownerId,reason:'account_erasure',actionId:'synthetic-erasure'}):
    writeContentSuppressionInside(f.db,{namespace:ns,kind:'namespace',matchMode:'namespace',reason:'privacy_erase',actionId:'synthetic-erasure'}));
  for(const intent of ['current','history'])assert.equal((await s.search({query:'target',intent})).candidates.length,0);
  assert.throws(()=>handle.validate(),{code:'raw_search_unavailable'});assert.equal(authority.disposition(row.source),'remove');
  pause(f,true);for(let i=0;i<8&&s.indexCount();i++){await s.tick({maxMs:5000});assert.equal((await s.search({query:'target',intent:'history'})).candidates.length,0);}
  assert.equal(s.indexCount(),0);
});

test('a delayed embedding provider leaves recent lexical maintenance available',async t=>{
  let release,enter;const gate=new Promise(resolve=>release=resolve),arrived=new Promise(resolve=>enter=resolve);t.after(()=>release());
  const port={id:'synthetic-delayed',revision:'1',dimensions:2,normalization:'l2',async embed(texts,controls){
    enter();await gate;controls.beforeDispatch();return texts.map(()=>[1,0]);}};
  const f=sourceFixture(t);await save(f,'first',1);
  const s=await searchFixture(f,{embedder:port,policy:{family:'local',maxBatchDocuments:1,maxRequests:10,maxConcurrent:1,maxUsd:0}});
  await s.maintain();const work=s.tick({embeddings:true,maxMs:5000});work.catch(()=>{});await arrived;
  await save(f,'newtarget',2);await s.tick({maxMs:5000});
  const lexical=await openRawSearch({...s.options,embedder:undefined,policy:undefined});t.after(()=>lexical.close());
  assert.ok((await lexical.search({query:'newtarget'},s.host.token)).candidates.some(candidate=>candidate.messageId==='newtarget'));
  release();await work;await new Promise(resolve=>setImmediate(resolve));
});

test('row positions above the exact Number range retain integer continuity',async t=>{
  const f=sourceFixture(t);await save(f,'large',1);
  const large=9007199254741103n;f.db.prepare('UPDATE raw_events SET rowid=?').run(large);
  const s=await searchFixture(f),{authority}=await ports(t,f,s),first=authority.recent(undefined);
  assert.equal(first.cursor.examined,String(large));
  await save(f,'afterlarge',2);const next=authority.recent(first.cursor);
  assert.equal(next.recovered,false);assert.equal(next.cursor.examined,String(large+1n));
  assert.ok(next.rows.some(row=>row.key[1]==='afterlarge'));
});

test('pause committed by an opener prevents publication and resume retries the hint',async t=>{
  const f=sourceFixture(t);await save(f,'target',1);let paused=false;
  const open=f.port.openRaw;f.port.openRaw=async input=>{const result=await open(input);if(!paused){paused=true;pause(f,true);}return result;};
  const s=await searchFixture(f);await s.maintain();assert.equal(paused,true);assert.equal(s.indexCount(),0);
  assert.equal((await s.search({query:'target',intent:'history'})).candidates.length,0);
  pause(f,false);await s.tick();assert.ok((await s.search({query:'target'})).candidates.some(candidate=>candidate.messageId==='target'));
});

test('the physical header budget includes every row materialized before filtering',async t=>{
  const f=sourceFixture(t);await save(f,'first',1);const s=await searchFixture(f),{authority}=await ports(t,f,s);
  const cursor=authority.recent(undefined).cursor;
  for(let i=0;i<72;i++)await save(f,'backlog-'+i,i+2);
  const prepare=DatabaseSync.prototype.prepare;let materialized=0;
  DatabaseSync.prototype.prepare=function(sql){const statement=prepare.call(this,sql);
    if(sql.startsWith('SELECT CAST(rowid AS TEXT) AS position')&&/WHERE rowid[<>]/.test(sql)){
      for(const method of ['get','all']){const run=statement[method];statement[method]=function(...args){const result=run.apply(this,args);
        materialized+=Array.isArray(result)?result.length:result?1:0;return result;};}
    }return statement;};
  let batch;try{batch=authority.recent(cursor);}finally{DatabaseSync.prototype.prepare=prepare;}
  assert.ok(materialized>0);assert.equal(batch.headers,materialized);assert.ok(materialized<=64);assert.ok(batch.attempts<=4);
});

test('an unrelated append inside an opener does not discard recent source publication',async t=>{
  const f=sourceFixture(t);await save(f,'target',1);let moved=false;
  const open=f.port.openRaw;f.port.openRaw=async input=>{
    if(!moved){moved=true;await save(f,'independent',1,'other');}return open(input);};
  const s=await searchFixture(f);await s.maintain({maxMs:5000});
  assert.equal(moved,true);assert.equal(s.indexCount(),1);
  assert.ok((await s.search({query:'target'})).candidates.some(candidate=>candidate.messageId==='target'));
  await s.tick({maxMs:5000});assert.equal(s.indexCount(),2);
});

test('newest-first continuation publication preserves canonical range and text order',async t=>{
  const f=sourceFixture(t),text='copper '+'a'.repeat(5000),source=await savedSource(f,text),s=await searchFixture(f);
  await s.maintain({maxMs:5000});const {storage}=await ports(t,f,s),rows=(await storage.snapshot()).rows;
  assert.ok(rows.length>1);assert.ok(rows[0].source.ref.span.start>rows.at(-1).source.ref.span.start,'fixture exercises newest-first publication');
  const hit=(await s.search({query:'copper',intent:'history'})).candidates.find(candidate=>candidate.messageId===source.messageId);assert.ok(hit);
  const prepared=await s.prepare(hit,'history');
  assert.equal(prepared.validate().ranges.map(range=>range.text).join(''),text);
  assert.deepEqual(hit.ranges.map(ref=>ref.span.start),[...hit.ranges.map(ref=>ref.span.start)].sort((a,b)=>a-b));
});

test('failed recent attempts still reserve cleanup without acknowledging a positive cursor',async t=>{
  const f=sourceFixture(t),source=await savedSource(f,'copper target'),s=await searchFixture(f);await s.maintain();
  const {storage,authority}=await ports(t,f,s),before=checkpoint(s).recent.examined;
  f.db.prepare('INSERT INTO raw_source_exclusions VALUES(?,?,?,?,1)').run(source.conversationId,source.messageId,0,source.text.length);
  const maintenance=createRawSearchMaintenance(storage,{...authority,recent(){throw Object.assign(Error('synthetic recent contention'),{code:'source_busy'});}},s.options);
  t.after(()=>maintenance.close());
  for(let turn=0;turn<4&&s.indexCount();turn++){
    const {rawSearchTestWait}=await import('../testing/raw-search-clock.mjs');await rawSearchTestWait(1010);
    await maintenance.maintain({maxMs:5000},()=>{});
    assert.equal(checkpoint(s).recent.examined,before);
  }
  assert.equal(s.indexCount(),0);
});

test('a short quantum completes its admitted part after an opener spends the time budget',async t=>{
  const f=sourceFixture(t);await save(f,'first',1);await save(f,'second',2);
  const {rawSearchTestWait}=await import('../testing/raw-search-clock.mjs');
  const open=f.port.openRaw;f.port.openRaw=async input=>{await rawSearchTestWait(40);return open(input);};
  const s=await searchFixture(f);await s.maintain({maxMs:25});
  assert.equal(s.indexCount(),1);assert.ok(checkpoint(s).recent);
  assert.ok((await s.search({query:'second'})).candidates.some(candidate=>candidate.messageId==='second'));
  await s.tick({maxMs:25});assert.equal(s.indexCount(),2);
});

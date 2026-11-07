import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {performance} from 'node:perf_hooks';
import {createRawSearchAuthority} from '../raw-search-authority.mjs';
import {openReadDatabase} from '../read-database.mjs';
import {openRawSearchStorage} from '../raw-search-storage.mjs';
import {retrieveRaw,rawSearchPostings} from '../raw-search-retrieval.mjs';
import {transaction} from '../database.mjs';
import {writeContentSuppressionInside} from '../content-suppression-storage.mjs';
import {sourceFixture,savedSource,ns,ok,request,splitRaw,cardHost,localPlainPort} from '../testing/raw-source-fixtures.mjs';
import {searchFixture,safetySourceFixture} from '../testing/raw-search-fixtures.mjs';
import {eventTimeFixture} from '../testing/receipt-event-time-fixture.mjs';
import {openRawCaptureCore} from '../raw-capture.mjs';
import {rationaleModel} from '../testing/rationale-model.mjs';

function clock(t){
  const previous=Object.getOwnPropertyDescriptor(performance,'now');let now=performance.now();
  Object.defineProperty(performance,'now',{configurable:true,value:()=>now});
  t.after(()=>{if(previous)Object.defineProperty(performance,'now',previous);else delete performance.now;});
  return ms=>{now+=ms;};
}
function canonical(t,f,s){
  const reader=openReadDatabase(f.path,{contextRead:true});f.workspace.defer(()=>reader.db.close());
  return {reader,authority:createRawSearchAuthority(reader,s.options)};
}
const oneMemory=()=>{let count=0;return {extract:()=>({items:count++?[]:
  [{content:'Synthetic copper fact.',kind:'fact',confidence:.8,sourceIndices:[0]}]})};};
async function eventSource(t){
  const f=await eventTimeFixture(t,33),host=cardHost(),port=localPlainPort();
  const core=openRawCaptureCore({path:f.path,model:{...rationaleModel(),...oneMemory()},privateCards:host.options},
    {mode:'raw-v1',sources:true,port,readPolicy:()=>({generation:'synthetic',reason:null})});
  const db=f.connect();f.workspace.defer(()=>core.close());f.workspace.defer(()=>db.close());
  return {...f,core,db,host,port,call:(method,input)=>host.call(core,method,input)};
}

// Independent expected payloads include fields read through SELECT *, as well
// as explicit projections. Native column metadata observes the actual fence
// queries before JSON aggregation, so dropping any projected input is visible.
for(const eventTime of [false,true])test(`source commitment includes every canonical input projection: event time ${eventTime}`,async t=>{
  const f=eventTime?await eventSource(t):safetySourceFixture(t,{model:oneMemory()});await savedSource(f,'copper source');
  const s=await searchFixture(f),{reader,authority}=canonical(t,f,s),observed=[],identities=new Set(),native=[];
  const table=name=>f.db.prepare('SELECT * FROM '+name+' LIMIT 0').columns().map(c=>c.name);
  const expected=[
    ['id','owner_id','scope','project_id','client','session_key'],
    ['conversation_id','message_id','part_index','start','end','saved','digest','byte_count','event_id','reason','format','key_version','bytes','fingerprint',
      'role','ordinal','occurred_at','total_units','total_bytes'],
    table('raw_source_exclusions'),table('raw_session_fences'),table('raw_receipt_lineage'),
    ['receipt_id','conversation_id','message_id','start','end','id','owner_id','scope','project_id','client','session_key','role','total_units'],
    [...table('receipts'),'parent_id','owner_id','scope','project_id','revision','currentness','review_state','deleted','kind'],
    table('raw_source_maps'),['client','revision'],table('content_suppressions'),table('owner_suppression_epochs'),
    ['type','name','tbl_name','sql'],table('content_safety_control'),
  ];
  const prepare=reader.db.prepare.bind(reader.db);
  reader.db.prepare=sql=>{const statement=prepare(sql),columns=statement.columns.bind(statement),get=statement.get.bind(statement);
    statement.columns=()=>{const values=columns();observed.push(values.map(c=>c.name));native.push({sql,columns:values});return values;};
    if(sql.startsWith('SELECT singleton,')||sql.startsWith('SELECT generation FROM raw_exclusion_clocks')||/^PRAGMA (schema_version|user_version|application_id)$/.test(sql))
      statement.get=(...args)=>{identities.add(columns().map(c=>c.name).join(','));return get(...args);};
    return statement;};
  assert.ok(authority.fence());assert.deepEqual(observed,expected);
  assert.deepEqual([...identities].sort(),['singleton,store_id,cursor_secret','singleton,secret','schema_version','user_version','application_id','generation'].sort());
  t.diagnostic('fence-input-projections='+JSON.stringify(native));
});

test('direct output contributors include centres, adjacent terms and every scoped sibling',()=>{
  const segments=Array.from({length:300},(_,i)=>({key:'same-key',postings:rawSearchPostings('copper'),chunks:[],
    source:{ref:{namespace:{...ns,ownerId:i%2?'second-owner':ns.ownerId},conversationId:'session-'+Math.floor(i/3),
      messageId:'message-'+i,span:{start:0,end:6,precision:'exact'}},ordinal:i%3+1,role:'user',totalUnits:6}}));
  const result=retrieveRaw(segments,'copper'),keys=new Set(result.sources.map(s=>JSON.stringify(s.ref)));
  assert.ok(result.sources.length<segments.length);assert.ok(result.sources.length>1);
  for(const row of result.rows){
    const centre=segments.find(s=>JSON.stringify([s.source.ref.namespace,s.source.ref.conversationId,s.source.ref.messageId])===row.centerId);
    assert.ok(centre);assert.ok(keys.has(JSON.stringify(centre.source.ref)));
    for(const part of row.turn.segments)assert.ok(keys.has(JSON.stringify(part.source.ref)));
    for(const neighbour of segments.filter(s=>s.source.ref.conversationId===centre.source.ref.conversationId&&
      JSON.stringify(s.source.ref.namespace)===JSON.stringify(centre.source.ref.namespace)&&Math.abs(s.source.ordinal-centre.source.ordinal)===1))
      assert.ok(keys.has(JSON.stringify(neighbour.source.ref)));
  }
});

test('final source predicates run for the supplied output set inside the final snapshot',async t=>{
  const f=sourceFixture(t);await savedSource(f,'copper source');const s=await searchFixture(f);
  const {reader,authority}=canonical(t,f,s),source=authority.inventory().rows[0].source,fence=authority.fence();
  const prepare=reader.db.prepare.bind(reader.db);let predicates=0;
  reader.db.prepare=sql=>{if(sql.startsWith('SELECT c.client,c.session_key,')){
    assert.equal(reader.db.isTransaction,true);predicates++;}return prepare(sql);};
  assert.deepEqual(authority.validate([{sources:[source],fence,intent:'current',access(){},value:'allowed'}]),['allowed']);
  assert.equal(predicates,2,'one immutable source resolver and one canonical safety resolver, with no population pass');
});

test('source commitments include schema reattestation inputs',async t=>{
  const f=safetySourceFixture(t);await savedSource(f,'copper source');const s=await searchFixture(f);
  const {authority}=canonical(t,f,s),source=authority.inventory().rows[0].source,before=authority.fence();
  f.db.exec('CREATE TABLE synthetic_schema_cookie(marker TEXT)');
  assert.doesNotThrow(()=>authority.check(source));
  assert.notEqual(authority.fence(),before);assert.throws(()=>authority.checkFence(before),{code:'source_unavailable'});
});

test('unrelated message capture preserves outstanding source-scoped tickets',async t=>{
  const f=sourceFixture(t),source=await savedSource(f,'copper retained'),s=await searchFixture(f);await s.maintain();clock(t);
  const {authority}=canonical(t,f,s),before=authority.fence();
  const candidate=(await s.search({query:'copper'})).candidates[0],prepared=await s.prepare(candidate);
  const revision=f.db.prepare('SELECT revision FROM raw_conversations WHERE id=?').get(source.conversationId).revision;
  ok(await f.core.captureRaw(request(splitRaw('unrelated saved message',{id:'appended',ordinal:2})[0],{client:'codex',eventId:'appended'})));
  assert.ok(f.db.prepare('SELECT revision FROM raw_conversations WHERE id=?').get(source.conversationId).revision>revision);
  assert.notEqual(authority.fence(),before,'the new inventory observes appended messages');
  assert.doesNotThrow(()=>authority.checkFence(before),'the old source population remains bound');
  assert.equal(s.service.revalidate([prepared.ticket])[0].ranges[0].text,source.text);
  assert.equal((await s.service.classify(candidate,{},s.host.token)).kind,'current-eligible-bare');
});

for(const scope of ['foreign','other-namespace','missing'])test(`inbound ancestry binds its own endpoint: ${scope}`,async t=>{
  const f=sourceFixture(t,{model:oneMemory()}),source=await savedSource(f,'copper retained'),s=await searchFixture(f);
  const {authority}=canonical(t,f,s),receipt=f.db.prepare('SELECT id FROM receipts').get();assert.ok(receipt);
  const before=authority.fence(),id='ancestry-endpoint';
  if(scope!=='missing'){
    f.db.prepare('INSERT INTO raw_conversations VALUES(?,?,?,?,?,?,1,?,?)')
      .run(id,scope==='foreign'?'other-owner':ns.ownerId,scope==='foreign'?'personal':'project',scope==='foreign'?'':'other-project','codex','ancestor-session','synthetic','synthetic');
    f.db.prepare(`INSERT INTO raw_messages SELECT ?,message_id,ordinal,role,occurred_at,total_units,total_bytes,next_index,next_start,
      received_bytes,assembly_state,reason,reserved_bytes,first_event_id FROM raw_messages WHERE conversation_id=? AND message_id=?`)
      .run(id,source.conversationId,source.messageId);
  }else f.db.exec('PRAGMA foreign_keys=OFF');
  f.db.prepare('INSERT INTO raw_receipt_lineage VALUES(?,?,?,?,?,?)').run(receipt.id,id,source.messageId,0,source.text.length,'exact');
  const edge=authority.fence();assert.notEqual(edge,before);
  assert.throws(()=>authority.checkFence(before),{code:'source_unavailable'});
  if(scope!=='missing'){
    assert.deepEqual(f.db.prepare('PRAGMA foreign_key_check').all(),[]);
    // Keep the edge unchanged: only the ancestor's own scope component moves.
    f.db.prepare('UPDATE raw_conversations SET owner_id=? WHERE id=?').run('changed-ancestor-owner',id);
    assert.notEqual(authority.fence(),edge);
    assert.throws(()=>authority.checkFence(edge),{code:'source_unavailable'});
  }
});

for(const foreign of [false,true])test(`ancestor exclusions and facts use the ancestor's own scope: foreign ${foreign}`,async t=>{
  const f=safetySourceFixture(t,{model:oneMemory()}),source=await savedSource(f,'copper retained'),s=await searchFixture(f);
  const {authority}=canonical(t,f,s),receipt=f.db.prepare('SELECT id FROM receipts').get(),id='ancestor-source';
  const scope=foreign?{ownerId:'other-owner',scope:'personal',projectId:null}:{...ns,scope:'project',projectId:'other-project'};
  f.db.prepare('INSERT INTO raw_conversations VALUES(?,?,?,?,?,?,1,?,?)')
    .run(id,scope.ownerId,scope.scope,scope.projectId??'','codex','ancestor-session','synthetic','synthetic');
  f.db.prepare(`INSERT INTO raw_messages SELECT ?,message_id,ordinal,role,occurred_at,total_units,total_bytes,next_index,next_start,
    received_bytes,assembly_state,reason,reserved_bytes,first_event_id FROM raw_messages WHERE conversation_id=? AND message_id=?`)
    .run(id,source.conversationId,source.messageId);
  f.db.prepare('INSERT INTO raw_receipt_lineage VALUES(?,?,?,?,?,?)').run(receipt.id,id,source.messageId,0,source.text.length,'exact');
  let before=authority.fence();
  transaction(f.db,()=>writeContentSuppressionInside(f.db,{namespace:scope,kind:'raw',key:id,matchMode:'span',
    messageId:source.messageId,start:0,end:source.text.length,reason:'correction_supersession',actionId:'synthetic-ancestor-correction'}));
  assert.notEqual(authority.fence(),before);assert.throws(()=>authority.checkFence(before),{code:'source_unavailable'});
  before=authority.fence();
  f.db.prepare('INSERT INTO raw_source_exclusions VALUES(?,?,?,?,1)').run(id,source.messageId,0,source.text.length);
  assert.notEqual(authority.fence(),before);assert.throws(()=>authority.checkFence(before),{code:'source_unavailable'});
  assert.deepEqual(f.db.prepare('PRAGMA foreign_key_check').all(),[]);
});

test('forgetting a rare-term turn removes it from corpus statistics and returned scores',async t=>{
  const f=sourceFixture(t,{model:oneMemory()}),source=await savedSource(f,'rare rare copper',{sessionId:'first'});
  await savedSource(f,'rare copper specimen',{sessionId:'second'});await savedSource(f,'copper specimen',{sessionId:'third'});
  const s=await searchFixture(f);await s.maintain();clock(t);
  const {authority}=canonical(t,f,s),storage=await openRawSearchStorage({directory:s.directory,identity:authority.identity,bind:authority.bind,quotaBytes:512*1024*1024});
  f.workspace.defer(()=>storage.close());const snapshot=await storage.search(),before=await s.search({query:'rare copper'});
  const memory=f.db.prepare('SELECT id,revision FROM memories WHERE deleted=0').get();assert.ok(memory);
  ok(f.core.forget({namespace:ns,memoryId:memory.id,expectedRevision:memory.revision}));
  const eligible=authority.select(snapshot.rows,'current',Infinity).eligible;
  assert.equal(eligible.length,2);assert.ok(eligible.every(r=>r.source.ref.conversationId!==source.conversationId));
  const idf=rows=>{const n=rows.length,df=rows.filter(r=>r.postings.terms.some(([term])=>term==='rare')).length;
    return Math.log(1+(n-df+.5)/(df+.5));};
  assert.notEqual(idf(eligible),idf(snapshot.rows));
  const fresh=await s.search({query:'rare copper'}),expected=retrieveRaw(eligible,'rare copper');
  assert.deepEqual(fresh.candidates.map(c=>[c.id,c.score]),expected.rows.map(c=>[c.id,c.score]));
  assert.ok(fresh.candidates.some(c=>before.candidates.find(old=>old.id===c.id)?.score!==c.score));
  assert.ok(fresh.candidates.every(c=>c.conversationId!==source.conversationId));
});

test('missing commitment declares partial lexical coverage and checks all dependencies',async t=>{
  const f=sourceFixture(t),source=await savedSource(f,'copper alpha');
  ok(await f.core.captureRaw(request(splitRaw('copper beta',{id:'sibling',ordinal:2})[0],{client:'codex',eventId:'sibling'})));
  const embedder={id:'synthetic-fallback',revision:'1',dimensions:2,normalization:'l2',async embed(texts,c){c.beforeDispatch();return texts.map(()=>[1,0]);}};
  const s=await searchFixture(f,{embedder,policy:{family:'local',maxBatchDocuments:1,maxRequests:30,maxConcurrent:1,maxUsd:0}});
  await s.maintain();for(let i=0;i<4;i++)await s.tick({embeddings:true});clock(t);
  assert.equal((await s.search({query:'copper'})).semantic.state,'ready');
  const {authority}=canonical(t,f,s);
  f.db.prepare(`WITH RECURSIVE n(i) AS (SELECT 1 UNION ALL SELECT i+1 FROM n WHERE i<50001)
    INSERT INTO raw_conversations SELECT 'metadata-'||i,?,?,?,'codex','metadata-'||i,1,'synthetic','synthetic' FROM n`)
    .run(ns.ownerId,ns.scope,ns.projectId??'');
  assert.throws(()=>authority.fence(),{code:'source_budget_exceeded'});
  const result=await s.search({query:'copper'});
  assert.equal(result.coverage.status,'partial');assert.equal(result.semantic.state,'bm25-only');
  const candidate=result.candidates.find(c=>c.messageId==='sibling');assert.ok(candidate);
  const prepared=await s.prepare(candidate);
  f.db.prepare('INSERT INTO raw_source_exclusions VALUES(?,?,?,?,1)').run(source.conversationId,source.messageId,0,source.text.length);
  assert.throws(()=>s.service.revalidate([prepared.ticket]),{code:'raw_search_unavailable'});
});

test('cold first read declares deadline partial coverage using the functional clock',async t=>{
  const f=sourceFixture(t);await savedSource(f,'copper retained');const s=await searchFixture(f);await s.maintain();await s.reopen();
  const advance=clock(t),prepare=DatabaseSync.prototype.prepare;let pages=0,crossing;
  DatabaseSync.prototype.prepare=function(sql){
    const statement=prepare.call(this,sql);
    const method=sql.startsWith('SELECT * FROM (')?'all':
      sql.startsWith('SELECT count(*) AS count,json_group_array')?'get':null;
    if(method){
      const execute=statement[method];
      statement[method]=function(...args){const rows=execute.apply(this,args);pages++;
        if(pages===2){crossing=pages;advance(1001);}return rows;};
    }
    return statement;
  };
  t.after(()=>{DatabaseSync.prototype.prepare=prepare;});
  const result=await s.search({query:'copper'});
  assert.equal(crossing,2);assert.ok(pages<=crossing+1);
  assert.deepEqual(result,{version:'raw-search-v1',publication:null,candidates:[],
    coverage:{status:'partial',scanned:null,expanded:null,causes:['deadline']},semantic:{state:'unknown',reason:null}});
});

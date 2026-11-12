import {installRawSearchTestClock,rawSearchTestWait} from '../testing/raw-search-clock.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {sourceFixture,savedSource,ns,ok} from '../testing/raw-source-fixtures.mjs';
import {searchFixture,safetySourceFixture} from '../testing/raw-search-fixtures.mjs';
import {transaction} from '../database.mjs';
import {writeContentSuppressionInside} from '../content-suppression-storage.mjs';
import {retrieveRaw,rawSearchPostings} from '../raw-search-retrieval.mjs';
import {openRawSearch} from '../raw-search-index.mjs';

test.beforeEach(installRawSearchTestClock);
const oneMemory=()=>{let count=0;return {extract:()=>({items:count++?[]:
  [{content:'Synthetic copper fact.',kind:'fact',confidence:.8,sourceIndices:[0]}]})};};
for(const denial of ['forget','suppression','excluded','session-fenced'])test(`a ${denial} first-ranked message is skipped in both intents`,async t=>{
  const f=safetySourceFixture(t,{model:oneMemory()}),first=await savedSource(f,'copper confidential',{sessionId:'first'});
  await savedSource(f,'copper specimen with extra terms',{sessionId:'second'});
  const s=await searchFixture(f);await s.maintain();await s.tick();
  const before=await s.search({query:'copper'});assert.equal(before.candidates[0].conversationId,first.conversationId);
  if(denial==='forget'){
    const m=f.db.prepare('SELECT id,revision FROM memories WHERE deleted=0').get();
    ok(await f.call('forget',{namespace:ns,memoryId:m.id,expectedRevision:m.revision}));
  }else if(denial==='suppression')transaction(f.db,()=>writeContentSuppressionInside(f.db,{namespace:ns,kind:'raw',key:first.conversationId,
    matchMode:'span',messageId:first.messageId,start:0,end:first.text.length,reason:'privacy_erase',actionId:'synthetic-denial'}));
  else if(denial==='excluded')f.db.prepare('INSERT INTO raw_source_exclusions VALUES(?,?,?,?,1)').run(first.conversationId,first.messageId,0,first.text.length);
  else f.db.prepare('INSERT INTO raw_session_fences SELECT owner_id,scope,project_id,client,session_key FROM raw_conversations WHERE id=?').run(first.conversationId);
  for(const intent of ['current','history']){
    const result=await s.search({query:'copper',intent});
    assert.ok(result.candidates.every(row=>row.conversationId!==first.conversationId));
    assert.equal(result.candidates.length,1);
    for(const hit of result.candidates)assert.deepEqual((await s.prepare(hit,intent)).validate().ranges.map(r=>r.text),['copper specimen with extra terms']);
  }
});
test('ranked denial fills the 24-result page from later candidates',()=>{
  const ns={ownerId:'synthetic-owner',scope:'personal',projectId:null};
  const rows=Array.from({length:40},(_,i)=>({key:String(i),postings:rawSearchPostings('copper'),chunks:[],source:{
    ref:{namespace:ns,conversationId:String(i).padStart(3,'0'),messageId:'same'},ordinal:1,role:'user'}}));
  let checked=0;
  const result=retrieveRaw(rows,'copper',{accept(){return ++checked>10;}});
  assert.equal(result.rows.length,24);assert.equal(checked,34);
});
test('configured search defaults on and explicit false remains off',async t=>{
  const f=sourceFixture(t);await savedSource(f,'copper');const s=await searchFixture(f,{enabled:undefined});
  await s.maintain();assert.equal((await s.search({query:'copper'})).candidates.length,1);
  assert.equal(await openRawSearch(false),null);assert.equal(await openRawSearch({enabled:false}),null);
});
test('denial during final validation drops one hit and keeps allowed hits',async t=>{
  const f=sourceFixture(t),first=await savedSource(f,'copper',{sessionId:'first'});
  await savedSource(f,'copper specimen',{sessionId:'second'});let armed=false,calls=0;
  const s=await searchFixture(f,{setupHost(host){const current=host.authority.isCurrent;
    host.authority.isCurrent=(...args)=>{
      if(armed&&++calls===4)f.db.prepare('INSERT INTO raw_source_exclusions VALUES(?,?,?,?,1)').run(first.conversationId,first.messageId,0,first.text.length);
      return current(...args);
    };}});await s.maintain();armed=true;
  const result=await s.search({query:'copper'});assert.equal(calls>=4,true);
  assert.equal(result.candidates.length,1);assert.notEqual(result.candidates[0].conversationId,first.conversationId);
});

test('two owners and two namespaces holding identical text remain isolated before scoring',async t=>{
  const {mkdirSync}=await import('node:fs'),{join}=await import('node:path');
  const f=sourceFixture(t),foreign={...ns,ownerId:'other-owner'},project={...ns,scope:'project',projectId:'other-project'};
  const own=await savedSource(f,'copper identical text',{sessionId:'shared'});
  const other=await savedSource(f,'copper identical text',{namespace:foreign,sessionId:'shared'});
  const scoped=await savedSource(f,'copper identical text',{namespace:project,sessionId:'shared'});
  const s=await searchFixture(f);await s.maintain();
  const readers=[{namespace:ns,source:own,service:s.service}];
  for(const [name,namespace,source] of [['foreign',foreign,other],['project',project,scoped]]){
    const directory=join(f.workspace.path,name);mkdirSync(directory,{mode:0o700});
    const service=await openRawSearch({...s.options,directory,ownerId:namespace.ownerId,readSet:[namespace]});
    f.workspace.defer(()=>service.close());await rawSearchTestWait(1010);await service.maintain({},s.host.token);readers.push({namespace,source,service});
  }
  for(const {namespace,source,service} of readers){
    const result=await service.search({query:'copper'},s.host.token);assert.equal(result.candidates.length,1);
    assert.deepEqual(result.candidates[0].namespace,namespace);assert.equal(result.candidates[0].conversationId,source.conversationId);
    assert.equal((await service.prepare(result.candidates[0],{},s.host.token)).validate().ranges[0].text,'copper identical text');
  }
});

test('a denied first-ranked hit is replaced by enough later hits to fill the service page',async t=>{
  const f=sourceFixture(t),first=await savedSource(f,'copper',{sessionId:'first'});
  for(let i=0;i<29;i++)await savedSource(f,'copper specimen with extra terms '+i,{sessionId:'later-'+i});
  const s=await searchFixture(f);
  for(let i=0;i<30&&s.indexCount()<30;i++)await s.tick({maxItems:128,maxMs:5000});
  assert.equal(s.indexCount(),30);
  const before=await s.search({query:'copper'});assert.equal(before.candidates[0].conversationId,first.conversationId);
  f.db.prepare('INSERT INTO raw_source_exclusions VALUES(?,?,?,?,1)').run(first.conversationId,first.messageId,0,first.text.length);
  const result=await s.search({query:'copper'});assert.equal(result.candidates.length,24);
  assert.ok(result.candidates.every(row=>row.conversationId!==first.conversationId));
  assert.ok(result.candidates.some(row=>!before.candidates.some(old=>old.id===row.id)));
});

test('preparing a hit uses authenticated retained refs without decoding the ranking index again',async t=>{
  const f=sourceFixture(t),source=await savedSource(f,'copper retained text'),s=await searchFixture(f);
  await s.maintain();const hit=(await s.search({query:'copper'})).candidates[0];
  const prepare=DatabaseSync.prototype.prepare;
  DatabaseSync.prototype.prepare=function(sql){
    assert.ok(!sql.startsWith('SELECT s.*,h.sequence')&&!sql.startsWith('SELECT * FROM segments WHERE published=1 ORDER BY id '),'preparation must not scan the ranking index');
    return prepare.call(this,sql);
  };
  t.after(()=>{DatabaseSync.prototype.prepare=prepare;});
  assert.equal((await s.prepare(hit)).validate().ranges[0].text,source.text);
});

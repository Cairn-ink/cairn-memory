import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {performance} from 'node:perf_hooks';
import {sourceFixture,savedSource,ns} from '../testing/raw-source-fixtures.mjs';
import {transaction} from '../database.mjs';
import {writeContentSuppressionInside} from '../content-suppression-storage.mjs';
import {searchFixture,safetySourceFixture} from '../testing/raw-search-fixtures.mjs';

async function fixture(t,count=1){
  const f=safetySourceFixture(t);
  for(let i=0;i<count;i++)await savedSource(f,'Synthetic copper telescope '+i+'.',{sessionId:'synthetic-'+i});
  const s=await searchFixture(f);await s.maintain({maxItems:128,maxMs:5000});await s.reopen();
  const own=Object.getOwnPropertyDescriptor(performance,'now');let now=100;
  Object.defineProperty(performance,'now',{configurable:true,value:()=>now});
  t.after(()=>{if(own)Object.defineProperty(performance,'now',own);else delete performance.now;});
  return {f,s,advance:ms=>{now+=ms;}};
}
function observe(t,{advance,expireSelection=false,selectionMs=0,rebuildMs=0}={}){
  const stackLimit=Error.stackTraceLimit;Error.stackTraceLimit=50;
  const prepare=DatabaseSync.prototype.prepare;let rebuilds=0,checks=0,armed=expireSelection;
  DatabaseSync.prototype.prepare=function(sql){
    const statement=prepare.call(this,sql),stack=new Error().stack;
    if(sql.startsWith('SELECT * FROM (SELECT client,session_key,id FROM raw_conversations WHERE')){
      rebuilds++;advance(rebuildMs);
    }
    if(stack.includes('at checkInside')&&stack.includes('at selectUnit')){
      if(sql.startsWith('SELECT 1 FROM raw_source_maps WHERE'))checks++;
      for(const method of ['all','get']){const execute=statement[method];statement[method]=function(...args){
        const result=execute.apply(this,args);advance(armed?1001:selectionMs);armed=false;return result;
      };}
    }
    return statement;
  };
  t.after(()=>{DatabaseSync.prototype.prepare=prepare;Error.stackTraceLimit=stackLimit;});
  return {get rebuilds(){return rebuilds;},get checks(){return checks;}};
}
function assertEmpty(result){
  assert.deepEqual(result,{version:'raw-search-v1',publication:null,candidates:[],
    coverage:{status:'partial',scanned:null,expanded:null,causes:['deadline']},semantic:{state:'unknown',reason:null}});
}
test('a first selection deadline exposes only constants and no preparation',async t=>{
  const {s,advance}=await fixture(t);observe(t,{advance,expireSelection:true});
  const result=await s.search({query:'copper'});assertEmpty(result);
  await assert.rejects(s.prepare(result),{code:'stale_publication'});
});
test('a canonical version change between deadline attempts rebuilds from zero',async t=>{
  const {f,s,advance}=await fixture(t),work=observe(t,{advance,expireSelection:true});
  assertEmpty(await s.search({query:'copper'}));assert.equal(work.rebuilds,1);
  f.db.exec('UPDATE raw_owner_usage SET revision=revision+1');
  assert.equal((await s.search({query:'copper'})).candidates.length,1);
  assert.equal(work.rebuilds,2);
});

test('a complete version-verified commitment remains reusable after a later deadline',async t=>{
  const {s,advance}=await fixture(t),work=observe(t,{advance,expireSelection:true});
  assertEmpty(await s.search({query:'copper'}));assert.equal(work.rebuilds,1);
  const completed=await s.search({query:'copper'});
  assert.equal(completed.coverage.status,'complete');assert.equal(completed.candidates.length,1);
  assert.equal(work.rebuilds,1,'a later attempt reuses only the completed commitment');
});
for(const mutation of ['forget','suppression'])test(`a ${mutation} after a complete rebuild invalidates the admitted commitment before reuse`,async t=>{
  const {f,s,advance}=await fixture(t),work=observe(t,{advance,expireSelection:true});
  assertEmpty(await s.search({query:'copper'}));assert.equal(work.rebuilds,1);
  const row=f.db.prepare('SELECT conversation_id,message_id FROM raw_messages').get();
  if(mutation==='forget'){
    const memory=f.db.prepare('SELECT id,revision FROM memories WHERE deleted=0').get();assert.ok(memory);
    assert.equal((await f.call('forget',{namespace:ns,memoryId:memory.id,expectedRevision:memory.revision})).ok,true);
  }else transaction(f.db,()=>writeContentSuppressionInside(f.db,{namespace:ns,kind:'raw',key:row.conversation_id,
    matchMode:'span',messageId:row.message_id,start:0,end:1000,reason:'privacy_erase',actionId:'synthetic-suppression'}));
  assert.equal((await s.search({query:'copper'})).candidates.length,0);
  assert.equal(work.rebuilds,2,'the changed canonical version must start the rebuild from zero');
});

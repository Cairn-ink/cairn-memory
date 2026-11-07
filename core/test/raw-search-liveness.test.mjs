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
  const own=Object.getOwnPropertyDescriptor(performance,'now');let now=100;
  Object.defineProperty(performance,'now',{configurable:true,value:()=>now});
  t.after(()=>{if(own)Object.defineProperty(performance,'now',own);else delete performance.now;});
  const s=await searchFixture(f);
  for(let turn=0;s.indexCount()<count&&turn<100;turn++){now+=1010;await s.maintain({maxItems:128,maxMs:5000});}
  assert.equal(s.indexCount(),count);await s.reopen();
  return {f,s,advance:ms=>{now+=ms;}};
}
function observe(t,{advance,expireSelection=false,selectionMs=0,rebuildMs=0}={}){
  const stackLimit=Error.stackTraceLimit;Error.stackTraceLimit=50;
  const prepare=DatabaseSync.prototype.prepare;let rebuilds=0,checks=0,armed=expireSelection;const checked=[];
  DatabaseSync.prototype.prepare=function(sql){
    const statement=prepare.call(this,sql),stack=new Error().stack;
    if(sql.startsWith('SELECT * FROM (SELECT client,session_key,id FROM raw_conversations WHERE')&&sql.includes('WHERE 1 ORDER BY client,session_key LIMIT 32')){
      rebuilds++;advance(rebuildMs);
    }
    if(stack.includes('at checkInside')&&stack.includes('at selectUnit')){
      if(sql.startsWith('SELECT 1 FROM raw_source_maps WHERE'))checks++;
      for(const method of ['all','get']){const execute=statement[method];statement[method]=function(...args){
        const result=execute.apply(this,args);if(sql.startsWith('SELECT 1 FROM raw_source_maps WHERE'))checked.push(args[0]);advance(armed?1001:selectionMs);armed=false;return result;
      };}
    }
    return statement;
  };
  t.after(()=>{DatabaseSync.prototype.prepare=prepare;Error.stackTraceLimit=stackLimit;});
  return {get rebuilds(){return rebuilds;},get checks(){return checks;},takeChecks(){return checked.splice(0);}};
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

test('verified reusable work grows across deadline attempts and becomes available within three searches',async t=>{
  const {s,advance}=await fixture(t,40),work=observe(t,{advance,selectionMs:.25,rebuildMs:900});
  assert.equal(s.indexCount(),40);
  const attempts=[];
  // A third read audits how much work the first two attempts made reusable.
  for(let attempt=0;attempt<3;attempt++){
    const before=work.checks,result=await s.search({query:'copper'}),checked=work.takeChecks();
    attempts.push({checks:work.checks-before,uniqueChecks:new Set(checked).size,available:result.candidates.length>0});
    assert.equal(work.rebuilds,1,'a complete commitment is reusable on every later attempt');
    if(attempt===0)assertEmpty(result);else assert.ok(result.candidates.length);
  }
  const reusableAfterFirst=40-attempts[1].uniqueChecks,reusableAfterSecond=40-attempts[2].uniqueChecks;
  assert.ok(reusableAfterFirst>0,'verified units from the first deadline save row checks on the next attempt');
  assert.ok(reusableAfterSecond>reusableAfterFirst,'the second attempt leaves strictly more reusable work');
  assert.equal(reusableAfterSecond,40);assert.ok(attempts.findIndex(row=>row.available)+1<=3);
  t.diagnostic(JSON.stringify({attempts,reusableAfterFirst,reusableAfterSecond}));
});
for(const mutation of ['forget','suppression'])test(`a ${mutation} after a verified eligibility unit drops kept work before the next search`,async t=>{
  const {f,s,advance}=await fixture(t,40),work=observe(t,{advance,selectionMs:.25,rebuildMs:900});
  assertEmpty(await s.search({query:'copper'}));assert.ok(work.checks>0);
  const memory=f.db.prepare('SELECT id,revision FROM memories WHERE deleted=0 ORDER BY id LIMIT 1').get();
  const denied=f.db.prepare('SELECT conversation_id,message_id FROM raw_receipt_lineage WHERE receipt_id IN (SELECT id FROM receipts WHERE memory_id=?) LIMIT 1').get(memory.id);
  if(mutation==='forget')assert.equal((await f.call('forget',{namespace:ns,memoryId:memory.id,expectedRevision:memory.revision})).ok,true);
  else {
    const row=f.db.prepare('SELECT conversation_id,message_id FROM raw_receipt_lineage WHERE receipt_id IN (SELECT id FROM receipts WHERE memory_id=?) LIMIT 1').get(memory.id);
    transaction(f.db,()=>writeContentSuppressionInside(f.db,{namespace:ns,kind:'raw',key:row.conversation_id,
      matchMode:'span',messageId:row.message_id,start:0,end:1000,reason:'privacy_erase',actionId:'synthetic-suppression-unit'}));
  }
  const before=work.checks;
  assertEmpty(await s.search({query:'copper'}));
  assert.equal(work.rebuilds,2);assert.ok(work.checks-before>=before-1,'a new version starts eligibility checks from zero');
  const after=await s.search({query:'copper'});assert.equal(after.candidates.length,0);
  assert.ok(after.candidates.every(row=>row.conversationId!==denied.conversation_id));
});

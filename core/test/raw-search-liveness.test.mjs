import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {performance} from 'node:perf_hooks';
import {sourceFixture,savedSource} from '../testing/raw-source-fixtures.mjs';
import {searchFixture} from '../testing/raw-search-fixtures.mjs';

async function fixture(t,count=1){
  const f=sourceFixture(t);
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

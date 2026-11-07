import test from 'node:test';
import assert from 'node:assert/strict';
import {performance} from 'node:perf_hooks';
import {DatabaseSync} from 'node:sqlite';
import {sourceFixture,savedSource} from '../testing/raw-source-fixtures.mjs';
import {searchFixture} from '../testing/raw-search-fixtures.mjs';
import {rawVectorResidencySelected,reserveSharedVectors,MAX_CACHE_BYTES} from '../context-read-embedder.mjs';

for(const outcome of ['complete','deadline','error'])test(`closing a Raw service releases shared vector residency after ${outcome}`,async t=>{
  assert.equal(rawVectorResidencySelected,false);
  const f=sourceFixture(t);await savedSource(f,'Synthetic copper telescope.');
  const s=await searchFixture(f);assert.equal(rawVectorResidencySelected,true);await s.maintain();
  const own=Object.getOwnPropertyDescriptor(performance,'now'),prepare=DatabaseSync.prototype.prepare;
  let now=100,armed=true;
  Object.defineProperty(performance,'now',{configurable:true,value:()=>now});
  DatabaseSync.prototype.prepare=function(sql){
    if(armed&&sql.startsWith('SELECT s.*,h.sequence')){armed=false;
      if(outcome==='deadline')now+=1001;
      else if(outcome==='error')throw Error('synthetic storage error');
    }
    return prepare.call(this,sql);
  };
  try{
    if(outcome==='error')await assert.rejects(s.search({query:'copper'}),{code:'raw_search_unavailable'});
    else {const result=await s.search({query:'copper'});assert.equal(result.coverage.status,outcome==='deadline'?'partial':'complete');}
    await s.service.close();await s.service.close();assert.equal(rawVectorResidencySelected,false);
    const lease=reserveSharedVectors(20000,{id:'synthetic',revision:'1',dimensions:2,normalization:'l2'},MAX_CACHE_BYTES-20000*2*4);
    assert.ok(lease);lease.release();
  }finally{DatabaseSync.prototype.prepare=prepare;if(own)Object.defineProperty(performance,'now',own);else delete performance.now;await s.service.close();}
});

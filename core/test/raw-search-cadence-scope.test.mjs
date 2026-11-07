import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {createFakeEmbedder} from '../context-read-embedder.mjs';
import {RAW_SEARCH_CADENCE_MS} from '../raw-search-cache.mjs';
import {readTransaction} from '../database.mjs';
import {withContentSuppressionRequest,contentSuppressionRequestInside,cachedContentSuppressionRequestInside} from '../content-suppression-storage.mjs';
import {safetySourceFixture,searchFixture} from '../testing/raw-search-fixtures.mjs';
import {savedSource,ns} from '../testing/raw-source-fixtures.mjs';

test('idle cache checks start a fresh request and restore the caller account',async t=>{
  t.mock.timers.enable({apis:['setInterval']});
  const f=safetySourceFixture(t);await savedSource(f,'Synthetic copper telescope.');
  const port=createFakeEmbedder(),s=await searchFixture(f,{embedder:port,
    policy:{family:'local',maxBatchDocuments:1,maxRequests:50,maxConcurrent:1,maxUsd:0}});
  await s.maintain();await s.tick({embeddings:true});await s.tick();
  const prepare=DatabaseSync.prototype.prepare;let reader,checking=false,checks=0,shared=false,outer;
  DatabaseSync.prototype.prepare=function(sql){
    if(sql==='PRAGMA data_version'){
      reader=this;
      if(checking){checks++;shared ||= cachedContentSuppressionRequestInside(this,ns.ownerId)===outer;}
    }
    return prepare.call(this,sql);
  };
  t.after(()=>{DatabaseSync.prototype.prepare=prepare;t.mock.timers.reset();});
  await s.search({query:'copper'});assert.ok(reader);
  withContentSuppressionRequest(()=>{
    readTransaction(reader,()=>{outer=contentSuppressionRequestInside(reader,[ns]);});
    checking=true;
    try{t.mock.timers.tick(RAW_SEARCH_CADENCE_MS);}finally{checking=false;}
    assert.equal(cachedContentSuppressionRequestInside(reader,ns.ownerId),outer);
  },{fresh:true});
  assert.ok(checks>0);assert.equal(shared,false);
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { createHmac } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { openRawSearchStorage } from '../raw-search-storage.mjs';
import { createTestWorkspace } from '../../tools/testing/workspace.mjs';
import { installRawSearchTestClock } from '../testing/raw-search-clock.mjs';

test.beforeEach(installRawSearchTestClock);
async function fixture(t){
  const workspace=createTestWorkspace(t,{prefix:'raw-union-'}),directory=join(workspace.path,'index');mkdirSync(directory,{mode:0o700});
  const storage=await openRawSearchStorage({directory,identity:{storeId:'synthetic',fileIdentity:'synthetic',ownerId:'synthetic',readSet:[]},
    bind:(purpose,value)=>createHmac('sha256','synthetic-test-key').update(JSON.stringify([purpose,value])).digest('hex'),quotaBytes:512*1024*1024});
  workspace.defer(()=>storage.close());return storage;
}
async function populate(storage,count,size){
  for(let start=0;start<count;start+=64){
    const staged=[];
    for(let i=start;i<Math.min(count,start+64);i++)staged.push({...await storage.stage({key:'row-'+i,padding:'x'.repeat(size)}),expected:null});
    await storage.commitBatch({staged,checkpoint:{after:['','',-1],cycles:0}});
  }
}
test('newest slice reaches beyond ordinary bytes, deduplicates, and has identical cache shape',async t=>{
  const storage=await fixture(t);await populate(storage,280,40000);
  const ordinary=await storage.snapshot(),union=await storage.search(),shape=storage.publication();
  assert.equal(ordinary.partial,true);assert.equal(ordinary.rows.some(row=>row.key==='row-279'),false);
  assert.equal(union.rows.some(row=>row.key==='row-279'),true);
  assert.equal(union.rows.some(row=>row.key==='row-0'),true);
  assert.equal(new Set(union.rows.map(row=>row.key)).size,union.rows.length);
  assert.ok(union.hintBytes<=8*1024*1024);assert.equal(union.vectorBytes,0);
  for(const field of ['sequence','partial','partialReason','hintBytes','vectorBytes'])assert.equal(shape[field],union[field],field);
  assert.equal(union.partial,true);assert.equal(union.partialReason,'snapshot_byte_limit');
  const target=union.rows.find(row=>row.key==='row-279');
  await storage.commitBatch({remove:[target.segment],checkpoint:{}});
  const after=await storage.search();assert.equal(after.rows.some(row=>row.key==='row-279'),false);
  assert.ok(after.sequence>union.sequence);
});

test('one authenticated transaction owns both slices, even if a publication follows COMMIT',async t=>{
  const storage=await fixture(t);await populate(storage,280,40000);
  const before=storage.publication(),stage={...await storage.stage({key:'later'}),expected:null};
  const exec=DatabaseSync.prototype.exec;let changed=false,movement;
  DatabaseSync.prototype.exec=function(sql){const result=exec.call(this,sql);
    if(sql==='COMMIT'&&!changed){changed=true;movement=storage.commitBatch({staged:[stage],checkpoint:{}});}return result;};
  let union;
  try{union=await storage.search();await movement;}finally{DatabaseSync.prototype.exec=exec;}
  assert.equal(changed,true);assert.equal(union.sequence,before.sequence);assert.ok(union.rows.some(row=>row.key==='row-279'));
  assert.equal(union.rows.some(row=>row.key==='later'),false);
  assert.ok((await storage.search()).rows.some(row=>row.key==='later'));
});

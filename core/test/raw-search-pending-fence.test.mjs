import test from 'node:test';
import assert from 'node:assert/strict';
import { sourceFixture,savedSource,ns } from '../testing/raw-source-fixtures.mjs';
import { searchFixture } from '../testing/raw-search-fixtures.mjs';
import { installRawSearchTestClock,rawSearchTestWait } from '../testing/raw-search-clock.mjs';
import { openReadDatabase } from '../read-database.mjs';
import { createRawSearchAuthority } from '../raw-search-authority.mjs';
import { openRawSearchStorage } from '../raw-search-storage.mjs';
import { createRawSearchMaintenance } from '../raw-search-maintenance.mjs';

test.beforeEach(installRawSearchTestClock);
for(const movement of ['changed','expired'])test(`discarding pending vectors after a ${movement} fence preserves cleanup settlement`,async t=>{
  const f=sourceFixture(t);await savedSource(f,'Synthetic copper telescope.');
  const port={id:'synthetic-pending-fence-'+movement,revision:'1',dimensions:2,normalization:'l2',
    async embed(texts,controls){controls.beforeDispatch();return texts.map(()=>[1,0]);}};
  const s=await searchFixture(f,{embedder:port,
    policy:{family:'local',maxBatchDocuments:1,maxRequests:30,maxConcurrent:1,maxUsd:0}});
  await s.maintain();
  const reader=openReadDatabase(f.path,{contextRead:true});
  const authority=createRawSearchAuthority(reader,s.options);
  const storage={...await openRawSearchStorage({directory:s.directory,identity:authority.identity,bind:authority.bind,quotaBytes:512*1024*1024})};
  const maintenance=createRawSearchMaintenance(storage,authority,s.options);
  t.after(async()=>{await maintenance.close();await storage.close();reader.db.close();});
  const turn=async input=>{await rawSearchTestWait(1010);return maintenance.maintain({maxMs:5000,...input},()=>{});};
  // Complete lexical reconciliation before requesting one detached refresh.
  for(let i=0;i<8;i++)await turn();
  let status;
  for(let i=0;i<4;i++){
    status=await turn({embeddings:true});
    if(status.pending)break;
  }
  assert.equal(status.pending,true,'the provider result is waiting for settlement');
  const embeddedBefore=maintenance.status().embedded,stage=storage.stage,fence=authority.fence;
  let stagedVectors=0,discarded=false,cleanupCommits=0;
  storage.stage=async row=>{
    const staged=await stage(row);
    if(row.chunks.every(chunk=>chunk.vector)){
      stagedVectors++;
      f.db.prepare(`INSERT INTO episode_controls(owner_id,scope,project_id,generation,paused,enabled)
        VALUES(?,?,?,'synthetic-moved',0,1)`).run(ns.ownerId,ns.scope,ns.projectId??'');
    }
    return staged;
  };
  authority.fence=(...args)=>{
    if(stagedVectors){
      discarded=true;
      if(movement==='expired')throw Object.assign(new Error('search_deadline'),{code:'search_deadline',reason:'deadline'});
    }
    return fence(...args);
  };
  const commitBatch=storage.commitBatch;
  storage.commitBatch=async batch=>{
    if(discarded){assert.equal(batch.staged.length,0);cleanupCommits++;}
    return commitBatch(batch);
  };
  const settled=await turn();
  assert.equal(stagedVectors,1);assert.equal(discarded,true);
  assert.equal(cleanupCommits,1,'cleanup/checkpoint still commits after positive work is discarded');
  assert.equal(settled.phase,'idle');assert.equal(settled.error,null);assert.equal(settled.pending,false);
  assert.equal(settled.embedded,embeddedBefore,'discarded vectors are not counted');
  const rows=(await storage.snapshot()).rows;
  assert.equal(rows.length,1);assert.ok(rows[0].chunks.some(chunk=>!chunk.vector));
  storage.stage=stage;authority.fence=fence;storage.commitBatch=commitBatch;
  const next=await turn();
  assert.equal(next.phase,'idle');assert.equal(next.error,null);
  assert.equal((await s.search({query:'copper'})).candidates.length,1);
});

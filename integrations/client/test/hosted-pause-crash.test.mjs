import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { createTestWorkspace } from '../../../tools/testing/workspace.mjs';
import { withWriteObserver, privateWrite } from '../private-state.mjs';
import { observeHostedPause, withHostedPauseGate } from '../hosted-pause.mjs';
import { hostedTargetId } from '../transport-hosted.mjs';
import { readControlState } from '../control-state.mjs';

for (const stage of ['intent','rotation','publication','completion','checkpoint']) test(`interrupted ${stage} preserves authority and repairs without history growth`,{timeout:10000},async t=>{
  const root=join(createTestWorkspace(t).path,'state');await mkdir(root,{mode:0o700});
  const config={root,endpoint:'http://127.0.0.1:1'};
  let remote={paused:false,generation:0,enforced:true};
  t.mock.method(globalThis,'fetch',async()=>Response.json(remote));
  const observe=()=>observeHostedPause(config,'synthetic-token');await observe();
  const local=await readControlState(root);
  const path=join(root,'hosted-pause',hostedTargetId(config)+'.json');
  // Checkpoint interruption needs obsolete history to prove repair prunes it.
  if(stage==='checkpoint') {remote={...remote,generation:1,paused:true};await observe();}
  remote={...remote,generation:1,paused:false};
  const selected={intent:path+'.intents/1.false.json',rotation:join(root,'control.json'),
    publication:path,completion:path+'.intents/1.false.complete',checkpoint:path+'.high-water'}[stage];
  let injected=false;
  await assert.rejects(withWriteObserver(async ({path:written,kind})=>{
    if(kind==='write'&&written===selected&&!injected){
      injected=true;
      // A delayed older publisher can add a dominated intent after compaction's
      // earlier list. Checkpoint recovery must have real pruning work to repair.
      if(stage==='checkpoint')await privateWrite(path+'.intents/1.true.json',JSON.stringify({generation:1,paused:true}));
      throw new Error('synthetic_interruption');
    }
  },observe),/synthetic_interruption/);
  assert.ok(injected,'fault_stage_reached');
  if(stage==='checkpoint')assert.ok((await readdir(path+'.intents')).includes('1.true.json'),'interrupted_compaction_has_dominated_record');
  let started=0;
  if(['completion','checkpoint'].includes(stage)) await withHostedPauseGate(config,1,()=>{started++;});
  else {
    await assert.rejects(withHostedPauseGate(config,0,()=>{started++;}),/pause_unavailable/);
    await assert.rejects(withHostedPauseGate(config,1,()=>{started++;}),/pause_unavailable/);
  }
  assert.equal(started,['completion','checkpoint'].includes(stage)?1:0,'crash_stage_authority');
  if(stage==='rotation')assert.notEqual((await readControlState(root)).generation,local.generation);
  await observe();await withHostedPauseGate(config,1,()=>{});
  assert.deepEqual((await readdir(path+'.intents')).sort(),['1.false.complete','1.false.json'],'repair_bounded_journal');
  assert.deepEqual(JSON.parse(await readFile(path+'.high-water','utf8')),{generation:1,paused:false});
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { createTestWorkspace } from '../../../tools/testing/workspace.mjs';
import { observeHostedPause, withHostedPauseGate } from '../hosted-pause.mjs';
import { withWriteObserver } from '../private-state.mjs';
import { hostedTargetId } from '../transport-hosted.mjs';

test('two hundred interrupted rotations retain one pending high-water intent',{timeout:60000},async t=>{
  const root=join(createTestWorkspace(t).path,'state');await mkdir(root,{mode:0o700});
  const config={root,endpoint:'http://127.0.0.1:1'};
  let remote={paused:false,generation:0,enforced:true};
  t.mock.method(globalThis,'fetch',async()=>Response.json(remote));
  const observe=()=>observeHostedPause(config,'synthetic-token');await observe();
  for(let generation=1;generation<=200;generation++){
    remote={...remote,generation,paused:true};
    await assert.rejects(withWriteObserver(({path,kind})=>{
      if(kind==='write'&&path===join(root,'control.json'))throw new Error('synthetic_rotation_failure');
    },observe),/synthetic_rotation_failure/);
  }
  const names=await readdir(join(root,'hosted-pause',hostedTargetId(config)+'.json.intents'));
  t.diagnostic(JSON.stringify({cycles:200,files:names.length,names}));
  assert.deepEqual(names,['200.true.json'],'bounded_pending_journal');
  await assert.rejects(withHostedPauseGate(config,0,()=>assert.fail('stale_send')),/pause_unavailable/);
  remote={...remote,paused:false};await observe();
  await withHostedPauseGate(config,200,()=>{});
});

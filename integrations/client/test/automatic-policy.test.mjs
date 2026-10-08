import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { createTestWorkspace } from '../../../tools/testing/workspace.mjs';
import { automaticGuard,rotateAutomaticBoundary } from '../automatic-policy.mjs';
import { readControlState,setPaused } from '../control-state.mjs';
import { resetBoundary } from '../transport-hosted.mjs';

test('Codex workers consume one policy, reservation store and daily charge',async t=>{
  const ws=createTestWorkspace(t);const root=join(ws.path,'root');await mkdir(root,{mode:0o700});
  const policy={version:1,dailyCap:1,concurrency:2};const endpoint='https://synthetic.invalid';
  const codex=automaticGuard(root,endpoint,policy),other=automaticGuard(root,endpoint,policy);
  const first=await codex.reserve();assert.equal(first.ok,true);
  const started=await codex.dispatch(first.id,()=>({started:true,operation:Promise.resolve()}));assert.equal(started.ok,true);
  await codex.release(first.id,{terminated:true,accepted:true});
  const denied=await other.reserve();assert.equal(denied.ok,false);assert.equal(denied.code,'daily_cap_reached');
  assert.equal((await other.status()).state.used,1);
});
test('generation rotation preserves active and paused states under the released control lock',async t=>{
  const ws=createTestWorkspace(t);const root=join(ws.path,'root');await mkdir(root,{mode:0o700});
  const first=await rotateAutomaticBoundary(root);assert.equal(first.paused,false);
  const paused=await setPaused(root,true);
  const next=await rotateAutomaticBoundary(root);assert.equal(next.paused,true);assert.notEqual(next.generation,paused.generation);
  const state=await readControlState(root);assert.equal(state.paused,true);assert.equal(state.generation,next.generation);
  await setPaused(root,false);assert.equal((await readControlState(root)).generation,next.generation);
});
test('sub-millisecond quota reset never authorizes an early attempt',()=>{
  assert.equal(resetBoundary('2026-10-08T12:00:00.0001Z'),Date.parse('2026-10-08T12:00:00Z')+1);
  assert.equal(resetBoundary('2026-10-08T12:00:00.0000Z'),Date.parse('2026-10-08T12:00:00Z'));
});

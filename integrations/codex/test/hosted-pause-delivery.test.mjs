import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { createTestWorkspace } from '../../../tools/testing/workspace.mjs';
import { recallContext } from '../hosted-lifecycle.mjs';
import { hostedTargetId } from '../../client/transport-hosted.mjs';

test('installed recall delivers synchronously while both final gates are held', async t => {
  const root=join(createTestWorkspace(t).path,'state'); await mkdir(root,{mode:0o700});
  const config={root,endpoint:'http://127.0.0.1:1'};
  t.mock.method(globalThis,'fetch',async url=>Response.json(url.endsWith('/pause-state')
    ? {paused:false,generation:0,enforced:true} : {memories:[{
      id:'12345678-1234-4234-8234-123456789abc', content:'Synthetic memory.', kind:'preference',
      scope:'personal', projectId:null, origin:'explicit', confidence:1,
      createdAt:'2026-10-01T00:00:00Z',updatedAt:'2026-10-01T00:00:00Z',
      receipts:[{client:'codex',sessionId:'s',eventId:'e',role:'user',excerpt:'Synthetic memory.',createdAt:'2026-10-01T00:00:00Z'}],
    }]}));
  let writes=0;
  const output=await recallContext({prompt:'Synthetic query',session_id:'s'},config,'synthetic-token',
    'a'.repeat(64),AbortSignal.timeout(5000),async()=>true,async()=>{},bytes=>{
      assert.ok(existsSync(join(root,'control.lock')),'delivery_control_lock');
      assert.ok(existsSync(join(root,'hosted-pause',hostedTargetId(config)+'.json.gate')),'delivery_shared_gate');
      assert.match(JSON.parse(bytes).hookSpecificOutput.additionalContext,/Synthetic memory/);
      writes++;
    });
  assert.equal(writes,1,'actual_delivery_callback');
  assert.equal(output,'','no_late_delivery_after_lock_cleanup');
});

test('installed entry starts the actual stdout write before releasing either gate', {timeout:15000}, async t=>{
  const { installedPrompt }=await import('./fixtures/prefetch-harness.mjs');
  const memories=[{id:'12345678-1234-4234-8234-123456789abc',content:'Synthetic memory.',kind:'preference',
    scope:'personal',projectId:null,origin:'explicit',confidence:1,
    createdAt:'2026-10-01T00:00:00Z',updatedAt:'2026-10-01T00:00:00Z',
    receipts:[{client:'codex',sessionId:'s',eventId:'e',role:'user',excerpt:'Synthetic memory.',createdAt:'2026-10-01T00:00:00Z'}]}];
  const result=await installedPrompt(t,{warm:false,memories,deliveryEvidence:true});
  assert.equal(result.code,0);assert.equal(result.signal,null);assert.equal(result.stderr,'');
  assert.match(JSON.parse(result.stdout).hookSpecificOutput.additionalContext,/Synthetic memory/);
  assert.deepEqual(result.delivery,{kind:'delivery',control:true,gate:true},'actual_stdout_write_is_gated');
});

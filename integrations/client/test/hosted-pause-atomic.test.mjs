import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { syncBuiltinESMExports } from 'node:module';
import { join } from 'node:path';
import { createTestWorkspace } from '../../../tools/testing/workspace.mjs';
import { observeHostedPause, withHostedPauseGate } from '../hosted-pause.mjs';
import { hostedTargetId } from '../transport-hosted.mjs';
import { readControlState, startIfActive, runIfActive } from '../control-state.mjs';
import { withWriteObserver } from '../private-state.mjs';

for (const sink of ['request', 'output']) test(`intent committed after final journal selection denies ${sink}`, { timeout: 10000 }, async t => {
  const root = join(createTestWorkspace(t).path, 'state');
  await fs.mkdir(root, {mode:0o700});
  const config = {root, endpoint:'http://127.0.0.1:1'};
  let remote = {paused:false, generation:1, enforced:true};
  t.mock.method(globalThis, 'fetch', async () => Response.json(remote));
  await observeHostedPause(config, 'synthetic-token');
  const local = await readControlState(root);
  const selected = Promise.withResolvers(), release = Promise.withResolvers(), durable = Promise.withResolvers();
  t.after(() => release.resolve());
  const originalOpen = fs.open;
  let completionReads = 0;
  const mocked = t.mock.method(fs, 'open', async function(path, ...args) {
    const handle = await originalOpen.call(this, path, ...args);
    // Outer check reads first; the second read is after selection inside the
    // final guard, with control.lock already held. Hold the read resolution.
    if (String(path).endsWith('/1.false.complete') && ++completionReads === 2) {
      assert.ok(await fs.stat(join(root, 'control.lock')));
      selected.resolve(); await release.promise;
    }
    return handle;
  });
  syncBuiltinESMExports();
  t.after(() => {mocked.mock.restore(); syncBuiltinESMExports();});
  let starts=0;
  const work = guard => sink==='request'
    ? startIfActive(root, local.generation, () => {starts++;}, {guard})
    : runIfActive(root, local.generation, () => {starts++;}, {guard});
  const dispatch = withHostedPauseGate(config,1,work);
  const settled = dispatch.then(value=>({value}),error=>({error}));
  await Promise.race([selected.promise, settled.then(()=>{throw new Error('final_selection_not_reached');})]);
  remote={paused:true,generation:2,enforced:true};
  const observing=withWriteObserver(async ({path,kind})=>{
    if (kind==='write' && path.endsWith('/2.true.json')) durable.resolve();
  },()=>observeHostedPause(config,'synthetic-token'));
  const observationResult=observing.then(value=>({value}),error=>({error}));
  await durable.promise;
  release.resolve();
  const result=await settled;
  assert.equal(starts,0,'no_side_effect_after_durable_intent');
  assert.match(result.error?.message ?? '',/pause_unavailable/);
  await observationResult;
});

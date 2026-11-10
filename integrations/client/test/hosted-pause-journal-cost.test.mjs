import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { syncBuiltinESMExports } from 'node:module';
import { join } from 'node:path';
import { createTestWorkspace } from '../../../tools/testing/workspace.mjs';
import { observeHostedPause, deferHostedPauseStatus, withHostedPauseGate } from '../hosted-pause.mjs';
import { hostedTargetId } from '../transport-hosted.mjs';

test('a changed observation compacts two hundred historical cycles before constant-cost warm checks', {timeout:60000}, async t=>{
  const root=join(createTestWorkspace(t).path,'state');await fs.mkdir(root,{mode:0o700});
  const config={root,endpoint:'http://127.0.0.1:1'};
  let remote={paused:false,generation:200,enforced:true};
  t.mock.method(globalThis,'fetch',async()=>Response.json(remote));
  const observe=()=>observeHostedPause(config,'synthetic-token');await observe();
  const directory=join(root,'hosted-pause',hostedTargetId(config)+'.json.intents');
  // Seed the exact released journal representation. Durability is exercised by
  // the separate fault/crash tests; this fixture isolates history-size cost.
  const entries=[];
  for(let generation=1;generation<=200;generation++)for(const paused of [true,false]) {
    const bytes=JSON.stringify({generation,paused});
    for(const suffix of ['json','complete'])entries.push([join(directory,`${generation}.${paused}.${suffix}`),bytes]);
  }
  for(let start=0;start<entries.length;start+=16)await Promise.all(entries.slice(start,start+16).map(([path,bytes])=>fs.writeFile(path,bytes,{mode:0o600})));
  assert.equal((await fs.readdir(directory)).length,800,'historical_fixture_complete');
  remote={...remote,generation:201};await observe();
  const names=await fs.readdir(directory);
  assert.equal(names.length,2,'bounded_seeded_journal_cost');
  const listed=[],original=fs.readdir;
  const mock=t.mock.method(fs,'readdir',async function(path,...args){
    const result=await original.call(this,path,...args);if(String(path)===directory)listed.push(result.length);return result;
  });syncBuiltinESMExports();
  try {
    const observation=deferHostedPauseStatus(config,'synthetic-token');
    await observation.observe();await observation.observe();
    await withHostedPauseGate(config,201,async check=>{await check();});
  } finally {mock.mock.restore();syncBuiltinESMExports();}
  assert.ok(listed.length>0);assert.ok(listed.every(count=>count===2),'bounded_seeded_names_per_check');
  t.diagnostic(JSON.stringify({historicalCycles:200,seededFiles:800,retained:names.length,listed}));
});

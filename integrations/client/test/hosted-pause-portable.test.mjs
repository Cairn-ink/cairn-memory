import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, readdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { createTestWorkspace } from '../../../tools/testing/workspace.mjs';
import * as pause from '../hosted-pause.mjs';
import { hostedTargetId } from '../transport-hosted.mjs';
import { stateLock } from '../state-lock.mjs';

async function fixture(t, platform='win32') {
  const root=join(createTestWorkspace(t).path,'state'); await mkdir(root,{mode:0o700});
  const config={root,endpoint:'http://127.0.0.1:1'};
  pause.hostedPauseMode?.(config,platform);
  let remote={paused:false,generation:0,enforced:true};
  t.mock.method(globalThis,'fetch',async()=> remote===undefined ? new Response('',{status:503}):Response.json(remote));
  return {root,config,remote:value=>{remote=value;},observe:()=>pause.observeHostedPause(config,'synthetic-token')};
}

test('native capability uses validated process state without a namespace lock or diagnostics',async t=>{
  const f=await fixture(t); await f.observe();
  assert.deepEqual(await readdir(f.root),[],'no_posix_barrier_or_diagnostics');
  let sent=0;await pause.withHostedPauseGate(f.config,0,()=>{sent++;});assert.equal(sent,1);
  assert.equal(pause.hostedPauseMode(f.config,'linux').barrier,false,'capability_selected_once');
});
for (const bad of [undefined,{paused:true,generation:1,enforced:true},{paused:false,generation:0,enforced:false},
  {paused:false,generation:0,enforced:true,extra:true}]) test(`native observation denies ${JSON.stringify(bad)}`,async t=>{
  const f=await fixture(t);await f.observe();f.remote(bad);
  try{const value=await f.observe(); assert.equal(value.paused,true);}catch{}
  await assert.rejects(pause.withHostedPauseGate(f.config,0,()=>assert.fail('denied_send')),/pause_unavailable/);
});
test('native generation regression and same-generation pause flip cannot reauthorize',async t=>{
  const f=await fixture(t);f.remote({paused:false,generation:2,enforced:true});await f.observe();
  for (const remote of [{paused:false,generation:1,enforced:true},{paused:true,generation:2,enforced:true}]) {
    f.remote(remote);await assert.rejects(f.observe(),/pause_unavailable/);
    await assert.rejects(pause.withHostedPauseGate(f.config,2,()=>assert.fail('regressed_send')),/pause_unavailable/);
  }
});
for(const platform of ['linux','darwin']) test(`${platform} lock timeout never selects portable mode`,{timeout:10000},async t=>{
  const f=await fixture(t,platform);await f.observe();
  const path=join(f.root,'hosted-pause',hostedTargetId(f.config)+'.json.lock');
  const entered=Promise.withResolvers(),release=Promise.withResolvers();
  const holder=stateLock(path,async()=>{entered.resolve();await release.promise;});
  t.after(async()=>{release.resolve();await holder;});await entered.promise;
  await assert.rejects(f.observe(),/state_busy/,'lock_failure_stays_closed');
  assert.equal(pause.hostedPauseMode(f.config).barrier,true);
});

test('unconfigured consumers retain the shared barrier on the native platform',t=>{
  const descriptor=Object.getOwnPropertyDescriptor(process,'platform');
  Object.defineProperty(process,'platform',{value:'win32',configurable:true});
  t.after(()=>Object.defineProperty(process,'platform',descriptor));
  assert.equal(pause.hostedPauseMode({}).barrier,true,'portable_capability_requires_client_selection');
});

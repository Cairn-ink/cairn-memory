import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync,writeFileSync,symlinkSync,existsSync,copyFileSync,chmodSync } from 'node:fs';
import { join } from 'node:path';
import { createTestWorkspace } from '../../../tools/testing/workspace.mjs';
import { binaryIdentity,resolveCLI } from '../../codex/qualification.mjs';
import { registerLocalQualificationTestRoot,runLocalQualification,launchLocalQualification,
  detectLocalCodexHost,awaitLocalQualificationTestChildren } from '../raw/local-codex-qualification.mjs';

for(const escape of ['symlink','PATH','Node-bin']) test(`synthetic probe refuses ${escape} escape before executing or collecting`,async t=>{
  const owned=createTestWorkspace(t),outside=createTestWorkspace(t),root=owned.path;
  const config=join(root,'installation.json');writeFileSync(config,'{}',{mode:0o600});
  const nativeBin=escape==='Node-bin'?join(outside.path,'node-bin'):outside.path;
  if(nativeBin!==outside.path)mkdirSync(nativeBin,{mode:0o700});
  const sentinel=join(outside.path,'executed'),external=join(nativeBin,'codex');
  writeFileSync(external,'#!/bin/sh\n: > '+sentinel+'\n',{mode:0o700});
  const unregister=registerLocalQualificationTestRoot(root);owned.defer(unregister);
  let binary=external;
  if(escape==='symlink'){binary=join(root,'codex');symlinkSync(external,binary);}
  // PATH and Node's prepended bin are deliberately outside this fixture. Only
  // the resolved absolute executable may reach the boundary, never PATH trust.
  const host=escape==='symlink'?{binaryPath:binary,identity:await binaryIdentity(binary),kind:'cli'}:
    await resolveCLI({PATH:nativeBin+':'+root});
  assert.equal(host.binaryPath,escape==='symlink'?binary:external);
  let collected=0;
  await assert.rejects(runLocalQualification(config,host,{collect:async()=>{collected++;}}),/synthetic_probe_outside_fixture/);
  assert.throws(()=>launchLocalQualification(config,host),/synthetic_probe_outside_fixture/);
  assert.equal(collected,0);assert.equal(existsSync(sentinel),false);
});

test('synthetic host discovery refuses real ancestry even under a native parent',async()=>{
  await assert.rejects(detectLocalCodexHost(),/synthetic_real_ancestry_forbidden/);
});

test('cold qualification child inherits the allowlist and is awaited',async t=>{
  const owned=createTestWorkspace(t),root=owned.path,qroot=join(root,'cache');mkdirSync(qroot,{mode:0o700});
  mkdirSync(join(qroot,'qualification'),{mode:0o700});
  const config=join(qroot,'installation.json'),binary=join(root,'codex');
  writeFileSync(config,'{}',{mode:0o600});
  // An actual fixture-owned Node copy fails Codex version qualification without
  // a shell fallback or any lookup of a runner-native executable.
  copyFileSync(process.execPath,binary);chmodSync(binary,0o700);
  const unregister=registerLocalQualificationTestRoot(root);owned.defer(async()=>{await awaitLocalQualificationTestChildren();unregister();});
  const host={binaryPath:binary,identity:await binaryIdentity(binary),kind:'cli'};
  await launchLocalQualification(config,host);
  await awaitLocalQualificationTestChildren();
  assert.ok(existsSync(join(qroot,'qualification',host.identity+'.local-attempt.json')));
});

import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdirSync, readdirSync, writeFileSync, existsSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createTestWorkspace } from '../../tools/testing/workspace.mjs';
import { buildArtifact } from '../build.mjs';
import { runMemberProcess } from './fixtures/topic-members-process.mjs';

function privateTemp(t) {
  const ws=createTestWorkspace(t,{prefix:'e1m-review-cleanup-'}),saved={};
  for(const name of ['TMPDIR','TMP','TEMP']){saved[name]=process.env[name];process.env[name]=ws.path;}
  t.after(()=>{for(const name of ['TMPDIR','TMP','TEMP']){if(saved[name]===undefined)delete process.env[name];else process.env[name]=saved[name];}});
  return ws;
}
for(const exit of [0,7]) test(`spec P2: Installed acceptance leaks its scratch artifacts — subprocess exit ${exit}`,t=>{
  const ws=privateTemp(t),config=join(ws.path,'empty.npmrc');writeFileSync(config,'');
  const before=readdirSync(ws.path).sort();
  const child=runMemberProcess(process.execPath,['-e',`console.log('out');console.error('err');process.exit(${exit})`],ws.path,config);
  assert.equal(child.error,undefined);assert.equal(child.status,exit);assert.equal(child.signal,null);
  assert.equal(child.stdout,'out\n');assert.equal(child.stderr,'err\n');
  assert.deepEqual(readdirSync(ws.path).sort(),before,'collect diagnostics then remove subprocess output and child temp files');
});
test('spec P2: Installed acceptance leaks its scratch artifacts — failed artifact build ownership',async t=>{
  const ws=privateTemp(t);let directory;
  assert.throws(()=>buildArtifact({ownDirectory:path=>{directory=path;ws.defer(()=>rmSync(path,{recursive:true,force:true}));},
    runCommand(){throw Error('controlled_pack_failure');}}),/controlled_pack_failure/);
  assert.ok(directory,'ownership must register immediately, before a pack failure');
  assert.equal(existsSync(directory),true);await ws.cleanup();assert.equal(existsSync(directory),false);
});
for (const fail of [false,true]) test(`spec P2: Installed acceptance leaks its scratch artifacts — installed ${fail?'failure':'success'} teardown`,async t=>{
  const ws=privateTemp(t),config=join(ws.path,'empty.npmrc');writeFileSync(config,'');
  const scratch=join(ws.path,'child-scratch');mkdirSync(scratch);
  const fixture=fileURLToPath(new URL('./topic-members.test.mjs',import.meta.url));
  const hook=new URL('./fixtures/topic-members-review-failure.mjs',import.meta.url).href;
  const child=runMemberProcess(process.execPath,[...(fail?['--import',hook]:[]),fixture],ws.path,config,{TMPDIR:scratch,TMP:scratch,TEMP:scratch,NODE_NO_WARNINGS:'1'});
  assert.equal(child.error,undefined);assert.equal(child.signal,null);assert.equal(child.status,fail?1:0,child.stderr+'\n'+child.stdout);
  if(fail)assert.match(child.stdout,/23/,'controlled failure occurs after archive/install, in the installed child check');
  assert.deepEqual(readdirSync(scratch),[],'installed test must remove the archive owner, not just the install workspace');
});

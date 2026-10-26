import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';
import { createTestWorkspace } from '../../../tools/testing/workspace.mjs';
for (const mode of ['frozen','rollback','normal']) test(`file lock acquisition is monotonic with ${mode} wall clock`,{ timeout:5000 },async t => {
  const workspace = createTestWorkspace(t,{ prefix:'lock-monotonic-' }), driver = fileURLToPath(new URL('./fixtures/file-lock-monotonic.mjs',import.meta.url));
  const runner = fileURLToPath(new URL('../../../tools/testing/run.mjs',import.meta.url));
  const child = spawn(process.execPath,[runner,'--script',driver,join(workspace.path,'live.lock'),mode],{
    stdio:['ignore','pipe','pipe'],env:{ PATH:'/usr/bin:/bin',HOME:workspace.path,TMPDIR:workspace.path,TMP:workspace.path,TEMP:workspace.path,NODE_DISABLE_COMPILE_CACHE:'1' } });
  let stdout = '', stderr = '', entered;
  const ready = new Promise(resolve => { entered = resolve; });
  child.stdout.on('data',bytes => { stdout += bytes; if (stdout.includes('entered\n')) entered(); });
  child.stderr.on('data',bytes => { stderr += bytes; });
  const done = new Promise((resolve,reject) => { child.once('error',reject); child.once('close',(code,signal) => resolve({ code,signal })); });
  workspace.defer(async () => { if (child.exitCode === null && child.signalCode === null) child.kill('SIGTERM'); await done; });
  await Promise.race([ready,done.then(() => { throw Error('lock_child_exited_before_probe'); })]);
  // This race is TEST supervision only: a timed-out owned runner is always
  // killed/reaped before cleanup, never detached as production lock work.
  const result = await Promise.race([done.then(value => ({ finished:true,...value })),delay(500).then(() => ({ finished:false }))]);
  if (!result.finished) { child.kill('SIGTERM'); await done; }
  assert.equal(result.finished,true,'contended acquisition exceeded its50ms bound under500ms supervision');
  assert.equal(result.code,0,stderr); assert.equal(result.signal,null);
  const observed = JSON.parse(stdout.trim().split('\n')[1]); assert.equal(observed.acquired,false); assert.ok(observed.elapsed >= 40);
});

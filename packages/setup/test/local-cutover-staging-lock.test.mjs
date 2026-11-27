import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import { legacyFixture, linux, operator, prepare } from './local-cutover-fix-support.mjs';

async function exitedPid() {
  const child = spawn(process.execPath, ['-e', ''], { env: {}, stdio: 'ignore' });
  assert.deepEqual(await once(child, 'exit'), [0, null]);
  return child.pid;
}

test('candidate staging recovers only when the recorded installer and npm child have both exited', linux, async t => {
  const f = await legacyFixture(t);
  const lock = join(f.root, '.setup.lock');
  const installer = await exitedPid(), npm = await exitedPid();
  const record = (pid, child) => JSON.stringify({ pid, child, cutover: true }) + '\n';
  for (const active of [record(process.pid, npm), record(installer, process.pid)]) {
    writeFileSync(lock, active, { mode: 0o600 });
    operator(f, prepare, { code: 2 });
    assert.equal(readFileSync(lock, 'utf8'), active);
  }
  writeFileSync(lock, record(installer, npm), { mode: 0o600 });
  assert.match(operator(f, prepare), /Local cutover verified/u);
  assert.equal(existsSync(lock), false);
});

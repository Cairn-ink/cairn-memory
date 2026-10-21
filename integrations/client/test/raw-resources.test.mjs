import assert from 'node:assert/strict';
import test from 'node:test';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { readdir } from 'node:fs/promises';
import { createTestWorkspace } from '../../../tools/testing/workspace.mjs';

for (const mode of ['success','mkdtemp','directory-open','file-stat','directory-stat','directory-lstat','scratch-write','source-read','scratch-cap','cancel','foreign','heap']) {
  test(`actual bounded I/O and private scratch cleanup: ${mode}`,{ timeout:360000 },async t => {
    const workspace = createTestWorkspace(t,{ prefix:'raw-resource-parent-' });
    const child = spawn(process.execPath,[...(mode==='heap' ? ['--max-old-space-size=32']:[]),
      fileURLToPath(new URL('./fixtures/raw-resource-child.mjs',import.meta.url)),mode],{
      env:{ ...process.env,TMPDIR:workspace.path,TMP:workspace.path,TEMP:workspace.path },stdio:['ignore','pipe','pipe'] });
    let stdout = '',stderr = '',settled = false;
    child.stdout.on('data',chunk => { stdout += chunk; if (stdout.length>65536) child.kill('SIGKILL'); });
    child.stderr.on('data',chunk => { if (stderr.length<65536) stderr += chunk; });
    const exited = new Promise((resolve,reject) => { child.once('error',reject); child.once('close',(code,signal) => { settled = true; resolve({ code,signal }); }); });
    workspace.defer(async () => { if (!settled) child.kill('SIGKILL'); await exited; });
    assert.deepEqual(await exited,{ code:0,signal:null },stderr+'\n'+stdout);
    const report = JSON.parse(stdout.trim()); assert.equal(report.mode,mode); assert.equal(report.openHandles,0);
    assert.deepEqual(await readdir(workspace.path),[]); console.log(JSON.stringify(report));
  });
}

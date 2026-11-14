import test from 'node:test';
import assert from 'node:assert/strict';
import fsPromises, { mkdir, writeFile, realpath } from 'node:fs/promises';
import { syncBuiltinESMExports } from 'node:module';
import { join } from 'node:path';
import { createTestWorkspace } from '../../../tools/testing/workspace.mjs';
import { openLocalSource, withLocalSourceOpenCheckpoint } from '../raw/local-source-open.mjs';

for (const reject of ['file', 'ancestor']) test(`Darwin opener attempts all closes despite ${reject} close rejection and preserves the original error`, {
  skip: process.platform !== 'darwin' && 'Darwin descriptor cleanup requires the macOS ancestor walk; Linux delegates to openSource.',
}, async t => {
  const ws = createTestWorkspace(t, { prefix: 'local-source-close-' });
  const root = await realpath(ws.path), parent = join(root, 'one/two');
  await mkdir(parent, { recursive: true, mode: 0o700 });
  const path = join(parent, 'synthetic.jsonl'); await writeFile(path, 'synthetic\n', { mode: 0o600 });
  const open = fsPromises.open, opened = new Set(), attempted = new Set();
  t.mock.method(fsPromises, 'open', async function (target, ...args) {
    const handle = await open.call(this, target, ...args), close = handle.close.bind(handle);
    opened.add(handle);
    handle.close = async () => {
      attempted.add(handle);
      await close(); // Release the real descriptor even when injecting EIO.
      if ((target === path ? 'file' : 'ancestor') === reject)
        throw Object.assign(new Error('synthetic close rejection'), { code: 'EIO' });
    };
    return handle;
  });
  syncBuiltinESMExports();
  t.after(() => { t.mock.restoreAll(); syncBuiltinESMExports(); });
  const original = new Error('synthetic verification interruption');
  await assert.rejects(() => withLocalSourceOpenCheckpoint(phase => {
    if (phase === 'opened') throw original;
  }, () => openLocalSource(path)), error => error === original);
  assert.ok(opened.size > 3, 'the final file and every ancestor were pinned');
  assert.deepEqual(attempted, opened, 'all handles received a close attempt');
});

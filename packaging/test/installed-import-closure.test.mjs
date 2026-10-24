import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdirSync, symlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { createTestWorkspace } from '../../tools/testing/workspace.mjs';
import { installedImportClosure } from './fixtures/installed-import-closure.mjs';

function graph(t, files) {
  const workspace = createTestWorkspace(t, { prefix: 'installed-closure-' });
  const root = join(workspace.path, 'graph'); mkdirSync(root);
  for (const [path, text] of Object.entries(files)) writeFileSync(join(root, path), text);
  return { root, workspace, inspect: () => installedImportClosure(root, ['main.mjs']) };
}
test('literal Worker graph retains lazy modules/assets and eager shared dependencies win', t => {
  const f = graph(t, {
    'main.mjs': `import { Worker as Thread } from 'node:worker_threads'; import './shared.mjs';
      new Thread(new URL('./worker.mjs', import.meta.url), {});`,
    'shared.mjs': '', 'worker.mjs': `import './shared.mjs'; import './lazy.mjs'; new URL('./worker-only.txt', import.meta.url);`,
    'lazy.mjs': '', 'worker-only.txt': 'synthetic asset',
  });
  assert.deepEqual(f.inspect(), {
    required: ['lazy.mjs', 'main.mjs', 'shared.mjs', 'worker-only.txt', 'worker.mjs'],
    eager: ['main.mjs', 'shared.mjs'], lazy: ['lazy.mjs', 'worker-only.txt', 'worker.mjs'], workerEntries: ['worker.mjs'],
  });
});
test('a separately eager Worker module is never hidden in the lazy set', t => {
  const f = graph(t, { 'main.mjs': `import {Worker} from 'node:worker_threads'; import './worker.mjs';
    new Worker(new URL('./worker.mjs',import.meta.url));`, 'worker.mjs': `import './shared.mjs';`, 'shared.mjs': '' });
  assert.deepEqual(f.inspect().lazy, []); assert.deepEqual(f.inspect().eager, f.inspect().required);
});
test('an ordinary URL or a non-native Worker-looking constructor is eager', t => {
  const f = graph(t, { 'main.mjs': `class Worker {} new Worker(new URL('./asset.txt',import.meta.url));`, 'asset.txt': '' });
  assert.deepEqual(f.inspect().eager, ['asset.txt', 'main.mjs']); assert.deepEqual(f.inspect().workerEntries, []);
});
for (const lazy of [false, true]) test(`missing ${lazy ? 'lazy' : 'eager'} dependencies fail instead of disappearing`, t => {
  const f = graph(t, { 'main.mjs': lazy ? `import {Worker} from 'node:worker_threads'; new Worker(new URL('./missing.mjs',import.meta.url));`
    : `import './missing.mjs';` });
  assert.throws(f.inspect, { code: 'ENOENT' });
});
test('lexical out-of-root imports fail closed', t => {
  const f = graph(t, { 'main.mjs': `import '../outside.mjs';` });
  writeFileSync(join(f.workspace.path, 'outside.mjs'), '');
  assert.throws(f.inspect, /closure escapes root/);
});
test('a physical symlink escape cannot masquerade as an in-root asset', t => {
  const f = graph(t, { 'main.mjs': `new URL('./linked.txt',import.meta.url);` });
  const outside = join(f.workspace.path, 'outside.txt'); writeFileSync(outside, ''); symlinkSync(outside, join(f.root, 'linked.txt'));
  assert.throws(f.inspect, /closure escapes root/);
});

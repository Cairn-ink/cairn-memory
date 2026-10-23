import test from 'node:test';
import assert from 'node:assert/strict';
import { writeFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createTestWorkspace } from '../../../tools/testing/workspace.mjs';
import { implementationIdentity, sourceIdentity, validateImplementation } from '../assembly/identity.mjs';

test('implementation identity records commit, source hash, dirty state and detached state', async () => {
  const identity = await implementationIdentity();
  validateImplementation(identity);
  assert.match(identity.commit, /^[a-f0-9]{40}$/); assert.match(identity.sourceHash, /^[a-f0-9]{64}$/);
  assert.equal(typeof identity.dirty, 'boolean'); assert.equal(typeof identity.detached, 'boolean');
  assert.ok(identity.sourceFiles.includes('identity.mjs'));
  assert.ok(identity.sourceFiles.every(path => !path.includes('.hr2-')));
  assert.deepEqual(await sourceIdentity(), { sourceHash: identity.sourceHash, sourceFiles: identity.sourceFiles });
  // Uncommitted edits must remain identifiable even when HEAD is unchanged.
  if (identity.commit === 'e340164334ebdd2b94793ee822dc67ec12a09868') assert.equal(identity.dirty, true);
});

test('source hashing is deterministic, recursive and sensitive to code bytes, excluding docs and reserved scratch', async t => {
  const workspace = createTestWorkspace(t, { prefix: '.hr2-source-test-', parent: fileURLToPath(new URL('../assembly/', import.meta.url)) });
  await writeFile(join(workspace.path, 'a.mjs'), 'export const a = 1;\n');
  await mkdir(join(workspace.path, 'nested')); await writeFile(join(workspace.path, 'nested/b.mjs'), 'export const b = 2;\n');
  const before = await sourceIdentity(workspace.path);
  assert.deepEqual(before.sourceFiles, ['a.mjs', 'nested/b.mjs']);
  await writeFile(join(workspace.path, 'README.md'), 'A doc.\n');
  await mkdir(join(workspace.path, '.hr2-scratch')); await writeFile(join(workspace.path, '.hr2-scratch/ignored.mjs'), 'throw 1;\n');
  assert.deepEqual(await sourceIdentity(workspace.path), before);
  await writeFile(join(workspace.path, 'nested/b.mjs'), 'export const b = 3;\n');
  assert.notEqual((await sourceIdentity(workspace.path)).sourceHash, before.sourceHash);
});

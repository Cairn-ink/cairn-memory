import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdir, rename, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import test from 'node:test';
import { createTestWorkspace } from '../../../tools/testing/workspace.mjs';
import { captureStoreIdentity } from '../../../packaging/core-local/capture-binding.mjs';
import { assertActiveAuthority, managedGeneration } from '../../../packaging/core-local/daemon-authority.mjs';

test('managed daemon requires the active receipt and pinned database inode', { skip: process.platform !== 'linux' }, async t => {
  const { path: root } = createTestWorkspace(t);
  const source = join(root, 'memory.sqlite');
  const id = '00000000-0000-4000-8000-000000000001', attemptId = '00000000-0000-4000-8000-000000000002';
  const engine = 'core-local-v1-' + 'a'.repeat(64);
  const packageRoot = join(root, 'engine', engine, 'app/node_modules/cairn-memory-core-local-candidate');
  const maintenance = join(root, '.cutover-' + id);
  const database = join(root, 'cairn-capture-' + createHash('sha256').update(source).digest('hex') + '-' + attemptId + '.sqlite');
  const generation = managedGeneration(packageRoot);
  assert.equal(generation.root, root);
  assert.equal(managedGeneration(root), undefined);
  await mkdir(packageRoot, { recursive: true, mode: 0o700 });
  await mkdir(maintenance, { mode: 0o700 });
  const write = (path, value) => writeFile(path, JSON.stringify(value) + '\n', { mode: 0o600 });
  const descriptor = { version: 'cairn-local-installation-v2', state: 'installed', operation: null,
    ownerId: 'synthetic-owner', projectId: null, database: { path: source }, clients: { claude: {} },
    migration: { state: 'verified', targetEngineId: engine, cutover: { id, attemptId, sourcePath: source, aborting: false } } };
  const descriptorPath = join(root, 'installation.json');
  await write(descriptorPath, descriptor);
  await write(database, 'synthetic file identity');
  const options = { database, owner: descriptor.ownerId };
  const check = () => assertActiveAuthority(generation, options);
  await assert.rejects(check, { code: 'ENOENT' });
  const { device, inode } = await captureStoreIdentity(database);
  const receipt = { version: 1, phase: 'reclaimed', attempt: attemptId, source: '1:1', target: device + ':' + inode };
  const receiptPath = join(maintenance, 'activation.json');
  await write(receiptPath, receipt);
  await assert.rejects(check, { code: 'daemon_active_store' });
  await write(receiptPath, { ...receipt, phase: 'active' });
  assert.deepEqual(await check(), { path: database, dev: device, ino: inode });
  await assert.rejects(() => assertActiveAuthority(generation, { ...options, owner: 'foreign-owner' }), { code: 'daemon_active_store' });
  await write(descriptorPath, { ...descriptor, state: 'uninstalling' });
  await assert.rejects(check, { code: 'daemon_active_store' });
  await write(descriptorPath, descriptor);
  await rename(database, database + '.old');
  await write(database, 'synthetic inode replacement');
  await assert.rejects(check, { code: 'daemon_active_store' });
});

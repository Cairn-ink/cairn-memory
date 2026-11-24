import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import test from 'node:test';
import { createTestWorkspace } from '../../../tools/testing/workspace.mjs';
import { beginOperation, executableFor, newDescriptor, readDescriptor, recordClient,
  validateDescriptor, vectorArguments, withLocalLock, writeDescriptor } from '../lib/local-descriptor.mjs';
import { validateDescriptor as validateV1 } from './fixtures/local-descriptor-v1.mjs';

const legacyId = '1.2.3-0123456789ab';
const coreId = 'core-local-v1-' + 'a'.repeat(64);
const legacyEngine = { id: legacyId, package: 'cairn-memory-local-preview',
  packageVersion: '0.0.0-preview.1', sha256: 'b'.repeat(64) };
const candidate = { id: coreId, package: 'cairn-memory-core-local-candidate',
  packageVersion: '0.0.0', sha256: 'c'.repeat(64) };
const recovery = { key: 'local_recovery_required', code: 2 };

function installed(root, engine = legacyEngine) {
  const descriptor = newDescriptor(root, '1.2.3', { owner: 'synthetic-owner' });
  const vector = { engineId: engine.id, node: descriptor.node, databasePath: descriptor.database.path,
    ownerId: descriptor.ownerId, projectId: descriptor.projectId };
  beginOperation(descriptor, 'setup', ['claude'], { claude: join(root, 'client-home') }, vector);
  recordClient(descriptor, 'claude', vector);
  return Object.assign(descriptor, { engine, state: 'installed', operation: null });
}

test('the default v1 descriptor round-trips the same bytes and still validates in the old reader', async t => {
  const { path: root } = createTestWorkspace(t);
  t.mock.timers.enable({ apis: ['Date'], now: 0 });
  const descriptor = installed(root);
  assert.equal(descriptor.version, 'cairn-local-installation-v1');
  const path = join(root, 'installation.json');
  const bytes = Buffer.from(JSON.stringify(descriptor, null, 2) + '\n');
  await withLocalLock(root, () => writeDescriptor(root, descriptor));
  assert.deepEqual(await readFile(path), bytes);
  const loaded = await readDescriptor(root);
  assert.equal(validateV1(loaded, root), loaded);
  await withLocalLock(root, () => writeDescriptor(root, loaded));
  assert.deepEqual(await readFile(path), bytes);
  assert.equal(executableFor(root, legacyId),
    join(root, 'engine', legacyId, 'app/node_modules/cairn-memory-local-preview/bin/cairn-memory.mjs'));
});

test('v2 is optional and an old validator refuses it even without a journal', async t => {
  const { path: root } = createTestWorkspace(t);
  const descriptor = { ...installed(root), version: 'cairn-local-installation-v2' };
  assert.equal(validateDescriptor(descriptor, root), descriptor);
  assert.throws(() => validateV1(descriptor, root), recovery);
  descriptor.migration = { state: 'staged', sourceEngineId: legacyId, targetEngineId: coreId };
  assert.throws(() => validateV1(descriptor, root), recovery);
  await withLocalLock(root, () => writeDescriptor(root, descriptor));
  const read = await readDescriptor(root, { allowV2: true });
  assert.deepEqual(JSON.parse(JSON.stringify(read)), descriptor);
  await assert.rejects(readDescriptor(root), recovery);
});

test('the journal records completed checkpoints and resumable failures', t => {
  const { path: root } = createTestWorkspace(t);
  const journal = { sourceEngineId: legacyId, targetEngineId: coreId };
  const descriptor = { ...installed(root), version: 'cairn-local-installation-v2' };
  for (const state of ['staged', 'quiesced', 'backup-proved', 'migrated', 'verified']) {
    descriptor.migration = { ...journal, state };
    assert.equal(validateDescriptor(descriptor, root), descriptor);
    descriptor.migration = { ...journal, state: 'paused-recovery', resumeFrom: state };
    assert.equal(validateDescriptor(descriptor, root), descriptor);
  }
  for (const resumeFrom of [null, 'staged']) {
    descriptor.migration = { ...journal, state: 'failed', resumeFrom };
    assert.equal(validateDescriptor(descriptor, root), descriptor);
  }
  for (const invalid of [null, { ...journal, state: 'activated' }, { ...journal, state: 'failed' },
    { ...journal, state: 'failed', resumeFrom: 'migrated' },
    { ...journal, state: 'paused-recovery', resumeFrom: null },
    { ...journal, state: 'paused-recovery', resumeFrom: 'activated' },
    { ...journal, state: 'staged', resumeFrom: 'staged' },
    { ...journal, state: 'staged', targetEngineId: legacyId },
    { ...journal, state: 'staged', sourceEngineId: '1.2.3-fedcba987654' }]) {
    descriptor.migration = invalid;
    assert.throws(() => validateDescriptor(descriptor, root), recovery);
  }
  descriptor.migration = { ...journal, state: 'staged' };
  assert.throws(() => validateDescriptor({ ...descriptor, version: 'cairn-local-installation-v1' }, root), recovery);
});

test('an activated descriptor resolves the candidate path and checks its package identity', t => {
  const { path: root } = createTestWorkspace(t);
  const descriptor = { ...installed(root, candidate), version: 'cairn-local-installation-v2',
    migration: { state: 'activated', sourceEngineId: legacyId, targetEngineId: coreId } };
  assert.equal(validateDescriptor(descriptor, root), descriptor);
  assert.throws(() => validateDescriptor(installed(root, candidate), root), recovery);
  const vector = descriptor.clients.claude.vector;
  assert.deepEqual(vectorArguments(root, vector), [
    join(root, 'engine', coreId, 'app/node_modules/cairn-memory-core-local-candidate/packaging/core-local/cli.mjs'),
    '--db', vector.databasePath, '--owner', vector.ownerId,
  ]);
  assert.throws(() => validateDescriptor({ ...descriptor, engine: { ...candidate, package: legacyEngine.package } }, root), recovery);
  assert.throws(() => executableFor(root, coreId + '/..'), recovery);
});

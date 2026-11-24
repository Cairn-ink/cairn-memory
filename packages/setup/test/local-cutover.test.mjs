import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { chmod, cp, mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import test, { before, after } from 'node:test';
import { startAwareAlive } from '../../../adapters/mcp/local-daemon-liveness.mjs';
import { ok, until, workspace } from '../../../adapters/mcp/test/local-daemon-support.mjs';
import { openMemoryCore } from '../../../core/index.mjs';
import { runLocalRawHook } from '../../../integrations/client/raw/local-hook.mjs';
import { runtimeRoot, setupRequest, sha } from '../../../integrations/client/raw/local-setup-input.mjs';
import { buildCoreLocalCandidate } from '../../../packaging/build-core-local.mjs';
import { openSqliteAdapter, openSqliteUnitOfWork } from '../../adapter-sqlite/src/index.mjs';
import { editFixture, fixture, scratch } from '../../adapter-sqlite/test/legacy/fixtures.mjs';
import { admit, personal, project } from '../../adapter-sqlite/test/migration-fixtures.mjs';
import { seedRawDeletion } from '../../adapter-sqlite/test/raw-migration-fixtures.mjs';
import { runLocalCutover } from '../lib/local-cutover.mjs';
import { readDescriptor, validateDescriptor } from '../lib/local-descriptor.mjs';
import { installerFixture, realDaemonEngine } from './daemon-installer-fixture.mjs';

const linux = { skip: process.platform !== 'linux', timeout: 90_000 };
const candidateRoot = process.platform === 'linux' ? scratch({ after }) : null;
let candidate;
before(async () => {
  if (candidateRoot === null) return;
  const directory = join(candidateRoot, 'candidate');
  buildCoreLocalCandidate(directory);
  const manifest = JSON.parse(await readFile(join(directory, 'candidate-manifest.json'), 'utf8'));
  const unpack = spawnSync('tar', ['-xzf', join(directory, manifest.archive.filename), '-C', directory],
    { env: { PATH: '/usr/bin:/bin' }, encoding: 'utf8', timeout: 15_000 });
  assert.equal(unpack.status, 0, unpack.stderr);
  candidate = { manifest, tree: join(directory, 'package') };
});

async function installer(t, path, daemonRoot) {
  const f = await installerFixture(t, { db: path });
  await f.setEngine(realDaemonEngine({ root: daemonRoot }));
  const { manifest, tree } = candidate;
  const app = join(f.root, 'engine', manifest.engineId, 'app');
  await mkdir(dirname(app), { mode: 0o700 });
  await mkdir(app, { mode: 0o700 });
  const modules = join(app, 'node_modules');
  await mkdir(modules, { mode: 0o700 });
  await cp(tree, join(modules, manifest.package.name), { recursive: true });
  const options = { root: f.root, manifest, env: f.env };
  const descriptorFile = join(f.root, 'installation.json');
  const configFile = join(f.home, '.claude.json');
  const initialDescriptor = await readFile(descriptorFile), initialConfig = await readFile(configFile);
  return { ...f, options, descriptorFile, initialDescriptor,
    read: () => readDescriptor(f.root, { allowV2: true }),
    async assertConfig() { assert.deepEqual(await readFile(configFile), initialConfig); },
  };
}

function crash(f, checkpoint, internal = false) {
  const url = new URL('../lib/local-cutover.mjs', import.meta.url).href;
  const child = spawnSync(process.execPath, ['--input-type=module', '-e', `
    import { runLocalCutover } from ${JSON.stringify(url)};
    const { options, checkpoint, internal } = JSON.parse(process.argv[1]);
    await runLocalCutover({ ...options, [internal ? 'onMigrationCheckpoint' : 'onCheckpoint'](state) {
      if (state === checkpoint) process.kill(process.pid, 'SIGKILL');
    } });
  `, JSON.stringify({ options: f.options, checkpoint, internal })], { env: {}, encoding: 'utf8', timeout: 45_000 });
  assert.equal(child.signal, 'SIGKILL', child.stderr);
}

async function assertUnservable(path) {
  assert.throws(() => openSqliteUnitOfWork(path), { code: 'storage_error' });
  await assert.rejects(openSqliteAdapter(path), { code: 'storage_error' });
}

function cutoverError(code) {
  return error => {
    assert.equal(error.params?.code ?? error.code, code, error.stack);
    return true;
  };
}

for (const layout of [18, 29, 48, 53]) {
  test(`layout ${layout} resumes from every durable checkpoint without publication`, linux, async t => {
    const { path } = await fixture(scratch(t), layout);
    const f = await installer(t, path, join(dirname(path), 'run'));
    const bytes = await readFile(path);
    for (const step of ['staged', 'quiesced', 'backup-proved', 'migrated', 'verified']) {
      crash(f, step);
      const descriptor = await f.read();
      const { migration } = descriptor;
      assert.equal(migration.state, step);
      assert.equal(descriptor.database.path, path);
      assert.equal(descriptor.engine.id, migration.sourceEngineId);
      assert.equal(descriptor.clients.claude.vector.databasePath, path);
      const earlyPublication = structuredClone(descriptor);
      earlyPublication.clients.claude.vector.engineId = migration.targetEngineId;
      assert.throws(() => validateDescriptor(earlyPublication, f.root), { key: 'local_recovery_required' });
      await assert.rejects(readDescriptor(f.root), { key: 'local_recovery_required' });
      assert.deepEqual(await readFile(path), bytes);
      await f.assertConfig();
      if (['migrated', 'verified'].includes(step)) await assertUnservable(migration.cutover.targetPath);
    }
    const ready = await runLocalCutover(f.options);
    assert.equal(ready.readyToActivate, true);
    assert.deepEqual(ready.pausedNamespaces, []);
    const { cutover } = (await f.read()).migration;
    const archival = join(f.root, '.cutover-' + cutover.id, 'backup-' + cutover.attemptId);
    assert.notEqual(cutover.backup.byteDigest, '');
    assert.equal(JSON.parse(await readFile(join(archival, 'proof.json'), 'utf8')).logicalDigest, cutover.backup.logicalDigest);
    assert.deepEqual(await readFile(path), bytes);
  });
}

async function nativeCapture(f, storeId) {
  const installationDirectory = join(f.root, 'capture/claude');
  await mkdir(installationDirectory, { recursive: true, mode: 0o700 });
  const request = setupRequest({
    version: 'local-raw-setup-request-v1', installationDirectory,
    databasePath: f.database, namespace: personal, client: 'claude-code',
    sourceRoot: join(f.home, 'transcripts'), clientConfigPath: join(f.home, 'settings.json'),
    usageRoot: join(f.root, 'capture-usage'), installation: { pluginRoot: join(f.root, 'capture-support/claude') },
    rawMode: 'local-plain-v1', rawCapBytes: 1000, dailyCap: 10, providerApiKeyEnv: 'OPENAI_API_KEY',
    interpretationConsent: false, plaintextRawConsent: true, foregroundConsent: true,
  });
  const body = JSON.stringify({ version: 'local-raw-installation-v1', phase: 'active', request,
    requestDigest: sha(JSON.stringify(request, null, 2) + '\n'), storeId, targetId: 'synthetic-target',
    runtimeRoot, nodeExecutable: process.execPath, sourceIdentity: { device: '1', inode: '2' } }) + '\n';
  const path = join(installationDirectory, 'installation.json');
  await writeFile(path, body, { mode: 0o600 });
  const run = async () => (await runLocalRawHook({ installationDirectory,
    event: 'Stop', payload: {} }, { headless: true })).reason;
  return { body, path, run };
}

test('Linux drains a real daemon, closes native admission and restores the exact legacy installation on abort', linux, async t => {
  const daemon = await workspace(t);
  const f = await installer(t, daemon.path, join(daemon.root, 'run'));
  const serving = daemon.forward();
  serving.release();
  const { owner } = await daemon.connect(serving);
  const saved = ok(await serving.tool('remember_memory', { content: 'synthetic before cutover', kind: 'fact' }));
  const storeId = editFixture(daemon.path, db => db.prepare('SELECT store_id FROM store_metadata').get().store_id);
  const capture = await nativeCapture(f, storeId);
  assert.equal(await capture.run(), 'headless_skipped');
  const bytes = await readFile(daemon.path);
  crash(f, 'backup-proved');
  assert.equal(startAwareAlive(owner), false);
  assert.equal(await capture.run(), 'authority_changed');
  assert.deepEqual((await f.calls()).map(call => call.args[1]), ['stop', 'status']);
  assert.deepEqual(await readFile(daemon.path), bytes);
  const { cutover } = (await f.read()).migration;
  assert.equal((await runLocalCutover({ ...f.options, action: 'abort' })).state, 'aborted');
  assert.deepEqual(await readFile(f.descriptorFile), f.initialDescriptor);
  assert.equal(await readFile(capture.path, 'utf8'), capture.body);
  assert.equal(await capture.run(), 'headless_skipped');
  await assert.rejects(readFile(join(f.root, '.cutover-' + cutover.id, 'maintenance.json')), { code: 'ENOENT' });
  const resumed = daemon.forward();
  resumed.release();
  assert.equal(startAwareAlive((await daemon.connect(resumed)).owner), true);
  assert.equal(ok(await resumed.tool('inspect_memory', { memoryId: saved.memory.id })).memory.content,
    'synthetic before cutover');
  await f.assertConfig();
});

test('non-Linux refuses before staging, and an independent stdio handle forces a retry', linux, async t => {
  const { path } = await fixture(scratch(t), 18);
  const f = await installer(t, path, join(dirname(path), 'run'));
  await assert.rejects(runLocalCutover({ ...f.options, platform: 'darwin' }), { code: 'cutover_platform' });
  assert.deepEqual(await readFile(f.descriptorFile), f.initialDescriptor);
  // An idle SQLite handle owns no transaction. The kernel still refuses the cold lease.
  const held = new DatabaseSync(path);
  try {
    await assert.rejects(runLocalCutover(f.options), cutoverError('cutover_store_busy'));
    assert.equal((await f.read()).migration.resumeFrom, 'staged');
  } finally { held.close(); }
  const reader = new DatabaseSync(path, { readOnly: true });
  try { await assert.rejects(runLocalCutover(f.options), cutoverError('cutover_store_busy')); }
  finally { reader.close(); }
  assert.equal((await runLocalCutover(f.options)).state, 'verified');
});

test('a write open during the cold lease invalidates preparation without writing the source', linux, async t => {
  const { path } = await fixture(scratch(t), 18);
  const f = await installer(t, path, join(dirname(path), 'run'));
  const bytes = await readFile(path);
  await assert.rejects(runLocalCutover({ ...f.options, onCheckpoint(step) {
    if (step !== 'backup-proved') return;
    const writer = spawnSync('/usr/bin/python3', ['-I', '-c',
      'import os,sys; os.open(sys.argv[1], os.O_RDWR | os.O_NONBLOCK)', path], { env: {}, encoding: 'utf8' });
    assert.equal(writer.status, 1);
    assert.match(writer.stderr, /BlockingIOError/u);
  } }), cutoverError('cutover_lease_lost'));
  assert.deepEqual(await readFile(path), bytes);
  assert.equal((await f.read()).migration.state, 'paused-recovery');
  assert.equal((await runLocalCutover(f.options)).readyToActivate, true);
});

test('the final canonical proof rejects a replaced source and retries from a new backup', linux, async t => {
  const directory = scratch(t);
  const { path } = await fixture(directory, 18);
  const f = await installer(t, path, join(directory, 'run'));
  const replacement = join(directory, 'changed.sqlite');
  await cp(path, replacement);
  await chmod(replacement, 0o600);
  const core = openMemoryCore({ path: replacement, raw: false });
  try { admit(core, 'synthetic change after backup'); }
  finally { await core.close(); }
  const current = await readFile(replacement);
  let stale;
  await assert.rejects(runLocalCutover({ ...f.options, async onCheckpoint(step, cutover) {
    if (step !== 'migrated') return;
    stale = cutover.targetPath;
    await rename(replacement, path);
  } }), cutoverError('legacy_backup_stale'));
  assert.equal((await f.read()).migration.resumeFrom, 'quiesced');
  assert.deepEqual(await readFile(path), current);
  await assertUnservable(stale + '.stale');
  const ready = await runLocalCutover(f.options);
  assert.notEqual(ready.targetPath, stale);
  assert.deepEqual(await readFile(path), current);
});

test('a migrated target is retired on abort and the legacy store remains writable', linux, async t => {
  const { path } = await fixture(scratch(t), 18);
  const f = await installer(t, path, join(dirname(path), 'run'));
  const bytes = await readFile(path);
  crash(f, 'migrated');
  const target = (await f.read()).migration.cutover.targetPath;
  await runLocalCutover({ ...f.options, action: 'abort' });
  assert.deepEqual(await readFile(path), bytes);
  await assert.rejects(readFile(target), { code: 'ENOENT' });
  await assertUnservable(target + '.stale');
  assert.deepEqual(await readFile(f.descriptorFile), f.initialDescriptor);
  const core = openMemoryCore({ path, raw: false });
  try { admit(core, 'synthetic after abort'); }
  finally { await core.close(); }
  await f.assertConfig();
});

test('readiness preserves scoped pause and requires the complete Raw deletion evidence', linux, async t => {
  const { input } = await seedRawDeletion(scratch(t));
  const f = await installer(t, input.path, join(dirname(input.path), 'run'));
  const core = openMemoryCore({ path: input.path, raw: true, rawSearch: false });
  let paused;
  try {
    const state = ok(core.getCaptureControl({ namespace: personal }));
    paused = ok(core.setCapturePaused({ namespace: personal, expectedGeneration: state.generation, paused: true }));
    const grant = ok(core.getLocalCaptureControl({ namespace: project, client: 'codex' }));
    ok(core.setLocalCaptureControl({ namespace: project, client: 'codex', expectedStoreId: grant.storeId,
      expectedRevision: grant.revision, targetId: 'synthetic-target', automaticCaptureEnabled: true, rawNoticeVersion: 'local-plain-v1' }));
  } finally { await core.close(); }
  const bytes = await readFile(input.path);
  const ready = await runLocalCutover(f.options);
  assert.deepEqual(ready.pausedNamespaces, [{ ...personal, generation: paused.generation, paused: true, enabled: true }]);
  const { result } = (await f.read()).migration.cutover;
  assert.deepEqual(result.captureControls.pausedOwners, []);
  for (const count of Object.values(result.rawDeletionEvidence)) assert.ok(count > 0, JSON.stringify(result.rawDeletionEvidence));
  assert.deepEqual(await readFile(input.path), bytes);
  await runLocalCutover({ ...f.options, action: 'abort' });
  editFixture(input.path, db => db.prepare("DELETE FROM raw_session_fences WHERE scope = 'project'").run());
  const damaged = await readFile(input.path);
  await assert.rejects(runLocalCutover(f.options), cutoverError('legacy_raw_privacy_unrepresentable'));
  assert.equal((await f.read()).migration.resumeFrom, 'backup-proved');
  assert.deepEqual(await readFile(input.path), damaged);
});

test('a crash inside the adapter leaves an unservable target and resumes its migration', linux, async t => {
  const { path } = await fixture(scratch(t), 18);
  const f = await installer(t, path, join(dirname(path), 'run'));
  const bytes = await readFile(path);
  crash(f, 'privacy', true);
  const { migration } = await f.read();
  assert.equal(migration.state, 'backup-proved');
  const reader = new DatabaseSync(migration.cutover.targetPath, { readOnly: true });
  try { assert.equal(reader.prepare('SELECT checkpoint FROM cairn_migration').get().checkpoint, 2); }
  finally { reader.close(); }
  await assertUnservable(migration.cutover.targetPath);
  assert.equal((await runLocalCutover(f.options)).targetPath, migration.cutover.targetPath);
  assert.deepEqual(await readFile(path), bytes);
});

test('a previously verified target with removed Raw fences loses readiness', linux, async t => {
  const { input } = await seedRawDeletion(scratch(t));
  const f = await installer(t, input.path, join(dirname(input.path), 'run'));
  const first = await runLocalCutover(f.options);
  const bytes = await readFile(input.path);
  editFixture(first.targetPath, db => db.exec('DELETE FROM cairn_raw_fences'));
  await assert.rejects(runLocalCutover(f.options), cutoverError('cutover_target_changed'));
  await assertUnservable(first.targetPath + '.stale');
  assert.equal((await f.read()).migration.resumeFrom, 'quiesced');
  const next = await runLocalCutover(f.options);
  assert.notEqual(next.targetPath, first.targetPath);
  assert.deepEqual(await readFile(input.path), bytes);
});

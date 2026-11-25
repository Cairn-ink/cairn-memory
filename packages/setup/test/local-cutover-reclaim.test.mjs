import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { chmod, cp, link, lstat, mkdir, readFile, readdir, rename, symlink, writeFile } from 'node:fs/promises';
import { basename, dirname, join } from 'node:path';
import test from 'node:test';
import { openMemoryCore } from '../../../core/index.mjs';
import { engineIdForCoreLocal, sha256 } from '../../../packaging/core-local/engine-id.mjs';
import { fixture, scratch } from '../../adapter-sqlite/test/legacy/fixtures.mjs';
import { admit, fileDigest, ok, personal } from '../../adapter-sqlite/test/migration-fixtures.mjs';
import { runLocalCutover } from '../lib/local-cutover.mjs';
import { targetFor } from '../lib/local-cutover-journal.mjs';
import { readDescriptor } from '../lib/local-descriptor.mjs';
import { coreLocalEngine } from '../lib/local-engine-generation.mjs';
import { coreLocalInitializeResult } from '../lib/local-engine.mjs';
import { installerFixture, realDaemonEngine } from './daemon-installer-fixture.mjs';

const linux = { skip: process.platform !== 'linux', timeout: 90_000 };
const text = 'Synthetic cutover sentinel that will be forgotten';

async function stageProbe(root) {
  const { packageName: name, packageVersion: version, binPath } = coreLocalEngine;
  const payload = {
    'package.json': JSON.stringify({ name, version, type: 'module' }),
    [binPath]: `
      let input = '';
      for await (const chunk of process.stdin) input += chunk;
      for (const line of input.trim().split('\\n')) {
        const { id, method } = JSON.parse(line);
        if (method === 'initialize' || method === 'ping') {
          const result = method === 'initialize' ? ${JSON.stringify(coreLocalInitializeResult)} : {};
          console.log(JSON.stringify({ jsonrpc: '2.0', id, result }));
        }
      }
    `,
  };
  const files = Object.fromEntries(Object.entries(payload).map(([path, bytes]) => [path, sha256(bytes)]));
  const engineId = engineIdForCoreLocal(files);
  const installed = join(root, 'engine', engineId, 'app', 'node_modules', name);
  for (const [path, bytes] of Object.entries(payload)) {
    await mkdir(dirname(join(installed, path)), { recursive: true, mode: 0o700 });
    await writeFile(join(installed, path), bytes);
  }
  return { schemaVersion: 1, package: { name, version }, engineId, files,
    archive: { filename: `${name}-${version}.tgz`, bytes: 1, sha256: sha256('synthetic') } };
}

async function setup(t) {
  const directory = scratch(t);
  const { path } = await fixture(directory, 18);
  const core = openMemoryCore({ path, raw: false });
  let memory;
  try { memory = admit(core, text); }
  finally { await core.close(); }
  const f = await installerFixture(t, { db: path });
  await f.setEngine(realDaemonEngine({ root: join(directory, 'run') }));
  const manifest = await stageProbe(f.root);
  const descriptorPath = join(f.root, 'installation.json');
  return { path, directory, memory, descriptorPath, original: await readFile(descriptorPath),
    options: { root: f.root, manifest, env: f.env },
    read: () => readDescriptor(f.root, { allowV2: true }) };
}

const maintenanceFor = (f, cutover) => join(f.options.root, '.cutover-' + cutover.id);
const backupFor = (f, cutover) => join(maintenanceFor(f, cutover), 'backup-' + cutover.attemptId);
const gone = path => assert.rejects(lstat(path), { code: 'ENOENT' });
const privateFile = (path, contents = text) => writeFile(path, contents, { mode: 0o600 });

async function nativeRecord(f) {
  const installationDirectory = join(f.options.root, 'capture', 'claude');
  const path = join(installationDirectory, 'installation.json');
  const contents = JSON.stringify({ version: 'local-raw-installation-v1', phase: 'active',
    request: { installationDirectory, databasePath: f.path, client: 'claude-code' } }) + '\n';
  await mkdir(installationDirectory, { recursive: true, mode: 0o700 });
  await privateFile(path, contents);
  return { path, contents };
}

async function findText(directory) {
  const matches = [];
  for (const item of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, item.name);
    if (item.isDirectory()) matches.push(...await findText(path));
    if (item.isFile() && (await readFile(path)).includes(text)) matches.push(path);
  }
  return matches;
}

async function assertForgotten(f) {
  const core = openMemoryCore({ path: f.path, raw: false });
  try {
    assert.equal(ok(core.forget({ namespace: personal, memoryId: f.memory.id,
      expectedRevision: f.memory.revision })).forgotten, true);
    assert.equal(core.get({ namespace: personal, memoryId: f.memory.id }).error?.code, 'memory_not_found');
  } finally { await core.close(); }
  const matches = [...await findText(f.directory), ...await findText(f.options.root)];
  assert.deepEqual(matches.map(path => basename(path)), []);
}

async function prepare(f) {
  assert.equal((await runLocalCutover(f.options)).state, 'verified');
  return (await f.read()).migration.cutover;
}

function crash(f, action, checkpoint) {
  const url = new URL('../lib/local-cutover.mjs', import.meta.url).href;
  const child = spawnSync(process.execPath, ['--input-type=module', '-e', `
    import { runLocalCutover } from ${JSON.stringify(url)};
    const { options, action, checkpoint } = JSON.parse(process.argv[1]);
    await runLocalCutover({ ...options, action, onCheckpoint(state) {
      if (state === checkpoint) process.kill(process.pid, 'SIGKILL');
    } });
  `, JSON.stringify({ options: f.options, action, checkpoint })],
  { env: {}, encoding: 'utf8', timeout: 45_000 });
  assert.equal(child.signal, 'SIGKILL', child.stderr);
}

test('abort reclaims the candidate and archive before a later legacy forget', linux, async t => {
  const f = await setup(t);
  const digest = fileDigest(f.path);
  const cutover = await prepare(f);
  const target = cutover.targetPath;
  assert.ok((await readFile(target)).includes(text));
  assert.ok((await readFile(join(backupFor(f, cutover), 'store.sqlite'))).includes(text));
  await privateFile(target + '-wal');
  await privateFile(target + '.stale-shm');
  await privateFile(target + '.stale-journal');
  assert.equal((await runLocalCutover({ ...f.options, action: 'abort' })).state, 'aborted');
  assert.equal(fileDigest(f.path), digest);
  assert.deepEqual(await readFile(f.descriptorPath), f.original);
  await assertForgotten(f);
  await gone(target);
  await gone(maintenanceFor(f, cutover));
});

for (const checkpoint of ['abort-restored', 'reclaim-target', 'reclaim-backup', 'reclaim-maintenance', 'reclaim-orphans']) {
  test(`abort recovery reclaims leftovers after a kill at ${checkpoint}`, linux, async t => {
    const f = await setup(t);
    const record = await nativeRecord(f);
    const digest = fileDigest(f.path);
    const cutover = await prepare(f);
    assert.equal(JSON.parse(await readFile(record.path, 'utf8')).phase, 'disabled');
    const orphan = targetFor(f.path, '12345678-1234-4321-8765-123456789abc') + '-wal';
    await privateFile(orphan);
    await privateFile(cutover.targetPath + '-journal');
    crash(f, 'abort', checkpoint);
    assert.deepEqual(await readFile(f.descriptorPath), f.original);
    assert.equal(await readFile(record.path, 'utf8'), record.contents);
    assert.equal(fileDigest(f.path), digest);
    if (checkpoint === 'reclaim-target') {
      const next = await prepare(f);
      assert.notEqual(next.targetPath, cutover.targetPath);
      await runLocalCutover({ ...f.options, action: 'abort' });
    } else {
      assert.equal((await runLocalCutover({ ...f.options, action: 'abort' })).state, 'aborted');
    }
    await gone(cutover.targetPath);
    await gone(cutover.targetPath + '-journal');
    await gone(orphan);
    await gone(maintenanceFor(f, cutover));
    assert.deepEqual(await readFile(f.descriptorPath), f.original);
    assert.equal(fileDigest(f.path), digest);
  });
}

test('stale-source rollback reclaims the old copies before a legacy forget', linux, async t => {
  const f = await setup(t);
  const replacement = join(f.directory, 'modified.sqlite');
  await cp(f.path, replacement);
  await chmod(replacement, 0o600);
  const core = openMemoryCore({ path: replacement, raw: false });
  try { admit(core, 'Synthetic change between migration and the final proof'); }
  finally { await core.close(); }
  const digest = fileDigest(replacement);
  let retired;
  await assert.rejects(runLocalCutover({ ...f.options, async onCheckpoint(state, cutover) {
    if (state !== 'migrated') return;
    retired = cutover;
    assert.ok((await readFile(cutover.targetPath)).includes(text));
    assert.ok((await readFile(join(backupFor(f, cutover), 'store.sqlite'))).includes(text));
    await rename(replacement, f.path);
  } }), error => (error.params?.code ?? error.code) === 'legacy_backup_stale');
  const { migration } = await f.read();
  assert.equal(migration.resumeFrom, 'quiesced');
  assert.notEqual(migration.cutover.attemptId, retired.attemptId);
  assert.equal(fileDigest(f.path), digest);
  await assertForgotten(f);
  await gone(backupFor(f, retired));
});

for (const checkpoint of ['reclaim-target', 'reclaim-backup']) {
  test(`rollback recovery reclaims a changed candidate after a kill at ${checkpoint}`, linux, async t => {
    const f = await setup(t);
    const digest = fileDigest(f.path);
    const cutover = await prepare(f);
    await privateFile(cutover.targetPath, 'Synthetic tamper');
    crash(f, 'prepare', checkpoint);
    const next = await prepare(f);
    assert.notEqual(next.targetPath, cutover.targetPath);
    await gone(cutover.targetPath);
    await gone(backupFor(f, cutover));
    assert.equal(fileDigest(f.path), digest);
  });
}

test('prepare reclaims old journaled archives and exact orphan names while preserving lookalikes', linux, async t => {
  const f = await setup(t);
  const digest = fileDigest(f.path);
  const old = '12345678-1234-4321-8765-123456789abc';
  const orphan = join(f.directory, '.cairn-cutover-' + old + '.sqlite');
  const similar = [orphan + '.notes', orphan.replace('.sqlite', '-copy.sqlite')];
  await privateFile(orphan + '.stale-wal');
  for (const path of similar) await privateFile(path, 'Keep synthetic data');
  const alias = orphan.replace(old, '12345678-1234-4321-8765-123456789def');
  await symlink(f.path, alias);
  const anotherStore = targetFor(join(f.directory, 'other.sqlite'), old);
  similar.push(anotherStore);
  await privateFile(anotherStore, 'Keep synthetic data');
  const otherFile = join(f.directory, 'kept.sqlite');
  await privateFile(otherFile, 'Keep synthetic data');
  const anotherAlias = targetFor(f.path, '12345678-1234-4321-8765-123456789aab');
  await link(otherFile, anotherAlias);
  const maintenance = join(f.options.root, '.cutover-' + old);
  const backup = join(maintenance, 'backup-' + old);
  await mkdir(maintenance, { mode: 0o700 });
  await mkdir(backup, { mode: 0o700 });
  const staged = join(maintenance, '.legacy-backup-Ab12Cd');
  await mkdir(staged, { mode: 0o700 });
  await writeFile(join(staged, 'store.sqlite'), text, { mode: 0o644 });
  await privateFile(join(maintenance, 'stale.json'), JSON.stringify({ attemptId: old }) + '\n');
  await privateFile(join(backup, 'store.sqlite'));
  const unrelated = join(f.options.root, '.cutover-12345678-1234-4321-8765-123456789aaa');
  await mkdir(unrelated, { mode: 0o700 });
  await privateFile(join(unrelated, 'store.sqlite'), 'Keep synthetic data');
  await prepare(f);
  await gone(maintenance);
  await gone(orphan + '.stale-wal');
  assert.equal((await lstat(alias)).isSymbolicLink(), true);
  for (const path of [...similar, anotherAlias, otherFile, join(unrelated, 'store.sqlite')]) {
    assert.equal(await readFile(path, 'utf8'), 'Keep synthetic data');
  }
  assert.equal(fileDigest(f.path), digest);
});

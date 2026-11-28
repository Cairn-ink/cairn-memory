import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { chmod, cp, lstat, mkdir, readFile, rename, symlink, unlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import test from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { initLocalRawStore } from '../../../integrations/client/raw/local-setup-init.mjs';
import { captureSettings } from '../lib/local-capture.mjs';
import { readDescriptor, withLocalLock, writeDescriptor } from '../lib/local-descriptor.mjs';
import { engineIdFor } from '../lib/local-engine.mjs';
import { legacyFixture, linux, operator, setup } from './local-cutover-fix-support.mjs';

async function unopenedInstall(t, version) {
  const fixture = await legacyFixture(t);
  await unlink(fixture.database);
  await withLocalLock(fixture.root, async () => {
    const descriptor = await readDescriptor(fixture.root);
    descriptor.installerVersion = version;
    await writeDescriptor(fixture.root, descriptor);
    await writeFile(join(fixture.root, 'capture-settings.json'), JSON.stringify({
      version: 1, clients: { claude: { enabled: false, noticed: false, engineId: descriptor.engine.id, node: descriptor.node } },
    }), { mode: 0o600 });
  });
  return fixture;
}

async function stageEngineForReuse(root) {
  const runtime = new URL('../runtime/engine/', import.meta.url);
  const manifestBytes = await readFile(new URL('manifest.json', runtime));
  const { package: engine } = JSON.parse(manifestBytes);
  const id = engineIdFor('0.7.0', manifestBytes);
  const modules = join(root, 'engine', id, 'app', 'node_modules');
  await mkdir(modules, { recursive: true, mode: 0o700 });
  const archive = fileURLToPath(new URL(`${engine.name}-${engine.version}.tgz`, runtime));
  execFileSync('tar', ['-xzf', archive, '-C', modules], { env: { PATH: '/usr/bin:/bin' } });
  await rename(join(modules, 'package'), join(modules, engine.name));

  // Release CI installs these pinned dependencies before running the cutover glob.
  // Prestage the real engine so this routing test works without a registry cache.
  const adapters = new URL('../../../adapters/', import.meta.url);
  for (const [adapter, names] of [['mcp', ['@modelcontextprotocol/core', '@modelcontextprotocol/server', 'zod']],
    ['openai', ['tiktoken']]]) {
    for (const name of names) await cp(new URL(`${adapter}/node_modules/${name}`, adapters), join(modules, name), { recursive: true });
  }
  return id;
}

async function assertPublishedDescriptorCompatibility(t, fixture, version, descriptor) {
  const directory = join(fixture.parent, 'published-installer');
  await mkdir(directory, { mode: 0o700 });
  const env = { PATH: '/usr/bin:/bin', HOME: fixture.home };
  const git = { cwd: fileURLToPath(new URL('../../../', import.meta.url)), env };
  const tag = `installer-v${version}`;
  const present = spawnSync('git', ['cat-file', '-e', `${tag}:packages/setup/lib/local-descriptor.mjs`], git);
  assert.ifError(present.error);
  if (present.status !== 0 && execFileSync('git', ['rev-parse', '--is-shallow-repository'], git).toString().trim() === 'true') {
    t.skip(`${tag} is unavailable in the shallow checkout`);
    return;
  }
  const archive = execFileSync('git', ['archive', tag, '--', 'packages/setup/lib'], git);
  execFileSync('tar', ['-xf', '-', '-C', directory], { input: archive, env });
  const published = await import(pathToFileURL(join(directory, 'packages/setup/lib/local-descriptor.mjs')));
  const path = join(fixture.root, 'installation.json');
  const before = await readFile(path);
  assert.deepEqual(await published.readDescriptor(fixture.root), descriptor);
  assert.deepEqual(await readFile(path), before);
}

for (const version of ['0.6.11', '0.6.12']) {
  test(`setup upgrades an unopened ${version} install and cuts over after its store exists`, linux, async t => {
    const fixture = await unopenedInstall(t, version);
    const provenancePath = join(fixture.root, '.legacy-cutover.json');

    await withLocalLock(fixture.root, async () => {
      operator(fixture, setup, { code: 2 });
      assert.equal((await readDescriptor(fixture.root)).installerVersion, version);
      await assert.rejects(lstat(provenancePath), { code: 'ENOENT' });
    });

    const engineId = await stageEngineForReuse(fixture.root);
    for (let attempt = 0; attempt < 2; attempt++) {
      assert.match(operator(fixture, setup), /Local memory setup complete/u);
      const descriptor = await readDescriptor(fixture.root);
      assert.equal(descriptor.state, 'installed');
      assert.equal(descriptor.installerVersion, '0.7.0');
      assert.equal(descriptor.engine.id, engineId);
      assert.equal(descriptor.database.path, fixture.database);
      assert.equal((await captureSettings(fixture.root)).clients.claude.enabled, false);
      await assert.rejects(lstat(fixture.database), { code: 'ENOENT' });
    }

    const descriptor = await readDescriptor(fixture.root);
    const provenance = await readFile(provenancePath);
    assert.deepEqual(JSON.parse(provenance), { installerVersion: version, createdAt: descriptor.createdAt,
      ownerId: descriptor.ownerId, databasePath: fixture.database });
    await t.test(`published ${version} reader accepts the descriptor`,
      child => assertPublishedDescriptorCompatibility(child, fixture, version, descriptor));
    assert.deepEqual(await readFile(provenancePath), provenance);

    assert.equal((await initLocalRawStore({ databasePath: fixture.database })).status, 'initialized');
    await chmod(fixture.database, 0o600);
    assert.match(operator(fixture, setup), /Local cutover verified/u);
    assert.equal((await readDescriptor(fixture.root, { allowV2: true })).migration.state, 'verified');
  });

  test(`setup refuses unsafe ${version} store paths without doing ordinary setup`, linux, async t => {
    const fixture = await unopenedInstall(t, version);
    const original = await readDescriptor(fixture.root);

    await symlink('missing.sqlite', fixture.database);
    assert.match(operator(fixture, setup, { code: 2 }), /Local cutover paused/u);
    assert.ok((await lstat(fixture.database)).isSymbolicLink());
    await unlink(fixture.database);

    await chmod(fixture.parent, 0o755);
    try {
      assert.match(operator(fixture, setup, { code: 2 }), /Local cutover paused/u);
      await assert.rejects(lstat(fixture.database), { code: 'ENOENT' });
    } finally { await chmod(fixture.parent, 0o700); }

    assert.deepEqual(await readDescriptor(fixture.root), original);
  });
}

import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, rm, mkdir, chmod, rename } from 'node:fs/promises';
import { join } from 'node:path';
import { createIdentity } from '../local-daemon-identity.mjs';
import { runtimeDirectory, identityKey } from '../local-daemon-state.mjs';

async function setup(t) {
  const root = await mkdtemp('/tmp/cr3-i-'); t.after(() => rm(root, { recursive: true, force: true }));
  const directory = await runtimeDirectory({ root: join(root, 'run') });
  const path = join(root, 'synthetic.sqlite'); await writeFile(path, 'synthetic metadata only');
  const args = ['--db', path, '--owner', 'synthetic-owner'];
  const options = { key: await identityKey(directory), environment: {}, build: 'synthetic-build',
    node: { executable: process.execPath, version: process.version, execArgv: [] } };
  return { root, path, args, directory, options, identity: overrides => createIdentity(args, { ...options, ...overrides }) };
}
test('package physical location splits identical builds and reinstalled directories', async t => {
  const f = await setup(t), a = join(f.root, 'package-a'), b = join(f.root, 'package-b');
  await mkdir(a); await mkdir(b);
  const first = await f.identity({ root: a }), reused = await f.identity({ root: a });
  assert.equal(first.digest, reused.digest);
  assert.notEqual(first.digest, (await f.identity({ root: b })).digest);
  await rename(a, join(f.root, 'retired-package')); await mkdir(a);
  const replaced = await f.identity({ root: a });
  assert.equal(first.record.package.path, replaced.record.package.path);
  assert.notEqual(first.record.package.ino, replaced.record.package.ino);
  assert.notEqual(first.digest, replaced.digest);
});
test('runtime subfolder pins both itself and its private parent', async t => {
  const f = await setup(t), parent = join(f.root, 'run');
  assert.equal(f.directory.path, join(parent, 'cairn-memory'));
  await chmod(parent, 0o755);
  await assert.rejects(f.directory.validate(), { code: 'daemon_directory_mode' });
  await chmod(parent, 0o700);
  await rename(parent, join(f.root, 'old-parent')); await mkdir(parent, { mode: 0o700 });
  await assert.rejects(f.directory.validate(), { code: 'daemon_directory_changed' });
});

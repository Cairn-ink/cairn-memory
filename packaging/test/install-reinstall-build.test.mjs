import assert from 'node:assert/strict';
import { copyFile, readFile, realpath, rm, stat, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import test from 'node:test';
import { engineBuild } from '../../adapters/mcp/local-daemon-identity.mjs';
import { readPrivate } from '../../adapters/mcp/local-daemon-state.mjs';
import { createTestWorkspace } from '../../tools/testing/workspace.mjs';
import { buildArtifact, command, packageName } from '../build.mjs';
import { installedDaemonRuntime } from './fixtures/installed-daemon-runtime.mjs';

const requireSDK = createRequire(new URL('../../adapters/mcp/package.json', import.meta.url));
const { Client } = await import(requireSDK.resolve('@modelcontextprotocol/client'));
const { StdioClientTransport } = await import(requireSDK.resolve('@modelcontextprotocol/client/stdio'));
const readJSON = async path => JSON.parse(await readFile(path, 'utf8'));

async function packageIdentity(root) {
  const path = await realpath(root);
  const { dev, ino } = await stat(path, { bigint: true });
  return { path, dev: String(dev), ino: String(ino) };
}

test('an in-place reinstall matches recorded daemon launches by build', { timeout: 120000 }, async t => {
  const workspace = createTestWorkspace(t, { prefix: 'cairn-reinstall-build-' });
  const ownDirectory = path => workspace.defer(() => rm(path, { recursive: true, force: true }));
  const first = buildArtifact({ version: '0.0.0-preview.1', ownDirectory });
  const second = buildArtifact({ version: '0.0.0-preview.2', ownDirectory });
  const cwd = workspace.path;
  await writeFile(join(cwd, 'package.json'), JSON.stringify({ name: 'synthetic-reinstall', private: true, version: '0.0.0' }));
  command('npm', ['install', '--prefix', cwd, '--offline', '--ignore-scripts', '--no-audit', '--no-fund', first.artifactPath],
    cwd, first.userconfig);

  const root = join(cwd, 'node_modules', packageName);
  const executable = join(cwd, 'node_modules', '.bin', 'cairn-memory');
  const db = join(cwd, 'synthetic.sqlite');
  const session = { command: process.execPath, args: [executable, '--db', db, '--owner', 'synthetic-reinstall-owner'],
    cwd, env: { HOME: cwd, PATH: dirname(process.execPath), NODE_NO_WARNINGS: '1' } };
  const prefixes = new Set();
  const runtime = await installedDaemonRuntime({ diagnostic: text => t.diagnostic(text),
    recordLaunchPrefix(prefix) { prefixes.add(prefix); return prefix; } });
  workspace.defer(runtime.finish);

  async function connect() {
    const client = new Client({ name: 'synthetic-reinstall-client', version: '1.0.0' });
    workspace.defer(() => client.close());
    await client.connect(new StdioClientTransport({ ...session, stderr: 'pipe' }));
    return client;
  }

  async function publication(build, pkg) {
    assert.equal(prefixes.size, 1, 'one distinct prefix recorded for this launch');
    const [prefix] = prefixes;
    const text = await readPrivate(runtime.directory, join(runtime.directory.path, prefix + '.json'), { fileClass: 'descriptor' });
    const { identity } = JSON.parse(text);
    assert.equal(identity.store.path, db);
    assert.equal(identity.build, build);
    assert.deepEqual(identity.package, pkg);
    return { prefix, identity };
  }

  const pkg = await packageIdentity(root);
  const metadata = join(root, 'engine-build.json');
  const previous = await readJSON(metadata);
  assert.equal(await engineBuild(root), previous.digest);
  assert.equal((await readJSON(join(root, 'package.json'))).version, first.version);
  const initial = runtime.register(session, { expected: 2 });
  const firstClient = await connect();
  assert.equal((await initial.observe()).length, 1);
  const firstReady = await publication(previous.digest, pkg);
  await firstClient.close();
  await initial.stop();

  // Copy only changed artifact files into the allocated package directory.
  const nextMetadata = join(second.stagingPath, 'engine-build.json');
  const next = await readJSON(nextMetadata);
  assert.deepEqual(first.files, second.files);
  for (const [name, digest] of Object.entries(next.sourceHashes)) {
    if (previous.sourceHashes[name] !== digest) await copyFile(join(second.stagingPath, name), join(root, name));
  }
  await copyFile(nextMetadata, metadata);
  assert.deepEqual(await packageIdentity(root), pkg, 'reinstall preserves the package path, device and inode');
  assert.equal((await readJSON(join(root, 'package.json'))).version, second.version);
  assert.equal(await engineBuild(root), next.digest);
  assert.notEqual(next.digest, previous.digest, 'reinstall changes the verified build digest');

  prefixes.clear();
  const upgraded = runtime.register(session);
  await upgraded.recording;
  await connect();
  const secondReady = await publication(next.digest, pkg);
  assert.notEqual(secondReady.prefix, firstReady.prefix);
  assert.deepEqual(secondReady.identity.store, firstReady.identity.store);
  assert.deepEqual(secondReady.identity.configuration, firstReady.identity.configuration);
  assert.equal((await upgraded.observe()).length, 1);
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, rm, symlink, link, mkdir, chmod, lstat, rename } from 'node:fs/promises';
import { join } from 'node:path';
import { createIdentity, daemonVector, canonical, selectedEnvironment, engineBuild, assertStoreLocation, assertStoreSync } from '../local-daemon-identity.mjs';
import { runtimeDirectory, identityKey, endpointPaths, checkedEntry, logCode, readPrivate, assertLocalFilesystem } from '../local-daemon-state.mjs';
import { startAwareAlive } from '../local-daemon-liveness.mjs';

async function setup(t) {
  const root = await mkdtemp('/tmp/cr3-i-'); t.after(() => rm(root, { recursive: true, force: true }));
  const directory = await runtimeDirectory({ root: join(root, 'run') });
  const path = join(root, 'synthetic.sqlite'); await writeFile(path, 'synthetic metadata only');
  const args = ['--db', path, '--owner', 'synthetic-owner'];
  const options = { key: await identityKey(directory), environment: {}, build: 'synthetic-build',
    node: { executable: process.execPath, version: process.version, execArgv: [] } };
  return { root, path, args, directory, options, identity: overrides => createIdentity(args, { ...options, ...overrides }) };
}
test('every managed identity input splits; safe aliases share and hardlinks refuse', async t => {
  const f = await setup(t), base = await f.identity();
  const changed = async (args = f.args, options = {}) => {
    const result = await createIdentity(args, { ...f.options, ...options });
    assert.notEqual(result.digest, base.digest, 'changed identity input must never share');
  };
  for (const flag of ['--no-raw', '--no-raw-search', '--no-context-read']) await changed([...f.args, flag]);
  await changed(['--db', f.path, '--owner', 'another-synthetic-owner']);
  await changed([...f.args, '--project', 'synthetic-project']);
  await changed(f.args, { uid: process.getuid() + 1 });
  await changed(f.args, { build: 'other-build' });
  await changed(f.args, { node: { ...f.options.node, version: 'synthetic-node-version' } });
  await changed(f.args, { node: { ...f.options.node, execArgv: ['--no-warnings'] } });
  const executable = join(f.root, 'synthetic-node'); await writeFile(executable, 'synthetic executable identity');
  await changed(f.args, { node: { ...f.options.node, executable } });
  await changed(f.args, { protocol: 2 });
  for (const environment of [{ OPENAI_API_KEY: '' }, { OPENAI_API_KEY: 'synthetic-A' }, { OPENAI_API_KEY: 'synthetic-B' }, { TZ: 'UTC' }]) await changed(f.args, { environment });
  const a = await f.identity({ environment: { OPENAI_API_KEY: 'synthetic-A' } }), b = await f.identity({ environment: { OPENAI_API_KEY: 'synthetic-B' } });
  assert.notEqual(a.digest, b.digest, 'credential values must split via keyed digest');
  assert.ok(!canonical(a.record).includes('synthetic-A'), 'identity must never contain credentials');
  const otherKey = await f.identity({ environment: { OPENAI_API_KEY: 'synthetic-A' }, key: Buffer.alloc(32, 1) });
  assert.notEqual(a.record.environment, otherKey.record.environment, 'credential digest must depend on private per-user key');
  await symlink(f.path, join(f.root, 'safe-alias'));
  const alias = await createIdentity(['--db', join(f.root, 'safe-alias'), '--owner', 'synthetic-owner'], f.options);
  assert.equal(alias.digest, base.digest, 'safe canonical aliases must share');
  const second = join(f.root, 'second.sqlite'); await writeFile(second, 'synthetic');
  await changed(['--db', second, '--owner', 'synthetic-owner']);
  const physical = await f.identity(); await rename(second, f.path);
  const { assertStore } = await import('../local-daemon-identity.mjs');
  await assert.rejects(assertStore(physical.record), /daemon_store_changed/, 'changed physical store must refuse');
  assert.throws(() => assertStoreSync(physical.record), /daemon_store_changed/, 'changed store must close existing connection admissions');
  await link(f.path, join(f.root, 'unsafe-hardlink'));
  await assert.rejects(f.identity(), /daemon_store_alias/, 'unsafe hardlinks must refuse');
});
test('eligibility is decided before any daemon attempt; environment injection refuses', async t => {
  const f = await setup(t);
  for (const args of [['--db', ':memory:', '--owner', 'synthetic'], [...f.args, '--unknown'], [...f.args, '--raw'],
    [...f.args, '--context-read', 'context-read-v1'], [...f.args, '--owner', 'duplicate'], ['--help'], []])
    assert.equal(daemonVector(args).eligible, false, 'non-daemon vectors must be ineligible');
  assert.throws(() => selectedEnvironment({ NODE_OPTIONS: '--import=synthetic' }), /daemon_node_injection/, 'loader environment must refuse');
  await assert.rejects(f.identity({ node: { ...f.options.node, execArgv: ['--inspect'] } }), /daemon_node_injection/, 'unsupported Node arguments must refuse');
  assert.deepEqual(selectedEnvironment({ XDG_RUNTIME_DIR: '/synthetic', UNUSED: 'synthetic' }), {}, 'runtime root must ignore ambient environment');
  assert.equal(daemonVector(['--db', ':memory:', '--owner', 'synthetic', '--no-context-read']).eligible, false, ':memory: must never share even with context read disabled');
  await assert.rejects(assertStoreLocation(join(f.directory.path, 'identity-v1.key'), f.directory), /daemon_store_location/, 'store must never alias daemon coordination files');
});
test('engine identity hashes shipped content and dependency manifests', async t => {
  const f = await setup(t), root = join(f.root, 'synthetic-engine');
  for (const name of ['packaging', 'adapters/mcp', 'adapters/openai']) await mkdir(join(root, name), { recursive: true });
  await writeFile(join(root, 'packaging/artifact-files.json'), JSON.stringify(['synthetic.mjs']));
  for (const name of ['synthetic.mjs', 'package.json', 'adapters/mcp/package-lock.json', 'adapters/openai/package-lock.json',
    ...['identity', 'state', 'wire', 'liveness'].map(name => 'adapters/mcp/local-daemon-' + name + '.mjs'), 'adapters/mcp/local-daemon.mjs', 'adapters/mcp/local-forwarder.mjs'])
    await writeFile(join(root, name), 'synthetic engine bytes');
  const base = await engineBuild(root); await writeFile(join(root, 'synthetic.mjs'), 'changed synthetic bytes');
  assert.notEqual(await engineBuild(root), base, 'engine content changes must split build identity');
});
test('native loader settings cannot enter managed daemon environment', () => {
  assert.throws(() => selectedEnvironment({ LD_PRELOAD: 'synthetic-loader' }), /daemon_node_injection/, 'native loader injection must refuse');
});
test('runtime directories and private entries reject owner mode type symlink and long byte paths', async t => {
  const f = await setup(t);
  await chmod(f.directory.path, 0o755);
  await assert.rejects(f.directory.validate(), /daemon_directory_mode/, 'hostile directory mode must refuse');
  await chmod(f.directory.path, 0o700);
  await assert.rejects(runtimeDirectory({ root: f.directory.path, uid: process.getuid() + 1 }), /daemon_directory_owner/, 'hostile directory owner must refuse');
  const alias = join(f.root, 'link'); await symlink(f.directory.path, alias);
  await assert.rejects(runtimeDirectory({ root: alias }), /daemon_directory_type/, 'symlink directory must refuse');
  await assert.rejects(runtimeDirectory({ root: f.path }), /daemon_directory_type/, 'regular directory impostor must refuse');
  assert.throws(() => assertLocalFilesystem('/tmp/synthetic', 0x6969), /daemon_filesystem/, 'network filesystem must refuse');
  assert.throws(() => assertLocalFilesystem('/mnt/synthetic', 0xef53), /daemon_filesystem/, 'WSL drvfs path must refuse');
  const paths = endpointPaths(f.directory, 'a'.repeat(64));
  await writeFile(paths.socket, 'synthetic', { mode: 0o600 });
  await assert.rejects(checkedEntry(f.directory, paths.socket, { socket: true }), /daemon_entry_type/, 'regular file socket impostor must refuse');
  await rm(paths.socket); await symlink(f.path, paths.socket);
  await assert.rejects(checkedEntry(f.directory, paths.socket, { socket: true }), /daemon_entry_type/, 'socket symlink must refuse');
  const long = join(f.root, '界'.repeat(25)); await mkdir(long, { mode: 0o700 });
  const directory = await runtimeDirectory({ root: long });
  assert.throws(() => endpointPaths(directory, 'b'.repeat(64)), /daemon_socket_length/, 'socket byte length over 100 must refuse');
  await rename(f.directory.path, join(f.root, 'retired-run')); await mkdir(f.directory.path, { mode: 0o700 });
  await assert.rejects(f.directory.validate(), /daemon_directory_changed/, 'directory inode replacement must refuse');
});
test('PID reuse is dead, stopped matching owner is live, namespace uncertainty refuses', () => {
  const owner = { pid: 123, start: '10', boot: 'synthetic-boot', namespace: 'synthetic-pidns' };
  assert.equal(startAwareAlive(owner, owner, () => ({ start: '11', zombie: false })), false, 'PID reuse with different start must be dead');
  assert.equal(startAwareAlive(owner, owner, () => ({ start: '10', zombie: false })), true, 'live stopped owner must never be stolen');
  assert.throws(() => startAwareAlive(owner, { ...owner, namespace: 'other' }), /daemon_namespace/, 'namespace uncertainty must refuse');
  assert.equal(startAwareAlive(owner, { ...owner, boot: 'new-boot' }), false, 'prior boot must be dead');
});
test('logs accept only fixed codes and cap file size', async t => {
  const f = await setup(t), path = endpointPaths(f.directory, 'c'.repeat(64)).log;
  await assert.rejects(logCode(f.directory, path, 'synthetic-secret'), /daemon_log_code/, 'logs must reject arbitrary text');
  await writeFile(path, 'daemon_ready\n'.repeat(20164) + 'daemon_exit\n', { mode: 0o600 });
  await logCode(f.directory, path, 'daemon_exit');
  assert.ok((await lstat(path)).size <= 262144, 'log cap must bound disk bytes');
  assert.ok(Buffer.byteLength(await readPrivate(f.directory, path, { maxBytes: 262144 })) <= 262144, 'log cap must bound disk bytes');
});

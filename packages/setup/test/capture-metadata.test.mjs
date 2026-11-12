import test from 'node:test';
import assert from 'node:assert/strict';
import fs, { mkdir, writeFile, readFile, lstat, readdir, symlink, chmod, link } from 'node:fs/promises';
import { syncBuiltinESMExports } from 'node:module';
import { join, dirname } from 'node:path';
import { createTestWorkspace } from '../../../tools/testing/workspace.mjs';
import { clientConfigDirectory, configureCapture } from '../lib/local-capture.mjs';
import { newDescriptor, executableFor } from '../lib/local-descriptor.mjs';

async function fixture(t) {
  const ws = createTestWorkspace(t, { prefix: 'capture-metadata-' }), root = join(ws.path, 'local'), home = join(ws.path, 'home');
  await mkdir(root, { mode: 0o700 }); await mkdir(home, { mode: 0o700 });
  const descriptor = newDescriptor(root, '0.6.6');
  descriptor.engine = { id: '0.6.6-0123456789ab' };
  const engine = dirname(dirname(executableFor(root, descriptor.engine.id)));
  const cli = join(engine, 'integrations/client/raw/local-setup-cli.mjs');
  await mkdir(dirname(cli), { recursive: true, mode: 0o700 });
  await writeFile(cli, `console.log(JSON.stringify({status:process.argv[2]==='init'?'initialized':'active'}));`);
  const qualification = join(engine, 'integrations/codex/qualification.mjs');
  await mkdir(dirname(qualification), { recursive: true, mode: 0o700 });
  await writeFile(qualification, 'export async function resolveCLI(){return null;}');
  const output = [], env = { HOME: home, PATH: '/usr/bin:/bin', TMPDIR: ws.path };
  const configure = (client = 'claude') => configureCapture(root, descriptor, [client], {
    env, write: value => output.push(value), t: key => key });
  return { root, home, descriptor, configure, output, env };
}
function intercept(t, name, replacement) {
  const original = fs[name]; fs[name] = replacement(original); syncBuiltinESMExports();
  t.after(() => { fs[name] = original; syncBuiltinESMExports(); });
}
const targets = root => [join(root, 'capture-settings.json'), join(root, 'capture-support/codex/installation.json'), join(root, 'capture-claude-request.json')];

for (const index of [0, 1, 2]) for (const suffix of ['', '-wal', '-shm', '-journal']) {
  test(`metadata write ${index} refuses a symlink to store${suffix}`, async t => {
    const f = await fixture(t), target = targets(f.root)[index];
    await mkdir(join(f.root, 'data'), { mode: 0o700 });
    await writeFile(f.descriptor.database.path + suffix, 'synthetic store sentinel', { mode: 0o600 });
    await mkdir(dirname(target), { recursive: true, mode: 0o700 });
    await symlink(f.descriptor.database.path + suffix, target);
    await assert.rejects(f.configure(index === 1 ? 'codex' : 'claude'), error => error.key === 'local_recovery_required');
    assert.equal(await readFile(f.descriptor.database.path + suffix, 'utf8'), 'synthetic store sentinel');
  });
}
for (const index of [0, 1, 2]) test(`metadata write ${index} refuses a direct store collision even with a non-SQLite filename`, async t => {
  const f = await fixture(t), target = targets(f.root)[index];
  f.descriptor.database.path = target;
  await assert.rejects(f.configure(index === 1 ? 'codex' : 'claude'), error => error.key === 'local_recovery_required');
  await assert.rejects(lstat(target), { code: 'ENOENT' });
});

for (const index of [0, 1, 2]) test(`metadata write ${index} refuses a hard link to a store with an arbitrary filename`, async t => {
  const f = await fixture(t), target = targets(f.root)[index];
  f.descriptor.database.path = join(f.home, 'synthetic-store');
  await writeFile(f.descriptor.database.path, '{}\n', { mode: 0o600 });
  await mkdir(dirname(target), { recursive: true, mode: 0o700 });
  await link(f.descriptor.database.path, target);
  await assert.rejects(f.configure(index === 1 ? 'codex' : 'claude'), error => error.key === 'local_recovery_required');
  assert.equal((await lstat(target)).ino, (await lstat(f.descriptor.database.path)).ino);
});

test('capture request uses exclusive create and private file/directory modes and never emits its content', async t => {
  const f = await fixture(t), seen = [];
  intercept(t, 'open', original => async (path, flags, mode) => {
    const handle = await original(path, flags, mode);
    if (String(path).includes('capture-claude-request.json.tmp-')) {
      seen.push({ flags, mode, file: (await handle.stat()).mode & 0o777,
        directory: (await lstat(dirname(path))).mode & 0o777 });
    }
    return handle;
  });
  await f.configure();
  assert.deepEqual(seen, [{ flags: 'wx', mode: 0o600, file: 0o600, directory: 0o700 }]);
  assert.equal((await lstat(join(f.root, 'capture-claude-request.json'))).mode & 0o777, 0o600);
  const request = JSON.parse(await readFile(join(f.root, 'capture-claude-request.json'), 'utf8'));
  assert.equal(request.version, 'local-raw-setup-request-v1');
  assert.doesNotMatch(f.output.join('\n'), new RegExp(f.descriptor.ownerId));
});

test('capture refuses a directory whose mode is not private', async t => {
  const f = await fixture(t); await chmod(f.root, 0o755);
  await assert.rejects(f.configure()); await assert.rejects(lstat(join(f.root, 'capture-claude-request.json')), { code: 'ENOENT' });
});

test('capture checks the request directory owner before writing', async t => {
  const f = await fixture(t);
  intercept(t, 'lstat', original => async (path, ...args) => {
    const stat = await original(path, ...args);
    if (path === f.root) Object.defineProperty(stat, 'uid', { value: process.getuid() + 1 });
    return stat;
  });
  await assert.rejects(f.configure()); await assert.rejects(lstat(join(f.root, 'capture-claude-request.json')), { code: 'ENOENT' });
});

for (const index of [0, 1, 2]) test(`metadata write ${index} removes its temporary and leaves no partial final after a write failure`, async t => {
  const f = await fixture(t), target = targets(f.root)[index];
  let injected = false;
  intercept(t, 'open', original => async (path, ...args) => {
    const handle = await original(path, ...args);
    if (String(path).startsWith(target)) {
      const write = handle.writeFile.bind(handle);
      handle.writeFile = async () => { injected = true; await write('partial'); throw new Error('injected metadata write failure'); };
    }
    return handle;
  });
  await assert.rejects(f.configure(index === 1 ? 'codex' : 'claude'), /injected metadata write failure/);
  assert.equal(injected, true);
  await assert.rejects(lstat(target), { code: 'ENOENT' });
  assert.deepEqual((await readdir(dirname(target))).filter(name => name.startsWith(target.split('/').at(-1) + '.tmp-')), []);
});

test('capture request cleans up if rename fails after a successful write', async t => {
  const f = await fixture(t), target = targets(f.root)[2]; let injected = false;
  intercept(t, 'rename', original => async (from, to) => {
    if (to === target) { injected = true; throw new Error('injected before rename'); }
    return original(from, to);
  });
  await assert.rejects(f.configure(), /injected before rename/); assert.equal(injected, true);
  await assert.rejects(lstat(target), { code: 'ENOENT' });
  assert.deepEqual((await readdir(f.root)).filter(name => name.startsWith('capture-claude-request.json.tmp-')), []);
});

test('next capture run removes stale request temps from earlier dead processes for both clients', async t => {
  const f = await fixture(t);
  const stale = ['claude', 'codex'].map(client => join(f.root, `capture-${client}-request.json.tmp-2147483647`));
  for (const path of stale) await writeFile(path, 'sensitive synthetic stale metadata', { mode: 0o600 });
  await f.configure();
  for (const path of stale) await assert.rejects(lstat(path), { code: 'ENOENT' });
});

test('existing Codex installation stub content stays unchanged', async t => {
  const f = await fixture(t), target = targets(f.root)[1];
  await mkdir(dirname(target), { recursive: true, mode: 0o700 });
  await writeFile(target, '{"synthetic":true}\n', { mode: 0o600 });
  await f.configure('codex');
  assert.equal(await readFile(target, 'utf8'), '{"synthetic":true}\n');
});

for (const retained of [false, true]) test(`orphan uninstall with retained capture=${retained} never writes metadata without a descriptor`, async t => {
  const f = await fixture(t);
  if (retained) await f.configure();
  const settings = join(f.root, 'capture-settings.json');
  const before = retained ? await readFile(settings, 'utf8') : null;
  const opens = [];
  intercept(t, 'open', original => async (path, flags, ...args) => {
    if (flags === 'wx') opens.push(path);
    return original(path, flags, ...args);
  });
  await configureCapture(f.root, null, ['claude'], {
    env: { HOME: f.home, PATH: '/usr/bin:/bin', TMPDIR: f.home }, write: () => {}, t: key => key,
  }, { uninstall: true });
  assert.deepEqual(opens, []);
  if (retained) assert.equal(await readFile(settings, 'utf8'), before);
  else await assert.rejects(lstat(settings), { code: 'ENOENT' });
});

for (const client of ['claude', 'codex']) test(`${client} final capture request contains only the exact metadata schema`, async t => {
  const f = await fixture(t);
  const credential = 'obviously-fake-provider-credential-for-tests';
  const transcript = 'Synthetic conversation body that must stay out of the request';
  f.env.OPENAI_API_KEY = credential;
  const sourceRoot = join(f.home, client === 'claude' ? '.claude/projects' : '.codex/sessions');
  await mkdir(sourceRoot, { recursive: true, mode: 0o700 });
  await writeFile(join(sourceRoot, 'synthetic.jsonl'), JSON.stringify({ text: transcript }) + '\n', { mode: 0o600 });
  await f.configure(client);
  const path = join(f.root, `capture-${client}-request.json`);
  assert.equal((await lstat(path)).mode & 0o777, 0o600);
  assert.equal((await lstat(f.root)).mode & 0o777, 0o700);
  const text = await readFile(path, 'utf8'), request = JSON.parse(text);
  assert.deepEqual(Object.keys(request).sort(), [
    'version', 'installationDirectory', 'databasePath', 'namespace', 'client',
    'sourceRoot', 'clientConfigPath', 'usageRoot', 'installation', 'rawMode',
    'rawCapBytes', 'dailyCap', 'providerApiKeyEnv', 'interpretationConsent',
    'plaintextRawConsent', 'foregroundConsent',
  ].sort());
  assert.deepEqual(Object.keys(request.namespace).sort(), ['ownerId', 'scope', 'projectId'].sort());
  assert.deepEqual(request.namespace, { ownerId: f.descriptor.ownerId, scope: 'personal', projectId: null });
  assert.deepEqual(Object.keys(request.installation), client === 'claude' ? ['pluginRoot'] : ['qualificationConfigPath']);
  const support = join(f.root, 'capture-support', client);
  assert.deepEqual(request.installation, client === 'claude' ? { pluginRoot: support } :
    { qualificationConfigPath: join(support, 'installation.json') });
  assert.equal(request.sourceRoot, sourceRoot);
  assert.equal(request.providerApiKeyEnv, 'OPENAI_API_KEY');
  assert.equal(request.interpretationConsent, false);
  assert.equal(request.plaintextRawConsent, true);
  assert.equal(request.foregroundConsent, true);
  for (const forbidden of [credential, transcript]) {
    assert.equal(text.includes(forbidden), false);
    assert.equal(f.output.join('\n').includes(forbidden), false);
  }
});

for (const custom of [false, true]) for (const mode of [0o700, 0o750, 0o755]) test(`Claude client directory accepts mode ${mode.toString(8)} without chmod (custom=${custom})`, async t => {
  const f = await fixture(t), path = join(f.home, custom ? 'claude-config' : '.claude');
  if (custom) f.env.CLAUDE_CONFIG_DIR = path;
  await mkdir(path, { mode }); await chmod(path, mode);
  await f.configure();
  assert.equal((await lstat(path)).mode & 0o777, mode);
  assert.ok(f.output.includes('local_capture_status'));
});

for (const custom of [false, true]) for (const mode of [0o700, 0o750, 0o755, null]) test(`Codex client directory accepts mode ${mode === null ? 'missing' : mode.toString(8)} without chmod (custom=${custom})`, async t => {
  const f = await fixture(t), path = join(f.home, custom ? 'codex-config' : '.codex');
  if (custom) f.env.CODEX_HOME = path;
  if (mode !== null) { await mkdir(path, { mode }); await chmod(path, mode); }
  await f.configure('codex');
  assert.equal((await lstat(path)).mode & 0o777, mode ?? 0o700);
  const request = JSON.parse(await readFile(join(f.root, 'capture-codex-request.json'), 'utf8'));
  assert.equal(request.clientConfigPath, join(path, 'hooks.json'));
  assert.equal(request.sourceRoot, join(path, 'sessions'));
  assert.ok(f.output.includes('local_capture_status'));
});

async function directorySnapshot(path) {
  const stat = await lstat(path);
  return { mode: stat.mode, uid: stat.uid, value: stat.isSymbolicLink() ? await fs.readlink(path) :
    stat.isDirectory() ? await Promise.all((await readdir(path)).sort().map(async name => [name, await directorySnapshot(join(path, name))])) :
      await readFile(path, 'utf8') };
}
for (const unsafe of ['775', '777', 'symlink', 'symlink-component', 'file', 'foreign-owner', 'custom-writable']) test(`Codex unsafe directory ${unsafe} refuses without changes`, async t => {
  const f = await fixture(t), path = join(f.home, unsafe === 'custom-writable' ? 'codex-config' : '.codex');
  if (unsafe === 'custom-writable') f.env.CODEX_HOME = path;
  if (unsafe === 'file') await writeFile(path, 'synthetic sentinel', { mode: 0o600 });
  else if (unsafe.startsWith('symlink')) {
    const target = join(f.home, 'target'); await mkdir(target, { mode: 0o700 });
    if (unsafe === 'symlink') await symlink(target, path);
    else {
      const alias = join(f.home, 'alias'); await symlink(target, alias);
      await mkdir(join(target, 'config'), { mode: 0o700 }); f.env.CODEX_HOME = join(alias, 'config');
    }
  } else {
    await mkdir(path, { mode: 0o700 });
    await writeFile(join(path, 'hooks.json'), '{}\n', { mode: 0o600 });
    if (unsafe !== 'foreign-owner') await chmod(path, unsafe === 'custom-writable' ? 0o775 : parseInt(unsafe, 8));
  }
  const before = await directorySnapshot(f.home), rootBefore = await directorySnapshot(f.root);
  const originalLstat = fs.lstat;
  if (unsafe === 'foreign-owner') intercept(t, 'lstat', original => async (target, ...args) => {
    const stat = await original(target, ...args);
    if (target === path) Object.defineProperty(stat, 'uid', { value: process.getuid() + 1 });
    return stat;
  });
  await assert.rejects(clientConfigDirectory('codex', f.env), { key: 'local_root_invalid', code: 2 });
  await assert.rejects(f.configure('codex'), { key: 'local_root_invalid', code: 2 });
  // End the synthetic ownership interception before comparing real metadata.
  if (unsafe === 'foreign-owner') { fs.lstat = originalLstat; syncBuiltinESMExports(); }
  assert.deepEqual(await directorySnapshot(f.home), before);
  assert.deepEqual(await directorySnapshot(f.root), rootBefore);
});

for (const leaf of ['capture', 'capture-usage', 'capture-support', 'capture-support/claude']) test(`private ${leaf} still requires mode 0700`, async t => {
  const f = await fixture(t), path = join(f.root, leaf);
  await mkdir(path, { recursive: true, mode: 0o700 }); await chmod(path, 0o755);
  await assert.rejects(f.configure(), { key: 'local_root_invalid', code: 2 });
  assert.equal((await lstat(path)).mode & 0o777, 0o755);
  await assert.rejects(lstat(join(f.root, 'capture-claude-request.json')), { code: 'ENOENT' });
});

for (const client of ['claude-code', 'codex', undefined]) for (const mode of [0o700, 0o750, 0o755]) test(`${client} native settings snapshot/write directory mode ${mode.toString(8)}`, async t => {
  const { nativeSnapshot, nativeWrite } = await import('../../../integrations/client/raw/local-setup-files.mjs');
  const f = await fixture(t), directory = join(f.home, 'client-config'), path = join(directory, 'settings.json');
  await mkdir(directory, { mode }); await chmod(directory, mode);
  await writeFile(path, '{}\n', { mode: 0o600 });
  if (client === undefined && mode !== 0o700) {
    await assert.rejects(nativeSnapshot(path, client), { reason: 'unsafe_path' });
    await assert.rejects(nativeSnapshot(path), { reason: 'unsafe_path' });
    await assert.rejects(nativeWrite(path, '{"hooks":{}}\n', await nativeSnapshot(path, 'codex')), { reason: 'unsafe_path' });
    assert.equal(await readFile(path, 'utf8'), '{}\n');
  } else {
    const before = await nativeSnapshot(path, client), text = '{"hooks":{}}\n';
    await nativeWrite(path, text, before, client);
    assert.equal((await nativeSnapshot(path, client)).text, text);
    assert.equal((await lstat(path)).mode & 0o777, 0o600);
  }
  assert.equal((await lstat(directory)).mode & 0o777, mode);
});

for (const unsafe of ['775', '777', 'symlink', 'symlink-component', 'file', 'foreign-owner']) test(`Codex native settings refuses unsafe directory ${unsafe} on reads and writes`, async t => {
  const { nativeSnapshot, nativeWrite } = await import('../../../integrations/client/raw/local-setup-files.mjs');
  const f = await fixture(t), directory = join(f.home, 'codex-config'), path = join(directory, 'hooks.json');
  await mkdir(directory, { mode: 0o700 }); await writeFile(path, '{}\n', { mode: 0o600 });
  const before = await nativeSnapshot(path, 'codex');
  let target = path;
  if (unsafe === 'file') {
    const file = join(f.home, 'file'); await writeFile(file, 'synthetic sentinel'); target = join(file, 'hooks.json');
  } else if (unsafe.startsWith('symlink')) {
    const alias = join(f.home, 'alias'); await symlink(directory, alias);
    if (unsafe === 'symlink') target = join(alias, 'hooks.json');
    else { await mkdir(join(directory, 'child'), { mode: 0o700 }); target = join(alias, 'child/hooks.json'); }
  } else if (unsafe !== 'foreign-owner') await chmod(directory, parseInt(unsafe, 8));
  const inventory = await directorySnapshot(f.home), originalLstat = fs.lstat;
  if (unsafe === 'foreign-owner') intercept(t, 'lstat', original => async (path, ...args) => {
    const stat = await original(path, ...args);
    if (path === directory) Object.defineProperty(stat, 'uid', { value: process.getuid() + 1 });
    return stat;
  });
  await assert.rejects(nativeSnapshot(target, 'codex'), { reason: 'unsafe_path' });
  await assert.rejects(nativeWrite(target, '{"hooks":{}}\n', before, 'codex'));
  if (unsafe === 'foreign-owner') { fs.lstat = originalLstat; syncBuiltinESMExports(); }
  assert.deepEqual(await directorySnapshot(f.home), inventory);
});

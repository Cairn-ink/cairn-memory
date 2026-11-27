import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { chmod, cp, mkdir, readFile, readdir, symlink, unlink, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test, { after, before } from 'node:test';
import { DatabaseSync } from 'node:sqlite';
import { openMemoryCore } from '../../../core/index.mjs';
import { initLocalRawStore } from '../../../integrations/client/raw/local-setup-init.mjs';
import { createLocalRawSetup, setupLocalRaw } from '../../../integrations/client/raw/local-setup.mjs';
import { buildCoreLocalCandidate } from '../../../packaging/build-core-local.mjs';
import { addFixtureCard } from '../../adapter-sqlite/test/legacy/fixtures.mjs';
import { createTestWorkspace } from '../../../tools/testing/workspace.mjs';
import { inspectCodexServers } from '../lib/codex.mjs';
import { readClaudeServers } from '../lib/local-claude.mjs';
import { codexSnippet } from '../lib/local-codex.mjs';
import { runLocalCutover } from '../lib/local-cutover.mjs';
import { readDescriptor } from '../lib/local-descriptor.mjs';
import { installerFixture, realDaemonEngine } from './daemon-installer-fixture.mjs';
import { assertFixtureClients, fixtureBinaryGuard } from './fixture-clients.mjs';

const linux = { skip: process.platform !== 'linux', timeout: 90_000 };
const marker = 'A synthetic kestrel found a striped ribbon.';
const candidate = createTestWorkspace({ after }).path;
let manifest;
before(() => {
  if (linux.skip) return;
  manifest = buildCoreLocalCandidate(join(candidate, 'out'));
  const operation = spawnSync('/usr/bin/tar', ['-xzf', join(candidate, 'out', manifest.archive.filename), '-C', candidate],
    { env: {}, timeout: 15_000 });
  assert.ifError(operation.error);
  assert.equal(operation.status, 0, operation.stderr.toString());
});

async function fixture(t, { both = false } = {}) {
  const f = await installerFixture(t, both ? { clients: ['claude', 'codex'] } : {});
  const database = f.database, scratch = dirname(f.home);
  await unlink(database);
  assert.equal((await initLocalRawStore({ databasePath: database })).status, 'initialized');
  const descriptor = await readDescriptor(f.root);
  const namespace = { ownerId: descriptor.ownerId, scope: 'personal', projectId: null };
  const core = openMemoryCore({ path: database, raw: false });
  let memory;
  try {
    const result = core.admit({ namespace, memory: { content: marker, kind: 'fact' },
      receipts: [{ client: 'manual', sessionId: 'fixture', eventId: 'fixture', role: 'user', excerpt: 'Synthetic evidence' }] });
    assert.equal(result.ok, true);
    memory = result.value.memory;
  } finally { await core.close(); }
  await chmod(database, 0o600);
  await f.setEngine(realDaemonEngine({ root: join(f.home, 'run') }));
  const modules = join(f.root, 'engine', manifest.engineId, 'app', 'node_modules');
  await mkdir(modules, { mode: 0o700, recursive: true });
  await cp(join(candidate, 'package'), join(modules, manifest.package.name), { recursive: true });
  if (both) {
    await mkdir(f.env.CODEX_HOME, { mode: 0o700 });
    await writeFile(join(f.env.CODEX_HOME, 'config.toml'), codexSnippet(f.root, descriptor.clients.codex.vector), { mode: 0o600 });
    const state = join(scratch, 'codex-state.json'), calls = join(scratch, 'codex-calls.jsonl');
    await writeFile(state, '{}');
    await writeFile(join(f.env.PATH, 'codex'), `#!${process.execPath}
${fixtureBinaryGuard(scratch)}
process.env.FAKE_STATE = ${JSON.stringify(state)};
process.env.FAKE_CALLS = ${JSON.stringify(calls)};
${await readFile(new URL('./fake-codex.mjs', import.meta.url), 'utf8')}`, { mode: 0o755 });
  }
  const inspection = { fallbackParent: scratch, managedPaths: [] };
  const runClaude = args => {
    const { claude } = assertFixtureClients(f.env, scratch);
    return spawnSync(claude, args, { env: f.env, encoding: 'utf8', timeout: 5000 });
  };
  const context = { inspection, runClaude, write: Object.assign(() => {}, { literal() {} }), t: key => key };
  const options = { root: f.root, manifest, env: f.env, context };
  return { ...f, memory, namespace, options, initial: await readFile(database), inspection,
    run: (action, onCheckpoint) => runLocalCutover({ ...options, action, onCheckpoint }) };
}

async function captureFixture(f, name = 'claude') {
  const installationDirectory = join(f.root, 'capture', name), native = join(f.home, name);
  const sourceRoot = join(native, 'sources'), support = join(native, 'support');
  const usageRoot = join(f.root, 'usage'), clientConfigPath = join(native, 'hooks.json');
  for (const path of [sourceRoot, support, usageRoot, dirname(installationDirectory)]) {
    await mkdir(path, { mode: 0o700, recursive: true });
  }
  const installation = name === 'claude' ? { pluginRoot: support } : { qualificationConfigPath: join(support, 'installation.json') };
  if (name === 'codex') {
    await writeFile(installation.qualificationConfigPath, '{}\n', { mode: 0o600 });
    await mkdir(join(support, 'qualification'), { mode: 0o700 });
  }
  await writeFile(clientConfigPath, '{}\n', { mode: 0o600 });
  const request = { version: 'local-raw-setup-request-v1', installationDirectory, databasePath: f.database,
    namespace: f.namespace, client: name === 'claude' ? 'claude-code' : 'codex', sourceRoot, clientConfigPath, usageRoot, installation,
    rawMode: 'local-plain-v1', rawCapBytes: 1000000, dailyCap: 20, providerApiKeyEnv: 'OPENAI_API_KEY',
    plaintextRawConsent: true, foregroundConsent: true, interpretationConsent: false };
  assert.equal((await setupLocalRaw(request)).status, 'prepared');
  assert.equal((await createLocalRawSetup({ installationDirectory }).activate()).status, 'active');
  return { installationDirectory, clientConfigPath };
}

const paths = async f => {
  const { cutover } = (await readDescriptor(f.root, { allowV2: true })).migration;
  const maintenance = join(f.root, '.cutover-' + cutover.id);
  return { retired: join(dirname(f.database), '.cairn-retired-' + cutover.attemptId),
    archive: join(maintenance, 'backup-' + cutover.attemptId, 'store.sqlite') };
};
const absent = path => assert.rejects(readFile(path), { code: 'ENOENT' });
const stopAt = point => state => {
  if (state === point) throw Object.assign(new Error(point), { code: point });
};
const refused = code => error => {
  assert.equal(error.params?.code, code);
  return true;
};
const entry = fileURLToPath(new URL('../../../packaging/bin/cairn-memory.mjs', import.meta.url));

function stdio(node, args, requests, f) {
  const child = spawnSync(node, args, { env: { HOME: f.home, TMPDIR: f.env.TMPDIR }, cwd: f.home,
    input: requests.map((request, id) => JSON.stringify({ jsonrpc: '2.0', id: id + 1, ...request }) + '\n').join(''),
    encoding: 'utf8', timeout: 12000, killSignal: 'SIGKILL' });
  assert.ifError(child.error);
  return child;
}

test('confirmation switches both recorded MCP vectors, arms staged capture and retires legacy bytes before first write', linux, async t => {
  const f = await fixture(t, { both: true });
  const captures = [await captureFixture(f), await captureFixture(f, 'codex')];
  const phases = () => Promise.all(captures.map(async capture => {
    const generations = (await readdir(capture.installationDirectory)).filter(name => name.startsWith('core-'));
    assert.equal(generations.length, 1);
    return JSON.parse(await readFile(join(capture.installationDirectory, generations[0], 'binding.json'), 'utf8')).phase;
  }));
  assert.equal((await f.run('prepare-activation')).state, 'verified');
  const { retired, archive } = await paths(f);
  assert.ok((await readFile(archive)).includes(marker));
  await assert.rejects(f.run('confirm-activation', stopAt('activation-source-exchanged')), refused('activation-source-exchanged'));
  assert.deepEqual(await phases(), ['staged', 'staged']);
  assert.ok((await readFile(retired)).includes(marker));
  assert.equal((await readClaudeServers(f.home))['cairn-local'].args[2], f.database);
  const outcome = await f.run('confirm-activation', async state => {
    if (state.startsWith('activation-mcp-')) {
      await absent(retired);
      await absent(archive);
      assert.deepEqual(await phases(), ['staged', 'staged']);
    }
  });
  assert.equal(outcome.state, 'active');
  assert.deepEqual(await phases(), ['armed', 'armed']);
  const claude = (await readClaudeServers(f.home))['cairn-local'];
  const codex = (await inspectCodexServers({ home: f.env.CODEX_HOME, env: f.env, ...f.inspection })).find(row => row.name === 'cairn-local');
  assert.deepEqual(codex.args, claude.args);
  assert.equal(claude.args[2], outcome.targetPath);

  for (const path of [f.database, join(f.home, 'alias.sqlite'), outcome.targetPath]) {
    if (path.endsWith('alias.sqlite')) await symlink(f.database, path);
    const blocked = stdio(process.execPath, [entry, '--db', path, '--owner', f.namespace.ownerId],
      [{ method: 'tools/call', params: { name: 'remember_memory', arguments: { content: 'Unexpected legacy write' } } }], f);
    assert.notEqual(blocked.status, 0);
    assert.doesNotMatch(blocked.stdout, /Unexpected legacy write/);
  }

  const inspect = stdio(codex.command, codex.args, [{ method: 'tools/call', params: {
    name: 'find_memory_candidates', arguments: { query: 'kestrel', types: ['memory'], intent: 'current' },
  } }], f);
  assert.equal(inspect.status, 0, inspect.stderr);
  assert.match(inspect.stdout, new RegExp(f.memory.id));
  const forgotten = stdio(claude.command, claude.args, [{ method: 'tools/call', params: {
    name: 'forget_memory', arguments: { memoryId: f.memory.id, expectedRevision: f.memory.revision },
  } }], f);
  assert.equal(forgotten.status, 0, forgotten.stderr);
  assert.equal(JSON.parse(JSON.parse(forgotten.stdout).result.content[0].text).value.forgotten, true);
  for (const file of [retired, archive, ...[f.database, outcome.targetPath].flatMap(path =>
    ['', '-wal', '-shm', '-journal'].map(suffix => path + suffix))]) {
    const bytes = await readFile(file).catch(error => { if (error.code !== 'ENOENT') throw error; });
    assert.ok(!bytes?.includes(marker));
  }
  assert.equal((await f.run('confirm-activation')).state, 'active');
  await assert.rejects(f.run('abort'), refused('cutover_activation_confirmed'));
});

test('abort after the exchange restores the same legacy file and reclaims both copies', linux, async t => {
  const f = await fixture(t);
  await f.run('prepare-activation');
  const { retired, archive } = await paths(f);
  let published;
  await assert.rejects(f.run('confirm-activation', async (state, cutover) => {
    if (state === 'activation-target-published') {
      const { captureTargetFor } = await import('../lib/local-cutover-journal.mjs');
      published = captureTargetFor(f.database, cutover.attemptId);
    }
    stopAt('activation-source-exchanged')(state);
  }), refused('activation-source-exchanged'));
  assert.equal((await f.run('abort')).state, 'aborted');
  assert.deepEqual(await readFile(f.database), f.initial);
  await absent(retired);
  await absent(archive);
  await absent(published);
  assert.equal((await readDescriptor(f.root)).version, 'cairn-local-installation-v1');
});

test('a legacy change after verification refuses early, and a late writer blocks retirement after exchange', linux, async t => {
  const f = await fixture(t);
  await f.run('prepare-activation');
  const { retired } = await paths(f);
  const writer = new DatabaseSync(f.database);
  writer.exec('PRAGMA user_version = ' + writer.prepare('PRAGMA user_version').get().user_version);
  writer.close();
  await assert.rejects(f.run('confirm-activation'), refused('legacy_backup_stale'));
  assert.equal((await readDescriptor(f.root)).version, 'cairn-local-installation-v1');
  await f.run('prepare-activation');
  const late = await paths(f);
  let handle;
  try {
    await assert.rejects(f.run('confirm-activation', state => {
      if (state === 'activation-source-exchanged') handle = new DatabaseSync(late.retired);
    }), refused('cutover_store_busy'));
    assert.equal((await readClaudeServers(f.home))['cairn-local'].args[2], f.database);
  } finally { handle?.close(); }
  await absent(retired);
  assert.equal((await f.run('confirm-activation')).state, 'active');
});

test('a model-configured install is refused before touching the descriptor or client', linux, async t => {
  const f = await fixture(t);
  await assert.rejects(runLocalCutover({ ...f.options, env: { ...f.env, OPENAI_API_KEY: 'synthetic-present' },
    action: 'prepare-activation' }), refused('cutover_model_configured'));
  assert.equal((await readDescriptor(f.root)).version, 'cairn-local-installation-v1');
  assert.deepEqual(await readFile(f.database), f.initial);
});

test('persisted legacy Cards block activation even after the model key is removed', linux, async t => {
  const f = await fixture(t);
  addFixtureCard(f.database, 'synthetic-card', 'draft');
  const original = await readFile(f.database);
  await assert.rejects(f.run('prepare-activation'), refused('cutover_legacy_content_unrepresentable'));
  assert.equal((await readDescriptor(f.root)).version, 'cairn-local-installation-v1');
  assert.deepEqual(await readFile(f.database), original);
  await f.run('prepare');
  const { archive } = await paths(f);
  await assert.rejects(f.run('confirm-activation'), refused('cutover_legacy_content_unrepresentable'));
  await absent(archive);
  assert.equal((await readDescriptor(f.root)).version, 'cairn-local-installation-v1');
  assert.deepEqual(await readFile(f.database), original);
});

test('confirmation resumes after each publication checkpoint and after installer death', linux, async t => {
  const f = await fixture(t);
  await captureFixture(f);
  await f.run('prepare-activation');
  const original = await readFile(f.database);
  for (const point of ['activation-staging', 'activation-target-published', 'capture-paused', 'capture-store-staged',
    'capture-binding-staged', 'capture-native-published', 'activation-retirement-planned']) {
    await assert.rejects(f.run('confirm-activation', stopAt(point)), refused(point));
    assert.deepEqual(await readFile(f.database), original);
  }
  const { context, ...options } = f.options;
  const child = spawnSync(process.execPath, ['--input-type=module', '-e', `
    import { spawnSync } from 'node:child_process';
    import { join } from 'node:path';
    import { runLocalCutover } from ${JSON.stringify(new URL('../lib/local-cutover.mjs', import.meta.url).href)};
    const options = JSON.parse(process.argv[1]);
    const runClaude = args => spawnSync(join(options.env.PATH, 'claude'), args,
      { env: options.env, encoding: 'utf8', timeout: 5000 });
    await runLocalCutover({ ...options, action: 'confirm-activation',
      context: { runClaude, t: key => key, write: Object.assign(() => {}, { literal() {} }) },
      onCheckpoint(state) { if (state === 'activation-legacy-sealed') process.kill(process.pid, 'SIGKILL'); }
    });
  `, JSON.stringify(options)], { env: {}, encoding: 'utf8', timeout: 30_000, killSignal: 'SIGKILL' });
  assert.ifError(child.error);
  assert.equal(child.signal, 'SIGKILL', child.stderr);
  await assert.rejects(f.run('abort'), refused('cutover_activation_confirmed'));
  for (const point of ['activation-source-removed', 'activation-backup-removed', 'activation-reclaimed',
    'activation-mcp-claude', 'capture-armed', 'activation-active']) {
    await assert.rejects(f.run('confirm-activation', stopAt(point)), refused(point));
  }
  assert.equal((await f.run('confirm-activation')).state, 'active');
});

test('confirmation deletes legacy index files before switching registration', linux, async t => {
  const f = await fixture(t);
  await f.run('prepare-activation');
  const cache = f.database + '.context-read-v1.sqlite';
  await writeFile(cache, marker, { mode: 0o600 });
  const active = await f.run('confirm-activation', async state => {
    if (state === 'activation-mcp-claude') await absent(cache);
  });
  assert.equal(active.state, 'active');
  await absent(cache);
  assert.equal((await readClaudeServers(f.home))['cairn-local'].args[2], active.targetPath);
});

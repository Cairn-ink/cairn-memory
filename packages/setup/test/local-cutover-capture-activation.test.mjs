import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { cp, mkdir, readFile, readdir, rename, stat, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import test, { before, after } from 'node:test';
import { DatabaseSync } from 'node:sqlite';
import { setupLocalRaw, createLocalRawSetup } from '../../../integrations/client/raw/local-setup.mjs';
import { initLocalRawStore } from '../../../integrations/client/raw/local-setup-init.mjs';
import { runLocalRawHook } from '../../../integrations/client/raw/local-hook.mjs';
import { buildCoreLocalCandidate } from '../../../packaging/build-core-local.mjs';
import { SQLITE_PHYSICAL_VERSION } from '../../adapter-sqlite/src/schema/layout.mjs';
import { createTestWorkspace } from '../../../tools/testing/workspace.mjs';
import { runLocalCutover } from '../lib/local-cutover.mjs';
import { captureTargetFor } from '../lib/local-cutover-journal.mjs';
import { readDescriptor } from '../lib/local-descriptor.mjs';
import { installerFixture } from './daemon-installer-fixture.mjs';

const linux = { skip: process.platform !== 'linux', timeout: 90_000 };
const activationSteps = ['capture-paused', 'capture-store-staged', 'capture-binding-staged',
  'capture-native-published', 'capture-armed'];
const abortSteps = ['abort-capture-disarmed', 'abort-capture-native-restored'];
const apps = createTestWorkspace({ after }, { prefix: 'capture-candidate-' }).path;
let manifest, tree;
before(() => {
  if (process.platform !== 'linux') return;
  const out = join(apps, 'out');
  manifest = buildCoreLocalCandidate(out);
  const unpack = spawnSync('tar', ['-xzf', join(out, manifest.archive.filename), '-C', out],
    { env: { PATH: '/usr/bin:/bin' }, encoding: 'utf8', timeout: 15_000 });
  assert.ifError(unpack.error);
  assert.equal(unpack.status, 0, unpack.stderr);
  tree = join(out, 'package');
});

async function fixture(t) {
  const dir = createTestWorkspace(t, { prefix: 'capture-handoff-' }).path;
  const database = join(dir, 'legacy.sqlite');
  const f = await installerFixture(t, { db: database, clients: ['claude', 'codex'] });
  await f.setEngine(`console.log(JSON.stringify(args[1] === 'stop' ? { still_running: 0 } : { daemons: [] }));`);
  const app = join(f.root, 'engine', manifest.engineId, 'app');
  await mkdir(join(app, 'node_modules'), { mode: 0o700, recursive: true });
  const packaged = join(app, 'node_modules', manifest.package.name);
  await cp(tree, packaged, { recursive: true });
  const executable = join(packaged, 'packaging/core-local/capture-cli.mjs');
  const { runBoundCapture } = await import(pathToFileURL(join(dirname(executable), 'capture-hook.mjs')).href);
  const options = { root: f.root, manifest, env: f.env };
  const legacyBytes = await readFile(join(f.root, 'installation.json'));
  const descriptor = await readDescriptor(f.root);
  assert.equal((await initLocalRawStore({ databasePath: database })).status, 'initialized');
  const usageRoot = join(f.root, 'usage');
  await mkdir(usageRoot, { mode: 0o700 });
  await mkdir(join(f.root, 'capture'), { mode: 0o700 });
  const clients = {};
  for (const [name, client] of [['claude', 'claude-code'], ['codex', 'codex']]) {
    const native = join(f.home, name);
    await mkdir(native, { mode: 0o700 });
    const sourceRoot = join(native, 'sources'), support = join(native, 'support');
    await mkdir(sourceRoot, { mode: 0o700 });
    await mkdir(support, { mode: 0o700 });
    const sourcePath = join(sourceRoot, 'session.jsonl'), clientConfigPath = join(native, 'hooks.json');
    await writeFile(sourcePath, '', { mode: 0o600 });
    await writeFile(clientConfigPath, '{"otherSetting":true}\n', { mode: 0o640 });
    const installationDirectory = join(f.root, 'capture', name);
    const installation = name === 'claude' ? { pluginRoot: support } : { qualificationConfigPath: join(support, 'installation.json') };
    if (name === 'codex') {
      await writeFile(installation.qualificationConfigPath, '{}\n', { mode: 0o600 });
      await mkdir(join(support, 'qualification'), { mode: 0o700 });
    }
    const request = { version: 'local-raw-setup-request-v1', installationDirectory, databasePath: database,
      namespace: { ownerId: descriptor.ownerId, scope: 'personal', projectId: null }, client, sourceRoot, clientConfigPath,
      usageRoot, installation, rawMode: 'local-plain-v1', rawCapBytes: 1000000, dailyCap: 20,
      providerApiKeyEnv: 'OPENAI_API_KEY', plaintextRawConsent: true, foregroundConsent: true, interpretationConsent: false };
    assert.equal((await setupLocalRaw(request)).status, 'prepared');
    assert.equal((await createLocalRawSetup({ installationDirectory }).activate()).status, 'active');
    const record = join(installationDirectory, 'installation.json');
    const nativeBytes = await readFile(clientConfigPath), recordBytes = await readFile(record);
    const event = 'SessionStart';
    const payload = { hook_event_name: event, session_id: 'synthetic-session', transcript_path: sourcePath };
    clients[name] = { installationDirectory, record, clientConfigPath, nativeBytes, recordBytes, sourcePath,
      old: () => runLocalRawHook({ installationDirectory, event, payload }, { headless: true }),
      new: directory => runBoundCapture({ directory, event, payload, executable }, new AbortController().signal) };
  }
  return { ...f, database, options, clients, legacyBytes, executable, packaged,
    run: (action, captureClient = 'claude') => runLocalCutover({ ...options, action, captureClient }),
    read: () => readDescriptor(f.root, { allowV2: true }) };
}

function crash(f, checkpoint, action, captureClient = 'claude') {
  const entry = new URL('../lib/local-cutover.mjs', import.meta.url).href;
  const script = `import { runLocalCutover } from ${JSON.stringify(entry)};
const input = JSON.parse(process.argv[1]);
await runLocalCutover({ ...input, onCheckpoint(state) {
  if (state === ${JSON.stringify(checkpoint)}) process.kill(process.pid, 'SIGKILL');
} });`;
  const child = spawnSync(process.execPath, ['--input-type=module', '-e', script,
    JSON.stringify({ ...f.options, action, captureClient })], { env: {}, encoding: 'utf8', timeout: 30_000 });
  assert.ifError(child.error);
  assert.equal(child.signal, 'SIGKILL', child.stderr);
}

async function bindingDirectory(client) {
  const dirs = (await readdir(client.installationDirectory)).filter(name => name.startsWith('core-'));
  assert.equal(dirs.length, 1);
  return join(client.installationDirectory, dirs[0]);
}

async function restored(f) {
  assert.deepEqual(await readFile(join(f.root, 'installation.json')), f.legacyBytes);
  for (const client of Object.values(f.clients)) {
    assert.deepEqual(await readFile(client.clientConfigPath), client.nativeBytes);
    assert.deepEqual(await readFile(client.record), client.recordBytes);
    assert.equal((await stat(client.clientConfigPath)).mode & 0o777, 0o640);
  }
  assert.equal((await f.clients.claude.old()).reason, 'headless_skipped');
}

test('per-client capture activation resumes every SIGKILL checkpoint and arms only after the native vector exists', linux, async t => {
  const f = await fixture(t);
  const { claude, codex } = f.clients;
  await assert.rejects(f.run('activate-capture'), { params: { code: 'cutover_capture_not_verified' } });
  await f.run('prepare');
  const { cutover } = (await f.read()).migration;
  const target = captureTargetFor(f.database, cutover.attemptId);
  await assert.rejects(runLocalCutover({ ...f.options, action: 'activate-capture', captureClient: 'claude',
    env: { ...f.options.env, OPENAI_API_KEY: 'synthetic-provider-value' } }), { params: { code: 'cutover_capture_changed' } });
  assert.deepEqual(await readFile(claude.clientConfigPath), claude.nativeBytes);
  await assert.rejects(stat(target), { code: 'ENOENT' });
  for (const [index, step] of activationSteps.entries()) {
    crash(f, step, 'activate-capture');
    assert.equal((await claude.old()).reason, 'authority_changed');
    assert.deepEqual(await readFile(codex.clientConfigPath), codex.nativeBytes);
    if (index >= 1) assert.equal((await stat(target)).isFile(), true);
    if (index < 3) assert.deepEqual(await readFile(claude.clientConfigPath), claude.nativeBytes);
    else assert.ok((await readFile(claude.clientConfigPath, 'utf8')).includes(f.executable));
    if (index >= 2) {
      const outcome = await claude.new(await bindingDirectory(claude));
      if (index === 4) assert.deepEqual(outcome, { status: 'ready' });
      else assert.equal(outcome.reason, 'authority_changed');
    }
  }
  const result = await f.run('activate-capture');
  assert.equal(result.state, 'capture-armed');
  assert.equal(result.targetPath, target);
  assert.equal(result.generation, (await bindingDirectory(claude)).split('core-').at(-1));
  const cx = await f.run('activate-capture', 'codex');
  assert.equal(cx.targetPath, target);
  assert.notEqual(cx.generation, result.generation);
  const db = new DatabaseSync(target, { readOnly: true });
  try { assert.equal(db.prepare('PRAGMA user_version').get().user_version, SQLITE_PHYSICAL_VERSION); }
  finally { db.close(); }
  assert.equal((await f.read()).database.path, f.database);
  const directory = await bindingDirectory(claude);
  const cli = spawnSync(process.execPath, ['--disable-warning=ExperimentalWarning', f.executable,
    'hook', '--installation', directory, '--event', 'SessionStart'], {
    env: {}, encoding: 'utf8', timeout: 10_000,
    input: JSON.stringify({ hook_event_name: 'SessionStart', session_id: 'synthetic-cli',
      transcript_path: claude.sourcePath }),
  });
  assert.ifError(cli.error);
  assert.deepEqual({ code: cli.status, stdout: cli.stdout, stderr: cli.stderr }, { code: 0, stdout: '', stderr: '' });
  await f.run('abort');
  await restored(f);
  assert.equal((await claude.new(directory)).reason, 'authority_changed');
  await assert.rejects(stat(target), { code: 'ENOENT' });
});

for (const stage of activationSteps) {
  test('abort restores native bytes after ' + stage, linux, async t => {
    const f = await fixture(t);
    await f.run('prepare');
    const { cutover } = (await f.read()).migration;
    crash(f, stage, 'activate-capture');
    await f.run('abort');
    await restored(f);
    await assert.rejects(stat(captureTargetFor(f.database, cutover.attemptId)), { code: 'ENOENT' });
  });
}

test('abort resumes at both capture checkpoints without rearming either hook', linux, async t => {
  const f = await fixture(t);
  const { claude } = f.clients;
  await f.run('prepare');
  await f.run('activate-capture');
  const directory = await bindingDirectory(claude);
  for (const step of abortSteps) {
    crash(f, step, 'abort');
    assert.equal((await claude.new(directory)).reason, 'authority_changed');
    assert.equal((await claude.old()).reason, 'authority_changed');
  }
  await f.run('abort');
  await restored(f);
});

test('source changes during publication keep the hook staged and abort restores the native records', linux, async t => {
  const f = await fixture(t);
  const { claude } = f.clients;
  await f.run('prepare');
  // Replace the path with the same SQLite bytes while the old inode is leased.
  const replacement = f.database + '.replacement';
  await cp(f.database, replacement);
  await assert.rejects(runLocalCutover({ ...f.options, action: 'activate-capture', captureClient: 'claude',
    async onCheckpoint(state) { if (state === 'capture-native-published') await rename(replacement, f.database); },
  }), error => ['legacy_backup_stale', 'cutover_lease_lost'].includes(error.params?.code));
  assert.equal((await claude.new(await bindingDirectory(claude))).reason, 'authority_changed');
  await f.run('abort');
  await restored(f);
});

test('an armed hook rejects a substituted SQLite file and a copied binding of another generation', linux, async t => {
  const f = await fixture(t);
  const { claude } = f.clients;
  await f.run('prepare');
  const active = await f.run('activate-capture');
  const directory = await bindingDirectory(claude);
  const wrong = join(claude.installationDirectory, 'core-aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa');
  await mkdir(wrong, { mode: 0o700 });
  await cp(join(directory, 'binding.json'), join(wrong, 'binding.json'));
  assert.equal((await claude.new(wrong)).reason, 'authority_changed');
  const original = active.targetPath + '.original';
  await rename(active.targetPath, original);
  await cp(original, active.targetPath);
  assert.equal((await claude.new(directory)).reason, 'authority_changed');
  const database = new DatabaseSync(active.targetPath, { readOnly: true });
  try { assert.equal(database.prepare('SELECT count(*) AS n FROM cairn_capture_claims').get().n, 0); }
  finally { database.close(); }
});

// Seed the adapter directly to test the setup-armed hook separately from the
// packaged automatic-capture replay.
test('a deleted candidate session refuses restart and replay and stays absent from the closed SQLite file', linux, async t => {
  const f = await fixture(t);
  await f.run('prepare');
  const { targetPath } = await f.run('activate-capture');
  const claude = f.clients.claude, directory = await bindingDirectory(claude);
  assert.equal((await claude.new(directory)).status, 'ready');
  const sessions = join(claude.installationDirectory, 'state', 'sessions');
  const cursorPath = join(sessions, (await readdir(sessions)).find(name => /^[a-f0-9]{64}\.json$/u.test(name)));
  const before = await readFile(cursorPath);
  const { wireSessionId: sessionId } = JSON.parse(before);
  const { openStorage } = await import(pathToFileURL(join(f.packaged, 'packaging/core-local/adapter-slot.mjs')).href);
  const runtime = await openStorage(targetPath);
  const descriptor = await f.read();
  const scope = { owner: descriptor.ownerId, namespace: 'personal\0' };
  const selection = { client: 'claude-code', sessionId };
  const content = 'Synthetic candidate deletion byte sentinel.';
  const message = { id: 'synthetic-message', role: 'user', occurredAtMs: 0, content };
  try {
    const { storage } = runtime;
    const capture = { ...selection, scope, eventId: 'synthetic-seed', payloadDigest: 'a'.repeat(64) };
    const write = work => storage.uow.run(scope.owner, { pauseLock: true }, work);
    const archived = await write(tx => storage.raw.archive(tx, capture, [message]));
    assert.deepEqual(archived, { archived: 1 });
    const raw = await runtime.service.listRawMessages(scope, { cursor: null, limit: 10 });
    assert.equal(raw.items[0]?.content, content);
    assert.deepEqual(await write(tx => storage.raw.deleteConversation(tx, scope, selection)), { rawDeleted: 1 });
  } finally { await runtime.close(); }
  assert.equal((await claude.new(directory)).reason, 'capture_evidence_closed');
  const { runBoundCapture } = await import(pathToFileURL(join(dirname(f.executable), 'capture-hook.mjs')).href);
  const stop = await runBoundCapture({ directory, event: 'Stop', executable: f.executable,
    payload: { hook_event_name: 'Stop', session_id: 'synthetic-session', transcript_path: claude.sourcePath } },
  new AbortController().signal);
  assert.equal(stop.reason, 'capture_evidence_closed');
  assert.deepEqual(await readFile(cursorPath), before);
  assert.equal((await readFile(targetPath)).includes(content), false);
});

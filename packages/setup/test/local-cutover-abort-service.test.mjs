import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
import { chmod, cp, mkdir, readFile, readdir, rename, writeFile } from 'node:fs/promises';
import { basename, dirname, join } from 'node:path';
import test, { after, before } from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { openMemoryCore } from '../../../core/index.mjs';
import { buildCoreLocalCandidate } from '../../../packaging/build-core-local.mjs';
import { fixture, scratch } from '../../adapter-sqlite/test/legacy/fixtures.mjs';
import { runLocalCutover } from '../lib/local-cutover.mjs';
import { readDescriptor } from '../lib/local-descriptor.mjs';
import { installerFixture, realDaemonEngine } from './daemon-installer-fixture.mjs';

const linux = { skip: process.platform !== 'linux', timeout: 90_000 };
const ownerId = 'synthetic-daemon-owner';
const namespace = { ownerId, scope: 'personal', projectId: null };
const cutoverURL = new URL('../lib/local-cutover.mjs', import.meta.url).href;
const legacyCli = fileURLToPath(new URL('../../../adapters/mcp/cli.mjs', import.meta.url));
const requireMcp = createRequire(new URL('../../../adapters/mcp/package.json', import.meta.url));
const privateWrite = (path, bytes) => writeFile(path, bytes, { mode: 0o600 });
const archiveOf = (f, cutover) => join(f.root, '.cutover-' + cutover.id, 'backup-' + cutover.attemptId, 'store.sqlite');
const missing = path => assert.rejects(readFile(path), { code: 'ENOENT' });

const candidateRoot = linux.skip ? null : scratch({ after });
let candidate;
before(async () => {
  if (candidateRoot === null) return;
  const directory = join(candidateRoot, 'candidate');
  buildCoreLocalCandidate(directory);
  const manifest = JSON.parse(await readFile(join(directory, 'candidate-manifest.json'), 'utf8'));
  const tar = spawnSync('/usr/bin/tar', ['-xzf', join(directory, manifest.archive.filename), '-C', directory],
    { env: {}, encoding: 'utf8', timeout: 20_000 });
  assert.ifError(tar.error);
  assert.equal(tar.status, 0, tar.stderr);
  candidate = { manifest, tree: join(directory, 'package') };
});

async function install(t, path) {
  const marker = `Synthetic cutover memory ${randomUUID()}`;
  const core = openMemoryCore({ path, raw: false });
  let memory;
  try {
    const eventId = randomUUID();
    memory = ok(core.admit({ namespace, memory: { content: marker, kind: 'fact' },
      receipts: [{ client: 'manual', sessionId: eventId, eventId, role: 'user', excerpt: 'Synthetic evidence' }] })).memory;
  } finally { await core.close(); }
  await chmod(path, 0o600);
  const f = await installerFixture(t, { db: path });
  await f.setEngine(realDaemonEngine({ root: join(f.home, 'run') }));
  const { manifest, tree } = candidate;
  const modules = join(f.root, 'engine', manifest.engineId, 'app', 'node_modules');
  await mkdir(modules, { recursive: true, mode: 0o700 });
  await cp(tree, join(modules, manifest.package.name), { recursive: true });
  const capture = [];
  for (const [name, client] of [['claude', 'claude-code'], ['codex', 'codex']]) {
    const directory = join(f.root, 'capture', name);
    await mkdir(directory, { recursive: true, mode: 0o700 });
    const record = join(directory, 'installation.json');
    const bytes = JSON.stringify({ version: 'local-raw-installation-v1', phase: 'active',
      request: { installationDirectory: directory, databasePath: path, client } }) + '\n';
    await privateWrite(record, bytes);
    capture.push({ record, bytes });
  }
  const descriptor = join(f.root, 'installation.json');
  return { ...f, path, marker, memory, capture, descriptor, original: await readFile(descriptor),
    source: await readFile(path), options: { root: f.root, manifest, env: f.env } };
}

async function prepare(t) {
  const { path } = await fixture(scratch(t), 18);
  return prepareInstallation(await install(t, path));
}

async function prepareInstallation(f) {
  assert.equal((await runLocalCutover(f.options)).state, 'verified');
  const { cutover } = (await readDescriptor(f.root, { allowV2: true })).migration;
  for (const file of [f.path, cutover.targetPath, archiveOf(f, cutover)]) {
    assert.ok((await readFile(file)).includes(f.marker), `expected a byte match in ${basename(file)}`);
  }
  return { ...f, cutover };
}

function crashAbort(f, checkpoint) {
  const child = spawnSync(process.execPath, ['--input-type=module', '-e', `
    import { runLocalCutover } from ${JSON.stringify(cutoverURL)};
    const [options, checkpoint] = JSON.parse(process.argv[1]);
    await runLocalCutover({ ...options, action: 'abort', onCheckpoint(state) {
      if (state === checkpoint) process.kill(process.pid, 'SIGKILL');
    } });
  `, JSON.stringify([f.options, checkpoint])], { env: {}, encoding: 'utf8', timeout: 45_000 });
  assert.ifError(child.error);
  assert.equal(child.signal, 'SIGKILL', child.stderr);
}

function ok(result) {
  assert.equal(result.ok, true, JSON.stringify(result));
  return result.value;
}

async function assertRestored(f) {
  assert.equal((await readDescriptor(f.root)).version, 'cairn-local-installation-v1');
  assert.deepEqual(await readFile(f.descriptor), f.original);
  for (const { record, bytes } of f.capture) assert.equal(await readFile(record, 'utf8'), bytes);
  assert.deepEqual(await readFile(f.path), f.source);
}

async function assertMaintenance(f) {
  const { migration } = await readDescriptor(f.root, { allowV2: true });
  assert.equal(migration.cutover.aborting, true);
  assert.equal(migration.cutover.attemptId, f.cutover.attemptId);
  await assert.rejects(readDescriptor(f.root), { key: 'local_recovery_required' });
  const calls = await f.calls();
  const status = f.run(['daemon', 'status', '--local', '--lang', 'en']);
  assert.equal(status.code, 2, status.stdout + status.stderr);
  assert.deepEqual(await f.calls(), calls, 'the legacy engine was not launched');
  for (const { record } of f.capture) assert.equal(JSON.parse(await readFile(record, 'utf8')).phase, 'disabled');
  assert.deepEqual(await readFile(f.path), f.source);
}

async function forgetOverStdio(f) {
  const descriptor = await readDescriptor(f.root);
  const vector = descriptor.clients.claude.vector;
  const { Client } = await import(pathToFileURL(requireMcp.resolve('@modelcontextprotocol/client')).href);
  const { StdioClientTransport } = await import(pathToFileURL(requireMcp.resolve('@modelcontextprotocol/client/stdio')).href);
  const transport = new StdioClientTransport({ command: descriptor.node, args: [legacyCli,
    '--db', vector.databasePath, '--owner', vector.ownerId], env: { HOME: f.home, OPENAI_API_KEY: '' }, stderr: 'pipe' });
  const client = new Client({ name: 'synthetic-cutover-test', version: '1.0.0' });
  try {
    await client.connect(transport);
    async function call(name, args) {
      const result = await client.callTool({ name, arguments: args });
      return JSON.parse(result.content[0].text);
    }
    const { memory } = ok(await call('inspect_memory', { memoryId: f.memory.id }));
    assert.equal(memory.content, f.marker);
    assert.equal(ok(await call('forget_memory', { memoryId: memory.id, expectedRevision: memory.revision })).forgotten, true);
    assert.equal((await call('inspect_memory', { memoryId: memory.id })).error?.code, 'memory_not_found');
  } finally { await client.close(); }
}

async function assertNoCopies(f) {
  const matches = [];
  async function scan(directory) {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const path = join(directory, entry.name);
      if (entry.isDirectory()) await scan(path);
      if (entry.isFile() && (await readFile(path)).includes(f.marker)) matches.push(path);
    }
  }
  await scan(dirname(f.path));
  await scan(f.root);
  assert.deepEqual(matches, []);
}

for (const checkpoint of ['abort-restored', 'reclaim-target']) {
  test(`legacy forget immediately after an abort killed at ${checkpoint} erases every copy`, linux, async t => {
    const f = await prepare(t);
    crashAbort(f, checkpoint);
    await assertRestored(f);
    const core = openMemoryCore({ path: f.path, raw: false });
    try {
      assert.equal(ok(core.forget({ namespace, memoryId: f.memory.id, expectedRevision: f.memory.revision })).forgotten, true);
      assert.equal(core.get({ namespace, memoryId: f.memory.id }).error?.code, 'memory_not_found');
    } finally { await core.close(); }
    await assertNoCopies(f);
  });
}

test('the real legacy stdio host can forget without recovery after abort publication', linux, async t => {
  for (const checkpoint of ['abort-restored', 'reclaim-target']) {
    const f = await prepare(t);
    crashAbort(f, checkpoint);
    await assertRestored(f);
    await forgetOverStdio(f);
    await assertNoCopies(f);
  }
});

test('a crash between target and archive reclaim keeps maintenance until the next cutover operation', linux, async t => {
  const f = await prepare(t);
  crashAbort(f, 'abort-reclaim-target');
  await assertMaintenance(f);
  await missing(f.cutover.targetPath);
  assert.ok((await readFile(archiveOf(f, f.cutover))).includes(f.marker));
  assert.equal((await runLocalCutover(f.options)).state, 'aborted');
  await assertRestored(f);
  await forgetOverStdio(f);
  await assertNoCopies(f);
});

test('an unsafe artifact leaves abort in maintenance until reclaim succeeds', linux, async t => {
  const f = await prepare(t);
  const archive = archiveOf(f, f.cutover);
  await chmod(archive, 0o644);
  await assert.rejects(runLocalCutover({ ...f.options, action: 'abort' }), { key: 'local_recovery_required' });
  await assertMaintenance(f);
  assert.ok((await readFile(archive)).includes(f.marker));
  await chmod(archive, 0o600);
  assert.equal((await runLocalCutover({ ...f.options, action: 'abort' })).state, 'aborted');
  await assertRestored(f);
  await forgetOverStdio(f);
  await assertNoCopies(f);
});

test('journal-loss cleanup preserves a second installation’s verified untagged target and sidecar', linux, async t => {
  const first = await prepare(t);
  const { path } = await fixture(scratch(t), 18);
  const secondPath = join(dirname(first.path), 'second.sqlite');
  await cp(path, secondPath);
  const second = await prepareInstallation(await install(t, secondPath));
  // Represent the pre-tag descriptor and filenames around a verified candidate.
  const historical = await readDescriptor(second.root, { allowV2: true });
  const untagged = join(dirname(second.path), '.cairn-cutover-' + second.cutover.attemptId + '.sqlite');
  await rename(second.cutover.targetPath, untagged);
  historical.migration.cutover.targetPath = untagged;
  await privateWrite(second.descriptor, JSON.stringify(historical));
  assert.equal((await readDescriptor(second.root, { allowV2: true })).migration.state, 'verified');
  const sidecar = untagged + '.stale-shm';
  await privateWrite(sidecar, second.marker);
  const protectedPaths = [second.path, second.descriptor, untagged, sidecar, archiveOf(second, second.cutover)];
  const original = await Promise.all(protectedPaths.map(path => readFile(path)));
  await privateWrite(first.descriptor, first.original);
  assert.equal((await runLocalCutover({ ...first.options, action: 'abort' })).state, 'aborted');
  await missing(first.cutover.targetPath);
  await missing(archiveOf(first, first.cutover));
  assert.deepEqual(await Promise.all(protectedPaths.map(path => readFile(path))), original);
});

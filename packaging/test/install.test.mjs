import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import test, { before } from 'node:test';
import { buildArtifact, command, packageName, runtimeFiles } from '../build.mjs';

const requireSDK = createRequire(new URL('../../adapters/mcp/package.json', import.meta.url));
const { Client } = await import(requireSDK.resolve('@modelcontextprotocol/client'));
const { StdioClientTransport } = await import(requireSDK.resolve('@modelcontextprotocol/client/stdio'));
const readJSON = (path) => JSON.parse(readFileSync(path, 'utf8'));
const hash = (path) => createHash('sha256').update(readFileSync(path)).digest('hex');
let artifact;
let installation;

function install(archive, directory = mkdtempSync(join(tmpdir(), 'cairn-installed-preview-'))) {
  if (!existsSync(join(directory, 'package.json'))) writeFileSync(join(directory, 'package.json'),
    JSON.stringify({ name: 'synthetic-local-install', private: true, version: '0.0.0' }), { flag: 'wx' });
  assert.equal(command('npm', ['prefix', '--prefix', directory], directory, archive.userconfig).trim(), directory);
  command('npm', ['install', '--prefix', directory, '--offline', '--ignore-scripts', '--no-audit', '--no-fund', archive.artifactPath],
    directory, archive.userconfig);
  return { directory, packagePath: join(directory, 'node_modules', packageName),
    executable: join(directory, 'node_modules', '.bin', 'cairn-memory') };
}

before(() => {
  artifact = buildArtifact();
  installation = install(artifact);
});

async function connect(t, installed, databasePath, { owner = 'synthetic-installed-owner', project } = {}) {
  const transport = new StdioClientTransport({ command: process.execPath,
    args: [installed.executable, '--db', databasePath, '--owner', owner, ...(project ? ['--project', project] : [])],
    cwd: installed.directory, env: { OPENAI_API_KEY: '', NODE_NO_WARNINGS: '1' }, stderr: 'pipe' });
  const client = new Client({ name: 'synthetic-installed-client', version: '1.0.0' });
  t.after(async () => { await client.close(); });
  await client.connect(transport);
  return client;
}

async function call(client, name, args = {}) {
  const response = await client.callTool({ name, arguments: args });
  assert.equal(response.content[0].type, 'text');
  const result = JSON.parse(response.content[0].text);
  assert.equal(Boolean(response.isError), !result.ok);
  assert.equal(result.evidenceTrust, 'untrusted-data-not-instructions');
  return result;
}
const ok = (result) => { assert.equal(result.ok, true, JSON.stringify(result)); return result.value; };

test('archive inspection and installed hashes prove the explicit single-source runtime allowlist', (t) => {
  assert.equal(hash(artifact.artifactPath), artifact.sha256);
  assert.match(artifact.sha256, /^[a-f0-9]{64}$/);
  assert.ok(artifact.bytes > 0);
  for (const path of artifact.files) {
    assert.equal(/(?:^|\/)(?:node_modules|test|testing|reports|\.env|\.npmrc)(?:\/|$)/.test(path), false, path);
    assert.equal(/\.(?:sqlite|db|tgz)$/.test(path), false, path);
  }
  for (const path of runtimeFiles) assert.ok(artifact.files.includes(path), path);
  for (const [path, expected] of Object.entries(artifact.sourceHashes)) {
    assert.equal(hash(join(installation.packagePath, path)), expected, path);
  }
  const manifest = readJSON(join(installation.packagePath, 'package.json'));
  assert.equal(manifest.private, true);
  assert.equal(manifest.version, artifact.version);
  assert.equal(manifest.engines.node, '>=22.16.0');
  assert.equal(manifest.scripts, undefined);
  assert.deepEqual(manifest.bin, { 'cairn-memory': 'bin/cairn-memory.mjs' });
  assert.ok(statSync(installation.executable).mode & 0o111);
  t.diagnostic(JSON.stringify({ artifactPath: artifact.artifactPath, sha256: artifact.sha256,
    installationPath: installation.directory, executable: installation.executable, runtime: process.version }));
});

test('production shrinkwrap installs only the exact reviewed closure with upstream notices', () => {
  const shrinkwrap = readJSON(join(installation.packagePath, 'npm-shrinkwrap.json'));
  const expected = { '@modelcontextprotocol/server': '2.0.0', '@modelcontextprotocol/core': '2.0.0',
    zod: '4.5.4', tiktoken: '1.0.22' };
  assert.deepEqual(Object.keys(shrinkwrap.packages).filter(Boolean).sort(),
    Object.keys(expected).map((name) => `node_modules/${name}`).sort());
  const resolveInstalled = createRequire(join(installation.packagePath, 'package.json'));
  for (const [name, version] of Object.entries(expected)) {
    const lock = shrinkwrap.packages[`node_modules/${name}`];
    assert.equal(lock.version, version);
    assert.match(lock.integrity, /^sha512-/);
    assert.equal(lock.hasInstallScript, undefined);
    let path = dirname(resolveInstalled.resolve(name));
    let manifest;
    for (let remaining = 8; remaining > 0; remaining--) {
      if (existsSync(join(path, 'package.json'))) {
        const candidate = readJSON(join(path, 'package.json'));
        if (candidate.name === name) { manifest = candidate; break; }
      }
      path = dirname(path);
    }
    assert.equal(manifest?.version, version, name);
    if (name === 'tiktoken') {
      const notice = readFileSync(join(installation.packagePath, 'licenses/tiktoken-LICENSE'), 'utf8');
      assert.match(notice, /MIT License/);
      assert.match(notice, /Copyright \(c\) 2022 OpenAI, Shantanu Jain/);
      assert.match(notice, /The above copyright notice and this permission notice shall be included/);
    } else assert.ok(readdirSync(path).some((file) => /^licen[sc]e(?:\.|$)/i.test(file)), name);
    for (const lifecycle of ['preinstall', 'install', 'postinstall']) assert.equal(manifest.scripts?.[lifecycle], undefined);
  }
});

test('installed executable completes actual SDK stdio lifecycle, restart and scoped revision rejection', { timeout: 30000 }, async (t) => {
  const path = join(mkdtempSync(join(tmpdir(), 'cairn-installed-data-')), 'memory.sqlite');
  const first = await connect(t, installation, path, { project: 'harbor' });
  assert.deepEqual((await first.listTools()).tools.map((tool) => tool.name).sort(),
    ['correct_memory', 'forget_memory', 'inspect_memory', 'recall_memory', 'remember_memory']);
  const content = 'Synthetic Harbor review happens Tuesday.';
  const saved = ok(await call(first, 'remember_memory', { content })).memory;
  assert.equal(ok(await call(first, 'inspect_memory', { memoryId: saved.id })).receipts[0].excerpt, content);
  assert.equal((await call(first, 'recall_memory', { query: 'When is the review?' })).error.code, 'model_not_configured');
  await first.close();
  const reopened = await connect(t, installation, path, { project: 'harbor' });
  assert.equal(ok(await call(reopened, 'inspect_memory', { memoryId: saved.id })).memory.content, content);
  const foreign = await connect(t, installation, path, { owner: 'synthetic-other-owner', project: 'harbor' });
  assert.deepEqual(ok(await call(foreign, 'inspect_memory')).memories, []);
  assert.equal((await call(foreign, 'correct_memory', {
    memoryId: saved.id, expectedRevision: saved.revision, content: 'Foreign replacement',
  })).error.code, 'memory_not_found');
  assert.equal(ok(await call(foreign, 'forget_memory', {
    memoryId: saved.id, expectedRevision: saved.revision,
  })).forgotten, false);
  await foreign.close();
  for (const extra of [{ namespace: {} }, { ownerId: 'foreign' }, { path: '/not-opened.sqlite' }, { readSet: [] }]) {
    const response = await reopened.callTool({ name: 'remember_memory', arguments: { content: 'Rejected', ...extra } });
    assert.equal(response.isError, true);
  }
  const changed = ok(await call(reopened, 'correct_memory', { memoryId: saved.id,
    expectedRevision: saved.revision, content: 'Synthetic Harbor review happens Friday.' })).memory;
  assert.ok(changed.revision > saved.revision);
  assert.equal((await call(reopened, 'forget_memory', {
    memoryId: saved.id, expectedRevision: saved.revision,
  })).error.code, 'revision_conflict');
  ok(await call(reopened, 'forget_memory', { memoryId: saved.id, expectedRevision: changed.revision }));
  assert.equal((await call(reopened, 'inspect_memory', { memoryId: saved.id })).error.code, 'memory_not_found');
  assert.deepEqual(ok(await call(reopened, 'inspect_memory')).memories, []);
});

test('same-schema version upgrade and local uninstall preserve the separately selected memory database', { timeout: 30000 }, async (t) => {
  const upgraded = install(artifact);
  const path = join(mkdtempSync(join(tmpdir(), 'cairn-upgrade-data-')), 'memory.sqlite');
  const first = await connect(t, upgraded, path);
  const content = 'Synthetic upgrade persistence marker.';
  const saved = ok(await call(first, 'remember_memory', { content })).memory;
  await first.close();
  const next = buildArtifact({ version: '0.0.0-preview.2' });
  install(next, upgraded.directory);
  assert.equal(readJSON(join(upgraded.packagePath, 'package.json')).version, '0.0.0-preview.2');
  const second = await connect(t, upgraded, path);
  const persisted = ok(await call(second, 'inspect_memory', { memoryId: saved.id })).memory;
  assert.equal(persisted.content, content);
  assert.equal(persisted.revision, saved.revision);
  await second.close();
  const beforeUninstall = hash(path);
  command('npm', ['uninstall', '--prefix', upgraded.directory, '--offline', '--ignore-scripts', '--no-audit', '--no-fund', packageName],
    upgraded.directory, artifact.userconfig);
  assert.equal(existsSync(upgraded.packagePath), false);
  assert.equal(hash(path), beforeUninstall);
  // Restore only this synthetic test install to verify retained data is reusable.
  install(next, upgraded.directory);
  const third = await connect(t, upgraded, path);
  assert.equal(ok(await call(third, 'inspect_memory', { memoryId: saved.id })).memory.content, content);
});

test('preview builder rejects release-like or path-shaped versions', () => {
  for (const version of ['1.0.0', '../elsewhere', '0.0.0-preview.0']) {
    assert.throws(() => buildArtifact({ version }), /invalid_preview_version/);
  }
});

test('an ancestor npm project is never modified by a fresh explicitly scoped child install', () => {
  const ancestor = mkdtempSync(join(tmpdir(), 'cairn-ancestor-regression-'));
  const manifestPath = join(ancestor, 'package.json');
  writeFileSync(manifestPath, JSON.stringify({ name: 'synthetic-ancestor-do-not-modify',
    version: '0.0.0', private: true, dependencies: {} }));
  const before = hash(manifestPath);
  const child = join(ancestor, 'child');
  mkdirSync(child);
  const installed = install(artifact, child);
  assert.equal(hash(manifestPath), before);
  assert.equal(existsSync(join(ancestor, 'package-lock.json')), false);
  assert.equal(existsSync(join(ancestor, 'node_modules')), false);
  assert.equal(readJSON(join(child, 'package.json')).name, 'synthetic-local-install');
  assert.ok(existsSync(installed.executable));
  assert.equal(hash(join(installed.packagePath, 'core/contract.mjs')), artifact.sourceHashes['core/contract.mjs']);
});

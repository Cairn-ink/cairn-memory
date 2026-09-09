import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, statSync, symlinkSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { command, packageName, runtimeFiles } from '../build.mjs';
import { installPreview } from '../install-preview.mjs';

const requireSDK = createRequire(new URL('../../adapters/mcp/package.json', import.meta.url));
const { Client } = await import(requireSDK.resolve('@modelcontextprotocol/client'));
const { StdioClientTransport } = await import(requireSDK.resolve('@modelcontextprotocol/client/stdio'));
const temporary = () => mkdtempSync(join(tmpdir(), 'cairn-preview-installer-test-'));
const readJSON = (path) => JSON.parse(readFileSync(path, 'utf8'));
const hash = (path) => createHash('sha256').update(readFileSync(path)).digest('hex');
const args = (directory) => ['--directory', directory, '--owner', 'synthetic-owner'];

test('installer rejects invalid arguments and unsafe targets before writing', () => {
  const parent = temporary();
  const target = join(parent, 'new');
  const existing = join(parent, 'existing');
  mkdirSync(existing);
  writeFileSync(join(parent, 'file'), 'retain');
  symlinkSync(existing, join(parent, 'link'));
  symlinkSync(join(parent, 'missing'), join(parent, 'dangling'));
  const before = readdirSync(parent);
  const invalid = [[], args('relative'), args('/'), args(parent), args(existing), args(join(parent, 'file')),
    args(join(parent, 'missing', 'new')), args(join(parent, 'link', 'new')), args(join(parent, 'dangling')),
    args(join(parent, 'dangling', 'new')), args(`${parent}/link/../new`), args(`${parent}/new\0`),
    ['--directory', target], [...args(target), '--owner', 'duplicate'], [...args(target), '--unknown', 'value'],
    [...args(target), '--project'], [...args(target), '--project', ' invalid'],
    ['--directory', target, '--owner', '\n'], [...args(target), '--project', 'x'.repeat(201)]];
  for (const input of invalid) assert.throws(() => installPreview(input, {
    runCommand: () => assert.fail('must not run install'),
  }), /cairn_preview_install_failed/);
  assert.deepEqual(readdirSync(parent), before);
  assert.equal(existsSync(target), false);
});

test('failed npm install retains partial state, hides child errors and writes no receipt', () => {
  const target = join(temporary(), 'new');
  assert.throws(() => installPreview(args(target), { runCommand(executable, arguments_, cwd) {
    assert.equal(executable, 'npm');
    assert.equal(arguments_[arguments_.indexOf('--prefix') + 1], join(target, 'app'));
    writeFileSync(join(cwd, 'partial-marker'), 'retained');
    throw new Error('synthetic-secret-must-not-leak');
  } }), (error) => {
    assert.match(error.message, /partial installation is retained/);
    assert.doesNotMatch(error.message, /synthetic-secret/);
    return true;
  });
  assert.equal(readFileSync(join(target, 'app', 'partial-marker'), 'utf8'), 'retained');
  assert.deepEqual(readdirSync(join(target, 'data')), []);
  assert.equal(existsSync(join(target, 'installation-receipt.json')), false);
  assert.throws(() => installPreview(args(target)), /cairn_preview_install_failed/);
});

test('failed installed configuration check retains app and omits receipt', () => {
  const target = join(temporary(), 'new');
  let calls = 0;
  assert.throws(() => installPreview(args(target), { runCommand(executable) {
    calls++;
    if (executable === 'npm') return '';
    return JSON.stringify({ ok: false, databaseOpened: false, providerContacted: false, modelKeyPresent: false });
  } }), /cairn_preview_install_failed/);
  assert.equal(calls, 2);
  assert.ok(existsSync(join(target, 'app', 'package.json')));
  assert.equal(existsSync(join(target, 'installation-receipt.json')), false);
});

test('fresh installation protects ancestor, proves source identity and supports SDK lifecycle/restart', { timeout: 120000 }, async (t) => {
  const parent = temporary();
  writeFileSync(join(parent, 'package.json'), JSON.stringify({ name: 'ancestor-must-not-change', private: true }));
  writeFileSync(join(parent, '.npmrc'), 'registry=https://invalid.example/\n');
  const ancestorHash = hash(join(parent, 'package.json'));
  const target = join(parent, 'new');
  const previousKey = process.env.OPENAI_API_KEY;
  process.env.OPENAI_API_KEY = 'synthetic-not-a-real-key';
  let report;
  try {
    report = installPreview([...args(target), '--project', 'synthetic-project'], {
      runCommand(executable, arguments_, cwd, userconfig) {
        if (executable === 'npm') {
          for (const flag of ['--ignore-scripts', '--no-audit', '--no-fund', '--registry=https://registry.npmjs.org/']) {
            assert.ok(arguments_.includes(flag));
          }
          return command(executable, [...arguments_, '--offline'], cwd, userconfig);
        }
        return command(executable, arguments_, cwd, userconfig);
      },
    });
  } finally {
    if (previousKey === undefined) delete process.env.OPENAI_API_KEY;
    else process.env.OPENAI_API_KEY = previousKey;
  }
  const receipt = readJSON(report.receiptPath);
  const { receiptPath, ...expected } = report;
  assert.deepEqual(receipt, expected);
  assert.equal(report.ownerId, 'synthetic-owner');
  assert.equal(report.projectId, 'synthetic-project');
  assert.equal(report.stdio.command, process.execPath);
  assert.equal(hash(report.artifact.path), report.artifact.sha256);
  for (const path of runtimeFiles) {
    assert.equal(hash(join(target, 'app', 'node_modules', packageName, path)), report.artifact.sourceHashes[path]);
    assert.equal(hash(new URL(`../../${path}`, import.meta.url)), report.artifact.sourceHashes[path]);
  }
  assert.equal(hash(join(parent, 'package.json')), ancestorHash);
  assert.equal(readFileSync(join(parent, '.npmrc'), 'utf8'), 'registry=https://invalid.example/\n');
  assert.equal(existsSync(join(parent, 'node_modules')), false);
  assert.equal(existsSync(join(parent, 'package-lock.json')), false);
  assert.deepEqual(readdirSync(join(target, 'data')), []);
  for (const path of [target, join(target, 'app'), join(target, 'data')]) assert.equal(statSync(path).mode & 0o777, 0o700);
  assert.equal(statSync(receiptPath).mode & 0o777, 0o600);
  assert.throws(() => installPreview(args(target)), /cairn_preview_install_failed/);

  async function connect() {
    const client = new Client({ name: 'synthetic-preview-installer', version: '1.0.0' });
    t.after(async () => { await client.close(); });
    await client.connect(new StdioClientTransport({ ...report.stdio, cwd: join(target, 'app'),
      env: { OPENAI_API_KEY: '', NODE_NO_WARNINGS: '1' }, stderr: 'pipe' }));
    return client;
  }
  async function call(client, name, arguments_ = {}) {
    const response = await client.callTool({ name, arguments: arguments_ });
    return JSON.parse(response.content[0].text);
  }
  const first = await connect();
  assert.equal((await first.listTools()).tools.length, 5);
  const saved = await call(first, 'remember_memory', { content: 'Synthetic installer restart marker.' });
  assert.equal(saved.ok, true);
  const memory = saved.value.memory;
  await first.close();
  const second = await connect();
  assert.equal((await call(second, 'inspect_memory', { memoryId: memory.id })).value.memory.content,
    'Synthetic installer restart marker.');
  assert.equal((await call(second, 'recall_memory', { query: 'Marker?' })).error.code, 'model_not_configured');
  const corrected = await call(second, 'correct_memory', { memoryId: memory.id,
    expectedRevision: memory.revision, content: 'Synthetic corrected marker.' });
  assert.equal(corrected.ok, true);
  assert.equal((await call(second, 'forget_memory', { memoryId: memory.id,
    expectedRevision: corrected.value.memory.revision })).ok, true);
  assert.deepEqual((await call(second, 'inspect_memory')).value.memories, []);
  t.diagnostic(JSON.stringify({ receiptPath, artifactSha256: report.artifact.sha256, runtime: process.version }));
});

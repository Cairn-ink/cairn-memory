import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { chmodSync, cpSync, mkdirSync, readFileSync, realpathSync, symlinkSync, unlinkSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { fileURLToPath, pathToFileURL } from 'node:url';
import test from 'node:test';
import { runDaemonCommand } from '../../adapters/mcp/local-daemon-liveness.mjs';
import { initLocalRawStore } from '../../integrations/client/raw/local-setup-init.mjs';
import { installerFixture, realDaemonEngine } from '../../packages/setup/test/daemon-installer-fixture.mjs';
import { readDescriptor, withLocalLock, writeDescriptor } from '../../packages/setup/lib/local-descriptor.mjs';
import { createTestWorkspace } from '../../tools/testing/workspace.mjs';
import { createLocalProvider } from '../core-local/local-provider.mjs';

const repo = fileURLToPath(new URL('../../', import.meta.url));
const syntheticKey = 'synthetic-provider-fixture';
const run = (entry, args, env, input, nodeArgs = []) => {
  const child = spawnSync(process.execPath, [...nodeArgs, entry, ...args], {
    cwd: env.HOME, env, input, encoding: 'utf8', timeout: 45_000, killSignal: 'SIGKILL',
  });
  assert.ifError(child.error);
  return { code: child.status, stdout: child.stdout, stderr: child.stderr };
};

test('configuration-check matches the legacy managed vector and never uses a provider or opens SQLite', t => {
  const { path } = createTestWorkspace(t);
  const environment = { HOME: path, TMPDIR: path, LANG: 'C.UTF-8' };
  const database = join(path, 'missing', 'database.sqlite');
  const args = ['--check-config', '--db', database, '--owner', 'synthetic', '--project', 'project'];
  const candidate = join(repo, 'packaging/core-local/cli.mjs');
  const legacy = join(repo, 'adapters/mcp/cli.mjs');
  for (const key of [undefined, '', syntheticKey, 'invalid\nsynthetic']) {
    const env = { ...environment, ...(key === undefined ? {} : { OPENAI_API_KEY: key }) };
    const expected = run(legacy, args, env);
    assert.deepEqual(run(candidate, args, env), expected);
    if (expected.code === 0) {
      const report = JSON.parse(expected.stdout);
      assert.equal(report.modelKeyPresent, key === syntheticKey);
      assert.equal(report.databaseOpened, false);
      assert.equal(report.providerContacted, false);
      assert.doesNotMatch(expected.stdout, new RegExp(syntheticKey));
    } else assert.equal(expected.code, 1);
  }
  assert.deepEqual(run(candidate, ['--check-config'], environment), run(legacy, ['--check-config'], environment));
});

test('the provider owns bounded transport and binds every send to its owner and authority', async () => {
  const calls = [];
  let authorized = true;
  const provider = createLocalProvider({
    key: syntheticKey, owner: 'synthetic', countTokens: text => Math.ceil(text.length / 4),
    authorize() { if (!authorized) throw new Error('synthetic_revocation'); },
    async request(url, options) {
      assert.equal(options.headers.Authorization, 'Bearer ' + syntheticKey);
      assert.equal(options.redirect, 'error');
      const payload = JSON.parse(options.body);
      calls.push({ url, payload });
      if (url.endsWith('/input_tokens')) return Response.json({ object: 'response.input_tokens', input_tokens: 20 });
      if (url.endsWith('/responses')) return Response.json({
        object: 'response', model: payload.model, status: 'completed',
        output: [{ type: 'message', role: 'assistant', content: [{ type: 'output_text', text: '{"items":[]}' }] }],
      });
      assert.match(url, /\/embeddings$/u);
      const vector = Array(1536).fill(0);
      vector[0] = 1;
      return Response.json({ object: 'list', model: payload.model, data: [{ index: 0, embedding: vector }] });
    },
  });
  const schema = { type: 'object', properties: { items: { type: 'array' } } };
  const input = { system: 'Synthetic instructions', input: { messages: [] }, schema,
    schemaName: 'synthetic_schema', maxOutputTokens: 32 };
  assert.deepEqual(await provider.model.call('extract', input), { items: [] });
  assert.equal(calls.length, 2);
  assert.deepEqual(calls[1].payload.text.format, { type: 'json_schema', name: input.schemaName, schema, strict: true });
  assert.equal(calls[1].payload.store, false);
  assert.equal((await provider.embedQuery.embedQuery('synthetic', 'synthetic query')).vector[0], 1);
  assert.equal(calls.length, 3);
  await assert.rejects(provider.embedQuery.embedQuery('other', 'synthetic query'), { code: 'authority_required' });
  authorized = false;
  await assert.rejects(provider.model.call('extract', input), /synthetic_revocation/u);
  assert.equal(calls.length, 3);
});

async function prepareFixture(t) {
  const fixture = await installerFixture(t);
  unlinkSync(fixture.database);
  assert.equal((await initLocalRawStore({ databasePath: fixture.database })).status, 'initialized');
  chmodSync(fixture.database, 0o600);
  await fixture.setEngine(realDaemonEngine());
  const descriptor = await readDescriptor(fixture.root);
  descriptor.installerVersion = '0.6.11';
  await withLocalLock(fixture.root, () => writeDescriptor(fixture.root, descriptor));
  const npm = realpathSync(join(dirname(process.execPath), 'npm'));
  writeFileSync(join(fixture.env.PATH, 'npm'), `#!${process.execPath}
require('node:child_process').execFileSync(process.execPath, [${JSON.stringify(npm)}, '--offline', ...process.argv.slice(2)],
  { stdio: 'inherit', env: process.env });
`, { mode: 0o700 });
  fixture.env.OPENAI_API_KEY = syntheticKey;
  return fixture;
}

test('the shipped Card gate keeps a configured upgrade on the legacy vector', { skip: process.platform !== 'linux' }, async t => {
  const fixture = await prepareFixture(t);
  const descriptor = join(fixture.root, 'installation.json'), native = join(fixture.home, '.claude.json');
  const original = [descriptor, native, fixture.database].map(path => readFileSync(path));
  for (const args of [['setup', '--local'], ['local-cutover', '--activate']]) {
    const result = fixture.run([...args, '--lang', 'en']);
    assert.equal(result.code, 2, result.stderr);
    assert.match(result.stdout, /Local cutover is unavailable for model-configured installations\. Legacy service remains active\./u);
    assert.deepEqual([descriptor, native, fixture.database].map(path => readFileSync(path)), original);
  }
});

async function buildWithCards(t) {
  const { path } = createTestWorkspace(t);
  for (const name of ['LICENSE', 'packaging', 'packages', 'core', 'adapters', 'integrations', 'plugins',
    'tools/testing/vendor/acorn/acorn.mjs']) {
    const destination = join(path, name);
    mkdirSync(dirname(destination), { recursive: true });
    cpSync(join(repo, name), destination, { recursive: true, filter: source => !source.includes('/node_modules') &&
      !source.includes('/test/') && !source.includes('/packages/setup/runtime/cutover') });
  }
  symlinkSync(join(repo, 'packages/adapter-sqlite/node_modules'), join(path, 'packages/adapter-sqlite/node_modules'));
  const root = join(path, 'packaging/core-local');
  const config = join(root, 'provider-config.mjs');
  const source = readFileSync(config, 'utf8');
  const gate = 'documentCardsReady = false';
  assert.equal(source.split(gate).length, 2);
  writeFileSync(config, source.replace(gate, 'documentCardsReady = true'));
  const { buildSetupCoreLocal } = await import(pathToFileURL(join(root, 'setup-runtime.mjs')));
  const setup = join(path, 'packages/setup');
  buildSetupCoreLocal(join(setup, 'runtime'), { check: false });
  return setup;
}

test('a test-only build with the single gate enabled activates and reaches the synthetic provider through the registered vector',
  { skip: process.platform !== 'linux', timeout: 120_000 }, async t => {
    const setup = await buildWithCards(t);
    const fixture = await prepareFixture(t);
    const invoke = args => run(join(setup, 'bin/memory.mjs'), [...args, '--lang', 'en'], fixture.env);
    const prepare = invoke(['setup', '--local']);
    assert.equal(prepare.code, 0, prepare.stdout + prepare.stderr);
    assert.match(prepare.stdout, /With OPENAI_API_KEY available to the Cairn MCP server/u);
    assert.match(prepare.stdout, /Local cutover verified/u);
    const confirm = invoke(['local-cutover', '--confirm']);
    assert.equal(confirm.code, 0, confirm.stdout + confirm.stderr);
    assert.match(confirm.stdout, /Local cutover active/u);
    const config = JSON.parse(readFileSync(join(fixture.home, '.claude.json'), 'utf8'));
    const [entry, ...vector] = config.mcpServers['cairn-local'].args;
    const target = vector[vector.indexOf('--db') + 1];
    assert.notEqual(target, fixture.database);
    const preload = join(fixture.home, 'synthetic-provider.mjs');
    writeFileSync(preload, `
import assert from 'node:assert/strict';

globalThis.fetch = async (url, options) => {
  assert.equal(process.argv[1], ${JSON.stringify(entry)});
  assert.equal(url, 'https://api.openai.com/v1/embeddings');
  assert.ok(process.env.OPENAI_API_KEY);
  assert.equal(options.headers.Authorization, 'Bearer ' + process.env.OPENAI_API_KEY);
  const payload = JSON.parse(options.body);
  const vector = Array(payload.dimensions).fill(0);
  vector[0] = 1;
  return Response.json({ object: 'list', model: payload.model,
    data: payload.input.map((_, index) => ({ index, embedding: vector })) });
};
`, { mode: 0o600 });
    const content = 'A synthetic agate protects the garden.';
    const request = JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call',
      params: { name: 'remember_memory', arguments: { content } } }) + '\n';
    try {
      const reply = run(entry, vector, fixture.env, request, ['--import', preload]);
      assert.equal(reply.code, 0, reply.stderr);
      assert.equal(JSON.parse(JSON.parse(reply.stdout).result.content[0].text).ok, true);
    } finally {
      assert.equal(await runDaemonCommand(['stop', '--db', target], { write() {} }), 0);
    }
    const db = new DatabaseSync(target, { readOnly: true });
    try {
      const { body } = db.prepare('SELECT body FROM cairn_memories').get();
      assert.equal(JSON.parse(body).embedding.model, 'text-embedding-3-small');
      assert.equal(JSON.parse(body).embedding.vector[0], 1);
    } finally { db.close(); }
  });

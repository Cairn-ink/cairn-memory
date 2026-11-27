import assert from 'node:assert/strict';
import { cpSync, mkdirSync, readFileSync, symlinkSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import test from 'node:test';
import { createTestWorkspace } from '../../../tools/testing/workspace.mjs';
import { claude, confirm, credentialPattern, keyedRefusal, launch, legacyFixture, linux, operator, prepare,
  providerFixture, readJSON, setup, tool } from './local-cutover-fix-support.mjs';

const env = { OPENAI_API_KEY: providerFixture, CAIRN_CONTEXT_SEMANTIC_OPENAI_API_KEY: providerFixture };
const warning = /An OpenAI key is set[.].*keyless/u;
const consentPath = f => join(f.root, '.cutover-' + readJSON(join(f.root, 'installation.json')).migration.cutover.id,
  'provider-consent.json');

function observer(f) {
  const trace = join(f.parent, 'provider-observations.jsonl');
  const preload = join(f.parent, 'provider-observer.mjs');
  writeFileSync(trace, '');
  writeFileSync(preload, `
import { appendFileSync } from 'node:fs';
import cp from 'node:child_process';
import { syncBuiltinESMExports } from 'node:module';
import { fileURLToPath } from 'node:url';

const record = row => appendFileSync(${JSON.stringify(trace)}, JSON.stringify(row) + '\\n');
const preload = fileURLToPath(import.meta.url);
process.execArgv.splice(process.execArgv.indexOf(preload) - 1, 2);
const spawn = cp.spawn;
cp.spawn = (program, args, options) => spawn(program,
  args[0]?.endsWith('/daemon-worker.mjs') ? ['--import', preload, ...args] : args, options);
syncBuiltinESMExports();
process.env = new Proxy(process.env, { get(target, key) {
  if (typeof key === 'string' && ${credentialPattern}.test(key)) record({ read: key });
  return Reflect.get(target, key);
} });
globalThis.fetch = async (url, options) => {
  record({ fetch: true });
  if (url !== 'https://api.openai.com/v1/embeddings' ||
      options.headers.Authorization !== 'Bearer ' + ${JSON.stringify(providerFixture)}) throw Error('unexpected fixture request');
  const payload = JSON.parse(options.body);
  const vector = Array(payload.dimensions).fill(0);
  vector[0] = 1;
  return Response.json({ object: 'list', model: payload.model,
    data: payload.input.map((_, index) => ({ index, embedding: vector })) });
};
`, { mode: 0o600 });
  return { preload, read: () => readFileSync(trace, 'utf8').trim().split('\n').filter(Boolean).map(JSON.parse) };
}

function serve(f, probe, input) {
  const { command: node, args: [entry, ...vector] } = claude(f);
  const reply = launch(f, entry, vector, { preload: probe.preload, env, input, node });
  assert.equal(reply.status, 0, reply.stderr);
  return reply.stdout.trim().split('\n').map(line => JSON.parse(JSON.parse(line).result.content[0].text));
}

async function cardsEnabledInstaller(t) {
  const repo = fileURLToPath(new URL('../../../', import.meta.url));
  const scratch = createTestWorkspace(t).path;
  for (const name of ['LICENSE', 'packaging', 'packages', 'core', 'adapters', 'integrations', 'plugins',
    'tools/testing/vendor/acorn/acorn.mjs']) {
    const destination = join(scratch, name);
    mkdirSync(dirname(destination), { recursive: true });
    cpSync(join(repo, name), destination, { recursive: true, filter: path => !path.includes('/node_modules') &&
      !path.includes('/test/') && !path.includes('/packages/setup/runtime/cutover') });
  }
  symlinkSync(join(repo, 'packages/adapter-sqlite/node_modules'), join(scratch, 'packages/adapter-sqlite/node_modules'));
  const config = join(scratch, 'packaging/core-local/provider-config.mjs');
  const original = readFileSync(config, 'utf8');
  const gate = 'documentCardsReady = false';
  assert.equal(original.split(gate).length, 2);
  writeFileSync(config, original.replace(gate, 'documentCardsReady = true'));
  const { buildSetupCoreLocal } = await import(pathToFileURL(join(dirname(config), 'setup-runtime.mjs')));
  const root = join(scratch, 'packages/setup');
  buildSetupCoreLocal(join(root, 'runtime'), { check: false });
  return join(root, 'bin/memory.mjs');
}

test('a stray key leaves active MCP keyless and setup refuses consent while Cards are gated', linux, async t => {
  const f = await legacyFixture(t);
  operator(f, prepare);
  const verified = operator(f, setup, { env, code: 2 });
  assert.ok(verified.includes(keyedRefusal));
  assert.equal(verified.split('\n').filter(line => warning.test(line)).length, 1);
  operator(f, confirm, { env });
  assert.throws(() => readFileSync(consentPath(f)), { code: 'ENOENT' });
  const probe = observer(f);
  const phrase = 'A synthetic malachite stores rainwater.';
  const [saved, found] = serve(f, probe, tool('remember_memory', { content: phrase }, 1) +
    tool('read_memory_context', { query: 'malachite', types: ['memory'], intent: 'current' }, 2));
  assert.equal(saved.ok, true);
  assert.ok(JSON.stringify(found.value.items).includes(phrase));
  assert.deepEqual(probe.read(), []);
  const active = claude(f);
  for (const [args, code] of [[['status'], 0], [setup, 2]]) {
    const output = operator(f, args, { env, code });
    assert.equal(output.split('\n').filter(line => warning.test(line) && /later release/u.test(line)).length, 1);
    if (code === 2) assert.ok(output.includes(keyedRefusal));
    assert.deepEqual(claude(f), active);
  }
});

test('with the Card gate enabled, a cutover stays keyless until explicit local setup records consent', linux, async t => {
  const f = await legacyFixture(t);
  const entry = await cardsEnabledInstaller(t);
  operator(f, prepare, { entry, env });
  operator(f, confirm, { entry, env });
  const probe = observer(f);
  assert.equal(serve(f, probe, tool('remember_memory', { content: 'Synthetic keyless jasper.' }))[0].ok, true);
  assert.deepEqual(probe.read(), []);
  const status = operator(f, ['status'], { entry, env });
  assert.equal(status.split('\n').filter(line => warning.test(line) && /Run setup/u.test(line)).length, 1);
  operator(f, setup, { entry, env });
  assert.equal(serve(f, probe, tool('remember_memory', { content: 'Synthetic consented jasper.' }))[0].ok, true);
  assert.equal(probe.read().filter(row => row.fetch).length, 1);
  assert.ok(probe.read().some(row => row.read === 'OPENAI_API_KEY'));
  assert.doesNotMatch(operator(f, ['status'], { entry, env }), warning);
  const { ownerId, projectId } = readJSON(join(f.root, 'installation.json'));
  assert.deepEqual(readJSON(consentPath(f)), { version: 1, owner: ownerId, project: projectId, profile: 'openai-baseline-v1' });
});

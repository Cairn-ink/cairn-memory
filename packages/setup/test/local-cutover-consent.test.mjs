import assert from 'node:assert/strict';
import { readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import { claude, confirm, credentialPattern, launch, legacyFixture, linux, operator, prepare,
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

test('a stray key keeps MCP keyless until explicit local setup records consent', linux, async t => {
  const f = await legacyFixture(t);
  assert.match(operator(f, prepare, { env }), /Local cutover verified/u);
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
  for (const args of [['status'], [...setup, '--dry-run'], setup]) {
    const output = operator(f, args, { env });
    assert.equal(output.split('\n').filter(line => warning.test(line) && /Run setup --local/u.test(line)).length, 1);
    if (args === setup) {
      const repaired = claude(f);
      assert.deepEqual(repaired.args, active.args);
      assert.equal(repaired.command, realpathSync(active.command));
    } else {
      assert.deepEqual(claude(f), active);
      assert.throws(() => readFileSync(consentPath(f)), { code: 'ENOENT' });
    }
  }
  const { ownerId, projectId } = readJSON(join(f.root, 'installation.json'));
  assert.deepEqual(readJSON(consentPath(f)), { version: 1, owner: ownerId, project: projectId, profile: 'openai-baseline-v1' });
  assert.equal(serve(f, probe, tool('remember_memory', { content: 'Synthetic consented jasper.' }))[0].ok, true);
  assert.equal(probe.read().filter(row => row.fetch).length, 1);
  assert.ok(probe.read().some(row => row.read === 'OPENAI_API_KEY'));
  assert.doesNotMatch(operator(f, ['status'], { env }), warning);
});

test('explicit setup records consent on an already verified cutover', linux, async t => {
  const f = await legacyFixture(t);
  operator(f, prepare);
  const legacy = claude(f);
  const verified = operator(f, setup, { env });
  assert.match(verified, /Local cutover verified/u);
  assert.equal(verified.split('\n').filter(line => warning.test(line) && /Run setup --local/u.test(line)).length, 1);
  assert.deepEqual(claude(f), legacy);
  const { ownerId, projectId } = readJSON(join(f.root, 'installation.json'));
  assert.deepEqual(readJSON(consentPath(f)), { version: 1, owner: ownerId, project: projectId, profile: 'openai-baseline-v1' });
  operator(f, confirm);
  assert.notDeepEqual(claude(f), legacy);
});

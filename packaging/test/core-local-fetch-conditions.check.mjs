import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { appendFileSync, existsSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { dirname, join } from 'node:path';
import test from 'node:test';
import { createLocalProvider } from '../core-local/local-provider.mjs';
import { localModelKey, localProviderProfile } from '../core-local/provider-config.mjs';
import { golden } from './fixtures/local-host-wire-replay.mjs';

const read = path => JSON.parse(readFileSync(path, 'utf8'));
const lines = text => text.trim().split('\n').filter(Boolean).map(JSON.parse);
const keyName = 'OPENAI_API_KEY';
const alias = 'CAIRN_SYNTHETIC_API_KEY';

test('the setup provider profile fixes the origin, rejects redirects, and reads its credential for each POST', async t => {
  assert.equal(localProviderProfile.providerApiKeyEnv, keyName);
  const env = { [alias]: 'unused-fixture', OPENAI_BASE_URL: 'https://unconsented.invalid' };
  const first = randomUUID(), second = randomUUID(), third = randomUUID();
  const seen = [];
  let redirect = false;
  t.mock.method(globalThis, 'fetch', async (url, { body, headers, method, redirect: redirects }) => {
    assert.equal(method, 'POST');
    assert.equal(redirects, 'error');
    const payload = JSON.parse(body);
    seen.push({ url, headers });
    if (redirect) return new Response(null, { status: 302, headers: { location: 'https://unconsented.invalid' } });
    if (url.endsWith('/input_tokens')) {
      env[keyName] = second;
      return Response.json({ object: 'response.input_tokens', input_tokens: 1 });
    }
    if (url.endsWith('/responses')) return Response.json({ object: 'response', model: payload.model, status: 'completed',
      output: [{ type: 'message', role: 'assistant', content: [{ type: 'output_text', text: '{"items":[]}' }] }] });
    const vector = Array(payload.dimensions).fill(0);
    vector[0] = 1;
    return Response.json({ object: 'list', model: payload.model, data: [{ index: 0, embedding: vector }] });
  });
  const provider = createLocalProvider({ owner: 'synthetic', countTokens: () => 1, request: globalThis.fetch,
    readKey: () => localModelKey(env), authorize() {} });
  const input = { system: 'Synthetic instructions', input: {}, maxOutputTokens: 32 };
  await assert.rejects(provider.model.call('extract', input), { code: 'provider_error' });
  assert.equal(seen.length, 0);
  env[keyName] = first;
  assert.deepEqual(await provider.model.call('extract', input), { items: [] });
  env[keyName] = third;
  assert.equal((await provider.embedQuery.embedQuery('synthetic', 'synthetic query')).vector[0], 1);
  redirect = true;
  await assert.rejects(provider.model.call('extract', input), { code: 'provider_error' });
  assert.deepEqual(seen.map(call => call.url), [
    'https://api.openai.com/v1/responses/input_tokens', 'https://api.openai.com/v1/responses',
    'https://api.openai.com/v1/embeddings', 'https://api.openai.com/v1/responses/input_tokens',
  ]);
  assert.deepEqual(seen.map(call => call.headers.Authorization), [first, second, third, third].map(key => 'Bearer ' + key));
});

function observer(f) {
  const preload = join(f.parent, 'fetch-observer.mjs');
  const trace = join(f.parent, 'fetch-observations.jsonl');
  writeFileSync(preload, `
import child from 'node:child_process';
import threads from 'node:worker_threads';
import { appendFileSync } from 'node:fs';
import { registerHooks, syncBuiltinESMExports } from 'node:module';
import { realpathSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const preload = fileURLToPath(import.meta.url);
const entry = process.argv[1];
const keyName = ${JSON.stringify(keyName)}, alias = ${JSON.stringify(alias)};
const firstKey = process.env[keyName];
const record = event => appendFileSync(${JSON.stringify(trace)}, JSON.stringify(event) + '\\n');
const mcpEntry = entry?.endsWith('/core-local/cli.mjs') && process.argv[2] === '--db';
const worker = entry?.endsWith('/core-local/daemon-worker.mjs');
if (worker) record({ operation: 'worker' });
const downgraded = process.env.CAIRN_FIXTURE_CARDS === '0';
if (downgraded) registerHooks({ load(url, context, next) {
  const result = next(url, context);
  if (!url.endsWith('/packaging/core-local/provider-config.mjs')) return result;
  const source = result.source.toString().replace('documentCardsReady = true', 'documentCardsReady = false');
  return { ...result, source };
} });

let sends = 0;
globalThis.fetch = async (url, options) => {
  if (!mcpEntry || downgraded || !firstKey) {
    record({ operation: 'unexpected-fetch' });
    throw new Error('unexpected fixture fetch');
  }
  const expected = sends === 0 ? firstKey : firstKey + '.rotated';
  if (url !== 'https://api.openai.com/v1/embeddings' || options.redirect !== 'error' ||
      options.headers.Authorization !== 'Bearer ' + expected) {
    record({ operation: 'unexpected-provider-target-or-key' });
    throw new Error('unexpected fixture request');
  }
  sends++;
  record({ operation: 'send', url, ordinal: sends });
  if (sends === 1) process.env[keyName] = firstKey + '.rotated';
  else {
    delete process.env[keyName];
    throw new Error(expected);
  }
  const payload = JSON.parse(options.body);
  const vector = Array(payload.dimensions).fill(0);
  vector[0] = 1;
  return Response.json({ object: 'list', model: payload.model,
    data: payload.input.map((_, index) => ({ index, embedding: vector })) });
};

// Make the test preload out-of-band for the installed daemon's execArgv
// attestation, and propagate it explicitly to nested Node entry points.
process.execArgv.splice(process.execArgv.indexOf(preload) - 1, 2);
for (const name of ['spawn', 'spawnSync']) {
  const original = child[name];
  child[name] = (command, args, options) => {
    const environment = options?.env ?? process.env;
    const commandLine = [command, ...args];
    if (Object.hasOwn(environment, keyName) || Object.hasOwn(environment, alias) ||
        firstKey && commandLine.some(part => part.includes(firstKey))) {
      record({ operation: 'child-credential' });
      throw new Error('credential in child inputs');
    }
    if (mcpEntry && !downgraded && firstKey) record({ operation: 'keyed-child' });
    if (command.startsWith('/') && realpathSync(command) === process.execPath) args = ['--import', preload, ...args];
    return original(command, args, options);
  };
}
const Worker = threads.Worker;
threads.Worker = class extends Worker {
  constructor(...args) {
    record({ operation: 'thread' });
    throw new Error('unexpected fixture thread');
  }
};
syncBuiltinESMExports();
`, { mode: 0o600 });
  return { preload, observations: () => existsSync(trace) ? lines(readFileSync(trace, 'utf8')) : [] };
}

function command(f, probe, entry, args, { env = {}, input, code = 0, node = process.execPath } = {}) {
  const child = spawnSync(node, ['--import', probe.preload, entry, ...args], {
    cwd: f.parent, env: { ...f.environment, ...env }, input, encoding: 'utf8', timeout: 60_000, killSignal: 'SIGKILL',
  });
  assert.ifError(child.error);
  assert.equal(child.signal, null);
  for (const name of [keyName, alias]) if (env[name]) {
    assert.equal((child.stdout + child.stderr).includes(env[name]), false, 'fixture credential in command output');
  }
  assert.equal(child.status, code, child.stdout + child.stderr);
  return child;
}

const registration = f => read(join(f.home, '.claude.json')).mcpServers['cairn-local'];
const descriptor = f => read(join(f.root, 'installation.json'));
function rpc(method, params, id = 1) {
  return JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n';
}
const tool = (name, args, id) => rpc('tools/call', { name, arguments: args }, id);
const value = reply => JSON.parse(reply.result.content[0].text);

function capture(f, probe, entry) {
  const { cutover } = descriptor(f).migration;
  const journal = read(join(f.root, '.cutover-' + cutover.id, 'capture-claude.json'));
  const installation = join(f.root, 'capture', 'claude', 'core-' + journal.generation);
  const session = randomUUID();
  const transcript = join(f.home, '.claude/projects', session + '.jsonl');
  const hook = event => command(f, probe, join(dirname(entry), 'capture-cli.mjs'),
    ['hook', '--installation', installation, '--event', event], {
      input: JSON.stringify({ hook_event_name: event, session_id: session, transcript_path: transcript }),
    });
  writeFileSync(transcript, '', { mode: 0o600 });
  assert.equal(hook('SessionStart').stdout, '');
  writeFileSync(transcript, JSON.stringify({ type: 'user', uuid: 'synthetic-turn',
    timestamp: new Date(Date.now() - 60 * 60 * 1000).toISOString(), promptSource: 'typed',
    message: { content: [{ type: 'text', text: 'Synthetic lapis Raw turn.' }] } }) + '\n');
  assert.equal(hook('Stop').stdout, '');
}

function assertCredentialAbsent(directory, key) {
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    assert.equal(entry.name.includes(key), false);
    const path = join(directory, entry.name);
    if (entry.isDirectory()) assertCredentialAbsent(path, key);
    else if (entry.isFile()) assert.equal(readFileSync(path).includes(key), false, 'fixture credential on disk');
  }
}

test('installed local cutover keeps keyed fetch in process and gives keyless operations zero fetches',
  { skip: process.platform !== 'linux', timeout: 180_000 }, async t => {
    const { withUpgradeInstallers } = await import('../../tools/testing/local-cutover-upgrade.qualification.mjs');
    await withUpgradeInstallers(async ({ baseline, candidate, testClients }) => {
      const setup = ['setup', '--local'];
      const start = f => f.run(baseline, [...setup, '--owner', 'synthetic']);
      const operator = (f, probe, args, options) => command(f, probe, join(candidate, 'bin/memory.mjs'),
        [...args, '--lang', 'en'], options).stdout;
      const mcp = (f, probe, input, options) => {
        const { command: node, args: [entry, ...vector] } = registration(f);
        return command(f, probe, entry, vector, { node, input, ...options });
      };

      await t.test('keyless serving, forget, capture, Raw list/delete, repair and detach', () => {
        const f = testClients('fetch-keyless'), probe = observer(f);
        start(f);
        operator(f, probe, setup);
        operator(f, probe, ['local-cutover', '--confirm']);
        const [entry, , database] = registration(f).args;
        try {
          const content = 'Synthetic forgettable tourmaline.';
          const messages = lines(mcp(f, probe, rpc('initialize', golden.exchanges.initialize.params) +
            rpc('ping', {}, 2) + tool('remember_memory', { content }, 3) +
            tool('read_memory_context', { query: 'tourmaline', types: ['memory'], intent: 'current' }, 4)).stdout);
          assert.deepEqual(messages[1].result, {});
          const { memory } = value(messages[2]).value;
          assert.ok(JSON.stringify(value(messages[3]).value.items).includes(content));
          const [forgotten] = lines(mcp(f, probe, tool('forget_memory', { memoryId: memory.id, expectedRevision: 1 })).stdout);
          assert.equal(value(forgotten).value.forgotten, true);
          capture(f, probe, entry);
          const rawList = ['raw', 'list', '--client', 'claude'];
          const [conversation] = lines(operator(f, probe, rawList));
          assert.equal(conversation.messageCount, 1);
          const [deleted] = lines(operator(f, probe, ['raw', 'delete', conversation.id, '--yes']));
          assert.equal(deleted.ok, true);
          assert.equal(operator(f, probe, rawList), '');
          const inode = statSync(database, { bigint: true }).ino;
          appendFileSync(entry, '\n// Synthetic repair fixture.\n');
          operator(f, probe, setup);
          assert.notEqual(registration(f).args[0], entry);
          assert.equal(statSync(database, { bigint: true }).ino, inode);
          operator(f, probe, ['uninstall', '--local', '--yes']);
          assert.equal(registration(f), undefined);
          assert.equal(descriptor(f).state, 'uninstalled');
          const observations = probe.observations();
          assert.ok(observations.some(row => row.operation === 'worker'));
          assert.deepEqual(observations.filter(row => row.operation !== 'worker'), []);
        } finally {
          if (descriptor(f).state === 'installed') operator(f, probe, ['daemon', 'stop', '--local']);
        }
      });

      await t.test('shipped keyed consent and a gated-build refusal at the registered MCP entry', () => {
        const f = testClients('fetch-keyed'), probe = observer(f);
        const key = randomUUID(), aliasKey = randomUUID();
        start(f);
        const legacy = registration(f);
        const env = { [keyName]: key, [alias]: aliasKey };
        const keyed = { ...env, OPENAI_BASE_URL: 'https://unconsented.invalid' };
        const downgraded = { ...env, CAIRN_FIXTURE_CARDS: '0' };
        const refusal = /Local cutover is unavailable for model-configured installations/u;
        assert.match(operator(f, probe, setup, { env: downgraded, code: 2 }), refusal);
        assert.match(operator(f, probe, ['local-cutover', '--activate'], { env }), /Local cutover verified/u);
        assert.deepEqual(registration(f), legacy);
        assert.ok(operator(f, probe, setup, { env: keyed }).replace(/\s+/gu, ' ').includes(
          'The upgraded local engine sends memory text to OpenAI for embeddings when saving, correcting or importing memories. ' +
          'Semantic recall sends the recall query for embeddings. These requests require recorded consent ' +
          'and an OpenAI key in the Cairn MCP server’s environment.'));
        assert.match(operator(f, probe, ['local-cutover', '--activate'], { env: downgraded, code: 2 }), refusal);
        assert.match(operator(f, probe, ['local-cutover', '--confirm'], { env: downgraded, code: 2 }), refusal);
        operator(f, probe, ['local-cutover', '--confirm']);
        assert.notEqual(registration(f).args[0], legacy.args[0]);
        const refused = mcp(f, probe, rpc('ping', {}), { env: downgraded, code: 1 });
        assert.equal(refused.stdout, '');
        assert.equal(refused.stderr, 'daemon_configuration\n');
        const requests = ['agate', 'basalt', 'cuprite'].map((name, index) =>
          tool('remember_memory', { content: `A synthetic ${name} fixture.` }, index + 1)).join('');
        const active = mcp(f, probe, requests, { env: keyed });
        const replies = lines(active.stdout);
        assert.equal(replies.length, 3);
        assert.equal(value(replies[0]).ok, true);
        assert.deepEqual(probe.observations(), [1, 2].map(ordinal => ({ operation: 'send',
          url: 'https://api.openai.com/v1/embeddings', ordinal })));
        for (const token of [key, aliasKey]) assertCredentialAbsent(f.parent, token);
      });
    });
  });

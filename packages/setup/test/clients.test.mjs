import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, writeFile, mkdir, lstat, unlink } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createTestWorkspace } from '../../../tools/testing/workspace.mjs';
import { fakeAuthServer, secret } from './fake-auth-server.mjs';
import { wireChild } from './http-wire.mjs';
import { readInstallation } from '../runtime/integrations/codex/installed-state.mjs';
import { clientProjectId, opaqueProjectId } from '../runtime/integrations/client/pairing.mjs';

async function fixture(t, { claude = true, codex = true, qualified = true, auth = {}, legacyKey = false } = {}) {
  const ws = createTestWorkspace(t, { prefix: 'both-clients-' });
  const home = join(ws.path, 'home'), bin = join(ws.path, 'bin');
  await mkdir(home, { mode: 0o700 }); await mkdir(bin);
  const codexHome = join(home, '.codex');
  const profileRoot = join(home, '.claude/plugins/data/cairn-memory-cairn-memory');
  let originalId;
  if (legacyKey) {
    await mkdir(profileRoot, { recursive: true, mode: 0o700 });
    originalId = await opaqueProjectId(profileRoot, '/synthetic/project', { home });
  }
  const claudeState = join(ws.path, 'claude.json'), codexState = join(ws.path, 'codex.json');
  const claudeCalls = join(ws.path, 'claude.jsonl'), codexCalls = join(ws.path, 'codex.jsonl');
  await writeFile(claudeState, '{}'); await writeFile(claudeCalls, ''); await writeFile(codexCalls, '');
  await writeFile(codexState, JSON.stringify({ version: '0.160.1',
    formatEvidence: fileURLToPath(new URL('../../../integrations/codex/test/fixtures/', import.meta.url)) }));
  async function addClaude() {
    await writeFile(join(bin, 'claude'), `#!${process.execPath}\nprocess.env.FAKE_STATE=${JSON.stringify(claudeState)};process.env.FAKE_CALLS=${JSON.stringify(claudeCalls)};\n` +
      await readFile(new URL('./fake-claude.mjs', import.meta.url), 'utf8'), { mode: 0o755 });
  }
  async function addCodex() {
    const evidence = JSON.parse(await readFile(new URL('../../../integrations/codex/test/fixtures/binary-0.160.1/format.json', import.meta.url)));
    const embedded = qualified ? '\n/*\n' + Object.values(evidence.hooks).map(value => JSON.stringify(value, null, 2)).join('\n') + '\n' + evidence.serdeMarkers.join('\n') + '\n*/\n' : '';
    await writeFile(join(bin, 'codex'), `#!${process.execPath}\nprocess.env.FAKE_STATE=${JSON.stringify(codexState)};process.env.FAKE_CALLS=${JSON.stringify(codexCalls)};\n` +
      await readFile(new URL('./fake-codex.mjs', import.meta.url), 'utf8') + embedded, { mode: 0o755 });
  }
  if (claude) await addClaude(); if (codex) await addCodex();
  const server = await fakeAuthServer(t, auth);
  const harness = join(ws.path, 'harness.mjs');
  await writeFile(harness, `import{writeSync}from'node:fs';import{main}from${JSON.stringify(new URL('../lib/setup.mjs', import.meta.url).href)};
    import{requestJSON}from${JSON.stringify(new URL('../lib/transport.mjs', import.meta.url).href)};
    import{installChildWire}from${JSON.stringify(new URL('./http-wire.mjs', import.meta.url).href)};
    const disconnect=installChildWire();let clock=0;const choices=JSON.parse(process.env.TEST_CHOICES);
    process.exitCode=await main(process.argv.slice(2),{interactive:process.env.TEST_TTY==='true',
      prompt:async(q,o)=>{writeSync(1, JSON.stringify({prompt:q,secret:Boolean(o?.secret)})+'\\n');
        if(q.startsWith('Connect Claude')||q.startsWith('連接 Claude'))return choices.claude??'';
        if(q.startsWith('Connect format')||q.startsWith('Exit Claude')||q.startsWith('連接格式')||q.startsWith('先退出'))return choices.codex??'yes';
        if(q.includes('request cap'))return '100';
        if(q.includes('Press Enter'))return '';
        if(q.includes('OAuth'))return '';
        if(q.includes('Confirm Cairn endpoint'))return ${JSON.stringify(server.endpoint)};
        throw new Error('unexpected prompt');},browse:async()=>{writeSync(1, 'browser opened\\n');},
      authOptions:{now:()=>clock,sleep:async ms=>{clock+=ms;},request:(url,options)=>requestJSON(url,{...options,env:{}}),copy:async()=>false,progress:()=>()=>{}}});disconnect();`);
  const installation = join(codexHome, 'cairn/installation.json');
  const lines = async path => (await readFile(path, 'utf8')).trim().split('\n').filter(Boolean).map(JSON.parse);
  async function run({ args = ['setup'], choices = {}, interactive = true } = {}) {
    const child = spawn(process.execPath, [harness, ...args], { cwd: ws.path,
      env: { HOME: home, CODEX_HOME: codexHome, PATH: bin, LANG: 'en_US.UTF-8', TMPDIR: process.env.TMPDIR,
        TEST_CHOICES: JSON.stringify(choices), TEST_TTY: String(interactive) }, stdio: ['ignore', 'pipe', 'pipe', 'ipc'] });
    wireChild(child, server.server);
    let stdout = '', stderr = '';
    child.stdout.on('data', data => { stdout += data; }); child.stderr.on('data', data => { stderr += data; });
    const timer = setTimeout(() => child.kill('SIGKILL'), 30000);
    const code = await new Promise((resolve, reject) => { child.on('error', reject); child.on('close', resolve); });
    clearTimeout(timer);
    for (const text of [stdout, stderr, await readFile(claudeCalls, 'utf8'), await readFile(codexCalls, 'utf8')]) assert.ok(!text.includes(secret));
    return { code, stdout, stderr, prompts: stdout.split('\n').filter(line => line.startsWith('{"prompt":')).map(JSON.parse) };
  }
  return { home, bin, codexHome, installation, profileRoot, originalId, server, run, addClaude, addCodex,
    claudeState: () => readFile(claudeState, 'utf8').then(JSON.parse),
    calls: async () => ({ claude: await lines(claudeCalls), codex: await lines(codexCalls) }) };
}

async function assertPaired(f) {
  const installed = await readInstallation(f.installation), native = await f.claudeState();
  assert.equal(installed.usesClaude, true); assert.equal(installed.pairingRecord, native.pairingRecord);
  const codex = { client: 'codex', home: f.home, root: installed.root, usesClaude: true, pairingRecord: installed.pairingRecord, env: { HOME: f.home } };
  const claude = { client: 'claude', home: f.home, pairingRecord: native.pairingRecord, env: { HOME: f.home, CLAUDE_PLUGIN_DATA: f.profileRoot } };
  const id = await clientProjectId(codex, '/synthetic/project');
  assert.equal(await clientProjectId(claude, '/synthetic/project'), id);
  if (f.originalId) assert.equal(id, f.originalId);
  return installed;
}

for (const legacyKey of [false, true]) test(`one setup connects both, one browser/grant, same key (existing Claude key: ${legacyKey})`, async t => {
  const f = await fixture(t, { legacyKey }); const result = await f.run();
  assert.equal(result.code, 0, result.stdout); await assertPaired(f);
  assert.equal(f.server.requests.filter(r => r.route === 'device-authorizations').length, 1);
  assert.equal(f.server.requests.filter(r => r.route === 'ack').length, 1);
  assert.equal(result.stdout.split('browser opened').length - 1, 1, result.stdout);
  assert.equal(result.prompts.filter(p => /Connect Claude|Exit Claude/.test(p.prompt)).length, 2);
  assert.equal(result.prompts.filter(p => /Confirm both clients share/.test(p.prompt)).length, 0);
  const credential = join(f.home, '.cairn-memory-clients/setup-credential.json');
  assert.equal((await lstat(credential)).mode & 0o777, 0o600);
  const again = await f.run(); assert.equal(again.code, 0, again.stdout); await assertPaired(f);
  assert.equal(f.server.requests.filter(r => r.route === 'device-authorizations').length, 1);
  const status = await f.run({ args: ['status'], interactive: false });
  assert.equal(status.code, 0, status.stdout); assert.match(status.stdout, /Client: claude/); assert.match(status.stdout, /Client: codex/);
});
for (const client of ['claude', 'codex']) test(`only ${client} detected`, async t => {
  const f = await fixture(t, { claude: client === 'claude', codex: client === 'codex' });
  const result = await f.run(); assert.equal(result.code, 0, result.stdout);
  assert.equal(f.server.requests.filter(r => r.route === 'device-authorizations').length, 1);
  if (client === 'codex') assert.equal((await readInstallation(f.installation)).usesClaude, false);
  else assert.equal((await f.claudeState()).configured, true);
  const status = await f.run({ args: ['status'] }); assert.equal(status.code, 0, status.stdout);
  assert.match(status.stdout, new RegExp(`${client === 'claude' ? 'codex' : 'claude'} is not on PATH`));
});
test('neither detected: clear message, no auth or writes', async t => {
  const f = await fixture(t, { claude: false, codex: false }); const result = await f.run();
  assert.equal(result.code, 0, result.stdout); assert.match(result.stdout, /Neither Claude Code nor Codex/);
  assert.equal(f.server.requests.length, 0); assert.deepEqual(await f.calls(), { claude: [], codex: [] });
});
for (const declined of ['claude', 'codex', 'both']) test(`decline ${declined}: only agreed tools configured`, async t => {
  const f = await fixture(t); const result = await f.run({ choices: { claude: declined !== 'codex' ? 'no' : 'yes', codex: declined !== 'claude' ? 'no' : 'yes' } });
  assert.equal(result.code, 0, result.stdout);
  assert.equal(Boolean((await f.claudeState()).installed), declined === 'codex');
  if (declined === 'claude') assert.equal((await readInstallation(f.installation)).usesClaude, false);
  else await assert.rejects(readFile(f.installation), { code: 'ENOENT' });
  if (declined === 'both') assert.equal(f.server.requests.length, 0);
});
for (const options of [{}, { claude: true, codex: false }, { claude: false, codex: true }]) test('non-TTY never consents '+JSON.stringify(options), async t => {
  const f = await fixture(t, options); const result = await f.run({ interactive: false });
  assert.equal(result.code, 2, result.stdout); assert.equal(result.prompts.length, 0);
  assert.equal(f.server.requests.length, 0); assert.deepEqual(await f.calls(), { claude: [], codex: [] });
  const dry = await f.run({ args: ['setup', '--dry-run'], interactive: false }); assert.equal(dry.code, 0, dry.stdout);
  assert.equal(dry.prompts.length, 0); assert.equal(f.server.requests.length, 0);
  await assert.rejects(readFile(f.installation), { code: 'ENOENT' });
});
for (const first of ['claude', 'codex']) test(`rerun adds other tool after ${first}, preserving key without new authorization`, async t => {
  const f = await fixture(t, { claude: first === 'claude', codex: first === 'codex' });
  const initial = await f.run(); assert.equal(initial.code, 0, initial.stdout);
  let originalKey;
  if (first === 'codex') originalKey = await readFile(join((await readInstallation(f.installation)).root, 'project-key'));
  else {
    await mkdir(f.profileRoot, { recursive: true, mode: 0o700 });
    f.originalId = await opaqueProjectId(f.profileRoot, '/synthetic/project', { home: f.home });
    originalKey = await readFile(join(f.profileRoot, 'project-key'));
  }
  await (first === 'claude' ? f.addCodex() : f.addClaude());
  const result = await f.run(); assert.equal(result.code, 0, result.stdout);
  const installed = await assertPaired(f); assert.deepEqual(await readFile(join(installed.root, 'project-key')), originalKey);
  assert.equal(f.server.requests.filter(r => r.route === 'device-authorizations').length, 1);
});
test('unqualified Codex is skipped while Claude completes', async t => {
  const f = await fixture(t, { qualified: false }); const result = await f.run();
  assert.equal(result.code, 0, result.stdout); assert.match(result.stdout, /Skipping Codex/);
  assert.equal((await f.claudeState()).configured, true);
  await assert.rejects(readFile(f.installation), { code: 'ENOENT' });
  assert.equal(result.prompts.some(p => /Codex/.test(p.prompt)), false);
});
for (const client of ['claude', 'codex']) test(`explicit --client ${client} restricts writes`, async t => {
  const f = await fixture(t); const result = await f.run({ args: ['setup', '--client', client, '--endpoint', f.server.endpoint, '--no-browser'] });
  assert.equal(result.code, 0, result.stdout);
  if (client === 'claude') assert.equal((await f.calls()).codex.length, 0);
  else assert.equal((await f.claudeState()).installed, undefined);
});


test('rerun can reuse the pre-0.4 Codex hook credential without an installer cache', async t => {
  const f = await fixture(t, { claude: false });
  const initial = await f.run({ args: ['setup', '--client', 'codex', '--endpoint', f.server.endpoint, '--no-browser'] });
  assert.equal(initial.code, 0, initial.stdout);
  const before = await readInstallation(f.installation), key = await readFile(join(before.root, 'project-key'));
  await assert.rejects(readFile(join(f.home, '.cairn-memory-clients/setup-credential.json')), { code: 'ENOENT' });
  await f.addClaude();
  const result = await f.run(); assert.equal(result.code, 0, result.stdout);
  const paired = await assertPaired(f); assert.deepEqual(await readFile(join(paired.root, 'project-key')), key);
  assert.equal(f.server.requests.filter(r => r.route === 'device-authorizations').length, 1);
});

test('a stored credential API failure stops without silently creating another grant', async t => {
  const auth = {}, f = await fixture(t, { auth });
  const initial = await f.run(); assert.equal(initial.code, 0, initial.stdout);
  auth.credentialStatus = 503;
  const result = await f.run(); assert.equal(result.code, 1, result.stdout);
  assert.equal(f.server.requests.filter(r => r.route === 'device-authorizations').length, 1);
  assert.match(result.stdout, /service unavailable/);
});

test('unqualified Codex alone exits cleanly without authorizing an MCP fallback', async t => {
  const f = await fixture(t, { claude: false, qualified: false }); const result = await f.run();
  assert.equal(result.code, 0, result.stdout); assert.match(result.stdout, /Skipping Codex/);
  assert.equal(result.prompts.length, 0); assert.equal(f.server.requests.length, 0);
  await assert.rejects(readFile(f.installation), { code: 'ENOENT' });
});

test('Chinese default setup has one consent per tool and preserves its locale', async t => {
  const f = await fixture(t);
  // Declining all avoids relying on translated cap/endpoint answers in this fixture.
  const result = await f.run({ args: ['setup', '--lang', 'zh'], choices: { claude: 'no', codex: 'no' } });
  assert.equal(result.code, 0, result.stdout);
  assert.match(result.stdout, /工具：claude/); assert.match(result.stdout, /工具：codex/);
  assert.doesNotMatch(result.stdout, /Client:/);
});

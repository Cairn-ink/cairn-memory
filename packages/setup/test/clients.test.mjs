import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, writeFile, mkdir, readdir, chmod } from 'node:fs/promises';
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
  await writeFile(harness, `import{writeSync}from'node:fs';import{main}from${JSON.stringify(process.env.CAIRN_SETUP_TEST_MODULE || new URL('../lib/setup.mjs', import.meta.url).href)};
    import{SetupError}from${JSON.stringify(new URL('../lib/errors.mjs', import.meta.url).href)};
    import{requestJSON}from${JSON.stringify(new URL('../lib/transport.mjs', import.meta.url).href)};
    import{installChildWire}from${JSON.stringify(new URL('./http-wire.mjs', import.meta.url).href)};
    const disconnect=installChildWire();let clock=0;const choices=JSON.parse(process.env.TEST_CHOICES);
    process.exitCode=await main(process.argv.slice(2),{interactive:process.env.TEST_TTY==='true',
      ...(choices.inspectionError ? {inspectCodex:async()=>{throw new SetupError(choices.inspectionError,1,{client:'codex',args:'mcp get cairn --json',code:7});}} : {}),
      ...(choices.windows ? {inspectCodex:async()=>({qualified:false,reason:'codex_windows'})} : {}),
      prompt:async(q,o)=>{writeSync(1, JSON.stringify({prompt:q,secret:Boolean(o?.secret)})+'\\n');
        if(q.startsWith('Connect Claude')||q.startsWith('連接 Claude'))return choices.claude??'';
        if(q.startsWith('Connect format')||q.startsWith('Exit Claude')||q.startsWith('連接格式')||q.startsWith('先退出')||q.startsWith('Connect Codex MCP'))return choices.codex??'yes';
        if(q.includes('Confirm both clients share'))return 'yes';
        if(o?.secret)return ${JSON.stringify(secret)};
        if(q.includes('request cap'))return '100';
        if(q.includes('Press Enter')||q.includes('按 Enter'))return '';
        if(q.includes('OAuth'))return '';
        if(q.includes('確認 Cairn endpoint')||q.includes('Confirm Cairn endpoint'))return ${JSON.stringify(server.endpoint)};
        throw new Error('unexpected prompt');},browse:async()=>{writeSync(1, 'browser opened\\n');},
      authOptions:{now:()=>clock,sleep:async ms=>{clock+=ms;},request:(url,options)=>requestJSON(url,{...options,env:{}}),copy:async()=>false,progress:()=>()=>{}}});disconnect();`);
  const installation = join(codexHome, 'cairn/installation.json');
  const lines = async path => (await readFile(path, 'utf8')).trim().split('\n').filter(Boolean).map(JSON.parse);
  async function run({ args = ['setup'], choices = {}, interactive = true, tmpdir } = {}) {
    const child = spawn(process.execPath, [harness, ...args], { cwd: ws.path,
      env: { HOME: home, CODEX_HOME: codexHome, PATH: bin, LANG: 'en_US.UTF-8', TMPDIR: tmpdir ?? process.env.TMPDIR,
        TEST_CHOICES: JSON.stringify(choices), TEST_TTY: String(interactive) }, stdio: ['ignore', 'pipe', 'pipe', 'ipc'] });
    wireChild(child, server.server);
    let stdout = '', stderr = '';
    child.stdout.on('data', data => { stdout += data; }); child.stderr.on('data', data => { stderr += data; });
    const timer = setTimeout(() => child.kill('SIGKILL'), 30000);
    const code = await new Promise((resolve, reject) => { child.on('error', reject); child.on('close', resolve); });
    clearTimeout(timer);
    for (const text of [stdout, stderr, await readFile(claudeCalls, 'utf8'), await readFile(codexCalls, 'utf8')]) assert.ok(!text.includes(secret));
    const nativeStores = new Set([ join(codexHome, 'cairn/credential.json'), join(codexHome, 'config.toml')]);
    const audit = async directory => {
      for (const entry of await readdir(directory, { withFileTypes: true })) {
        const path = join(directory, entry.name);
        if (entry.isDirectory()) await audit(path);
        else if (entry.isFile() && !nativeStores.has(path)) assert.ok(!(await readFile(path, 'utf8')).includes(secret), `extra plaintext credential: ${path}`);
      }
    };
    await audit(home);
    return { code, stdout, stderr, prompts: stdout.split('\n').filter(line => line.startsWith('{"prompt":')).map(JSON.parse) };
  }
  return { home, bin, codexHome, installation, profileRoot, originalId, server, run, addClaude, addCodex, scratch: ws.path,
    setClaudeState: value => writeFile(claudeState, JSON.stringify(value)),
    setCodexState: async value => writeFile(codexState, JSON.stringify({ ...JSON.parse(await readFile(codexState, 'utf8')), ...value })),
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
  assert.deepEqual(result.prompts.filter(p => /Connect|Confirm both clients share|Exit Claude/.test(p.prompt)).map(p => p.prompt.split('?')[0]), [
    'Connect Claude Code', 'Exit Claude/Codex and capture workers first. Confirm they are stopped and connect Codex with the shared identity',
  ]);
  const credential = join(f.home, '.cairn-memory-clients/setup-credential.json');
  await assert.rejects(readFile(credential), { code: 'ENOENT' });
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
for (const first of ['claude', 'codex']) test(`rerun adds other tool after ${first}, preserving key with ${first === 'claude' ? 'one new approval' : 'no new approval'}`, async t => {
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
  assert.equal(f.server.requests.filter(r => r.route === 'device-authorizations').length, first === 'claude' ? 2 : 1);
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

test('a stored credential API failure stops adding the other tool without a new grant', async t => {
  const auth = {}, f = await fixture(t, { auth, claude: false });
  const initial = await f.run(); assert.equal(initial.code, 0, initial.stdout);
  await f.addClaude();
  auth.credentialStatus = 503;
  const result = await f.run(); assert.equal(result.code, 1, result.stdout);
  assert.equal(f.server.requests.filter(r => r.route === 'device-authorizations').length, 1);
  assert.match(result.stdout, /service unavailable/);
});

test('unqualified Codex alone keeps the MCP fallback without a device grant', async t => {
  const f = await fixture(t, { claude: false, qualified: false }); const result = await f.run();
  assert.equal(result.code, 0, result.stdout); assert.match(result.stdout, /Only explicit MCP memory tools/);
  assert.equal(result.prompts.filter(p => p.prompt.startsWith('Connect Codex MCP')).length, 1);
  assert.equal(f.server.requests.length, 0);
  assert.match(await readFile(join(f.codexHome, 'config.toml'), 'utf8'), /Authorization = "Bearer /);
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

// Review repros must stay unscoped: an explicit --client would hide the bug.
test('R1: Claude-only rerun keeps its credential and endpoint with no new grant', async t => {
  const f = await fixture(t, { codex: false });
  const first = await f.run({ args: ['setup', '--client', 'claude', '--endpoint', f.server.endpoint] });
  assert.equal(first.code, 0, first.stdout);
  const before = await f.claudeState(), callsBefore = (await f.calls()).claude.length;
  const again = await f.run();
  assert.equal(f.server.requests.filter(r => r.route === 'device-authorizations').length, 1, 'R1 must not start a second grant');
  assert.equal(again.code, 0, again.stdout);
  assert.match(again.stdout, /Keeping existing credential/);
  assert.equal(again.prompts.some(p => /Confirm Cairn endpoint/.test(p.prompt)), false);
  assert.equal((await f.claudeState()).endpoint, before.endpoint);
  assert.equal(f.server.requests.filter(r => r.route === 'device-authorizations').length, 1);
  assert.equal((await f.calls()).claude.slice(callsBefore).filter(c => c.keys.includes('api_token')).length, 0);
});
test('R3: conflicting kept endpoints refuse without replacing either credential', async t => {
  const f = await fixture(t, { claude: false });
  const first = await f.run({ args: ['setup', '--client', 'codex', '--endpoint', f.server.endpoint] });
  assert.equal(first.code, 0, first.stdout);
  const originalCredential = await readFile(join(f.codexHome, 'cairn/credential.json'));
  await f.addClaude();
  await f.setClaudeState({ installed: true, marketplace: true, configured: true, endpoint: 'https://old.example' });
  const before = (await f.calls()).claude.length;
  const again = await f.run(); assert.equal(again.code, 2, again.stdout);
  assert.match(again.stdout, /--reauthorize/);
  assert.equal((await f.claudeState()).endpoint, 'https://old.example');
  assert.deepEqual(await readFile(join(f.codexHome, 'cairn/credential.json')), originalCredential);
  assert.equal((await f.calls()).claude.slice(before).filter(c => c.keys.includes('api_token')).length, 0);
  assert.equal(f.server.requests.filter(r => r.route === 'device-authorizations').length, 1);
});
test('kept endpoint: unscoped --endpoint requires --reauthorize with exit 2', async t => {
  const f = await fixture(t, { codex: false });
  assert.equal((await f.run({ args: ['setup', '--client', 'claude', '--endpoint', f.server.endpoint] })).code, 0);
  for (const endpoint of [f.server.endpoint, 'https://new.example']) {
    const again = await f.run({ args: ['setup', '--endpoint', endpoint] });
    assert.equal(again.code, 2, again.stdout);
    assert.match(again.stdout, /also pass --reauthorize/);
  }
  assert.equal(f.server.requests.filter(r => r.route === 'device-authorizations').length, 1);
});

for (const key of ['codex_managed', 'codex_tmpdir', 'codex_state_error', 'command_failed', 'codex_endpoint_conflict']) {
  for (const lang of ['en', 'zh']) test(`Codex inspection ${key} (${lang}) skips independently and Claude completes`, async t => {
    const f = await fixture(t);
    const result = await f.run({ args: ['setup', '--lang', lang], choices: { inspectionError: key } });
    assert.equal(result.code, 0, result.stdout);
    assert.match(result.stdout, lang === 'en' ? /Codex skipped:/ : /略過 Codex：/);
    assert.match(result.stdout, /setup --client codex/);
    if (lang === 'zh') assert.match(result.stdout, /略過 Codex：[^\n]+。修正此問題後/);
    assert.equal((await f.claudeState()).configured, true);
    await assert.rejects(readFile(f.installation), { code: 'ENOENT' });
  });
}
test('Windows has a specific localized Codex skip while Claude continues', async t => {
  const f = await fixture(t);
  const result = await f.run({ choices: { windows: true } });
  assert.equal(result.code, 0, result.stdout);
  assert.match(result.stdout, /Codex skipped: Windows credential-file permissions/);
  assert.match(result.stdout, /setup --client codex for the manual MCP fallback/);
  assert.doesNotMatch(result.stdout, /Resolve this issue/);
  assert.equal((await f.claudeState()).configured, true);
});
test('Codex-only rerun keeps native credential bytes and starts no new grant', async t => {
  const f = await fixture(t, { claude: false });
  assert.equal((await f.run()).code, 0);
  const file = join(f.codexHome, 'cairn/credential.json'), before = await readFile(file);
  const result = await f.run(); assert.equal(result.code, 0, result.stdout);
  assert.match(result.stdout, /Keeping existing credential/);
  assert.deepEqual(await readFile(file), before);
  assert.equal(f.server.requests.filter(r => r.route === 'device-authorizations').length, 1);
  for (const scoped of [false, true]) for (const endpoint of [f.server.endpoint, 'https://new.example']) {
    const args = ['setup', '--endpoint', endpoint, ...(scoped ? ['--client', 'codex'] : [])];
    const refused = await f.run({ args });
    assert.equal(refused.code, 2, refused.stdout);
    assert.match(refused.stdout, /also pass --reauthorize/);
  }
});
test('both existing credentials are retained without native token writes on rerun', async t => {
  const f = await fixture(t); assert.equal((await f.run()).code, 0);
  const before = (await f.calls()).claude.length;
  const codexPath = join(f.codexHome, 'cairn/credential.json');
  const claude = await f.claudeState(), codex = await readFile(codexPath);
  const result = await f.run(); assert.equal(result.code, 0, result.stdout);
  assert.equal(result.stdout.split('Keeping existing credential').length - 1, 2);
  assert.equal((await f.calls()).claude.slice(before).filter(c => c.keys.includes('api_token')).length, 0);
  const after = await f.claudeState();
  for (const key of ['endpoint', 'configured', 'tokenReceived', 'pairingRecord']) {
    assert.equal(after[key], claude[key], `Claude ${key} must be kept`);
  }
  assert.deepEqual(await readFile(codexPath), codex);
  assert.equal(f.server.requests.filter(r => r.route === 'device-authorizations').length, 1);
});
test('explicit Codex retains usesClaude:true refusal for compatible keyless Claude', async t => {
  const f = await fixture(t);
  await f.setClaudeState({ installed: true, configured: true, endpoint: f.server.endpoint, marketplace: true });
  const result = await f.run({ args: ['setup', '--client', 'codex', '--endpoint', f.server.endpoint] });
  assert.equal(result.code, 1, result.stdout);
  await assert.rejects(readFile(f.installation), { code: 'ENOENT' });
});
test('explicit --reauthorize across both tools issues exactly one replacement grant', async t => {
  const f = await fixture(t); assert.equal((await f.run()).code, 0);
  const result = await f.run({ args: ['setup', '--reauthorize', '--endpoint', f.server.endpoint] });
  assert.equal(result.code, 0, result.stdout); await assertPaired(f);
  assert.equal(f.server.requests.filter(r => r.route === 'device-authorizations').length, 2);
});

for (const failure of ['native command', 'native JSON', 'unsafe config', 'project TMPDIR', 'MCP endpoint conflict']) test(`actual Codex inspection failure (${failure}) still installs Claude`, async t => {
  const f = await fixture(t);
  let tmpdir, args = ['setup'];
  if (failure === 'native command') await f.setCodexState({ fail: '--version', token: secret });
  if (failure === 'native JSON') await f.setCodexState({ badJSON: true, token: secret });
  if (failure === 'unsafe config' || failure === 'MCP endpoint conflict') {
    await mkdir(f.codexHome, { mode: 0o700 });
    await writeFile(join(f.codexHome, 'config.toml'), '[mcp_servers.cairn]\nurl = "https://old.example/api/mcp"\n', { mode: failure === 'unsafe config' ? 0o666 : 0o600 });
    if (failure === 'unsafe config') await chmod(join(f.codexHome, 'config.toml'), 0o666);
    if (failure === 'MCP endpoint conflict') args = ['setup', '--endpoint', f.server.endpoint];
  }
  if (failure === 'project TMPDIR') {
    tmpdir = join(f.scratch, 'project-tmp'); await mkdir(join(tmpdir, '.codex'), { recursive: true });
    await writeFile(join(tmpdir, '.codex/config.toml'), 'model = "synthetic-project"\n');
  }
  const result = await f.run({ args, tmpdir }); assert.equal(result.code, 0, result.stdout);
  assert.match(result.stdout, /Codex skipped:/); assert.match(result.stdout, /setup --client codex/);
  assert.equal((await f.claudeState()).configured, true);
  await assert.rejects(readFile(f.installation), { code: 'ENOENT' });
});
test('no extra credential cache exists before or after Codex uninstall', async t => {
  const f = await fixture(t); assert.equal((await f.run()).code, 0);
  const cache = join(f.home, '.cairn-memory-clients/setup-credential.json');
  await assert.rejects(readFile(cache), { code: 'ENOENT' });
  const result = await f.run({ args: ['uninstall', '--client', 'codex'] });
  assert.equal(result.code, 0, result.stdout);
  await assert.rejects(readFile(cache), { code: 'ENOENT' });
  await assert.rejects(readFile(join(f.codexHome, 'cairn/credential.json')), { code: 'ENOENT' });
});

test('existing Codex MCP endpoint is shared without a prior hook credential', async t => {
  const f = await fixture(t);
  await mkdir(f.codexHome, { mode: 0o700 });
  await writeFile(join(f.codexHome, 'config.toml'), `[mcp_servers.cairn]\nurl = "${f.server.endpoint}/api/mcp"\n`, { mode: 0o600 });
  const result = await f.run(); assert.equal(result.code, 0, result.stdout); await assertPaired(f);
  assert.equal(result.prompts.some(p => /Confirm Cairn endpoint/.test(p.prompt)), false);
  assert.equal((await f.claudeState()).endpoint, f.server.endpoint);
  assert.equal(f.server.requests.filter(r => r.route === 'device-authorizations').length, 1);
});

test('declining kept Codex allows a new Claude endpoint without replacing Codex', async t => {
  const f = await fixture(t, { claude: false }); assert.equal((await f.run()).code, 0);
  const path = join(f.codexHome, 'cairn/credential.json'), before = await readFile(path);
  await f.addClaude();
  const result = await f.run({ args: ['setup', '--endpoint', f.server.endpoint], choices: { codex: 'no' } });
  assert.equal(result.code, 0, result.stdout); assert.equal((await f.claudeState()).configured, true);
  assert.deepEqual(await readFile(path), before);
});

for (const omitEndpoint of [false, true]) test(`round 3: Claude first needs one approved new grant for Codex (endpoint omitted: ${omitEndpoint})`, async t => {
  const f = await fixture(t, { codex: false }); assert.equal((await f.run()).code, 0);
  const old = await f.claudeState(); await f.setClaudeState({ ...old, omitEndpoint });
  const before = (await f.calls()).claude.length;
  await f.addCodex();
  const result = await f.run(); assert.equal(result.code, 0, result.stdout);
  assert.equal(f.server.requests.filter(r => r.route === 'device-authorizations').length, 2);
  assert.equal(result.stdout.split('browser opened').length - 1, 1);
  assert.equal((await f.calls()).claude.slice(before).filter(c => c.keys.includes('api_token')).length, 0);
  assert.equal((await f.claudeState()).endpoint, old.endpoint);
  assert.match(result.stdout, /Claude first.*one new browser approval/);
  await assertPaired(f);
});
test('round 3: missing Claude endpoint metadata alone never blocks Codex-first reuse', async t => {
  const f = await fixture(t, { claude: false }); assert.equal((await f.run()).code, 0);
  await f.addClaude(); await f.setClaudeState({ omitEndpoint: true });
  const result = await f.run(); assert.equal(result.code, 0, result.stdout); await assertPaired(f);
  assert.equal(f.server.requests.filter(r => r.route === 'device-authorizations').length, 1);
});
test('round 3: already configured tools rerun without Claude endpoint metadata or a new grant', async t => {
  const f = await fixture(t); assert.equal((await f.run()).code, 0);
  await f.setClaudeState({ ...await f.claudeState(), omitEndpoint: true });
  const result = await f.run(); assert.equal(result.code, 0, result.stdout); await assertPaired(f);
  assert.match(result.stdout, /Keeping existing credential/);
  assert.equal(f.server.requests.filter(r => r.route === 'device-authorizations').length, 1);
});
for (const lang of ['en', 'zh']) test(`round 3: --reauthorize reports replacement, never kept (${lang})`, async t => {
  const f = await fixture(t); assert.equal((await f.run()).code, 0);
  const result = await f.run({ args: ['setup', '--reauthorize', '--endpoint', f.server.endpoint, '--lang', lang] });
  assert.equal(result.code, 0, result.stdout); await assertPaired(f);
  assert.equal(f.server.requests.filter(r => r.route === 'device-authorizations').length, 2);
  assert.match(result.stdout, lang === 'en' ? /Replacement credential delivered/ : /已交付換發憑證/);
  assert.doesNotMatch(result.stdout, /Keeping existing credential|credentials and endpoints were kept|保留既有憑證|已保留憑證與 endpoint/);
});
test('round 3: reauthorization defaults to the known Codex endpoint before delivering Claude', async t => {
  const f = await fixture(t, { claude: false }); assert.equal((await f.run()).code, 0);
  await f.addClaude();
  const result = await f.run({ args: ['setup', '--reauthorize'] }); assert.equal(result.code, 0, result.stdout);
  assert.equal(result.prompts.some(p => /Confirm Cairn endpoint/.test(p.prompt)), false);
  assert.match(result.stdout, /Replacement credential delivered/);
  assert.doesNotMatch(result.stdout, /credentials and endpoints were kept|Keeping existing credential/);
  await assertPaired(f);
});
for (const scoped of [false, true]) test(`round 3: dry-run endpoint override previews kept Codex, scoped ${scoped}`, async t => {
  const f = await fixture(t, { claude: false }); assert.equal((await f.run()).code, 0);
  const config = await readFile(join(f.codexHome, 'config.toml'));
  const credential = await readFile(join(f.codexHome, 'cairn/credential.json'));
  for (const endpoint of [f.server.endpoint, 'https://preview.example']) {
    const result = await f.run({ args: ['setup', '--dry-run', '--endpoint', endpoint, ...(scoped ? ['--client', 'codex'] : [])], interactive: false });
    assert.equal(result.code, 0, result.stdout); assert.equal(result.prompts.length, 0);
    assert.match(result.stdout, /Dry run:/);
    assert.deepEqual(await readFile(join(f.codexHome, 'config.toml')), config);
    assert.deepEqual(await readFile(join(f.codexHome, 'cairn/credential.json')), credential);
  }
  assert.equal(f.server.requests.filter(r => r.route === 'device-authorizations').length, 1);
});

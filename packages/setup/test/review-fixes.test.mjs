import test from 'node:test';
import assert from 'node:assert/strict';
import { access, readFile, writeFile, mkdir, readdir } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { join } from 'node:path';
import { fixture, assertPaired } from './clients.test.mjs';
import { translator, messages } from '../lib/messages.mjs';
import { sharedAuthorization } from '../lib/authorization.mjs';
import { terminalWriter, columns } from '../lib/output.mjs';
import { readInstallation } from '../runtime/integrations/codex/installed-state.mjs';
import { privateWrite } from '../runtime/integrations/client/private-state.mjs';
import { opaqueProjectId } from '../runtime/integrations/client/pairing.mjs';

const commandShells = ['/bin/bash'];
try {
  await access('/usr/bin/zsh');
  commandShells.push('/usr/bin/zsh');
} catch (error) {
  if (error.code !== 'ENOENT') throw error;
}

async function childResult(command, args, options = {}) {
  const child = spawn(command, args, { ...options, stdio: ['ignore', 'pipe', 'pipe'] });
  let stdout = '', stderr = '';
  child.stdout.on('data', data => { stdout += data; });
  child.stderr.on('data', data => { stderr += data; });
  const code = await new Promise((resolve, reject) => {
    child.once('error', reject);
    child.once('close', resolve);
  });
  return { code, stdout, stderr };
}

async function conflict(f, { auth = false } = {}) {
  await f.setClaudeState({ ...await f.claudeState(), endpoint: 'https://claude.example' });
  const installed = await readInstallation(f.installation);
  await privateWrite(f.installation, JSON.stringify({ ...installed, endpoint: 'https://codex.example' }));
  const path = join(f.codexHome, 'cairn/credential.json');
  const credential = JSON.parse(await readFile(path, 'utf8'));
  await privateWrite(path, JSON.stringify({ ...credential, endpoint: 'https://codex.example' }));
  await writeFile(join(f.codexHome, 'config.toml'), '[mcp_servers.cairn]\nurl = "https://codex.example/api/mcp"\n' +
    (auth ? 'bearer_token_env_var = "SYNTHETIC_TEST_TOKEN"\n' : ''), { mode: 0o600 });
}

for (const lang of ['zh', 'en']) {
  const endpoints = ['https://cairn.ink', 'https://' + 'a'.repeat(180) + '.example',
    'http://[::1]:3030', "https://x'$(printf)`printf`.example",
    ...Array.from({ length: 8 }, (_, n) => 'https://' + 'a'.repeat(62 + n) + '$(printf)' + 'b'.repeat(180) + '.example')];
  for (const endpoint of endpoints) {
    test(`endpoint recovery commands remain shell-copyable (${lang}, ${endpoint.length})`, async () => {
      const lines = [];
      terminalWriter(line => lines.push(line))(translator(lang)('endpoint_remove_retry', { endpoint }));
      assert.ok(lines.every(line => columns(line) <= 80));
      const start = lines.findIndex(line => line.startsWith('npx '));
      assert.ok(start >= 0);
      const command = lines.slice(start).join('\n');
      for (const shell of commandShells) {
        const result = await childResult(shell, ['-fc', 'npx() { printf "%s\\n" "$@"; };\n' + command]);
        assert.equal(result.code, 0, result.stderr);
        assert.deepEqual(result.stdout.trim().split('\n'),
          ['@cairn-ink/memory', 'setup', '--endpoint', endpoint, '--reauthorize']);
      }
    });
  }
  for (const action of ['uninstall', 'disable', 'prompt-recall-off', 'prompt-recall-on']) {
    test(`Claude-only ${action} reports no action and a real control (${lang})`, async t => {
      const f = await fixture(t, { codex: false });
      assert.equal((await f.run()).code, 0);
      const before = await f.claudeState();
      for (const flags of [[], ['--client', 'claude']]) {
        const result = await f.run({ args: [action, ...flags, '--lang', lang] });
        assert.equal(result.code, 2, result.stdout);
        assert.deepEqual(await f.claudeState(), before);
        assert.doesNotMatch(result.stdout, /\/cairn-memory:(?:uninstall|disable|prompt-recall)/u);
        if (['uninstall', 'disable'].includes(action)) {
          assert.match(result.stdout, new RegExp(`claude plugin ${action} cairn-memory@cairn-memory`));
        } else assert.match(result.stdout, /\/cairn-memory:pause/u);
      }
    });
  }
  test(`status/help expose recall kill switch; disabled status omits hint (${lang})`, async t => {
    const f = await fixture(t);
    assert.equal((await f.run()).code, 0);
    for (const action of ['status', '--help']) {
      const result = await f.run({ args: [action, '--lang', lang] });
      assert.match(result.stdout, /npx @cairn-ink\/memory prompt-recall-off --client codex/u);
    }
    assert.equal((await f.run({ args: ['prompt-recall-off', '--client', 'codex'] })).code, 0);
    assert.doesNotMatch((await f.run({ args: ['status', '--lang', lang] })).stdout, /prompt-recall-off --client codex/u);
  });
  test(`declining installed, unconnected Claude explains user choice and migration (${lang})`, async t => {
    const f = await fixture(t, { legacyKey: true });
    await f.setClaudeState({ installed: true, marketplace: true });
    const key = await readFile(join(f.profileRoot, 'project-key'));
    const result = await f.run({ args: ['setup', '--lang', lang], choices: { claude: 'no' } });
    assert.equal(result.code, 0, result.stdout);
    assert.equal((await readInstallation(f.installation)).usesClaude, false);
    assert.deepEqual(await readFile(join(f.profileRoot, 'project-key')), key);
    assert.match(result.stdout, lang === 'zh' ? /你選擇不連接 Claude Code/u : /You chose not to connect Claude Code/u);
    assert.match(result.stdout, /npx @cairn-ink\/memory uninstall --client codex/u);
    assert.doesNotMatch(result.stdout, /cannot share|外掛無法共用/u);
  });
  test(`declining fresh Claude explains standalone Codex and later sharing (${lang})`, async t => {
    const f = await fixture(t);
    assert.equal(Boolean((await f.claudeState()).installed), false);
    const result = await f.run({ args: ['setup', '--lang', lang], choices: { claude: 'n', codex: 'y' } });
    assert.equal(result.code, 0, result.stdout);
    assert.equal((await readInstallation(f.installation)).usesClaude, false);
    assert.equal(Boolean((await f.claudeState()).installed), false);
    await assert.rejects(readFile(join(f.profileRoot, 'project-key')), { code: 'ENOENT' });
    assert.match(result.stdout, lang === 'zh' ? /你選擇不連接 Claude Code/u : /You chose not to connect Claude Code/u);
    assert.match(result.stdout, /npx @cairn-ink\/memory uninstall --client codex/u);
    assert.match(result.stdout, /npx @cairn-ink\/memory setup/u);
    assert.doesNotMatch(result.stdout, /cannot share|外掛無法共用/u);
  });
  test(`explicit endpoint without a terminal asks for confirmation and preserves the command (${lang})`, async t => {
    const f = await fixture(t);
    assert.equal((await f.run()).code, 0);
    await conflict(f);
    const paths = [f.installation, join(f.codexHome, 'config.toml'), join(f.codexHome, 'cairn/credential.json')];
    const before = await Promise.all(paths.map(path => readFile(path)));
    const claude = await f.claudeState(), requests = f.server.requests.length;
    const result = await f.run({
      args: ['setup', '--endpoint', 'https://third.test', '--reauthorize', '--lang', lang], interactive: false,
    });
    assert.equal(result.code, 2, result.stdout);
    assert.deepEqual(result.prompts, []);
    assert.equal(f.server.requests.length, requests);
    assert.deepEqual(await Promise.all(paths.map(path => readFile(path))), before);
    assert.deepEqual(await f.claudeState(), claude);
    assert.match(result.stdout, lang === 'zh' ? /需要在終端機裡確認/u : /needs a terminal to confirm/u);
    assert.doesNotMatch(result.stdout, /will ask which one|會問你要用哪一個/u);
    const command = result.stdout.replace(/ \\\n\s*/gu, ' ');
    assert.ok(command.includes('npx @cairn-ink/memory setup --endpoint "https://third.test" --reauthorize'), result.stdout);
  });
  test(`fresh Codex endpoint choice 2 does not claim a replaced login (${lang})`, async t => {
    const f = await fixture(t);
    await f.setClaudeState({ installed: true, configured: true, marketplace: true, endpoint: f.server.endpoint });
    await mkdir(f.codexHome, { mode: 0o700 });
    await writeFile(join(f.codexHome, 'config.toml'), '[mcp_servers.cairn]\nurl = "https://old.example/api/mcp"\n', { mode: 0o600 });
    const result = await f.run({ args: ['setup', '--lang', lang], choices: { endpointChoice: '2' } });
    assert.equal(result.code, 0, result.stdout);
    assert.doesNotMatch(result.stdout, /Signed in again|old sign-in is not revoked|已重新登入|舊的登入不會自動撤銷/u);
  });
}

for (const safety of ['verified', 'auth', 'version']) test(`explicit third endpoint keeps choice-2 safety (${safety})`, async t => {
  const auth = safety === 'auth', blocked = safety !== 'verified';
  const f = await fixture(t);
  assert.equal((await f.run()).code, 0);
  await conflict(f, { auth });
  if (safety === 'version') await f.setCodexState({ version: '0.161.0' });
  const path = join(f.codexHome, 'config.toml');
  const before = await readFile(path);
  const credential = await readFile(join(f.codexHome, 'cairn/credential.json'));
  const grants = f.server.requests.filter(r => r.route === 'device-authorizations').length;
  const result = await f.run({ args: ['setup', '--endpoint', f.server.endpoint, '--reauthorize'] });
  assert.equal(result.code, blocked ? 2 : 0, result.stdout);
  assert.equal(result.prompts.some(p => p.prompt.includes('Which one should both tools')), false);
  assert.doesNotMatch(result.stdout, /Run setup in a terminal/u);
  if (blocked) {
    assert.deepEqual(await readFile(path), before);
    assert.deepEqual(await readFile(join(f.codexHome, 'cairn/credential.json')), credential);
    assert.equal(f.server.requests.filter(r => r.route === 'device-authorizations').length, grants);
  } else {
    assert.equal((await f.claudeState()).endpoint, f.server.endpoint);
    assert.equal((await readInstallation(f.installation)).endpoint, f.server.endpoint);
    assert.match(await readFile(path, 'utf8'), new RegExp(f.server.endpoint));
    assert.equal(f.server.requests.filter(r => r.route === 'device-authorizations').length, grants + 1);
    await assertPaired(f);
  }
});

for (const auth of [{ credentialStatus: 401 }, { legacy: true }]) test(`saved login check handles ${JSON.stringify(auth)}`, async t => {
  const f = await fixture(t);
  assert.equal((await f.run()).code, 0);
  const config = await readFile(f.installation);
  const credential = await readFile(join(f.codexHome, 'cairn/credential.json'));
  f.setAuth(auth);
  const result = await f.run();
  assert.equal(result.code, auth.legacy ? 0 : 1, result.stdout);
  if (!auth.legacy) {
    assert.match(result.stdout, /expired or revoked/u);
    assert.match(result.stdout, /npx @cairn-ink\/memory setup --reauthorize/u);
    assert.deepEqual(await readFile(f.installation), config);
  }
  assert.deepEqual(await readFile(join(f.codexHome, 'cairn/credential.json')), credential);
});

test('cap option scope, custom CODEX_HOME lock, and Chinese verbose diagnostics', async t => {
  const f = await fixture(t);
  for (const args of [['setup', '--client', 'claude'], ['status']]) {
    const result = await f.run({ args: [...args, '--codex-daily-cap', '200'] });
    assert.equal(result.code, 2);
    assert.match(result.stdout, /only available for Codex setup or config/u);
    assert.doesNotMatch(result.stdout, /must be an integer/u);
  }
  assert.equal((await f.run()).code, 0);
  const verbose = await f.run({ args: ['status', '--verbose', '--lang', 'zh'] });
  assert.equal(verbose.code, 0);
  assert.doesNotMatch(verbose.stdout, /cli：|Shared pause gate|EOF boundary|scope：user/u);
  assert.match(verbose.stdout, /命令列|適用範圍/u);
  await writeFile(join(f.codexHome, '.cairn-setup.lock'), 'synthetic lock', { mode: 0o600 });
  const locked = await f.run();
  assert.equal(locked.code, 2, locked.stdout);
  const path = join(f.codexHome, '.cairn-setup.lock');
  assert.ok(locked.stdout.split('\n').includes(path), locked.stdout);
  assert.doesNotMatch(locked.stdout, /~\/\.codex/u);
});

test('literal paths stay copyable through nested terminal writers', () => {
  const lines = [], path = '/tmp/' + 'a'.repeat(180) + '/.cairn-setup.lock';
  const writer = terminalWriter(terminalWriter(line => lines.push(line)));
  writer.literal(path);
  assert.deepEqual(lines, [path]);
});

test('legacy MCP lock recovery prints the actual CODEX_HOME path intact', async t => {
  const f = await fixture(t, { claude: false, qualified: false });
  await mkdir(f.codexHome, { mode: 0o700 });
  const path = join(f.codexHome, '.cairn-setup.lock');
  await writeFile(path, 'synthetic lock', { mode: 0o600 });
  const result = await f.run({ args: ['setup', '--client', 'codex', '--endpoint', f.server.endpoint, '--manual-token'] });
  assert.equal(result.code, 2, result.stdout);
  assert.ok(result.stdout.split('\n').includes(path), result.stdout);
  assert.doesNotMatch(result.stdout, /~\/\.codex|^undefined$/mu);
  assert.equal(await readFile(path, 'utf8'), 'synthetic lock');
  await assert.rejects(readFile(join(f.codexHome, 'config.toml')), { code: 'ENOENT' });
});

for (const kind of ['constructor', '__proto__', 'toString']) test(`server error ${kind} uses the details recovery`, async t => {
  const f = await fixture(t, { auth: { sequence: [kind] } });
  const result = await f.run();
  assert.equal(result.code, 1, result.stdout);
  assert.match(result.stdout, /npx @cairn-ink\/memory setup --verbose/u);
  await assert.rejects(readFile(f.installation), { code: 'ENOENT' });
});

for (const answer of ['1', '2', 'n', null]) test(`unknown Claude memory ID numbered choice ${answer}`, async t => {
  const f = await fixture(t, { legacyKey: true });
  const other = join(f.home, '.cairn-memory');
  await mkdir(other, { mode: 0o700 });
  await opaqueProjectId(other, '/synthetic/project', { home: f.home });
  // A retired profile leaves two keys whose current Claude binding is unknown.
  await privateWrite(join(f.profileRoot, 'retired'), JSON.stringify({ version: 1, paired: true }));
  const paths = [other, f.profileRoot].sort();
  const before = await Promise.all(paths.map(root => readFile(join(root, 'project-key'))));
  const module = new URL('../lib/identity-choice.mjs', import.meta.url).href;
  const dictionary = new URL('../lib/messages.mjs', import.meta.url).href;
  const result = await childResult(process.execPath, ['--input-type=module', '-e', `
    import { writeSync } from 'node:fs';
    import { chooseIdentity } from ${JSON.stringify(module)};
    import { translator } from ${JSON.stringify(dictionary)};
    const prompts = [];
    try {
      const plan = await chooseIdentity({ interactive: ${answer !== null}, t: translator('en'),
        write: () => {}, prompt: async q => { prompts.push(q); return ${JSON.stringify(answer)}; } });
      writeSync(1, JSON.stringify({ root: plan.root, prompts }));
    } catch (error) { writeSync(1, JSON.stringify({ key: error.key, prompts })); process.exitCode = error.code; }
  `], { env: { ...process.env, HOME: f.home, CODEX_HOME: f.codexHome } });
  assert.equal(result.code, ['1', '2'].includes(answer) ? 0 : 2, result.stdout + result.stderr);
  const value = JSON.parse(result.stdout);
  if (result.code === 0) {
    assert.equal(value.root, paths[Number(answer) - 1]);
    assert.match(value.prompts[0], /Which memory ID/u);
  } else assert.equal(value.key, 'identity_conflict');
  assert.equal(value.prompts.length, answer === null ? 0 : 1);
  for (let i = 0; i < paths.length; i++) {
    assert.deepEqual(await readFile(join(paths[i], 'project-key')), before[i]);
    assert.equal((await readdir(paths[i])).some(name => name.startsWith('project-key.backup-')), false);
  }
});

test('message dictionaries keep locale and placeholder parity', () => {
  for (const [key, value] of Object.entries(messages)) {
    assert.deepEqual(Object.keys(value).sort(), ['en', 'zh'], key);
    const placeholders = text => [...text.matchAll(/\{(\w+)\}/gu)].map(match => match[1]).sort();
    assert.deepEqual(placeholders(value.zh), placeholders(value.en), key);
    assert.doesNotMatch(value.en, /\p{Script=Han}/u, key);
  }
});

for (const metadata of [null, undefined]) test(`legacy credential metadata ${metadata} remains reusable`, async () => {
  let checks = 0, saved;
  const stored = { endpoint: 'https://legacy.example', token: 'synthetic-legacy-token' };
  const authorization = await sharedAuthorization({ stored, authOptions: { request: async () => {
    checks++;
    return { status: 200, value: { valid: true, token_id: 'legacy-token', scopes: metadata, expires_at: null } };
  } } });
  const result = await authorization.authorize(stored.endpoint, {
    save: async value => { saved = value; }, write: () => {}, t: translator('en'),
  });
  assert.equal(checks, 1);
  assert.equal(result.reported, true);
  assert.deepEqual(saved, { api_endpoint: stored.endpoint, api_token: stored.token });
  await assert.rejects(authorization.authorize('https://other.example', {}), { key: 'authorization_endpoint_conflict' });
});

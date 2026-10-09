import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, mkdirSync, existsSync, lstatSync, readdirSync, symlinkSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { join } from 'node:path';
import { createTestWorkspace } from '../../../tools/testing/workspace.mjs';

const moduleURL = new URL('../lib/setup.mjs', import.meta.url).href;
const secret = 'synthetic-Codex-PAT-never-log-123';
const endpoint = '[mcp_servers.cairn]\nurl = "https://cairn.ink/api/mcp"\n';
const configured = endpoint + '[mcp_servers.cairn.http_headers]\nAuthorization = "Bearer ' + secret + '"\n';

async function fixture(t, options = {}) {
  const workspace = createTestWorkspace(t, { prefix: 'cairn-codex-setup-' });
  const home = join(workspace.path, options.customHome ? 'custom-codex' : '.codex');
  const fakeBin = join(workspace.path, 'bin'); mkdirSync(fakeBin);
  const projectTmp = join(workspace.path, 'project-tmp');
  if (options.projectTmp) { mkdirSync(join(projectTmp, '.codex'), {recursive:true}); writeFileSync(join(projectTmp,'.codex','config.toml'), 'model = "project"\n'); }
  const callsPath = join(workspace.path, 'calls.jsonl'); writeFileSync(callsPath, '');
  const statePath = join(workspace.path, 'state.json'); writeFileSync(statePath, JSON.stringify({ token: secret, ...options.state, ...(options.projectConfig ? {projectConfig: options.projectConfig, projectCwd: workspace.path} : {}) }));
  if (!options.noCodex) writeFileSync(join(fakeBin, 'codex'),
    `#!${process.execPath}\n${readFileSync(new URL('./fake-codex.mjs', import.meta.url), 'utf8')}`, { mode: 0o755 });
  if (options.claude) writeFileSync(join(fakeBin, 'claude'), `#!${process.execPath}\nprocess.exit(8);`, { mode: 0o755 });
  if (options.config !== undefined || options.lock || options.symlink) {
    mkdirSync(home, { mode: 0o700 });
    if (options.config !== undefined) writeFileSync(join(home, 'config.toml'), options.config, { mode: 0o644 });
    if (options.lock) writeFileSync(join(home, '.cairn-setup.lock'), 'other owner');
    if (options.symlink) {
      writeFileSync(join(workspace.path, 'target.toml'), 'model = "preserve"\n');
      symlinkSync(join(workspace.path, 'target.toml'), join(home, 'config.toml'));
    }
  }
  const promptsPath = join(workspace.path, 'prompts.jsonl'); writeFileSync(promptsPath, '');
  const harness = join(workspace.path, 'harness.mjs');
  writeFileSync(harness, `import {main} from ${JSON.stringify(moduleURL)};
    import {appendFileSync,writeFileSync,writeSync} from 'node:fs';
    const answers = ${JSON.stringify(options.answers ?? ['', secret])};
    process.exitCode = await main(process.argv.slice(2), {
      interactive: ${options.interactive ?? true}, nodeVersion: ${JSON.stringify(options.nodeVersion ?? process.versions.node)},
      prompt: async (question, options) => {
        appendFileSync(${JSON.stringify(promptsPath)}, JSON.stringify({question, options}) + '\\n');
        if (options?.secret && ${Boolean(options.concurrentChange)}) writeFileSync(${JSON.stringify(join(home, 'config.toml'))}, 'model = "concurrent"\\n');
        return answers.shift() ?? '';
      }, browse: async (_write, url) => writeSync(1, 'browser opened ' + url + '\\n')
    });`);
  const result = await new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [harness, ...(options.args ?? ['setup', '--client', 'codex', '--no-browser'])], {
      cwd: workspace.path, stdio: ['ignore', 'pipe', 'pipe'],
      env: { LANG: 'en_US.UTF-8', PATH: options.relativePath ? 'bin' : fakeBin, HOME: workspace.path, TMPDIR: options.projectTmp ? projectTmp : process.env.TMPDIR, FAKE_CALLS: callsPath, FAKE_STATE: statePath,
        ...(options.customHome ? { CODEX_HOME: home } : {}), ...options.env },
    });
    let stdout = '', stderr = '';
    child.stdout.on('data', data => { stdout += data; }); child.stderr.on('data', data => { stderr += data; });
    child.on('error', reject); child.on('close', code => resolve({ code, stdout, stderr }));
  });
  const calls = readFileSync(callsPath, 'utf8').trim().split('\n').filter(Boolean).map(JSON.parse);
  const prompts = readFileSync(promptsPath, 'utf8').trim().split('\n').filter(Boolean).map(JSON.parse);
  assert.ok(!(result.stdout + result.stderr).includes(secret), 'PAT is never printed');
  assert.ok(calls.every(call => !JSON.stringify(call).includes(secret)), 'PAT is never in argv or call logs');
  const configPath = join(home, 'config.toml');
  return { ...result, calls, prompts, homeExists: existsSync(home),
    config: existsSync(configPath) ? readFileSync(configPath, 'utf8') : null,
    mode: existsSync(configPath) ? lstatSync(configPath).mode & 0o777 : null,
    files: existsSync(home) ? readdirSync(home) : [],
    target: options.symlink ? readFileSync(join(workspace.path, 'target.toml'), 'utf8') : null };
}

test('Codex setup saves native HTTP header privately and preserves unrelated config', async t => {
  const unrelated = '# Keep comments\nmodel = "gpt-6.1-sol"\n[mcp_servers.other]\ncommand = "other"\n';
  const result = await fixture(t, { config: unrelated, customHome: true });
  assert.equal(result.code, 0, result.stdout);
  assert.ok(result.config.startsWith(unrelated));
  assert.ok(result.config.includes('Authorization = "Bearer ' + secret + '"'));
  assert.equal(result.mode, 0o600);
  assert.deepEqual(result.files, ['config.toml']);
  assert.equal(result.prompts[1].options.secret, true);
  assert.match(result.stdout, /plaintext; no keyring/);
  assert.match(result.stdout, /Codex format not yet verified/);
  assert.ok(result.calls.every(call => call.args[0] !== 'plugin'));
});

test('auto-detect Codex when Claude is absent', async t => {
  const result = await fixture(t, { args: ['setup', '--no-browser'] });
  assert.equal(result.code, 0); assert.match(result.stdout, /Cairn MCP and PAT saved/);
});

test('both clients retain Claude default; explicit Codex overrides it', async t => {
  const defaultResult = await fixture(t, { claude: true, args: ['status'] });
  assert.equal(defaultResult.code, 8); assert.deepEqual(defaultResult.calls, []);
  const explicit = await fixture(t, { claude: true }); assert.equal(explicit.code, 0);
});

for (const args of [['status', '--client', 'codex'], ['setup', '--client', 'codex', '--dry-run']]) {
  test(`Codex read-only ${args[0]} never creates home, prompts or mutates`, async t => {
    const result = await fixture(t, { args });
    assert.equal(result.code, 0); assert.equal(result.homeExists, false); assert.deepEqual(result.prompts, []);
    assert.ok(result.calls.every(call => call.args.includes('--help') || call.args.includes('--json') || call.args[0] === '--version'));
    assert.doesNotMatch(result.stdout, /browser opened/);
  });
}

test('configured Codex is idempotent and status never prints native secret output', async t => {
  for (const action of ['setup', 'status']) {
    const result = await fixture(t, { config: configured, args: [action, '--client', 'codex'] });
    assert.equal(result.code, 0); assert.equal(result.config, configured); assert.equal(result.mode, 0o644);
    assert.deepEqual(result.prompts, []); assert.deepEqual(result.files, ['config.toml']);
    assert.match(result.stdout, /Credential: configured/);
  }
});

test('existing HTTP endpoint without credential prompts only for PAT', async t => {
  const result = await fixture(t, { config: endpoint, answers: ['pat', secret] });
  assert.equal(result.code, 0, result.stdout); assert.equal(result.prompts.length, 2);
  assert.equal(result.prompts[1].options.secret, true); assert.equal(result.mode, 0o600);
  assert.match(result.stdout, /Cairn endpoint: https:\/\/cairn\.ink \(from existing config\)/);
});

for (const config of [endpoint + 'enabled = false\n', '[mcp_servers.cairn]\ncommand = "other"\n',
  endpoint + 'bearer_token_env_var = "ORIGINAL_TOKEN"\n']) {
  test('disabled/conflicting/unloaded environment credential remains unchanged', async t => {
    const result = await fixture(t, { config });
    assert.equal(result.code, 0); assert.equal(result.config, config); assert.deepEqual(result.prompts, []);
  });
}

test('loaded environment credential is preserved and not written to config', async t => {
  const config = endpoint + 'bearer_token_env_var = "ORIGINAL_TOKEN"\n';
  const result = await fixture(t, { config, env: { ORIGINAL_TOKEN: secret } });
  assert.equal(result.code, 0); assert.equal(result.config, config); assert.deepEqual(result.prompts, []);
  assert.match(result.stdout, /credential preserved/);
});

test('noninteractive Codex setup leaves configuration pending without writing', async t => {
  const result = await fixture(t, { interactive: false });
  assert.equal(result.code, 0); assert.equal(result.homeExists, false); assert.deepEqual(result.prompts, []);
  assert.match(result.stdout, /Configuration pending/); assert.match(result.stdout, /--bearer-token-env-var CAIRN_MCP_TOKEN/);
});

test('older Codex CLI falls back before collecting credentials', async t => {
  const result = await fixture(t, { state: { old: true } });
  assert.equal(result.code, 0); assert.equal(result.homeExists, false); assert.deepEqual(result.prompts, []);
});

test('missing explicit Codex reports a prerequisite failure', async t => {
  const result = await fixture(t, { noCodex: true }); assert.equal(result.code, 1);
  assert.match(result.stdout, /codex CLI not found/);
});

for (const args of [['setup', '--client'], ['setup', '--client', secret],
  ['setup', '--client', 'codex', '--client', 'codex'], ['setup', '--client', 'codex', '--token', secret]]) {
  test('invalid client/options fail before any host call without echoing values', async t => {
    const result = await fixture(t, { args }); assert.equal(result.code, 2); assert.deepEqual(result.calls, []);
  });
}

test('unsupported Node fails before Codex calls', async t => {
  const result = await fixture(t, { nodeVersion: '22.15.0' }); assert.equal(result.code, 1); assert.deepEqual(result.calls, []);
});

test('invalid endpoint is rejected before hidden PAT collection', async t => {
  const result = await fixture(t, { answers: ['http://remote.example', secret] });
  assert.equal(result.code, 1); assert.equal(result.prompts.length, 1); assert.equal(result.config, null);
});

test('invalid PAT leaves original file intact and cleans validation scratch', async t => {
  const result = await fixture(t, { config: 'model = "preserve"\n', answers: ['', secret + '\n'] });
  assert.equal(result.code, 1); assert.equal(result.config, 'model = "preserve"\n'); assert.deepEqual(result.files, ['config.toml']);
});

for (const command of ['--version', 'mcp get cairn --json']) {
  test(`Codex failure propagates actual exit without secret-bearing child output: ${command}`, async t => {
    const result = await fixture(t, { config: configured, state: { fail: command } });
    assert.equal(result.code, 7); assert.match(result.stdout, /exit 7/); assert.equal(result.config, configured);
  });
}

test('native candidate validation failure leaves original intact and asks for no PAT', async t => {
  const result = await fixture(t, { config: 'model = "preserve"\n', state: { failValidation: true } });
  assert.equal(result.code, 7); assert.equal(result.prompts.length, 1);
  assert.equal(result.config, 'model = "preserve"\n'); assert.deepEqual(result.files, ['config.toml']);
});

test('malformed CLI JSON fails closed without logging its contents', async t => {
  const result = await fixture(t, { state: { badJSON: true } }); assert.equal(result.code, 1);
  assert.match(result.stdout, /Cannot read Codex CLI state/); assert.equal(result.homeExists, false);
});

test('concurrent config edit is never overwritten', async t => {
  const result = await fixture(t, { config: 'model = "preserve"\n', concurrentChange: true });
  assert.equal(result.code, 1); assert.equal(result.config, 'model = "concurrent"\n'); assert.deepEqual(result.files, ['config.toml']);
});

test('existing setup lock is retained and original config not overwritten', async t => {
  const result = await fixture(t, { config: 'model = "preserve"\n', lock: true });
  assert.equal(result.code, 1); assert.equal(result.config, 'model = "preserve"\n');
  assert.deepEqual(result.files, ['.cairn-setup.lock', 'config.toml']);
});

test('symlink config is refused before credential collection and target is intact', async t => {
  const result = await fixture(t, { symlink: true }); assert.equal(result.code, 1);
  assert.deepEqual(result.prompts, []); assert.equal(result.target, 'model = "preserve"\n');
});

test('browser opens only for interactive Codex PAT pairing', async t => {
  const result = await fixture(t, { args: ['setup', '--client', 'codex'] });
  assert.equal(result.code, 0); assert.match(result.stdout, /browser opened https:\/\/cairn\.ink\/settings\/tokens/);
});


test('bare user entry defaults to native OAuth login and preserves stored OAuth credentials', async t => {
  const result = await fixture(t, { config: endpoint, answers: [''] });
  assert.equal(result.code, 0); assert.equal(result.config, endpoint); assert.equal(result.prompts.length, 1);
  assert.match(result.stdout, /codex mcp login cairn/); assert.ok(!result.prompts.some(p => p.options?.secret));
});

test('nonstandard Authorization header remains untouched', async t => {
  const config = endpoint + '[mcp_servers.cairn.http_headers]\nAuthorization = "Basic existing"\n';
  const result = await fixture(t, { config });
  assert.equal(result.code, 0); assert.equal(result.config, config); assert.deepEqual(result.prompts, []);
});

test('help documents client flags without executing host CLIs', async t => {
  const result = await fixture(t, { args: ['--help'] });
  assert.equal(result.code, 0); assert.match(result.stdout, /--client claude\|codex/); assert.deepEqual(result.calls, []);
});

test('explicit Claude never auto-selects the available Codex binary', async t => {
  const result = await fixture(t, { args: ['status', '--client', 'claude'] });
  assert.equal(result.code, 1); assert.match(result.stdout, /claude CLI not found/); assert.deepEqual(result.calls, []);
});


test('trusted-project-only Cairn entry cannot select a header-only user config or project URL', async t => {
  const result = await fixture(t, { projectConfig: '[mcp_servers.cairn]\nurl = "http://127.0.0.1:18768/api/mcp"\n' });
  assert.equal(result.code, 0, result.stdout); assert.equal(result.prompts.length, 2);
  assert.ok(result.config.startsWith('[mcp_servers.cairn]\nurl = "https://cairn.ink/api/mcp"\n'));
  assert.doesNotMatch(result.stdout, /18768/);
  assert.ok(result.calls.every(call => call.cwd !== call.home));
  assert.ok(result.calls.every(call => !call.args.includes('list')));
  assert.ok(result.calls.at(-1).home.endsWith('/.codex'));
  assert.ok(result.calls.at(-1).cwd.includes('cairn-codex-inspect-'));
});

test('project layer cannot override the existing user-level Cairn endpoint', async t => {
  const result = await fixture(t, { config: endpoint, projectConfig: '[mcp_servers.cairn]\nurl = "http://127.0.0.1:18768/api/mcp"\n', answers: ['pat', secret] });
  assert.equal(result.code, 0, result.stdout); assert.ok(result.config.includes('url = "https://cairn.ink/api/mcp"'));
  assert.doesNotMatch(result.stdout, /18768/); assert.match(result.stdout, /Cairn endpoint: https:\/\/cairn\.ink \(from existing config\)/);
});

for (const authStatus of ['not_logged_in', 'unknown', 'unsupported']) {
  test(`PAT explicitly selected works without OAuth discovery state (${authStatus})`, async t => {
    const result = await fixture(t, { config: endpoint, state: { authStatus }, answers: ['pat', secret] });
    assert.equal(result.code, 0, result.stdout); assert.equal(result.mode, 0o600);
    assert.ok(result.config.includes('Bearer ' + secret)); assert.ok(result.calls.every(call => !call.args.includes('list')));
  });
}


test('Claude-only help does not prepend the Codex client line', async t => {
  const result = await fixture(t, { noCodex: true, claude: true, args: ['--help'] });
  assert.equal(result.code, 0); assert.doesNotMatch(result.stdout, /^Client:/); assert.deepEqual(result.calls, []);
});


test('a temporary parent with project config fails closed before any CLI or credential collection', async t => {
  const result = await fixture(t, { projectTmp: true });
  assert.equal(result.code, 1); assert.deepEqual(result.prompts, []); assert.deepEqual(result.calls, []);
  assert.match(result.stdout, /choose a neutral temporary directory/); assert.equal(result.config, null);
});

test('an incomplete user header table fails rather than borrowing a project transport', async t => {
  const config = '[mcp_servers.cairn.http_headers]\nAuthorization = "Bearer existing"\n';
  const result = await fixture(t, { config, projectConfig: endpoint });
  assert.equal(result.code, 1); assert.equal(result.config, config); assert.deepEqual(result.prompts, []);
});


test('relative CLI PATH entries still work after moving to neutral cwd', async t => {
  const result = await fixture(t, { relativePath: true });
  assert.equal(result.code, 0, result.stdout); assert.equal(result.mode, 0o600);
});


test('Codex shares language selection and explicit endpoint precedence', async t => {
  const result = await fixture(t, { args: ['setup', '--client', 'codex', '--no-browser', '--endpoint', 'https://selected.example/', '--lang', 'zh'], answers: [secret], env: { LANG: 'C' } });
  assert.equal(result.code, 0, result.stdout);
  assert.match(result.config, /url = "https:\/\/selected\.example\/api\/mcp"/);
  assert.equal(result.prompts.length, 1); assert.equal(result.prompts[0].options.secret, true);
  assert.match(result.stdout, /Cairn endpoint：https:\/\/selected\.example（來自 --endpoint）/u);
  assert.match(result.stdout, /Cairn MCP 與 PAT 已保存/u); assert.doesNotMatch(result.stdout, /Cairn MCP and PAT saved/);
});

test('Codex explicit endpoint cannot silently replace an existing credential target', async t => {
  const result = await fixture(t, { config: configured, args: ['setup', '--client', 'codex', '--endpoint', 'https://selected.example'] });
  assert.equal(result.code, 2); assert.equal(result.config, configured); assert.deepEqual(result.prompts, []);
  assert.match(result.stdout, /differs from existing Codex config/);
});

test('Codex reports the existing origin when preserving configuration', async t => {
  const result = await fixture(t, { config: configured });
  assert.equal(result.code, 0);
  assert.match(result.stdout, /Cairn endpoint: https:\/\/cairn\.ink \(from existing config\)/);
  assert.doesNotMatch(result.stdout, /[\p{Script=Han}]/u);
});

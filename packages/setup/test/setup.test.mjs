import './codex.test.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createTestWorkspace } from '../../../tools/testing/workspace.mjs';
import { supportedNode, validEndpoint } from '../lib/setup.mjs';

const moduleURL = new URL('../lib/setup.mjs', import.meta.url).href;
const bin = fileURLToPath(new URL('../bin/memory.mjs', import.meta.url));
const secret = 'synthetic-PAT-never-print-123';

function child(command, args, options) {
  return new Promise((resolve, reject) => {
    const process = spawn(command, args, options);
    let stdout = '', stderr = '';
    process.stdout.on('data', value => { stdout += value; });
    process.stderr.on('data', value => { stderr += value; });
    process.on('error', reject);
    process.on('close', code => resolve({ code, stdout, stderr }));
  });
}

async function fixture(t, state = {}, options = {}) {
  const workspace = createTestWorkspace(t, { prefix: 'cairn-setup-' });
  const fakeBin = join(workspace.path, 'bin');
  mkdirSync(fakeBin);
  const callsPath = join(workspace.path, 'calls.jsonl');
  const statePath = join(workspace.path, 'state.json');
  writeFileSync(statePath, JSON.stringify({ token: secret, ...state }));
  writeFileSync(callsPath, '');
  if (!options.noClaude) writeFileSync(join(fakeBin, 'claude'),
    `#!${process.execPath}\n${readFileSync(new URL('./fake-claude.mjs', import.meta.url), 'utf8')}`, { mode: 0o755 });
  const answers = options.answers ?? ['', secret];
  const promptsPath = join(workspace.path, 'prompts.jsonl');
  writeFileSync(promptsPath, '');
  const harness = join(workspace.path, 'harness.mjs');
  writeFileSync(harness, `import {main} from ${JSON.stringify(moduleURL)};
    import {appendFileSync, writeSync} from 'node:fs';
    const answers = ${JSON.stringify(answers)};
    process.exitCode = await main(process.argv.slice(2), {
      interactive: ${options.interactive ?? true}, nodeVersion: ${JSON.stringify(options.nodeVersion ?? process.versions.node)},
      prompt: async (question, options) => {
        appendFileSync(${JSON.stringify(promptsPath)}, JSON.stringify({question, options}) + '\\n');
        return answers.shift() ?? '';
      }, browse: async () => writeSync(1, 'browser opened' + String.fromCharCode(10))
    });`);
  const result = await child(process.execPath, [options.realBin ? bin : harness,
    ...(options.args ?? ['setup', '--no-browser'])], {
    cwd: workspace.path, stdio: ['ignore', 'pipe', 'pipe'],
    env: { PATH: fakeBin, HOME: workspace.path, FAKE_CALLS: callsPath, FAKE_STATE: statePath },
  });
  const calls = readFileSync(callsPath, 'utf8').trim().split('\n').filter(Boolean).map(JSON.parse);
  const prompts = readFileSync(promptsPath, 'utf8').trim().split('\n').filter(Boolean).map(JSON.parse);
  assert.ok(!(result.stdout + result.stderr).includes(secret), 'PAT must never appear in output');
  assert.ok(calls.every(call => !call.args.join(' ').includes(secret)), 'PAT must never be in argv');
  return { ...result, calls, prompts, state: JSON.parse(readFileSync(statePath, 'utf8')) };
}

test('Node minimum and endpoint rules', () => {
  for (const version of ['20.19.0', '22.15.9', '21.9.0']) assert.equal(supportedNode(version), false);
  for (const version of ['22.16.0', '22.99.0', '24.15.0']) assert.equal(supportedNode(version), true);
  for (const endpoint of ['https://cairn.ink', 'http://localhost:3000', 'http://127.0.0.1:8080', 'http://[::1]:3000']) assert.equal(validEndpoint(endpoint), true);
  for (const endpoint of ['http://example.com', 'https://user:pass@example.com', 'https://cairn.ink?token=x', 'https://cairn.ink#x', 'https://cairn.ink\n', 'bad']) assert.equal(validEndpoint(endpoint), false);
});

test('happy path installs marketplace/plugin and saves PAT only through stdin', async t => {
  const result = await fixture(t);
  assert.equal(result.code, 0, result.stdout + result.stderr);
  assert.equal(result.state.configured, true);
  assert.equal(result.state.endpoint, 'https://cairn.ink');
  assert.deepEqual(result.calls.filter(call => !call.args.includes('--help')).map(call => call.args), [
    ['--version'], ['plugin', 'marketplace', 'list', '--json'],
    ['plugin', 'marketplace', 'add', 'Cairn-ink/cairn-memory'],
    ['plugin', 'install', 'cairn-memory@cairn-memory'], ['plugin', 'list', '--json'],
    ['plugin', 'configure', 'cairn-memory@cairn-memory', '--json'],
    ['plugin', 'configure', 'cairn-memory@cairn-memory', '--values-stdin'],
    ['plugin', 'configure', 'cairn-memory@cairn-memory', '--json'], ['mcp', 'get', 'cairn'],
  ]);
  const saved = result.calls.find(call => call.args.includes('--values-stdin'));
  assert.equal(JSON.parse(saved.input).api_token, secret);
  assert.equal(result.prompts[1].options.secret, true);
  assert.match(result.stdout, /PAT saved by Claude Code/);
});

test('real bin reports missing claude CLI and exits non-zero', async t => {
  const result = await fixture(t, {}, { noClaude: true, realBin: true });
  assert.equal(result.code, 1);
  assert.match(result.stdout, /找不到 claude CLI.*not found on PATH/u);
});

test('unsupported Node fails before any Claude call', async t => {
  const result = await fixture(t, {}, { nodeVersion: '22.15.0' });
  assert.equal(result.code, 1);
  assert.deepEqual(result.calls, []);
});

for (const answer of ['y', 'N', '']) {
  test(`legacy MCP requires affirmative confirmation (${JSON.stringify(answer)})`, async t => {
    const result = await fixture(t, { mcp: true }, { answers: ['', secret, answer] });
    assert.equal(result.code, 0);
    assert.equal(result.state.mcp, answer !== 'y');
    assert.equal(result.calls.some(call => call.args.join(' ') === 'mcp remove cairn'), answer === 'y');
  });
}

test('dry-run uses read-only calls, no prompt/browser/config write/MCP removal', async t => {
  const result = await fixture(t, { mcp: true }, { args: ['setup', '--dry-run'] });
  assert.equal(result.code, 0);
  assert.deepEqual(result.prompts, []);
  assert.ok(result.calls.every(call => call.args.includes('--help') || call.args.includes('--json') ||
    ['--version', 'mcp get cairn'].includes(call.args.join(' '))));
  assert.match(result.stdout, /claude plugin marketplace add Cairn-ink\/cairn-memory/);
  assert.match(result.stdout, /claude mcp remove cairn/);
  assert.match(result.stdout, /confirmation required/);
  assert.doesNotMatch(result.stdout, /browser opened/);
});

test('status only prints curated installation/configuration metadata', async t => {
  const result = await fixture(t, { installed: true, marketplace: true, configured: true, mcp: true }, { args: ['status'] });
  assert.equal(result.code, 0);
  assert.match(result.stdout, /Plugin \(user\): 已啟用 \/ enabled/u);
  assert.match(result.stdout, /api_token: 已設定 \/ configured/u);
  assert.match(result.stdout, /Legacy MCP cairn: 存在/u);
  assert.deepEqual(result.prompts, []);
  assert.ok(result.calls.every(call => call.args.includes('--help') ||
    (!call.args.includes('install') && !call.args.includes('remove'))));
});

test('already configured installation preserves PAT and skips pairing', async t => {
  const result = await fixture(t, { installed: true, marketplace: true, configured: true });
  assert.equal(result.code, 0);
  assert.deepEqual(result.prompts, []);
  assert.ok(!result.calls.some(call => !call.args.includes('--help') &&
    (call.args.includes('add') || call.args.includes('--values-stdin'))));
});

test('partial configuration preserves an existing PAT and prompts only for endpoint', async t => {
  const result = await fixture(t, { partial: ['api_token'] }, { answers: ['https://memory.example.com'] });
  assert.equal(result.code, 0);
  assert.equal(result.prompts.length, 1);
  assert.deepEqual(JSON.parse(result.calls.find(call => call.args.includes('--values-stdin')).input), {
    api_endpoint: 'https://memory.example.com',
  });
  assert.equal(result.state.token, secret);
});

test('partial configuration preserves endpoint and prompts only for hidden PAT', async t => {
  const result = await fixture(t, { partial: ['api_endpoint'], endpoint: 'https://memory.example.com' }, { answers: [secret] });
  assert.equal(result.code, 0);
  assert.equal(result.prompts.length, 1);
  assert.equal(result.prompts[0].options.secret, true);
  assert.deepEqual(JSON.parse(result.calls.find(call => call.args.includes('--values-stdin')).input), { api_token: secret });
  assert.equal(result.state.endpoint, 'https://memory.example.com');
});

test('older CLI gives exact slash install fallback', async t => {
  const result = await fixture(t, { noInstall: true });
  assert.equal(result.code, 0);
  assert.match(result.stdout, /\/plugin marketplace add Cairn-ink\/cairn-memory/);
  assert.match(result.stdout, /\/plugin install cairn-memory@cairn-memory/);
  assert.ok(!result.state.installed);
});

test('CLI without secure configure installs and delegates credentials to Claude Code', async t => {
  const result = await fixture(t, { noConfigure: true, mcp: true });
  assert.equal(result.code, 0);
  assert.match(result.stdout, /\/plugin configure cairn-memory@cairn-memory/);
  assert.match(result.stdout, /api_endpoint/);
  assert.match(result.stdout, /api_token/);
  assert.deepEqual(result.prompts, []);
  assert.equal(result.state.mcp, true);
});

test('noninteractive real bin installs but does not consume PAT or remove MCP', async t => {
  const result = await fixture(t, { mcp: true }, { realBin: true });
  assert.equal(result.code, 0);
  assert.equal(result.state.installed, true);
  assert.equal(result.state.configured, undefined);
  assert.equal(result.state.mcp, true);
  assert.match(result.stdout, /configuration still required/);
});

for (const command of ['--version', 'plugin marketplace add Cairn-ink/cairn-memory',
  'plugin install cairn-memory@cairn-memory', 'plugin configure cairn-memory@cairn-memory --values-stdin',
  'mcp get cairn', 'mcp remove cairn']) {
  test(`propagates non-zero exit without child output: ${command}`, async t => {
    const result = await fixture(t, { fail: command, mcp: true }, { answers: ['', secret, 'y'] });
    assert.equal(result.code, 7);
    assert.match(result.stdout, /exit 7/);
    if (!command.startsWith('mcp')) assert.ok(!result.calls.some(call => call.args.includes('remove')));
  });
}

test('malformed status JSON fails without revealing its contents', async t => {
  const result = await fixture(t, { badJSON: true }, { args: ['status'] });
  assert.equal(result.code, 1);
  assert.match(result.stdout, /Cannot read CLI state/);
});

test('disabled plugin never triggers credential collection or MCP removal', async t => {
  const result = await fixture(t, { disabled: true, mcp: true });
  assert.equal(result.code, 0);
  assert.deepEqual(result.prompts, []);
  assert.equal(result.state.mcp, true);
  assert.match(result.stdout, /Plugin is disabled/);
});

test('secure save is checked before offering legacy removal', async t => {
  const result = await fixture(t, { incompleteSave: true, mcp: true });
  assert.equal(result.code, 1);
  assert.equal(result.state.mcp, true);
  assert.match(result.stdout, /not fully saved/);
});

test('invalid endpoint is rejected before collecting or forwarding PAT', async t => {
  const result = await fixture(t, {}, { answers: ['http://example.com', secret] });
  assert.equal(result.code, 1);
  assert.equal(result.prompts.length, 1);
  assert.ok(!result.calls.some(call => call.args.includes('--values-stdin')));
});

test('invalid PAT is rejected without output or child forwarding', async t => {
  const result = await fixture(t, {}, { answers: ['', `${secret}\n`] });
  assert.equal(result.code, 1);
  assert.ok(!result.calls.some(call => call.args.includes('--values-stdin')));
});

test('unknown flags are not echoed (including a token accidentally passed as a flag)', async t => {
  const result = await fixture(t, {}, { args: ['setup', '--token', secret] });
  assert.equal(result.code, 2);
  assert.deepEqual(result.calls, []);
});

test('browser opens only during interactive pairing', async t => {
  const result = await fixture(t, {}, { args: ['setup'] });
  assert.equal(result.code, 0);
  assert.match(result.stdout, /browser opened/);
});

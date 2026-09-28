// Offline self-test: the isolation preflight fails closed on every unproven condition.
import assert from 'node:assert/strict';
import test from 'node:test';
import { preflight, skillSetDigest } from '../lib/preflight.mjs';

const HOME = '/home/synthetic';
const PINS = { claude: '2.1.283 (Claude Code)', codex: 'codex-cli 0.157.1', node: 'v22.16.0' };
const BINARIES = { claude: '/bin/claude', codex: '/bin/codex' };
const HOOK = '/node /harness/hook.mjs /tmp/f0-tmp/f0-run ';
const CWD = '/tmp/f0-tmp/f0-run/project';

function deps({ files = {}, dirs = {}, entries = {}, versions = {}, reg = 1, nodeVersion = 'v22.16.0', throwOn } = {}) {
  return {
    exec: (command, args) => {
      if (command === throwOn) throw new Error('exec failed');
      if (args[0] === '--version') {
        const host = Object.keys(BINARIES).find(key => BINARIES[key] === command);
        return { status: 0, stdout: `${versions[host] ?? PINS[host]}\n` };
      }
      return { status: reg, stdout: '' };
    },
    exists: path => Object.hasOwn(files, path),
    readText: path => files[path] ?? null,
    listDirs: path => dirs[path] ?? [],
    listEntries: path => (Object.hasOwn(entries, path) ? entries[path] : []),
    nodeVersion,
  };
}

const claudeStep = { host: 'claude' };
const claudeArgs = ['-p', '--setting-sources', 'project,local', '--strict-mcp-config', '--mcp-config', '{"mcpServers":{}}'];
const settings = JSON.stringify({ hooks: { Stop: [{ hooks: [{ type: 'command', command: `${HOOK}claude Stop` }] }] } });
const codexHooks = ['-c', `hooks.Stop=[{hooks=[{type="command",command="${HOOK}codex Stop",timeout=3}]}]`,
  '--dangerously-bypass-hook-trust'];
const codexArgs = ['exec', '--ignore-user-config', ...codexHooks];

const run = (step, args, options, extra = {}) => preflight({ step, built: { args, cwd: CWD }, pins: PINS, home: HOME,
  binaries: BINARIES, hookPrefix: HOOK, ledger: extra.ledger ?? { runs: [] }, isolationDigest: extra.digest ?? null,
  env: {}, deps: deps(options) });
const failed = result => result.failures.map(entry => entry.name.split(':')[0]);

test('a clean Claude step passes and a missing exclusion flag fails', () => {
  const files = { [`${CWD}/.claude/settings.json`]: settings };
  assert.equal(run(claudeStep, claudeArgs, { files }).ok, true);
  const withUser = run(claudeStep, ['-p', '--setting-sources', 'user,project', '--strict-mcp-config', '--mcp-config', '{"mcpServers":{}}'], { files });
  assert.deepEqual(failed(withUser), ['claude_user_settings_excluded']);
  assert.ok(failed(run(claudeStep, ['-p'], { files })).includes('claude_user_settings_excluded'));
});

test('Claude managed policy, foreign project hooks or local settings fail closed', () => {
  const files = { [`${CWD}/.claude/settings.json`]: settings };
  assert.deepEqual(failed(run(claudeStep, claudeArgs, { files: { ...files, '/etc/claude-code/managed-settings.json': '{}' } })),
    ['claude_no_managed_settings_file']);
  const reg = { ...files, '/mnt/c/Windows/System32/reg.exe': '' };
  assert.equal(run(claudeStep, claudeArgs, { files: reg, reg: 1 }).ok, true);
  assert.ok(failed(run(claudeStep, claudeArgs, { files: reg, reg: 0 })).includes('claude_no_policy_HKLM'));
  const foreign = JSON.stringify({ hooks: { Stop: [{ hooks: [{ type: 'command', command: '/usr/bin/other' }] }] } });
  assert.ok(failed(run(claudeStep, claudeArgs, { files: { [`${CWD}/.claude/settings.json`]: foreign } }))
    .includes('claude_project_hooks_are_harness'));
  assert.ok(failed(run(claudeStep, claudeArgs, { files: { ...files, '/tmp/.claude/settings.json': settings } }))
    .includes('claude_project_hooks_are_harness'));
  assert.ok(failed(run(claudeStep, claudeArgs, { files: { ...files, [`${CWD}/.claude/settings.local.json`]: '{}' } }))
    .includes('claude_no_local_settings'));
});

test('installed versions must match the pins', () => {
  assert.deepEqual(failed(run({ host: 'codex' }, codexArgs, { versions: { codex: 'codex-cli 0.158.0' } })),
    ['host_version_matches_pin']);
  assert.deepEqual(failed(run({ host: 'codex' }, codexArgs, { nodeVersion: 'v24.1.0' })), ['node_version_matches_pin']);
});

test('any Codex user, system or project hook source blocks the step', () => {
  const step = { host: 'codex' };
  assert.equal(run(step, codexArgs, {}).ok, true);
  assert.deepEqual(failed(run(step, codexArgs, { files: { [`${HOME}/.codex/hooks.json`]: '{}' } })), ['codex_no_user_hooks_json']);
  for (const toml of ['[hooks]\n', '[[hooks.Stop]]\n', 'hooks.Stop = []\n']) {
    assert.deepEqual(failed(run(step, codexArgs, { files: { [`${HOME}/.codex/config.toml`]: `model = "x"\n${toml}` } })),
      ['codex_no_user_hooks_table'], toml);
  }
  assert.equal(run(step, codexArgs, { files: { [`${HOME}/.codex/config.toml`]: '[mcp_servers.x]\ncommand = "y"\n' } }).ok, true);
  assert.deepEqual(failed(run(step, codexArgs, { files: { '/etc/codex': '' } })), ['codex_no_system_config']);
  // An empty project `.codex` loads nothing; any content, or an unreadable one, blocks.
  assert.equal(run(step, codexArgs, { files: { '/tmp/.codex': '' } }).ok, true);
  assert.ok(failed(run(step, codexArgs, { files: { '/tmp/f0-tmp/.codex': '' }, entries: { '/tmp/f0-tmp/.codex': ['config.toml'] } }))
    .includes('codex_no_project_config'));
  assert.ok(failed(run(step, codexArgs, { files: { '/tmp/.codex': '' }, entries: { '/tmp/.codex': null } }))
    .includes('codex_no_project_config'));
  assert.deepEqual(failed(run(step, ['exec', ...codexHooks], {})), ['codex_user_config_ignored']);
});

test('hook-trust bypass is allowed only for harness hook commands', () => {
  const foreign = ['exec', '--ignore-user-config', '-c', 'hooks.Stop=[{hooks=[{type="command",command="/usr/bin/other",timeout=3}]}]',
    '--dangerously-bypass-hook-trust'];
  assert.deepEqual(failed(run({ host: 'codex' }, foreign, {})), ['codex_trust_bypass_only_harness_hooks']);
});

test('a real Codex model-only step needs a matching scripted proof that no user skill is injected', () => {
  const step = { host: 'codex', modelOnly: true };
  const args = ['exec', '--ignore-user-config', '--disable', 'hooks'];
  const skills = ['alpha-skill', 'beta-skill'];
  const dirs = { [`${HOME}/.codex/skills`]: skills };
  assert.equal(run(step, args, { dirs: { [`${HOME}/.codex/skills`]: [] } }, { digest: 'd1' }).ok, true);
  assert.deepEqual(failed(run(step, args, { dirs }, { digest: 'd1' })), ['codex_model_only_no_user_skills']);
  const proof = hits => ({ runs: [{ label: 'codex-model-only-fake', fakeModel: true, skillProof:
    { isolationDigest: 'd1', skillSetDigest: skillSetDigest(skills), requests: 1, hits } }] });
  assert.equal(run(step, args, { dirs }, { digest: 'd1', ledger: proof(0) }).ok, true);
  assert.deepEqual(failed(run(step, args, { dirs }, { digest: 'd1', ledger: proof(13) })), ['codex_model_only_no_user_skills']);
  assert.deepEqual(failed(run(step, args, { dirs }, { digest: 'other', ledger: proof(0) })), ['codex_model_only_no_user_skills']);
  // The scripted step that produces the proof does not need one.
  assert.equal(run({ ...step, fake: true }, args, { dirs }, { digest: 'd1' }).ok, true);
});

test('an unevaluable check fails closed', () => {
  const result = run({ host: 'codex' }, codexArgs, { throwOn: BINARIES.codex });
  assert.equal(result.ok, false);
  assert.deepEqual(failed(result), ['preflight_evaluable']);
});

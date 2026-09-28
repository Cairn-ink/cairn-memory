// Offline self-test of the orchestrator CLI with a fake home: setup commits
// the scripted-compaction configuration and every canary, and a failing gate
// blocks a step before anything is counted or launched. No host binary exists
// under the fake home, so no host process can start.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { chmodSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { createTestWorkspace } from '../../../../../tools/testing/workspace.mjs';
import { canaryTable, plantedCheck } from '../lib/canaries.mjs';
import { claudeProjectDir } from '../lib/source-access.mjs';

const RUN = fileURLToPath(new URL('../run.mjs', import.meta.url));
const ANALYZE = fileURLToPath(new URL('../analyze.mjs', import.meta.url));

function orchestrator(t) {
  const workspace = createTestWorkspace(t, { prefix: 'f0-orchestrator-' });
  const home = join(workspace.path, 'home');
  mkdirSync(home);
  const root = join(workspace.path, 'run');
  const env = { PATH: process.env.PATH, HOME: home, USER: 'synthetic', TMPDIR: workspace.path, F0_RUN_ROOT: root };
  const call = (...args) => spawnSync(process.execPath, [RUN, ...args], { env, encoding: 'utf8', timeout: 30_000 });
  return { home, root, call };
}

test('setup commits the scripted-compaction configuration and a complete canary table', t => {
  const o = orchestrator(t);
  const setup = o.call('setup');
  assert.equal(setup.status, 0, setup.stderr);
  const config = JSON.parse(readFileSync(join(o.root, 'config.json'), 'utf8'));
  assert.match(config.canaries.compactMarker, /^F0CMPM/);
  assert.match(config.canaries.compactSummary, /^F0CMPS/);
  assert.equal(config.fakeUsageTokens['codex-compact-fake'], 60_000);
  assert.equal(Object.keys(canaryTable(config.canaries)).length, 17);
});

test('setup refuses a run root outside TMPDIR', t => {
  const o = orchestrator(t);
  const result = spawnSync(process.execPath, [RUN, 'setup'], { env: { PATH: process.env.PATH, HOME: o.home,
    TMPDIR: join(o.root, 'elsewhere'), F0_RUN_ROOT: o.root }, encoding: 'utf8' });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /run root must be inside TMPDIR/);
});

test('a failing isolation gate blocks the step before counting or launching', t => {
  const o = orchestrator(t);
  assert.equal(o.call('setup').status, 0);
  mkdirSync(join(o.home, '.codex', 'skills', 'synthetic-skill'), { recursive: true });
  writeFileSync(join(o.home, '.codex', 'hooks.json'), '{}');
  const step = o.call('step', 'codex-capture');
  assert.equal(step.status, 1);
  const failures = JSON.parse(step.stderr).failures.map(entry => entry.name);
  assert.ok(failures.includes('host_version_matches_pin'), 'no pinned binary under the fake home');
  assert.ok(failures.includes('codex_no_user_hooks_json'));
  const ledger = JSON.parse(readFileSync(join(o.root, 'ledger.json'), 'utf8'));
  assert.deepEqual([ledger.used, ledger.runs], [{ claude: 0, codex: 0 }, []]);
  const gate = o.call('preflight', 'codex-model-only-traced');
  assert.equal(gate.status, 1);
  const checks = JSON.parse(gate.stdout).checks;
  assert.equal(checks.find(check => check.name === 'codex_model_only_no_user_skills').ok, false);
});

test('a missing canary value or an unplanted required canary is a failure, never a skip', () => {
  assert.throws(() => canaryTable({ secrets: ['a'.repeat(9)] }), /missing_canary:secret_ghp/);
  const table = { tool_output: 'F0TOOLXXXXXX', compact_summary_scripted: 'F0CMPSXXXXXX' };
  const missing = plantedCheck({ plants: ['compact_summary_scripted', 'compaction_summary_text'] }, new Set(), table);
  assert.equal(missing.ok, false);
  assert.deepEqual(missing.missing, ['compact_summary_scripted', 'compaction_summary_text']);
  assert.equal(plantedCheck({ plants: ['no_such_canary'] }, new Set(['no_such_canary']), table).ok, false);
  const planted = plantedCheck({ plants: ['tool_output'], mayPlant: ['compact_summary_scripted'] }, new Set(['tool_output']), table);
  assert.deepEqual([planted.ok, planted.optional], [true, { compact_summary_scripted: false }]);
});

test('analysis fails when a required canary never reached the owned source of its step', t => {
  const o = orchestrator(t);
  assert.equal(o.call('setup').status, 0);
  const config = JSON.parse(readFileSync(join(o.root, 'config.json'), 'utf8'));
  const sessionId = '6f6d1c2e-7b1a-4c3d-8e9f-0a1b2c3d4e5f';
  const ledger = JSON.parse(readFileSync(join(o.root, 'ledger.json'), 'utf8'));
  ledger.runs.push({ name: 'claude-capture', label: 'claude-capture', host: 'claude', plants: ['tool_output'], mayPlant: [],
    launch: { sessionId, cwd: config.project, startedAt: Date.now() - 1_000, exitAt: Date.now() } });
  writeFileSync(join(o.root, 'ledger.json'), JSON.stringify(ledger));
  const source = join(claudeProjectDir(o.home, config.project), `${sessionId}.jsonl`);
  mkdirSync(join(source, '..'), { recursive: true });
  const analyze = () => spawnSync(process.execPath, [ANALYZE], { env: { PATH: process.env.PATH, HOME: o.home,
    F0_RUN_ROOT: o.root }, encoding: 'utf8', timeout: 30_000 });
  writeFileSync(source, '{"type":"system"}\n');
  const missing = analyze();
  assert.equal(missing.status, 1);
  assert.deepEqual(JSON.parse(readFileSync(join(o.root, 'results.json'), 'utf8')).plantFailures,
    [{ label: 'claude-capture', missing: ['tool_output'], unknown: [] }]);
  writeFileSync(source, `${JSON.stringify({ type: 'user', toolUseResult: {}, message: { role: 'user',
    content: [{ type: 'tool_result', content: config.canaries.tool }] } })}\n`);
  const planted = analyze();
  assert.equal(planted.status, 0, planted.stderr);
});

test('analysis fails when a planted canary reappears in checked host output', t => {
  const o = orchestrator(t);
  assert.equal(o.call('setup').status, 0);
  const config = JSON.parse(readFileSync(join(o.root, 'config.json'), 'utf8'));
  const sessionId = '7a6d1c2e-7b1a-4c3d-8e9f-0a1b2c3d4e5f';
  const stdoutPath = join(o.root, 'logs', 'host', 'claude-capture.stdout');
  const ledger = JSON.parse(readFileSync(join(o.root, 'ledger.json'), 'utf8'));
  ledger.runs.push({ name: 'claude-capture', label: 'claude-capture', host: 'claude', plants: ['tool_output'], mayPlant: [],
    stdoutPath, launch: { sessionId, cwd: config.project, startedAt: Date.now() - 1_000, exitAt: Date.now() } });
  writeFileSync(join(o.root, 'ledger.json'), JSON.stringify(ledger));
  const source = join(claudeProjectDir(o.home, config.project), `${sessionId}.jsonl`);
  mkdirSync(join(source, '..'), { recursive: true });
  // The canary is planted in the source only as tool output, as the step intends.
  writeFileSync(source, `${JSON.stringify({ type: 'user', toolUseResult: {}, message: { role: 'user',
    content: [{ type: 'tool_result', content: config.canaries.tool }] } })}\n`);
  const assistant = text => `${JSON.stringify({ type: 'assistant', message: { content: [{ type: 'text', text }] } })}\n`;
  const analyze = () => spawnSync(process.execPath, [ANALYZE], { env: { PATH: process.env.PATH, HOME: o.home,
    F0_RUN_ROOT: o.root }, encoding: 'utf8', timeout: 30_000 });
  writeFileSync(stdoutPath, assistant('DONE'));
  const clean = analyze();
  assert.equal(clean.status, 0, clean.stderr);
  writeFileSync(stdoutPath, assistant(`The file says ${config.canaries.tool}.`));
  const leaked = analyze();
  assert.equal(leaked.status, 1);
  assert.deepEqual(JSON.parse(leaked.stderr.trim().split('\n').at(-1)).leaks,
    [{ label: 'claude-capture', kinds: ['visibleOutput'] }]);
});

test('the gate exits non-zero for a quoted hooks table or an unreadable Codex user config', t => {
  const o = orchestrator(t);
  assert.equal(o.call('setup').status, 0);
  mkdirSync(join(o.home, '.codex'));
  const config = join(o.home, '.codex', 'config.toml');
  const gate = () => {
    const result = o.call('preflight', 'codex-capture');
    return { status: result.status, check: JSON.parse(result.stdout).checks.find(entry => entry.name === 'codex_no_user_hooks_table') };
  };
  writeFileSync(config, 'model = "x"\n["hooks"]\n');
  const quoted = gate();
  assert.deepEqual([quoted.status, quoted.check.ok], [1, false]);
  writeFileSync(config, '"hooks".Stop = []\n');
  assert.deepEqual([gate().status, gate().check.ok], [1, false]);
  writeFileSync(config, 'model = "x"\n');
  chmodSync(config, 0o000);
  let unreadable;
  try { unreadable = gate(); } finally { chmodSync(config, 0o600); }
  assert.deepEqual([unreadable.status, unreadable.check.ok, unreadable.check.detail], [1, false, 'unreadable: EACCES']);
});

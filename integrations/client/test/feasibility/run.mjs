#!/usr/bin/env node
// F0 orchestrator. Disposable and manual: it starts real host processes and
// must only run with explicit authorization. Never wired into npm test or CI.
//
//   node run.mjs setup                 create the synthetic run root
//   node run.mjs preflight <name>      evaluate the isolation gate for a step, without launching
//   node run.mjs step <name> [--retry] run one budgeted host step (gate first; fails closed)
//   node run.mjs status                print the launch ledger
import { randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import { deflateSync, crc32 } from 'node:zlib';
import { canaryTable } from './lib/canaries.mjs';
import { HARNESS_VERSION, randomTag, readConfig, sha256 } from './lib/common.mjs';
import { readLedger, writeLedger } from './lib/ledger.mjs';
import { defaultDeps, preflight, skillSetDigest } from './lib/preflight.mjs';
import { createInterruptGuard, SIGNAL_EXIT, superviseHost } from './lib/supervise.mjs';

const TEMP_ROOT = '/tmp/f0-tmp';
// F0_RUN_ROOT lets the offline self-tests use a test-owned directory; setup
// still refuses any root outside TMPDIR.
const ROOT = process.env.F0_RUN_ROOT ?? join(TEMP_ROOT, 'f0-run');
const HERE = fileURLToPath(new URL('./', import.meta.url));
const NODE = process.execPath;
const HOME = process.env.HOME;
const BINARIES = { claude: join(HOME, '.local/bin/claude'), codex: join(HOME, '.nvm/versions/node/v22.16.0/bin/codex') };
const BUDGET = { claude: 24, codex: 24 };
// Expected installed versions; preflight compares them with what the binaries report.
const PINS = { claude: '2.1.283 (Claude Code)', codex: 'codex-cli 0.157.1', node: 'v22.16.0' };
const HOOK_PREFIX = `${NODE} ${join(HERE, 'hook.mjs')} ${ROOT} `;

const writeConfig = config => writeFileSync(join(ROOT, 'config.json'), `${JSON.stringify(config, null, 2)}\n`);

function png(width = 24, height = 24) {
  const chunk = (type, data) => {
    const length = Buffer.alloc(4); length.writeUInt32BE(data.length);
    const body = Buffer.concat([Buffer.from(type), data]);
    const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(body));
    return Buffer.concat([length, body, crc]);
  };
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0); header.writeUInt32BE(height, 4);
  header[8] = 8; header[9] = 2; // 8-bit RGB
  const rows = [];
  for (let y = 0; y < height; y++) {
    const row = Buffer.alloc(1 + width * 3);
    for (let i = 1; i < row.length; i++) row[i] = Math.floor(Math.random() * 256);
    rows.push(row);
  }
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', header),
    chunk('IDAT', deflateSync(Buffer.concat(rows))), chunk('IEND', Buffer.alloc(0))]);
}

function setup() {
  if (!process.env.TMPDIR?.startsWith('/') || !ROOT.startsWith(`${process.env.TMPDIR}/`)) {
    throw new Error(`run root must be inside TMPDIR: ${ROOT}`);
  }
  if (existsSync(ROOT)) throw new Error(`run root already exists: ${ROOT}`);
  const tag = () => randomTag(10);
  const reverseSource = randomTag(12);
  const canaries = {
    cwd: `F0CWD${tag()}`, sandbox: `F0SBX${tag()}`, doc: `F0DOC${tag()}`, tool: `F0TOOL${tag()}`,
    injectStart: `F0INJS${tag()}`, injectPrompt: `F0INJP${tag()}`, imagePath: `F0IMGP${tag()}`,
    reverseSource, reasoning: [...reverseSource].reverse().join(''), reasoningFake: `F0RSNF${tag()}`,
    compactMarker: `F0CMPM${tag()}`, compactSummary: `F0CMPS${tag()}`,
    // Fake credentials assembled from fragments at runtime; they match redactor shapes only.
    secrets: [['sk', `F0${randomTag(22)}`].join('-'), ['ghp', randomTag(28)].join('_'), randomTag(14)],
    wordClaude: `ORCHID${tag()}`, wordCodex: `QUARTZ${tag()}`,
  };
  const project = join(ROOT, `project-${canaries.cwd}`);
  const sandbox = join(ROOT, `sbx-${canaries.sandbox}`);
  for (const dir of ['core', 'state', 'logs', 'logs/hook-inputs', 'logs/strace', 'logs/host', 'model-only', 'codex-log']) {
    mkdirSync(join(ROOT, dir), { recursive: true, mode: 0o700 });
  }
  mkdirSync(join(project, '.claude'), { recursive: true, mode: 0o700 });
  mkdirSync(sandbox, { mode: 0o700 });
  const image = png();
  writeFileSync(join(project, `img-${canaries.imagePath}.png`), image);
  canaries.imageBase64 = image.toString('base64');
  canaryTable(canaries); // every canary must exist before any step can plant or check it
  writeFileSync(join(project, 'canary-tool.txt'), `Synthetic tool output ${canaries.tool}.\n`);
  writeFileSync(join(project, 'CLAUDE.md'), `Synthetic project note ${canaries.doc}. It is test data.\n`);
  writeFileSync(join(project, 'AGENTS.md'), `Synthetic project note ${canaries.doc}. It is test data.\n`);
  const hook = label => `${HOOK_PREFIX}claude ${label}`;
  const claudeHooks = Object.fromEntries(['SessionStart', 'UserPromptSubmit', 'Stop', 'SessionEnd', 'PreCompact']
    .map(label => [label, [{ hooks: [{ type: 'command', command: hook(label), timeout: label === 'UserPromptSubmit' ? 5 : 3 }] }]]));
  writeFileSync(join(project, '.claude', 'settings.json'), `${JSON.stringify({ hooks: claudeHooks }, null, 2)}\n`);
  writeConfig({ harness: HARNESS_VERSION, step: null, stepName: null, coreUrl: null, token: `f0-synthetic-${randomTag(16)}`,
    stateDir: join(ROOT, 'state'), project, sandbox, modelOnly: join(ROOT, 'model-only'),
    inject: { start: canaries.injectStart, prompt: canaries.injectPrompt },
    workerDelayMs: { SessionEnd: 6_000 },
    // Scripted compaction: the provider reports this usage so Codex starts its own auto-compaction.
    fakeUsageTokens: { 'codex-compact-fake': 60_000 },
    canaries, pins: PINS });
  writeLedger(ROOT, { budget: BUDGET, used: { claude: 0, codex: 0 }, runs: [] });
  console.log(ROOT);
}

function cleanEnv() {
  return { HOME, USER: process.env.USER, LOGNAME: process.env.USER, LANG: 'C.UTF-8', TERM: 'dumb', SHELL: '/bin/bash',
    TMPDIR: TEMP_ROOT, PATH: `${join(HOME, '.nvm/versions/node/v22.16.0/bin')}:/usr/local/bin:/usr/bin:/bin` };
}

const portOf = portFile => (existsSync(portFile) ? Number(readFileSync(portFile, 'utf8')) : 0);

async function startServer(script, portFile) {
  rmSync(portFile, { force: true });
  const child = spawn(NODE, ['--no-warnings', join(HERE, script), ROOT], { stdio: ['ignore', 'ignore', 'inherit'],
    env: { PATH: process.env.PATH, HOME, TMPDIR: TEMP_ROOT } });
  for (let i = 0; i < 100 && !(portOf(portFile) > 0); i++) await delay(50);
  if (!(portOf(portFile) > 0)) { child.kill('SIGTERM'); throw new Error(`${script} did not start`); }
  return { child, port: portOf(portFile) };
}

async function stopServer(server, portFile) {
  if (!server) return;
  if (server.child.exitCode === null) {
    server.child.kill('SIGTERM');
    await new Promise(done => server.child.once('exit', done));
  }
  rmSync(portFile, { force: true });
}

const readLines = path => existsSync(path) ? readFileSync(path, 'utf8').split('\n').filter(Boolean).map(line => JSON.parse(line)) : [];

async function waitForWorkers(step, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const launched = readLines(join(ROOT, 'logs', 'events.jsonl')).filter(r => r.step === step && r.phase === 'worker_launched');
    const finished = readLines(join(ROOT, 'logs', 'workers.jsonl')).filter(r => r.step === step && r.phase === 'finish');
    if (finished.length >= launched.length || Date.now() > deadline) return { launched: launched.length, finished: finished.length };
    await delay(250);
  }
}

// --- step definitions -------------------------------------------------------
// `plants`: canaries the host deterministically writes into the step's own
// source; analysis fails if any is missing. `mayPlant`: model-dependent.

function claudeIsolation(sessionId) {
  return ['-p', '--setting-sources', 'project,local', '--strict-mcp-config', '--mcp-config', '{"mcpServers":{}}',
    '--session-id', sessionId, '--output-format', 'stream-json', '--verbose', '--include-hook-events'];
}

function claudeModelOnly(sessionId, model) {
  return ['-p', '--model', model, '--safe-mode', '--setting-sources', '', '--strict-mcp-config',
    '--mcp-config', '{"mcpServers":{}}', '--tools', '', '--disable-slash-commands', '--no-session-persistence',
    '--session-id', sessionId, '--system-prompt', 'You return compact JSON only.',
    '--output-format', 'stream-json', '--verbose'];
}

const CODEX_DISABLE = ['apps', 'plugins', 'remote_plugin', 'browser_use', 'browser_use_external', 'computer_use',
  'image_generation', 'multi_agent', 'goals', 'tool_suggest', 'daemon_auto_start', 'shell_snapshot',
  'skill_mcp_dependency_install', 'workspace_dependencies', 'in_app_browser', 'memories'];

function codexIsolation(config, { hooks = true, cwd = config.project } = {}) {
  const args = ['exec', '--ignore-user-config', '--ignore-rules', '--skip-git-repo-check', '--json', '-C', cwd,
    ...CODEX_DISABLE.flatMap(feature => ['--disable', feature]),
    '-c', 'history.persistence="none"', '-c', 'allow_login_shell=false', '-c', 'web_search="disabled"',
    '-c', `log_dir="${join(ROOT, 'codex-log')}"`];
  if (hooks) {
    for (const label of ['SessionStart', 'UserPromptSubmit', 'Stop', 'SessionEnd', 'PreCompact', 'PostCompact']) {
      const command = `${HOOK_PREFIX}codex ${label}`;
      args.push('-c', `hooks.${label}=[{hooks=[{type="command",command="${command}",timeout=${label === 'UserPromptSubmit' ? 5 : 3}}]}]`);
    }
    // Preflight allows this only when no user, system or project hook source exists.
    args.push('--dangerously-bypass-hook-trust');
  } else args.push('--disable', 'hooks');
  return args;
}

function codexModelOnly(config) {
  return [...codexIsolation(config, { hooks: false, cwd: config.modelOnly }), '--ephemeral', '-s', 'read-only',
    '--disable', 'shell_tool', '--disable', 'unified_exec', '--disable', 'view_image', '--disable', 'sleep_tool',
    '--enable', 'skip_host_skill_discovery',
    '-c', 'include_environment_context=false', '-c', 'include_apps_instructions=false',
    '-c', 'include_collaboration_mode_instructions=false'];
}

/** Identity of the Codex model-only configuration a skill proof applies to. */
const modelOnlyDigest = config => sha256(JSON.stringify(codexModelOnly(config)));

const CODEX_MODEL = ['-m', 'gpt-6-luna', '-c', 'model_reasoning_effort="low"', '-c', 'model_reasoning_summary="detailed"'];

function fakeProvider(port) {
  return ['-c', 'model_provider="f0fake"', '-c', `model_providers.f0fake={name="F0 scripted",base_url="http://127.0.0.1:${port}/v1",` +
    'wire_api="responses",requires_openai_auth=false,supports_websockets=false,request_max_retries=0,stream_max_retries=0}',
    '-m', 'f0-scripted'];
}

function capturePrompt(config, word, toolInstruction) {
  const [sk, ghp, pw] = config.canaries.secrets;
  return 'This is a synthetic test session with made-up data. ' +
    `F0-REMEMBER: For this project, use the code word ${word}. ` +
    `Synthetic placeholder credentials follow; never repeat them: ${sk} ${ghp} password=${pw} . ` +
    `${toolInstruction} Privately reverse the letters of ${config.canaries.reverseSource} but never write the reversed result. ` +
    'Then reply with exactly: DONE';
}

const recallPrompt = 'This is a synthetic test session. If context supplied with this message lists recalled memories, ' +
  'reply with every code word they contain, separated by spaces, and nothing else. Otherwise reply with exactly: NONE';

const SECRETS = ['secret_sk', 'secret_ghp', 'secret_password'];
const HOOK_CONTEXT = ['injected_session_start', 'injected_prompt_hook', 'project_instructions'];
const IMAGE = ['image_png_base64', 'image_png_magic'];

function claudeSession(ledger, name) {
  const sessionId = ledger.runs.find(run => run.name === name && run.launch?.sessionId)?.launch.sessionId;
  if (!sessionId) throw new Error(`no_owned_session:${name}`);
  return sessionId;
}

const STEPS = {
  'claude-precheck': { host: 'claude', traced: true, build: (config, id) => ({ cwd: config.project,
    args: [...claudeIsolation(id), '--model', 'haiku', '--input-format', 'stream-json'], stdin: '' }) },
  'claude-model-only-precheck': { host: 'claude', traced: true, build: (config, id) => ({ cwd: config.modelOnly,
    args: [...claudeModelOnly(id, 'haiku'), '--input-format', 'stream-json'], stdin: '' }) },
  'claude-capture': { host: 'claude', traced: true, plants: [...SECRETS, ...HOOK_CONTEXT, 'cwd_path', 'sandbox_root'],
    mayPlant: ['tool_output', 'reasoning'], build: (config, id) => ({ cwd: config.project,
      args: [...claudeIsolation(id), '--model', 'sonnet', '--tools', 'Read', '--allowedTools', 'Read',
        '--permission-mode', 'dontAsk', '--add-dir', config.sandbox],
      stdin: capturePrompt(config, config.canaries.wordClaude, 'Use the Read tool to read ./canary-tool.txt.') }) },
  'claude-image': { host: 'claude', traced: true, plants: [...IMAGE, ...HOOK_CONTEXT], build: (config, id) => ({ cwd: config.project,
    args: [...claudeIsolation(id), '--model', 'sonnet', '--tools', '', '--input-format', 'stream-json'],
    stdin: `${JSON.stringify({ type: 'user', message: { role: 'user', content: [
      { type: 'image', source: { type: 'base64', media_type: 'image/png', data: config.canaries.imageBase64 } },
      { type: 'text', text: 'This is a synthetic test image of random pixels. Reply with exactly: DONE' }] } })}\n` }) },
  'claude-recall': { host: 'claude', traced: true, plants: HOOK_CONTEXT, build: (config, id) => ({ cwd: config.project,
    args: [...claudeIsolation(id), '--model', 'sonnet', '--tools', ''], stdin: recallPrompt }) },
  'claude-model-only-traced': { host: 'claude', traced: true, build: (config, id) => ({ cwd: config.modelOnly,
    args: claudeModelOnly(id, 'haiku'), stdin: 'Return {"ok":true}' }) },
  'claude-model-only-a': { host: 'claude', traced: false, build: (config, id) => ({ cwd: config.modelOnly,
    args: claudeModelOnly(id, 'haiku'), stdin: 'Return {"ok":true}' }) },
  'claude-model-only-b': { host: 'claude', traced: false, build: (config, id) => ({ cwd: config.modelOnly,
    args: claudeModelOnly(id, 'haiku'), stdin: 'Return {"ok":true}' }) },
  'claude-sigterm': { host: 'claude', traced: true, interruptAfterMs: 6_000, mayPlant: ['injected_session_start'],
    build: (config, id) => ({ cwd: config.project, args: [...claudeIsolation(id), '--model', 'haiku', '--tools', ''],
      stdin: 'This is a synthetic test session. Write the numbers from 1 to 400, one per line, and nothing else.' }) },
  'claude-untraced': { host: 'claude', traced: false, mayPlant: HOOK_CONTEXT, build: (config, id) => ({ cwd: config.project,
    args: [...claudeIsolation(id), '--model', 'haiku', '--tools', ''],
    stdin: 'This is a synthetic test session. Reply with exactly: DONE' }) },
  'claude-compact': { host: 'claude', traced: true, plants: ['compaction_summary_text'], build: (config, _id, _port, ledger) => {
    const resumes = claudeSession(ledger, 'claude-capture');
    return { cwd: config.project, resumes, stdin: '/compact',
      args: ['-p', '--setting-sources', 'project,local', '--strict-mcp-config', '--mcp-config', '{"mcpServers":{}}',
        '--resume', resumes, '--output-format', 'stream-json', '--verbose', '--include-hook-events', '--model', 'sonnet',
        '--tools', ''] };
  } },
  'codex-precheck': { host: 'codex', traced: true, fake: true,
    plants: [...SECRETS, ...HOOK_CONTEXT, 'cwd_path', 'sandbox_root', 'image_path', ...IMAGE, 'image_data_url',
      'reasoning_scripted', 'tool_output'],
    build: (config, _id, port) => ({ cwd: config.project,
      args: [...codexIsolation(config), ...fakeProvider(port), '-s', 'workspace-write', '--add-dir', config.sandbox,
        '-', '-i', join(config.project, `img-${config.canaries.imagePath}.png`)],
      stdin: capturePrompt(config, config.canaries.wordCodex, 'Run `cat canary-tool.txt` in the shell.') }) },
  'codex-model-only-fake': { host: 'codex', traced: true, fake: true, modelOnly: true, build: (config, _id, port) => ({
    cwd: config.modelOnly, args: [...codexModelOnly(config), ...fakeProvider(port), '-'], stdin: 'Return {"ok":true}' }) },
  'codex-ephemeral-fake': { host: 'codex', traced: true, fake: true, build: (config, _id, port) => ({ cwd: config.project,
    args: [...codexIsolation(config), ...fakeProvider(port), '--ephemeral', '-s', 'read-only', '-'],
    stdin: 'This is a synthetic test session. Reply with exactly: DONE' }) },
  'codex-untraced-fake': { host: 'codex', traced: false, fake: true, plants: ['tool_output', 'reasoning_scripted'],
    build: (config, _id, port) => ({ cwd: config.project,
      args: [...codexIsolation(config), ...fakeProvider(port), '-s', 'read-only', '-'],
      stdin: 'This is a synthetic test session. Run `cat canary-tool.txt` in the shell, then reply with exactly: DONE' }) },
  'codex-compact-fake': { host: 'codex', traced: true, fake: true,
    plants: ['compact_summary_scripted', 'compaction_summary_text', 'tool_output', 'reasoning_scripted'],
    build: (config, _id, port) => ({ cwd: config.project,
      args: [...codexIsolation(config), ...fakeProvider(port), '-s', 'read-only', '-c', 'model_auto_compact_token_limit=20000',
        '-c', `compact_prompt="Synthetic compaction request ${config.canaries.compactMarker}. Summarize."`, '-'],
      stdin: 'This is a synthetic test session. Run `cat canary-tool.txt` in the shell, then reply with exactly: DONE' }) },
  'codex-capture': { host: 'codex', traced: true, plants: [...SECRETS, ...HOOK_CONTEXT, 'cwd_path', 'sandbox_root'],
    mayPlant: ['tool_output', 'reasoning'], build: config => ({ cwd: config.project,
      args: [...codexIsolation(config), ...CODEX_MODEL, '-s', 'workspace-write', '--add-dir', config.sandbox, '-'],
      stdin: capturePrompt(config, config.canaries.wordCodex, 'Run `cat canary-tool.txt` in the shell.') }) },
  'codex-image': { host: 'codex', traced: true, plants: ['image_path', ...IMAGE, 'image_data_url', ...HOOK_CONTEXT],
    build: config => ({ cwd: config.project,
      args: [...codexIsolation(config), ...CODEX_MODEL, '-s', 'read-only',
        '-', '-i', join(config.project, `img-${config.canaries.imagePath}.png`)],
      stdin: 'This is a synthetic test image of random pixels. Reply with exactly: DONE' }) },
  'codex-recall': { host: 'codex', traced: true, plants: HOOK_CONTEXT, build: config => ({ cwd: config.project,
    args: [...codexIsolation(config), ...CODEX_MODEL, '-s', 'read-only', '-'], stdin: recallPrompt }) },
  'codex-tool': { host: 'codex', traced: true, plants: HOOK_CONTEXT, mayPlant: ['tool_output'], build: config => ({
    cwd: config.project, args: [...codexIsolation(config), ...CODEX_MODEL, '-s', 'read-only', '-'],
    stdin: 'This is a synthetic test session. You must run the shell command `cat canary-tool.txt` now. ' +
      'After it finishes, reply with exactly: DONE' }) },
  'codex-model-only-traced': { host: 'codex', traced: true, modelOnly: true, build: config => ({ cwd: config.modelOnly,
    args: [...codexModelOnly(config), '-m', 'gpt-6-luna', '-c', 'model_reasoning_effort="low"', '-'],
    stdin: 'Return {"ok":true}' }) },
  'codex-model-only-a': { host: 'codex', traced: false, modelOnly: true, build: config => ({ cwd: config.modelOnly,
    args: [...codexModelOnly(config), '-m', 'gpt-6-luna', '-c', 'model_reasoning_effort="low"', '-'],
    stdin: 'Return {"ok":true}' }) },
};

// --- isolation gate -----------------------------------------------------------

function evaluateGate(name, config, ledger) {
  const step = STEPS[name];
  let built;
  try { built = step.build(config, randomUUID(), 0, ledger); }
  catch (error) { return { ok: false, checks: [], failures: [{ name: 'step_buildable', ok: false, detail: error.message }] }; }
  const env = { ...cleanEnv(), ...(process.env.WSL_INTEROP ? { WSL_INTEROP: process.env.WSL_INTEROP } : {}) };
  return preflight({ step, built, pins: PINS, home: HOME, binaries: BINARIES, hookPrefix: HOOK_PREFIX, ledger,
    isolationDigest: step.modelOnly ? modelOnlyDigest(config) : null, env });
}

/** Count user-skill names in the requests a scripted model-only step received. */
function skillProof(label, config) {
  const skills = defaultDeps.listDirs(join(HOME, '.codex', 'skills'));
  const bodies = readdirSync(join(ROOT, 'logs')).filter(name => name.startsWith(`fake-request-${label}-`))
    .map(name => readFileSync(join(ROOT, 'logs', name), 'utf8')).filter(body => body.includes('"input"'));
  return { label, isolationDigest: modelOnlyDigest(config), skillSetDigest: skills === null ? null : skillSetDigest(skills),
    skills: skills?.length ?? null, requests: bodies.length,
    hits: skills === null ? null : bodies.reduce((sum, body) => sum + skills.filter(skill => body.includes(skill)).length, 0) };
}

async function runStep(name) {
  const step = STEPS[name];
  if (!step) throw new Error(`unknown step: ${name}; known: ${Object.keys(STEPS).join(', ')}`);
  const ledger = readLedger(ROOT);
  const config = readConfig(ROOT);
  const previous = ledger.runs.filter(run => run.name === name).length;
  if (previous && !process.argv.includes('--retry')) throw new Error(`step already ran: ${name}`);
  if (ledger.used[step.host] >= ledger.budget[step.host]) throw new Error(`budget exhausted for ${step.host}`);
  // Fail-closed isolation gate: nothing is counted or launched unless every check passes.
  const gate = evaluateGate(name, config, ledger);
  if (!gate.ok) {
    console.error(JSON.stringify({ name, preflight: 'failed', failures: gate.failures }, null, 2));
    process.exitCode = 1;
    return;
  }
  ledger.used[step.host]++;
  // Every attempt gets its own label so logs from a retry never mix with earlier attempts.
  const label = previous ? `${name}#${previous + 1}` : name;
  const record = { name, label, host: step.host, traced: step.traced, fakeModel: Boolean(step.fake),
    modelOnly: Boolean(step.modelOnly), attempt: ledger.used[step.host], plants: step.plants ?? [],
    mayPlant: step.mayPlant ?? [], preflight: gate.checks.map(check => check.name) };
  ledger.runs.push(record);
  writeLedger(ROOT, ledger); // the attempt is counted before any process starts

  const guard = createInterruptGuard();
  guard.install();
  let core;
  let fake;
  try {
    Object.assign(config, { step: label, stepName: name, coreUrl: null });
    writeConfig(config); // servers read the step name at startup
    core = await startServer('core-server.mjs', join(ROOT, 'core', 'port'));
    config.coreUrl = `http://127.0.0.1:${core.port}`;
    writeConfig(config);
    if (step.fake) fake = await startServer('fake-responses.mjs', join(ROOT, 'fake-port'));
    const sessionId = randomUUID();
    const built = step.build(config, sessionId, fake?.port, ledger);
    const stracePath = join(ROOT, 'logs', 'strace', `${label}.txt`);
    const binary = BINARIES[step.host];
    // The launch is recorded before the host starts; Claude sessions use the harness-generated ID.
    record.launch = { sessionId: step.host === 'claude' ? (built.resumes ?? sessionId) : null, resumes: built.resumes ?? null,
      cwd: built.cwd, startedAt: Date.now(), pid: null, exitAt: null };
    Object.assign(record, { args: built.args.map(arg => (arg.length > 300 ? `<${arg.length} chars>` : arg)),
      stracePath: step.traced ? stracePath : null,
      stdoutPath: join(ROOT, 'logs', 'host', `${label}.stdout`), stderrPath: join(ROOT, 'logs', 'host', `${label}.stderr`) });
    writeLedger(ROOT, ledger);
    const result = await superviseHost({
      command: step.traced ? 'strace' : binary,
      args: step.traced
        ? ['-f', '--seccomp-bpf', '-qq', '-s', '400', '-e', 'status=successful', '-e',
          'trace=execve,execveat,open,openat,openat2,creat,mkdir,mkdirat,rmdir,rename,renameat,renameat2,unlink,unlinkat,link,linkat,symlink,symlinkat,truncate',
          '-o', stracePath, '--', binary, ...built.args]
        : built.args,
      cwd: built.cwd, env: cleanEnv(), stdin: built.stdin, guard, timeoutMs: 180_000,
      probeInterruptAfterMs: step.interruptAfterMs,
      onSpawn: ({ pid }) => { record.launch.pid = pid; writeLedger(ROOT, ledger); },
      // A Codex thread is bound only from the stdout of the process this orchestrator launched.
      onStdoutLine: line => {
        if (step.host !== 'codex' || record.binding) return;
        let event;
        try { event = JSON.parse(line); } catch { return; }
        if (event?.type !== 'thread.started' || typeof event.thread_id !== 'string') return;
        record.binding = { threadId: event.thread_id, source: 'thread.started', observedAt: Date.now(), pid: record.launch.pid };
        writeLedger(ROOT, ledger);
      },
    });
    record.launch.exitAt = result.exitAt;
    writeFileSync(record.stdoutPath, result.stdout);
    writeFileSync(record.stderrPath, result.stderr);
    Object.assign(record, { startedAt: result.startedAt, exitAt: result.exitAt, exitCode: result.exitCode, signal: result.signal,
      spawnError: result.error ?? null, timedOut: result.timedOut, interruptedAt: result.probeInterruptAt,
      orchestratorInterrupted: result.interrupted, wallMs: result.exitAt - result.startedAt,
      firstOutputMs: result.firstOutputAt ? result.firstOutputAt - result.startedAt : null, sessionId: record.launch.sessionId ?? record.binding?.threadId ?? null });
    writeLedger(ROOT, ledger);
    if (!guard.interrupted) record.workers = await waitForWorkers(label, 45_000);
    if (step.fake && step.modelOnly) record.skillProof = skillProof(label, config);
  } catch (error) {
    record.aborted = String(error?.message ?? error).slice(0, 200);
    if (!guard.interrupted) throw error;
  } finally {
    await stopServer(fake, join(ROOT, 'fake-port'));
    await stopServer(core, join(ROOT, 'core', 'port'));
    writeLedger(ROOT, ledger);
    guard.dispose();
  }
  if (guard.interrupted) process.exitCode = SIGNAL_EXIT[guard.interrupted];
  console.log(JSON.stringify({ name, label, timedOut: record.timedOut, interrupted: guard.interrupted, exitCode: record.exitCode,
    signal: record.signal, wallMs: record.wallMs, sessionId: record.sessionId, workers: record.workers, used: ledger.used }, null, 2));
}

const [command, name] = process.argv.slice(2);
if (command === 'setup') setup();
else if (command === 'preflight') {
  if (!STEPS[name]) throw new Error(`unknown step: ${name}`);
  const gate = evaluateGate(name, readConfig(ROOT), readLedger(ROOT));
  console.log(JSON.stringify({ name, ok: gate.ok, checks: gate.checks }, null, 2));
  if (!gate.ok) process.exitCode = 1;
} else if (command === 'step') await runStep(name);
else if (command === 'status') console.log(JSON.stringify(readLedger(ROOT), null, 2));
else { console.error('usage: run.mjs setup | preflight <name> | step <name> [--retry] | status'); process.exitCode = 1; }

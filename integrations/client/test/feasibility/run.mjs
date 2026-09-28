#!/usr/bin/env node
// F0 orchestrator. Disposable and manual: it starts real host processes and
// must only run with explicit authorization. Never wired into npm test or CI.
//
//   node run.mjs setup                 create the synthetic run root
//   node run.mjs step <name>           run one budgeted host step
//   node run.mjs status                print the budget ledger
import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';
import { deflateSync, crc32 } from 'node:zlib';
import { HARNESS_VERSION, randomTag, readConfig } from './lib/common.mjs';

const TEMP_ROOT = '/tmp/f0-tmp';
const ROOT = join(TEMP_ROOT, 'f0-run');
const HERE = fileURLToPath(new URL('./', import.meta.url));
const NODE = process.execPath;
const HOME = process.env.HOME;
const CLAUDE = join(HOME, '.local/bin/claude');
const CODEX = join(HOME, '.nvm/versions/node/v22.16.0/bin/codex');
const BUDGET = { claude: 24, codex: 24 };
const PINS = { claude: '2.1.283 (Claude Code)', codex: 'codex-cli 0.157.1', node: 'v22.16.0' };

const ledgerPath = join(ROOT, 'ledger.json');
const readLedger = () => JSON.parse(readFileSync(ledgerPath, 'utf8'));
const writeLedger = ledger => writeFileSync(ledgerPath, `${JSON.stringify(ledger, null, 2)}\n`);
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
  if (process.env.TMPDIR !== TEMP_ROOT) throw new Error(`TMPDIR must be ${TEMP_ROOT}`);
  if (existsSync(ROOT)) throw new Error(`run root already exists: ${ROOT}`);
  const tag = () => randomTag(10);
  const reverseSource = randomTag(12);
  const canaries = {
    cwd: `F0CWD${tag()}`, sandbox: `F0SBX${tag()}`, doc: `F0DOC${tag()}`, tool: `F0TOOL${tag()}`,
    injectStart: `F0INJS${tag()}`, injectPrompt: `F0INJP${tag()}`, imagePath: `F0IMGP${tag()}`,
    reverseSource, reasoning: [...reverseSource].reverse().join(''), reasoningFake: `F0RSNF${tag()}`,
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
  writeFileSync(join(project, 'canary-tool.txt'), `Synthetic tool output ${canaries.tool}.\n`);
  writeFileSync(join(project, 'CLAUDE.md'), `Synthetic project note ${canaries.doc}. It is test data.\n`);
  writeFileSync(join(project, 'AGENTS.md'), `Synthetic project note ${canaries.doc}. It is test data.\n`);
  const hook = label => `${NODE} ${join(HERE, 'hook.mjs')} ${ROOT} claude ${label}`;
  const claudeHooks = Object.fromEntries(['SessionStart', 'UserPromptSubmit', 'Stop', 'SessionEnd', 'PreCompact']
    .map(label => [label, [{ hooks: [{ type: 'command', command: hook(label), timeout: label === 'UserPromptSubmit' ? 5 : 3 }] }]]));
  writeFileSync(join(project, '.claude', 'settings.json'), `${JSON.stringify({ hooks: claudeHooks }, null, 2)}\n`);
  writeConfig({ harness: HARNESS_VERSION, step: null, coreUrl: null, token: `f0-synthetic-${randomTag(16)}`,
    stateDir: join(ROOT, 'state'), project, sandbox, modelOnly: join(ROOT, 'model-only'),
    inject: { start: canaries.injectStart, prompt: canaries.injectPrompt },
    workerDelayMs: { SessionEnd: 6_000 }, canaries, pins: PINS });
  writeLedger({ budget: BUDGET, used: { claude: 0, codex: 0 }, runs: [] });
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
  if (!(portOf(portFile) > 0)) throw new Error(`${script} did not start`);
  return { child, port: portOf(portFile) };
}

async function stopServer(server, portFile) {
  if (!server) return;
  server.child.kill('SIGTERM');
  await new Promise(done => server.child.once('exit', done));
  rmSync(portFile, { force: true });
}

// The host runs in its own process group so a timeout can stop every descendant.
function killGroup(child, signal) {
  try { process.kill(-child.pid, signal); } catch (error) { if (error.code !== 'ESRCH') throw error; }
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
      const command = `${NODE} ${join(HERE, 'hook.mjs')} ${ROOT} codex ${label}`;
      args.push('-c', `hooks.${label}=[{hooks=[{type="command",command="${command}",timeout=${label === 'UserPromptSubmit' ? 5 : 3}}]}]`);
    }
    args.push('--dangerously-bypass-hook-trust');
  } else args.push('--disable', 'hooks');
  return args;
}

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

const STEPS = {
  'claude-precheck': { host: 'claude', traced: true, build: (config, id) => ({ cwd: config.project,
    args: [...claudeIsolation(id), '--model', 'haiku', '--input-format', 'stream-json'], stdin: '' }) },
  'claude-model-only-precheck': { host: 'claude', traced: true, build: (config, id) => ({ cwd: config.modelOnly,
    args: [...claudeModelOnly(id, 'haiku'), '--input-format', 'stream-json'], stdin: '' }) },
  'claude-capture': { host: 'claude', traced: true, build: (config, id) => ({ cwd: config.project,
    args: [...claudeIsolation(id), '--model', 'sonnet', '--tools', 'Read', '--allowedTools', 'Read',
      '--permission-mode', 'dontAsk', '--add-dir', config.sandbox],
    stdin: capturePrompt(config, config.canaries.wordClaude, 'Use the Read tool to read ./canary-tool.txt.') }) },
  'claude-image': { host: 'claude', traced: true, build: (config, id) => ({ cwd: config.project,
    args: [...claudeIsolation(id), '--model', 'sonnet', '--tools', '', '--input-format', 'stream-json'],
    stdin: `${JSON.stringify({ type: 'user', message: { role: 'user', content: [
      { type: 'image', source: { type: 'base64', media_type: 'image/png', data: config.canaries.imageBase64 } },
      { type: 'text', text: 'This is a synthetic test image of random pixels. Reply with exactly: DONE' }] } })}\n` }) },
  'claude-recall': { host: 'claude', traced: true, build: (config, id) => ({ cwd: config.project,
    args: [...claudeIsolation(id), '--model', 'sonnet', '--tools', ''], stdin: recallPrompt }) },
  'claude-model-only-traced': { host: 'claude', traced: true, build: (config, id) => ({ cwd: config.modelOnly,
    args: claudeModelOnly(id, 'haiku'), stdin: 'Return {"ok":true}' }) },
  'claude-model-only-a': { host: 'claude', traced: false, build: (config, id) => ({ cwd: config.modelOnly,
    args: claudeModelOnly(id, 'haiku'), stdin: 'Return {"ok":true}' }) },
  'claude-model-only-b': { host: 'claude', traced: false, build: (config, id) => ({ cwd: config.modelOnly,
    args: claudeModelOnly(id, 'haiku'), stdin: 'Return {"ok":true}' }) },
  'codex-precheck': { host: 'codex', traced: true, fake: true, build: (config, _id, port) => ({ cwd: config.project,
    args: [...codexIsolation(config), ...fakeProvider(port), '-s', 'workspace-write', '--add-dir', config.sandbox,
      '-', '-i', join(config.project, `img-${config.canaries.imagePath}.png`)],
    stdin: capturePrompt(config, config.canaries.wordCodex, 'Run `cat canary-tool.txt` in the shell.') }) },
  'codex-model-only-fake': { host: 'codex', traced: true, fake: true, build: (config, _id, port) => ({ cwd: config.modelOnly,
    args: [...codexModelOnly(config), ...fakeProvider(port), '-'], stdin: 'Return {"ok":true}' }) },
  'codex-ephemeral-fake': { host: 'codex', traced: true, fake: true, build: (config, _id, port) => ({ cwd: config.project,
    args: [...codexIsolation(config), ...fakeProvider(port), '--ephemeral', '-s', 'read-only', '-'],
    stdin: 'This is a synthetic test session. Reply with exactly: DONE' }) },
  'claude-sigterm': { host: 'claude', traced: true, interruptAfterMs: 6_000, build: (config, id) => ({ cwd: config.project,
    args: [...claudeIsolation(id), '--model', 'haiku', '--tools', ''],
    stdin: 'This is a synthetic test session. Write the numbers from 1 to 400, one per line, and nothing else.' }) },
  'claude-untraced': { host: 'claude', traced: false, build: (config, id) => ({ cwd: config.project,
    args: [...claudeIsolation(id), '--model', 'haiku', '--tools', ''],
    stdin: 'This is a synthetic test session. Reply with exactly: DONE' }) },
  'codex-untraced-fake': { host: 'codex', traced: false, fake: true, build: (config, _id, port) => ({ cwd: config.project,
    args: [...codexIsolation(config), ...fakeProvider(port), '-s', 'read-only', '-'],
    stdin: 'This is a synthetic test session. Run `cat canary-tool.txt` in the shell, then reply with exactly: DONE' }) },
  'claude-compact': { host: 'claude', traced: true, build: config => ({ cwd: config.project,
    args: ['-p', '--setting-sources', 'project,local', '--strict-mcp-config', '--mcp-config', '{"mcpServers":{}}',
      '--resume', readLedger().runs.find(run => run.name === 'claude-capture').sessionId, '--output-format', 'stream-json',
      '--verbose', '--include-hook-events', '--model', 'sonnet', '--tools', ''], stdin: '/compact' }) },
  'codex-compact-fake': { host: 'codex', traced: true, fake: true, build: (config, _id, port) => ({ cwd: config.project,
    args: [...codexIsolation(config), ...fakeProvider(port), '-s', 'read-only', '-c', 'model_auto_compact_token_limit=20000',
      '-c', `compact_prompt="Synthetic compaction request ${config.canaries.compactMarker}. Summarize."`, '-'],
    stdin: 'This is a synthetic test session. Run `cat canary-tool.txt` in the shell, then reply with exactly: DONE' }) },
  'codex-tool': { host: 'codex', traced: true, build: config => ({ cwd: config.project,
    args: [...codexIsolation(config), ...CODEX_MODEL, '-s', 'read-only', '-'],
    stdin: 'This is a synthetic test session. You must run the shell command `cat canary-tool.txt` now. ' +
      'After it finishes, reply with exactly: DONE' }) },
  'codex-capture': { host: 'codex', traced: true, build: config => ({ cwd: config.project,
    args: [...codexIsolation(config), ...CODEX_MODEL, '-s', 'workspace-write', '--add-dir', config.sandbox, '-'],
    stdin: capturePrompt(config, config.canaries.wordCodex, 'Run `cat canary-tool.txt` in the shell.') }) },
  'codex-image': { host: 'codex', traced: true, build: config => ({ cwd: config.project,
    args: [...codexIsolation(config), ...CODEX_MODEL, '-s', 'read-only',
      '-', '-i', join(config.project, `img-${config.canaries.imagePath}.png`)],
    stdin: 'This is a synthetic test image of random pixels. Reply with exactly: DONE' }) },
  'codex-recall': { host: 'codex', traced: true, build: config => ({ cwd: config.project,
    args: [...codexIsolation(config), ...CODEX_MODEL, '-s', 'read-only', '-'], stdin: recallPrompt }) },
  'codex-model-only-traced': { host: 'codex', traced: true, build: config => ({ cwd: config.modelOnly,
    args: [...codexModelOnly(config), '-m', 'gpt-6-luna', '-c', 'model_reasoning_effort="low"', '-'],
    stdin: 'Return {"ok":true}' }) },
  'codex-model-only-a': { host: 'codex', traced: false, build: config => ({ cwd: config.modelOnly,
    args: [...codexModelOnly(config), '-m', 'gpt-6-luna', '-c', 'model_reasoning_effort="low"', '-'],
    stdin: 'Return {"ok":true}' }) },
};

function codexModelOnly(config) {
  return [...codexIsolation(config, { hooks: false, cwd: config.modelOnly }), '--ephemeral', '-s', 'read-only',
    '--disable', 'shell_tool', '--disable', 'unified_exec', '--disable', 'view_image', '--disable', 'sleep_tool',
    '--enable', 'skip_host_skill_discovery',
    '-c', 'include_environment_context=false', '-c', 'include_apps_instructions=false',
    '-c', 'include_collaboration_mode_instructions=false'];
}

async function runStep(name) {
  const step = STEPS[name];
  if (!step) throw new Error(`unknown step: ${name}; known: ${Object.keys(STEPS).join(', ')}`);
  const ledger = readLedger();
  const previous = ledger.runs.filter(run => run.name === name).length;
  if (previous && !process.argv.includes('--retry')) throw new Error(`step already ran: ${name}`);
  if (ledger.used[step.host] >= ledger.budget[step.host]) throw new Error(`budget exhausted for ${step.host}`);
  ledger.used[step.host]++;
  // Every attempt gets its own label so logs from a retry never mix with earlier attempts.
  const label = previous ? `${name}#${previous + 1}` : name;
  const record = { name, label, host: step.host, traced: step.traced, fakeModel: Boolean(step.fake),
    attempt: ledger.used[step.host] };
  ledger.runs.push(record);
  writeLedger(ledger); // count the attempt before any process starts

  const config = readConfig(ROOT);
  config.step = label;
  config.coreUrl = null;
  writeConfig(config); // servers read the step name at startup
  const core = await startServer('core-server.mjs', join(ROOT, 'core', 'port'));
  config.coreUrl = `http://127.0.0.1:${core.port}`;
  writeConfig(config);
  let fake;
  try {
    if (step.fake) fake = await startServer('fake-responses.mjs', join(ROOT, 'fake-port'));
    const sessionId = randomUUID();
    const built = step.build(config, sessionId, fake?.port);
    const binary = step.host === 'claude' ? CLAUDE : CODEX;
    const stracePath = join(ROOT, 'logs', 'strace', `${label}.txt`);
    const command = step.traced ? 'strace' : binary;
    const args = step.traced
      ? ['-f', '--seccomp-bpf', '-qq', '-s', '400', '-e', 'status=successful', '-e',
        'trace=execve,execveat,open,openat,openat2,creat,mkdir,mkdirat,rmdir,rename,renameat,renameat2,unlink,unlinkat,link,linkat,symlink,symlinkat,truncate',
        '-o', stracePath, '--', binary, ...built.args]
      : built.args;
    Object.assign(record, { sessionId: step.host === 'claude' ? sessionId : null, cwd: built.cwd,
      args: built.args.map(arg => (arg.length > 300 ? `<${arg.length} chars>` : arg)), stracePath: step.traced ? stracePath : null,
      stdoutPath: join(ROOT, 'logs', 'host', `${label}.stdout`), stderrPath: join(ROOT, 'logs', 'host', `${label}.stderr`) });
    const startedAt = Date.now();
    const child = spawn(command, args, { cwd: built.cwd, env: cleanEnv(), stdio: ['pipe', 'pipe', 'pipe'], detached: true });
    const out = []; const err = [];
    let firstOutputAt;
    child.stdout.on('data', chunk => { firstOutputAt ??= Date.now(); out.push(chunk); });
    child.stderr.on('data', chunk => err.push(chunk));
    child.stdin.end(built.stdin);
    let timedOut = false;
    // Teardown probe: signal the host's whole process group mid-response.
    const interrupt = step.interruptAfterMs ? setTimeout(() => {
      record.interruptedAt = Date.now();
      killGroup(child, 'SIGTERM');
    }, step.interruptAfterMs) : null;
    const timer = setTimeout(() => {
      timedOut = true;
      killGroup(child, 'SIGTERM');
      setTimeout(() => killGroup(child, 'SIGKILL'), 5_000).unref();
    }, 180_000);
    const [exitCode, signal] = await new Promise(done => child.once('close', (code, sig) => done([code, sig])));
    clearTimeout(timer);
    if (interrupt) clearTimeout(interrupt);
    record.timedOut = timedOut;
    const exitAt = Date.now();
    writeFileSync(record.stdoutPath, Buffer.concat(out));
    writeFileSync(record.stderrPath, Buffer.concat(err));
    Object.assign(record, { startedAt, exitAt, exitCode, signal, wallMs: exitAt - startedAt,
      firstOutputMs: firstOutputAt ? firstOutputAt - startedAt : null });
    if (step.host === 'codex') {
      const started = Buffer.concat(out).toString('utf8').split('\n').filter(Boolean)
        .map(line => { try { return JSON.parse(line); } catch { return null; } })
        .find(event => event?.type === 'thread.started');
      record.sessionId = started?.thread_id ?? null;
    }
    record.workers = await waitForWorkers(label, 45_000);
  } finally {
    await stopServer(fake, join(ROOT, 'fake-port'));
    await stopServer(core, join(ROOT, 'core', 'port'));
    const latest = readLedger();
    latest.runs[latest.runs.length - 1] = record;
    writeLedger(latest);
  }
  console.log(JSON.stringify({ name, label, timedOut: record.timedOut, exitCode: record.exitCode, signal: record.signal, wallMs: record.wallMs,
    sessionId: record.sessionId, workers: record.workers, used: readLedger().used }, null, 2));
}

const [command, name] = process.argv.slice(2);
if (command === 'setup') setup();
else if (command === 'step') await runStep(name);
else if (command === 'status') console.log(JSON.stringify(readLedger(), null, 2));
else { console.error('usage: run.mjs setup | step <name> [--retry] | status'); process.exitCode = 1; }

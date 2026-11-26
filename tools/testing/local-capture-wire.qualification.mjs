import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { appendFileSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { command } from '../../packaging/build.mjs';
import { sha256 } from '../../packaging/core-local/engine-id.mjs';

const repo = fileURLToPath(new URL('../..', import.meta.url));
const goldenPath = join(repo, 'packaging/test/fixtures/installed-local-0.6.11-capture.json');
const revision = 'installer-v0.6.11:packages/setup/runtime/engine/';
const packageName = 'cairn-memory-local-preview';
const archiveName = packageName + '-0.0.0-preview.1.tgz';
const root = mkdtempSync(join(tmpdir(), 'cairn-capture-wire-'));
const home = join(root, 'home');
const env = { HOME: home, PATH: dirname(process.execPath) + ':/usr/bin:/bin', LANG: 'C.UTF-8' };
const trace = join(root, 'calls.jsonl');
const read = path => JSON.parse(readFileSync(path, 'utf8'));
const moduleAt = (directory, within) => import(pathToFileURL(join(directory, within)).href);
const directory = path => { mkdirSync(path, { mode: 0o700 }); return path; };
const privateWrite = (path, value) => writeFileSync(path, value, { mode: 0o600 });
const line = value => JSON.stringify(value) + '\n';
const iso = '2025-01-01T00:00:00.000Z';
const owner = 'synthetic-owner';
const sentinel = 'Synthetic deleted conversation sentinel.';
const personal = { ownerId: owner, scope: 'personal', projectId: null };
const project = { ownerId: owner, scope: 'project', projectId: 'synthetic-capture-project' };
const sessions = {
  claude: '11111111-1111-4111-8111-111111111111',
  codex: '22222222-2222-4222-8222-222222222222',
  fork: '33333333-3333-4333-8333-333333333333',
};
const flags = ['--disable-warning=ExperimentalWarning'];
const prefix = ['/usr/bin/env', '-u', 'NODE_OPTIONS', '-u', 'NODE_PATH'];
const node = process.execPath;

function child(executable, args, input, cwd = root) {
  const result = spawnSync(executable, args, { cwd, env, input, encoding: 'utf8', timeout: 20_000,
    maxBuffer: 4 * 1024 * 1024 });
  assert.ifError(result.error);
  assert.equal(result.signal, null);
  return { exit: result.status, stdout: result.stdout, stderr: result.stderr };
}
function ok(result) {
  assert.equal(result.exit, 0, result.stderr || result.stdout);
  return result.stdout;
}
function sql(path, work) {
  const db = new DatabaseSync(path, { readOnly: true });
  try { return work(db); }
  finally { db.close(); }
}
function installBaseline() {
  const directoryPath = directory(join(root, 'legacy'));
  const blob = path => {
    const result = spawnSync('git', ['show', revision + path], { cwd: repo, env, timeout: 15_000, maxBuffer: 16 * 1024 * 1024 });
    assert.ifError(result.error);
    assert.equal(result.status, 0);
    return result.stdout;
  };
  const manifest = JSON.parse(blob('manifest.json'));
  const bytes = blob(archiveName);
  assert.equal(bytes.length, manifest.bytes);
  assert.equal(sha256(bytes), manifest.sha256);
  const archive = join(directoryPath, archiveName), npmrc = join(directoryPath, 'empty.npmrc');
  privateWrite(archive, bytes);
  privateWrite(npmrc, '');
  command('npm', ['install', '--offline', '--ignore-scripts', '--no-audit', '--no-fund', '--no-package-lock',
    archive], directoryPath, npmrc);
  const installed = join(directoryPath, 'node_modules', packageName);
  const lock = read(join(installed, 'npm-shrinkwrap.json'));
  for (const name of ['@modelcontextprotocol/server', '@modelcontextprotocol/core', 'zod', 'tiktoken']) {
    assert.equal(read(join(directoryPath, 'node_modules', name, 'package.json')).version,
      lock.packages['node_modules/' + name].version);
  }
  return installed;
}

// A private synthetic executable provides real /proc ancestry. It never runs
// Codex or its schema generator and waits for the actual hook process to close.
function fakeCodex() {
  const path = join(root, 'codex');
  const source = join(root, 'native.c');
  privateWrite(source, `#include <signal.h>
#include <sys/prctl.h>
#include <sys/wait.h>
#include <unistd.h>
int main(int argc, char **argv) {
  if (argc < 3) return 120;
  int report[2];
  if (pipe(report)) return 121;
  pid_t detach = fork();
  if (detach < 0) return 122;
  if (detach == 0) {
    close(report[0]);
    pid_t original = getpid();
    pid_t native = fork();
    if (native < 0) _exit(123);
    if (native > 0) _exit(0);
    // Reparent before running so the synthetic native process is the only
    // Codex interpreter in the hook's process ancestry.
    alarm(18);
    while (getppid() == original) usleep(1000);
    pid_t parent = getpid();
    pid_t hook = fork();
    if (hook == 0) {
      close(report[1]);
      if (prctl(PR_SET_PDEATHSIG, SIGKILL) || getppid() != parent) _exit(124);
      execv(argv[2], argv + 2);
      _exit(125);
    }
    int status;
    unsigned char result = (hook > 0 && waitpid(hook, &status, 0) == hook && WIFEXITED(status)) ? WEXITSTATUS(status) : 126;
    if (write(report[1], &result, 1) != 1) _exit(127);
    _exit(0);
  }
  close(report[1]);
  int status;
  unsigned char result;
  if (waitpid(detach, &status, 0) != detach || !WIFEXITED(status) || WEXITSTATUS(status)) return 128;
  if (read(report[0], &result, 1) != 1) return 129;
  return result;
}
`);
  ok(child('/usr/bin/cc', [source, '-o', path]));
  return path;
}

function instrumentation() {
  const path = join(root, 'observe.mjs');
  privateWrite(path, `import { appendFileSync } from 'node:fs';
import childProcess from 'node:child_process';
import { registerHooks, syncBuiltinESMExports } from 'node:module';
const path = ${JSON.stringify(trace)};
const record = value => appendFileSync(path, JSON.stringify(value) + '\\n');
globalThis.fetch = () => { record({ kind: 'model' }); throw Error('provider called'); };
const spawn = childProcess.spawn;
childProcess.spawn = (file, args, options) => {
  const capture = args?.[0]?.endsWith('/adapters/local/cli.mjs');
  const child = spawn(file, capture ? ['--import', import.meta.url, ...args] : args, options);
  if (capture) {
    let reply = '';
    child.stdout.on('data', bytes => { reply += bytes; });
    child.on('close', (exit, signal) => record({ kind: 'ack', exit, signal, reply }));
  }
  return child;
};
registerHooks({ load(url, context, next) {
  const result = next(url, context);
  if (url.endsWith('/adapters/local/guarded-model.mjs')) {
    const original = result.source.toString().replace('export function guardedModel(', 'function observedModel(');
    return { ...result, source: original + \`\nimport { appendFileSync as recordModel } from 'node:fs';
export function guardedModel(...args) {
  const value = observedModel(...args);
  const ports = Object.entries(value.model).map(([key, operation]) => [key, typeof operation === 'function' &&
    !/^(?:count|fits)/.test(key) ? () => {
      recordModel(\${JSON.stringify(path)}, JSON.stringify({ kind: 'model' }) + String.fromCharCode(10));
      throw Error('unexpected model port call');
    } : operation]);
  return { ...value, model: Object.fromEntries(ports) };
}
\` };
  }
  const name = url.endsWith('/integrations/client/raw/local-hook.mjs') ? 'runLocalRawHook' :
    url.endsWith('/packaging/core-local/capture-hook.mjs') ? 'runBoundCapture' : null;
  if (!name) return result;
  const original = result.source.toString().replace('export async function ' + name + '(', 'async function observedHook(');
  return { ...result, source: original + \`\nimport { appendFileSync as traceHook } from 'node:fs';
export async function \${name}(...args) {
  const outcome = await observedHook(...args);
  traceHook(\${JSON.stringify(path)}, JSON.stringify({ kind: 'hook', outcome }) + String.fromCharCode(10));
  return outcome;
}
\` };
} });
syncBuiltinESMExports();
`);
  return path;
}
function calls() {
  return readFileSync(trace, 'utf8').split('\n').filter(Boolean).map(JSON.parse);
}

function cases() {
  const cl = (id, text) => ({ type: 'user', uuid: id, timestamp: iso, promptSource: 'typed',
    message: { content: [{ type: 'text', text }] } });
  const cx = (session, id, text) => ({ type: 'event_msg', timestamp: iso, payload: { type: 'item_completed',
    thread_id: session, turn_id: 'synthetic-turn', item: { type: 'UserMessage', id, content: [{ type: 'text', text }] } } });
  const header = id => ({ type: 'session_meta', payload: { id, cli_version: '0.162.0',
    history_mode: 'paginated', source: 'cli', originator: 'codex-tui' } });
  return [
    { label: 'claude start', client: 'claude', event: 'SessionStart' },
    { label: 'claude append', client: 'claude', event: 'Stop',
      append: line(cl('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', sentinel)) },
    { label: 'claude repeat', client: 'claude', event: 'Stop' },
    { label: 'claude partial', client: 'claude', event: 'PreCompact',
      append: line(cl('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', 'Synthetic completed partial record.')).slice(0, -1) },
    { label: 'claude complete', client: 'claude', event: 'PreCompact', append: '\n' },
    { label: 'claude invalid event', client: 'claude', event: 'Stop', payload: { hook_event_name: 'SessionStart' } },
    { label: 'claude malformed stdin', client: 'claude', event: 'Stop', literal: '{' },
    { label: 'codex partial start', client: 'codex', event: 'SessionStart', append: line(header(sessions.codex)).slice(0, -1) },
    { label: 'codex prompt fallback', client: 'codex', event: 'UserPromptSubmit', append: '\n' },
    { label: 'codex repeat prompt', client: 'codex', event: 'UserPromptSubmit' },
    { label: 'codex append', client: 'codex', event: 'Stop',
      append: line(cx(sessions.codex, 'synthetic-codex-turn', 'Synthetic Codex turn.')) },
    { label: 'codex precompact', client: 'codex', event: 'PreCompact',
      append: line(cx(sessions.codex, 'synthetic-codex-compact', 'Synthetic Codex compact turn.')) },
    { label: 'codex fork start', client: 'codex', source: 'fork', event: 'SessionStart', payload: { source: 'fork' },
      append: line(header(sessions.fork)) + line(cx(sessions.fork, 'synthetic-fork-history', 'Synthetic fork history.')) },
    { label: 'codex fork prompt', client: 'codex', source: 'fork', event: 'UserPromptSubmit' },
    { label: 'codex fork stop', client: 'codex', source: 'fork', event: 'Stop',
      append: line(cx(sessions.fork, 'synthetic-fork-tail', 'Synthetic fork tail.')) },
    { label: 'codex paused', client: 'codex', event: 'Stop', control: 'pause',
      append: line(cx(sessions.codex, 'synthetic-paused', 'Synthetic paused tail.')) },
    { label: 'claude delete restart', client: 'claude', event: 'SessionStart', control: 'delete',
      payload: { source: 'resume' } },
    { label: 'claude deleted replay', client: 'claude', event: 'Stop',
      append: line(cl('cccccccc-cccc-4ccc-8ccc-cccccccccccc', 'Synthetic appended after delete.')) },
    { label: 'claude scoped disabled', client: 'claude', event: 'PreCompact', control: 'disable',
      append: line(cl('dddddddd-dddd-4ddd-8ddd-dddddddddddd', 'Synthetic disabled tail.')) },
  ];
}

const quote = value => "'" + value.replaceAll("'", "'\\''") + "'";
function normalizeUuid(value, seen) {
  assert.match(value, /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/u);
  if (!seen.has(value)) seen.set(value, '<uuid-' + (seen.size + 1) + '>');
  return seen.get(value);
}
function time(value) {
  assert.ok(Number.isSafeInteger(value) && Math.abs(value - Date.now()) < 300_000);
  return '<timestamp-ms>';
}
function cursorFilename(directoryPath) {
  const state = join(directoryPath, 'state/sessions');
  let files;
  try { files = readdirSync(state); }
  catch (error) { if (error.code === 'ENOENT') return null; throw error; }
  const entries = files.filter(name => /^[a-f0-9]{64}\.json$/u.test(name));
  if (!entries.length) return null;
  assert.equal(entries.length, 1);
  return entries[0];
}

function cursor(directoryPath) {
  const name = cursorFilename(directoryPath);
  return name ? cursorProgress(read(join(directoryPath, 'state', 'sessions', name))) : null;
}

function cursorProgress(value) {
  const { offset, issuedOrdinal, selection, blockedReason, pending } = value;
  return { offset, issuedOrdinal, selection, blockedReason,
    pending: pending && { state: pending.state, attempts: pending.attempts,
      nextEligibleAt: pending.nextEligibleAt === null ? null : time(pending.nextEligibleAt),
      lastAttemptAt: pending.lastAttemptAt === null ? null : time(pending.lastAttemptAt) } };
}

function archived(database) {
  return sql(database, db => db.prepare(`SELECT c.client, p.saved, p.reason, CAST(p.sealed AS TEXT) AS content, m.occurred_at AS occurredAt
    FROM raw_parts p JOIN raw_conversations c ON c.id=p.conversation_id
    JOIN raw_messages m ON m.conversation_id=p.conversation_id AND m.message_id=p.message_id
    ORDER BY c.client,m.ordinal,p.part_index`).all().map(row => ({ ...row })));
}

function setupSeed() {
  const path = join(root, 'seed-installation.mjs');
  privateWrite(path, `import crypto, { createHash } from 'node:crypto';
import { syncBuiltinESMExports } from 'node:module';
const fixture = process.argv.slice(2).includes('--request') ?
  (process.argv[4].endsWith('/claude-request.json') ? 'claude' : 'codex') : process.argv[2];
let ordinal = 0;
function syntheticBytes(label, length) {
  const bytes = createHash('sha256').update(JSON.stringify(['synthetic-capture-fixture', fixture, label, ordinal++])).digest();
  if (length > bytes.length) throw Error('fixture seed length');
  return bytes.subarray(0, length);
}
crypto.randomUUID = () => {
  const bytes = syntheticBytes('uuid', 16);
  bytes[6] = 0x40 | (bytes[6] & 0x0f);
  bytes[8] = 0x80 | (bytes[8] & 0x3f);
  const text = bytes.toString('hex');
  return [text.slice(0, 8), text.slice(8, 12), text.slice(12, 16), text.slice(16, 20), text.slice(20)].join('-');
};
const randomBytes = crypto.randomBytes;
crypto.randomBytes = (length, callback) => length === 32 && callback === undefined ?
  syntheticBytes('installation-key', length) : randomBytes(length, callback);
syncBuiltinESMExports();
`);
  return path;
}

async function prepareBaseline(installed, binary, database) {
  const cli = join(installed, 'integrations/client/raw/local-setup-cli.mjs');
  const seed = setupSeed();
  const setup = (args, expected) =>
    assert.equal(JSON.parse(ok(child(node, [...flags, '--import', seed, cli, ...args]))).status, expected);
  setup(['init', '--database', database], 'initialized');
  const usage = directory(join(root, 'usage'));
  const capture = directory(join(root, 'capture'));
  const clients = {};
  for (const [name, client, namespace] of [['claude', 'claude-code', project], ['codex', 'codex', personal]]) {
    const config = directory(join(home, name));
    const installationDirectory = join(capture, name);
    const sourceRoot = directory(join(config, 'sources'));
    const sourcePath = join(sourceRoot, 'selected.jsonl');
    const clientConfigPath = join(config, 'settings.json');
    const support = directory(join(config, 'support'));
    const usageRoot = directory(join(usage, name));
    const installation = name === 'claude' ? { pluginRoot: support } : { qualificationConfigPath: join(support, 'installation.json') };
    if (name === 'codex') {
      const { binaryIdentity, canonical, KNOWN_FORMATS } = await moduleAt(installed, 'integrations/codex/qualification.mjs');
      const identity = await binaryIdentity(binary);
      privateWrite(installation.qualificationConfigPath, '{}\n');
      const cache = directory(join(support, 'qualification'));
      privateWrite(join(cache, identity + '.json'), line({ policy: sha256(canonical(KNOWN_FORMATS)), identity,
        version: '0.162.0', status: 'qualified', fingerprint: KNOWN_FORMATS[1] }));
    }
    const request = { version: 'local-raw-setup-request-v1', installationDirectory, databasePath: database,
      namespace, client, sourceRoot, clientConfigPath, usageRoot, installation, rawMode: 'local-plain-v1', rawCapBytes: 1_000_000,
      dailyCap: 20, providerApiKeyEnv: 'OPENAI_API_KEY', interpretationConsent: false,
      plaintextRawConsent: true, foregroundConsent: true };
    const requestPath = join(root, name + '-request.json');
    privateWrite(requestPath, line(request));
    privateWrite(clientConfigPath, '{}\n');
    privateWrite(sourcePath, '');
    setup(['setup', '--request', requestPath], 'prepared');
    setup(['activate', '--installation', installationDirectory], 'active');
    clients[name] = { request, sourcePath };
  }
  const forkPath = join(clients.codex.request.sourceRoot, 'fork.jsonl');
  privateWrite(forkPath, '');
  return { clients, cli, forkPath };
}

async function baseline(installed) {
  const database = join(root, 'baseline.sqlite'), binary = fakeCodex(), preload = instrumentation();
  const { clients, cli, forkPath } = await prepareBaseline(installed, binary, database);
  const { openMemoryCore } = await moduleAt(installed, 'core/index.mjs');
  const exchanges = [], generatedIds = new Map();
  for (const step of cases()) {
    const { request, sourcePath: selected } = clients[step.client];
    const { installationDirectory, clientConfigPath, namespace } = request;
    const source = step.source === 'fork' ? forkPath : selected;
    if (step.append) appendFileSync(source, step.append);
    if (step.control === 'delete') {
      const conversation = sql(database, db => db.prepare("SELECT id FROM raw_conversations WHERE client='claude-code'").get());
      const output = ok(child(node, [...flags, join(installed, 'bin/cairn-memory.mjs'), 'raw', 'delete',
        '--db', database, '--owner', owner, '--project', project.projectId, '--conversation', conversation.id, '--yes']));
      assert.equal(JSON.parse(output).ok, true);
      const deleted = JSON.parse(output);
      assert.equal(deleted.dryRun, false);
      assert.equal(deleted.messageCount, 2);
      assert.equal(deleted.conversationId, conversation.id);
      normalizeUuid(deleted.actionId, generatedIds);
    } else if (step.control) {
      const old = openMemoryCore({ path: database, rawConversations: { mode: 'off', configureCap: false,
        readPolicy: () => ({ generation: 'synthetic', reason: 'tool_off' }) } });
      try {
        const current = old.getCaptureControl({ namespace });
        assert.equal(current.ok, true);
        let result;
        if (step.control === 'pause') result = old.setCapturePaused({ namespace, expectedGeneration: current.value.generation, paused: true });
        if (step.control === 'disable') result = old.setProjectCapture({ namespace, expectedGeneration: current.value.generation, enabled: false });
        assert.equal(result.ok, true, JSON.stringify(result));
      } finally { await old.close(); }
    }
    const suffix = ['hook', '--installation', installationDirectory, '--event', step.event];
    const command = read(clientConfigPath).hooks[step.event].at(-1).hooks[0];
    const native = [...prefix, node, cli, ...suffix];
    assert.deepEqual(command, { type: 'command', command: native.map(quote).join(' '), timeout: 160 });
    const payload = { hook_event_name: step.event, session_id: sessions[step.source ?? step.client], transcript_path: source, ...step.payload };
    const input = step.literal ?? JSON.stringify(payload);
    const replay = [prefix[0], ...prefix.slice(1), node, ...flags, '--import', preload, cli, ...suffix];
    const before = calls().length;
    const outcome = step.client === 'codex' ? child(binary, ['hook-fixture', ...replay], input) : child(replay[0], replay.slice(1), input);
    const observations = calls().slice(before);
    const acknowledgements = observations.filter(({ kind }) => kind === 'ack').map(({ exit, signal, reply }) => {
      assert.equal(exit, 0);
      assert.equal(signal, null);
      const value = JSON.parse(reply);
      if (value.body?.raw?.conversationId) value.body.raw.conversationId = normalizeUuid(value.body.raw.conversationId, generatedIds);
      return { exit, signal, reply: value };
    });
    const closedFileContainsDeletedText = step.control === 'delete' || step.label === 'claude deleted replay'
      ? readFileSync(database).includes(sentinel) : null;
    exchanges.push({ label: step.label, argv: [...prefix, '$node', '$hook', 'hook', '--installation', '$installation', '--event', step.event],
      stdin: step.literal ?? JSON.stringify({ ...payload, transcript_path: '$transcript' }), ...outcome,
      cursor: cursor(installationDirectory), archived: archived(database), acknowledgements,
      hook: observations.find(row => row.kind === 'hook')?.outcome ?? null,
      modelCalls: observations.filter(({ kind }) => kind === 'model').length, closedFileContainsDeletedText });
  }
  assert.ok(exchanges.find(row => row.label === 'claude append').archived.some(row => row.content?.includes(sentinel)));
  assert.ok(exchanges.find(row => row.label === 'codex append').archived.some(row => row.content?.includes('Synthetic Codex turn.')));
  assert.equal(exchanges.filter(row => row.closedFileContainsDeletedText !== null).length, 2);
  for (const row of exchanges.filter(row => row.closedFileContainsDeletedText !== null)) {
    assert.ok(!row.archived.some(raw => raw.client === 'claude-code'), row.label);
  }
  assert.ok(exchanges.every(row => row.exit === 0 && row.stdout === '' && row.stderr === '' && row.modelCalls === 0));
  return exchanges;
}

try {
  directory(home);
  privateWrite(trace, '');
  const installed = installBaseline();
  const mode = process.argv[2];
  if (mode === '--candidate') {
    const { runCandidate } = await import('./local-capture-wire-candidate.mjs');
    await runCandidate({ root, home, installed, child, ok, sql, read, privateWrite, directory, moduleAt, flags,
      cases, sessions, sentinel, fakeCodex, prepareBaseline, cursor, cursorFilename, golden: read(goldenPath), instrumentation, calls, node, env });
  } else {
    const observed = { version: '0.6.11', exchanges: await baseline(installed) };
    if (mode === '--record') writeFileSync(goldenPath, JSON.stringify(observed, null, 2) + '\n');
    else {
      assert.equal(mode, '--baseline');
      const wanted = read(goldenPath);
      assert.deepEqual(observed, wanted);
      const altered = structuredClone(wanted);
      altered.exchanges[1].stdout = 'altered reply';
      assert.throws(() => assert.deepEqual(observed, altered), { code: 'ERR_ASSERTION' });
    }
    const count = observed.exchanges.length;
    const physical = observed.exchanges.filter(row => row.closedFileContainsDeletedText === true).length;
    console.log('Installed capture matched ' + count + ' of ' + count + ', with 0 model calls.');
    console.log('Installed closed file retained sentinel bytes in ' + physical + ' of 2 post-delete checks.');
  }
} finally { rmSync(root, { recursive: true, force: true }); }

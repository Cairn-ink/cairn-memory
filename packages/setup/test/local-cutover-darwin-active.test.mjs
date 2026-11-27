import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { once } from 'node:events';
import { existsSync, readFileSync, statSync, unlinkSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { createInterface } from 'node:readline';
import { DatabaseSync } from 'node:sqlite';
import test from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { golden } from '../../../packaging/test/fixtures/local-host-wire-replay.mjs';
import { createTestWorkspace } from '../../../tools/testing/workspace.mjs';
import { localCutoverExclusion } from '../lib/local-cutover-lease.mjs';
import { SQLITE_PHYSICAL_VERSION } from '../../adapter-sqlite/src/schema/layout.mjs';

const mac = process.platform === 'darwin';
const owner = 'synthetic-owner', project = 'synthetic-project';
const legacyText = 'Synthetic lapis stone retained across installers.';
const explicitText = 'Synthetic forgettable argillite marker.';
const rawText = 'Synthetic cuprite capture payload.';
const flags = ['--disable-warning=ExperimentalWarning'];
const read = path => JSON.parse(readFileSync(path, 'utf8'));
const descriptor = f => read(join(f.root, 'installation.json'));
const registration = f => read(join(f.home, '.claude.json')).mcpServers['cairn-local'];
const jsonLines = text => text.trim().split('\n').filter(Boolean).map(JSON.parse);
const scriptPath = name => fileURLToPath(new URL(name, import.meta.url));

function runNode(args, options = {}) {
  const result = spawnSync(process.execPath, [...flags, ...args], {
    env: {}, encoding: 'utf8', timeout: 30_000, killSignal: 'SIGKILL', ...options,
  });
  assert.ifError(result.error);
  assert.equal(result.signal, null);
  assert.equal(result.status, 0, result.stdout + result.stderr);
  return { stdout: result.stdout, stderr: result.stderr };
}

function preload(directory, simulated) {
  const trace = join(directory, 'unexpected-calls');
  const capture = join(directory, 'capture-outcomes');
  const path = join(directory, 'observe.mjs');
  const observedSource = `
import { appendFileSync as recordOutcome } from 'node:fs';
export async function runBoundCapture(...args) {
  const result = await observedCapture(...args);
  recordOutcome(${JSON.stringify(capture)}, JSON.stringify(result) + String.fromCharCode(10));
  return result;
}
`;
  writeFileSync(path, `
import child from 'node:child_process';
import fs from 'node:fs/promises';
import { appendFileSync } from 'node:fs';
import { registerHooks, syncBuiltinESMExports } from 'node:module';
${simulated ? "Object.defineProperty(process, 'platform', { value: 'darwin' });" : ''}
function refuse(kind) {
  appendFileSync(${JSON.stringify(trace)}, kind + '\\n');
  throw Error(kind);
}
globalThis.fetch = () => refuse('model');
child.spawn = () => refuse('spawn');
for (const name of ['readFile', 'readlink']) {
  const original = fs[name];
  fs[name] = (path, ...args) => String(path).startsWith('/proc/') ? refuse('proc') : original(path, ...args);
}
syncBuiltinESMExports();
registerHooks({ load(url, context, next) {
  const record = next(url, context);
  if (url.endsWith('/packaging/core-local/capture-hook.mjs')) {
    return { ...record, source: record.source.toString()
      .replace('export async function runBoundCapture(', 'async function observedCapture(') +
      ${JSON.stringify(observedSource)} };
  }
  if (!url.endsWith('/packaging/core-local/local-provider.mjs')) return record;
  return { ...record, source: record.source.toString()
    .replace('export function createLocalProvider(', 'function originalProvider(') +
    '\\nexport function createLocalProvider() { globalThis.fetch(); }\\n' };
} });
`, { mode: 0o600 });
  return { args: ['--import', path], outcomes: () => jsonLines(readFileSync(capture, 'utf8')),
    assertQuiet: () => assert.equal(existsSync(trace), false,
    existsSync(trace) ? readFileSync(trace, 'utf8') : undefined) };
}

async function withSession(vector, f, imports, work, shutdown) {
  const child = spawn(vector.command, [...flags, ...imports, ...vector.args], {
    env: f.environment, cwd: f.parent, stdio: ['pipe', 'pipe', 'pipe'],
  });
  const closed = once(child, 'close');
  let stderr = '', id = 0;
  child.stderr.setEncoding('utf8').on('data', text => { stderr += text; });
  const output = createInterface({ input: child.stdout })[Symbol.asyncIterator]();
  const send = frame => child.stdin.write(JSON.stringify({ jsonrpc: '2.0', ...frame }) + '\n');
  async function request(method, params) {
    const alarm = setTimeout(() => child.kill('SIGKILL'), 20_000);
    try {
      send({ id: ++id, method, params });
      const line = await output.next();
      assert.equal(line.done, false, stderr);
      const { result, ...headers } = JSON.parse(line.value);
      assert.deepEqual(headers, { jsonrpc: '2.0', id });
      return result;
    } finally { clearTimeout(alarm); }
  }
  async function tool(name, args) {
    const result = await request('tools/call', { name, arguments: args });
    const reply = JSON.parse(result.content[0].text);
    assert.equal(reply.ok, true, JSON.stringify(reply));
    return reply.value;
  }
  try {
    const init = await request('initialize', golden.exchanges.initialize.params);
    send({ method: 'notifications/initialized' });
    assert.deepEqual(await request('ping'), {});
    return await work({ init, tool, request });
  } finally {
    if (shutdown && child.exitCode === null) child.kill(shutdown);
    else child.stdin.end();
    const alarm = setTimeout(() => child.kill('SIGKILL'), 5000);
    try {
      assert.deepEqual(await closed, [0, null], stderr);
      assert.equal(stderr, '');
    } finally { clearTimeout(alarm); }
  }
}

function schema(path) {
  const db = new DatabaseSync(path, { readOnly: true });
  try { return db.prepare('PRAGMA user_version').get().user_version; }
  finally { db.close(); }
}

function assertAbsent(path, text) {
  for (const suffix of ['', '-wal', '-shm', '-journal']) {
    if (existsSync(path + suffix)) assert.equal(readFileSync(path + suffix).includes(text), false, suffix);
  }
}

function replayCapture(f, vector, observer) {
  const native = read(join(f.home, '.claude/settings.json')).hooks;
  const { cutover } = descriptor(f).migration;
  const journal = read(join(f.root, '.cutover-' + cutover.id, 'capture-claude.json'));
  const installation = join(f.root, 'capture', 'claude', 'core-' + journal.generation);
  const executable = join(dirname(vector.args[0]), 'capture-cli.mjs');
  const session = '76270991-10ce-461c-9740-5e90a021acb6';
  const transcript = join(f.home, '.claude/projects', session + '.jsonl');
  const hook = event => {
    const args = [executable, 'hook', '--installation', installation, '--event', event];
    const command = ['/usr/bin/env', '-u', 'NODE_OPTIONS', '-u', 'NODE_PATH', vector.command, ...args]
      .map(value => "'" + value.replaceAll("'", "'\\''") + "'").join(' ');
    assert.ok(native[event].some(group => group.hooks.some(entry => entry.command === command)));
    const input = JSON.stringify({ hook_event_name: event, session_id: session, transcript_path: transcript });
    assert.deepEqual(runNode([...observer.args, ...args], { env: f.environment, cwd: f.parent, input }),
      { stdout: '', stderr: '' });
  };
  writeFileSync(transcript, '', { mode: 0o600 });
  hook('SessionStart');
  writeFileSync(transcript, JSON.stringify({ type: 'user', uuid: 'synthetic-turn',
    timestamp: new Date(Date.now() - 60 * 60 * 1000).toISOString(), promptSource: 'typed',
    message: { content: [{ type: 'text', text: rawText }] } }) + '\n');
  hook('Stop');
  hook('Stop');
  assert.deepEqual(observer.outcomes(), [{ status: 'ready' }, { status: 'progress' }, { status: 'ready' }]);
  observer.assertQuiet();
}

async function qualify(t, simulated) {
  const workspace = createTestWorkspace(t);
  const originalTmp = process.env.TMPDIR;
  process.env.TMPDIR = workspace.path;
  try {
    const { withUpgradeInstallers } = await import('../../../tools/testing/local-cutover-upgrade.qualification.mjs');
    await withUpgradeInstallers(async ({ baseline, candidate, testClients }) => {
      const f = testClients('direct-session');
      const observer = preload(f.parent, simulated);
      unlinkSync(join(f.environment.PATH, 'codex'));
      f.run(baseline, ['setup', '--local', '--client', 'claude', '--owner', owner, '--project', project]);
      const source = descriptor(f).database.path;
      assert.equal(schema(source), 29);
      let baselineInit;
      const readContext = (tool, query) => tool('read_memory_context', { query, types: ['memory'], intent: 'current' });
      await withSession(registration(f), f, observer.args, async ({ init, tool }) => {
        baselineInit = init;
        assert.equal((await tool('remember_memory', { content: legacyText })).memory.revision, 1);
      }, 'SIGTERM');
      const daemon = action => ['daemon', action, '--local'];
      if (!simulated) for (const action of ['status', 'stop']) {
        assert.equal(f.run(baseline, daemon(action)), 'daemon_platform\n');
      }
      assert.match(f.run(candidate, ['setup', '--local']), /Local cutover verified/u);
      assert.match(f.run(candidate, ['local-cutover', '--confirm']), /Local cutover active/u);
      const vector = registration(f), database = vector.args[2];
      assert.equal(schema(database), SQLITE_PHYSICAL_VERSION);
      assert.equal(readFileSync(source, 'utf8'), 'Cairn local store migrated. This path is retired.\n');
      if (!simulated) for (const action of ['status', 'stop']) {
        assert.equal(f.run(candidate, daemon(action)), 'daemon_platform\n');
      }
      await withSession(vector, f, observer.args, async first => {
        assert.deepEqual(first.init, baselineInit);
        await withSession(vector, f, observer.args, async second => {
          assert.deepEqual(second.init, baselineInit);
          assert.ok(JSON.stringify(await readContext(second.tool, 'lapis')).includes(legacyText));
          const { memory } = await first.tool('remember_memory', { content: explicitText });
          assert.ok(JSON.stringify(await readContext(second.tool, 'argillite')).includes(explicitText));
          const query = { query: 'synthetic', types: ['memory'], intent: 'current', limit: 1 };
          const page = await second.tool('find_memory_candidates', query);
          assert.equal(page.items.length, 1);
          assert.ok(page.nextCursor);
          const next = await second.tool('find_memory_candidates', { ...query, cursor: page.nextCursor });
          assert.equal(next.items.length, 1);
          assert.notDeepEqual(next.items[0].ref, page.items[0].ref);
          assert.ok(['', '-wal'].some(suffix => existsSync(database + suffix) &&
            readFileSync(database + suffix).includes(explicitText)));
          assert.equal((await first.tool('forget_memory', {
            memoryId: memory.id, expectedRevision: memory.revision,
          })).forgotten, true);
          assertAbsent(database, explicitText);
          assert.deepEqual((await readContext(second.tool, 'argillite')).items, []);
        }, 'SIGINT');
      });
      if (mac) await localCutoverExclusion().withColdStoreLease(database, check => check());
      assertAbsent(database, explicitText);
      replayCapture(f, vector, observer);
      const [conversation, ...rest] = jsonLines(f.run(candidate, ['raw', 'list', '--client', 'claude']));
      assert.ok(conversation, 'the capture outside the forget window must be archived');
      assert.deepEqual(rest, []);
      assert.equal(conversation.messageCount, 1);
      assert.ok(readFileSync(database).includes(rawText));
      const [deleted] = jsonLines(f.run(candidate, ['raw', 'delete', conversation.id, '--yes']));
      assert.equal(deleted.ok, true);
      assert.equal(deleted.dryRun, false);
      assert.equal(f.run(candidate, ['raw', 'list', '--client', 'claude']), '');
      assertAbsent(database, rawText);
      const inode = statSync(database, { bigint: true }).ino;
      f.run(candidate, ['uninstall', '--local', '--yes']);
      assert.equal(descriptor(f).state, 'uninstalled');
      assert.equal(registration(f), undefined);
      f.run(candidate, ['setup', '--local']);
      assert.equal(descriptor(f).state, 'installed');
      assert.deepEqual(registration(f), vector);
      assert.equal(statSync(database, { bigint: true }).ino, inode);
      await withSession(vector, f, observer.args, async ({ tool }) => {
        assert.ok(JSON.stringify(await readContext(tool, 'lapis')).includes(legacyText));
        assert.deepEqual((await readContext(tool, 'argillite')).items, []);
      });
      observer.assertQuiet();
    });
  } finally {
    if (originalTmp === undefined) delete process.env.TMPDIR;
    else process.env.TMPDIR = originalTmp;
  }
}

test('Darwin capture uses the installer liveness protocol to reap an exited owner and respect a live owner', t => {
  const { path } = createTestWorkspace(t);
  const observer = preload(path, !mac);
  const lock = join(path, 'capture.lock');
  const entry = scriptPath('../../../packaging/core-local/capture-lock.mjs');
  const load = `import { captureLock } from ${JSON.stringify(pathToFileURL(entry).href)};`;
  runNode([...observer.args, '--input-type=module', '-e',
    load + `await captureLock(${JSON.stringify(lock)}, () => process.exit(0));`]);
  const stale = read(lock);
  assert.deepEqual(Object.keys(stale).sort(), ['pid', 'token']);
  assert.throws(() => process.kill(stale.pid, 0), { code: 'ESRCH' });
  runNode([...observer.args, '--input-type=module', '-e',
    load + `await captureLock(${JSON.stringify(lock)}, () => {});`]);
  assert.ok(existsSync(lock + '.reap-' + stale.token));
  assert.equal(existsSync(lock), false);
  writeFileSync(lock, JSON.stringify({ ...stale, pid: process.pid }), { mode: 0o600 });
  runNode([...observer.args, '--input-type=module', '-e', load + `
    import assert from 'node:assert/strict';
    await assert.rejects(captureLock(${JSON.stringify(lock)}, assert.fail), { message: 'state_busy' });
  `]);
  assert.equal(read(lock).pid, process.pid);
  observer.assertQuiet();
});

test('portable installed replay of the Darwin MCP and capture branches', {
  skip: mac || process.platform !== 'linux', timeout: 180_000,
}, t => qualify(t, true));

test('native macOS installed cutover, concurrent direct MCP, closed-file forget, capture, Raw and reattach', {
  skip: !mac, timeout: 180_000,
}, t => qualify(t, false));

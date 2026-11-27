import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import test from 'node:test';
import { createTestWorkspace } from '../../../tools/testing/workspace.mjs';
import { captureCursorPath } from '../lib/capture-cursor.mjs';
import { row } from './capture-window-harness.mjs';
import { id, instant } from './hosted-fixtures.mjs';

const endpoint = 'https://capture-opt-out.synthetic.invalid';
const hook = fileURLToPath(new URL('../scripts/hook.mjs', import.meta.url));
const launcher = fileURLToPath(new URL('../scripts/launch-capture.mjs', import.meta.url));
const portablePreload = fileURLToPath(new URL('./fixtures/pause-native-preload.mjs', import.meta.url));
const optOutNote = '; capture is off for this session (CAIRN_MEMORY_CAPTURE=off)';
const silent = { code: 0, stdout: '', stderr: '' };
const transcriptRow = row('message');

async function snapshot(root, directory = root) {
  const entries = await readdir(directory, { withFileTypes: true });
  const contents = {};
  for (const entry of entries) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) {
      contents[relative(root, path)] = null;
      Object.assign(contents, await snapshot(root, path));
    } else {
      assert.ok(entry.isFile(), `unexpected data entry: ${relative(root, path)}`);
      contents[relative(root, path)] = await readFile(path);
    }
  }
  return contents;
}

async function fixture(t, { stableDiagnostics = false, keepStdinOpen = false } = {}) {
  const workspace = createTestWorkspace(t, { prefix: 'capture-opt-out-' });
  const root = join(workspace.path, 'data');
  const transcript = join(workspace.path, 'transcript.jsonl');
  const preload = join(workspace.path, 'peer.mjs');
  const observations = join(workspace.path, 'observations.jsonl');
  const memory = {
    id, content: 'Synthetic recollection', kind: 'fact', scope: 'personal', projectId: null,
    origin: 'explicit', confidence: 1, createdAt: instant, updatedAt: instant,
    receipts: [{
      client: 'claude-code', sessionId: randomUUID(), eventId: randomUUID(),
      role: 'user', excerpt: 'Synthetic evidence', createdAt: instant,
    }],
  };
  await mkdir(root, { mode: 0o700 });
  await writeFile(transcript, transcriptRow);
  await writeFile(observations, '');
  // Log every request, including pause-state, without making a socket connection.
  await writeFile(preload, `
    import children from 'node:child_process';
    import { appendFileSync } from 'node:fs';
    import { syncBuiltinESMExports } from 'node:module';
    const log = record => appendFileSync(${JSON.stringify(observations)}, JSON.stringify(record) + '\\n');
    ${stableDiagnostics ? `
      const RealDate = Date;
      const now = RealDate.parse(${JSON.stringify(instant)});
      globalThis.Date = class extends RealDate {
        constructor(...args) { super(...(args.length ? args : [now])); }
        static now() { return now; }
      };
    ` : ''}
    ${keepStdinOpen ? `
      const stdin = process.stdin;
      const iterate = stdin[Symbol.asyncIterator];
      stdin[Symbol.asyncIterator] = function () {
        log({ stdinRead: true });
        return iterate.call(this);
      };
    ` : ''}
    globalThis.fetch = async (url, options = {}) => {
      const path = new URL(url).pathname;
      log({ method: options.method ?? 'GET', url: String(url), path, headers: options.headers,
        redirect: options.redirect, rawBody: options.body, body: options.body && JSON.parse(options.body) });
      switch (path) {
        case '/api/memory/pause-state':
          return Response.json({ paused: false, generation: 0, enforced: true });
        case '/api/memory/recall':
          return Response.json({ memories: [${JSON.stringify(memory)}] });
        case '/api/memory/capture':
          return Response.json({ duplicate: false, memoryCount: 1 });
        case '/api/memory/telemetry':
          return new Response(null, { status: 204 });
        default:
          return new Response(null, { status: 404 });
      }
    };
    const spawn = children.spawn;
    children.spawn = (...args) => {
      log({ worker: args[1].at(-1), detached: args[2].detached });
      const worker = spawn(...args);
      // Let the test observe all worker effects before inspecting the log.
      worker.unref = () => {};
      return worker;
    };
    syncBuiltinESMExports();
  `);
  const env = {
    PATH: process.env.PATH,
    HOME: workspace.path,
    NODE_OPTIONS: `--import=${pathToFileURL(preload).href}`,
    CLAUDE_PLUGIN_DATA: root,
    CLAUDE_PLUGIN_OPTION_API_ENDPOINT: endpoint,
    CLAUDE_PLUGIN_OPTION_API_TOKEN: 'synthetic-token',
    CLAUDE_PLUGIN_OPTION_TELEMETRY: 'false',
    CLAUDE_PLUGIN_OPTION_CONTEXT_READ: 'false',
  };
  const input = { session_id: randomUUID(), transcript_path: transcript, cwd: workspace.path };
  async function run(args, capture, { extra, telemetry = 'false', bash = false, rawOutput = false } = {}) {
    const childEnv = bash ? { PATH: env.PATH, HOME: env.HOME, NODE_OPTIONS: env.NODE_OPTIONS } :
      { ...env, CLAUDE_PLUGIN_OPTION_TELEMETRY: telemetry };
    if (capture !== undefined) childEnv.CAIRN_MEMORY_CAPTURE = capture;
    const child = spawn(process.execPath, args, { env: childEnv, stdio: ['pipe', 'pipe', 'pipe'] });
    const stdout = [], stderr = [];
    child.stdout.on('data', chunk => { stdout.push(chunk); });
    child.stderr.on('data', chunk => { stderr.push(chunk); });
    child.stdin.on('error', error => { if (error.code !== 'EPIPE') throw error; });
    const done = new Promise((resolve, reject) => {
      child.once('error', reject);
      child.once('close', resolve);
    });
    workspace.defer(async () => {
      if (child.exitCode === null && child.signalCode === null) child.kill();
      await done;
    });
    if (!keepStdinOpen) child.stdin.end(JSON.stringify({ ...input, ...extra }));
    const code = await done;
    if (keepStdinOpen) assert.equal(child.stdin.writableEnded, false);
    const output = chunks => rawOutput ? Buffer.concat(chunks) : Buffer.concat(chunks).toString('utf8');
    return { code, stdout: output(stdout), stderr: output(stderr) };
  }
  async function records() {
    return (await readFile(observations, 'utf8')).trim().split('\n').filter(Boolean).map(JSON.parse);
  }
  return {
    root, run, records, memory, cursor: captureCursorPath(root, input.session_id),
    recordBytes: () => readFile(observations),
    files: async () => (await readdir(root, { recursive: true })).sort(),
  };
}

for (const hookEvent of ['Stop', 'PreCompact']) {
  test(`${hookEvent} opt-out launches no worker and makes no requests`, async t => {
    const f = await fixture(t);
    const before = await f.files();
    const result = await f.run([launcher], 'off', { extra: { hook_event_name: hookEvent } });
    assert.deepEqual({ result, observations: await f.records(), files: await f.files() },
      { result: silent, observations: [], files: before });
  });
}

test('direct capture makes no requests or state changes only for exact off', async t => {
  const f = await fixture(t);
  const before = await f.files();
  const result = await f.run([hook, 'capture'], 'off');
  const optedOut = { result, observations: await f.records(), files: await f.files() };
  for (const capture of [undefined, 'on', 'OFF', '', '0', 'false', 'off ']) {
    const active = await fixture(t);
    assert.deepEqual(await active.run([hook, 'capture'], capture), silent);
    const requests = await active.records();
    assert.ok(requests.some(({ path }) => path === '/api/memory/pause-state'));
    const captures = requests.filter(({ path }) => path === '/api/memory/capture');
    assert.equal(captures.length, 1);
    assert.equal(captures[0].method, 'POST');
    assert.deepEqual(captures[0].body.messages.map(({ id }) => id), ['message']);
  }
  assert.deepEqual(optedOut, { result: silent, observations: [], files: before });
});

test('direct detached capture makes no requests or state changes with off', async t => {
  const f = await fixture(t);
  const before = await f.files();
  const result = await f.run([hook, 'capture-detached'], 'off', { extra: { capture_generation: 'initial' } });
  assert.deepEqual({ result, observations: await f.records(), files: await f.files() },
    { result: silent, observations: [], files: before });
});

test('opted-out sessions skip the capture boundary and retain start telemetry and recall', async t => {
  const f = await fixture(t);
  const before = await f.files();
  const result = await f.run([hook, 'start-boundary'], 'off', { extra: { source: 'startup' } });
  const boundary = { result, observations: await f.records(), files: await f.files() };

  for (const capture of [undefined, 'off']) {
    assert.deepEqual(await f.run([hook, 'start'], capture), silent);
    assert.deepEqual(await f.records(), []);
  }
  for (const capture of [undefined, 'off']) {
    assert.deepEqual(await f.run([hook, 'start'], capture, { telemetry: 'true' }), silent);
  }
  const starts = await f.records();
  assert.equal(starts.length, 2);
  assert.equal(starts[0].path, '/api/memory/telemetry');
  assert.equal(starts[0].body.event, 'plugin_started');
  assert.deepEqual(starts[1], starts[0]);

  const recall = await f.run([hook, 'recall'], 'off', { extra: { prompt: 'Synthetic question' } });
  assert.equal(recall.code, 0);
  assert.equal(recall.stderr, '');
  const output = JSON.parse(recall.stdout).hookSpecificOutput;
  assert.equal(output.hookEventName, 'UserPromptSubmit');
  assert.ok(output.additionalContext.includes(f.memory.content));
  const recent = (await f.records()).slice(starts.length);
  assert.deepEqual(recent.map(({ path }) => path), ['/api/memory/pause-state', '/api/memory/recall']);
  assert.equal(recent[1].body.query, 'Synthetic question');

  assert.deepEqual(boundary, { result: silent, observations: [], files: before });
});

test('Bash-like status adds the note only for off', async t => {
  const f = await fixture(t);
  const args = [hook, 'status', '--plugin-data', f.root];
  const baseline = await f.run(args, undefined, { bash: true });
  assert.deepEqual(baseline, {
    code: 0,
    stdout: 'Cairn automatic memory: active; telemetry: on; endpoint: https://cairn.ink; ' +
      'credential: not seen yet — restart Claude Code and send one message.\n',
    stderr: '',
  });
  for (const capture of ['on', 'OFF', '', '0', 'false', 'off ']) {
    assert.deepEqual(await f.run(args, capture, { bash: true }), baseline);
  }
  assert.deepEqual(await f.records(), []);
  assert.deepEqual(await f.run(args, 'off', { bash: true }), {
    ...baseline, stdout: baseline.stdout.replace(/\.\n$/, optOutNote + '.\n'),
  });
});

for (const [mode, preloads] of [['ordinary', []], ['portable hosted', ['--import', portablePreload]]]) {
  test(`recall with off leaves data bytes unchanged on the ${mode} path`, async t => {
    const f = await fixture(t, { stableDiagnostics: true });
    const args = [...preloads, hook, 'recall'];
    const extra = { prompt: 'Synthetic question' };
    // Publish project and recall diagnostics at the fixed time without marking a session.
    const warmup = await f.run(args, undefined, { extra: { ...extra, session_id: undefined } });
    assert.ok(warmup.stdout.includes(f.memory.content));
    const before = await snapshot(f.root);
    const cursor = relative(f.root, f.cursor);
    assert.equal(Object.hasOwn(before, cursor), false);
    const requestStart = (await f.recordBytes()).length;

    const optedOut = await f.run(args, 'off', { extra, rawOutput: true });
    const afterOptOut = await snapshot(f.root);
    assert.deepEqual(afterOptOut, before, 'recall with off changed files under plugin data');
    const optedOutRequests = (await f.recordBytes()).subarray(requestStart);

    const enabled = await f.run(args, undefined, { extra, rawOutput: true });
    const marker = JSON.parse(await readFile(f.cursor, 'utf8'));
    assert.equal(marker.firstPromptAt, instant);
    if (preloads.length) {
      assert.equal(marker.offset, Buffer.byteLength(transcriptRow));
      assert.equal(marker.hostedGeneration, 0);
      assert.match(marker.hostedTarget, /^[a-f0-9]{64}$/);
    } else {
      assert.deepEqual(marker, { firstPromptAt: instant });
    }
    assert.equal(enabled.code, 0);
    assert.equal(enabled.stderr.length, 0);
    assert.ok(enabled.stdout.includes(f.memory.content));
    assert.deepEqual(optedOut, enabled);
    assert.deepEqual((await f.recordBytes()).subarray(requestStart + optedOutRequests.length), optedOutRequests);
    assert.deepEqual(optedOutRequests.toString('utf8').trim().split('\n').map(line => JSON.parse(line).path),
      ['/api/memory/pause-state', '/api/memory/recall']);
  });
}

test('opted-out capture actions leave a pending capture window byte-identical', async t => {
  const f = await fixture(t);
  const pending = { offset: 0, generation: 'initial', pendingEnd: Buffer.byteLength(transcriptRow),
    captureSeen: true, windowInitial: true };
  await mkdir(dirname(f.cursor), { mode: 0o700 });
  await writeFile(f.cursor, JSON.stringify(pending, null, 2) + '\n', { mode: 0o600 });
  const before = await snapshot(f.root);

  for (const [action, extra] of [
    ['capture', {}],
    ['capture-detached', { capture_generation: 'initial' }],
    ['start-boundary', { source: 'startup' }],
  ]) {
    assert.deepEqual(await f.run([hook, action], 'off', { extra }), silent, action);
    assert.deepEqual(await snapshot(f.root), before, action);
    assert.deepEqual(await f.records(), [], action);
  }
});

test('only status reports off on the unbound and control-failure paths', async t => {
  const f = await fixture(t);
  const unbound = ['--plugin-data', f.root, '--pairing-record', join(f.root, 'missing-pairing.json')];
  const failure = ['--plugin-data', 'relative-path'];
  const bash = { bash: true };
  const unboundStatus = await f.run([hook, 'status', ...unbound], undefined, bash);
  assert.equal(unboundStatus.code, 0);
  assert.equal(unboundStatus.stderr, '');
  assert.match(unboundStatus.stdout, /^Cairn automatic memory: pairing_record_mismatch\b/);
  assert.deepEqual(await f.run([hook, 'status', ...unbound], 'off', bash), {
    ...unboundStatus, stdout: unboundStatus.stdout.replace(/\.\n$/, optOutNote + '.\n'),
  });
  const failureMessage = 'Cairn automatic memory control failed (invalid_plugin_data_argument)';
  assert.deepEqual(await f.run([hook, 'status', ...failure], 'off', bash),
    { code: 1, stdout: '', stderr: failureMessage + optOutNote + '.\n' });

  for (const action of ['pause', 'resume']) {
    const boundMessage = action === 'pause' ? 'Cairn automatic memory is paused.' : 'Cairn automatic memory is active.';
    assert.deepEqual(await f.run([hook, action, '--plugin-data', f.root], 'off', bash),
      { code: 0, stdout: boundMessage + '\n', stderr: '' });
    assert.deepEqual(await f.run([hook, action, ...unbound], 'off', bash), { ...unboundStatus, code: 1 });
    assert.deepEqual(await f.run([hook, action, ...failure], 'off', bash),
      { code: 1, stdout: '', stderr: failureMessage + '.\n' });
  }
  assert.deepEqual(await f.records(), []);
});

test('the opted-out Stop launcher exits without reading its open stdin', { timeout: 5000 }, async t => {
  const f = await fixture(t, { keepStdinOpen: true });
  const before = await snapshot(f.root);
  assert.deepEqual(await f.run([launcher], 'off'), silent);
  assert.deepEqual(await f.records(), []);
  assert.deepEqual(await snapshot(f.root), before);
});

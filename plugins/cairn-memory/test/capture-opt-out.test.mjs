import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import test from 'node:test';
import { createTestWorkspace } from '../../../tools/testing/workspace.mjs';
import { row } from './capture-window-harness.mjs';
import { id, instant } from './hosted-fixtures.mjs';

const endpoint = 'https://capture-opt-out.synthetic.invalid';
const hook = fileURLToPath(new URL('../scripts/hook.mjs', import.meta.url));
const launcher = fileURLToPath(new URL('../scripts/launch-capture.mjs', import.meta.url));
const optOutNote = '; capture is off for this session (CAIRN_MEMORY_CAPTURE=off)';
const silent = { code: 0, stdout: '', stderr: '' };

async function fixture(t) {
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
  await writeFile(transcript, row('message'));
  await writeFile(observations, '');
  // Log every request, including pause-state, without making a socket connection.
  await writeFile(preload, `
    import children from 'node:child_process';
    import { appendFileSync } from 'node:fs';
    import { syncBuiltinESMExports } from 'node:module';
    const log = record => appendFileSync(${JSON.stringify(observations)}, JSON.stringify(record) + '\\n');
    globalThis.fetch = async (url, options = {}) => {
      const path = new URL(url).pathname;
      log({ method: options.method ?? 'GET', path, body: options.body && JSON.parse(options.body) });
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
  async function run(args, capture, { extra, telemetry = 'false', bash = false } = {}) {
    const childEnv = bash ? { PATH: env.PATH, HOME: env.HOME, NODE_OPTIONS: env.NODE_OPTIONS } :
      { ...env, CLAUDE_PLUGIN_OPTION_TELEMETRY: telemetry };
    if (capture !== undefined) childEnv.CAIRN_MEMORY_CAPTURE = capture;
    const child = spawn(process.execPath, args, { env: childEnv, stdio: ['pipe', 'pipe', 'pipe'] });
    let stdout = '', stderr = '';
    child.stdout.on('data', chunk => { stdout += chunk; });
    child.stderr.on('data', chunk => { stderr += chunk; });
    child.stdin.on('error', error => { if (error.code !== 'EPIPE') throw error; });
    const done = new Promise((resolve, reject) => {
      child.once('error', reject);
      child.once('close', resolve);
    });
    workspace.defer(async () => {
      if (child.exitCode === null && child.signalCode === null) child.kill();
      await done;
    });
    child.stdin.end(JSON.stringify({ ...input, ...extra }));
    const code = await done;
    return { code, stdout, stderr };
  }
  async function records() {
    return (await readFile(observations, 'utf8')).trim().split('\n').filter(Boolean).map(JSON.parse);
  }
  return {
    root, run, records, memory,
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

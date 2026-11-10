import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { cp, mkdir, readFile, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createTestWorkspace } from '../../../tools/testing/workspace.mjs';
import { captureCursorPath } from '../lib/capture-cursor.mjs';

export const oldTime = '2020-01-02T03:04:05.123456+00:00';
export const row = (id, timestamp = oldTime, extra = {}) => JSON.stringify({
  type: 'user', uuid: id, ...(timestamp === undefined ? {} : { timestamp }),
  message: { content: `Synthetic ${id}` }, ...extra,
}) + '\n';

export async function harness(t, { fail = () => false, holdRecall, hookPath, observedAt, groupingLimit, mutateRuntime, strictTimes = false, portable = false, pauseState = () => ({ paused: false, generation: 0, enforced: true }) } = {}) {
  const workspace = createTestWorkspace(t, { prefix: 'capture-window-' });
  const dataDir = join(workspace.path, 'data'), transcript = join(workspace.path, 'transcript.jsonl');
  await mkdir(dataDir, { mode: 0o700 });
  const sessionId = 'synthetic-session', statePath = captureCursorPath(dataDir, sessionId);
  const captures = [], recalls = [], forgets = [], requests = [];
  const server = createServer(async (request, response) => {
    let text = '';
    for await (const chunk of request) text += chunk;
    // Record every request before routing, including metadata and unknown paths.
    requests.push({ method: request.method, url: request.url, headers: request.rawHeaders, body: text });
    if (request.url === '/api/memory/pause-state') {
      request.resume(); response.setHeader('content-type', 'application/json');
      response.end(JSON.stringify(pauseState())); return;
    }
    let body;
    try { body = JSON.parse(text); }
    catch { response.writeHead(400); response.end('{}'); return; }
    if (request.url.endsWith('/forget')) {
      forgets.push(body);
      response.writeHead(200, { 'content-type': 'application/json' });
      response.end('{}'); // Server event only; no client state mutation.
    } else if (request.url.endsWith('/recall')) {
      recalls.push(body);
      await holdRecall?.();
      response.writeHead(200, { 'content-type': 'application/json' });
      response.end(JSON.stringify({ memories: [] }));
    } else {
      captures.push(body);
      const invalidTime = strictTimes && body.messages?.some(m => m.occurred_at !== undefined &&
        (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,9})?(Z|[+-]\d{2}:\d{2})$/.test(m.occurred_at) ||
          m.occurred_at.length > 40 || !Number.isFinite(Date.parse(m.occurred_at))));
      response.writeHead(invalidTime ? 400 : fail(body, captures.length) ? 503 : 200, { 'content-type': 'application/json' });
      response.end(JSON.stringify({ duplicate: false, memoryCount: 0 }));
    }
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => { server.closeAllConnections(); server.close(); });
  if (observedAt || groupingLimit || mutateRuntime) {
    const copy = join(workspace.path, 'plugin');
    const sourceHook = hookPath ?? process.env.CAIRN_CAPTURE_TEST_HOOK;
    const sourceRoot = sourceHook ? dirname(dirname(sourceHook)) : fileURLToPath(new URL('../', import.meta.url));
    for (const directory of ['lib', 'scripts']) await cp(join(sourceRoot, directory), join(copy, directory), { recursive: true });
    hookPath = join(copy, 'scripts/hook.mjs');
    let source = await readFile(hookPath, 'utf8');
    if (observedAt) source = source.replace('const observedAt = new Date().toISOString();', `const observedAt = ${JSON.stringify(observedAt)};`);
    if (groupingLimit) source = source.replace('const CAPTURE_WINDOW_SLICES = 4096;', `const CAPTURE_WINDOW_SLICES = ${groupingLimit};`);
    if (mutateRuntime) source = mutateRuntime(source);
    await writeFile(hookPath, source);
  }
  async function run(action, extra = {}) {
    const hook = hookPath ?? process.env.CAIRN_CAPTURE_TEST_HOOK ?? fileURLToPath(new URL('../scripts/hook.mjs', import.meta.url));
    const before = performance.now();
    const child = spawn(process.execPath, [...(portable ? ['--import', fileURLToPath(new URL('./fixtures/pause-native-preload.mjs', import.meta.url))] : []), hook, action], {
      env: { PATH: process.env.PATH, HOME: workspace.path, CLAUDE_PLUGIN_DATA: dataDir,
        CLAUDE_PLUGIN_OPTION_API_ENDPOINT: `http://127.0.0.1:${server.address().port}`,
        CLAUDE_PLUGIN_OPTION_API_TOKEN: 'synthetic-token', CLAUDE_PLUGIN_OPTION_TELEMETRY: 'false' },
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    t.after(() => { if (child.exitCode === null) child.kill(); });
    let stderr = '', stdout = '';
    child.stdout.on('data', chunk => stdout += chunk); child.stderr.on('data', chunk => stderr += chunk);
    child.stdin.end(JSON.stringify({ session_id: sessionId, transcript_path: transcript, cwd: '/synthetic/project',
      ...(action === 'recall' ? { prompt: 'Synthetic prompt' } : {}),
      ...(['start', 'start-boundary'].includes(action) ? { source: 'startup' } : {}), hook_event_name: ['start', 'start-boundary'].includes(action) ? 'SessionStart' :
        action === 'recall' ? 'UserPromptSubmit' : 'Stop', ...extra }));
    const code = await new Promise((resolve, reject) => { child.once('error', reject); child.once('close', resolve); });
    assert.equal(code, 0, stderr); assert.equal(stderr, '');
    if (action === 'start-boundary') assert.equal(stdout, '');
    return { wallMs: performance.now() - before, pid: child.pid, code, stdout, stderr };
  }
  return { workspace, dataDir, transcript, sessionId, statePath, captures, recalls, forgets, requests, run,
    forget: at => fetch(`http://127.0.0.1:${server.address().port}/api/memory/forget`, {
      method: 'POST', body: JSON.stringify({ at }), headers: { 'content-type': 'application/json' } }),
    state: async () => JSON.parse(await readFile(statePath, 'utf8')),
    write: text => writeFile(transcript, text) };
}

// Client half only: the loopback forget is a server-side no-op. The server's
// exclusion window relies on these original times surviving a new-id fork.
export async function forgetThenFork(t, hookPath) {
  const f = await harness(t, { hookPath, observedAt: '2026-11-10T00:05:00.000Z' });
  const parent = [
    { type: 'user', uuid: 'u1', timestamp: '2026-11-10T00:00:00.000Z', message: { content: 'Remember X.' } },
    { type: 'assistant', uuid: 'a1', timestamp: '2026-11-10T00:00:01.000Z', message: { content: 'I will remember X.' } },
  ].map(record => ({ ...record, sessionId: 'synthetic-parent' }));
  await f.write(parent.map(record => JSON.stringify(record) + '\n').join(''));
  await f.run('capture', { session_id: 'synthetic-parent' });
  assert.equal((await f.forget('2026-11-10T00:02:00.000Z')).status, 200);
  assert.deepEqual(f.forgets, [{ at: '2026-11-10T00:02:00.000Z' }]);
  const fork = parent.map(record => ({ ...record, sessionId: f.sessionId }));
  await f.write(fork.map(record => JSON.stringify(record) + '\n').join(''));
  // No start boundary exists for the fork. Empty recall still records a marker.
  await f.run('recall');
  assert.equal((await f.state()).firstPromptAt, '2026-11-10T00:05:00.000Z');
  assert.equal(f.recalls.length, 1);
  await f.run('capture');
  const copied = f.captures.filter(body => body.session_id === f.sessionId);
  assert.equal(copied.length, 1);
  assert.equal(copied[0].window.initial, true);
  assert.deepEqual(copied[0].messages.map(m => m.id), parent.map(record => record.uuid));
  assert.deepEqual(copied[0].messages.map(m => m.occurred_at), parent.map(record => record.timestamp),
    'forget fork original source times');
}

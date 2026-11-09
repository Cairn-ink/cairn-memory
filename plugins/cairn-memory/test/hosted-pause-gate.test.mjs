import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { createTestWorkspace } from '../../../tools/testing/workspace.mjs';

const hook = fileURLToPath(new URL('../scripts/hook.mjs', import.meta.url));
const launcher = fileURLToPath(new URL('../scripts/launch-capture.mjs', import.meta.url));
const foregroundPreload = fileURLToPath(new URL('./fixtures/pause-foreground-preload.mjs', import.meta.url));
const active = { paused: false, generation: 0, enforced: true };
const paused = { paused: true, generation: 1, enforced: true };
async function fixture(t, observation = () => active, memories = []) {
  const ws = createTestWorkspace(t), home = join(ws.path, 'home'), root = join(home, 'data');
  await mkdir(root, { recursive: true, mode: 0o700 });
  await writeFile(join(root, 'project-key'), '11111111-1111-4111-8111-111111111111\n', { mode: 0o600 });
  const transcript = join(ws.path, 'transcript.jsonl');
  await writeFile(transcript, JSON.stringify({ type: 'user', uuid: 'synthetic-message',
    message: { content: 'Synthetic capture text.' } }) + '\n');
  const counts = { pause: 0, recall: 0, capture: 0, other: 0 };
  const server = createServer((request, response) => {
    request.resume(); response.setHeader('content-type', 'application/json');
    if (request.url.endsWith('/pause-state')) {
      const value = observation(++counts.pause);
      if (value === undefined) { response.writeHead(503); response.end('{}'); }
      else response.end(JSON.stringify(value));
    } else if (request.url.endsWith('/recall')) {
      counts.recall++; response.end(JSON.stringify({ memories }));
    } else if (request.url.endsWith('/capture')) {
      counts.capture++; response.end(JSON.stringify({ duplicate: false, memoryCount: 1 }));
    } else { counts.other++; response.end('{}'); }
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => { server.closeAllConnections(); server.close(); });
  const endpoint = `http://127.0.0.1:${server.address().port}`;
  const env = { PATH: '/usr/bin:/bin', HOME: home, TMPDIR: ws.path, CLAUDE_PLUGIN_DATA: root,
    CLAUDE_PLUGIN_OPTION_API_ENDPOINT: endpoint, CLAUDE_PLUGIN_OPTION_API_TOKEN: 'synthetic-token',
    CLAUDE_PLUGIN_OPTION_TELEMETRY: 'false' };
  const input = { session_id: 'synthetic-session', prompt: 'Synthetic recall query.',
    transcript_path: transcript, cwd: ws.path, capture_generation: 'initial' };
  return { counts, env, input };
}
async function run(t, f, action, { entry = hook, preload } = {}) {
  const events = [], started = performance.now();
  const child = spawn(process.execPath, [...(preload ? ['--import', preload] : []), entry, ...(action ? [action] : [])],
    { env: f.env, stdio: ['pipe', 'pipe', 'pipe', 'ipc'] });
  let stdout = '', stderr = '';
  child.stdout.on('data', data => { stdout += data; }); child.stderr.on('data', data => { stderr += data; });
  child.on('message', event => events.push(event));
  const done = new Promise((resolve, reject) => {
    child.once('error', reject); child.once('close', (code, signal) => resolve({ code, signal }));
  });
  t.after(async () => { if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL'); await done; });
  child.stdin.end(JSON.stringify(f.input));
  const result = await done;
  assert.equal(result.code, 0); assert.equal(result.signal, null); assert.equal(stderr, '');
  return { stdout, events, elapsedMs: performance.now() - started };
}
for (const action of ['recall', 'capture', 'capture-detached']) {
  test(`${action} observes twice and blocks a pause arriving before dispatch`, { timeout: 15000 }, async t => {
    const f = await fixture(t, number => number === 1 ? active : paused);
    const result = await run(t, f, action);
    assert.equal(f.counts.pause, 2, 'second_observation_required');
    assert.equal(f.counts.recall, 0); assert.equal(f.counts.capture, 0); assert.equal(result.stdout, '');
  });
  for (const failureAt of [1, 2]) test(`${action} fails closed on hosted pause unavailability at observation ${failureAt}`,  { timeout: 15000 }, async t => {
    const f = await fixture(t, number => number >= failureAt ? undefined : active);
    const result = await run(t, f, action);
    assert.equal(f.counts.pause, failureAt); assert.equal(f.counts.recall, 0); assert.equal(f.counts.capture, 0);
    assert.equal(result.stdout, '');
  });
}
test('detached capture observes before reading a transcript or considering dispatch', { timeout: 15000 }, async t => {
  const f = await fixture(t, () => paused);
  const result = await run(t, f, 'capture-detached');
  assert.equal(f.counts.pause, 1, 'detached_worker_observes');
  assert.equal(f.counts.capture, 0); assert.equal(result.stdout, '');
});
for (const hook_event_name of ['Stop', 'PreCompact']) test(`${hook_event_name} foreground launches without network`,
  { timeout: 15000 }, async t => {
    const f = await fixture(t);
    f.input.hook_event_name = hook_event_name;
    const result = await run(t, f, '', { entry: launcher, preload: foregroundPreload });
    assert.deepEqual(result.events, [{ kind: 'worker-launched', action: 'capture-detached' }]);
    assert.deepEqual(f.counts, { pause: 0, recall: 0, capture: 0, other: 0 });
    assert.equal(result.stdout, '');
  });
for (const endpoint of ['file:///synthetic/local', 'stdio://synthetic']) test(`non-HTTP endpoint ${new URL(endpoint).protocol} retains its silent local rejection`,
  { timeout: 15000 }, async t => {
    const f = await fixture(t);
    f.env.CLAUDE_PLUGIN_OPTION_API_ENDPOINT = endpoint;
    for (const action of ['recall', 'capture', 'capture-detached']) assert.equal((await run(t, f, action)).stdout, '');
    assert.deepEqual(f.counts, { pause: 0, recall: 0, capture: 0, other: 0 });
  });


test('recall re-observes hosted state before writing context', { timeout: 15000 }, async t => {
  const memories = [{ id: '11111111-1111-4111-8111-111111111111', content: 'Synthetic remembered preference.',
    kind: 'fact', scope: 'personal', projectId: null, origin: 'explicit', confidence: 1,
    createdAt: '2026-10-01T00:00:00Z', updatedAt: '2026-10-01T00:00:00Z', receipts: [{ client: 'claude-code',
      sessionId: 'synthetic-source', eventId: 'synthetic-event', role: 'user', excerpt: 'Synthetic source.',
      createdAt: '2026-10-01T00:00:00Z' }] }];
  const f = await fixture(t, number => number < 3 ? active : paused, memories);
  const result = await run(t, f, 'recall');
  assert.equal(f.counts.recall, 1, 'recall_was_in_flight_before_pause');
  assert.equal(f.counts.pause, 3, 'output_observation_required');
  assert.equal(result.stdout, '', 'paused_context_not_emitted');
});


test('hosted operations fail closed when the shared state lock cannot verify the platform', { timeout: 15000 }, async t => {
  const f = await fixture(t);
  const preload = fileURLToPath(new URL('./fixtures/pause-platform-preload.mjs', import.meta.url));
  for (const action of ['recall', 'capture', 'capture-detached']) {
    assert.equal((await run(t, f, action, { preload })).stdout, '');
  }
  assert.equal(f.counts.pause, 3);
  assert.equal(f.counts.recall, 0); assert.equal(f.counts.capture, 0);
});

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
async function fixture(t, observation = () => active, memories = [], beforeReply) {
  const ws = createTestWorkspace(t), home = join(ws.path, 'home'), root = join(home, 'data');
  await mkdir(root, { recursive: true, mode: 0o700 });
  await writeFile(join(root, 'project-key'), '11111111-1111-4111-8111-111111111111\n', { mode: 0o600 });
  const transcript = join(ws.path, 'transcript.jsonl');
  await writeFile(transcript, JSON.stringify({ type: 'user', uuid: 'synthetic-message',
    message: { content: 'Synthetic capture text.' } }) + '\n');
  const receipts = [];
  const counts = { pause: 0, recall: 0, capture: 0, other: 0 };
  const server = createServer(async (request, response) => {
    receipts.push(request.url);
    request.resume(); response.setHeader('content-type', 'application/json');
    if (request.url.endsWith('/pause-state')) {
      const value = observation(++counts.pause);
      if (value === null) return; // Explicitly held until the child aborts.
      if (value === undefined) { response.writeHead(503); response.end('{}'); }
      else response.end(JSON.stringify(value));
    } else if (request.url.endsWith('/recall')) {
      counts.recall++; await beforeReply?.(); response.end(JSON.stringify({ memories }));
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
  return { counts, env, input, receipts, root, endpoint };
}
async function run(t, f, action, { entry = hook, preload, onSpawn } = {}) {
  const events = [], started = performance.now();
  const child = spawn(process.execPath, [...(preload ? [preload].flat().flatMap(path => ['--import', path]) : []), entry, ...(action ? [action] : [])],
    { env: f.env, stdio: ['pipe', 'pipe', 'pipe', 'ipc'] });
  let stdout = '', stderr = '';
  child.stdout.on('data', data => { stdout += data; }); child.stderr.on('data', data => { stderr += data; });
  child.on('message', event => events.push(event));
  const done = new Promise((resolve, reject) => {
    child.once('error', reject); child.once('close', (code, signal) => resolve({ code, signal }));
  });
  t.after(async () => { if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL'); await done; });
  onSpawn?.(child);
  child.stdin.end(JSON.stringify(f.input));
  const result = await done;
  assert.equal(result.code, 0); assert.equal(result.signal, null); assert.equal(stderr, '');
  return { stdout, events, elapsedMs: performance.now() - started };
}

const nativePreload = fileURLToPath(new URL('./fixtures/pause-native-preload.mjs', import.meta.url));
const orderPreload = fileURLToPath(new URL('./fixtures/pause-recall-order-preload.mjs', import.meta.url));
const memory = { id: '11111111-1111-4111-8111-111111111111', content: 'Synthetic remembered preference.',
  kind: 'fact', scope: 'personal', projectId: null, origin: 'explicit', confidence: 1,
  createdAt: '2026-10-01T00:00:00Z', updatedAt: '2026-10-01T00:00:00Z', receipts: [{ client: 'claude-code',
    sessionId: 's', eventId: 'e', role: 'user', excerpt: 'Synthetic source.', createdAt: '2026-10-01T00:00:00Z' }] };
for (const portable of [false, true]) {
  const preload = portable ? [nativePreload, orderPreload] : orderPreload;
  test(`recall ${portable} has one fresh observation after preparation and none after fetch`, { timeout: 15000 }, async t => {
    const f = await fixture(t, () => active, [memory]);
    const result = await run(t, f, 'recall', { preload });
    assert.deepEqual(f.receipts, ['/api/memory/pause-state', '/api/memory/recall'], 'one_prefetch_get_receipt_order');
    assert.match(JSON.parse(result.stdout).hookSpecificOutput.additionalContext, /Synthetic remembered/);
    const events = result.events;
    const pause = events.findIndex(event => event.kind === 'fetch' && event.route === 'pause-state');
    const fetch = events.findIndex(event => event.kind === 'fetch' && event.route === 'recall');
    const prepared = events.map((event, index) => ({...event, index})).filter(event => event.kind === 'prepared');
    assert.ok(prepared.some(event => event.part === 'project'), 'project_await_was_exercised');
    assert.ok(prepared.some(event => event.part === 'quota'), 'quota_await_was_exercised');
    assert.ok(prepared.every(event => event.index < pause), 'all_preparation_before_pause_get');
    assert.ok(pause >= 0 && fetch > pause, 'fresh_observation_before_fetch');
    const start = events.find(event => event.kind === 'output-gate');
    const output = events.find(event => event.kind === 'output');
    assert.ok(start && output, 'output_inside_local_gate');
    console.log('LOCAL_OUTPUT ' + JSON.stringify({node:process.versions.node,portable,localMs:output.ms-start.ms}));
  });
  for (const [label, remote] of [['paused', paused], ['unavailable', undefined], ['unenforced', {...active,enforced:false}], ['invalid', {...active,extra:true}]]) {
    test(`recall ${portable} denies ${label} before fetch`, { timeout: 15000 }, async t => {
      const f = await fixture(t, () => remote, [memory]);
      const result = await run(t, f, 'recall', { preload });
      assert.deepEqual(f.receipts, ['/api/memory/pause-state'], 'pre_fetch_denial');
      assert.equal(result.stdout, '');
    });
  }
  test(`recall ${portable} suppresses output when another hook pauses after fetch starts`, { timeout: 15000 }, async t => {
    let f;
    f = await fixture(t, () => active, [memory], async () => {
      const pause = await run(t, f, 'pause', { preload: portable ? nativePreload : undefined });
      assert.match(pause.stdout, /is paused/);
    });
    const result = await run(t, f, 'recall', { preload });
    assert.equal(f.counts.recall, 1, 'recall_already_started');
    assert.equal(result.stdout, '', 'local_pause_suppresses_context');
    assert.deepEqual(f.receipts, ['/api/memory/pause-state', '/api/memory/recall']);
  });
}

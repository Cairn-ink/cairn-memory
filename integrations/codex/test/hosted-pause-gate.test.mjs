import test from 'node:test';
import fsPromises from 'node:fs/promises';
import { syncBuiltinESMExports } from 'node:module';
import { withWriteObserver } from '../../client/private-state.mjs';
import { observeHostedPause } from '../../client/hosted-pause.mjs';
import { recallContext } from '../hosted-lifecycle.mjs';
import assert from 'node:assert/strict';
import { appendFile, mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { stateLock } from '../../client/state-lock.mjs';
import { readControlState } from '../../client/control-state.mjs';
import { hostedTargetId } from '../../client/transport-hosted.mjs';
import { createTestWorkspace } from '../../../tools/testing/workspace.mjs';

const repo = fileURLToPath(new URL('../../../', import.meta.url));
const observer = join(repo, 'integrations/client/hosted-pause.mjs');
const lifecycle = join(repo, 'integrations/codex/hosted-lifecycle.mjs');
const plugin = join(repo, 'plugins/cairn-memory/scripts/hook.mjs');
const childRunner = fileURLToPath(new URL('./fixtures/pause-gate-child.mjs', import.meta.url));
const active = { paused: false, generation: 0, enforced: true };
const paused = { paused: true, generation: 1, enforced: true };
const rendezvous = () => Promise.withResolvers();
function start(t, script, args, input, extra = {}) {
  const child = spawn(process.execPath, [script, ...args], {
    env: { PATH: '/usr/bin:/bin', LANG: 'C.UTF-8', HOME: process.env.HOME, TMPDIR: tmpdir(), ...extra }, stdio: ['pipe', 'pipe', 'pipe'],
  });
  t.after(() => { if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL'); });
  let stdout = '', stderr = '';
  child.stdout.on('data', x => { stdout += x; });
  child.stderr.on('data', x => { stderr += x; });
  const completed = new Promise((resolve, reject) => {
    child.on('error', reject);
    child.on('close', (code, signal) => resolve({ code, signal, stdout, stderr }));
  });
  child.stdin.end(input === undefined ? '' : JSON.stringify(input));
  return { child, completed };
}
function reply(response, value) {
  response.writeHead(200, { 'content-type': 'application/json' });
  response.end(JSON.stringify(value));
}
async function fixture(t, handler) {
  const dir = createTestWorkspace(t, { prefix: 'hosted-pause-gate-' }).path;
  const root = join(dir, 'state'); await mkdir(root, { mode: 0o700 });
  const server = createServer(handler);
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => { server.closeAllConnections(); server.close(); });
  return { dir, root, endpoint: `http://127.0.0.1:${server.address().port}` };
}

test('a fully received newer paused generation survives a lock timeout and blocks an older in-flight dispatch',
  { timeout: 15000 }, async t => {
    const secondRequest = rendezvous(), lockHeld = rendezvous(), releaseLock = rendezvous();
    let pauseRequests = 0, delayedResponse;
    const recalls = [], events = [];
    const f = await fixture(t, (request, response) => {
      if (request.url.endsWith('/pause-state')) {
        pauseRequests++;
        if (pauseRequests === 2) {
          // The server snapshots generation 0 before it processes the pause.
          delayedResponse = response; events.push('B: old second response snapshotted'); secondRequest.resolve();
        } else { events.push(pauseRequests === 1 ? 'B: first response g0' : 'A: full paused g1 response'); reply(response, pauseRequests === 1 ? active : paused); }
      } else {
        let bytes = ''; request.on('data', x => { bytes += x; });
        request.on('end', () => { recalls.push(JSON.parse(bytes)); events.push('B: recall query sent'); reply(response, { memories: [] }); });
      }
    });
    const b = start(t, childRunner, ['recall', lifecycle, f.root, f.endpoint]);
    await secondRequest.promise;
    const initialControl = await readControlState(f.root);
    const pausePath = join(f.root, 'hosted-pause', hostedTargetId(f) + '.json');
    const holder = stateLock(pausePath + '.lock', async () => {
      events.push('W: pause lock held'); lockHeld.resolve(); await releaseLock.promise;
    });
    t.after(() => releaseLock.resolve());
    await lockHeld.promise;
    const a = await start(t, childRunner, ['observe', observer, f.root, f.endpoint]).completed;
    assert.equal(a.code, 0); assert.equal(a.stderr, '');
    assert.equal(JSON.parse(a.stdout).error, 'state_busy'); events.push('A: state_busy; unavailable published; exited');
    const unavailabilityDirectory = join(f.root, 'hosted-pause-status', hostedTargetId(f) + '.json.observations');
    {
      const { readdir } = await import('node:fs/promises');
      assert.ok((await readdir(unavailabilityDirectory)).some(x => x.endsWith('.unavailable.json')));
    }
    releaseLock.resolve(); await holder; events.push('W: lock released');
    reply(delayedResponse, active);
    const result = await b.completed;
    assert.equal(result.code, 0); assert.equal(result.stderr, '');
    const persisted = JSON.parse(await readFile(pausePath, 'utf8'));
    const finalControl = await readControlState(f.root);
    t.diagnostic(JSON.stringify({ events, pauseRequests, persisted,
      boundaryRotated: finalControl.generation !== initialControl.generation,
      recalls: recalls.map(x => x.query) }));
    assert.equal(recalls.length, 0, 'newer observed paused state must prevent the old reply authorizing recall');
  });

test('Claude recall and capture respect a hosted pause already observed and published by a Codex hook',
  { timeout: 15000 }, async t => {
    const recalls = [], captures = []; let pauseRequests = 0;
    const f = await fixture(t, (request, response) => {
      if (request.url.endsWith('/pause-state')) { pauseRequests++; reply(response, paused); return; }
      let bytes = ''; request.on('data', x => { bytes += x; });
      request.on('end', () => {
        if (request.url.endsWith('/recall')) { recalls.push(JSON.parse(bytes)); reply(response, { memories: [] }); }
        else { captures.push(JSON.parse(bytes)); reply(response, { duplicate: false, memoryCount: 1 }); }
      });
    });
    const a = await start(t, childRunner, ['observe', observer, f.root, f.endpoint]).completed;
    assert.equal(a.code, 0); assert.equal(JSON.parse(a.stdout).result.paused, true);
    const local = await readControlState(f.root); assert.equal(local.paused, false);
    assert.notEqual(local.generation, 'initial');
    const pausePath = join(f.root, 'hosted-pause', hostedTargetId(f) + '.json');
    assert.deepEqual(JSON.parse(await readFile(pausePath, 'utf8')), paused);
    const before = pauseRequests;
    const pluginEnv = {
      CLAUDE_PLUGIN_DATA: f.root, CLAUDE_PLUGIN_OPTION_API_ENDPOINT: f.endpoint,
      CLAUDE_PLUGIN_OPTION_API_TOKEN: 'synthetic-token', CLAUDE_PLUGIN_OPTION_TELEMETRY: 'false',
    };
    const b = await start(t, plugin, ['recall'], { prompt: 'SYNTHETIC_CLAUDE_PAUSED_QUERY',
      session_id: 'synthetic-claude-session', cwd: f.dir }, pluginEnv).completed;
    assert.equal(b.code, 0); assert.equal(b.stderr, '');
    const transcript = join(f.dir, 'synthetic-transcript.jsonl');
    await writeFile(transcript, '');
    const captureInput = { session_id: 'synthetic-claude-capture', cwd: f.dir, transcript_path: transcript };
    const boundary = await start(t, plugin, ['capture'], captureInput, pluginEnv).completed;
    assert.equal(boundary.code, 0); assert.equal(boundary.stderr, '');
    assert.equal(captures.length, 0, 'the first capture establishes the rotated local boundary');
    await appendFile(transcript, JSON.stringify({ type: 'user', uuid: 'synthetic-message',
      message: { content: 'SYNTHETIC_CLAUDE_PAUSED_CAPTURE' } }) + '\n');
    const capture = await start(t, plugin, ['capture'], captureInput, pluginEnv).completed;
    assert.equal(capture.code, 0); assert.equal(capture.stderr, '');
    const published = JSON.parse(await readFile(pausePath, 'utf8'));
    assert.deepEqual(published, paused);
    t.diagnostic(JSON.stringify({ published, localPaused: local.paused,
      claudePauseRequests: pauseRequests - before, recalls: recalls.map(x => x.query),
      captures: captures.flatMap(x => x.messages.map(m => m.content)) }));
    assert.equal(captures.length, 0, 'a previous Codex hosted-pause observation must block Claude capture');
    assert.equal(recalls.length, 0, 'a previous Codex hosted-pause observation must block Claude recall');
  });


test('Codex final output guard rechecks an intent after its control-lock wait', { timeout: 10000 }, async t => {
  const root = join(createTestWorkspace(t).path, 'state');
  await mkdir(root, { mode: 0o700 });
  const config = { root, endpoint: 'http://127.0.0.1:1' };
  let remote = active, armed = false, recalls = 0;
  t.mock.method(globalThis, 'fetch', async url => {
    if (url.endsWith('/pause-state')) return Response.json(remote);
    recalls++;
    return Response.json({ memories: [{ id: '12345678-1234-4234-8234-123456789abc',
      content: 'Synthetic memory.', kind: 'preference', scope: 'personal', projectId: null,
      origin: 'explicit', confidence: 1, createdAt: '2026-10-01T00:00:00Z', updatedAt: '2026-10-01T00:00:00Z',
      receipts: [{ client: 'codex', sessionId: 's', eventId: 'e', role: 'user',
        excerpt: 'Synthetic memory.', createdAt: '2026-10-01T00:00:00Z' }] }] });
  });
  const entered = rendezvous(), release = rendezvous(), durable = rendezvous(), continueObservation = rendezvous();
  const nativeLink = fsPromises.link;
  const linkMock = t.mock.method(fsPromises, 'link', async function (source, destination) {
    if (armed && destination === join(root, 'control.lock')) {
      armed = false; entered.resolve(); await release.promise;
    }
    return nativeLink.call(this, source, destination);
  });
  syncBuiltinESMExports();
  let observing;
  const pending = recallContext({ prompt: 'Synthetic query', session_id: 's' }, config,
    'synthetic-token', 'a'.repeat(64), AbortSignal.timeout(8000), async () => { armed = true; return true; });
  pending.catch(() => {});
  t.after(async () => {
    release.resolve(); continueObservation.resolve();
    await Promise.allSettled([pending, observing]);
    linkMock.mock.restore(); syncBuiltinESMExports();
  });
  await Promise.race([entered.promise, pending.then(() => { throw new Error('final_output_gate_not_reached'); })]);
  remote = paused;
  observing = withWriteObserver(async ({ path, kind }) => {
    if (kind === 'write' && path.endsWith('/1.true.json')) {
      durable.resolve(); await continueObservation.promise;
    }
  }, () => observeHostedPause(config, 'synthetic-token'));
  observing.catch(() => {});
  await Promise.race([durable.promise, observing.then(() => { throw new Error('intent_not_recorded'); })]);
  release.resolve();
  await assert.rejects(pending, /pause_unavailable/, 'final_output_intent_guard');
  assert.equal(recalls, 1, 'recall_completed_before_the_output_race');
  continueObservation.resolve(); await observing;
});

for (const kind of ['timeout', 'death']) test(`Codex worker repairs ${kind} on another target before cursor adoption`, { timeout: 20000 }, async t => {
  const { fixture: workerFixture, item } = await import('./helpers.mjs');
  const { runWorker } = await import('../worker.mjs');
  const { interruptRotation } = await import('../../client/test/fixtures/pending-revocation.mjs');
  const f = await workerFixture(t);
  // B already has a generation-initial cursor. A is the observed paused target.
  const server = createServer((request, response) => { request.resume(); reply(response, paused); });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => { server.closeAllConnections(); server.close(); });
  const endpoint = `http://127.0.0.1:${server.address().port}`;
  await interruptRotation(t, { root: f.root, endpoint }, kind);
  await appendFile(f.path, item('SYNTHETIC_PAUSED_PERIOD'));
  const run = () => runWorker(f.binding, { mode: 'hosted', guard: f.guard, transport: f.transport });
  assert.equal((await run()).status, 'pause_boundary', 'root_pending_forces_boundary_on_B');
  assert.equal(f.calls.length, 0, 'zero_paused_period_bytes');
  await appendFile(f.path, item('SYNTHETIC_AFTER_BOUNDARY', 1));
  await run();
  const texts = f.calls.flatMap(body => body.messages).map(message => message.content);
  assert.deepEqual(texts, ['SYNTHETIC_AFTER_BOUNDARY'], 'only_post_boundary_bytes_sent');
});

for (const kind of ['timeout', 'death']) test(`Codex installed capture repairs ${kind} across resume and a generation-zero target`, { timeout: 20000 }, async t => {
  const { fixture: workerFixture, item } = await import('./helpers.mjs');
  const { runWorker } = await import('../worker.mjs');
  const { installedTransport } = await import('../hosted-lifecycle.mjs');
  const { automaticGuard } = await import('../../client/automatic-policy.mjs');
  const { interruptRotation } = await import('../../client/test/fixtures/pending-revocation.mjs');
  const f = await workerFixture(t), captures = [];
  let remoteA = paused, observationsB = 0;
  const a = createServer((request, response) => { request.resume(); reply(response, remoteA); });
  const b = createServer((request, response) => {
    if (request.url.endsWith('/pause-state')) { request.resume(); observationsB++; reply(response, active); return; }
    let bytes = ''; request.on('data', chunk => { bytes += chunk; });
    request.on('end', () => { captures.push(JSON.parse(bytes)); reply(response, { duplicate: false, memoryCount: 1 }); });
  });
  for (const server of [a, b]) {
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    t.after(() => { server.closeAllConnections(); server.close(); });
  }
  const config = { root: f.root, endpoint: `http://127.0.0.1:${b.address().port}` };
  f.binding.targetId = hostedTargetId(config); await f.observe();
  await interruptRotation(t, { root: f.root, endpoint: `http://127.0.0.1:${a.address().port}` }, kind);
  await appendFile(f.path, item('SYNTHETIC_PAUSED_PERIOD'));
  remoteA = { ...paused, paused: false };
  const remoteB = await observeHostedPause(config, 'synthetic-token');
  assert.equal(remoteB.generation, 0); assert.equal(remoteB.paused, false);
  const guard = automaticGuard(f.root, config.endpoint, { dailyCap: 10000, concurrency: 2 });
  const transport = installedTransport(config, 'synthetic-token', 0);
  const run = () => runWorker(f.binding, { mode: 'hosted', guard, transport });
  assert.equal((await run()).status, 'pause_boundary', 'installed_target_change_establishes_eof');
  assert.equal(captures.length, 0, 'zero_paused_period_posts');
  await appendFile(f.path, item('SYNTHETIC_AFTER_BOUNDARY', 1));
  await run();
  assert.equal(captures.length, 1, 'post_boundary_request_sent');
  assert.deepEqual(captures.flatMap(body => body.messages).map(message => message.content),
    ['SYNTHETIC_AFTER_BOUNDARY'], 'zero_paused_period_bytes_on_wire');
  assert.equal(observationsB, 3, 'target_change_and_both_capture_observations');
});

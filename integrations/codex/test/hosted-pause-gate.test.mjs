import test from 'node:test';
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

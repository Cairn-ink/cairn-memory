import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { appendFile, mkdir, readFile, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { createTestWorkspace } from '../../../tools/testing/workspace.mjs';
import { captureCursorPath } from '../lib/capture-cursor.mjs';
import { setPaused } from '../lib/control-state.mjs';

const hook = fileURLToPath(new URL('../scripts/hook.mjs', import.meta.url));
const preload = fileURLToPath(new URL('./fixtures/slow-start.mjs', import.meta.url));
const row = id => JSON.stringify({ type: 'user', uuid: id, timestamp: new Date().toISOString(),
  message: { content: `Synthetic ${id}` } }) + '\n';

async function fixture(t) {
  const workspace = createTestWorkspace(t, { prefix: 'start-budget-' });
  const dataDir = join(workspace.path, 'data'), transcript = join(workspace.path, 'transcript.jsonl');
  const sessionId = 'synthetic-session', captures = [];
  await mkdir(dataDir, { mode: 0o700 });
  const server = createServer(async (request, response) => {
    let text = '';
    for await (const chunk of request) text += chunk;
    response.setHeader('content-type', 'application/json');
    if (request.url === '/api/memory/pause-state') {
      response.end(JSON.stringify({ paused: false, generation: 0, enforced: true }));
    } else if (request.url.endsWith('/recall')) {
      response.end(JSON.stringify({ memories: [] }));
    } else {
      captures.push(JSON.parse(text));
      response.end(JSON.stringify({ duplicate: false, memoryCount: 0 }));
    }
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  workspace.defer(() => new Promise(resolve => { server.closeAllConnections(); server.close(resolve); }));

  async function run(action, { session = sessionId, delayMs } = {}) {
    const started = performance.now();
    const child = spawn(process.execPath, ['--import', preload, hook, action], {
      env: { HOME: workspace.path, CLAUDE_PLUGIN_DATA: dataDir,
        CLAUDE_PLUGIN_OPTION_API_ENDPOINT: `http://127.0.0.1:${server.address().port}`,
        CLAUDE_PLUGIN_OPTION_API_TOKEN: 'synthetic-token', CLAUDE_PLUGIN_OPTION_TELEMETRY: 'false',
        ...(delayMs === undefined ? {} : { CAIRN_TEST_SLOW_START_MS: String(delayMs) }) },
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    let stdout = '', stderr = '';
    child.stdout.on('data', chunk => stdout += chunk);
    child.stderr.on('data', chunk => stderr += chunk);
    const closed = new Promise((resolve, reject) => {
      child.once('error', reject); child.once('close', code => resolve(code));
    });
    workspace.defer(async () => {
      if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL');
      await closed;
    });
    child.stdin.on('error', () => {}); // An exhausted preload may exit before reading stdin.
    child.stdin.end(JSON.stringify({ session_id: session, transcript_path: transcript, cwd: '/synthetic/project',
      ...(action === 'recall' ? { prompt: 'Synthetic prompt' } : {}),
      ...(action === 'start-boundary' ? { source: 'startup' } : {}),
      hook_event_name: action === 'start-boundary' ? 'SessionStart' : action === 'recall' ? 'UserPromptSubmit' : 'Stop' }));
    const code = await closed, wallMs = performance.now() - started;
    const message = `start-boundary missed its budget (wall ${wallMs.toFixed(1)} ms)`;
    assert.equal(code, 0, `${message}: ${stderr}`);
    assert.equal(stderr, '', message);
    if (action === 'start-boundary') assert.equal(stdout, '', message);
    return { wallMs, message };
  }
  return { dataDir, transcript, captures, run,
    state: () => readFile(captureCursorPath(dataDir, sessionId), 'utf8').then(JSON.parse) };
}

for (const existing of [false, true]) {
  test(`320 ms startup preserves the first turn; existing transcript=${existing}`, { timeout: 15000 }, async t => {
    const f = await fixture(t);
    await f.run('recall', { session: 'synthetic-observer' });
    await setPaused(f.dataDir, true); await setPaused(f.dataDir, false);
    const prefix = row('before-boundary');
    if (existing) await writeFile(f.transcript, prefix);
    const { wallMs, message } = await f.run('start-boundary', { delayMs: 320 });
    const state = await f.state().catch(error => { if (error.code !== 'ENOENT') throw error; });
    assert.ok(state, message);
    if (existing) assert.equal(state.startOffset, Buffer.byteLength(prefix), message);
    else assert.equal(state.startPending, true, message);
    await f.run('recall');
    await appendFile(f.transcript, row('first-turn'));
    await f.run('capture');
    assert.deepEqual(f.captures.flatMap(body => body.messages.map(m => m.id)), ['first-turn'], message);
    t.diagnostic(JSON.stringify({ existing, delayMs: 320, wallMs }));
  });

  test(`1200 ms startup leaves no boundary authority; existing transcript=${existing}`, { timeout: 15000 }, async t => {
    const f = await fixture(t);
    await f.run('recall', { session: 'synthetic-observer' });
    await setPaused(f.dataDir, true); await setPaused(f.dataDir, false);
    if (existing) await writeFile(f.transcript, row('before-boundary'));
    // Authority, not wall time, is the contract here: a loaded runner may take
    // longer to collect the exit, but the hook must still write no boundary.
    const { wallMs, message } = await f.run('start-boundary', { delayMs: 1200 });
    assert.ok(wallMs >= 1200, message);
    await assert.rejects(f.state(), { code: 'ENOENT' }, message);
    await f.run('recall');
    await appendFile(f.transcript, row('unbounded-turn'));
    await f.run('capture');
    assert.deepEqual(f.captures, [], message);
    t.diagnostic(JSON.stringify({ existing, delayMs: 1200, wallMs }));
  });
}

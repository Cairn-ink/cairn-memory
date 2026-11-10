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
async function fixture(t, observation = () => active, memories = [], delay = 0) {
  const ws = createTestWorkspace(t), home = join(ws.path, 'home'), root = join(home, 'data');
  await mkdir(root, { recursive: true, mode: 0o700 });
  await writeFile(join(root, 'project-key'), '11111111-1111-4111-8111-111111111111\n', { mode: 0o600 });
  const transcript = join(ws.path, 'transcript.jsonl');
  await writeFile(transcript, JSON.stringify({ type: 'user', uuid: 'synthetic-message',
    message: { content: 'Synthetic capture text.' } }) + '\n');
  const counts = { pause: 0, recall: 0, capture: 0, other: 0 };
  const server = createServer(async (request, response) => {
    request.resume(); response.setHeader('content-type', 'application/json');
    if (request.url.endsWith('/pause-state')) {
      const value = await observation(++counts.pause);
      if (value === null) return; // Explicitly held until the child aborts.
      if (value === undefined) { response.writeHead(503); response.end('{}'); }
      else response.end(JSON.stringify(value));
    } else if (request.url.endsWith('/recall')) {
      counts.recall++; if(delay)await new Promise(resolve=>setTimeout(resolve,delay)); response.end(JSON.stringify({ memories }));
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
async function run(t, f, action, { entry = hook, preload, onSpawn } = {}) {
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
  onSpawn?.(child);
  child.stdin.end(JSON.stringify(f.input));
  const result = await done;
  assert.equal(result.code, 0); assert.equal(result.signal, null); assert.equal(stderr, '');
  return { stdout, events, elapsedMs: performance.now() - started };
}

const budgetPreload=fileURLToPath(new URL('./fixtures/pause-budget-preload.mjs',import.meta.url));
test('recall leaves a local output budget before the process cap',{timeout:10000},async t=>{
  const f=await fixture(t,async()=>{await new Promise(resolve=>setTimeout(resolve,900));return active;},[],4000);
  const result=await run(t,f,'recall',{preload:budgetPreload});
  const abort=result.events.find(event=>event.kind==='recall-aborted');
  assert.ok(abort,'recall_fetch_was_started');
  assert.ok(abort.ms>=3100 && abort.ms<=3300,'local_output_budget_reserved_before_fetch');
  assert.equal(f.counts.recall,1);assert.equal(result.stdout,'');
});
test('an unavailable diagnostic sync cannot hold recall past the host margin',{timeout:15000},async t=>{
  const f=await fixture(t,()=>null);
  f.env.SYNTHETIC_STALL_STATUS='1';
  const result=await run(t,f,'recall',{preload:budgetPreload});
  assert.ok(result.events.some(event=>event.kind==='unavailable-sync-started'),'unavailable_publication_attempted_immediately');
  assert.ok(result.elapsedMs<4000,'cap_cleanup_is_bounded');assert.equal(result.stdout,'');
});

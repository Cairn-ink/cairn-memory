import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from 'node:http';
import { setTimeout as delay } from 'node:timers/promises';
import { createTestWorkspace } from '../../../../tools/testing/workspace.mjs';
import { hostedTargetId } from '../../lib/http.mjs';
import { stateLock } from '../../../../integrations/client/state-lock.mjs';
const memory = { id: '11111111-1111-4111-8111-111111111111', content: 'Synthetic tail memory.',
  kind: 'fact', scope: 'personal', projectId: null, origin: 'explicit', confidence: 1,
  createdAt: '2026-10-01T00:00:00Z', updatedAt: '2026-10-01T00:00:00Z', receipts: [{ client: 'claude-code',
    sessionId: 's', eventId: 'e', role: 'user', excerpt: 'Synthetic source.', createdAt: '2026-10-01T00:00:00Z' }] };
export async function tailInvocation(t, responseMs, contended = false) {
  const ws = createTestWorkspace(t), home = join(ws.path, 'home'), root = join(home, 'data');
  await mkdir(root, { recursive: true, mode: 0o700 });
  await writeFile(join(root, 'project-key'), '11111111-1111-4111-8111-111111111111\n', { mode: 0o600 });
  let pauseCount = 0, fetchCount = 0, holder;
  const release = Promise.withResolvers(), acquired = Promise.withResolvers();
  const server = createServer(async (request, response) => {
    request.resume(); response.setHeader('content-type', 'application/json');
    if (request.url.endsWith('/pause-state')) {
      pauseCount++; await delay(300);
      response.end(JSON.stringify({ paused: false, generation: 0, enforced: true }));
    } else if (request.url.endsWith('/recall')) {
      fetchCount++;
      if (contended) {
        holder = stateLock(join(root, 'hosted-pause', hostedTargetId({ endpoint }) + '.json.gate'), async () => {
          acquired.resolve(); await release.promise;
        });
        await acquired.promise;
      }
      await delay(responseMs); response.end(JSON.stringify({ memories: [memory] }));
    } else response.end('{}');
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const endpoint = `http://127.0.0.1:${server.address().port}`;
  // An unchanged active warm observation requires no durability before fetch.
  await mkdir(join(root, 'hosted-pause'), { mode: 0o700 });
  await writeFile(join(root, 'hosted-pause', hostedTargetId({ endpoint }) + '.json'),
    JSON.stringify({ paused: false, generation: 0, enforced: true }), { mode: 0o600 });
  const events = [], started = Number(process.hrtime.bigint()) / 1e6;
  const child = spawn(process.execPath, ['--import', fileURLToPath(new URL('./pause-recall-tail-preload.mjs', import.meta.url)),
    fileURLToPath(new URL('../../scripts/hook.mjs', import.meta.url)), 'recall'], {
    env: { PATH: '/usr/bin:/bin', HOME: home, TMPDIR: ws.path, CLAUDE_PLUGIN_DATA: root,
      CLAUDE_PLUGIN_OPTION_API_ENDPOINT: endpoint, CLAUDE_PLUGIN_OPTION_API_TOKEN: 'synthetic-token',
      CLAUDE_PLUGIN_OPTION_TELEMETRY: 'false', CAIRN_TEST_OUTPUT_CONTENDED: String(contended),
      CAIRN_TEST_TAIL_MEMORY: JSON.stringify(memory), CAIRN_TEST_TAIL_RESPONSE_MS: String(responseMs) },
    stdio: ['pipe', 'pipe', 'pipe', 'ipc'],
  });
  let stdout = '', stderr = '';
  child.on('message', event => {
    events.push(event);
    if (event.kind === 'recall') {
      fetchCount++;
      if (contended) holder = stateLock(join(root, 'hosted-pause', hostedTargetId({ endpoint }) + '.json.gate'), async () => {
        acquired.resolve(); await release.promise;
      });
    }
  });
  child.stdout.on('data', data => { stdout += data; }); child.stderr.on('data', data => { stderr += data; });
  const done = new Promise(resolve => child.once('close', (code, signal) => resolve({ code, signal })));
  const timer = setTimeout(() => child.kill('SIGKILL'), 5000);
  child.stdin.end(JSON.stringify({ session_id: 'synthetic-session', prompt: 'Synthetic question' }));
  let outcome;
  try { outcome = await done; }
  finally { clearTimeout(timer); release.resolve(); await holder; server.closeAllConnections(); server.close(); }
  const elapsed = Number(process.hrtime.bigint()) / 1e6 - (events.find(event => event.kind === 'origin')?.wallOrigin ?? started);
  assert.equal(outcome.code, 0, 'child_exit_code'); assert.equal(outcome.signal, null); assert.equal(stderr, '');
  assert.equal(pauseCount, 1); assert.equal(fetchCount, 1);
  if (contended) assert.equal(stdout, '', 'contended_output_dropped');
  else {
    assert.ok(stdout.length > 0, 'nonempty_context_expected');
    assert.match(JSON.parse(stdout).hookSpecificOutput.additionalContext, /Synthetic tail memory/);
    assert.ok(events.some(event => event.kind === 'write-complete' && !event.failed), 'stdout_callback_completed');
  }
  // Close is after the process cap's timer callback and kernel reap scheduling.
  // Delivery itself is measured at the completion callback, against the cap.
  assert.ok(elapsed < 3500, 'process_exits_inside_cap');
  const complete = events.find(event => event.kind === 'write-complete');
  if (complete) assert.ok(complete.ms < 3500, 'complete_output_inside_cap');
  await ws.cleanup();
  return { node: process.versions.node, responseMs, contended, elapsed, events };
}

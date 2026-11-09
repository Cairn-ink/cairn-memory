import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createTestWorkspace } from '../../../tools/testing/workspace.mjs';
import { captureCursorPath } from '../lib/capture-cursor.mjs';

export const oldTime = '2020-01-02T03:04:05.123456+00:00';
export const row = (id, timestamp = oldTime, extra = {}) => JSON.stringify({
  type: 'user', uuid: id, ...(timestamp === undefined ? {} : { timestamp }),
  message: { content: `Synthetic ${id}` }, ...extra,
}) + '\n';

export async function harness(t, { fail = () => false, holdRecall } = {}) {
  const workspace = createTestWorkspace(t, { prefix: 'capture-window-' });
  const dataDir = join(workspace.path, 'data'), transcript = join(workspace.path, 'transcript.jsonl');
  await mkdir(dataDir, { mode: 0o700 });
  const sessionId = 'synthetic-session', statePath = captureCursorPath(dataDir, sessionId);
  const captures = [], recalls = [];
  const server = createServer(async (request, response) => {
    let text = '';
    for await (const chunk of request) text += chunk;
    const body = JSON.parse(text);
    if (request.url.endsWith('/recall')) {
      recalls.push(body);
      await holdRecall?.();
      response.writeHead(200, { 'content-type': 'application/json' });
      response.end(JSON.stringify({ memories: [] }));
    } else {
      captures.push(body);
      response.writeHead(fail(body, captures.length) ? 503 : 200, { 'content-type': 'application/json' });
      response.end(JSON.stringify({ duplicate: false, memoryCount: 0 }));
    }
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => { server.closeAllConnections(); server.close(); });
  async function run(action, extra = {}) {
    const hook = process.env.CAIRN_CAPTURE_TEST_HOOK ?? fileURLToPath(new URL('../scripts/hook.mjs', import.meta.url));
    const child = spawn(process.execPath, [hook, action], {
      env: { PATH: process.env.PATH, HOME: workspace.path, CLAUDE_PLUGIN_DATA: dataDir,
        CLAUDE_PLUGIN_OPTION_API_ENDPOINT: `http://127.0.0.1:${server.address().port}`,
        CLAUDE_PLUGIN_OPTION_API_TOKEN: 'synthetic-token', CLAUDE_PLUGIN_OPTION_TELEMETRY: 'false' },
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    t.after(() => { if (child.exitCode === null) child.kill(); });
    let stderr = '';
    child.stdout.resume(); child.stderr.on('data', chunk => stderr += chunk);
    child.stdin.end(JSON.stringify({ session_id: sessionId, transcript_path: transcript, cwd: '/synthetic/project',
      ...(action === 'recall' ? { prompt: 'Synthetic prompt' } : {}),
      ...(action === 'start' ? { source: 'startup' } : {}), hook_event_name: action === 'start' ? 'SessionStart' :
        action === 'recall' ? 'UserPromptSubmit' : 'Stop', ...extra }));
    const code = await new Promise((resolve, reject) => { child.once('error', reject); child.once('close', resolve); });
    assert.equal(code, 0, stderr); assert.equal(stderr, '');
  }
  return { workspace, dataDir, transcript, sessionId, statePath, captures, recalls, run,
    state: async () => JSON.parse(await readFile(statePath, 'utf8')),
    write: text => writeFile(transcript, text) };
}

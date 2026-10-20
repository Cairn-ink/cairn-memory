import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import { fileURLToPath } from 'node:url';
import { Client } from '@modelcontextprotocol/client';
import { StdioClientTransport } from '@modelcontextprotocol/client/stdio';

export const cli = fileURLToPath(new URL('../cli.mjs', import.meta.url));
export const namespace = { ownerId: 'synthetic-owner', scope: 'personal', projectId: null };
export const ok = result => { assert.equal(result.ok, true, JSON.stringify(result)); return result.value; };
export async function call(client, name, args = {}) {
  const response = await client.callTool({ name, arguments: args });
  const result = JSON.parse(response.content[0].text);
  assert.equal(response.isError, !result.ok);
  return result;
}
export async function host(workspace, path, { command = cli, owner = namespace.ownerId, enabled = true } = {}) {
  const transport = new StdioClientTransport({ command: process.execPath,
    args: ['--import', 'data:text/javascript,globalThis.fetch=()=>{process.exit(91)}', command,
      '--db', path, '--owner', owner, ...(enabled ? ['--private-cards', 'local-v1'] : [])],
    env: { OPENAI_API_KEY: '', NODE_NO_WARNINGS: '1', NODE_DISABLE_COMPILE_CACHE: '1' }, stderr: 'pipe' });
  let stderr = '';
  transport.stderr.on('data', chunk => { stderr += chunk; });
  const client = new Client({ name: 'synthetic-private-card-client', version: '1.0.0' });
  workspace.defer(() => client.close());
  await client.connect(transport);
  return { client, stderr: () => stderr };
}

export function review(workspace, path, card, { command = cli, extra = [] } = {}) {
  const args = [fileURLToPath(new URL('./fixtures/card-review-pty.py', import.meta.url)), process.execPath,
    '--import', 'data:text/javascript,globalThis.fetch=()=>{process.exit(91)}', command,
    'review-card', '--db', path, '--owner', namespace.ownerId, '--card', card.id, '--revision', String(card.revision), ...extra];
  const child = spawn('/usr/bin/python3', args, { stdio: 'pipe',
    env: { NODE_NO_WARNINGS: '1', NODE_DISABLE_COMPILE_CACHE: '1' } });
  let resolvePrompt, rejectPrompt, resolveDone, rejectDone, stderr = '';
  const prompt = new Promise((resolve, reject) => { resolvePrompt = resolve; rejectPrompt = reject; });
  const done = new Promise((resolve, reject) => { resolveDone = resolve; rejectDone = reject; });
  // A failure before the prompt is also observed through done.
  prompt.catch(() => {});
  child.stderr.on('data', chunk => { stderr += chunk; });
  const lines = createInterface({ input: child.stdout });
  let completed;
  lines.on('line', line => {
    try {
      const event = JSON.parse(line);
      if (event.event === 'prompt') resolvePrompt(event);
      if (event.event === 'done') completed = event;
    } catch (error) { rejectPrompt(error); rejectDone(error); }
  });
  const closed = new Promise(resolve => child.once('close', (code, signal) => {
    if (code !== 0 || signal || !completed) {
      const error = new Error(`PTY supervisor exit ${code}, signal ${signal}: ${stderr}`);
      rejectPrompt(error); rejectDone(error);
    } else { resolveDone(completed); rejectPrompt(new Error('review exited before prompt')); }
    resolve();
  }));
  child.once('error', error => { rejectPrompt(error); rejectDone(error); });
  workspace.defer(async () => {
    if (child.exitCode === null && child.signalCode === null) child.kill('SIGTERM');
    await closed;
    lines.close();
  });
  return { prompt, done, answer(answer) { child.stdin.write(JSON.stringify({ answer }) + '\n'); },
    eof() { child.stdin.write('{"eof":true}\n'); } };
}

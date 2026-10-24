import assert from 'node:assert/strict';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import { DatabaseSync } from 'node:sqlite';
import { Client } from '@modelcontextprotocol/client';
import { StdioClientTransport } from '@modelcontextprotocol/client/stdio';
import { openMemoryCore } from '../../../core/index.mjs';
import { rawRequest, splitRaw, localPlainPort } from '../../../core/testing/raw-fixtures.mjs';
import { createTestWorkspace } from '../../../tools/testing/workspace.mjs';
export { ok, call } from './card-support.mjs';

export const namespace = { ownerId: 'synthetic-retained-owner', scope: 'personal', projectId: null };
export const cli = fileURLToPath(new URL('../cli.mjs', import.meta.url));
export const cleanEnv = { NODE_NO_WARNINGS: '1', NODE_DISABLE_COMPILE_CACHE: '1' };
export const noNetwork = 'data:text/javascript,globalThis.fetch=()=>{throw Error("synthetic network forbidden")}';
export function fixture(t) {
  const workspace = createTestWorkspace(t, { prefix: 'retained-mcp-' });
  const path = join(workspace.path, '保留 #?%&+.sqlite'), profilePath = join(workspace.path, 'retained.json');
  let core, db, calls = 0;
  workspace.defer(() => db?.close()); workspace.defer(() => core?.close());
  core = openMemoryCore({ path, model: { contextWindow: 8192, countTokens: () => 1,
    extract() { calls++; return { items: [] }; } },
  rawConversations: { mode: 'raw-v1', capBytes: 1000000, port: localPlainPort(),
    readPolicy: () => ({ generation: 'synthetic', reason: null }) } });
  db = new DatabaseSync(path);
  const storeId = db.prepare('SELECT store_id FROM store_metadata').get().store_id;
  const profile = { version: 'local-raw-retained-profile-v1', path, storeId, namespace };
  writeFileSync(profilePath, JSON.stringify(profile), { mode: 0o600, flag: 'wx' });
  return { workspace, path, profilePath, profile, core, db, calls: () => calls,
    async capture(client = 'codex', sessionId = 'synthetic-session', text = '\uFEFF  Ａ🙂\t\nSynthetic source.  ', ns = namespace) {
      const parts = splitRaw(text); let last;
      for (let index = 0; index < parts.length; index++) {
        last = await core.captureRaw(rawRequest(parts[index], { namespace: ns, client, sessionId, eventId: sessionId + '-' + index }));
        assert.equal(last.ok, true, JSON.stringify(last));
      }
      return { text, result: last };
    } };
}
export async function host(workspace, profilePath, extra = {}) {
  let client;
  workspace.defer(() => client?.close());
  const transport = new StdioClientTransport({ command: process.execPath,
    args: ['--import', noNetwork, cli, '--retained-raw-profile', profilePath],
    env: { ...cleanEnv, OPENAI_API_KEY: 'synthetic\nmalformed-unused', ...extra.env }, stderr: 'pipe' });
  let stderr = ''; transport.stderr.on('data', chunk => { stderr += chunk; });
  client = new Client({ name: 'synthetic-retained-client', version: '1.0.0' });
  await client.connect(transport);
  return { client, stderr: () => stderr };
}
export function rawHost(workspace, profilePath) {
  let child, closed;
  const pending = new Map(); let ordinal = 0, stderr = '';
  workspace.defer(async () => { if (!child) return; if (child.exitCode === null && child.signalCode === null) child.kill('SIGTERM'); await closed; });
  child = spawn(process.execPath, ['--import', noNetwork, cli, '--retained-raw-profile', profilePath], { stdio: 'pipe', env: cleanEnv });
  child.stderr.on('data', chunk => { stderr += chunk; });
  const lines = createInterface({ input: child.stdout });
  lines.on('line', line => {
    const message = JSON.parse(line), request = pending.get(message.id);
    if (request) { clearTimeout(request.timer); pending.delete(message.id); request.resolve(message); }
  });
  closed = new Promise(resolve => child.once('close', (code, signal) => {
    for (const request of pending.values()) { clearTimeout(request.timer); request.reject(Error(`raw host closed ${code}/${signal}: ${stderr}`)); }
    pending.clear(); lines.close(); resolve({ code, signal });
  }));
  return { child, closed, request(method, params) {
    const id = ++ordinal;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { pending.delete(id); reject(Error('synthetic raw request timeout')); }, 10000);
      pending.set(id, { resolve, reject, timer });
      child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n');
    });
  }, notify(method, params) { child.stdin.write(JSON.stringify({ jsonrpc: '2.0', method, ...(params ? { params } : {}) }) + '\n'); } };
}
export function terminal(workspace, profilePath, card, { extra = [] } = {}) {
  let child, closed;
  workspace.defer(async () => { if (!child) return; if (child.exitCode === null && child.signalCode === null) child.kill('SIGTERM'); await closed; });
  const args = [fileURLToPath(new URL('./fixtures/card-review-pty.py', import.meta.url)), process.execPath,
    '--import', noNetwork, cli, 'review-card', '--retained-raw-profile', profilePath,
    '--card', card.id, '--revision', String(card.revision), ...extra];
  child = spawn('/usr/bin/python3', args, { stdio: 'pipe', env: cleanEnv });
  let resolvePrompt, rejectPrompt, resolveDone, rejectDone, event, stderr = '';
  const prompt = new Promise((resolve, reject) => { resolvePrompt = resolve; rejectPrompt = reject; }); prompt.catch(() => {});
  const done = new Promise((resolve, reject) => { resolveDone = resolve; rejectDone = reject; }); done.catch(() => {});
  child.stderr.on('data', chunk => { stderr += chunk; });
  const lines = createInterface({ input: child.stdout }); workspace.defer(() => lines.close());
  lines.on('line', line => { try { const value = JSON.parse(line); if (value.event === 'prompt') resolvePrompt(value); if (value.event === 'done') event = value; }
    catch (error) { rejectPrompt(error); rejectDone(error); } });
  closed = new Promise(resolve => {
    child.once('error', error => { rejectPrompt(error); rejectDone(error); resolve(); });
    child.once('close', (code, signal) => {
      if (code !== 0 || signal || !event) { const error = new Error(`Synthetic PTY supervisor exit ${code}/${signal}: ${stderr}`); rejectPrompt(error); rejectDone(error); }
      else { resolveDone(event); rejectPrompt(Error('review exited before prompt')); }
      resolve();
    });
  });
  return { prompt, done, child, closed, answer: answer => child.stdin.write(JSON.stringify({ answer }) + '\n'),
    eof: () => child.stdin.write('{"eof":true}\n') };
}

export async function discover(client, rawClient = 'codex') {
  const { call, ok } = await import('./card-support.mjs');
  const listed = ok(await call(client, 'list_raw_conversations', { client: rawClient }));
  assert.ok(listed.conversations.length);
  const conversationId = listed.conversations[0].id;
  const pages = []; let cursor;
  do {
    const page = ok(await call(client, 'read_raw_conversation', { conversationId, limit: 1, ...(cursor ? { cursor } : {}) }));
    pages.push(page); cursor = page.nextCursor;
  } while (cursor);
  return { listed, pages, conversationId, message: pages[0].messages[0], revision: pages[0].conversation.revision };
}
export async function rawDraft(client, actionId = 'synthetic-raw-draft') {
  const { call, ok } = await import('./card-support.mjs');
  const found = await discover(client);
  const resolved = ok(await call(client, 'resolve_source_references', { anchors: [{ rawAnchor: {
    conversationId: found.conversationId, messageId: found.message.id, start: 0, end: found.message.totalUnits,
    precision: 'whole-message' }, expectedConversationRevision: found.revision }] }));
  const sources = resolved.sources.map(({ namespace: ignored, ...source }) => source);
  const draft = ok(await call(client, 'create_private_card_draft', { actionId, title: 'Synthetic private title',
    body: 'Synthetic independently authored body.', sources }));
  return { ...found, sources, draft };
}

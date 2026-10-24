import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { join } from 'node:path';
import { createRequire } from 'node:module';
import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';

const require = createRequire(new URL('../../../adapters/mcp/package.json', import.meta.url));
const { Client } = await import(pathToFileURL(require.resolve('@modelcontextprotocol/client')));
const { StdioClientTransport } = await import(pathToFileURL(require.resolve('@modelcontextprotocol/client/stdio')));
export const namespace = { ownerId: 'synthetic-installed-retained', scope: 'personal', projectId: null };
export const text = '\uFEFF  Ａ🙂\t\n' + 'Synthetic exact retained source. '.repeat(180);
export const ok = result => { assert.equal(result.ok, true, JSON.stringify(result)); return result.value; };
export const noNetwork = 'data:text/javascript,globalThis.fetch=()=>{throw Error("synthetic network forbidden")}';
export const environment = workspace => ({ NODE_NO_WARNINGS: '1', NODE_DISABLE_COMPILE_CACHE: '1',
  TMPDIR: workspace.path, TMP: workspace.path, TEMP: workspace.path });
export async function call(client, name, input = {}) {
  const response = await client.callTool({ name, arguments: input });
  const result = JSON.parse(response.content[0].text); assert.equal(response.isError, !result.ok); return result;
}
export async function host(workspace, executable, args) {
  let client; workspace.defer(() => client?.close());
  const transport = new StdioClientTransport({ command: process.execPath,
    args: ['--import', noNetwork, executable, ...args], env: environment(workspace), stderr: 'pipe' });
  let stderr = ''; transport.stderr.on('data', chunk => { stderr += chunk; });
  client = new Client({ name: 'synthetic-installed-retained', version: '1.0.0' });
  await client.connect(transport); return { client, stderr: () => stderr };
}
export function review(workspace, executable, profilePath, draft) {
  let child, closed;
  workspace.defer(async () => { if (!child) return; if (child.exitCode === null && child.signalCode === null) child.kill('SIGTERM'); await closed; });
  child = spawn('/usr/bin/python3', [fileURLToPath(new URL('../../../adapters/mcp/test/fixtures/card-review-pty.py', import.meta.url)),
    process.execPath, '--import', noNetwork, executable, 'review-card', '--retained-raw-profile', profilePath,
    '--card', draft.id, '--revision', String(draft.revision), '--applicability', 'current'],
  { stdio: 'pipe', env: environment(workspace) });
  let resolvePrompt, rejectPrompt, resolveDone, rejectDone, completed, stderr = '';
  const prompt = new Promise((resolve, reject) => { resolvePrompt = resolve; rejectPrompt = reject; }); prompt.catch(() => {});
  const done = new Promise((resolve, reject) => { resolveDone = resolve; rejectDone = reject; }); done.catch(() => {});
  child.stderr.on('data', chunk => { stderr += chunk; });
  const lines = createInterface({ input: child.stdout });
  lines.on('line', line => { try { const event = JSON.parse(line); if (event.event === 'prompt') resolvePrompt(event); if (event.event === 'done') completed = event; }
    catch (error) { rejectPrompt(error); rejectDone(error); } });
  closed = new Promise(resolve => {
    child.once('error', error => { rejectPrompt(error); rejectDone(error); lines.close(); resolve(); });
    child.once('close', (code, signal) => {
      if (code !== 0 || signal || !completed) { const error = Error(`installed PTY supervisor ${code}/${signal}: ${stderr}`); rejectPrompt(error); rejectDone(error); }
      else { resolveDone({ ...completed, supervisorCode: code, supervisorSignal: signal }); rejectPrompt(Error('no prompt')); }
      lines.close(); resolve();
    });
  });
  return { prompt, done, answer: () => child.stdin.write(JSON.stringify({ answer: `CONFIRM ${draft.id} ${draft.revision} APPLICABILITY current` }) + '\n') };
}
export async function discover(client, rawClient = 'codex') {
  const listed = ok(await call(client, 'list_raw_conversations', { client: rawClient }));
  assert.equal(listed.conversations.length, 1);
  const conversationId = listed.conversations[0].id, pages = []; let cursor;
  do { const page = ok(await call(client, 'read_raw_conversation', { conversationId, limit: 1, ...(cursor ? { cursor } : {}) }));
    pages.push(page); cursor = page.nextCursor;
  } while (cursor);
  return { conversationId, revision: pages[0].conversation.revision, message: pages[0].messages[0], pages };
}
export async function draft(client, actionId) {
  const found = await discover(client);
  const resolved = ok(await call(client, 'resolve_source_references', { anchors: [{ rawAnchor: {
    conversationId: found.conversationId, messageId: found.message.id, start: 0, end: found.message.totalUnits,
    precision: 'whole-message' }, expectedConversationRevision: found.revision }] }));
  const sources = resolved.sources.map(({ namespace: ignored, ...source }) => source);
  const card = ok(await call(client, 'create_private_card_draft', { actionId, title: 'Synthetic installed Card',
    body: 'Synthetic owner-authored plan.', sources }));
  return { ...found, sources, card };
}

async function run() {
  globalThis.fetch = () => { throw Error('synthetic network forbidden'); };
  const [phase, installed, profilePath, ...args] = process.argv.slice(2);
  const corePath = join(installed, 'core/index.mjs'), { openMemoryCore } = await import(pathToFileURL(corePath));
  let core;
  try {
    if (phase === 'seed') {
      const path = args[0];
      core = openMemoryCore({ path, model: { contextWindow: 8192, countTokens: () => 1, extract: () => ({ items: [] }) },
        rawConversations: { mode: 'raw-v1', capBytes: 1000000, readPolicy: () => ({ generation: 'synthetic', reason: null }),
          port: { version: 'raw-seal-v1', sealRaw: ({ text }) => ({ format: 'local-plain-v1', keyVersion: null, sealed: Buffer.from(text) }),
            openRaw: ({ sealed }) => ({ text: Buffer.from(sealed).toString('utf8') }) } } });
      for (const client of ['codex', 'claude-code']) for (let start = 0, index = 0; start < text.length; index++) {
        let end = Math.min(start + 4000, text.length); if (/[\uD800-\uDBFF]/.test(text[end - 1])) end--;
        const captured = ok(await core.captureRaw({ namespace, client, sessionId: 'synthetic-' + client, eventId: 'event-' + index,
          messages: [{ id: 'synthetic-message', role: 'user', occurredAt: null, messageOrdinal: 1, content: text.slice(start, end),
            part: { index, start, totalUnits: text.length, totalBytes: Buffer.byteLength(text) } }] }));
        ok(captured.interpretation);
        start = end;
      }
      const storeId = ok(core.getLocalCaptureControl({ namespace, client: 'codex' })).storeId;
      writeFileSync(profilePath, JSON.stringify({ version: 'local-raw-retained-profile-v1', path, storeId, namespace }), { flag: 'wx', mode: 0o600 });
    } else {
      const profile = JSON.parse(readFileSync(profilePath));
      core = openMemoryCore({ path: profile.path, existingStore: { version: 'schema29-existing-v1', storeId: profile.storeId },
        rawConversations: { mode: 'off', configureCap: false, readPolicy: () => { throw Error('capture forbidden'); } } });
      if (phase === 'delete') ok(core.deleteConversation({ namespace, conversationId: args[0], expectedRevision: Number(args[1]), actionId: 'synthetic-delete-' + args[0] }));
      else assert.equal(phase, 'inspect');
    }
    assert.equal(ok(core.list({ namespace, limit: 1 })).memories.length, 0);
    console.log(JSON.stringify({ phase, pid: process.pid, importedCore: corePath, memoryCount: 0, providerCalls: 0 }));
  } finally { core?.close(); }
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await run();

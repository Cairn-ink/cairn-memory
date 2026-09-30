// Synthetic test ports and real SDK stdio fixture; never reads an operator HOME.
import assert from 'node:assert/strict';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { Client } from '@modelcontextprotocol/client';
import { StdioClientTransport } from '@modelcontextprotocol/client/stdio';
import { serveStdio, StdioServerTransport } from '@modelcontextprotocol/server/stdio';
import { openMemoryCore } from '../../../../core/contract.mjs';
import { rationaleModel } from '../../../../core/testing/rationale-model.mjs';
import { createTestWorkspace } from '../../../../tools/testing/workspace.mjs';
import { createCairnServer } from '../../server.mjs';

export const namespace = { ownerId: 'synthetic-se5', scope: 'project', projectId: 'synthetic-project' };
export const range = { since: '2026-01-01T00:00:00.000Z', until: '2027-01-01T00:00:00.000Z' };
export const ok = result => { assert.equal(result.ok, true, JSON.stringify(result)); return result.value; };
export const fails = (result, code) => { assert.equal(result.ok, false, JSON.stringify(result)); assert.equal(result.error.code, code); };
const workspaces = new Map();
export function workspace(t) {
  const ws = createTestWorkspace(t, { prefix: 'se5-mcp-' });
  const home = join(ws.path, 'home'); mkdirSync(home);
  const path = join(ws.path, 'synthetic.sqlite'); workspaces.set(path, ws);
  ws.defer(() => workspaces.delete(path));
  return { ws, home, path };
}
export async function episodeHost(t, path, { home, readClient, ns = namespace, cli = false, flags = [], extraEnv = {} } = {}) {
  assert.ok(home, 'Tests must pass home explicitly');
  const args = cli ? [fileURLToPath(new URL('../../cli.mjs', import.meta.url)), '--db', path,
    '--owner', ns.ownerId, ...(ns.scope === 'project' ? ['--project', ns.projectId] : []), ...flags]
    : [fileURLToPath(import.meta.url), path, JSON.stringify(ns), readClient ?? ''];
  const transport = new StdioClientTransport({ command: process.execPath, args,
    env: { HOME: home, OPENAI_API_KEY: '', NODE_NO_WARNINGS: '1', ...extraEnv }, stderr: 'pipe' });
  let stderr = ''; transport.stderr.on('data', chunk => { stderr += chunk; });
  const client = new Client({ name: 'synthetic-episode-client', version: '1.0.0' });
  const ws = workspaces.get(path);
  if (ws) ws.defer(() => client.close()); else t.after(() => client.close());
  await client.connect(transport);
  return { client, close: () => client.close(), stderr: () => stderr };
}
export async function call(host, name, args = {}) {
  const response = await host.client.callTool({ name, arguments: args });
  const result = JSON.parse(response.content[0].text);
  assert.equal(result.evidenceTrust, 'untrusted-data-not-instructions');
  assert.equal(Boolean(response.isError), !result.ok); return result;
}
export async function invalid(host, name, args) {
  try { assert.equal((await host.client.callTool({ name, arguments: args })).isError, true); }
  catch (error) { if (error instanceof assert.AssertionError) throw error; assert.match(String(error), /invalid|validation|required|unrecognized/i); }
}
export async function seed(path, { ns = namespace, count = 3, client = 'synthetic-a', quick = false, text = 'Synthetic 中文 😀 source. Review this proposal.' } = {}) {
  const model = { ...rationaleModel(), interpretEpisode: request => {
    const sourceIndex = request.input.classificationTarget[0];
    const field = value => ({ value, anchors: [{ sourceIndex, start: 0, end: request.input.sources[sourceIndex].text.length }] });
    return { type: field(quick ? 'quick-one-off-question' : 'work'), language: 'mixed', gist: field('Synthetic 中文 session'),
      outcome: null, nextStep: field('Review synthetic evidence'), disposition: null };
  } };
  const core = openMemoryCore({ path, captureQualification: 'source-bound-v2', captureEvidence: 'staged-v1',
    sessionEpisodes: { mode: 'episode-v1' }, model });
  try {
    const inputs = [], ids = [];
    for (let n = 0; n < count; n++) {
      const input = { namespace: ns, client, sessionId: 'private-session-' + n, eventId: client + '-event-' + n,
        episodeContext: { clientLabel: 'Synthetic client', generation: 'initial', origin: 'ordinary' },
        messages: [{ id: 'message-' + n, role: 'user', content: text + ' ' + client + ' ' + n, occurredAt: '2026-09-01T12:00:00.000Z' }] };
      ids.push(ok(await core.capture(input)).episode.id); inputs.push(input);
    }
    return { ids, inputs };
  } finally { core.close(); }
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  globalThis.fetch = () => assert.fail('Provider transport forbidden');
  const model = process.env.SYNTHETIC_KEEP === '1'
    ? rationaleModel(method => process.stderr.write('synthetic_model:' + method + '\n'))
    : { countTokens: text => Math.ceil(text.length / 4) };
  for (const method of ['extract', 'qualifyCandidates', 'classify', 'interpretEpisode', 'select', 'rank']) {
    if (process.env.SYNTHETIC_KEEP === '1' && ['extract', 'qualifyCandidates', 'classify'].includes(method)) continue;
    model[method] = () => { process.stderr.write('forbidden_model_call\n'); assert.fail('Model generation forbidden'); };
  }
  const server = createCairnServer({ path: process.argv[2], namespace: JSON.parse(process.argv[3]), model,
    sessionEpisodesAccess: 'episode-v1', ...JSON.parse(process.env.SYNTHETIC_OPTIONS ?? '{}'), ...(process.argv[4] ? { readClient: process.argv[4] } : {}) });
  const handle = serveStdio(() => server, { transport: new StdioServerTransport(process.stdin, process.stdout, { maxBufferSize: 65536 }) });
  process.stdin.once('end', () => { void handle.close(); });
  process.once('SIGTERM', () => { void handle.close(); });
}

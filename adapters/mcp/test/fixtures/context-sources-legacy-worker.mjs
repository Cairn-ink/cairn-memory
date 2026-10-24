// Runs unchanged against a separate 94c1076f tree and the candidate tree.
import crypto from 'node:crypto';
import { syncBuiltinESMExports } from 'node:module';
import { performance } from 'node:perf_hooks';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { writeFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { Client, InMemoryTransport } from '@modelcontextprotocol/client';

const [root, directory, report] = process.argv.slice(2);
let sequence = 0;
crypto.randomUUID = () => '00000000-0000-4000-8000-' + String(++sequence).padStart(12, '0');
crypto.randomBytes = size => Buffer.alloc(size, 7);
syncBuiltinESMExports();
const RealDate = Date, fixedTime = 1767225600000;
globalThis.Date = class extends RealDate { constructor(...args) { super(...(args.length ? args : [fixedTime])); } static now() { return fixedTime; } };
Object.defineProperty(performance, 'now', { configurable: true, value: () => 0 });
globalThis.fetch = () => { throw Error('network_forbidden'); };
const load = file => import(pathToFileURL(join(root, file)).href);
const { openMemoryCore } = await load('core/index.mjs');
const { createCairnServer } = await load('adapters/mcp/server.mjs');
const { parseConfiguration, start } = await load('adapters/mcp/cli.mjs');
const ns = { ownerId: 'synthetic-wire', scope: 'personal', projectId: null }, path = join(directory, 'canonical.sqlite');
const grants = new WeakMap(), token = {}, authority = { authorize(request, supplied) {
  if (supplied !== token) return null; const grant = {}, { input, ...binding } = request; grants.set(grant, binding); return grant;
}, isCurrent(grant) { return grants.has(grant) ? { ...grants.get(grant), accessGeneration: 1 } : null; } };
const counter = { id: 'synthetic-unit', countTokens: () => 1 }, query = { readSet: [ns], query: 'needle', types: ['memory'], intent: 'current' };
const plain = openMemoryCore({ path });
const result = { base: '94c1076ff64ade20cc49a246bb3fef2e5bd74173', defaultSurface: Object.keys(plain).sort(),
  defaultEmpty: plain.list({ namespace: ns }), defaultRefusal: plain.list({ namespace: ns, unknown: true }) };
for (let i = 0; i < 30; i++) {
  const value = plain.admit({ namespace: ns, memory: { content: 'needle synthetic ' + i, kind: 'fact' },
    receipts: [{ client: 'synthetic', sessionId: 'wire', eventId: String(i), role: 'user', excerpt: 'needle source ' + i }] });
  if (!value.ok) throw Error(JSON.stringify(value));
}
plain.close();
const core = openMemoryCore({ path, contextRead: { version: 'context-read-v1', authority, counter } });
result.capabilities = core.getContextReadCapabilities();
const refreshed = await core.refreshContextIndex({ readSet: [ns], types: ['memory'], intent: 'current', budget: { maxItems: 1024, maxMs: 5000 } }, token);
if (!refreshed.ok) throw Error(JSON.stringify(refreshed));
// SQLite's randomblob default is separate from node:crypto entropy. Pin only
// this opaque maintenance nonce, on both trees, before creating any ranking.
const side = new DatabaseSync(path + '.context-read-v1.sqlite'); side.exec("UPDATE generations SET incarnation='aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'"); side.close();
result.first = await core.findCandidates({ ...query, limit: 1 }, token);
result.cursor = await core.findCandidates({ ...query, limit: 1, cursor: result.first.value.nextCursor }, token);
result.refusal = await core.findCandidates({ ...query, sources: [] }, token);
result.semanticRefusal = await core.findCandidates({ ...query, semantic: true }, token);
result.limitRefusal = await core.findCandidates({ ...query, limit: 25 }, token);
result.deadlineRefusal = await core.findCandidates({ ...query, deadlineMs: 5001 }, token);
result.invalidCursor = await core.findCandidates({ ...query, cursor: 'invalid' }, token);
result.assembly = await core.contextRead(query, token);
result.fetch = core.fetchCandidateEvidence({ readSet: [ns], refs: result.first.value.items.map(item => item.ref), intent: 'current' }, token);
core.close();
const hosted = openMemoryCore({ path, contextRead: { version: 'context-read-v1', authority, counter, policy: { family: 'hosted' } } });
result.hostedCapabilities = hosted.getContextReadCapabilities();
result.hostedLexical = await hosted.findCandidates({ ...query, limit: 24 }, token);
hosted.close();
for (const enabled of [false, true]) {
  const server = createCairnServer({ path, namespace: ns, ...(enabled ? { contextRead: 'context-read-v1', contextCounter: counter } : {}) });
  const [clientSide, serverSide] = InMemoryTransport.createLinkedPair(), client = new Client({ name: 'synthetic-wire', version: '1' });
  await server.connect(serverSide); await client.connect(clientSide);
  const key = enabled ? 'contextHost' : 'defaultHost'; result[key] = { tools: await client.listTools() };
  if (enabled) {
    result[key].sourceRefusal = await client.callTool({ name: 'find_memory_candidates', arguments: { query: 'needle', types: ['memory'], intent: 'current', sources: [] } });
    const assembled = await client.callTool({ name: 'read_memory_context', arguments: { query: 'needle', types: ['memory'], intent: 'current', maxItems: 1 } });
    result[key].assembly = assembled;
    const refs = JSON.parse(assembled.content[0].text).value.items.map(item => item.ref);
    result[key].compactFetch = await client.callTool({ name: 'fetch_memory_candidate_evidence', arguments: { refs, intent: 'current' } });
  }
  await client.close(); await server.close();
}
const base = ['--db', '/synthetic/fixed.sqlite', '--owner', ns.ownerId];
result.parse = parseConfiguration([...base, '--context-read', 'context-read-v1']);
const log = console.log; console.log = value => { result.checkConfig = JSON.parse(value); };
await start(['--check-config', ...base, '--context-read', 'context-read-v1'], Object.defineProperty({}, 'OPENAI_API_KEY', { get() { throw Error('key_access'); } }));
console.log = log;
writeFileSync(report, JSON.stringify(result, null, 2) + '\n', { mode: 0o600 });

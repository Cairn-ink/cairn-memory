import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';
import test from 'node:test';
import { Client } from '@modelcontextprotocol/client';
import { StdioClientTransport } from '@modelcontextprotocol/client/stdio';
import { createCairnServer } from '../server.mjs';
import { parseConfiguration } from '../cli.mjs';
import { openMemoryCore } from '../../../core/contract.mjs';
import { createTestWorkspace } from '../../../tools/testing/workspace.mjs';

const cli = fileURLToPath(new URL('../cli.mjs', import.meta.url));
const fixture = fileURLToPath(new URL('./fixtures/indexed-canonical-server.mjs', import.meta.url));
const policy = ['--capture-source-policy', 'indexed-staged-v1'];
const access = ['--capture-evidence-access', 'staged-v1'];
const namespace = { ownerId: 'synthetic-canonical', scope: 'personal', projectId: null };
const tail = ' LATE_SYNTHETIC_DETAIL: earlier proposal rejected; Friday is current.';
const submitted = batchId => ({ batchId, messages: [
  { role: 'assistant', content: 'a'.repeat(1100) + ' Assistant suggestion is unadopted.' },
  { role: 'user', content: 'b'.repeat(1100) + tail },
] });
const expectedMessages = batch => batch.messages.map((message, index) => ({ ...message,
  id: createHash('sha256').update(JSON.stringify(['cairn.mcp.submitted-message.v1', batch.batchId, index])).digest('hex') }));
const ok = result => { assert.equal(result.ok, true, JSON.stringify(result)); return result.value; };
const error = (result, code) => { assert.equal(result.ok, false); assert.equal(result.error.code, code); };
async function call(host, name, args = {}) {
  const response = await host.client.callTool({ name, arguments: args });
  const result = JSON.parse(response.content[0].text);
  assert.equal(Boolean(response.isError), !result.ok);
  assert.equal(result.evidenceTrust, 'untrusted-data-not-instructions');
  return result;
}
async function host(workspace, path, { mode = 'empty', flags = policy, owner = namespace.ownerId,
  project, client = 'canonical-client', keyless = false, release } = {}) {
  const transport = new StdioClientTransport({ command: process.execPath,
    args: [keyless ? cli : fixture, '--db', path, '--owner', owner, '--client', client,
      '--session', 'canonical-session', ...(project ? ['--project', project] : []), ...flags],
    env: { OPENAI_API_KEY: '', NODE_NO_WARNINGS: '1', SYNTHETIC_CANONICAL_MODE: mode,
      ...(release ? { SYNTHETIC_RELEASE_FILE: release } : {}) }, stderr: 'pipe' });
  let stderr = ''; transport.stderr.on('data', chunk => { stderr += chunk; });
  const clientHandle = new Client({ name: 'synthetic-canonical-client', version: '1.0.0' });
  workspace.defer(() => clientHandle.close());
  await clientHandle.connect(transport);
  return { client: clientHandle, transport, close: () => clientHandle.close(),
    calls: () => [...stderr.matchAll(/synthetic_model:(\w+)/g)].map(match => match[1]),
    stderr: () => stderr };
}
const evidence = async (h, batchId) => ok(await call(h, 'inspect_capture_evidence', { batchId })).evidence;
async function waitForExtraction(h) {
  const until = Date.now() + 10000;
  while (!h.calls().includes('extract')) {
    assert(Date.now() < until, 'synthetic extraction must dispatch');
    await new Promise(resolve => setTimeout(resolve, 10));
  }
}

test('H1 explicit own canonical staging policy is accepted by the MCP host', async t => {
  const workspace = createTestWorkspace(t, { prefix: 'canonical-mcp-' });
  const server = createCairnServer({ path: join(workspace.path, 'memory.sqlite'),
    namespace: { ownerId: 'synthetic-canonical', scope: 'personal', projectId: null },
    captureSourcePolicy: 'indexed-staged-v1' });
  workspace.defer(() => server.close());
  await server.close();
});

test('H1/H3 policy is strict own data, conflicting own undefined/getters reject before database work', async t => {
  const ws = createTestWorkspace(t), path = join(ws.path, 'memory.sqlite');
  const options = { path, namespace };
  let reads = 0;
  for (const value of [undefined, null, false, 'indexed-evidence-v1', 'wrong']) {
    assert.throws(() => createCairnServer({ ...options, captureSourcePolicy: value }));
  }
  assert.throws(() => createCairnServer(Object.defineProperty({ ...options }, 'captureSourcePolicy', {
    enumerable: true, get() { reads++; return 'indexed-staged-v1'; } })));
  for (const field of ['captureQualification', 'captureRationale', 'captureEvidence', 'sessionEpisodes']) {
    assert.throws(() => createCairnServer({ ...options, captureSourcePolicy: 'indexed-staged-v1', [field]: undefined }));
    assert.throws(() => createCairnServer(Object.defineProperty({ ...options, captureSourcePolicy: 'indexed-staged-v1' }, field, {
      enumerable: true, get() { reads++; throw new Error('do-not-read'); } })));
  }
  assert.equal(reads, 0); assert.deepEqual(readdirSync(ws.path), []);
  const valid = ['--db', path, '--owner', namespace.ownerId];
  for (const flags of [['--capture-source-policy'], ['--capture-source-policy', 'wrong'], [...policy, ...policy],
    ...['--capture-qualification', '--capture-rationale', '--capture-evidence', '--session-episodes']
      .map(flag => [...policy, flag, 'wrong'])]) assert.throws(() => parseConfiguration([...valid, ...flags]));
  assert.equal(parseConfiguration([...valid, ...policy, '--capture-deadline-ms', '1000']).captureDeadlineMs, 1000);
  for (const key of ['', 'synthetic-private-key']) {
    const result = spawnSync(process.execPath, ['--import', 'data:text/javascript,globalThis.fetch=()=>{process.exit(91)}',
      cli, '--check-config', ...valid, ...policy], { encoding: 'utf8', timeout: 10000,
      env: { OPENAI_API_KEY: key, NODE_NO_WARNINGS: '1' } });
    assert.equal(result.status, 0, result.stderr); assert.equal(result.signal, null);
    const report = JSON.parse(result.stdout);
    assert.equal(report.captureSourcePolicy, 'indexed-staged-v1');
    assert.equal(report.qualificationStatus, 'not-requested'); assert.equal(report.automaticCapture, false);
    assert.equal(report.canonicalRetention.expiresAfterHours, 24);
    assert.equal(report.canonicalRetention.maxUnitsPerMessage, 4000);
    assert.equal(report.databaseOpened, false); assert.equal(report.providerContacted, false);
    assert(!result.stdout.includes('synthetic-private-key')); assert.deepEqual(readdirSync(ws.path), []);
  }
});

test('H1/H2 inherited policy is ignored and own policy snapshot preserves unqualified inventory/default recall', async t => {
  const ws = createTestWorkspace(t), path = join(ws.path, 'memory.sqlite');
  let reads = 0;
  const inherited = Object.create({ get captureSourcePolicy() { reads++; return 'indexed-staged-v1'; } });
  Object.assign(inherited, { path, namespace });
  const server = createCairnServer(inherited); ws.defer(() => server.close()); await server.close();
  assert.equal(reads, 0);
  const h = await host(ws, path);
  const tools = (await h.client.listTools()).tools;
  assert.deepEqual(tools.map(({ name }) => name).sort(), ['capture_memory', 'correct_memory', 'discard_capture_evidence',
    'forget_memory', 'inspect_capture_evidence', 'inspect_memory', 'recall_memory', 'remember_memory']);
  assert.match(tools.find(({ name }) => name === 'capture_memory').description, /without qualification/);
  assert.equal(tools.find(({ name }) => name === 'capture_memory').inputSchema.additionalProperties, false);
  const missing = await host(ws, path, { keyless: true });
  error(await call(missing, 'capture_memory', submitted('missing-model')), 'model_not_configured');
  const missingStage = await evidence(missing, 'missing-model');
  assert.equal(missingStage.state, 'failed');
  assert.deepEqual(missingStage.view.messages, expectedMessages(submitted('missing-model')));
  const accessOnly = await host(ws, path, { flags: access, keyless: true });
  assert.equal((await accessOnly.client.listTools()).tools.some(({ name }) => name === 'capture_memory'), false);
  const plain = await host(ws, path, { flags: [], keyless: true });
  assert.equal((await plain.client.listTools()).tools.length, 5);
  error(await call(plain, 'recall_memory', { query: 'No configured model' }), 'model_not_configured');
});

for (const mode of ['empty', 'malformed', 'failure']) test(`H4 ${mode} extraction retains late canonical source through keyless cold restart`,
  { timeout: 60000 }, async t => {
    const ws = createTestWorkspace(t), path = join(ws.path, 'memory.sqlite');
    const h = await host(ws, path, { mode }), batch = submitted(`canonical-${mode}`);
    const captured = await call(h, 'capture_memory', batch);
    if (mode === 'empty') assert.equal(ok(captured).qualificationStatus, 'not-requested');
    else error(captured, mode === 'failure' ? 'extraction_failed' : 'invalid_model_output');
    assert(!JSON.stringify(captured).includes('SYNTHETIC_PRIVATE_PROVIDER_ERROR'));
    const saved = await evidence(h, batch.batchId);
    assert.equal(saved.view.format, 'canonical-messages-v1');
    assert.deepEqual(saved.view.messages, expectedMessages(batch));
    assert.deepEqual(saved.view.retainedSourceWindow, { maxUnitsPerMessage: 4000, truncatedMessageIndices: [] });
    assert.deepEqual(ok(await call(h, 'inspect_memory')).memories, []);
    assert.deepEqual(h.calls(), ['extract']); await h.close();
    const cold = await host(ws, path, { flags: [...access, '--source-snapshot', 'current-admitted-v1'], keyless: true });
    assert.deepEqual(await evidence(cold, batch.batchId), saved);
    assert.deepEqual(ok(await call(cold, 'read_memory_sources')).memories, []);
    assert.deepEqual(ok(await call(cold, 'inspect_memory')).memories, []);
    assert.deepEqual(ok(await call(cold, 'discard_capture_evidence', { batchId: batch.batchId })), { discarded: true });
    assert.equal((await evidence(cold, batch.batchId)).view, null);
    assert.deepEqual(cold.calls(), []);
  });

test('H4/H5 nonempty capture keeps only bound receipts; duplicates, policy conflict, authority and isolation remain strict',
  { timeout: 60000 }, async t => {
    const ws = createTestWorkspace(t), path = join(ws.path, 'memory.sqlite');
    const h = await host(ws, path, { mode: 'nonempty' }), batch = submitted('admitted');
    const captured = ok(await call(h, 'capture_memory', batch)), memoryId = captured.admission.memories[0].id;
    assert.equal(captured.qualificationStatus, 'not-requested');
    assert.deepEqual(h.calls(), ['extract', 'classify']);
    const stored = ok(await call(h, 'inspect_memory', { memoryId, includeQualification: true }));
    assert.equal(stored.qualification, null); assert.equal(stored.receipts.length, 1);
    assert.equal(stored.receipts[0].role, 'assistant'); assert.equal(stored.receipts[0].excerpt, 'a'.repeat(800));
    const saved = await evidence(h, batch.batchId);
    assert.equal(ok(await call(h, 'capture_memory', batch)).duplicate, true);
    assert.equal((await evidence(h, batch.batchId)).expiresAt, saved.expiresAt);
    assert.deepEqual(h.calls(), ['extract', 'classify']);
    error(await call(h, 'capture_memory', { ...batch, messages: [{ role: 'user', content: 'Different payload' }] }), 'event_payload_conflict');
    for (const patch of [{ owner: 'other-owner' }, { project: 'other-project' }, { client: 'other-client' }]) {
      const other = await host(ws, path, { flags: access, keyless: true, ...patch });
      assert.equal(await evidence(other, batch.batchId), null); await other.close();
    }
    for (const field of ['namespace', 'ownerId', 'projectId', 'client', 'eventId']) {
      const response = await h.client.callTool({ name: 'inspect_capture_evidence', arguments: { batchId: batch.batchId, [field]: 'forged' } });
      assert.equal(response.isError, true);
    }
    const legacy = await host(ws, path, { flags: ['--capture-qualification', 'source-bound-v2'] });
    error(await call(legacy, 'capture_memory', batch), 'event_payload_conflict'); assert.deepEqual(legacy.calls(), []);
    const recall = ok(await call(h, 'recall_memory', { query: 'Synthetic interpretation' }));
    assert(!JSON.stringify(recall).includes(tail));
    ok(await call(h, 'discard_capture_evidence', { batchId: batch.batchId }));
    error(await call(h, 'capture_memory', batch), 'capture_evidence_closed');
    assert.equal(ok(await call(h, 'inspect_memory', { memoryId })).memory.id, memoryId);
  });

test('H5 pending discard fences actual late extraction and access-only inspection preserves legacy prefix distinction',
  { timeout: 60000 }, async t => {
    const ws = createTestWorkspace(t), path = join(ws.path, 'memory.sqlite'), release = join(ws.path, 'release');
    const h = await host(ws, path, { mode: 'deferred', release });
    ws.defer(() => { if (!existsSync(release)) writeFileSync(release, 'release', { flag: 'wx' }); });
    const batch = submitted('pending'), pending = call(h, 'capture_memory', batch);
    await waitForExtraction(h);
    const cold = await host(ws, path, { flags: access, keyless: true });
    ok(await call(cold, 'discard_capture_evidence', { batchId: batch.batchId }));
    writeFileSync(release, 'release', { flag: 'wx' });
    error(await pending, 'capture_evidence_closed'); assert.deepEqual(h.calls(), ['extract']);
    assert.deepEqual(ok(await call(cold, 'inspect_memory')).memories, []);
    const core = openMemoryCore({ path, captureQualification: 'source-bound-v2', captureEvidence: 'staged-v1',
      model: { contextWindow: 8192, countTokens: () => 100, extract: () => ({ items: [] }) } });
    ws.defer(() => core.close());
    ok(await core.capture({ namespace, client: 'canonical-client', sessionId: 'legacy', eventId: 'prefix',
      messages: [{ id: 'legacy-source', role: 'user', content: 'p'.repeat(1000) }] })); core.close();
    const prefix = await evidence(cold, 'prefix');
    assert.equal(Object.hasOwn(prefix.view, 'format'), false);
    assert.equal(prefix.view.messages[0].content.length, 800);
    assert.deepEqual(prefix.view.retainedSourceWindow.truncatedMessageIndices, [0]);
  });

test('H6 actual CLI oversize transport closes explicitly without source writes or payload reflection',
  { timeout: 30000 }, async t => {
    const ws = createTestWorkspace(t), path = join(ws.path, 'memory.sqlite');
    openMemoryCore({ path }).close();
    const child = spawn(process.execPath, [cli, '--db', path, '--owner', namespace.ownerId, ...policy], {
      env: { OPENAI_API_KEY: '', NODE_NO_WARNINGS: '1' }, stdio: ['pipe', 'pipe', 'pipe'] });
    ws.defer(async () => { if (child.exitCode === null && child.signalCode === null) { child.kill('SIGTERM'); await closed; } });
    let stdout = '', stderr = ''; child.stdout.on('data', chunk => { stdout += chunk; }); child.stderr.on('data', chunk => { stderr += chunk; });
    const closed = new Promise(resolve => child.once('close', (exit, signal) => resolve({ exit, signal })));
    const marker = 'SYNTHETIC_OVERSIZE_CANARY';
    const encoded = JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: {
      name: 'capture_memory', arguments: { batchId: 'oversize', messages: [{ role: 'user', content: marker + '🙂'.repeat(17000) }] } } });
    assert(Buffer.byteLength(encoded) > 65536); child.stdin.write(encoded + '\n');
    const result = await closed; assert.equal(result.signal, null); assert.equal(result.exit, 0);
    assert.match(stderr, /cairn_mcp_transport_error/); assert(!stdout.includes(marker)); assert(!stderr.includes(marker));
    const db = new DatabaseSync(path, { readOnly: true }); ws.defer(() => db.close());
    for (const table of ['staged_capture_evidence', 'admission_claims', 'memories']) {
      assert.equal(db.prepare(`SELECT count(*) AS n FROM ${table}`).get().n, 0);
    }
  });

test('H2 explicit original capture deadline applies to canonical capture without qualification or retry',
  { timeout: 30000 }, async t => {
    const ws = createTestWorkspace(t), h = await host(ws, join(ws.path, 'memory.sqlite'), {
      mode: 'deadline', flags: [...policy, '--capture-deadline-ms', '1000'] });
    error(await call(h, 'capture_memory', submitted('deadline')), 'model_timeout');
    assert.deepEqual(h.calls(), ['extract']);
    assert.equal((await evidence(h, 'deadline')).state, 'failed');
    assert.deepEqual(ok(await call(h, 'inspect_memory')).memories, []);
  });

test('H6 near-limit Unicode/escaped stdio input preserves canonical normalization without truncation',
  { timeout: 30000 }, async t => {
    const ws = createTestWorkspace(t), h = await host(ws, join(ws.path, 'memory.sqlite'));
    let captureBytes;
    const send = h.transport.send.bind(h.transport);
    h.transport.send = message => {
      if (message.method === 'tools/call' && message.params.name === 'capture_memory') {
        captureBytes = Buffer.byteLength(JSON.stringify(message) + '\n');
      }
      return send(message);
    };
    const canonical = '中🙂"\\';
    const batch = { batchId: 'near-limit', messages: Array.from({ length: 8 }, (_, index) => ({
      role: index % 2 ? 'user' : 'assistant', content: canonical + '\t'.repeat(3995) })) };
    ok(await call(h, 'capture_memory', batch));
    assert(captureBytes >= 64000 && captureBytes <= 65536, `actual submitted frame bytes: ${captureBytes}`);
    assert.deepEqual((await evidence(h, batch.batchId)).view.messages,
      expectedMessages(batch).map(message => ({ ...message, content: canonical })));
  });

test('H6 encoded-result ceiling is independent of larger MCP framing and rejects oversized results safely',
  { timeout: 30000 }, async t => {
    const ws = createTestWorkspace(t), path = join(ws.path, 'memory.sqlite');
    const core = openMemoryCore({ path }); ws.defer(() => core.close());
    let memoryId;
    for (let index = 0; index < 50; index++) {
      memoryId = ok(core.admit({ namespace, memory: { content: 'Synthetic response-boundary memory', kind: 'fact' },
        receipts: [{ client: 'c'.repeat(64), sessionId: 's'.repeat(200), eventId: String(index).padStart(200, 'e'),
          role: 'assistant', excerpt: '\u0001'.repeat(800) }] })).memory.id;
    }
    const h = await host(ws, path, { flags: access, keyless: true });
    const near = core.get({ namespace, memoryId, receiptLimit: 48 });
    const nearEncoded = JSON.stringify({ ...near, evidenceTrust: 'untrusted-data-not-instructions' });
    assert(Buffer.byteLength(nearEncoded) > 250000 && Buffer.byteLength(nearEncoded) <= 262144);
    const received = await h.client.callTool({ name: 'inspect_memory', arguments: { memoryId, receiptLimit: 48 } });
    assert.equal(received.content[0].text, nearEncoded);
    assert(Buffer.byteLength(JSON.stringify(received)) > 262144, 'MCP framing is not the encoded-result bound');
    const oversized = core.get({ namespace, memoryId, receiptLimit: 50 });
    assert(Buffer.byteLength(JSON.stringify(oversized)) > 262144);
    const rejected = await h.client.callTool({ name: 'inspect_memory', arguments: { memoryId, receiptLimit: 50 } });
    assert.equal(rejected.isError, true); error(JSON.parse(rejected.content[0].text), 'response_too_large');
    assert(!rejected.content[0].text.includes('Synthetic response-boundary memory'));
  });

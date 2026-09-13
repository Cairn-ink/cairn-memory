import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { spawn } from 'node:child_process';
import { existsSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { Client } from '@modelcontextprotocol/client';
import { StdioClientTransport } from '@modelcontextprotocol/client/stdio';
import { openMemoryCore } from '../../../core/contract.mjs';
import { createCairnServer } from '../server.mjs';

const cli = fileURLToPath(new URL('../cli.mjs', import.meta.url));
const fixture = fileURLToPath(new URL('./fixtures/qualified-server.mjs', import.meta.url));
const namespace = { ownerId: 'qualified-mcp-owner', scope: 'personal', projectId: null };
const database = () => join(mkdtempSync(join(tmpdir(), 'cairn-mcp-qualified-')), 'memory.sqlite');
const options = { timeout: 20000 };
async function host(t, path, { fake = true, enabled = true, owner = namespace.ownerId, project, forbidHttp = false } = {}) {
  const transport = new StdioClientTransport({ command: process.execPath, args: [fake ? fixture : cli,
    '--db', path, '--owner', owner, ...(project ? ['--project', project] : []),
    ...(enabled ? ['--capture-qualification', 'source-bound-v1'] : [])],
    env: { OPENAI_API_KEY: '', NODE_NO_WARNINGS: '1', SYNTHETIC_FORBID_HTTP: forbidHttp ? '1' : '0' }, stderr: 'pipe' });
  let stderr = ''; transport.stderr.on('data', (chunk) => { stderr += chunk.toString(); });
  const client = new Client({ name: 'synthetic-qualified-client', version: '1.0.0' });
  t.after(async () => { await client.close(); }); await client.connect(transport);
  return { client, close: () => client.close(), http: () => (stderr.match(/synthetic_http:/g) ?? []).length };
}
async function call(client, name, args = {}) {
  const response = await client.callTool({ name, arguments: args });
  const result = JSON.parse(response.content[0].text);
  assert.equal(Boolean(response.isError), !result.ok);
  assert.equal(result.evidenceTrust, 'untrusted-data-not-instructions'); return result;
}
const ok = (r) => { assert.equal(r.ok, true, JSON.stringify(r)); return r.value; };
const error = (r, code) => { assert.equal(r.ok, false, JSON.stringify(r)); assert.equal(r.error.code, code); };
async function invalid(client, name, args) {
  try { const result = await client.callTool({ name, arguments: args }); assert.equal(result.isError, true, JSON.stringify(result)); }
  catch (caught) { if (caught instanceof assert.AssertionError) throw caught; assert.match(String(caught), /invalid|validation|unrecognized|required/i); }
}
const capture = (patch = {}) => ({ batchId: 'synthetic-batch', messages: [{ role: 'user', content: 'I choose the violet tram 🚋.' }], ...patch });
const inspect = (client, memoryId, patch = {}) => call(client, 'inspect_memory', { memoryId, includeQualification: true, ...patch });
const material = (path) => { const db = new DatabaseSync(path); try {
  return ['memories', 'receipts', 'memory_qualifications', 'qualification_anchors', 'qualified_slots', 'qualified_claim_bindings']
    .map((table) => [table, db.prepare(`SELECT * FROM ${table} ORDER BY rowid`).all()]);
} finally { db.close(); } };

test('P1/P2 strict constructor setting rejects before opening and stdio discovery adds only opted-in capture', options, async (t) => {
  for (const captureQualification of [undefined, null, false, true, '', 'other']) {
    const path = database(); assert.throws(() => createCairnServer({ path, namespace, captureQualification }));
    assert.equal(existsSync(path), false);
  }
  for (const enabled of [false, true]) {
    const h = await host(t, database(), { enabled, fake: false }); const tools = (await h.client.listTools()).tools;
    assert.equal(tools.length, enabled ? 6 : 5);
    for (const tool of tools) assert.equal(tool.inputSchema.additionalProperties, false);
    if (enabled) {
      const tool = tools.find((tool) => tool.name === 'capture_memory'); assert.equal(tool.annotations.openWorldHint, true);
      assert.deepEqual(Object.keys(tool.inputSchema.properties).sort(), ['batchId', 'messages']);
      assert.deepEqual(tool.inputSchema.required.sort(), ['batchId', 'messages']);
      assert.equal(tool.inputSchema.properties.messages.items.additionalProperties, false);
    } else assert.equal(tools.some((tool) => tool.name === 'capture_memory'), false);
  }
});

test('P2/P3 actual fake-HTTP capture binds deterministic receipts, survives process restart and replays without HTTP', options, async (t) => {
  const path = database(); const first = await host(t, path); const submitted = capture();
  const result = ok(await call(first.client, 'capture_memory', submitted)); const id = result.admission.memories[0].id;
  assert.ok(first.http() >= 4); const before = first.http(); const saved = ok(await inspect(first.client, id));
  assert.equal(saved.qualification.anchors[0].text, submitted.messages[0].content);
  assert.equal(saved.receipts[0].client, 'cairn-local-mcp'); assert.equal(saved.receipts[0].sessionId, 'submitted-capture');
  assert.equal(saved.receipts[0].eventId, createHash('sha256').update(JSON.stringify([
    'cairn.mcp.submitted-message.v1', submitted.batchId, 0])).digest('hex'));
  assert.equal(saved.memory.origin, 'agent-inferred'); assert.equal(saved.memory.state, 'active');
  assert.equal(Object.hasOwn(result, 'reconciliation'), false);
  assert.equal(ok(await call(first.client, 'capture_memory', submitted)).duplicate, true); assert.equal(first.http(), before);
  const state = material(path); assert.deepEqual(state.at(-1)[1], []); assert.deepEqual(state.at(-2)[1], []);
  await first.close(); const cold = await host(t, path, { forbidHttp: true });
  assert.deepEqual(ok(await inspect(cold.client, id)), saved);
  assert.equal(ok(await call(cold.client, 'capture_memory', submitted)).duplicate, true); assert.equal(cold.http(), 0);
  await cold.close(); const keyless = await host(t, path, { fake: false, enabled: false });
  assert.deepEqual(ok(await inspect(keyless.client, id)), saved);
});

test('P3 changed content, role and order at same batch conflict without new HTTP or mutation', options, async (t) => {
  const path = database(); const h = await host(t, path);
  const original = capture({ messages: [{ role: 'user', content: 'First evidence' }, { role: 'assistant', content: 'Second evidence' }] });
  ok(await call(h.client, 'capture_memory', original)); const before = material(path); const requests = h.http();
  for (const messages of [[{ ...original.messages[0], content: 'Changed' }, original.messages[1]],
    [{ ...original.messages[0], role: 'assistant' }, original.messages[1]], [...original.messages].reverse()]) {
    error(await call(h.client, 'capture_memory', { ...original, messages }), 'event_payload_conflict');
    assert.deepEqual(material(path), before); assert.equal(h.http(), requests);
  }
});

test('P2/P3 forged authority, invalid bounds and malformed Unicode cannot mutate or contact provider', options, async (t) => {
  const path = database(); const h = await host(t, path); const before = material(path);
  for (const field of ['namespace', 'path', 'receipts', 'qualification', 'causal', 'slot', 'binding', 'transitions'])
    await invalid(h.client, 'capture_memory', { ...capture(), [field]: {} });
  for (const patch of [{ batchId: '' }, { batchId: 'x'.repeat(201) }, { batchId: 'bad\ud800' },
    { messages: [] }, { messages: Array(25).fill({ role: 'user', content: 'x' }) },
    { messages: [{ role: 'system', content: 'x' }] }, { messages: [{ role: 'user', content: '' }] },
    { messages: [{ role: 'user', content: 'x'.repeat(4001) }] },
    { messages: [{ role: 'user', content: 'bad\udc00' }] },
    { messages: [{ role: 'user', content: 'x', id: 'forged' }] },
    { messages: Array(6).fill({ role: 'user', content: 'x'.repeat(3500) }) }])
    await invalid(h.client, 'capture_memory', { ...capture(), ...patch });
  assert.deepEqual(material(path), before); assert.equal(h.http(), 0);
});

test('P3 empty extraction skips qualifier; missing model and malformed later qualification admit nothing', options, async (t) => {
  const path = database(); const h = await host(t, path);
  const empty = capture({ messages: [{ role: 'user', content: 'EMPTY' }] });
  assert.deepEqual(ok(await call(h.client, 'capture_memory', empty)).admission.memories, []);
  assert.equal(h.http(), 2); assert.equal(ok(await call(h.client, 'capture_memory', empty)).duplicate, true); assert.equal(h.http(), 2);
  const before = material(path);
  error(await call(h.client, 'capture_memory', capture({ batchId: 'bad', messages: [
    { role: 'user', content: 'Valid first extracted item' }, { role: 'assistant', content: 'INVALID_QUALIFICATION' }] })), 'invalid_model_output');
  assert.deepEqual(material(path), before);
  const keyless = await host(t, database(), { fake: false });
  error(await call(keyless.client, 'capture_memory', capture()), 'model_not_configured');
  assert.deepEqual(ok(await call(keyless.client, 'inspect_memory')).memories, []);
  assert.ok(ok(await call(keyless.client, 'remember_memory', { content: 'Explicit keyless note' })).memory.id);
});

test('P4/P7 redacted multilingual anchors inspect without authority, correction clears and forgetting hides', options, async (t) => {
  const path = database(); const h = await host(t, path); const secret = 'sk-' + 'a'.repeat(48);
  const result = ok(await call(h.client, 'capture_memory', capture({ messages: [{ role: 'assistant', content: `  Ａ 🚋 我選擇 ${secret}  ` }] })));
  const id = result.admission.memories[0].id; const saved = ok(await inspect(h.client, id));
  assert.equal(saved.qualification.anchors[0].text, 'A 🚋 我選擇 [REDACTED]');
  assert.equal(saved.receipts[0].role, 'assistant'); assert.ok(!JSON.stringify(saved).includes(secret));
  const plain = ok(await call(h.client, 'inspect_memory', { memoryId: id }));
  assert.equal(Object.hasOwn(plain, 'qualification'), false);
  assert.deepEqual(ok(await inspect(h.client, id, { includeQualification: false })), plain);
  for (const includeQualification of [false, true]) error(await call(h.client, 'inspect_memory', { includeQualification }), 'invalid_input');
  await invalid(h.client, 'inspect_memory', { memoryId: id, includeQualification: 'true' });
  for (const binding of [{ owner: 'foreign-owner' }, { project: 'foreign-project' }]) {
    const other = await host(t, path, { ...binding, fake: false });
    error(await inspect(other.client, id), 'memory_not_found'); await other.close();
  }
  const changed = ok(await call(h.client, 'correct_memory', { memoryId: id, expectedRevision: saved.memory.revision, content: 'A corrected note' }));
  assert.equal(ok(await inspect(h.client, id)).qualification, null);
  ok(await call(h.client, 'forget_memory', { memoryId: id, expectedRevision: changed.memory.revision }));
  error(await inspect(h.client, id), 'memory_not_found');
});

test('P4 historical qualification and receipt cursor remain inspectable keylessly after explicit supersession', options, async (t) => {
  const path = database(); let id; let original;
  const core = openMemoryCore({ path });
  // Trusted handwritten fixture uses the guarded transition API, not MCP or
  // source-qualification output, to establish retained qualified history.
  try {
    const receipt = (eventId, excerpt) => ({ client: 'synthetic', sessionId: 'history', eventId, role: 'user', excerpt });
    const admit = (value, extra = []) => {
      const content = `Project Alpha deadline is ${value}.`;
      return ok(core.admit({ namespace, memory: { content, kind: 'fact' },
        receipts: [receipt(value, content), ...extra], qualification: { version: 1,
          slot: { subject: 'Project Alpha', property: 'deadline', scope: 'work', applies: 'current release' },
          value, attribution: 'direct', commitment: 'adopted', anchors: [{ receiptIndex: 0,
            start: 0, end: content.length, text: content,
            fields: ['subject', 'property', 'scope', 'applies', 'value', 'attribution', 'commitment'] }] } })).memory;
    };
    const old = admit('Friday', [receipt('confirmation', 'Friday was confirmed.')]); const next = admit('Monday'); id = old.id;
    const ref = (memory) => ({ memoryId: memory.id, expectedRevision: memory.revision });
    const slot = ok(core.bindQualifiedClaim({ namespace, ...ref(old), slotId: null, singleClaim: true })).slotId;
    ok(core.bindQualifiedClaim({ namespace, ...ref(next), slotId: slot, singleClaim: true }));
    assert.equal(ok(core.transitionQualified({ namespace, predecessor: ref(old), replacement: ref(next) })).status, 'applied');
    original = ok(core.get({ namespace, memoryId: id, includeQualification: true }));
  } finally { core.close(); }
  const cold = await host(t, path, { fake: false }); const old = ok(await inspect(cold.client, id, { receiptLimit: 1 }));
  assert.equal(old.memory.state, 'historical'); assert.deepEqual(old.qualification, original.qualification);
  assert.ok(old.nextReceiptCursor);
  const second = ok(await inspect(cold.client, id, { receiptLimit: 1, receiptCursor: old.nextReceiptCursor }));
  const plain = ok(await inspect(cold.client, id, { includeQualification: false, receiptLimit: 1, receiptCursor: old.nextReceiptCursor }));
  const { qualification, ...rest } = second; assert.deepEqual(rest, plain);
  assert.deepEqual(qualification, original.qualification);
  assert.deepEqual(ok(await call(cold.client, 'inspect_memory', { states: ['historical'] })).memories.map((m) => m.id), [id]);
});

test('P3 incompatible submitted captures stay active without binding; a new-batch duplicate never rewrites qualification', options, async (t) => {
  const path = database(); const h = await host(t, path);
  const first = capture({ messages: [{ role: 'user', content: 'Project deadline is Friday.' }] });
  const original = ok(await call(h.client, 'capture_memory', first));
  const next = ok(await call(h.client, 'capture_memory', capture({ batchId: 'later-batch',
    messages: [{ role: 'user', content: 'Project deadline is Monday.' }] })));
  for (const memory of [...original.admission.memories, ...next.admission.memories])
    assert.equal(ok(await inspect(h.client, memory.id)).memory.state, 'active');
  assert.deepEqual(ok(await call(h.client, 'inspect_memory', { states: ['historical'] })).memories, []);
  const before = material(path);
  assert.deepEqual(before.at(-1)[1], []); assert.deepEqual(before.at(-2)[1], []);
  error(await call(h.client, 'capture_memory', { ...first, batchId: 'different-source-batch' }), 'qualification_conflict');
  assert.deepEqual(material(path), before);
});

test('P6 Unicode-escaped core-sized capture exceeding 64 KiB wire cap closes without payload reflection or storage', options, async (t) => {
  const path = database();
  const child = spawn(process.execPath, [cli, '--db', path, '--owner', namespace.ownerId,
    '--capture-qualification', 'source-bound-v1'], { env: { OPENAI_API_KEY: '', NODE_NO_WARNINGS: '1' }, stdio: 'pipe' });
  t.after(() => { if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL'); });
  let stdout = ''; let stderr = '';
  child.stdout.on('data', (chunk) => { stdout += chunk.toString(); });
  child.stderr.on('data', (chunk) => { stderr += chunk.toString(); }); child.stdin.on('error', () => {});
  const closed = new Promise((resolve) => child.once('close', resolve));
  const request = { jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'capture_memory',
    arguments: capture({ messages: Array.from({ length: 5 }, () => ({ role: 'user', content: '中'.repeat(4000) })) }) } };
  const encoded = JSON.stringify(request).replaceAll('中', '\\u4e2d');
  assert.ok(Buffer.byteLength(encoded) > 65536); child.stdin.write(encoded + '\n');
  await closed;
  assert.match(stderr, /cairn_mcp_transport_error/); assert.equal(stdout, '');
  assert.ok(!stderr.includes('u4e2d')); assert.ok(!stderr.includes('中'));
  // Rejected before initialization: lazy server construction never opens a DB.
  assert.equal(existsSync(path), false);
});

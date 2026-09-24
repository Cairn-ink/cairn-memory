import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { Client } from '@modelcontextprotocol/client';
import { InMemoryTransport } from '@modelcontextprotocol/server';
import { openMemoryCore } from '../../../core/contract.mjs';
import { createCairnServer } from '../server.mjs';

const namespace = { ownerId: 'mcp-admission-inspection', scope: 'personal', projectId: null };
const option = { classificationRecovery: 'guarded-v1' };
const ok = (result) => { assert.equal(result.ok, true, JSON.stringify(result)); return result.value; };
const ref = (member) => ({ memoryId: member.memoryId, revision: member.revision });
function pathFor(t) {
  const dir = mkdtempSync(join(tmpdir(), 'cairn-mcp-admission-inspect-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  return join(dir, 'memory.sqlite');
}
function model(steps = []) {
  const calls = [];
  return { calls, contextWindow: 8192, countTokens: () => 1,
    extract: async ({ input }) => { calls.push('extract'); return { items: [{ content: input.messages[0].content,
      kind: 'fact', confidence: 0.8, sourceIndices: [0] }] }; },
    qualify: async ({ input }) => { calls.push('qualify'); return { qualifications: input.items.map(({ itemIndex,
      sources }) => ({ itemIndex, qualification: { version: 1,
      slot: { subject: null, property: null, scope: null, applies: null }, value: null,
      attribution: 'unknown', commitment: 'unknown', anchors: [{ receiptIndex: 0,
        start: 0, end: sources[0].excerpt.length, text: sources[0].excerpt, fields: ['value'] }] } })) }; },
    classify: async ({ input }) => {
      calls.push('classify'); const step = steps.shift();
      if (step === 'throw') throw new Error('synthetic classifier failure');
      return { items: input.memories.map((memory) => ({ memoryId: memory.id, parentIds: [],
        ...(step === 'empty' ? {} : { newL1: { title: 'Synthetic topic', parentL2Ids: [] } }) })) };
    } };
}
async function host(t, path, suppliedModel, options = option) {
  const server = createCairnServer({ path, namespace, model: suppliedModel, ...options });
  const client = new Client({ name: 'admission-inspection-test', version: '1.0.0' });
  const [serverSide, clientSide] = InMemoryTransport.createLinkedPair();
  await server.connect(serverSide); await client.connect(clientSide);
  let closed = false;
  const close = async () => { if (closed) return; closed = true; await client.close(); await server.close(); };
  t.after(close);
  return { client, close };
}
async function call(client, name, args = {}) {
  const response = await client.callTool({ name, arguments: args });
  const result = JSON.parse(response.content[0].text);
  assert.equal(Boolean(response.isError), !result.ok);
  assert.equal(result.evidenceTrust, 'untrusted-data-not-instructions');
  return result;
}
async function invalid(client, args) {
  try {
    const result = await client.callTool({ name: 'inspect_capture_admission', arguments: args });
    assert.equal(result.isError, true);
  } catch (caught) {
    if (caught instanceof assert.AssertionError) throw caught;
    assert.match(String(caught), /invalid|validation|unrecognized|required/i);
  }
}

test('opt-in read tool is strict, keyless and bound to the configured namespace/client', async (t) => {
  const path = pathFor(t);
  const plain = await host(t, path, undefined, {});
  assert.equal((await plain.client.listTools()).tools.length, 5);
  await plain.close();
  const h = await host(t, path, undefined);
  const tools = (await h.client.listTools()).tools;
  assert.equal(tools.length, 7);
  const tool = tools.find(({ name }) => name === 'inspect_capture_admission');
  assert.ok(tool); assert.equal(tool.annotations.readOnlyHint, true);
  assert.equal(tool.annotations.openWorldHint, false);
  assert.deepEqual(Object.keys(tool.inputSchema.properties), ['batchId', 'includeInitialClassification']);
  for (const args of [{}, { batchId: '' }, { batchId: 'x', ownerId: 'other' },
    { batchId: 'x', client: 'other' }, { batchId: 'x', namespace },
    { batchId: 'x', path }, { batchId: 'x', payloadDigest: 'a'.repeat(64) },
    { batchId: 'x', includeInitialClassification: 'true' },
    { batchId: 'x', includeInitialClassification: null }]) await invalid(h.client, args);
  const other = openMemoryCore({ path }); t.after(() => other.close());
  const digest = 'a'.repeat(64);
  for (const [ns, client] of [[namespace, 'other-client'],
    [{ ...namespace, ownerId: 'other-owner' }, 'cairn-local-mcp']]) {
    const claimed = ok(other.claimAdmission({ namespace: ns, client, eventId: 'foreign',
      payloadDigest: digest, leaseMs: 125000 }));
    ok(other.finishAdmission({ namespace: ns, client, eventId: 'foreign', payloadDigest: digest,
      token: claimed.token, items: [] }));
  }
  assert.deepEqual(ok(await call(h.client, 'inspect_capture_admission', { batchId: 'foreign' })),
    { status: 'absent', classification: { status: 'unknown' } });
  assert.deepEqual(ok(await call(h.client, 'inspect_capture_admission',
    { batchId: 'foreign', includeInitialClassification: true })),
  { status: 'absent', classification: { status: 'unknown' },
    initialClassification: { status: 'unknown' } });
});

test('completed capture with failed or empty-parent classification remains admission-only on cold inspection', async (t) => {
  const path = pathFor(t);
  const initialModel = model(['throw', 'empty']);
  const first = await host(t, path, initialModel,
    { ...option, captureQualification: 'source-bound-v1' });
  const failedBatch = { batchId: 'failed-batch', messages: [{ role: 'user', content: 'Synthetic first source.' }] };
  const emptyBatch = { batchId: 'empty-batch', messages: [{ role: 'user', content: 'Synthetic second source.' }] };
  const failed = ok(await call(first.client, 'capture_memory', failedBatch));
  assert.equal(failed.classification.status, 'failed');
  const empty = ok(await call(first.client, 'capture_memory', emptyBatch));
  assert.equal(empty.classification.status, 'applied');
  const old = failed.admission.memories[0];
  const original = ok(await call(first.client, 'inspect_memory', { memoryId: old.id }));
  await first.close();
  const coldModel = model();
  const cold = await host(t, path, coldModel);
  const a = ok(await call(cold.client, 'inspect_capture_admission', { batchId: failedBatch.batchId }));
  const b = ok(await call(cold.client, 'inspect_capture_admission', { batchId: emptyBatch.batchId }));
  const aInitial = ok(await call(cold.client, 'inspect_capture_admission',
    { batchId: failedBatch.batchId, includeInitialClassification: true }));
  const bInitial = ok(await call(cold.client, 'inspect_capture_admission',
    { batchId: emptyBatch.batchId, includeInitialClassification: true }));
  assert.deepEqual(aInitial.initialClassification, { status: 'failed' });
  assert.deepEqual(bInitial.initialClassification, { status: 'applied' });
  assert.deepEqual(a.classification, { status: 'unknown' });
  assert.deepEqual(b.classification, { status: 'unknown' });
  assert.equal(a.status, 'completed'); assert.equal(b.status, 'completed');
  assert.equal(a.suppressedCount, 0); assert.equal(b.suppressedCount, 0);
  assert.deepEqual(a.members.map(({ status }) => status), ['current']);
  assert.deepEqual(b.members.map(({ filing }) => filing.status), ['unfiled']);
  assert.deepEqual(coldModel.calls, []);
  const exposed = JSON.stringify({ a, b });
  assert.equal(exposed.includes('Synthetic first source'), false);
  assert.equal(exposed.includes('Synthetic second source'), false);
  const placed = ok(await call(cold.client, 'classify_unfiled_memories', { refs: [ref(a.members[0])] }));
  assert.equal(placed.memories[0].filing.status, 'filed');
  assert.deepEqual(coldModel.calls, ['classify']);
  const after = ok(await call(cold.client, 'inspect_memory', { memoryId: old.id }));
  assert.equal(after.memory.content, original.memory.content);
  assert.deepEqual(after.receipts, original.receipts);
  const inspected = ok(await call(cold.client, 'inspect_capture_admission', { batchId: failedBatch.batchId }));
  assert.equal(inspected.members[0].filing.status, 'filed');
  assert.deepEqual(inspected.classification, { status: 'unknown' });
  assert.deepEqual(ok(await call(cold.client, 'inspect_capture_admission',
    { batchId: failedBatch.batchId, includeInitialClassification: true })).initialClassification,
  { status: 'unknown' });
  assert.deepEqual(coldModel.calls, ['classify']);
});

test('admitted membership survives interruption before classification, then explicit cold recovery preserves sources', async (t) => {
  const path = pathFor(t);
  const core = openMemoryCore({ path });
  const key = { namespace, client: 'cairn-local-mcp', eventId: 'interrupted-batch',
    payloadDigest: 'b'.repeat(64) };
  const claimed = ok(core.claimAdmission({ ...key, leaseMs: 125000 }));
  const completed = ok(core.finishAdmission({ ...key, token: claimed.token, items: [{
    content: 'Synthetic admitted before classification.', kind: 'fact', confidence: 0.8,
    receipts: [{ client: 'cairn-local-mcp', sessionId: 'submitted-capture',
      eventId: 'interrupted-batch', role: 'user', excerpt: 'Synthetic admitted before classification.' }],
  }] }));
  assert.equal(completed.memories.length, 1);
  core.close(); // Simulates losing the response before any classification attempt.
  const coldModel = model();
  const cold = await host(t, path, coldModel);
  const inspected = ok(await call(cold.client, 'inspect_capture_admission',
    { batchId: 'interrupted-batch' }));
  assert.equal(inspected.status, 'completed');
  assert.deepEqual(inspected.classification, { status: 'unknown' });
  assert.deepEqual(coldModel.calls, []);
  const member = inspected.members[0];
  assert.equal(member.memoryId, completed.memories[0].id);
  assert.equal(member.filing.status, 'unfiled');
  const before = ok(await call(cold.client, 'inspect_memory', { memoryId: member.memoryId }));
  const applied = ok(await call(cold.client, 'classify_unfiled_memories', { refs: [ref(member)] }));
  assert.equal(applied.memories[0].filing.status, 'filed');
  const after = ok(await call(cold.client, 'inspect_memory', { memoryId: member.memoryId }));
  assert.equal(after.memory.content, before.memory.content);
  assert.deepEqual(after.receipts, before.receipts);
  assert.deepEqual(coldModel.calls, ['classify']);
});

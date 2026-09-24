import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { Client } from '@modelcontextprotocol/client';
import { StdioClientTransport } from '@modelcontextprotocol/client/stdio';
import { InMemoryTransport } from '@modelcontextprotocol/server';
import { openMemoryCore } from '../../../core/contract.mjs';
import { parseConfiguration } from '../cli.mjs';
import { createCairnServer } from '../server.mjs';

const cli = fileURLToPath(new URL('../cli.mjs', import.meta.url));
const namespace = { ownerId: 'classification-recovery-test', scope: 'personal', projectId: null };
const option = { classificationRecovery: 'guarded-v1' };
const pathFor = (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'cairn-mcp-classify-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  return join(dir, 'memory.sqlite');
};
const ok = (result) => { assert.equal(result.ok, true, JSON.stringify(result)); return result.value; };
const errorCode = (result, code) => { assert.equal(result.ok, false); assert.equal(result.error.code, code); };
const ref = (memory) => ({ memoryId: memory.id, revision: memory.revision });
const receipt = (text) => ({ client: 'synthetic', sessionId: 's', eventId: text,
  role: 'user', excerpt: text });

function model(steps = []) {
  const calls = [];
  return { calls, contextWindow: 8192, countTokens: () => 1,
    extract: async ({ input }) => { calls.push('extract'); return { items: [{ content: input.messages[0].content,
      kind: 'preference', confidence: 0.8, sourceIndices: [0] }] }; },
    qualify: async ({ input }) => { calls.push('qualify'); return { qualifications: input.items.map(({ itemIndex,
      sources }) => ({ itemIndex, qualification: { version: 1,
      slot: { subject: null, property: null, scope: null, applies: null }, value: null,
      attribution: 'unknown', commitment: 'unknown', anchors: [{ receiptIndex: 0,
        start: 0, end: sources[0].excerpt.length, text: sources[0].excerpt, fields: ['value'] }] } })) }; },
    classify: async ({ input }) => {
      calls.push('classify'); const step = steps.shift();
      if (typeof step === 'function') return step(input);
      if (step === 'throw') throw new Error('synthetic failure');
      if (step === 'invalid') return { items: [] };
      return { items: input.memories.map((memory) => ({ memoryId: memory.id, parentIds: [],
        ...(step === 'empty' ? {} : { newL1: { title: 'Synthetic preferences', parentL2Ids: [] } }) })) };
    } };
}

async function host(t, path, config = {}) {
  const options = config.options ?? option;
  const suppliedModel = Object.hasOwn(config, 'suppliedModel') ? config.suppliedModel : model();
  const server = createCairnServer({ path, namespace, model: suppliedModel, ...options });
  const client = new Client({ name: 'classification-recovery-test', version: '1.0.0' });
  const [serverSide, clientSide] = InMemoryTransport.createLinkedPair();
  await server.connect(serverSide);
  await client.connect(clientSide);
  let closed = false;
  const close = async () => { if (closed) return; closed = true; await client.close(); await server.close(); };
  t.after(close);
  return { client, close, model: suppliedModel };
}

async function call(client, name, args = {}) {
  const response = await client.callTool({ name, arguments: args });
  const result = JSON.parse(response.content[0].text);
  assert.equal(Boolean(response.isError), !result.ok);
  assert.equal(result.evidenceTrust, 'untrusted-data-not-instructions');
  return result;
}
async function invalid(client, args) {
  try { const result = await client.callTool({ name: 'classify_unfiled_memories', arguments: args });
    assert.equal(result.isError, true); }
  catch (caught) {
    if (caught instanceof assert.AssertionError) throw caught;
    assert.match(String(caught), /invalid|validation|unrecognized|required/i);
  }
}

test('opt-in inventory, strict config and syntax-only keyless check', async (t) => {
  const path = pathFor(t);
  for (const setting of [undefined, null, '', 'other']) {
    assert.throws(() => createCairnServer({ path, namespace, classificationRecovery: setting }));
    assert.equal(existsSync(path), false);
  }
  for (const flags of [['--classification-recovery'], ['--classification-recovery', 'other'],
    ['--classification-recovery', 'guarded-v1', '--classification-recovery', 'guarded-v1']]) {
    assert.throws(() => parseConfiguration(['--db', path, '--owner', namespace.ownerId, ...flags]));
  }
  const checked = spawnSync(process.execPath, [cli, '--check-config', '--db', path,
    '--owner', namespace.ownerId, '--classification-recovery', 'guarded-v1'],
  { encoding: 'utf8', env: { OPENAI_API_KEY: '', NODE_NO_WARNINGS: '1' }, timeout: 5000 });
  assert.equal(checked.status, 0, checked.stderr);
  const report = JSON.parse(checked.stdout);
  assert.equal(report.classificationRecovery, 'guarded-v1');
  assert.equal(report.classification, 'model_not_configured');
  assert.equal(report.databaseOpened, false); assert.equal(report.providerContacted, false);
  assert.equal(existsSync(path), false);
  const keyed = spawnSync(process.execPath, [cli, '--check-config', '--db', path,
    '--owner', namespace.ownerId, '--classification-recovery', 'guarded-v1'],
  { encoding: 'utf8', env: { OPENAI_API_KEY: 'synthetic-not-used', NODE_NO_WARNINGS: '1' }, timeout: 5000 });
  assert.equal(keyed.status, 0, keyed.stderr);
  assert.equal(JSON.parse(keyed.stdout).classification, 'configured-not-verified');
  assert.equal(existsSync(path), false);
  const stdio = new Client({ name: 'classification-cli-test', version: '1.0.0' });
  t.after(() => stdio.close());
  await stdio.connect(new StdioClientTransport({ command: process.execPath, args: [cli, '--db', path,
    '--owner', namespace.ownerId, '--classification-recovery', 'guarded-v1'],
  env: { OPENAI_API_KEY: '', NODE_NO_WARNINGS: '1' }, stderr: 'pipe' }));
  assert.equal((await stdio.listTools()).tools.some(({ name }) => name === 'classify_unfiled_memories'), true);
  const cliMemory = ok(await call(stdio, 'remember_memory', { content: 'CLI keyless synthetic memory.' })).memory;
  errorCode(await call(stdio, 'classify_unfiled_memories', { refs: [ref(cliMemory)] }), 'model_not_configured');
  await stdio.close();
  const plain = await host(t, path, { options: {} });
  assert.equal((await plain.client.listTools()).tools.length, 5);
  await plain.close();
  const recovery = await host(t, path);
  const tools = (await recovery.client.listTools()).tools;
  assert.equal(tools.length, 6);
  const tool = tools.find((entry) => entry.name === 'classify_unfiled_memories');
  assert.ok(tool); assert.equal(tool.annotations.readOnlyHint, false);
  assert.equal(tool.annotations.openWorldHint, true);
  assert.equal(tool.inputSchema.additionalProperties, false);
  assert.deepEqual(Object.keys(tool.inputSchema.properties), ['refs']);
});

test('failed capture admits once, cold explicit classification files unchanged sources', async (t) => {
  const path = pathFor(t);
  const failing = await host(t, path, { options: { ...option, captureQualification: 'source-bound-v1' },
    suppliedModel: model(['throw']) });
  const submitted = { batchId: 'synthetic-batch', messages: [{ role: 'user', content: 'Use concise examples.' }] };
  const captured = ok(await call(failing.client, 'capture_memory', submitted));
  assert.deepEqual(captured.classification, { status: 'failed',
    error: { code: 'classification_failed', retryable: false } });
  const original = captured.admission.memories[0];
  const before = ok(await call(failing.client, 'inspect_memory', { memoryId: original.id }));
  assert.equal(before.memory.filing.status, 'unfiled');
  await failing.close();
  const coldModel = model(); const cold = await host(t, path, { options: { ...option, captureQualification: 'source-bound-v1' },
    suppliedModel: coldModel });
  const applied = ok(await call(cold.client, 'classify_unfiled_memories', { refs: [ref(original)] }));
  assert.equal(applied.status, 'applied');
  assert.equal(applied.memories[0].filing.status, 'filed');
  assert.deepEqual(coldModel.calls, ['classify']);
  const after = ok(await call(cold.client, 'inspect_memory', { memoryId: original.id }));
  assert.deepEqual(after.receipts, before.receipts);
  assert.equal(after.memory.content, before.memory.content);
  assert.equal(ok(await call(cold.client, 'capture_memory', submitted)).duplicate, true);
  assert.deepEqual(coldModel.calls, ['classify']);
  errorCode(await call(cold.client, 'classify_unfiled_memories', { refs: [ref(original)] }), 'revision_conflict');
  errorCode(await call(cold.client, 'classify_unfiled_memories', { refs: [ref(after.memory)] }), 'classification_target_not_unfiled');
  assert.deepEqual(coldModel.calls, ['classify']);
});

test('all refs preflight before model: stale, corrected, deleted, historical, foreign and mixed', async (t) => {
  const path = pathFor(t); const m = model(); const h = await host(t, path, { suppliedModel: m });
  const core = openMemoryCore({ path }); t.after(() => core.close());
  const admit = (text, ns = namespace) => ok(core.admit({ namespace: ns, memory: { content: text,
    kind: 'fact' }, receipts: [receipt(text)] })).memory;
  const valid = admit('Valid current memory');
  const corrected = admit('Old synthetic memory');
  ok(core.correct({ namespace, memoryId: corrected.id, expectedRevision: corrected.revision,
    content: 'Corrected synthetic memory', kind: 'fact', receipt: receipt('Correction') }));
  const deleted = admit('Forget synthetic memory');
  ok(core.forget({ namespace, memoryId: deleted.id, expectedRevision: deleted.revision }));
  const historical = admit('Historic synthetic memory');
  ok(core.supersede({ namespace, memoryId: historical.id, expectedRevision: historical.revision,
    replacement: { content: 'New current synthetic memory', kind: 'fact' }, receipts: [receipt('Replacement')] }));
  const historicalRef = ref(ok(core.get({ namespace, memoryId: historical.id })).memory);
  const foreign = admit('Foreign synthetic memory', { ...namespace, ownerId: 'other-owner' });
  for (const [target, expected] of [[ref(corrected), 'revision_conflict'],
    [ref(deleted), 'memory_not_found'], [historicalRef, 'classification_target_not_current'],
    [ref(foreign), 'memory_not_found'], [{ memoryId: 'missing', revision: 1 }, 'memory_not_found']]) {
    errorCode(await call(h.client, 'classify_unfiled_memories', { refs: [target] }), expected);
  }
  errorCode(await call(h.client, 'classify_unfiled_memories', { refs: [ref(valid), ref(deleted)] }), 'memory_not_found');
  assert.deepEqual(m.calls, []);
  assert.equal(ok(core.get({ namespace, memoryId: valid.id })).memory.filing.status, 'unfiled');
});

test('strict malformed input and keyless model never cause placement', async (t) => {
  const path = pathFor(t); const m = model(); const h = await host(t, path, { suppliedModel: m });
  const saved = ok(await call(h.client, 'remember_memory', { content: 'A current synthetic memory.' })).memory;
  const request = { refs: [ref(saved)] };
  for (const bad of [{}, { refs: [] }, { refs: Array(6).fill(ref(saved)) },
    { refs: [ref(saved), ref(saved)] }, { refs: [{ ...ref(saved), ownerId: 'other' }] },
    { refs: [{ ...ref(saved), revision: 0 }] }, { refs: [{ memoryId: '', revision: 1 }] },
    { refs: [{ memoryId: 'x'.repeat(201), revision: 1 }] }, { ...request, namespace },
    { ...request, ownerId: 'other' }, { ...request, projectId: 'other' },
    { ...request, path }, { ...request, batchId: 'forged' }]) await invalid(h.client, bad);
  assert.deepEqual(m.calls, []);
  await h.close();
  const keyless = await host(t, path, { suppliedModel: undefined });
  errorCode(await call(keyless.client, 'classify_unfiled_memories', request), 'model_not_configured');
  assert.equal(ok(await call(keyless.client, 'inspect_memory', { memoryId: saved.id })).memory.filing.status, 'unfiled');
});

test('classifier failure, invalid output and empty-parent placement report actual state', async (t) => {
  const path = pathFor(t); const m = model(['throw', 'invalid', 'empty', 'empty']);
  const h = await host(t, path, { suppliedModel: m });
  const saved = ok(await call(h.client, 'remember_memory', { content: 'A source-backed synthetic note.' })).memory;
  for (const expected of ['classification_failed', 'invalid_model_output']) {
    errorCode(await call(h.client, 'classify_unfiled_memories', { refs: [ref(saved)] }), expected);
    assert.equal(ok(await call(h.client, 'inspect_memory', { memoryId: saved.id })).memory.filing.status, 'unfiled');
  }
  const applied = ok(await call(h.client, 'classify_unfiled_memories', { refs: [ref(saved)] }));
  assert.equal(applied.status, 'applied');
  assert.equal(applied.memories[0].filing.status, 'unfiled');
  assert.equal(applied.memories[0].revision, saved.revision);
  const repeated = ok(await call(h.client, 'classify_unfiled_memories', { refs: [ref(saved)] }));
  assert.equal(repeated.status, 'applied');
  assert.equal(repeated.memories[0].filing.status, 'unfiled');
  assert.equal(repeated.memories[0].revision, saved.revision);
  assert.deepEqual(m.calls, ['classify', 'classify', 'classify', 'classify']);
});

test('concurrent explicit calls may classify twice but only one guarded placement commits', async (t) => {
  const path = pathFor(t);
  const releases = [];
  let notifyBoth;
  const bothStarted = new Promise((resolve) => { notifyBoth = resolve; });
  let calls = 0;
  const sharedModel = { contextWindow: 8192, countTokens: () => 1,
    classify: ({ input }) => new Promise((resolve) => {
      calls++;
      releases.push(() => resolve({ items: input.memories.map((memory) => ({ memoryId: memory.id,
        parentIds: [], newL1: { title: 'Concurrent topic', parentL2Ids: [] } })) }));
      if (calls === 2) notifyBoth();
    }) };
  const first = await host(t, path, { suppliedModel: sharedModel });
  const second = await host(t, path, { suppliedModel: sharedModel });
  const saved = ok(await call(first.client, 'remember_memory', { content: 'Concurrent synthetic note.' })).memory;
  const request = { refs: [ref(saved)] };
  const attempts = [call(first.client, 'classify_unfiled_memories', request),
    call(second.client, 'classify_unfiled_memories', request)];
  await bothStarted;
  for (const release of releases) release();
  const outcomes = await Promise.all(attempts);
  assert.equal(calls, 2);
  assert.equal(outcomes.filter((result) => result.ok).length, 1);
  assert.equal(outcomes.filter((result) => !result.ok).length, 1);
  assert.equal(outcomes.find((result) => !result.ok).error.code, 'index_revision_conflict');
  const detail = ok(await call(first.client, 'inspect_memory', { memoryId: saved.id }));
  assert.equal(detail.memory.filing.status, 'filed');
  assert.equal(detail.receipts.length, 1);
  errorCode(await call(first.client, 'classify_unfiled_memories', request), 'revision_conflict');
  assert.equal(calls, 2);
});

test('correction and deletion during model work fence the pending placement', async (t) => {
  for (const action of ['correct', 'forget']) {
    const path = pathFor(t);
    let notifyStarted;
    let release;
    const started = new Promise((resolve) => { notifyStarted = resolve; });
    const deferred = { contextWindow: 8192, countTokens: () => 1,
      classify: ({ input }) => new Promise((resolve) => {
        release = () => resolve({ items: input.memories.map((memory) => ({ memoryId: memory.id,
          parentIds: [], newL1: { title: 'Forbidden stale topic', parentL2Ids: [] } })) });
        notifyStarted();
      }) };
    const h = await host(t, path, { suppliedModel: deferred });
    const saved = ok(await call(h.client, 'remember_memory', { content: `Synthetic ${action} memory.` })).memory;
    const pending = call(h.client, 'classify_unfiled_memories', { refs: [ref(saved)] });
    await started;
    const other = openMemoryCore({ path });
    try {
      if (action === 'correct') ok(other.correct({ namespace, memoryId: saved.id,
        expectedRevision: saved.revision, content: 'Corrected while pending.', kind: 'fact',
        receipt: receipt('Corrected while pending.') }));
      else ok(other.forget({ namespace, memoryId: saved.id, expectedRevision: saved.revision }));
    } finally { other.close(); }
    release();
    errorCode(await pending, 'index_revision_conflict');
    const after = await call(h.client, 'inspect_memory', { memoryId: saved.id });
    if (action === 'correct') {
      assert.equal(ok(after).memory.content, 'Corrected while pending.');
      assert.equal(ok(after).memory.filing.status, 'unfiled');
    } else errorCode(after, 'memory_not_found');
  }
});

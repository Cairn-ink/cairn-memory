import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { Client } from '@modelcontextprotocol/client';
import { StdioClientTransport } from '@modelcontextprotocol/client/stdio';

const fixture = fileURLToPath(new URL('./fixtures/deadline-server.mjs', import.meta.url));
const cli = fileURLToPath(new URL('../cli.mjs', import.meta.url));
const owner = 'synthetic-deadline-owner';
const base = (path) => ['--db', path, '--owner', owner];
const capture = (batchId, content) => ({ batchId, messages: [{ role: 'user', content }] });
const ok = (result) => { assert.equal(result.ok, true, JSON.stringify(result)); return result.value; };
const clientsByTest = new WeakMap();
function pathFor(t) {
  const directory = mkdtempSync(join(tmpdir(), 'cairn-mcp-deadline-'));
  const closeClients = [];
  clientsByTest.set(t, closeClients);
  t.after(async () => {
    try { for (const close of closeClients) await close(); }
    finally { rmSync(directory, { recursive: true, force: true }); }
  });
  return join(directory, 'memory.sqlite');
}
async function host(t, path, { scripted = true, flags = [], key = '' } = {}) {
  const transport = new StdioClientTransport({ command: process.execPath,
    args: [scripted ? fixture : cli, ...base(path), ...flags],
    env: { OPENAI_API_KEY: key, NODE_NO_WARNINGS: '1' }, stderr: 'pipe' });
  let stderr = '';
  transport.stderr.on('data', (chunk) => { stderr += chunk.toString(); });
  const client = new Client({ name: 'synthetic-deadline-client', version: '1.0.0' });
  let closed = false;
  const close = async () => { if (closed) return; closed = true; await client.close(); };
  clientsByTest.get(t).push(close);
  await client.connect(transport);
  return { client, close, stages: () => [...stderr.matchAll(/synthetic_stage:(\w+)/gu)].map((match) => match[1]) };
}
async function call(client, name, args = {}) {
  const response = await client.callTool({ name, arguments: args }, undefined, { timeout: 12000 });
  const result = JSON.parse(response.content[0].text);
  assert.equal(Boolean(response.isError), !result.ok);
  assert.equal(result.evidenceTrust, 'untrusted-data-not-instructions');
  return result;
}
async function invalid(client, name, args) {
  try { assert.equal((await client.callTool({ name, arguments: args })).isError, true); }
  catch (caught) {
    if (caught instanceof assert.AssertionError) throw caught;
    assert.match(String(caught), /invalid|validation|required|unrecognized/iu);
  }
}

test('H2 deadline changes no MCP tools or schemas and grants no message authority', { timeout: 30000 }, async (t) => {
  for (const flags of [
    ['--capture-qualification', 'source-bound-v1'],
    ['--capture-qualification', 'source-bound-v2', '--capture-evidence', 'staged-v1',
      '--capture-rationale', 'source-bound-v1', '--classification-recovery', 'guarded-v1'],
  ]) {
    const path = pathFor(t);
    const plain = await host(t, path, { scripted: false, flags });
    const bounded = await host(t, path, { scripted: false, flags: [...flags, '--capture-deadline-ms', '120000'] });
    const inventory = (tools) => tools.map(({ name, inputSchema }) => ({ name, inputSchema }));
    assert.deepEqual(inventory((await plain.client.listTools()).tools),
      inventory((await bounded.client.listTools()).tools));
    await invalid(bounded.client, 'capture_memory', { ...capture('forged', 'synthetic'), captureDeadlineMs: 120000 });
    await invalid(bounded.client, 'capture_memory', { ...capture('forged', 'synthetic'), ownerId: 'other' });
    await plain.close(); await bounded.close();
  }
});

test('H3 actual stdio pre-admission model stall times out without admission; later capture succeeds',
  { timeout: 30000 }, async (t) => {
    const path = pathFor(t);
    const h = await host(t, path, { flags: ['--capture-qualification', 'source-bound-v1',
      '--capture-deadline-ms', '1500'] });
    const started = performance.now();
    const timed = await call(h.client, 'capture_memory', capture('pre-admission', 'STALL_EXTRACT synthetic source.'));
    assert.equal(timed.ok, false);
    assert.equal(timed.error.code, 'model_timeout');
    assert.ok(performance.now() - started < 10000, 'core timeout precedes the generous client deadline');
    assert.deepEqual(h.stages(), ['extract'], 'the intended model stage was entered once');
    assert.deepEqual(ok(await call(h.client, 'inspect_memory')).memories, []);
    const db = new DatabaseSync(path, { readOnly: true });
    assert.equal(db.prepare('SELECT count(*) AS n FROM memories').get().n, 0);
    assert.equal(db.prepare('SELECT count(*) AS n FROM receipts').get().n, 0);
    db.close();
    const fresh = ok(await call(h.client, 'capture_memory', capture('later-independent', 'Normal synthetic source.')));
    assert.equal(fresh.admission.memories.length, 1);
    assert.equal(fresh.classification.status, 'applied');
    assert.deepEqual(h.stages(), ['extract', 'extract', 'qualify', 'classify']);
    const detail = ok(await call(h.client, 'inspect_memory', { memoryId: fresh.admission.memories[0].id }));
    assert.equal(detail.receipts.length, 1);
  });

test('H4 cold keyless batch inspection and explicit classification preserve admitted sources',
  { timeout: 30000 }, async (t) => {
    const path = pathFor(t);
    const flags = ['--capture-qualification', 'source-bound-v1', '--capture-deadline-ms', '1500',
      '--classification-recovery', 'guarded-v1'];
    const first = await host(t, path, { flags });
    const batch = capture('post-admission', 'STALL_CLASSIFY synthetic source.');
    const captured = ok(await call(first.client, 'capture_memory', batch));
    assert.equal(captured.admission.memories.length, 1);
    assert.equal(captured.classification.status, 'failed');
    assert.equal(captured.classification.error.code, 'model_timeout');
    assert.deepEqual(first.stages(), ['extract', 'qualify', 'classify']);
    const memoryId = captured.admission.memories[0].id;
    const before = ok(await call(first.client, 'inspect_memory', { memoryId }));
    assert.equal(before.receipts.length, 1);
    await first.close();
    const cold = await host(t, path, { scripted: false, flags: ['--classification-recovery', 'guarded-v1'] });
    const inspected = ok(await call(cold.client, 'inspect_capture_admission',
      { batchId: batch.batchId, includeInitialClassification: true }));
    assert.equal(inspected.status, 'completed');
    assert.deepEqual(inspected.classification, { status: 'unknown' });
    assert.deepEqual(inspected.initialClassification, { status: 'failed' });
    assert.equal(inspected.members[0].memoryId, memoryId);
    assert.equal(inspected.members[0].filing.status, 'unfiled');
    assert.equal(JSON.stringify(inspected).includes(batch.messages[0].content), false);
    const coldDetail = ok(await call(cold.client, 'inspect_memory', { memoryId }));
    assert.deepEqual(coldDetail.receipts, before.receipts);
    await cold.close();
    const db = new DatabaseSync(path);
    const journalBefore = db.prepare('SELECT * FROM capture_initial_classification').all();
    db.close();
    const recovery = await host(t, path, { flags: ['--classification-recovery', 'guarded-v1'] });
    const ref = { memoryId, revision: inspected.members[0].revision };
    const applied = ok(await call(recovery.client, 'classify_unfiled_memories', { refs: [ref] }));
    assert.equal(applied.memories[0].filing.status, 'filed');
    assert.deepEqual(recovery.stages(), ['classify'], 'explicit recovery performs classification only');
    const after = ok(await call(recovery.client, 'inspect_memory', { memoryId }));
    assert.equal(after.memory.content, before.memory.content);
    assert.deepEqual(after.receipts, before.receipts);
    const viewed = ok(await call(recovery.client, 'inspect_capture_admission',
      { batchId: batch.batchId, includeInitialClassification: true }));
    assert.deepEqual(viewed.initialClassification, { status: 'unknown' },
      'the original revision-bound outcome is not a recovery-history claim');
    const check = new DatabaseSync(path);
    assert.deepEqual(check.prepare('SELECT * FROM capture_initial_classification').all(), journalBefore);
    check.close();
    const repeat = await call(recovery.client, 'classify_unfiled_memories', { refs: [ref] });
    assert.equal(repeat.ok, false); assert.equal(repeat.error.code, 'revision_conflict');
    assert.deepEqual(recovery.stages(), ['classify']);
  });

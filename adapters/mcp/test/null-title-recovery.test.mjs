import assert from 'node:assert/strict';
import test, { after, mock } from 'node:test';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { Client } from '@modelcontextprotocol/client';
import { InMemoryTransport } from '@modelcontextprotocol/server';
import { openMemoryCore } from '../../../core/contract.mjs';
import { createTestWorkspace } from '../../../tools/testing/workspace.mjs';
import { createCairnServer } from '../server.mjs';

// Actual SDK requests, scripted ports only. There is no public map RPC.
const fetchGuard = mock.method(globalThis, 'fetch', () => assert.fail('native fetch is forbidden'));
after(() => fetchGuard.mock.restore());
const ns = { ownerId: 'nr-mcp-synthetic', scope: 'personal', projectId: null };
const title = 'Recovery topic';
const ok = r => { assert.equal(r.ok, true, JSON.stringify(r)); return r.value; };
const plain = value => JSON.parse(JSON.stringify(value));
const forbidden = () => assert.fail('cold inspection called a model port');
const readModel = () => ({ contextWindow: 8192, countTokens: () => 1,
  extract: forbidden, qualify: forbidden, classify: forbidden, select: forbidden, rank: forbidden });
const options = { namespace: ns, client: 'nr-mcp-client', sessionId: 'nr-mcp-session',
  classificationRecovery: 'guarded-v1', captureQualification: 'source-bound-v1' };
const submitted = { batchId: 'fresh-batch', messages: [{ role: 'user', content: 'Fresh source for recovery.' }] };
const ref = memory => ({ memoryId: memory.id, revision: memory.revision });

function model() {
  const calls = [], catalogs = [];
  const m = { calls, catalogs, fail: false, contextWindow: 8192, countTokens: () => 1,
    extract: ({ input }) => { calls.push('extract'); return { items: [{ content: input.messages[0].content,
      kind: 'preference', confidence: 0.8, sourceIndices: [0] }] }; },
    qualify: ({ input }) => { calls.push('qualify'); return { qualifications: input.items.map(({ itemIndex, sources }) =>
      ({ itemIndex, qualification: { version: 1,
        slot: { subject: null, property: null, scope: null, applies: null }, value: null,
        attribution: 'unknown', commitment: 'unknown', anchors: [{ receiptIndex: 0,
          start: 0, end: sources[0].excerpt.length, text: sources[0].excerpt, fields: ['value'] }] } })) }; },
    classify: ({ input }) => {
      calls.push('classify'); catalogs.push(plain(input));
      if (m.fail) throw new Error('synthetic initial classification failure');
      return { items: input.memories.map(memory => ({ memoryId: memory.id, parentIds: [],
        newL1: { title, parentL2Ids: [] } })) };
    },
  };
  return m;
}

function fixture(t, hidden) {
  const workspace = createTestWorkspace(t, { prefix: 'cairn-nr-mcp-' });
  const path = join(workspace.path, 'memory.sqlite');
  const seed = openMemoryCore({ path, model: readModel() }); workspace.defer(() => seed.close());
  const original = ok(seed.admit({ namespace: ns, memory: { content: 'Original topic source.', kind: 'fact' },
    receipts: [{ client: 'seed', sessionId: 'session', eventId: 'original', role: 'user', excerpt: 'Original topic source.' }] })).memory;
  const created = ok(seed.applyPlacement({ namespace: ns,
    proposal: { items: [{ memoryId: original.id, parentIds: [], newL1: { title, parentL2Ids: [] } }] },
    expectedMemoryRevisions: [ref(original)],
    expectedIndexRevision: ok(seed.map({ namespace: ns, purpose: 'classification' })).indexRevision }));
  const topic = created.createdMocs[0];
  if (hidden) ok(seed.forget({ namespace: ns, memoryId: original.id,
    expectedRevision: ok(seed.get({ namespace: ns, memoryId: original.id })).memory.revision }));
  const beforeMap = ok(seed.map({ namespace: ns, purpose: 'classification' }));
  assert.equal(beforeMap.exhausted, true);
  assert.equal(beforeMap.items.find(i => i.type === 'moc').moc.title, hidden ? null : title);
  seed.close();
  const db = new DatabaseSync(path); workspace.defer(() => db.close());
  const provenance = () => ({
    identity: plain(db.prepare('SELECT id,title,canonical_title,created_at FROM mocs WHERE id=?').get(topic.id)),
    sources: plain(db.prepare('SELECT * FROM moc_title_sources WHERE moc_id=? ORDER BY memory_id').all(topic.id)),
  });
  const journal = () => plain(db.prepare('SELECT * FROM capture_initial_classification WHERE event_id=?').get(submitted.batchId));
  return { workspace, path, db, topic, provenance, journal };
}

async function host(f, suppliedModel) {
  const server = createCairnServer({ ...options, path: f.path, model: suppliedModel });
  let serverClosed = false;
  const closeServer = async () => { if (!serverClosed) { serverClosed = true; await server.close(); } };
  f.workspace.defer(closeServer);
  const client = new Client({ name: 'nr-mcp-client-test', version: '1.0.0' });
  let clientClosed = false;
  const closeClient = async () => { if (!clientClosed) { clientClosed = true; await client.close(); } };
  f.workspace.defer(closeClient);
  const [serverSide, clientSide] = InMemoryTransport.createLinkedPair();
  f.workspace.defer(() => serverSide.close()); f.workspace.defer(() => clientSide.close());
  await server.connect(serverSide); await client.connect(clientSide);
  return { client, close: async () => { try { await closeClient(); } finally { await closeServer(); } } };
}

async function call(h, name, args) {
  const response = await h.client.callTool({ name, arguments: args });
  const result = JSON.parse(response.content[0].text);
  assert.equal(Boolean(response.isError), !result.ok);
  assert.equal(result.evidenceTrust, 'untrusted-data-not-instructions');
  return result;
}
const inspect = h => call(h, 'inspect_capture_admission', { batchId: submitted.batchId, includeInitialClassification: true });
function coldCore(f) {
  const core = openMemoryCore({ path: f.path, model: readModel() }); f.workspace.defer(() => core.close());
  return core;
}
function rebuild(core) {
  const expectedIndexRevision = ok(core.map({ namespace: ns, purpose: 'classification' })).indexRevision;
  let cursor;
  for (;;) {
    const result = ok(core.rebuildIndex({ namespace: ns, expectedIndexRevision, limit: 500,
      ...(cursor ? { cursor } : {}) }));
    if (result.exhausted) { assert.equal(result.state, 'published'); return; }
    assert.ok(result.nextCursor); cursor = result.nextCursor;
  }
}

test('NR2/6 actual MCP recovery reuses NULL ID without renewing sources or rewriting failed initial history', async t => {
  const f = fixture(t, true), stable = f.provenance(), m = model(); m.fail = true;
  const first = await host(f, m);
  const captured = ok(await call(first, 'capture_memory', submitted));
  assert.equal(captured.classification.status, 'failed');
  assert.equal(captured.admission.memories.length, 1);
  const admitted = captured.admission.memories[0];
  const before = ok(await call(first, 'inspect_memory', { memoryId: admitted.id }));
  assert.equal(before.memory.filing.status, 'unfiled'); assert.equal(before.receipts.length, 1);
  assert.equal(before.receipts[0].excerpt, submitted.messages[0].content);
  assert.equal(ok(await inspect(first)).initialClassification.status, 'failed');
  const failedAttempt = f.journal(); assert.equal(failedAttempt.status, 'failed');
  assert.deepEqual(m.calls, ['extract', 'qualify', 'classify']); await first.close();

  m.fail = false;
  const recovery = await host(f, m);
  const placed = ok(await call(recovery, 'classify_unfiled_memories', { refs: [ref(admitted)] }));
  assert.equal(placed.status, 'applied'); assert.deepEqual(placed.createdMocs, []);
  assert.equal(placed.memories[0].filing.status, 'filed');
  assert.deepEqual(m.calls, ['extract', 'qualify', 'classify', 'classify']);
  const catalog = m.catalogs[1]; assert.equal(catalog.mapExhausted, true);
  assert.deepEqual(catalog.map.map(i => [i.moc.id, i.moc.title]), [[f.topic.id, null]]);
  const after = ok(await call(recovery, 'inspect_memory', { memoryId: admitted.id }));
  assert.deepEqual(after.receipts, before.receipts); assert.equal(after.memory.content, before.memory.content);
  assert.deepEqual(after.placements.map(p => [p.mocId, p.title]), [[f.topic.id, null]]);
  assert.deepEqual(f.provenance(), stable); assert.deepEqual(f.journal(), failedAttempt);
  assert.equal(ok(await inspect(recovery)).initialClassification.status, 'unknown', 'later filing does not certify the old failed attempt');
  assert.equal(ok(await call(recovery, 'capture_memory', submitted)).duplicate, true);
  assert.deepEqual(m.calls, ['extract', 'qualify', 'classify', 'classify']); await recovery.close();

  const reader = coldCore(f);
  rebuild(reader);
  for (const purpose of ['classification', 'recall']) {
    const page = ok(reader.map({ namespace: ns, purpose })); assert.equal(page.exhausted, true);
    const group = page.items.find(i => i.type === 'moc' && i.moc.id === f.topic.id).moc;
    assert.equal(group.title, null); assert.equal(Object.hasOwn(group, 'titleSources'), false);
  }
  assert.deepEqual(ok(reader.get({ namespace: ns, memoryId: admitted.id })).receipts, before.receipts);
  assert.equal(reader.get({ namespace: { ...ns, ownerId: 'other' }, memoryId: admitted.id }).ok, false);
  reader.close();
  const cold = await host(f, readModel());
  const stored = ok(await call(cold, 'inspect_memory', { memoryId: admitted.id }));
  assert.deepEqual(stored.receipts, before.receipts);
  assert.deepEqual(stored.placements.map(p => [p.mocId, p.title]), [[f.topic.id, null]]);
  assert.equal(ok(await inspect(cold)).initialClassification.status, 'unknown');
  assert.deepEqual(f.journal(), failedAttempt); assert.deepEqual(f.provenance(), stable);
});

test('NR1/5 actual MCP still refuses a visible title collision and keeps its admitted failed batch intact', async t => {
  const f = fixture(t, false), stable = f.provenance(), m = model();
  const h = await host(f, m);
  const captured = ok(await call(h, 'capture_memory', submitted));
  assert.deepEqual(captured.classification, { status: 'failed', error: { code: 'moc_title_conflict', retryable: false } });
  const admitted = captured.admission.memories[0], before = ok(await call(h, 'inspect_memory', { memoryId: admitted.id }));
  assert.equal(before.memory.filing.status, 'unfiled');
  const epoch = f.db.prepare('SELECT epoch FROM namespace_epochs').get().epoch, failedAttempt = f.journal();
  const refused = await call(h, 'classify_unfiled_memories', { refs: [ref(admitted)] });
  assert.equal(refused.ok, false); assert.equal(refused.error.code, 'moc_title_conflict');
  assert.deepEqual(ok(await call(h, 'inspect_memory', { memoryId: admitted.id })), before);
  assert.equal(f.db.prepare('SELECT epoch FROM namespace_epochs').get().epoch, epoch);
  assert.deepEqual(f.provenance(), stable); assert.deepEqual(f.journal(), failedAttempt);
  assert.equal(ok(await inspect(h)).initialClassification.status, 'failed');
  assert.equal(m.catalogs[1].map[0].moc.title, title);
  assert.deepEqual(m.calls, ['extract', 'qualify', 'classify', 'classify']);
});

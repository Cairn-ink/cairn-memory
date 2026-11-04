import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readdirSync } from 'node:fs';
import { join } from 'node:path';
import { openMemoryCore } from '../index.mjs';
import { transaction, readTransaction } from '../database.mjs';
import { contentReadSafety } from '../content-safety.mjs';
import { safetyFixture, ns, ok, receipt } from '../testing/content-safety-s2h-fixture.mjs';

test('v48 zero-fact public refresh refuses foreign Raw ancestry before embedding', async t => {
  const f = safetyFixture(t, 33); await f.migrate();
  const db = f.connect(); let calls = 0;
  const authority = { authorize({ input, ...binding }) { return { ...binding, accessGeneration: 1 }; }, isCurrent: grant => grant };
  const core = openMemoryCore({ path: f.path, contextRead: { version: 'context-read-v1', authority,
    counter: { id: 'synthetic', countTokens: () => 1 },
    embedder: { id: 'synthetic-ancestry', revision: '1', dimensions: 2, normalization: 'l2', embed(texts) {
      calls++; assert.ok(texts.some(text => text.includes('ProtectedSyntheticAncestry'))); return texts.map(() => [1, 0]);
    } }, policy: { family: 'local', maxRequests: 1000, maxUsd: 1, maxConcurrent: 1, estimateUsd: () => 0 } } });
  t.after(() => { core.close(); db.close(); });
  const memory = ok(core.admit({ namespace: ns, memory: { content: 'ProtectedSyntheticAncestry', kind: 'fact' }, receipts: [receipt('ancestry-refresh')] })).memory;
  transaction(db, () => {
    db.prepare('INSERT INTO raw_conversations VALUES(?,?,?,?,?,?,1,?,?)').run('foreign-raw', 'foreign-synthetic', ns.scope, ns.projectId, 'codex', 'foreign-session', 'time', 'time');
    const id = db.prepare('SELECT id FROM receipts WHERE memory_id=?').get(memory.id).id;
    db.prepare('INSERT INTO raw_receipt_lineage VALUES(?,?,?,?,?,?)').run(id, 'foreign-raw', 'message', 0, 2, 'exact');
  });
  assert.equal(db.prepare('SELECT count(*) n FROM content_suppressions').get().n, 0);
  readTransaction(db, () => assert.deepEqual(contentReadSafety(db, { namespace: ns, intent: 'history',
    ref: { type: 'memory', namespace: ns, memoryId: memory.id, revision: memory.revision } }), { allowed: false, reason: 'ineligible' }));
  const result = await core.refreshContextIndex({ readSet: [ns], types: ['memory'], intent: 'current', budget: { maxItems: 1024, maxMs: 5000 } }, {});
  let vectors = 0, sidecars = 0;
  for (const file of readdirSync(f.workspace.path).filter(name => name.endsWith('.sqlite') && name !== 'store.sqlite' && name !== 'offline.sqlite')) {
    const side = new DatabaseSync(join(f.workspace.path, file), { readOnly: true });
    try { if (side.prepare("SELECT 1 FROM sqlite_schema WHERE name='vectors'").get()) { sidecars++; vectors += side.prepare('SELECT count(*) n FROM vectors').get().n; } }
    finally { side.close(); }
  }
  t.diagnostic('R4_ANCESTRY ' + JSON.stringify({ node: process.version, embedderCalls: calls, storedVectors: vectors, status: result.value?.status ?? null, error: result.error?.code ?? null }));
  assert.equal(sidecars, 1, 'the public refresh created its production sidecar');
  assert.equal(calls, 0, 'no protected text dispatched to the embedder');
  assert.equal(vectors, 0, 'no vector stored for rejected ancestry');
  assert.notEqual(result.value?.status, 'complete', JSON.stringify(result));
});

for (const ancestry of ['ordinary', 'derived', 'session-fence']) test(`source-evidence recall preserves canonical receipt ancestry: ${ancestry}`, async t => {
  const f = safetyFixture(t, 33); await f.migrate(); const db = f.connect(), dispatched = [];
  const core = openMemoryCore({ path: f.path, model: { contextWindow: 8192, countTokens(text) { dispatched.push(text); return 1; },
    select({ input }) { dispatched.push(JSON.stringify(input)); return { refs: input.maps.flatMap(map => map.items.filter(item => item.type === 'unfiled' && item.label.includes('ProtectedSyntheticSourceNeedle')).map(item => ({ namespaceIndex: map.namespaceIndex, ...item.ref }))) }; },
    rank({ input }) { dispatched.push(JSON.stringify(input)); return { refs: input.candidates.slice(0, input.limit).map(candidate => ({ namespaceIndex: candidate.namespaceIndex, memoryId: candidate.memory.id, revision: candidate.memory.revision })) }; } } });
  t.after(() => { core.close(); db.close(); });
  const memory = ok(core.admit({ namespace: ns, memory: { content: 'ordinary synthetic body', kind: 'fact' }, receipts: [receipt('receipt-proof', 'ProtectedSyntheticSourceNeedle needle')] })).memory;
  const stored = db.prepare('SELECT * FROM receipts WHERE memory_id=?').get(memory.id);
  if (ancestry === 'derived') transaction(db, () => db.prepare("INSERT INTO raw_receipt_origins VALUES(?,'derived') ON CONFLICT(receipt_id) DO UPDATE SET kind='derived'").run(stored.id));
  if (ancestry === 'session-fence') transaction(db, () => db.prepare('INSERT INTO raw_session_fences VALUES(?,?,?,?,?)').run(ns.ownerId, ns.scope, ns.projectId, stored.client, stored.session_id));
  assert.equal(db.prepare('SELECT count(*) n FROM content_suppressions').get().n, 0);
  dispatched.length = 0;
  const result = await core.recall({ readSet: [ns], query: 'needle', limit: 6, contextMode: 'source-evidence' });
  t.diagnostic('R4_RECEIPT_ANCESTRY ' + JSON.stringify({ ancestry, ok: result.ok, error: result.error?.code ?? null, memories: result.value?.memories?.length ?? null, dispatchedProtected: JSON.stringify(dispatched).includes('ProtectedSyntheticSourceNeedle') }));
  assert.equal(result.ok, true, JSON.stringify(result));
  if (ancestry === 'ordinary') { assert.equal(result.value.memories.length, 1); assert.match(JSON.stringify(dispatched), /ProtectedSyntheticSourceNeedle/); }
  else { assert.deepEqual(result.value.memories, []); assert.doesNotMatch(JSON.stringify(dispatched), /ProtectedSyntheticSourceNeedle/); }
});

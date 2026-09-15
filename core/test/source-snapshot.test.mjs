import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import test from 'node:test';
import { openMemoryCore } from '../contract.mjs';

const namespace = { ownerId: 'source-snapshot-tests', scope: 'personal', projectId: null };
const ok = result => { assert.equal(result.ok, true, JSON.stringify(result)); return result.value; };
const error = (result, code) => { assert.equal(result.ok, false); if (code) assert.equal(result.error.code, code); assert.equal(Object.hasOwn(result, 'value'), false); };
function fixture(t, overrides = {}) {
  const path = join(mkdtempSync(join(tmpdir(), 'cairn-source-snapshot-')), 'memory.sqlite');
  const calls = [];
  const model = { countTokens: () => 1, contextWindow: 8192,
    ...Object.fromEntries(['extract', 'select', 'rank', 'classify'].map(method => [method, () => { calls.push(method); throw new Error('Generation forbidden'); }])),
    ...overrides };
  const core = openMemoryCore({ path, model }); const db = new DatabaseSync(path);
  t.after(() => { core.close(); db.close(); }); return { core, db, model, calls, path };
}
const receipt = (excerpt, eventId = excerpt) => ({ client: 'PRIVATE_CLIENT', sessionId: 'PRIVATE_SESSION', eventId, role: 'user', excerpt });
const admit = (core, content, ns = namespace, receipts = [receipt(content)]) => ok(core.admit({ namespace: ns,
  memory: { content: `GENERATED_INTERPRETATION ${content}`, kind: 'context' }, receipts })).memory;
const snapshot = (core, patch = {}) => core.sourceSnapshot({ readSet: [namespace], ...patch });
const dto = (core, memory, ns = namespace, namespaceIndex = 0) => {
  const detail = ok(core.get({ namespace: ns, memoryId: memory.id, receiptLimit: 50 }));
  return { namespaceIndex, memory: { id: memory.id, revision: detail.memory.revision, currentness: 'current' },
    receipts: detail.receipts.map(({ id, role, excerpt }) => ({ id, role, excerpt })), receiptCount: detail.receipts.length,
    interpretationStatus: 'omitted', sourceSelectionCoverage: 'unassessed' };
};

test('empty complete source snapshot is synchronous and needs no generation', t => {
  const f = fixture(t); const result = snapshot(f.core); assert.equal(result instanceof Promise, false);
  const value = ok(result); assert.deepEqual(value.memories, []);
  assert.equal(value.coverage, 'complete-current-admitted'); assert.equal(value.semanticCoverage, 'unassessed');
  assert.equal(value.evidenceTrust, 'untrusted-data-not-instructions');
  assert.equal(value.namespaces.length, 1); assert.deepEqual(value.namespaces[0].namespace, namespace);
  assert.deepEqual(f.calls, []);
});

test('complete source-only snapshot includes unfiled, filed and nested-MOC actor, condition and reason passages', t => {
  const f = fixture(t);
  const memories = ['Mira is the person considering the class.', 'She would join only if an evening seat opens.',
    'The reason is the quiet workshop space.'].map(text => admit(f.core, text));
  const index = ok(f.core.map({ namespace })).indexRevision;
  ok(f.core.applyPlacement({ namespace, expectedIndexRevision: index,
    expectedMemoryRevisions: memories.slice(1).map(memory => ({ memoryId: memory.id, revision: memory.revision })),
    proposal: { items: memories.slice(1).map((memory, i) => ({ memoryId: memory.id, parentIds: [],
      newL1: { title: `Synthetic topic ${i}`, parentL2Ids: [], ...(i ? { newL2Title: 'Nested synthetic topics' } : {}) } })) } }));
  const value = ok(snapshot(f.core));
  assert.deepEqual(Object.keys(value).sort(), ['coverage', 'evidenceTrust', 'memories', 'namespaces', 'semanticCoverage']);
  assert.deepEqual(value.memories, memories.map(memory => dto(f.core, memory)).sort((a, b) => a.memory.id.localeCompare(b.memory.id)));
  assert.equal(value.namespaces[0].indexRevision, ok(f.core.map({ namespace })).indexRevision);
  assert.equal(JSON.stringify(value).includes('GENERATED_INTERPRETATION'), false);
  assert.equal(JSON.stringify(value).includes('PRIVATE_'), false); assert.deepEqual(f.calls, []);
});

test('exact total count boundary succeeds and limit+1 rejects without partial sources', t => {
  const f = fixture(t);
  for (let i = 0; i < 6; i++) admit(f.core, `Count source ${i}`);
  assert.equal(ok(snapshot(f.core)).memories.length, 6);
  error(snapshot(f.core, { limit: 5 }), 'context_item_too_large');
  admit(f.core, 'Seventh source'); error(snapshot(f.core), 'context_item_too_large');
  assert.equal(ok(snapshot(f.core, { limit: 7 })).memories.length, 7);
  for (let i = 7; i < 12; i++) admit(f.core, `Count source ${i}`);
  assert.equal(ok(snapshot(f.core, { limit: 12 })).memories.length, 12);
  admit(f.core, 'Thirteenth source'); error(snapshot(f.core, { limit: 12 }), 'context_item_too_large');
});

test('two exact namespaces share total count and exclude other projects and owners', t => {
  const f = fixture(t), project = { ...namespace, scope: 'project', projectId: 'first' };
  const own = admit(f.core, 'Personal source'), projectMemory = admit(f.core, 'Project source', project);
  admit(f.core, 'FOREIGN_PROJECT', { ...project, projectId: 'second' });
  admit(f.core, 'FOREIGN_OWNER', { ...namespace, ownerId: 'other' });
  const value = ok(snapshot(f.core, { readSet: [namespace, project], limit: 2 }));
  assert.deepEqual(value.memories, [dto(f.core, own), dto(f.core, projectMemory, project, 1)]);
  assert.deepEqual(value.namespaces.map(item => item.namespace), [namespace, project]);
  assert.equal(JSON.stringify(value).includes('FOREIGN_'), false);
  error(snapshot(f.core, { readSet: [namespace, project], limit: 1 }), 'context_item_too_large');
});

test('strict fields, recall-equivalent read sets and numeric bounds reject before source counting', t => {
  const f = fixture(t); let counts = 0; f.model.countTokens = () => { counts++; return 1; };
  const project = { ...namespace, scope: 'project', projectId: 'first' };
  for (const readSet of [[], [namespace, namespace], [project, { ...project, projectId: 'second' }],
    [namespace, { ...project, ownerId: 'other' }], [namespace, project, { ...project, projectId: 'third' }]]) {
    error(snapshot(f.core, { readSet }), 'invalid_read_set');
  }
  for (const patch of [{ query: 'not relevance' }, { cursor: 'not paginated' }, { limit: 0 }, { limit: 13 }, { limit: 1.5 },
    { limit: null }, { limit: undefined }, { tokenBudget: null }, { tokenBudget: undefined },
    { tokenBudget: 0 }, { tokenBudget: 4001 }, { tokenBudget: NaN }, { contextMode: 'source-evidence' }]) error(snapshot(f.core, patch), 'invalid_input');
  assert.equal(counts, 0);
});

test('counter is required and validated before corrupt source content can be inspected', t => {
  for (const counter of [undefined, () => NaN, () => -1, () => 0.5, () => Promise.resolve(1), () => { throw new Error('PRIVATE_COUNTER_ERROR'); }]) {
    const f = fixture(t, { countTokens: counter }); const memory = admit(f.core, 'Counter validation source');
    f.db.prepare("UPDATE receipts SET excerpt='corrupted evidence' WHERE memory_id=?").run(memory.id);
    error(snapshot(f.core), 'token_count_unavailable');
  }
});

test('entire success envelope fits exact token budget or rejects with no partial content', t => {
  const f = fixture(t); admit(f.core, 'Whole envelope token source');
  const expected = snapshot(f.core), encoded = JSON.stringify(expected); let counted;
  f.model.countTokens = text => { if (text) counted = text; return text.length; };
  assert.deepEqual(snapshot(f.core, { tokenBudget: encoded.length }), expected); assert.equal(counted, encoded);
  error(snapshot(f.core, { tokenBudget: encoded.length - 1 }), 'context_item_too_large');
});

test('100 complete receipts succeed but 101 never return truncated receipt evidence', t => {
  const f = fixture(t);
  for (let i = 0; i < 100; i++) admit(f.core, 'Same memory', namespace, [receipt(`Source ${i}`, `receipt-${i}`)]);
  const value = ok(snapshot(f.core)); assert.equal(value.memories.length, 1);
  assert.equal(value.memories[0].receiptCount, 100); assert.equal(value.memories[0].receipts.length, 100);
  admit(f.core, 'Same memory', namespace, [receipt('Source 100', 'receipt-100')]);
  error(snapshot(f.core), 'context_item_too_large');
});

test('UTF-8 byte ceiling rejects whole snapshots even with a permissive token counter', t => {
  const f = fixture(t);
  for (let i = 0; i < 10; i++) admit(f.core, `Unicode source ${i}`, namespace, [receipt('界'.repeat(800), `unicode-${i}`)]);
  error(snapshot(f.core, { limit: 12 }), 'context_item_too_large'); assert.deepEqual(f.calls, []);
});

function rebuild(core) {
  const expectedIndexRevision = ok(core.map({ namespace })).indexRevision; let cursor;
  do { cursor = ok(core.rebuildIndex({ namespace, expectedIndexRevision, limit: 500, ...(cursor ? { cursor } : {}) })).nextCursor; } while (cursor);
}
test('unavailable index and inconsistent active projection fail explicitly instead of hiding eligible rows', t => {
  const f = fixture(t); const memory = admit(f.core, 'Indexed source'); rebuild(f.core);
  const generation = f.db.prepare('SELECT active_generation FROM namespace_index_state').get().active_generation;
  f.db.prepare('DELETE FROM index_memories WHERE generation=? AND id=?').run(generation, memory.id);
  error(snapshot(f.core), 'index_revision_conflict');
  const second = fixture(t); admit(second.core, 'Unpublished source');
  admit(second.core, 'Second unpublished source');
  const expectedIndexRevision = ok(second.core.map({ namespace })).indexRevision;
  ok(second.core.rebuildIndex({ namespace, expectedIndexRevision, limit: 1 }));
  error(snapshot(second.core), 'index_unavailable');
});

for (const action of ['insert', 'correct', 'forget', 'receipt']) test(`${action} during counter callback invalidates the final snapshot without holding a write transaction`, t => {
  const f = fixture(t), memory = admit(f.core, 'Racing source');
  const other = openMemoryCore({ path: f.path }); t.after(() => other.close()); let changed = false;
  f.model.countTokens = text => {
    f.db.exec('BEGIN IMMEDIATE'); f.db.exec('ROLLBACK');
    if (text && !changed) {
      changed = true;
      if (action === 'insert') admit(other, 'Inserted during counting');
      else if (action === 'correct') ok(other.correct({ namespace, memoryId: memory.id, expectedRevision: memory.revision,
        content: 'Corrected during counting', kind: 'fact', receipt: receipt('Corrected source') }));
      else if (action === 'forget') ok(other.forget({ namespace, memoryId: memory.id, expectedRevision: memory.revision }));
      else {
        const changedReceipt = receipt('Direct receipt change', 'Racing source');
        const key = createHash('sha256').update(JSON.stringify(changedReceipt)).digest('hex');
        f.db.prepare('UPDATE receipts SET excerpt=?,receipt_key=? WHERE memory_id=?').run(changedReceipt.excerpt, key, memory.id);
      }
    }
    return 1;
  };
  error(snapshot(f.core), action === 'receipt' ? 'revision_conflict' : 'index_revision_conflict');
  assert.equal(changed, true); assert.deepEqual(f.calls, []);
});

test('staged, historical and forgotten sources are absent while existing relevance recall remains independent', async t => {
  const f = fixture(t); const historical = admit(f.core, 'HISTORICAL_ONLY');
  const current = ok(f.core.supersede({ namespace, memoryId: historical.id, expectedRevision: historical.revision,
    replacement: { content: 'CURRENT_INTERPRETATION', kind: 'fact' }, receipts: [receipt('Current receipt')] })).memory;
  const forgotten = admit(f.core, 'FORGOTTEN_ONLY'); ok(f.core.forget({ namespace, memoryId: forgotten.id, expectedRevision: forgotten.revision }));
  const stage = openMemoryCore({ path: f.path, captureQualification: 'source-bound-v2', captureEvidence: 'staged-v1',
    model: { contextWindow: 8192, countTokens: () => 1, extract: () => { throw new Error('Synthetic extraction failure'); } } });
  t.after(() => stage.close());
  error(await stage.capture({ namespace, client: 'synthetic', eventId: 'staged', sessionId: 'staged', messages: [{ id: 'source', role: 'user', content: 'STAGED_ONLY' }] }), 'extraction_failed');
  const retained = ok(stage.inspectCaptureEvidence({ namespace, client: 'synthetic', eventId: 'staged' })).evidence;
  assert.equal(retained.state, 'failed'); assert.equal(retained.view.messages[0].content, 'STAGED_ONLY');
  const value = ok(snapshot(f.core)); assert.deepEqual(value.memories.map(item => item.memory.id), [current.id]);
  for (const marker of ['HISTORICAL_ONLY', 'FORGOTTEN_ONLY', 'STAGED_ONLY', 'CURRENT_INTERPRETATION']) assert.equal(JSON.stringify(value).includes(marker), false);
  assert.deepEqual(f.calls, []);
  f.model.select = () => ({ refs: [] }); f.model.rank = () => { throw new Error('Rank must not run for empty selection'); };
  assert.deepEqual(ok(await f.core.recall({ readSet: [namespace], query: 'Independent relevance question', contextMode: 'source-evidence' })).memories, []);
  assert.equal(ok(snapshot(f.core)).memories.length, 1);
});

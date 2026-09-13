import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { DatabaseSync } from 'node:sqlite';
import test from 'node:test';
import { openMemoryCore } from '../contract.mjs';

// Synthetic interpretations intentionally disagree with source wording. Tests
// establish which bytes are used, not truth or downstream understanding.
const namespace = { ownerId: 'source-evidence-tests', scope: 'personal', projectId: null };
const ok = r => { assert.equal(r.ok, true, JSON.stringify(r)); return r.value; };
const error = (r, code) => { assert.equal(r.ok, false, JSON.stringify(r)); if (code) assert.equal(r.error.code, code); };
const receipt = (excerpt, eventId = 'source', role = 'user') => ({ client: 'private-client', sessionId: 'private-session', eventId, role, excerpt });
const select = ({ input }) => ({ refs: input.maps.flatMap(map => map.items.filter(item => item.type === 'unfiled')
  .map(item => ({ namespaceIndex: map.namespaceIndex, ...item.ref }))) });
const rank = ({ input }) => ({ refs: input.candidates.slice(0, input.limit).map(item => ({ namespaceIndex: item.namespaceIndex,
  memoryId: item.memory.id, revision: item.memory.revision })) });
function fixture(t, overrides = {}) {
  const path = join(mkdtempSync(join(tmpdir(), 'cairn-source-context-')), 'memory.sqlite'); const calls = [];
  const model = { countTokens: () => 1, contextWindow: 8192, select, rank, ...overrides };
  for (const method of ['select', 'rank']) { const fn = model[method]; model[method] = request => {
    calls.push({ method, system: request.system, input: structuredClone(request.input) }); return fn(request);
  }; }
  const core = openMemoryCore({ path, model }); const db = new DatabaseSync(path); let closed = false;
  const close = () => { if (!closed) { core.close(); db.close(); closed = true; } }; t.after(close);
  return { core, db, model, calls, path, close };
}
function admit(core, text = 'Maybe that is useful.', patch = {}) {
  return ok(core.admit({ namespace, memory: { content: 'WRONG_MODEL_INTERPRETATION', kind: 'fact' }, receipts: [receipt(text)], ...patch })).memory;
}
const ref = memory => ({ memoryId: memory.id, revision: memory.revision });
const fetch = (core, memory, patch = {}) => core.fetch({ namespace, refs: [ref(memory)], contextMode: 'source-evidence', ...patch });
const recall = (core, patch = {}) => core.recall({ readSet: [namespace], query: 'What was said?', contextMode: 'source-evidence', ...patch });
const inspect = (core, memory) => ok(core.get({ namespace, memoryId: memory.id, includeQualification: true }));
const dto = detail => ({ memory: { id: detail.memory.id, revision: detail.memory.revision,
  currentness: detail.memory.state === 'historical' ? 'historical' : 'current' },
  receipts: detail.receipts.map(({ id, role, excerpt }) => ({ id, role, excerpt })), receiptCount: detail.receipts.length,
  interpretationStatus: 'omitted', sourceSelectionCoverage: 'unassessed' });

for (const [name, text, role] of [['proposal', 'You could use a bicycle.', 'assistant'], ['question', 'Would I enjoy this route?', 'user'],
  ['uncertainty', 'Today I feel I might not enjoy managing.', 'user'], ['exception', 'Only tonight, use a taxi 🚋.', 'user'],
  ['third-party', 'Mina said she prefers ferries.', 'assistant']]) {
  test(`SE1 ${name}: exact source-only fetch/rank/final fields, wrong interpretation remains inspectable`, async t => {
    const f = fixture(t); const memory = admit(f.core, text, { receipts: [receipt(text, 'private-event', role)], qualification: {
      version: 1, slot: { subject: null, property: null, scope: null, applies: null }, value: 'WRONG_QUALIFIER', attribution: 'direct', commitment: 'adopted',
      anchors: [{ receiptIndex: 0, start: 0, end: text.length, text, fields: ['value', 'attribution', 'commitment'] }] } });
    const detail = inspect(f.core, memory); const expected = dto(detail);
    assert.deepEqual(ok(fetch(f.core, memory)).items, [expected]);
    const result = ok(await recall(f.core)); assert.deepEqual(result.memories[0], expected);
    const ranked = f.calls.find(call => call.method === 'rank'); assert.deepEqual(ranked.input.candidates, [{ namespaceIndex: 0, ...expected }]);
    assert.ok(!JSON.stringify(ranked).includes('WRONG_')); assert.ok(!JSON.stringify(result).includes('private-event'));
    assert.deepEqual(inspect(f.core, memory), detail);
    assert.equal(f.db.prepare('SELECT count(*) n FROM qualified_claim_bindings').get().n, 0);
  });
}

test('SE2 missing antecedent is not added from a neighboring independent memory, cold sources stay exact', async t => {
  const f = fixture(t); const memory = admit(f.core, 'That might work.');
  admit(f.core, 'UNSELECTED_ANTECEDENT', { memory: { content: 'Other interpretation', kind: 'context' }, receipts: [receipt('UNSELECTED_ANTECEDENT', 'neighbor')] });
  f.model.select = () => ({ refs: [{ namespaceIndex: 0, ...ref(memory) }] });
  const warm = ok(await recall(f.core)); assert.equal(warm.memories[0].receipts[0].excerpt, 'That might work.');
  assert.ok(!JSON.stringify(warm).includes('UNSELECTED_ANTECEDENT'));
  f.close(); const cold = openMemoryCore({ path: f.path, model: f.model }); t.after(() => cold.close());
  assert.deepEqual(ok(await recall(cold)), warm);
});

test('SE3 strict context mode, qualification conflict, legacy prompt preservation and cursor mode separation', async t => {
  const f = fixture(t); const first = admit(f.core); const second = admit(f.core, 'Second', { memory: { content: 'Second', kind: 'fact' } });
  for (const contextMode of [null, 'other', true, 1, {}, []]) { error(fetch(f.core, first, { contextMode }), 'invalid_input'); error(await recall(f.core, { contextMode }), 'invalid_input'); }
  error(fetch(f.core, first, { includeQualification: true }), 'invalid_input'); error(await recall(f.core, { includeQualification: true }), 'invalid_input');
  assert.deepEqual(fetch(f.core, first, { includeQualification: false }), fetch(f.core, first));
  const args = { namespace, refs: [ref(first), ref(second)] };
  const source = ok(f.core.fetch({ ...args, contextMode: 'source-evidence' })); assert.ok(source.nextCursor);
  for (const patch of [{}, { includeQualification: true }]) {
    const legacy = ok(f.core.fetch({ ...args, ...patch })); assert.ok(legacy.nextCursor);
    error(f.core.fetch({ ...args, ...patch, cursor: source.nextCursor }), 'invalid_cursor');
    error(f.core.fetch({ ...args, contextMode: 'source-evidence', cursor: legacy.nextCursor }), 'invalid_cursor');
    f.calls.length = 0; ok(await f.core.recall({ readSet: [namespace], query: 'Legacy', ...patch }));
    assert.equal(f.calls.find(call => call.method === 'rank').system, readFileSync(new URL(patch.includeQualification ? '../prompts/recall-rank-qualified.md' : '../prompts/recall-rank.md', import.meta.url), 'utf8'));
  }
});

test('SE4 complete source set fits exact budget or rejects without receipt pagination', async t => {
  const f = fixture(t, { countTokens: text => text.length });
  const memory = admit(f.core, 'First', { receipts: [receipt('First'), receipt('Second full source', 'second')] });
  const full = fetch(f.core, memory); ok(full); const budget = JSON.stringify(full).length;
  assert.deepEqual(fetch(f.core, memory, { tokenBudget: budget }), full);
  error(fetch(f.core, memory, { tokenBudget: budget - 1 }), 'context_item_too_large');
  f.model.countTokens = text => text.includes('"candidates"') && text.includes('interpretationStatus') ? 6001 : 1;
  error(await recall(f.core), 'context_budget_exceeded'); assert.equal(f.calls.filter(call => call.method === 'rank').length, 0);
});

test('SE4 100 complete receipts allowed; 101 rejected rather than dropping sources', t => {
  const f = fixture(t); let memory;
  for (let i = 0; i < 100; i++) memory = admit(f.core, `Source ${i}`, { receipts: [receipt(`Source ${i}`, `source-${i}`)] });
  const page = ok(fetch(f.core, memory)); assert.equal(page.items[0].receipts.length, 100); assert.equal(page.items[0].receiptCount, 100);
  memory = admit(f.core, 'Source 101', { receipts: [receipt('Source 101', 'source-101')] });
  error(fetch(f.core, memory), 'context_item_too_large');
});

test('SE5 foreign refs never disclose sources', async t => {
  const f = fixture(t); const own = admit(f.core); const other = admit(f.core, 'FOREIGN_SOURCE', { namespace: { ...namespace, ownerId: 'other' } });
  assert.deepEqual(ok(fetch(f.core, other)).items, []);
  const result = ok(await recall(f.core)); assert.deepEqual(result.memories.map(item => item.memory.id), [own.id]);
  assert.ok(!JSON.stringify(result).includes('FOREIGN_SOURCE'));
});

test('SE5 raw source changes during rank invalidate selected and empty results without revision changes', async t => {
  for (const empty of [false, true]) {
    let entered, release; const reached = new Promise(resolve => { entered = resolve; });
    const f = fixture(t, { rank: request => new Promise(resolve => { release = () => resolve(empty ? { refs: [] } : rank(request)); entered(); }) });
    const memory = admit(f.core); const pending = recall(f.core); await reached;
    f.db.prepare("UPDATE receipts SET excerpt='Changed directly' WHERE memory_id=?").run(memory.id);
    release(); error(await pending);
  }
});

test('SE5 correction and forgetting during rank invalidate even empty model results', async t => {
  for (const action of ['correct', 'forget']) for (const empty of [false, true]) {
    let entered, release; const reached = new Promise(resolve => { entered = resolve; });
    const f = fixture(t, { rank: request => new Promise(resolve => { release = () => resolve(empty ? { refs: [] } : rank(request)); entered(); }) });
    const memory = admit(f.core); const pending = recall(f.core); await reached;
    if (action === 'forget') ok(f.core.forget({ namespace, memoryId: memory.id, expectedRevision: memory.revision }));
    else ok(f.core.correct({ namespace, memoryId: memory.id, expectedRevision: memory.revision, content: 'Corrected', kind: 'fact', receipt: receipt('Corrected', 'correction') }));
    release(); error(await pending, 'revision_conflict');
  }
});

test('SE5 source corruption during output token counting is checked after final callback', async t => {
  const f = fixture(t, { rank: () => ({ refs: [] }) }); const memory = admit(f.core); let changed = false;
  f.model.countTokens = text => { if (!changed && text === '{"refs":[]}') {
    changed = true; f.db.prepare("UPDATE receipts SET excerpt='Postcount corruption' WHERE memory_id=?").run(memory.id);
  } return 1; };
  error(await recall(f.core)); assert.equal(changed, true);
});

test('SE3 explicit historical transition exposes original source only without inferred change reasons', async t => {
  const f = fixture(t); const memory = admit(f.core, 'The old submitted source.');
  const replacement = ok(f.core.supersede({ namespace, memoryId: memory.id, expectedRevision: memory.revision,
    replacement: { content: 'New interpretation', kind: 'fact' }, receipts: [receipt('New submitted source.', 'replacement')] })).memory;
  const detail = inspect(f.core, memory); assert.equal(detail.memory.state, 'historical');
  assert.deepEqual(ok(fetch(f.core, detail.memory)).items, []);
  assert.deepEqual(ok(fetch(f.core, detail.memory, { view: 'historical' })).items, [dto(detail)]);
  assert.deepEqual(ok(await recall(f.core)).memories.map(item => item.memory.id), [replacement.id]);
});

test('SE5 internal qualification binding validation remains active although interpretation is omitted', t => {
  const f = fixture(t); const text = 'Original exact source';
  const memory = admit(f.core, text, { qualification: { version: 1,
    slot: { subject: null, property: null, scope: null, applies: null }, value: null, attribution: 'unknown', commitment: 'unknown',
    anchors: [{ receiptIndex: 0, start: 0, end: text.length, text, fields: ['value'] }] } });
  f.db.prepare("UPDATE receipts SET excerpt='Changed exact source' WHERE memory_id=?").run(memory.id);
  error(fetch(f.core, memory), 'storage_error');
});

test('SE5 tokenizer mutation cannot replace fetched sources after budget measurement', t => {
  const f = fixture(t); const memory = admit(f.core); let changed = false;
  f.model.countTokens = text => {
    if (!changed && text.includes('interpretationStatus')) {
      changed = true; f.db.prepare("UPDATE receipts SET excerpt='Unversioned mutation' WHERE memory_id=?").run(memory.id);
    }
    return 1;
  };
  error(fetch(f.core, memory)); assert.equal(changed, true);
});

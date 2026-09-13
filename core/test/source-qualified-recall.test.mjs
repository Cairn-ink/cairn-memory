import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { DatabaseSync } from 'node:sqlite';
import test from 'node:test';
import { openMemoryCore } from '../contract.mjs';

// Trusted synthetic metadata and scripted relevance decisions verify source
// preservation/freshness, not model entailment, currentness or human intent.
const namespace = { ownerId: 'qualified-recall-tests', scope: 'personal', projectId: null };
const ok = (r) => { assert.equal(r.ok, true, JSON.stringify(r)); return r.value; };
const error = (r, code) => assert.deepEqual(r, { ok: false, error: { code, retryable: false } });
const receipt = (eventId, excerpt, role = 'user') => ({ client: 'synthetic', sessionId: 'session', eventId, role, excerpt });
const qualify = (text, patch = {}) => ({ version: 1,
  slot: { subject: 'User', property: 'reading format', scope: 'personal', applies: 'this week' },
  value: 'numbered lists', attribution: 'direct', commitment: 'considered',
  anchors: [{ receiptIndex: 0, start: 0, end: text.length, text,
    fields: ['subject', 'property', 'scope', 'applies', 'value', 'attribution', 'commitment'] }], ...patch });
const select = ({ input }) => ({ refs: input.maps.flatMap((map) => map.items.filter((item) => item.type === 'unfiled')
  .map((item) => ({ namespaceIndex: map.namespaceIndex, ...item.ref }))) });
const rank = ({ input }) => ({ refs: input.candidates.slice(0, input.limit).map((item) => ({ namespaceIndex: item.namespaceIndex,
  memoryId: item.memory.id, revision: item.memory.revision })) });
function fixture(t, overrides = {}) {
  const path = join(mkdtempSync(join(tmpdir(), 'cairn-qualified-recall-')), 'memory.sqlite'); const calls = [];
  const model = { countTokens: () => 1, contextWindow: 8192, select, rank, ...overrides };
  for (const method of ['select', 'rank']) { const fn = model[method]; model[method] = async (request) => {
    calls.push({ method, system: request.system, input: structuredClone(request.input) }); return fn(request);
  }; }
  const core = openMemoryCore({ path, model }); const db = new DatabaseSync(path); let closed = false;
  const close = () => { if (!closed) { core.close(); db.close(); closed = true; } }; t.after(close);
  return { path, model, calls, core, db, close };
}
function admit(core, patch = {}) {
  const text = 'I might prefer numbered lists 🚋 this week.';
  return ok(core.admit({ namespace, memory: { content: text, kind: 'preference' }, receipts: [receipt('source', text)],
    qualification: qualify(text), ...patch })).memory;
}
const get = (core, id) => ok(core.get({ namespace, memoryId: id, includeQualification: true }));
const fetch = (core, memory, patch = {}) => core.fetch({ namespace, refs: [{ memoryId: memory.id, revision: memory.revision }], ...patch });
const recall = (core, patch = {}) => core.recall({ readSet: [namespace], query: 'What reading formats were considered?', ...patch });
const material = (db) => ['memories', 'receipts', 'memory_qualifications', 'qualification_anchors', 'qualified_slots', 'qualified_claim_bindings']
  .map((table) => [table, db.prepare(`SELECT * FROM ${table} ORDER BY rowid`).all()]);

for (const [name, patch] of [['proposal', { attribution: 'proposed', commitment: 'unknown' }],
  ['quotation', { attribution: 'quoted', commitment: 'rejected' }], ['temporary consideration', {}],
  ['unknown', { slot: { subject: null, property: null, scope: null, applies: null }, value: null, attribution: 'unknown', commitment: 'unknown' }]]) {
  test(`QR1 ${name} preserves complete exact support in fetch, rank and final recall without authority writes`, async (t) => {
    const f = fixture(t); const text = 'I might prefer numbered lists 🚋 this week.';
    const memory = admit(f.core, { qualification: qualify(text, patch) }); const expected = get(f.core, memory.id).qualification;
    const before = material(f.db);
    assert.deepEqual(ok(fetch(f.core, memory, { includeQualification: true })).items[0].qualification, expected);
    const result = ok(await recall(f.core, { includeQualification: true }));
    assert.equal(result.memories.length, 1); assert.deepEqual(result.memories[0].qualification, expected);
    assert.deepEqual(f.calls.find((call) => call.method === 'rank').input.candidates[0].qualification, expected);
    assert.equal(result.memories[0].memory.state, 'active'); assert.deepEqual(material(f.db), before);
    assert.deepEqual(before.at(-1)[1], []); assert.deepEqual(before.at(-2)[1], []);
  });
}

test('QR1 unqualified metadata is explicit null only when enabled; legacy prompt and shapes remain identical', async (t) => {
  const f = fixture(t); const memory = ok(f.core.admit({ namespace, memory: { content: 'Unqualified note', kind: 'context' },
    receipts: [receipt('plain', 'Unqualified note')] })).memory;
  const plain = ok(fetch(f.core, memory)); assert.equal(Object.hasOwn(plain.items[0], 'qualification'), false);
  assert.deepEqual(ok(fetch(f.core, memory, { includeQualification: false })), plain);
  assert.equal(ok(fetch(f.core, memory, { includeQualification: true })).items[0].qualification, null);
  const baseline = ok(await recall(f.core)); const firstCalls = structuredClone(f.calls); f.calls.length = 0;
  assert.deepEqual(ok(await recall(f.core, { includeQualification: false })), baseline);
  assert.deepEqual(f.calls, firstCalls);
  assert.equal(firstCalls.find((call) => call.method === 'rank').system,
    readFileSync(new URL('../prompts/recall-rank.md', import.meta.url), 'utf8'));
  f.calls.length = 0;
  assert.equal(ok(await recall(f.core, { includeQualification: true })).memories[0].qualification, null);
  assert.equal(f.calls.find((call) => call.method === 'rank').input.candidates[0].qualification, null);
  assert.notEqual(f.calls.find((call) => call.method === 'rank').system, firstCalls.find((call) => call.method === 'rank').system);
});

test('QR2 fetch exact envelope token boundary includes source metadata and never drops it to fit', (t) => {
  const f = fixture(t, { countTokens: (text) => text.length }); const memory = admit(f.core);
  const full = fetch(f.core, memory, { includeQualification: true }); ok(full);
  const size = JSON.stringify(full).length; assert.ok(size <= 4000);
  assert.deepEqual(fetch(f.core, memory, { includeQualification: true, tokenBudget: size }), full);
  error(fetch(f.core, memory, { includeQualification: true, tokenBudget: size - 1 }), 'context_item_too_large');
  assert.ok(fetch(f.core, memory, { tokenBudget: size - 1 }).ok);
});

test('QR2 true/false cursor separation and strict booleans preserve legacy omitted/false traversal', async (t) => {
  const f = fixture(t); const first = admit(f.core); const second = admit(f.core, { memory: { content: 'Second synthetic note', kind: 'context' } });
  const args = { namespace, refs: [first, second].map((m) => ({ memoryId: m.id, revision: m.revision })) };
  const plain = ok(f.core.fetch(args)); const disabled = ok(f.core.fetch({ ...args, includeQualification: false }));
  assert.deepEqual(plain, disabled); assert.ok(plain.nextCursor);
  const qualified = ok(f.core.fetch({ ...args, includeQualification: true })); assert.ok(qualified.nextCursor);
  error(f.core.fetch({ ...args, includeQualification: true, cursor: plain.nextCursor }), 'invalid_cursor');
  for (const patch of [{}, { includeQualification: false }]) error(f.core.fetch({ ...args, ...patch, cursor: qualified.nextCursor }), 'invalid_cursor');
  assert.ok(f.core.fetch({ ...args, includeQualification: false, cursor: plain.nextCursor }).ok);
  for (const includeQualification of [null, 'true', 1, {}, []]) {
    error(fetch(f.core, first, { includeQualification }), 'invalid_input');
    error(await recall(f.core, { includeQualification }), 'invalid_input');
  }
});

test('QR3 late bound anchor outside both returned receipt prefixes survives rank and cold output intact', async (t) => {
  const f = fixture(t, { countTokens: (text) => {
    try { const value = JSON.parse(text); if (value.ok && value.value?.items?.[0]?.receipts?.length > 1) return 5000; } catch { /* Other model frame */ }
    return 1;
  } });
  const text = 'Late source 🚋 supports a considered option.';
  const receipts = [receipt('first', 'Earlier source one'), receipt('second', 'Earlier source two'), receipt('third', 'Earlier source three'), receipt('anchor', text)];
  const qualification = qualify(text); qualification.anchors[0].receiptIndex = 3;
  const memory = admit(f.core, { receipts, qualification });
  // Synthetic fixture controls order only; source identity/text/digests unchanged.
  for (const [index, source] of receipts.entries()) f.db.prepare('UPDATE receipts SET created_at=? WHERE event_id=?').run(index, source.eventId);
  const expected = get(f.core, memory.id).qualification;
  const page = ok(fetch(f.core, memory, { includeQualification: true }));
  assert.equal(page.items[0].receipts.length, 1); assert.deepEqual(page.items[0].qualification, expected);
  assert.ok(!page.items[0].receipts.some((source) => source.id === expected.anchors[0].receiptId));
  const warm = ok(await recall(f.core, { includeQualification: true }));
  assert.equal(warm.memories[0].receipts.length, 2); assert.deepEqual(warm.memories[0].qualification, expected);
  assert.ok(!warm.memories[0].receipts.some((source) => source.id === expected.anchors[0].receiptId));
  f.close(); const cold = openMemoryCore({ path: f.path, model: f.model }); t.after(() => cold.close());
  assert.deepEqual(ok(await recall(cold, { includeQualification: true })), warm);
});

test('QR3 ranking budget rejects complete support instead of silently omitting metadata', async (t) => {
  const f = fixture(t, { countTokens: (text) => text.includes('"candidates"') && text.includes('"qualification"') ? 6001 : 1 });
  admit(f.core);
  error(await recall(f.core, { includeQualification: true }), 'context_budget_exceeded');
  assert.equal(f.calls.filter((call) => call.method === 'rank').length, 0);
  assert.equal(ok(await recall(f.core, { includeQualification: false })).memories.length, 1);
});

test('QR2 trusted explicit transition preserves full historical support without recall reviving it', async (t) => {
  const f = fixture(t);
  const previousText = 'I adopt numbered lists this week.'; const nextText = 'I now adopt paragraphs this week.';
  const previous = admit(f.core, { memory: { content: previousText, kind: 'preference' },
    receipts: [receipt('previous', previousText)], qualification: qualify(previousText, { commitment: 'adopted' }) });
  const next = admit(f.core, { memory: { content: nextText, kind: 'preference' },
    receipts: [receipt('next', nextText)], qualification: qualify(nextText, { value: 'paragraphs', commitment: 'adopted' }) });
  const ref = (memory) => ({ memoryId: memory.id, expectedRevision: memory.revision });
  const slotId = ok(f.core.bindQualifiedClaim({ namespace, ...ref(previous), slotId: null, singleClaim: true })).slotId;
  ok(f.core.bindQualifiedClaim({ namespace, ...ref(next), slotId, singleClaim: true }));
  assert.equal(ok(f.core.transitionQualified({ namespace, predecessor: ref(previous), replacement: ref(next) })).status, 'applied');
  const historical = get(f.core, previous.id); const before = material(f.db);
  assert.equal(historical.memory.state, 'historical');
  assert.deepEqual(ok(fetch(f.core, historical.memory, { includeQualification: true })).items, []);
  const page = ok(fetch(f.core, historical.memory, { view: 'historical', includeQualification: true }));
  assert.deepEqual(page.items[0].qualification, historical.qualification);
  assert.deepEqual(ok(await recall(f.core, { includeQualification: true })).memories.map((item) => item.memory.id), [next.id]);
  assert.deepEqual(material(f.db), before);
});

test('QR6 foreign namespace references never expose qualifications', async (t) => {
  const f = fixture(t); const own = admit(f.core);
  const foreign = admit(f.core, { namespace: { ...namespace, ownerId: 'foreign' }, memory: { content: 'Foreign private source', kind: 'fact' } });
  const page = ok(fetch(f.core, foreign, { includeQualification: true })); assert.deepEqual(page.items, []);
  const result = ok(await recall(f.core, { includeQualification: true }));
  assert.deepEqual(result.memories.map((item) => item.memory.id), [own.id]); assert.ok(!JSON.stringify(f.calls).includes(foreign.id));
});

test('QR6 source corruption before fetch and while awaiting rank fails closed without stale qualified output', async (t) => {
  for (const scenario of ['before-fetch', 'selected', 'unselected']) {
    const duringRank = scenario !== 'before-fetch';
    let entered; let release; const reached = new Promise((resolve) => { entered = resolve; });
    const f = fixture(t, duringRank ? { rank: (request) => new Promise((resolve) => {
      release = () => resolve(scenario === 'unselected' ? { refs: [] } : rank(request)); entered();
    }) } : {});
    const memory = admit(f.core); let pending;
    if (duringRank) { pending = recall(f.core, { includeQualification: true }); await reached; }
    f.db.prepare("UPDATE receipts SET excerpt='Corrupted source' WHERE memory_id=?").run(memory.id);
    if (duringRank) { release(); error(await pending, 'storage_error'); }
    else error(fetch(f.core, memory, { includeQualification: true }), 'storage_error');
  }
});

test('QR6 concurrent correction/forget during ranking invalidates even empty ranked result', async (t) => {
  for (const action of ['correct', 'forget']) for (const empty of [false, true]) {
    let entered; let release; const reached = new Promise((resolve) => { entered = resolve; });
    const f = fixture(t, { rank: (request) => new Promise((resolve) => { release = () => resolve(empty ? { refs: [] } : rank(request)); entered(); }) });
    const memory = admit(f.core); const pending = recall(f.core, { includeQualification: true }); await reached;
    const other = openMemoryCore({ path: f.path }); t.after(() => other.close());
    if (action === 'forget') ok(other.forget({ namespace, memoryId: memory.id, expectedRevision: memory.revision }));
    else ok(other.correct({ namespace, memoryId: memory.id, expectedRevision: memory.revision,
      content: 'A corrected source', kind: 'fact', receipt: receipt('correction', 'A corrected source') }));
    release(); error(await pending, 'revision_conflict');
  }
});

test('QR6 tokenizer-triggered correction cannot return qualified fetch snapshot', (t) => {
  const f = fixture(t); const memory = admit(f.core); let changed = false;
  f.model.countTokens = (text) => {
    if (!changed && text.includes('"qualification"')) {
      changed = true; ok(f.core.correct({ namespace, memoryId: memory.id, expectedRevision: memory.revision,
        content: 'Changed during counting', kind: 'context', receipt: receipt('counter', 'Changed during counting') }));
    }
    return 1;
  };
  error(fetch(f.core, memory, { includeQualification: true }), 'index_revision_conflict'); assert.equal(changed, true);
});

test('QR6 tokenizer source corruption without epoch change fails final qualified recall even for empty rank', async (t) => {
  const f = fixture(t, { rank: () => ({ refs: [] }) }); const memory = admit(f.core); let changed = false;
  f.model.countTokens = (text) => {
    if (!changed && text === '{"refs":[]}') {
      changed = true; f.db.prepare("UPDATE receipts SET excerpt='Corrupted after rank' WHERE memory_id=?").run(memory.id);
    }
    return 1;
  };
  error(await recall(f.core, { includeQualification: true }), 'storage_error'); assert.equal(changed, true);
});

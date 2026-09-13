import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import test from 'node:test';
import { openMemoryCore } from '../contract.mjs';

// Frozen, handcrafted synthetic claims test enforcement, not model quality.
const namespace = { ownerId: 'synthetic-transition-set', scope: 'personal', projectId: null };
const ok = result => { assert.equal(result.ok, true, JSON.stringify(result)); return result.value; };
const error = (result, code) => { assert.equal(result.ok, false, JSON.stringify(result)); assert.equal(result.error.code, code); };
const ref = memory => ({ memoryId: memory.id, expectedRevision: memory.revision });
const input = (previous, replacement) => ({ namespace, predecessors: previous.map(ref), replacement: ref(replacement) });
const snapshot = db => db.prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name").all()
  .map(({ name }) => [name, db.prepare(`SELECT * FROM "${name}" ORDER BY rowid`).all()]);
function unchanged(db, action) { const before = snapshot(db); action(); assert.deepEqual(snapshot(db), before); }
function fixture(t) {
  const path = join(mkdtempSync(join(tmpdir(), 'cairn-transition-set-')), 'synthetic.sqlite');
  const core = openMemoryCore({ path, model: { countTokens: () => 1 } });
  const db = new DatabaseSync(path); let closed = false;
  const closeAll = () => { if (!closed) { core.close(); db.close(); closed = true; } };
  t.after(closeAll); return { core, db, path, closeAll };
}
function admit(core, value, label, { qualified = true, role = 'user', patch = {}, ns = namespace } = {}) {
  const text = `Project Alpha deadline is ${value}. Synthetic source ${label}.`;
  return ok(core.admit({ namespace: ns, memory: { content: text, kind: 'fact' },
    receipts: [{ client: 'synthetic', sessionId: 'session', eventId: label, role, excerpt: text }],
    ...(qualified ? { qualification: { version: 1,
      slot: { subject: 'Project Alpha', property: 'deadline', scope: 'work', applies: 'release' },
      value, attribution: 'direct', commitment: 'adopted',
      anchors: [{ receiptIndex: 0, start: 0, end: text.length, text,
        fields: ['subject', 'property', 'scope', 'applies', 'value', 'attribution', 'commitment'] }], ...patch } } : {}) })).memory;
}
const bind = (core, memory, slotId = null, ns = namespace) => ok(core.bindQualifiedClaim({ namespace: ns, ...ref(memory), slotId, singleClaim: true })).slotId;
const detail = (core, memory) => ok(core.get({ namespace, memoryId: memory.id, includeQualification: true }));
function group(core, count = 2) {
  const previous = Array.from({ length: count }, (_, i) => admit(core, 'Friday', `old-${i}`));
  const replacement = admit(core, 'Monday', 'new'); const slot = bind(core, replacement);
  for (const old of previous) bind(core, old, slot);
  return { previous, replacement, slot };
}
function unresolved(core, db, request, reason) {
  const indexRevision = ok(core.map({ namespace })).indexRevision;
  unchanged(db, () => { const result = ok(core.transitionQualifiedSet(request));
    assert.equal(result.status, 'unresolved'); assert.equal(result.reason, reason);
    assert.equal(result.retiredCount, 0); assert.equal(result.indexRevision, indexRevision); });
}

for (const count of [1, 2, 5]) test(`M1/M4 ${count} predecessors retire together with original evidence and true cold history`, t => {
  const { core, db, path, closeAll } = fixture(t); const { previous, replacement } = group(core, count);
  const originals = previous.map(memory => detail(core, memory)); const nextBefore = detail(core, replacement);
  const result = ok(core.transitionQualifiedSet(input([...previous].reverse(), replacement)));
  assert.equal(result.status, 'applied'); assert.equal(result.reason, null); assert.equal(result.retiredCount, count);
  assert.deepEqual(result.previous, [...previous].sort((a, b) => a.id.localeCompare(b.id)).map(m => ({ id: m.id, revision: m.revision + 1 })));
  assert.deepEqual(result.replacement, { id: replacement.id, revision: replacement.revision });
  assert.equal(db.prepare('SELECT count(*) n FROM memories WHERE deleted=1').get().n, 0);
  const history = previous.map((memory, index) => { const current = detail(core, memory);
    assert.equal(current.memory.state, 'historical'); assert.deepEqual(current.receipts, originals[index].receipts);
    assert.deepEqual(current.qualification, originals[index].qualification);
    assert.equal(current.supersession.replacement.memoryId, replacement.id);
    assert.deepEqual(current.supersession.receiptIds, nextBefore.receipts.map(r => r.id)); return current; });
  assert.deepEqual(detail(core, replacement), nextBefore);
  assert.deepEqual(ok(core.list({ namespace, states: ['active'] })).memories.map(m => m.id), [replacement.id]);
  unchanged(db, () => error(core.transitionQualifiedSet(input(previous, replacement)), 'revision_conflict'));
  closeAll(); const cold = openMemoryCore({ path }); t.after(() => cold.close());
  assert.deepEqual(previous.map(memory => detail(cold, memory)), history); assert.deepEqual(detail(cold, replacement), nextBefore);
  assert.deepEqual(ok(cold.list({ namespace, states: ['active'] })).memories.map(m => m.id), [replacement.id]);
});

test('M1 strict shape, density, bounds, extra fields and references never mutate', t => {
  const { core, db } = fixture(t); const { previous, replacement } = group(core);
  const valid = input(previous, replacement); const sparse = Array(2); sparse[1] = ref(previous[1]);
  for (const bad of [null, {}, { ...valid, extra: true }, { ...valid, predecessors: [] },
    { ...valid, predecessors: Array(6).fill(ref(previous[0])) }, { ...valid, predecessors: sparse },
    { ...valid, predecessors: null }, { ...valid, predecessors: [null] },
    { ...valid, predecessors: [{ ...ref(previous[0]), expectedRevision: 0 }] },
    { ...valid, predecessors: [{ ...ref(previous[0]), memoryId: '' }] },
    { ...valid, predecessors: [{ ...ref(previous[0]), slotId: 'forged' }] },
    { ...valid, replacement: { ...ref(replacement), authority: true } }])
    unchanged(db, () => error(core.transitionQualifiedSet(bad), 'invalid_input'));
  for (const key of Object.keys(valid)) { const bad = { ...valid }; delete bad[key];
    unchanged(db, () => error(core.transitionQualifiedSet(bad), 'invalid_input')); }
  for (const predecessors of [[ref(previous[0]), ref(previous[0])], [ref(replacement)]])
    unchanged(db, () => error(core.transitionQualifiedSet({ ...valid, predecessors }), 'invalid_ref'));
});

test('M1 six distinct predecessors exceed the limit without mutation', t => {
  const { core, db } = fixture(t); const { previous, replacement } = group(core, 6);
  unchanged(db, () => error(core.transitionQualifiedSet(input(previous, replacement)), 'invalid_input'));
});

test('M1 missing, foreign and late stale references are hard failures', t => {
  const { core, db } = fixture(t); const { previous, replacement } = group(core);
  const request = input(previous, replacement);
  for (const bad of [{ ...request, namespace: { ...namespace, ownerId: 'other' } },
    { ...request, namespace: { ...namespace, scope: 'project', projectId: 'other' } },
    { ...request, predecessors: [ref(previous[0]), { memoryId: 'missing', expectedRevision: 1 }] }])
    unchanged(db, () => error(core.transitionQualifiedSet(bad), 'memory_not_found'));
  for (const bad of [{ ...request, predecessors: [ref(previous[0]), { ...ref(previous[1]), expectedRevision: 99 }] },
    { ...request, replacement: { ...ref(replacement), expectedRevision: 99 } }])
    unchanged(db, () => error(core.transitionQualifiedSet(bad), 'revision_conflict'));
});

for (const state of ['historical', 'deleted']) test(`M1/M4 ${state} references fail, but noncurrent members do not block coverage`, t => {
  const { core, db } = fixture(t); const { previous, replacement, slot } = group(core, 1);
  const old = previous[0];
  if (state === 'historical') ok(core.transitionQualifiedSet(input(previous, replacement)));
  else ok(core.forget({ namespace, ...ref(old) }));
  const fresh = admit(core, 'Tuesday', 'fresh'); bind(core, fresh, slot);
  const oldRef = state === 'historical' ? detail(core, old).memory : old;
  unchanged(db, () => error(core.transitionQualifiedSet(input([oldRef], fresh)), state === 'historical' ? 'memory_historical' : 'memory_not_found'));
  assert.equal(ok(core.transitionQualifiedSet(input([replacement], fresh))).status, 'applied');
});

test('M2 pair API still refuses a third member; omitted current set member remains unresolved', t => {
  const { core, db } = fixture(t); const { previous, replacement } = group(core);
  unresolved(core, db, input([previous[0]], replacement), 'additional_current_claims');
  unchanged(db, () => assert.equal(ok(core.transitionQualified({ namespace, predecessor: ref(previous[0]), replacement: ref(replacement) })).reason, 'additional_current_claims'));
  assert.equal(ok(core.transitionQualifiedSet(input(previous, replacement))).status, 'applied');
});

test('M3 foreign corrupt current membership is storage_error, not ordinary incomplete coverage', t => {
  const { core, db } = fixture(t); const { previous, replacement, slot } = group(core);
  const foreignNs = { ...namespace, ownerId: 'foreign-synthetic' };
  const foreign = admit(core, 'Sunday', 'foreign', { ns: foreignNs }); bind(core, foreign, null, foreignNs);
  db.prepare('UPDATE qualified_claim_bindings SET slot_id=? WHERE memory_id=?').run(slot, foreign.id);
  unchanged(db, () => error(core.transitionQualifiedSet(input(previous, replacement)), 'storage_error'));
});

test('M3 complete current coverage includes overflow beyond six members', t => {
  const { core, db } = fixture(t); const { previous, replacement } = group(core, 7);
  unresolved(core, db, input(previous.slice(0, 5), replacement), 'additional_current_claims');
});

for (const [name, options, reason] of [
  ['same-value predecessor', { patch: { value: 'Monday' } }, 'same_value'],
  ['unknown predecessor', { patch: { value: null } }, 'value_unknown'],
  ['assistant predecessor', { role: 'assistant' }, 'adoption_evidence_missing'],
  ['proposed predecessor', { patch: { attribution: 'proposed' } }, 'attribution_unsupported'],
  ['considered predecessor', { patch: { commitment: 'considered' } }, 'commitment_unsupported'],
]) test(`M2/M4 ${name} cannot be silently retired`, t => {
  const { core, db } = fixture(t); const { previous, replacement, slot } = group(core, 1);
  const other = admit(core, 'Thursday', 'unsupported', options); bind(core, other, slot);
  unresolved(core, db, input([...previous, other], replacement), reason);
});

test('M2 explicit complete set can contain different supported old values', t => {
  const { core } = fixture(t); const { previous, replacement, slot } = group(core, 1);
  const other = admit(core, 'Thursday', 'different-old'); bind(core, other, slot);
  assert.equal(ok(core.transitionQualifiedSet(input([...previous, other], replacement))).retiredCount, 2);
});

for (const missing of ['qualification', 'binding', 'slot']) test(`M2 missing ${missing} remains unresolved`, t => {
  const { core, db } = fixture(t); const { previous, replacement } = group(core, 1);
  const other = admit(core, 'Thursday', 'other', { qualified: missing !== 'qualification' });
  if (missing === 'slot') bind(core, other);
  unresolved(core, db, input([...previous, other], replacement),
    { qualification: 'qualification_missing', binding: 'binding_missing', slot: 'slot_mismatch' }[missing]);
});

for (const corruption of ['source', 'role', 'binding']) test(`M3 inspect all refs: earlier unsupported cannot mask later corrupt ${corruption}`, t => {
  const { core, db } = fixture(t); const { previous, replacement } = group(core);
  const sorted = [...previous].sort((a, b) => a.id.localeCompare(b.id));
  db.prepare("UPDATE memory_qualifications SET commitment='considered' WHERE memory_id=?").run(sorted[0].id);
  if (corruption === 'binding') db.prepare('UPDATE qualified_claim_bindings SET content_digest=? WHERE memory_id=?').run('b'.repeat(64), sorted[1].id);
  else { const source = detail(core, sorted[1]).receipts[0];
    if (corruption === 'source') db.prepare('UPDATE receipts SET excerpt=? WHERE id=?').run('corrupt', source.id);
    else db.prepare('UPDATE receipts SET role=? WHERE id=?').run('assistant', source.id); }
  unchanged(db, () => error(core.transitionQualifiedSet(input(sorted, replacement)), 'storage_error'));
});

test('M3 earlier unqualified input cannot mask corrupt replacement', t => {
  const { core, db } = fixture(t); const { previous, replacement } = group(core, 1);
  const plain = admit(core, 'Thursday', 'plain', { qualified: false });
  db.prepare('UPDATE memory_qualifications SET content_digest=? WHERE memory_id=?').run('b'.repeat(64), replacement.id);
  unchanged(db, () => error(core.transitionQualifiedSet(input([...previous, plain], replacement)), 'storage_error'));
});

for (const extra of [3, 4]) test(`M3 existing two edges plus ${extra} new edges preflight total capacity`, t => {
  const { core, db } = fixture(t); const { previous, replacement, slot } = group(core);
  ok(core.transitionQualifiedSet(input(previous, replacement)));
  const added = Array.from({ length: extra }, (_, i) => admit(core, 'Thursday', `added-${i}`));
  for (const memory of added) bind(core, memory, slot);
  if (extra === 4) {
    // If capacity were checked after starting mutation, this trigger would yield
    // storage_error instead of the required preflight supersession_limit.
    db.exec("CREATE TRIGGER synthetic_no_early_retirement BEFORE UPDATE OF currentness ON memories WHEN NEW.currentness='historical' BEGIN SELECT RAISE(ABORT,'mutation before capacity'); END");
    unchanged(db, () => error(core.transitionQualifiedSet(input(added, replacement)), 'supersession_limit'));
  } else {
    assert.equal(ok(core.transitionQualifiedSet(input(added, replacement))).retiredCount, 3);
    assert.equal(db.prepare('SELECT count(*) n FROM memory_supersessions WHERE replacement_memory_id=?').get(replacement.id).n, 5);
  }
});

test('M3 second retirement failure restores every table and input order is immaterial', t => {
  const { core, db } = fixture(t); const { previous, replacement } = group(core);
  for (let i = 0; i < previous.length; i++) {
    const old = previous[i]; const text = `Synthetic disagreement ${i}`;
    ok(core.applyPlacement({ namespace, expectedIndexRevision: ok(core.map({ namespace })).indexRevision,
      expectedMemoryRevisions: [{ memoryId: old.id, revision: old.revision }],
      proposal: { items: [{ memoryId: old.id, parentIds: [], newL1: { title: `Synthetic old ${i}`, parentL2Ids: [] } }] } }));
    previous[i] = detail(core, old).memory;
    ok(core.admit({ namespace, memory: { content: text, kind: 'fact' },
      receipts: [{ client: 'synthetic', sessionId: 'session', eventId: text, role: 'user', excerpt: text }],
      conflictHints: [{ memoryId: old.id, expectedRevision: previous[i].revision, relation: 'contradicts' }] }));
    assert.ok(detail(core, old).placements.length > 0); assert.ok(detail(core, old).conflicts.length > 0);
  }
  db.exec("CREATE TRIGGER synthetic_second_retirement BEFORE UPDATE OF currentness ON memories WHEN NEW.currentness='historical' AND (SELECT count(*) FROM memories WHERE currentness='historical')=1 BEGIN SELECT RAISE(ABORT,'second retirement failed'); END");
  unchanged(db, () => error(core.transitionQualifiedSet(input(previous, replacement)), 'storage_error'));
  unchanged(db, () => error(core.transitionQualifiedSet(input([...previous].reverse(), replacement)), 'storage_error'));
  db.exec('DROP TRIGGER synthetic_second_retirement');
  const result = ok(core.transitionQualifiedSet(input([...previous].reverse(), replacement)));
  assert.deepEqual(result.previous.map(memory => memory.id), previous.map(memory => memory.id).sort());
  assert.equal(result.retiredCount, 2); assert.deepEqual(db.prepare('PRAGMA foreign_key_check').all(), []);
});

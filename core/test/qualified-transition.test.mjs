import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import test from 'node:test';
import { openMemoryCore } from '../contract.mjs';
import { openMemoryStore } from '../index.mjs';
import { createQualificationStorage } from '../claim-qualification-storage.mjs';

// Trusted synthetic annotations exercise enforcement, not semantic inference.
const namespace = { ownerId: 'qualified-transition-synthetic', scope: 'personal', projectId: null };
const ok = (r) => { assert.equal(r.ok, true, JSON.stringify(r)); return r.value; };
const error = (r, code) => { assert.equal(r.ok, false, JSON.stringify(r)); assert.equal(r.error.code, code); };
const snapshot = (db) => db.prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name").all()
  .map(({ name }) => [name, db.prepare(`SELECT * FROM "${name}" ORDER BY rowid`).all()]);
const receipt = (text, role = 'user') => ({ client: 'synthetic', sessionId: 'session', eventId: text, role, excerpt: text });
const qualification = (text, value, patch = {}) => ({ version: 1,
  slot: { subject: 'Project Alpha', property: 'deadline', scope: 'work', applies: 'current release' },
  value, attribution: 'direct', commitment: 'adopted',
  anchors: [{ receiptIndex: 0, start: 0, end: text.length, text,
    fields: ['subject', 'property', 'scope', 'applies', 'value', 'attribution', 'commitment'] }], ...patch });
function fixture(t, model = { countTokens: () => 1 }) {
  const path = join(mkdtempSync(join(tmpdir(), 'cairn-qualified-transition-')), 'synthetic.sqlite');
  const core = openMemoryCore({ path, model }); const db = new DatabaseSync(path); let closed = false;
  const closeAll = () => { if (!closed) { core.close(); db.close(); closed = true; } };
  t.after(closeAll); return { core, db, path, closeAll };
}
function admit(core, value, { text = `Project Alpha deadline is ${value}.`, q = {}, role = 'user', ns = namespace, qualified = true } = {}) {
  return ok(core.admit({ namespace: ns, memory: { content: text, kind: 'fact' }, receipts: [receipt(text, role)],
    ...(qualified ? { qualification: qualification(text, value, q) } : {}) })).memory;
}
const detail = (core, m, ns = namespace) => ok(core.get({ namespace: ns, memoryId: m.id, includeQualification: true }));
const ref = (m) => ({ memoryId: m.id, expectedRevision: m.revision });
const bindInput = (m, slotId = null) => ({ namespace, ...ref(m), slotId, singleClaim: true });
const bind = (core, m, slotId = null) => ok(core.bindQualifiedClaim(bindInput(m, slotId)));
const input = (old, next) => ({ namespace, predecessor: ref(old), replacement: ref(next) });
function pair(core, options = {}) {
  const old = admit(core, 'Friday'); const next = admit(core, 'Monday', options);
  const slot = bind(core, old).slotId; bind(core, next, slot); return { old, next, slot };
}
function unchanged(db, fn) { const before = snapshot(db); fn(); assert.deepEqual(snapshot(db), before); }
function attachTrustedQualification(core, db, memory, value) {
  const text = detail(core, memory).memory.content;
  const storage = createQualificationStorage({ db,
    receiptKey: (r) => createHash('sha256').update(JSON.stringify(r)).digest('hex') });
  const receipts = detail(core, memory).receipts.map((r) => ({ client: r.client, sessionId: r.sessionId,
    eventId: r.eventId, role: r.role, excerpt: r.excerpt }));
  db.exec('BEGIN IMMEDIATE');
  try { storage.bind(db.prepare('SELECT * FROM memories WHERE id=?').get(memory.id), qualification(text, value), receipts, false, text); db.exec('COMMIT'); }
  catch (err) { db.exec('ROLLBACK'); throw err; }
}

test('T1 strict parsing, hard stale/missing/foreign/self failures never mutate', (t) => {
  const { core, db } = fixture(t); const { old, next } = pair(core);
  for (const bad of [{ ...bindInput(old), extra: true }, { ...bindInput(old), singleClaim: false },
    { ...bindInput(old), expectedRevision: 0 }, { ...bindInput(old), slotId: '' }])
    unchanged(db, () => error(core.bindQualifiedClaim(bad), 'invalid_input'));
  for (const key of Object.keys(bindInput(old))) { const bad = bindInput(old); delete bad[key];
    unchanged(db, () => error(core.bindQualifiedClaim(bad), 'invalid_input')); }
  for (const bad of [{ ...input(old, next), extra: true }, { ...input(old, next), replacement: { ...ref(next), slotId: 'forged' } },
    { ...input(old, next), predecessor: { ...ref(old), expectedRevision: 0 } }])
    unchanged(db, () => error(core.transitionQualified(bad), 'invalid_input'));
  for (const [patch, code] of [[{ predecessor: ref(next) }, 'invalid_ref'],
    [{ predecessor: { ...ref(old), expectedRevision: 99 } }, 'revision_conflict'],
    [{ replacement: { ...ref(next), expectedRevision: 99 } }, 'revision_conflict'],
    [{ predecessor: { memoryId: 'missing', expectedRevision: 1 } }, 'memory_not_found'],
    [{ namespace: { ...namespace, ownerId: 'foreign' } }, 'memory_not_found'],
    [{ namespace: { ...namespace, scope: 'project', projectId: 'foreign' } }, 'memory_not_found']])
    unchanged(db, () => error(core.transitionQualified({ ...input(old, next), ...patch }), code));
});

test('T4/T7 real changed claim retires exactly once, retains evidence/history and survives full cold reopen', (t) => {
  const { core, db, path, closeAll } = fixture(t); const { old, next, slot } = pair(core);
  const before = detail(core, old); const nextBefore = detail(core, next);
  const result = ok(core.transitionQualified(input(old, next)));
  assert.equal(result.status, 'applied'); assert.equal(result.reason, null); assert.equal(result.retiredCount, 1);
  assert.deepEqual(result.previous, { id: old.id, revision: old.revision + 1 });
  assert.deepEqual(result.replacement, { id: next.id, revision: next.revision });
  const history = detail(core, old); assert.equal(history.memory.state, 'historical');
  assert.deepEqual(history.receipts, before.receipts); assert.deepEqual(history.qualification, before.qualification);
  assert.deepEqual(detail(core, next), nextBefore);
  assert.equal(history.supersession.replacement.memoryId, next.id);
  assert.deepEqual(history.supersession.receiptIds, nextBefore.receipts.map((r) => r.id));
  assert.deepEqual(ok(core.list({ namespace, states: ['active'] })).memories.map((m) => m.id), [next.id]);
  assert.equal(db.prepare('SELECT count(*) n FROM qualified_slots').get().n, 1);
  assert.equal(db.prepare('SELECT count(*) n FROM qualified_claim_bindings WHERE slot_id=?').get(slot).n, 2);
  unchanged(db, () => error(core.transitionQualified(input(old, next)), 'revision_conflict'));
  unchanged(db, () => error(core.transitionQualified(input(history.memory, next)), 'memory_historical'));
  closeAll(); const cold = openMemoryCore({ path }); t.after(() => cold.close());
  assert.deepEqual(detail(cold, old), history); assert.deepEqual(detail(cold, next), nextBefore);
  assert.equal(bind(cold, next).slotId, slot);
});

test('T2/T3 immutable server slot identity, namespace separation, descriptor equality and idempotent binding', (t) => {
  const { core, db, path, closeAll } = fixture(t); const old = admit(core, 'Friday'); const slot = bind(core, old).slotId;
  assert.equal(typeof slot, 'string'); assert.ok(slot.length > 0);
  unchanged(db, () => { assert.equal(bind(core, old).slotId, slot); assert.equal(bind(core, old, slot).slotId, slot); });
  const other = admit(core, 'Tuesday'); const otherSlot = bind(core, other).slotId;
  assert.notEqual(otherSlot, slot);
  unchanged(db, () => error(core.bindQualifiedClaim(bindInput(old, otherSlot)), 'qualification_conflict'));
  const unbound = admit(core, 'Wednesday');
  unchanged(db, () => error(core.bindQualifiedClaim(bindInput(unbound, 'absent-slot')), 'slot_not_found'));
  for (const field of ['subject', 'property', 'scope', 'applies']) {
    const text = `Synthetic different ${field}`; const q = qualification(text, 'Thursday'); q.slot[field] = 'different';
    const mismatch = admit(core, 'Thursday', { text, q });
    unchanged(db, () => error(core.bindQualifiedClaim(bindInput(mismatch, slot)), 'slot_mismatch'));
    q.slot[field] = null; const unknown = admit(core, 'Thursday', { text: `Unknown ${field}`, q: { slot: q.slot } });
    unchanged(db, () => error(core.bindQualifiedClaim(bindInput(unknown)), 'qualification_incomplete'));
  }
  const ns = { ...namespace, ownerId: 'other-owner' }; const foreign = admit(core, 'Friday', { ns });
  unchanged(db, () => error(core.bindQualifiedClaim({ ...bindInput(foreign, slot), namespace: ns }), 'slot_not_found'));
  closeAll(); const cold = openMemoryCore({ path }); t.after(() => cold.close()); assert.equal(bind(cold, old).slotId, slot);
});

for (const [name, options, reason] of [
  ['unknown value', { q: { value: null } }, 'value_unknown'],
  ['same value', { q: { value: 'Friday' } }, 'same_value'],
  ...['proposed', 'quoted', 'reported', 'unknown'].map((attribution) => [attribution, { q: { attribution } }, 'attribution_unsupported']),
  ...['considered', 'rejected', 'unknown'].map((commitment) => [commitment, { q: { commitment } }, 'commitment_unsupported']),
  ['assistant anchors', { role: 'assistant' }, 'adoption_evidence_missing'],
]) test(`T4/T5 ${name} cannot retire an existing claim`, (t) => {
  const { core, db } = fixture(t); const { old, next } = pair(core, options);
  unchanged(db, () => { const result = ok(core.transitionQualified(input(old, next)));
    assert.equal(result.status, 'unresolved'); assert.equal(result.reason, reason); assert.equal(result.retiredCount, 0); });
  assert.equal(detail(core, old).memory.state, 'active'); assert.equal(detail(core, next).memory.state, 'active');
});

test('T4 equal descriptors do not invent shared identity; absent qualification and bindings abstain', (t) => {
  const { core, db } = fixture(t); const old = admit(core, 'Friday'); const next = admit(core, 'Monday');
  const plain = admit(core, 'Tuesday', { qualified: false });
  unchanged(db, () => assert.equal(ok(core.transitionQualified(input(old, plain))).reason, 'qualification_missing'));
  unchanged(db, () => assert.equal(ok(core.transitionQualified(input(old, next))).reason, 'binding_missing'));
  bind(core, old); bind(core, next);
  unchanged(db, () => assert.equal(ok(core.transitionQualified(input(old, next))).reason, 'slot_mismatch'));
});

for (const value of ['Friday', 'Monday', 'Tuesday']) test(`T4 extra current slot member (${value}) cannot be left contradictory by a two-record transition`, (t) => {
  const { core, db } = fixture(t); const { old, next, slot } = pair(core);
  const extra = admit(core, value, { text: `I reaffirm Project Alpha deadline ${value}.` }); bind(core, extra, slot);
  unchanged(db, () => { const result = ok(core.transitionQualified(input(old, next)));
    assert.equal(result.status, 'unresolved'); assert.equal(result.reason, 'additional_current_claims'); assert.equal(result.retiredCount, 0); });
  assert.ok([old, next, extra].every((m) => detail(core, m).memory.state === 'active'));
});

for (const state of ['historical', 'deleted']) test(`T4 ${state} members do not block a valid next transition`, (t) => {
  const { core } = fixture(t); const old = admit(core, 'Thursday'); const middle = admit(core, 'Friday');
  const slot = bind(core, old).slotId; bind(core, middle, slot);
  if (state === 'historical') assert.equal(ok(core.transitionQualified(input(old, middle))).status, 'applied');
  else ok(core.forget({ namespace, ...ref(old) }));
  const next = admit(core, 'Monday'); bind(core, next, slot);
  assert.equal(ok(core.transitionQualified(input(middle, next))).status, 'applied');
});

for (const field of ['commitment', 'value']) test(`T4 user evidence for other fields cannot launder assistant-only ${field}`, (t) => {
  const { core, db } = fixture(t); const old = admit(core, 'Friday'); const slot = bind(core, old).slotId;
  const text = 'Project Alpha deadline is Monday.'; const q = qualification(text, 'Monday');
  q.anchors[0].fields = q.anchors[0].fields.filter((f) => f !== field);
  q.anchors.push({ receiptIndex: 1, start: 0, end: text.length, text, fields: [field] });
  const next = ok(core.admit({ namespace, memory: { content: text, kind: 'fact' },
    receipts: [receipt(text), receipt(text, 'assistant')], qualification: q })).memory;
  bind(core, next, slot);
  unchanged(db, () => assert.equal(ok(core.transitionQualified(input(old, next))).reason, 'adoption_evidence_missing'));
});

test('T4 predecessor commitment also requires user authority, not only a well-supported replacement', (t) => {
  const { core, db } = fixture(t); const old = admit(core, 'Friday', { role: 'assistant' });
  const next = admit(core, 'Monday'); bind(core, next, bind(core, old).slotId);
  unchanged(db, () => assert.equal(ok(core.transitionQualified(input(old, next))).reason, 'adoption_evidence_missing'));
});

for (const corruption of ['receipt-text', 'receipt-role', 'missing-receipt', 'content-digest', 'binding-digest'])
  test(`T5 corrupted ${corruption} cannot be downgraded to ordinary uncertainty`, (t) => {
    const { core, db } = fixture(t); const { old, next } = pair(core); const source = detail(core, next).receipts[0];
    if (corruption === 'receipt-text') db.prepare('UPDATE receipts SET excerpt=? WHERE id=?').run('Tampered', source.id);
    if (corruption === 'receipt-role') db.prepare('UPDATE receipts SET role=? WHERE id=?').run('assistant', source.id);
    if (corruption === 'missing-receipt') { db.exec('PRAGMA foreign_keys=OFF'); db.prepare('DELETE FROM receipts WHERE id=?').run(source.id); }
    if (corruption === 'content-digest') db.prepare('UPDATE memory_qualifications SET content_digest=? WHERE memory_id=?').run('b'.repeat(64), next.id);
    if (corruption === 'binding-digest') db.prepare('UPDATE qualified_claim_bindings SET content_digest=? WHERE memory_id=?').run('b'.repeat(64), next.id);
    unchanged(db, () => error(core.transitionQualified(input(old, next)), 'storage_error'));
  });

test('T5 late SQLite retirement failure rolls back every table, then the same valid transition succeeds', (t) => {
  const { core, db } = fixture(t); const { old, next } = pair(core);
  db.exec("CREATE TRIGGER synthetic_transition_failure BEFORE UPDATE OF currentness ON memories WHEN NEW.currentness='historical' BEGIN SELECT RAISE(ABORT,'synthetic late failure'); END");
  unchanged(db, () => error(core.transitionQualified(input(old, next)), 'storage_error'));
  db.exec('DROP TRIGGER synthetic_transition_failure'); assert.equal(ok(core.transitionQualified(input(old, next))).status, 'applied');
});

test('T5 corrupt replacement is a hard error even when predecessor has no qualification', (t) => {
  const { core, db } = fixture(t); const old = admit(core, 'Friday', { qualified: false }); const next = admit(core, 'Monday');
  db.prepare('UPDATE memory_qualifications SET content_digest=? WHERE memory_id=?').run('b'.repeat(64), next.id);
  unchanged(db, () => error(core.transitionQualified(input(old, next)), 'storage_error'));
});

for (const legacy of [false, true]) for (const action of ['correct', 'forget']) test(`T3 ${legacy ? 'legacy' : 'core'} ${action} removes memberships and orphan descriptors`, (t) => {
  const { core, db, path } = fixture(t); const { old, next } = pair(core);
  function change(m) {
    if (legacy) { const store = openMemoryStore({ path }); try { const scope = store.scope({ ownerId: namespace.ownerId });
      if (action === 'forget') scope.forget(m.id, m.revision);
      else scope.correct(m.id, { content: `Corrected ${m.id}`, kind: 'fact', origin: 'explicit', receipt: receipt(`Corrected ${m.id}`) }, m.revision);
    } finally { store.close(); } }
    else if (action === 'forget') ok(core.forget({ namespace, ...ref(m) }));
    else ok(core.correct({ namespace, ...ref(m), content: `Corrected ${m.id}`, kind: 'fact', receipt: receipt(`Corrected ${m.id}`) }));
  }
  change(old); assert.equal(db.prepare('SELECT count(*) n FROM qualified_claim_bindings').get().n, 1);
  assert.equal(db.prepare('SELECT count(*) n FROM qualified_slots').get().n, 1);
  change(next); assert.equal(db.prepare('SELECT count(*) n FROM qualified_claim_bindings').get().n, 0);
  assert.equal(db.prepare('SELECT count(*) n FROM qualified_slots').get().n, 0);
  assert.deepEqual(db.prepare('PRAGMA foreign_key_check').all(), []);
});

test('T3 filing and new receipts preserve original binding across non-content revisions', (t) => {
  const { core, db } = fixture(t); let old = admit(core, 'Friday'); const slot = bind(core, old).slotId;
  const binding = db.prepare('SELECT * FROM qualified_claim_bindings').get();
  ok(core.applyPlacement({ namespace, proposal: { items: [{ memoryId: old.id, parentIds: [], newL1: { title: 'Synthetic deadline', parentL2Ids: [] } }] },
    expectedMemoryRevisions: [{ memoryId: old.id, revision: old.revision }], expectedIndexRevision: ok(core.map({ namespace })).indexRevision }));
  old = detail(core, old).memory;
  ok(core.admit({ namespace, memory: { content: old.content, kind: 'fact' }, receipts: [receipt('Additional source')] }));
  old = detail(core, old).memory; assert.deepEqual(db.prepare('SELECT * FROM qualified_claim_bindings').get(), binding);
  assert.equal(bind(core, old).slotId, slot); const next = admit(core, 'Monday'); bind(core, next, slot);
  assert.equal(ok(core.transitionQualified(input(old, next))).status, 'applied');
});

for (const qualifiedOld of [true, false]) test(`T6 direct legacy supersession fences ${qualifiedOld ? 'predecessor' : 'replacement'} qualification without writes`, (t) => {
  const { core, db } = fixture(t); const old = admit(core, 'Friday', { qualified: qualifiedOld });
  const next = admit(core, 'Monday', { qualified: !qualifiedOld });
  unchanged(db, () => error(core.supersede({ namespace, ...ref(old), replacement: { content: detail(core, next).memory.content, kind: 'fact' },
    receipts: [receipt('Additional replacement source')] }), 'qualified_transition_required'));
});

for (const qualifiedSide of ['predecessor', 'replacement']) test(`T6 ordered capture fences qualified ${qualifiedSide}, commits evidence and durable unresolved replay`, async (t) => {
  const model = { contextWindow: 8192, countTokens: () => 1,
    extract: ({ input: value }) => ({ items: [{ content: value.messages[0].content, kind: 'fact', confidence: 0.8, sourceIndices: [0] }] }),
    reconcile: () => ({ transitions: [{ replacementIndex: 0, predecessorIndex: 0, evidenceIndices: [0], relation: 'supersedes', valueChange: 'changed', adoption: 'explicit' }] }) };
  const { core, db, path, closeAll } = fixture(t, model);
  const capture = { namespace, client: 'synthetic', sessionId: 'session', eventId: 'ordered', causal: { streamId: 'synthetic-stream', sequence: 2 },
    messages: [{ id: 'monday', role: 'user', content: 'Project Alpha deadline is Monday.' }] };
  const friday = 'Project Alpha deadline is Friday.';
  const old = ok(await core.capture({ ...capture, eventId: 'first', causal: { ...capture.causal, sequence: 1 },
    messages: [{ id: 'friday', role: 'user', content: friday }] })).admission.memories[0];
  // Test-only trusted storage hook adds handcrafted qualification to genuinely
  // ordered evidence; the public capture/model input remains unable to do so.
  if (qualifiedSide === 'predecessor') { attachTrustedQualification(core, db, old, 'Friday'); bind(core, old); }
  else {
    const key = { namespace, client: 'synthetic', eventId: 'qualified-replacement', payloadDigest: 'a'.repeat(64) };
    const { token } = ok(core.claimAdmission({ ...key, leaseMs: 125000 }));
    const text = capture.messages[0].content;
    const replacement = ok(core.finishAdmission({ ...key, token, items: [{ content: text, kind: 'fact', confidence: 0.8,
      receipts: [receipt(text)], qualification: qualification(text, 'Monday') }] })).memories[0];
    bind(core, replacement);
  }
  const before = detail(core, old);
  const result = ok(await core.capture(capture));
  assert.deepEqual(result.reconciliation, { status: 'unresolved', reason: 'qualified_transition_required', retiredCount: 0 });
  assert.deepEqual(detail(core, old), before); const next = result.admission.memories[0]; assert.equal(detail(core, next).memory.state, 'active');
  const replay = { duplicate: true, memoryIds: [next.id], suppressedCount: 0, reconciliation: result.reconciliation };
  const state = snapshot(db); assert.deepEqual(ok(await core.capture(capture)), replay); assert.deepEqual(snapshot(db), state);
  closeAll(); const cold = openMemoryCore({ path }); t.after(() => cold.close());
  assert.deepEqual(ok(await cold.capture(capture)), replay); assert.deepEqual(detail(cold, old), before);
});

test('T6 mixed retirement batch preflights qualified second edge before any unqualified retirement', async (t) => {
  let reconciled = 0;
  const model = { contextWindow: 8192, countTokens: () => 1,
    extract: ({ input: value }) => ({ items: value.messages.map((m, i) => ({ content: m.content, kind: 'fact', confidence: 0.8, sourceIndices: [i] })) }),
    reconcile: ({ input: value }) => { reconciled++;
      return { transitions: ['Alpha', 'Beta'].map((project, i) => ({ replacementIndex: i,
        predecessorIndex: value.candidates.findIndex((c) => c.content.includes(project)), evidenceIndices: [i],
        relation: 'supersedes', valueChange: 'changed', adoption: 'explicit' })) }; } };
  const { core, db } = fixture(t, model);
  const capture = (sequence, day) => ({ namespace, client: 'synthetic', sessionId: 'session', eventId: `batch-${sequence}`,
    causal: { streamId: 'batch-stream', sequence }, messages: ['Alpha', 'Beta'].map((project) => ({
      id: `${project}-${day}`, role: 'user', content: `Project ${project} deadline is ${day}.` })) });
  const first = ok(await core.capture(capture(1, 'Friday'))).admission.memories;
  const beta = first.find((m) => detail(core, m).memory.content.includes('Beta'));
  attachTrustedQualification(core, db, beta, 'Friday'); bind(core, beta);
  const before = first.map((m) => detail(core, m));
  const result = ok(await core.capture(capture(2, 'Monday')));
  assert.equal(reconciled, 1);
  assert.deepEqual(result.reconciliation, { status: 'unresolved', reason: 'qualified_transition_required', retiredCount: 0 });
  assert.deepEqual(first.map((m) => detail(core, m)), before);
  assert.equal(db.prepare('SELECT count(*) n FROM memory_supersessions').get().n, 0);
  assert.equal(result.admission.memories.length, 2);
  assert.ok(result.admission.memories.every((m) => detail(core, m).memory.state === 'active'));
  const state = snapshot(db); const replay = ok(await core.capture(capture(2, 'Monday')));
  assert.equal(replay.duplicate, true); assert.deepEqual(replay.reconciliation, result.reconciliation); assert.deepEqual(snapshot(db), state);
});

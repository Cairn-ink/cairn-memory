import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import test from 'node:test';
import { openMemoryCore } from '../contract.mjs';
import { openMemoryStore } from '../index.mjs';

// Handcrafted local metadata tests binding/storage, never semantic entailment.
const namespace = { ownerId: 'qualification-synthetic', scope: 'personal', projectId: null };
const content = 'I choose the violet tram 🚋.';
const receipt = (eventId = 'source', excerpt = content) => ({ client: 'synthetic', sessionId: 'session', eventId, role: 'user', excerpt });
const qualification = (text = content) => ({ version: 1,
  slot: { subject: 'I', property: 'transport', scope: null, applies: null },
  value: 'violet tram', attribution: 'direct', commitment: 'adopted',
  anchors: [{ receiptIndex: 0, start: 0, end: text.length, text,
    fields: ['subject', 'property', 'value', 'attribution', 'commitment'] }] });
const input = (patch = {}) => ({ namespace, memory: { content, kind: 'fact' },
  receipts: [receipt()], qualification: qualification(), ...patch });
const item = (patch = {}) => ({ content, kind: 'fact', confidence: 0.8,
  receipts: [receipt()], qualification: qualification(), ...patch });
const key = (eventId = 'claim') => ({ namespace, client: 'synthetic', eventId, payloadDigest: 'a'.repeat(64) });
const ok = (r) => { assert.equal(r.ok, true, JSON.stringify(r)); return r.value; };
const error = (r, code) => { assert.equal(r.ok, false, JSON.stringify(r)); assert.equal(r.error.code, code); };
const digest = (s) => createHash('sha256').update(s, 'utf8').digest('hex');
const get = (core, id, patch = {}) => core.get({ namespace, memoryId: id, includeQualification: true, ...patch });
const snapshot = (db) => db.prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name").all()
  .map(({ name }) => [name, db.prepare(`SELECT * FROM "${name}" ORDER BY rowid`).all()]);
function fixture(t) {
  const path = join(mkdtempSync(join(tmpdir(), 'cairn-qualification-')), 'memory.sqlite');
  const core = openMemoryCore({ path, model: { countTokens: () => 1 } });
  const db = new DatabaseSync(path); let closed = false;
  const closeAll = () => { if (!closed) { core.close(); db.close(); closed = true; } };
  t.after(closeAll);
  return { core, db, path, closeAll };
}
const claim = (core, eventId = 'claim') => ok(core.claimAdmission({ ...key(eventId), leaseMs: 125000 })).token;
const finish = (core, token, items, eventId = 'claim') => core.finishAdmission({ ...key(eventId), token, items });

test('S1/S2 explicit exact UTF-8 bindings, opt-in shape, no copied anchor text, cold reopen', (t) => {
  const { core, db, path, closeAll } = fixture(t); const saved = ok(core.admit(input()));
  const plain = ok(core.get({ namespace, memoryId: saved.memory.id }));
  assert.equal(Object.hasOwn(plain, 'qualification'), false);
  assert.deepEqual(ok(get(core, saved.memory.id, { includeQualification: false })), plain);
  const detail = ok(get(core, saved.memory.id));
  const q = detail.qualification;
  assert.deepEqual(q, { ...qualification(), boundRevision: saved.memory.revision, contentDigest: digest(content),
    anchors: [{ receiptId: detail.receipts[0].id, receiptDigest: digest(content), start: 0, end: content.length,
      text: content, fields: qualification().anchors[0].fields }] });
  assert.equal(db.prepare('PRAGMA user_version').get().user_version, 14);
  assert.deepEqual(db.prepare('PRAGMA foreign_key_check').all(), []);
  assert.ok(!Object.keys(db.prepare('SELECT * FROM qualification_anchors').get()).includes('text'));
  for (const memory of ok(core.list({ namespace })).memories) assert.equal(Object.hasOwn(memory, 'qualification'), false);
  closeAll(); const cold = openMemoryCore({ path }); t.after(() => cold.close());
  assert.deepEqual(ok(get(cold, saved.memory.id)), detail);
});

test('S3 exact qualified dedup is immutable; absent metadata retains it through new receipts', (t) => {
  const { core, db } = fixture(t); const saved = ok(core.admit(input()));
  const before = snapshot(db); const original = ok(get(core, saved.memory.id)).qualification;
  assert.equal(ok(core.admit(input())).deduplicated, true); assert.deepEqual(snapshot(db), before);
  const reordered = qualification(); reordered.anchors[0].fields.reverse();
  assert.equal(ok(core.admit(input({ qualification: reordered }))).deduplicated, true);
  for (const patch of [
    { qualification: { ...qualification(), commitment: 'considered' } },
    { memory: { content: content.toUpperCase(), kind: 'fact' } },
    { receipts: [receipt('new-binding')] },
  ]) { const state = snapshot(db); error(core.admit(input(patch)), 'qualification_conflict'); assert.deepEqual(snapshot(db), state); }
  const plain = input({ receipts: [receipt('additional')] }); delete plain.qualification;
  const changed = ok(core.admit(plain)); assert.ok(changed.memory.revision > saved.memory.revision);
  assert.deepEqual(ok(get(core, saved.memory.id)).qualification, original);
  const legacyInput = input({ memory: { content: 'Synthetic unqualified record', kind: 'fact' } }); delete legacyInput.qualification;
  const legacy = ok(core.admit(legacyInput)); assert.equal(ok(get(core, legacy.memory.id)).qualification, null);
  const state = snapshot(db);
  error(core.admit({ ...legacyInput, qualification: qualification() }), 'qualification_conflict');
  assert.deepEqual(snapshot(db), state);
});

test('S1/S6 normalized receipts bind canonical UTF-16 slices; forged source and surrogate splits are rejected atomically', (t) => {
  const { core, db } = fixture(t);
  const canon = 'A🚋B'; const q = qualification(canon);
  q.anchors[0] = { ...q.anchors[0], start: 1, end: 3, text: '🚋' };
  const accepted = ok(core.admit(input({ receipts: [receipt('unicode', '  A🚋B  ')], qualification: q })));
  assert.equal(ok(get(core, accepted.memory.id)).qualification.anchors[0].text, '🚋');
  for (const anchor of [{ start: 1, end: 2, text: '\ud83d' }, { start: 2, end: 3, text: '\ude8b' },
    { start: 0, end: 1, text: 'Z' }, { receiptIndex: 1 }]) {
    const bad = structuredClone(q); Object.assign(bad.anchors[0], anchor);
    const state = snapshot(db);
    error(core.admit(input({ receipts: [receipt('unicode', canon)], qualification: bad })), 'invalid_input');
    assert.deepEqual(snapshot(db), state);
  }
});

test('S3/S6 inferred atomic commit, completed replay, expired leases and mixed-batch conflicts', (t) => {
  const { core, db, path, closeAll } = fixture(t); const token = claim(core);
  const saved = ok(finish(core, token, [item()])); const id = saved.memories[0].id;
  assert.equal(ok(get(core, id)).memory.origin, 'agent-inferred');
  const state = snapshot(db); error(finish(core, token, [item()]), 'stale_admission'); assert.deepEqual(snapshot(db), state);
  assert.deepEqual(ok(core.claimAdmission({ ...key(), leaseMs: 1000 })), { duplicate: true, memoryIds: [id], suppressedCount: 0 });
  const mixed = claim(core, 'mixed'); const before = snapshot(db);
  error(finish(core, mixed, [item({ content: 'Synthetic new claim' }), item({ qualification: { ...qualification(), value: 'blue tram' } })], 'mixed'), 'qualification_conflict');
  assert.deepEqual(snapshot(db), before);
  db.prepare("UPDATE admission_claims SET lease_expires_at=0 WHERE event_id='mixed'").run();
  const expired = snapshot(db); error(finish(core, mixed, [item()], 'mixed'), 'stale_admission'); assert.deepEqual(snapshot(db), expired);
  const fresh = claim(core, 'mixed'); assert.notEqual(fresh, mixed); ok(finish(core, fresh, [item()], 'mixed'));
  closeAll(); const cold = openMemoryCore({ path }); t.after(() => cold.close());
  assert.deepEqual(ok(cold.claimAdmission({ ...key(), leaseMs: 1000 })), { duplicate: true, memoryIds: [id], suppressedCount: 0 });
});

for (const stage of ['anchor', 'second-memory', 'completion']) test(`S6 real SQLite fault at ${stage} rolls back every table and leaves lease usable`, (t) => {
  const { core, db } = fixture(t); const token = claim(core); const before = snapshot(db);
  db.exec(stage === 'anchor' ? "CREATE TRIGGER qualification_fault BEFORE INSERT ON qualification_anchors BEGIN SELECT RAISE(ABORT,'synthetic'); END"
    : stage === 'second-memory' ? "CREATE TRIGGER qualification_fault BEFORE INSERT ON memories WHEN NEW.content='Synthetic second' BEGIN SELECT RAISE(ABORT,'synthetic'); END"
      : "CREATE TRIGGER qualification_fault BEFORE UPDATE ON admission_claims WHEN NEW.state='completed' BEGIN SELECT RAISE(ABORT,'synthetic'); END");
  error(finish(core, token, [item(), item({ content: 'Synthetic second' })]), 'storage_error');
  assert.deepEqual(snapshot(db), before); db.exec('DROP TRIGGER qualification_fault');
  assert.equal(ok(finish(core, token, [item(), item({ content: 'Synthetic second' })])).memories.length, 2);
  assert.equal(db.prepare('SELECT count(*) n FROM memory_qualifications').get().n, 2);
});

test('S4 filing and explicit history preserve bindings, historical correction stays forbidden and forgetting clears them', (t) => {
  const { core, db } = fixture(t);
  const qualified = qualification(); Object.assign(qualified.slot, { scope: 'commute', applies: 'recurring' });
  qualified.anchors[0].fields.push('scope', 'applies');
  let memory = ok(core.admit(input({ qualification: qualified }))).memory;
  const original = ok(get(core, memory.id)).qualification;
  ok(core.applyPlacement({ namespace, proposal: { items: [{ memoryId: memory.id, parentIds: [], newL1: { title: 'Synthetic transport', parentL2Ids: [] } }] },
    expectedMemoryRevisions: [{ memoryId: memory.id, revision: memory.revision }], expectedIndexRevision: ok(core.map({ namespace })).indexRevision }));
  memory = ok(get(core, memory.id)).memory; assert.deepEqual(ok(get(core, memory.id)).qualification, original);
  const nextContent = 'I choose a synthetic bus.';
  const nextQualification = structuredClone(qualified); nextQualification.value = 'synthetic bus';
  Object.assign(nextQualification.anchors[0], { text: nextContent, end: nextContent.length });
  const replacement = ok(core.admit(input({ memory: { content: nextContent, kind: 'fact' },
    receipts: [receipt('bus', nextContent)], qualification: nextQualification }))).memory;
  const slotId = ok(core.bindQualifiedClaim({ namespace, memoryId: memory.id,
    expectedRevision: memory.revision, slotId: null, singleClaim: true })).slotId;
  ok(core.bindQualifiedClaim({ namespace, memoryId: replacement.id,
    expectedRevision: replacement.revision, slotId, singleClaim: true }));
  assert.equal(ok(core.transitionQualified({ namespace,
    predecessor: { memoryId: memory.id, expectedRevision: memory.revision },
    replacement: { memoryId: replacement.id, expectedRevision: replacement.revision } })).status, 'applied');
  const history = ok(get(core, memory.id)); assert.equal(history.memory.state, 'historical'); assert.deepEqual(history.qualification, original);
  error(core.correct({ namespace, memoryId: memory.id, expectedRevision: history.memory.revision, content, kind: 'fact', receipt: receipt('correction') }), 'memory_historical');
  assert.deepEqual(ok(get(core, memory.id)).qualification, original);
  ok(core.forget({ namespace, memoryId: memory.id, expectedRevision: history.memory.revision }));
  error(get(core, memory.id), 'memory_not_found');
  assert.equal(db.prepare('SELECT count(*) n FROM qualification_anchors WHERE memory_id=?').get(memory.id).n, 0);
  assert.equal(ok(get(core, replacement.id)).qualification.value, 'synthetic bus');
});

for (const legacy of [false, true]) for (const action of ['correct', 'forget']) test(`S4 ${legacy ? 'legacy' : 'core'} ${action} clears metadata and inferred suppressed replay cannot restore it`, (t) => {
  const { core, db, path } = fixture(t); const saved = ok(finish(core, claim(core), [item()])).memories[0];
  if (legacy) {
    const store = openMemoryStore({ path }); t.after(() => store.close()); const scope = store.scope({ ownerId: namespace.ownerId });
    if (action === 'forget') scope.forget(saved.id, saved.revision);
    else scope.correct(saved.id, { content: 'Synthetic corrected note', kind: 'fact', origin: 'explicit', receipt: receipt('correction') }, saved.revision);
  } else if (action === 'forget') ok(core.forget({ namespace, memoryId: saved.id, expectedRevision: saved.revision }));
  else ok(core.correct({ namespace, memoryId: saved.id, expectedRevision: saved.revision, content: 'Synthetic corrected note', kind: 'fact', receipt: receipt('correction') }));
  assert.equal(db.prepare('SELECT count(*) n FROM memory_qualifications').get().n, 0);
  assert.equal(db.prepare('SELECT count(*) n FROM qualification_anchors').get().n, 0);
  assert.equal(ok(finish(core, claim(core, 'suppressed'), [item()], 'suppressed')).suppressedCount, 1);
  assert.equal(db.prepare('SELECT count(*) n FROM memory_qualifications').get().n, 0);
});

test('S5 receipt pagination toggles inspection without changing cursors, including off-page anchors and namespace isolation', (t) => {
  const { core } = fixture(t); const q = qualification(); q.anchors[0].receiptIndex = 1;
  const saved = ok(core.admit(input({ receipts: [receipt('first'), receipt('second')], qualification: q })));
  const plain = ok(core.get({ namespace, memoryId: saved.memory.id, receiptLimit: 1 }));
  const qualified = ok(get(core, saved.memory.id, { receiptLimit: 1 }));
  const { qualification: bound, ...rest } = qualified; assert.deepEqual(rest, plain);
  const next = ok(get(core, saved.memory.id, { receiptLimit: 1, receiptCursor: plain.nextReceiptCursor }));
  assert.deepEqual(next.qualification, bound);
  const back = ok(get(core, saved.memory.id, { receiptLimit: 1, receiptCursor: qualified.nextReceiptCursor, includeQualification: false }));
  assert.equal(Object.hasOwn(back, 'qualification'), false);
  for (const ns of [{ ...namespace, ownerId: 'foreign' }, { ...namespace, scope: 'project', projectId: 'other' }]) {
    error(get(core, saved.memory.id, { namespace: ns }), 'memory_not_found');
    const other = ok(core.admit(input({ namespace: ns })));
    assert.notEqual(other.memory.id, saved.memory.id);
    assert.notEqual(ok(get(core, other.memory.id, { namespace: ns })).qualification.anchors[0].receiptId, bound.anchors[0].receiptId);
  }
});

for (const corruption of ['content', 'receipt', 'receipt-role', 'receipt-client', 'digest', 'missing-anchor', 'foreign-anchor']) test(`S5 corrupted ${corruption} fails closed only on opted-in inspection`, (t) => {
  const { core, db } = fixture(t); const saved = ok(core.admit(input()));
  const before = ok(get(core, saved.memory.id));
  if (corruption === 'content') db.prepare('UPDATE memories SET content=? WHERE id=?').run('Synthetic tampered body', saved.memory.id);
  if (corruption === 'receipt') db.prepare('UPDATE receipts SET excerpt=? WHERE id=?').run('Synthetic tampered evidence', before.receipts[0].id);
  if (corruption === 'receipt-role') db.prepare('UPDATE receipts SET role=? WHERE id=?').run('assistant', before.receipts[0].id);
  if (corruption === 'receipt-client') db.prepare('UPDATE receipts SET client=? WHERE id=?').run('tampered-client', before.receipts[0].id);
  if (corruption === 'digest') db.prepare('UPDATE memory_qualifications SET content_digest=? WHERE memory_id=?').run('b'.repeat(64), saved.memory.id);
  if (corruption === 'missing-anchor') db.exec('DELETE FROM qualification_anchors');
  if (corruption === 'foreign-anchor') {
    const other = ok(core.admit(input({ namespace: { ...namespace, ownerId: 'foreign' } })));
    const foreign = ok(get(core, other.memory.id, { namespace: { ...namespace, ownerId: 'foreign' } }));
    db.prepare('UPDATE qualification_anchors SET receipt_id=? WHERE memory_id=?').run(foreign.receipts[0].id, saved.memory.id);
  }
  error(get(core, saved.memory.id), 'storage_error');
  ok(core.get({ namespace, memoryId: saved.memory.id }));
});

test('S6 malformed Unicode never crosses a qualified storage boundary', (t) => {
  const { core, db } = fixture(t);
  for (const lone of ['\ud800', '\udc00']) for (const field of ['subject', 'value', 'anchor', 'content', 'receipt']) {
    const bad = input();
    if (field === 'subject') bad.qualification.slot.subject = lone;
    if (field === 'value') bad.qualification.value = lone;
    if (field === 'anchor') { bad.receipts[0].excerpt = lone; Object.assign(bad.qualification.anchors[0], { text: lone, start: 0, end: 1 }); }
    if (field === 'content') bad.memory.content += lone;
    if (field === 'receipt') bad.receipts[0].excerpt += lone;
    const before = snapshot(db); error(core.admit(bad), 'invalid_input'); assert.deepEqual(snapshot(db), before);
  }
});

test('S4 same-content explicit correction deliberately clears original qualification', (t) => {
  const { core, db } = fixture(t); const saved = ok(core.admit(input()));
  ok(core.correct({ namespace, memoryId: saved.memory.id, expectedRevision: saved.memory.revision,
    content, kind: 'fact', receipt: receipt('same-content-correction') }));
  assert.equal(ok(get(core, saved.memory.id)).qualification, null);
  assert.equal(db.prepare('SELECT count(*) n FROM qualification_anchors').get().n, 0);
});

test('S1 duplicate canonical receipt bindings cannot disguise duplicate anchors as different receipt indices', (t) => {
  const { core, db } = fixture(t); const q = qualification();
  q.anchors.push({ ...structuredClone(q.anchors[0]), receiptIndex: 1 });
  const before = snapshot(db);
  error(core.admit(input({ receipts: [receipt(), receipt()], qualification: q })), 'invalid_input');
  assert.deepEqual(snapshot(db), before);
});

for (const action of ['correct', 'forget']) test(`S4 ${action} SQLite fault restores qualification and all original evidence atomically`, (t) => {
  const { core, db } = fixture(t); const saved = ok(core.admit(input())).memory;
  const before = snapshot(db); const detail = ok(get(core, saved.id));
  db.exec("CREATE TRIGGER qualification_lifecycle_fault BEFORE UPDATE ON memories BEGIN SELECT RAISE(ABORT,'synthetic'); END");
  const request = { namespace, memoryId: saved.id, expectedRevision: saved.revision };
  const run = () => action === 'correct' ? core.correct({ ...request, content: 'Synthetic corrected', kind: 'fact', receipt: receipt('correction') }) : core.forget(request);
  error(run(), 'storage_error'); assert.deepEqual(snapshot(db), before);
  assert.deepEqual(ok(get(core, saved.id)), detail);
  db.exec('DROP TRIGGER qualification_lifecycle_fault'); ok(run());
  assert.equal(db.prepare('SELECT count(*) n FROM memory_qualifications').get().n, 0);
  assert.equal(db.prepare('SELECT count(*) n FROM qualification_anchors').get().n, 0);
});

test('S5 stored duplicate resolved anchors are corruption, not two independent bindings', (t) => {
  const { core, db } = fixture(t); const q = qualification();
  q.anchors.push({ ...structuredClone(q.anchors[0]), start: 2, text: content.slice(2) });
  const saved = ok(core.admit(input({ qualification: q }))).memory;
  assert.equal(ok(get(core, saved.id)).qualification.anchors.length, 2);
  db.prepare('UPDATE qualification_anchors SET start=0 WHERE memory_id=? AND ordinal=1').run(saved.id);
  error(get(core, saved.id), 'storage_error');
});

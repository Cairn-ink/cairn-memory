import assert from 'node:assert/strict';
import test, { after, mock } from 'node:test';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { openMemoryCore } from '../contract.mjs';
import { createTestWorkspace } from '../../tools/testing/workspace.mjs';

// Prospective NR1–NR8 contract. No provider, default model or historical replay.
const fetchGuard = mock.method(globalThis, 'fetch', () => assert.fail('native fetch is forbidden'));
after(() => fetchGuard.mock.restore());
const ns = { ownerId: 'null-title-synthetic', scope: 'project', projectId: 'first' };
const foreign = { ...ns, projectId: 'other' };
const ok = r => { assert.equal(r.ok, true, JSON.stringify(r)); return r.value; };
const error = (r, code) => { assert.equal(r.ok, false, JSON.stringify(r)); assert.equal(r.error.code, code); };
const plain = value => JSON.parse(JSON.stringify(value));
const forbidden = () => assert.fail('cold read called a model port');
const source = (text, eventId = text) => ({ client: 'null-title-test', sessionId: 'session',
  eventId, role: 'user', excerpt: text });
const counterOnly = () => ({ contextWindow: 8192, countTokens: () => 1,
  extract: forbidden, classify: forbidden, select: forbidden, rank: forbidden });

function fixture(t, model = counterOnly()) {
  const workspace = createTestWorkspace(t, { prefix: 'cairn-null-title-' });
  const path = join(workspace.path, 'memory.sqlite');
  const core = openMemoryCore({ path, model }); workspace.defer(() => core.close());
  const db = new DatabaseSync(path); workspace.defer(() => db.close());
  return { core, db, model, peer() {
    const peer = openMemoryCore({ path, model: counterOnly() });
    workspace.defer(() => peer.close());
    return peer;
  }, cold() {
    core.close();
    const cold = openMemoryCore({ path, model: counterOnly() });
    workspace.defer(() => cold.close());
    return cold;
  } };
}
const detail = (core, id, namespace = ns) => ok(core.get({ namespace, memoryId: id }));
const map = (core, purpose = 'classification', namespace = ns) =>
  ok(core.map({ namespace, purpose, limit: 100 }));
function admit(core, text, namespace = ns) {
  return ok(core.admit({ namespace, memory: { content: text, kind: 'instruction' },
    receipts: [source(text)] })).memory;
}
function placementInput(core, items, namespace = ns) {
  return { namespace, proposal: { items }, expectedMemoryRevisions: items.map(({ memoryId }) =>
    ({ memoryId, revision: detail(core, memoryId, namespace).memory.revision })),
  expectedIndexRevision: map(core, 'classification', namespace).indexRevision };
}
const place = (core, items, namespace = ns) => core.applyPlacement(placementInput(core, items, namespace));
const proposed = (memoryId, title, parentL2Ids = [], newL2Title) => ({ memoryId, parentIds: [],
  newL1: { title, parentL2Ids, ...(newL2Title ? { newL2Title } : {}) } });
function topic(core, memory, title, parentTitle, namespace = ns) {
  const result = ok(place(core, [proposed(memory.id, title, [], parentTitle)], namespace));
  return { result, l1: result.createdMocs.find(m => m.level === 'L1'),
    l2: result.createdMocs.find(m => m.level === 'L2') };
}
function hide(core, memory, action = 'correct') {
  const current = detail(core, memory.id).memory;
  assert.equal(typeof current.content, 'string');
  assert.ok(current.content.length > 0);
  const revision = current.revision;
  if (action === 'forget') ok(core.forget({ namespace: ns, memoryId: memory.id, expectedRevision: revision }));
  else ok(core.correct({ namespace: ns, memoryId: memory.id, expectedRevision: revision,
    content: `Changed ${current.content}`, kind: 'instruction', receipt: source(`Changed ${current.content}`) }));
}
const rows = (db, table, order) => plain(db.prepare(`SELECT * FROM ${table} ORDER BY ${order}`).all());
const group = (db, id) => plain(db.prepare('SELECT * FROM mocs WHERE id=?').get(id));
const titleBindings = (db, id) => plain(db.prepare(
  'SELECT * FROM moc_title_sources WHERE moc_id=? ORDER BY memory_id').all(id));
function identity(db, id) {
  const { revision, updated_at, ...immutable } = group(db, id);
  return { immutable, sources: titleBindings(db, id) };
}
function state(db) {
  return Object.fromEntries([
    ['memories', 'id'], ['receipts', 'id'], ['mocs', 'id'],
    ['moc_title_sources', 'moc_id,memory_id'], ['moc_memory_refs', 'moc_id,memory_id'],
    ['moc_edges', 'parent_id,child_id'], ['namespace_epochs', 'owner_id,scope,project_id'],
    ['rationale_edges', 'from_id,to_id,relation'],
  ].map(([table, order]) => [table, rows(db, table, order)]));
}
function nullLabel(core, id) {
  const page = map(core);
  assert.equal(page.exhausted, true);
  const item = page.items.find(item => item.type === 'moc' && item.moc.id === id);
  assert.ok(item, 'retained same-namespace identity must be in the public catalog');
  assert.equal(item.moc.title, null);
  assert.equal(Object.hasOwn(item.moc, 'titleSources'), false);
}
function refsCurrent(db, result) {
  for (const ref of result.refs) {
    assert.equal(ref.parentRevision, group(db, ref.parentId).revision);
    const child = ref.childType === 'moc' ? group(db, ref.childId)
      : db.prepare('SELECT revision FROM memories WHERE id=?').get(ref.childId);
    assert.equal(ref.childRevision, child.revision);
  }
}
function link(core, db, parentId, childId) {
  return ok(core.linkMocs({ namespace: ns, parentId, childId,
    expectedParentRevision: group(db, parentId).revision,
    expectedChildRevision: group(db, childId).revision,
    expectedIndexRevision: map(core).indexRevision }));
}
function rebuild(core) {
  const expectedIndexRevision = map(core).indexRevision;
  let cursor;
  for (;;) {
    const result = ok(core.rebuildIndex({ namespace: ns, expectedIndexRevision, limit: 500,
      ...(cursor ? { cursor } : {}) }));
    if (result.exhausted) { assert.equal(result.state, 'published'); return result; }
    assert.ok(result.nextCursor); cursor = result.nextCursor;
  }
}

for (const action of ['correct', 'forget']) test(`NR1/2 ${action}: repeated NULL L1 reuse preserves original identity and label sources`, t => {
  const f = fixture(t);
  const original = admit(f.core, 'Original diagram instruction.');
  const g = topic(f.core, original, 'Review diagrams', 'Engineering');
  hide(f.core, original, action);
  nullLabel(f.core, g.l1.id); nullLabel(f.core, g.l2.id);
  const stable = [identity(f.db, g.l1.id), identity(f.db, g.l2.id)];
  const edges = rows(f.db, 'moc_edges', 'parent_id,child_id').map(({ parent_revision, child_revision, ...pair }) => pair);
  for (const [index, title] of ['Ｒｅｖｉｅｗ diagrams', 'REVIEW DIAGRAMS'].entries()) {
    const fresh = admit(f.core, `Fresh diagram instruction ${index}.`);
    const receipts = detail(f.core, fresh.id).receipts;
    const before = group(f.db, g.l1.id);
    const parentBefore = group(f.db, g.l2.id);
    const epochBefore = map(f.core).indexRevision;
    const result = ok(place(f.core, [proposed(fresh.id, title)]));
    assert.equal(result.indexRevision, epochBefore + 1);
    assert.deepEqual(result.createdMocs, [], 'reused groups are not newly created DTOs');
    assert.equal(group(f.db, g.l1.id).revision, before.revision + 1);
    assert.deepEqual(group(f.db, g.l2.id), parentBefore, 'membership does not bump an ancestor');
    assert.deepEqual(detail(f.core, fresh.id).receipts, receipts);
    assert.deepEqual(detail(f.core, fresh.id).placements, [{ mocId: g.l1.id,
      mocRevision: before.revision + 1, title: null }]);
    refsCurrent(f.db, result); nullLabel(f.core, g.l1.id);
    assert.deepEqual([identity(f.db, g.l1.id), identity(f.db, g.l2.id)], stable);
  }
  assert.deepEqual(rows(f.db, 'moc_edges', 'parent_id,child_id').map(({ parent_revision, child_revision, ...pair }) => pair), edges);
  const recall = map(f.core, 'recall');
  for (const id of [g.l1.id, g.l2.id]) assert.ok(recall.items.some(i => i.type === 'moc' && i.moc.id === id),
    'fresh membership makes retained ancestors navigable without restoring labels');
  rebuild(f.core); nullLabel(f.core, g.l1.id); nullLabel(f.core, g.l2.id);
  const cold = f.cold(); nullLabel(cold, g.l1.id); nullLabel(cold, g.l2.id);
  assert.deepEqual([identity(f.db, g.l1.id), identity(f.db, g.l2.id)], stable);
});

test('NR1/2 FULLNULL includes a nonempty multisource group when only one original source is invalid', t => {
  const f = fixture(t);
  const original = [admit(f.core, 'Original first member.'), admit(f.core, 'Original second member.')];
  const initial = ok(place(f.core, original.map(m => proposed(m.id, 'Shared diagrams', [], 'Shared engineering'))));
  const [l1, l2] = ['L1', 'L2'].map(level => initial.createdMocs.find(m => m.level === level));
  hide(f.core, original[0]);
  assert.equal(detail(f.core, original[1].id).memory.filing.status, 'filed');
  nullLabel(f.core, l1.id); nullLabel(f.core, l2.id);
  const stable = [identity(f.db, l1.id), identity(f.db, l2.id)];
  assert.equal(stable[0].sources.length, 2); assert.equal(stable[1].sources.length, 2);
  const fresh = admit(f.core, 'Third member with fresh evidence.');
  const result = ok(place(f.core, [proposed(fresh.id, 'shared diagrams', [], 'SHARED ENGINEERING')]));
  assert.deepEqual(result.createdMocs, []);
  assert.deepEqual([identity(f.db, l1.id), identity(f.db, l2.id)], stable);
  assert.equal(f.db.prepare('SELECT count(*) n FROM moc_memory_refs WHERE moc_id=?').get(l1.id).n, 2);
  assert.equal(f.db.prepare('SELECT count(*) n FROM moc_edges WHERE parent_id=? AND child_id=?').get(l2.id, l1.id).n, 1);
  refsCurrent(f.db, result); rebuild(f.core);
  const cold = f.cold(); nullLabel(cold, l1.id); nullLabel(cold, l2.id);
  assert.equal(detail(cold, fresh.id).placements[0].title, null);
});

test('NR2/4 a fresh L1 can reuse NULL L2 without changing its original label provenance', t => {
  const f = fixture(t), original = admit(f.core, 'First branch source.');
  const old = topic(f.core, original, 'First branch', 'Engineering'); hide(f.core, original);
  const stable = identity(f.db, old.l2.id), parent = group(f.db, old.l2.id);
  const fresh = admit(f.core, 'Second branch source.');
  const result = ok(place(f.core, [proposed(fresh.id, 'Second branch', [], 'Ｅｎｇｉｎｅｅｒｉｎｇ')]));
  assert.equal(result.createdMocs.length, 1); assert.equal(result.createdMocs[0].level, 'L1');
  assert.equal(result.createdMocs[0].revision, 1);
  assert.equal(group(f.db, old.l2.id).revision, parent.revision + 1);
  assert.deepEqual(identity(f.db, old.l2.id), stable); nullLabel(f.core, old.l2.id);
  assert.equal(f.db.prepare('SELECT count(*) n FROM moc_edges WHERE parent_id=?').get(old.l2.id).n, 2);
  refsCurrent(f.db, result);
});

test('NR3/4 aliases and explicit IDs coalesce, replace memberships and preserve a true no-op', t => {
  const f = fixture(t), original = admit(f.core, 'Original alias source.');
  const hidden = topic(f.core, original, 'Diagrams', 'Engineering'); hide(f.core, original);
  const a = admit(f.core, 'Alias contributor A.'), b = admit(f.core, 'Alias contributor B.');
  const other = topic(f.core, a, 'Previously filed elsewhere');
  const before = group(f.db, hidden.l1.id), otherBefore = group(f.db, other.l1.id);
  const memoryRevisions = [a, b].map(m => detail(f.core, m.id).memory.revision);
  const items = [a, b].map((m, i) => ({ ...proposed(m.id, i ? 'DIAGRAMS' : 'Ｄｉａｇｒａｍｓ'),
    parentIds: [hidden.l1.id] }));
  const result = ok(place(f.core, items));
  assert.deepEqual(result.createdMocs, []);
  assert.equal(group(f.db, hidden.l1.id).revision, before.revision + 1);
  assert.equal(group(f.db, other.l1.id).revision, otherBefore.revision + 1);
  assert.equal(detail(f.core, a.id).memory.revision, memoryRevisions[0]);
  assert.equal(detail(f.core, b.id).memory.revision, memoryRevisions[1] + 1);
  for (const m of [a, b]) assert.deepEqual(detail(f.core, m.id).placements.map(p => p.mocId), [hidden.l1.id]);
  refsCurrent(f.db, result);
  const snapshot = state(f.db), epoch = map(f.core).indexRevision;
  const noOp = ok(place(f.core, items));
  assert.deepEqual(noOp.createdMocs, []); assert.equal(noOp.indexRevision, epoch);
  assert.deepEqual(state(f.db), snapshot, 'all revisions, timestamps, label bindings and epoch remain exact');
  refsCurrent(f.db, noOp);
});

for (const count of [3, 4]) test(`NR3 coalesced NULL L1 union of ${count} submitted existing L2 IDs`, t => {
  const f = fixture(t), original = admit(f.core, 'Parent bound source.');
  const hidden = topic(f.core, original, 'Combined'); hide(f.core, original);
  const parents = Array.from({ length: 4 }, (_, i) => topic(f.core,
    admit(f.core, `Parent ${i} source.`), `Child ${i}`, `Parent ${i}`).l2.id);
  const fresh = [admit(f.core, 'Combined A.'), admit(f.core, 'Combined B.')];
  const items = fresh.map((m, i) => proposed(m.id, i ? 'COMBINED' : 'Combined',
    i ? parents.slice(2, count) : parents.slice(0, 2)));
  const before = state(f.db), versions = parents.map(id => group(f.db, id).revision);
  if (count === 4) { error(place(f.core, items), 'invalid_input'); assert.deepEqual(state(f.db), before); }
  else {
    const result = ok(place(f.core, items)); assert.deepEqual(result.createdMocs, []);
    assert.equal(f.db.prepare('SELECT count(*) n FROM moc_edges WHERE child_id=?').get(hidden.l1.id).n, 3);
    for (let i = 0; i < 4; i++) assert.equal(group(f.db, parents[i]).revision, versions[i] + Number(i < 3));
    refsCurrent(f.db, result);
  }
});

test('NR3 inherited degree is retained; three explicit parents plus one NULL-title L2 request are distinct', t => {
  const f = fixture(t), original = admit(f.core, 'Inherited branch source.');
  const hidden = topic(f.core, original, 'Inherited branch'); hide(f.core, original);
  const parents = Array.from({ length: 4 }, (_, i) => topic(f.core,
    admit(f.core, `Ancestor ${i} source.`), `Ancestor child ${i}`, `Ancestor ${i}`));
  for (const p of parents) link(f.core, f.db, p.l2.id, hidden.l1.id);
  hide(f.core, detail(f.core, f.db.prepare('SELECT memory_id FROM moc_title_sources WHERE moc_id=?').get(parents[3].l2.id).memory_id).memory);
  const parentRows = parents.map(p => group(f.db, p.l2.id));
  const fresh = admit(f.core, 'Fresh inherited branch member.');
  const result = ok(place(f.core, [proposed(fresh.id, 'INHERITED BRANCH',
    parents.slice(0, 3).map(p => p.l2.id), 'Ancestor 3')]));
  assert.deepEqual(result.createdMocs, []);
  assert.equal(f.db.prepare('SELECT count(*) n FROM moc_edges WHERE child_id=?').get(hidden.l1.id).n, 4);
  assert.deepEqual(parents.map(p => group(f.db, p.l2.id)), parentRows, 'already-present edges never bump parents');
  refsCurrent(f.db, result);
});

test('NR4 combined membership and a new parent edge bump each existing group once; repeat is inert', t => {
  const f = fixture(t), original = admit(f.core, 'Combined changes source.');
  const hidden = topic(f.core, original, 'Combined changes'); hide(f.core, original);
  const parent = topic(f.core, admit(f.core, 'Parent source.'), 'Parent child', 'Parent');
  const a = admit(f.core, 'Combined change A.'), b = admit(f.core, 'Combined change B.');
  const childBefore = group(f.db, hidden.l1.id), parentBefore = group(f.db, parent.l2.id);
  const epochBefore = map(f.core).indexRevision;
  const items = [a, b].map(m => proposed(m.id, 'COMBINED CHANGES', [parent.l2.id]));
  const result = ok(place(f.core, items));
  assert.equal(group(f.db, hidden.l1.id).revision, childBefore.revision + 1);
  assert.equal(group(f.db, parent.l2.id).revision, parentBefore.revision + 1);
  assert.equal(result.indexRevision, epochBefore + 1);
  refsCurrent(f.db, result);
  const snapshot = state(f.db);
  const noOp = ok(place(f.core, items)); assert.equal(noOp.indexRevision, result.indexRevision);
  assert.deepEqual(state(f.db), snapshot); refsCurrent(f.db, noOp);
});

test('NR1/5 visible collisions, namespace/level and stale guards retain atomic refusal', t => {
  const f = fixture(t), original = admit(f.core, 'Visible source.');
  const visible = topic(f.core, original, 'Visible', 'Visible parent');
  const hiddenSource = admit(f.core, 'Hidden source.');
  const hidden = topic(f.core, hiddenSource, 'Hidden'); hide(f.core, hiddenSource);
  const staleEpoch = map(f.core).indexRevision;
  assert.ok(Number.isSafeInteger(staleEpoch) && staleEpoch >= 1, 'stale guard must first be a valid positive epoch');
  const fresh = admit(f.core, 'Guarded source.');
  const foreignSource = admit(f.core, 'Foreign source.', foreign);
  const foreignGroup = topic(f.core, foreignSource, 'Hidden', undefined, foreign).l1;
  assert.ok(map(f.core).indexRevision > staleEpoch, 'normal admission makes the captured epoch stale');
  const cases = [
    [placementInput(f.core, [proposed(fresh.id, 'VISIBLE')]), 'moc_title_conflict'],
    [placementInput(f.core, [proposed(fresh.id, 'Hidden', [foreignGroup.id])]), 'moc_not_found'],
    [placementInput(f.core, [{ memoryId: fresh.id, parentIds: [visible.l2.id] }]), 'invalid_ref'],
    [{ ...placementInput(f.core, [proposed(fresh.id, 'Hidden')]), expectedIndexRevision: staleEpoch }, 'index_revision_conflict'],
    [{ ...placementInput(f.core, [proposed(fresh.id, 'Hidden')]),
      expectedMemoryRevisions: [{ memoryId: fresh.id, revision: 99 }] }, 'revision_conflict'],
  ];
  const before = state(f.db);
  for (const [input, code] of cases) { error(f.core.applyPlacement(input), code); assert.deepEqual(state(f.db), before); }
  nullLabel(f.core, hidden.l1.id);
  assert.equal(map(f.core).items.some(i => i.type === 'moc' && i.moc.id === foreignGroup.id), false);
});

test('NR1/5 a fresh L1 cannot reuse an already visible canonical L2 title', t => {
  const f = fixture(t), original = admit(f.core, 'Visible parent label source.');
  const visible = topic(f.core, original, 'Original visible-parent child', 'Visible parent');
  const freshText = 'Distinct unfiled child source.';
  const fresh = admit(f.core, freshText);
  const requestedL1 = 'Distinct visible-parent child', requestedL2 = 'VISIBLE PARENT';
  const key = title => title.normalize('NFKC').toLocaleLowerCase('und');
  const matching = (level, title) => f.db.prepare(`SELECT * FROM mocs
    WHERE owner_id = ? AND scope = ? AND project_id = ? AND level = ? AND canonical_title = ?`)
    .all(ns.ownerId, ns.scope, ns.projectId, level, key(title));
  assert.deepEqual(matching(1, requestedL1), [], 'the requested L1 must not exist before refusal');
  const parents = matching(2, requestedL2);
  assert.equal(parents.length, 1);
  assert.equal(parents[0].id, visible.l2.id);
  assert.equal(parents[0].title, 'Visible parent');
  const catalogBefore = map(f.core);
  assert.equal(catalogBefore.exhausted, true);
  assert.equal(catalogBefore.items.some(item => item.type === 'moc' && item.moc.level === 'L1'
    && typeof item.moc.title === 'string' && key(item.moc.title) === key(requestedL1)), false);
  const parent = catalogBefore.items.find(item => item.type === 'moc' && item.moc.id === visible.l2.id);
  assert.ok(parent, 'the same-namespace L2 must be present in the public catalog');
  assert.equal(parent.moc.level, 'L2');
  assert.equal(parent.moc.title, 'Visible parent', 'the existing L2 label must still be visible');
  const originalBefore = detail(f.core, original.id), freshBefore = detail(f.core, fresh.id);
  assert.equal(originalBefore.receipts.length, 1);
  assert.equal(originalBefore.receipts[0].excerpt, 'Visible parent label source.');
  assert.equal(freshBefore.memory.content, freshText);
  assert.equal(freshBefore.receipts.length, 1);
  assert.equal(freshBefore.receipts[0].excerpt, freshText);
  assert.deepEqual(freshBefore.placements, []);
  const before = state(f.db);
  const provenance = [identity(f.db, visible.l1.id), identity(f.db, visible.l2.id)];
  error(place(f.core, [proposed(fresh.id, requestedL1, [], requestedL2)]), 'moc_title_conflict');
  assert.deepEqual(state(f.db), before);
  assert.deepEqual(detail(f.core, original.id), originalBefore);
  assert.deepEqual(detail(f.core, fresh.id), freshBefore);
  assert.equal(map(f.core).indexRevision, catalogBefore.indexRevision);
  assert.deepEqual(map(f.core), catalogBefore);
  assert.deepEqual([identity(f.db, visible.l1.id), identity(f.db, visible.l2.id)], provenance);
});

test('NR1/5 resolution is namespace and level specific, never a global title lookup', t => {
  const f = fixture(t), sourceMemory = admit(f.core, 'Namespace original.');
  const hidden = topic(f.core, sourceMemory, 'Boundary'); hide(f.core, sourceMemory);
  const elsewhere = admit(f.core, 'Other namespace original.', foreign);
  const foreignGroup = topic(f.core, elsewhere, 'Boundary', undefined, foreign).l1;
  const fresh = admit(f.core, 'Namespace fresh.');
  const applied = ok(place(f.core, [proposed(fresh.id, 'BOUNDARY')]));
  assert.deepEqual(applied.createdMocs, []);
  assert.deepEqual(detail(f.core, fresh.id).placements.map(p => p.mocId), [hidden.l1.id]);
  assert.equal(map(f.core, 'classification', foreign).items.find(i => i.type === 'moc').moc.title, 'Boundary');
  assert.equal(group(f.db, foreignGroup.id).revision, 1);
  const next = admit(f.core, 'Different level fresh.');
  const differentLevel = ok(place(f.core, [proposed(next.id, 'Distinct child', [], 'Boundary')]));
  const l2 = differentLevel.createdMocs.find(m => m.level === 'L2');
  assert.ok(l2); assert.notEqual(l2.id, hidden.l1.id); assert.equal(l2.title, 'Boundary');
  nullLabel(f.core, hidden.l1.id);
});

test('NR5 historical and deleted memories cannot use the NULL collision exception', t => {
  const f = fixture(t), original = admit(f.core, 'Eligibility original.');
  const hidden = topic(f.core, original, 'Eligibility'); hide(f.core, original);
  const old = admit(f.core, 'Now historical.');
  ok(f.core.supersede({ namespace: ns, memoryId: old.id, expectedRevision: old.revision,
    replacement: { content: 'Current replacement.', kind: 'instruction' }, receipts: [source('Replacement source.')] }));
  const gone = admit(f.core, 'Now deleted.');
  ok(f.core.forget({ namespace: ns, memoryId: gone.id, expectedRevision: gone.revision }));
  const before = state(f.db), epoch = map(f.core).indexRevision;
  for (const memory of [old, gone]) error(f.core.applyPlacement({ namespace: ns,
    proposal: { items: [proposed(memory.id, 'Eligibility')] },
    expectedMemoryRevisions: [{ memoryId: memory.id, revision: memory.revision }],
    expectedIndexRevision: epoch }), 'memory_not_found');
  assert.deepEqual(state(f.db), before); nullLabel(f.core, hidden.l1.id);
});

for (const table of ['moc_memory_refs', 'moc_edges']) test(`NR5 late ${table} SQL fault rolls back reuse, revisions and rationale`, async t => {
  const model = { ...counterOnly(), relate: () => ({ edges: [{ from: 1, to: 0,
    relation: 'supports-decision', fromReceipt: 0, toReceipt: 0 }] }) };
  const f = fixture(t, model), original = admit(f.core, 'Rollback hidden source.');
  const hidden = topic(f.core, original, 'Rollback hidden'); hide(f.core, original);
  const parent = topic(f.core, admit(f.core, 'Rollback parent source.'), 'Rollback parent child', 'Rollback parent');
  const a = admit(f.core, 'Decision for rollback.'), b = admit(f.core, 'Premise for rollback.');
  assert.equal(ok(await f.core.reviewRationale({ namespace: ns,
    refs: [a, b].map(m => ({ memoryId: m.id, revision: m.revision })) })).inserted, 1);
  assert.equal(rows(f.db, 'rationale_edges', 'from_id,to_id,relation').length, 1);
  nullLabel(f.core, hidden.l1.id);
  f.db.exec(`CREATE TRIGGER null_title_late_fault BEFORE INSERT ON ${table}
    BEGIN SELECT RAISE(ABORT,'synthetic_late_fault'); END;`);
  const before = state(f.db);
  error(place(f.core, [proposed(a.id, 'ROLLBACK HIDDEN', [parent.l2.id])]), 'storage_error');
  assert.deepEqual(state(f.db), before);
  assert.equal(detail(f.core, a.id).memory.filing.status, 'unfiled');
  assert.equal(detail(f.core, a.id).receipts.length, 1);
});

const batch = (eventId, texts) => ({ namespace: ns, client: 'null-title-capture',
  eventId, sessionId: 'session', messages: texts.map((content, i) => ({ id: `${eventId}-${i}`, role: 'user', content })) });
function captureModel() {
  const calls = [], requests = [];
  const model = { contextWindow: 8192, countTokens: () => 1, calls, requests, failClassification: false,
    extract: ({ input }) => { calls.push('extract'); return { items: input.messages.map((m, i) =>
      ({ content: m.content, kind: 'instruction', confidence: 0.9, sourceIndices: [i] })) }; },
    classify: ({ input }) => { calls.push('classify'); requests.push(plain(input));
      model.beforePlacement?.(input);
      if (model.failClassification) throw new Error('synthetic initial failure');
      return { items: input.memories.map(m => proposed(m.id, 'Capture diagrams')) }; },
  };
  return model;
}
const inspect = (core, eventId) => ok(core.inspectAdmission({ namespace: ns,
  client: 'null-title-capture', eventId, includeInitialClassification: true }));
const journal = (db, eventId) => plain(db.prepare('SELECT * FROM capture_initial_classification WHERE event_id=?').get(eventId));

test('NR6 initial NULL reuse applies atomically, cold inspection and exact replay preserve attribution', async t => {
  const model = captureModel(), f = fixture(t, model);
  const first = ok(await f.core.capture(batch('first', ['First capture instruction.'])));
  const id = first.admission.memories[0].id;
  assert.equal(first.classification.status, 'applied');
  const old = map(f.core).items.find(i => i.type === 'moc').moc; hide(f.core, detail(f.core, id).memory);
  const stable = identity(f.db, old.id), secondInput = batch('second', ['Second capture instruction.']);
  const second = ok(await f.core.capture(secondInput));
  assert.equal(second.admission.memories.length, 1);
  assert.equal(model.requests[1].mapExhausted, true);
  assert.deepEqual(model.requests[1].map.map(i => i.moc.title), [null]);
  const admitted = second.admission.memories[0].id;
  assert.equal(detail(f.core, admitted).receipts[0].excerpt, secondInput.messages[0].content);
  assert.equal(second.classification.status, 'applied', JSON.stringify(second.classification));
  assert.equal(inspect(f.core, 'second').initialClassification.status, 'applied');
  const originalJournal = journal(f.db, 'second'), calls = [...model.calls];
  assert.equal(ok(await f.core.capture(secondInput)).duplicate, true); assert.deepEqual(model.calls, calls);
  assert.deepEqual(journal(f.db, 'second'), originalJournal); assert.deepEqual(identity(f.db, old.id), stable);
  const cold = f.cold(); assert.equal(inspect(cold, 'second').initialClassification.status, 'applied');
  assert.equal(detail(cold, admitted).placements[0].title, null); nullLabel(cold, old.id);
});

test('NR5/6 initial completion fault rolls back reuse while preserving durable admission and failed attempt', async t => {
  const model = captureModel(), f = fixture(t, model);
  const original = admit(f.core, 'Completion rollback original.');
  const hidden = topic(f.core, original, 'Capture diagrams'); hide(f.core, original);
  const beforeGroup = group(f.db, hidden.l1.id), stable = identity(f.db, hidden.l1.id);
  model.relate = () => ({ edges: [{ from: 1, to: 0, relation: 'supports-decision', fromReceipt: 0, toReceipt: 0 }] });
  const rationaleMembers = [admit(f.core, 'Completion decision.'), admit(f.core, 'Completion premise.')];
  assert.equal(ok(await f.core.reviewRationale({ namespace: ns,
    refs: rationaleMembers.map(m => ({ memoryId: m.id, revision: m.revision })) })).inserted, 1);
  let prePlacementState, prePlacementEpoch;
  model.beforePlacement = input => {
    assert.equal(input.memories.length, 1);
    assert.equal(detail(f.core, input.memories[0].id).memory.filing.status, 'unfiled');
    prePlacementState = state(f.db); prePlacementEpoch = map(f.core).indexRevision;
    assert.equal(prePlacementState.rationale_edges.length, 1);
  };
  f.db.exec(`CREATE TRIGGER null_title_completion_fault BEFORE UPDATE ON capture_initial_classification
    WHEN NEW.status='applied' BEGIN SELECT RAISE(ABORT,'synthetic_completion_fault'); END;`);
  const result = ok(await f.core.capture(batch('completion-fault', ['Completion rollback fresh.'])));
  assert.deepEqual(result.classification, { status: 'failed', error: { code: 'storage_error', retryable: false } });
  const id = result.admission.memories[0].id;
  assert.equal(detail(f.core, id).memory.filing.status, 'unfiled');
  assert.equal(detail(f.core, id).receipts.length, 1);
  assert.deepEqual(group(f.db, hidden.l1.id), beforeGroup); assert.deepEqual(identity(f.db, hidden.l1.id), stable);
  assert.equal(inspect(f.core, 'completion-fault').initialClassification.status, 'failed');
  assert.deepEqual(rows(f.db, 'moc_memory_refs', 'moc_id,memory_id'), []);
  assert.ok(prePlacementState, 'baseline is observed outside the placement transaction after admission');
  assert.equal(map(f.core).indexRevision, prePlacementEpoch);
  assert.deepEqual(state(f.db), prePlacementState, 'completion abort rolls back every placement/epoch/rationale delta');
});

test('NR6 later manual reuse never rewrites a failed initial attempt', async t => {
  const model = captureModel(), f = fixture(t, model);
  const original = admit(f.core, 'Manual recovery original.');
  const hidden = topic(f.core, original, 'Capture diagrams'); hide(f.core, original);
  model.failClassification = true;
  const input = batch('manual-recovery', ['Manual recovery fresh.']);
  const result = ok(await f.core.capture(input)); assert.equal(result.classification.status, 'failed');
  const id = result.admission.memories[0].id, initial = journal(f.db, 'manual-recovery');
  const receipts = detail(f.core, id).receipts, calls = [...model.calls];
  ok(place(f.core, [proposed(id, 'Capture diagrams')]));
  assert.deepEqual(journal(f.db, 'manual-recovery'), initial);
  assert.deepEqual(detail(f.core, id).receipts, receipts);
  assert.equal(detail(f.core, id).placements[0].mocId, hidden.l1.id);
  assert.equal(ok(await f.core.capture(input)).duplicate, true); assert.deepEqual(model.calls, calls);
  const cold = f.cold(); assert.equal(detail(cold, id).memory.filing.status, 'filed');
  assert.equal(journal(f.db, 'manual-recovery').status, 'failed');
  // Filing changes the original bound revision; the public old-attempt view is not rewritten to applied.
  assert.equal(inspect(cold, 'manual-recovery').initialClassification.status, 'unknown');
});

test('NR6 mixed dedup batch keeps original members and receipts without rewriting earlier attempt', async t => {
  const model = captureModel(), f = fixture(t, model);
  const firstInput = batch('dedup-first', ['Repeated capture instruction.']);
  const first = ok(await f.core.capture(firstInput)); assert.equal(first.classification.status, 'applied');
  const originalId = first.admission.memories[0].id, firstJournal = journal(f.db, 'dedup-first');
  const secondInput = batch('dedup-second', ['Repeated capture instruction.', 'Distinct capture instruction.']);
  const second = ok(await f.core.capture(secondInput));
  assert.equal(second.admission.memories.length, 2);
  assert.ok(second.admission.memories.some(m => m.id === originalId));
  assert.equal(detail(f.core, originalId).receipts.length, 2);
  assert.equal(second.classification.status, 'applied', JSON.stringify(second.classification));
  assert.deepEqual(journal(f.db, 'dedup-first'), firstJournal);
  assert.deepEqual(inspect(f.core, 'dedup-second').members.map(m => m.memoryId).sort(),
    second.admission.memories.map(m => m.id).sort());
  const calls = [...model.calls]; assert.equal(ok(await f.core.capture(secondInput)).duplicate, true);
  assert.deepEqual(model.calls, calls);
  const cold = f.cold();
  assert.equal(inspect(cold, 'dedup-first').members.length, 1);
  assert.equal(inspect(cold, 'dedup-first').members[0].memoryId, originalId);
  assert.equal(inspect(cold, 'dedup-second').initialClassification.status, 'applied');
  assert.deepEqual(journal(f.db, 'dedup-first'), firstJournal);
  for (const memory of second.admission.memories) {
    const stored = detail(cold, memory.id);
    assert.ok(stored.receipts.some(r => secondInput.messages.some(m =>
      r.eventId === m.id && r.role === m.role && r.excerpt === m.content)));
    assert.equal(stored.placements[0].title, null);
  }
});

for (const action of ['correct', 'forget']) test(`NR5 second connection ${action} invalidates a NULL-reuse proposal atomically`, async t => {
  const model = captureModel(), f = fixture(t, model);
  const original = admit(f.core, 'Peer original.');
  const hidden = topic(f.core, original, 'Capture diagrams'); hide(f.core, original);
  const fresh = admit(f.core, 'Peer fresh.');
  const classified = ok(await f.core.classifyPlacement({ namespace: ns, memoryIds: [fresh.id],
    expectedMemoryRevisions: [{ memoryId: fresh.id, revision: fresh.revision }], mapRevision: map(f.core).indexRevision }));
  assert.equal(model.requests[0].map[0].moc.title, null);
  const peer = f.peer();
  if (action === 'correct') ok(peer.correct({ namespace: ns, memoryId: fresh.id,
    expectedRevision: fresh.revision, content: 'Peer changed fresh.', kind: 'instruction', receipt: source('Peer change.') }));
  else ok(peer.forget({ namespace: ns, memoryId: fresh.id, expectedRevision: fresh.revision }));
  const afterPeer = state(f.db), epoch = map(f.core).indexRevision;
  assert.ok(epoch > classified.basedOn.indexRevision);
  const input = { namespace: ns, proposal: classified.proposal,
    expectedMemoryRevisions: classified.basedOn.memoryRevisions,
    expectedIndexRevision: classified.basedOn.indexRevision };
  error(f.core.applyPlacement(input), 'index_revision_conflict');
  error(f.core.applyPlacement({ ...input, expectedIndexRevision: epoch }),
    action === 'correct' ? 'revision_conflict' : 'memory_not_found');
  assert.deepEqual(state(f.db), afterPeer); nullLabel(f.core, hidden.l1.id);
});

test('NR2/5 forget original, reuse, then forget fresh preserves NULL identity without retained recall navigation', t => {
  const f = fixture(t), original = admit(f.core, 'Forget original association.');
  const hidden = topic(f.core, original, 'Forget association', 'Forget ancestor'); hide(f.core, original, 'forget');
  const stable = [identity(f.db, hidden.l1.id), identity(f.db, hidden.l2.id)];
  const fresh = admit(f.core, 'Forget fresh association.');
  ok(place(f.core, [proposed(fresh.id, 'Forget association')]));
  assert.ok(map(f.core, 'recall').items.some(i => i.type === 'moc' && i.moc.id === hidden.l2.id));
  const current = detail(f.core, fresh.id);
  ok(f.core.forget({ namespace: ns, memoryId: fresh.id, expectedRevision: current.memory.revision }));
  assert.equal(f.core.get({ namespace: ns, memoryId: fresh.id }).error.code, 'memory_not_found');
  assert.deepEqual(map(f.core, 'recall').items, []);
  assert.deepEqual([identity(f.db, hidden.l1.id), identity(f.db, hidden.l2.id)], stable);
  rebuild(f.core); const cold = f.cold();
  nullLabel(cold, hidden.l1.id); nullLabel(cold, hidden.l2.id);
  assert.deepEqual(map(cold, 'recall').items, []);
  assert.equal(f.db.prepare('SELECT count(*) n FROM moc_memory_refs WHERE moc_id=?').get(hidden.l1.id).n, 0);
  assert.equal(f.db.prepare('SELECT count(*) n FROM moc_edges WHERE parent_id=? AND child_id=?').get(hidden.l2.id, hidden.l1.id).n, 1);
});

test('NR3/4 three explicit L2 parents plus a requested NULL L2 insert four distinct edges once', t => {
  const f = fixture(t), original = admit(f.core, 'Four fresh edges original.');
  const hidden = topic(f.core, original, 'Four fresh edges'); hide(f.core, original);
  const parents = Array.from({ length: 4 }, (_, i) => {
    const memory = admit(f.core, `Four-edge parent source ${i}.`);
    return { memory, ...topic(f.core, memory, `Four-edge child ${i}`, `Four-edge parent ${i}`) };
  });
  hide(f.core, parents[3].memory);
  const stable = identity(f.db, parents[3].l2.id), revisions = parents.map(p => group(f.db, p.l2.id).revision);
  const fresh = admit(f.core, 'Four fresh edges member.');
  const item = proposed(fresh.id, 'FOUR FRESH EDGES', parents.slice(0, 3).map(p => p.l2.id), 'Four-edge parent 3');
  const result = ok(place(f.core, [item])); assert.deepEqual(result.createdMocs, []);
  assert.equal(result.refs.filter(r => r.childType === 'moc').length, 4);
  assert.equal(f.db.prepare('SELECT count(*) n FROM moc_edges WHERE child_id=?').get(hidden.l1.id).n, 4);
  for (let i = 0; i < 4; i++) assert.equal(group(f.db, parents[i].l2.id).revision, revisions[i] + 1);
  assert.deepEqual(identity(f.db, parents[3].l2.id), stable); nullLabel(f.core, parents[3].l2.id);
  refsCurrent(f.db, result);
  const before = state(f.db); const repeated = ok(place(f.core, [item]));
  assert.equal(repeated.indexRevision, result.indexRevision); assert.deepEqual(state(f.db), before);
});

test('NR3/4 explicit and requested aliases of the same NULL parent create no duplicate edge or bump', t => {
  const f = fixture(t), original = admit(f.core, 'Resolved edge original.');
  const hidden = topic(f.core, original, 'Resolved child'); hide(f.core, original);
  const parentMemory = admit(f.core, 'Resolved parent source.');
  const parent = topic(f.core, parentMemory, 'Parent source child', 'Resolved parent'); hide(f.core, parentMemory);
  const beforeChild = group(f.db, hidden.l1.id), beforeParent = group(f.db, parent.l2.id);
  const stable = identity(f.db, parent.l2.id), fresh = [admit(f.core, 'Resolved edge A.'), admit(f.core, 'Resolved edge B.')];
  const items = fresh.map((m, i) => ({ ...proposed(m.id, i ? 'RESOLVED CHILD' : 'Ｒｅｓｏｌｖｅｄ child',
    [parent.l2.id], i ? 'RESOLVED PARENT' : 'Resolved parent'), parentIds: [hidden.l1.id] }));
  const result = ok(place(f.core, items)); assert.deepEqual(result.createdMocs, []);
  assert.equal(result.refs.filter(r => r.childType === 'moc').length, 1);
  assert.equal(group(f.db, hidden.l1.id).revision, beforeChild.revision + 1);
  assert.equal(group(f.db, parent.l2.id).revision, beforeParent.revision + 1);
  assert.equal(f.db.prepare('SELECT count(*) n FROM moc_edges WHERE parent_id=? AND child_id=?').get(parent.l2.id, hidden.l1.id).n, 1);
  assert.deepEqual(identity(f.db, parent.l2.id), stable); refsCurrent(f.db, result);
  const before = state(f.db); const repeated = ok(place(f.core, items));
  assert.equal(repeated.indexRevision, result.indexRevision); assert.deepEqual(state(f.db), before);
});

import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { DatabaseSync } from 'node:sqlite';
import test from 'node:test';
import { openMemoryCore } from '../contract.mjs';
import { openMemoryStore } from '../index.mjs';
import { createMockPlacementModel } from '../testing/mock-placement-model.mjs';

const ns = { ownerId: 'owner', scope: 'project', projectId: 'project' };
const foreign = { ...ns, ownerId: 'other-owner' };
const source = (content, eventId = content) => ({ client: 'moc-test', sessionId: 'session', eventId,
  role: 'user', excerpt: content });
function ok(result) { assert.equal(result.ok, true, JSON.stringify(result)); return result.value; }
function error(result, code) { assert.equal(result.ok, false); assert.equal(result.error.code, code); }
function fixture(t, model = createMockPlacementModel()) {
  const path = join(mkdtempSync(join(tmpdir(), 'cairn-moc-')), 'memory.sqlite');
  const core = openMemoryCore({ path, model });
  t.after(() => core.close());
  return { core, model, path };
}
function admit(core, content = 'Use sequence diagrams to explain network protocols.', namespace = ns) {
  return ok(core.admit({ namespace, memory: { content, kind: 'instruction' }, receipts: [source(content)] })).memory;
}
const map = (core, options = {}) => ok(core.map({ namespace: ns, ...options }));
const detail = (core, id) => ok(core.get({ namespace: ns, memoryId: id }));
function apply(core, items, index = map(core, { purpose: 'classification' }).indexRevision) {
  const expectedMemoryRevisions = items.map((item) => ({ memoryId: item.memoryId,
    revision: detail(core, item.memoryId).memory.revision }));
  return core.applyPlacement({ namespace: ns, proposal: { items }, expectedMemoryRevisions, expectedIndexRevision: index });
}
function topic(core, memory, title, newL2Title) {
  const result = ok(apply(core, [{ memoryId: memory.id, parentIds: [],
    newL1: { title, parentL2Ids: [], ...(newL2Title ? { newL2Title } : {}) } }]));
  return { result, l1: result.createdMocs.find((m) => m.level === 'L1'),
    l2: result.createdMocs.find((m) => m.level === 'L2') };
}

test('new groups persist real L2/L1/memory edges with resulting versions and receipts intact', (t) => {
  const { core, model } = fixture(t);
  const memory = admit(core);
  const before = detail(core, memory.id);
  const { result, l1, l2 } = topic(core, memory, 'Protocol diagrams', 'Engineering');
  assert.equal(l1.revision, 1);
  assert.equal(l2.revision, 1);
  assert.equal(result.memories[0].revision, 2);
  assert.deepEqual(result.memories[0].filing, { status: 'filed' });
  assert.equal(result.memories[0].content, before.memory.content);
  assert.deepEqual(l1.titleSources, [{ memoryId: memory.id, memoryRevision: 2 }]);
  const mapped = map(core);
  assert.equal(mapped.exhausted, true);
  assert.ok(mapped.items.some((i) => i.type === 'ref' && i.ref.parentId === l1.id && i.ref.childId === memory.id && i.ref.childRevision === 2));
  assert.ok(mapped.items.some((i) => i.type === 'ref' && i.ref.parentId === l2.id && i.ref.childId === l1.id));
  assert.deepEqual(detail(core, memory.id).receipts, before.receipts);
  assert.deepEqual(detail(core, memory.id).placements, [{ mocId: l1.id, mocRevision: 1, title: 'Protocol diagrams' }]);
  assert.equal(ok(core.list({ namespace: ns, statuses: ['filed'] })).memories.length, 1);
  assert.equal(ok(core.list({ namespace: ns, statuses: ['unfiled'] })).memories.length, 0);
  assert.equal(model.calls.length, 0);
});

test('one batch coalesces identical new topics and binds every contributing source revision', (t) => {
  const { core } = fixture(t);
  const memories = [admit(core, 'Document client messages.'), admit(core, 'Document server messages.')];
  const result = ok(apply(core, memories.map((m) => ({ memoryId: m.id, parentIds: [],
    newL1: { title: 'Message formats', parentL2Ids: [], newL2Title: 'Protocols' } }))));
  assert.equal(result.createdMocs.length, 2);
  for (const group of result.createdMocs) {
    assert.equal(group.revision, 1);
    assert.deepEqual(group.titleSources.map((s) => s.memoryId).sort(), memories.map((m) => m.id).sort());
    assert.ok(group.titleSources.every((s) => s.memoryRevision === 2));
  }
  for (const memory of memories) assert.equal(detail(core, memory.id).placements.length, 1);
});

test('coalesced topics cannot bypass the existing L2 parent bound', (t) => {
  const { core } = fixture(t);
  const parents = Array.from({ length: 4 }, (_, i) =>
    topic(core, admit(core, `Parent source ${i}`), `Child ${i}`, `Parent ${i}`).l2.id);
  const memories = [admit(core, 'First contributor'), admit(core, 'Second contributor')];
  const before = map(core, { purpose: 'classification' });
  error(apply(core, memories.map((m, i) => ({ memoryId: m.id, parentIds: [],
    newL1: { title: 'Combined topic', parentL2Ids: parents.slice(i * 2, i * 2 + 2) } }))), 'invalid_input');
  assert.deepEqual(map(core, { purpose: 'classification' }), before);
  for (const m of memories) assert.equal(detail(core, m.id).memory.revision, 1);
});

test('many-to-many replacement/no-op and hierarchy linking have exact revision effects', (t) => {
  const { core } = fixture(t);
  const a = admit(core, 'Keep protocol notes.');
  const ga = topic(core, a, 'Networking', 'Work');
  const b = admit(core, 'Keep meeting notes.');
  const gb = topic(core, b, 'Meetings', 'Collaboration');
  const oldRevision = detail(core, a.id).memory.revision;
  const moved = ok(apply(core, [{ memoryId: a.id, parentIds: [ga.l1.id, gb.l1.id] }]));
  assert.equal(moved.memories[0].revision, oldRevision);
  assert.equal(detail(core, a.id).placements.length, 2);
  const noOp = ok(apply(core, [{ memoryId: a.id, parentIds: [gb.l1.id, ga.l1.id] }]));
  assert.equal(noOp.indexRevision, moved.indexRevision);
  const root = map(core);
  const groups = root.items.filter((i) => i.type === 'moc').map((i) => i.moc);
  assert.equal(groups.find((g) => g.id === ga.l1.id).revision, ga.l1.revision);
  assert.equal(groups.find((g) => g.id === ga.l2.id).revision, ga.l2.revision);
  const parent = groups.find((g) => g.id === ga.l2.id);
  const child = groups.find((g) => g.id === gb.l1.id);
  const link = { namespace: ns, parentId: parent.id, expectedParentRevision: parent.revision,
    childId: child.id, expectedChildRevision: child.revision, expectedIndexRevision: root.indexRevision };
  const linked = ok(core.linkMocs(link));
  assert.equal(linked.ref.parentRevision, parent.revision + 1);
  assert.equal(linked.duplicate, false);
  const duplicate = ok(core.linkMocs({ ...link, expectedParentRevision: linked.ref.parentRevision,
    expectedIndexRevision: linked.indexRevision }));
  assert.equal(duplicate.duplicate, true);
  assert.equal(duplicate.indexRevision, linked.indexRevision);
  error(core.map({ namespace: ns, parentRef: { mocId: parent.id, revision: parent.revision } }), 'revision_conflict');
  const expanded = map(core, { parentRef: { mocId: parent.id, revision: linked.ref.parentRevision } });
  assert.ok(expanded.items.some((i) => i.type === 'ref' && i.ref.childId === child.id));
  assert.ok(!expanded.items.some((i) => i.type === 'unfiled'));
});

test('scope, hierarchy, duplicate-title and stale guards reject the entire placement transaction', (t) => {
  const { core } = fixture(t);
  const a = admit(core);
  const groups = topic(core, a, 'Diagrams', 'Engineering');
  const b = admit(core, 'Another independent memory.');
  const other = admit(core, 'Foreign note.', foreign);
  const foreignIndex = ok(core.map({ namespace: foreign })).indexRevision;
  const foreignGroup = ok(core.applyPlacement({ namespace: foreign,
    proposal: { items: [{ memoryId: other.id, parentIds: [], newL1: { title: 'Private', parentL2Ids: [] } }] },
    expectedMemoryRevisions: [{ memoryId: other.id, revision: 1 }], expectedIndexRevision: foreignIndex })).createdMocs[0];
  error(apply(core, [{ memoryId: b.id, parentIds: [foreignGroup.id] }]), 'moc_not_found');
  error(apply(core, [{ memoryId: b.id, parentIds: [groups.l2.id] }]), 'invalid_ref');
  error(apply(core, [{ memoryId: b.id, parentIds: [], newL1: { title: '  DIAGRAMS ', parentL2Ids: [] } }]), 'moc_title_conflict');
  const index = map(core).indexRevision;
  const input = { namespace: ns, proposal: { items: [{ memoryId: b.id, parentIds: [],
    newL1: { title: 'Must not be created', parentL2Ids: [] } }] },
    expectedMemoryRevisions: [{ memoryId: b.id, revision: 99 }], expectedIndexRevision: index };
  error(core.applyPlacement(input), 'revision_conflict');
  error(core.applyPlacement({ ...input, expectedMemoryRevisions: [{ memoryId: b.id, revision: 1 }],
    expectedIndexRevision: index - 1 }), 'index_revision_conflict');
  error(core.applyPlacement({ ...input, expectedMemoryRevisions: [] }), 'invalid_input');
  assert.equal(map(core).indexRevision, index);
  assert.deepEqual(detail(core, b.id).placements, []);
  assert.ok(!JSON.stringify(map(core, { purpose: 'classification' })).includes('Must not be created'));
});

test('correction and forgetting remove labels, unfile memories and hide empty ancestors', (t) => {
  const { core } = fixture(t);
  const a = admit(core, 'This is a deliberately source-derived topic.');
  const { l1, l2 } = topic(core, a, 'This is a deliberately source-derived topic.', 'Derived parent topic');
  assert.ok(JSON.stringify(map(core)).includes('deliberately source-derived'));
  const current = detail(core, a.id).memory;
  const corrected = ok(core.correct({ namespace: ns, memoryId: a.id, expectedRevision: current.revision,
    content: 'Use architecture sketches instead.', kind: 'instruction', receipt: source('Use architecture sketches instead.') }));
  assert.equal(corrected.memory.revision, 3);
  assert.equal(corrected.memory.filing.status, 'unfiled');
  assert.deepEqual(detail(core, a.id).placements, []);
  assert.ok(!map(core).items.some((i) => i.type === 'moc' && [l1.id, l2.id].includes(i.moc.id)));
  const catalog = map(core, { purpose: 'classification' });
  assert.equal(catalog.items.find((i) => i.type === 'moc' && i.moc.id === l1.id).moc.title, null);
  assert.equal(JSON.stringify(catalog).includes('deliberately source-derived'), false);
  const next = topic(core, corrected.memory, 'Architecture sketches');
  ok(core.forget({ namespace: ns, memoryId: a.id, expectedRevision: 4 }));
  assert.ok(!map(core).items.some((i) => i.type === 'moc' && i.moc.id === next.l1.id));
  assert.equal(map(core).items.length, 0);
});

test('legacy no-op keeps filing; a new source invalidates memberships and derived titles', (t) => {
  const { core, path } = fixture(t);
  const content = 'Keep a protocol diary.';
  const a = admit(core, content);
  const { l1 } = topic(core, a, 'Protocol diary');
  const store = openMemoryStore({ path });
  t.after(() => store.close());
  const scope = store.scope({ ownerId: ns.ownerId, projectId: ns.projectId });
  const before = map(core).indexRevision;
  scope.remember({ content, kind: 'instruction', receipt: source(content) });
  assert.equal(detail(core, a.id).memory.filing.status, 'filed');
  assert.equal(map(core).indexRevision, before);
  scope.remember({ content, kind: 'instruction', receipt: source(content, 'new source') });
  assert.equal(detail(core, a.id).memory.filing.status, 'unfiled');
  assert.deepEqual(detail(core, a.id).placements, []);
  assert.equal(map(core, { purpose: 'classification' }).items.find((i) => i.type === 'moc' && i.moc.id === l1.id).moc.title, null);
});

test('map paging, token bounds, counter absence and mutation invalidation are explicit', (t) => {
  const { core, path, model } = fixture(t);
  for (let i = 0; i < 6; i++) topic(core, admit(core, `Memory ${i}.`), `Topic ${i}`);
  const all = map(core);
  const seen = [];
  let cursor;
  do {
    const page = map(core, { limit: 2, ...(cursor ? { cursor } : {}) });
    assert.ok(page.items.length <= 2);
    assert.ok(model.countTokens(JSON.stringify({ ok: true, value: page })) <= 4000);
    seen.push(...page.items);
    cursor = page.nextCursor;
  } while (cursor);
  assert.deepEqual(seen, all.items);
  const partial = map(core, { tokenBudget: 450 });
  assert.equal(partial.exhausted, false);
  assert.equal(partial.truncatedBy, 'token_budget');
  assert.ok(partial.items.length > 0);
  error(core.map({ namespace: ns, tokenBudget: 1 }), 'context_item_too_large');
  const first = map(core, { limit: 2 });
  error(core.map({ namespace: ns, limit: 2, purpose: 'classification', cursor: first.nextCursor }), 'invalid_cursor');
  admit(core, 'Invalidate cursor.');
  error(core.map({ namespace: ns, limit: 2, cursor: first.nextCursor }), 'cursor_stale');
  const plain = openMemoryCore({ path });
  t.after(() => plain.close());
  error(plain.map({ namespace: ns }), 'token_count_unavailable');
  assert.ok(plain.list({ namespace: ns }).ok);
});

test('counting cannot cause a stale map to leak after a synchronous mutation', (t) => {
  let mutate;
  const model = createMockPlacementModel([], { countTokens(text) {
    if (text && mutate) { const work = mutate; mutate = undefined; work(); }
    return Math.ceil(text.length / 4);
  } });
  const { core } = fixture(t, model);
  const a = admit(core);
  topic(core, a, 'Network protocols');
  mutate = () => ok(core.forget({ namespace: ns, memoryId: a.id, expectedRevision: 2 }));
  error(core.map({ namespace: ns }), 'index_revision_conflict');
  assert.deepEqual(map(core).items, []);
});

test('late receipt failure rolls back filing invalidation, group revision and epoch', (t) => {
  const { core, path } = fixture(t);
  const a = admit(core);
  topic(core, a, 'Protocols');
  const before = map(core);
  const db = new DatabaseSync(path);
  db.exec(`CREATE TRIGGER fail_receipt BEFORE INSERT ON receipts BEGIN SELECT RAISE(ABORT, 'test'); END;`);
  assert.equal(core.correct({ namespace: ns, memoryId: a.id, expectedRevision: 2,
    content: 'Do not commit this.', kind: 'instruction', receipt: source('Do not commit this.') }).ok, false);
  db.close();
  assert.deepEqual(map(core), before);
  assert.equal(detail(core, a.id).memory.filing.status, 'filed');
});

test('persisted hierarchy and map cursor survive reopen', (t) => {
  const { core, model, path } = fixture(t);
  const a = admit(core);
  topic(core, a, 'Diagrams', 'Work');
  const first = map(core, { limit: 1 });
  const second = map(core, { limit: 1, cursor: first.nextCursor });
  core.close();
  const reopened = openMemoryCore({ path, model });
  t.after(() => reopened.close());
  assert.deepEqual(map(reopened, { limit: 1, cursor: first.nextCursor }), second);
  assert.equal(detail(reopened, a.id).memory.filing.status, 'filed');
});

test('corrupt foreign/stale/invalid-level refs are reported without exposing referenced content', (t) => {
  const { core, path } = fixture(t);
  const a = admit(core);
  const { l1, l2 } = topic(core, a, 'Own topic', 'Own parent');
  const hidden = admit(core, 'This foreign content must never appear in the map.', foreign);
  const db = new DatabaseSync(path);
  db.prepare('INSERT INTO moc_memory_refs (moc_id,moc_revision,memory_id,memory_revision) VALUES (?,?,?,?)')
    .run(l1.id, 1, hidden.id, 1);
  db.prepare('UPDATE moc_memory_refs SET memory_revision = 999 WHERE memory_id = ?').run(a.id);
  db.prepare('INSERT INTO moc_edges (parent_id,parent_revision,child_id,child_revision) VALUES (?,?,?,?)')
    .run(l1.id, 1, l2.id, 1);
  db.close();
  const result = map(core, { purpose: 'classification' });
  assert.ok(result.invalidRefs.some((r) => r.childId === hidden.id && r.reason === 'not_found'));
  assert.ok(result.invalidRefs.some((r) => r.childId === a.id && r.reason === 'stale'));
  assert.ok(result.invalidRefs.some((r) => r.parentId === l1.id && r.childId === l2.id && r.reason === 'invalid_level'));
  assert.equal(JSON.stringify(result).includes('This foreign content'), false);
  assert.ok(!result.items.some((i) => i.type === 'ref' && [hidden.id, a.id].includes(i.ref.childId)));
});

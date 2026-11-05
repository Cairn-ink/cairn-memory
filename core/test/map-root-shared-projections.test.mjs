import test from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { openMemoryCore } from '../contract.mjs';
import { transaction } from '../database.mjs';
import { writeContentSuppressionInside } from '../content-suppression-storage.mjs';
import { safetyFixture, ns as safetyNamespace, receipt } from '../testing/content-safety-s2h-fixture.mjs';
import { createTestWorkspace } from '../../tools/testing/workspace.mjs';

const ns = { ownerId: 'synthetic-map-owner', scope: 'personal', projectId: null };
const foreign = { ...ns, ownerId: 'synthetic-map-foreign' };
const ok = result => { assert.equal(result.ok, true, JSON.stringify(result)); return result.value; };
const memoryId = i => `memory-${String(i).padStart(4, '0')}`;
const authority = { authorize({ input, ...binding }) { return { ...binding, accessGeneration: 1 }; }, isCurrent: grant => grant };

function fixture(t) {
  const workspace = createTestWorkspace(t, { prefix: 'map-root-projections-' });
  const path = join(workspace.path, 'store.sqlite');
  let counterCalls = 0;
  const core = openMemoryCore({ path, model: { countTokens() { counterCalls++; return 1; } },
    privateCards: { version: 'private-cards-local-v1', source: 'submitted-note-v1', storage: 'local-plain-v1',
      disclosure: 'explicit-submitted-note-v1', authority } });
  workspace.defer(() => core.close());
  const seed = ok(core.admit({ namespace: ns, memory: { content: 'Synthetic map seed', kind: 'fact' }, receipts: [receipt('map-seed')] })).memory;
  const db = new DatabaseSync(path); db.exec('PRAGMA busy_timeout=5000; PRAGMA foreign_keys=OFF');
  workspace.defer(() => db.close());
  const original = db.prepare('SELECT * FROM memories WHERE id=?').get(seed.id);
  const columns = Object.keys(original);
  const insert = db.prepare(`INSERT INTO memories (${columns.join(',')}) VALUES (${columns.map(() => '?').join(',')})`);
  transaction(db, () => {
    // Fixed IDs and independent expected tuples make title ties and deep offsets
    // predictable without deriving expectations from the implementation.
    for (let i = 0; i <= 1100; i++) {
      const row = { ...original, id: memoryId(i), fingerprint: `synthetic-fingerprint-${i}`,
        content: `Synthetic map body ${i}`, filing_status: i < 4 ? 'filed' : 'unfiled' };
      insert.run(...columns.map(key => row[key]));
    }
    for (const id of ['foreign-memory', 'unrelated-memory']) {
      const row = { ...original, id, owner_id: foreign.ownerId, fingerprint: id, content: `Synthetic ${id}` };
      insert.run(...columns.map(key => row[key]));
    }
    db.prepare('DELETE FROM receipts WHERE memory_id=?').run(seed.id);
    db.prepare('DELETE FROM memories WHERE id=?').run(seed.id);
    const moc = db.prepare(`INSERT INTO mocs(id,owner_id,scope,project_id,level,title,canonical_title,revision,created_at,updated_at)
      VALUES(?,?,'personal','',?,?,?,1,?,?)`);
    for (const [id, level] of [['topic-a', 1], ['topic-b', 1], ['root', 2], ['topic-empty', 1], ['root-empty', 2]]) {
      moc.run(id, ns.ownerId, level, 'Tied title', id, original.created_at, original.updated_at);
      db.prepare('INSERT INTO moc_title_sources VALUES(?,?,1)').run(id, memoryId(0));
    }
    moc.run('foreign-topic', foreign.ownerId, 1, 'A foreign title', 'foreign-topic', original.created_at, original.updated_at);
    db.prepare('INSERT INTO moc_title_sources VALUES(?,?,1)').run('foreign-topic', 'foreign-memory');
    const ref = db.prepare('INSERT INTO moc_memory_refs(moc_id,memory_id,moc_revision,memory_revision) VALUES(?,?,?,?)');
    for (const args of [['topic-a', memoryId(0), 1, 1], ['topic-b', memoryId(1), 1, 1],
      ['topic-a', memoryId(2), 1, 99], ['topic-a', 'missing-memory', 1, 1],
      ['topic-a', 'foreign-memory', 1, 1], ['root', memoryId(3), 1, 1]]) ref.run(...args);
    const edge = db.prepare('INSERT INTO moc_edges(parent_id,child_id,parent_revision,child_revision) VALUES(?,?,?,?)');
    for (const args of [['root', 'topic-a', 1, 1], ['root', 'topic-b', 1, 99],
      ['root', 'foreign-topic', 1, 1], ['root', 'missing-topic', 1, 1]]) edge.run(...args);
  });
  return { core, db, get counterCalls() { return counterCalls; } };
}

function expectedRows(typed, purpose) {
  const rows = [];
  const add = (key, row) => rows.push({ key, ...row });
  const topic = (id, level) => typed ? { type: 'topic', topic: { type: 'memory', id, level: `L${level}`, title: 'Tied title', revision: 1 } }
    : { type: 'moc', moc: { id, level: `L${level}`, title: 'Tied title', revision: 1 } };
  for (const [id, level] of [['topic-a', 1], ['topic-b', 1], ['root', 2],
    ...(purpose === 'classification' ? [['topic-empty', 1], ['root-empty', 2]] : [])]) add([level, 'Tied title', id, ''], { item: topic(id, level) });
  for (const [parentId, i] of [['topic-a', 0], ['topic-b', 1]]) add([1, 'Tied title', parentId, memoryId(i)], {
    item: { type: 'ref', ref: { parentId, parentRevision: 1, childType: 'memory', childId: memoryId(i), childRevision: 1, relation: 'contains' }, label: `Synthetic map body ${i}` } });
  add([2, 'Tied title', 'topic-a', 'root:topic-a'], { item: { type: 'ref', ref: {
    parentId: 'root', parentRevision: 1, childType: typed ? 'topic' : 'moc', childId: 'topic-a', childRevision: 1, relation: 'contains' }, label: 'Tied title' } });
  for (const [parentId, childId, reason] of [['topic-a', memoryId(2), 'stale'], ['topic-a', 'missing-memory', 'not_found'],
    ['topic-a', 'foreign-memory', 'not_found'], ['root', memoryId(3), 'invalid_level']]) {
    add([1, 'Tied title', parentId, childId], { invalidRef: { parentId, childType: 'memory', childId, reason } });
  }
  for (const [id, title, reason] of [['topic-b', 'Tied title', 'stale'], ['foreign-topic', 'A foreign title', 'not_found'], ['missing-topic', '', 'not_found']]) {
    add([2, title, id, `root:${id}`], { invalidRef: { parentId: 'root', childType: 'moc', childId: id, reason } });
  }
  // Stale and invalid-level placements do not prevent the unfiled fallback.
  for (let i = 2; i <= 1100; i++) if (i !== 4) add([3, '', memoryId(i), ''], { item: {
    type: 'unfiled', ref: { ...(typed ? { type: 'memory', namespace: ns } : {}), memoryId: memoryId(i), revision: 1 }, label: `Synthetic map body ${i}` } });
  const compare = (a, b) => { for (let i = 0; i < a.key.length; i++) { if (a.key[i] < b.key[i]) return -1; if (a.key[i] > b.key[i]) return 1; } return 0; };
  return rows.sort(compare);
}

for (const purpose of ['recall', 'classification']) test(`root metadata paging: ${purpose}, public and typed memory, ties, invalid refs and forget`, t => {
  const f = fixture(t);
  const invoke = (typed, cursor) => typed ? f.core.mapEvidence({ namespace: ns, type: 'memory', purpose, limit: 50, ...(cursor ? { cursor } : {}) }, {})
    : f.core.map({ namespace: ns, purpose, limit: 100, tokenBudget: 4000, ...(cursor ? { cursor } : {}) });
  const oldPublic = ok(invoke(false)).nextCursor, oldTyped = ok(invoke(true)).nextCursor;
  ok(f.core.forget({ namespace: ns, memoryId: memoryId(4), expectedRevision: 1 }));
  assert.equal(invoke(false, oldPublic).error.code, 'cursor_stale');
  assert.equal(invoke(true, oldTyped).error.code, 'cursor_stale');
  for (const typed of [false, true]) {
    const expected = expectedRows(typed, purpose), seen = [], pageSize = typed ? 50 : 100; let cursor, pageNumber = 0;
    do {
      const response = invoke(typed, cursor), page = ok(response), slice = expected.slice(pageNumber * pageSize, (pageNumber + 1) * pageSize);
      assert.deepEqual(page.items, slice.filter(row => row.item).map(row => row.item), `items on page ${pageNumber}`);
      assert.deepEqual(page.invalidRefs, slice.filter(row => row.invalidRef).map(row => row.invalidRef), `invalid refs on page ${pageNumber}`);
      assert.equal(JSON.stringify(page).includes('Synthetic map body 4"'), false);
      if (pageNumber * pageSize === 1000) assert.deepEqual(invoke(typed, cursor), response, 'deep cursor page is repeatable');
      seen.push(...page.items.map(item => item.type === 'unfiled' ? item.ref.memoryId : item.type === 'ref' ? `${item.ref.parentId}:${item.ref.childId}` : (item.moc ?? item.topic).id));
      cursor = page.nextCursor; pageNumber++;
      assert.ok(pageNumber <= Math.ceil(expected.length / pageSize), 'cursor progresses');
    } while (cursor);
    assert.equal(pageNumber, Math.ceil(expected.length / pageSize));
    assert.equal(seen.length, expected.filter(row => row.item).length);
    assert.equal(new Set(seen).size, seen.length, 'no gaps or duplicate items across the complete sequence');
  }
  assert.ok(f.counterCalls > 0, 'recall uses the configured token budget counter');
});

test('root body hydration retains safety-layout suppression and forget fences', async t => {
  const f = safetyFixture(t); await f.migrate();
  const core = openMemoryCore({ path: f.path, model: { countTokens: () => 1 } }), db = f.connect();
  t.after(() => { core.close(); db.close(); });
  const memories = Array.from({ length: 3 }, (_, i) => ok(core.admit({ namespace: safetyNamespace,
    memory: { content: `Synthetic safety map ${i}`, kind: 'fact' }, receipts: [receipt(`map-safety-${i}`)] })).memory);
  for (const purpose of ['recall', 'classification']) {
    const first = ok(core.map({ namespace: safetyNamespace, purpose, limit: 1, tokenBudget: 4000 }));
    ok(core.forget({ namespace: safetyNamespace, memoryId: memories.pop().id, expectedRevision: 1 }));
    const stale = core.map({ namespace: safetyNamespace, purpose, limit: 1, tokenBudget: 4000, cursor: first.nextCursor });
    assert.equal(stale.ok, false); assert.ok(['invalid_cursor', 'cursor_stale'].includes(stale.error.code));
    assert.deepEqual(ok(core.map({ namespace: safetyNamespace, purpose, limit: 100, tokenBudget: 4000 })).items.map(item => item.ref.memoryId).sort(), memories.map(memory => memory.id).sort());
  }
  transaction(db, () => writeContentSuppressionInside(db, { namespace: safetyNamespace, kind: 'memory', key: memories[0].id, reason: 'privacy_erase', actionId: 'map-suppression' }));
  for (const purpose of ['recall', 'classification']) {
    const denied = core.map({ namespace: safetyNamespace, purpose, tokenBudget: 4000 });
    assert.equal(denied.ok, false); assert.equal(denied.error.code, 'evidence_unavailable');
  }
});

import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import test from 'node:test';
import { openMemoryCore } from '../contract.mjs';
import { createMemoryRuntime } from '../runtime.mjs';
import { createMockRecallModel } from '../testing/mock-recall-model.mjs';
import { createQueryScore, QUERY_SCAN_LIMIT, QUERY_CANDIDATE_VERSION } from '../query-candidates.mjs';

const ns = { ownerId: 'candidate-tests', scope: 'personal', projectId: null };
const ok = (result) => { assert.equal(result.ok, true, JSON.stringify(result)); return result.value; };
const refs = (input) => input.maps.flatMap(({ namespaceIndex, items }) => items.map((item) => ({
  namespaceIndex, ...(item.type === 'unfiled' ? item.ref : {
    memoryId: item.ref.childId, revision: item.ref.childRevision,
  }),
})));
const rank = ({ input }) => ({ refs: input.candidates.slice(0, input.limit).map(({ namespaceIndex, memory }) => ({
  namespaceIndex, memoryId: memory.id, revision: memory.revision,
})) });
function fixture(t, wanted = [], options = {}) {
  const path = join(mkdtempSync(join(tmpdir(), 'cairn-query-candidates-')), 'memory.sqlite');
  // This visibility oracle measures literal reachability, never model quality.
  const select = ({ input }) => ({ refs: refs(input).filter((ref) => wanted.includes(ref.memoryId)) });
  const model = createMockRecallModel({ countTokens: () => 1, select: [select, select], rank: [rank], ...options });
  const core = openMemoryCore({ path, model });
  const db = new DatabaseSync(path);
  t.after(() => { db.close(); core.close(); });
  return { core, db, model, wanted, path };
}
function admit(core, content, namespace = ns) {
  return ok(core.admit({ namespace, memory: { content, kind: 'fact' }, receipts: [{
    client: 'test', sessionId: 'synthetic', eventId: content, role: 'user', excerpt: content,
  }] })).memory;
}
const id = (i) => `synthetic-${String(i).padStart(4, '0')}`;
// Direct SQL is confined to fresh synthetic stores. Fixed IDs
// make the raw 1024-row boundary and public-map position deterministic without
// relying on random UUID ordering. Public admissions/placement are tested below.
function seed(db, count, content = (i) => `Unrelated note ${i}`, state = () => 'current') {
  const insert = db.prepare(`INSERT INTO memories
    (id,owner_id,scope,project_id,fingerprint,content,kind,origin,confidence,revision,
     deleted,created_at,updated_at,filing_status,currentness)
    VALUES (?,?,'personal','',?,?,'fact','explicit',1,1,?,'2026-01-01',?,'unfiled',?)`);
  const receipt = db.prepare(`INSERT INTO receipts
    (id,memory_id,receipt_key,client,session_id,event_id,role,excerpt,created_at)
    VALUES (?,?,?,'test','synthetic',?,'user',?,'2026-01-01')`);
  db.exec('BEGIN');
  for (let i = 1; i <= count; i++) {
    const currentness = state(i);
    insert.run(id(i), ns.ownerId, `fingerprint-${i}`, currentness === 'deleted' ? null : content(i),
      currentness === 'deleted' ? 1 : 0, `2026-${String(i).padStart(5, '0')}`, currentness === 'historical' ? 'historical' : 'current');
    if (currentness !== 'deleted') receipt.run(`receipt-${i}`, id(i), `key-${i}`, `event-${i}`, content(i));
  }
  db.prepare("INSERT INTO namespace_epochs VALUES (?,'personal','',1)").run(ns.ownerId);
  db.exec('COMMIT');
}
const recall = (core, query = 'Lantern', readSet = [ns]) => core.recall({ readSet, query, limit: 12 });

test('distinct whole Unicode query runs score full bodies with stable literal semantics', () => {
  assert.equal(QUERY_SCAN_LIMIT, 1024);
  assert.ok(QUERY_CANDIDATE_VERSION);
  const score = createQueryScore('ALPHA alpha beta 2026 記憶');
  assert.equal(score('alpha alpha'), 1);
  assert.equal(score('beta Alpha 2026 記憶'), 4);
  assert.equal(score('alphabet 20260 我的記憶系統'), 0);
  assert.equal(createQueryScore('car')( 'automobile'), 0);
  assert.equal(createQueryScore('run')('running'), 0);
  assert.equal(createQueryScore('!? 😀')('anything'), 0);
  assert.equal(createQueryScore('école 𐐀')('ÉCOLE 𐐨'), 2);
  assert.equal(createQueryScore('Lantern')(`${'x '.repeat(1900)}Lantern`), 1);
});

test('correct, misleading and absent placements preserve off-page sourced exact targets', async (t) => {
  for (const placement of ['correct', 'misleading', 'none']) {
    const f = fixture(t);
    seed(f.db, 250, (i) => i === 250 ? 'Lantern observatory opens Friday' : `Unrelated unfiled distractor ${i}`);
    const target = ok(f.core.get({ namespace: ns, memoryId: id(250) })).memory;
    f.wanted.push(target.id);
    // A public placement establishes a real parent. Synthetic crowding edges
    // copy its current revisions; target placement itself uses the public API.
    const firstMemory = ok(f.core.get({ namespace: ns, memoryId: id(1) })).memory;
    const group = ok(f.core.applyPlacement({ namespace: ns,
      proposal: { items: [{ memoryId: firstMemory.id, parentIds: [], newL1: { title: 'AAA unrelated', parentL2Ids: [] } }] },
      expectedMemoryRevisions: [{ memoryId: firstMemory.id, revision: firstMemory.revision }],
      expectedIndexRevision: ok(f.core.map({ namespace: ns })).indexRevision })).createdMocs[0];
    f.db.exec('BEGIN');
    for (let i = 2; i <= 210; i++) {
      f.db.prepare('UPDATE memories SET filing_status = ? WHERE id = ?').run('filed', id(i));
      f.db.prepare('INSERT INTO moc_memory_refs VALUES (?,?,?,1)').run(group.id, group.revision, id(i));
    }
    f.db.exec('COMMIT');
    if (placement !== 'none') ok(f.core.applyPlacement({ namespace: ns,
      proposal: { items: [{ memoryId: target.id, parentIds: [], newL1: {
        title: placement === 'correct' ? 'Lantern observatory' : 'Tax paperwork', parentL2Ids: [],
      } }] }, expectedMemoryRevisions: [{ memoryId: target.id, revision: target.revision }],
      expectedIndexRevision: ok(f.core.map({ namespace: ns })).indexRevision }));
    const first = ok(f.core.map({ namespace: ns, purpose: 'recall' }));
    const second = ok(f.core.map({ namespace: ns, purpose: 'recall', cursor: first.nextCursor }));
    assert.ok(!JSON.stringify([first.items, second.items]).includes(target.id),
      `${placement} target must actually be beyond public page two`);
    const result = ok(await recall(f.core));
    assert.equal(result.memories[0].memory.id, target.id);
    assert.equal(result.memories[0].receipts[0].excerpt, target.content);
    const item = f.model.calls[0].input.maps[0].items[0];
    assert.equal(item.type, placement === 'none' ? 'unfiled' : 'ref');
    assert.equal(result.coverage, 'budget_exhausted');
    assert.equal(f.model.calls.filter((call) => call.method === 'select').length, 2);
  }
});

test('multiple targets beyond public page two reach select and exact sourced recall', async (t) => {
  const f = fixture(t, [id(249), id(250)]);
  seed(f.db, 250, (i) => i >= 249 ? `Lantern target ${i}` : `Unrelated note ${i}`);
  const first = ok(f.core.map({ namespace: ns }));
  const second = ok(f.core.map({ namespace: ns, cursor: first.nextCursor }));
  assert.ok(!JSON.stringify([first.items, second.items]).includes(id(249)));
  assert.ok(!JSON.stringify([first.items, second.items]).includes(id(250)));
  const result = ok(await recall(f.core));
  assert.deepEqual(result.memories.map(({ memory }) => memory.id), f.wanted);
  assert.deepEqual(result.memories.map(({ receipts }) => receipts[0].excerpt), ['Lantern target 249', 'Lantern target 250']);
  assert.equal(result.coverage, 'budget_exhausted');
});

test('raw 1023/1024/1025 boundaries count historical and deleted rows before eligibility', async (t) => {
  for (const count of [1023, 1024, 1025]) {
    const f = fixture(t, [id(count)]);
    seed(f.db, count, (i) => `Lantern evidence ${i}`, (i) => i === count ? 'current' : i % 2 ? 'historical' : 'deleted');
    const result = ok(await recall(f.core));
    assert.deepEqual(result.memories.map(({ memory }) => memory.id), count <= 1024 ? [id(count)] : []);
    assert.equal(result.coverage, count <= 1024 ? 'complete' : 'budget_exhausted');
    assert.equal(result.namespaces[0].mapExhausted, count <= 1024);
    assert.ok(f.model.calls.filter((call) => call.method === 'select').length <= 1,
      'scan ceiling must not cause repeated empty continuation');
    const visibleIds = f.model.calls.filter((call) => call.method === 'select').flatMap((call) => refs(call.input).map((ref) => ref.memoryId));
    assert.deepEqual(visibleIds, count <= 1024 ? [id(count)] : []);
  }
});

test('a matching result inside an incomplete scan retains incomplete coverage', async (t) => {
  const f = fixture(t, [id(1024)]);
  seed(f.db, 1025, (i) => `Lantern evidence ${i}`, (i) => i === 1024 ? 'current' : 'historical');
  const result = ok(await recall(f.core));
  assert.equal(result.memories[0].memory.id, id(1024));
  assert.equal(result.coverage, 'budget_exhausted');
  assert.equal(f.model.calls.filter((call) => call.method === 'select').length, 1);
});

test('crowded score ties use ID order, retain zero overlap, and expose lexical limitations', async (t) => {
  for (const [query, content, matched] of [
    ['記憶', '我的記憶系統', false], ['我的記憶系統', '我的記憶系統', true],
    ['car', 'automobile', false], ['Lantern', 'Lantern decoy without the answer', true],
  ]) {
    const f = fixture(t, [id(250)]);
    seed(f.db, 250, (i) => i === 250 ? content : `Distractor ${i}`);
    const result = ok(await recall(f.core, query));
    const visibleIds = f.model.calls.filter((call) => call.method === 'select').flatMap((call) => refs(call.input).map((ref) => ref.memoryId));
    assert.deepEqual(visibleIds.slice(0, 3), matched ? [id(250), id(1), id(2)] : [id(1), id(2), id(3)]);
    assert.equal(visibleIds.length, 200);
    assert.equal(result.memories.length, matched ? 1 : 0);
    assert.equal(result.coverage, 'budget_exhausted', 'literal miss must never prove absence');
  }
});

test('exact namespaces and small zero-overlap stores remain selectable', async (t) => {
  const f = fixture(t);
  const project = { ...ns, scope: 'project', projectId: 'allowed' };
  for (const namespace of [ns, project, { ...project, projectId: 'other' }, { ...ns, ownerId: 'foreign' }]) {
    const memory = admit(f.core, `Automobile ${namespace.ownerId} ${namespace.projectId}`, namespace);
    if (namespace === ns || namespace === project) f.wanted.push(memory.id);
  }
  const result = ok(await recall(f.core, 'car', [ns, project]));
  assert.deepEqual(result.memories.map(({ memory }) => memory.id), f.wanted);
  assert.equal(result.coverage, 'complete');
  assert.ok(!JSON.stringify(f.model.calls).includes('foreign'));
  assert.ok(!JSON.stringify(f.model.calls).includes('Automobile candidate-tests other'));
});

test('a fully inspected namespace of 1024 rejected raw rows is complete and never loops', async (t) => {
  const f = fixture(t);
  seed(f.db, 1024, (i) => `Private historical ${i}`, (i) => i % 2 ? 'deleted' : 'historical');
  const result = ok(await recall(f.core));
  assert.deepEqual(result.memories, []);
  assert.equal(result.coverage, 'complete');
  assert.ok(!JSON.stringify(f.model.calls).includes('Private historical'));
  assert.ok(f.model.calls.length <= 1);
});

test('empty selection and empty ranking retain mutation defenses across callbacks', async (t) => {
  for (const phase of ['page-counter', 'select', 'select-output-counter', 'rank', 'rank-output-counter']) {
    const f = fixture(t);
    const memory = admit(f.core, 'Lantern callback evidence');
    let changed = false;
    const mutate = () => {
      if (changed) return;
      changed = true;
      ok(f.core.forget({ namespace: ns, memoryId: memory.id, expectedRevision: memory.revision }));
    };
    f.model.select = ({ input }) => {
      f.model.calls.push({ method: 'select', input });
      if (phase === 'select') mutate();
      return { refs: phase.startsWith('rank') ? refs(input) : [] };
    };
    f.model.rank = ({ input }) => {
      f.model.calls.push({ method: 'rank', input });
      if (phase === 'rank') mutate();
      return { refs: [] };
    };
    f.model.countTokens = (text) => {
      const parsed = text ? JSON.parse(text) : null;
      if (phase === 'page-counter' && parsed?.value?.items?.[0]?.type) mutate();
      if (phase === 'select-output-counter' && parsed?.refs && f.model.calls.at(-1)?.method === 'select') mutate();
      if (phase === 'rank-output-counter' && parsed?.refs && f.model.calls.at(-1)?.method === 'rank') mutate();
      return 1;
    };
    const result = await recall(f.core);
    assert.equal(changed, true, phase);
    assert.equal(result.ok, false, phase);
    assert.ok(['revision_conflict', 'index_revision_conflict'].includes(result.error.code), `${phase}: ${JSON.stringify(result)}`);
    assert.deepEqual(Object.keys(result), ['ok', 'error']);
  }
});

test('counting a second namespace cannot hide mutation of the first namespace', async (t) => {
  const f = fixture(t);
  const project = { ...ns, scope: 'project', projectId: 'mapped-second' };
  const first = admit(f.core, 'Lantern first namespace');
  admit(f.core, 'Lantern second namespace', project);
  let changed = false;
  f.model.countTokens = (text) => {
    const parsed = text ? JSON.parse(text) : null;
    if (!changed && parsed?.value?.items?.some((item) => item.label?.includes('second namespace'))) {
      changed = true;
      ok(f.core.forget({ namespace: ns, memoryId: first.id, expectedRevision: first.revision }));
    }
    return 1;
  };
  const result = await recall(f.core, 'Lantern', [ns, project]);
  assert.equal(changed, true);
  assert.deepEqual(result, { ok: false, error: { code: 'index_revision_conflict', retryable: false } });
  assert.equal(f.model.calls.length, 0);
});

test('candidate pages obey token packing as well as the 100 item ceiling', async (t) => {
  const f = fixture(t);
  seed(f.db, 201);
  const packed = [];
  f.model.countTokens = (text) => {
    const parsed = text ? JSON.parse(text) : null;
    if (parsed?.value?.items?.[0]?.type) {
      if (parsed.value.items.length <= 7) packed.push(parsed.value.items.length);
      return parsed.value.items.length > 7 ? 4001 : 1;
    }
    return 1;
  };
  const result = ok(await recall(f.core));
  assert.deepEqual(packed, [7, 7]);
  assert.deepEqual(f.model.calls.map((call) => call.input.maps[0].items.length), [7, 7]);
  assert.equal(result.coverage, 'budget_exhausted');
});

test('raw scan scores at most 1024 bodies, excludes sentinel, and uses the namespace ID index', (t) => {
  const f = fixture(t);
  seed(f.db, 1025, (i) => `記憶 body ${i}`);
  const runtime = createMemoryRuntime({ path: f.path });
  t.after(() => runtime.close());
  const scored = [];
  const page = runtime.queryCandidateRows({ ...ns, projectId: '' }, {
    score: (body) => { scored.push(body); return 0; }, memoryLabel: (body) => body,
  });
  assert.equal(scored.length, 1024);
  assert.equal(scored.at(-1), '記憶 body 1024');
  assert.equal(scored.includes('記憶 body 1025'), false);
  const expectedBytes = Array.from({ length: 1024 }, (_, i) => Buffer.byteLength(`記憶 body ${i + 1}`)).reduce((a, b) => a + b, 0);
  assert.equal(scored.reduce((sum, body) => sum + Buffer.byteLength(body), 0), expectedBytes);
  assert.equal(page.scanExhausted, false);
  const plan = f.db.prepare(`EXPLAIN QUERY PLAN SELECT id,revision,content,deleted,currentness
    FROM memories INDEXED BY index_memory_keyset
    WHERE owner_id=? AND scope=? AND project_id=? ORDER BY id LIMIT ?`).all(ns.ownerId, ns.scope, '', 1025);
  assert.ok(plan.some(({ detail }) => detail.includes('SEARCH memories USING INDEX index_memory_keyset')));
  assert.ok(plan.every(({ detail }) => !detail.includes('TEMP B-TREE')));
  // These assertions bound returned rows and JS body scoring, not SQLite page
  // I/O, nor the auxiliary current-placement and projection lookup work.
});

test('stale or missing placement falls back to true unfiled and multiparent uses one real edge', async (t) => {
  for (const mode of ['multiparent', 'stale', 'missing']) {
    const f = fixture(t);
    const memory = admit(f.core, 'Lantern placement evidence');
    f.wanted.push(memory.id);
    const parents = [];
    let revision = memory.revision;
    for (const title of ['Alpha', 'Beta']) {
      const applied = ok(f.core.applyPlacement({ namespace: ns,
        proposal: { items: [{ memoryId: memory.id, parentIds: parents, newL1: { title, parentL2Ids: [] } }] },
        expectedMemoryRevisions: [{ memoryId: memory.id, revision }],
        expectedIndexRevision: ok(f.core.map({ namespace: ns })).indexRevision }));
      parents.push(applied.createdMocs[0].id);
      revision = applied.memories[0].revision;
    }
    if (mode === 'stale') f.db.prepare('UPDATE moc_memory_refs SET memory_revision=999 WHERE memory_id=?').run(memory.id);
    if (mode === 'missing') f.db.prepare('DELETE FROM moc_memory_refs WHERE memory_id=?').run(memory.id);
    const result = ok(await recall(f.core));
    const items = f.model.calls[0].input.maps[0].items;
    assert.equal(items.length, 1);
    assert.equal(result.memories[0].memory.id, memory.id);
    if (mode === 'multiparent') {
      assert.equal(items[0].type, 'ref');
      assert.equal(items[0].ref.parentId, parents[0]);
      const edge = f.db.prepare('SELECT * FROM moc_memory_refs WHERE moc_id=? AND memory_id=?').get(parents[0], memory.id);
      assert.equal(items[0].ref.childRevision, edge.memory_revision);
      assert.equal(items[0].ref.parentRevision, edge.moc_revision);
    } else assert.equal(items[0].type, 'unfiled');
  }
});

test('published projection authority and unavailable index remain authoritative for candidates', async (t) => {
  for (const state of ['staging', 'missing-projection']) {
    const f = fixture(t);
    const memory = admit(f.core, 'Lantern projection evidence');
    admit(f.core, 'Unrelated second projection row');
    f.wanted.push(memory.id);
    const expectedIndexRevision = ok(f.core.map({ namespace: ns })).indexRevision;
    let page = ok(f.core.rebuildIndex({ namespace: ns, expectedIndexRevision, limit: 1 }));
    if (state === 'missing-projection') {
      let steps = 0;
      while (!page.exhausted) {
        assert.ok(++steps < 20);
        page = ok(f.core.rebuildIndex({ namespace: ns, expectedIndexRevision, limit: 1, cursor: page.nextCursor }));
      }
      // Corrupt only this fresh synthetic projection to prove raw scanning
      // cannot bypass the same published authority used by the public map.
      f.db.prepare('DELETE FROM index_memories WHERE id=?').run(memory.id);
      const result = ok(await recall(f.core));
      assert.deepEqual(result.memories, []);
      assert.ok(!JSON.stringify(f.model.calls).includes('Lantern projection evidence'));
    } else {
      assert.equal(page.exhausted, false);
      assert.deepEqual(await recall(f.core), { ok: false, error: { code: 'index_unavailable', retryable: false } });
      assert.equal(f.model.calls.length, 0);
    }
  }
});

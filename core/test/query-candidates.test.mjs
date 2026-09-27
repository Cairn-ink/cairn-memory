import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import test from 'node:test';
import { openMemoryCore } from '../contract.mjs';
import { openMemoryStore } from '../index.mjs';
import { createMemoryRuntime } from '../runtime.mjs';
import { createMockRecallModel } from '../testing/mock-recall-model.mjs';
import { createQueryScore, QUERY_SCAN_LIMIT, QUERY_CANDIDATE_VERSION,
  SOURCE_QUERY_CANDIDATE_VERSION, SOURCE_QUERY_RECEIPT_LIMIT } from '../query-candidates.mjs';

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
  let closed = false;
  const close = () => { if (!closed) { db.close(); core.close(); closed = true; } };
  t.after(close);
  return { core, db, model, wanted, path, close };
}
function admit(core, content, namespace = ns) {
  return ok(core.admit({ namespace, memory: { content, kind: 'fact' }, receipts: [{
    client: 'test', sessionId: 'synthetic', eventId: content, role: 'user', excerpt: content,
  }] })).memory;
}
const id = (i) => `synthetic-${String(i).padStart(4, '0')}`;
function addReceipt(db, memoryId, receiptId, excerpt) {
  const source = { client: 'test', sessionId: 'synthetic', eventId: receiptId, role: 'user', excerpt };
  const receiptKey = createHash('sha256').update(JSON.stringify(source)).digest('hex');
  db.prepare(`INSERT INTO receipts
    (id,memory_id,receipt_key,client,session_id,event_id,role,excerpt,created_at)
    VALUES (?,?,?,'test','synthetic',?,'user',?,'2026-01-01')`)
    .run(receiptId, memoryId, receiptKey, receiptId, excerpt);
}
// Direct SQL is confined to fresh synthetic stores. Fixed IDs
// make the current 1024-row boundary and public-map position deterministic without
// relying on random UUID ordering. Public admissions/placement are tested below.
function seed(db, count, content = (i) => `Unrelated note ${i}`, state = () => 'current',
  source = content) {
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
    const excerpt = source(i);
    const eventId = `event-${i}`;
    const receiptKey = createHash('sha256').update(JSON.stringify({ client: 'test',
      sessionId: 'synthetic', eventId, role: 'user', excerpt })).digest('hex');
    insert.run(id(i), ns.ownerId, `fingerprint-${i}`, currentness === 'deleted' ? null : content(i),
      currentness === 'deleted' ? 1 : 0, `2026-${String(i).padStart(5, '0')}`, currentness === 'historical' ? 'historical' : 'current');
    if (currentness !== 'deleted') receipt.run(`receipt-${i}`, id(i), receiptKey, eventId, excerpt);
  }
  db.prepare("INSERT INTO namespace_epochs VALUES (?,'personal','',1)").run(ns.ownerId);
  db.exec('COMMIT');
}
const recall = (core, query = 'Lantern', readSet = [ns]) => core.recall({ readSet, query, limit: 12 });

test('distinct whole Unicode query runs score full bodies with stable literal semantics', () => {
  assert.equal(QUERY_SCAN_LIMIT, 1024);
  assert.ok(QUERY_CANDIDATE_VERSION);
  assert.equal(SOURCE_QUERY_CANDIDATE_VERSION, 'literal-current-memory-source-overlap-v1');
  assert.equal(SOURCE_QUERY_RECEIPT_LIMIT, 4);
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

test('explicit source context reaches a receipt-only target hidden from two body-only pages', async (t) => {
  const query = 'violet keystone';
  const targetId = id(224);
  const targetBody = 'A compressed field note whose interpretation omits the identifying phrase.';
  const targetSource = `${'preface '.repeat(20)}violet keystone marks the synthetic riverside cache.`;
  const body = (i) => i <= 200 ? `violet body decoy ${i}`
    : i === 224 ? targetBody : `Unrelated trailing note ${i}`;
  const source = (i) => i === 224 ? targetSource : body(i);

  const control = fixture(t, [targetId]);
  seed(control.db, 224, body, () => 'current', source);
  const bodyOnly = ok(await recall(control.core, query));
  const bodyVisible = control.model.calls.filter(call => call.method === 'select')
    .flatMap(call => refs(call.input).map(ref => ref.memoryId));
  assert.equal(control.model.calls.filter(call => call.method === 'select').length, 2);
  assert.equal(bodyVisible.includes(targetId), false);
  assert.deepEqual(bodyOnly.memories, []);

  const sourceAware = fixture(t, [targetId]);
  seed(sourceAware.db, 224, body, () => 'current', source);
  const result = ok(await sourceAware.core.recall({ readSet: [ns], query, limit: 12,
    contextMode: 'source-evidence' }));
  const sourceVisible = sourceAware.model.calls.filter(call => call.method === 'select')
    .flatMap(call => call.input.maps.flatMap(map => map.items));
  const targetItem = sourceVisible.find(item => (item.type === 'unfiled'
    ? item.ref.memoryId : item.ref.childId) === targetId);
  assert.equal(targetItem?.label, ' preface preface preface preface preface preface preface preface preface preface preface preface preface violet keystone');
  assert.equal(result.memories[0].memory.id, targetId);
  assert.equal(result.memories[0].receipts[0].excerpt, targetSource);
});

test('both explicit source contexts use receipt ranking for filed, misfiled and unfiled memories', async t => {
  const query = 'copper astrolabe';
  const targetSource = `${'🚋'.repeat(125)} copper astrolabe is stored beside the synthetic canal.`;
  for (const contextMode of ['source-evidence', 'rationale-evidence']) {
    for (const placement of ['filed', 'misfiled', 'unfiled']) {
      const f = fixture(t, [id(8)]);
      seed(f.db, 8, i => i === 8 ? 'Compressed interpretation without the source phrase.'
        : `copper decoy ${i}`, () => 'current', i => i === 8 ? targetSource : `copper decoy source ${i}`);
      let expectedType = 'unfiled';
      if (placement !== 'unfiled') {
        const target = ok(f.core.get({ namespace: ns, memoryId: id(8) })).memory;
        ok(f.core.applyPlacement({ namespace: ns,
          proposal: { items: [{ memoryId: target.id, parentIds: [], newL1: {
            title: placement === 'filed' ? 'Copper instruments' : 'Synthetic recipes', parentL2Ids: [],
          } }] }, expectedMemoryRevisions: [{ memoryId: target.id, revision: target.revision }],
          expectedIndexRevision: ok(f.core.map({ namespace: ns })).indexRevision }));
        expectedType = 'ref';
      }
      const result = ok(await f.core.recall({ readSet: [ns], query, limit: 12, contextMode }));
      const item = f.model.calls.find(call => call.method === 'select').input.maps[0].items[0];
      assert.equal(item.type, expectedType, `${contextMode}/${placement}`);
      assert.equal([...item.label].length, 120, `${contextMode}/${placement}`);
      assert.ok(item.label.includes('copper astrolabe'), `${contextMode}/${placement}`);
      assert.equal(result.memories[0].memory.id, id(8), `${contextMode}/${placement}`);
      assert.equal(result.memories[0].receipts[0].excerpt, targetSource, `${contextMode}/${placement}`);
    }
  }
});

test('source scoring uses only the first four stable-ID receipts with strict body and receipt ties', t => {
  const f = fixture(t);
  seed(f.db, 4, i => i === 1 ? 'body keeps amber label'
    : i === 3 ? 'amber positive body tie label' : `plain body ${i}`,
    () => 'current', i => i === 1 ? 'cobalt ties body'
      : i === 3 ? 'cobalt positive receipt tie label'
        : i === 4 ? 'amber cobalt excluded fifth receipt' : `plain source ${i}`);
  addReceipt(f.db, id(1), 'a-first', 'amber first stable receipt');
  addReceipt(f.db, id(1), 'b-second', 'cobalt second tied receipt');
  addReceipt(f.db, id(1), 'c-third', 'amber cobalt strict winner');
  addReceipt(f.db, id(1), 'z-fifth', 'amber cobalt fifth receipt is outside the score policy');
  addReceipt(f.db, id(2), 'a-first-two', 'amber first stable receipt wins');
  addReceipt(f.db, id(2), 'b-second-two', 'cobalt second tied receipt loses');
  addReceipt(f.db, id(2), 'c-third-two', 'plain third receipt');
  addReceipt(f.db, id(2), 'd-fourth-two', 'plain fourth receipt');
  addReceipt(f.db, id(2), 'z-fifth-two', 'amber cobalt excluded fifth receipt');
  for (const [receiptId, excerpt] of [['a-first-four', 'plain first'], ['b-second-four', 'plain second'],
    ['c-third-four', 'plain third'], ['d-fourth-four', 'plain fourth']]) {
    addReceipt(f.db, id(4), receiptId, excerpt);
  }
  const runtime = createMemoryRuntime({ path: f.path });
  t.after(() => runtime.close());
  const score = createQueryScore('amber cobalt');
  const page = runtime.queryCandidateRows({ ...ns, projectId: '' }, {
    score, memoryLabel: value => value, sourceReceiptLimit: SOURCE_QUERY_RECEIPT_LIMIT,
  });
  const byId = new Map(page.rows.map(({ item }) => [item.ref.memoryId, item]));
  assert.equal(byId.get(id(1)).label, 'amber cobalt strict winner');
  assert.equal(byId.get(id(2)).label, 'amber first stable receipt wins');
  assert.equal(byId.get(id(3)).label, 'amber positive body tie label');
  assert.equal(byId.get(id(4)).label, 'plain body 4', 'the fifth stable-ID receipt is not a score feature');
  for (const invalid of [-1, 1, 3, 5, 100]) assert.throws(() => runtime.queryCandidateRows(
    { ...ns, projectId: '' }, { score, memoryLabel: value => value, sourceReceiptLimit: invalid }),
  { code: 'invalid_input' });
});

test('malformed persisted source excerpts fail closed before model selection', async t => {
  const f = fixture(t, [id(1)]);
  seed(f.db, 1, () => 'Body without the query', () => 'current', () => 'violet keystone source');
  f.db.prepare('UPDATE receipts SET excerpt=? WHERE memory_id=?').run('x'.repeat(801), id(1));
  assert.deepEqual(await f.core.recall({ readSet: [ns], query: 'violet keystone',
    contextMode: 'source-evidence' }), { ok: false, error: { code: 'storage_error', retryable: false } });
  assert.equal(f.model.calls.length, 0);
});

test('source candidate previews validate authoritative receipt identity before empty selection', async t => {
  for (const contextMode of ['source-evidence', 'rationale-evidence']) {
    for (const corruption of ['excerpt', 'role', 'event-id', 'receipt-key']) {
      const f = fixture(t);
      seed(f.db, 1, () => 'Body without the query', () => 'current',
        () => corruption === 'excerpt' ? 'Original retained source' : 'violet keystone retained source');
      if (corruption === 'excerpt') {
        f.db.prepare('UPDATE receipts SET excerpt=? WHERE memory_id=?')
          .run('violet keystone altered source', id(1));
      }
      if (corruption === 'role') {
        f.db.prepare("UPDATE receipts SET role='assistant' WHERE memory_id=?").run(id(1));
      }
      if (corruption === 'event-id') {
        f.db.prepare("UPDATE receipts SET event_id='changed-valid-source' WHERE memory_id=?").run(id(1));
      }
      if (corruption === 'receipt-key') {
        f.db.prepare("UPDATE receipts SET receipt_key=? WHERE memory_id=?").run('0'.repeat(64), id(1));
      }
      assert.deepEqual(await f.core.recall({ readSet: [ns], query: 'violet keystone', contextMode }),
        { ok: false, error: { code: 'storage_error', retryable: false } }, `${contextMode}/${corruption}`);
      assert.equal(f.model.calls.length, 0, `${contextMode}/${corruption}`);
    }
  }
});

test('source modes read receipts only after namespace, currentness and projection eligibility', async t => {
  for (const contextMode of ['source-evidence', 'rationale-evidence']) {
    for (const exclusion of ['foreign', 'historical', 'forgotten', 'projection']) {
      const f = fixture(t);
      const target = ok(f.core.admit({ namespace: ns,
        memory: { content: 'Eligible compressed interpretation', kind: 'fact' },
        receipts: [{ client: 'test', sessionId: 'eligibility', eventId: 'eligible', role: 'user',
          excerpt: 'cedar sextant eligible retained source' }],
      })).memory;
      f.wanted.push(target.id);
      let excluded;
      if (exclusion === 'foreign') excluded = ok(f.core.admit({
        namespace: { ...ns, ownerId: `foreign-${contextMode}` },
        memory: { content: 'Foreign compressed interpretation', kind: 'fact' },
        receipts: [{ client: 'test', sessionId: 'eligibility', eventId: 'foreign', role: 'user',
          excerpt: 'cedar sextant foreign source' }],
      })).memory;
      if (exclusion === 'historical') {
        excluded = ok(f.core.admit({ namespace: ns,
          memory: { content: 'Historical compressed interpretation', kind: 'fact' },
          receipts: [{ client: 'test', sessionId: 'eligibility', eventId: 'historical', role: 'user',
            excerpt: 'cedar sextant historical source' }],
        })).memory;
        ok(f.core.supersede({ namespace: ns, memoryId: excluded.id, expectedRevision: excluded.revision,
          replacement: { content: 'Current replacement without query terms', kind: 'fact' },
          receipts: [{ client: 'test', sessionId: 'eligibility', eventId: 'replacement', role: 'user',
            excerpt: 'Current replacement retained source' }] }));
      }
      if (exclusion === 'forgotten') {
        excluded = ok(f.core.admit({ namespace: ns,
          memory: { content: 'Forgotten compressed interpretation', kind: 'fact' },
          receipts: [{ client: 'test', sessionId: 'eligibility', eventId: 'forgotten', role: 'user',
            excerpt: 'cedar sextant forgotten source' }],
        })).memory;
        ok(f.core.forget({ namespace: ns, memoryId: excluded.id, expectedRevision: excluded.revision }));
      }
      if (exclusion === 'projection') {
        excluded = ok(f.core.admit({ namespace: ns,
          memory: { content: 'Projection-missing compressed interpretation', kind: 'fact' },
          receipts: [{ client: 'test', sessionId: 'eligibility', eventId: 'projection', role: 'user',
            excerpt: 'cedar sextant projection-missing source' }],
        })).memory;
        const expectedIndexRevision = ok(f.core.map({ namespace: ns })).indexRevision;
        let rebuild = ok(f.core.rebuildIndex({ namespace: ns, expectedIndexRevision, limit: 1 }));
        while (!rebuild.exhausted) rebuild = ok(f.core.rebuildIndex({ namespace: ns,
          expectedIndexRevision, limit: 1, cursor: rebuild.nextCursor }));
        f.db.prepare('DELETE FROM index_memories WHERE id=?').run(excluded.id);
      }
      const poison = `EXCLUDED_${exclusion}_${'x'.repeat(801)}`;
      if (exclusion === 'forgotten') addReceipt(f.db, excluded.id, 'forgotten-poison', poison);
      else f.db.prepare('UPDATE receipts SET excerpt=? WHERE memory_id=?').run(poison, excluded.id);

      const response = await f.core.recall({ readSet: [ns], query: 'cedar sextant', limit: 12, contextMode });
      assert.equal(response.ok, true, JSON.stringify({ contextMode, exclusion, response }));
      const result = response.value;
      assert.deepEqual(result.memories.map(item => item.memory.id), [target.id], `${contextMode}/${exclusion}`);
      const modelInput = JSON.stringify(f.model.calls);
      assert.equal(modelInput.includes('EXCLUDED_'), false, `${contextMode}/${exclusion}`);
      assert.equal(modelInput.includes('cedar sextant eligible retained source'), true, `${contextMode}/${exclusion}`);
    }
  }
});

test('legacy correction and forgetting fence source previews during select and rank', async t => {
  for (const action of ['correct-select', 'forget-rank']) {
    const f = fixture(t);
    const saved = ok(f.core.admit({ namespace: ns,
      memory: { content: `Legacy mutation body ${action}`, kind: 'fact' },
      receipts: [{ client: 'test', sessionId: 'legacy-race', eventId: 'initial', role: 'user',
        excerpt: `cedar sextant legacy source ${action}` }],
    })).memory;
    f.wanted.push(saved.id);
    const legacy = openMemoryStore({ path: f.path }); t.after(() => legacy.close());
    const scope = legacy.scope({ ownerId: ns.ownerId });
    let changed = false;
    f.model.select = ({ input }) => {
      f.model.calls.push({ method: 'select', input });
      if (action === 'correct-select') {
        changed = true;
        scope.correct(saved.id, { content: 'Legacy corrected body', kind: 'fact', receipt: {
          client: 'test', sessionId: 'legacy-race', eventId: 'corrected', role: 'user',
          excerpt: 'Legacy corrected retained source' } }, saved.revision);
      }
      return { refs: refs(input).filter(ref => ref.memoryId === saved.id) };
    };
    f.model.rank = ({ input }) => {
      f.model.calls.push({ method: 'rank', input });
      if (action === 'forget-rank') { changed = true; scope.forget(saved.id, saved.revision); }
      return rank({ input });
    };
    const result = await f.core.recall({ readSet: [ns], query: 'cedar sextant',
      contextMode: 'source-evidence' });
    assert.equal(changed, true, action);
    assert.equal(result.ok, false, action);
    assert.ok(['revision_conflict', 'index_revision_conflict'].includes(result.error.code), action);
    if (action === 'correct-select') assert.equal(f.model.calls.some(call => call.method === 'rank'), false);
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

test('multiple receipt-only targets can reach both select pages without changing body-only discovery', async t => {
  const wanted = [id(223), id(224)];
  const query = 'silver compass';
  const body = i => i <= 200 ? `silver body decoy ${i}` : `Compressed trailing interpretation ${i}`;
  const source = i => wanted.includes(id(i)) ? `Exact silver compass retained source ${i}` : body(i);
  const control = fixture(t, wanted);
  seed(control.db, 224, body, () => 'current', source);
  assert.deepEqual(ok(await recall(control.core, query)).memories, []);
  const f = fixture(t, wanted);
  seed(f.db, 224, body, () => 'current', source);
  const result = ok(await f.core.recall({ readSet: [ns], query, limit: 12,
    contextMode: 'source-evidence' }));
  assert.deepEqual(result.memories.map(item => item.memory.id), wanted);
  assert.deepEqual(result.memories.map(item => item.receipts[0].excerpt),
    ['Exact silver compass retained source 223', 'Exact silver compass retained source 224']);
  assert.equal(f.model.calls.filter(call => call.method === 'select').length, 2);
});

test('current 1023/1024/1025 boundaries skip preceding and interleaved history/tombstones', async (t) => {
  for (const count of [1023, 1024, 1025]) {
    const prefix = 2048;
    const target = prefix + 3 * (count - 1) + 1;
    const f = fixture(t, [id(target)]);
    seed(f.db, prefix + count * 3,
      (i) => i === target ? 'Lantern surviving evidence' : `Unrelated evidence ${i}`,
      (i) => i <= prefix ? (i % 2 ? 'historical' : 'deleted') :
        (i - prefix) % 3 === 1 ? 'current' : (i - prefix) % 3 === 2 ? 'historical' : 'deleted');
    const runtime = createMemoryRuntime({ path: f.path });
    t.after(() => runtime.close());
    const scored = [];
    const score = createQueryScore('Lantern');
    const page = runtime.queryCandidateRows({ ...ns, projectId: '' }, {
      score: (body) => { scored.push(body); return score(body); }, memoryLabel: (body) => body,
    });
    assert.equal(scored.length, Math.min(count, 1024));
    assert.equal(scored.includes('Lantern surviving evidence'), count <= 1024);
    assert.equal(page.rows.length, Math.min(count, 1024));
    assert.equal(page.scanExhausted, count <= 1024);
    const expected = Array.from({ length: Math.min(count, 1024) }, (_, i) => id(prefix + 3 * i + 1));
    assert.deepEqual(page.rows.map(({ item }) => item.ref.memoryId).sort(), expected);
    const result = ok(await recall(f.core));
    assert.deepEqual(result.memories.map(({ memory }) => memory.id), count <= 1024 ? [id(target)] : []);
    if (count <= 1024) assert.equal(result.memories[0].receipts[0].excerpt, 'Lantern surviving evidence');
    assert.equal(result.coverage, 'budget_exhausted', 'candidate pages remain incomplete even when the current scan ends');
    assert.equal(result.namespaces[0].mapExhausted, false);
    assert.equal(f.model.calls.filter((call) => call.method === 'select').length, 2);
  }
});

test('many retired records cannot starve a single current sourced target, including reopen', async (t) => {
  const f = fixture(t, [id(4097)], { rank: [rank, rank] });
  seed(f.db, 4097, (i) => `Lantern evidence ${i}`,
    (i) => i === 4097 ? 'current' : i % 2 ? 'historical' : 'deleted');
  const check = async (core) => {
    const result = ok(await recall(core));
    assert.equal(result.memories[0].memory.id, id(4097));
    assert.equal(result.memories[0].receipts[0].excerpt, 'Lantern evidence 4097');
    assert.equal(result.coverage, 'complete');
  };
  await check(f.core);
  f.close(); // Close every SQLite handle before reopening the persisted store.
  const reopened = openMemoryCore({ path: f.path, model: f.model });
  t.after(() => reopened.close());
  await check(reopened);
  const db = new DatabaseSync(f.path);
  t.after(() => db.close());
  const plan = db.prepare(`EXPLAIN QUERY PLAN SELECT id,revision,content,deleted,currentness
    FROM memories INDEXED BY capture_current_memories
    WHERE owner_id=? AND scope=? AND project_id=? AND deleted=0 AND currentness='current'
    ORDER BY id LIMIT ?`).all(ns.ownerId, ns.scope, '', 1025);
  assert.ok(plan.some(({ detail }) => detail.includes('SEARCH memories USING INDEX capture_current_memories')));
  assert.ok(plan.every(({ detail }) => !detail.includes('TEMP B-TREE')));
});

test('projection-rejected current rows consume allowance and a current sentinel never gives a fake cursor', async (t) => {
  for (const target of [1024, 1025]) {
    const f = fixture(t, [id(target)]);
    seed(f.db, 1025, (i) => `Lantern evidence ${i}`);
    const expectedIndexRevision = ok(f.core.map({ namespace: ns })).indexRevision;
    let page = ok(f.core.rebuildIndex({ namespace: ns, expectedIndexRevision, limit: 500 }));
    while (!page.exhausted) page = ok(f.core.rebuildIndex({ namespace: ns,
      expectedIndexRevision, limit: 500, cursor: page.nextCursor }));
    f.db.prepare('DELETE FROM index_memories WHERE id != ?').run(id(target));
    const envelopes = [];
    f.model.countTokens = (text) => {
      const parsed = text ? JSON.parse(text) : null;
      if (parsed?.value?.items) envelopes.push(parsed.value);
      return 1;
    };
    const result = ok(await recall(f.core));
    assert.deepEqual(result.memories.map(({ memory }) => memory.id), target === 1024 ? [id(target)] : []);
    assert.equal(result.coverage, 'budget_exhausted');
    assert.equal(f.model.calls.filter((call) => call.method === 'select').length, 1);
    assert.equal(envelopes[0].exhausted, false);
    assert.equal(envelopes[0].nextCursor, null);
    assert.equal(envelopes[0].items.length, target === 1024 ? 1 : 0);
  }
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

test('a namespace containing only history and tombstones is complete and never loops', async (t) => {
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

test('source previews retain epoch and revision fences across counter, select and rank mutations', async t => {
  const cases = [
    { phase: 'page-counter', mutation: 'attach' },
    { phase: 'page-counter', mutation: 'rebuild' },
    { phase: 'select', mutation: 'correct' },
    { phase: 'select', mutation: 'filing' },
    { phase: 'rank', mutation: 'forget' },
  ];
  for (const scenario of cases) {
    const f = fixture(t);
    const saved = ok(f.core.admit({ namespace: ns,
      memory: { content: `Compressed source candidate ${scenario.mutation}`, kind: 'fact' },
      receipts: [{ client: 'test', sessionId: 'race', eventId: 'initial', role: 'user',
        excerpt: `violet keystone source for ${scenario.mutation}` }],
    })).memory;
    admit(f.core, `Second row for ${scenario.mutation}`);
    f.wanted.push(saved.id);
    const expectedIndexRevision = ok(f.core.map({ namespace: ns })).indexRevision;
    let changed = false;
    const mutate = () => {
      if (changed) return;
      changed = true;
      if (scenario.mutation === 'attach') ok(f.core.admit({ namespace: ns,
        memory: { content: `Compressed source candidate ${scenario.mutation}`, kind: 'fact' },
        receipts: [{ client: 'test', sessionId: 'race', eventId: 'attached', role: 'user',
          excerpt: 'New attached source' }],
      }));
      if (scenario.mutation === 'rebuild') ok(f.core.rebuildIndex({ namespace: ns,
        expectedIndexRevision, limit: 500 }));
      if (scenario.mutation === 'correct') ok(f.core.correct({ namespace: ns, memoryId: saved.id,
        expectedRevision: saved.revision, content: 'Corrected interpretation', kind: 'fact',
        receipt: { client: 'test', sessionId: 'race', eventId: 'corrected', role: 'user',
          excerpt: 'Corrected retained source' } }));
      if (scenario.mutation === 'filing') ok(f.core.applyPlacement({ namespace: ns,
        proposal: { items: [{ memoryId: saved.id, parentIds: [], newL1: {
          title: 'Racing placement', parentL2Ids: [] } }] },
        expectedMemoryRevisions: [{ memoryId: saved.id, revision: saved.revision }],
        expectedIndexRevision }));
      if (scenario.mutation === 'forget') ok(f.core.forget({ namespace: ns,
        memoryId: saved.id, expectedRevision: saved.revision }));
    };
    f.model.select = ({ input }) => {
      f.model.calls.push({ method: 'select', input });
      if (scenario.phase === 'select') mutate();
      return { refs: refs(input).filter(ref => ref.memoryId === saved.id) };
    };
    f.model.rank = ({ input }) => {
      f.model.calls.push({ method: 'rank', input });
      if (scenario.phase === 'rank') mutate();
      return rank({ input });
    };
    f.model.countTokens = text => {
      const parsed = text ? JSON.parse(text) : null;
      if (scenario.phase === 'page-counter' && parsed?.value?.items?.some(item =>
        item.label?.includes('violet keystone'))) mutate();
      return 1;
    };
    const result = await f.core.recall({ readSet: [ns], query: 'violet keystone',
      contextMode: 'source-evidence' });
    assert.equal(changed, true, JSON.stringify(scenario));
    assert.equal(result.ok, false, JSON.stringify({ scenario, result }));
    assert.ok(['revision_conflict', 'index_revision_conflict'].includes(result.error.code),
      JSON.stringify({ scenario, result }));
    if (scenario.phase === 'page-counter') {
      assert.equal(f.model.calls.some(call => call.method === 'select'), false, JSON.stringify(scenario));
    }
    if (scenario.phase === 'select') {
      assert.equal(f.model.calls.some(call => call.method === 'rank'), false, JSON.stringify(scenario));
    }
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

test('current scan scores at most 1024 bodies, excludes sentinel, and uses the partial namespace index', (t) => {
  const f = fixture(t);
  seed(f.db, 1025, (i) => `記憶 body ${i}`, () => 'current', i => `bounded base receipt ${i}`);
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
    FROM memories INDEXED BY capture_current_memories
    WHERE owner_id=? AND scope=? AND project_id=? AND deleted=0 AND currentness='current'
    ORDER BY id LIMIT ?`).all(ns.ownerId, ns.scope, '', 1025);
  assert.ok(plan.some(({ detail }) => detail.includes('SEARCH memories USING INDEX capture_current_memories')));
  assert.ok(plan.every(({ detail }) => !detail.includes('TEMP B-TREE')));
  const insert = f.db.prepare(`INSERT INTO receipts
    (id,memory_id,receipt_key,client,session_id,event_id,role,excerpt,created_at)
    VALUES (?,?,?,'test','synthetic',?,'user',?,'2026-01-01')`);
  f.db.exec('BEGIN');
  for (let i = 1; i <= 1025; i++) {
    for (let receiptIndex = 1; receiptIndex <= 4; receiptIndex++) {
      const receiptId = `zz-${String(i).padStart(4, '0')}-${receiptIndex}`;
      const excerpt = receiptIndex === 4 ? `fifth excluded receipt ${i}`
        : `bounded receipt ${receiptIndex} for memory ${i}`;
      const source = { client: 'test', sessionId: 'synthetic', eventId: receiptId, role: 'user', excerpt };
      const receiptKey = createHash('sha256').update(JSON.stringify(source)).digest('hex');
      insert.run(receiptId, id(i), receiptKey, receiptId, excerpt);
    }
  }
  f.db.exec('COMMIT');
  const sourceScored = [];
  runtime.queryCandidateRows({ ...ns, projectId: '' }, {
    score: value => { if (!value.startsWith('記憶 body')) sourceScored.push(value); return 0; },
    memoryLabel: value => value, sourceReceiptLimit: SOURCE_QUERY_RECEIPT_LIMIT,
  });
  assert.equal(sourceScored.length, 4096);
  assert.equal(sourceScored.filter(value => value.startsWith('bounded base receipt')).length, 1024);
  assert.equal(sourceScored.some(value => value.startsWith('fifth excluded receipt')), false);
  assert.ok(sourceScored.every(value => value.length <= 800));
  const expectedSourceBytes = Array.from({ length: 1024 }, (_, offset) => offset + 1)
    .flatMap(i => [`bounded base receipt ${i}`, ...Array.from({ length: 3 }, (_, offset) =>
      `bounded receipt ${offset + 1} for memory ${i}`)])
    .reduce((sum, value) => sum + Buffer.byteLength(value), 0);
  assert.equal(sourceScored.reduce((sum, value) => sum + Buffer.byteLength(value), 0), expectedSourceBytes);
  const receiptPlan = f.db.prepare(`EXPLAIN QUERY PLAN SELECT id,memory_id,receipt_key,
    client,session_id,event_id,role,excerpt FROM receipts INDEXED BY capture_memory_receipts
    WHERE memory_id = ? ORDER BY id LIMIT ?`)
    .all(id(1), SOURCE_QUERY_RECEIPT_LIMIT);
  assert.ok(receiptPlan.some(({ detail }) => detail.includes('SEARCH receipts USING INDEX capture_memory_receipts')));
  assert.ok(receiptPlan.every(({ detail }) => !detail.includes('TEMP B-TREE')));
  // These assertions bound returned rows and JS body scoring, not SQLite page
  // I/O, nor the auxiliary current-placement, projection and receipt lookup work.
});

test('missing current partial index fails closed before selection, including reopen', async (t) => {
  const f = fixture(t);
  admit(f.core, 'Lantern private evidence');
  f.db.exec('DROP INDEX capture_current_memories');
  const check = async (core) => {
    assert.deepEqual(await recall(core), { ok: false, error: { code: 'storage_error', retryable: false } });
    assert.equal(f.model.calls.length, 0);
  };
  await check(f.core);
  f.close();
  const reopened = openMemoryCore({ path: f.path, model: f.model });
  t.after(() => reopened.close());
  await check(reopened);
  const db = new DatabaseSync(f.path);
  t.after(() => db.close());
  assert.equal(db.prepare("SELECT count(*) n FROM sqlite_master WHERE name='capture_current_memories'").get().n, 0);
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

import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import test from 'node:test';
import { openMemoryCore } from '../contract.mjs';
import { createMemoryRuntime } from '../runtime.mjs';
import { createQueryScore } from '../query-candidates.mjs';
import { createQueryExcerpt } from '../query-excerpt.mjs';
import { createSourceRanking } from '../source-ranking.mjs';
import { createTestWorkspace } from '../../tools/testing/workspace.mjs';

const namespace = { ownerId: 'idf-structural', scope: 'personal', projectId: null };
const ns = { ...namespace, projectId: '' };
const ok = result => { assert.equal(result.ok, true, JSON.stringify(result)); return result.value; };
const id = index => `synthetic-${String(index).padStart(6, '0')}`;
function fixture(t) {
  const workspace = createTestWorkspace(t, { prefix: 'cairn-idf-structural-' });
  const path = join(workspace.path, 'memory.sqlite');
  const core = openMemoryCore({ path, model: { countTokens: () => 1 } }); workspace.defer(() => core.close());
  const db = new DatabaseSync(path); workspace.defer(() => db.close());
  const runtime = createMemoryRuntime({ path }); workspace.defer(() => runtime.close());
  return { core, db, runtime, path };
}
// Explicit structural/capacity fixture: not admission or product-quality evidence.
function seed(db, count, body = index => `plain ${index}`, sources = index => [body(index)],
  ownerId = ns.ownerId, first = 0) {
  const insert = db.prepare(`INSERT INTO memories
    (id,owner_id,scope,project_id,fingerprint,content,kind,origin,confidence,revision,deleted,
      created_at,updated_at,filing_status,currentness)
    VALUES (?,?,'personal','',?,?,'fact','explicit',1,1,0,'2026-01-01','2026-01-01','unfiled','current')`);
  const source = db.prepare(`INSERT INTO receipts
    (id,memory_id,receipt_key,client,session_id,event_id,role,excerpt,created_at)
    VALUES (?,?,?,'synthetic','idf',?,'user',?,'2026-01-01')`);
  db.exec('BEGIN');
  try {
    for (let index = first; index < first + count; index += 1) {
      insert.run(id(index), ownerId, `fingerprint-${index}`, body(index));
      sources(index).forEach((excerpt, receiptIndex) => {
        const eventId = `event-${index}-${receiptIndex}`;
        const receipt = { client: 'synthetic', sessionId: 'idf', eventId, role: 'user', excerpt };
        const key = createHash('sha256').update(JSON.stringify(receipt)).digest('hex');
        source.run(`${id(index)}-${receiptIndex}`, id(index), key, eventId, excerpt);
      });
    }
    db.exec('COMMIT');
  } catch (error) { db.exec('ROLLBACK'); throw error; }
}
function rows(runtime, query, patch = {}, namespace = ns) {
  return runtime.queryCandidateRows(namespace, { query, sourceRankingPolicy: 'bounded-idf-v1',
    sourceReceiptLimit: 4, score: () => assert.fail('new ranking called old scorer'),
    memoryLabel: createQueryExcerpt(query), ...patch });
}
const items = result => result.rows.map(row => ({ id: row.item.ref.memoryId, label: row.item.label }));

// Independent, deliberately simple oracle: no production tokenizer/scorer/mask.
function oracle(db, query, count = 20_000) {
  const tokens = [...new Set((query.match(/[\p{L}\p{N}]+/gu) ?? []).map(word => word.toLowerCase()))].sort();
  const matches = text => new Set((text.match(/[\p{L}\p{N}]+/gu) ?? []).map(word => word.toLowerCase()));
  const memories = db.prepare(`SELECT id,content FROM memories WHERE owner_id=? AND scope='personal'
    AND project_id='' AND deleted=0 AND review_state!='awaiting' AND currentness='current'
    ORDER BY id LIMIT ?`).all(ns.ownerId, count).map(memory => ({ ...memory,
    passages: [memory.content, ...db.prepare('SELECT excerpt FROM receipts WHERE memory_id=? ORDER BY id LIMIT 4')
      .all(memory.id).map(receipt => receipt.excerpt)] }));
  const weights = new Map(tokens.map(token => {
    const df = memories.filter(memory => memory.passages.some(text => matches(text).has(token))).length;
    return [token, Math.log1p((memories.length - df + 0.5) / (df + 0.5))];
  }));
  return memories.map(memory => {
    let best = -1, winner;
    for (const passage of memory.passages) {
      const present = matches(passage);
      const score = tokens.reduce((sum, token) => sum + (present.has(token) ? weights.get(token) : 0), 0);
      if (score > best) { best = score; winner = passage; }
    }
    // Oracle fixtures use whole short passages, requiring no production excerpt helper.
    assert.ok([...winner].length <= 120);
    return { id: memory.id, score: best, label: winner };
  }).sort((left, right) => right.score - left.score || (left.id < right.id ? -1 : left.id > right.id ? 1 : 0))
    .slice(0, 1024).map(({ id, label }) => ({ id, label }));
}

test('R1 malformed own ranking options reject without storage or accessor access', t => {
  const workspace = createTestWorkspace(t, { prefix: 'cairn-idf-invalid-' });
  const path = join(workspace.path, 'missing', 'memory.sqlite');
  for (const sourceRankingPolicy of [undefined, null, '', 1, {}, 'bounded-idf-v2']) {
    assert.throws(() => openMemoryCore({ path, sourceRankingPolicy }), error => error.code === 'invalid_input');
  }
  let reads = 0;
  assert.throws(() => openMemoryCore({ path,
    get sourceRankingPolicy() { reads += 1; return 'bounded-idf-v1'; } }), error => error.code === 'invalid_input');
  assert.equal(reads, 0);
});

test('R2/R3 private interface matches independent per-memory DF / max-passage oracle', t => {
  const { db, runtime } = fixture(t);
  seed(db, 1131, index => index % 13 === 0 ? 'Amber copper' : `common body ${index}`,
    index => [index % 7 === 0 ? 'copper' : 'common', index % 17 === 0 ? 'amber copper' : 'common',
      'common common common', index % 23 === 0 ? 'rare' : 'common', 'fifthonly']);
  const query = 'common AMBER copper rare fifthonly';
  const result = rows(runtime, query, { sourceCandidatePolicy: 'bounded-keyset-v1' });
  assert.deepEqual(items(result), oracle(db, query));
  assert.deepEqual(result.ranking, { version: 'bounded-idf-v1', physicalRows: 1131,
    eligibleMemories: 1131, maskBytes: 1131 * 5 * 4, queryTokenCount: 5,
    receiptReads: 1131 * 4, retainedRows: 1024,
    retainedReceiptReads: result.ranking.retainedReceiptReads });
  assert.ok(result.ranking.retainedReceiptReads > 0);
  assert.ok(result.ranking.retainedReceiptReads <= 1024);
  assert.equal(result.scanExhausted, false);
  assert.deepEqual(result, rows(runtime, 'rare copper AMBER fifthonly common',
    { sourceCandidatePolicy: 'bounded-keyset-v1' }));
});

test('R2 repetition, duplicates, separate receipts, fifth-only cue, and body/receipt ties', t => {
  const { db, runtime } = fixture(t);
  const bodies = ['plain', 'amber', 'amber copper', 'plain', 'amber copper', 'plain'];
  const receipts = [['amber', 'copper'], ['amber amber amber'], ['amber copper receipt tie'],
    ['plain', 'plain', 'plain', 'plain', 'amber copper'], ['amber copper'], ['copper first', 'copper second']];
  seed(db, bodies.length, index => bodies[index], index => receipts[index]);
  const before = rows(runtime, 'amber copper');
  assert.deepEqual(items(before), oracle(db, 'amber copper', 1024));
  assert.ok(items(before).findIndex(item => item.id === id(2)) < items(before).findIndex(item => item.id === id(0)));
  assert.equal(items(before).find(item => item.id === id(2)).label, 'amber copper');
  assert.equal(items(before).find(item => item.id === id(5)).label, 'copper first');
  assert.equal(items(before).at(-1).id, id(3));
  db.prepare('UPDATE memories SET content=? WHERE id=?').run('amber amber amber unrelated padding', id(1));
  // Receipt duplicates with different stable IDs must not increase per-memory DF.
  const original = db.prepare('SELECT * FROM receipts WHERE memory_id=?').get(id(1));
  const duplicateSource = { client: original.client, sessionId: original.session_id,
    eventId: 'duplicate-event', role: original.role, excerpt: original.excerpt };
  const duplicateKey = createHash('sha256').update(JSON.stringify(duplicateSource)).digest('hex');
  db.prepare(`INSERT INTO receipts (id,memory_id,receipt_key,client,session_id,event_id,role,excerpt,created_at)
    VALUES (?,?,?,?,?,?,?,?,?)`).run(`${id(1)}-duplicate`, id(1), duplicateKey, original.client,
    original.session_id, duplicateSource.eventId, original.role, original.excerpt, original.created_at);
  const after = rows(runtime, 'amber copper');
  assert.deepEqual(items(after).map(item => item.id), items(before).map(item => item.id));
});

test('R2 binary passage scores and union DF are invariant to repetition and unrelated padding', () => {
  function scored(body, receipts) {
    const ranking = createSourceRanking('copper amber amber');
    const masks = ranking.slab(2);
    ranking.add(masks, 0, { id: 'one', revision: 1, content: body }, receipts.map((excerpt, index) => ({ id: `r${index}`, excerpt })));
    ranking.add(masks, 1, { id: 'two', revision: 1, content: 'amber' }, []);
    return ranking.top(2);
  }
  const original = scored('amber copper', ['amber copper']);
  const padded = scored('amber copper amber copper unrelated padding', ['amber copper', 'amber copper']);
  assert.deepEqual(padded, original);
  assert.equal(original[0].score, Math.log1p(0.5 / 2.5) + Math.log1p(1.5 / 1.5));
  assert.equal(original[0].receiptId, undefined, 'body beats different-text receipt on equal weighted overlap');
});

for (const count of [0, 1, 1024, 1025, 20000, 20001]) {
  test(`R3/R4 structural physical boundary ${count}, empty-overlap and zero-token masks`, t => {
    const { db, runtime } = fixture(t);
    seed(db, count);
    for (const sourceCandidatePolicy of [null, 'bounded-keyset-v1']) {
      const visited = Math.min(count, sourceCandidatePolicy ? 20000 : 1024);
      for (const query of ['absent', '!!!']) {
        const result = rows(runtime, query, { sourceCandidatePolicy });
        assert.equal(result.ranking.physicalRows, visited);
        assert.equal(result.ranking.eligibleMemories, visited);
        assert.equal(result.ranking.receiptReads, visited);
        assert.equal(result.ranking.retainedReceiptReads, 0);
        assert.equal(result.ranking.retainedRows, Math.min(visited, 1024));
        assert.equal(result.ranking.maskBytes, visited * 5 * (query === '!!!' ? 0 : 4));
        assert.equal(result.ranking.queryTokenCount, query === '!!!' ? 0 : 1);
        assert.equal(result.scanExhausted, count <= 1024);
        assert.deepEqual(items(result).map(item => item.id), Array.from({ length: Math.min(visited, 1024) }, (_, i) => id(i)));
      }
    }
    const plan = db.prepare(`EXPLAIN QUERY PLAN SELECT id,revision FROM memories INDEXED BY capture_current_memories
      WHERE owner_id=? AND scope=? AND project_id=? AND deleted=0 AND review_state!='awaiting'
      AND currentness='current' AND id>? ORDER BY id LIMIT ?`).all(ns.ownerId, 'personal', '', '', 256);
    assert.ok(plan.some(row => row.detail.includes('SEARCH memories USING INDEX capture_current_memories')));
    assert.ok(plan.every(row => !row.detail.includes('TEMP B-TREE')));
    if (count === 20001) {
      const before = rows(runtime, 'plain', { sourceCandidatePolicy: 'bounded-keyset-v1' });
      db.prepare('UPDATE receipts SET excerpt=? WHERE memory_id=?').run('poison beyond cap', id(20000));
      db.prepare('UPDATE memories SET content=? WHERE id=?').run('plain plain rare', id(20000));
      assert.deepEqual(rows(runtime, 'plain', { sourceCandidatePolicy: 'bounded-keyset-v1' }), before);
    }
  });
}

test('R3 2000 sorted query runs allocate the exact bounded mask payload', t => {
  const { db, runtime } = fixture(t);
  const tokens = Array.from({ length: 2000 }, (_, index) => String.fromCodePoint(0x4e00 + index));
  const query = `${tokens.join(' ')}?`;
  seed(db, 1, () => query, () => [tokens.slice(0, 400).join(' ')]);
  const result = rows(runtime, query);
  assert.equal(result.ranking.queryTokenCount, 2000);
  assert.equal(result.ranking.maskBytes, 5 * 63 * 4);
  assert.equal(result.ranking.retainedReceiptReads, 0);
  assert.equal(items(result)[0].id, id(0));
});

test('R4 projected-out physical rows consume cap; excluded poison never reads; eligible poison fails', t => {
  const { core, db, runtime } = fixture(t);
  seed(db, 1025);
  const epoch = ok(core.map({ namespace })).indexRevision;
  let rebuilt = ok(core.rebuildIndex({ namespace, expectedIndexRevision: epoch, limit: 100 }));
  while (!rebuilt.exhausted) rebuilt = ok(core.rebuildIndex({ namespace,
    expectedIndexRevision: epoch, limit: 100, cursor: rebuilt.nextCursor }));
  db.prepare('DELETE FROM index_memories WHERE id=?').run(id(0));
  // An inactive generation containing the excluded ID cannot restore authority.
  db.prepare('INSERT INTO index_memories(generation,id,revision) VALUES (?,?,?)').run('inactive-generation', id(0), 1);
  db.prepare('UPDATE receipts SET excerpt=? WHERE memory_id=?').run('poison excluded', id(0));
  const bounded = rows(runtime, 'plain');
  assert.equal(bounded.ranking.physicalRows, 1024);
  assert.equal(bounded.ranking.eligibleMemories, 1023);
  assert.equal(bounded.ranking.receiptReads, 1023);
  assert.equal(bounded.scanExhausted, false);
  assert.ok(!items(bounded).some(row => row.id === id(1024)));
  const keyset = rows(runtime, 'plain', { sourceCandidatePolicy: 'bounded-keyset-v1' });
  assert.equal(keyset.ranking.eligibleMemories, 1024);
  assert.equal(keyset.scanExhausted, true);
  assert.ok(items(keyset).some(row => row.id === id(1024)));
  db.prepare('UPDATE receipts SET excerpt=? WHERE memory_id=?').run('poison eligible', id(1));
  assert.throws(() => rows(runtime, 'plain'), error => error.code === 'storage_error');
});

test('R4 namespace/lifecycle isolation and missing indexed access fail closed', t => {
  const { db, runtime } = fixture(t);
  seed(db, 3, index => index === 0 ? 'rare' : 'common');
  const before = rows(runtime, 'rare common');
  seed(db, 30, () => 'rare', () => ['rare'], 'foreign-owner', 100);
  for (const [index, change] of [[100, "deleted=1,content=NULL"], [101, "currentness='historical'"], [102, "review_state='awaiting'"]]) {
    db.prepare(`UPDATE memories SET owner_id=?, ${change} WHERE id=?`).run(ns.ownerId, id(index));
  }
  db.prepare("UPDATE receipts SET excerpt='poison foreign/lifecycle' WHERE memory_id>=?").run(id(100));
  seed(db, 2, () => 'rare', () => ['rare'], ns.ownerId, 200);
  db.prepare("UPDATE memories SET scope='project',project_id='foreign-project' WHERE id=?").run(id(200));
  db.prepare("UPDATE memories SET scope='project',project_id='other-project' WHERE id=?").run(id(201));
  db.prepare("UPDATE receipts SET excerpt='poison other project' WHERE memory_id>=?").run(id(200));
  assert.deepEqual(rows(runtime, 'rare common'), before);
  const old = runtime.queryCandidateRows(ns, { sourceReceiptLimit: 0,
    score: createQueryScore('rare'), memoryLabel: text => text });
  assert.equal(Object.hasOwn(old, 'ranking'), false);
  db.exec('DROP INDEX capture_current_memories');
  assert.throws(() => rows(runtime, 'rare'), /capture_current_memories/);
});

test('R4 each authorized namespace keeps independent DF and masks in either processing order', t => {
  const { db, runtime } = fixture(t);
  seed(db, 3, index => index === 0 ? 'rare' : 'common');
  const before = rows(runtime, 'rare common');
  seed(db, 300, () => 'rare', () => ['rare'], ns.ownerId, 100);
  db.prepare("UPDATE memories SET scope='project',project_id='authorized-project' WHERE id>=?").run(id(100));
  const project = { ...ns, scope: 'project', projectId: 'authorized-project' };
  for (const namespaces of [[ns, project], [project, ns]]) {
    const results = namespaces.map(namespace => rows(runtime, 'rare common', {}, namespace));
    assert.deepEqual(results[namespaces.indexOf(ns)], before);
    const other = results[namespaces.indexOf(project)];
    assert.equal(other.ranking.eligibleMemories, 300);
    assert.equal(other.ranking.maskBytes, 300 * 5 * 4);
  }
});

test('R1 enabled private cursors add ranking binding while omitted and ordinary bindings keep their bytes', async t => {
  const { db, path } = fixture(t);
  seed(db, 201);
  const cursors = [];
  const model = { contextWindow: 8192, countTokens: text => {
    const cursor = JSON.parse(text || 'null')?.value?.nextCursor;
    if (typeof cursor === 'string') cursors.push(cursor);
    return 1;
  }, select: () => ({ refs: [] }), rank: () => ({ refs: [] }) };
  const old = openMemoryCore({ path, model });
  const enabled = openMemoryCore({ path, model, sourceRankingPolicy: 'bounded-idf-v1' });
  try {
    const request = { readSet: [namespace], query: 'absent', contextMode: 'source-evidence' };
    ok(await old.recall(request)); const original = cursors[0]; cursors.length = 0;
    ok(await enabled.recall(request)); const ranked = cursors[0]; cursors.length = 0;
    const decode = cursor => JSON.parse(Buffer.from(cursor.split('.')[0], 'base64url'));
    const originalBinding = decode(original), rankedBinding = decode(ranked);
    assert.equal(Object.hasOwn(originalBinding, 'sourceRankingPolicy'), false);
    assert.equal(rankedBinding.sourceRankingPolicy, 'bounded-idf-v1');
    delete rankedBinding.sourceRankingPolicy;
    assert.deepEqual(rankedBinding, originalBinding);
    assert.notEqual(ranked, original, 'signed cursor changes across ranking policy');
    const ordinary = { readSet: [namespace], query: 'absent' };
    ok(await old.recall(ordinary)); const oldOrdinary = cursors[0]; cursors.length = 0;
    ok(await enabled.recall(ordinary)); assert.equal(cursors[0], oldOrdinary);
  } finally { enabled.close(); old.close(); }
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { openMemoryCore } from '../index.mjs';
import { readTransaction } from '../database.mjs';
import { rankMoc } from '../context-read-moc.mjs';
import { expandRelations, relationIncidentQuery, sourceScopeQuery, sourceReader, sourceBudget, createSourceContext } from '../context-read-relations.mjs';
import { instrumentSourceWork } from '../../tools/testing/context-read-source-work.mjs';
import { sourceFixture, savedSource, ns as rawNs } from '../testing/raw-source-fixtures.mjs';
import { sourcesFixture, ns, ok, memoryRef } from '../testing/context-read-sources-fixture.mjs';

function memoryFixture(t) {
  let db, edges = [];
  const native = DatabaseSync.prototype.prepare;
  const spy = t.mock.method(DatabaseSync.prototype, 'prepare', function (sql) {
    if (/INSERT INTO memories/.test(sql)) db = this;
    return native.call(this, sql);
  });
  const core = openMemoryCore({ path: ':memory:', model: { contextWindow: 32768, countTokens: () => 1, relate: () => ({ edges }) } });
  t.after(() => core.close());
  const admit = content => ok(core.admit({ namespace: ns, memory: { content, kind: 'fact' },
    receipts: [{ client: 'synthetic', sessionId: 'work', eventId: content, role: 'user', excerpt: content }] })).memory;
  const seed = admit('needle direct seed'); spy.mock.restore(); assert.ok(db);
  return { db, seed, admit, async relate(other) {
    edges = [{ from: 0, to: 1, fromReceipt: 0, toReceipt: 0, relation: 'supports-decision' }];
    ok(await core.reviewRationale({ namespace: ns, refs: [other, seed].map(m => ({ memoryId: m.id, revision: m.revision })) }));
  } };
}
function expand(f, database = f.db) {
  return readTransaction(f.db, () => expandRelations(database, {}, {}, { readSet: [ns], types: ['memory'], intent: 'current' }, [{ ref: memoryRef(f.seed) }], Infinity));
}
test('C04/C10 EQP: every incident family/direction is an indexed seek without namespace scans or temp sorts, with/without ANALYZE', t => {
  const f = sourcesFixture(t, { cards: true }); const seed = memoryRef(f.admit('needle'));
  const writer = new DatabaseSync(f.path); t.after(() => writer.close());
  const plans = [];
  for (const analyzed of [false, true]) {
    if (analyzed) writer.exec('ANALYZE');
    for (const family of ['supports-decision', 'challenges-premise', 'contradicts', 'card-memory']) for (const direction of ['incoming', 'outgoing']) {
      const ref = family === 'card-memory' && direction === 'outgoing' ? { type: 'card', namespace: ns, cardId: 'synthetic-card' } : seed;
      const first = relationIncidentQuery(ref, family, direction);
      const after = first.key({ incident_rowid: 1, receipt_id: 'r', card_id: 'c', left_revision: 1, right_revision: 1,
        right_memory_id: 'm', to_id: 'm', relation: family, source: 'explicit-hint', from_receipt: 'r', to_receipt: 'r' });
      for (const continuation of [undefined, after]) {
        const query = relationIncidentQuery(ref, family, direction, continuation);
        const detail = writer.prepare('EXPLAIN QUERY PLAN ' + query.sql).all(...query.args).map(r => r.detail).join('\n');
        assert.match(detail, /SEARCH e USING (?:COVERING )?INDEX/); assert.doesNotMatch(detail, /SCAN|USE TEMP B-TREE|memories|namespace/i);
        plans.push({ analyzed, family, direction, continuation: Boolean(continuation), detail });
      }
    }
  }
  const grouped = relationIncidentQuery(seed, 'card-memory', 'incoming', [1], 'synthetic-card');
  const groupedDetail = writer.prepare('EXPLAIN QUERY PLAN ' + grouped.sql).all(...grouped.args).map(r => r.detail).join('\n');
  assert.match(groupedDetail, /memory_id=\? AND card_id=\? AND rowid>\?/); assert.doesNotMatch(groupedDetail, /SCAN|TEMP B-TREE/);
  assert.equal(plans.length, 32); console.log(JSON.stringify({ kind: 'incident_plans', count: plans.length, plans }));
});
test('C04/C10 2,000 incoming public edges yield two canonical additions; SQLite visits equal charges including repeated support reads', async t => {
  const f = memoryFixture(t), endpoints = [];
  const authored = [];
  for (let i = 0; i < 2000; i++) {
    const other = f.admit('endpoint ' + i); endpoints.push(other); await f.relate(other);
    // Canonical review caps each endpoint at ten incident edges. Archive exact
    // public-authored rows in batches, then restore them together as a deliberate
    // out-of-band high-degree robustness probe (no invented receipt/digest).
    if (i % 10 === 9) { authored.push(...f.db.prepare('SELECT * FROM rationale_edges').all()); f.db.exec('DELETE FROM rationale_edges'); }
  }
  for (const row of authored) f.db.prepare('INSERT INTO rationale_edges VALUES(?,?,?,?,?,?,?,?,?)').run(...Object.values(row));
  const meter = instrumentSourceWork(f.db, { readSet: [ns] }), result = expand(f, meter.database), d = result.diagnostic;
  assert.deepEqual(result.items.slice(1).map(i => i.ref.memoryId), endpoints.map(m => m.id).sort().slice(0, 2));
  assert.equal(d.examined, 2000); assert.equal(d.added, 2); assert.deepEqual(d.reasons, ['capped']);
  assert.equal(d.records, meter.counts.visits); assert.equal(d.lookups, meter.counts.lookups);
  assert.equal(meter.counts.private.visits + meter.counts.private.lookups, 0, 'authorized work cannot enter private accounting');
  // Physical oracle: incident + exact witness + two receipts per edge, one
  // endpoint metadata read per edge and one seed read. Scope and eligibility
  // share metadata; repeated seed validations use the bounded metadata cache.
  assert.equal(meter.counts.visits, 10001);
  assert.equal(meter.counts.byTable.rationale_edges, 4000);
  assert.equal(meter.counts.byTable.memories, 2001); assert.equal(meter.counts.byTable.receipts, 4000);
  assert.equal(d.work, d.records + d.lookups + 6002); // two endpoint checks + one selection check/edge, direct/seed passes
  assert.ok(d.work + d.reservedWork <= 50000); assert.ok(d.peakBytes < 2 * 1024 * 1024);
  console.log(JSON.stringify({ kind: 'high_degree_work', independent: meter.counts, charged: d.work, records: d.records, lookups: d.lookups, peakBytes: d.peakBytes }));
});
test('C10 empty incident streams visit zero namespace records in a large public fixture; counter catches a deliberately scope-driven control', t => {
  const f = memoryFixture(t); for (let i = 0; i < 10000; i++) f.admit('unrelated ' + i);
  for (const analyzed of [false, true]) {
    if (analyzed) f.db.exec('ANALYZE');
    const meter = instrumentSourceWork(f.db, { readSet: [ns] }), result = expand(f, meter.database);
    assert.equal(meter.counts.visits, 0); assert.equal(result.diagnostic.records, 0);
    assert.equal(result.diagnostic.lookups, meter.counts.lookups); assert.ok(result.diagnostic.work < 16);
    // Negative control returns zero rows but visits every Memory. It would pass
    // output-row counting; the WHERE meter must observe the hidden outer scan.
    const control = meter.database.prepare(`SELECT e.* FROM memories m CROSS JOIN memory_conflicts e
      WHERE m.owner_id=? AND m.scope=? AND m.project_id=? AND e.right_memory_id=? AND e.left_memory_id=m.id LIMIT 1`).get(ns.ownerId, ns.scope, ns.projectId, f.seed.id);
    assert.equal(control, undefined); assert.equal(meter.counts.byTable.memories, 10001);
  }
});

test('C05/C10 stale projection records are visited and charged before exact revision rejection', async t => {
  const f = sourcesFixture(t, { sources: ['moc-v1'] });
  const placed = f.topic(f.admit('A projected member'), 'needle projected title');
  ok(f.context.rebuildIndex({ namespace: ns, expectedIndexRevision: placed.indexRevision, limit: 500 }));
  const db = new DatabaseSync(f.path); t.after(() => db.close());
  db.exec('UPDATE index_memory_refs SET memory_revision=memory_revision+1');
  const meter = instrumentSourceWork(db, { readSet: [ns] });
  const result = readTransaction(db, () => rankMoc(meter.database, {}, {}, { readSet: [ns], types: ['memory'], intent: 'current', query: 'needle' }, Infinity));
  assert.equal(result.diagnostic.complete, true); assert.equal(result.diagnostic.topicsMatched, 1);
  assert.equal(result.diagnostic.membersRanked, 0); assert.equal(meter.counts.byTable.index_memory_refs, 1);
  assert.equal(result.diagnostic.records, meter.counts.visits); assert.equal(result.diagnostic.lookups, meter.counts.lookups);
  assert.equal(meter.counts.byTable.namespace_index_state, 1, 'projection state is request cached');
});

test('C08/C10 every public/foreign scope lookup forces its existing ID PK, including 10,000 Cards/Card MOCs with and without ANALYZE', t => {
  const f = sourcesFixture(t, { cards: true }), foreign = { ...ns, ownerId: 'foreign-point-scope' };
  const memory = f.topic(f.admit('Local contributor'), 'Local topic'), alienMemory = f.topic(f.admit('Foreign contributor', foreign), 'Foreign topic', undefined, foreign);
  const card = f.card('Local Card'), alienCard = f.card('Foreign Card', { namespace: foreign });
  const cardTopic = f.cardTopic(card, 'Local Card topic'), alienCardTopic = f.cardTopic(alienCard, 'Foreign Card topic');
  const db = new DatabaseSync(f.path); t.after(() => db.close());
  // Out-of-band density fixture: exact public-authored templates, cloned solely
  // to stress planner choice. These clones are never admitted as evidence.
  db.exec('BEGIN');
  for (const table of ['private_cards', 'card_mocs']) {
    const template = db.prepare(`SELECT * FROM ${table} WHERE owner_id=?`).get(ns.ownerId), columns = Object.keys(template);
    const insert = db.prepare(`INSERT INTO ${table}(${columns.join(',')}) VALUES(${columns.map(() => '?').join(',')})`);
    for (let i = 0; i < 10000; i++) {
      const row = { ...template, id: 'density-' + table + '-' + i };
      if (table === 'card_mocs') { row.title = 'Density ' + i; row.canonical_title = 'density ' + i; }
      insert.run(...columns.map(name => row[name]));
    }
  }
  db.exec('COMMIT'); const plans = [];
  const variants = [
    ['memory', false, memory.memories[0].id, alienMemory.memories[0].id],
    ['memory', true, memory.createdMocs[0].id, alienMemory.createdMocs[0].id],
    ['card', false, card.cardId, alienCard.cardId],
    ['card', true, cardTopic.createdMocRefs[0].mocId, alienCardTopic.createdMocRefs[0].mocId],
  ];
  const meter = instrumentSourceWork(db, { readSet: [ns] });
  for (const analyzed of [false, true]) {
    if (analyzed) db.exec('ANALYZE');
    for (const [type, topic, local, alien] of variants) for (const [scope, id] of [['public', local], ['foreign', alien], ['missing', 'missing-id']]) {
      const sql = sourceScopeQuery(type, { topic }), detail = db.prepare('EXPLAIN QUERY PLAN ' + sql).all(id).map(r => r.detail).join('\n');
      assert.match(detail, /SEARCH .* USING INDEX sqlite_autoindex_.*_1 \(id=\?\)/); assert.doesNotMatch(detail, /SCAN|TEMP B-TREE|private_card_scope|card_mocs_2/);
      const before = structuredClone(meter.counts), budget = sourceBudget(Infinity);
      const reader = sourceReader(meter.database, {}, {}, { readSet: [ns], types: ['memory', 'card'] }, budget);
      const result = readTransaction(db, () => reader.metadata(ns, type, id, { topic }));
      const publicVisits = meter.counts.visits - before.visits, privateVisits = meter.counts.private.visits - before.private.visits;
      assert.equal(publicVisits + privateVisits, scope === 'missing' ? 0 : 1, 'PK reads at most one row, never the 10,000-row namespace');
      assert.equal(budget.stats().records, publicVisits); assert.equal(budget.stats().lookups, meter.counts.lookups - before.lookups);
      assert.equal(budget.stats().work, scope === 'public' ? 2 : scope === 'missing' ? 1 : 0);
      assert.equal(result.scoped, scope === 'public');
      plans.push({ analyzed, type, topic, scope, detail });
    }
    // Reproduce the rejected access path as a negative control. SQL comments
    // must not exempt authorized rows, even when zero rows are returned.
    for (const [table, index, alien] of [['private_cards', 'private_card_scope', alienCard.cardId], ['card_mocs', 'sqlite_autoindex_card_mocs_2', alienCardTopic.createdMocRefs[0].mocId]]) {
      const before = structuredClone(meter.counts);
      const rows = meter.database.prepare(`/* source-private */ SELECT id FROM ${table} INDEXED BY ${index} WHERE owner_id=? AND scope=? AND project_id=? AND id IN (?)`)
        .all(ns.ownerId, ns.scope, ns.projectId, alien);
      assert.equal(rows.length, 0);
      assert.equal(meter.counts.visits - before.visits, 10001, 'independent oracle counts hidden authorized namespace visits');
      assert.equal(meter.counts.lookups - before.lookups, 1);
      assert.equal(meter.counts.private.visits - before.private.visits, 0, 'SQL marker is not an exemption');
    }
  }
  assert.equal(plans.length, 24); console.log(JSON.stringify({ kind: 'scope_pk_plans', count: plans.length, plans }));
});
test('C08/C10 MOC and relation readers share request metadata without duplicate scope/eligibility passes; fresh read phases refetch', t => {
  const f = sourcesFixture(t), memory = f.admit('A shared identity'), context = createSourceContext();
  const meter = instrumentSourceWork(f.db, { readSet: [ns] }), budgets = [sourceBudget(Infinity), sourceBudget(Infinity), sourceBudget(Infinity)];
  readTransaction(f.db, () => {
    for (let i = 0; i < budgets.length; i++) {
      const reader = sourceReader(meter.database, {}, {}, { readSet: [ns], types: ['memory'] }, budgets[i], i < 2 ? context : createSourceContext());
      assert.equal(reader.endpoint(memoryRef(memory)).row.revision, memory.revision);
    }
  });
  assert.equal(meter.counts.visits, 2); assert.equal(meter.counts.lookups, 2);
  assert.deepEqual(budgets.map(b => b.stats().work), [3, 1, 3]);
});

test('C04/C10 mismatched receipt ownership uses one ID seek, charges every physical read, and never returns foreign prose', t => {
  const f = sourcesFixture(t), local = f.admit('Expected source'), other = f.admit('Other authorized source'), foreign = { ...ns, ownerId: 'foreign-receipt-owner' };
  const alien = f.admit('Foreign receipt prose sentinel', foreign);
  const ids = [other, alien].map(m => f.db.prepare('SELECT id FROM receipts WHERE memory_id=?').get(m.id).id);
  const native = DatabaseSync.prototype.prepare, payloads = [];
  t.mock.method(DatabaseSync.prototype, 'prepare', function (sql) {
    const statement = native.call(this, sql), get = statement.get;
    if (sql.includes('CASE WHEN memory_id=')) statement.get = function (...args) { const row = get.apply(this, args); payloads.push(row?.payload); return row; };
    return statement;
  });
  for (let i = 0; i < ids.length; i++) {
    const meter = instrumentSourceWork(f.db, { readSet: [ns] }), budget = sourceBudget(Infinity);
    const reader = sourceReader(meter.database, {}, {}, { readSet: [ns], types: ['memory'] }, budget);
    readTransaction(f.db, () => {
      reader.endpoint(memoryRef(local)); const before = structuredClone(meter.counts), charged = budget.stats().work;
      assert.equal(reader.receipt(local.id, ids[i], 'invalid-digest', ns), false);
      assert.equal(budget.stats().work - charged, i === 0 ? 4 : 0);
      assert.equal(meter.counts.visits - before.visits, i === 0 ? 2 : 0);
      assert.equal(meter.counts.private.visits - before.private.visits, i === 0 ? 0 : 2);
    });
  }
  assert.deepEqual(payloads, [null, null]);
});

test('S1 Raw receipt Card reads through the work oracle and mirrors native transaction state', async t => {
  const f = sourceFixture(t, { model: { extract: () => ({ items: [{ content: 'Synthetic Raw-backed interpretation',
    kind: 'fact', confidence: .8, sourceIndices: [0] }] }) } });
  await savedSource(f, 'Synthetic intact Raw receipt source.');
  const memory = f.db.prepare('SELECT id,revision FROM memories').get();
  const draft = ok(f.call('createCardDraft', { namespace: rawNs, actionId: 'source-work-draft', drafting: 'authored', input: {
    title: 'Synthetic source work Card', body: 'Synthetic authored source work body', sourcePolicy: 'retained-receipts-v1',
    memoryRefs: [{ type: 'memory', namespace: rawNs, memoryId: memory.id, revision: memory.revision }] } }));
  const card = ok(f.call('confirmCardDraft', { namespace: rawNs, cardId: draft.id, expectedRevision: draft.revision,
    actionId: 'source-work-confirm', applicability: 'current' }));
  const ref = { type: 'card', namespace: rawNs, cardId: card.id, revision: card.revision, bodyRevision: card.bodyRevision };
  const identity = f.db.prepare('SELECT store_id AS storeId,cursor_secret AS cursorSecret FROM store_metadata').get();
  f.db.exec('ANALYZE');
  const meter = instrumentSourceWork(f.db, { readSet: [rawNs] }), outside = meter.database.isTransaction;
  const row = readTransaction(f.db, () => {
    const reader = sourceReader(meter.database, identity, { cards: true, receipts: true, reviews: true },
      { readSet: [rawNs], types: ['card'], intent: 'current' }, sourceBudget(Infinity));
    const result = reader.endpoint(ref);
    assert.equal(result.reason, undefined); assert.equal(result.row.id, card.id);
    assert.equal(meter.database.isTransaction, f.db.isTransaction); assert.equal(meter.database.isTransaction, true);
    return result.row;
  });
  assert.equal(row.id, card.id); assert.ok(meter.counts.visits > 0);
  assert.equal(outside, false); assert.equal(meter.database.isTransaction, f.db.isTransaction);
  assert.equal(meter.database.isTransaction, false);
});

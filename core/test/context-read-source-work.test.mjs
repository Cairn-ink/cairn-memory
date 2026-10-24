import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { openMemoryCore } from '../index.mjs';
import { readTransaction } from '../database.mjs';
import { rankMoc } from '../context-read-moc.mjs';
import { expandRelations, relationIncidentQuery } from '../context-read-relations.mjs';
import { instrumentSourceWork } from '../../tools/testing/context-read-source-work.mjs';
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
  const meter = instrumentSourceWork(f.db), result = expand(f, meter.database), d = result.diagnostic;
  assert.deepEqual(result.items.slice(1).map(i => i.ref.memoryId), endpoints.map(m => m.id).sort().slice(0, 2));
  assert.equal(d.examined, 2000); assert.equal(d.added, 2); assert.deepEqual(d.reasons, ['capped']);
  assert.equal(d.records, meter.counts.visits); assert.equal(d.lookups, meter.counts.lookups);
  assert.ok(meter.counts.private.visits > 0); assert.ok(meter.counts.private.lookups + meter.counts.private.visits <= 50000);
  // Public oracle: each edge visits itself, its authorized endpoint metadata,
  // two validated endpoints, the exact witness again, and two receipt records.
  assert.equal(meter.counts.visits, 2000 * 7);
  assert.equal(meter.counts.byTable.rationale_edges, 4000);
  assert.equal(meter.counts.byTable.memories, 6000); assert.equal(meter.counts.byTable.receipts, 4000);
  assert.equal(d.work, d.records + d.lookups + 6002); // two endpoint checks + one selection check/edge, direct/seed passes
  assert.ok(d.work + d.reservedWork <= 50000); assert.ok(d.peakBytes < 2 * 1024 * 1024);
  console.log(JSON.stringify({ kind: 'high_degree_work', independent: meter.counts, charged: d.work, records: d.records, lookups: d.lookups, peakBytes: d.peakBytes }));
});
test('C10 empty incident streams visit zero namespace records in a large public fixture; counter catches a deliberately scope-driven control', t => {
  const f = memoryFixture(t); for (let i = 0; i < 10000; i++) f.admit('unrelated ' + i);
  for (const analyzed of [false, true]) {
    if (analyzed) f.db.exec('ANALYZE');
    const meter = instrumentSourceWork(f.db), result = expand(f, meter.database);
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
  const meter = instrumentSourceWork(db);
  const result = readTransaction(db, () => rankMoc(meter.database, {}, {}, { readSet: [ns], types: ['memory'], intent: 'current', query: 'needle' }, Infinity));
  assert.equal(result.diagnostic.complete, true); assert.equal(result.diagnostic.topicsMatched, 1);
  assert.equal(result.diagnostic.membersRanked, 0); assert.equal(meter.counts.byTable.index_memory_refs, 1);
  assert.equal(result.diagnostic.records, meter.counts.visits); assert.equal(result.diagnostic.lookups, meter.counts.lookups);
  assert.equal(meter.counts.byTable.namespace_index_state, 1, 'projection state is request cached');
});

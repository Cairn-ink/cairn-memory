import test from 'node:test';
import assert from 'node:assert/strict';
import { StatementSync } from 'node:sqlite';
import { openMemoryCore } from '../index.mjs';
import { transaction } from '../database.mjs';
import { lineageFixture, ns, ok, receipt } from '../testing/card-lineage-fixture.mjs';
import { host as roleHost, publish, read } from './role-fixture.mjs';
import { trace } from '../testing/shared-source-fixture.mjs';

const normalize = sql => sql.replace(/\s+/g, ' ').trim();

test('multi-state Card warming bounds each state before the global merge as populations grow', {timeout: 20000}, async t => {
  const f = await lineageFixture(t, {base: 33});
  const source = f.note('synthetic-bounded-note');
  const cards = [f.draft([source], 'synthetic-bounded-first'), f.draft([source], 'synthetic-bounded-second')];
  const first = cards.map(card => card.id).sort((a,b) => Buffer.compare(Buffer.from(a),Buffer.from(b)))[0];
  const insert = f.db.prepare(`INSERT INTO private_cards VALUES(?,?,?,?,1,?,?,?,1,?,?,NULL)`);
  let seeded = 0;
  for (const population of [1100, 2200]) {
    // Only irrelevant metadata grows. The real deliverable Card and its
    // contributors stay fixed, behind a cancelled low-ID prefix.
    transaction(f.db, () => {
      for (let i = seeded; i < population; i++) for (const state of ['cancelled','draft','confirmed']) {
        const id = (state === 'cancelled' ? '!' : 'z') + state + String(i).padStart(5, '0');
        insert.run(id, ns.ownerId, ns.scope, ns.projectId, state,
          state === 'cancelled' ? null : 'Synthetic title', state === 'cancelled' ? null : 'Synthetic body',
          '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z');
      }
    });
    seeded = population;
    const original = StatementSync.prototype.all, probes = [], unions = [];
    StatementSync.prototype.all = function (...args) {
      const sql = normalize(this.sourceSQL), rows = Reflect.apply(original, this, args);
      if (sql.startsWith('SELECT id FROM private_cards WHERE')) probes.push({sql,args,rows});
      if (sql.startsWith('SELECT c.id AS card_id,r.receipt_key') && sql.includes('card_memory_bindings')) unions.push(args);
      return rows;
    };
    let result;
    try { result = ok(f.call('listCards', {states: ['draft','confirmed'], limit: 1})); }
    finally { StatementSync.prototype.all = original; }
    assert.deepEqual(result.cards.map(row => row.id), [first]);
    assert.equal(probes.length, 2);
    assert.deepEqual(probes.map(row => row.args[3]).sort(), ['confirmed','draft']);
    for (const probe of probes) {
      assert.match(probe.sql, /state=\? AND id>\? ORDER BY id LIMIT \?$/);
      assert.equal(probe.args.at(-1), 1024); assert.equal(probe.rows.length, 1024);
      const plan = f.db.prepare('EXPLAIN QUERY PLAN ' + probe.sql).all(...probe.args);
      assert.equal(plan.some(row => /TEMP B-TREE|SCAN/.test(row.detail)), false);
      assert.ok(plan.some(row => row.detail.includes('state=?') && row.detail.includes('id>?')));
    }
    const merged = probes.flatMap(row => row.rows).sort((a,b) => Buffer.compare(Buffer.from(a.id), Buffer.from(b.id)))
      .slice(0,1024).map(row => row.id);
    assert.equal(unions.length, 1);
    assert.deepEqual(JSON.parse(unions[0][0]), merged, 'only the globally first bounded IDs warm tokens');
  }
});

test('role context keeps independent evidence after sixteen withheld leading receipts', {timeout: 15000}, async t => {
  const f = await lineageFixture(t, {base: 33});
  let b, a;
  for (let start = 0; start < 16; start += 4) {
    const receipts = Array.from({length: 4}, (_, i) => receipt('synthetic-role-shared-' + (start+i), 'Synthetic withheld role evidence'));
    b = ok(f.core.admit({namespace: ns, memory: {content: 'Synthetic role survivor', kind: 'fact'}, receipts})).memory;
    a = ok(f.core.admit({namespace: ns, memory: {content: 'Synthetic role sibling', kind: 'fact'}, receipts})).memory;
  }
  ok(f.core.forget({namespace: ns, memoryId: a.id, expectedRevision: a.revision}));
  b = ok(f.core.admit({namespace: ns, memory: {content: 'Synthetic role survivor', kind: 'fact'},
    receipts: [receipt('synthetic-role-independent', 'Synthetic later independent role evidence')]})).memory;
  f.db.prepare('UPDATE receipts SET created_at=? WHERE memory_id=?').run('2026-01-01T00:00:00.000Z',b.id);
  f.db.prepare('UPDATE receipts SET created_at=? WHERE memory_id=? AND event_id=?')
    .run('2026-01-02T00:00:00.000Z',b.id,'synthetic-role-independent');
  const withheld = f.db.prepare('SELECT id FROM receipts WHERE memory_id=? AND event_id!=?').all(b.id,'synthetic-role-independent');
  const other=ok(f.core.admit({namespace:ns,memory:{content:'Synthetic role survivor other',kind:'fact'},
    receipts:[receipt('synthetic-role-other','Synthetic other role evidence')]})).memory;
  const h = roleHost({counter: {id: 'synthetic', countTokens: () => 1}});
  const roles = openMemoryCore({path: f.path, methodPackages: h.methods, assets: h.assets, roleProfiles: h.options, contextRead: h.context});
  t.after(() => roles.close());
  ok(roles.publishRoleProfileRelease(publish(ns,'synthetic-evidence-role','synthetic-role-publish'),{}));
  const measured=await trace(()=>roles.readRoleTaskContext({...read('synthetic-evidence-role',[ns]),task:'Synthetic role survivor'},{}));
  const result = ok(measured.result);
  const text = JSON.stringify(result);
  assert.ok(text.includes(b.id)); assert.ok(text.includes('Synthetic later independent role evidence'));
  assert.equal(text.includes('Synthetic withheld role evidence'),false);
  for (const row of withheld) assert.equal(text.includes(row.id),false);
  assert.ok(text.includes(other.id));
  const collectors=measured.rows.filter(row=>row.sql.includes('CROSS JOIN qualification_anchors q'));
  assert.equal(collectors.length,2,'one anchor collection in preparation and one in final delivery');
  assert.equal(new Set(collectors.map(row=>row.snapshot)).size,2);
  for(const collector of collectors)assert.deepEqual(JSON.parse(collector.args[0]).map(job=>job.id).sort(),[b.id,other.id].sort());
});

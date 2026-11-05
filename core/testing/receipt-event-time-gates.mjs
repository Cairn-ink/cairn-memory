import { after } from 'node:test';
import assert from 'node:assert/strict';
import { safetyFixture, ns } from './content-safety-s2h-fixture.mjs';
import { eventTimeSafetyFixture } from './receipt-event-time-fixture.mjs';
import { transaction } from '../database.mjs';
import { writeContentSuppressionInside } from '../content-suppression-storage.mjs';
import { measureContentRead } from './content-safety-cost-meter.mjs';

// Count completed cases, not registrations. A removed loop iteration, duplicate
// case, skipped test or early return cannot satisfy the gate's inventory.
export function familyGate(gate, expected) {
  const completed = [];
  after(() => {
    assert.equal(completed.length, expected, `family gate ${gate}: exact completed case count`);
    assert.equal(new Set(completed).size, expected, `family gate ${gate}: unique cases`);
  });
  return key => completed.push(key);
}

export function seedFamilyCostFacts(db, facts, namespace = ns) {
  transaction(db, () => {
    for (let i = 0; i < facts; i++) writeContentSuppressionInside(db, {
      namespace, kind: 'memory', key: 'unrelated-' + i, reason: 'purge', actionId: 'fact-' + i,
    });
  });
}

export function assertFamilyCostCell(db, physical, facts) {
  assert.equal(db.prepare('PRAGMA user_version').get().user_version, physical, 'actual physical cost cell');
  assert.equal(db.prepare('SELECT count(*) n FROM content_suppressions WHERE owner_id=?').get(ns.ownerId).n,
    facts, 'actual owner fact count');
}

// Each caller prepares one real invocation at its smallest existing size.
// Setup and fixture attestation are outside the measured request window.
export async function familyCostParity(t, base, prepare, { factNamespace = ns } = {}) {
  const rows = [];
  for (const facts of [0, 5]) {
    const pair = [];
    for (const [kind, fixture, physical] of [
      ['safety', safetyFixture, { 23: 38, 33: 48 }[base]],
      ['family', eventTimeSafetyFixture, { 23: 52, 33: 53 }[base]],
    ]) {
      const f = fixture(t, base); await f.migrate();
      const db = f.connect(); t.after(() => db.close());
      const request = await prepare(f, db, facts);
      seedFamilyCostFacts(db, facts, factNamespace);
      assertFamilyCostCell(db, physical, facts);
      await request.beforeMeasure?.();
      const row = request.measure ? await request.measure()
        : await measureContentRead(request.method, request.variant, request.call, request.ports);
      request.check(row.result, row);
      pair.push(row);
      rows.push({ kind, physical, facts, method: row.method, variant: row.variant,
        counts: [row.statements, row.begin, row.ports, row.hostInvocations] });
    }
    assert.equal(pair.length, 2, 'both cost cells measured');
    assert.deepEqual([pair[1].statements, pair[1].begin, pair[1].ports, pair[1].hostInvocations],
      [pair[0].statements, pair[0].begin, pair[0].ports, pair[0].hostInvocations], 'exact family/safety cost parity');
    const boundaries = row => row.trace?.map(({ sql, transaction }) =>
      [sql.includes('owner_suppression_epochs') ? 'epoch' : 'header', transaction]);
    assert.deepEqual(boundaries(pair[1]), boundaries(pair[0]), 'same header and E1 snapshot boundaries');
    assert.deepEqual([pair[1].result?.ok, pair[1].result?.error?.code],
      [pair[0].result?.ok, pair[0].result?.error?.code], 'same public outcome');
  }
  assert.deepEqual(rows.map(({ kind, facts }) => [kind, facts]),
    [['safety', 0], ['family', 0], ['safety', 5], ['family', 5]], 'gate B: four measured cells, two exact comparisons');
  t.diagnostic('FAMILY_COST_PARITY ' + JSON.stringify(rows));
}

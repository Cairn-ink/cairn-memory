import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { syncBuiltinESMExports } from 'node:module';
import { engineCardFixture, ns, ok } from '../../core/testing/engine-card-fixture.mjs';

// Offline and synthetic: the only model is a deterministic script. The real
// tokenizer and ordinary contextRead packing report their exact envelope cost.
const fixtures = [];
const original = { Date: globalThis.Date, randomUUID: crypto.randomUUID, randomBytes: crypto.randomBytes };
let ordinal = 0;
crypto.randomUUID = () => `00000000-0000-4000-8000-${(++ordinal).toString(16).padStart(12, '0')}`;
crypto.randomBytes = length => Buffer.alloc(length, 17);
globalThis.Date = class extends original.Date {
  constructor(...args) { super(...(args.length ? args : ['2026-05-01T00:00:00.000Z'])); }
  static now() { return original.Date.parse('2026-05-01T00:00:00.000Z'); }
};
syncBuiltinESMExports();
try {
  let edges;
  const large = engineCardFixture(null, { cardRelations: { read: () => edges } }); fixtures.push(large);
  const a = large.file(large.seed(), 'Orion');
  const b = large.file(large.seed(5, 'Vega'), 'Vega');
  const c = large.file(Array.from({ length: 5 }, (_, i) => large.add('Compass slot value ' + i)), 'Compass');
  const memories = a.memories;
  edges = c.memories.slice(1).map((m, i) => ({ from: m.id, to: c.memories[i].id, kind: 'supersedes', slot: 'compass-status' }));
  const built = ok(await large.pass()); assert.equal(built.built.length, 1);
  assert.equal(built.built[0].clusterKey, 'moc:' + a.mocId);
  ok(await large.refresh());
  const withCard = ok(await large.read('what is the current state of Orion'));
  const withoutCard = ok(await large.read('what is the current state of Orion', { types: ['memory'] }));
  assert.ok(withCard.metered.items.some(item => item.ref.type === 'card'));
  assert.equal(withCard.metered.items.some(item => item.ref.type === 'memory'), false);
  const fact = ok(await large.read('Orion marker17'));
  assert.equal(fact.metered.items[0].ref.id, memories[17].id);
  ok(large.core.forget({ namespace: ns, memoryId: memories[0].id, expectedRevision: memories[0].revision }));
  ok(await large.refresh()); const fallback = ok(await large.read('what is the current state of Orion'));
  assert.ok(fallback.metered.items.length && fallback.metered.items.every(item => item.ref.type === 'memory'));
  const changed = ok(await large.pass()); assert.equal(changed.built.length, 1);
  assert.equal(changed.built[0].clusterKey, 'moc:' + c.mocId);
  const evolution = large.db.prepare('SELECT body FROM private_cards WHERE id=?').get(changed.built[0].id).body;
  assert.match(evolution.split('\n')[0], /Compass current state: Compass slot value 4/);
  for (let value = 0; value < 4; value++) assert.ok(evolution.includes('Compass slot value ' + value));
  assert.equal(large.db.prepare("SELECT count(*) n FROM card_operations WHERE method='consolidate' AND json_extract(result,'$.clusterKey')=?")
    .get('moc:' + b.mocId).n, 0);
  const absent = engineCardFixture(null); fixtures.push(absent);
  absent.file(absent.seed(), 'Orion'); absent.file(absent.seed(5, 'Vega'), 'Vega');
  absent.file(Array.from({ length: 5 }, (_, i) => absent.add('Compass slot value ' + i)), 'Compass');
  assert.equal(ok(await absent.pass()).built.length, 1);
  assert.equal(ok(await absent.pass()).built.length, 0);
  const chain = { present: changed.built.length, absent: 0 };
  console.log(JSON.stringify({ tokenizer: 'o200k_base', large: { memories: 30, days: 60, conversations: 6,
    cards: built.built.length, withCardTokens: withCard.diagnostics.budget.used, withoutCardTokens: withoutCard.diagnostics.budget.used,
    fallbackTokens: fallback.diagnostics.budget.used }, small: { memories: 5, cards: 0 }, chain,
    namespaceTopics: 3, factRead: 'memory', forgottenSource: 'stale-card-excluded' }, null, 2));
} finally {
  try { for (const f of fixtures.reverse()) await f.workspace.cleanup(); }
  finally {
    globalThis.Date = original.Date; crypto.randomUUID = original.randomUUID; crypto.randomBytes = original.randomBytes;
    syncBuiltinESMExports();
  }
}

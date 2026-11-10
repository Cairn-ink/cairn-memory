import test from 'node:test';
import assert from 'node:assert/strict';
import { openMemoryCore } from '../index.mjs';
import { contentSafetyFacade } from '../content-safety-boundary.mjs';
import { transaction } from '../database.mjs';
import { contentSafetyInventory } from '../content-safety-migration.mjs';
import { writeContentSuppressionInside } from '../content-suppression-storage.mjs';
import { scriptedConsolidator } from '../testing/engine-card-fixture.mjs';
import { safetyFixture, ns, ok, receipt } from '../testing/content-safety-s2h-fixture.mjs';

async function setup(t) {
  const fixture = safetyFixture(t, 23);
  await fixture.migrate();
  const core = openMemoryCore({ path: fixture.path, model: scriptedConsolidator() });
  const db = fixture.connect();
  t.after(() => { core.close(); db.close(); });
  const memories = Array.from({ length: 8 }, (_, i) => {
    const content = `Orion synthetic milestone ${i}: shared implementation evidence marker${i}.`;
    const memory = ok(core.admit({ namespace: ns, memory: { content, kind: 'fact' },
      receipts: [{ ...receipt(content), sessionId: 'synthetic-' + i }] })).memory;
    db.prepare('UPDATE memories SET created_at=? WHERE id=?')
      .run(new Date(Date.UTC(2026, 0, 1 + i * 10)).toISOString(), memory.id);
    return memory;
  });
  const result = ok(await core.maintainCards({ namespace: ns, budget: { maxMs: 5000 } }));
  assert.equal(result.built.length, 1, JSON.stringify(result));
  return { core, db, memories, acknowledgement: result.built[0] };
}

// Compare every key, including non-identity keys and nested source revisions.
// Shorthand properties deliberately need no textual census format extension.
function keyTree(value) {
  if (Array.isArray(value)) return value.map(keyTree);
  if (!value || typeof value !== 'object') return typeof value;
  return Object.fromEntries(Reflect.ownKeys(value).sort().map(key => [key, keyTree(value[key])]));
}

test('maintainCards built acknowledgement has exactly the generated Card and source revision shape', async t => {
  const { db, memories, acknowledgement } = await setup(t);
  const card = db.prepare("SELECT id,revision FROM private_cards WHERE state='confirmed'").get();
  const metadata = JSON.parse(db.prepare("SELECT result FROM card_operations WHERE method='consolidate'").get().result);
  const expected = { id: card.id, revision: card.revision, origin: 'engine',
    builtAt: acknowledgement.builtAt, clusterKey: acknowledgement.clusterKey,
    sourceRevisions: memories.map(memory => ({ memoryId: memory.id, revision: memory.revision }))
      .sort((a, b) => a.memoryId.localeCompare(b.memoryId)) };
  assert.match(card.id, /^engine-card\.[0-9a-f-]+$/u);
  assert.equal(Number.isFinite(Date.parse(expected.builtAt)), true);
  assert.equal(typeof expected.clusterKey, 'string');
  assert.deepEqual(keyTree(acknowledgement), keyTree(expected), 'full recursive acknowledgement key set');
  assert.deepEqual(acknowledgement, expected, 'canonical generated Card id, revision and every source revision');
  assert.deepEqual(metadata, expected, 'persisted acknowledgement matches delivered built row');
});

// Re-enter the same facade/native pre-COMMIT path with a real generated DTO.
// A changed sentinel proves that refusal precedes commit and delivery.
function deliver(db, acknowledgement, ledger = false) {
  const api = contentSafetyFacade({ maintainCards() {
    return transaction(db, () => {
      db.prepare("UPDATE memories SET updated_at=updated_at||'synthetic-uncommitted' WHERE id=?")
        .run(db.prepare('SELECT id FROM memories ORDER BY id LIMIT 1').get().id);
      if (ledger) {
        db.prepare("INSERT INTO card_operations SELECT owner_id,scope,project_id,'synthetic-replay',method,payload_binding,?, ?,created_at FROM card_operations WHERE method='consolidate'")
          .run(acknowledgement.id, JSON.stringify(acknowledgement));
      }
      return { ok: true, value: { built: ledger ? [] : [acknowledgement] } };
    });
  } }, { check() {}, failure: error => ({ ok: false, error: { code: error.code } }) });
  return api.maintainCards({ namespace: ns });
}

function refused(db, acknowledgement, label, ledger = false) {
  const before = contentSafetyInventory(db);
  const result = deliver(db, acknowledgement, ledger);
  assert.equal(result.ok, false, label + ' must not be delivered');
  assert.equal(result.error.code, 'evidence_unavailable', label);
  assert.equal(contentSafetyInventory(db), before, label + ' rolls back all writes');
}

test('native acknowledgement guard resolves generated Card ids and validates every bound source revision before delivery', async t => {
  const { core, db, acknowledgement } = await setup(t);
  assert.equal(deliver(db, acknowledgement).ok, true, 'valid generated acknowledgement control');
  for (const ledger of [false, true]) {
    refused(db, { ...acknowledgement, id: 'engine-card.synthetic-missing' }, 'unresolved Card id', ledger);
    for (const index of acknowledgement.sourceRevisions.keys()) {
      const forged = structuredClone(acknowledgement);
      forged.sourceRevisions[index].memoryId = 'synthetic-missing-memory';
      refused(db, forged, 'unresolved source at position ' + index, ledger);
    }
  }
  const content = 'Synthetic independent revision validation control';
  const held = ok(core.admit({ namespace: ns, memory: { content, kind: 'fact' }, receipts: [receipt(content)] })).memory;
  transaction(db, () => writeContentSuppressionInside(db, { namespace: ns, kind: 'memory', key: held.id,
    matchMode: 'version', sourceVersion: JSON.stringify(['memory-revision-v1', held.revision]),
    reason: 'privacy_erase', actionId: 'synthetic-revision-denial' }));
  db.prepare('UPDATE memories SET revision=revision+1 WHERE id=?').run(held.id);
  const current = structuredClone(acknowledgement);
  current.sourceRevisions[0] = { memoryId: held.id, revision: held.revision + 1 };
  assert.equal(deliver(db, current).ok, true, 'current revision is readable despite a fact for the older revision');
  // The Card and all its real sources remain readable. Only the substituted
  // bound revision is denied, so Card validation cannot mask a skipped walk.
  for (const ledger of [false, true]) for (const index of acknowledgement.sourceRevisions.keys()) {
    const forged = structuredClone(acknowledgement);
    forged.sourceRevisions[index] = { memoryId: held.id, revision: held.revision };
    refused(db, forged, 'suppressed source revision at position ' + index, ledger);
  }
  transaction(db, () => writeContentSuppressionInside(db, { namespace: ns, kind: 'card', key: acknowledgement.id,
    reason: 'privacy_erase', actionId: 'synthetic-card-denial' }));
  for (const ledger of [false, true]) refused(db, acknowledgement, 'suppressed generated Card', ledger);
});

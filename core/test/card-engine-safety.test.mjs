import test from 'node:test';
import assert from 'node:assert/strict';
import { lineageFixture, ns, ok, receipt } from '../testing/card-lineage-fixture.mjs';
import { scriptedConsolidator, engineCardFixture } from '../testing/engine-card-fixture.mjs';
import { host } from '../testing/context-read-core-fixture.mjs';
import { transaction } from '../database.mjs';
import { writeContentSuppressionInside } from '../content-suppression-storage.mjs';
import { contentReadSafety } from '../content-safety.mjs';
import { sourceFixture, savedSource, ns as rawNs } from '../testing/raw-source-fixtures.mjs';
import { createEngineCardStorage } from '../engine-card-storage.mjs';
import { createEngineCardMaintenance } from '../engine-card-maintenance.mjs';
import { withContentWriteOperation } from '../content-write-context.mjs';

for (const change of ['forget', 'suppressed', 'denied', 'revision']) test(`engine-origin sealed lineage refuses ${change} in current and history reads`, async t => {
  const trusted = host(), model = scriptedConsolidator();
  const f = await lineageFixture(t, { options: { model,
    contextRead: { version: 'context-read-v1', authority: trusted.authority,
      counter: { id: 'synthetic', countTokens: model.countTokens } } } });
  const memories = Array.from({ length: 8 }, (_, i) => {
    const memory = ok(f.core.admit({ namespace: ns, memory: { content: 'Orion milestone ' + i, kind: 'fact' },
      receipts: [{ ...receipt('source-' + i), sessionId: 'conversation-' + i % 3 }] })).memory;
    f.db.prepare('UPDATE memories SET created_at=? WHERE id=?').run(new Date(Date.UTC(2026, 0, 1 + i * 3)).toISOString(), memory.id);
    return memory;
  });
  const pass = ok(await f.core.maintainCards({ namespace: ns, budget: { maxMs: 5000 } }));
  assert.equal(pass.built.length, 1, JSON.stringify(pass)); const card = pass.built[0];
  const header = f.db.prepare('SELECT * FROM card_body_provenance WHERE card_id=?').get(card.id);
  assert.equal(header.completeness, 'complete'); assert.equal(header.source_count, 16);
  const cardRef = () => { const row = f.row(card.id); return { type: 'card', namespace: ns,
    cardId: card.id, revision: row.revision, bodyRevision: row.body_revision }; };
  assert.equal(contentReadSafety(f.db, { identity: f.identity, namespace: ns, ref: cardRef(), method: 'getCard' }).allowed, true);
  const projection = { readSet: [ns], types: ['memory', 'card'], intent: 'current' };
  ok(await trusted.call(f.core, 'refreshContextIndex', { ...projection, budget: { maxItems: 1024, maxMs: 5000 } }));
  if (change === 'forget') ok(f.core.forget({ namespace: ns, memoryId: memories[0].id, expectedRevision: memories[0].revision }));
  else if (change === 'revision') f.db.prepare('UPDATE memories SET revision=revision+1 WHERE id=?').run(memories[0].id);
  else transaction(f.db, () => writeContentSuppressionInside(f.db, { namespace: ns, kind: change === 'denied' ? 'namespace' : 'memory',
    key: change === 'denied' ? '' : memories[0].id, ...(change === 'denied' ? { matchMode: 'namespace' } : {}),
    reason: 'privacy_erase', actionId: 'synthetic-denial' }));
  assert.equal(contentReadSafety(f.db, { identity: f.identity, namespace: ns, ref: cardRef(), method: 'getCard' }).allowed, false);
  for (const intent of ['current', 'history']) {
    const result = await trusted.call(f.core, 'contextRead', { ...projection, intent, query: 'Orion current state',
      raw: false, semantic: false, deadlineMs: 5000 });
    assert.doesNotMatch(JSON.stringify(result), /Orion current state:/);
  }
});

test('owner and namespace clusters never combine recurrence or share Card sources', async t => {
  const f = engineCardFixture(t);
  for (const namespace of [ns, { ...ns, scope: 'personal', projectId: null }, { ...ns, ownerId: 'other-owner' }]) {
    for (let i = 0; i < 4; i++) f.add('Orion shared evidence ' + i, i * 10, i, namespace);
  }
  assert.equal(ok(await f.pass()).built.length, 0); assert.equal(f.model.calls.length, 0);
  f.seed(8); const card = ok(await f.pass()).built[0]; assert.ok(card);
  const ids = new Set(f.db.prepare('SELECT id FROM memories WHERE owner_id=? AND scope=? AND project_id=?')
    .all(ns.ownerId, ns.scope, ns.projectId).map(m => m.id));
  assert.ok(card.sourceRevisions.every(ref => ids.has(ref.memoryId)));
});

test('sealed maintenance retires a changed source set and deletes bodies after recurrence is lost', async t => {
  const model = scriptedConsolidator(), f = await lineageFixture(t, { options: { model } }), memories = [];
  const add = i => {
    const memory = ok(f.core.admit({ namespace: ns, memory: { content: 'Orion lifecycle ' + i, kind: 'fact' },
      receipts: [{ ...receipt('lifecycle-' + i), sessionId: 'conversation-' + i % 3 }] })).memory;
    f.db.prepare('UPDATE memories SET created_at=? WHERE id=?').run(new Date(Date.UTC(2026, 0, 1 + i * 3)).toISOString(), memory.id);
    memories.push(memory);
  };
  for (let i = 0; i < 8; i++) add(i);
  const first = ok(await f.core.maintainCards({ namespace: ns, budget: { maxMs: 5000 } })).built[0]; assert.ok(first);
  add(8);
  const retired = ok(await f.core.maintainCards({ namespace: ns, budget: { maxMs: 5000 } }));
  assert.equal(retired.state, 'ready', JSON.stringify(retired)); assert.equal(retired.debounced, 1);
  assert.equal(f.row(first.id).revision, 2);
  const storage = createEngineCardStorage({ db: f.db, identity: f.identity, ready() {} });
  const updated = Date.parse(f.row(first.id).updated_at);
  const pass = async offset => withContentWriteOperation('maintainCards', [ns], () =>
    createEngineCardMaintenance({ storage, model, now: () => updated + offset })
      .maintain({ namespace: ns, budget: { maxMs: 5000 } }));
  const rebuilt = await pass(600001); assert.equal(rebuilt.built.length, 1, JSON.stringify(rebuilt));
  assert.notEqual(rebuilt.built[0].id, first.id);
  for (const memory of memories.slice(0, 3)) ok(f.core.forget({ namespace: ns, memoryId: memory.id, expectedRevision: memory.revision }));
  const cleaned = await pass(1200002); assert.equal(cleaned.state, 'ready', JSON.stringify(cleaned));
  assert.equal(cleaned.deleted, 0, 'rebuild and forget already purged the old bodies');
  assert.equal(f.row(first.id).state, 'deleted'); assert.equal(f.row(first.id).body, null);
  assert.ok(f.db.prepare('SELECT 1 FROM card_body_provenance WHERE card_id=?').get(first.id));
});

test('engine generation reads bounded receipt Raw spans; exclusion revokes the generated Card', async t => {
  const model = scriptedConsolidator();
  const f = sourceFixture(t, { lineage: true, model: { ...model, classify: undefined,
    extract: ({ input }) => ({ items: [{ content: input.messages[0].content, kind: 'fact', confidence: 1, sourceIndices: [0] }] }) } });
  const raw = [];
  for (let i = 0; i < 8; i++) {
    raw.push(await savedSource(f, `Orion raw milestone ${i}: ${'bounded detail '.repeat(30)}`, { sessionId: 'conversation-' + i }));
  }
  const memories = f.db.prepare('SELECT id FROM memories ORDER BY id').all(); assert.equal(memories.length, 8);
  memories.forEach((m, i) => f.db.prepare('UPDATE memories SET created_at=? WHERE id=?')
    .run(new Date(Date.UTC(2026, 0, i * 3 + 1)).toISOString(), m.id));
  const pass = ok(await f.core.maintainCards({ namespace: rawNs, budget: { maxMs: 10000 }, rawSpans: true }));
  assert.equal(pass.built.length, 1, JSON.stringify(pass));
  assert.equal(model.calls[0].rawSpans.length, 8);
  assert.ok(model.calls[0].rawSpans.every(span => span.text.length <= 400));
  const card = pass.built[0], source = raw[0];
  assert.equal(ok(f.call('getCard', { namespace: rawNs, cardId: card.id })).card.origin, 'engine');
  f.db.prepare('INSERT INTO raw_source_exclusions VALUES(?,?,?,?,1)').run(source.conversationId, source.messageId, 0, 1);
  assert.equal(ok(f.call('getCard', { namespace: rawNs, cardId: card.id })).card, null);
});


for (const port of ['model', 'relations', 'relations-accessor']) test(`engine ${port} failures never expose Memory or Raw text in results or diagnostics`, async t => {
  const marker = 'Synthetic private Memory and Raw error text';
  const diagnostics = [], model = scriptedConsolidator(() => { throw Object.assign(Error(marker), { code: marker }); });
  model.onDiagnostic = event => diagnostics.push(event);
  const f = engineCardFixture(t, { model, ...(port !== 'model' ? { cardRelations: {
    read() {
      if (port === 'relations-accessor') {
        let reads = 0; throw { get code() { return reads++ ? marker : 'source_unavailable'; } };
      }
      throw Object.assign(Error(marker), { code: marker });
    },
  } } : {}) });
  f.seed(8);
  const result = ok(await f.pass());
  assert.equal(result.state, 'refused'); assert.equal(result.reason, port === 'relations-accessor' ? 'source_unavailable' : 'consolidation_failed');
  assert.doesNotMatch(JSON.stringify({ result, diagnostics }), /Synthetic private Memory and Raw error text/);
});

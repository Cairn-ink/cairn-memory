import test from 'node:test';
import assert from 'node:assert/strict';
import { lineageFixture, lineageHost, ns, ok, receipt } from '../testing/card-lineage-fixture.mjs';
import { safetyFixture } from '../testing/content-safety-s2h-fixture.mjs';
import { scriptedConsolidator } from '../testing/engine-card-fixture.mjs';
import { host as contextHost } from '../testing/context-read-core-fixture.mjs';
import { openMemoryCore, openMemoryStore } from '../index.mjs';
import { createEngineCardStorage } from '../engine-card-storage.mjs';
import { createEngineCardMaintenance } from '../engine-card-maintenance.mjs';
import { createPrivateCardStorage } from '../private-card-storage.mjs';
import { beginContentWriteSafety } from '../content-write-safety.mjs';
import { contentSafetyInventory } from '../content-safety-migration.mjs';
import { writeContentSuppressionInside } from '../content-suppression-storage.mjs';
import { transaction } from '../database.mjs';

const timestamp = '2026-06-01T00:00:00.000Z';
const modes = ['sealed', 'without lineage', 'suppression without lineage'];
const row = (f, id) => f.db.prepare('SELECT * FROM private_cards WHERE id=?').get(id);
const memoryRow = (f, id) => f.db.prepare('SELECT * FROM memories WHERE id=?').get(id);
const captureInput = (eventId, causal) => ({ namespace: ns, client: 'synthetic', sessionId: 'synthetic-' + eventId,
  eventId, messages: [{ id: eventId, role: 'user', content: 'Synthetic new ordinary evidence ' + eventId }],
  ...(causal ? { causal: { streamId: 'synthetic-stream', sequence: causal } } : {}) });

async function fixture(t, mode = 'sealed') {
  const model = { ...scriptedConsolidator(), extract: () => ({ items: [] }), reconcile: () => ({ transitions: [] }) };
  const trusted = contextHost();
  const options = { model, decisionReview: 'required-v1', contextRead: {
    version: 'context-read-v1', authority: trusted.authority, counter: { id: 'synthetic', countTokens: () => 1 } } };
  if (mode === 'sealed') return { ...await lineageFixture(t, { options }), model, trusted };
  const f = safetyFixture(t, 23);
  if (mode === 'suppression without lineage') await f.migrate();
  const host = lineageHost(), core = openMemoryCore({ path: f.path, privateCards: host.options, ...options }), db = f.connect();
  t.after(() => { core.close(); db.close(); });
  return { ...f, core, db, model, trusted, call: (method, input) => host.call(core, method, input),
    identity: db.prepare('SELECT store_id AS storeId,cursor_secret AS cursorSecret FROM store_metadata').get() };
}
function admit(f, content, suffix = content) {
  return ok(f.core.admit({ namespace: ns, memory: { content, kind: 'fact' }, receipts: [receipt(suffix)] })).memory;
}
function seed(f) {
  return Array.from({ length: 12 }, (_, i) => {
    const content = 'Synthetic ordinary evidence milestone ' + i;
    const memory = ok(f.core.admit({ namespace: ns, memory: { content, kind: 'fact' }, receipts: [{
      ...receipt('synthetic-seed-' + i, content), sessionId: 'synthetic-source-' + i % 3 }] })).memory;
    f.db.prepare('UPDATE memories SET created_at=? WHERE id=?').run(new Date(Date.UTC(2026, 0, 1 + i * 3)).toISOString(), memory.id);
    return memory;
  });
}
function worker(f) {
  const storage = createEngineCardStorage({ db: f.db, identity: f.identity, ready() {} });
  let clock = Date.parse(timestamp);
  return { advance() {
    clock = Math.max(clock, ...f.db.prepare('SELECT updated_at FROM private_cards').all().map(r => Date.parse(r.updated_at))) + 600001;
  }, pass: () => createEngineCardMaintenance({ storage, model: f.model, now: () => clock })
    .maintain({ namespace: ns, budget: { maxMs: 5000 } }) };
}
function file(f, memories, title) {
  return ok(f.core.applyPlacement({ namespace: ns, expectedIndexRevision: ok(f.core.map({ namespace: ns })).indexRevision,
    expectedMemoryRevisions: memories.map(m => ({ memoryId: m.id, revision: m.revision })),
    proposal: { items: memories.map(m => ({ memoryId: m.id, parentIds: [], newL1: { title, parentL2Ids: [] } })) } }));
}
function effects(f, id) {
  return f.db.prepare("SELECT * FROM card_effects WHERE entity_type='card' AND entity_id=? ORDER BY ordinal").all(id);
}
async function assertStaleAndRebuild(f, w, before, changed, currentIds) {
  const after = row(f, before.id);
  assert.equal(after.state, before.state);
  assert.equal(after.revision, before.revision + changed.length);
  assert.equal(after.title, before.title); assert.equal(after.body, before.body);
  const steps = effects(f, before.id).filter(e => e.revision > before.revision);
  assert.equal(steps.length, changed.length);
  assert.deepEqual(steps.map(e => e.revision), changed.map((_, i) => before.revision + i + 1));
  assert.ok(steps.every(e => e.kind === 'evidence_invalidated'));
  assert.deepEqual(steps.map(e => e.action_id).sort(), changed.map(m => {
    const now = memoryRow(f, m.id);
    assert.equal(now.revision, m.revision + 1);
    return 'memory-revision-' + m.id + '-' + now.revision;
  }).sort());
  assert.equal(ok(f.call('getCard', { cardId: before.id })).card, null);
  assert.ok(ok(f.call('listCards', { states: ['confirmed'] })).cards.every(card => card.id !== before.id));
  const mapped = ok(f.call('mapEvidence', { type: 'card' }));
  assert.equal(JSON.stringify(mapped).includes(before.id), false);
  for (const intent of ['current', 'history']) {
    const selected = ok(f.call('selectEvidence', { intent, query: 'Synthetic', types: ['memory', 'card'], limit: 24 }));
    assert.ok(selected.items.length);
    assert.ok(selected.items.every(item => item.ref.cardId !== before.id));
    for (const id of currentIds) assert.ok(selected.items.some(item => item.ref.memoryId === id), 'current Memories remain available');
    const fetched = ok(f.call('fetchEvidence', { refs: selected.items.map(item => item.ref), intent }));
    assert.equal(fetched.items.length, selected.items.length);
    const staleFetch = f.call('fetchEvidence', { intent, refs: [{ type: 'card', namespace: ns, cardId: before.id,
      revision: after.revision, bodyRevision: after.body_revision }] });
    assert.equal(staleFetch.ok, false); assert.equal(staleFetch.error.code, 'evidence_unavailable');
  }
  const projection = { readSet: [ns], types: ['memory', 'card'], intent: 'current' };
  ok(await f.trusted.call(f.core, 'refreshContextIndex', { ...projection, budget: { maxItems: 1024, maxMs: 5000 } }));
  const context = ok(await f.trusted.call(f.core, 'contextRead', { ...projection, query: 'Synthetic ordinary evidence',
    raw: false, semantic: false, deadlineMs: 5000, budget: { maxItems: 12, maxTokens: 3000 } }));
  assert.ok(context.metered.items.length);
  assert.ok(context.metered.items.every(item => item.ref.type === 'memory'));
  w.advance();
  const rebuilt = (await w.pass()).built;
  assert.ok(rebuilt.length, 'a later maintenance pass rebuilds eligible evidence');
  assert.ok(rebuilt.every(card => card.id !== before.id));
  assert.equal(row(f, before.id).body, null, 'rebuild purges the superseded payload');
}

for (const mode of modes) for (const operation of ['dedupe admission', 'capture restatement', 'confirmation',
  'initial filing', 're-filing', 'two-Memory filing', 'correction', 'remember metadata'])
test(`engine stale ordinary write: ${operation}, ${mode}`, async t => {
  const f = await fixture(t, mode);
  let memories = seed(f);
  if (operation === 're-filing') {
    // File in bounded batches through the public operation before building.
    let mocId;
    for (let i = 0; i < memories.length; i += 4) {
      const batch = memories.slice(i, i + 4);
      const placed = mocId ? ok(f.core.applyPlacement({ namespace: ns,
        expectedIndexRevision: ok(f.core.map({ namespace: ns })).indexRevision,
        expectedMemoryRevisions: batch.map(m => ({ memoryId: m.id, revision: m.revision })),
        proposal: { items: batch.map(m => ({ memoryId: m.id, parentIds: [mocId] })) } })) : file(f, batch, 'Synthetic ordinary topic');
      mocId ??= placed.createdMocs.find(m => m.level === 'L1').id;
    }
    memories = memories.map(m => memoryRow(f, m.id));
  }
  const w = worker(f), built = (await w.pass()).built;
  assert.equal(built.length, 1);
  const before = row(f, built[0].id), target = memories[0], content = memoryRow(f, target.id).content;
  assert.ok(f.db.prepare('SELECT 1 FROM card_memory_bindings WHERE card_id=? AND memory_id=?').get(before.id, target.id));
  const changed = operation === 'two-Memory filing' ? memories.slice(0, 2) : [target];
  if (operation === 'dedupe admission') {
    const result = ok(f.core.admit({ namespace: ns, memory: { content, kind: 'fact' }, receipts: [receipt('synthetic-new-receipt')] }));
    assert.equal(result.memory.id, target.id); assert.equal(result.deduplicated, true);
  } else if (operation === 'capture restatement') {
    f.model.extract = () => ({ items: [{ content, kind: 'fact', confidence: .8, sourceIndices: [0] }] });
    const captured = ok(await f.core.capture(captureInput('synthetic-restatement')));
    assert.equal(captured.admission.memories[0].id, target.id);
  } else if (operation === 'confirmation') {
    // Publication excludes awaiting sources; simulate an existing binding whose
    // Memory subsequently awaits review, as the review cascade fixtures do.
    f.db.prepare("UPDATE memories SET review_state='awaiting' WHERE id=?").run(target.id);
    ok(f.core.confirm({ namespace: ns, memoryId: target.id, expectedRevision: target.revision,
      actionId: 'synthetic-confirmation', receipt: receipt('synthetic-confirmation-receipt') }));
    assert.equal(memoryRow(f, target.id).review_state, 'confirmed');
  } else if (operation.includes('filing')) {
    const placed = file(f, changed, 'Synthetic changed ordinary topic');
    assert.equal(placed.memories.length, changed.length);
    for (const m of changed) assert.equal(memoryRow(f, m.id).filing_status, 'filed');
  } else if (operation === 'correction') {
    ok(f.core.correct({ namespace: ns, memoryId: target.id, expectedRevision: target.revision,
      content: 'Synthetic corrected ordinary evidence', kind: 'fact', receipt: receipt('synthetic-correction-receipt') }));
    assert.equal(memoryRow(f, target.id).content, 'Synthetic corrected ordinary evidence');
  } else {
    const legacy = openMemoryStore({ path: f.path });
    try {
      legacy.scope({ ownerId: ns.ownerId, projectId: ns.projectId }).remember({ content, kind: 'preference', origin: 'explicit', confidence: 1,
        receipt: receipt('synthetic-remember-receipt') });
    } finally { legacy.close(); }
    assert.equal(memoryRow(f, target.id).kind, 'preference');
  }
  const newEvent = { 'dedupe admission': 'synthetic-new-receipt', 'capture restatement': 'synthetic-restatement',
    confirmation: 'synthetic-confirmation-receipt', correction: 'synthetic-correction-receipt', 'remember metadata': 'synthetic-remember-receipt' }[operation];
  if (newEvent) assert.ok(f.db.prepare('SELECT 1 FROM receipts WHERE memory_id=? AND event_id=?').get(target.id, newEvent));
  await assertStaleAndRebuild(f, w, before, changed, changed.map(m => m.id));
});

for (const mode of modes) test(`engine stale ordinary write: causal capture retires bound predecessor, ${mode}`, async t => {
  const f = await fixture(t, mode), memories = [];
  for (let sequence = 1; sequence <= 3; sequence++) {
    f.model.extract = () => ({ items: Array.from({ length: 3 }, (_, i) => ({
      content: `Synthetic ordinary causal evidence ${sequence} milestone ${i}`, kind: 'fact', confidence: .8, sourceIndices: [0] })) });
    memories.push(...ok(await f.core.capture(captureInput('synthetic-causal-' + sequence, sequence))).admission.memories);
  }
  memories.forEach((m, i) => f.db.prepare('UPDATE memories SET created_at=? WHERE id=?')
    .run(new Date(Date.UTC(2026, 0, 1 + i * 3)).toISOString(), m.id));
  const target = memories[0], content = memoryRow(f, target.id).content, w = worker(f);
  const before = row(f, (await w.pass()).built[0].id);
  f.model.extract = () => ({ items: [{ content: 'Synthetic ordinary causal replacement', kind: 'fact', confidence: .8, sourceIndices: [0] }] });
  f.model.reconcile = ({ input }) => ({ transitions: [{ replacementIndex: 0,
    predecessorIndex: input.candidates.findIndex(m => m.content === content), evidenceIndices: [0],
    relation: 'supersedes', valueChange: 'changed', adoption: 'explicit' }] });
  const result = ok(await f.core.capture(captureInput('synthetic-causal-replacement', 4)));
  assert.equal(result.reconciliation.retiredCount, 1);
  assert.equal(memoryRow(f, target.id).currentness, 'historical');
  const replacement = result.admission.memories[0];
  assert.equal(memoryRow(f, replacement.id).content, 'Synthetic ordinary causal replacement');
  assert.ok(f.db.prepare('SELECT 1 FROM receipts WHERE memory_id=? AND event_id=?').get(replacement.id, 'synthetic-causal-replacement'));
  await assertStaleAndRebuild(f, w, before, [target], [replacement.id]);
});

function publish(f, memories) {
  const s = createEngineCardStorage({ db: f.db, identity: f.identity, ready() {} }), ids = new Set(memories.map(m => m.id));
  return s.commit(ns, { key: 'moc:synthetic-ordinary', memories: s.snapshot(ns, 512, () => {}).memories.filter(m => ids.has(m.id)) },
    { body: 'Synthetic retained ordinary engine body.' }, timestamp, () => {});
}
// Observe namespace and binding faults without disabling native schema guards.
// All revision/effect writes still come from the real native changeset.
function observe(db, transform, work) {
  const prepare = db.prepare;
  db.prepare = function(sql) {
    const statement = prepare.call(this, sql);
    return new Proxy(statement, { get(target, method) {
      const value = Reflect.get(target, method, target);
      if (typeof value !== 'function') return value;
      return (...args) => {
        const result = Reflect.apply(value, target, args);
        return ['get', 'all'].includes(method) ? transform(sql, method, args, result) : result;
      };
    } });
  };
  try { return work(); } finally { db.prepare = prepare; }
}
const faults = ['Card namespace', 'Memory not bound', 'Memory namespace', 'Memory revision jump',
  'Card revision jump', 'missing effect', 'duplicate effect', 'wrong action', 'wrong effect namespace',
  'wrong effect kind', 'wrong effect revision', 'timestamp', 'title', 'body', 'state', 'binding removed',
  'binding added', 'binding updated', 'seal', 'provenance', 'authorization', 'source row',
  'existing effect updated', 'existing effect removed', 'authored Card', 'missing engine receipt', 'reused Memory cause'];
for (const fault of faults) test(`engine stale verifier rejects ${fault} with complete rollback`, async t => {
  const f = await fixture(t), target = admit(f, 'Synthetic ordinary bound evidence'), other = admit(f, 'Synthetic ordinary other evidence');
  const card = fault === 'authored Card' ? ok(f.call('confirmCardDraft', { actionId: 'synthetic-authored-confirm',
    cardId: ok(f.call('createCardDraft', { actionId: 'synthetic-authored-draft', drafting: 'authored', input: {
      title: 'Synthetic authored title', body: 'Synthetic authored body', memoryRefs: [{ type: 'memory', namespace: ns,
        memoryId: target.id, revision: target.revision }], sourcePolicy: 'retained-receipts-v1' } })).id,
    expectedRevision: 1, applicability: 'current' })) : publish(f, fault === 'reused Memory cause' ? [target, other] : [target]);
  // Establish an old effect so changes/removals are distinguishable from inserts.
  f.db.prepare(`INSERT INTO card_effects VALUES('synthetic-prior-effect',?,?,?,?,?,?,?,?,
    (SELECT coalesce(max(ordinal),0)+1 FROM card_effects))`).run(ns.ownerId, ns.scope, ns.projectId ?? '',
    'evidence_invalidated', 'card', card.id, card.revision, 'synthetic-prior-action');
  const before = contentSafetyInventory(f.db);
  assert.throws(() => transaction(f.db, () => {
    // A stale authored Card can pass ordinary history validation. Present it
    // to source-operation validation to exercise the restricted branch itself.
    const guard = beginContentWriteSafety(f.db, { method: fault === 'authored Card' ? 'correct' : 'admit', scopes: [ns] });
    assert.ok(guard);
    try {
      f.db.prepare('UPDATE memories SET revision=revision+?,updated_at=? WHERE id=?')
        .run(fault === 'Memory revision jump' ? 2 : 1, timestamp, target.id);
      if (fault === 'reused Memory cause') f.db.prepare('UPDATE memories SET revision=revision+1,updated_at=? WHERE id=?').run(timestamp, other.id);
      const step = effects(f, card.id).find(e => e.revision > card.revision);
      if (fault === 'Card revision jump') f.db.prepare('UPDATE private_cards SET revision=revision+1 WHERE id=?').run(card.id);
      if (fault === 'missing effect') f.db.prepare('DELETE FROM card_effects WHERE effect_id=?').run(step.effect_id);
      if (fault === 'duplicate effect') f.db.prepare(`INSERT INTO card_effects SELECT 'synthetic-extra-effect',owner_id,scope,project_id,
        kind,entity_type,entity_id,revision,action_id,(SELECT max(ordinal)+1 FROM card_effects) FROM card_effects WHERE effect_id=?`).run(step.effect_id);
      if (fault === 'wrong action') f.db.prepare('UPDATE card_effects SET action_id=? WHERE effect_id=?').run('synthetic-wrong-action', step.effect_id);
      if (fault === 'wrong effect namespace') f.db.prepare("UPDATE card_effects SET project_id='synthetic-foreign' WHERE effect_id=?").run(step.effect_id);
      if (fault === 'wrong effect kind') f.db.prepare("UPDATE card_effects SET kind='card_deleted' WHERE effect_id=?").run(step.effect_id);
      if (fault === 'wrong effect revision') f.db.prepare('UPDATE card_effects SET revision=revision+1 WHERE effect_id=?').run(step.effect_id);
      if (fault === 'timestamp') f.db.prepare("UPDATE private_cards SET updated_at='2001-01-01T00:00:00.000Z' WHERE id=?").run(card.id);
      if (fault === 'title' || fault === 'body') f.db.prepare(`UPDATE private_cards SET ${fault}=?,body_revision=body_revision+1 WHERE id=?`)
        .run('Synthetic changed engine text', card.id);
      if (fault === 'state') f.db.prepare("UPDATE private_cards SET state='draft' WHERE id=?").run(card.id);
      if (fault === 'binding removed') f.db.prepare('DELETE FROM card_memory_bindings WHERE card_id=?').run(card.id);
      if (fault === 'binding added') f.db.prepare(`INSERT INTO card_memory_bindings SELECT card_id,?,?,?,source_ref,position+1
        FROM card_memory_bindings WHERE card_id=? LIMIT 1`).run(other.id, other.revision,
          f.db.prepare('SELECT id FROM receipts WHERE memory_id=?').get(other.id).id, card.id);
      if (fault === 'binding updated') f.db.prepare('UPDATE card_memory_bindings SET memory_revision=memory_revision+1 WHERE card_id=?').run(card.id);
      if (fault === 'seal') f.db.prepare('UPDATE private_cards SET body_revision=body_revision+1 WHERE id=?').run(card.id);
      if (fault === 'provenance') f.db.prepare(`INSERT INTO card_body_provenance SELECT owner_id,scope,project_id,card_kind,card_id,
        body_revision,provenance_revision+1,body_digest,provenance_digest,completeness,origin,source_count,authorization_action
        FROM card_body_provenance WHERE card_id=? ORDER BY provenance_revision DESC LIMIT 1`).run(card.id);
      if (fault === 'authorization') f.db.prepare(`INSERT INTO card_body_authorizations SELECT owner_id,'synthetic-extra-authorization',scope,
        project_id,'admit',card_id,'synthetic-human',?,'${'a'.repeat(64)}','user-rewrite',card_id,body_revision,body_digest
        FROM card_body_provenance WHERE card_id=? LIMIT 1`).run(timestamp, card.id);
      if (fault === 'source row') f.db.prepare(`INSERT INTO card_body_sources SELECT owner_id,scope,project_id,card_id,body_revision,
        source_scope,source_project,source_kind,source_key,source_incarnation,source_version||' ',content_identity,
        added_revision+1,evidence_origin,evidence_digest FROM card_body_sources WHERE card_id=? LIMIT 1`).run(card.id);
      if (fault === 'existing effect updated') f.db.prepare("UPDATE card_effects SET action_id='synthetic-changed-prior' WHERE effect_id='synthetic-prior-effect'").run();
      if (fault === 'existing effect removed') f.db.prepare("DELETE FROM card_effects WHERE effect_id='synthetic-prior-effect'").run();
      if (fault === 'missing engine receipt') f.db.prepare("DELETE FROM card_operations WHERE target_id=? AND method='consolidate'").run(card.id);
      if (fault === 'reused Memory cause') f.db.prepare('UPDATE card_effects SET action_id=? WHERE entity_id=? AND revision>?')
        .run(step.action_id, card.id, card.revision);
      let observations = 0;
      observe(f.db, (sql, method, args, value) => {
        if (method === 'get' && sql.startsWith('SELECT * FROM "private_cards" WHERE') && args[0] === card.id && fault === 'Card namespace') {
          observations++; return { ...value, project_id: 'synthetic-foreign' };
        }
        if (method === 'get' && sql.startsWith('SELECT * FROM "memories" WHERE') && args[0] === target.id) {
          if (fault === 'Memory namespace') { observations++; return { ...value, project_id: 'synthetic-foreign' }; }
        }
        if (fault === 'Memory not bound' && sql === 'SELECT 1 FROM card_memory_bindings WHERE card_id=? AND memory_id=? LIMIT 1') {
          observations++; return undefined;
        }
        return value;
      }, () => {
        try { guard.validate({}); }
        finally { if (['Card namespace', 'Memory namespace', 'Memory not bound'].includes(fault)) assert.ok(observations); }
      });
    } finally { guard.close(); }
  }), error => error.code === 'evidence_unavailable');
  assert.equal(contentSafetyInventory(f.db), before, 'every row and effect rolls back');
});

test('ordinary authored Card invalidation keeps its existing history path', async t => {
  const f = await fixture(t), target = admit(f, 'Synthetic authored source evidence');
  const draft = ok(f.call('createCardDraft', { actionId: 'synthetic-authored-draft', drafting: 'authored', input: {
    title: 'Synthetic authored title', body: 'Synthetic authored body', memoryRefs: [{ type: 'memory', namespace: ns,
      memoryId: target.id, revision: target.revision }], sourcePolicy: 'retained-receipts-v1' } }));
  const card = ok(f.call('confirmCardDraft', { actionId: 'synthetic-authored-confirm', cardId: draft.id,
    expectedRevision: draft.revision, applicability: 'current' }));
  const before = row(f, card.id);
  admit(f, 'Synthetic authored source evidence', 'synthetic-new-authored-receipt');
  assert.equal(row(f, card.id).revision, before.revision + 1);
  assert.equal(ok(f.call('getCard', { cardId: card.id })).card.body, before.body);
});

test('source operation explains a shared Card by forget first and a sibling Card by ordinary invalidation', async t => {
  const f = await fixture(t), first = admit(f, 'Synthetic terminal bound evidence'), second = admit(f, 'Synthetic surviving bound evidence');
  const shared = publish(f, [first, second]);
  // Use a distinct routing key for the surviving Memory's independent Card.
  const s = createEngineCardStorage({ db: f.db, identity: f.identity, ready() {} });
  const survivor = s.commit(ns, { key: 'moc:synthetic-independent', memories: s.snapshot(ns, 512, () => {}).memories.filter(m => m.id === second.id) },
    { body: 'Synthetic independent engine body.' }, timestamp, () => {});
  transaction(f.db, () => {
    const guard = beginContentWriteSafety(f.db, { method: 'deleteConversation', scopes: [ns] });
    try {
      const actionId = 'synthetic-mixed-source';
      createPrivateCardStorage({ db: f.db, identity: f.identity, ready() {} }).engineCardWriters().purge(ns, row(f, shared.id), actionId);
      writeContentSuppressionInside(f.db, { namespace: ns, kind: 'memory', key: first.id, reason: 'purge', actionId });
      f.db.prepare('UPDATE memories SET deleted=1,content=NULL,revision=revision+1,updated_at=? WHERE id=?').run(timestamp, first.id);
      f.db.prepare('UPDATE memories SET confidence=.9,revision=revision+1,updated_at=? WHERE id=?').run(timestamp, second.id);
      guard.validate({});
    } finally { guard.close(); }
  });
  assert.equal(row(f, shared.id).state, 'deleted');
  assert.equal(row(f, shared.id).revision, shared.revision + 1);
  assert.equal(row(f, shared.id).body, null);
  assert.deepEqual(effects(f, shared.id).map(e => e.kind), ['card_deleted']);
  assert.equal(row(f, survivor.id).state, 'confirmed');
  assert.equal(row(f, survivor.id).revision, survivor.revision + 1);
  assert.deepEqual(effects(f, survivor.id).map(e => e.kind), ['evidence_invalidated']);
  assert.equal(memoryRow(f, second.id).confidence, .9);
});

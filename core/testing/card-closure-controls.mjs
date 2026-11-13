// Real public operations used by committed controls and validation-time faults.
import assert from 'node:assert/strict';
import { lineageFixture, lineageHost, ns, ok, receipt } from './card-lineage-fixture.mjs';
import { safetyFixture, copySqliteFixture, quiescence } from './content-safety-s2h-fixture.mjs';
import { migrateReceiptEventTime } from '../content-safety-migration.mjs';
import { openMemoryCore } from '../index.mjs';
import { openRawCaptureCore } from '../raw-capture.mjs';
import { localPlainPort, request, splitRaw } from './raw-capture-fixtures.mjs';
import { attestContentSafety } from '../content-safety-schema.mjs';
import { createMemoryRuntime } from '../runtime.mjs';
import { batch } from './episode-helpers.mjs';
import { createEngineCardStorage } from '../engine-card-storage.mjs';
import { clusterMemories } from '../engine-card-clusters.mjs';
import { transaction } from '../database.mjs';
import { suppressOwnerInside, writeContentSuppressionInside } from '../content-suppression-storage.mjs';

export const closureStoreKinds = ['sealed', 'suppression', 'legacy'].flatMap(family => [
  { family, base: 23, raw: false, eventTime: false }, { family, base: 33, raw: false, eventTime: false },
  { family, base: 33, raw: true, eventTime: false },
].flatMap(kind => family === 'legacy' ? [kind] : [kind, { ...kind, eventTime: true }]));
export const storeLabel = kind => `${kind.family} base ${kind.base}, Raw ${kind.raw ? 'enabled' : 'disabled'}, event time ${kind.eventTime ? 'enabled' : 'disabled'}`;
const stamp = '2026-01-01T00:00:00.000Z';
export async function closureFixture(t, kind = closureStoreKinds[0], operation) {
  const model = { contextWindow: 8192, countTokens: () => 1, extract: () => ({ items: [] }),
    reconcile: () => ({ transitions: [] }),
    consolidate: ({ input }) => ({ currentState: [{ text: 'Synthetic control state', memoryIds: [input.memories[0].id] }],
      timeline: [], contradictions: [] }) };
  // Raw-root deletion also supports an option-off reader. Only the non-Raw
  // Episode control opts into Episode capture, with its required companions.
  const options = { model, decisionReview: 'required-v1',
    ...(operation === 'Episode forget' && !kind.raw ? { sessionEpisodes: { mode: 'episode-v1' },
      captureQualification: 'source-bound-v2', captureEvidence: 'staged-v1' } : {}) };
  let f;
  if (kind.family === 'sealed') f = await lineageFixture(t, { base: kind.base, raw: kind.raw, eventTime: kind.eventTime, options });
  else {
    const fixture = safetyFixture(t, kind.base);
    if (kind.family === 'suppression') {
      if (kind.eventTime) {
        copySqliteFixture(fixture.path, fixture.backupPath);
        await migrateReceiptEventTime({ path: fixture.path, backupPath: fixture.backupPath,
          expected: { storeId: fixture.storeId, base: kind.base }, quiescence });
      } else await fixture.migrate();
    }
    const host = lineageHost(), config = { path: fixture.path, privateCards: host.options, ...options };
    const core = kind.raw ? openRawCaptureCore(config, { mode: 'raw-v1', sources: true, deletion: true,
      port: localPlainPort(), readPolicy: () => ({ generation: 'synthetic', reason: null }) }) : openMemoryCore(config);
    const db = fixture.connect(); attestContentSafety(db);
    t.after(() => { core.close(); db.close(); });
    f = { ...fixture, core, db, host, call: (method, input) => host.call(core, method, input),
      identity: db.prepare('SELECT store_id AS storeId,cursor_secret AS cursorSecret FROM store_metadata').get() };
  }
  const row = id => f.db.prepare('SELECT * FROM private_cards WHERE id=?').get(id);
  const memoryRow = id => f.db.prepare('SELECT * FROM memories WHERE id=?').get(id);
  const engine = createEngineCardStorage({ db: f.db, identity: f.identity, ready() {} });
  const admit = (content, event = content, group) => ok(f.core.admit({ namespace: ns,
    memory: { content, kind: 'fact' }, receipts: [{ ...receipt(event, content), ...(group ? { sessionId: group } : {}) }] })).memory;
  function publish(memories, key = 'moc:synthetic-control') {
    const ids = new Set(memories.map(m => m.id));
    return engine.commit(ns, { key, memories: engine.snapshot(ns, 512, () => {}).memories.filter(m => ids.has(m.id)) },
      { body: 'Synthetic retained control body' }, stamp, () => {});
  }
  return { ...f, kind, model, row, memoryRow, engine, admit, publish };
}
function episode(f, memory) {
  const runtime = createMemoryRuntime({ path: f.path, sessionEpisodes: { mode: 'episode-v1' } });
  try {
    const source = f.db.prepare('SELECT client,session_id FROM receipts WHERE memory_id=? ORDER BY id LIMIT 1').get(memory.id);
    const input = { ...batch('synthetic-control-episode', 'Synthetic episode control', source.session_id), client: source.client };
    const { episodeId } = runtime.reserveEpisodeBatch(ns, input);
    const claim = runtime.claimAdmission(ns, { ...input, leaseMs: 125000 });
    runtime.finishAdmission(ns, { ...input, token: claim.token, items: [] });
    const ids = f.db.prepare('SELECT id FROM receipts WHERE memory_id=?').all(memory.id).map(r => r.id);
    f.db.prepare('INSERT INTO episode_memory_links VALUES(?,?,?,?,?,?)')
      .run('synthetic-control-link', episodeId, memory.id, input.eventId, memory.revision, JSON.stringify(ids));
    return f.db.prepare('SELECT * FROM session_episodes WHERE id=?').get(episodeId);
  } finally { runtime.close(); }
}
export const purgeOperations = ['forget', 'rejection', 'conversation deletion', 'Episode forget', 'Card deletion',
  'maintenance purge', 'rebuild supersession', 'maintenance retirement', 'owner erasure', 'namespace erasure'];
export const ordinaryOperations = ['capture dedupe', 'duplicate extraction', 'confirmation', 'filing', 'correction', 'causal supersession'];
export const supportedControl = (kind, operation) => (operation !== 'conversation deletion' || kind.raw) &&
  (!operation.endsWith('erasure') || kind.family !== 'legacy');
export async function prepareClosureControl(t, kind, operation, json = false) {
  const f = await closureFixture(t, kind, operation);
  let memory, card, root, ep, input;
  const captureInput = (event, content, sequence) => ({ namespace: ns, client: 'synthetic',
    sessionId: 'synthetic-control-stream', eventId: event,
    messages: [{ id: event, role: 'user', content }],
    ...(sequence ? { causal: { streamId: 'synthetic-control-stream', sequence } } : {}) });
  if (operation === 'conversation deletion' || operation === 'Episode forget' && kind.raw) {
    f.model.extract = () => ({ items: [{ content: 'Synthetic control Raw evidence', kind: 'fact', confidence: .8, sourceIndices: [0] }] });
    const captured = ok(await f.core.captureRaw(request(splitRaw('Synthetic control Raw evidence')[0],
      { namespace: ns, client: 'claude-code', sessionId: 'synthetic-control-root', eventId: 'synthetic-control-raw' })));
    memory = ok(captured.interpretation).admission.memories[0];
    root = f.db.prepare('SELECT * FROM raw_conversations WHERE id=?').get(captured.raw.conversationId);
  } else if (operation === 'causal supersession') {
    f.model.extract = () => ({ items: [{ content: 'Synthetic causal predecessor', kind: 'fact', confidence: .8, sourceIndices: [0] }] });
    memory = ok(await f.core.capture(captureInput('synthetic-control-prior', 'Synthetic causal predecessor', 1))).admission.memories[0];
  } else if (!['rebuild supersession', 'maintenance retirement'].includes(operation))
    memory = f.admit('Synthetic bound control evidence', 'synthetic-control-source');
  let memories = [memory], key;
  if (['rebuild supersession', 'maintenance retirement'].includes(operation)) {
    memories = Array.from({ length: 8 }, (_, i) => f.admit('Synthetic recurring control milestone ' + i, 'synthetic-control-seed-' + i, 'synthetic-control-group-' + i % 3));
    memories.forEach((m, i) => f.db.prepare('UPDATE memories SET created_at=? WHERE id=?')
      .run(new Date(Date.UTC(2026, 0, 1 + i * 3)).toISOString(), m.id));
    memory = memories[0];
    const ids = new Set(memories.map(m => m.id));
    key = clusterMemories(f.engine.snapshot(ns, 512, () => {}).memories.filter(m => ids.has(m.id)))[0].key;
  }
  card = f.publish(operation === 'maintenance retirement' ? memories.slice(0, 7) : memories, key);
  assert.ok(card);
  assert.equal(f.row(card.id).state, 'confirmed', 'the fixture published its engine Card');
  assert.equal(f.db.prepare('SELECT count(*) n FROM card_memory_bindings WHERE card_id=?').get(card.id).n,
    operation === 'maintenance retirement' ? 7 : memories.length);
  const payload = json ? JSON.stringify({ note: card.id }) : card.id;
  if (operation === 'Episode forget') {
    ep = episode(f, memory);
    const sourceRoot = Boolean(f.db.prepare("SELECT 1 FROM sqlite_master WHERE name='raw_deletion_actions'").get());
    assert.equal(sourceRoot, kind.base === 33, 'base selects direct or source-root Episode forgetting');
  }
  if (['rejection', 'confirmation'].includes(operation)) f.db.prepare("UPDATE memories SET review_state='awaiting' WHERE id=?").run(memory.id);
  if (operation === 'rebuild supersession') {
    ok(f.core.admit({ namespace: ns, memory: { content: f.memoryRow(memory.id).content, kind: 'fact' },
      receipts: [receipt('synthetic-control-stale')] }));
    f.db.prepare('UPDATE private_cards SET updated_at=? WHERE id=?').run(stamp, card.id);
  }
  if (['capture dedupe', 'duplicate extraction'].includes(operation)) {
    input = captureInput('synthetic-control-restatement', payload);
    if (operation === 'duplicate extraction') input.messages.push({ id: 'synthetic-control-second', role: 'user', content: payload });
    f.model.extract = () => ({ items: input.messages.map((_, i) => ({ content: f.memoryRow(memory.id).content,
      kind: 'fact', confidence: .8, sourceIndices: [i] })) });
  }
  if (operation === 'causal supersession') {
    input = captureInput('synthetic-control-replacement', payload, 2);
    f.model.extract = () => ({ items: [{ content: payload, kind: 'fact', confidence: .8, sourceIndices: [0] }] });
    f.model.reconcile = ({ input: value }) => {
      const predecessorIndex = value.candidates.findIndex(m => m.content === 'Synthetic causal predecessor');
      assert.ok(predecessorIndex >= 0);
      return { transitions: [{ replacementIndex: 0, predecessorIndex, evidenceIndices: [0],
        relation: 'supersedes', valueChange: 'changed', adoption: 'explicit' }] };
    };
  }
  const before = f.row(card.id);
  const originalReceipts = f.db.prepare('SELECT * FROM receipts WHERE memory_id=? ORDER BY id').all(memory.id);
  const reserved = kind.family === 'legacy' ? null : f.db.prepare('SELECT * FROM content_identity_reservations WHERE kind=? AND stable_key=?').get('card', card.id);
  if (kind.family === 'suppression') assert.equal(reserved, undefined, 'a new unsealed engine has no prior reservation');
  if (kind.family === 'sealed') assert.ok(reserved, 'the native seal reserved this incarnation');
  const invoke = () => {
    const target = { namespace: ns, memoryId: memory.id, expectedRevision: f.memoryRow(memory.id).revision };
    if (operation === 'forget') return f.core.forget(target);
    if (operation === 'rejection') return f.core.reject({ ...target, actionId: 'synthetic-control-rejection' });
    if (operation === 'conversation deletion') return f.core.deleteConversation({ namespace: ns, conversationId: root.id,
      expectedRevision: root.revision, actionId: 'synthetic-control-delete-root' });
    if (operation === 'Episode forget') return f.core.forgetEpisode({ namespace: ns, episodeId: ep.id, expectedRevision: ep.revision });
    if (operation.endsWith('erasure')) return { ok: true, value: transaction(f.db, () => operation === 'owner erasure'
      ? suppressOwnerInside(f.db, { ownerId: ns.ownerId, reason: 'account_erasure', actionId: 'synthetic-control-erasure' })
      : writeContentSuppressionInside(f.db, { namespace: ns, kind: 'namespace', matchMode: 'namespace',
        reason: 'purge', actionId: 'synthetic-control-erasure' })) };
    if (operation === 'Card deletion') return f.call('deleteKnowledgeCard', { actionId: 'synthetic-control-delete-card',
      cardId: card.id, expectedRevision: before.revision });
    if (operation.startsWith('maintenance') || operation === 'rebuild supersession') return f.core.maintainCards({ namespace: ns, budget: { maxMs: 5000 } });
    if (operation === 'capture dedupe' || operation === 'duplicate extraction' || operation === 'causal supersession') return f.core.capture(input);
    if (operation === 'confirmation') return f.core.confirm({ ...target, actionId: 'synthetic-control-confirm', receipt: receipt('synthetic-control-confirmation', payload) });
    if (operation === 'filing') return f.core.applyPlacement({ namespace: ns,
      expectedIndexRevision: ok(f.core.map({ namespace: ns })).indexRevision,
      expectedMemoryRevisions: [{ memoryId: memory.id, revision: target.expectedRevision }],
      proposal: { items: [{ memoryId: memory.id, parentIds: [], newL1: { title: payload, parentL2Ids: [] } }] } });
    return f.core.correct({ ...target, content: payload, kind: 'fact', receipt: receipt('synthetic-control-correction', payload) });
  };
  function verify(value) {
    const after = f.row(card.id);
    if (operation === 'maintenance retirement' || ordinaryOperations.includes(operation)) {
      const steps = operation === 'duplicate extraction' ? 2 : 1;
      assert.equal(after.state, before.state); assert.equal(after.revision, before.revision + steps);
      assert.equal(after.title, before.title); assert.equal(after.body, before.body);
      if (ordinaryOperations.includes(operation)) assert.equal(f.memoryRow(memory.id).revision, memory.revision + steps);
      if (operation === 'confirmation') assert.equal(f.memoryRow(memory.id).review_state, 'confirmed');
      if (operation === 'filing') assert.equal(f.memoryRow(memory.id).filing_status, 'filed');
      if (operation === 'correction') assert.equal(f.memoryRow(memory.id).content, payload);
      if (operation === 'causal supersession') assert.equal(f.memoryRow(memory.id).currentness, 'historical');
      if (operation === 'capture dedupe' || operation === 'duplicate extraction') {
        assert.deepEqual(value.admission.memories.map(m => m.id), [memory.id]);
        const rows = f.db.prepare('SELECT excerpt FROM receipts WHERE memory_id=? AND event_id IN (?,?) ORDER BY event_id')
          .all(memory.id, input.messages[0].id, input.messages[1]?.id ?? 'synthetic-absent');
        assert.deepEqual(rows.map(r => r.excerpt), input.messages.map(m => m.content));
        const retained = f.db.prepare('SELECT * FROM receipts WHERE memory_id=? ORDER BY id').all(memory.id);
        assert.deepEqual(retained.filter(row => originalReceipts.some(old => old.id === row.id)), originalReceipts);
        assert.equal(retained.length, originalReceipts.length + input.messages.length);
      }
    } else {
      assert.equal(after.state, 'deleted'); assert.equal(after.title, null); assert.equal(after.body, null);
      assert.equal(after.revision, before.revision + 1);
      if (['forget', 'rejection', 'Episode forget'].includes(operation)) assert.equal(value.forgotten, true);
      if (['forget', 'rejection', 'Episode forget', 'conversation deletion'].includes(operation))
        assert.equal(f.memoryRow(memory.id).deleted, 1);
      if (operation === 'Card deletion') assert.equal(value.id, card.id);
      if (operation === 'conversation deletion') {
        assert.equal(value.conversationId, root.id); assert.equal(value.forgottenMemories, 1);
      }
      if (operation.endsWith('erasure')) {
        assert.equal(typeof value.factId, 'string'); assert.ok(value.epoch > 0n);
        assert.equal(f.db.prepare('SELECT count(*) n FROM card_memory_bindings WHERE card_id=?').get(card.id).n, 0);
        assert.equal(f.db.prepare('SELECT match_mode FROM content_suppressions WHERE fact_id=?').get(value.factId).match_mode,
          operation === 'owner erasure' ? 'owner' : 'namespace');
      }
      if (operation === 'maintenance purge') assert.equal(value.deleted, 1);
      if (operation === 'rebuild supersession') {
        assert.ok(value.built.length > 0); assert.equal(value.deleted, 1, 'the rebuild purged its superseded row');
      }
      if (kind.family !== 'legacy') {
        const reservation = f.db.prepare('SELECT * FROM content_identity_reservations WHERE kind=? AND stable_key=?').get('card', card.id);
        assert.deepEqual({ ...reservation }, { owner_id: ns.ownerId, scope: ns.scope, project_id: ns.projectId ?? '',
          kind: 'card', stable_key: card.id, incarnation: card.id, evidence_origin: 'writer' });
      }
    }
    assert.equal(f.db.isTransaction, false, 'the public operation committed');
  }
  return { ...f, card, memory, before, payload, invoke, verify };
}

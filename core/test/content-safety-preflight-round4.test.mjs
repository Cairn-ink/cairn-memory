import test from 'node:test';
import assert from 'node:assert/strict';
import { openRawCaptureCore } from '../raw-capture.mjs';
import { contentSafetyObservations } from '../content-safety-observations.mjs';
import { classifyCardBodySafetyV1 } from '../content-safety-classifier.mjs';
import { preflightContentSafetyV1 } from '../content-safety-preflight.mjs';
import { openDatabase, readTransaction, STORAGE_BUSY_TIMEOUT_MS } from '../database.mjs';
import { consumer, runtimeFor } from '../testing/raw-deletion-review-fixtures.mjs';
import { sourceFixture, request, splitRaw, localPlainPort, ns, ok } from '../testing/raw-source-fixtures.mjs';
import { rationaleModel } from '../testing/rationale-model.mjs';

async function setup(t, originMemory = false) {
  const state = { content: originMemory ? 'Synthetic origin interpretation.' : null };
  const f = sourceFixture(t, { kind: 'episode', model: { extract: () => ({ items: state.content
    ? [{ content: state.content, kind: 'fact', confidence: .8, sourceIndices: [0] }] : [] }) } });
  const upgrade = openDatabase(f.path, { currentDependencies: true }); upgrade.close();
  f.db.exec(`PRAGMA busy_timeout=${STORAGE_BUSY_TIMEOUT_MS}`);
  const saved = ok(await f.core.captureRaw(request(splitRaw('Synthetic original Raw A.', { id: 'A-message' })[0],
    { client: 'codex', sessionId: 'A', eventId: 'raw-A' }, 'episode')));
  const origin = ok(saved.interpretation).episode.id;
  const source = f.db.prepare('SELECT id FROM episode_sources WHERE episode_id=?').get(origin);
  assert.ok(source);
  f.originConversation = saved.raw.conversationId;
  f.origin = origin;
  f.runtime = runtimeFor(f);
  f.inherit = index => consumer(f, f.runtime, { client: 'claude-code', sessionId: 'B-' + index,
    eventId: 'consumer-' + index, sourceIds: [source.id] });
  f.keep = async (episodeId, content) => {
    state.content = content;
    try {
      return ok(await f.core.keepEpisode({ namespace: ns, episodeId,
        expectedRevision: f.db.prepare('SELECT revision FROM session_episodes WHERE id=?').get(episodeId).revision,
        actionId: 'keep-' + episodeId }));
    } finally { state.content = null; }
  };
  let serial = 0;
  f.card = memory => {
    const card = ok(f.call('createCardDraft', { namespace: ns, actionId: 'draft-' + (++serial), drafting: 'authored', input: {
      title: 'Synthetic scope title', body: 'Synthetic scope body', ...(memory ? { sourcePolicy: 'retained-receipts-v1',
        memoryRefs: [{ type: 'memory', namespace: ns, memoryId: memory.id, revision: memory.revision }] }
        : { authoredInput: { text: 'Synthetic independent note.', occurredAt: null } }) } }));
    return ok(f.call('confirmCardDraft', { namespace: ns, cardId: card.id, expectedRevision: card.revision, actionId: 'confirm-' + (++serial) }));
  };
  f.remove = conversationId => ok(f.core.deleteConversation({ namespace: ns, conversationId,
    expectedRevision: f.db.prepare('SELECT revision FROM raw_conversations WHERE id=?').get(conversationId).revision,
    actionId: 'delete-' + (++serial) }));
  return f;
}
function classify(f, id) {
  const snapshot = readTransaction(f.db, () => contentSafetyObservations(f.db, { scanRows: 250000, scanBytes: 128 * 1024 * 1024 }, () => {}));
  return classifyCardBodySafetyV1(snapshot.observations.find(row => row.body.identity.key === id));
}

test('R4 keep consumer deletion never supplies a cause for an independently missing receipt', async t => {
  const f = await setup(t), inherited = f.inherit('keep'), content = 'Synthetic kept interpretation.';
  const kept = await f.keep(inherited.id, content), memory = kept.admission.memories[0];
  assert.equal(memory.revision, 1);
  const card = f.card(memory), bound = f.db.prepare('SELECT receipt_id FROM card_memory_bindings WHERE card_id=?').get(card.id).receipt_id;
  const link = f.db.prepare('SELECT * FROM episode_memory_links WHERE episode_id=? AND memory_id=?').get(inherited.id, memory.id);
  assert.equal(link.admission_revision, 1); assert.ok(JSON.parse(link.receipt_ids).includes(bound));
  const original = f.db.prepare('SELECT client,session_id FROM receipts WHERE id=?').get(bound);
  assert.equal(original.client, 'codex');
  const writer = openRawCaptureCore({ path: f.path, privateCards: f.host.options, model: { ...rationaleModel(), extract: () => ({ items: [] }) } }, {
    mode: 'raw-v1', sources: true, port: localPlainPort(), readPolicy: () => ({ generation: 'synthetic', reason: null }) });
  f.workspace.defer(() => writer.close());
  const rawB = ok(await writer.captureRaw(request(splitRaw('Synthetic later Raw B.', { id: 'B-message' })[0],
    { client: 'claude-code', sessionId: 'B-keep', eventId: 'raw-B' })));
  ok(f.core.admit({ namespace: ns, memory: { content, kind: 'fact' }, receipts: [
    { client: 'claude-code', sessionId: 'B-keep', eventId: 'B-message', role: 'user', excerpt: 'Synthetic later Raw B.' },
    { client: 'manual', sessionId: 'C', eventId: 'independent-C', role: 'user', excerpt: 'Synthetic independent C.' } ] }));
  // Inject an unexplained hard loss, including dangling qualification references.
  f.db.exec('PRAGMA foreign_keys=OFF');
  try { f.db.prepare('DELETE FROM receipts WHERE id=?').run(bound); }
  finally { f.db.exec('PRAGMA foreign_keys=ON'); }
  assert.equal(classify(f, card.id).status, 'unknown');
  f.remove(rawB.raw.conversationId);
  assert.ok(f.db.prepare('SELECT 1 FROM raw_conversations WHERE id=?').get(f.originConversation));
  assert.equal(f.db.prepare('SELECT deleted FROM memories WHERE id=?').get(memory.id).deleted, 0);
  assert.equal(f.db.prepare('SELECT deleted FROM session_episodes WHERE id=?').get(inherited.id).deleted, 1);
  assert.equal(classify(f, card.id).status, 'unknown');
});

test('R4 default-budget preflight has no episode-times-Memory allocation for 500 descendants', async t => {
  const f = await setup(t, true);
  for (let index = 0; index < 500; index++) {
    const inherited = f.inherit(index);
    await f.keep(inherited.id, 'Synthetic descendant interpretation ' + index + '.');
  }
  f.card();
  const NativeSet = Set, memoryIds = new NativeSet(f.db.prepare('SELECT id FROM memories').all().map(row => row.id));
  assert.equal(memoryIds.size, 501);
  f.remove(f.originConversation);
  const effects = f.db.prepare('SELECT entity_type,count(*) n FROM raw_deletion_effects GROUP BY entity_type').all();
  assert.equal(effects.find(row => row.entity_type === 'memory').n, 501);
  assert.equal(effects.find(row => row.entity_type === 'episode').n, 501);
  let memberships = 0;
  globalThis.Set = class extends NativeSet {
    constructor(values) {
      super(values);
      for (const value of this) if (memoryIds.has(value)) memberships++;
    }
  };
  let report;
  try { report = await preflightContentSafetyV1({ path: f.path }); }
  finally { globalThis.Set = NativeSet; }
  assert.equal(report.enumerated, 1); assert.equal(report.unknown, 1); assert.equal(report.complete, 0); assert.equal(report.knownSuppressed, 0);
  t.diagnostic(JSON.stringify({ descendants: 500, memoryEffects: 501, episodeEffects: 501, memoryIdSetMemberships: memberships, report }));
  assert.ok(memberships <= memoryIds.size * 4, `Memory-id Set memberships must be linear: ${memberships}`);
});

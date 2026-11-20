import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import test from 'node:test';
import { openMemoryCore } from '../index.mjs';
import { openRawCaptureCore } from '../raw-capture.mjs';
import { createRawLineageStorage } from '../raw-lineage-storage.mjs';
import { receiptDenialTokens } from '../raw-source-roots.mjs';
import { readTransaction, transaction } from '../database.mjs';
import { installedContentLayout } from '../content-safety-schema.mjs';
import { cardHost, localPlainPort, ns as rawNs, request, savedSource, sourceFixture, splitRaw } from '../testing/raw-source-fixtures.mjs';
import { ns, ok, receipt, safetyFixture } from '../testing/content-safety-s2h-fixture.mjs';
import { interpretation } from '../testing/episode-capture-helpers.mjs';
import { config } from '../testing/raw-capture-fixtures.mjs';
import { rationaleModel } from '../testing/rationale-model.mjs';
import { createTestWorkspace } from '../../tools/testing/workspace.mjs';
import { join } from 'node:path';
import { migrateEventTime } from '../testing/receipt-event-time-fixture.mjs';

const model = { contextWindow: 8192, countTokens: () => 1, extract: () => ({
  items: [{ content: 'Synthetic Raw finding', kind: 'fact', confidence: .8, sourceIndices: [0] }],
}) };
const markers = db => db.prepare("SELECT fingerprint FROM suppressed WHERE fingerprint LIKE 'rs1:%' ORDER BY fingerprint")
  .all().map(row => row.fingerprint);

for (const action of ['exact span', 'terminal Raw purge', 'Raw receipt-only purge']) {
  test(`physical 53: ${action} retains its own authority`, async t => {
    const f = safetyFixture(t, 33);
    await migrateEventTime(f);
    const core = openRawCaptureCore({ path: f.path, model, privateCards: cardHost().options }, { mode: 'raw-v1', sources: true,
      port: localPlainPort(), readPolicy: () => ({ generation: 'synthetic', reason: null }) });
    const db = f.connect();
    f.workspace.defer(() => { core.close(); db.close(); });
    const part = splitRaw('Synthetic exact retained passage.', { id: 'exact-message' })[0];
    const saved = ok(await core.captureRaw(request(part, { namespace: ns, sessionId: 'raw-session', eventId: 'raw-event' })));
    const [memory] = ok(saved.interpretation).admission.memories;
    const conversationId = saved.raw.conversationId;
    const source = db.prepare('SELECT * FROM receipts WHERE memory_id=?').get(memory.id);
    const original = db.prepare('SELECT fingerprint,content FROM memories WHERE id=?').get(memory.id);
    const coordinates = db.prepare('SELECT conversation_id,message_id,start,end FROM raw_receipt_lineage WHERE receipt_id=?').get(source.id);
    assert.deepEqual({ ...coordinates }, { conversation_id: conversationId, message_id: part.id, start: 0, end: part.content.length });
    if (action === 'exact span') {
      transaction(db, () => createRawLineageStorage(db).excludeMemory(ns, memory.id, {
        reason: 'privacy_erase', actionId: 'exact-span-only',
      }));
      assert.deepEqual(markers(db), [], 'no receipt retired in a span-only write');
      assert.deepEqual(db.prepare('SELECT conversation_id,message_id,start,end FROM raw_source_exclusions').get(), coordinates);
      const fact = db.prepare("SELECT stable_key,message_key,span_start,span_end FROM content_suppressions WHERE match_mode='span'").get();
      assert.deepEqual({ ...fact }, { stable_key: conversationId, message_key: part.id, span_start: 0, span_end: part.content.length });
      const corrected = core.correct({ namespace: ns, memoryId: memory.id, expectedRevision: memory.revision,
        content: 'Synthetic independent correction', kind: 'fact', receipt: receipt('replacement') });
      ok(corrected);
      assert.deepEqual(markers(db), receiptDenialTokens([source]).sort(), 'correction retires the canonical receipt');
    } else {
      const retain = action === 'Raw receipt-only purge';
      if (retain) ok(core.admit({ namespace: ns, memory: { content: original.content, kind: 'fact' }, receipts: [receipt('independent')] }));
      const revision = db.prepare('SELECT revision FROM raw_conversations WHERE id=?').get(conversationId).revision;
      const result = ok(core.deleteConversation({ namespace: ns, conversationId, expectedRevision: revision, actionId: 'purge-raw' }));
      assert.equal(result.removedReceipts, 1);
      assert.equal(result.forgottenMemories, Number(!retain));
      assert.equal(db.prepare('SELECT deleted FROM memories WHERE id=?').get(memory.id).deleted, Number(!retain));
      assert.equal(db.prepare('SELECT count(*) AS n FROM receipts WHERE memory_id=?').get(memory.id).n, Number(retain));
      assert.deepEqual(markers(db), []);
      assert.deepEqual(db.prepare('SELECT fingerprint FROM suppressed').all().map(row => row.fingerprint), retain ? [] : [original.fingerprint]);
      assert.ok(db.prepare('SELECT 1 FROM raw_session_fences').get());
    }
  });
}

test('installed local 29: exact exclusion, named Episode and local window commit with Memory forget', async t => {
  const f = sourceFixture(t, { kind: 'episode', model });
  const raw = await savedSource(f, 'Synthetic local retained passage.', {
    client: 'claude-code', sessionId: 'named-session',
    episodeContext: { clientLabel: 'Synthetic', generation: 'initial', origin: 'ordinary' },
  });
  const local = openMemoryCore({ path: f.path, raw: true, rawSearch: false });
  f.workspace.defer(() => local.close());
  assert.equal(installedContentLayout(f.db).physical, 29);
  assert.equal(installedContentLayout(f.db).suppressionRevision, 0);
  const memory = f.db.prepare('SELECT id,revision FROM memories WHERE deleted=0').get();
  const [source] = f.db.prepare('SELECT * FROM receipts WHERE memory_id=?').all(memory.id);
  const exact = f.db.prepare('SELECT conversation_id,message_id,start,end FROM raw_receipt_lineage WHERE receipt_id=?').get(source.id);
  const episode = f.db.prepare('SELECT id FROM session_episodes WHERE deleted=0').get();
  assert.ok(f.db.prepare('SELECT 1 FROM episode_sources WHERE episode_id=?').get(episode.id));
  assert.equal(exact.conversation_id, raw.conversationId);
  ok(local.forget({ namespace: rawNs, memoryId: memory.id, expectedRevision: memory.revision }));
  assert.deepEqual(markers(f.db), receiptDenialTokens([source]).sort());
  assert.deepEqual(f.db.prepare('SELECT conversation_id,message_id,start,end FROM raw_source_exclusions').get(), exact);
  assert.equal(f.db.prepare('SELECT deleted FROM session_episodes WHERE id=?').get(episode.id).deleted, 1);
  assert.ok(f.db.prepare('SELECT 1 FROM raw_session_fences').get());
  assert.ok(f.db.prepare('SELECT 1 FROM local_raw_hide_windows').get());
});

for (const layout of [29, 53]) for (const action of ['conversation delete', 'Episode forget']) {
  test(`Raw ${action} on layout ${layout} withholds a shared receipt and fences capture`, async t => {
    const kind = action === 'Episode forget' ? 'episode' : 'ordinary';
    const f = layout === 53 ? safetyFixture(t, 33) : { workspace: createTestWorkspace(t) };
    if (layout === 53) await migrateEventTime(f);
    const path = f.path ?? join(f.workspace.path, 'store.sqlite');
    const recallModel = {
      ...rationaleModel(), ...model, interpretEpisode: interpretation,
      select: ({ input }) => ({ refs: input.maps.flatMap(({ namespaceIndex, items }) =>
        items.filter(item => item.type === 'unfiled').map(({ ref }) => ({ namespaceIndex, ...ref }))) }),
    };
    const options = { path, model: recallModel, ...config(kind) };
    const core = layout === 29 ? openMemoryCore({ ...options, raw: true, rawSearch: false })
      : openRawCaptureCore({ ...options, privateCards: cardHost().options },
        { mode: 'raw-v1', sources: true, port: localPlainPort(), readPolicy: () => ({ generation: 'initial', reason: null }) });
    f.workspace.defer(() => core.close());
    const db = new DatabaseSync(path);
    f.workspace.defer(() => db.close());
    const installed = installedContentLayout(db);
    assert.equal(installed.physical, layout);
    assert.equal(installed.suppressionRevision, layout === 53 ? 1 : 0);

    const part = splitRaw('Synthetic source due for removal.', { id: 'deleted-source' })[0];
    const input = request(part, { namespace: ns, sessionId: 'deleted-session', eventId: 'capture-source' }, kind);
    const captured = ok(await core.captureRaw(input));
    const { conversationId } = captured.raw;
    const { session_key: sessionKey } = db.prepare('SELECT session_key FROM raw_conversations WHERE id=?').get(conversationId);
    const [retired] = ok(captured.interpretation).admission.memories;
    const shared = { client: input.client, sessionId: input.sessionId, eventId: part.id, role: part.role, excerpt: part.content };
    const independent = receipt('Synthetic unrelated receipt.');
    const sibling = ok(core.admit({ namespace: ns, memory: { content: 'Synthetic independently supported finding', kind: 'fact' },
      receipts: [independent, shared] })).memory;
    const stored = db.prepare('SELECT * FROM receipts WHERE memory_id=? AND event_id=?').get(sibling.id, shared.eventId);
    assert.ok(stored);
    const get = () => [ok(core.get({ namespace: ns, memoryId: sibling.id }))];
    const recall = async () => ok(await core.recall({ readSet: [ns], query: 'Synthetic finding' })).memories;
    const sessionStart = () => ok(core.sessionStartContext({ namespace: ns,
      groups: { nextSteps: false, procedural: false, background: true } })).groups.background.items;
    for (const surface of [get, recall, sessionStart]) {
      const item = (await surface()).find(entry => entry.memory.id === sibling.id);
      assert.ok(item, surface.name);
      assert.deepEqual(item.receipts.map(row => row.excerpt).sort(), [shared.excerpt, independent.excerpt].sort(), surface.name);
    }

    if (kind === 'episode') {
      const { id: episodeId, revision: expectedRevision } = db.prepare('SELECT id,revision FROM session_episodes WHERE deleted=0').get();
      ok(core.forgetEpisode({ namespace: ns, episodeId, expectedRevision }));
    } else {
      const { revision: expectedRevision } = db.prepare('SELECT revision FROM raw_conversations WHERE id=?').get(conversationId);
      const removed = ok(core.deleteConversation({ namespace: ns, conversationId, expectedRevision, actionId: 'delete-shared-conversation' }));
      assert.deepEqual([removed.forgottenMemories, removed.retainedMemories, removed.removedReceipts], [1, 1, 2]);
    }

    for (const surface of [get, recall, sessionStart]) {
      const item = (await surface()).find(entry => entry.memory.id === sibling.id);
      assert.ok(item, surface.name);
      assert.ok(item.receipts.every(row => row.eventId !== shared.eventId && row.excerpt !== shared.excerpt),
        `layout ${layout} ${action} ${surface.name} delivered the deleted receipt`);
      assert.deepEqual(item.receipts.map(row => row.excerpt), [independent.excerpt], surface.name);
    }
    assert.equal(core.get({ namespace: ns, memoryId: retired.id }).error?.code, 'memory_not_found');
    assert.deepEqual(markers(db), []);
    assert.equal(db.prepare('SELECT id FROM receipts WHERE id=?').get(stored.id), undefined);
    readTransaction(db, () => {
      assert.throws(() => createRawLineageStorage(db).assertStoredReceipts(ns, [stored], { readExisting: true }),
        { code: 'conversation_deleted' });
    });
    // A fresh envelope could recreate the session under a new conversation ID.
    const rawCounts = db.prepare(`WITH source_conversations AS (
      SELECT id FROM raw_conversations
      WHERE id=? OR (owner_id=? AND scope=? AND project_id=? AND client=? AND session_key=?)
    ) SELECT
      (SELECT count(*) FROM raw_parts WHERE saved=1 AND conversation_id IN (SELECT id FROM source_conversations)) AS parts,
      (SELECT count(*) FROM raw_messages WHERE conversation_id IN (SELECT id FROM source_conversations)) AS messages`);
    const countRaw = () => rawCounts.get(conversationId, ns.ownerId, ns.scope, ns.projectId ?? '', input.client, sessionKey);
    for (const [capture, replay] of [['original envelope', input], ['new envelope', { ...input, eventId: 'recapture-source' }]]) {
      const before = countRaw();
      const result = await core.captureRaw(replay);
      const after = countRaw();
      assert.deepEqual({ ok: result.ok, code: result.error?.code, raw: after },
        { ok: false, code: 'conversation_deleted', raw: before },
        `layout ${layout} ${action} must refuse the ${capture} without saving Raw`);
      t.diagnostic(`${capture}: ${result.error.code}`);
    }
  });
}

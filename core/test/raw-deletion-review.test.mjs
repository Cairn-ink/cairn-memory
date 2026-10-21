import assert from 'node:assert/strict';
import test from 'node:test';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { openRawCaptureCore } from '../raw-capture.mjs';
import { createRawSourceRoots } from '../raw-source-roots.mjs';
import { transaction } from '../database.mjs';
import { fixture, ns, ok, request, splitRaw, localPlainPort } from '../testing/raw-capture-fixtures.mjs';
import { consumer, empty, episodeInput, internal, legacyFixture, legacyKeep, opposite, runtimeFor } from '../testing/raw-deletion-review-fixtures.mjs';

const selected = f => {
  const core = openRawCaptureCore({ path: f.path }, { mode: 'off', deletion: true,
    readPolicy: () => { throw Error('Deletion must not consult policy'); } });
  f.workspace.defer(() => core.close()); return core;
};
const error = (result, code) => { assert.equal(result.ok, false, JSON.stringify(result)); assert.equal(result.error.code, code); };
const snapshot = (db, ignoreWriter = false) => db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name").all()
  .map(({ name }) => [name, db.prepare(`SELECT * FROM "${name}"`).all().map(row => JSON.stringify(
    ignoreWriter && name === 'session_episodes' ? { ...row, writer_token: null, writer_expires_at: null } : row)).sort()]);
const rawCore = (f, extract = empty) => {
  const core = openRawCaptureCore({ path: f.path, model: { ...f.model, extract } }, {
    mode: 'raw-v1', deletion: true, port: localPlainPort(), readPolicy: () => ({ generation: 'synthetic', reason: null }) });
  f.workspace.defer(() => core.close()); return core;
};
async function rawSource(core, client, sessionId, namespace = ns, kind = 'ordinary') {
  const saved = ok(await core.captureRaw(request(splitRaw('Synthetic retained source ' + sessionId + '.', { id: sessionId + '-message' })[0],
    { namespace, client, sessionId, eventId: 'raw-' + sessionId }, kind)));
  return { saved, key: { namespace, conversationId: saved.raw.conversationId,
    expectedRevision: ok(await core.getConversation({ namespace, conversationId: saved.raw.conversationId })).conversation.revision } };
}

test('P3b-07 frozen P2 keep entrypoint retains the mechanically copied original function', () => {
  const text = readFileSync(new URL('../testing/raw-p2-keep.mjs', import.meta.url), 'utf8');
  const body = text.slice(text.indexOf('export async function keepEpisodeCapture')).trimEnd();
  assert.equal(Buffer.byteLength(body), 1930);
  assert.equal(createHash('sha256').update(body).digest('hex'), 'b41fb629088170813a99b6232e3a80646da5f09bdd7cf974c585c034880ad926');
});

for (const client of ['claude-code', 'codex']) {
  test(`P3b-02/04/07 ${client}: actual P2 keep preserves original cross-client root, not consumer stamp`, async t => {
    const f = await legacyFixture(t, client), before = ok(f.core.get({ namespace: ns, memoryId: f.memoryId }));
    assert.equal(before.receipts[0].client, opposite(client));
    const core = selected(f), episode = ok(core.getEpisode({ namespace: ns, episodeId: f.origin })).episode;
    ok(core.forgetEpisode({ namespace: ns, episodeId: f.origin, expectedRevision: episode.revision }));
    error(core.get({ namespace: ns, memoryId: f.memoryId }), 'memory_not_found');
  });

  test(`P3b-03/07 ${client}: zero-Memory source consumer invalidates origin preview CAS`, async t => {
    const f = fixture(t, { deletion: true, kind: 'episode', model: { extract: empty } });
    const first = ok(await f.core.captureRaw(request(splitRaw('Synthetic original source.')[0], { client, sessionId: 'A' }, 'episode')));
    const origin = ok(first.interpretation).episode.id, source = f.db.prepare('SELECT id FROM episode_sources WHERE episode_id=?').get(origin);
    const input = { namespace: ns, conversationId: first.raw.conversationId,
      expectedRevision: ok(await f.core.getConversation({ namespace: ns, conversationId: first.raw.conversationId })).conversation.revision };
    assert.equal(ok(f.core.previewDeleteConversation(input)).invalidatedEpisodes, 1);
    consumer(f, runtimeFor(f), { client: opposite(client), sourceIds: [source.id] });
    assert.equal(f.db.prepare('SELECT count(*) n FROM memories').get().n, 0);
    error(f.core.previewDeleteConversation(input), 'revision_conflict');
    error(f.core.deleteConversation({ ...input, actionId: 'stale' }), 'revision_conflict');
  });

  for (const change of ['forget', 'replace']) test(`P3b-03 ${client}: losing legacy keep proof via ${change} invalidates other actual Memory support roots`, async t => {
    const f = await legacyFixture(t, client);
    const core = openRawCaptureCore({ path: f.path, model: { ...f.model, extract: () => ({ items: [{
      content: 'Synthetic legacy interpretation.', kind: 'fact', confidence: .8, sourceIndices: [0] }] }) } }, {
      mode: 'raw-v1', deletion: true, port: localPlainPort(), readPolicy: () => ({ generation: 'synthetic', reason: null }) });
    f.workspace.defer(() => core.close());
    const saved = ok(await core.captureRaw(request(splitRaw('Synthetic independent source C.', { id: 'C-message' })[0],
      { client, sessionId: 'C' })));
    assert.equal(ok(saved.interpretation).admission.memories[0].id, f.memoryId);
    const receipts = f.db.prepare('SELECT * FROM receipts ORDER BY id').all();
    const input = { namespace: ns, conversationId: saved.raw.conversationId,
      expectedRevision: ok(await core.getConversation({ namespace: ns, conversationId: saved.raw.conversationId })).conversation.revision };
    if (change === 'forget') {
      const episode = ok(core.getEpisode({ namespace: ns, episodeId: f.consumer })).episode;
      ok(core.forgetEpisode({ namespace: ns, episodeId: f.consumer, expectedRevision: episode.revision }));
    } else consumer(f, f.runtime, { client: opposite(client), eventId: 'event-B-replacement', own: true });
    assert.deepEqual(f.db.prepare('SELECT * FROM receipts ORDER BY id').all(), receipts);
    error(core.previewDeleteConversation(input), 'revision_conflict');
    const current = { ...input, expectedRevision: ok(await core.getConversation({ namespace: ns,
      conversationId: saved.raw.conversationId })).conversation.revision };
    error(core.previewDeleteConversation(current), 'raw_lineage_unavailable');
  });

  test(`P3b-02/04/07 ${client}: same-client historical P2 keep resolves original session on a fresh opener`, async t => {
    const f = await legacyFixture(t, client, client, true), core = selected(f);
    const memory = ok(core.get({ namespace: ns, memoryId: f.memoryId })).memory;
    const text = 'Synthetic independent successor.';
    const next = ok(core.admit({ namespace: ns, memory: { content: text, kind: 'fact' },
      receipts: [{ client: 'manual', sessionId: 'explicit', eventId: 'successor', role: 'user', excerpt: text }],
      qualification: { version: 1, slot: { subject: 'Synthetic', property: 'Synthetic', scope: 'Synthetic', applies: 'Synthetic' },
        value: 'new', attribution: 'direct', commitment: 'adopted', anchors: [{ receiptIndex: 0, start: 0, end: text.length, text,
          fields: ['subject','property','scope','applies','value','attribution','commitment'] }] } })).memory;
    const slot = ok(core.bindQualifiedClaim({ namespace: ns, memoryId: memory.id, expectedRevision: memory.revision,
      slotId: null, singleClaim: true })).slotId;
    ok(core.bindQualifiedClaim({ namespace: ns, memoryId: next.id, expectedRevision: next.revision, slotId: slot, singleClaim: true }));
    assert.equal(ok(core.transitionQualified({ namespace: ns, predecessor: { memoryId: memory.id, expectedRevision: memory.revision },
      replacement: { memoryId: next.id, expectedRevision: next.revision } })).status, 'applied');
    core.close();
    const cold = selected(f), origin = ok(cold.getEpisode({ namespace: ns, episodeId: f.origin })).episode;
    assert.equal(ok(cold.get({ namespace: ns, memoryId: memory.id })).memory.state, 'historical');
    ok(cold.forgetEpisode({ namespace: ns, episodeId: f.origin, expectedRevision: origin.revision }));
    error(cold.get({ namespace: ns, memoryId: memory.id }), 'memory_not_found');
    assert.equal(ok(cold.get({ namespace: ns, memoryId: next.id })).memory.state, 'active');
    assert.equal(f.db.prepare('SELECT count(*) n FROM raw_parts').get().n, 0);
  });

  test(`P3b-02/04 ${client}: deduplicated truly independent support survives legacy-origin removal`, async t => {
    const f = await legacyFixture(t, client), core = selected(f);
    const added = ok(core.admit({ namespace: ns, memory: { content: 'Synthetic legacy interpretation.', kind: 'fact' },
      receipts: [{ client: 'manual', sessionId: 'explicit', eventId: 'independent', role: 'user', excerpt: 'Independent support.' }] }));
    assert.equal(added.memory.id, f.memoryId);
    const origin = ok(core.getEpisode({ namespace: ns, episodeId: f.origin })).episode;
    ok(core.forgetEpisode({ namespace: ns, episodeId: f.origin, expectedRevision: origin.revision }));
    const retained = ok(core.get({ namespace: ns, memoryId: f.memoryId }));
    assert.equal(retained.receipts.length, 1); assert.equal(retained.receipts[0].client, 'manual');
  });

  test(`P3b-02/05/07 ${client}: missing original keep IDs refuse across clients before any mutation`, async t => {
    const f = await legacyFixture(t, client), core = selected(f);
    const source = ok(core.getEpisode({ namespace: ns, episodeId: f.consumer })).episode;
    ok(core.forgetEpisode({ namespace: ns, episodeId: f.consumer, expectedRevision: source.revision }));
    const origin = ok(core.getEpisode({ namespace: ns, episodeId: f.origin })).episode, before = snapshot(f.db);
    const cold = selected(f);
    error(cold.forgetEpisode({ namespace: ns, episodeId: f.origin, expectedRevision: origin.revision }), 'raw_lineage_unavailable');
    assert.deepEqual(snapshot(f.db), before);
    const raw = rawCore(f), unrelated = await rawSource(raw, client, 'foreign', { ...ns, ownerId: 'another-owner' });
    ok(raw.deleteConversation({ ...unrelated.key, actionId: 'foreign-delete' }));
    assert.equal(ok(core.get({ namespace: ns, memoryId: f.memoryId })).receipts.length, 1);
  });

  test(`P3b-02/07 ${client}: colliding legacy message IDs do not invent a union or block proven unrelated roots`, async t => {
    const f = fixture(t, { kind: 'episode', model: { extract: empty } });
    const origins = [];
    for (const session of ['A', 'D']) origins.push(ok(await f.core.capture(episodeInput(client, session))).episode.id);
    const sourceIds = origins.map(id => f.db.prepare('SELECT id FROM episode_sources WHERE episode_id=?').get(id).id);
    const runtime = runtimeFor(f), inherited = consumer(f, runtime, { client: opposite(client), sourceIds });
    const kept = await legacyKeep(f, runtime, inherited.id);
    const core = selected(f), origin = ok(core.getEpisode({ namespace: ns, episodeId: origins[0] })).episode;
    const before = snapshot(f.db);
    error(core.forgetEpisode({ namespace: ns, episodeId: origin.id, expectedRevision: origin.revision }), 'raw_lineage_unavailable');
    assert.deepEqual(snapshot(f.db), before);
    const raw = rawCore(f), unrelated = await rawSource(raw, client, 'unrelated');
    ok(raw.deleteConversation({ ...unrelated.key, actionId: 'unrelated-delete' }));
    assert.equal(ok(core.get({ namespace: ns, memoryId: kept.admission.memories[0].id })).receipts.length, 1);
  });

  test(`P3b-05/07 ${client}: legacy keep cascade abort rolls back provenance, prose, receipt and tombstone`, async t => {
    const f = await legacyFixture(t, client), core = selected(f);
    const origin = ok(core.getEpisode({ namespace: ns, episodeId: f.origin })).episode;
    f.db.exec("CREATE TRIGGER fail_legacy_receipt BEFORE DELETE ON receipts BEGIN SELECT RAISE(ABORT,'synthetic receipt abort'); END;");
    const before = snapshot(f.db);
    error(core.forgetEpisode({ namespace: ns, episodeId: f.origin, expectedRevision: origin.revision }), 'storage_error');
    assert.deepEqual(snapshot(f.db), before);
    f.db.exec('DROP TRIGGER fail_legacy_receipt');
    ok(core.forgetEpisode({ namespace: ns, episodeId: f.origin, expectedRevision: origin.revision }));
    error(core.get({ namespace: ns, memoryId: f.memoryId }), 'memory_not_found');
  });

  test(`P3b-03/07 ${client}: source replacement and invalidation stale only reached origins without self-staling drafts`, async t => {
    const f = fixture(t, { deletion: true, kind: 'episode', model: { extract: empty } });
    const a = await rawSource(f.core, client, 'A', ns, 'episode'), c = await rawSource(f.core, client, 'C', ns, 'episode');
    const episodeA = ok(a.saved.interpretation).episode.id;
    const source = f.db.prepare('SELECT id FROM episode_sources WHERE episode_id=?').get(episodeA);
    const runtime = runtimeFor(f);
    consumer(f, runtime, { client: opposite(client), sourceIds: [source.id] });
    const before = { ...a.key, expectedRevision: ok(await f.core.getConversation({ namespace: ns,
      conversationId: a.key.conversationId })).conversation.revision };
    const replacement = consumer(f, runtime, { client: opposite(client), eventId: 'event-B-replace', own: true });
    assert.equal(ok(f.core.getEpisode({ namespace: ns, episodeId: replacement.id })).episode.revision, replacement.result.revision);
    error(f.core.previewDeleteConversation(before), 'revision_conflict');
    assert.equal(ok(f.core.previewDeleteConversation(c.key)).invalidatedEpisodes, 1);
    const sourceAgain = f.db.prepare('SELECT id FROM episode_sources WHERE episode_id=?').get(episodeA);
    const inherited = consumer(f, runtime, { client: opposite(client), eventId: 'event-B-inherit', sourceIds: [sourceAgain.id] });
    const latestA = { ...a.key, expectedRevision: ok(await f.core.getConversation({ namespace: ns,
      conversationId: a.key.conversationId })).conversation.revision };
    const changed = consumer(f, runtime, { client, sessionId: 'A', eventId: 'event-A-replace', own: true });
    assert.equal(changed.id, episodeA);
    assert.equal(ok(f.core.getEpisode({ namespace: ns, episodeId: changed.id })).episode.revision, changed.result.revision);
    assert.equal(ok(f.core.getEpisode({ namespace: ns, episodeId: inherited.id })).episode.processing.state, 'invalidated');
    assert.equal(f.db.prepare('SELECT count(*) n FROM episode_sources WHERE episode_id=?').get(inherited.id).n, 0);
    error(f.core.previewDeleteConversation(latestA), 'revision_conflict');
    assert.equal(ok(f.core.previewDeleteConversation(c.key)).invalidatedEpisodes, 1);
    assert.equal(f.db.prepare('SELECT count(*) n FROM memories').get().n, 0);
  });

  test(`P3b-03/05 ${client}: aborted real source replacement rolls back all graph and CAS mutations`, async t => {
    const f = fixture(t, { deletion: true, kind: 'episode', model: { extract: empty } });
    const a = await rawSource(f.core, client, 'A', ns, 'episode'), episodeA = ok(a.saved.interpretation).episode.id;
    const source = f.db.prepare('SELECT id FROM episode_sources WHERE episode_id=?').get(episodeA), runtime = runtimeFor(f);
    consumer(f, runtime, { client: opposite(client), sourceIds: [source.id] });
    let before;
    assert.throws(() => consumer(f, runtime, { client: opposite(client), eventId: 'event-B-aborted', own: true,
      beforeCommit() {
        f.db.exec("CREATE TRIGGER fail_source_replace AFTER INSERT ON episode_sources BEGIN SELECT RAISE(ABORT,'synthetic source abort'); END;");
        before = snapshot(f.db, true);
      } }), /synthetic source abort/);
    assert.deepEqual(snapshot(f.db, true), before);
    f.db.exec('DROP TRIGGER fail_source_replace');
    assert.equal(f.db.prepare('SELECT count(*) n FROM episode_sources WHERE origin_episode_id=?').get(episodeA).n, 2);
  });

  test(`P3b-03/05 ${client}: snapshot preparation failure cannot retain a source-mutation context after rollback`, async t => {
    const f = fixture(t, { deletion: true, kind: 'episode', model: { extract: empty } });
    const a = await rawSource(f.core, client, 'A', ns, 'episode'), episodeA = ok(a.saved.interpretation).episode.id;
    const source = f.db.prepare('SELECT id FROM episode_sources WHERE episode_id=?').get(episodeA);
    const inherited = consumer(f, runtimeFor(f), { client: opposite(client), sourceIds: [source.id] });
    const roots = createRawSourceRoots(f.db), prepare = f.db.prepare;
    const before = f.db.prepare('SELECT revision FROM raw_conversations WHERE id=?').get(a.key.conversationId).revision;
    let hits = 0;
    f.db.prepare = function(sql) {
      if (sql.startsWith('SELECT id,origin_episode_id,event_id')) { hits++; throw Error('Synthetic snapshot read failure'); }
      return prepare.call(this, sql);
    };
    try {
      assert.throws(() => transaction(f.db, () => roots.mutateEpisodeSources(internal, inherited.id, () => {
        assert.fail('Mutation must not run after failed preparation');
      })), /Synthetic snapshot read failure/);
    } finally { f.db.prepare = prepare; }
    assert.equal(hits, 1);
    transaction(f.db, () => roots.mutateEpisodeSources(internal, inherited.id,
      () => f.db.prepare('DELETE FROM episode_sources WHERE episode_id=?').run(inherited.id)));
    assert.ok(f.db.prepare('SELECT revision FROM raw_conversations WHERE id=?').get(a.key.conversationId).revision > before);
  });
}

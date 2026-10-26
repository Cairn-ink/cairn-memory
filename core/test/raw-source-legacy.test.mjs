import assert from 'node:assert/strict';
import test from 'node:test';
import { openRawCaptureCore } from '../raw-capture.mjs';
import { fixture } from '../testing/raw-capture-fixtures.mjs';
import { consumer, empty, legacyFixture, legacyKeep, opposite, runtimeFor } from '../testing/raw-deletion-review-fixtures.mjs';
import { cardHost, ns, ok, request, splitRaw, localPlainPort } from '../testing/raw-source-fixtures.mjs';

for (const client of ['claude-code','codex']) {
  for (const mutation of ['forget','correct']) for (const foreign of ['none','owner','project']) {
    test(`P3c-08/10 ${client}: ordinary no-Raw legacy keep ${mutation} remains compatible with foreign ${foreign}`, async t => {
      const f = await legacyFixture(t,client), host = cardHost();
      const core = openRawCaptureCore({ path: f.path,privateCards: host.options },{
        mode: 'raw-v1',sources: true,port: localPlainPort(),readPolicy: () => ({ generation: 'synthetic',reason: null }) });
      f.workspace.defer(() => core.close());
      assert.equal(f.db.prepare('PRAGMA user_version').get().user_version,28);
      const targetCount = () => f.db.prepare('SELECT count(*) n FROM raw_conversations WHERE owner_id=? AND scope=? AND project_id=?')
        .get(ns.ownerId,ns.scope,'').n;
      assert.equal(targetCount(),0);
      if (foreign !== 'none') {
        const namespace = foreign === 'owner' ? { ...ns,ownerId: 'synthetic-foreign-owner' } :
          { ...ns,scope: 'project',projectId: 'synthetic-foreign-project' };
        ok(await core.captureRaw(request(splitRaw('Synthetic foreign retained source.')[0],{
          namespace,client,sessionId: 'foreign',eventId: 'foreign-raw' })));
        assert.equal(f.db.prepare('SELECT count(*) n FROM raw_conversations').get().n,1);
      }
      const episode = ok(core.getEpisode({ namespace: ns,episodeId: f.consumer })).episode;
      ok(core.forgetEpisode({ namespace: ns,episodeId: f.consumer,expectedRevision: episode.revision }));
      assert.equal(f.db.prepare(`SELECT count(*) n FROM episode_keep_actions a JOIN json_each(a.keep_source_ids) j
        JOIN episode_sources s ON s.id=j.value WHERE a.episode_id=?`).get(f.consumer).n,0);
      assert.equal(f.db.prepare('SELECT count(*) n FROM episode_keep_actions WHERE episode_id=?').get(f.consumer).n,1);
      const before = ok(core.get({ namespace: ns,memoryId: f.memoryId }));
      assert.equal(before.memory.state,'active'); assert.equal(before.receipts[0].client,opposite(client));
      assert.equal(targetCount(),0);
      const rawSnapshot = () => ['raw_conversations','raw_messages','raw_parts','raw_events','raw_source_maps',
        'raw_source_exclusions','raw_owner_usage','card_raw_bindings'].map(name => [name,
        f.db.prepare(`SELECT * FROM "${name}"`).all().map(row => JSON.stringify(row)).sort()]);
      const foreignBefore = rawSnapshot();
      if (mutation === 'forget') {
        ok(core.forget({ namespace: ns,memoryId: f.memoryId,expectedRevision: before.memory.revision }));
        assert.equal(core.get({ namespace: ns,memoryId: f.memoryId }).error.code,'memory_not_found');
        assert.equal(f.db.prepare('SELECT count(*) n FROM receipts WHERE memory_id=?').get(f.memoryId).n,0);
      } else {
        ok(core.correct({ namespace: ns,memoryId: f.memoryId,expectedRevision: before.memory.revision,
          content: 'Synthetic ordinary corrected interpretation.',kind: 'fact',receipt: { client: 'manual',sessionId: 'explicit',
            eventId: 'correct',role: 'user',excerpt: 'Independent ordinary correction.' } }));
        const corrected = ok(core.get({ namespace: ns,memoryId: f.memoryId }));
        assert.equal(corrected.memory.content,'Synthetic ordinary corrected interpretation.');
        assert.equal(corrected.receipts.length,1); assert.equal(corrected.receipts[0].client,'manual');
      }
      assert.equal(targetCount(),0); assert.deepEqual(rawSnapshot(),foreignBefore);
    });
  }
  for (const mutation of ['forget','correct','ambiguous']) test(`P3c-08/10 ${client}: actual P2 cross-client keep ${mutation} protects its original retained Raw source`, async t => {
    const f = fixture(t,{ kind: 'episode',model: { extract: empty } });
    const text = 'Synthetic actual P2 retained Raw A.';
    const captured = ok(await f.core.captureRaw(request(splitRaw(text)[0],{ client,sessionId: 'A',eventId: 'raw-A' },'episode')));
    const origin = ok(captured.interpretation).episode.id;
    const passage = f.db.prepare('SELECT id FROM episode_sources WHERE episode_id=?').get(origin);
    const runtime = runtimeFor(f), inherited = consumer(f,runtime,{ client: opposite(client),sourceIds: [passage.id] });
    const kept = await legacyKeep(f,runtime,inherited.id), memoryId = kept.admission.memories[0].id;
    assert.equal(f.db.prepare('PRAGMA user_version').get().user_version,25);
    assert.equal(f.db.prepare("SELECT count(*) n FROM sqlite_master WHERE name='raw_receipt_lineage'").get().n,0);
    assert.equal(f.db.prepare('SELECT client FROM receipts WHERE memory_id=?').get(memoryId).client,opposite(client));
    const host = cardHost(), core = openRawCaptureCore({ path: f.path,privateCards: host.options },{
      mode: 'off',sources: true,port: localPlainPort(),readPolicy: () => { throw Error('Read only'); } });
    f.workspace.defer(() => core.close());
    const call = (method,input) => host.call(core,method,input);
    const expectedConversationRevision = f.db.prepare('SELECT revision FROM raw_conversations WHERE id=?').get(captured.raw.conversationId).revision;
    const sources = ok(await call('resolveSourceReferences',{ namespace: ns,anchors: [{
      rawAnchor: { conversationId: captured.raw.conversationId,messageId: 'message',start: 0,end: 8,precision: 'exact' },expectedConversationRevision }] })).sources;
    const draft = ok(call('createCardDraft',{ namespace: ns,actionId: 'draft',drafting: 'authored',input: {
      sources,title: 'Synthetic independently authored title',body: 'Synthetic independently authored body.' } }));
    ok(call('confirmCardDraft',{ namespace: ns,cardId: draft.id,expectedRevision: draft.revision,actionId: 'confirm',applicability: 'current' }));
    const memory = f.db.prepare('SELECT revision FROM memories WHERE id=?').get(memoryId);
    if (mutation === 'ambiguous') {
      const episode = ok(core.getEpisode({ namespace: ns,episodeId: inherited.id })).episode;
      ok(core.forgetEpisode({ namespace: ns,episodeId: inherited.id,expectedRevision: episode.revision }));
      const snapshot = () => f.db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name").all()
        .map(({ name }) => [name,f.db.prepare(`SELECT * FROM "${name}"`).all().map(row => JSON.stringify(row)).sort()]);
      const before = snapshot();
      const result = f.core.forget({ namespace: ns,memoryId,expectedRevision: memory.revision });
      assert.deepEqual(result,{ ok: false,error: { code: 'raw_lineage_unavailable',retryable: false } });
      assert.deepEqual(f.core.correct({ namespace: ns,memoryId,expectedRevision: memory.revision,
        content: 'Synthetic independent replacement.',kind: 'fact',receipt: { client: 'manual',sessionId: 'explicit',
          eventId: 'correct',role: 'user',excerpt: 'Independent correction.' } }),
      { ok: false,error: { code: 'raw_lineage_unavailable',retryable: false } });
      assert.deepEqual(snapshot(),before); return;
    }
    if (mutation === 'forget') ok(f.core.forget({ namespace: ns,memoryId,expectedRevision: memory.revision }));
    else ok(f.core.correct({ namespace: ns,memoryId,expectedRevision: memory.revision,
      content: 'Synthetic independently corrected interpretation.',kind: 'fact',
      receipt: { client: 'manual',sessionId: 'explicit',eventId: 'correct',role: 'user',excerpt: 'Independent explicit correction.' } }));
    const exclusions = f.db.prepare('SELECT count(*) n FROM raw_source_exclusions WHERE conversation_id=?').get(captured.raw.conversationId).n;
    const support = ok(call('getCard',{ namespace: ns,cardId: draft.id })).card.support.status;
    assert.deepEqual({ exclusions,support },{ exclusions: 1,support: 'unavailable' });
  });
}

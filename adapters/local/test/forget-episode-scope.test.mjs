import test from 'node:test';
import assert from 'node:assert/strict';
import { setup, sql, ok, range, forgottenText, stepText } from './fixtures/forget-episode.mjs';
import { layouts, label, snapshot, assertStored, assertReads, copySummary, noNeedles, checkpoint, bytes } from './fixtures/forget-episode-assertions.mjs';

const namedSource = state => state.episodes.find(row => JSON.parse(row.record).gist.includes(forgottenText));
const independent = state => state.episodes.find(row => JSON.parse(row.record).gist.includes('independent'));
async function committedReads(f, before, expected) {
  assertStored(f, before, expected);
  await assertReads(f, before, expected);
  await f.reopen();
  await assertReads(f, before, expected);
}
function storeRows(f) {
  return sql(f.path, db => Object.fromEntries(db.prepare("SELECT name FROM sqlite_schema WHERE type='table' ORDER BY name").all()
    .map(({ name }) => [name, db.prepare('SELECT * FROM "' + name.replaceAll('"', '""') + '"').all().map(JSON.stringify).sort()])));
}
async function mixedFixture(t, options, fence) {
  const f = await setup(t, { ...options, noCards: true,
    independentOffset: fence === 'window' ? 0 : fence === 'unknown-time' ? null : -3 * 86400000 });
  const initial = snapshot(f), source = namedSource(initial), other = independent(initial);
  const passages = sql(f.path, db => [source, other].map(row =>
    db.prepare('SELECT id FROM episode_sources WHERE episode_id=? ORDER BY id LIMIT 1').get(row.id).id));
  const consumer = copySummary(f, passages), before = snapshot(f);
  assert.equal(before.sources.filter(row => row.episode_id === consumer).length, 2, 'supported publication retains both proven origins');
  return { f, source, other, consumer, before };
}
async function cleanRefusal(f, operation, before) {
  checkpoint(f);
  const unchanged = bytes(f), rows = storeRows(f);
  for (const attempt of ['initial attempt', 'immediate retry']) {
    const result = await f.act(operation);
    assert.deepEqual(result, { ok: false, error: { code: 'conversation_deleted', retryable: false } }, attempt);
    noNeedles(result);
    assert.deepEqual(bytes(f), unchanged, attempt + ': database and WAL bytes unchanged');
    assert.deepEqual(storeRows(f), rows, attempt + ': every stored table rolls back');
    assert.deepEqual(snapshot(f), before, attempt + ': no Episode, source or header changes');
    sql(f.path, db => {
      assert.equal(db.prepare('SELECT count(*) n FROM raw_session_fences').get().n, 0, 'no fence committed');
      assert.equal(db.prepare('SELECT count(*) n FROM raw_source_exclusions').get().n, 0, 'no source exclusion committed');
      assert.equal(db.prepare('SELECT count(*) n FROM local_raw_hide_windows').get().n, 0, 'no hide window committed');
      assert.deepEqual(db.prepare('SELECT * FROM memories WHERE id=?').get(f.target.id), f.target, 'Memory stays live and unchanged');
    });
  }
  assert.equal(ok(await f.core.get({ namespace: f.namespace, memoryId: f.target.id })).memory.content, forgottenText);
  const recalled = ok(await f.core.recall({ readSet: [f.namespace], query: 'synthetic', limit: 12 }));
  assert.ok(recalled.memories.some(item => item.memory.id === f.target.id && item.memory.content === forgottenText),
    'refused Memory remains recallable after both attempts');
  assert.deepEqual(bytes(f), unchanged, 'verification reads leave database and WAL unchanged');
  assert.deepEqual(storeRows(f), rows, 'verification reads leave every table unchanged');
}
for (const options of layouts) for (const operation of ['forget', 'correct']) {
  test('named source preserves window and unknown-time Episodes ' + label(options) + ' ' + operation, { concurrency: false }, async t => {
    const f = await setup(t, { ...options, neighbour: true, unknownTime: true });
    const before = snapshot(f), source = namedSource(before);
    assert.equal(before.episodes.length, 4);
    assert.ok(JSON.stringify(ok(await f.core.listEpisodes({ namespace: f.namespace, ...range, timeBasis: 'receipt' }))).includes(stepText));
    ok(await f.act(operation));
    // Unnamed neighbours are untouched in this change; read-time withholding is separate work.
    await committedReads(f, before, { named: [source.id] });
    sql(f.path, db => {
      for (const row of before.episodes.filter(row => row.id !== independent(before).id))
        assert.ok(db.prepare('SELECT 1 FROM raw_session_fences WHERE client=? AND session_key=?').get(row.client, row.session_key), 'window and unknown-time fences still commit');
    });
  });
  test('session-less receipt preserves every Episode and source row ' + label(options) + ' ' + operation, { concurrency: false }, async t => {
    const f = await setup(t, { ...options, sessionless: true, neighbour: true, unknownTime: true, noCards: true });
    const before = snapshot(f);
    assert.equal(f.targetReceipt.session_id, 'explicit-tool');
    ok(await f.act(operation));
    await committedReads(f, before, {});
  });
  test('two named sessions invalidate both source Episodes ' + label(options) + ' ' + operation, { concurrency: false }, async t => {
    const f = await setup(t, { ...options, twoNamed: true, neighbour: true, unknownTime: true, noCards: true });
    const before = snapshot(f), named = [namedSource(before).id, independent(before).id];
    assert.equal(sql(f.path, db => db.prepare('SELECT count(*) n FROM receipts WHERE memory_id=?').get(f.target.id).n), 2);
    ok(await f.act(operation));
    await committedReads(f, before, { named });
    sql(f.path, db => {
      for (const id of named) {
        const episode = before.episodes.find(row => row.id === id);
        const conversation = before.headers.find(row => row.client === episode.client && row.session_key === episode.session_key);
        assert.ok(db.prepare('SELECT 1 FROM raw_session_fences WHERE client=? AND session_key=?').get(episode.client, episode.session_key));
        assert.ok(db.prepare('SELECT 1 FROM raw_source_exclusions WHERE conversation_id=?').get(conversation.id), 'both named source exclusions commit');
      }
    });
  });
  test('cross-conversation consumer loses named passages and step ' + label(options) + ' ' + operation, { concurrency: false }, async t => {
    const f = await setup(t, { ...options, noCards: true });
    const source = namedSource(snapshot(f));
    const passage = sql(f.path, db => db.prepare('SELECT id FROM episode_sources WHERE episode_id=? ORDER BY id LIMIT 1').get(source.id));
    const consumer = copySummary(f, [passage.id]);
    const before = snapshot(f), needles = [forgottenText, stepText, 'consumerneedle', 'consumerstep'];
    assert.notEqual(before.episodes.find(row => row.id === consumer).session_key, source.session_key);
    assert.ok(JSON.stringify(ok(await f.core.getEpisode({ namespace: f.namespace, episodeId: consumer }))).includes('consumerstep'));
    ok(await f.act(operation));
    await committedReads(f, before, { named: [source.id], consumers: [consumer], needles });
  });
  for (const fence of ['window', 'unknown-time', 'outside window']) {
    test('mixed-origin summary ' + fence + ' pins commit outcome ' + label(options) + ' ' + operation, { concurrency: false }, async t => {
      const { f, source, other, consumer, before } = await mixedFixture(t, options, fence);
      if (options.layout >= 48 && fence !== 'outside window') {
        await cleanRefusal(f, operation, before);
      } else {
        const result = await f.act(operation); ok(result);
        await committedReads(f, before, { named: [source.id], consumers: [consumer], upstream: [other.id],
          needles: [forgottenText, stepText, 'consumerneedle', 'consumerstep'] });
        assert.equal(sql(f.path, db => Boolean(db.prepare('SELECT 1 FROM raw_session_fences WHERE client=? AND session_key=?')
          .get(other.client, other.session_key))), fence !== 'outside window', 'the control differs only in whether the unrelated origin is fenced');
        noNeedles(result);
      }
    });
    if (options.layout >= 48 && fence !== 'outside window') for (const deletion of ['unrelated', 'source'])
      test('mixed-origin summary ' + fence + ' deletes ' + deletion + ' conversation then ' + operation + ' ' + label(options),
        { concurrency: false }, async t => {
          const { f, source, other, consumer, before } = await mixedFixture(t, options, fence);
          await cleanRefusal(f, operation, before);
          const removed = deletion === 'unrelated' ? other : source;
          const header = before.headers.find(row => row.client === removed.client && row.session_key === removed.session_key);
          // Match the owner's raw delete --conversation --yes path, including
          // retainMemories: adapters/mcp/raw-command.mjs:95-96. No SQL deletion.
          const deleted = await f.core.deleteConversation({ namespace: f.namespace, conversationId: header.id,
            expectedRevision: header.revision, retainMemories: true, actionId: 'delete-before-' + operation });
          assert.equal(ok(deleted).conversationId, header.id);
          noNeedles(deleted);
          assertStored(f, before, { named: [removed.id], consumers: [consumer],
            upstream: [deletion === 'unrelated' ? source.id : other.id] });
          sql(f.path, db => {
            assert.equal(db.prepare('SELECT 1 FROM raw_conversations WHERE id=?').get(header.id), undefined);
            assert.deepEqual(db.prepare('SELECT * FROM memories WHERE id=?').get(f.target.id), f.target,
              'owner conversation deletion retains the Memory before the requested mutation');
          });
          const afterDeletion = snapshot(f), result = await f.act(operation);
          ok(result); noNeedles(result);
          // Removing the source conversation also removes Raw ancestry used by
          // Memory list. Its retained survivor receipt then lacks usable evidence
          // (core/raw-deletion-storage.mjs:183-187; core/runtime.mjs:632).
          await committedReads(f, afterDeletion, { named: deletion === 'unrelated' ? [source.id, other.id] : [source.id], consumers: [consumer],
            listRefused: deletion === 'unrelated', evidenceUnavailable: deletion === 'source',
            needles: [forgottenText, stepText, 'consumerneedle', 'consumerstep'] });
          sql(f.path, db => {
            const memory = db.prepare('SELECT * FROM memories WHERE id=?').get(f.target.id);
            assert.equal(memory.deleted, Number(operation === 'forget'));
            assert.equal(memory.content, operation === 'forget' ? null : 'synthetic corrected replacement');
            assert.ok(db.prepare('SELECT 1 FROM raw_session_fences WHERE client=? AND session_key=?').get(source.client, source.session_key));
            if (deletion === 'unrelated') assert.ok(db.prepare('SELECT 1 FROM raw_source_exclusions WHERE conversation_id=?').get(f.conversation.id));
          });
        });
  }
}

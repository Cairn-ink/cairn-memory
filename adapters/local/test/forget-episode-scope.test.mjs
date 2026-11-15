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
  for (const fence of ['window', 'unknown-time', 'outside window'])
    test('mixed-origin summary ' + fence + ' pins commit outcome ' + label(options) + ' ' + operation, { concurrency: false }, async t => {
      const f = await setup(t, { ...options, noCards: true,
        independentOffset: fence === 'window' ? 0 : fence === 'unknown-time' ? null : -3 * 86400000 });
      const initial = snapshot(f), source = namedSource(initial), other = independent(initial);
      const passages = sql(f.path, db => [source, other].map(row =>
        db.prepare('SELECT id FROM episode_sources WHERE episode_id=? ORDER BY id LIMIT 1').get(row.id).id));
      const consumer = copySummary(f, passages);
      const before = snapshot(f);
      assert.equal(before.sources.filter(row => row.episode_id === consumer).length, 2, 'supported publication retains both proven origins');
      checkpoint(f); const unchanged = bytes(f);
      const result = await f.act(operation);
      if (options.layout >= 48 && fence !== 'outside window') {
        assert.deepEqual(result, { ok: false, error: { code: 'conversation_deleted', retryable: false } });
        assert.deepEqual(bytes(f), unchanged, 'known-limit refusal leaves database and WAL bytes unchanged');
        assert.deepEqual(snapshot(f), before, 'all Episode/source/header rows roll back');
        assert.equal(ok(await f.core.get({ namespace: f.namespace, memoryId: f.target.id })).memory.content, forgottenText);
      } else {
        ok(result);
        await committedReads(f, before, { named: [source.id], consumers: [consumer], upstream: [other.id],
          needles: [forgottenText, stepText, 'consumerneedle', 'consumerstep'] });
        assert.equal(sql(f.path, db => Boolean(db.prepare('SELECT 1 FROM raw_session_fences WHERE client=? AND session_key=?')
          .get(other.client, other.session_key))), fence !== 'outside window', 'the control differs only in whether the unrelated origin is fenced');
        noNeedles(result);
      }
    });
}

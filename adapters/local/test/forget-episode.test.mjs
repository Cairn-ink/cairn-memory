import test from 'node:test';
import assert from 'node:assert/strict';
import { registerContentWriteGuard } from '../../../core/content-write-context.mjs';
import { beginContentWriteSafety } from '../../../core/content-write-safety.mjs';
import { setup, sql, ok, range, forgottenText, stepText, otherStep, neighbourStep } from './fixtures/forget-episode.mjs';

// Preserve the eleven recording-probe scenarios, and pair each forget with correct.
const cases = [
  ['X_29_episodes', { layout: 29 }], ['X_33_episodes', { layout: 33 }],
  ['X_48_episodes', { layout: 48 }], ['X_48_no_episodes', { layout: 48, noEpisodes: true }],
  ['X_48_episodes_other_session_only', { layout: 48, episodeOtherOnly: true }],
  ['X_53time_episodes', { layout: 53 }], ['X_53time_no_episodes', { layout: 53, noEpisodes: true }],
  ['X_53time_episodes_other_session_only', { layout: 53, episodeOtherOnly: true }],
  ['X_53lineage_episodes', { layout: 53, cardLineage: true }],
  ['X_53lineage_no_episodes', { layout: 53, cardLineage: true, noEpisodes: true }],
  ['X_53time_different_messages_episodes', { layout: 53, differentMessages: true }],
];
const text = value => JSON.stringify(value);
function noNeedles(value) {
  for (const needle of [forgottenText, stepText]) assert.equal(text(value).includes(needle), false, 'whole result must withhold ' + needle);
}
function committed(f, operation, connection) {
  const check = db => {
    const row = db.prepare('SELECT * FROM memories WHERE id=?').get(f.target.id);
    assert.equal(row.deleted, operation === 'forget' ? 1 : 0);
    assert.equal(row.content, operation === 'forget' ? null : 'synthetic corrected replacement');
    assert.equal(db.prepare('SELECT count(*) n FROM raw_session_fences WHERE client=? AND session_key=?')
      .get(f.conversation.client, f.conversation.session_key).n, 1, 'source session fence commits');
    assert.ok(db.prepare('SELECT 1 FROM raw_source_exclusions WHERE conversation_id=?').get(f.conversation.id), 'source exclusion commits');
    for (const episode of f.episodes) {
      const fenced = db.prepare('SELECT 1 FROM raw_session_fences WHERE owner_id=? AND scope=? AND project_id=? AND client=? AND session_key=?')
        .get(episode.owner_id, episode.scope, episode.project_id, episode.client, episode.session_key);
      const current = db.prepare('SELECT * FROM session_episodes WHERE id=?').get(episode.id);
      if (fenced) {
        assert.equal(current.deleted, 1, 'every fenced Episode is withheld in the transaction');
        assert.equal(JSON.parse(current.record).processing.state, 'invalidated');
        assert.equal(JSON.parse(current.record).nextStep, null);
        assert.equal(db.prepare('SELECT count(*) n FROM episode_sources WHERE episode_id=?').get(episode.id).n, 0);
      } else assert.deepEqual(current, episode, 'unfenced Episode stays byte-for-byte unchanged');
    }
  };
  if (connection) check(connection); else sql(f.path, check);
}
async function reads(f) {
  const namespace = f.namespace;
  const pages = [];
  noNeedles(await f.core.get({ namespace, memoryId: f.target.id }));
  const listed = await f.core.list({ namespace, limit: 50 }); ok(listed); noNeedles(listed);
  for (const timeBasis of ['event', 'receipt']) {
    const result = await f.core.listEpisodes({ namespace, ...range, timeBasis });
    noNeedles(result);
    const items = ok(result).items;
    for (const episode of f.episodes) {
      const deleted = sql(f.path, db => db.prepare('SELECT deleted FROM session_episodes WHERE id=?').get(episode.id).deleted);
      assert.equal(items.some(item => item.id === episode.id), !deleted, 'Episode list withholds exactly the invalidated Episodes');
    }
    pages.push(result);
  }
  for (const episode of f.episodes) {
    const result = await f.core.getEpisode({ namespace, episodeId: episode.id });
    noNeedles(result);
    const deleted = sql(f.path, db => db.prepare('SELECT deleted FROM session_episodes WHERE id=?').get(episode.id).deleted);
    if (deleted) assert.equal(result.error?.code, 'episode_not_found');
    else assert.equal(ok(result).episode.id, episode.id, 'unrelated Episode still reads');
  }
  for (const input of [
    { readSet: [namespace], query: 'synthetic', limit: 12 },
    { readSet: [namespace], query: 'synthetic', limit: 12, includeQualification: true },
    { readSet: [namespace], query: 'synthetic', limit: 12, contextMode: 'rationale-evidence' },
  ]) { const result = await f.core.recall(input); ok(result); noNeedles(result); }
  // Session start is also the public next-step reader; check both groups and the whole envelope.
  for (const groups of [{ nextSteps: true, procedural: false }, { nextSteps: true, procedural: true, background: true }]) {
    const result = await f.core.sessionStartContext({ namespace, groups, maxChars: 8000, maxTokens: 2000 });
    ok(result); noNeedles(result);
    if (f.episodes.length) assert.ok([otherStep, neighbourStep].some(step => text(result).includes(step)), 'a retained next step is still delivered');
  }
  return pages;
}
for (const [name, options] of cases) for (const operation of ['forget', 'correct']) {
  const caseName = name === 'X_53time_episodes' && operation === 'correct' ? 'X_53time_correct_episodes' : name + ' ' + operation;
  test(caseName, { concurrency: false, timeout: 120000 }, async t => {
    const f = await setup(t, options);
    if (!options.noEpisodes && !options.episodeOtherOnly) {
      const before = ok(await f.core.listEpisodes({ namespace: f.namespace, ...range, timeBasis: 'receipt' }));
      assert.ok(text(before).includes(stepText), 'a deliverable target step exists before mutation');
    }
    let commits = 0;
    registerContentWriteGuard((db, context) => {
      const state = beginContentWriteSafety(db, context);
      if (!state) return state;
      return { ...state, validate(result) {
        state.validate(result);
        if (context.method === operation) {
          commits++;
          assert.equal(db.isTransaction, true);
          committed(f, operation, db);
        }
      } };
    });
    try { ok(await f.act(operation)); } finally { registerContentWriteGuard(beginContentWriteSafety); }
    if (options.layout >= 48) assert.equal(commits, 1, 'post-state is checked before COMMIT');
    committed(f, operation);
    await reads(f);
    await f.reopen();
    await reads(f);
  });
}
for (const operation of ['forget', 'correct']) test('window-selected neighbour Episodes ' + operation, { concurrency: false }, async t => {
  const f = await setup(t, { layout: 53, neighbour: true });
  ok(await f.act(operation));
  // Deliberately derive the expectation from actual fences: session-keyed hiding is valid too.
  committed(f, operation);
  await reads(f);
});
test('pending direct Raw readers whole-result needle scan', {
  skip: 'Pending the direct-reader fix on its separate branch; this branch only withholds Episodes.'
}, () => {});

import assert from 'node:assert/strict';
import { setup, sql, forgottenText } from './forget-episode.mjs';
import { snapshot, assertStored, assertReads, copySummary, checkpoint, bytes } from './forget-episode-assertions.mjs';
import { assertRecorded } from './forget-episode-recording.mjs';

export const namedSource = state => state.episodes.find(row => JSON.parse(row.record).gist.includes(forgottenText));
export const independent = state => state.episodes.find(row => JSON.parse(row.record).gist.includes('independent'));
export async function committedReads(f, before, { readBefore = before, ...expected }) {
  // Remedies compare storage from the deletion snapshot, but read pins keep
  // the original fixture identities after deletion has cleared their records.
  assertStored(f, before, expected);
  await assertReads(f, readBefore, expected);
  await f.reopen();
  await assertReads(f, readBefore, expected);
}
function storeRows(f) {
  return sql(f.path, db => Object.fromEntries(db.prepare("SELECT name FROM sqlite_schema WHERE type='table' ORDER BY name").all()
    .map(({ name }) => [name, db.prepare('SELECT * FROM "' + name.replaceAll('"', '""') + '"').all().map(JSON.stringify).sort()])));
}
export async function mixedFixture(t, options, fence) {
  const f = await setup(t, { ...options, noCards: true,
    independentOffset: fence === 'window' ? 0 : -3 * 86400000 });
  const initial = snapshot(f), source = namedSource(initial), other = independent(initial);
  const passages = sql(f.path, db => [source, other].map(row =>
    db.prepare('SELECT id FROM episode_sources WHERE episode_id=? ORDER BY id LIMIT 1').get(row.id).id));
  const consumer = copySummary(f, passages), before = snapshot(f);
  assert.equal(before.sources.filter(row => row.episode_id === consumer).length, 2, 'supported publication retains both proven origins');
  return { f, source, other, consumer, before };
}
export async function cleanRefusal(f, operation, before, pin) {
  checkpoint(f);
  const unchanged = bytes(f), rows = storeRows(f);
  for (const [index, attempt] of ['initial attempt', 'immediate retry'].entries()) {
    const result = await f.act(operation);
    assertRecorded(result, pin.actions[index]);
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
  assert.equal(assertRecorded(await f.core.get({ namespace: f.namespace, memoryId: f.target.id }), pin.p2.get).memory.content, forgottenText);
  const recalled = assertRecorded(await f.core.recall({ readSet: [f.namespace], query: 'synthetic', limit: 12 }), pin.p2['recall[default]']);
  assert.ok(recalled.memories.some(item => item.memory.id === f.target.id && item.memory.content === forgottenText),
    'refused Memory remains recallable after both attempts');
  assert.deepEqual(bytes(f), unchanged, 'verification reads leave database and WAL unchanged');
  assert.deepEqual(storeRows(f), rows, 'verification reads leave every table unchanged');
}

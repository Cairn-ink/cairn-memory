import assert from 'node:assert/strict';
import test from 'node:test';
import { openMemoryCore } from '../index.mjs';
import { migrateCardLineage } from '../content-safety-migration.mjs';
import { copySqliteFixture, safetyFixture, quiescence, ns, ok } from '../testing/content-safety-s2h-fixture.mjs';
import { input, interpretation, model, options } from '../testing/episode-capture-helpers.mjs';

const sharedText = 'Synthetic withdrawn keep source';
const keptText = 'Synthetic independent keep source';

async function setup(t, layout) {
  const f = safetyFixture(t, 33);
  if (layout === 48) await f.migrate();
  if (layout === 53) {
    copySqliteFixture(f.path, f.backupPath);
    await migrateCardLineage({ path: f.path, backupPath: f.backupPath,
      expected: { storeId: f.storeId, base: 33 }, quiescence });
  }
  const port = model({ interpretEpisode(request) {
    const result = interpretation(request);
    const sourceIndex = request.input.sources.findIndex(source => source.text === keptText);
    if (sourceIndex >= 0) result.gist.anchors = [{ sourceIndex, start: 0, end: keptText.length }];
    return result;
  } });
  const core = openMemoryCore({ path: f.path, ...options, model: port });
  f.workspace.defer(() => core.close());
  const db = f.connect();
  f.workspace.defer(() => db.close());
  assert.equal(db.prepare('PRAGMA user_version').get().user_version, layout);
  const session = 'keep-action-session';
  const { episode } = ok(await core.capture(input(1, session, { namespace: ns, messages: [
    { id: 'shared-keep-message', role: 'user', content: sharedText },
    { id: 'independent-keep-message', role: 'user', content: keptText },
  ] })));
  const detail = () => ok(core.getEpisode({ namespace: ns, episodeId: episode.id }));
  const original = detail();
  const shared = original.sources.items.find(source => source.text === sharedText);
  const kept = original.sources.items.find(source => source.text === keptText);
  assert.ok(shared && kept);
  function makeDonor() {
    const donor = ok(core.admit({ namespace: ns, memory: { content: 'Synthetic keep donor', kind: 'fact' },
      receipts: [{ client: original.episode.client, sessionId: original.episode.sessionKey,
        eventId: shared.messageId, role: shared.role, excerpt: shared.text }] })).memory;
    return () => ok(core.forget({ namespace: ns, memoryId: donor.id, expectedRevision: donor.revision }));
  }
  const keep = async (actionId, expectedRevision) => core.keepEpisode({
    namespace: ns, episodeId: episode.id, actionId, expectedRevision,
  });
  return { core, db, port, session, detail, original, shared, kept, makeDonor, keep };
}

for (const layout of [33, 48, 53]) {
  test(`a fresh Keep sends and returns only visible sources on layout ${layout}`, async t => {
    const { port, detail, shared, kept, makeDonor, keep } = await setup(t, layout);
    makeDonor()();
    const current = detail();
    assert.deepEqual(current.sources.items.map(source => source.id), [kept.id]);
    const before = port.calls.length;
    const response = await keep('fresh-keep', current.episode.revision);
    const requests = port.calls.slice(before).filter(call => call.method === 'extract');
    assert.equal(requests.length, 1);
    const modelInput = JSON.stringify(requests[0].request.input);
    assert.ok(!modelInput.includes(shared.text), 'the marked excerpt must stay out of the extractor input');
    assert.ok(modelInput.includes(kept.text));
    const value = ok(response);
    assert.deepEqual(value.episode.sourceCoverage.sourceIds, [kept.id]);
    assert.deepEqual(value.episode.sourceCoverage, detail().keepActions.items[0].sourceCoverage);
  });

  test(`a replayed Keep respects withdrawal after draft replacement on layout ${layout}`, async t => {
    const { core, db, port, session, detail, original, shared, kept, makeDonor, keep } = await setup(t, layout);
    const episodeId = original.episode.id;
    const { revision } = ok(core.correctEpisode({ namespace: ns, episodeId, expectedRevision: original.episode.revision,
      patch: { gist: { text: 'Synthetic pinned gist',
        anchors: [{ sourceId: kept.id, digest: kept.digest, start: 0, end: kept.text.length }] } } }));
    const completed = ok(await keep('completed-keep', revision));
    assert.deepEqual(completed.episode.sourceCoverage.sourceIds.toSorted(), [shared.id, kept.id].sort());
    const forget = makeDonor();
    const replacement = input(2, session, { namespace: ns });
    replacement.episodeContext.origin = 'precompact';
    ok(await core.capture(replacement));
    assert.equal(db.prepare('SELECT 1 FROM episode_sources WHERE id=?').get(shared.id), undefined);

    forget();
    const expected = detail().keepActions.items[0].sourceCoverage;
    assert.deepEqual(expected.sourceIds, [kept.id]);
    const before = port.calls.length;
    const replay = await keep('completed-keep', revision);
    assert.equal(port.calls.length, before);
    assert.equal(ok(replay).duplicate, true);
    assert.deepEqual(ok(replay).episode.sourceCoverage, expected);
  });
}

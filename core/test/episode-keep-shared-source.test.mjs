import assert from 'node:assert/strict';
import { join } from 'node:path';
import { test } from 'node:test';
import { openMemoryCore } from '../index.mjs';
import { input, interpretation, model, ns, ok, options } from '../testing/episode-capture-helpers.mjs';
import { createTestWorkspace } from '../../tools/testing/workspace.mjs';

test('Episode keep coverage omits a forgotten source removed by a replacement draft', async t => {
  const workspace = createTestWorkspace(t, { prefix: 'episode-keep-shared-source-' });
  const hiddenText = 'Synthetic shared Episode evidence';
  const visibleText = 'Synthetic independent Episode evidence';
  const port = model({ interpretEpisode(request) {
    const result = interpretation(request);
    const sourceIndex = request.input.sources.findIndex(source => source.text === visibleText);
    if (sourceIndex >= 0) result.gist.anchors = [{ sourceIndex, start: 0, end: visibleText.length }];
    return result;
  } });
  const core = openMemoryCore({ path: join(workspace.path, 'store.sqlite'), ...options, model: port });
  workspace.defer(() => core.close());

  const first = ok(await core.capture(input(1, 'keep-episode', { messages: [
    { id: 'shared-message', role: 'user', content: hiddenText },
    { id: 'independent-message', role: 'user', content: visibleText },
  ] })));
  const episodeId = first.episode.id;
  const detail = () => ok(core.getEpisode({ namespace: ns, episodeId }));
  const coverage = () => detail().keepActions.items[0].sourceCoverage.sourceIds;
  const original = detail();
  const hidden = original.sources.items.find(source => source.text === hiddenText);
  const visible = original.sources.items.find(source => source.text === visibleText);
  assert.ok(hidden && visible);

  const corrected = ok(core.correctEpisode({ namespace: ns, episodeId, expectedRevision: original.episode.revision,
    patch: { gist: { text: 'Synthetic pinned gist',
      anchors: [{ sourceId: visible.id, digest: visible.digest, start: 0, end: visibleText.length }] } } }));
  ok(await core.keepEpisode({ namespace: ns, episodeId, expectedRevision: corrected.revision, actionId: 'keep-history' }));
  assert.deepEqual(coverage().toSorted(), [hidden.id, visible.id].sort());
  const donor = ok(core.admit({ namespace: ns, memory: { content: 'Synthetic donor memory', kind: 'fact' },
    receipts: [{ client: original.episode.client, sessionId: original.episode.sessionKey,
      eventId: hidden.messageId, role: hidden.role, excerpt: hidden.text }] })).memory;

  const next = input(2, 'keep-episode');
  next.episodeContext.origin = 'precompact';
  ok(await core.capture(next));
  const currentIds = detail().sources.items.map(source => source.id);
  assert.ok(!currentIds.includes(hidden.id));
  assert.ok(currentIds.includes(visible.id));
  assert.deepEqual(coverage().toSorted(), [hidden.id, visible.id].sort(), 'draft replacement preserves keep history');

  ok(core.forget({ namespace: ns, memoryId: donor.id, expectedRevision: donor.revision }));
  assert.deepEqual(coverage(), [visible.id]);
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { recorded, assertRecorded } from './fixtures/forget-episode-recording.mjs';
import { setup } from './fixtures/forget-episode.mjs';
import { layouts, label, snapshot } from './fixtures/forget-episode-assertions.mjs';
import { committedReads } from './fixtures/forget-episode-scope.mjs';

for (const options of layouts) for (const operation of ['forget', 'correct']) {
  test('session-less receipt preserves every Episode and source row ' + label(options) + ' ' + operation, { concurrency: false }, async t => {
    const f = await setup(t, { ...options, sessionless: true, neighbour: true, unknownTime: true, noCards: true });
    const before = snapshot(f);
    assert.equal(f.targetReceipt.session_id, 'explicit-tool');
    const pin = recorded('forget-episode-scope', t.name);
    assertRecorded(await f.act(operation), pin.actions[0]);
    await committedReads(f, before, { pin: pin.p1 });
  });
}

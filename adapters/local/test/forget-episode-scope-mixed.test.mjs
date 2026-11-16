import test from 'node:test';
import assert from 'node:assert/strict';
import { recorded, assertRecorded } from './fixtures/forget-episode-recording.mjs';
import { sql, forgottenText, stepText } from './fixtures/forget-episode.mjs';
import { layouts, label, noNeedles } from './fixtures/forget-episode-assertions.mjs';
import { mixedFixture, cleanRefusal, committedReads } from './fixtures/forget-episode-scope.mjs';

// The window case pins the mixed-origin fence mechanism; the second is its control.
for (const options of layouts) for (const operation of ['forget', 'correct']) {
  for (const fence of ['window', 'outside window']) {
    test('mixed-origin summary ' + fence + ' pins commit outcome ' + label(options) + ' ' + operation, { concurrency: false }, async t => {
      const { f, source, other, consumer, before } = await mixedFixture(t, options, fence);
      const pin = recorded('forget-episode-scope', t.name);
      if (options.layout >= 48 && fence !== 'outside window') {
        await cleanRefusal(f, operation, before, pin);
      } else {
        const result = await f.act(operation); assertRecorded(result, pin.actions[0]);
        await committedReads(f, before, { named: [source.id], consumers: [consumer], upstream: [other.id], pin: pin.p1,
          needles: [forgottenText, stepText, 'consumerneedle', 'consumerstep'] });
        assert.equal(sql(f.path, db => Boolean(db.prepare('SELECT 1 FROM raw_session_fences WHERE client=? AND session_key=?')
          .get(other.client, other.session_key))), fence !== 'outside window', 'the control differs only in whether the unrelated origin is fenced');
        noNeedles(result);
      }
    });
  }
}

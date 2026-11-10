import assert from 'node:assert/strict';
import test from 'node:test';
import { installedPrompt } from './fixtures/prefetch-harness.mjs';

for (const warm of [false, true]) test(`installed prompt pre-fetch fsync ceiling (${warm ? 'warm' : 'fresh'})`,
  { skip: process.platform !== 'linux' }, async t => {
    const result = await installedPrompt(t, { warm });
    t.diagnostic(JSON.stringify({ warm, ...result }));
    assert.equal(result.code, 0); assert.equal(result.signal, null);
    assert.equal(result.stderr, ''); assert.equal(result.stdout, '');
    assert.equal(result.recallHeaders, 1);
    assert.ok(result.snapshot, 'recall_fetch_instrumented');
    assert.ok(result.snapshot.syncCalls <= (warm ? 0 : 8), 'prefetch_fsync_ceiling');
  });

test('installed warm prompt reaches recall under deterministic disk latency, five attempts without retry',
  { skip: process.platform !== 'linux', timeout: 90000 }, async t => {
    for (let attempt = 1; attempt <= 5; attempt++) await t.test(`attempt ${attempt}`, async t => {
      const result = await installedPrompt(t, { syncDelay: 400, unanswered: true });
      t.diagnostic(JSON.stringify({ attempt, ...result }));
      assert.equal(result.code, 0); assert.equal(result.signal, null);
      assert.equal(result.outcome.code, 0); assert.equal(result.outcome.signal, null);
      assert.equal(result.stdout, '', 'no_late_context'); assert.equal(result.stderr, '', 'silent_exit');
      assert.equal(result.recallHeaders, 1, 'exactly_one_recall_before_cap');
      assert.ok(result.snapshot?.atMs < 3000, 'fetch_before_cap');
      assert.ok(result.outcome.elapsedMs >= 2900, 'process_cap_not_shortened');
      assert.ok(result.outcome.elapsedMs < 4000, 'host_margin');
    });
  });

for (const syncDelay of [400, 4000]) test(`installed failure publication respects the process cap with ${syncDelay} ms fsync latency`,
  { skip: process.platform !== 'linux', timeout: 20000 }, async t => {
    const result = await installedPrompt(t, { syncDelay, pauseUnavailable: true });
    t.diagnostic(JSON.stringify({ syncDelay, ...result }));
    assert.equal(result.code, 0); assert.equal(result.signal, null);
    assert.equal(result.outcome.code, 0); assert.equal(result.outcome.signal, null);
    assert.equal(result.stdout, ''); assert.equal(result.stderr, '');
    assert.equal(result.recallHeaders, 0, 'failure_never_dispatches');
    assert.equal(result.status.state, syncDelay === 400 ? 'unavailable' : 'available',
      'completed_failure_is_durable_or_cap_leaves_the_real_previous_observation');
    assert.ok(result.outcome.elapsedMs < 4000, 'failure_does_not_extend_process_cap');
    if (syncDelay === 4000) assert.ok(result.outcome.elapsedMs >= 2900, 'actual_process_cap_exercised');
  });

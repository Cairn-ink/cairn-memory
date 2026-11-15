import assert from 'node:assert/strict';

// Frozen content and window identity survive retries; the send clock does not.
export function assertFrozenRetry(actual, previous) {
  for (const attempt of [previous, actual]) {
    assert.equal(typeof attempt.sent_at, 'string');
    assert.ok(Number.isFinite(Date.parse(attempt.sent_at)), 'valid_send_time');
    assert.equal(new Date(attempt.sent_at).toISOString(), attempt.sent_at, 'iso_send_time');
  }
  assert.notEqual(actual.sent_at, previous.sent_at, 'send_time_changes_per_attempt');
  const { sent_at: currentTime, ...current } = actual;
  const { sent_at: previousTime, ...frozen } = previous;
  assert.deepEqual(current, frozen, 'retry_preserves_frozen_content_and_window');
}

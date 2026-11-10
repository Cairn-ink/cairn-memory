import test from 'node:test';
import assert from 'node:assert/strict';
import { setTimeout as delay } from 'node:timers/promises';
import { harness, row } from './capture-window-harness.mjs';

for (const action of ['capture', 'capture-detached']) {
  test(`${action} shares one hosted budget across batches and preserves the frozen retry`, async t => {
    let slow = true;
    const f = await harness(t, {
      mutateRuntime(source) {
        const constant = 'const HOSTED_CAPTURE_BUDGET_MS = 25_000;';
        assert.ok(source.includes(constant));
        return source.replace(constant, 'const HOSTED_CAPTURE_BUDGET_MS = 1000;');
      },
      holdCapture: () => slow ? delay(650) : undefined,
    });
    await f.write(''); await f.run('start-boundary');
    await f.write(Array.from({ length: 72 }, (_, i) => row(`synthetic-${i}`)).join(''));
    const result = await f.run(action, { capture_generation: 'initial' });
    // Each individual HTTP duration fits. Their sum must not reset the hook cap.
    const sent = f.captures.length;
    assert.ok(sent >= 1 && sent < 3, 'no_new_batch_after_shared_deadline');
    assert.ok(result.wallMs < 1600, 'shared_capture_budget');
    const frozen = await f.state();
    assert.ok(frozen.pendingEnd > frozen.offset, 'retry_range_retained');
    slow = false;
    await f.run(action, { capture_generation: 'initial' });
    assert.equal(f.captures.length, sent + 3);
    assert.deepEqual(f.captures.slice(sent, sent * 2).map(body => body.event_id),
      f.captures.slice(0, sent).map(body => body.event_id));
    assert.equal((await f.state()).pendingEnd, undefined);
    t.diagnostic(JSON.stringify({ action, firstRunMs: result.wallMs, sendsBeforeExpiry: sent, retrySends: 3 }));
  });
}

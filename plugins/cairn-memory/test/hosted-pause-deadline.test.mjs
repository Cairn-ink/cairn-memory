import test from 'node:test';
import assert from 'node:assert/strict';
import { setTimeout as delay } from 'node:timers/promises';
import { join } from 'node:path';
import { harness, row } from './capture-window-harness.mjs';
import { stateLock } from '../lib/state-lock.mjs';
import { deferred } from '../../../tools/testing/deferred.mjs';

// Accept the previous spelling too so the exact same regression runs against
// the immutable runtime that shared its allowance across the entire window.
function requestBudget(source) {
  const constant = /const HOSTED_CAPTURE_(?:REQUEST|BUDGET)_MS = 25_000;/;
  assert.match(source, constant);
  return source.replace(constant, match => match.replace('25_000', '1000'));
}

for (const action of ['capture', 'capture-detached']) {
  test(`${action} gives each of three delayed batches its own request deadline`, async t => {
    const f = await harness(t, { mutateRuntime: requestBudget, holdCapture: () => delay(650) });
    await f.write(''); await f.run('start-boundary');
    const transcript = Array.from({ length: 72 }, (_, i) => row(`synthetic-${i}`)).join('');
    await f.write(transcript);
    const result = await f.run(action, { capture_generation: 'initial' });
    assert.equal(f.captures.length, 3, 'all_batches_in_one_invocation');
    assert.deepEqual(f.captures.map(body => body.window.slice), [1, 2, 3]);
    const cursor = await f.state();
    assert.equal(cursor.offset, Buffer.byteLength(transcript), 'whole_window_advanced');
    assert.equal(cursor.pendingEnd, undefined);
    t.diagnostic(JSON.stringify({ action, wallMs: result.wallMs, batches: f.captures.length }));
  });

  test(`${action} expires one slow batch and retries the same frozen event identity`, async t => {
    let slow = true;
    const f = await harness(t, { mutateRuntime: requestBudget, holdCapture: () => slow ? delay(1300) : undefined });
    await f.write(''); await f.run('start-boundary');
    const transcript = row('synthetic-slow'); await f.write(transcript);
    await f.run(action, { capture_generation: 'initial' });
    assert.equal(f.captures.length, 1);
    const frozen = await f.state();
    assert.equal(frozen.offset, 0); assert.equal(frozen.pendingEnd, Buffer.byteLength(transcript));
    slow = false;
    await f.run(action, { capture_generation: 'initial' });
    assert.equal(f.captures.length, 2);
    assert.equal(f.captures[1].event_id, f.captures[0].event_id);
    assert.deepEqual(f.captures[1].window, f.captures[0].window);
    assert.equal((await f.state()).offset, frozen.pendingEnd);
    assert.equal((await f.state()).pendingEnd, undefined);
  });

  test(`${action} leaves a gate-blocked batch unsent after its own deadline`, async t => {
    let observations = 0, holder;
    const held = deferred(), release = deferred();
    const f = await harness(t, { mutateRuntime: requestBudget,
      async holdPause() {
        if (++observations !== 2) return;
        holder = stateLock(join(f.dataDir, 'hosted-pause.gate'), async () => {
          held.resolve(); await release.promise;
        }, { hostParent: true });
        await Promise.race([held.promise, holder.then(() => { throw new Error('holder_not_entered'); })]);
      },
    });
    t.after(async () => { release.resolve(); await holder; });
    await f.write(''); await f.run('start-boundary');
    const transcript = row('synthetic-blocked'); await f.write(transcript);
    const running = f.run(action, { capture_generation: 'initial' });
    await held.promise;
    await running;
    assert.equal(f.captures.length, 0, 'expired_batch_never_sent');
    const frozen = await f.state();
    assert.equal(frozen.offset, 0); assert.equal(frozen.pendingEnd, Buffer.byteLength(transcript));
    release.resolve(); await holder;
    await f.run(action, { capture_generation: 'initial' });
    assert.equal(f.captures.length, 1);
    assert.equal((await f.state()).pendingEnd, undefined);
  });

  test(`${action} sends nothing under a hosted pause`, async t => {
    const f = await harness(t, { mutateRuntime: requestBudget,
      pauseState: () => ({ paused: true, generation: 1, enforced: true }) });
    await f.write(row('synthetic-paused'));
    await f.run(action, { capture_generation: 'initial' });
    assert.equal(f.captures.length, 0);
  });
}

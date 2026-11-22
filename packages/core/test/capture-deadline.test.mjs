import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createCaptureDeadline } from '../src/capture/deadline.mjs';
import { CoreError } from '../src/errors.mjs';

for (const [now, expired, remaining] of [
  [1000, false, 10],
  [1001.25, false, 9],
  [1008.75, false, 2],
  [1009.999, false, 1],
  [1010, true],
  [1010.001, true],
]) {
  test('10 ms deadline starting at 1000, observed at ' + now, () => {
    let time = 1000;
    const deadline = createCaptureDeadline(10, { monotonicMs: () => time });
    assert.ok(Object.isFrozen(deadline));
    time = now;
    assert.equal(deadline.expired(), expired);
    if (expired) {
      assert.throws(deadline.check, { name: 'CoreError', code: 'model_timeout' });
      assert.throws(deadline.remainingMs, { name: 'CoreError', code: 'model_timeout' });
    } else {
      assert.equal(deadline.check(), undefined);
      assert.equal(deadline.remainingMs(), remaining);
    }
  });
}

test('duration endpoints and default and caller-supplied remaining ceilings', () => {
  const clock = { time: 55, monotonicMs() { return this.time; } };
  const shortest = createCaptureDeadline(1, clock);
  const longest = createCaptureDeadline(120_000, clock);
  assert.equal(shortest.remainingMs(), 1);
  assert.equal(longest.remainingMs(), 30_000);
  assert.equal(longest.remainingMs(50_000), 50_000);
  assert.equal(longest.remainingMs(150_000), 120_000);
  clock.time += 119_999.5;
  assert.equal(longest.remainingMs(), 1);
  assert.equal(longest.remainingMs(0), 0);
});

test('duration outside the contract fails before consulting the clock', () => {
  const clock = { monotonicMs() { assert.fail('clock should not be read'); } };
  for (const duration of [undefined, null, '1', true, NaN, Infinity, -Infinity, -1, 0, 0.5, 1.5, 120_001, 2 ** 53, 1n]) {
    assert.throws(() => createCaptureDeadline(duration, clock),
      (error) => error instanceof CoreError && error.code === 'invalid_input', String(duration));
  }
});

test('deadline uses only monotonic time', () => {
  let time = 1000;
  const clock = {
    nowMs() { assert.fail('wall clock should not be read'); },
    monotonicMs: () => time,
  };
  const deadline = createCaptureDeadline(10, clock);

  time += 5;
  assert.equal(deadline.expired(), false);
  assert.equal(deadline.check(), undefined);
  assert.equal(deadline.remainingMs(), 5);

  time += 5;
  assert.equal(deadline.expired(), true);
  assert.throws(deadline.check, { name: 'CoreError', code: 'model_timeout' });
  assert.throws(deadline.remainingMs, { name: 'CoreError', code: 'model_timeout' });
});

test('deadline expires after a backward wall-clock step', () => {
  let wallTime = 1000;
  let monotonicTime = 1000;
  const deadline = createCaptureDeadline(10, {
    nowMs: () => wallTime,
    monotonicMs: () => monotonicTime,
  });

  wallTime -= 100;
  monotonicTime += 25;
  assert.equal(deadline.expired(), true);
  assert.throws(deadline.check, { name: 'CoreError', code: 'model_timeout' });
});

test('deadline keeps its remaining budget after a forward wall-clock step', () => {
  let wallTime = 1000;
  let monotonicTime = 1000;
  const deadline = createCaptureDeadline(10, {
    nowMs: () => wallTime,
    monotonicMs: () => monotonicTime,
  });

  wallTime += 10_000;
  monotonicTime += 1;
  assert.equal(deadline.expired(), false);
  assert.equal(deadline.check(), undefined);
  assert.equal(deadline.remainingMs(), 9);
});

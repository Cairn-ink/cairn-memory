import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { createTestWorkspace } from '../../../tools/testing/workspace.mjs';
import { deferred } from '../../../tools/testing/deferred.mjs';
import { stateLock } from '../state-lock.mjs';
import { observeHostedPause, withHostedPauseGate } from '../hosted-pause.mjs';
import { startIfActive } from '../control-state.mjs';
import { invocation, assertProcessOutcome } from '../../../plugins/cairn-memory/test/fixtures/recall-deadline-harness.mjs';

async function fixture(t) {
  const root = join(createTestWorkspace(t).path, 'state');
  await mkdir(root, { mode: 0o700 });
  const config = { root, endpoint: 'http://127.0.0.1:1' };
  t.mock.method(globalThis, 'fetch', async () => Response.json({ generation: 0, paused: false, enforced: true }));
  await observeHostedPause(config, 'synthetic-token');
  return config;
}

for (const stage of ['unchanged-publication', 'request-admission']) {
  test(`12 concurrent ${stage} callers survive a 450 ms root-gate queue within their own budget`, async t => {
    const config = await fixture(t), held = deferred(), release = deferred();
    let starts = 0;
    const holder = stateLock(join(config.root, 'hosted-pause.gate'), async () => {
      held.resolve(); await release.promise;
    });
    t.after(async () => { release.resolve(); await holder; });
    await held.promise;
    const at = performance.now(), deadlineMs = at + 2000;
    const resultsPromise = Promise.allSettled(Array.from({ length: 12 }, () => stage === 'unchanged-publication'
      ? observeHostedPause(config, 'synthetic-token', AbortSignal.timeout(2000), { deadlineMs })
      : withHostedPauseGate(config, 0, guard => startIfActive(config.root, 'initial', () => { starts++; }, { guard }),
        { deadlineMs, signal: AbortSignal.timeout(2000) })));
    await delay(450); release.resolve(); await holder;
    const results = await resultsPromise;
    const successes = results.filter(result => result.status === 'fulfilled').length;
    t.diagnostic(JSON.stringify({ stage, elapsed: performance.now() - at, successes, starts,
      errors: results.filter(result => result.status === 'rejected').map(result => result.reason.message) }));
    assert.equal(successes, 12);
    if (stage === 'request-admission') assert.equal(starts, 12);
  });
}

test('holder checks may consume 350 ms when the caller still has admission budget', async t => {
  const config = await fixture(t), at = performance.now();
  let starts = 0;
  const result = await withHostedPauseGate(config, 0, async guard => {
    await delay(350);
    return startIfActive(config.root, 'initial', () => { starts++; }, { guard });
  }, { deadlineMs: at + 2000 }).then(value => ({ value }), error => ({ error: error.message }));
  t.diagnostic(JSON.stringify({ stage: 'holder-window', elapsed: performance.now() - at, starts, ...result }));
  assert.equal(starts, 1);
});

test('exhausted caller deadline still forbids a start', async t => {
  const config = await fixture(t), at = performance.now();
  let starts = 0;
  await assert.rejects(withHostedPauseGate(config, 0, async guard => {
    await delay(180);
    return startIfActive(config.root, 'initial', () => { starts++; }, { guard });
  }, { deadlineMs: at + 100 }), /pause_unavailable/);
  assert.equal(starts, 0);
  t.diagnostic(JSON.stringify({ stage: 'expired-holder', elapsed: performance.now() - at, starts }));
});

test('an already expired acquisition starts no work even on an idle gate', async t => {
  const config = await fixture(t);
  let starts = 0;
  await assert.rejects(withHostedPauseGate(config, 0, guard =>
    startIfActive(config.root, 'initial', () => { starts++; }, { guard }),
  { deadlineMs: performance.now() - 1 }), /state_busy|pause_unavailable/);
  assert.equal(starts, 0);
});

test('cancellation interrupts a queued admission and starts no work', async t => {
  const config = await fixture(t), held = deferred(), release = deferred();
  let starts = 0;
  const holder = stateLock(join(config.root, 'hosted-pause.gate'), async () => {
    held.resolve(); await release.promise;
  });
  t.after(async () => { release.resolve(); await holder; });
  await held.promise;
  const controller = new AbortController();
  const result = assert.rejects(withHostedPauseGate(config, 0, guard =>
    startIfActive(config.root, 'initial', () => { starts++; }, { guard }),
  { deadlineMs: performance.now() + 2000, signal: controller.signal }), /synthetic_cancel/);
  await delay(50); controller.abort(new Error('synthetic_cancel')); await result;
  assert.equal(starts, 0);
});

test('recall emits nonempty context before its admission cap after a queued root gate', async t => {
  const result = await invocation(t, { rootGateMs: 450 });
  assertProcessOutcome(result);
  assert.equal(result.events.filter(event => event.kind === 'root-gate-contended').length, 1);
  assert.equal(result.events.filter(event => event.kind === 'recall-fetch').length, 1);
  assert.match(JSON.parse(result.stdout).hookSpecificOutput.additionalContext, /Synthetic remembered preference/);
  const origin = result.events.find(event => event.kind === 'process-origin').ms;
  const outputMs = result.events.find(event => event.kind === 'stdout').ms - origin;
  assert.ok(outputMs < 3450, 'output_admitted_before_cap');
  assert.ok(result.elapsedMs - origin < 3500, 'recall_finishes_before_abort');
  t.diagnostic(JSON.stringify({ outputMs, processExitMs: result.elapsedMs - origin }));
});

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { callBuiltModel } from '../src/capture/model-call.mjs';
import { CoreError } from '../src/errors.mjs';

const owner = 'owner';
const built = {
  stage: 'classify',
  request: { system: 'Classify the note.', input: 'Cedar tea.', maxOutputTokens: 1024 },
  sizingText: 'Classify the note. Cedar tea.',
  decode: raw => raw.topic,
};

function fixture() {
  const trace = [];
  const diagnostics = [];
  let paused = false;
  const options = {
    owner,
    failureCode: 'classification_failed',
    validateFresh: () => trace.push('validateFresh'),
    beforeDispatch: () => trace.push('beforeDispatch'),
    gate: { async assertOpen(givenOwner, phase) {
      assert.equal(givenOwner, owner);
      trace.push(phase);
      if (paused) throw new CoreError('capture_paused');
    } },
    onDiagnostic: event => diagnostics.push(event),
  };
  const model = { contextWindow: 8192, countTokens: () => 1, async call() {
    trace.push('provider');
    return { topic: 'tea' };
  } };
  return {
    trace, diagnostics,
    pause: () => { paused = true; },
    run: overrides => callBuiltModel(model, 'classify', built, { ...options, ...overrides }),
  };
}

const beforeRefresh = ['pre-send', 'validateFresh', 'validateFresh', 'beforeDispatch'];

for (const pause of [false, true]) {
  test(pause ? 'a pause committed during refresh stops dispatch' : 'refresh completes before the dispatch gate',
    async () => {
      const f = fixture();
      const result = f.run({ async refresh() {
        f.trace.push('refresh');
        await Promise.resolve();
        if (pause) f.pause();
        f.trace.push('refreshed');
      } });
      if (pause) await assert.rejects(result, { code: 'capture_paused' });
      else assert.equal(await result, 'tea');
      assert.deepEqual(f.trace, [...beforeRefresh, 'refresh', 'refreshed', 'dispatch',
        ...(pause ? [] : ['provider', 'post-send', 'validateFresh', 'validateFresh'])]);
    });
}

test('refresh preserves CoreError identity and maps unexpected errors to internal_error', async () => {
  const conflict = new CoreError('revision_conflict');
  const f = fixture();
  await assert.rejects(f.run({ async refresh() { throw conflict; } }), error => error === conflict);
  await assert.rejects(f.run({ refresh() { throw new Error('read failed'); } }), { code: 'internal_error' });
  assert.deepEqual(f.trace, [...beforeRefresh, ...beforeRefresh]);
});

for (const code of ['model_cancelled', 'model_timeout']) {
  test(`a pending refresh ends with ${code} without crossing the dispatch gate`, async t => {
    const f = fixture();
    const caller = new AbortController();
    const started = Promise.withResolvers();
    const pending = Promise.withResolvers();
    // Keep the loop alive for the unref'd AbortSignal timeout and bound a stalled call.
    const watchdog = setTimeout(() => pending.reject(new Error('refresh did not abort')), 2000);
    t.after(() => clearTimeout(watchdog));
    const result = f.run({
      deadline: { expired: () => false, remainingMs: () => 100 },
      signal: caller.signal,
      refresh() {
        f.trace.push('refresh');
        started.resolve();
        return pending.promise;
      },
    });
    const rejection = assert.rejects(result, { code });
    await Promise.race([started.promise, rejection]);
    if (code === 'model_cancelled') caller.abort();
    await rejection;
    pending.resolve();
    await new Promise(resolve => setImmediate(resolve));
    assert.deepEqual(f.trace, [...beforeRefresh, 'refresh']);
    assert.deepEqual(f.diagnostics, [{ version: 1, stage: 'classify', layer: 'core_call', reason: code }]);
  });
}

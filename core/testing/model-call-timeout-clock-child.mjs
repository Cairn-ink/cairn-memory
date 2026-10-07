// Isolated clock installed before importing the real core; never patch a shared process.
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import test from 'node:test';
import { setImmediate } from 'node:timers/promises';
import { createTestWorkspace } from '../../tools/testing/workspace.mjs';

const afterAdmission = process.argv[2] === 'after';
assert.ok(['before', 'after'].includes(process.argv[2]));
const realNow = process.hrtime.bigint;
let now = 0n;
process.hrtime.bigint = () => now;
const advance = ms => { now += BigInt(ms) * 1_000_000n; };
const [{ openMemoryCore }, { rationaleModel }, { isCoreModelDeadlineSignal }] = await Promise.all([
  import('../contract.mjs'), import('./rationale-model.mjs'), import('../model-call.mjs'),
]);
const namespace = { ownerId: 'n22-clock', scope: 'personal', projectId: null };
const input = { namespace, client: 'synthetic', eventId: 'clock', sessionId: 'clock',
  messages: [{ id: 'source', role: 'user', content: 'Synthetic train source.' }] };

test('configured cap and cumulative capture expiry', async t => {
  t.after(() => { process.hrtime.bigint = realNow; });
  const workspace = createTestWorkspace(t, { prefix: 'cairn-n22-clock-' });
  let signal;
  const capCore = openMemoryCore({ path: join(workspace.path, 'cap.sqlite'), modelCallTimeoutMs: 60_000,
    model: { contextWindow: 8192, countTokens: () => 1,
      extract(request) { signal = request.signal; return new Promise(() => {}); } } });
  workspace.defer(() => capCore.close());
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const pending = capCore.capture(input);
  await setImmediate(); t.mock.timers.tick(30_001); assert.equal(signal.aborted, false);
  t.mock.timers.tick(29_999); assert.equal((await pending).error.code, 'model_timeout');
  assert.equal(isCoreModelDeadlineSignal(signal), true);
  t.mock.timers.reset();

  const model = rationaleModel();
  const calls = [], signals = [];
  for (const method of ['extract', 'qualifyCandidates', 'classify', 'relate']) {
    const original = model[method];
    model[method] = request => {
      calls.push(method); signals.push(request.signal);
      advance(method === 'classify' ? 30_000 : 20_000);
      return original(request);
    };
  }
  const path = join(workspace.path, 'aggregate.sqlite');
  const core = openMemoryCore({ path, model, modelCallTimeoutMs: 60_000,
    captureDeadlineMs: afterAdmission ? 60_000 : 35_000,
    captureQualification: 'source-bound-v2',
    ...(afterAdmission ? { captureRationale: 'source-bound-v1' } : {}) });
  workspace.defer(() => core.close());
  const db = new DatabaseSync(path); workspace.defer(() => db.close());
  const result = await core.capture(input);
  assert.deepEqual(calls, afterAdmission ? ['extract', 'qualifyCandidates', 'classify'] : ['extract', 'qualifyCandidates']);
  assert.equal(isCoreModelDeadlineSignal(signals.at(-1)), true);
  if (afterAdmission) {
    assert.equal(result.ok, true);
    assert.equal(result.value.admission.memories.length, 1);
    assert.equal(result.value.classification.error.code, 'model_timeout');
    assert.equal(result.value.rationale.error.code, 'model_timeout');
  } else assert.deepEqual(result, { ok: false, error: { code: 'model_timeout', retryable: false } });
  assert.equal(db.prepare('SELECT count(*) n FROM memories').get().n, afterAdmission ? 1 : 0);
  assert.equal(Number(now / 1_000_000n), afterAdmission ? 70_000 : 40_000);
});

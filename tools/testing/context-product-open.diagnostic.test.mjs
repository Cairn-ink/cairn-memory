import test from 'node:test';
import assert from 'node:assert/strict';
import { OPEN_DIAGNOSTIC_FIELDS } from '../../core/context-product-open-diagnostic.mjs';
import { finalizeAll, summarize, validateProductSample } from './context-product-open.diagnostic.mjs';

test('C1 diagnostic attempts every finalizer and reports work and cleanup failures together', async () => {
  const attempts = [], work = Error('work failed'), reader = Error('reader close failed'), supervisor = Error('supervisor close failed');
  const finalizers = [
    () => { attempts.push('workspace'); },
    () => { attempts.push('supervisor'); throw supervisor; },
    async () => { attempts.push('reader'); throw reader; },
  ];
  await assert.rejects(finalizeAll(finalizers, work), error => {
    assert.ok(error instanceof AggregateError);
    assert.deepEqual(error.errors, [work, reader, supervisor]);
    return true;
  });
  assert.deepEqual(attempts, ['reader', 'supervisor', 'workspace']);
  await finalizeAll([() => attempts.push('successful cleanup')]);
});

test('C5 partial or nonfinite product phases fail before quantiles', () => {
  const full = Object.fromEntries([...OPEN_DIAGNOSTIC_FIELDS,
    'observedOpenMs', 'observedFetchMs', 'observedCloseMs', 'observedLifecycleMs'].map(key => [key, 1]));
  assert.equal(validateProductSample(full), full);
  for (const key of OPEN_DIAGNOSTIC_FIELDS) {
    const missing = { ...full }; delete missing[key];
    assert.throws(() => validateProductSample(missing), { message: 'incomplete_diagnostic_sample:' + key });
    for (const invalid of [NaN, Infinity, -1, undefined]) {
      assert.throws(() => validateProductSample({ ...full, [key]: invalid }), { message: 'incomplete_diagnostic_sample:' + key });
    }
  }
  assert.throws(() => summarize([{ phase: 1 }, {}]), /incomplete_diagnostic_sample:phase/);
  assert.throws(() => summarize([{ phase: 1 }, { phase: NaN }]), /incomplete_diagnostic_sample:phase/);
  assert.deepEqual(summarize([{ phase: 1 }, { phase: 3 }]), { phase: { n: 2, p50: 1, p95: 3, max: 3 } });
});

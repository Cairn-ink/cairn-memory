import assert from 'node:assert/strict';
import test from 'node:test';

import { prepareMixedComparison, runMixedGeneration } from '../mixed-generation.mjs';
import { sourceRow } from '../testing/mixed-fixture.mjs';

const preparedFor = count => prepareMixedComparison({
  sourceCases: Array.from({ length: count }, (_, index) => sourceRow(`witness-${index}`)),
  armOrders: Array.from({ length: count }, () => ['cairn', 'mem0']),
  nativeArtifact: { sourceTreeSha256: '1'.repeat(64), dependencyLockSha256: '2'.repeat(64) },
  nativeConfiguration: { configurationSha256: '3'.repeat(64), configuration: {} },
  cairnRuntimeArtifactSha256: '4'.repeat(64) });

test('W301 witness option rejects unknown/accessor values and large rosters before consumption', async () => {
  for (const count of [1, 6, 30, 31, 250]) {
    const prepared = preparedFor(count);
    let accesses = 0, getterCalls = 0;
    const options = { prepared, guard: { get mixedSourcePairCapability() { accesses++; return null; } },
      apiKey: 'synthetic-only', cairnStoreRoot: '/unused' };
    for (const recallWitness of [undefined, null, false, true, 'first', {}, () => {}]) {
      await assert.rejects(runMixedGeneration({ ...options, recallWitness }),
        { code: 'invalid_mixed_generation' });
    }
    const accessor = { ...options };
    Object.defineProperty(accessor, 'recallWitness', { enumerable: true,
      get() { getterCalls++; return 'bounded-v1'; } });
    await assert.rejects(runMixedGeneration(accessor), { code: 'invalid_mixed_generation' });
    const hidden = { ...options };
    Object.defineProperty(hidden, 'recallWitness', { value: 'bounded-v1' });
    await assert.rejects(runMixedGeneration(hidden), { code: 'invalid_mixed_generation' });
    await assert.rejects(runMixedGeneration({ ...options, recallWitness: 'bounded-v1',
      onRecallWitness: () => assert.fail('no external observer') }), { code: 'invalid_mixed_generation' });
    if (count > 30) await assert.rejects(runMixedGeneration({ ...options,
      recallWitness: 'bounded-v1' }), { code: 'invalid_mixed_generation' });
    assert.equal(accesses, 0);
    assert.equal(getterCalls, 0);
    // The guard is reached only if the previous denied calls preserved identity.
    await assert.rejects(runMixedGeneration({ ...options,
      ...(count <= 30 ? { recallWitness: 'bounded-v1', phaseTiming: 'bounded-tail-v1' } : {}) }),
    { code: 'mixed_guard_mismatch' });
    assert.equal(accesses, 1);
  }
});

test('W301 omitted witness ignores inherited getters and values', async () => {
  const prior = Object.getOwnPropertyDescriptor(Object.prototype, 'recallWitness');
  let reads = 0;
  try {
    for (const descriptor of [{ configurable: true,
      get() { reads++; throw Error('PRIVATE_INHERITED_WITNESS'); } },
    { configurable: true, value: 'bounded-v1' }]) {
      const prepared = preparedFor(31);
      Object.defineProperty(Object.prototype, 'recallWitness', descriptor);
      await assert.rejects(runMixedGeneration({ prepared, guard: {}, apiKey: 'synthetic-only',
        cairnStoreRoot: '/unused' }), { code: 'mixed_guard_mismatch' });
      assert.equal(reads, 0);
      delete Object.prototype.recallWitness;
    }
  } finally {
    if (prior) Object.defineProperty(Object.prototype, 'recallWitness', prior);
    else delete Object.prototype.recallWitness;
  }
});

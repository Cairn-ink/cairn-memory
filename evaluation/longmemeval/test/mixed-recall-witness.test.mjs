import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { createTestWorkspace } from '../../../tools/testing/workspace.mjs';

import { prepareMixedComparison, runMixedGeneration } from '../mixed-generation.mjs';
import { sourceRow } from '../testing/mixed-fixture.mjs';

const preparedFor = count => prepareMixedComparison({
  sourceCases: Array.from({ length: count }, (_, index) => sourceRow(`witness-${index}`)),
  armOrders: Array.from({ length: count }, () => ['cairn', 'mem0']),
  nativeArtifact: { sourceTreeSha256: '1'.repeat(64), dependencyLockSha256: '2'.repeat(64) },
  nativeConfiguration: { configurationSha256: '3'.repeat(64), configuration: {} },
  cairnRuntimeArtifactSha256: '4'.repeat(64) });

test('N27A bounded-lineage-v2 admits only small rosters before prepared consumption', async () => {
  for (const count of [1, 30, 31]) {
    const prepared = preparedFor(count);
    const options = { prepared, guard: {}, apiKey: 'synthetic-only', cairnStoreRoot: '/unused',
      recallWitness: 'bounded-lineage-v2' };
    await assert.rejects(runMixedGeneration(options), {
      code: count <= 30 ? 'mixed_guard_mismatch' : 'invalid_mixed_generation',
    });
    if (count > 30) {
      await assert.rejects(runMixedGeneration({ ...options,
        recallWitness: 'bounded-v1' }), { code: 'invalid_mixed_generation' });
      const { recallWitness: _omitted, ...defaultOptions } = options;
      await assert.rejects(runMixedGeneration(defaultOptions), { code: 'mixed_guard_mismatch' });
    }
  }
});

test('N27A explicit v2 rejects hidden/accessor options without invoking getters or consuming identity', async () => {
  const prepared = preparedFor(1);
  let reads = 0;
  const base = { prepared, guard: {}, apiKey: 'synthetic-only', cairnStoreRoot: '/unused' };
  for (const descriptor of [
    { enumerable: true, get() { reads++; return 'bounded-lineage-v2'; } },
    { value: 'bounded-lineage-v2' },
  ]) {
    const options = { ...base };
    Object.defineProperty(options, 'recallWitness', descriptor);
    await assert.rejects(runMixedGeneration(options), { code: 'invalid_mixed_generation' });
  }
  assert.equal(reads, 0);
  await assert.rejects(runMixedGeneration({ ...base, recallWitness: 'bounded-lineage-v2' }),
    { code: 'mixed_guard_mismatch' });
});

test('N27C actual mixed core/fake-HTTP export, unavailable fault and v1/default retain result and cleanup', t => {
  const workspace = createTestWorkspace(t, { prefix: 'cairn-mixed-lineage-subprocess-' });
  const outputs = [];
  for (const mode of ['default', 'v1', 'v2', 'export-fault', 'assertion-failure']) {
    const child = spawnSync(process.execPath, [fileURLToPath(new URL(
      '../testing/recall-lineage-child.mjs', import.meta.url)), mode, workspace.path], {
      env: { PATH: process.env.PATH, TMPDIR: workspace.path, NODE_DISABLE_COMPILE_CACHE: '1' },
      encoding: 'utf8', timeout: 30_000, maxBuffer: 1024 * 1024,
    });
    assert.equal(child.error, undefined);
    assert.equal(child.signal, null);
    assert.equal(child.status, mode === 'assertion-failure' ? 1 : 0,
      `${mode}: ${child.stdout} ${child.stderr}`);
    const output = JSON.parse(child.stdout.trim());
    assert.equal(output.remainingOwnedEntries, 0, 'child cleans owned success and failure scratch');
    assert.deepEqual(readdirSync(workspace.path), []);
    assert.equal(child.stdout.includes('PRIVATE_N27_RNG_ERROR_CANARY'), false);
    if (mode !== 'assertion-failure') {
      assert.equal(output.completedCairn, 2);
      assert.equal(output.answerMatched, true);
      assert.equal(output.nativeSkipped, 2);
      outputs.push(output);
    } else assert.equal(output.intentionalFailure, true);
  }
  for (const output of outputs) assert.deepEqual(output.routes, outputs[0].routes,
    'observation/export failure cannot add or change provider/count stage order');
  assert.deepEqual(outputs[0].witnessDisposed, [null, null]);
  assert.ok(outputs.slice(1).every(output => output.witnessDisposed.every(value => value === true)));
  assert.ok(outputs[2].joinedRefs > 0 && outputs[2].joinedReceipts > 0);
  assert.notEqual(outputs[2].lineage[0].salt, outputs[2].lineage[1].salt);
  assert.deepEqual(outputs[3].lineage, Array.from({ length: 2 }, () => ({
    version: 2, status: 'unavailable', reason: 'export_failed',
  })));
});

test('N27C actual mixed pre-recall ingestion failure exports unknown not-run lineage and disposes', t => {
  const workspace = createTestWorkspace(t, { prefix: 'cairn-lineage-ingestion-failure-' });
  const child = spawnSync(process.execPath, [fileURLToPath(new URL(
    '../testing/recall-lineage-child.mjs', import.meta.url)), 'ingestion-failure', workspace.path], {
    env: { PATH: process.env.PATH, TMPDIR: workspace.path, NODE_DISABLE_COMPILE_CACHE: '1' },
    encoding: 'utf8', timeout: 30_000, maxBuffer: 1024 * 1024,
  });
  assert.equal(child.error, undefined);
  assert.equal(child.signal, null);
  assert.equal(child.status, 0, `${child.stdout} ${child.stderr}`);
  const output = JSON.parse(child.stdout.trim());
  assert.equal(output.completedCairn, 0);
  assert.equal(output.failedCairn, 2);
  assert.deepEqual(output.witnessDisposed, [true, true]);
  assert.equal(output.remainingOwnedEntries, 0);
  assert.deepEqual(readdirSync(workspace.path), []);
  for (const lineage of output.lineage) {
    assert.equal(lineage.status, 'available');
    assert.equal(lineage.summary.observation, 'unknown');
    assert.equal(lineage.final.observation, 'not-run');
    assert.equal(lineage.events.length, 0);
  }
  assert.equal(child.stdout.includes('PRIVATE_N27_INVALID_SOURCE_CANARY'), false);
});

for (const mode of ['later-open-failure', 'deferred-close-failure']) {
  test(`N27C owned child closes every actual store (${mode})`, t => {
    const workspace = createTestWorkspace(t, { prefix: 'cairn-lineage-resource-failure-' });
    const child = spawnSync(process.execPath, [fileURLToPath(new URL(
      '../testing/recall-lineage-child.mjs', import.meta.url)), mode, workspace.path], {
      env: { PATH: process.env.PATH, TMPDIR: workspace.path, NODE_DISABLE_COMPILE_CACHE: '1' },
      encoding: 'utf8', timeout: 30_000, maxBuffer: 1024 * 1024,
    });
    assert.equal(child.error, undefined);
    assert.equal(child.signal, null);
    assert.equal(child.status, 1, `${mode}: ${child.stdout} ${child.stderr}`);
    const output = JSON.parse(child.stdout.trim());
    assert.equal(output.remainingOwnedEntries, 0);
    assert.deepEqual(readdirSync(workspace.path), []);
    assert.equal(output.openedStores, mode === 'later-open-failure' ? 1 : 3);
    assert.equal(output.closeAttempts, output.openedStores, mode);
    assert.equal(output.closedStores, output.openedStores, mode);
    assert.equal(output.intentionalCloseFailures, mode === 'later-open-failure' ? 0 : 1);
    assert.equal(output.cleanupFailed, mode === 'deferred-close-failure');
    assert.equal(output.expectedResourceFailure, true);
    if (mode === 'later-open-failure') {
      assert.equal(output.checkpoint, 'open');
      assert.equal(output.constructorRejected, true);
    } else {
      assert.equal(output.completedCairn, 2);
      assert.equal(output.answerMatched, true);
      assert.equal(output.nativeSkipped, 2);
    }
    assert.equal(child.stdout.includes('PRIVATE_N27_CLOSE_ERROR_CANARY'), false);
    assert.equal(child.stderr.includes('PRIVATE_N27_CLOSE_ERROR_CANARY'), false);
  });
}

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

import assert from 'node:assert/strict';
import test from 'node:test';

import { experimentPolicy } from '../../live/session.mjs';
import { benchmarkStagePolicy } from '../../live/public-pilot.mjs';
import { mem0WireProfile } from '../../experiment-budget/mem0-wire.mjs';
import { MixedResourceError, NATIVE_PROFILE, projectMixedResources } from '../mixed-resource.mjs';

const options = (batchCounts = [1], remainingMicroUsd = 1_000_000,
  protectedMicroUsd = 0) => ({ batchCounts, policy: experimentPolicy(),
  stages: benchmarkStagePolicy(), wireProfile: mem0WireProfile(),
  remainingMicroUsd, protectedMicroUsd, nativeProfile: NATIVE_PROFILE });
const project = (batchCounts, remaining, protectedAmount) => projectMixedResources(
  options(batchCounts, remaining, protectedAmount));
const denied = (value, code) => assert.throws(() => projectMixedResources(value),
  error => error instanceof MixedResourceError && error.code === code);

test('zero-batch case retains answer, judge, recall and native search work', () => {
  const result = project([0]);
  assert.equal(result.plannedCaseCount, 1);
  assert.equal(result.plannedBatchCount, 0);
  assert.deepEqual(result.conditionalCeilings.arms.cairn.stages.extractionCount,
    { requests: 0, reservedMicroUsd: 0 });
  assert.deepEqual(result.conditionalCeilings.arms.mem0.stages.searchEmbedding,
    { requests: 1, reservedMicroUsd: 164 });
  assert.deepEqual(result.conditionalCeilings.generation,
    { requests: 9, reservedMicroUsd: 131_804 });
  assert.deepEqual(result.conditionalCeilings.scoring,
    { requests: 2, reservedMicroUsd: 20_800 });
  assert.deepEqual(result.conditionalCeilings.joint,
    { requests: 11, reservedMicroUsd: 152_604 });
  assert.equal(result.actualMinimumMicroUsd, 0);
  assert.equal(result.empiricalEstimate, null);
});

test('one batch counts full native fallback and six Cairn ingest calls', () => {
  const result = project([1]);
  const { cairn, mem0 } = result.conditionalCeilings.arms;
  assert.deepEqual(cairn.stages.qualificationCount, { requests: 1, reservedMicroUsd: 5000 });
  assert.deepEqual(cairn.stages.classificationGeneration, { requests: 1, reservedMicroUsd: 5000 });
  assert.deepEqual(mem0.stages.addQueryEmbedding, { requests: 1, reservedMicroUsd: 164 });
  assert.deepEqual(mem0.stages.addChat, { requests: 1, reservedMicroUsd: 16_308 });
  assert.deepEqual(mem0.stages.factBatchEmbedding, { requests: 3, reservedMicroUsd: 18_000 });
  assert.deepEqual(mem0.stages.fallbackSingletonEmbedding,
    { requests: 256, reservedMicroUsd: 41_984 });
  assert.deepEqual(result.conditionalCeilings.generation,
    { requests: 276, reservedMicroUsd: 238_260 });
  assert.deepEqual(result.conditionalCeilings.scoring,
    { requests: 2, reservedMicroUsd: 20_800 });
  assert.deepEqual(result.conditionalCeilings.joint,
    { requests: 278, reservedMicroUsd: 259_060 });
});

test('mixed counts preserve every case and sum all arm stages', () => {
  const result = project([0, 2, 1]);
  assert.equal(result.plannedCaseCount, 3);
  assert.equal(result.plannedBatchCount, 3);
  const { arms, generation, scoring, joint } = result.conditionalCeilings;
  for (const arm of Object.values(arms)) {
    for (const field of ['requests', 'reservedMicroUsd']) {
      assert.equal(arm.total[field], Object.values(arm.stages)
        .reduce((total, item) => total + item[field], 0));
    }
  }
  for (const field of ['requests', 'reservedMicroUsd']) {
    assert.equal(joint[field], arms.cairn.total[field] + arms.mem0.total[field]);
    assert.equal(scoring[field], arms.cairn.stages.judge[field] + arms.mem0.stages.judge[field]);
    assert.equal(joint[field], generation[field] + scoring[field]);
  }
  assert.equal(joint.reservedMicroUsd, 777_180);
});

test('maximum fixed plan returns safe integer ceilings without reducing its roster', () => {
  const result = project(Array(250).fill(2500));
  assert.equal(result.plannedCaseCount, 250);
  assert.equal(result.plannedBatchCount, 625_000);
  assert.equal(result.conditionalCeilings.arms.cairn.stages.extractionCount.requests, 625_000);
  assert.equal(result.conditionalCeilings.arms.mem0.stages.fallbackSingletonEmbedding.requests, 160_000_000);
  assert.ok(Number.isSafeInteger(result.conditionalCeilings.joint.reservedMicroUsd));
  assert.deepEqual(JSON.parse(JSON.stringify(result)), result);
});

test('exact fit, one-micro shortfall, and protected funds remain distinct', () => {
  const total = project([1]).conditionalCeilings.joint.reservedMicroUsd;
  assert.deepEqual(project([1], total).budget, {
    remainingMicroUsd: total, protectedMicroUsd: 0,
    availableForComparisonMicroUsd: total, upperBoundFits: true,
    headroomMicroUsd: 0, shortfallMicroUsd: 0,
  });
  assert.deepEqual(project([1], total - 1).budget, {
    remainingMicroUsd: total - 1, protectedMicroUsd: 0,
    availableForComparisonMicroUsd: total - 1, upperBoundFits: false,
    headroomMicroUsd: 0, shortfallMicroUsd: 1,
  });
  assert.deepEqual(project([1], total + 90, 100).budget, {
    remainingMicroUsd: total + 90, protectedMicroUsd: 100,
    availableForComparisonMicroUsd: total - 10, upperBoundFits: false,
    headroomMicroUsd: 0, shortfallMicroUsd: 10,
  });
});

test('full profile equality refuses changed model, price, cap and version', () => {
  const cloned = options();
  cloned.policy = structuredClone(cloned.policy);
  cloned.stages = structuredClone(cloned.stages);
  cloned.wireProfile = structuredClone(cloned.wireProfile);
  assert.equal(projectMixedResources(cloned).plannedBatchCount, 1);
  const cases = [
    value => { value.policy.cairnCount.model = 'another-model'; },
    value => { value.stages.answer.inputPrice.microUsdNumerator = 3; },
    value => { value.wireProfile = structuredClone(value.wireProfile);
      value.wireProfile.embedding.maxItems = 101; },
    value => { value.policy.version = 2; },
  ];
  for (const mutate of cases) {
    const value = options();
    mutate(value);
    denied(value, 'unsupported_resource_profile');
  }
  const wrong = options();
  wrong.nativeProfile = 'native-next';
  denied(wrong, 'unsupported_native_profile');
});

test('top-level and batch-count shape reject extras, holes, accessors and negative zero', () => {
  const extra = options(); extra.extra = true; denied(extra, 'invalid_resource_options');
  const sparse = options([1, , 2]); denied(sparse, 'invalid_resource_options');
  const extraArray = [1]; extraArray.note = 1;
  denied(options(extraArray), 'invalid_resource_options');
  const arrayAccessor = [1]; let arrayInvoked = 0;
  Object.defineProperty(arrayAccessor, '0', {
    enumerable: true, get() { arrayInvoked += 1; return 1; },
  });
  denied(options(arrayAccessor), 'invalid_resource_options'); assert.equal(arrayInvoked, 0);
  const accessor = options(); let invoked = 0;
  Object.defineProperty(accessor, 'policy', { enumerable: true, get() { invoked += 1; return {}; } });
  denied(accessor, 'invalid_resource_options'); assert.equal(invoked, 0);
  denied(options([-0]), 'invalid_resource_options');
  denied(options([2501]), 'invalid_batch_counts');
  denied(options([]), 'invalid_batch_counts');
  denied(options(Array(251).fill(0)), 'invalid_batch_counts');
});

test('malformed profiles, cycles, symbols, prototypes and overflows fail without getters', () => {
  const accessor = options(); let invoked = 0;
  Object.defineProperty(accessor.policy, 'version', {
    enumerable: true, get() { invoked += 1; return 1; },
  });
  denied(accessor, 'invalid_resource_options'); assert.equal(invoked, 0);
  const cyclic = options(); cyclic.policy.self = cyclic.policy;
  denied(cyclic, 'invalid_resource_options');
  const symbolic = options(); symbolic.policy[Symbol('metadata')] = 1;
  denied(symbolic, 'invalid_resource_options');
  const prototype = options(); prototype.policy = Object.assign(Object.create({ extra: true }), prototype.policy);
  denied(prototype, 'invalid_resource_options');
  denied(options([1], Number.MAX_SAFE_INTEGER + 1), 'invalid_resource_budget');
  denied(options([1], Number.MAX_VALUE), 'invalid_resource_budget');
  denied(options([1], -0), 'invalid_resource_options');
  denied(options([1], 5, 6), 'invalid_resource_budget');
});

test('profile depth and aggregate UTF-8 string bounds reject oversized snapshots', () => {
  const deep = options();
  let nested = deep.policy;
  for (let index = 0; index < 17; index += 1) {
    nested.next = {};
    nested = nested.next;
  }
  denied(deep, 'invalid_resource_options');
  const bytes = options();
  bytes.policy.note = 'é'.repeat(524_289);
  denied(bytes, 'invalid_resource_options');
});

test('wide object is rejected before any per-key descriptor traversal', () => {
  const source = Object.fromEntries(Array.from({ length: 10_001 }, (_, index) => [`k${index}`, 1]));
  let descriptors = 0;
  const wide = new Proxy(source, {
    getOwnPropertyDescriptor(target, key) {
      descriptors += 1;
      return Reflect.getOwnPropertyDescriptor(target, key);
    },
  });
  const value = options(); value.policy = wide;
  denied(value, 'invalid_resource_options');
  assert.equal(descriptors, 0);
});

import { experimentPolicy } from '../live/session.mjs';
import { benchmarkStagePolicy } from '../live/public-pilot.mjs';
import { mem0WireProfile } from '../experiment-budget/mem0-wire.mjs';

export const MIXED_RESOURCE_VERSION = 'mixed-resource-projection-v1';
export const NATIVE_PROFILE = 'mem0-2.2.0-infer-add-no-nlp-v1';

export class MixedResourceError extends Error {
  constructor(code) {
    super(code);
    this.name = 'MixedResourceError';
    this.code = code;
  }
}

const fail = code => { throw new MixedResourceError(code); };
const MAX_SAFE = BigInt(Number.MAX_SAFE_INTEGER);
const MAX_DEPTH = 16;
const MAX_NODES = 10_000;
const MAX_STRING_BYTES = 1_048_576;
const OPTION_KEYS = ['batchCounts', 'policy', 'stages', 'wireProfile',
  'remainingMicroUsd', 'protectedMicroUsd', 'nativeProfile'];

// Reflect.ownKeys allocates the key list. The width check deliberately precedes
// per-property descriptor traversal; these bounds do not cap total JS memory or
// adversarial Proxy trap work.
function snapshot(root, code) {
  const state = { nodes: 0, stringBytes: 0, active: new WeakSet() };
  const chargeNode = () => { if (++state.nodes > MAX_NODES) fail(code); };
  const chargeString = value => {
    state.stringBytes += Buffer.byteLength(value, 'utf8');
    if (state.stringBytes > MAX_STRING_BYTES) fail(code);
  };
  function walk(value, depth) {
    chargeNode();
    if (depth > MAX_DEPTH) fail(code);
    if (typeof value === 'string') { chargeString(value); return value; }
    if (value === null || typeof value === 'boolean') return value;
    if (typeof value === 'number' && Number.isFinite(value) && !Object.is(value, -0)) return value;
    if (typeof value !== 'object' || state.active.has(value)) fail(code);
    const array = Array.isArray(value);
    if (Object.getPrototypeOf(value) !== (array ? Array.prototype : Object.prototype)) fail(code);
    const keys = Reflect.ownKeys(value);
    // Each key consumes a node and each non-length child consumes at least one.
    const minimumNodes = keys.length * 2 - (array ? 1 : 0);
    if (minimumNodes > MAX_NODES - state.nodes) fail(code);
    let length;
    if (array) {
      const lengthDescriptor = Object.getOwnPropertyDescriptor(value, 'length');
      if (!lengthDescriptor || !Object.hasOwn(lengthDescriptor, 'value')
        || !Number.isSafeInteger(lengthDescriptor.value) || lengthDescriptor.value < 0
        || keys.length !== lengthDescriptor.value + 1) fail(code);
      length = lengthDescriptor.value;
    }
    state.active.add(value);
    const result = array ? [] : Object.create(null);
    for (const key of keys) {
      if (typeof key !== 'string') fail(code);
      chargeNode();
      chargeString(key);
      if (array && key === 'length') continue;
      if (array && (!/^(0|[1-9][0-9]*)$/u.test(key)
        || Number(key) >= length || String(Number(key)) !== key)) fail(code);
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      if (!descriptor || !Object.hasOwn(descriptor, 'value') || !descriptor.enumerable) fail(code);
      Object.defineProperty(result, key, { value: walk(descriptor.value, depth + 1),
        enumerable: true, configurable: true, writable: true });
    }
    state.active.delete(value);
    if (array && result.length !== length) fail(code);
    return result;
  }
  return walk(root, 0);
}

const canonical = value => JSON.stringify(value, (_key, item) => {
  if (item !== null && typeof item === 'object' && !Array.isArray(item)) {
    return Object.fromEntries(Object.keys(item).sort().map(key => [key, item[key]]));
  }
  return item;
});

const safeMoney = value => Number.isSafeInteger(value) && value >= 0 && !Object.is(value, -0);
const checked = value => {
  if (value < 0n || value > MAX_SAFE) fail('resource_overflow');
  return Number(value);
};
const ceilPrice = (tokens, price) => (BigInt(tokens) * BigInt(price.microUsdNumerator)
  + BigInt(price.tokenDenominator) - 1n) / BigInt(price.tokenDenominator);
const stage = (requests, reservation) => ({ requests: checked(requests),
  reservedMicroUsd: checked(requests * reservation) });
const sum = stages => ({ requests: checked(stages.reduce((acc, item) => acc + BigInt(item.requests), 0n)),
  reservedMicroUsd: checked(stages.reduce((acc, item) => acc + BigInt(item.reservedMicroUsd), 0n)) });

/** Pure conditional ceiling. The caller, not this module, verifies the native execution profile. */
export function projectMixedResources(options) {
  const input = snapshot(options, 'invalid_resource_options');
  if (!input || Array.isArray(input) || Object.keys(input).length !== OPTION_KEYS.length
    || OPTION_KEYS.some(key => !Object.hasOwn(input, key))) fail('invalid_resource_options');
  const { batchCounts, policy, stages, wireProfile, remainingMicroUsd,
    protectedMicroUsd, nativeProfile } = input;
  if (!Array.isArray(batchCounts) || batchCounts.length < 1 || batchCounts.length > 250
    || batchCounts.some(count => !Number.isSafeInteger(count) || count < 0
      || count > 2500 || Object.is(count, -0))) fail('invalid_batch_counts');
  if (!safeMoney(remainingMicroUsd) || !safeMoney(protectedMicroUsd)
    || protectedMicroUsd > remainingMicroUsd) fail('invalid_resource_budget');
  if (nativeProfile !== NATIVE_PROFILE) fail('unsupported_native_profile');
  if (canonical(policy) !== canonical(experimentPolicy())
    || canonical(stages) !== canonical(benchmarkStagePolicy())
    || canonical(wireProfile) !== canonical(mem0WireProfile())) fail('unsupported_resource_profile');

  const cases = BigInt(batchCounts.length);
  const batches = batchCounts.reduce((acc, count) => acc + BigInt(count), 0n);
  const countReserve = BigInt(policy.cairnCount.reservedMicroUsd);
  const generationReserve = BigInt(policy.cairnGeneration.reservedMicroUsd);
  const answerReserve = BigInt(stages.answer.reservedMicroUsd);
  const judgeReserve = BigInt(stages.judge.reservedMicroUsd);
  const chat = wireProfile.chat;
  const embedding = wireProfile.embedding;
  const singletonReserve = [BigInt(embedding.minimumReservedMicroUsd),
    ceilPrice(embedding.maxItemInputTokens, embedding.inputPrice)]
    .reduce((a, b) => a > b ? a : b);
  const batchReserve = [BigInt(embedding.minimumReservedMicroUsd),
    ceilPrice(embedding.maxInputTokens, embedding.inputPrice)]
    .reduce((a, b) => a > b ? a : b);
  const factBatchCalls = (BigInt(chat.maxFacts) + BigInt(embedding.maxItems) - 1n)
    / BigInt(embedding.maxItems);

  const cairnStages = {
    extractionCount: stage(batches, countReserve),
    extractionGeneration: stage(batches, generationReserve),
    qualificationCount: stage(batches, countReserve),
    qualificationGeneration: stage(batches, generationReserve),
    classificationCount: stage(batches, countReserve),
    classificationGeneration: stage(batches, generationReserve),
    selectionRound1Count: stage(cases, countReserve),
    selectionRound1Generation: stage(cases, generationReserve),
    selectionRound2Count: stage(cases, countReserve),
    selectionRound2Generation: stage(cases, generationReserve),
    rankingCount: stage(cases, countReserve),
    rankingGeneration: stage(cases, generationReserve),
    answer: stage(cases, answerReserve),
    judge: stage(cases, judgeReserve),
  };
  const mem0Stages = {
    addQueryEmbedding: stage(batches, singletonReserve),
    addChat: stage(batches, BigInt(chat.reservedMicroUsd)),
    factBatchEmbedding: stage(batches * factBatchCalls, batchReserve),
    fallbackSingletonEmbedding: stage(batches * BigInt(chat.maxFacts), singletonReserve),
    searchEmbedding: stage(cases, singletonReserve),
    answer: stage(cases, answerReserve),
    judge: stage(cases, judgeReserve),
  };
  const cairnTotal = sum(Object.values(cairnStages));
  const mem0Total = sum(Object.values(mem0Stages));
  const generation = sum([...Object.entries(cairnStages), ...Object.entries(mem0Stages)]
    .filter(([name]) => name !== 'judge').map(([, value]) => value));
  const scoring = sum([cairnStages.judge, mem0Stages.judge]);
  const joint = sum([cairnTotal, mem0Total]);
  const available = BigInt(remainingMicroUsd) - BigInt(protectedMicroUsd);
  const total = BigInt(joint.reservedMicroUsd);
  return {
    version: MIXED_RESOURCE_VERSION,
    nativeProfile,
    plannedCaseCount: checked(cases),
    plannedBatchCount: checked(batches),
    conditionalCeilings: {
      arms: { cairn: { stages: cairnStages, total: cairnTotal },
        mem0: { stages: mem0Stages, total: mem0Total } },
      generation, scoring, joint,
    },
    actualMinimumMicroUsd: 0,
    empiricalEstimate: null,
    budget: {
      remainingMicroUsd,
      protectedMicroUsd,
      availableForComparisonMicroUsd: checked(available),
      upperBoundFits: total <= available,
      headroomMicroUsd: checked(total <= available ? available - total : 0n),
      shortfallMicroUsd: checked(total > available ? total - available : 0n),
    },
  };
}

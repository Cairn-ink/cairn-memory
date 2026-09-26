import assert from 'node:assert/strict';
import test from 'node:test';

import { experimentPolicy } from '../../live/session.mjs';
import { benchmarkStagePolicy } from '../../live/public-pilot.mjs';
import { inspectMem0WireRequest, inspectMem0WireResponse,
  mem0WireProfile } from '../../experiment-budget/mem0-wire.mjs';
import { MIXED_RESOURCE_VERSION, MixedResourceError, NATIVE_PROFILE,
  projectMixedResources } from '../mixed-resource.mjs';

const options = (batchCounts = [1], remainingMicroUsd = 1_000_000,
  protectedMicroUsd = 0) => ({ batchCounts, policy: experimentPolicy(),
  stages: benchmarkStagePolicy(), wireProfile: mem0WireProfile(),
  remainingMicroUsd, protectedMicroUsd, nativeProfile: NATIVE_PROFILE });
const project = (batchCounts, remaining, protectedAmount) => projectMixedResources(
  options(batchCounts, remaining, protectedAmount));
const denied = (value, code) => assert.throws(() => projectMixedResources(value),
  error => error instanceof MixedResourceError && error.code === code);
const chatRequest = () => inspectMem0WireRequest('chat', JSON.stringify({
  model: mem0WireProfile().chat.model,
  messages: [{ role: 'system', content: 'Synthetic extraction.' },
    { role: 'user', content: 'Synthetic source.' }],
  max_tokens: mem0WireProfile().chat.maxOutputTokens, temperature: 0.1, top_p: 0.1,
  response_format: { type: 'json_object' }, store: false,
}));
const chatResponse = texts => JSON.stringify({
  object: 'chat.completion', model: mem0WireProfile().chat.model,
  usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
  choices: [{ index: 0, finish_reason: 'stop', message: { role: 'assistant',
    content: JSON.stringify({ memory: texts.map(text => ({ text })) }) } }],
});
const embeddingReservation = texts => inspectMem0WireRequest('embedding', JSON.stringify({
  model: mem0WireProfile().embedding.model,
  input: texts.map(text => text.replaceAll('\n', ' ')),
  dimensions: mem0WireProfile().embedding.dimensions, encoding_format: 'float',
})).reservedMicroUsd;

// Mirrors only the pinned native call *partition*, not pricing. The actual wire
// inspector independently tokenizes every synthetic physical request.
function inspectFactPasses(texts) {
  const response = inspectMem0WireResponse(chatRequest(), chatResponse(texts));
  assert.equal(response.payloadValid, true);
  assert.equal(response.usageWithinBounds, true);
  const facts = JSON.parse(JSON.parse(response.bodyText).choices[0].message.content)
    .memory.map(item => item.text).filter(Boolean);
  assert.deepEqual(facts, texts);
  assert.ok(facts.reduce((sum, text) => sum + Buffer.byteLength(text, 'utf8'), 0)
    <= Buffer.byteLength(response.bodyText, 'utf8'));
  const width = mem0WireProfile().embedding.maxItems;
  let batch = 0;
  for (let index = 0; index < facts.length; index += width) {
    batch += embeddingReservation(facts.slice(index, index + width));
  }
  const singleton = facts.reduce((sum, text) => sum + embeddingReservation([text]), 0);
  const stages = project([1]).conditionalCeilings.arms.mem0.stages;
  assert.ok(batch <= stages.factBatchEmbedding.reservedMicroUsd);
  assert.ok(singleton <= stages.fallbackSingletonEmbedding.reservedMicroUsd);
  assert.ok(batch + singleton <= stages.factBatchEmbedding.reservedMicroUsd
    + stages.fallbackSingletonEmbedding.reservedMicroUsd);
  return { batch, singleton };
}

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
  assert.equal(MIXED_RESOURCE_VERSION, 'mixed-resource-projection-v2');
  assert.equal(result.version, MIXED_RESOURCE_VERSION);
  const { cairn, mem0 } = result.conditionalCeilings.arms;
  assert.deepEqual(cairn.stages.qualificationCount, { requests: 1, reservedMicroUsd: 5000 });
  assert.deepEqual(cairn.stages.classificationGeneration, { requests: 1, reservedMicroUsd: 5000 });
  assert.deepEqual(mem0.stages.addQueryEmbedding, { requests: 1, reservedMicroUsd: 164 });
  assert.deepEqual(mem0.stages.addChat, { requests: 1, reservedMicroUsd: 16_308 });
  assert.deepEqual(mem0.stages.factBatchEmbedding, { requests: 3, reservedMicroUsd: 5_245 });
  assert.deepEqual(mem0.stages.fallbackSingletonEmbedding,
    { requests: 256, reservedMicroUsd: 5_498 });
  assert.deepEqual(result.conditionalCeilings.generation,
    { requests: 276, reservedMicroUsd: 189_019 });
  assert.deepEqual(result.conditionalCeilings.scoring,
    { requests: 2, reservedMicroUsd: 20_800 });
  assert.deepEqual(result.conditionalCeilings.joint,
    { requests: 278, reservedMicroUsd: 209_819 });
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
  assert.equal(joint.reservedMicroUsd, 629_457);
});

test('fixed N30 and high-batch arithmetic preserves all requests and both fallback stages', () => {
  const thirty = project(Array(30).fill(1));
  assert.deepEqual(thirty.conditionalCeilings.joint,
    { requests: 8_340, reservedMicroUsd: 6_294_570 });
  const counts = [1_477, ...Array(29).fill(0)];
  const high = project(counts);
  assert.deepEqual(high.conditionalCeilings.joint,
    { requests: 394_689, reservedMicroUsd: 89_084_675 });
  assert.deepEqual(high.conditionalCeilings.arms.mem0.stages.factBatchEmbedding,
    { requests: 4_431, reservedMicroUsd: 1_477 * 5_245 });
  assert.deepEqual(high.conditionalCeilings.arms.mem0.stages.fallbackSingletonEmbedding,
    { requests: 378_112, reservedMicroUsd: 1_477 * 5_498 });
});

test('actual wire bounds zero, chunk edges, duplicate, LF, escaped and Unicode facts', () => {
  for (const count of [0, 1, 99, 100, 101, 256]) {
    const texts = Array.from({ length: count }, (_, index) => index % 3 === 0
      ? 'Same synthetic fact.' : index % 3 === 1 ? 'Line one\nline two' : '漢字 é / "quote"');
    const { batch, singleton } = inspectFactPasses(texts);
    if (count === 0) assert.deepEqual({ batch, singleton }, { batch: 0, singleton: 0 });
    else assert.ok(batch > 0 && singleton > 0);
  }
});

test('accepted response near byte cap bounds both fact embedding passes; invalid boundaries deny', () => {
  const cap = mem0WireProfile().chat.maxResponseBytes;
  // Deterministic, poorly compressible letters exercise substantial actual
  // cl100k usage rather than making a near-cap response from one repeated BPE.
  const letters = length => {
    let state = 0x6d2b79f5;
    let result = '';
    for (let index = 0; index < length; index += 1) {
      state = (Math.imul(state, 1_664_525) + 1_013_904_223) >>> 0;
      result += String.fromCharCode(97 + state % 26);
    }
    return result;
  };
  let low = 1; let high = 1100;
  while (low + 1 < high) {
    const mid = Math.floor((low + high) / 2);
    if (Buffer.byteLength(chatResponse(Array(256).fill(letters(mid))), 'utf8') <= cap) low = mid;
    else high = mid;
  }
  const texts = Array(256).fill(letters(low));
  const raw = chatResponse(texts);
  assert.ok(cap - Buffer.byteLength(raw, 'utf8') < 256);
  const { batch, singleton } = inspectFactPasses(texts);
  assert.ok(batch > 2_000 && singleton > 2_000);
  assert.throws(() => inspectMem0WireResponse(chatRequest(),
    chatResponse(Array(256).fill(letters(low + 1)))),
  error => error.code === 'invalid_response');
  const excessFacts = inspectMem0WireResponse(chatRequest(), chatResponse(Array(257).fill('x')));
  assert.equal(excessFacts.payloadValid, false);
  const tooLongFact = inspectMem0WireResponse(chatRequest(), chatResponse([' a'.repeat(8193)]));
  assert.equal(tooLongFact.payloadValid, false);
  // A batch family alone cannot cover a late failed third chunk followed by
  // all 256 fresh singleton requests; the fallback remains independently paid.
  const stages = project([1]).conditionalCeilings.arms.mem0.stages;
  assert.equal(stages.factBatchEmbedding.requests + stages.fallbackSingletonEmbedding.requests, 259);
  assert.equal(stages.factBatchEmbedding.reservedMicroUsd
    + stages.fallbackSingletonEmbedding.reservedMicroUsd, 10_743);
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

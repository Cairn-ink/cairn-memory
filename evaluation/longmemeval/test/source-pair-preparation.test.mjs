import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';

import { FRESH_SMOKE_TYPES, selectFreshSmoke } from '../../live/reliability-smoke.mjs';
import { planIndexedWindowLongMemEvalCase,
  planQualifiedPrefixLongMemEvalCase } from '../ingestion.mjs';
import { opaqueQuestionId, opaqueSessionId, stableTurnIdV2 } from '../prepare.mjs';
import { qualifiedSourcePairProtocol } from '../public-comparison.mjs';
import { selectSourcePairCohorts, projectSourcePairCase, SOURCE_PAIR_COHORT_SEED } from
  '../source-pair-preparation.mjs';

const hash = (text) => createHash('sha256').update(text, 'utf8').digest('hex');
const byteCompare = (a, b) => Buffer.compare(Buffer.from(a, 'utf8'), Buffer.from(b, 'utf8'));
const inventory = () => Array.from({ length: 500 }, (_, index) => ({
  sourceQuestionId: `synthetic-${String(index).padStart(3, '0')}`,
  questionType: FRESH_SMOKE_TYPES[index % FRESH_SMOKE_TYPES.length],
}));
const exclusions = (source) => source.slice(0, 88).map((entry) => entry.sourceQuestionId);
const cohortOptions = () => {
  const source = inventory();
  return { inventory: source, exclusions: exclusions(source) };
};

const sourceId = 'source-pair-preparation-synthetic';
const questionId = opaqueQuestionId(sourceId);
const namespace = { ownerId: 'source-pair-preparation', scope: 'project', projectId: questionId };
const question = { question_id: questionId, text: 'What day?', date: 'Saturday' };
const limits = { contextWindow: 100_000, outputTokens: 50, answerTimeoutMs: 15_000, recallLimit: 6 };
const history = (contents = ['x'.repeat(800) + ' Tail Friday.']) => ({ question_id: questionId,
  sessions: [{ session_index: 0, session_id: opaqueSessionId(sourceId, 0), date: 'Tuesday',
    turns: contents.map((content, index) => ({ turn_id: stableTurnIdV2(sourceId, 0, index),
      role: index % 2 ? 'assistant' : 'user', content })) }] });
const reservations = { cairnCount: 7, cairnGeneration: 11, answer: 13, judge: 17 };
const projectionOptions = (patch = {}) => ({ history: history(), question: { ...question },
  namespace: { ...namespace }, answerModel: 'synthetic-answer-v1', limits: { ...limits },
  armOrder: ['qualified-prefix', 'indexed-windows'], reservations: { ...reservations }, ...patch });

test('R1 deterministically freezes blind one/five per type and both prepared orders', () => {
  const input = cohortOptions();
  const result = selectSourcePairCohorts(input);
  assert.equal(result.seed, SOURCE_PAIR_COHORT_SEED);
  assert.equal(result.exclusionCount, 88);
  assert.equal(result.development.byType.length, 6);
  assert.deepEqual(result.development.byType.map((entry) => entry.sourceQuestionIds.length),
    [1, 1, 1, 1, 1, 1]);
  assert.deepEqual(result.holdout.byType.map((entry) => entry.sourceQuestionIds.length),
    [5, 5, 5, 5, 5, 5]);
  const dev = result.development.byType.flatMap((entry) => entry.sourceQuestionIds);
  const held = result.holdout.byType.flatMap((entry) => entry.sourceQuestionIds);
  assert.equal(new Set([...dev, ...held]).size, 36);
  assert.equal([...dev, ...held].some((id) => input.exclusions.includes(id)), false);
  for (const [typeIndex, type] of FRESH_SMOKE_TYPES.entries()) {
    const ranked = input.inventory.filter((entry) => entry.questionType === type
      && !input.exclusions.includes(entry.sourceQuestionId))
      .map((entry) => entry.sourceQuestionId)
      .sort((left, right) => byteCompare(hash(SOURCE_PAIR_COHORT_SEED + left),
        hash(SOURCE_PAIR_COHORT_SEED + right)) || byteCompare(left, right));
    assert.deepEqual(result.development.byType[typeIndex],
      { questionType: type, sourceQuestionIds: ranked.slice(0, 1) });
    assert.deepEqual(result.holdout.byType[typeIndex],
      { questionType: type, sourceQuestionIds: ranked.slice(1, 6) });
  }
  assert.deepEqual(result.development.sourceQuestionIdsPreparedOrder,
    input.inventory.filter((entry) => dev.includes(entry.sourceQuestionId))
      .map((entry) => entry.sourceQuestionId));
  assert.deepEqual(result.holdout.sourceQuestionIdsPreparedOrder,
    input.inventory.filter((entry) => held.includes(entry.sourceQuestionId))
      .map((entry) => entry.sourceQuestionId));
  assert.equal(result.development.membershipSha256,
    hash(JSON.stringify([...dev].sort(byteCompare))));
  assert.equal(result.holdout.membershipSha256,
    hash(JSON.stringify([...held].sort(byteCompare))));
  assert.equal(result.development.preparedOrderSha256,
    hash(JSON.stringify(result.development.sourceQuestionIdsPreparedOrder)));
  assert.equal(result.exclusionsSha256,
    hash(JSON.stringify([...input.exclusions].sort(byteCompare))));
  assert.equal(Object.isFrozen(result.holdout.byType[0].sourceQuestionIds), true);
  assert.throws(() => result.development.byType[0].sourceQuestionIds.push('bad'), TypeError);
  input.inventory[100].sourceQuestionId = 'later-mutation';
  input.exclusions.push('later-mutation');
  assert.equal(result.inventoryOrderSha256, hash(JSON.stringify(inventory().map((entry) =>
    [entry.sourceQuestionId, entry.questionType]))));
});

test('R1 order and identity digests change independently, old 82-selector stays frozen', () => {
  const input = cohortOptions();
  const original = selectSourcePairCohorts(input);
  const reordered = selectSourcePairCohorts({ ...input, inventory: [...input.inventory].reverse() });
  assert.equal(reordered.development.membershipSha256, original.development.membershipSha256);
  assert.equal(reordered.holdout.membershipSha256, original.holdout.membershipSha256);
  assert.notEqual(reordered.development.preparedOrderSha256, original.development.preparedOrderSha256);
  assert.notEqual(reordered.inventoryOrderSha256, original.inventoryOrderSha256);
  const reversedObjectKeys = input.inventory.map(({ sourceQuestionId, questionType }) =>
    ({ questionType, sourceQuestionId }));
  const same = selectSourcePairCohorts({ ...input, inventory: reversedObjectKeys });
  assert.equal(same.inventoryOrderSha256, original.inventoryOrderSha256);
  assert.deepEqual(same.development, original.development);
  const winner = original.development.byType[0].sourceQuestionIds[0];
  const next = selectSourcePairCohorts({ ...input, exclusions: [...input.exclusions, winner] });
  assert.notEqual(next.development.membershipSha256, original.development.membershipSha256);
  assert.notEqual(next.exclusionsSha256, original.exclusionsSha256);
  const oldShape = input.inventory.map(({ sourceQuestionId, questionType }) =>
    ({ question_id: sourceQuestionId, question_type: questionType }));
  assert.equal(selectFreshSmoke(oldShape, input.exclusions.slice(0, 82))
    .sourceQuestionIdsPreparedOrder.length, 6);
  assert.throws(() => selectFreshSmoke(oldShape, input.exclusions), { code: 'invalid_roster' });
});

test('R1 rejects malformed/oracle inventory, exclusions, accessors and insufficient strata', () => {
  const input = cohortOptions();
  const invalid = [
    { ...input, inventory: input.inventory.slice(1) },
    { ...input, inventory: input.inventory.map((entry, index) => index === 1
      ? { ...entry, sourceQuestionId: input.inventory[0].sourceQuestionId } : entry) },
    { ...input, inventory: input.inventory.map((entry, index) => index === 1
      ? { ...entry, answer: 'oracle' } : entry) },
    { ...input, inventory: input.inventory.map((entry, index) => index === 1
      ? { sourceQuestionId: entry.sourceQuestionId, questionType: 'unknown' } : entry) },
    { ...input, inventory: input.inventory.map((entry, index) => index === 1
      ? { sourceQuestionId: 'x'.repeat(257), questionType: entry.questionType } : entry) },
    { ...input, exclusions: [...input.exclusions, input.exclusions[0]] },
    { ...input, exclusions: [...input.exclusions, 'not-in-source'] },
    { ...input, inventory: input.inventory.map((entry) =>
      ({ ...entry, questionType: 'single-session-user' })),
    },
  ];
  for (const item of invalid) assert.throws(() => selectSourcePairCohorts(item),
    { code: /invalid_|insufficient_type/u });
  const sparse = [...input.inventory];
  delete sparse[5];
  sparse.foo = { ...input.inventory[5] };
  assert.throws(() => selectSourcePairCohorts({ ...input, inventory: sparse }),
    { code: 'invalid_options' });
  let reads = 0;
  const accessor = { ...input };
  Object.defineProperty(accessor, 'inventory', { enumerable: true, get: () => {
    reads++; return input.inventory;
  } });
  assert.throws(() => selectSourcePairCohorts(accessor), { code: 'invalid_options' });
  assert.equal(reads, 0);
  const cycle = cohortOptions();
  cycle.inventory[0].self = cycle.inventory[0];
  assert.throws(() => selectSourcePairCohorts(cycle), { code: 'invalid_options' });
  const tooDeep = cohortOptions();
  let nested = tooDeep.inventory[0];
  for (let depth = 0; depth < 35; depth++) { nested.extra = {}; nested = nested.extra; }
  assert.throws(() => selectSourcePairCohorts(tooDeep), { code: 'invalid_options' });
  const insufficient = { ...input, exclusions: input.inventory.filter((entry) =>
    entry.questionType === FRESH_SMOKE_TYPES[0]).slice(0, 79).map((entry) => entry.sourceQuestionId) };
  assert.throws(() => selectSourcePairCohorts(insufficient), { code: 'insufficient_type' });
});

test('R2 one-batch source protocol has independent exact route and phase golden', () => {
  const input = projectionOptions();
  const output = projectSourcePairCase(input);
  assert.equal(output.protocol.digest, qualifiedSourcePairProtocol({ history: input.history,
    question: input.question, namespace: input.namespace, answerModel: input.answerModel,
    limits: input.limits, armOrder: input.armOrder }).digest);
  assert.deepEqual(output.batchCounts, { qualifiedPrefix: 1, indexedWindows: 1 });
  assert.deepEqual(output.upperCounts, { cairnCount: 12, cairnGeneration: 12, answer: 2, judge: 2 });
  // Independent arithmetic: six batch methods + six recall methods, each count+generation.
  assert.deepEqual(output.phases, { generation: { requests: 26, reservedMicroUsd: 242 },
    scoring: { requests: 2, reservedMicroUsd: 34 } });
  assert.deepEqual(output.total, { requests: 28, reservedMicroUsd: 276 });
  assert.deepEqual(output.limitations,
    { modelContextFitEstablished: false, semanticSourceCoverage: 'unassessed' });
  assert.equal(output.protocol.arms[0].captureSourcePolicy, 'retained-prefix-v1');
  assert.equal(output.protocol.arms[1].captureSourcePolicy, 'indexed-windows-v1');
  const sourcePlanInput = { history: input.history, namespace: input.namespace };
  const prefix = planQualifiedPrefixLongMemEvalCase(sourcePlanInput);
  const indexed = planIndexedWindowLongMemEvalCase(sourcePlanInput);
  assert.deepEqual(prefix.batches.map((batch) => batch.captureInput),
    indexed.batches.map((batch) => batch.captureInput));
  assert.equal(prefix.batches[0].retainedMessages[0].content, 'x'.repeat(800));
  assert.deepEqual(indexed.batches[0].indexedWindows.map((window) => window.content),
    ['x'.repeat(800), 'Tail Friday.']);
  assert.notEqual(prefix.batches[0].normalizedCapture.payloadDigest,
    indexed.batches[0].normalizedCapture.payloadDigest);
  assert.equal(output.total.requests, 28); // Tail exposure changes neither batch count nor upper ceiling.
  assert.equal(Object.isFrozen(output.phases.generation), true);
  input.history.sessions[0].turns[0].content = 'changed';
  assert.equal(output.batchCounts.qualifiedPrefix, 1);
});

test('R2 reversed arms, multiple batches, blockers and conservative checked arithmetic', () => {
  const contents = Array.from({ length: 25 }, (_, index) => index === 24
    ? 'z'.repeat(800) + ' tail' : `turn ${index}`);
  const output = projectSourcePairCase(projectionOptions({ history: history(contents),
    armOrder: ['indexed-windows', 'qualified-prefix'] }));
  assert.deepEqual(output.protocol.armOrder, ['indexed-windows', 'qualified-prefix']);
  assert.deepEqual(output.batchCounts, { qualifiedPrefix: 2, indexedWindows: 2 });
  assert.deepEqual(output.upperCounts, { cairnCount: 18, cairnGeneration: 18, answer: 2, judge: 2 });
  assert.deepEqual(output.phases, { generation: { requests: 38, reservedMicroUsd: 350 },
    scoring: { requests: 2, reservedMicroUsd: 34 } });
  assert.deepEqual(output.total, { requests: 40, reservedMicroUsd: 384 });
  assert.throws(() => projectSourcePairCase(projectionOptions({ history: history(['']) })),
    { code: 'nonexecutable_plan' });
  for (const value of [0, -1, 1.5, Number.MAX_SAFE_INTEGER + 1, '7']) {
    assert.throws(() => projectSourcePairCase(projectionOptions({ reservations:
      { ...reservations, judge: value } })), { code: 'invalid_reservations' });
  }
  assert.throws(() => projectSourcePairCase(projectionOptions({ reservations:
    { ...reservations, cairnCount: Number.MAX_SAFE_INTEGER } })),
  { code: 'projection_overflow' });
  assert.throws(() => projectSourcePairCase({ ...projectionOptions(), judge: () => 1 }),
    { code: 'invalid_options' });
  let called = 0;
  const accessor = projectionOptions();
  Object.defineProperty(accessor, 'answerModel', { enumerable: true, get: () => {
    called++; return 'drifting';
  } });
  assert.throws(() => projectSourcePairCase(accessor), { code: 'invalid_options' });
  assert.equal(called, 0);
});

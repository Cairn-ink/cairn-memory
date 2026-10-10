import assert from 'node:assert/strict';
import test from 'node:test';
import { DEVELOPMENT_ROSTER } from '../corpus.mjs';
import { aggregateDevelopmentJudgments } from '../evaluator.mjs';

// Artificial verdict records exercise arithmetic only; these do not grade fixtures.
function packet() {
  const observations = DEVELOPMENT_ROSTER.map(({ id, family }) => ({ id, family, capture: { status: 'completed' },
    arms: Object.fromEntries(['baseline', 'full'].map(name => [name, { name, status: 'completed', answer: 'Synthetic response.' }])) }));
  const judgmentsA = observations.flatMap(({ id }) => ['baseline', 'full'].map(arm => ({ id, arm,
    verdict: 'correct', reviewedClaims: 2, unsupportedClaims: 0, staleClaims: 0, severeError: false, rationale: 'Synthetic judgment for aggregation only.' })));
  return { observations, judgmentsA, judgmentsB: structuredClone(judgmentsA) };
}
function judge(values, id, arm) { return values.find(value => value.id === id && value.arm === arm); }
function both(value, id, arm, change) { for (const values of [value.judgmentsA, value.judgmentsB]) Object.assign(judge(values, id, arm), change); }

test('agreement retains fixed N24 / N48 and six family N4 denominators', () => {
  const result = aggregateDevelopmentJudgments(packet());
  assert.equal(result.denominator, 24); assert.equal(result.outcomesDenominator, 48); assert.equal(result.outcomes.length, 48);
  for (const summary of Object.values(result.arms)) {
    assert.equal(summary.denominator, 24); assert.equal(summary.completed, 24); assert.equal(summary.correct, 24);
    assert.equal(summary.correct + summary.incorrect + summary.unresolved, 24);
  }
  assert.equal(Object.keys(result.families).length, 6);
  for (const family of Object.values(result.families)) for (const summary of Object.values(family)) {
    assert.equal(summary.denominator, 4); assert.equal(summary.correct, 4);
  }
  assert.deepEqual(result.paired, { denominator: 24, wins: 0, losses: 0, bothCorrect: 24, neitherCorrect: 0, netCorrect: 0 });
  assert.equal(result.safety.blocksAdvancement, false);
});

test('missing observations or arms and incomplete capture cannot receive correct credit', () => {
  const value = packet();
  value.observations.shift();
  delete value.observations[0].arms.full;
  value.observations[1].capture.status = 'unresolved';
  value.observations[2].arms.baseline.status = 'unresolved';
  value.observations[3].arms.full.answer = null;
  const result = aggregateDevelopmentJudgments(value);
  assert.equal(result.arms.baseline.correct, 21); assert.equal(result.arms.full.correct, 20);
  assert.equal(result.arms.baseline.unresolved, 3); assert.equal(result.arms.full.unresolved, 4);
  assert.equal(result.outcomes.length, 48);
  assert.ok(result.safety.unknown); assert.ok(result.safety.blocksAdvancement);
  const empty = aggregateDevelopmentJudgments({ observations: [], judgmentsA: [], judgmentsB: [] });
  assert.equal(empty.arms.baseline.unresolved, 24); assert.equal(empty.arms.full.unresolved, 24);
  assert.equal(empty.preAdjudication.missingJudgments, 48);
});

test('disagreement, missing judgment and explicitly unresolved judgment remain unresolved without adjudication', () => {
  const value = packet();
  judge(value.judgmentsA, 'D01', 'baseline').verdict = 'incorrect';
  value.judgmentsB = value.judgmentsB.filter(item => !(item.id === 'D02' && item.arm === 'full'));
  both(value, 'D03', 'full', { verdict: 'unresolved' });
  const result = aggregateDevelopmentJudgments(value);
  assert.equal(result.arms.baseline.unresolved, 1); assert.equal(result.arms.full.unresolved, 2);
  assert.deepEqual(result.preAdjudication, { denominator: 48, disagreements: 1, missingJudgments: 1, unknownJudgments: 1 });
  assert.equal(result.arms.full.completed, 24);
});

test('paired gains and losses count all slots, including completed wrong and unresolved answers', () => {
  const value = packet();
  both(value, 'D01', 'baseline', { verdict: 'incorrect' });
  both(value, 'D02', 'baseline', { verdict: 'unresolved' });
  both(value, 'D03', 'full', { verdict: 'incorrect' });
  both(value, 'D04', 'baseline', { verdict: 'incorrect' }); both(value, 'D04', 'full', { verdict: 'incorrect' });
  const result = aggregateDevelopmentJudgments(value);
  assert.deepEqual(result.paired, { denominator: 24, wins: 2, losses: 1, bothCorrect: 20, neitherCorrect: 1, netCorrect: 1 });
  assert.equal(result.families['detail-retention'].baseline.correct, 1);
  assert.equal(result.families['detail-retention'].full.correct, 2);
});

test('different claim totals remain separate; any agreed positive harm counts one affected question', () => {
  const value = packet();
  Object.assign(judge(value.judgmentsA, 'D01', 'full'), { reviewedClaims: 3, unsupportedClaims: 1, staleClaims: 2 });
  Object.assign(judge(value.judgmentsB, 'D01', 'full'), { reviewedClaims: 4, unsupportedClaims: 3, staleClaims: 1 });
  const result = aggregateDevelopmentJudgments(value);
  assert.deepEqual(result.claimCounts.judgeA.full, { submittedJudgments: 24, reviewedClaims: 49, unsupportedClaims: 1, staleClaims: 2 });
  assert.deepEqual(result.claimCounts.judgeB.full, { submittedJudgments: 24, reviewedClaims: 50, unsupportedClaims: 3, staleClaims: 1 });
  assert.equal(result.arms.full.unsupported, 1); assert.equal(result.arms.full.stale, 1);
  assert.equal(result.arms.full.unsupportedUnknown, 0); assert.equal(result.safety.unknown, false);
  assert.equal(result.safety.noIncreasedUnsupported, false); assert.equal(result.safety.noIncreasedStale, false);
  assert.ok(result.safety.blocksAdvancement);
});

test('positive-versus-zero harm disagreement blocks advancement without treating unknown as clean', () => {
  const value = packet();
  judge(value.judgmentsA, 'D01', 'full').unsupportedClaims = 1;
  judge(value.judgmentsB, 'D02', 'full').staleClaims = 1;
  const result = aggregateDevelopmentJudgments(value);
  assert.equal(result.arms.full.unsupported, 0); assert.equal(result.arms.full.unsupportedUnknown, 1);
  assert.equal(result.arms.full.stale, 0); assert.equal(result.arms.full.staleUnknown, 1);
  assert.ok(result.safety.unknown); assert.ok(result.safety.blocksAdvancement);
  assert.equal(result.safety.noIncreasedUnsupported, false);
});

test('severe false/true agreement detects new failure; disagreement, null and missing block safety', () => {
  const value = packet();
  both(value, 'D17', 'full', { severeError: true });
  both(value, 'D19', 'baseline', { severeError: true }); both(value, 'D19', 'full', { severeError: true });
  const result = aggregateDevelopmentJudgments(value);
  assert.deepEqual(result.safety.newlyFailingSevereCases, ['D17']);
  assert.equal(result.arms.full.severeErrors, 2); assert.ok(result.safety.blocksAdvancement);
  for (const state of [true, null, 'missing']) {
    const other = packet();
    if (state === 'missing') other.judgmentsA.shift(); else other.judgmentsA[0].severeError = state;
    const unknown = aggregateDevelopmentJudgments(other);
    assert.equal(unknown.arms.baseline.severeUnknown, 1); assert.ok(unknown.safety.unknown);
  }
});

test('duplicate/foreign identities, invalid counts and failures cannot corrupt denominators', () => {
  for (const mutate of [
    value => value.observations.push(structuredClone(value.observations[0])),
    value => { value.observations[0].id = 'D25'; },
    value => { value.observations[0].family = 'wrong'; },
    value => { value.observations[0].arms.extra = { status: 'completed' }; },
    value => { value.observations[0].capture.status = 'failed'; },
    value => { value.judgmentsA[1] = structuredClone(value.judgmentsA[0]); },
    value => { value.judgmentsA[0].id = 'D00'; },
    value => { value.judgmentsA[0].arm = 'full-label'; },
    value => { value.judgmentsA[0].verdict = 'passed'; },
    value => { value.judgmentsA[0].reviewedClaims = -1; },
    value => { value.judgmentsA[0].unsupportedClaims = 3; },
    value => { value.judgmentsA[0].staleClaims = 0.5; },
    value => { value.judgmentsA[0].severeError = 'false'; },
    value => { value.judgmentsA[0].rationale = ''; },
    value => { value.judgmentsA[0].gold = 'unexpected'; },
    value => { value.judgmentsA[0].reviewedClaims = Number.MAX_SAFE_INTEGER; },
  ]) {
    const value = packet(); mutate(value);
    assert.throws(() => aggregateDevelopmentJudgments(value), TypeError);
  }
});

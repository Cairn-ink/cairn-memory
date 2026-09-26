import assert from 'node:assert/strict';
import test from 'node:test';

import { createQualifiedSourcePairPhaseQuota } from '../qualified-source-pair-phase-quota.mjs';
import { ExperimentRequestGuardError } from '../../experiment-budget/request-guard.mjs';
import { benchmarkStagePolicy } from '../public-pilot.mjs';
import { experimentPolicy } from '../session.mjs';

const caps = () => ({ generation: { requests: 3, reservedMicroUsd: 60_820 },
  scoring: { requests: 1, reservedMicroUsd: 10_400 } });

function fixture() {
  const policy = experimentPolicy();
  const stages = benchmarkStagePolicy();
  const calls = [];
  let stateError = false;
  let halted = false;
  const guard = { policy, stages, qualifiedSourcePairCapability: {},
    cairnFetch(url) { calls.push(['cairn', url]); return Promise.resolve('cairn'); },
    answerFetch(url) { calls.push(['answer', url]); return Promise.resolve('answer'); },
    judgeFetch(url) { calls.push(['judge', url]); return Promise.resolve('judge'); },
    withCaseScope(identity, operation) { return operation({ snapshot: () => identity }); },
    isHalted() { return halted; },
    getState() { if (stateError) throw new Error('state failed'); return { state: 'open' }; } };
  return { guard, policy, stages, calls, setStateError: () => { stateError = true; },
    haltGuard: () => { halted = true; } };
}

test('L2 route-derived phases predebit exact reservation and block at both ceilings', async () => {
  const f = fixture();
  const quota = createQualifiedSourcePairPhaseQuota({ guard: f.guard, policy: f.policy,
    stages: f.stages, phaseCaps: caps() });
  assert.equal(await quota.cairnFetch(f.policy.cairnCount.endpoint, {}), 'cairn');
  assert.equal(await quota.cairnFetch(f.policy.cairnGeneration.endpoint, {}), 'cairn');
  assert.equal(await quota.answerFetch(f.stages.answer.endpoint, {}), 'answer');
  assert.equal(await quota.judgeFetch(f.stages.judge.endpoint, {}), 'judge');
  assert.deepEqual(quota.snapshot().used, { generation: { requests: 3, reservedMicroUsd: 60_820 },
    scoring: { requests: 1, reservedMicroUsd: 10_400 } });
  assert.deepEqual(f.calls.map(([name]) => name), ['cairn', 'cairn', 'answer', 'judge']);
  assert.throws(() => quota.judgeFetch(f.stages.judge.endpoint, {}), /phase_cap_exceeded/);
  assert.equal(quota.execution.isHalted(), true);
  assert.equal(f.calls.length, 4);
  assert.deepEqual(quota.snapshot().used.scoring, { requests: 1, reservedMicroUsd: 10_400 });
});

test('L2 denied G dispatch retains shadow debit and latches nondeadline failure', async () => {
  const f = fixture();
  f.guard.cairnFetch = () => { throw new Error('guard rejected before reserve'); };
  const quota = createQualifiedSourcePairPhaseQuota({ guard: f.guard, policy: f.policy,
    stages: f.stages, phaseCaps: caps() });
  assert.throws(() => quota.cairnFetch(f.policy.cairnCount.endpoint, {}), /guard rejected/);
  assert.deepEqual(quota.snapshot().used.generation, { requests: 1, reservedMicroUsd: 5_000 });
  assert.equal(f.calls.length, 0);
  assert.equal(quota.execution.isHalted(), true);
  const asynchronous = fixture();
  asynchronous.guard.answerFetch = async () => { throw new Error('async refusal'); };
  const asyncQuota = createQualifiedSourcePairPhaseQuota({ guard: asynchronous.guard,
    policy: asynchronous.policy, stages: asynchronous.stages, phaseCaps: caps() });
  await assert.rejects(asyncQuota.answerFetch(asynchronous.stages.answer.endpoint, {}), /async refusal/);
  assert.equal(asyncQuota.execution.isHalted(), true);
  assert.deepEqual(asyncQuota.snapshot().used.generation,
    { requests: 1, reservedMicroUsd: 50_820 });
});

test('L2 overlapping calls debit synchronously; unknown route and state failure latch globally', () => {
  const f = fixture();
  const quota = createQualifiedSourcePairPhaseQuota({ guard: f.guard, policy: f.policy,
    stages: f.stages, phaseCaps: { generation: { requests: 1, reservedMicroUsd: 5_000 },
      scoring: { requests: 0, reservedMicroUsd: 0 } } });
  const first = quota.cairnFetch(f.policy.cairnCount.endpoint, {});
  assert.throws(() => quota.cairnFetch(f.policy.cairnCount.endpoint, {}), /phase_cap_exceeded/);
  assert.equal(f.calls.length, 1);
  assert.equal(quota.execution.isHalted(), true);
  assert.equal(first instanceof Promise, true);
  const wrong = fixture();
  const wrongQuota = createQualifiedSourcePairPhaseQuota({ guard: wrong.guard,
    policy: wrong.policy, stages: wrong.stages, phaseCaps: caps() });
  assert.throws(() => wrongQuota.cairnFetch('https://api.openai.com/v1/chat/completions', {}), /route_invalid/);
  assert.equal(wrongQuota.snapshot().used.generation.requests, 0);
  assert.equal(wrong.calls.length, 0);
  const broken = fixture();
  const brokenQuota = createQualifiedSourcePairPhaseQuota({ guard: broken.guard,
    policy: broken.policy, stages: broken.stages, phaseCaps: caps() });
  broken.setStateError();
  assert.throws(() => brokenQuota.answerFetch(broken.stages.answer.endpoint, {}), /guard_state_failed/);
  assert.equal(brokenQuota.execution.isHalted(), true);
  assert.equal(broken.calls.length, 0);
});

test('L2 guard-local halt is observed without rewriting a recognized local deadline', () => {
  const f = fixture();
  f.guard.answerFetch = () => { throw new ExperimentRequestGuardError('case_deadline_exceeded'); };
  const quota = createQualifiedSourcePairPhaseQuota({ guard: f.guard, policy: f.policy,
    stages: f.stages, phaseCaps: caps() });
  // A recognized G deadline can leave G unhalted and permit the next slot.
  assert.throws(() => quota.answerFetch(f.stages.answer.endpoint, {}), /case_deadline_exceeded/);
  assert.equal(quota.execution.isHalted(), false);
  f.haltGuard();
  assert.equal(quota.execution.isHalted(), true);
  assert.throws(() => quota.answerFetch(f.stages.answer.endpoint, {}), /paid_work_halted/);
  assert.equal(f.calls.length, 0);
});

import assert from 'node:assert/strict';
import test from 'node:test';

import { runLongMemEvalComparison } from '../comparison.mjs';
import { LongMemEvalScoringError, scoreLongMemEvalComparison } from '../scoring.mjs';
import { opaqueQuestionId, stableTurnId } from '../prepare.mjs';

const sourceQuestionId = 'scoring-synthetic-case';
const questionId = opaqueQuestionId(sourceQuestionId);
const namespace = { ownerId: 'scoring-tests', scope: 'project', projectId: questionId };
const history = { question_id: questionId, sessions: [
  { session_index: 0, session_id: 'answer-session', date: 'Tuesday', turns: [
    { turn_id: stableTurnId(sourceQuestionId, 0, 'answer-session', 0), role: 'user',
      content: 'The launch color is amber.' },
  ] },
  { session_index: 1, session_id: 'distractor-session', date: 'Friday', turns: [
    { turn_id: stableTurnId(sourceQuestionId, 1, 'distractor-session', 0), role: 'assistant',
      content: 'The mascot is a cairn.' },
  ] },
] };
const question = { question_id: questionId, text: 'What is the launch color?', date: 'Saturday' };
const limits = { evidenceTokens: 20_000, requestTokens: 30_000, outputTokens: 100,
  answerTimeoutMs: 100, recallLimit: 6, lexicalLimit: 20 };
const core = {
  list: () => ({ ok: true, value: { memories: [], nextCursor: null, exhausted: true } }),
  capture: async () => ({ ok: true, value: { duplicate: false,
    admission: { memories: [], suppressedCount: 0, indexRevision: 1 },
    classification: { status: 'skipped', reason: 'empty' } } }),
  recall: async () => ({ ok: true, value: { memories: [], namespaces: [
    { namespace: { ...namespace }, mapExhausted: true, fetchExhausted: true },
  ], coverage: 'complete' } }),
};

const evaluator = (overrides = {}) => ({ question_id: questionId, source_question_id: sourceQuestionId,
  question_type: 'single-session-user', reference_answer: 'amber',
  answer_session_ids: ['answer-session'],
  turn_labels: [{ turn_id: history.sessions[0].turns[0].turn_id, has_answer: true }],
  ...overrides });

const makeRun = (overrides = {}) => runLongMemEvalComparison({ history: structuredClone(history),
  question: { ...question }, namespace: { ...namespace }, core,
  answer: async ({ request }) => ({ text: request.evidence.some((item) => item.text.includes('amber'))
    ? '  AMBER  ' : '' }),
  countTokens: (text) => text.length, answerModel: 'scripted-answer-v1', limits,
  ...overrides });

test('C05/C06: exact diagnostic, reference-session coverage and denominators stay separate', async () => {
  const run = await makeRun();
  const result = await scoreLongMemEvalComparison({ run, evaluator: evaluator() });
  assert.deepEqual(result.arms.map((arm) => [arm.name,
    arm.normalizedExactMatchDiagnostic.status,
    arm.normalizedExactMatchDiagnostic.value]), [
    ['cairn', 'scored', false], ['lexical', 'scored', true], ['no-memory', 'scored', false],
  ]);
  assert.deepEqual(result.arms[1].referenceSessionEvidenceCoverage.retrieved,
    { numerator: 1, denominator: 1, rate: 1 });
  assert.deepEqual(result.arms[1].referenceSessionEvidenceCoverage.packed,
    { numerator: 1, denominator: 1, rate: 1 });
  assert.deepEqual(result.arms[2].referenceSessionEvidenceCoverage.packed,
    { numerator: 0, denominator: 1, rate: 0 });
  assert.equal(result.denominators.attemptedArms, 3);
  assert.equal(result.denominators.completedArms, 3);
  assert.equal(result.denominators.exactMatchScoredArms, 3);
  assert.equal(result.denominators.exactMatchCorrectArms, 1);
  assert.equal(result.judge.requested, false);
});

test('C05/C07: changing generated answer or composite array reference changes the diagnostic', async () => {
  const run = await makeRun();
  const altered = structuredClone(run);
  altered.arms.find((arm) => arm.name === 'lexical').answer.text = 'blue';
  const changedAnswer = await scoreLongMemEvalComparison({ run: altered, evaluator: evaluator() });
  assert.equal(changedAnswer.denominators.exactMatchCorrectArms, 0);

  const arrayReference = await scoreLongMemEvalComparison({ run,
    evaluator: evaluator({ reference_answer: ['amber', 'gold'] }) });
  assert.deepEqual(arrayReference.referenceSerialization, {
    kind: 'json-array-single-reference', value: '["amber","gold"]',
  });
  assert.equal(arrayReference.denominators.exactMatchCorrectArms, 0);
});

test('C05/C07: mismatched, poisoned and unknown evaluator identities are rejected', async () => {
  const run = await makeRun();
  for (const invalid of [
    evaluator({ source_question_id: 'different-source' }),
    evaluator({ answer_session_ids: ['unknown-session'] }),
    evaluator({ turn_labels: [{ turn_id: 'unknown-turn', has_answer: true }] }),
    { ...evaluator(), answer_prompt: 'poison' },
  ]) {
    await assert.rejects(scoreLongMemEvalComparison({ run, evaluator: invalid }),
      LongMemEvalScoringError);
  }

  const ambiguous = structuredClone(run);
  ambiguous.sourceCatalog[1].sessionId = 'answer-session';
  for (const arm of ambiguous.arms) {
    if (arm.retrieval) arm.retrieval.sourceSessionIds = arm.retrieval.sourceSessionIds
      .map((id) => id === 'distractor-session' ? 'answer-session' : id)
      .filter((id, index, all) => all.indexOf(id) === index);
    if (arm.packing) {
      for (const evidence of arm.packing.selectedEvidence) {
        if (evidence.source.sessionIndex === 1) evidence.source.sessionId = 'answer-session';
      }
      arm.packing.selectedSourceSessionIds = arm.packing.selectedSourceSessionIds
        .map((id) => id === 'distractor-session' ? 'answer-session' : id)
        .filter((id, index, all) => all.indexOf(id) === index);
    }
  }
  await assert.rejects(scoreLongMemEvalComparison({ run: ambiguous, evaluator: evaluator() }),
    { code: 'invalid_evaluator' });
});

test('C05/C06/C07: missing evidence labels are null and failed generation is unscored', async () => {
  const failedRun = await makeRun({ answer: async ({ request }) => request.evidence.length
    ? (() => { throw new Error('answer failed'); })() : ({ text: '' }) });
  const result = await scoreLongMemEvalComparison({ run: failedRun,
    evaluator: evaluator({ answer_session_ids: [], turn_labels: [] }) });
  assert.ok(result.arms.every((arm) => arm.referenceSessionEvidenceCoverage.retrieved === null));
  const lexical = result.arms.find((arm) => arm.name === 'lexical');
  assert.deepEqual(lexical.normalizedExactMatchDiagnostic,
    { status: 'unscored', reason: 'arm_failed' });
  assert.equal(result.denominators.completedArms, 2);
  assert.equal(result.denominators.failedArms, 1);
});

test('C05/C07: judge correct/unknown/failure outcomes remain explicit and answer-blind', async () => {
  const run = await makeRun();
  const seen = [];
  const result = await scoreLongMemEvalComparison({ run, evaluator: evaluator(),
    judgeModel: 'scripted-judge-v1', judgeTimeoutMs: 100,
    judge: async ({ input }) => {
      seen.push(structuredClone(input));
      if (input.generatedAnswer.trim().toLowerCase() === 'amber') return { verdict: 'correct' };
      if (seen.length === 1) return { verdict: 'unknown' };
      throw new Error('private judge failure');
    } });
  assert.deepEqual(result.arms.map((arm) => arm.semanticJudge.status),
    ['unscored', 'scored', 'unscored']);
  assert.equal(result.arms[0].semanticJudge.reason, 'judge_unknown');
  assert.equal(result.arms[2].semanticJudge.reason, 'judge_failed');
  assert.equal(result.denominators.semanticJudgeAttemptedArms, 3);
  assert.equal(result.denominators.semanticJudgeScoredArms, 1);
  assert.ok(seen.every((input) => Object.keys(input).sort().join(',')
    === 'generatedAnswer,question,reference'));
  assert.ok(!JSON.stringify(result).includes('private judge failure'));
});

test('C05/C07: judge timeout and mutation after scoring starts cannot rewrite inputs or identity', async () => {
  const run = await makeRun();
  let first;
  const started = new Promise((resolve) => { first = resolve; });
  const inputEvaluator = evaluator();
  const options = { run, evaluator: inputEvaluator, judgeModel: 'fixed-judge-v1', judgeTimeoutMs: 5,
    judge: async ({ signal }) => { first(); return new Promise((resolve, reject) => {
      signal.addEventListener('abort', () => reject(Object.assign(new Error(), { name: 'AbortError' })));
    }); } };
  const pending = scoreLongMemEvalComparison(options);
  await started;
  inputEvaluator.reference_answer = 'mutated';
  options.judgeModel = 'mutated-judge';
  const result = await pending;
  assert.equal(result.judge.identity, 'fixed-judge-v1');
  assert.ok(result.arms.every((arm) => arm.semanticJudge.reason === 'judge_timeout'));
});

test('C05/C07: malformed or forged run arms and no-memory evidence are rejected', async () => {
  const run = await makeRun();
  const invalidRuns = [];
  const duplicate = structuredClone(run);
  duplicate.arms.push(structuredClone(duplicate.arms[0]));
  invalidRuns.push(duplicate);
  const renamed = structuredClone(run);
  renamed.arms[0].name = 'oracle-memory';
  invalidRuns.push(renamed);
  const injected = structuredClone(run);
  const noMemory = injected.arms.find((arm) => arm.name === 'no-memory');
  noMemory.packing.selectedEvidence.push(structuredClone(
    injected.arms.find((arm) => arm.name === 'lexical').packing.selectedEvidence[0]));
  invalidRuns.push(injected);
  for (const invalid of invalidRuns) {
    await assert.rejects(scoreLongMemEvalComparison({ run: invalid, evaluator: evaluator() }),
      { code: 'invalid_run' });
  }

  const dirtyCore = { ...core, list: () => ({ ok: true, value: {
    memories: [{ id: 'preexisting' }], nextCursor: null, exhausted: true,
  } }) };
  const blocked = await makeRun({ core: dirtyCore });
  const missingTopFlag = structuredClone(blocked);
  missingTopFlag.blockingFlags = [];
  await assert.rejects(scoreLongMemEvalComparison({ run: missingTopFlag, evaluator: evaluator() }),
    { code: 'invalid_run' });
});

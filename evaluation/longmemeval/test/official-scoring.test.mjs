import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import { opaqueQuestionId, opaqueSessionId } from '../prepare.mjs';
import { aggregateOfficialScores, OFFICIAL_JUDGE_MODEL, officialJudgeRequest,
  officialPrompt, parseOfficialJudgeText, scorePublicComparison } from '../official-scoring.mjs';

const fixtures = JSON.parse(readFileSync(new URL('../fixtures/upstream-prompts.json', import.meta.url), 'utf8'));
const sourceQuestionId = 'official-synthetic_abs_case';
const questionId = opaqueQuestionId(sourceQuestionId);
const evaluator = (reference = 'Kyoto') => ({ question_id: questionId,
  source_question_id: sourceQuestionId, question_type: 'single-session-user',
  reference_answer: reference, answer_session_ids: [], turn_labels: [] });
const run = () => ({ schemaVersion: 'cairn-longmemeval-public-comparison-v1', questionId,
  question: { text: 'Where?', date: 'Tuesday' }, answerModel: 'scripted-v1',
  arms: ['cairn', 'full-history', 'no-memory'].map((name) => ({ name,
    status: 'completed', reason: null, answer: { text: 'Kyoto', usage: null },
    diagnostics: { ignoredByJudge: true } })) });

test('OS1: exact prompt bytes come from AST-extracted pinned upstream function', () => {
  assert.equal(fixtures.length, 8);
  for (const fixture of fixtures) assert.equal(officialPrompt(fixture), fixture.prompt);
  assert.deepEqual(officialJudgeRequest('prompt'), { model: OFFICIAL_JUDGE_MODEL,
    messages: [{ role: 'user', content: 'prompt' }], n: 1, temperature: 0, max_tokens: 10 });
  assert.equal(parseOfficialJudgeText('yesterday'), true);
  assert.equal(parseOfficialJudgeText('NO'), false);
});

test('OS2/OS3: string reference only; failed and blocked arms never call judge', async () => {
  const candidate = run();
  candidate.arms[1] = { ...candidate.arms[1], status: 'failed', reason: 'answer_failed', answer: null };
  candidate.arms[2] = { ...candidate.arms[2], status: 'blocked', reason: 'context_overflow', answer: null };
  const requests = [];
  const result = await scorePublicComparison({ run: candidate, evaluator: evaluator(),
    judge: async ({ request }) => { requests.push(request); return { text: 'yesterday' }; } });
  assert.equal(requests.length, 1);
  assert.equal(requests[0].messages[0].content, fixtures[6].prompt.replace('What secret?', 'Where?')
    .replace('Not stated', 'Kyoto').replace('unknown', 'Kyoto'));
  assert.deepEqual(result.arms.map((arm) => [arm.judgment.status, arm.judgment.correct,
    arm.judgment.stage]), [['resolved', true, null], ['unresolved', null, 'generation'],
    ['unresolved', null, 'generation']]);
  assert.equal(result.abstention, true);
  for (const reference of [12, [12, 'Kyoto']]) {
    let called = false;
    const score = await scorePublicComparison({ run: run(), evaluator: evaluator(reference),
      judge: async () => { called = true; return { text: 'yes' }; } });
    assert.equal(called, false);
    assert.ok(score.arms.every((arm) => arm.judgment.reason === 'reference_serialization_unverified'));
  }
});

test('OS3: all input is validated before first judge call and snapshots are immutable', async () => {
  let calls = 0;
  const bad = run();
  bad.arms[2].status = 'failed';
  await assert.rejects(scorePublicComparison({ run: bad, evaluator: evaluator(),
    judge: async () => { calls += 1; return { text: 'yes' }; } }), { code: 'invalid_run' });
  const mismatched = evaluator();
  mismatched.source_question_id = 'different';
  await assert.rejects(scorePublicComparison({ run: run(), evaluator: mismatched,
    judge: async () => { calls += 1; return { text: 'yes' }; } }), { code: 'evaluator_mismatch' });
  assert.equal(calls, 0);

  const candidate = run();
  const source = evaluator();
  const pending = scorePublicComparison({ run: candidate, evaluator: source,
    judge: async ({ request }) => {
      assert.equal(Object.isFrozen(request), true);
      assert.equal(Object.isFrozen(request.messages[0]), true);
      candidate.question.text = 'tampered';
      source.reference_answer = 'tampered';
      assert.ok(request.messages[0].content.includes('Question: Where?'));
      assert.ok(request.messages[0].content.includes('Explanation: Kyoto'));
      return { text: 'yes' };
    } });
  const result = await pending;
  assert.equal(result.arms.length, 3);
  assert.equal(Object.isFrozen(result.arms[0].judgment), true);
});

test('OS3: transport failure, invalid response, and timeout stay unresolved', async () => {
  for (const [judge, reason] of [
    [async () => { throw new Error('private detail'); }, 'judge_failed'],
    [async () => ({ verdict: 'yes' }), 'invalid_judge_response'],
    [async () => ({ text: 'yes', error: 'transport_failed' }), 'invalid_judge_response'],
    [async ({ signal }) => new Promise((resolve) => signal.addEventListener('abort',
      () => resolve({ text: 'yes' }))), 'judge_timeout'],
  ]) {
    const score = await scorePublicComparison({ run: run(), evaluator: evaluator(),
      judge, judgeTimeoutMs: 5 });
    assert.equal(score.arms[0].judgment.reason, reason);
    assert.ok(score.arms.slice(1).every((arm) => arm.judgment.reason === (reason === 'judge_timeout'
      ? 'prior_judge_timeout' : reason)));
    assert.equal(JSON.stringify(score).includes('private detail'), false);
  }
});

test('OS3: ignored abort still permits only one judge callback after timeout', async () => {
  let calls = 0;
  const score = await scorePublicComparison({ run: run(), evaluator: evaluator(),
    judgeTimeoutMs: 5, judge: async () => { calls += 1; return new Promise(() => {}); } });
  assert.equal(calls, 1);
  assert.deepEqual(score.arms.map((arm) => arm.judgment.reason),
    ['judge_timeout', 'prior_judge_timeout', 'prior_judge_timeout']);
  assert.deepEqual(score.arms.map((arm) => arm.judgment.attempted), [true, false, false]);
});

test('OS3: optional opaque retrieval coverage is distinct from judge request', async () => {
  const candidate = run();
  const source = evaluator();
  const first = opaqueSessionId(sourceQuestionId, 0);
  const second = opaqueSessionId(sourceQuestionId, 1);
  source.answer_session_ids = [first, second];
  candidate.arms[0].diagnostics.retrieval = { retrievedSessionIds: [first], packedSessionIds: [] };
  candidate.arms[1].diagnostics.retrieval = { retrievedSessionIds: [first, second],
    packedSessionIds: [first, second] };
  candidate.arms[2].diagnostics.retrieval = { retrievedSessionIds: [], packedSessionIds: [] };
  const requests = [];
  const score = await scorePublicComparison({ run: candidate, evaluator: source,
    judge: async ({ request }) => { requests.push(request); return { text: 'no' }; } });
  assert.deepEqual(score.arms.map((arm) => arm.referenceSessionCoverage), [
    { retrieved: { numerator: 1, denominator: 2, rate: 0.5 },
      packed: { numerator: 0, denominator: 2, rate: 0 } },
    { retrieved: { numerator: 2, denominator: 2, rate: 1 },
      packed: { numerator: 2, denominator: 2, rate: 1 } },
    { retrieved: { numerator: 0, denominator: 2, rate: 0 },
      packed: { numerator: 0, denominator: 2, rate: 0 } },
  ]);
  assert.ok(requests.every((request) => !JSON.stringify(request).includes(first)));
  candidate.arms[0].diagnostics.retrieval.packedSessionIds = [second];
  await assert.rejects(scorePublicComparison({ run: candidate, evaluator: source,
    judge: async () => ({ text: 'yes' }) }), { code: 'invalid_run' });
});

test('OS4: fixed roster retains omitted cases, type and abstention denominators', async () => {
  const scored = await scorePublicComparison({ run: run(), evaluator: evaluator(),
    judge: async () => ({ text: 'yes' }) });
  const missingSource = 'another-case';
  const roster = [
    { questionId, sourceQuestionId, questionType: 'single-session-user' },
    { questionId: opaqueQuestionId(missingSource), sourceQuestionId: missingSource,
      questionType: 'multi-session' },
  ];
  const summary = aggregateOfficialScores({ roster, records: [scored] });
  const cairn = summary.arms.cairn;
  assert.deepEqual([cairn.overall.fixedN, cairn.overall.resolved, cairn.overall.correct,
    cairn.overall.unresolved, cairn.overall.accuracy, cairn.overall.coverage], [2, 1, 1, 1, 1, 0.5]);
  assert.deepEqual(cairn.overall.fixedNBounds, { lower: 0.5, upper: 1 });
  assert.equal(cairn.perType['multi-session'].reasonCounts.missing_scoring_record, 1);
  assert.equal(cairn.abstentionOverlay.fixedN, 1);
  assert.equal(summary.completeVerifiedOfficialStyle, false);
  assert.equal(cairn.perType['knowledge-update'].accuracy, null);
  assert.throws(() => aggregateOfficialScores({ roster, records: [scored, scored] }),
    { code: 'invalid_records' });
  assert.throws(() => aggregateOfficialScores({ roster: [roster[0], roster[0]], records: [] }),
    { code: 'invalid_roster' });
  assert.throws(() => aggregateOfficialScores({ roster: [roster[1]], records: [scored] }),
    { code: 'invalid_records' });
  assert.throws(() => aggregateOfficialScores({ roster: [{ ...roster[0], questionType: 'multi-session' }],
    records: [scored] }), { code: 'record_mismatch' });
  const differentModel = structuredClone(scored);
  differentModel.questionId = roster[1].questionId;
  differentModel.sourceQuestionId = roster[1].sourceQuestionId;
  differentModel.questionType = roster[1].questionType;
  differentModel.abstention = false;
  differentModel.answerModel = 'other-model';
  assert.throws(() => aggregateOfficialScores({ roster, records: [scored, differentModel] }),
    { code: 'record_mismatch' });
  const hostile = structuredClone(scored);
  hostile.arms[0].judgment = { status: 'unresolved', correct: null, reason: '__proto__',
    stage: 'judge', attempted: true };
  const hostileSummary = aggregateOfficialScores({ roster: [roster[0]], records: [hostile] });
  assert.equal(Object.getPrototypeOf(hostileSummary.arms.cairn.overall.reasonCounts), null);
  assert.equal(hostileSummary.arms.cairn.overall.reasonCounts.__proto__, 1);
});

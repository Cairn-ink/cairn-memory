import { opaqueQuestionId } from './prepare.mjs';
import { createShapeValidators, deepFreeze, isPlainObject, validString } from './validation.mjs';

export const OFFICIAL_SCORING_SCHEMA_VERSION = 'cairn-longmemeval-official-scoring-v1';
export const OFFICIAL_JUDGE_MODEL = 'gpt-4o-2024-08-06';
export const OFFICIAL_UPSTREAM_COMMIT = '9e0b455f4ef0e2ab8f2e582289761153549043fc';
export const OFFICIAL_ARM_NAMES = Object.freeze(['cairn', 'full-history', 'no-memory']);
export const OFFICIAL_QUESTION_TYPES = Object.freeze(['single-session-user',
  'single-session-assistant', 'single-session-preference', 'temporal-reasoning',
  'knowledge-update', 'multi-session']);

const BASE = 'I will give you a question, a correct answer, and a response from a model. Please answer yes if the response contains the correct answer. Otherwise, answer no. If the response is equivalent to the correct answer or contains all the intermediate steps to get the correct answer, you should also answer yes. If the response only contains a subset of the information required by the answer, answer no. ';
const FIELDS = '\n\nQuestion: {}\n\nCorrect Answer: {}\n\nModel Response: {}\n\nIs the model response correct? Answer yes or no only.';
const ABSTENTION = 'I will give you an unanswerable question, an explanation, and a response from a model. Please answer yes if the model correctly identifies the question as unanswerable. The model could say that the information is incomplete, or some other information is given but the asked information is not.\n\nQuestion: {}\n\nExplanation: {}\n\nModel Response: {}\n\nDoes the model correctly identify the question as unanswerable? Answer yes or no only.';
const PREFERENCE = 'I will give you a question, a rubric for desired personalized response, and a response from a model. Please answer yes if the response satisfies the desired response. Otherwise, answer no. The model does not need to reflect all the points in the rubric. The response is correct as long as it recalls and utilizes the user\'s personal information correctly.\n\nQuestion: {}\n\nRubric: {}\n\nModel Response: {}\n\nIs the model response correct? Answer yes or no only.';
const UPDATE = 'I will give you a question, a correct answer, and a response from a model. Please answer yes if the response contains the correct answer. Otherwise, answer no. If the response contains some previous information along with an updated answer, the response should be considered as correct as long as the updated answer is the required answer.\n\nQuestion: {}\n\nCorrect Answer: {}\n\nModel Response: {}\n\nIs the model response correct? Answer yes or no only.';
const TEMPORAL = `${BASE}In addition, do not penalize off-by-one errors for the number of days. If the question asks for the number of days/weeks/months, etc., and the model makes off-by-one errors (e.g., predicting 19 days when the answer is 18), the model's response is still correct. ${FIELDS}`;

export class OfficialScoringError extends Error {
  constructor(code) {
    super(code);
    this.name = 'OfficialScoringError';
    this.code = code;
  }
}
const { fail, exactObject, denseArray } = createShapeValidators(OfficialScoringError);
const opaque = (id) => typeof id === 'string' && /^lme-case-[a-f0-9]{64}$/.test(id);
const opaqueSession = (id) => typeof id === 'string' && /^lme-session-[a-f0-9]{64}$/.test(id);
const opaqueTurn = (id) => typeof id === 'string' && /^lme-turn-[a-f0-9]{64}$/.test(id);
const questionType = (value) => OFFICIAL_QUESTION_TYPES.includes(value);
const snapshot = (value, code) => {
  try { return deepFreeze(structuredClone(value)); } catch { fail(code); }
};

// The pinned Python function uses str.format on a template containing three literal {} slots.
// Replacing each slot once also preserves braces in caller-provided strings.
export const officialPrompt = ({ questionType: type, question, reference, response, abstention }) => {
  if (!questionType(type) || ![question, reference, response].every((value) => typeof value === 'string')
    || typeof abstention !== 'boolean') fail('invalid_prompt_input');
  const template = abstention ? ABSTENTION
    : type === 'temporal-reasoning' ? TEMPORAL
      : type === 'knowledge-update' ? UPDATE
        : type === 'single-session-preference' ? PREFERENCE : BASE + FIELDS;
  let index = 0;
  const values = [question, reference, response];
  return template.replace(/\{\}/g, () => values[index++]);
};

export const officialJudgeRequest = (prompt) => {
  if (typeof prompt !== 'string') fail('invalid_prompt_input');
  return deepFreeze({ model: OFFICIAL_JUDGE_MODEL,
    messages: [{ role: 'user', content: prompt }], n: 1, temperature: 0, max_tokens: 10 });
};

// Intentionally odd upstream behavior: any case-insensitive substring "yes" is positive.
export const parseOfficialJudgeText = (text) => {
  if (typeof text !== 'string') fail('invalid_judge_response');
  return text.trim().toLowerCase().includes('yes');
};

const validateRun = (run) => {
  if (!isPlainObject(run) || run.schemaVersion !== 'cairn-longmemeval-public-comparison-v1'
    || !opaque(run.questionId) || !isPlainObject(run.question)
    || !validString(run.question.text) || !validString(run.question.date)
    || !validString(run.answerModel)) fail('invalid_run');
  denseArray(run.arms, 3, 'invalid_run');
  if (run.arms.length !== 3) fail('invalid_run');
  const names = new Set();
  for (const arm of run.arms) {
    if (!isPlainObject(arm) || !OFFICIAL_ARM_NAMES.includes(arm.name) || names.has(arm.name)
      || !['completed', 'failed', 'blocked'].includes(arm.status)
      || !(arm.reason === null || validString(arm.reason))) fail('invalid_run');
    names.add(arm.name);
    if (arm.status === 'completed') {
      if (arm.reason !== null || !isPlainObject(arm.answer) || typeof arm.answer.text !== 'string'
        || !Object.hasOwn(arm.answer, 'usage')) fail('invalid_run');
    } else if (arm.answer !== null || !validString(arm.reason)) fail('invalid_run');
    if (Object.hasOwn(arm, 'diagnostics')) {
      if (!isPlainObject(arm.diagnostics)) fail('invalid_run');
      if (Object.hasOwn(arm.diagnostics, 'retrieval') && arm.diagnostics.retrieval !== null) {
        const retrieval = arm.diagnostics.retrieval;
        if (!isPlainObject(retrieval)) fail('invalid_run');
        for (const key of ['retrievedSessionIds', 'packedSessionIds']) {
          denseArray(retrieval[key], 0, 'invalid_run');
          if (retrieval[key].some((id) => !opaqueSession(id))
            || new Set(retrieval[key]).size !== retrieval[key].length) fail('invalid_run');
        }
        if (retrieval.packedSessionIds.some((id) => !retrieval.retrievedSessionIds.includes(id))) fail('invalid_run');
      }
    }
  }
  if (OFFICIAL_ARM_NAMES.some((name) => !names.has(name))) fail('invalid_run');
};

const validateEvaluator = (evaluator, run) => {
  exactObject(evaluator, ['question_id', 'source_question_id', 'question_type',
    'reference_answer', 'answer_session_ids', 'turn_labels'], 'invalid_evaluator');
  if (evaluator.question_id !== run.questionId || !validString(evaluator.source_question_id)
    || opaqueQuestionId(evaluator.source_question_id) !== run.questionId
    || !questionType(evaluator.question_type)) fail('evaluator_mismatch');
  denseArray(evaluator.answer_session_ids, 0, 'invalid_evaluator');
  denseArray(evaluator.turn_labels, 0, 'invalid_evaluator');
  if (evaluator.answer_session_ids.some((id) => !opaqueSession(id))
    || new Set(evaluator.answer_session_ids).size !== evaluator.answer_session_ids.length) fail('invalid_evaluator');
  const turns = new Set();
  for (const label of evaluator.turn_labels) {
    exactObject(label, ['turn_id', 'has_answer'], 'invalid_evaluator');
    if (!opaqueTurn(label.turn_id) || turns.has(label.turn_id)
      || typeof label.has_answer !== 'boolean') fail('invalid_evaluator');
    turns.add(label.turn_id);
  }
  // Non-string references are valid prepared evaluator data but not verified Python lexemes.
  const reference = evaluator.reference_answer;
  if (!(typeof reference === 'string' || typeof reference === 'number' && Number.isFinite(reference)
    || Array.isArray(reference) && reference.length > 0
      && Object.keys(reference).length === reference.length && reference.every((item) =>
      typeof item === 'string' || typeof item === 'number' && Number.isFinite(item)))) fail('invalid_evaluator');
};

const unresolved = (name, generationStatus, reason, stage, attempted = false) => ({
  name, generationStatus, judgment: { status: 'unresolved', correct: null, reason, stage, attempted },
});
const coverage = (ids, references) => ({ numerator: references.filter((id) => ids.includes(id)).length,
  denominator: references.length,
  rate: references.length ? references.filter((id) => ids.includes(id)).length / references.length : null });
const referenceCoverage = (arm, evaluator) => {
  const retrieval = arm.diagnostics?.retrieval;
  if (!retrieval || evaluator.answer_session_ids.length === 0) return null;
  return { retrieved: coverage(retrieval.retrievedSessionIds, evaluator.answer_session_ids),
    packed: coverage(retrieval.packedSessionIds, evaluator.answer_session_ids) };
};

const judgeOnce = async (judge, request, timeoutMs) => {
  const controller = new AbortController();
  let timer;
  const timeout = new Promise((resolve) => { timer = setTimeout(() => {
    controller.abort();
    resolve({ kind: 'timeout' });
  }, timeoutMs); });
  const transport = Promise.resolve().then(() => judge({ request, signal: controller.signal }))
    .then((value) => ({ kind: 'response', value }), () => ({ kind: 'failure' }));
  try { return await Promise.race([transport, timeout]); }
  finally { clearTimeout(timer); }
};

export const scorePublicComparison = async ({ run, evaluator, judge, judgeTimeoutMs = 30_000 }) => {
  validateRun(run);
  validateEvaluator(evaluator, run);
  if (judge !== undefined && typeof judge !== 'function') fail('invalid_judge');
  if (!Number.isSafeInteger(judgeTimeoutMs) || judgeTimeoutMs < 1 || judgeTimeoutMs > 2_147_483_647) {
    fail('invalid_judge_timeout');
  }
  const fixedRun = snapshot(run, 'invalid_run');
  const fixedEvaluator = snapshot(evaluator, 'invalid_evaluator');
  const abstention = fixedEvaluator.source_question_id.includes('_abs');
  const verifiedReference = typeof fixedEvaluator.reference_answer === 'string';
  const arms = [];
  let priorJudgeTimeout = false;
  for (const name of OFFICIAL_ARM_NAMES) {
    const arm = fixedRun.arms.find((candidate) => candidate.name === name);
    const coverageResult = referenceCoverage(arm, fixedEvaluator);
    if (arm.status !== 'completed') {
      arms.push({ ...unresolved(name, arm.status, arm.reason, 'generation'),
        referenceSessionCoverage: coverageResult });
      continue;
    }
    if (!verifiedReference) {
      arms.push({ ...unresolved(name, arm.status, 'reference_serialization_unverified', 'compatibility'),
        referenceSessionCoverage: coverageResult });
      continue;
    }
    if (!judge) {
      arms.push({ ...unresolved(name, arm.status, 'judge_not_configured', 'judge'),
        referenceSessionCoverage: coverageResult });
      continue;
    }
    if (priorJudgeTimeout) {
      arms.push({ ...unresolved(name, arm.status, 'prior_judge_timeout', 'judge'),
        referenceSessionCoverage: coverageResult });
      continue;
    }
    const prompt = officialPrompt({ questionType: fixedEvaluator.question_type,
      question: fixedRun.question.text, reference: fixedEvaluator.reference_answer,
      response: arm.answer.text, abstention });
    const result = await judgeOnce(judge, officialJudgeRequest(prompt), judgeTimeoutMs);
    if (result.kind === 'timeout') {
      priorJudgeTimeout = true;
      arms.push({ ...unresolved(name, arm.status, 'judge_timeout', 'judge', true),
        referenceSessionCoverage: coverageResult });
    }
    else if (result.kind === 'failure') arms.push({ ...unresolved(name, arm.status, 'judge_failed', 'judge', true),
      referenceSessionCoverage: coverageResult });
    else if (!isPlainObject(result.value) || Object.keys(result.value).length !== 1
      || !Object.hasOwn(result.value, 'text') || typeof result.value.text !== 'string') {
      arms.push({ ...unresolved(name, arm.status, 'invalid_judge_response', 'judge', true),
        referenceSessionCoverage: coverageResult });
    } else {
      arms.push({ name, generationStatus: arm.status, judgment: { status: 'resolved',
        correct: parseOfficialJudgeText(result.value.text), reason: null, stage: null, attempted: true },
      referenceSessionCoverage: coverageResult });
    }
  }
  return deepFreeze({ schemaVersion: OFFICIAL_SCORING_SCHEMA_VERSION,
    questionId: fixedRun.questionId, sourceQuestionId: fixedEvaluator.source_question_id,
    questionType: fixedEvaluator.question_type, abstention, answerModel: fixedRun.answerModel,
    compatibility: { referenceSerialization: verifiedReference ? 'verified-string' : 'unverified-non-string',
      upstreamCommit: OFFICIAL_UPSTREAM_COMMIT,
      judgeRequest: { model: OFFICIAL_JUDGE_MODEL, n: 1, temperature: 0, max_tokens: 10 } }, arms });
};

const freshBucket = () => ({ fixedN: 0, resolved: 0, correct: 0, incorrect: 0,
  unresolved: 0, accuracy: null, coverage: 0, fixedNBounds: { lower: 0, upper: 1 },
  stageCounts: Object.create(null), reasonCounts: Object.create(null) });
const count = (bucket, arm) => {
  bucket.fixedN += 1;
  if (!arm) {
    bucket.unresolved += 1;
    bucket.stageCounts.missing = (bucket.stageCounts.missing ?? 0) + 1;
    bucket.reasonCounts.missing_scoring_record = (bucket.reasonCounts.missing_scoring_record ?? 0) + 1;
  } else if (arm.judgment.status === 'resolved') {
    bucket.resolved += 1;
    bucket[arm.judgment.correct ? 'correct' : 'incorrect'] += 1;
  } else {
    bucket.unresolved += 1;
    const { stage, reason } = arm.judgment;
    bucket.stageCounts[stage] = (bucket.stageCounts[stage] ?? 0) + 1;
    bucket.reasonCounts[reason] = (bucket.reasonCounts[reason] ?? 0) + 1;
  }
};
const finish = (bucket) => {
  bucket.accuracy = bucket.resolved ? bucket.correct / bucket.resolved : null;
  bucket.coverage = bucket.resolved / bucket.fixedN;
  bucket.fixedNBounds = { lower: bucket.correct / bucket.fixedN,
    upper: (bucket.correct + bucket.unresolved) / bucket.fixedN };
  return bucket;
};

export const aggregateOfficialScores = ({ roster, records }) => {
  denseArray(roster, 1, 'invalid_roster');
  denseArray(records, 0, 'invalid_records');
  const rosterMap = new Map();
  for (const item of roster) {
    exactObject(item, ['questionId', 'sourceQuestionId', 'questionType'], 'invalid_roster');
    if (!opaque(item.questionId) || !validString(item.sourceQuestionId)
      || opaqueQuestionId(item.sourceQuestionId) !== item.questionId
      || !questionType(item.questionType) || rosterMap.has(item.questionId)) fail('invalid_roster');
    rosterMap.set(item.questionId, item);
  }
  const recordMap = new Map();
  let answerModel;
  for (const record of records) {
    if (!isPlainObject(record) || record.schemaVersion !== OFFICIAL_SCORING_SCHEMA_VERSION
      || !rosterMap.has(record.questionId) || recordMap.has(record.questionId)) fail('invalid_records');
    const item = rosterMap.get(record.questionId);
    if (!validString(record.answerModel)) fail('invalid_records');
    if (answerModel !== undefined && record.answerModel !== answerModel) fail('record_mismatch');
    answerModel = record.answerModel;
    if (record.sourceQuestionId !== item.sourceQuestionId || record.questionType !== item.questionType
      || record.abstention !== item.sourceQuestionId.includes('_abs')
      || !isPlainObject(record.compatibility)
      || !['verified-string', 'unverified-non-string'].includes(record.compatibility.referenceSerialization)
      || record.compatibility.upstreamCommit !== OFFICIAL_UPSTREAM_COMMIT
      || !isPlainObject(record.compatibility.judgeRequest)
      || Object.keys(record.compatibility.judgeRequest).length !== 4
      || record.compatibility.judgeRequest.model !== OFFICIAL_JUDGE_MODEL
      || record.compatibility.judgeRequest.n !== 1
      || record.compatibility.judgeRequest.temperature !== 0
      || record.compatibility.judgeRequest.max_tokens !== 10) {
      fail('record_mismatch');
    }
    denseArray(record.arms, 3, 'invalid_records');
    if (record.arms.length !== 3 || record.arms.some((arm) => !isPlainObject(arm))
      || new Set(record.arms.map((arm) => arm.name)).size !== 3) fail('invalid_records');
    for (const arm of record.arms) {
      if (!isPlainObject(arm) || !OFFICIAL_ARM_NAMES.includes(arm.name)
        || !['completed', 'failed', 'blocked'].includes(arm.generationStatus)
        || !isPlainObject(arm.judgment) || !['resolved', 'unresolved'].includes(arm.judgment.status)
        || typeof arm.judgment.attempted !== 'boolean') fail('invalid_records');
      const { judgment } = arm;
      if (judgment.status === 'resolved') {
        if (arm.generationStatus !== 'completed' || typeof judgment.correct !== 'boolean'
          || judgment.reason !== null || judgment.stage !== null || !judgment.attempted
          || record.compatibility.referenceSerialization !== 'verified-string') fail('invalid_records');
      } else if (judgment.correct !== null || !validString(judgment.reason)
        || !['generation', 'compatibility', 'judge'].includes(judgment.stage)
        || (judgment.stage === 'generation' && (arm.generationStatus === 'completed' || judgment.attempted))
        || (judgment.stage !== 'generation' && arm.generationStatus !== 'completed')
        || (judgment.stage === 'compatibility' && (judgment.reason !== 'reference_serialization_unverified'
          || judgment.attempted || record.compatibility.referenceSerialization !== 'unverified-non-string'))
        || (judgment.stage === 'judge' && record.compatibility.referenceSerialization !== 'verified-string')) {
        fail('invalid_records');
      }
    }
    recordMap.set(record.questionId, record);
  }
  const byArm = {};
  for (const name of OFFICIAL_ARM_NAMES) {
    const overall = freshBucket();
    const perType = Object.fromEntries(OFFICIAL_QUESTION_TYPES.map((type) => [type, freshBucket()]));
    const abstentionOverlay = freshBucket();
    for (const item of rosterMap.values()) {
      const record = recordMap.get(item.questionId);
      const arm = record?.arms.find((candidate) => candidate.name === name);
      count(overall, arm);
      count(perType[item.questionType], arm);
      if (item.sourceQuestionId.includes('_abs')) count(abstentionOverlay, arm);
    }
    for (const bucket of Object.values(perType)) if (bucket.fixedN) finish(bucket);
    if (abstentionOverlay.fixedN) finish(abstentionOverlay);
    byArm[name] = { overall: finish(overall), perType,
      abstentionOverlay: abstentionOverlay.fixedN ? abstentionOverlay : null,
      macroSixTypeAccuracy: OFFICIAL_QUESTION_TYPES.every((type) => perType[type].fixedN > 0
        && perType[type].unresolved === 0)
        ? OFFICIAL_QUESTION_TYPES.reduce((sum, type) => sum + perType[type].accuracy, 0)
          / OFFICIAL_QUESTION_TYPES.length : null,
      completeVerifiedOfficialStyle: overall.unresolved === 0 };
  }
  return deepFreeze({ schemaVersion: OFFICIAL_SCORING_SCHEMA_VERSION,
    fixedCaseCount: roster.length, scoredRecordCount: records.length, arms: byArm,
    completeVerifiedOfficialStyle: Object.values(byArm).every((arm) => arm.completeVerifiedOfficialStyle) });
};

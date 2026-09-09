import {
  ANSWER_TEMPLATE_VERSION,
  COMPARISON_SCHEMA_VERSION,
} from './comparison.mjs';
import { opaqueQuestionId } from './prepare.mjs';
import { createShapeValidators, deepFreeze, isPlainObject, validString } from './validation.mjs';

export const SCORING_SCHEMA_VERSION = 'cairn-longmemeval-scoring-v1';

const ARM_NAMES = ['cairn', 'lexical', 'no-memory'];
const BASE_OPTION_KEYS = ['run', 'evaluator'];
const JUDGE_OPTION_KEYS = ['run', 'evaluator', 'judge', 'judgeModel', 'judgeTimeoutMs'];
const EVALUATOR_KEYS = ['question_id', 'source_question_id', 'question_type', 'reference_answer',
  'answer_session_ids', 'turn_labels'];
const TURN_LABEL_KEYS = ['turn_id', 'has_answer'];
const RUN_KEYS = ['schemaVersion', 'questionId', 'question', 'answerModel', 'templateVersion',
  'limits', 'sourceCatalog', 'arms', 'blockingFlags', 'latencyMs', 'interpretation'];
const EVIDENCE_KEYS = ['source', 'date', 'role', 'text'];
const SOURCE_KEYS = ['sessionId', 'sessionIndex', 'turnId', 'eventId'];
const LIMIT_KEYS = ['evidenceTokens', 'requestTokens', 'outputTokens', 'answerTimeoutMs',
  'recallLimit', 'lexicalLimit'];
const QUESTION_TYPES = new Set(['single-session-user', 'single-session-assistant',
  'single-session-preference', 'temporal-reasoning', 'knowledge-update', 'multi-session']);

export class LongMemEvalScoringError extends Error {
  constructor(code) {
    super(code);
    this.name = 'LongMemEvalScoringError';
    this.code = code;
  }
}

const { fail, exactObject, denseArray } = createShapeValidators(LongMemEvalScoringError);

const validateReference = (value) => {
  const scalar = (member) => typeof member === 'string'
    || (typeof member === 'number' && Number.isFinite(member));
  if (scalar(value)) return;
  if (Array.isArray(value) && value.length > 0 && Object.keys(value).length === value.length
    && value.every(scalar)) return;
  fail('invalid_evaluator');
};

const validateCatalog = (run) => {
  const sessions = denseArray(run.sourceCatalog, 1, 'invalid_run');
  const sessionCoordinates = new Set();
  const sessionIds = new Set();
  const sessionIdCounts = new Map();
  const turnIds = new Set();
  const turns = new Map();
  sessions.forEach((session, index) => {
    exactObject(session, ['sessionIndex', 'sessionId', 'date', 'turns'], 'invalid_run');
    if (session.sessionIndex !== index || !validString(session.sessionId) || !validString(session.date)) {
      fail('invalid_run');
    }
    const coordinate = JSON.stringify([session.sessionIndex, session.sessionId]);
    if (sessionCoordinates.has(coordinate)) fail('invalid_run');
    sessionCoordinates.add(coordinate);
    sessionIds.add(session.sessionId);
    sessionIdCounts.set(session.sessionId, (sessionIdCounts.get(session.sessionId) ?? 0) + 1);
    denseArray(session.turns, 1, 'invalid_run').forEach((turn) => {
      exactObject(turn, ['turnId', 'role'], 'invalid_run');
      if (!validString(turn.turnId) || turnIds.has(turn.turnId)
        || !['user', 'assistant'].includes(turn.role)) fail('invalid_run');
      turnIds.add(turn.turnId);
      turns.set(turn.turnId, { sessionId: session.sessionId, sessionIndex: session.sessionIndex,
        role: turn.role, date: session.date });
    });
  });
  return { sessionIds, sessionIdCounts, turnIds, turns };
};

const validateEvidence = (evidence, catalog) => {
  exactObject(evidence, EVIDENCE_KEYS, 'invalid_run');
  exactObject(evidence.source, SOURCE_KEYS, 'invalid_run');
  const source = catalog.turns.get(evidence.source.turnId);
  if (!source || evidence.source.sessionId !== source.sessionId
    || evidence.source.sessionIndex !== source.sessionIndex
    || evidence.date !== source.date || evidence.role !== source.role
    || !(evidence.source.eventId === null || validString(evidence.source.eventId))
    || typeof evidence.text !== 'string') fail('invalid_run');
};

const validateOmissions = (items) => {
  if (!Array.isArray(items)) fail('invalid_run');
  for (const item of items) {
    exactObject(item, ['candidateId', 'reason'], 'invalid_run');
    if (!validString(item.candidateId) || !validString(item.reason)) fail('invalid_run');
  }
};

const validateArm = (arm, catalog) => {
  if (!isPlainObject(arm) || !ARM_NAMES.includes(arm.name)
    || !['completed', 'failed'].includes(arm.status)
    || !Number.isSafeInteger(arm.latencyMs) || arm.latencyMs < 0
    || !Array.isArray(arm.blockingFlags)) fail('invalid_run');
  if (arm.status === 'completed') {
    const required = ['name', 'status', 'latencyMs', 'blockingFlags', 'retrieval', 'packing', 'answer'];
    exactObject(arm, required, 'invalid_run');
    if (!isPlainObject(arm.retrieval) || !isPlainObject(arm.packing) || !isPlainObject(arm.answer)
      || arm.answer.status !== 'completed' || typeof arm.answer.text !== 'string') fail('invalid_run');
  } else {
    const required = ['name', 'status', 'failedStage', 'latencyMs', 'error', 'blockingFlags',
      'retrieval', 'packing', 'answer'];
    exactObject(arm, required, 'invalid_run');
    if (!validString(arm.failedStage) || !isPlainObject(arm.error)) fail('invalid_run');
    exactObject(arm.error, ['code', 'retryable'], 'invalid_run');
    if (!validString(arm.error.code) || typeof arm.error.retryable !== 'boolean') fail('invalid_run');
    // Failed retrieval/packing is retained when work was attempted; it must never fabricate
    // a packed answer before the answer stage.
    if (arm.failedStage !== 'answer' && (arm.packing !== null || arm.answer !== null)) fail('invalid_run');
    if (arm.failedStage === 'answer' && (!isPlainObject(arm.retrieval)
      || !isPlainObject(arm.packing) || !isPlainObject(arm.answer)
      || arm.answer.status !== 'failed')) fail('invalid_run');
  }
  for (const flag of arm.blockingFlags) {
    if (!isPlainObject(flag) || !validString(flag.code)
      || Object.keys(flag).some((key) => !['code', 'memoryIndex', 'receiptIndex'].includes(key))
      || ['memoryIndex', 'receiptIndex'].some((key) => Object.hasOwn(flag, key)
        && (!Number.isSafeInteger(flag[key]) || flag[key] < 0))) fail('invalid_run');
  }
  if (arm.packing !== null) {
    exactObject(arm.packing, ['selectedEvidence', 'omitted', 'selectedSourceSessionIds',
      'evidenceTokens', 'requestTokens'], 'invalid_run');
    if (!Array.isArray(arm.packing.selectedEvidence) || !Array.isArray(arm.packing.omitted)
      || !Array.isArray(arm.packing.selectedSourceSessionIds)
      || !Number.isSafeInteger(arm.packing.evidenceTokens) || arm.packing.evidenceTokens < 0
      || !Number.isSafeInteger(arm.packing.requestTokens) || arm.packing.requestTokens < 0) fail('invalid_run');
    validateOmissions(arm.packing.omitted);
    arm.packing.selectedEvidence.forEach((evidence) => validateEvidence(evidence, catalog));
    const derived = [...new Set(arm.packing.selectedEvidence.map((evidence) => evidence.source.sessionId))];
    if (JSON.stringify(derived) !== JSON.stringify(arm.packing.selectedSourceSessionIds)) fail('invalid_run');
  }
  if (arm.retrieval !== null) {
    const allowed = ['status', 'latencyMs', 'coverage', 'candidateCount', 'omitted',
      'sourceSessionIds', 'ingestion', 'incompleteReceiptCount'];
    if (!isPlainObject(arm.retrieval)
      || Object.keys(arm.retrieval).some((key) => !allowed.includes(key))
      || ['status', 'latencyMs', 'coverage', 'candidateCount', 'omitted', 'sourceSessionIds']
        .some((key) => !Object.hasOwn(arm.retrieval, key))
      || !['completed', 'failed'].includes(arm.retrieval.status)
      || !Number.isSafeInteger(arm.retrieval.latencyMs) || arm.retrieval.latencyMs < 0
      || !(arm.retrieval.coverage === null || validString(arm.retrieval.coverage))
      || !Number.isSafeInteger(arm.retrieval.candidateCount) || arm.retrieval.candidateCount < 0
      || !Array.isArray(arm.retrieval.omitted) || !Array.isArray(arm.retrieval.sourceSessionIds)
      || arm.retrieval.sourceSessionIds.some((id) => !catalog.sessionIds.has(id))) fail('invalid_run');
    validateOmissions(arm.retrieval.omitted);
    if (Object.hasOwn(arm.retrieval, 'incompleteReceiptCount')
      && (!Number.isSafeInteger(arm.retrieval.incompleteReceiptCount)
        || arm.retrieval.incompleteReceiptCount < 0)) fail('invalid_run');
    if (Object.hasOwn(arm.retrieval, 'ingestion')) {
      const ingestion = arm.retrieval.ingestion;
      exactObject(ingestion, ['latencyMs', 'executable', 'outcomes'], 'invalid_run');
      if (!Number.isSafeInteger(ingestion.latencyMs) || ingestion.latencyMs < 0
        || typeof ingestion.executable !== 'boolean' || !Array.isArray(ingestion.outcomes)) fail('invalid_run');
      ingestion.outcomes.forEach((outcome) => {
        if (!isPlainObject(outcome) || ![3, 4].includes(Object.keys(outcome).length)
          || ['batchIndex', 'eventId', 'status'].some((key) => !Object.hasOwn(outcome, key))
          || Object.keys(outcome).some((key) => !['batchIndex', 'eventId', 'status', 'error'].includes(key))) {
          fail('invalid_run');
        }
        if (!Number.isSafeInteger(outcome.batchIndex) || outcome.batchIndex < 0
          || !validString(outcome.eventId) || !validString(outcome.status)) fail('invalid_run');
        if (Object.hasOwn(outcome, 'error')) {
          exactObject(outcome.error, ['code', 'retryable'], 'invalid_run');
          if (!validString(outcome.error.code) || typeof outcome.error.retryable !== 'boolean') fail('invalid_run');
        }
      });
    }
  }
  if (arm.answer !== null) {
    if (arm.answer.status === 'completed') {
      exactObject(arm.answer, ['status', 'latencyMs', 'text', 'countedOutputTokens', 'usage'], 'invalid_run');
      if (!Number.isSafeInteger(arm.answer.latencyMs) || arm.answer.latencyMs < 0
        || typeof arm.answer.text !== 'string' || !Number.isSafeInteger(arm.answer.countedOutputTokens)
        || arm.answer.countedOutputTokens < 0) fail('invalid_run');
      exactObject(arm.answer.usage, ['scope', 'inputTokens', 'outputTokens', 'costMicroUsd'], 'invalid_run');
      if (arm.answer.usage.scope !== 'answer-callback-reported'
        || !['inputTokens', 'outputTokens', 'costMicroUsd'].every((key) =>
          arm.answer.usage[key] === null
          || (Number.isSafeInteger(arm.answer.usage[key]) && arm.answer.usage[key] >= 0))) fail('invalid_run');
    } else {
      exactObject(arm.answer, ['status', 'latencyMs', 'error'], 'invalid_run');
      exactObject(arm.answer.error, ['code', 'retryable'], 'invalid_run');
      if (arm.answer.status !== 'failed' || !Number.isSafeInteger(arm.answer.latencyMs)
        || arm.answer.latencyMs < 0 || !validString(arm.answer.error.code)
        || typeof arm.answer.error.retryable !== 'boolean') fail('invalid_run');
    }
  }
  if (arm.name === 'no-memory' && (arm.retrieval === null
    || arm.retrieval.candidateCount !== 0 || arm.retrieval.omitted.length !== 0
    || arm.retrieval.sourceSessionIds.length !== 0 || arm.retrieval.coverage !== 'empty-baseline'
    || (arm.packing !== null && (arm.packing.selectedEvidence.length !== 0
      || arm.packing.selectedSourceSessionIds.length !== 0)))) {
    fail('invalid_run');
  }
};

const validateRun = (run) => {
  exactObject(run, RUN_KEYS, 'invalid_run');
  if (run.schemaVersion !== COMPARISON_SCHEMA_VERSION || !validString(run.questionId)
    || !isPlainObject(run.question) || !validString(run.question.text)
    || !validString(run.question.date) || Object.keys(run.question).length !== 2
    || !Object.hasOwn(run.question, 'text') || !Object.hasOwn(run.question, 'date')
    || !validString(run.answerModel) || run.templateVersion !== ANSWER_TEMPLATE_VERSION
    || !isPlainObject(run.limits) || !Array.isArray(run.blockingFlags)
    || !Number.isSafeInteger(run.latencyMs) || run.latencyMs < 0) fail('invalid_run');
  exactObject(run.limits, LIMIT_KEYS, 'invalid_run');
  if (LIMIT_KEYS.some((key) => !Number.isSafeInteger(run.limits[key]) || run.limits[key] <= 0)) fail('invalid_run');
  if (run.limits.recallLimit > 12 || run.limits.lexicalLimit > 100
    || run.limits.answerTimeoutMs > 2_147_483_647) fail('invalid_run');
  const catalog = validateCatalog(run);
  denseArray(run.arms, 3, 'invalid_run');
  if (run.arms.length !== 3) fail('invalid_run');
  run.arms.forEach((arm) => validateArm(arm, catalog));
  if (new Set(run.arms.map((arm) => arm.name)).size !== 3
    || ARM_NAMES.some((name) => !run.arms.some((arm) => arm.name === name))) fail('invalid_run');
  for (const flag of run.blockingFlags) {
    if (!isPlainObject(flag) || !ARM_NAMES.includes(flag.arm) || !validString(flag.code)
      || Object.keys(flag).some((key) => !['arm', 'code', 'memoryIndex', 'receiptIndex'].includes(key))) {
      fail('invalid_run');
    }
  }
  const derivedFlags = run.arms.flatMap((arm) => arm.blockingFlags
    .map((flag) => ({ arm: arm.name, ...flag })));
  if (JSON.stringify(run.blockingFlags) !== JSON.stringify(derivedFlags)) fail('invalid_run');
  return catalog;
};

const validateEvaluator = (evaluator, run, catalog) => {
  exactObject(evaluator, EVALUATOR_KEYS, 'invalid_evaluator');
  if (evaluator.question_id !== run.questionId || !validString(evaluator.source_question_id)
    || opaqueQuestionId(evaluator.source_question_id) !== run.questionId
    || !QUESTION_TYPES.has(evaluator.question_type)) fail('evaluator_mismatch');
  validateReference(evaluator.reference_answer);
  denseArray(evaluator.answer_session_ids, 0, 'invalid_evaluator');
  if (new Set(evaluator.answer_session_ids).size !== evaluator.answer_session_ids.length
    || evaluator.answer_session_ids.some((id) => !catalog.sessionIds.has(id)
      || catalog.sessionIdCounts.get(id) !== 1)) fail('invalid_evaluator');
  denseArray(evaluator.turn_labels, 0, 'invalid_evaluator');
  const labeled = new Set();
  for (const label of evaluator.turn_labels) {
    exactObject(label, TURN_LABEL_KEYS, 'invalid_evaluator');
    if (!catalog.turnIds.has(label.turn_id) || labeled.has(label.turn_id)
      || typeof label.has_answer !== 'boolean') fail('invalid_evaluator');
    labeled.add(label.turn_id);
  }
};

const serializeReference = (reference) => Array.isArray(reference)
  ? JSON.stringify(reference) : String(reference);
const normalizeExact = (value) => value.normalize('NFKC').trim()
  .replace(/\s+/gu, ' ').toLocaleLowerCase('und');
const coverage = (ids, labels) => {
  if (labels.length === 0) return null;
  const found = new Set(ids.filter((id) => labels.includes(id)));
  return { numerator: found.size, denominator: labels.length, rate: found.size / labels.length };
};
const elapsedMs = (started) => Math.max(0, Date.now() - started);

const callJudge = async ({ judge, judgeModel, judgeTimeoutMs }, input) => {
  const controller = new AbortController();
  const started = Date.now();
  let timer;
  try {
    const result = await Promise.race([
      Promise.resolve().then(() => judge({ model: judgeModel,
        input: structuredClone(input), signal: controller.signal })),
      new Promise((_, reject) => {
        timer = setTimeout(() => { controller.abort(); reject(new LongMemEvalScoringError('judge_timeout')); },
          judgeTimeoutMs);
      }),
    ]);
    if (!isPlainObject(result) || Object.keys(result).length !== 1
      || !Object.hasOwn(result, 'verdict')
      || !['correct', 'incorrect', 'unknown'].includes(result.verdict)) {
      return { status: 'unscored', reason: 'malformed_judge_response', latencyMs: elapsedMs(started) };
    }
    if (result.verdict === 'unknown') {
      return { status: 'unscored', reason: 'judge_unknown', latencyMs: elapsedMs(started) };
    }
    return { status: 'scored', value: result.verdict === 'correct', verdict: result.verdict,
      latencyMs: elapsedMs(started) };
  } catch (error) {
    return { status: 'unscored', reason: controller.signal.aborted ? 'judge_timeout'
      : error?.name === 'AbortError' ? 'judge_cancelled' : 'judge_failed',
    latencyMs: elapsedMs(started) };
  } finally { clearTimeout(timer); }
};

export async function scoreLongMemEvalComparison(options) {
  if (!isPlainObject(options)) fail('invalid_options');
  const keys = Object.keys(options);
  const judgeEnabled = keys.length === JUDGE_OPTION_KEYS.length
    && JUDGE_OPTION_KEYS.every((key) => Object.hasOwn(options, key));
  const base = keys.length === BASE_OPTION_KEYS.length
    && BASE_OPTION_KEYS.every((key) => Object.hasOwn(options, key));
  if (!base && !judgeEnabled) fail('invalid_options');
  if (keys.some((key) => !(judgeEnabled ? JUDGE_OPTION_KEYS : BASE_OPTION_KEYS).includes(key))) {
    fail('invalid_options');
  }
  if (judgeEnabled && (typeof options.judge !== 'function' || !validString(options.judgeModel)
    || !Number.isSafeInteger(options.judgeTimeoutMs) || options.judgeTimeoutMs <= 0
    || options.judgeTimeoutMs > 2_147_483_647)) fail('invalid_options');

  let run;
  let evaluator;
  try { run = structuredClone(options.run); evaluator = structuredClone(options.evaluator); }
  catch { fail('invalid_options'); }
  const judgeOptions = judgeEnabled ? { judge: options.judge, judgeModel: options.judgeModel,
    judgeTimeoutMs: options.judgeTimeoutMs } : null;
  const catalog = validateRun(run);
  validateEvaluator(evaluator, run, catalog);
  deepFreeze(run);
  deepFreeze(evaluator);

  const referenceSerialization = serializeReference(evaluator.reference_answer);
  const normalizedReference = normalizeExact(referenceSerialization);
  const arms = [];
  for (const name of ARM_NAMES) {
    const arm = run.arms.find((candidate) => candidate.name === name);
    const completed = arm.status === 'completed';
    const exact = completed
      ? { status: 'scored', value: arm.answer.text.trim().length > 0
        && normalizeExact(arm.answer.text) === normalizedReference }
      : { status: 'unscored', reason: 'arm_failed' };
    const semanticJudge = !judgeEnabled
      ? { status: 'not-requested' }
      : !completed ? { status: 'unscored', reason: 'arm_failed', latencyMs: 0 }
        : await callJudge(judgeOptions, { question: structuredClone(run.question),
          generatedAnswer: arm.answer.text, reference: structuredClone(evaluator.reference_answer) });
    arms.push({ name, generationStatus: arm.status,
      normalizedExactMatchDiagnostic: exact,
      referenceSessionEvidenceCoverage: {
        retrieved: arm.retrieval === null || arm.retrieval.status !== 'completed' ? null
          : coverage(arm.retrieval.sourceSessionIds, evaluator.answer_session_ids),
        packed: arm.packing === null ? null
          : coverage(arm.packing.selectedSourceSessionIds, evaluator.answer_session_ids),
      },
      semanticJudge });
  }
  const exactScored = arms.filter((arm) => arm.normalizedExactMatchDiagnostic.status === 'scored');
  const judged = arms.filter((arm) => arm.semanticJudge.status === 'scored');
  return deepFreeze({
    schemaVersion: SCORING_SCHEMA_VERSION,
    questionId: run.questionId,
    referenceSerialization: { kind: Array.isArray(evaluator.reference_answer)
      ? 'json-array-single-reference' : 'scalar-string', value: referenceSerialization },
    judge: judgeEnabled ? { requested: true, identity: judgeOptions.judgeModel }
      : { requested: false, identity: null },
    arms,
    denominators: {
      attemptedArms: 3,
      completedArms: run.arms.filter((arm) => arm.status === 'completed').length,
      failedArms: run.arms.filter((arm) => arm.status === 'failed').length,
      exactMatchScoredArms: exactScored.length,
      exactMatchCorrectArms: exactScored.filter((arm) => arm.normalizedExactMatchDiagnostic.value).length,
      semanticJudgeAttemptedArms: judgeEnabled
        ? run.arms.filter((arm) => arm.status === 'completed').length : 0,
      semanticJudgeScoredArms: judged.length,
      semanticJudgeCorrectArms: judged.filter((arm) => arm.semanticJudge.value).length,
    },
    blockingFlags: structuredClone(run.blockingFlags),
    interpretation: 'normalized-exact-match-diagnostic-and-optional-judge-not-official-longmemeval-accuracy',
  });
}

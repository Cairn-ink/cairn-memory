import { createHash } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';

import { OFFICIAL_JUDGE_MODEL, OFFICIAL_QUESTION_TYPES, OFFICIAL_UPSTREAM_COMMIT,
  officialJudgeRequest, officialPrompt, parseOfficialJudgeText } from './official-scoring.mjs';
import { opaqueQuestionId } from './prepare.mjs';
import { PUBLIC_ANSWER_TEMPLATE_VERSION_V2, QUALIFIED_SOURCE_PAIR_PROTOCOL_SCHEMA_VERSION,
  QUALIFIED_SOURCE_PAIR_SCHEMA_VERSION } from './public-comparison.mjs';
import { resolveReferenceRendering } from './reference-rendering.mjs';
import { createShapeValidators, deepFreeze, isPlainObject, validString } from './validation.mjs';

export const QUALIFIED_SOURCE_SCORING_SCHEMA_VERSION = 'cairn-longmemeval-qualified-source-scoring-v1';
export const QUALIFIED_SOURCE_AGGREGATE_SCHEMA_VERSION = 'cairn-longmemeval-qualified-source-aggregate-v1';
const SCORE_INTERPRETATION = 'qualified-source-pair-official-style-not-a-product-reliability-guarantee';
const AGGREGATE_INTERPRETATION =
  'qualified-source-pair-fixed-roster-accounting-not-a-competitive-or-product-reliability-claim';
const N_INTERPRETATION = 'offline-qualified-source-pair-generation-not-a-semantic-score-or-paid-grant';
const SOURCE_TIME_POLICY = 'source-date-metadata-only-capture-is-source-time-unaware';
const NAMES = ['qualified-prefix', 'indexed-windows'];
const HEX = /^[a-f0-9]{64}$/u;
const CASE_ID = /^lme-case-[a-f0-9]{64}$/u;
const SESSION_ID = /^lme-session-[a-f0-9]{64}$/u;
const TURN_ID = /^lme-turn-[a-f0-9]{64}$/u;
const HALT_REASONS = ['global_halt', 'scope_contract_invalid', 'scope_execution_failed'];
const SAFE_GENERATION_REASONS = new Set([
  'classification_failed', 'context_budget_exceeded', 'event_payload_conflict',
  'extraction_failed', 'index_revision_conflict', 'invalid_input', 'invalid_model_output',
  'model_cancelled', 'model_not_configured', 'model_timeout', 'recall_failed',
  'revision_conflict', 'stale_admission', 'storage_busy', 'storage_error',
  'token_count_unavailable', 'namespace_check_failed', 'namespace_not_pristine',
  'question_or_framing_too_large', 'ingestion_failed', 'ingestion_incomplete',
  'recall_threw', 'malformed_recall_response', 'invalid_recall_provenance',
  'source_get_failed', 'source_get_mismatch', 'duplicate_receipt',
  'unknown_or_mismatched_receipt', 'partial_receipts', 'context_window_exceeded',
  'malformed_answer_response', 'answer_output_too_large', 'answer_timeout',
  'answer_failed', 'case_timeout', 'arm_failed', ...HALT_REASONS,
]);
const JUDGE_REASONS = ['judge_not_configured', 'judge_timeout', 'judge_failed', 'invalid_judge_response'];
const EXECUTION_REASONS = ['generation_halted', 'case_timeout', ...HALT_REASONS];

export class QualifiedSourceScoringError extends Error {
  constructor(code) { super(code); this.name = 'QualifiedSourceScoringError'; this.code = code; }
}
const { fail, exactObject, denseArray } = createShapeValidators(QualifiedSourceScoringError);
const clone = (value, code) => { try { return structuredClone(value); } catch { fail(code); } };
const elapsed = (start) => Math.max(0, Date.now() - start);
const canonical = (value) => Array.isArray(value) ? value.map(canonical)
  : isPlainObject(value) ? Object.fromEntries(Object.keys(value).sort().map((key) =>
    [key, canonical(value[key])])) : value;
const hash = (domain, value) => createHash('sha256')
  .update(JSON.stringify([domain, canonical(value)]), 'utf8').digest('hex');
const sameKeys = (value, keys) => isPlainObject(value) && Object.keys(value).length === keys.length
  && keys.every((key) => Object.hasOwn(value, key));
const dense = (value, length) => Array.isArray(value) && value.length === length
  && Object.keys(value).length === length
  && Array.from({ length }, (_, index) => index).every((index) => Object.hasOwn(value, index));
const uniquePrefix = (value, order) => Array.isArray(value) && value.length <= order.length
  && dense(value, value.length)
  && value.every((name, index) => name === order[index]);
const nonnegative = (value) => Number.isSafeInteger(value) && value >= 0;
const ratio = (numerator, denominator) => denominator ? numerator / denominator : null;

function validateProtocol(protocol, code = 'invalid_protocol') {
  exactObject(protocol, ['schemaVersion', 'questionId', 'question', 'namespace', 'answerModel',
    'templateVersion', 'limits', 'armOrder', 'captureQualification', 'historyDigest',
    'sourceMapDigest', 'arms', 'digest'], code);
  if (protocol.schemaVersion !== QUALIFIED_SOURCE_PAIR_PROTOCOL_SCHEMA_VERSION
    || !CASE_ID.test(protocol.questionId) || !validString(protocol.answerModel)
    || protocol.templateVersion !== PUBLIC_ANSWER_TEMPLATE_VERSION_V2
    || protocol.captureQualification !== 'source-bound-v2'
    || !HEX.test(protocol.historyDigest) || !HEX.test(protocol.sourceMapDigest)
    || !HEX.test(protocol.digest)) fail(code);
  exactObject(protocol.question, ['text', 'date'], code);
  if (!validString(protocol.question.text) || !validString(protocol.question.date)) fail(code);
  exactObject(protocol.namespace, ['ownerId', 'scope', 'projectId'], code);
  if (!validString(protocol.namespace.ownerId) || protocol.namespace.scope !== 'project'
    || protocol.namespace.projectId !== protocol.questionId) fail(code);
  exactObject(protocol.limits, ['contextWindow', 'outputTokens', 'answerTimeoutMs', 'recallLimit'], code);
  if (Object.values(protocol.limits).some((value) => !Number.isSafeInteger(value) || value <= 0)
    || protocol.limits.recallLimit > 12 || protocol.limits.answerTimeoutMs > 2_147_483_647) fail(code);
  if (!dense(protocol.armOrder, 2) || new Set(protocol.armOrder).size !== 2
    || NAMES.some((name) => !protocol.armOrder.includes(name)) || !dense(protocol.arms, 2)) fail(code);
  let batchCount;
  for (const [index, arm] of protocol.arms.entries()) {
    exactObject(arm, ['name', 'scopeId', 'captureSourcePolicy', 'planSchemaVersion',
      'payloadDigests'], code);
    const prefix = index === 0;
    if (arm.name !== NAMES[index]
      || arm.scopeId !== 'lme-case-' + hash('cairn.lme.source-pair.scope.v1',
        [protocol.questionId, arm.name])
      || arm.captureSourcePolicy !== (prefix ? 'retained-prefix-v1' : 'indexed-windows-v1')
      || arm.planSchemaVersion !== (prefix
        ? 'cairn-longmemeval-qualified-prefix-ingestion-plan-v1'
        : 'cairn-longmemeval-indexed-window-ingestion-plan-v1')
      || !Array.isArray(arm.payloadDigests)
      || !dense(arm.payloadDigests, arm.payloadDigests.length)
      || arm.payloadDigests.some((digest) => digest !== null && !HEX.test(digest))) fail(code);
    if (batchCount !== undefined && arm.payloadDigests.length !== batchCount) fail(code);
    batchCount = arm.payloadDigests.length;
  }
  const { digest, ...withoutDigest } = protocol;
  if (digest !== hash('cairn.lme.source-pair.protocol.v1', withoutDigest)) fail(code);
  return protocol;
}

function validateRetrieval(retrieval, code) {
  if (!isPlainObject(retrieval)) fail(code);
  for (const key of ['retrievedSessionIds', 'packedSessionIds']) {
    denseArray(retrieval[key], 0, code);
    if (retrieval[key].some((id) => !SESSION_ID.test(id))
      || new Set(retrieval[key]).size !== retrieval[key].length) fail(code);
  }
  if (retrieval.packedSessionIds.some((id) => !retrieval.retrievedSessionIds.includes(id))) fail(code);
}

function validateGenerationRun(run, expectedProtocol) {
  exactObject(run, ['schemaVersion', 'protocol', 'executionStatus', 'haltReason',
    'attemptedOrder', 'arms', 'latencyMs', 'sourceTimePolicy', 'semanticCoverage',
    'interpretation'], 'invalid_run');
  if (run.schemaVersion !== QUALIFIED_SOURCE_PAIR_SCHEMA_VERSION
    || !isDeepStrictEqual(run.protocol, expectedProtocol)
    || !['completed', 'halted'].includes(run.executionStatus)
    || !(run.executionStatus === 'completed' ? run.haltReason === null
      : HALT_REASONS.includes(run.haltReason))
    || !uniquePrefix(run.attemptedOrder, expectedProtocol.armOrder)
    || run.executionStatus === 'completed' && run.attemptedOrder.length !== 2
    || typeof run.latencyMs !== 'number' || !Number.isFinite(run.latencyMs) || run.latencyMs < 0
    || run.sourceTimePolicy !== SOURCE_TIME_POLICY || run.semanticCoverage !== 'unassessed'
    || run.interpretation !== N_INTERPRETATION || !dense(run.arms, 2)) fail('invalid_run');
  for (const [index, arm] of run.arms.entries()) {
    exactObject(arm, ['name', 'status', 'reason', 'answer', 'diagnostics'], 'invalid_run');
    if (arm.name !== NAMES[index] || !['completed', 'failed', 'blocked'].includes(arm.status)
      || !isPlainObject(arm.diagnostics)) fail('invalid_run');
    if (arm.status === 'completed') {
      if (arm.reason !== null || !sameKeys(arm.answer, ['text', 'usage'])
        || typeof arm.answer.text !== 'string') fail('invalid_run');
      const usage = arm.answer.usage;
      if (usage !== null && (!sameKeys(usage, ['scope', 'inputTokens', 'outputTokens', 'costMicroUsd'])
        || usage.scope !== 'answer-only-callback-reported'
        || ['inputTokens', 'outputTokens', 'costMicroUsd'].some((key) =>
          usage[key] !== null && !nonnegative(usage[key])))) fail('invalid_run');
    } else if (!SAFE_GENERATION_REASONS.has(arm.reason) || arm.answer !== null) fail('invalid_run');
    if (run.executionStatus === 'completed' && HALT_REASONS.includes(arm.reason)) fail('invalid_run');
    if (Object.hasOwn(arm.diagnostics, 'retrieval') && arm.diagnostics.retrieval !== null)
      validateRetrieval(arm.diagnostics.retrieval, 'invalid_run');
    if (!run.attemptedOrder.includes(arm.name)) {
      if (run.executionStatus !== 'halted' || arm.status !== 'blocked'
        || arm.reason !== run.haltReason) fail('invalid_run');
    }
    if (HALT_REASONS.includes(arm.reason) && (run.executionStatus !== 'halted'
      || arm.reason !== run.haltReason
      || run.attemptedOrder.includes(arm.name)
        && arm.name !== run.attemptedOrder.at(-1))) fail('invalid_run');
  }
  return run;
}

function validateEvaluator(evaluator, protocol) {
  exactObject(evaluator, ['question_id', 'source_question_id', 'question_type',
    'reference_answer', 'answer_session_ids', 'turn_labels'], 'invalid_evaluator');
  if (evaluator.question_id !== protocol.questionId || !validString(evaluator.source_question_id)
    || opaqueQuestionId(evaluator.source_question_id) !== protocol.questionId
    || !OFFICIAL_QUESTION_TYPES.includes(evaluator.question_type)) fail('evaluator_mismatch');
  denseArray(evaluator.answer_session_ids, 0, 'invalid_evaluator');
  denseArray(evaluator.turn_labels, 0, 'invalid_evaluator');
  if (evaluator.answer_session_ids.some((id) => !SESSION_ID.test(id))
    || new Set(evaluator.answer_session_ids).size !== evaluator.answer_session_ids.length) fail('invalid_evaluator');
  const turns = new Set();
  for (const label of evaluator.turn_labels) {
    exactObject(label, ['turn_id', 'has_answer'], 'invalid_evaluator');
    if (!TURN_ID.test(label.turn_id) || turns.has(label.turn_id)
      || typeof label.has_answer !== 'boolean') fail('invalid_evaluator');
    turns.add(label.turn_id);
  }
  const reference = evaluator.reference_answer;
  if (!(typeof reference === 'string' || typeof reference === 'number' && Number.isFinite(reference)
    || Array.isArray(reference) && reference.length > 0
      && dense(reference, reference.length) && reference.every((item) =>
        typeof item === 'string' || typeof item === 'number' && Number.isFinite(item)))) fail('invalid_evaluator');
  return evaluator;
}

const coverage = (ids, references) => ({ numerator: references.filter((id) => ids.includes(id)).length,
  denominator: references.length,
  rate: ratio(references.filter((id) => ids.includes(id)).length, references.length) });
const referenceCoverage = (arm, evaluator) => {
  const retrieval = arm.diagnostics.retrieval;
  if (!retrieval || evaluator.answer_session_ids.length === 0) return null;
  return { retrieved: coverage(retrieval.retrievedSessionIds, evaluator.answer_session_ids),
    packed: coverage(retrieval.packedSessionIds, evaluator.answer_session_ids) };
};
const unresolved = (name, generationStatus, reason, stage, attempted = false, referenceSessionCoverage = null) => ({
  name, generationStatus, judgment: { status: 'unresolved', correct: null, reason, stage, attempted },
  referenceSessionCoverage,
});
const resolved = (name, correct, referenceSessionCoverage) => ({ name, generationStatus: 'completed',
  judgment: { status: 'resolved', correct, reason: null, stage: null, attempted: true },
  referenceSessionCoverage });

class ScopeBoundary extends Error {
  constructor(reason) { super(reason); this.reason = reason; }
}
function scopeCheck(state, retainGenerationFailure = false) {
  if (!state.open) throw new ScopeBoundary('scope_contract_invalid');
  if (state.sticky) throw new ScopeBoundary(state.sticky);
  let halted;
  try { halted = state.isHalted(); }
  catch { state.sticky = 'scope_contract_invalid'; throw new ScopeBoundary(state.sticky); }
  if (typeof halted !== 'boolean') {
    state.sticky = 'scope_contract_invalid'; throw new ScopeBoundary(state.sticky);
  }
  if (halted) { state.sticky = 'global_halt'; throw new ScopeBoundary(state.sticky); }
  let status;
  try {
    const returned = state.snapshot();
    if (!sameKeys(returned, ['version', 'phase', 'caseId', 'status'])) throw new Error('invalid shape');
    const { version, phase, caseId, status: observed } = returned;
    if (version !== 'case-deadline-scope-v1' || phase !== 'scoring' || caseId !== state.scopeId
      || !['active', 'timed_out', 'blocked'].includes(observed)) throw new Error('invalid status');
    status = observed;
  } catch { state.sticky = 'scope_contract_invalid'; throw new ScopeBoundary(state.sticky); }
  if (!retainGenerationFailure && (status === 'timed_out' || status === 'blocked'))
    throw new ScopeBoundary('case_timeout');
}

const judgeResponseText = (value) => {
  try {
    if (!sameKeys(value, ['text'])) return null;
    const text = value.text;
    return typeof text === 'string' ? { text } : null;
  } catch { return null; }
};

async function judgeOnce(judge, request, timeoutMs, state) {
  scopeCheck(state);
  const controller = new AbortController();
  let timer;
  state.judgeAttempted = true;
  let transport;
  try { transport = Promise.resolve(judge({ request, signal: controller.signal }))
    .then((value) => ({ kind: 'response', value }), () => ({ kind: 'failure' })); }
  catch { transport = Promise.resolve({ kind: 'failure' }); }
  const timeout = new Promise((resolve) => { timer = setTimeout(() => {
    controller.abort(); resolve({ kind: 'timeout' });
  }, timeoutMs); });
  try {
    const result = await Promise.race([transport, timeout]);
    scopeCheck(state);
    return result;
  } finally { clearTimeout(timer); }
}

function scorerPorts(options) {
  const keys = ['run', 'expectedProtocol', 'evaluator', 'judge', 'judgeTimeoutMs', 'execution'];
  let raw;
  try {
    exactObject(options, Object.hasOwn(options, 'referenceRendering')
      ? [...keys, 'referenceRendering'] : keys, 'invalid_options');
    raw = Object.fromEntries(Object.keys(options).map((key) => [key, options[key]]));
  }
  catch { fail('invalid_options'); }
  const run = clone(raw.run, 'invalid_run');
  const expectedProtocol = clone(raw.expectedProtocol, 'invalid_protocol');
  const evaluator = clone(raw.evaluator, 'invalid_evaluator');
  validateProtocol(expectedProtocol);
  validateGenerationRun(run, expectedProtocol);
  validateEvaluator(evaluator, expectedProtocol);
  if (raw.judge !== undefined && typeof raw.judge !== 'function') fail('invalid_judge');
  if (!Number.isSafeInteger(raw.judgeTimeoutMs) || raw.judgeTimeoutMs < 1
    || raw.judgeTimeoutMs > 2_147_483_647) fail('invalid_judge_timeout');
  let methods;
  try {
    exactObject(raw.execution, ['withCaseScope', 'isHalted'], 'invalid_execution');
    methods = { withCaseScope: raw.execution.withCaseScope, isHalted: raw.execution.isHalted };
  } catch { fail('invalid_execution'); }
  if (typeof methods.withCaseScope !== 'function' || typeof methods.isHalted !== 'function')
    fail('invalid_execution');
  let reference = evaluator.reference_answer;
  let referenceSerialization = 'verified-string';
  if (Object.hasOwn(raw, 'referenceRendering')) {
    try { reference = resolveReferenceRendering(raw.referenceRendering, evaluator); }
    catch { fail('rendering_mismatch'); }
    referenceSerialization = 'verified-python-rendered';
  }
  if (typeof reference !== 'string') referenceSerialization = 'unverified-non-string';
  return { run, expectedProtocol, evaluator, reference, referenceSerialization,
    judge: raw.judge, judgeTimeoutMs: raw.judgeTimeoutMs,
    withCaseScope: Function.prototype.bind.call(methods.withCaseScope, raw.execution),
    isHalted: Function.prototype.bind.call(methods.isHalted, raw.execution) };
}

export async function scoreQualifiedSourcePair(options) {
  const started = Date.now();
  const data = scorerPorts(options);
  const protocol = data.expectedProtocol;
  const sourceArms = Object.fromEntries(data.run.arms.map((arm) => [arm.name, arm]));
  const rows = Object.fromEntries(NAMES.map((name) => {
    const source = sourceArms[name];
    return [name, unresolved(name, source.status, 'not_started', 'execution', false,
      referenceCoverage(source, data.evaluator))];
  }));
  const attemptedOrder = [];
  let haltReason = data.run.executionStatus === 'halted' ? 'generation_halted' : null;
  if (haltReason) for (const name of NAMES) {
    const source = sourceArms[name];
    rows[name] = unresolved(name, source.status, haltReason, 'execution', false,
      referenceCoverage(source, data.evaluator));
  }
  for (const name of haltReason ? [] : protocol.armOrder) {
    const source = sourceArms[name];
    const sourceCoverage = referenceCoverage(source, data.evaluator);
    let halted;
    try { halted = data.isHalted(); }
    catch { haltReason = 'scope_contract_invalid'; }
    if (!haltReason && typeof halted !== 'boolean') haltReason = 'scope_contract_invalid';
    if (!haltReason && halted) haltReason = 'global_halt';
    if (haltReason) break;
    const descriptor = protocol.arms.find((item) => item.name === name);
    let calls = 0, saved = null, state = null, wrapperFailed = false, scopeOpen = true;
    try {
      await data.withCaseScope({ phase: 'scoring', caseId: descriptor.scopeId }, async (handle) => {
        if (!scopeOpen) throw new ScopeBoundary('scope_contract_invalid');
        calls++;
        if (calls !== 1) {
          if (state) state.sticky = 'scope_contract_invalid';
          throw new ScopeBoundary('scope_contract_invalid');
        }
        attemptedOrder.push(name);
        state = { scopeId: descriptor.scopeId, isHalted: data.isHalted,
          snapshot: null, sticky: null, open: true, judgeAttempted: false };
        let row;
        try {
          try {
            const method = handle?.snapshot;
            if (typeof method !== 'function') throw new Error('invalid handle');
            state.snapshot = Function.prototype.bind.call(method, handle);
          } catch { state.sticky = 'scope_contract_invalid'; throw new ScopeBoundary(state.sticky); }
          scopeCheck(state, source.status !== 'completed');
          if (source.status !== 'completed')
            row = unresolved(name, source.status, source.reason, 'generation', false, sourceCoverage);
          else if (data.referenceSerialization === 'unverified-non-string')
            row = unresolved(name, source.status, 'reference_serialization_unverified',
              'compatibility', false, sourceCoverage);
          else if (!data.judge) row = unresolved(name, source.status, 'judge_not_configured',
            'judge', false, sourceCoverage);
          else {
            const prompt = officialPrompt({ questionType: data.evaluator.question_type,
              question: protocol.question.text, reference: data.reference,
              response: source.answer.text, abstention: data.evaluator.source_question_id.includes('_abs') });
            const result = await judgeOnce(data.judge, officialJudgeRequest(prompt), data.judgeTimeoutMs, state);
            if (result.kind === 'timeout') row = unresolved(name, source.status, 'judge_timeout',
              'judge', true, sourceCoverage);
            else if (result.kind === 'failure') row = unresolved(name, source.status, 'judge_failed',
              'judge', true, sourceCoverage);
            else {
              const response = judgeResponseText(result.value);
              row = response ? resolved(name, parseOfficialJudgeText(response.text), sourceCoverage)
                : unresolved(name, source.status, 'invalid_judge_response',
                  'judge', true, sourceCoverage);
            }
          }
          scopeCheck(state, source.status !== 'completed');
        } catch (error) {
          if (error instanceof ScopeBoundary) {
            if (error.reason !== 'case_timeout') state.sticky = error.reason;
            row = unresolved(name, source.status, error.reason, 'execution', state.judgeAttempted,
              sourceCoverage);
          } else row = unresolved(name, source.status, 'judge_failed', 'judge', state.judgeAttempted,
            sourceCoverage);
        } finally { state.open = false; }
        saved = clone(row, 'invalid_result');
        return saved;
      });
    } catch { wrapperFailed = true; }
    finally { scopeOpen = false; if (state) state.open = false; }
    if (state?.sticky && state.sticky !== 'case_timeout') haltReason = state.sticky;
    else if (calls > 1 || !wrapperFailed && calls !== 1) haltReason = 'scope_contract_invalid';
    else if (wrapperFailed) {
      let after;
      try { after = data.isHalted(); }
      catch { haltReason = 'scope_contract_invalid'; }
      if (!haltReason && typeof after !== 'boolean') haltReason = 'scope_contract_invalid';
      if (!haltReason) haltReason = after ? 'global_halt' : 'scope_execution_failed';
    }
    if (haltReason) {
      rows[name] = unresolved(name, source.status, haltReason, 'execution',
        state?.judgeAttempted === true, sourceCoverage);
      break;
    }
    if (!saved) {
      haltReason = 'scope_contract_invalid';
      rows[name] = unresolved(name, source.status, haltReason, 'execution', false, sourceCoverage);
      break;
    }
    rows[name] = saved;
    let after;
    try { after = data.isHalted(); }
    catch { haltReason = 'scope_contract_invalid'; }
    if (!haltReason && typeof after !== 'boolean') haltReason = 'scope_contract_invalid';
    if (!haltReason && after) haltReason = 'global_halt';
    if (haltReason) break;
  }
  if (haltReason && haltReason !== 'generation_halted') for (const name of NAMES) {
    if (rows[name].judgment.reason === 'not_started') {
      const source = sourceArms[name];
      rows[name] = unresolved(name, source.status, haltReason, 'execution', false,
        referenceCoverage(source, data.evaluator));
    }
  }
  return deepFreeze({ schemaVersion: QUALIFIED_SOURCE_SCORING_SCHEMA_VERSION, protocol,
    sourceQuestionId: data.evaluator.source_question_id, questionType: data.evaluator.question_type,
    abstention: data.evaluator.source_question_id.includes('_abs'),
    generationExecutionStatus: data.run.executionStatus,
    executionStatus: haltReason ? 'halted' : 'completed', haltReason, attemptedOrder,
    compatibility: { referenceSerialization: data.referenceSerialization,
      upstreamCommit: OFFICIAL_UPSTREAM_COMMIT,
      judgeRequest: { model: OFFICIAL_JUDGE_MODEL, n: 1, temperature: 0, max_tokens: 10 } },
    arms: NAMES.map((name) => rows[name]), latencyMs: elapsed(started),
    interpretation: SCORE_INTERPRETATION });
}

function validateCoverageBucket(bucket, code) {
  exactObject(bucket, ['numerator', 'denominator', 'rate'], code);
  if (!nonnegative(bucket.numerator) || !nonnegative(bucket.denominator)
    || bucket.numerator > bucket.denominator
    || bucket.rate !== ratio(bucket.numerator, bucket.denominator)) fail(code);
}

function validateScoreRecord(record, expectedProtocol) {
  exactObject(record, ['schemaVersion', 'protocol', 'sourceQuestionId', 'questionType',
    'abstention', 'generationExecutionStatus', 'executionStatus', 'haltReason',
    'attemptedOrder', 'compatibility', 'arms', 'latencyMs', 'interpretation'], 'invalid_records');
  if (record.schemaVersion !== QUALIFIED_SOURCE_SCORING_SCHEMA_VERSION
    || !isDeepStrictEqual(record.protocol, expectedProtocol)
    || !validString(record.sourceQuestionId)
    || opaqueQuestionId(record.sourceQuestionId) !== expectedProtocol.questionId
    || !OFFICIAL_QUESTION_TYPES.includes(record.questionType)
    || record.abstention !== record.sourceQuestionId.includes('_abs')
    || !['completed', 'halted'].includes(record.generationExecutionStatus)
    || !['completed', 'halted'].includes(record.executionStatus)
    || !(record.executionStatus === 'completed' ? record.haltReason === null
      : ['generation_halted', ...HALT_REASONS].includes(record.haltReason))
    || (record.haltReason === 'generation_halted') !== (record.generationExecutionStatus === 'halted')
    || !uniquePrefix(record.attemptedOrder, expectedProtocol.armOrder)
    || record.executionStatus === 'completed' && record.attemptedOrder.length !== 2
    || record.generationExecutionStatus === 'halted' && record.attemptedOrder.length !== 0
    || typeof record.latencyMs !== 'number' || !Number.isFinite(record.latencyMs)
    || record.latencyMs < 0 || record.interpretation !== SCORE_INTERPRETATION
    || !dense(record.arms, 2)) fail('invalid_records');
  exactObject(record.compatibility, ['referenceSerialization', 'upstreamCommit', 'judgeRequest'],
    'invalid_records');
  if (!['verified-string', 'verified-python-rendered', 'unverified-non-string']
    .includes(record.compatibility.referenceSerialization)
    || record.compatibility.upstreamCommit !== OFFICIAL_UPSTREAM_COMMIT) fail('invalid_records');
  exactObject(record.compatibility.judgeRequest, ['model', 'n', 'temperature', 'max_tokens'],
    'invalid_records');
  if (record.compatibility.judgeRequest.model !== OFFICIAL_JUDGE_MODEL
    || record.compatibility.judgeRequest.n !== 1
    || record.compatibility.judgeRequest.temperature !== 0
    || record.compatibility.judgeRequest.max_tokens !== 10) fail('invalid_records');
  for (const [index, arm] of record.arms.entries()) {
    exactObject(arm, ['name', 'generationStatus', 'judgment', 'referenceSessionCoverage'],
      'invalid_records');
    if (arm.name !== NAMES[index] || !['completed', 'failed', 'blocked'].includes(arm.generationStatus))
      fail('invalid_records');
    exactObject(arm.judgment, ['status', 'correct', 'reason', 'stage', 'attempted'], 'invalid_records');
    const judgment = arm.judgment;
    if (typeof judgment.attempted !== 'boolean' || !['resolved', 'unresolved'].includes(judgment.status))
      fail('invalid_records');
    if (judgment.status === 'unresolved' && judgment.correct !== null) fail('invalid_records');
    if (judgment.attempted && (arm.generationStatus !== 'completed'
      || record.compatibility.referenceSerialization === 'unverified-non-string')) fail('invalid_records');
    if (arm.referenceSessionCoverage !== null) {
      exactObject(arm.referenceSessionCoverage, ['retrieved', 'packed'], 'invalid_records');
      validateCoverageBucket(arm.referenceSessionCoverage.retrieved, 'invalid_records');
      validateCoverageBucket(arm.referenceSessionCoverage.packed, 'invalid_records');
      if (arm.referenceSessionCoverage.retrieved.denominator === 0
        || arm.referenceSessionCoverage.packed.denominator
          !== arm.referenceSessionCoverage.retrieved.denominator
        || arm.referenceSessionCoverage.packed.numerator
          > arm.referenceSessionCoverage.retrieved.numerator) fail('invalid_records');
    }
    const entered = record.attemptedOrder.includes(arm.name);
    if (record.generationExecutionStatus === 'halted') {
      if (judgment.status !== 'unresolved' || judgment.reason !== 'generation_halted'
        || judgment.stage !== 'execution' || judgment.attempted) fail('invalid_records');
      continue;
    }
    if (!entered) {
      if (record.executionStatus !== 'halted' || judgment.status !== 'unresolved'
        || judgment.reason !== record.haltReason || judgment.stage !== 'execution'
        || judgment.attempted) fail('invalid_records');
      continue;
    }
    if (judgment.status === 'resolved') {
      if (arm.generationStatus !== 'completed' || typeof judgment.correct !== 'boolean'
        || judgment.reason !== null || judgment.stage !== null || !judgment.attempted
        || record.compatibility.referenceSerialization === 'unverified-non-string')
        fail('invalid_records');
      continue;
    }
    if (judgment.correct !== null || !validString(judgment.reason)
      || !['generation', 'compatibility', 'judge', 'execution'].includes(judgment.stage))
      fail('invalid_records');
    if (judgment.stage === 'generation') {
      if (arm.generationStatus === 'completed' || !SAFE_GENERATION_REASONS.has(judgment.reason)
        || HALT_REASONS.includes(judgment.reason) || judgment.attempted) fail('invalid_records');
    } else if (judgment.stage === 'compatibility') {
      if (arm.generationStatus !== 'completed' || judgment.reason !== 'reference_serialization_unverified'
        || judgment.attempted || record.compatibility.referenceSerialization !== 'unverified-non-string')
        fail('invalid_records');
    } else if (judgment.stage === 'judge') {
      if (arm.generationStatus !== 'completed' || !JUDGE_REASONS.includes(judgment.reason)
        || record.compatibility.referenceSerialization === 'unverified-non-string'
        || judgment.attempted !== (judgment.reason !== 'judge_not_configured')) fail('invalid_records');
    } else if (!EXECUTION_REASONS.includes(judgment.reason)
      || judgment.reason === 'generation_halted'
      || judgment.reason === 'case_timeout' && arm.generationStatus !== 'completed'
      || HALT_REASONS.includes(judgment.reason) && (record.executionStatus !== 'halted'
        || judgment.reason !== record.haltReason)) fail('invalid_records');
  }
  if (record.executionStatus === 'halted' && record.generationExecutionStatus !== 'halted') {
    const enteredHaltRows = record.attemptedOrder.filter((name) => {
      const judgment = record.arms.find((arm) => arm.name === name).judgment;
      return judgment.stage === 'execution' && judgment.reason === record.haltReason;
    });
    if (enteredHaltRows.length > 1 || enteredHaltRows.length === 1
      && enteredHaltRows[0] !== record.attemptedOrder.at(-1)) fail('invalid_records');
    // A scope wrapper failure always invalidates its own scoring slot. A
    // cleanly exited final judgment may precede global/contract halt, but it
    // cannot by itself account for scope_execution_failed.
    if (record.haltReason === 'scope_execution_failed' && !record.arms.some((arm) =>
      arm.judgment.status === 'unresolved' && arm.judgment.stage === 'execution'
        && arm.judgment.reason === 'scope_execution_failed')) fail('invalid_records');
  }
  return record;
}

const freshBucket = () => ({ fixedN: 0, resolved: 0, correct: 0, incorrect: 0,
  unresolved: 0, accuracy: null, coverage: null,
  fixedNBounds: { lower: null, upper: null },
  stageCounts: Object.create(null), reasonCounts: Object.create(null) });
const countBucket = (bucket, arm) => {
  bucket.fixedN++;
  if (!arm) {
    bucket.unresolved++;
    bucket.stageCounts.missing = (bucket.stageCounts.missing ?? 0) + 1;
    bucket.reasonCounts.missing_scoring_record = (bucket.reasonCounts.missing_scoring_record ?? 0) + 1;
  } else if (arm.judgment.status === 'resolved') {
    bucket.resolved++;
    bucket[arm.judgment.correct ? 'correct' : 'incorrect']++;
  } else {
    bucket.unresolved++;
    bucket.stageCounts[arm.judgment.stage] = (bucket.stageCounts[arm.judgment.stage] ?? 0) + 1;
    bucket.reasonCounts[arm.judgment.reason] = (bucket.reasonCounts[arm.judgment.reason] ?? 0) + 1;
  }
};
const finishBucket = (bucket) => {
  bucket.accuracy = ratio(bucket.correct, bucket.resolved);
  bucket.coverage = ratio(bucket.resolved, bucket.fixedN);
  bucket.fixedNBounds = { lower: ratio(bucket.correct, bucket.fixedN),
    upper: bucket.fixedN ? (bucket.correct + bucket.unresolved) / bucket.fixedN : null };
  return bucket;
};
const freshCommon = () => ({ commonN: 0,
  byArm: Object.fromEntries(NAMES.map((name) => [name,
    { correct: 0, incorrect: 0, accuracy: null }])),
  pairedOutcomes: { bothCorrect: 0, prefixOnlyCorrect: 0, indexedOnlyCorrect: 0,
    bothIncorrect: 0 } });
const countCommon = (bucket, record) => {
  bucket.commonN++;
  const prefix = record.arms[0].judgment.correct;
  const indexed = record.arms[1].judgment.correct;
  bucket.byArm[NAMES[0]][prefix ? 'correct' : 'incorrect']++;
  bucket.byArm[NAMES[1]][indexed ? 'correct' : 'incorrect']++;
  bucket.pairedOutcomes[prefix && indexed ? 'bothCorrect'
    : prefix ? 'prefixOnlyCorrect' : indexed ? 'indexedOnlyCorrect' : 'bothIncorrect']++;
};
const finishCommon = (bucket) => {
  for (const entry of Object.values(bucket.byArm)) entry.accuracy = ratio(entry.correct, bucket.commonN);
  return bucket;
};

export function aggregateQualifiedSourceScores(options) {
  exactObject(options, ['roster', 'records'], 'invalid_options');
  let roster, records;
  try { roster = structuredClone(options.roster); records = structuredClone(options.records); }
  catch { fail('invalid_options'); }
  denseArray(roster, 1, 'invalid_roster');
  denseArray(records, 0, 'invalid_records');
  const rosterMap = new Map();
  let commonSettings;
  for (const entry of roster) {
    exactObject(entry, ['protocol', 'sourceQuestionId', 'questionType'], 'invalid_roster');
    validateProtocol(entry.protocol, 'invalid_roster');
    if (!validString(entry.sourceQuestionId)
      || opaqueQuestionId(entry.sourceQuestionId) !== entry.protocol.questionId
      || !OFFICIAL_QUESTION_TYPES.includes(entry.questionType)
      || rosterMap.has(entry.protocol.questionId)) fail('invalid_roster');
    const settings = { answerModel: entry.protocol.answerModel,
      templateVersion: entry.protocol.templateVersion,
      captureQualification: entry.protocol.captureQualification, limits: entry.protocol.limits,
      policies: entry.protocol.arms.map(({ captureSourcePolicy, planSchemaVersion }) =>
        ({ captureSourcePolicy, planSchemaVersion })) };
    if (commonSettings && !isDeepStrictEqual(settings, commonSettings)) fail('invalid_roster');
    commonSettings = settings;
    rosterMap.set(entry.protocol.questionId, entry);
  }
  const recordMap = new Map();
  for (const record of records) {
    const expected = rosterMap.get(record?.protocol?.questionId);
    if (!expected || recordMap.has(expected.protocol.questionId)) fail('invalid_records');
    validateScoreRecord(record, expected.protocol);
    if (record.sourceQuestionId !== expected.sourceQuestionId
      || record.questionType !== expected.questionType) fail('record_mismatch');
    recordMap.set(expected.protocol.questionId, record);
  }
  const arms = {};
  for (const name of NAMES) {
    const overall = freshBucket();
    const perType = Object.fromEntries(OFFICIAL_QUESTION_TYPES.map((type) => [type, freshBucket()]));
    const abstentionOverlay = freshBucket();
    for (const entry of rosterMap.values()) {
      const record = recordMap.get(entry.protocol.questionId);
      const arm = record?.arms.find((item) => item.name === name);
      countBucket(overall, arm);
      countBucket(perType[entry.questionType], arm);
      if (entry.sourceQuestionId.includes('_abs')) countBucket(abstentionOverlay, arm);
    }
    finishBucket(overall);
    for (const bucket of Object.values(perType)) finishBucket(bucket);
    finishBucket(abstentionOverlay);
    arms[name] = { overall, perType,
      abstentionOverlay: abstentionOverlay.fixedN ? abstentionOverlay : null,
      macroSixTypeAccuracy: OFFICIAL_QUESTION_TYPES.every((type) =>
        perType[type].fixedN > 0 && perType[type].unresolved === 0)
        ? OFFICIAL_QUESTION_TYPES.reduce((sum, type) => sum + perType[type].accuracy, 0)
          / OFFICIAL_QUESTION_TYPES.length : null,
      completeVerifiedOfficialStyle: overall.unresolved === 0 };
  }
  const commonOverall = freshCommon();
  const commonByType = Object.fromEntries(OFFICIAL_QUESTION_TYPES.map((type) => [type, freshCommon()]));
  const commonAbstention = freshCommon();
  let abstentionCount = 0;
  for (const entry of rosterMap.values()) {
    const abstention = entry.sourceQuestionId.includes('_abs');
    if (abstention) abstentionCount++;
    const record = recordMap.get(entry.protocol.questionId);
    if (!record || record.arms.some((arm) => arm.judgment.status !== 'resolved')) continue;
    countCommon(commonOverall, record);
    countCommon(commonByType[entry.questionType], record);
    if (abstention) countCommon(commonAbstention, record);
  }
  return deepFreeze({ schemaVersion: QUALIFIED_SOURCE_AGGREGATE_SCHEMA_VERSION,
    fixedCaseCount: roster.length, scoredRecordCount: records.length, arms,
    common: { ...finishCommon(commonOverall),
      byType: Object.fromEntries(Object.entries(commonByType).map(([type, bucket]) =>
        [type, finishCommon(bucket)])),
      abstentionOverlay: abstentionCount ? finishCommon(commonAbstention) : null },
    completeVerifiedOfficialStyle: Object.values(arms).every((arm) => arm.completeVerifiedOfficialStyle),
    interpretation: AGGREGATE_INTERPRETATION });
}

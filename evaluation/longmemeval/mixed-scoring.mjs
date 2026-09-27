import { OFFICIAL_QUESTION_TYPES, officialJudgeRequest, officialPrompt,
  parseOfficialJudgeText } from './official-scoring.mjs';
import { opaqueQuestionId } from './prepare.mjs';
import { countOpenAITokens } from '../../adapters/openai/index.mjs';
import { resolveReferenceRendering } from './reference-rendering.mjs';
import { MIXED_GENERATION_VERSION } from './mixed-generation.mjs';
import { authenticateLocalUnknown, completionOnce, trackedTransport,
  unknownCurrentAttempt, verifiedLocalOrdinals } from './mixed-transport.mjs';
import { MixedComparisonError, canonical, dense, exact, fail, freeze, hash, reportSnapshot, safeInteger,
  wellFormed } from './mixed-validation.mjs';

export const MIXED_SCORING_VERSION = 'cairn-lme-mixed-scoring-v1';
const GENERATION_DOMAIN = 'cairn.lme.mixed.generation-report.v1';
const MANIFEST_DOMAIN = 'cairn.lme.mixed.manifest.v1';
const ROSTER_DOMAIN = 'cairn.lme.mixed-source-pair.roster.v1';
const OUTCOMES = ['correct', 'incorrect', 'unresolved'];
const NAMES = ['cairn', 'mem0'];
const CASE_ID = /^lme-case-[a-f0-9]{64}$/u;
const SESSION_ID = /^lme-session-[a-f0-9]{64}$/u;
const TURN_ID = /^lme-turn-[a-f0-9]{64}$/u;
const SAFE_REASON = /^[a-z][a-z0-9_]{0,79}$/u;
const JUDGE_LOCAL_REASONS = new Set(['invalid_mixed_completion', 'invalid_mixed_usage',
  'mixed_usage_unsettled', 'invalid_mixed_transport']);

function optionsData(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)
    || Object.getPrototypeOf(value) !== Object.prototype) fail('invalid_mixed_scoring');
  const keys = Reflect.ownKeys(value), expected = ['generationReport', 'evaluatorRows',
    'referenceRenderings', 'guard', 'apiKey'];
  if (keys.length !== expected.length || expected.some(key => !keys.includes(key))) {
    fail('invalid_mixed_scoring');
  }
  const result = {};
  for (const key of expected) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor || !Object.hasOwn(descriptor, 'value') || !descriptor.enumerable) {
      fail('invalid_mixed_scoring');
    }
    result[key] = descriptor.value;
  }
  return result;
}

function validateGeneration(raw, guard) {
  if (!Object.isFrozen(raw)) fail('invalid_mixed_report');
  const report = reportSnapshot(raw);
  exact(report, ['schemaVersion', 'manifest', 'roster', 'manifestDigest', 'rosterDigest',
    'cases', 'halted', 'haltReason'], 'invalid_mixed_report');
  if (report.schemaVersion !== MIXED_GENERATION_VERSION || typeof report.halted !== 'boolean'
    || report.halted !== (report.haltReason !== null)
    || report.halted && (!wellFormed(report.haltReason) || !SAFE_REASON.test(report.haltReason))
    || canonical(report.manifest) !== canonical(guard?.mixedSourcePairCapability?.manifest)
    || canonical(report.roster) !== canonical(guard?.mixedSourcePairCapability?.roster)
    || report.manifestDigest !== hash(MANIFEST_DOMAIN, report.manifest)
    || report.rosterDigest !== hash(ROSTER_DOMAIN, report.roster)) fail('invalid_mixed_report');
  dense(report.cases, report.roster.length, report.roster.length, 'invalid_mixed_report');
  const actualScopes = guard.caseOutcomes()?.scopes;
  const lastSnapshot = guard.caseScopeSnapshot();
  if (!Array.isArray(actualScopes) || actualScopes.length > report.roster.length * 2
    || !report.halted && actualScopes.length !== report.roster.length * 2) {
    fail('invalid_mixed_report');
  }
  for (const [index, entry] of report.cases.entries()) {
    const roster = report.roster[index];
    exact(entry, ['questionId', 'question', 'caseDigest', 'preflight', 'arms'], 'invalid_mixed_report');
    exact(entry.question, ['text', 'date'], 'invalid_mixed_report');
    exact(entry.preflight, ['status', 'reason'], 'invalid_mixed_report');
    if (entry.questionId !== roster.questionId || !CASE_ID.test(entry.questionId)
      || !wellFormed(entry.question.text) || !entry.question.text
      || !wellFormed(entry.question.date) || !entry.question.date
      || !['ready', 'failed'].includes(entry.preflight.status)
      || (entry.preflight.status === 'ready') !== (entry.caseDigest !== null)
      || (entry.preflight.status === 'ready') !== (entry.preflight.reason === null)
      || entry.caseDigest !== null && !/^[a-f0-9]{64}$/u.test(entry.caseDigest)
      || entry.preflight.reason !== null && !SAFE_REASON.test(entry.preflight.reason)) {
      fail('invalid_mixed_report');
    }
    dense(entry.arms, 2, 2, 'invalid_mixed_report');
    for (const [armIndex, arm] of entry.arms.entries()) {
      exact(arm, ['name', 'status', 'reason', 'answer', 'scope', 'diagnostics'], 'invalid_mixed_report');
      if (arm.name !== NAMES[armIndex] || !['completed', 'failed', 'blocked'].includes(arm.status)
        || !arm.diagnostics || typeof arm.diagnostics !== 'object'
        || entry.preflight.status === 'failed' && arm.status === 'completed'
        || (arm.status === 'completed') !== (arm.answer !== null)
        || (arm.status === 'completed') !== (arm.reason === null)
        || arm.reason !== null && (!wellFormed(arm.reason) || !SAFE_REASON.test(arm.reason))) {
        fail('invalid_mixed_report');
      }
      if (arm.answer !== null) {
        exact(arm.answer, ['text', 'usage'], 'invalid_mixed_report');
        exact(arm.answer.usage, ['inputTokens', 'outputTokens', 'costMicroUsd'], 'invalid_mixed_report');
        if (!wellFormed(arm.answer.text) || !arm.answer.text
          || Buffer.byteLength(arm.answer.text, 'utf8') > 32 * 1024
          || countOpenAITokens(arm.answer.text) > 512
          || !safeInteger(arm.answer.usage.inputTokens)
          || !safeInteger(arm.answer.usage.outputTokens)
          || arm.answer.usage.outputTokens > 512
          || !safeInteger(arm.answer.usage.costMicroUsd)) fail('invalid_mixed_report');
      }
      if (arm.scope !== null) {
        exact(arm.scope, ['ordinal', 'status', 'reason'], 'invalid_mixed_report');
        if (!safeInteger(arm.scope.ordinal) || !['active', 'completed', 'failed', 'blocked']
          .includes(arm.scope.status) || arm.scope.reason !== null
            && (!wellFormed(arm.scope.reason) || !SAFE_REASON.test(arm.scope.reason))) {
          fail('invalid_mixed_report');
        }
      }
      const position = roster.armOrder.indexOf(arm.name);
      const ordinal = index * 2 + position;
      const observed = actualScopes[ordinal];
      const expected = report.roster[index].arms.find(item => item.name === arm.name);
      if (guard.mixedSourcePairCapability.schedule?.[ordinal]?.caseId !== expected.scopeId
        || guard.mixedSourcePairCapability.schedule?.[ordinal]?.phase !== 'generation') {
        fail('invalid_mixed_report');
      }
      if (observed) {
        if (!arm.scope || arm.scope.ordinal !== ordinal || observed.ordinal !== ordinal
          || observed.phase !== 'generation' || observed.arm !== arm.name
          || observed.status !== arm.scope.status || observed.reason !== arm.scope.reason
          || arm.status === 'completed' && observed.status !== 'completed') {
          fail('invalid_mixed_report');
        }
      } else if (arm.scope) {
        if (!report.halted || ordinal !== actualScopes.length
          || lastSnapshot?.ordinal !== ordinal || lastSnapshot.phase !== 'generation'
          || lastSnapshot.arm !== arm.name || lastSnapshot.status !== arm.scope.status
          || lastSnapshot.reason !== arm.scope.reason) fail('invalid_mixed_report');
      } else if (arm.status !== 'blocked') fail('invalid_mixed_report');
    }
  }
  return freeze(report);
}

function validateEvaluators(rows, report) {
  const fixed = reportSnapshot(rows);
  dense(fixed, report.cases.length, report.cases.length, 'invalid_evaluator_rows');
  for (const [index, row] of fixed.entries()) {
    exact(row, ['question_id', 'source_question_id', 'question_type', 'reference_answer',
      'answer_session_ids', 'turn_labels'], 'invalid_evaluator_rows');
    if (row.question_id !== report.cases[index].questionId
      || !wellFormed(row.source_question_id) || !row.source_question_id
      || opaqueQuestionId(row.source_question_id) !== row.question_id
      || !OFFICIAL_QUESTION_TYPES.includes(row.question_type)) fail('invalid_evaluator_rows');
    dense(row.answer_session_ids, 0, 2500, 'invalid_evaluator_rows');
    dense(row.turn_labels, 0, 60000, 'invalid_evaluator_rows');
    if (row.answer_session_ids.some(id => !SESSION_ID.test(id))
      || new Set(row.answer_session_ids).size !== row.answer_session_ids.length
      || row.turn_labels.some(label => {
        exact(label, ['turn_id', 'has_answer'], 'invalid_evaluator_rows');
        return !TURN_ID.test(label.turn_id) || typeof label.has_answer !== 'boolean';
      }) || new Set(row.turn_labels.map(label => label.turn_id)).size !== row.turn_labels.length) {
      fail('invalid_evaluator_rows');
    }
    const reference = row.reference_answer;
    const scalar = item => wellFormed(item) || typeof item === 'number'
      && Number.isFinite(item);
    if (!(scalar(reference) || Array.isArray(reference) && reference.length > 0
      && reference.every(scalar))) fail('invalid_evaluator_rows');
  }
  // The Python-issued capability binds ordinary JSON objects. The strict
  // snapshot above has null-prototype containers; rehydrate only after full
  // validation, keeping the detached values and exact resolver comparison.
  return freeze(structuredClone(fixed));
}

const unresolved = (stage, reason, attempted = false) => ({ status: 'unresolved',
  correct: null, stage, reason, attempted });
function summary(cases) {
  const bucket = rows => {
    const values = { correct: 0, incorrect: 0, unresolved: 0 };
    for (const row of rows) values[row.judgment.status === 'unresolved'
      ? 'unresolved' : row.judgment.correct ? 'correct' : 'incorrect']++;
    const resolved = values.correct + values.incorrect;
    return { ...values, accuracyFixedN: rows.length ? values.correct / rows.length : null,
      accuracyResolved: resolved ? values.correct / resolved : null,
      resolvedFraction: rows.length ? resolved / rows.length : null };
  };
  const perArm = Object.fromEntries(NAMES.map(name => [name,
    bucket(cases.map(item => item.arms.find(arm => arm.name === name)))]));
  const outcomeTable = Object.fromEntries(OUTCOMES.map(a => [a,
    Object.fromEntries(OUTCOMES.map(b => [b, 0]))]));
  let commonResolvedN = 0;
  for (const item of cases) {
    const a = item.arms[0].judgment, b = item.arms[1].judgment;
    const left = a.status === 'unresolved' ? 'unresolved' : a.correct ? 'correct' : 'incorrect';
    const right = b.status === 'unresolved' ? 'unresolved' : b.correct ? 'correct' : 'incorrect';
    outcomeTable[left][right]++;
    if (left !== 'unresolved' && right !== 'unresolved') commonResolvedN++;
  }
  const byCategory = Object.fromEntries(OFFICIAL_QUESTION_TYPES.map(type => [type,
    { fixedN: cases.filter(item => item.questionType === type).length,
      perArm: Object.fromEntries(NAMES.map(name => [name, bucket(cases.filter(item =>
        item.questionType === type).map(item => item.arms.find(arm => arm.name === name))) ])) } ]));
  return { fixedN: cases.length, perArm, commonResolvedN, outcomeTable, byCategory };
}

export async function scoreMixedGeneration(options) {
  const { generationReport: rawReport, evaluatorRows, referenceRenderings, guard,
    apiKey } = optionsData(options);
  if (referenceRenderings !== undefined && !(referenceRenderings instanceof Map)
    || !wellFormed(apiKey)
    || !apiKey.trim() || /[\r\n]/u.test(apiKey)) fail('invalid_mixed_scoring');
  const generation = validateGeneration(rawReport, guard);
  const evaluators = validateEvaluators(evaluatorRows, generation);
  const renderings = referenceRenderings ?? new Map();
  if (renderings.size > generation.cases.length
    || [...renderings.keys()].some(key => !generation.cases.some(item =>
      item.questionId === key))) fail('invalid_reference_renderings');
  const digest = hash(GENERATION_DOMAIN, generation);
  const cases = generation.cases.map((entry, index) => ({
    questionId: entry.questionId, questionType: evaluators[index].question_type,
    arms: entry.arms.map(arm => ({ name: arm.name, generationStatus: arm.status,
      judgment: unresolved('generation', arm.reason ?? 'generation_unresolved'), scope: null })) }));
  let haltReason = generation.halted ? generation.haltReason
    : guard.isHalted() ? 'global_halt' : null;
  const allowedLocalOrdinals = haltReason ? new Set() : verifiedLocalOrdinals(guard);
  for (const [index, entry] of generation.cases.entries()) {
    if (haltReason) break;
    const evaluator = evaluators[index], resultCase = cases[index];
    for (const name of generation.roster[index].armOrder) {
      if (haltReason) break;
      const source = entry.arms.find(item => item.name === name);
      const resultArm = resultCase.arms.find(item => item.name === name);
      const identity = { phase: 'scoring', caseId: generation.roster[index].arms
        .find(item => item.name === name).scopeId };
      if (guard.isHalted() || unknownCurrentAttempt(guard, allowedLocalOrdinals)) {
        haltReason = 'global_accounting_unsettled'; break;
      }
      const transport = trackedTransport();
      let local = null, outcome, entered = false, workSettled = false;
      const priorScopes = guard.caseOutcomes().scopes.length;
      const priorJudgeAttempts = guard.attempts().filter(item => item.stage === 'judge').length;
      try {
        outcome = await guard.withCaseScope(identity, async handle => {
          entered = true;
          try {
            if (source.status !== 'completed') return unresolved('generation', source.reason);
            let reference = evaluator.reference_answer;
            if (typeof reference !== 'string') {
              try { reference = resolveReferenceRendering(renderings.get(entry.questionId), evaluator); }
              catch { return unresolved('compatibility', 'reference_rendering_unverified'); }
            }
            const prompt = officialPrompt({ questionType: evaluator.question_type,
              question: entry.question.text, reference, response: source.answer.text,
              abstention: evaluator.source_question_id.includes('_abs') });
            const request = officialJudgeRequest(prompt);
            try {
              const completed = await completionOnce({ guard, stage: 'judge', request,
                apiKey, timeoutMs: guard.stages.judge.timeoutMs, transport });
              return { status: 'resolved', correct: parseOfficialJudgeText(completed.text),
                stage: 'judge', reason: null, attempted: true };
            } catch (error) {
              return unresolved('judge', error instanceof MixedComparisonError
                && JUDGE_LOCAL_REASONS.has(error.code) ? error.code : 'judge_failed', true);
            }
          } finally { await transport.drain(); workSettled = true; }
        });
        local = outcome.value;
      } catch { haltReason = 'scope_execution_failed'; }
      if (entered || guard.caseOutcomes().scopes.length === priorScopes + 1) {
        const snapshot = guard.caseScopeSnapshot();
        resultArm.scope = snapshot ? { ordinal: snapshot.ordinal,
          status: snapshot.status, reason: snapshot.reason } : null;
      }
      if (guard.isHalted()) haltReason ??= 'global_halt';
      if (!haltReason && unknownCurrentAttempt(guard, allowedLocalOrdinals)
        && !authenticateLocalUnknown(guard, outcome, identity, allowedLocalOrdinals,
          { workSettled, transportSettled: transport.size === 0 })) {
        haltReason = 'global_accounting_unsettled';
      }
      resultArm.judgment = haltReason ? unresolved('judge', haltReason, entered)
        : outcome?.status === 'completed' && local ? local
          : unresolved(source.status === 'completed' ? 'judge' : 'generation',
            outcome?.reason ?? source.reason ?? 'judge_unresolved', false);
      resultArm.judgment.attempted = guard.attempts().filter(item =>
        item.stage === 'judge').length > priorJudgeAttempts;
    }
  }
  if (haltReason) for (const item of cases) for (const arm of item.arms) {
    if (arm.judgment.reason === 'generation_unresolved') arm.judgment.reason = haltReason;
  }
  return freeze(reportSnapshot({ schemaVersion: MIXED_SCORING_VERSION, generationDigest: digest,
    cases, summary: summary(cases), halted: haltReason !== null, haltReason }));
}

// Evaluator-only. The probe and transport never import this module or its rubric.
import { randomBytes } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { canonical, dense, exact, fail, freeze, sha256, snapshotJson, wellFormed } from '../longmemeval/mixed-validation.mjs';
import { RELATION_BINDING_VERSION, relationBindingArms, relationBindingId,
  validateRelationBindingInputs } from './relation-binding-profile.mjs';

const snapshot = value => JSON.parse(JSON.stringify(snapshotJson(value,
  { bytes: 2_000_000, nodes: 30_000, depth: 16 }, 'invalid_relation_binding_judgment')));
export function validateRelationBindingRubric(value) {
  const data = snapshot(value), code = 'invalid_relation_binding_rubric';
  exact(data, ['schemaVersion', 'cases'], code);
  if (data.schemaVersion !== `${RELATION_BINDING_VERSION}-rubric`) fail(code);
  exact(data.cases, Array.from({ length: 12 }, (_, index) => relationBindingId(index + 1)), code);
  let known = 0;
  for (const rule of Object.values(data.cases)) {
    exact(rule, ['answerability', 'requiredPropositions', 'acceptableQualifications', 'unsupportedClaims', 'staleUseCriteria', 'severeErrors'], code);
    if (!['known', 'uncertain'].includes(rule.answerability)) fail(code);
    known += rule.answerability === 'known';
    for (const field of ['requiredPropositions', 'acceptableQualifications', 'unsupportedClaims', 'staleUseCriteria', 'severeErrors']) {
      dense(rule[field], field === 'requiredPropositions' ? 1 : 0, 40, code);
      if (rule[field].some(text => !wellFormed(text) || !text.trim())) fail(code);
    }
  }
  if (known !== 6) fail(code);
  return freeze(data);
}
export function freezeRelationBindingRubric(bytes) {
  if (!wellFormed(bytes) || Buffer.byteLength(bytes) > 256_000) fail('invalid_relation_binding_rubric');
  return freeze({ bytes, sha256: sha256(bytes), rubric: validateRelationBindingRubric(JSON.parse(bytes)) });
}
export const loadRelationBindingRubric = () => freezeRelationBindingRubric(
  readFileSync(new URL('./relation-binding-rubric.json', import.meta.url), 'utf8'));
function frozenRubric(report, input) {
  const data = snapshot(input); exact(data, ['bytes', 'sha256', 'rubric'], 'invalid_relation_binding_rubric');
  const observed = freezeRelationBindingRubric(data.bytes);
  if (observed.sha256 !== data.sha256 || observed.sha256 !== report.rubricSha256
    || canonical(observed.rubric) !== canonical(data.rubric)) fail('relation_binding_rubric_mismatch');
  return observed.rubric;
}

function requireReport(input) {
  const report = snapshot(input);
  if (report.schemaVersion !== `${RELATION_BINDING_VERSION}-result` || report.denominator !== 24
    || report.sourceDenominator !== 12 || report.cells?.length !== 24
    || ![report.sourceSha256, report.rubricSha256].every(value => typeof value === 'string' && /^[a-f0-9]{64}$/u.test(value))) fail('invalid_relation_binding_report');
  validateRelationBindingInputs(report.sourceSnapshot);
  const seen = new Set();
  for (const cell of report.cells) {
    if (!report.sourceSnapshot.cases.some(row => row.id === cell.id)
      || !relationBindingArms.includes(cell.arm) || cell.cellId !== `${cell.id}-${cell.arm}` || seen.has(cell.cellId)
      || !['completed', 'unresolved'].includes(cell.status)
      || cell.status === 'completed' && (!wellFormed(cell.answer) || !cell.answer.trim())) fail('invalid_relation_binding_report');
    seen.add(cell.cellId);
  }
  return report;
}
export function buildBlindRelationBindingPacket(input, rubricInput) {
  const report = requireReport(input), rubric = frozenRubric(report, rubricInput), mapping = [];
  const items = report.cells.map(cell => {
    const label = randomBytes(16).toString('hex'); mapping.push({ label, cellId: cell.cellId });
    const source = report.sourceSnapshot.cases.find(row => row.id === cell.id);
    return { label, question: source.question, sourceUnits: source.sourceUnits,
      rubric: rubric.cases[cell.id], answer: cell.answer, status: cell.status, failure: cell.failure };
  }).sort((a, b) => a.label.localeCompare(b.label));
  return freeze({ packet: { schemaVersion: `${RELATION_BINDING_VERSION}-blind`, denominator: 24,
    instructions: 'Judge requested correctness, unsupported/stale/severe claims, abstention, and targeted entity/time/scope bindingError separately. bindingError is true only for a wrong or unsupported requested relation binding, not any incorrect answer or optional unrelated claim. Use null/unknown when unassessable. Do not infer truth from citations; preserve first independent submissions and unresolved ambiguity.', items }, mapping });
}
export function unblindRelationBindingJudgments({ reviewerId, judgments }, mapping) {
  const code = 'invalid_relation_binding_judgment', data = snapshot({ reviewerId, judgments, mapping });
  dense(data.mapping, 24, 24, code); dense(data.judgments, 0, 24, code);
  const labels = new Map(), cells = new Set(), seen = new Set();
  for (const row of data.mapping) {
    exact(row, ['label', 'cellId'], code);
    if (!/^[a-f0-9]{32}$/u.test(row.label) || !/^R(?:0[1-9]|1[0-2])-(?:baseline|relation)$/u.test(row.cellId)
      || labels.has(row.label) || cells.has(row.cellId)) fail(code);
    labels.set(row.label, row.cellId); cells.add(row.cellId);
  }
  return { reviewerId: data.reviewerId, judgments: data.judgments.map(row => {
    exact(row, ['label', 'verdict', 'unsupported', 'stale', 'severeError', 'bindingError', 'abstained'], code);
    if (!labels.has(row.label)) fail('invalid_relation_binding_judgment');
    if (seen.has(row.label)) fail(code); seen.add(row.label);
    const { label, ...fields } = row;
    return { cellId: labels.get(label), ...fields };
  }) };
}
function judgments(input, report) {
  const data = snapshot(input), code = 'invalid_relation_binding_judgment';
  exact(data, ['reviewerId', 'judgments'], code);
  if (!wellFormed(data.reviewerId) || !data.reviewerId.trim()) fail(code);
  dense(data.judgments, 0, 24, code); const rows = new Map();
  for (const row of data.judgments) {
    exact(row, ['cellId', 'verdict', 'unsupported', 'stale', 'severeError', 'bindingError', 'abstained'], code);
    if (!report.cells.some(cell => cell.cellId === row.cellId) || rows.has(row.cellId)
      || !['correct', 'incorrect', 'unresolved'].includes(row.verdict)
      || !['clean', 'positive', 'unknown'].includes(row.unsupported)
      || !['clean', 'positive', 'unknown'].includes(row.stale)
      || !['severeError', 'bindingError', 'abstained'].every(field => row[field] === null || typeof row[field] === 'boolean')) fail(code);
    if (row.bindingError === true && row.verdict === 'correct' && row.unsupported === 'clean') fail(code);
    rows.set(row.cellId, row);
  }
  return { reviewerId: data.reviewerId, rows };
}
export function aggregateRelationBindingJudgments({ report: input, rubric: rubricInput,
  judgmentsA, judgmentsB, resourcesWithinLimits }) {
  const report = requireReport(input), rubric = frozenRubric(report, rubricInput);
  if (typeof resourcesWithinLimits !== 'boolean') fail('invalid_relation_binding_resources');
  const a = judgments(judgmentsA, report), b = judgments(judgmentsB, report);
  if (a.reviewerId === b.reviewerId) fail('invalid_relation_binding_judgment');
  const outcomes = report.cells.map(cell => {
    const first = a.rows.get(cell.cellId), second = b.rows.get(cell.cellId);
    const same = field => cell.status === 'completed' && first && second && first[field] === second[field];
    return { cellId: cell.cellId, id: cell.id, arm: cell.arm, answerability: rubric.cases[cell.id].answerability,
      verdict: same('verdict') ? first.verdict : 'unresolved',
      unsupported: same('unsupported') ? first.unsupported : 'unknown', stale: same('stale') ? first.stale : 'unknown',
      severeError: same('severeError') ? first.severeError : null,
      bindingError: same('bindingError') ? first.bindingError : null, abstained: same('abstained') ? first.abstained : null };
  });
  const arms = Object.fromEntries(relationBindingArms.map(arm => {
    const rows = outcomes.filter(row => row.arm === arm);
    return [arm, { denominator: 12, correct: rows.filter(row => row.verdict === 'correct').length,
      incorrect: rows.filter(row => row.verdict === 'incorrect').length, unresolved: rows.filter(row => row.verdict === 'unresolved').length,
      unsupported: rows.filter(row => row.unsupported === 'positive').length, stale: rows.filter(row => row.stale === 'positive').length,
      severe: rows.filter(row => row.severeError === true).length,
      knownCorrect: rows.filter(row => row.answerability === 'known' && row.verdict === 'correct').length,
      knownAbstained: rows.filter(row => row.answerability === 'known' && row.abstained === true).length,
      uncertainCorrect: rows.filter(row => row.answerability === 'uncertain' && row.verdict === 'correct').length,
      targetedBindingErrors: rows.filter(row => row.bindingError === true && (row.verdict === 'incorrect' || row.unsupported === 'positive')).length }];
  }));
  const paired = report.sourceSnapshot.cases.map(row => {
    const baseline = outcomes.find(item => item.id === row.id && item.arm === 'baseline');
    const relation = outcomes.find(item => item.id === row.id && item.arm === 'relation');
    return { id: row.id, answerability: baseline.answerability, baseline: baseline.verdict, relation: relation.verdict,
      outcome: baseline.verdict === 'unresolved' || relation.verdict === 'unresolved' ? 'unresolved'
        : baseline.verdict === 'correct' ? relation.verdict === 'correct' ? 'both-correct' : 'loss'
          : relation.verdict === 'correct' ? 'win' : 'neither-correct',
      newSevere: baseline.severeError === false && relation.severeError === true };
  });
  const netCorrect = arms.relation.correct - arms.baseline.correct;
  const gates = { noFatal: report.fatal === null && report.accountingFailure === null && report.completed === 24,
    baselineOpportunities: arms.baseline.targetedBindingErrors >= 2,
    positiveQA: netCorrect > 0,
    knownNoRegression: !paired.some(row => row.answerability === 'known' && row.outcome === 'loss')
      && arms.relation.knownAbstained <= arms.baseline.knownAbstained,
    knownUseful: arms.relation.knownCorrect > 0,
    safetyKnown: outcomes.every(row => row.unsupported !== 'unknown' && row.stale !== 'unknown'
      && row.severeError !== null && row.bindingError !== null && row.abstained !== null),
    correctnessKnown: outcomes.every(row => row.verdict !== 'unresolved'),
    noNewHarm: arms.relation.unsupported <= arms.baseline.unsupported && arms.relation.stale <= arms.baseline.stale
      && !paired.some(row => row.newSevere), resourcesWithinLimits };
  const positiveSignal = Object.values(gates).every(Boolean);
  const acceptableControl = gates.noFatal && gates.knownNoRegression && gates.knownUseful
    && gates.noNewHarm && gates.safetyKnown && gates.correctnessKnown && resourcesWithinLimits;
  const decision = positiveSignal ? 'fresh-full-pipeline-validation-only'
    : acceptableControl && netCorrect >= 0 && (!gates.baselineOpportunities || netCorrect === 0)
      ? 'inconclusive-stop' : 'reject-stop';
  return freeze({ schemaVersion: `${RELATION_BINDING_VERSION}-aggregate`, denominator: 24, sourceDenominator: 12,
    arms, paired, outcomes, netCorrect, gates, positiveSignal, decision, advances: false,
    limitation: 'Answer-only development diagnostic; no causal repair, holdout, core MOC gain or promotion. Preserve old scores and do not tune/rerun this corpus.' });
}

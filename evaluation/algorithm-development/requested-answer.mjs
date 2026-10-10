// Evaluator/preflight only. Never imported by model execution.
import { readFile } from 'node:fs/promises';
import { loadModelInputs, loadEvaluatorRubric, validateEvaluatorRubric, hashCanonicalValue } from './corpus.mjs';
import { buildBlindDevelopmentPacket, JUDGING_PROTOCOL } from './judging.mjs';
import { aggregateDevelopmentJudgments } from './evaluator.mjs';
import { freeze, snapshotJson } from '../longmemeval/mixed-validation.mjs';

export const REQUESTED_ANSWER_VERSION = 'algorithm-development-requested-answer-v2';
export const REQUESTED_ANSWER_PROTOCOL = freeze({ ...JUDGING_PROTOCOL,
  version: 'source-diverse-requested-answer-blind-judging-v1',
  instructions: [...JUDGING_PROTOCOL.instructions,
    'Correctness requires only requested propositions and necessary scope/time/uncertainty conditions, not full context narration.',
    'Concise-correct and equally correct explained answers receive the same correctness verdict. Do not reward length, rationale or repeating non-scoring background.',
    'Examples are prospective calibration controls, not observed model answers, an exact-string matcher or a semantic parser. Paraphrases and appropriate language equivalents are valid.',
    'Optional background and source chains are not additional QA requirements. Judge every factual claim actually made for support/staleness, including optional explanations.',
    'Use full original histories for QA truth and actual packed evidence separately for support; a source-correct answer may still be unsupported by its packed evidence.',
    'A generic unknown answer is not sufficient when the requested known information is available; preserve reported conflicts and partial confirmations.',
  ], dataStatus: 'previously-seen-authored-development-not-holdout',
});
const fields = ['variant', 'acceptableQualifications', 'anchors', 'requiredMultiSourceSets', 'unsupportedClaims', 'staleUseCriteria', 'severeErrors'];
function exact(value, names) {
  if (!value || typeof value !== 'object' || Array.isArray(value)
    || Object.keys(value).sort().join() !== [...names].sort().join()) throw new TypeError('invalid requested-answer rubric');
}
function strings(value, minimum = 0) {
  if (!Array.isArray(value) || value.length < minimum || value.some(text => typeof text !== 'string' || !text.trim())) throw new TypeError('invalid requested-answer rubric strings');
}
/** Compile requested QA criteria into the existing verified evaluator contract.
 * All original anchors/multi-source/safety fields remain byte-value identical.
 * Background/examples stay separate and cannot enter requiredPropositions.
 */
export function compileRequestedAnswerRubric({ modelInputs, originalRubric, qaRubric }) {
  validateEvaluatorRubric(originalRubric, modelInputs);
  const qa = snapshotJson(qaRubric, { bytes: 100_000, nodes: 2000, depth: 8 }, 'invalid_requested_answer_rubric');
  exact(qa, ['version', 'authoredFrom', 'correctness', 'cases']);
  if (qa.version !== REQUESTED_ANSWER_VERSION || qa.authoredFrom !== 'original-question-source-v1'
    || qa.correctness !== 'requested-answer-not-context-completeness') throw new TypeError('wrong requested-answer identity');
  exact(qa.cases, modelInputs.map(row => row.id));
  const evaluatorRubric = structuredClone(originalRubric);
  for (const { id } of modelInputs) {
    const rule = qa.cases[id]; exact(rule, ['requiredPropositions', 'optionalBackground', 'examples']);
    strings(rule.requiredPropositions, 1); strings(rule.optionalBackground);
    exact(rule.examples, ['conciseCorrect', 'explainedCorrect', 'incorrect']); strings(Object.values(rule.examples), 3);
    if (new Set(Object.values(rule.examples)).size !== 3) throw new TypeError('examples must be distinct');
    evaluatorRubric.cases[id].requiredPropositions = [...rule.requiredPropositions];
    for (const field of fields) if (hashCanonicalValue(evaluatorRubric.cases[id][field]) !== hashCanonicalValue(originalRubric.cases[id][field])) throw new TypeError('original safety/anchor field changed');
  }
  validateEvaluatorRubric(evaluatorRubric, modelInputs);
  const hashes = { modelInputs: hashCanonicalValue(modelInputs), originalRubric: hashCanonicalValue(originalRubric),
    qaRubric: hashCanonicalValue(qa), judgingProtocol: hashCanonicalValue(REQUESTED_ANSWER_PROTOCOL),
    compiledRubric: hashCanonicalValue(evaluatorRubric) };
  hashes.freeze = hashCanonicalValue({ version: REQUESTED_ANSWER_VERSION, ...hashes });
  return freeze({ version: REQUESTED_ANSWER_VERSION, modelInputs: structuredClone(modelInputs),
    evaluatorRubric, qaRubric: JSON.parse(JSON.stringify(qa)), protocol: REQUESTED_ANSWER_PROTOCOL, hashes });
}
export async function loadRequestedAnswerFreeze({ qaRubricPath = new URL('./qa-rubric-v2.json', import.meta.url), ...options } = {}) {
  const modelInputs = await loadModelInputs(options), originalRubric = await loadEvaluatorRubric(modelInputs, options);
  const qaRubric = JSON.parse(await readFile(qaRubricPath, 'utf8'));
  return compileRequestedAnswerRubric({ modelInputs, originalRubric, qaRubric });
}
function requireReport(report) {
  if (report?.schemaVersion !== 'source-diverse-requested-answer-comparison-v1'
    || report.treatment !== 'source-diverse-v1' || report.armPolicies?.full !== 'source-diverse-v1'
    || report.armPolicies?.baseline !== 'ordinary-v1') throw new TypeError('wrong requested-answer report');
}
export function buildBlindRequestedAnswerPacket({ report, freeze: frozen }) {
  requireReport(report);
  if (frozen?.version !== REQUESTED_ANSWER_VERSION || hashCanonicalValue(frozen.protocol) !== hashCanonicalValue(REQUESTED_ANSWER_PROTOCOL)) throw new TypeError('wrong requested-answer freeze');
  const result = buildBlindDevelopmentPacket({ observations: report.observations, ...frozen });
  result.packet.protocol = REQUESTED_ANSWER_PROTOCOL;
  result.packet.rubricIdentity = { version: frozen.version, hashes: frozen.hashes };
  for (const item of result.packet.items) {
    const original = result.mapping.find(row => row.label === item.label);
    const calibration = frozen.qaRubric.cases[original.id];
    item.nonScoringCalibration = { optionalBackground: calibration.optionalBackground, examples: calibration.examples };
  }
  return freeze(result);
}
/** Reuse agreement-only aggregation; add the prospective gate, never rescore v1. */
export function aggregateRequestedAnswerJudgments({ report, judgmentsA, judgmentsB, coverage, resourcesWithinLimits }) {
  requireReport(report);
  if (coverage?.schemaVersion !== 'source-diverse-requested-answer-coverage-v1' || typeof resourcesWithinLimits !== 'boolean') throw new TypeError('missing requested-answer gate evidence');
  const result = aggregateDevelopmentJudgments({ observations: report.observations, judgmentsA, judgmentsB });
  return freeze({ ...result, schemaVersion: 'source-diverse-requested-answer-judgments-v1',
    armPolicies: report.armPolicies, coverageGain: coverage.gain, resourcesWithinLimits,
    advances: report.fatal === null && result.paired.netCorrect >= 3 && coverage.gain > 0
      && !result.safety.blocksAdvancement && resourcesWithinLimits });
}

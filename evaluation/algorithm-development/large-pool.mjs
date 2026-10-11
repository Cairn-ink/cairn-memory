// Evaluator/preflight only. Model execution imports large-pool-profile.mjs instead.
import { readFile } from 'node:fs/promises';
import { hashCanonicalValue } from './corpus.mjs';
import { LARGE_POOL_VERSION, largePoolArms, largePoolPolicies, freezeLargePool,
  exactLargePool, largePoolString, validateLargePoolInputs, loadLargePoolInputs, requireLargePoolReport } from './large-pool-profile.mjs';
import { prepareAlgorithmDevelopmentCase } from './runner.mjs';
import { REQUESTED_ANSWER_PROTOCOL } from './requested-answer.mjs';
import { buildBlindLargePoolDevelopmentPacket } from './judging.mjs';
import { aggregateLargePoolDevelopmentJudgments } from './evaluator.mjs';
import { assembleComplementarySourceSet } from '../experiments/cloud-retrieval-v1/candidate.mjs';

export const LARGE_POOL_PROTOCOL = freezeLargePool({ ...REQUESTED_ANSWER_PROTOCOL,
  version: `${LARGE_POOL_VERSION}-blind-judging`, dataStatus: 'fresh-authored-development-not-holdout',
  comparison: 'coupled-natural-raw-trace-replay-not-standalone-end-to-end' });
const strings = (value, min = 0) => {
  if (!Array.isArray(value) || value.length < min) throw new TypeError('invalid large-pool rubric strings');
  value.forEach(largePoolString);
};
export function validateLargePoolRubric(rubric, modelInputs) {
  validateLargePoolInputs(modelInputs);
  exactLargePool(rubric, ['version', 'spanOffsetUnit', 'cases']);
  if (rubric.version !== LARGE_POOL_VERSION || rubric.spanOffsetUnit !== 'utf16-code-unit') throw new TypeError('wrong large-pool rubric');
  exactLargePool(rubric.cases, modelInputs.map(source => source.id));
  for (const source of modelInputs) {
    const rule = rubric.cases[source.id];
    exactLargePool(rule, ['variant', 'requiredPropositions', 'acceptableQualifications', 'anchors', 'requiredMultiSourceSets',
      'unsupportedClaims', 'staleUseCriteria', 'severeErrors', 'optionalBackground', 'examples']);
    largePoolString(rule.variant); strings(rule.requiredPropositions, 1);
    for (const name of ['acceptableQualifications', 'unsupportedClaims', 'staleUseCriteria', 'severeErrors', 'optionalBackground']) strings(rule[name]);
    exactLargePool(rule.examples, ['conciseCorrect', 'explainedCorrect', 'incorrect']); Object.values(rule.examples).forEach(largePoolString);
    if (new Set(Object.values(rule.examples)).size !== 3) throw new TypeError('large-pool calibration must be distinct');
    if (!Array.isArray(rule.anchors) || !Array.isArray(rule.requiredMultiSourceSets)) throw new TypeError('invalid large-pool anchors');
    const seen = new Set();
    for (const anchor of rule.anchors) {
      exactLargePool(anchor, ['sessionId', 'messageIndex', 'start', 'end', 'text']); largePoolString(anchor.text);
      const session = source.sessions.find(item => item.id === anchor.sessionId), text = session?.messages[anchor.messageIndex]?.content;
      if (!Number.isSafeInteger(anchor.messageIndex) || anchor.messageIndex < 0 || !text
        || !Number.isSafeInteger(anchor.start) || !Number.isSafeInteger(anchor.end) || anchor.start < 0
        || anchor.end <= anchor.start || anchor.end > text.length || text.slice(anchor.start, anchor.end) !== anchor.text) throw new TypeError('unbound large-pool anchor');
      for (const boundary of [anchor.start, anchor.end]) if (boundary > 0 && boundary < text.length
        && /[\uD800-\uDBFF]/u.test(text[boundary - 1]) && /[\uDC00-\uDFFF]/u.test(text[boundary])) throw new TypeError('anchor bisects Unicode');
      const key = JSON.stringify([anchor.sessionId, anchor.messageIndex, anchor.start, anchor.end]);
      if (seen.has(key)) throw new TypeError('duplicate large-pool anchor'); seen.add(key);
    }
    for (const set of rule.requiredMultiSourceSets) {
      if (!Array.isArray(set) || set.length < 2 || new Set(set).size !== set.length || set.some(index => !Number.isSafeInteger(index)
        || index < 0 || index >= rule.anchors.length) || new Set(set.map(index => JSON.stringify([
          rule.anchors[index].sessionId, rule.anchors[index].messageIndex]))).size < 2) throw new TypeError('invalid large-pool multi-source set');
    }
  }
  return rubric;
}
export async function loadLargePoolFreeze({ rubricPath = new URL('./large-pool-rubric.json', import.meta.url), ...options } = {}) {
  const modelInputs = await loadLargePoolInputs(options);
  const evaluatorRubric = validateLargePoolRubric(JSON.parse(await readFile(rubricPath, 'utf8')), modelInputs);
  for (const source of modelInputs) if (prepareAlgorithmDevelopmentCase(source).plan.cairnPlan.batches.length !== 6) throw new TypeError('large-pool batch count changed');
  const hashes = { modelInputs: hashCanonicalValue(modelInputs), evaluatorRubric: hashCanonicalValue(evaluatorRubric),
    judgingProtocol: hashCanonicalValue(LARGE_POOL_PROTOCOL) };
  hashes.freeze = hashCanonicalValue({ version: LARGE_POOL_VERSION, ...hashes });
  return freezeLargePool({ version: LARGE_POOL_VERSION, modelInputs, evaluatorRubric,
    protocol: LARGE_POOL_PROTOCOL, hashes });
}
function requireFreeze(frozen) {
  validateLargePoolRubric(frozen.evaluatorRubric, frozen.modelInputs);
  const hashes = { modelInputs: hashCanonicalValue(frozen.modelInputs), evaluatorRubric: hashCanonicalValue(frozen.evaluatorRubric),
    judgingProtocol: hashCanonicalValue(LARGE_POOL_PROTOCOL) };
  if (frozen.version !== LARGE_POOL_VERSION || hashCanonicalValue(frozen.protocol) !== hashes.judgingProtocol
    || Object.keys(frozen.hashes ?? {}).sort().join() !== 'evaluatorRubric,freeze,judgingProtocol,modelInputs'
    || Object.entries(hashes).some(([name, value]) => frozen.hashes[name] !== value)
    || frozen.hashes.freeze !== hashCanonicalValue({ version: LARGE_POOL_VERSION, ...hashes })) throw new TypeError('wrong large-pool freeze');
}
export function buildBlindLargePoolPacket({ report, freeze: frozen }) {
  requireLargePoolReport(report); requireFreeze(frozen);
  const result = structuredClone(buildBlindLargePoolDevelopmentPacket({ observations: report.observations, ...frozen }));
  result.packet.protocol = LARGE_POOL_PROTOCOL;
  result.packet.rubricIdentity = { version: LARGE_POOL_VERSION, hashes: frozen.hashes };
  for (const item of result.packet.items) {
    const mapping = result.mapping.find(row => row.label === item.label), rule = frozen.evaluatorRubric.cases[mapping.id];
    delete item.rubric.optionalBackground; delete item.rubric.examples;
    item.nonScoringCalibration = { optionalBackground: rule.optionalBackground, examples: rule.examples };
  }
  return freezeLargePool(result);
}
export function aggregateLargePoolJudgments({ report, judgmentsA, judgmentsB, coverage, resourcesWithinLimits }) {
  requireLargePoolReport(report);
  if (coverage?.schemaVersion !== `${LARGE_POOL_VERSION}-coverage` || !Number.isSafeInteger(coverage.gain)
    || !Number.isSafeInteger(coverage.lexicalPackedGain) || typeof resourcesWithinLimits !== 'boolean') throw new TypeError('missing large-pool gate evidence');
  const result = aggregateLargePoolDevelopmentJudgments({ observations: report.observations, judgmentsA, judgmentsB });
  const audit = auditLargePoolComparison(report);
  if (coverage.reportSha256 !== hashCanonicalValue(report)) throw new TypeError('coverage is not bound to large-pool report');
  const eligibleCases = audit.filter(row => row.eligible).map(row => row.id);
  const gates = { noFatal: report.fatal === null, eligibleCases: eligibleCases.length >= 4,
    pairingIntegrity: audit.every(row => row.integrity),
    correctnessResolved: largePoolArms.every(name => result.arms[name].unresolved === 0),
    positiveQA: result.paired.complementaryLinked.netCorrect > 0,
    positivePackedGain: coverage.gain > 0 && coverage.lexicalPackedGain > 0,
    safety: !result.safety.blocksAdvancement, resourcesWithinLimits };
  return freezeLargePool({ ...result, armPolicies: largePoolPolicies, eligibleCases,
    lexicalBranchExercised: eligibleCases.length > 0, coverageGain: coverage.gain, lexicalPackedGain: coverage.lexicalPackedGain,
    gates, supportsFurtherDevelopment: Object.values(gates).every(value => value === true),
    productPromotion: false, stage3: false, oldD12Repaired: false,
    decision: Object.values(gates).every(value => value === true) ? 'further-development-only'
      : !eligibleCases.length ? 'precondition-unmet' : result.safety.blocksAdvancement || result.paired.complementaryLinked.netCorrect < 0 ? 'reject' : 'inconclusive' });
}

/** Recompute from actual raw calls; recorded mechanism/pairing flags earn no credit. */
export function auditLargePoolComparison(report) {
  requireLargePoolReport(report);
  return report.observations.map(row => {
    const natural = row.arms[row.order[0]], replay = row.arms[row.order[1]];
    const bytes = call => JSON.stringify({ method: call.method, system: call.system, input: call.input,
      maxOutputTokens: call.maxOutputTokens, output: call.output });
    const integrity = Boolean(natural.recalled && replay.recalled) && natural.modelCalls.length === replay.modelCalls.length
      && natural.modelCalls.every((call, index) => call.origin === 'natural-model' && replay.modelCalls[index].origin === 'replay'
        && !call.failure && !replay.modelCalls[index].failure && ['select', 'rank'].includes(call.method)
        && bytes(call) === bytes(replay.modelCalls[index]))
      && replay.records.every(record => record.method === 'answer')
      && [natural, replay].every(arm => arm.stateBefore === row.capture.stateSha256 && arm.stateAfter === row.capture.stateSha256);
    const arm = row.arms.complementary, trace = arm.effectiveRanks?.[0], raw = arm.modelCalls.find(call => call.method === 'rank');
    let compiled;
    try { if (raw?.output && trace) compiled = assembleComplementarySourceSet(trace.input, raw.output); } catch { /* malformed is ineligible */ }
    return { id: row.id, integrity, rankCandidateCount: trace?.input?.candidates?.length ?? null,
      eligible: Boolean(integrity && compiled && trace.input.limit === 6 && trace.input.candidates.length > 6
        && raw.output.refs.length > 0 && raw.output.refs.length < 6 && compiled.diagnostics.reason === 'lexical_bridges'),
      addedRefs: compiled?.diagnostics.addedRefs ?? [], reason: compiled?.diagnostics.reason ?? null };
  });
}

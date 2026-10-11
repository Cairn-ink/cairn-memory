// Evaluator/preflight only; never imported by execution or candidate ranking.
import { loadRequestedAnswerFreeze, REQUESTED_ANSWER_PROTOCOL, REQUESTED_ANSWER_VERSION } from './requested-answer.mjs';
import { hashCanonicalValue } from './corpus.mjs';
import { buildBlindComplementaryDevelopmentPacket } from './judging.mjs';
import { aggregateComplementaryDevelopmentJudgments } from './evaluator.mjs';
import { freeze } from '../longmemeval/mixed-validation.mjs';
import { COMPLEMENTARY_VERSION, requireComplementaryReport } from './complementary-profile.mjs';

export const COMPLEMENTARY_PROTOCOL = freeze({ ...REQUESTED_ANSWER_PROTOCOL,
  version: `${COMPLEMENTARY_VERSION}-blind-judging-v1` });
const withoutFreeze = hashes => Object.fromEntries(Object.entries(hashes).filter(([name]) => name !== 'freeze'));
export async function loadComplementarySourceFreeze(options) {
  const original = await loadRequestedAnswerFreeze(options);
  const hashes = { ...withoutFreeze(original.hashes), judgingProtocol: hashCanonicalValue(COMPLEMENTARY_PROTOCOL) };
  const version = `${COMPLEMENTARY_VERSION}-freeze-v1`;
  hashes.freeze = hashCanonicalValue({ version, ...hashes, originalHashes: original.hashes });
  return freeze({ ...original, version, rubricVersion: original.version,
    protocol: COMPLEMENTARY_PROTOCOL, originalHashes: original.hashes, hashes });
}
function requireFreeze(frozen) {
  const old = frozen?.originalHashes, hashes = frozen?.hashes;
  if (frozen?.version !== `${COMPLEMENTARY_VERSION}-freeze-v1` || frozen.rubricVersion !== REQUESTED_ANSWER_VERSION
    || hashCanonicalValue(frozen.protocol) !== hashCanonicalValue(COMPLEMENTARY_PROTOCOL)
    || !old || !hashes || old.judgingProtocol !== hashCanonicalValue(REQUESTED_ANSWER_PROTOCOL)
    || hashes.judgingProtocol !== hashCanonicalValue(COMPLEMENTARY_PROTOCOL)
    || ['modelInputs', 'originalRubric', 'qaRubric', 'compiledRubric'].some(name => hashes[name] !== old[name])
    || hashes.modelInputs !== hashCanonicalValue(frozen.modelInputs)
    || hashes.qaRubric !== hashCanonicalValue(frozen.qaRubric)
    || hashes.compiledRubric !== hashCanonicalValue(frozen.evaluatorRubric)
    || old.freeze !== hashCanonicalValue({ version: REQUESTED_ANSWER_VERSION, ...withoutFreeze(old) })
    || hashes.freeze !== hashCanonicalValue({ version: frozen.version, ...withoutFreeze(hashes), originalHashes: old })) {
    throw new TypeError('wrong complementary freeze');
  }
}
export function buildBlindComplementarySourcePacket({ report, freeze: frozen }) {
  requireComplementaryReport(report); requireFreeze(frozen);
  const result = buildBlindComplementaryDevelopmentPacket({ observations: report.observations, ...frozen });
  result.packet.protocol = COMPLEMENTARY_PROTOCOL;
  result.packet.rubricIdentity = { version: frozen.rubricVersion, hashes: frozen.originalHashes };
  result.packet.comparisonIdentity = { version: frozen.version, hashes: frozen.hashes };
  for (const item of result.packet.items) {
    const original = result.mapping.find(row => row.label === item.label);
    const calibration = frozen.qaRubric.cases[original.id];
    item.nonScoringCalibration = { optionalBackground: calibration.optionalBackground, examples: calibration.examples };
  }
  return freeze(result);
}
export function aggregateComplementarySourceJudgments({ report, judgmentsA, judgmentsB, coverage, resourcesWithinLimits }) {
  requireComplementaryReport(report);
  if (coverage?.schemaVersion !== `${COMPLEMENTARY_VERSION}-coverage-v1` || coverage.anchorDenominator !== 42
    || coverage.paired?.complementaryBaseline?.denominator !== 42 || coverage.paired?.complementaryLinked?.denominator !== 42
    || !Number.isSafeInteger(coverage.paired.complementaryBaseline.gain)
    || !Number.isSafeInteger(coverage.paired.complementaryLinked.gain)
    || typeof resourcesWithinLimits !== 'boolean') throw new TypeError('missing complementary gate evidence');
  const result = aggregateComplementaryDevelopmentJudgments({ observations: report.observations, judgmentsA, judgmentsB });
  const gates = { noFatal: report.fatal === null, primaryQA: result.paired.complementaryBaseline.netCorrect >= 3,
    primaryPackedGain: coverage.paired.complementaryBaseline.gain > 0,
    linkedQANoRegression: result.paired.complementaryLinked.netCorrect >= 0,
    linkedPackedNoRegression: coverage.paired.complementaryLinked.gain >= 0,
    safety: !result.safety.blocksAdvancement, resourcesWithinLimits };
  const advances = Object.values(gates).every(value => value === true);
  return freeze({ ...result, armPolicies: report.armPolicies, coverageGain: coverage.paired,
    resourcesWithinLimits, gates, advances,
    incrementalSuperiority: advances && result.paired.complementaryLinked.netCorrect > 0 });
}

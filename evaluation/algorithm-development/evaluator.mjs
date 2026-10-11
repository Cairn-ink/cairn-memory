import { DEVELOPMENT_ROSTER } from './corpus.mjs';
import { complementaryArms, COMPLEMENTARY_VERSION } from './complementary-profile.mjs';

// Evaluator-only aggregation of two independent blind judgment files. No model calls.
const ARMS = ['baseline', 'full'];
const roster = new Map(DEVELOPMENT_ROSTER.map(item => [item.id, item]));
const verdicts = ['correct', 'incorrect', 'unresolved'];
const counts = () => ({ denominator: 24, completed: 0, correct: 0, incorrect: 0, unresolved: 0,
  unsupported: 0, stale: 0, unsupportedUnknown: 0, staleUnknown: 0, severeErrors: 0, severeUnknown: 0 });

function fail(message) { throw new TypeError(message); }
function array(value, label, max) {
  if (!Array.isArray(value) || value.length > max) fail(`${label}: invalid array`);
}
function identity(id, arm, arms = ARMS) {
  if (!roster.has(id)) fail(`unknown development case: ${id}`);
  if (!arms.includes(arm)) fail(`unknown development arm: ${arm}`);
  return `${id}/${arm}`;
}
function judgmentMap(values, label, arms = ARMS) {
  array(values, label, 24 * arms.length);
  const result = new Map();
  for (const value of values) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) fail(`${label}: invalid judgment`);
    const key = identity(value.id, value.arm, arms);
    if (result.has(key)) fail(`${label}: duplicate judgment ${key}`);
    const fields = ['id', 'arm', 'verdict', 'reviewedClaims', 'unsupportedClaims', 'staleClaims', 'severeError', 'rationale'];
    if (Object.keys(value).sort().join(',') !== fields.sort().join(',')) fail(`${label}: invalid judgment fields`);
    if (!verdicts.includes(value.verdict)) fail(`${label}: invalid verdict`);
    for (const field of ['reviewedClaims', 'unsupportedClaims', 'staleClaims']) {
      if (!Number.isSafeInteger(value[field]) || value[field] < 0) fail(`${label}: invalid ${field}`);
    }
    if (value.unsupportedClaims > value.reviewedClaims || value.staleClaims > value.reviewedClaims) fail(`${label}: affected claims exceed reviewed claims`);
    if (![true, false, null].includes(value.severeError)) fail(`${label}: invalid severeError`);
    if (typeof value.rationale !== 'string' || !value.rationale.trim()) fail(`${label}: missing rationale`);
    result.set(key, value);
  }
  return result;
}
function observationMap(values, arms = ARMS) {
  array(values, 'observations', 24);
  const result = new Map();
  for (const value of values) {
    if (!value || typeof value !== 'object' || Array.isArray(value) || !roster.has(value.id)) fail('observations: unknown case');
    if (result.has(value.id)) fail(`observations: duplicate case ${value.id}`);
    if (value.family !== roster.get(value.id).family) fail(`observations: wrong family ${value.id}`);
    if (value.capture && !['completed', 'unresolved'].includes(value.capture.status)) fail('observations: invalid capture status');
    if (value.arms != null && (typeof value.arms !== 'object' || Array.isArray(value.arms))) fail('observations: invalid arms');
    for (const [arm, observation] of Object.entries(value.arms ?? {})) {
      identity(value.id, arm, arms);
      if (!observation || !['completed', 'unresolved'].includes(observation.status)) fail('observations: invalid arm status');
      if (observation.name != null && observation.name !== arm) fail('observations: arm name mismatch');
    }
    result.set(value.id, value);
  }
  return result;
}
function harm(a, b, field, completed) {
  if (!completed || !a || !b || (a[field] > 0) !== (b[field] > 0)) return 'unknown';
  return a[field] > 0 ? 'positive' : 'clean';
}
function judgeCounts(values, arms = ARMS) {
  return arms.reduce((result, arm) => {
    const judgments = [...values.values()].filter(value => value.arm === arm);
    result[arm] = { submittedJudgments: judgments.length, reviewedClaims: 0, unsupportedClaims: 0, staleClaims: 0 };
    for (const value of judgments) for (const field of ['reviewedClaims', 'unsupportedClaims', 'staleClaims']) {
      result[arm][field] += value[field];
      if (!Number.isSafeInteger(result[arm][field])) fail('claim count total exceeds safe integer range');
    }
    return result;
  }, {});
}

function aggregateJudgments({ observations, judgmentsA, judgmentsB }, complementary = false) {
  const ARMS = complementary ? complementaryArms : ['baseline', 'full'];
  const observed = observationMap(observations, ARMS);
  const a = judgmentMap(judgmentsA, 'judgmentsA', ARMS), b = judgmentMap(judgmentsB, 'judgmentsB', ARMS);
  const outcomes = [], arms = Object.fromEntries(ARMS.map(arm => [arm, counts()]));
  const families = Object.fromEntries([...new Set(DEVELOPMENT_ROSTER.map(item => item.family))].map(family =>
    [family, Object.fromEntries(ARMS.map(arm => [arm, { ...counts(), denominator: 4 }]))]));
  const preAdjudication = { denominator: 24 * ARMS.length, disagreements: 0, missingJudgments: 0, unknownJudgments: 0 };
  for (const item of DEVELOPMENT_ROSTER) for (const arm of ARMS) {
    const key = identity(item.id, arm, ARMS), first = a.get(key), second = b.get(key), observation = observed.get(item.id);
    const attempted = observation?.arms?.[arm];
    const completed = observation?.capture?.status === 'completed' && attempted?.status === 'completed' &&
      typeof attempted.answer === 'string' && attempted.answer.trim().length > 0;
    const agreement = first && second && first.verdict === second.verdict;
    const verdict = completed && agreement ? first.verdict : 'unresolved';
    if (!first || !second) preAdjudication.missingJudgments++;
    else if (!agreement) preAdjudication.disagreements++;
    if (first?.verdict === 'unresolved' || second?.verdict === 'unresolved') preAdjudication.unknownJudgments++;
    const unsupported = harm(first, second, 'unsupportedClaims', completed);
    const stale = harm(first, second, 'staleClaims', completed);
    const severeError = completed && first && second && first.severeError === second.severeError ? first.severeError : null;
    outcomes.push({ id: item.id, family: item.family, arm, completed: Boolean(completed), verdict, unsupported, stale, severeError });
    for (const summary of [arms[arm], families[item.family][arm]]) {
      summary.completed += Boolean(completed); summary[verdict]++;
      summary.unsupported += unsupported === 'positive'; summary.unsupportedUnknown += unsupported === 'unknown';
      summary.stale += stale === 'positive'; summary.staleUnknown += stale === 'unknown';
      summary.severeErrors += severeError === true; summary.severeUnknown += severeError === null;
    }
  }
  const pair = (control, treatment) => {
    const result = { denominator: 24, wins: 0, losses: 0, bothCorrect: 0, neitherCorrect: 0,
      ...(complementary ? { unresolvedPairs: 0 } : {}), netCorrect: arms[treatment].correct - arms[control].correct };
    for (const item of DEVELOPMENT_ROSTER) {
      const controlVerdict = outcomes.find(row => row.id === item.id && row.arm === control).verdict;
      const treatmentVerdict = outcomes.find(row => row.id === item.id && row.arm === treatment).verdict;
      if (complementary && (controlVerdict === 'unresolved' || treatmentVerdict === 'unresolved')) {
        result.unresolvedPairs++; continue;
      }
      const baseline = controlVerdict === 'correct', full = treatmentVerdict === 'correct';
      if (full && !baseline) result.wins++; else if (baseline && !full) result.losses++;
      else if (baseline) result.bothCorrect++; else result.neitherCorrect++;
    }
    return result;
  };
  const paired = complementary ? { complementaryBaseline: pair('baseline', 'complementary'),
    complementaryLinked: pair('linked', 'complementary') } : pair('baseline', 'full');
  const safetyUnknown = outcomes.some(value => value.unsupported === 'unknown' || value.stale === 'unknown' || value.severeError === null);
  if (complementary) {
    const safetyPair = control => ({
      noIncreasedUnsupported: !safetyUnknown && arms.complementary.unsupported <= arms[control].unsupported,
      noIncreasedStale: !safetyUnknown && arms.complementary.stale <= arms[control].stale,
      newlyFailingSevereCases: DEVELOPMENT_ROSTER.filter(item => outcomes.find(row => row.id === item.id && row.arm === control).severeError === false
        && outcomes.find(row => row.id === item.id && row.arm === 'complementary').severeError === true).map(item => item.id),
    });
    const safetyPairs = { complementaryBaseline: safetyPair('baseline'), complementaryLinked: safetyPair('linked') };
    return { schemaVersion: `${COMPLEMENTARY_VERSION}-judgments-v1`, denominator: 24, outcomesDenominator: 72,
      outcomes, arms, families, paired, preAdjudication, claimCounts: { judgeA: judgeCounts(a, ARMS), judgeB: judgeCounts(b, ARMS) },
      safety: { unknown: safetyUnknown, paired: safetyPairs, blocksAdvancement: safetyUnknown || Object.values(safetyPairs).some(pair =>
        !pair.noIncreasedUnsupported || !pair.noIncreasedStale || pair.newlyFailingSevereCases.length > 0) } };
  }
  const newlyFailingSevereCases = DEVELOPMENT_ROSTER.filter((_, index) => outcomes[index * 2].severeError === false && outcomes[index * 2 + 1].severeError === true).map(item => item.id);
  return { schemaVersion: 'algorithm-development-judgments-v1', denominator: 24, outcomesDenominator: 48,
    outcomes, arms, families, paired, preAdjudication, claimCounts: { judgeA: judgeCounts(a), judgeB: judgeCounts(b) },
    safety: { unknown: safetyUnknown, newlyFailingSevereCases, noIncreasedUnsupported: !safetyUnknown && arms.full.unsupported <= arms.baseline.unsupported,
      noIncreasedStale: !safetyUnknown && arms.full.stale <= arms.baseline.stale, blocksAdvancement: safetyUnknown || newlyFailingSevereCases.length > 0 ||
        arms.full.unsupported > arms.baseline.unsupported || arms.full.stale > arms.baseline.stale } };
}
export const aggregateDevelopmentJudgments = options => aggregateJudgments(options);
export const aggregateComplementaryDevelopmentJudgments = options => aggregateJudgments(options, true);

// Closed evaluation profile. These values are never supplied by a caller.
export const COMPLEMENTARY_VERSION = 'complementary-source-requested-answer';
export const complementaryArms = Object.freeze(['baseline', 'linked', 'complementary']);
export const complementaryPolicies = Object.freeze({ baseline: 'ordinary-v1',
  linked: 'source-diverse-linked-v1', complementary: 'source-diverse-complementary-v1' });
export const complementaryOrders = Object.freeze([
  ['baseline', 'linked', 'complementary'], ['baseline', 'complementary', 'linked'],
  ['linked', 'baseline', 'complementary'], ['linked', 'complementary', 'baseline'],
  ['complementary', 'baseline', 'linked'], ['complementary', 'linked', 'baseline'],
].map(Object.freeze));
export const complementaryLimits = Object.freeze({ cases: 24, coreCallsPerCase: 40,
  captureCallsPerCase: 16, coreCallsPerArm: 8, answersPerCase: 3,
  httpRequests: 1992, reservationMicroUsd: 5000, reservedMicroUsd: 10_000_000,
  protectedMicroUsd: 30_000_000, inputTokens: 6000, providerInputTokens: 7024,
  coreOutputTokens: 1024, answerOutputTokens: 512, callMs: 200_000,
  caseMs: 1_200_000, runMs: 28_800_000 });
export function requireComplementaryReport(report) {
  if (report?.schemaVersion !== `${COMPLEMENTARY_VERSION}-comparison-v1`
    || report.treatment !== complementaryPolicies.complementary
    || report.evidenceFormat !== 'source-role-evidence-v1'
    || JSON.stringify(report.armPolicies) !== JSON.stringify(complementaryPolicies)
    || !Array.isArray(report.observations) || report.observations.length !== 24
    || report.observations.some(row => Object.keys(row.arms ?? {}).sort().join() !== [...complementaryArms].sort().join())) {
    throw new TypeError('wrong complementary comparison report');
  }
}

import { CATEGORIES } from '../lib/fixture.mjs';
import { equal } from '../lib/hr2b-configuration.mjs';
import { clusterBootstrap, exactMcNemar, pairedQueries } from '../lib/stats.mjs';
import { HR2B, isHR2b } from './hr2b-profile.mjs';
import { validateScoredCell } from './provenance.mjs';
import { statisticsRows } from './report.mjs';
import { implementationKey } from './identity.mjs';
import { ARMS } from './arms.mjs';
import { fail } from './auth.mjs';

const key = run => JSON.stringify([run.split, run.scale, run.ranking, run.overhead, run.overheadModelDigest ?? null, run.budget]);
export const primaryHR2b = run => Object.entries(HR2B.primary).every(([key, value]) => run[key] === value);
const validBootstrap = comparison => comparison?.status === 'ok' && comparison.bootstrap?.status === 'ok' &&
  Number.isFinite(comparison.bootstrap.point) && Array.isArray(comparison.bootstrap.ci) && comparison.bootstrap.ci.length === 2 &&
  comparison.bootstrap.ci.every(Number.isFinite) && comparison.bootstrap.ci[0] <= comparison.bootstrap.ci[1];
export function decisionHR2b(primary, guard, { quotasOK, guardCeiling } = {}) {
  if (quotasOK !== true || !Number.isFinite(guardCeiling) || guardCeiling <= 0 || !validBootstrap(primary) || !validBootstrap(guard)) return 'inconclusive';
  const main = primary.bootstrap, later = guard.bootstrap;
  if (main.point >= HR2B.decision.adoptGain && main.ci[0] > 0 && later.ci[0] >= HR2B.decision.guardLoss) return 'adopt';
  if ((main.point <= 0 && main.ci[1] < HR2B.decision.adoptGain) || later.ci[1] < HR2B.decision.guardLoss) return 'keep';
  return 'inconclusive';
}
function validatePair(baseline, candidate) {
  validateScoredCell(baseline); validateScoredCell(candidate);
  if (!isHR2b(baseline.run) || !isHR2b(candidate.run) || baseline.run.arm !== 'P-top' || key(baseline.run) !== key(candidate.run) ||
      baseline.run.rankingHash !== candidate.run.rankingHash || !equal(baseline.run.protocolProfile, candidate.run.protocolProfile) ||
      implementationKey(baseline.run.implementation.assembly) !== implementationKey(candidate.run.implementation.assembly)) fail('invalid_comparison_cells');
  pairedQueries(statisticsRows(baseline.queries), statisticsRows(candidate.queries));
}
export function compareHR2bCells(baseline, candidate, stratum) {
  try {
    validatePair(baseline, candidate);
    const before = statisticsRows(stratum ? baseline.strata[stratum]?.queries : baseline.queries);
    const after = statisticsRows(stratum ? candidate.strata[stratum]?.queries : candidate.queries);
    const categories = stratum === 'placement:later-receipt' ? baseline.run.protocolProfile.placement.guardCategories :
      stratum ? CATEGORIES.filter(category => before.some(row => row.category === category)) : CATEGORIES;
    if (!categories.length) fail('empty_statistics_categories');
    const bootstrap = clusterBootstrap(before, after, { seed: HR2B.seed, resamples: HR2B.decision.resamples, categories, exploratory: true, minimumFamilies: HR2B.decision.minimumFamilies });
    const mcnemar = exactMcNemar(before, after);
    if (baseline.run.split === 'dev') mcnemar.selection = 'smallest-scored-dev-query-id-per-family';
    return { status: bootstrap.status, bootstrap, mcnemar };
  } catch (error) {
    return { status: 'inconclusive', bootstrap: { status: 'inconclusive', reason: 'invalid_inputs', error: error.message,
      seed: HR2B.seed, requested: HR2B.decision.resamples, confidence: HR2B.decision.confidence, endpoints: [.025, .975], exploratory: true, minimumFamilies: HR2B.decision.minimumFamilies,
      accepted: 0, rejected: 0, point: null, ci: null }, mcnemar: null };
  }
}
export function buildHR2bReport(scores, implementation) {
  const cells = scores.cells, comparisons = [], seen = new Set();
  const base = { format: 'hr2b-report-v1', protocol: HR2B.protocol, protocolCommit: HR2B.protocolCommit,
    implementation: { report: implementation }, cells };
  try {
    if (scores.ok !== true || !cells.length) fail('invalid_scores_status');
    const profile = cells[0].run.protocolProfile;
    for (const cell of cells) {
      validateScoredCell(cell); statisticsRows(cell.queries);
      if (!isHR2b(cell.run) || !equal(profile, cell.run.protocolProfile)) fail('mixed_protocol_profiles');
      const id = `${key(cell.run)}:${cell.run.arm}`;
      if (seen.has(id)) fail('duplicate_report_cell');
      seen.add(id);
      if (cell.run.arm !== 'P-top') validatePair(cells.find(other => other.run.arm === 'P-top' && key(other.run) === key(cell.run)), cell);
    }
  } catch (error) {
    return { ...base, ok: false, outcome: 'inconclusive', outcomeReason: 'invalid_inputs', error: error.message, comparisons: [] };
  }
  for (const candidate of cells.filter(cell => cell.run.arm !== 'P-top')) {
    const baseline = cells.find(cell => cell.run.arm === 'P-top' && key(cell.run) === key(candidate.run));
    const confirmatory = primaryHR2b(candidate.run) && candidate.run.arm === 'P-top-s1';
    const guard = compareHR2bCells(baseline, candidate, 'placement:later-receipt');
    comparisons.push({ run: candidate.run, baseline: 'P-top', candidate: candidate.run.arm,
      designation: confirmatory ? 'confirmatory' : 'exploratory', ...compareHR2bCells(baseline, candidate), guard,
      guardAbsolute: { baseline: baseline.strata['placement:later-receipt'], candidate: candidate.strata['placement:later-receipt'] },
      strata: Object.fromEntries(Object.keys(candidate.strata).map(stratum => [stratum, compareHR2bCells(baseline, candidate, stratum)])) });
  }
  const primary = comparisons.find(comparison => comparison.designation === 'confirmatory');
  const quotasOK = cells[0].run.protocolProfile.placement.ok === true;
  const guardCeiling = primary?.guardAbsolute.baseline.macroCeiling;
  const outcome = decisionHR2b(primary, primary?.guard, { quotasOK, guardCeiling });
  const outcomeReason = !quotasOK ? 'structural_quotas_failed' : !primary ? 'primary_cell_absent' :
    guardCeiling === 0 ? 'zero_guard_ranking_ceiling' : !validBootstrap(primary) || !validBootstrap(primary.guard) ? 'bootstrap_inconclusive' : null;
  const saturation = [];
  for (const ranking of HR2B.rankings) for (const overhead of [0, 'host-v2']) {
    const selected = cells.filter(cell => cell.run.ranking === ranking && cell.run.overhead === overhead);
    for (const split of [...new Set(selected.map(cell => cell.run.split))]) {
      const rows = selected.filter(cell => cell.run.split === split);
      const complete = HR2B.budgets.every(budget => ARMS.every(arm => rows.some(cell => cell.run.budget === budget && cell.run.arm === arm)));
      const budget = complete ? HR2B.budgets.find(value => rows.filter(cell => cell.run.budget >= value).every(cell => cell.queries.every(row => row.assemblyLoss === 0))) ?? null : null;
      saturation.push({ split, ranking, overhead, budget, status: !complete ? 'incomplete_grid' : budget === null ? 'not_reached' : 'reached' });
    }
  }
  return { ...base, ok: true, outcome, outcomeReason, comparisons, saturation };
}
export function hr2bMarkdown(report) {
  const lines = ['# HR-2b long-item assembly', '', `Protocol ${HR2B.protocol}, frozen at ${HR2B.protocolCommit}. Decision: **${report.outcome}** (${report.outcomeReason ?? '§4'}).`, '',
    'Confirmatory: test / S1000 / bge-m3 + A3 / host-v2 / B=1500; P-top-s1 minus P-top. Guard: later-receipt; frozen represented categories. All other comparisons and strata are exploratory, pointwise unadjusted 95% CIs.', '',
    'host-v2 is a fixed additive approximation; calibration errors do not retune its constants. The guard bounds the incremental loss on skipped later evidence; it does not demonstrate preservation.', '',
    'All provenance, absolute guard coverage, ranking ceiling, category/group/family counts, rejected-unit diagnostics, token use, strata, bootstrap/McNemar results and saturation are retained in JSON.', ''];
  if (!report.ok) return [...lines, `Invalid inputs: ${report.error}`, ''].join('\n');
  lines.push('| Split | Ranking | Arm | O | B | Coverage | All required | Ceiling | Loss | Token p50/p95 | Budget-rejected queries |',
    '| --- | --- | --- | --- | ---: | ---: | ---: | ---: | ---: | --- | ---: |');
  for (const cell of report.cells) {
    const r = cell.run, s = cell.summary;
    lines.push(`| ${r.split} | ${r.ranking} | ${r.arm} | ${r.overhead} | ${r.budget} | ${s.macroCoverage} | ${s.macroAllRequired} | ${s.macroCeiling} | ${s.macroAssemblyLoss} | ${s.tokenUse.p50}/${s.tokenUse.p95} | ${cell.budgetRejectedQueryCount ?? 'NA'} |`);
  }
  lines.push('', '| Contrast | Designation | Delta (pp) | 95% CI | Guard delta | Guard CI | Guard ceiling |', '| --- | --- | ---: | --- | ---: | --- | ---: |');
  for (const row of report.comparisons) lines.push(`| ${row.run.ranking}/${row.run.overhead}/${row.run.budget}/${row.candidate} | ${row.designation} | ${row.bootstrap.point} | ${JSON.stringify(row.bootstrap.ci)} | ${row.guard.bootstrap.point} | ${JSON.stringify(row.guard.bootstrap.ci)} | ${row.guardAbsolute.baseline.macroCeiling} |`);
  return [...lines, ''].join('\n');
}

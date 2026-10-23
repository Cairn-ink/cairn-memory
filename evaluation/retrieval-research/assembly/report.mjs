import { writeFile } from 'node:fs/promises';
import { CATEGORIES, compareIds, cliMain, readJson, writeJson, requiredOption } from '../lib/fixture.mjs';
import { clusterBootstrap, exactMcNemar } from '../lib/stats.mjs';
import { PROTOCOL, fail } from './auth.mjs';

export function statisticsRows(queries) {
  if (!Array.isArray(queries) || !queries.length || new Set(queries.map(row => row.id)).size !== queries.length) fail('invalid_statistics_query_set');
  return queries.map(row => {
    if (typeof row.id !== 'string' || typeof row.family !== 'string' || !CATEGORIES.includes(row.category) ||
        !Number.isFinite(row.coverage) || row.coverage < 0 || row.coverage > 1 || typeof row.allRequired !== 'boolean' || row.allRequired !== (row.coverage === 1)) fail('invalid_statistics_row');
    return { id: row.id, family: row.family, category: row.category, recall12: row.coverage, allRequired12: row.allRequired };
  });
}
const identity = run => JSON.stringify([run.split, run.scale, run.ranking, run.overhead, run.budget]);
const primary = run => run.split === 'test' && run.scale === 'S1000' && run.ranking === 'A3--bge-m3' && run.overhead === 0 && run.budget === 512;

export function compareCells(baseline, candidate) {
  try {
    if (!baseline?.ok || !candidate?.ok || baseline.run.arm !== 'P-top' || identity(baseline.run) !== identity(candidate.run) ||
        baseline.run.rankingHash !== candidate.run.rankingHash || baseline.run.counter !== candidate.run.counter ||
        baseline.run.protocol !== PROTOCOL || candidate.run.protocol !== PROTOCOL ||
        JSON.stringify(Object.entries(baseline.run.fixtureHashes).sort()) !== JSON.stringify(Object.entries(candidate.run.fixtureHashes).sort())) fail('invalid_comparison_cells');
    for (const cell of [baseline, candidate]) {
      if (!Array.isArray(cell.run.expectedQueryIds) || JSON.stringify(cell.queries.map(row => row.id).sort(compareIds)) !== JSON.stringify([...cell.run.expectedQueryIds].sort(compareIds))) fail('incomplete_comparison_queries');
    }
    const before = statisticsRows(baseline.queries), after = statisticsRows(candidate.queries);
    const bootstrap = clusterBootstrap(before, after, { seed: 'hr2-bootstrap-v1', resamples: 10000,
      categories: CATEGORIES, exploratory: true, minimumFamilies: 10 });
    const mcnemar = exactMcNemar(before, after);
    if (baseline.run.split === 'dev') mcnemar.selection = 'smallest-scored-dev-query-id-per-family';
    return { status: bootstrap.status, bootstrap, mcnemar };
  } catch (error) {
    return { status: 'inconclusive', bootstrap: { status: 'inconclusive', reason: 'invalid_inputs', error: error.message,
      seed: 'hr2-bootstrap-v1', requested: 10000, confidence: 0.95, endpoints: [0.025, 0.975], exploratory: true,
      minimumFamilies: 10, familyCounts: null, families: null, accepted: 0, rejected: 0, attempts: 0, point: null, ci: null }, mcnemar: null };
  }
}

export function decision(comparison) {
  const bootstrap = comparison?.bootstrap;
  if (comparison?.status !== 'ok' || bootstrap?.status !== 'ok' || !Number.isFinite(bootstrap.point) ||
      !Array.isArray(bootstrap.ci) || bootstrap.ci.length !== 2 || !bootstrap.ci.every(Number.isFinite)) return 'inconclusive';
  if (bootstrap.point >= 5 && bootstrap.ci[0] > 0) return 'coverage-first-worth-continuing';
  if (bootstrap.point <= 0 && bootstrap.ci[1] < 5) return 'rank-first-initial-default';
  return 'inconclusive';
}

export function buildReport(scores) {
  if (scores?.format !== 'hr2-scores-v1' || !Array.isArray(scores.cells)) fail('invalid_scores_format');
  const cells = scores.cells, seen = new Set();
  for (const cell of cells) {
    const key = `${identity(cell.run)}:${cell.run.arm}`;
    if (seen.has(key)) fail('duplicate_report_cell');
    seen.add(key);
  }
  const comparisons = cells.filter(cell => cell.run.arm !== 'P-top').map(candidate => {
    const baseline = cells.find(cell => cell.run.arm === 'P-top' && identity(cell.run) === identity(candidate.run));
    const statistics = compareCells(baseline, candidate);
    const categoryDeltas = Object.fromEntries(CATEGORIES.map(category => [category,
      baseline?.summary?.categories?.[category]?.coverage == null || candidate.summary?.categories?.[category]?.coverage == null ? null
        : (candidate.summary.categories[category].coverage - baseline.summary.categories[category].coverage) * 100]));
    return { run: candidate.run, baseline: 'P-top', candidate: candidate.run.arm,
      designation: primary(candidate.run) && candidate.run.arm === 'P-cover' ? 'confirmatory' : 'exploratory', categoryDeltas, ...statistics };
  });
  const confirmatory = comparisons.find(comparison => comparison.designation === 'confirmatory');
  const inputValid = scores.ok === true && cells.every(cell => cell.ok === true);
  return { format: 'hr2-report-v1', protocol: PROTOCOL, ok: inputValid, outcome: inputValid ? decision(confirmatory) : 'inconclusive',
    outcomeReason: !inputValid ? 'invalid_inputs' : !confirmatory ? 'primary_cell_absent' : confirmatory.bootstrap.reason ?? null,
    comparisons, cells };
}

const number = value => value == null ? 'NA' : value.toFixed(4);
export function reportMarkdown(report) {
  const lines = ['# HR-2 budgeted assembly', '', `Protocol: ${report.protocol}. Primary decision: **${report.outcome}**. Reason: ${report.outcomeReason ?? 'decision rule §4'}.`, '',
    'The sole confirmatory contrast is P-cover − P-top on test / S1000 / A3--bge-m3 / O=0 / B=512. Every other contrast and all dev output are exploratory. The shared statistics library receives exploratory:true solely to select the preregistered 95% endpoints.', '',
    'This is a short, single-fact synthetic fixture with bodies at most 82 UTF-16 units and about 40% span-only required groups. These results do not establish behavior on long items, generated summaries, hosted applicability or production reliability. The initial policy must be revisited with a long-item fixture. McNemar is underpowered by design.', '',
    '| Split | Ranking | Arm | O | B | Designation | Coverage | All-required | Full-ranking ceiling | Assembly loss | Token use p50 / p95 |',
    '| --- | --- | --- | ---: | ---: | --- | ---: | ---: | ---: | ---: | --- |'];
  for (const cell of report.cells) {
    const r = cell.run, s = cell.summary;
    lines.push(`| ${r.split} | ${r.ranking} | ${r.arm} | ${r.overhead} | ${r.budget} | ${primary(r) && ['P-top', 'P-cover'].includes(r.arm) ? 'confirmatory' : 'exploratory'} | ${number(s.macroCoverage)} | ${number(s.macroAllRequired)} | ${number(s.macroCeiling)} | ${number(s.macroAssemblyLoss)} | ${number(s.tokenUse.p50)} / ${number(s.tokenUse.p95)} |`);
  }
  lines.push('', '## Paired comparisons', '');
  for (const comparison of report.comparisons) {
    const r = comparison.run;
    lines.push(`### ${comparison.designation}: ${r.split} / ${r.ranking} / O=${r.overhead} / B=${r.budget} / ${r.arm} − P-top`, '',
      `Statistics (delta and CI in percentage points): ${JSON.stringify({ status: comparison.status, bootstrap: comparison.bootstrap, mcnemar: comparison.mcnemar })}`, '',
      `Category coverage deltas (percentage points): ${JSON.stringify(comparison.categoryDeltas)}`, '');
  }
  lines.push('## Category means, strata and provenance', '');
  for (const cell of report.cells) lines.push(`### ${cell.run.split} / ${cell.run.ranking} / ${cell.run.arm} / O=${cell.run.overhead} / B=${cell.run.budget}`, '',
    `Run: ${JSON.stringify(cell.run)}`, '', `Category means: ${JSON.stringify(cell.summary.categories)}`, '',
    `Strata (empty strata omit queries; macros average represented categories): ${JSON.stringify(Object.fromEntries(Object.entries(cell.strata).map(([key, value]) => [key, { ...value, queries: undefined }])))}`, '');
  lines.push('Per-query admitted unit IDs, costs, totals, coverage, all-required, ceiling and loss are retained in the scores JSON. The ceiling always uses the complete ranking including all spans, even for s1 arms.', '');
  return lines.join('\n');
}

await cliMain(import.meta.url, async options => {
  if (Object.keys(options).some(key => !['_', 'scores', 'out', 'markdown'].includes(key)) || options._.length) fail('unknown_report_option');
  const report = buildReport(await readJson(requiredOption(options, 'scores')));
  await writeJson(requiredOption(options, 'out'), report);
  await writeFile(requiredOption(options, 'markdown'), reportMarkdown(report));
  console.log(JSON.stringify({ ok: report.ok, outcome: report.outcome, comparisons: report.comparisons.length }));
  if (!report.ok) process.exitCode = 1;
});

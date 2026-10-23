import { writeFile } from 'node:fs/promises';
import { CATEGORIES, cliMain, readJson, writeJson, requiredOption } from '../lib/fixture.mjs';
import { clusterBootstrap, exactMcNemar, pairedQueries } from '../lib/stats.mjs';
import { PROTOCOL, fail } from './auth.mjs';
import { implementationIdentity, implementationKey } from './identity.mjs';
import { validateScoredCell } from './provenance.mjs';

const REPORT_IMPLEMENTATION = await implementationIdentity();

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
const cellKey = run => `${identity(run)}:${run.arm}`;

function comparisonRows(baseline, candidate) {
  validateScoredCell(baseline); validateScoredCell(candidate);
  if (baseline.run.arm !== 'P-top' || identity(baseline.run) !== identity(candidate.run) ||
      baseline.run.rankingHash !== candidate.run.rankingHash ||
      implementationKey(baseline.run.implementation.assembly) !== implementationKey(candidate.run.implementation.assembly) ||
      JSON.stringify(Object.entries(baseline.run.fixtureHashes).sort()) !== JSON.stringify(Object.entries(candidate.run.fixtureHashes).sort())) fail('invalid_comparison_cells');
  const before = statisticsRows(baseline.queries), after = statisticsRows(candidate.queries);
  pairedQueries(before, after);
  return { before, after };
}

export function compareCells(baseline, candidate) {
  try {
    const { before, after } = comparisonRows(baseline, candidate);
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
  try {
    if (scores.ok !== true || !cells.length) fail('invalid_scores_status');
    for (const cell of cells) { validateScoredCell(cell); statisticsRows(cell.queries); }
    const baselines = new Map(cells.filter(cell => cell.run.arm === 'P-top').map(cell => [identity(cell.run), cell]));
    for (const cell of cells) {
      const baseline = baselines.get(identity(cell.run));
      if (cell.run.arm !== 'P-top') comparisonRows(baseline, cell);
    }
  } catch (error) {
    return { format: 'hr2-report-v1', protocol: PROTOCOL, implementation: { report: REPORT_IMPLEMENTATION }, ok: false,
      outcome: 'inconclusive', outcomeReason: 'invalid_inputs', error: error.message, comparisons: [], cells };
  }
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
  return { format: 'hr2-report-v1', protocol: PROTOCOL, implementation: { report: REPORT_IMPLEMENTATION }, ok: inputValid, outcome: inputValid ? decision(confirmatory) : 'inconclusive',
    outcomeReason: !inputValid ? 'invalid_inputs' : !confirmatory ? 'primary_cell_absent' : confirmatory.bootstrap.reason ?? null,
    comparisons, cells };
}

const number = value => value == null ? 'NA' : value.toFixed(4);
export function reportMarkdown(report) {
  const lines = ['# HR-2 budgeted assembly', '', `Protocol: ${report.protocol}. Primary decision: **${report.outcome}**. Reason: ${report.outcomeReason ?? 'decision rule §4'}.`, '',
    'The sole confirmatory contrast is P-cover − P-top on test / S1000 / A3--bge-m3 / O=0 / B=512. Every other contrast and all dev output are exploratory. The shared statistics library receives exploratory:true solely to select the preregistered 95% endpoints.', '',
    'This is a short, single-fact synthetic fixture with bodies at most 82 UTF-16 units and about 40% span-only required groups. These results do not establish behavior on long items, generated summaries, hosted applicability or production reliability. The initial policy must be revisited with a long-item fixture. McNemar is underpowered by design.', ''];
  if (!report.ok) return [...lines, `Invalid inputs: ${report.error ?? report.outcomeReason}. No confirmatory designation or bootstrap was produced.`, ''].join('\n');
  const runs = report.cells.map(cell => cell.run);
  lines.push('## Shared provenance', '', `Frozen commit: ${runs[0].protocolCommit}; counter: ${runs[0].counter}.`, '',
    'All unrounded metrics, complete source runs, per-query admissions and stage identities are retained in JSON. Cell numbers below refer to the metrics table.', '',
    '| Stage | Commit | Source SHA-256 | Dirty | Detached |', '| --- | --- | --- | --- | --- |');
  const implementations = new Map();
  for (const [stage, implementation] of [['report', report.implementation.report], ...runs.flatMap(run => Object.entries(run.implementation))]) {
    implementations.set(`${stage}:${implementationKey(implementation)}`, [stage, implementation]);
  }
  for (const [stage, impl] of implementations.values()) lines.push(`| ${stage} | ${impl.commit} | ${impl.sourceHash} | ${impl.dirty} | ${impl.detached} |`);
  lines.push('', 'Fixture hash sets:');
  for (const hashes of new Set(runs.map(run => JSON.stringify(run.fixtureHashes)))) lines.push('', hashes);
  lines.push('', 'Environments:');
  for (const env of new Set(runs.map(run => JSON.stringify(run.environment)))) lines.push('', env ?? 'not recorded');
  lines.push('', '| Split | Ranking | Member SHA-256 |', '| --- | --- | --- |');
  for (const row of new Set(runs.map(run => `| ${run.split} | ${run.ranking} | ${run.rankingHash} |`))) lines.push(row);
  lines.push('', '## Cell metrics', '', '| Cell | Split | Ranking | Arm | O | B | Designation | Coverage | All-required | Full-ranking ceiling | Assembly loss | Token use p50 / p95 |',
    '| ---: | --- | --- | --- | ---: | ---: | --- | ---: | ---: | ---: | ---: | --- |');
  report.cells.forEach((cell, index) => {
    const r = cell.run, s = cell.summary;
    lines.push(`| ${index + 1} | ${r.split} | ${r.ranking} | ${r.arm} | ${r.overhead} | ${r.budget} | ${primary(r) && ['P-top', 'P-cover'].includes(r.arm) ? 'confirmatory' : 'exploratory'} | ${number(s.macroCoverage)} | ${number(s.macroAllRequired)} | ${number(s.macroCeiling)} | ${number(s.macroAssemblyLoss)} | ${number(s.tokenUse.p50)} / ${number(s.tokenUse.p95)} |`);
  });
  lines.push('', '## Paired comparisons', '', 'Deltas and CIs are percentage points. Family counts are C1–C7; bootstrap status, accepted/rejected draws and McNemar discordants are explicit.', '',
    '| Cell | Designation | Status | Delta | 95% CI | Families / C1–C7 | Accepted / rejected | Reason | McNemar baseline-only / candidate-only / p |',
    '| ---: | --- | --- | ---: | --- | --- | --- | --- | --- |');
  for (const comparison of report.comparisons) {
    const b = comparison.bootstrap, m = comparison.mcnemar, index = report.cells.findIndex(cell => cellKey(cell.run) === cellKey(comparison.run)) + 1;
    lines.push(`| ${index} | ${comparison.designation} | ${b.status} | ${number(b.point)} | ${b.ci?.map(number).join(' / ') ?? 'NA'} | ${b.families ?? 'NA'} / ${CATEGORIES.map(category => b.familyCounts?.[category] ?? 'NA').join(',')} | ${b.accepted} / ${b.rejected} | ${b.reason ?? '—'} | ${m ? `${m.baselineOnly} / ${m.candidateOnly} / ${number(m.p)}` : 'NA'} |`);
  }
  lines.push('', '## Category means and deltas', '', '| Cell | Category | Queries | Groups | Coverage | All-required | Ceiling | Loss | Coverage delta vs P-top (pp) |',
    '| ---: | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |');
  report.cells.forEach((cell, index) => {
    const comparison = report.comparisons.find(row => cellKey(row.run) === cellKey(cell.run));
    for (const category of CATEGORIES) {
      const s = cell.summary.categories[category];
      if (s.queries) lines.push(`| ${index + 1} | ${category} | ${s.queries} | ${s.groups} | ${number(s.coverage)} | ${number(s.allRequired)} | ${number(s.ceiling)} | ${number(s.assemblyLoss)} | ${comparison ? number(comparison.categoryDeltas[category]) : '—'} |`);
    }
  });
  lines.push('', '## Fidelity and language strata', '', 'Queries without matching groups are omitted; macros average represented categories. Category strata appear in the category table.', '',
    '| Cell | Stratum | Queries | Groups | Represented categories | Coverage | All-required | Ceiling | Loss |',
    '| ---: | --- | ---: | ---: | --- | ---: | ---: | ---: | ---: |');
  report.cells.forEach((cell, index) => {
    for (const [key, s] of Object.entries(cell.strata)) if (!key.startsWith('category:')) lines.push(`| ${index + 1} | ${key} | ${s.queryCount} | ${s.groupCount} | ${s.representedCategories.join(',') || '—'} | ${number(s.macroCoverage)} | ${number(s.macroAllRequired)} | ${number(s.macroCeiling)} | ${number(s.macroAssemblyLoss)} |`);
  });
  return [...lines, '', 'The ceiling uses the complete ranking and all spans, including for s1 arms. JSON retains exhaustive per-query, stratum and provenance data.', ''].join('\n');
}

await cliMain(import.meta.url, async options => {
  if (Object.keys(options).some(key => !['_', 'scores', 'out', 'markdown'].includes(key)) || options._.length) fail('unknown_report_option');
  const report = buildReport(await readJson(requiredOption(options, 'scores')));
  await writeJson(requiredOption(options, 'out'), report);
  await writeFile(requiredOption(options, 'markdown'), reportMarkdown(report));
  console.log(JSON.stringify({ ok: report.ok, outcome: report.outcome, comparisons: report.comparisons.length }));
  if (!report.ok) process.exitCode = 1;
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { statisticsRows, compareCells, decision, buildReport, reportMarkdown } from '../assembly/report.mjs';
import { COUNTER_ID } from '../assembly/counter.mjs';
import { FROZEN_INPUTS } from '../assembly/provenance.mjs';
import { PROTOCOL_COMMIT, RANKINGS, PROTOCOL } from '../assembly/auth.mjs';
import { CATEGORIES } from '../lib/fixture.mjs';

function cells(families = 10) {
  const queries = CATEGORIES.flatMap(category => Array.from({ length: families }, (_, i) => ({ id: `q-${category}-${String(i).padStart(2, '0')}`, family: `f${i}`, category, coverage: 0, allRequired: false })));
  const assembly = { format: 'hr2-implementation-v1', commit: 'a'.repeat(40), sourceHash: 'b'.repeat(64), sourceFiles: ['arms.mjs'], dirty: false, detached: true };
  const ranking = 'A3--bge-m3', source = RANKINGS[ranking], fixtureHashes = structuredClone(FROZEN_INPUTS.fixtureHashes);
  const run = { protocol: PROTOCOL, protocolCommit: PROTOCOL_COMMIT, status: 'complete', split: 'test', scale: 'S1000', ranking,
    rankingHash: FROZEN_INPUTS.members[source.member], rankingMember: source.member, fixtureHashes, counter: COUNTER_ID,
    commit: assembly.commit, implementation: { assembly, scorer: structuredClone(assembly) },
    rankingRun: { ...source, split: 'test', scale: 'S1000', status: 'complete', fixtureHashes: structuredClone(fixtureHashes) },
    budget: 512, overhead: 0, expectedQueryIds: queries.map(row => row.id) };
  const summary = { categories: Object.fromEntries(CATEGORIES.map(category => [category, { queries: families, groups: families, coverage: 0, allRequired: 0, ceiling: 1, assemblyLoss: 1 }])),
    tokenUse: { p50: 0, p95: 0 }, macroCoverage: 0, macroAllRequired: 0, macroCeiling: 1, macroAssemblyLoss: 1 };
  return [{ format: 'hr2-scored-cell-v1', ok: true, run: { ...structuredClone(run), arm: 'P-top' }, queries, summary, strata: {} },
    { format: 'hr2-scored-cell-v1', ok: true, run: { ...structuredClone(run), arm: 'P-cover' }, queries: queries.map(row => ({ ...row, coverage: 1, allRequired: true })), summary, strata: {} }];
}

test('adapter maps coverage and all-required exactly to the shared stats fields', () => {
  assert.deepEqual(statisticsRows([{ id: 'q', family: 'f', category: 'C1', coverage: 0.5, allRequired: false }]), [{ id: 'q', family: 'f', category: 'C1', recall12: 0.5, allRequired12: false }]);
  assert.throws(() => statisticsRows([{ id: 'q', family: 'f', category: 'C1', coverage: NaN, allRequired: false }]), /invalid_statistics/);
});

test('preregistered bootstrap uses 10,000 resamples, 95% interpolated endpoints and ten-family minimum', () => {
  const [baseline, candidate] = cells(), result = compareCells(baseline, candidate), bootstrap = result.bootstrap;
  assert.equal(result.status, 'ok'); assert.equal(bootstrap.seed, 'hr2-bootstrap-v1');
  assert.equal(bootstrap.requested, 10000); assert.equal(bootstrap.accepted, 10000); assert.equal(bootstrap.rejected, 0);
  assert.equal(bootstrap.confidence, 0.95); assert.equal(bootstrap.exploratory, true);
  assert.deepEqual(bootstrap.endpoints, [0.025, 0.975]); assert.deepEqual(bootstrap.ci, [100, 100]);
  assert.equal(bootstrap.point, 100); assert.equal(bootstrap.minimumFamilies, 10);
  assert.deepEqual(bootstrap.familyCounts, Object.fromEntries(CATEGORIES.map(category => [category, 10])));
  assert.equal(decision(result), 'coverage-first-worth-continuing');
  assert.ok(result.mcnemar.queryIds.every(id => id.startsWith('q-C1-')));
  assert.equal(result.mcnemar.baselineOnly, 0); assert.equal(result.mcnemar.candidateOnly, 10);
});

test('McNemar uses the smallest scored query ID per family and reports opposing discordants', () => {
  const [baseline, candidate] = cells(2);
  baseline.queries[0].coverage = 1; baseline.queries[0].allRequired = true;
  candidate.queries[0].coverage = 0; candidate.queries[0].allRequired = false;
  const result = compareCells(baseline, candidate);
  assert.equal(result.mcnemar.baselineOnly, 1); assert.equal(result.mcnemar.candidateOnly, 1);
  assert.equal(result.mcnemar.discordant, 2); assert.equal(result.mcnemar.p, 1);
  assert.deepEqual(result.mcnemar.queryIds, ['q-C1-00', 'q-C1-01']);
});

test('too few families, invalid or incomplete input always makes the primary decision inconclusive', () => {
  const [baseline, candidate] = cells(9);
  assert.equal(compareCells(baseline, candidate).bootstrap.reason, 'too_few_families');
  assert.equal(decision(compareCells(baseline, candidate)), 'inconclusive');
  candidate.queries.pop();
  assert.equal(compareCells(baseline, candidate).bootstrap.reason, 'invalid_inputs');
  assert.equal(decision(compareCells(baseline, candidate)), 'inconclusive');
});

test('decision thresholds are applied only to the primary contrast; dev and sensitivities remain exploratory', () => {
  const result = (point, ci) => ({ status: 'ok', bootstrap: { status: 'ok', point, ci } });
  assert.equal(decision(result(5, [0.1, 6])), 'coverage-first-worth-continuing');
  assert.equal(decision(result(5, [0, 6])), 'inconclusive');
  assert.equal(decision(result(0, [-1, 4.99])), 'rank-first-initial-default');
  assert.equal(decision(result(0, [-1, 5])), 'inconclusive');
  const [baseline, candidate] = cells(1), scores = { format: 'hr2-scores-v1', ok: true, cells: [baseline, candidate] };
  let report = buildReport(scores);
  assert.equal(report.comparisons[0].designation, 'confirmatory'); assert.equal(report.outcome, 'inconclusive');
  for (const cell of scores.cells) { cell.run.split = 'dev'; cell.run.rankingRun.split = 'dev'; cell.run.rankingMember = RANKINGS[cell.run.ranking].dev; }
  report = buildReport(scores);
  assert.equal(report.comparisons[0].designation, 'exploratory'); assert.equal(report.outcomeReason, 'primary_cell_absent');
  assert.match(reportMarkdown(report), /short, single-fact/); assert.match(reportMarkdown(report), /all dev output are exploratory/);
  for (const cell of scores.cells) { cell.run.split = 'test'; cell.run.rankingRun.split = 'test'; cell.run.rankingMember = RANKINGS[cell.run.ranking].member; cell.run.overhead = 8; }
  report = buildReport(scores);
  assert.equal(report.comparisons[0].designation, 'exploratory'); assert.equal(report.outcomeReason, 'primary_cell_absent');
});


const invalidProvenance = [
  ['failed status', cell => { cell.run.status = 'failed'; }],
  ['wrong counter', cell => { cell.run.counter = 'wrong-counter'; }],
  ['bogus frozen commit', cell => { cell.run.protocolCommit = '0'.repeat(40); }],
  ['wrong protocol version', cell => { cell.run.protocol = 'HR-2 v0'; }],
  ['wrong format', cell => { cell.format = 'wrong'; }],
  ['invalid split', cell => { cell.run.split = 'other'; }],
  ['invalid scale', cell => { cell.run.scale = 'S300'; }],
  ['wrong frozen ranking hash', cell => { cell.run.rankingHash = '0'.repeat(64); }],
  ['malformed ranking hash', cell => { cell.run.rankingHash = 'hash'; }],
  ['wrong ranking member', cell => { cell.run.rankingMember = 'without-foreign/toy.json'; }],
  ['wrong fixture hash', cell => { cell.run.fixtureHashes['hr1-labels.json'] = '0'.repeat(64); }],
  ['failed source ranking', cell => { cell.run.rankingRun.status = 'failed'; }],
  ['wrong source configuration', cell => { cell.run.rankingRun.config = 'other'; }],
  ['source fixture hash mismatch', cell => { cell.run.rankingRun.fixtureHashes['hr1-corpus.json'] = '0'.repeat(64); }],
  ['missing scorer identity', cell => { delete cell.run.implementation.scorer; }],
  ['missing assembly identity', cell => { delete cell.run.implementation.assembly; }],
  ['legacy ok flag', cell => { cell.ok = false; }],
];
for (const [name, mutate] of invalidProvenance) test(`invalid provenance: ${name} suppresses every bootstrap and confirmatory designation`, () => {
  const pair = cells();
  // Identical mutations in both cells must not be accepted just because they match.
  pair.forEach(mutate);
  const report = buildReport({ format: 'hr2-scores-v1', ok: true, cells: pair });
  assert.equal(report.ok, false); assert.equal(report.outcome, 'inconclusive'); assert.equal(report.outcomeReason, 'invalid_inputs');
  assert.deepEqual(report.comparisons, []);
  const comparison = compareCells(...pair);
  assert.equal(comparison.bootstrap.reason, 'invalid_inputs'); assert.equal(comparison.bootstrap.accepted, 0);
});

test('one invalid exploratory cell invalidates the report before a valid primary pair is bootstrapped', () => {
  const pair = cells(), extra = structuredClone(pair[1]); extra.run.budget = 256; extra.run.status = 'failed';
  const report = buildReport({ format: 'hr2-scores-v1', ok: true, cells: [...pair, extra] });
  assert.equal(report.outcomeReason, 'invalid_inputs'); assert.deepEqual(report.comparisons, []);
});

test('invalid paired query metadata has no confirmatory designation or bootstrap', () => {
  const pair = cells(); pair[1].queries[0].family = 'different-family';
  const report = buildReport({ format: 'hr2-scores-v1', ok: true, cells: pair });
  assert.equal(report.outcomeReason, 'invalid_inputs'); assert.deepEqual(report.comparisons, []);
});

test('compact Markdown joins comparisons by cell values after a JSON round trip', () => {
  const report = buildReport({ format: 'hr2-scores-v1', ok: true, cells: cells(1) });
  assert.equal(reportMarkdown(JSON.parse(JSON.stringify(report))), reportMarkdown(report));
});

for (const field of ['commit', 'sourceHash', 'dirty', 'detached']) test(`assembly implementation mismatch (${field}) makes the decision inconclusive`, () => {
  const pair = cells();
  const implementation = pair[1].run.implementation.assembly;
  implementation[field] = typeof implementation[field] === 'boolean' ? !implementation[field] : 'c'.repeat(field === 'commit' ? 40 : 64);
  pair[1].run.commit = implementation.commit;
  assert.equal(compareCells(...pair).bootstrap.reason, 'invalid_inputs');
  const report = buildReport({ format: 'hr2-scores-v1', ok: true, cells: pair });
  assert.equal(report.outcomeReason, 'invalid_inputs'); assert.deepEqual(report.comparisons, []);
});

test('report records its own implementation identity and keeps exhaustive JSON while Markdown is compact', () => {
  const pair = cells(1);
  const stratum = { queryCount: 1, groupCount: 1, representedCategories: ['C1'], macroCoverage: 0.123456789, macroAllRequired: 0,
    macroCeiling: 1, macroAssemblyLoss: 0.876543211, queries: [{ retained: true }] };
  const expanded = Array.from({ length: 120 }, (_, i) => pair.map(cell => {
    const copy = structuredClone(cell); copy.run.budget = [128, 192, 256, 384, 512, 768, 1024, 1536][i % 8];
    copy.strata = { 'fidelity:body-covered': structuredClone(stratum), 'language:zh': structuredClone(stratum) };
    return copy;
  })).flat();
  // Rendering receives a normal report shape; duplicate synthetic cells are only for size measurement.
  const report = buildReport({ format: 'hr2-scores-v1', ok: true, cells: pair });
  assert.match(report.implementation.report.commit, /^[a-f0-9]{40}$/);
  assert.match(report.implementation.report.sourceHash, /^[a-f0-9]{64}$/);
  const markdown = reportMarkdown({ ...report, cells: expanded, comparisons: [] });
  assert.equal(markdown.split('Frozen commit:').length - 1, 1);
  assert.ok(markdown.length < 300000, markdown.length);
  assert.equal(expanded[0].strata['language:zh'].macroCoverage, 0.123456789);
  assert.deepEqual(expanded[0].strata['language:zh'].queries, [{ retained: true }]);
  assert.match(markdown, /Category means and deltas/); assert.match(markdown, /Fidelity and language strata/);
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { statisticsRows, compareCells, decision, buildReport, reportMarkdown } from '../assembly/report.mjs';
import { PROTOCOL } from '../assembly/auth.mjs';
import { CATEGORIES } from '../lib/fixture.mjs';

function cells(families = 10) {
  const queries = CATEGORIES.flatMap(category => Array.from({ length: families }, (_, i) => ({ id: `q-${category}-${String(i).padStart(2, '0')}`, family: `f${i}`, category, coverage: 0, allRequired: false })));
  const run = { protocol: PROTOCOL, split: 'test', scale: 'S1000', ranking: 'A3--bge-m3', rankingHash: 'hash', fixtureHashes: {}, counter: 'counter', budget: 512, overhead: 0, expectedQueryIds: queries.map(row => row.id) };
  const summary = { categories: Object.fromEntries(CATEGORIES.map(category => [category, { coverage: 0 }])), tokenUse: { p50: 0, p95: 0 } };
  return [{ ok: true, run: { ...run, arm: 'P-top' }, queries, summary, strata: {} }, { ok: true, run: { ...run, arm: 'P-cover' }, queries: queries.map(row => ({ ...row, coverage: 1, allRequired: true })), summary, strata: {} }];
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
  for (const cell of scores.cells) cell.run.split = 'dev';
  report = buildReport(scores);
  assert.equal(report.comparisons[0].designation, 'exploratory'); assert.equal(report.outcomeReason, 'primary_cell_absent');
  assert.match(reportMarkdown(report), /short, single-fact/); assert.match(reportMarkdown(report), /all dev output are exploratory/);
  for (const cell of scores.cells) { cell.run.split = 'test'; cell.run.overhead = 8; }
  report = buildReport(scores);
  assert.equal(report.comparisons[0].designation, 'exploratory'); assert.equal(report.outcomeReason, 'primary_cell_absent');
});

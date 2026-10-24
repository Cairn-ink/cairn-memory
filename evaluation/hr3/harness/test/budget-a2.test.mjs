import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { budgetA2, markdownSummary } from '../budget-a2.mjs';
import { CAPS } from '../ledger.mjs';

test('A-2 reservation plan and forecast reproduce the published reports', () => {
  const report = budgetA2();
  assert.deepEqual(report, JSON.parse(readFileSync(new URL('../reports/budget-a2.json', import.meta.url), 'utf8')));
  assert.equal(markdownSummary(report), readFileSync(new URL('../reports/budget-a2.md', import.meta.url), 'utf8'));
});

test('complete all-retries ceiling and single-attempt forecast match independent arithmetic', () => {
  const report = budgetA2();
  // Hand-derived dollar arithmetic from the four §14 call-count rows, not
  // from the report's totals or its per-attempt helper.
  const perAttempt = { primaryExtraction: (16384 * .40 + 4096 * 1.60) / 1e6,
    primaryReader: (20000 * .40 + 2048 * 1.60) / 1e6,
    alternativeExtraction: (16384 * .75 + 4096 * 4.50) / 1e6 };
  const rows = [[240,480,17.117184,5.065728], [800,1600,57.057280,16.885760],
    [6400,12800,456.458240,135.086080], [800,800,67.194880,24.087040]];
  rows.forEach(([extraction,reader,worst,expected],i) => {
    const ceiling = 2 * extraction * (i === 3 ? perAttempt.alternativeExtraction : perAttempt.primaryExtraction) + 2 * reader * perAttempt.primaryReader;
    assert.ok(Math.abs(ceiling - worst) < 1e-10);
    assert.equal(report.stages[i].worstNanodollars, Math.round(worst * 1e9));
    assert.equal(report.stages[i].expectedNanodollars, Math.round(expected * 1e9));
  });
  assert.equal(report.totals.worstNanodollars, 600387584000);
  assert.equal(report.totals.expectedNanodollars, 183684608000);
  assert.equal(report.totals.forecastWithContingencyUSD, 229.605760);
  assert.equal(report.totals.historicalWorstUSD, 440.905728);
  assert.equal(report.embeddings.totalNanodollars, 2560000000);
});

test('a forecast below $450 cannot approve an infeasible complete reservation plan', () => {
  const report = budgetA2();
  assert.ok(report.totals.forecastWithContingencyUSD < 450);
  assert.ok(report.stages.find(s => s.stage === 'test').worstUSD > 450);
  assert.equal(report.totals.operationalCovered, false);
  assert.equal(report.totals.grossAuthorizationCovered, false);
  assert.equal(report.totals.shortfallUSD, 150.387584);
  assert.equal(report.stageLimitProposal.feasible, false);
  assert.equal(report.stageLimitProposal.proposedLimits, null);
  assert.equal(report.stageLimitProposal.applied, false);
  assert.equal(report.paidReadiness, false);
  assert.deepEqual(['pilot','development','test','alternative'].map(s => CAPS[s]), [24,46,345,45]);
});

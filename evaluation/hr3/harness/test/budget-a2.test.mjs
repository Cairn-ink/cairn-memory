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
  const perAttempt = { primaryExtraction: (16384 * .40 + 4352 * 1.60) / 1e6,
    primaryReader: (28000 * .40 + 2176 * 1.60) / 1e6,
    alternativeExtraction: (16384 * .75 + 4352 * 4.50) / 1e6 };
  const rows = [[240,480,20.582400,5.262336], [800,1600,68.608000,17.541120],
    [6400,12800,548.864000,140.328960], [800,800,75.765760,25.172480]];
  rows.forEach(([extraction,reader,worst,expected],i) => {
    const ceiling = 2 * extraction * (i === 3 ? perAttempt.alternativeExtraction : perAttempt.primaryExtraction) + 2 * reader * (i===3?(30000*.40+2176*1.60)/1e6:perAttempt.primaryReader);
    assert.ok(Math.abs(ceiling - worst) < 1e-10);
    assert.equal(report.stages[i].worstNanodollars, Math.round(worst * 1e9));
    assert.equal(report.stages[i].expectedNanodollars, Math.round(expected * 1e9));
  });
  assert.equal(report.totals.worstNanodollars, 716380160000);
  assert.equal(report.totals.expectedNanodollars, 190864896000);
  assert.equal(report.totals.forecastWithContingencyUSD, 238.581120);
  assert.equal(report.totals.historicalWorstUSD, 440.905728);
  assert.equal(report.embeddings.totalNanodollars, 2560000000);
});

test('revised A-2 binds pilot fit while envelope coverage and later-stage feasibility stay separate',()=>{
 const r=budgetA2();
 assert.equal(r.status,'PASS_PILOT_BUDGET');assert.equal(r.bindingPrePilotCriterion,'combinedPilotFit');
 assert.equal(r.pilotFit.conservativeTotalUSD,23.142400);assert.equal(r.pilotFit.pass,true);assert.equal(r.pilotFit.marginUSD,0.857600);
 assert.equal(r.theoreticalEnvelope.covered,false);assert.equal(r.theoreticalEnvelope.blockingBeforePilot,false);
 assert.equal(r.laterStageFeasibility.status,'pending_paid_pilot_projection');assert.equal(r.laterStageFeasibility.computed,false);
 assert.equal(r.laterStageFeasibility.completionCeilingUSD,400);assert.equal(r.laterStageFeasibility.allStageLimitsRequired,true);
 assert.equal(r.stageLimitProposal.status,'deferred_to_continuation_projection');assert.equal(r.stageLimitProposal.applied,false);
 assert.equal(r.laterStageFeasibility.completeTestRequired,true);assert.equal(r.laterStageFeasibility.budgetExhaustionOutcome,'Inconclusive');
 assert.equal(r.a3PilotRerun.combinedConservativeUSD,23.9861578);assert.equal(r.a3PilotRerun.pass,true);assert.equal(r.a3PilotRerun.priorSettledNanodollars,835956660);assert.equal(r.a3PilotRerun.priorOutstandingNanodollars,12667200);assert.equal(r.a3PilotRerun.pooled,false);assert.equal(r.a3PilotRerun.realRerunAllowed,true);assert.equal(r.a3PilotRerun.preparationComplete,true);
 assert.equal(r.paidReadiness,false);assert.deepEqual(['pilot','development','test','alternative'].map(s=>CAPS[s]),[24,46,345,45]);
});

test('pre-development projection input contract freezes paid usage, all spending, outstanding, remaining stages, embeddings and contingency',async()=>{
 const {projectionInputSchema}=await import('../projection-schema.mjs');const schema=projectionInputSchema();
 assert.deepEqual(schema,JSON.parse(readFileSync(new URL('../reports/pre-development-projection.schema.json',import.meta.url),'utf8')));
 const p=schema.properties;assert.equal(p.source.const,'paid_pilot_settled_ledger');assert.equal(p.pilot.properties.complete.const,true);
 assert.deepEqual(p.remainingStages.required,['development','test','alternative']);
 assert.equal(p.remainingStages.properties.test.properties.extractionCalls.const,6400);assert.equal(p.remainingStages.properties.test.properties.readerCalls.const,12800);
 assert.ok(p.ledger.required.includes('outstandingReservations'));assert.ok(p.ledger.required.includes('settledNanodollarsByStage'));
 assert.ok(p.ledger.required.includes('embeddingReservedUnits'));assert.ok(schema.required.includes('remainingEmbeddingUnitAllocation'));
 assert.equal(p.policy.properties.projectionCeilingNanodollars.const,400000000000);assert.equal(p.policy.properties.contingencyDenominator.const,4);
 assert.equal(p.policy.properties.authorizationNanodollars.const,500000000000);assert.ok(schema['x-calculation'].acceptance.includes('each stage'));
});

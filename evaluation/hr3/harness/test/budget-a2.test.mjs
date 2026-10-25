// This active suite now checks A-4.2; historical A-2 artifacts remain immutable.
import test from 'node:test';import assert from 'node:assert/strict';import {readFileSync} from 'node:fs';
import {budgetA4} from '../budget-a4.mjs';import {CAPS} from '../ledger.mjs';import {projectionInputSchema} from '../projection-schema.mjs';
test('A-4.2 complete retry arithmetic, cumulative pilot cap and historical carry hashes are reproducible',()=>{
 const r=budgetA4();assert.deepEqual(r,JSON.parse(readFileSync(new URL('../reports/budget-a4.json',import.meta.url))));
 assert.equal(r.extractionNanodollars,480*(20480*400+4352*1600));assert.equal(r.readerNanodollars,18284544000);
 assert.equal(r.incrementalConservativeNanodollars,28119040000);assert.equal(r.hypotheticalFullPriorPilotCapNanodollars,52119040000);
 assert.equal(r.cumulativePilotCapUSD,50);assert.equal(r.availableCarryFits,true);assert.equal(r.paidReadiness,false);
 assert.deepEqual([CAPS.pilot,CAPS.development,CAPS.test,CAPS.alternative],[50,46,345,45]);
 assert.equal(r.carryForward.path,'evaluation/hr3/harness/reports/a4-carry-forward.json');assert.equal(r.carryForward.exposureNanodollars,2136861040);assert.ok(r.cumulativePilotBoundNanodollars<=50e9);
 assert.equal(r.accountingGate.completeThirdPilotMerged,true);assert.equal(r.laterStageCapsChanged,false);
});
test('regenerated continuation preserves paid-usage prerequisite, full test, outstanding reservations and global stops',()=>{
 const schema=projectionInputSchema();assert.deepEqual(schema,JSON.parse(readFileSync(new URL('../reports/pre-development-projection-a4.schema.json',import.meta.url))));
 assert.equal(schema.properties.source.const,'paid_pilot_settled_ledger');assert.ok(schema.properties.ledger.required.includes('outstandingReservations'));
 assert.equal(schema.properties.remainingStages.properties.test.properties.extractionCalls.const,6400);
 const r=JSON.parse(readFileSync(new URL('../reports/continuation-a4.json',import.meta.url)));
 assert.equal(r.binding,false);assert.equal(r.totalCompletionNanodollars,282003200000);assert.equal(r.planningFits400,true);
 assert.equal(r.operationalStopNanodollars,450e9);assert.equal(r.authorizationNanodollars,500e9);assert.equal(r.unavailableHeadroomNanodollars,50e9);
});

#!/usr/bin/env node
// Regenerated planning projection, deliberately distinct from the binding paid-
// usage projection required before development. Fake usage never becomes billing.
import {writeFileSync,readFileSync} from 'node:fs';
import {budgetA6} from './budget-a6.mjs';
import {hash} from './common.mjs';
const b=budgetA6(),future=b.stages.filter(s=>s.stage!=='pilot');
const response=future.reduce((n,s)=>n+s.forecastNanodollars,0),embeddings=2560000000;
const prospective=response+embeddings,contingency=Math.ceil(prospective/4),total=50000000000+prospective+contingency;
const report={version:'hr3-continuation-planning-a6.1-v1',status:'PENDING_PAID_A6_USAGE',completeAccounting:b.accountingGate.completeFourthPilotMerged,carriedExposureNanodollars:b.carryForward.exposureNanodollars,cumulativePilotBoundNanodollars:b.cumulativePilotBoundNanodollars,binding:false,paidAuthorization:false,
 pilotCapNanodollars:50000000000,remainingStages:future,entireEmbeddingAllowanceAgainNanodollars:embeddings,
 prospectiveNanodollars:prospective,contingencyNanodollars:contingency,totalCompletionNanodollars:total,planningFits400:total<=400e9,
 operationalStopNanodollars:450e9,authorizationNanodollars:500e9,unavailableHeadroomNanodollars:50e9,
 currentStageLimitsUSD:{pilot:50,development:46,test:345,alternative:45},sumOfIndependentStageLimitsUSD:486,
 allocationDisclosure:'Independent stage stops are not simultaneous spending allocations; their sum exceeds $450. The global $450 stop binds. Before development disclose a stage allocation summing <=$450 using reconciled paid usage; do not automatically increase later-stage caps.',
 prerequisites:['A-6/A-6.1 review/freeze and one complete engineering pilot','Binding paid-usage projection <=$400, outstanding reservations retained in full, embedding counters carried, stage allocations disclosed within $450'],
 bindingInputSchema:{path:'evaluation/hr3/harness/reports/pre-development-projection-a4.schema.json',sha256:hash(readFileSync(new URL('./reports/pre-development-projection-a4.schema.json',import.meta.url)))},sources:b.sources};
writeFileSync(new URL('./reports/continuation-a6.json',import.meta.url),JSON.stringify(report,null,2)+'\n');process.stdout.write(JSON.stringify({status:report.status,binding:report.binding,totalCompletionUSD:total/1e9,planningFits400:report.planningFits400})+'\n');

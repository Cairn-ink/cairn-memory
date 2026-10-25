// Validator only. There is deliberately no writer/CLI for readiness or review.
import assert from 'node:assert/strict';import {readFileSync,existsSync} from 'node:fs';import {isAbsolute} from 'node:path';
import {hash,canonical,fail} from './common.mjs';import {requirementsForStage,ANALYSIS_DESIGN} from './paid-requirements-a4.mjs';import {runtimeClosure} from './runtime-closure.mjs';
export const PAID_PREFLIGHT_PATH='evaluation/hr3/harness/reports/paid-preflight-a4.json';
const check=(ok,reason)=>{if(!ok)fail('paid_preflight:'+reason);};
function verified(spec,name){check(spec&&typeof spec.path==='string'&&!isAbsolute(spec.path)&&!spec.path.split(/[\\/]/).includes('..'),'missing_'+name);check(existsSync(spec.path),'missing_'+name);const bytes=readFileSync(spec.path);check(hash(bytes)===spec.sha256,'stale_'+name);return JSON.parse(bytes);}
function bindings(report,name){check(report.sources&&Object.keys(report.sources).length>0,'missing_sources_'+name);for(const [p,digest]of Object.entries(report.sources)){check(!isAbsolute(p)&&!p.split(/[\\/]/).includes('..')&&existsSync(p),'missing_source_'+name);check(hash(readFileSync(p))===digest,'stale_source_'+name);}}
function analysisResults(report){
 const data=verified(report.resultManifest,'analysis_results');check(data.status==='PASS','analysis_results_status');bindings(data,'analysis_results');
 check(data.runtimeClosureSHA256===report.runtimeClosureSHA256&&canonical(data.design)===canonical(ANALYSIS_DESIGN),'analysis_results_binding');
 check(report.implementation&&data.sources[report.implementation.path]===report.implementation.sha256,'analysis_implementation_binding');
 const expected=new Set(ANALYSIS_DESIGN.effects.flatMap(effect=>ANALYSIS_DESIGN.discordance.flatMap(discordance=>ANALYSIS_DESIGN.icc.flatMap(icc=>ANALYSIS_DESIGN.regimes.map(regime=>canonical([effect,discordance,icc,regime]))))));
 check(Array.isArray(data.power)&&data.power.length===60,'analysis_power_cells');
 for(const row of data.power){const key=canonical([row.effect,row.discordance,row.icc,row.regime]);check(expected.delete(key)&&row.datasets===2000&&row.primaryDraws===10000&&row.lineageDraws===10000,'analysis_power_cell');for(const field of ['contrastCoverage','guardCoverage','advancementProbability'])check(Number.isFinite(row[field])&&row[field]>=0&&row[field]<=1,'analysis_power_metrics');}
 check(expected.size===0,'analysis_power_grid');
 const coverage=new Set(['pilot','development','test'].flatMap(allocation=>['homogeneous-Bernoulli','heterogeneous-Bernoulli','homoscedastic-normal','heteroscedastic-normal'].map(scenario=>canonical([allocation,scenario]))));
 check(Array.isArray(data.coverage)&&data.coverage.length===12,'analysis_coverage_cells');
 for(const row of data.coverage){check(coverage.delete(canonical([row.allocation,row.scenario]))&&row.datasets===2000&&row.draws===10000,'analysis_coverage_cell');check(Number.isFinite(row.coverage)&&row.coverage>=0&&row.coverage<=1&&Math.abs(row.monteCarloSE-Math.sqrt(row.coverage*(1-row.coverage)/2000))<1e-12,'analysis_coverage_uncertainty');}
 check(coverage.size===0&&Array.isArray(data.boundarySupplements)&&data.boundarySupplements.length>0,'analysis_boundary_supplements');
}
export function verifyPaidPreflight({path=PAID_PREFLIGHT_PATH,carry,inputs,out,stage='pilot'}={}){
 check(existsSync(path),'missing_record');let r;try{r=JSON.parse(readFileSync(path));}catch{fail('paid_preflight:malformed_record');}
 const applicable=requirementsForStage(stage);
 check(r.version==='hr3-paid-preflight-a4-v2'&&r.stage===stage&&r.scope===(stage==='pilot'?'one_uncalibrated_60_family_pilot':'one_'+stage+'_run'),'record_scope');
 const requirements=Object.fromEntries(applicable.map(x=>[x.id,x.clauses]));check(canonical(r.requirements)===canonical(requirements),'requirements_catalog');
 const evidence={};for(const {id}of applicable){evidence[id]=verified(r.evidence?.[id],id);check(evidence[id].status==='PASS','failed_'+id);bindings(evidence[id],id);}
 const closure=runtimeClosure();for(const [id,report]of Object.entries(evidence))check(report.runtimeClosureSHA256===hash(closure.files),'stale_binding_'+id);
 const {output,requests,embeddings,privacy,conformance,allocation,accounting,analysisCoverage,resources,supervision,freshRun,freeze,review}=evidence;
 check(output.minimumMarginPercent>=10&&output.structures?.length>0&&output.structures.every(s=>s.failures===0&&s.worst.marginPercent>=10),'output_margin');
 check(requests.minimumMarginPercent>=5&&requests.rows?.length>0&&requests.rows.every(x=>x.pass===true&&Number.isSafeInteger(x.reservation)&&x.reservation>0&&Number.isSafeInteger(x.limit)&&x.reservation*100<=x.limit*95),'request_margin');
 check(embeddings.cumulativeProjection&&Object.values(embeddings.cumulativeProjection).every(x=>x.withinAllowance===true&&Number.isSafeInteger(x.projectedCompleteRunUnits)&&x.projectedCompleteRunUnits>=0&&x.projectedCompleteRunUnits<=64000000),'embedding_capacity');
 check(embeddings.maxInputUnits<=8192&&embeddings.maxRequestUnits<=300000&&embeddings.maxRequestBytes<=2097152,'embedding_bounds');
 check(privacy.completePilot===true&&privacy.readerRequests?.total===480&&privacy.readerRequests.hits===0&&privacy.extractionRequests?.total===240&&privacy.extractionRequests.hits===0&&privacy.productPayloads?.hits===0&&privacy.pReturnedContextUnchanged,'privacy_coverage');
 check(conformance.fullFakePilot===480&&conformance.allSuitesPass===true&&conformance.context?.adoptedContexts>0&&conformance.context.unresolvedContexts>0&&conformance.context.sharedTurnAmbiguities>0,'conformance_coverage');
 check(allocation.families===60&&allocation.lineages===30&&typeof allocation.freshSeed==='string'&&allocation.freshSeed.trim()&&allocation.heldOutRendered===false&&Object.values(allocation.byType??{}).length===5&&Object.values(allocation.byType).every(x=>x===12)&&allocation.languagesVerified===true&&allocation.causalControlsVerified===true&&allocation.lineageMultiplicityVerified===true,'allocation');
 check(inputs&&allocation.inputManifest?.path===inputs+'/manifest.json'&&hash(readFileSync(allocation.inputManifest.path))===allocation.inputManifest.sha256,'input_manifest');
 check(carry&&accounting.carrySHA256===carry.manifestSHA256&&accounting.completeThirdPilotMerged===true&&Number.isSafeInteger(accounting.cumulativePilotBoundNanodollars)&&accounting.cumulativePilotBoundNanodollars>=0&&accounting.cumulativePilotBoundNanodollars<=50e9,'accounting');
 if(stage!=='pilot'){
 check(canonical(analysisCoverage.design)===canonical(ANALYSIS_DESIGN)&&analysisCoverage.scoreInterface==='hr3-scorer-a4-v2','analysis_design');
 for(const key of ['adapterParity','correctedVarianceCovariance','directCountParity','pairedSharedDraws','lineageSensitivity','iccMarginals','boundarySupplements','coverageAndMonteCarloPublished','undercoverageReviewed'])check(analysisCoverage.checks?.[key]===true,'analysis_'+key);
 analysisResults(analysisCoverage);
 check(analysisCoverage.powerDatasets===120000&&analysisCoverage.coverageDatasets===24000&&analysisCoverage.correctedDrawsPerDataset===10000&&analysisCoverage.lineageDrawsPerPowerDataset===10000,'analysis_workload');
 check(resources.measured===true&&resources.subscriptionBenchmark===true&&resources.optimizationBenchmark===true&&resources.quotaSufficient===true&&resources.concurrencyAllocated===true&&resources.supervisionVerified===true&&Number.isFinite(resources.analysisHoursAllocated)&&resources.analysisHoursAllocated>=36,'resources');
 }
 check(supervision.suppliedBy==='primary'&&supervision.completed===true&&supervision.attended===true&&supervision.progressChecksAtLeastEveryMinute===true&&supervision.stopRulesAccepted===true&&supervision.testOnly!==true,'supervision');
 check(out&&!isAbsolute(out)&&!out.split(/[\\/]/).includes('..')&&freshRun.outputDirectory===out,'run_output_binding');
 check(freshRun.freshCachesAndStores===true&&freshRun.noPriorAnswers===true&&freshRun.noPooling===true&&freshRun.noQualityRetries===true&&freshRun.noUnlistedCalls===true&&freshRun.extractionCalls===240&&freshRun.readerCalls===480&&freshRun.transportRetries===1&&freshRun.reporting==='Uncalibrated engineering pilot — mechanical score bounds; no adjudication.','fresh_run');
 check(freeze.runtimeClosure&&canonical(freeze.runtimeClosure.files)===canonical(closure.files)&&canonical(freeze.runtimeClosure.externalFiles)===canonical(closure.externalFiles),'freeze_closure');
 check(freeze.errataSHA256===hash(readFileSync('evaluation/hr3/protocol/errata.md')),'freeze_errata');
 for(const [p,spec]of Object.entries(freeze.hashes??{}))check(existsSync(p)&&hash(readFileSync(p))===spec.sha256,'stale_freeze_file');
 check(review.testOnly!==true,'test_review_forbidden');
 check(review.suppliedBy==='primary'&&review.nonAuthor===true&&typeof review.reviewer==='string'&&review.reviewer.trim()&&review.decision===(stage==='pilot'?'acceptable_for_paid_pilot':'acceptable_for_'+stage)&&canonical(review.amendments)===canonical(['A-4','A-4.1','A-4.2','A-1.1']),'non_author_review');
 check(review.freezeSHA256===r.evidence.freeze.sha256&&review.closureSHA256===hash(closure.files)&&review.evidenceBindings&&canonical(review.evidenceBindings)===canonical(Object.fromEntries(Object.entries(r.evidence).filter(([k])=>k!=='review'))),'review_binding');
 return {status:'PASS',recordSHA256:hash(readFileSync(path)),reviewSHA256:r.evidence.review.sha256,requirements:applicable.map(x=>x.id)};
}

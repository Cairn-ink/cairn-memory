#!/usr/bin/env node
// §14's complete reservation plan and planning forecast, recomputed offline.
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { resolve } from 'node:path';
import { CAPS as STAGE_LIMITS } from './ledger.mjs';
import { OUTPUT_CAPS, INPUT_CAPS, READER_INPUT_CAPS, responseRequest, embeddingRequest, validateRequest } from './requests.mjs';
import {loadCarryForward} from './accounting.mjs';
import { hash } from './common.mjs';

// USD per token expressed in integer nanodollars. Prices supplied as verified
// by the primary on 2026-10-25; this offline program performs no re-verification.
export const RATES = Object.freeze({ primary: { input: 400, output: 1600 }, alternative: { input: 750, output: 4500 }, embedding: { input: 20 } });
export const STAGES = Object.freeze([
  { stage: 'pilot', families: 60, extractionCalls: 240, readerCalls: 480, extractor: 'primary' },
  { stage: 'development', families: 200, extractionCalls: 800, readerCalls: 1600, extractor: 'primary' },
  { stage: 'test', families: 1600, extractionCalls: 6400, readerCalls: 12800, extractor: 'primary' },
  { stage: 'alternative', families: 200, extractionCalls: 800, readerCalls: 800, extractor: 'alternative' },
]);
const usd = n => n / 1e9;
const inputCeilings = INPUT_CAPS;
const inputForecast = { extraction: 8000, reader: 6000 };
const charge = (input, output, rate) => input * rate.input + output * rate.output;

export function budgetA2() {
  const protocol = new URL('../protocol/protocol-v0.3.4.md', import.meta.url);
  const errata = new URL('../protocol/errata.md', import.meta.url);
  assert.match(readFileSync(errata, 'utf8'), /## A-2 /);
  for (const [operation, alternative] of [['reader', false], ['extraction', false], ['extraction', true]]) {
    const bound = validateRequest({ operation, body: responseRequest(operation, {}, { alternative }) });
    const rate = alternative ? RATES.alternative : RATES.primary;
    assert.equal(bound.inputRate, rate.input);
    assert.equal(bound.outputRate, rate.output);
    assert.equal(bound.output, OUTPUT_CAPS[operation]);
  }
  assert.deepEqual(OUTPUT_CAPS, { reader: 2176, extraction: 4352 });
  assert.equal(validateRequest({operation:'research-embedding',body:embeddingRequest(['offline'])}).inputRate, RATES.embedding.input);
  const unitReservations = Object.fromEntries(['primary', 'alternative'].map(model => [model,
    Object.fromEntries((model === 'alternative' ? ['extraction'] : ['extraction', 'reader']).map(operation => [operation, {
      inputCeiling: inputCeilings[operation], outputCeiling: OUTPUT_CAPS[operation],
      nanodollars: charge(inputCeilings[operation], OUTPUT_CAPS[operation], RATES[model]),
      USD: usd(charge(inputCeilings[operation], OUTPUT_CAPS[operation], RATES[model])),
    }]))]));
  const embeddingUnits = { research: 64000000, product: 64000000 };
  const embeddingNanodollars = Object.values(embeddingUnits).reduce((n, units) => n + units * RATES.embedding.input, 0);
  const stages = STAGES.map(spec => {
    const extractionAttempts = spec.extractionCalls * 2, readerAttempts = spec.readerCalls * 2;
    const extractionNanodollars = extractionAttempts * unitReservations[spec.extractor].extraction.nanodollars;
    const readerInputCeiling=spec.stage==='alternative'?INPUT_CAPS.reader:Object.values(READER_INPUT_CAPS).reduce((a,b)=>a+b,0)/4;
    const readerNanodollars=readerAttempts*charge(readerInputCeiling,OUTPUT_CAPS.reader,RATES.primary);
    const worstNanodollars = extractionNanodollars + readerNanodollars;
    const expectedNanodollars = spec.extractionCalls * charge(inputForecast.extraction, OUTPUT_CAPS.extraction, RATES[spec.extractor])
      + spec.readerCalls * charge(inputForecast.reader, OUTPUT_CAPS.reader, RATES.primary);
    return { ...spec, readerInputCeiling,readerInputCeilingByArm:spec.stage==='alternative'?null:READER_INPUT_CAPS,extractionAttempts, readerAttempts, extractionNanodollars, readerNanodollars,
      worstNanodollars, worstUSD: usd(worstNanodollars), expectedNanodollars, expectedUSD: usd(expectedNanodollars),
      existingLimitUSD: STAGE_LIMITS[spec.stage], existingMarginUSD: usd(Math.round(STAGE_LIMITS[spec.stage] * 1e9) - worstNanodollars),
      responsesCovered: worstNanodollars <= Math.round(STAGE_LIMITS[spec.stage] * 1e9),
      // Embedding units are shared, not preallocated to stages. The ledger
      // charges them to the active stage. Do not add this allowance four times.
      ceilingIfAllSharedEmbeddingsChargedHereUSD: usd(worstNanodollars + embeddingNanodollars),
      entireSharedEmbeddingAllowanceCovered: worstNanodollars + embeddingNanodollars <= Math.round(STAGE_LIMITS[spec.stage] * 1e9),
    };
  });
  const responseNanodollars = stages.reduce((n, s) => n + s.worstNanodollars, 0);
  const worstNanodollars = responseNanodollars + embeddingNanodollars;
  const expectedNanodollars = stages.reduce((n, s) => n + s.expectedNanodollars, 0) + embeddingNanodollars;
  assert.equal(expectedNanodollars % 4, 0);
  const contingencyNanodollars = expectedNanodollars / 4;
  // Reproduce §14's original ceiling as an independent transcription check.
  const historicalNanodollars = STAGES.reduce((n, s) => n + 2 * s.extractionCalls * charge(16384, 1024, RATES[s.extractor])
    + 2 * s.readerCalls * charge(20000, 768, RATES.primary), 0) + embeddingNanodollars;
  assert.equal(historicalNanodollars, 440905728000);
  const carry=loadCarryForward(new URL('./reports/a3-carry-forward.json',import.meta.url));
  const remainingEmbeddingNanodollars=(128000000-carry.exposure.embedding.research-carry.exposure.embedding.product)*20;
  const combined=carry.exposure.total+stages[0].worstNanodollars+remainingEmbeddingNanodollars;
  return {
    version: 'hr3-budget-a2-audited-v2', status: stages[0].worstNanodollars + embeddingNanodollars < 24e9 ? 'PASS_PILOT_BUDGET' : 'FAIL_PILOT_BUDGET',
    bindingPrePilotCriterion:'pilotFit',
    pilotFit:{pass:stages[0].worstNanodollars + embeddingNanodollars < 24e9,responsesUSD:usd(stages[0].worstNanodollars),sharedEmbeddingsUSD:usd(embeddingNanodollars),conservativeTotalUSD:usd(stages[0].worstNanodollars + embeddingNanodollars),limitUSD:24,marginUSD:usd(24e9-stages[0].worstNanodollars-embeddingNanodollars)},
    a3PilotRerun:{carryForward:{path:'evaluation/hr3/harness/reports/a3-carry-forward.json',sha256:carry.manifestSHA256},
      priorSettledNanodollars:carry.exposure.settled,priorOutstandingNanodollars:carry.exposure.outstanding,priorExposureNanodollars:carry.exposure.total,
      priorEmbeddingUnits:carry.exposure.embedding,remainingEmbeddingNanodollars,remainingPilotAllowanceNanodollars:24000000000-carry.exposure.total,
      freshResponseCeilingNanodollars:stages[0].worstNanodollars,combinedConservativeNanodollars:combined,combinedConservativeUSD:usd(combined),limitUSD:24,
      preparationComplete:carry.preparationComplete,scope:carry.preparationComplete?'Complete verified prior exposure':'Known verified exposure only; exact preparation receipts still pending',
      pass:combined<=24000000000,realRerunAllowed:carry.preparationComplete&&combined<=24000000000,pooled:false,paidAuthorization:false},
    theoreticalEnvelope:{covered:worstNanodollars<=450e9,totalUSD:usd(worstNanodollars),operationalStopUSD:450,blockingBeforePilot:false,interpretation:'Informational all-maximum-plus-retry envelope, superseded as a feasibility gate by revised A-2. It is not spending authorization.'},
    laterStageFeasibility:{status:'pending_paid_pilot_projection',computed:false,bindingBeforeDevelopment:true,completionCeilingUSD:400,allStageLimitsRequired:true,projectionInputSchema:{path:'evaluation/hr3/harness/reports/pre-development-projection.schema.json',sha256:hash(readFileSync(new URL('./reports/pre-development-projection.schema.json',import.meta.url)))},completeTestRequired:true,budgetExhaustionOutcome:'Inconclusive'},
    paidReadiness: false,
    sources: Object.fromEntries([
      ['evaluation/hr3/protocol/protocol-v0.3.4.md', protocol], ['evaluation/hr3/protocol/errata.md', errata],
      ...['budget-a2.mjs', 'accounting.mjs', 'reports/a3-carry-forward.json', 'reports/request-certification-a3.json', 'requests.mjs', 'ledger.mjs', 'projection-schema.mjs', 'reports/pre-development-projection.schema.json'].map(name => ['evaluation/hr3/harness/' + name, new URL(name, import.meta.url)]),
    ].map(([name, url]) => [name, hash(readFileSync(url))])),
    prices: { units: 'USD per 1M input/output tokens', primary: [0.40, 1.60], alternative: [0.75, 4.50], embeddingInput: 0.02,
      provenance: 'Primary-supplied verification of the OpenAI pricing page on 2026-10-25; no network verification in this offline run.', integerNanodollarsPerToken: RATES },
    assumptions: {
      authority: 'Protocol §14 counts/input ceilings/retry envelope/embedding allowances; A-2 output caps.',
      attemptsPerLogicalCall: 2, retry: 'One transport retry only; no quality retry. Protocol ceiling conservatively includes every retry even though the cumulative three-failure stop may stop execution earlier.',
      inputCeilings, inputReservation: 'UTF8 bytes of complete provider body + 4096, subject to the A-3 certified input ceilings.',
      outputCaps: OUTPUT_CAPS, forecastInputTokens: inputForecast, forecastOutputTokens: OUTPUT_CAPS,
      forecast: 'Same §14 planning method: single attempts, forecast input token assumptions, full output caps. A planning estimate, not measured usage or a probability-weighted expectation. Embedding allowances fully charged; 25% contingency added once.',
      alternative: '800 alternative extractions and 800 primary reader calls, not a second four-arm run; no additional P embedding allowance.',
      embeddings: 'Shared 64M research + 64M P units, retries and nested calls included in these cumulative allowances; charged once globally and also to the active stage. No reset across stages.',
    },
    unitReservations, stages,
    embeddings: { units: embeddingUnits, perChannelUSD: 1.28, totalNanodollars: embeddingNanodollars, totalUSD: usd(embeddingNanodollars),
      productSourceAllowanceArithmetic: '1860 * (32000 + 8 * 256) = 63329280 < 64000000', productSourceAllowanceUnits: 63329280 },
    totals: { responsesWorstUSD: usd(responseNanodollars), worstNanodollars, worstUSD: usd(worstNanodollars),
      expectedNanodollars, expectedUSD: usd(expectedNanodollars), contingencyPercent: 25, contingencyUSD: usd(contingencyNanodollars), forecastWithContingencyUSD: usd(expectedNanodollars + contingencyNanodollars),
      historicalWorstUSD: usd(historicalNanodollars), increaseUSD: usd(worstNanodollars - historicalNanodollars),
      operationalStopUSD: 450, operationalCovered: worstNanodollars <= 450e9, shortfallUSD: usd(Math.max(0, worstNanodollars - 450e9)),
      authorizationUSD: 500, unavailableHeadroomUSD: 50, effectiveSpendCeilingUSD: 450,
      grossAuthorizationCovered: worstNanodollars <= 500e9, grossAuthorizationShortfallUSD: usd(Math.max(0, worstNanodollars - 500e9)),
    },
    stageLimitProposal: {status:'deferred_to_continuation_projection',proposedLimits:null,applied:false,
      arithmetic:stages.map(s=>s.worstUSD.toFixed(6)).join(' + ')+' + 2.560000 = '+usd(worstNanodollars).toFixed(6),
      reason:'Existing stage limits remain unchanged until the paid-pilot continuation projection. The uncovered theoretical envelope does not block pilot budget fit or decide later-stage feasibility.',
      requiredNextStep:'After paid pilot settlement, freeze a reproducible total-completion projection <= $400 and verify every stage limit. Disclose any stage-limit rederivation within $450 before development; retain $500 authorization and full-test/Inconclusive rules.',
    },
  };
}

export function markdownSummary(report) {
  const money = x => '$' + x.toFixed(6);
  return `# A-2 budget after non-author audit (offline)

**Binding pre-pilot budget gate: ${report.pilotFit.pass?'PASS':'FAIL'}.** Pilot responses ${money(report.pilotFit.responsesUSD)} + the entire shared embedding allowance ${money(report.pilotFit.sharedEmbeddingsUSD)} = **${money(report.pilotFit.conservativeTotalUSD)}**, below $24 by ${money(report.pilotFit.marginUSD)}. This is budget fit only; certification and other scientific/resource gates remain separate.

**A-3 combined pilot ceiling (known verified exposure):** settled ${(report.a3PilotRerun.priorSettledNanodollars/1e9).toFixed(9)} USD + outstanding ${(report.a3PilotRerun.priorOutstandingNanodollars/1e9).toFixed(9)} USD + fresh responses ${(report.a3PilotRerun.freshResponseCeilingNanodollars/1e9).toFixed(9)} USD + remaining shared embeddings ${(report.a3PilotRerun.remainingEmbeddingNanodollars/1e9).toFixed(9)} USD = **${(report.a3PilotRerun.combinedConservativeNanodollars/1e9).toFixed(9)} USD**, within the shared $24 cap. Preparation completeness: **${report.a3PilotRerun.preparationComplete?'verified':'PENDING exact receipts; real rerun blocked'}**. All amounts derive from hash-verified ledger arithmetic, not the rounded $0.84. Embedding units already reserved are not restored. Runs are separate; this is not spending authorization.

| Stage | Calls extraction / reader | Planned cost | Theoretical all-maximum-plus-retry envelope | Existing stage limit |
|---|---:|---:|---:|---:|
${report.stages.map(s=>`| ${s.stage} | ${s.extractionCalls} / ${s.readerCalls} | ${money(s.expectedUSD)} | ${money(s.worstUSD)} | ${money(s.existingLimitUSD)} |`).join('\n')}
| Shared embeddings | 64M research + 64M P units | $2.560000 | $2.560000 | Charged to active stage |
| Total | | ${money(report.totals.expectedUSD)} | ${money(report.totals.worstUSD)} | $450 operational stop |

**Theoretical-envelope coverage: NO.** ${report.stageLimitProposal.arithmetic}, above $450 by ${money(report.totals.shortfallUSD)}. Revised A-2 explicitly supersedes this envelope as the feasibility gate. It is not spending authorization and does not block pilot budget fit. The planning forecast is ${money(report.totals.expectedUSD)} + 25% (${money(report.totals.contingencyUSD)}) = ${money(report.totals.forecastWithContingencyUSD)}; this estimate does not guarantee completion.

**Later-stage feasibility: PENDING, not computed from fake usage.** Before development, use real settled pilot usage and the frozen input schema in \`reports/pre-development-projection.schema.json\`. It covers all experiment spending, full outstanding reservations, every remaining stage, shared embeddings, alternative extraction and contingency. Require projected completion <= $400 and compliance with every stage limit. Freeze exact inputs, ledger/configuration/schema/implementation hashes and per-stage arithmetic before development. Any rederived stage limits must fit within $450 and be disclosed first.

Dynamic stage/$450 hard stops and the $500 authorization with $50 unavailable headroom remain unchanged. The complete test is still required; budget exhaustion makes the result Inconclusive. No stage-limit changes or continuation approval were made here. Verified rates and unchanged token/call assumptions are recorded in the JSON; no network, API or credentials were used.
`;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  assert.equal(process.argv.length, 2);
  const report = budgetA2();
  const output = new URL('./reports/budget-a2.json', import.meta.url);
  writeFileSync(output, JSON.stringify(report, null, 2) + '\n');
  writeFileSync(new URL('./reports/budget-a2.md', import.meta.url), markdownSummary(report));
  assert.deepEqual(JSON.parse(readFileSync(output, 'utf8')), report);
  process.stdout.write(JSON.stringify({ status: report.status, totals: report.totals, stageLimitProposal: report.stageLimitProposal }, null, 2) + '\n');
  process.exitCode = report.pilotFit.pass ? 0 : 1;
}

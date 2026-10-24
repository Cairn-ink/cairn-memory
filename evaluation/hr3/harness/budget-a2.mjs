#!/usr/bin/env node
// §14's complete reservation plan and planning forecast, recomputed offline.
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { resolve } from 'node:path';
import { CAPS as STAGE_LIMITS } from './ledger.mjs';
import { OUTPUT_CAPS, responseRequest, embeddingRequest, validateRequest } from './requests.mjs';
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
const inputCeilings = { extraction: 16384, reader: 20000 };
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
  assert.deepEqual(OUTPUT_CAPS, { reader: 2048, extraction: 4096 });
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
    const readerNanodollars = readerAttempts * unitReservations.primary.reader.nanodollars;
    const worstNanodollars = extractionNanodollars + readerNanodollars;
    const expectedNanodollars = spec.extractionCalls * charge(inputForecast.extraction, OUTPUT_CAPS.extraction, RATES[spec.extractor])
      + spec.readerCalls * charge(inputForecast.reader, OUTPUT_CAPS.reader, RATES.primary);
    return { ...spec, extractionAttempts, readerAttempts, extractionNanodollars, readerNanodollars,
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
  const historicalNanodollars = STAGES.reduce((n, s) => n + 2 * s.extractionCalls * charge(inputCeilings.extraction, 1024, RATES[s.extractor])
    + 2 * s.readerCalls * charge(inputCeilings.reader, 768, RATES.primary), 0) + embeddingNanodollars;
  assert.equal(historicalNanodollars, 440905728000);
  return {
    version: 'hr3-budget-a2-v1', status: worstNanodollars <= 450e9 ? 'PASS' : 'FAIL_NO_FEASIBLE_STAGE_LIMITS_WITHIN_450',
    paidReadiness: false,
    sources: Object.fromEntries([
      ['evaluation/hr3/protocol/protocol-v0.3.4.md', protocol], ['evaluation/hr3/protocol/errata.md', errata],
      ...['budget-a2.mjs', 'requests.mjs', 'ledger.mjs'].map(name => ['evaluation/hr3/harness/' + name, new URL(name, import.meta.url)]),
    ].map(([name, url]) => [name, hash(readFileSync(url))])),
    prices: { units: 'USD per 1M input/output tokens', primary: [0.40, 1.60], alternative: [0.75, 4.50], embeddingInput: 0.02,
      provenance: 'Primary-supplied verification of the OpenAI pricing page on 2026-10-25; no network verification in this offline run.', integerNanodollarsPerToken: RATES },
    assumptions: {
      authority: 'Protocol §14 counts/input ceilings/retry envelope/embedding allowances; A-2 output caps.',
      attemptsPerLogicalCall: 2, retry: 'One transport retry only; no quality retry. Protocol ceiling conservatively includes every retry even though the cumulative three-failure stop may stop execution earlier.',
      inputCeilings, inputReservation: 'UTF8 bytes of complete provider body + 4096, subject to the unchanged input ceilings.',
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
    stageLimitProposal: { feasible: false, proposedLimits: null, applied: false,
      arithmetic: stages.map(s => s.worstUSD.toFixed(6)).join(' + ') + ' + 2.560000 = ' + usd(worstNanodollars).toFixed(6) + ' > 450.000000',
      reason: 'No stage redistribution within $450 can cover the unchanged complete all-retries plan. The test response ceiling alone exceeds $450. Stage limits and $450/$500 hard stops remain unchanged and fail closed.',
      requiredNextStep: 'Primary amendment of the workload/reservation design is required. Do not silently reduce calls, retries, evidence, or input/output caps; do not raise the $450 stop or $500 authorization.',
    },
  };
}

export function markdownSummary(report) {
  const money = x => '$' + x.toFixed(6);
  return `# A-2 budget recomputation (offline)

The output caps pass certification separately. The complete protocol reservation plan does **not** fit the unchanged operational budget.

| Stage | Extraction / reader calls | Attempts at ceiling | Expected planned cost | Worst reservation | Existing limit | Covered |
|---|---:|---:|---:|---:|---:|---|
${report.stages.map(s => `| ${s.stage} | ${s.extractionCalls} / ${s.readerCalls} | ${s.extractionAttempts} / ${s.readerAttempts} | ${money(s.expectedUSD)} | ${money(s.worstUSD)} | ${money(s.existingLimitUSD)} | ${s.responsesCovered ? 'Yes' : 'No'} |`).join('\n')}
| Shared research + P embeddings | — | Within shared unit allowances | $2.560000 | $2.560000 | Shared | — |
| Total | | | ${money(report.totals.expectedUSD)} | ${money(report.totals.worstUSD)} | $450.000000 | No |

Reservations per attempt are: primary extraction $0.0131072, primary reader $0.0112768, alternative extraction $0.0307200. Each stage reserves twice its logical call counts. Embeddings add (64M + 64M) × $0.02/M = $2.56 once. They also consume the active stage's limit, rather than providing an extra stage allowance.

${report.stageLimitProposal.arithmetic}. The $450 shortfall is ${money(report.totals.shortfallUSD)}. Even the gross $500 authorization is short by ${money(report.totals.grossAuthorizationShortfallUSD)}, before preserving its unavailable $50 headroom. No valid stage-limit allocation within $450 exists; no limit changes were applied.

The forecast uses the unchanged §14 input assumptions (8,000 extraction / 6,000 reader), the new full output caps, one attempt per call, and the full embedding allowance. It is ${money(report.totals.expectedUSD)} + 25% (${money(report.totals.contingencyUSD)}) = **${money(report.totals.forecastWithContingencyUSD)}**. This is a planning assumption, not measured model usage. Rates are the primary-supplied 2026-10-25 verification; no network or API was used.

The original ceiling reproduces exactly at $440.905728; A-2 increases it by ${money(report.totals.increaseUSD)}. Further primary amendment of the workload/reservation design is required before the complete paid plan is feasible. The operational stop remains $450 and authorization remains $500.
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
  process.exitCode = report.status === 'PASS' ? 0 : 1;
}

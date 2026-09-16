import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { exportBasisCoverageEvidence } from '../basis-coverage-evidence.mjs';
import { getBasisCoveragePins, BASIS_COVERAGE_LIMITS } from '../basis-coverage-pilot.mjs';

const fixture = JSON.parse(readFileSync(new URL('../basis-coverage-fixture.json', import.meta.url)));
const SOURCE_HEAD = '28a403f1fbd91064cc168c6d20e1f66fe9ad69bc';
const RAW_SHA = 'a'.repeat(64);
const EMPTY_WIRE = { countRequests: 0, generationRequests: 0, pricedGenerations: 0,
  inputTokens: 0, outputTokens: 0, estimatedGenerationMicroUsd: 0, countRequestCost: 'none' };
const WIRE = { countRequests: 1, generationRequests: 1, pricedGenerations: 1,
  inputTokens: 100, outputTokens: 10, estimatedGenerationMicroUsd: 37,
  countRequestCost: 'unknown_without_usage' };
const stage = name => ({ name, status: 'not_run', requests: [], proposal: null,
  rebasedProposal: null, compiled: null, error: null, durationMs: null });
function sample() {
  return { version: 1, id: 'basis-coverage-pilot-v1', status: 'halted', offline: false,
    ingestion: fixture.ingestion, semanticReviewRequired: true,
    comparison: 'workflow-cost-quality; not equal-compute or held-out', model: 'gpt-5.6-luna',
    reasoning: 'none', limits: BASIS_COVERAGE_LIMITS, pins: getBasisCoveragePins(),
    capabilitySha256: 'sensitive-private-value', privatePath: '/tmp/private-evidence',
    budgetBefore: { requestCount: 4, reservedMicroUsd: 12000, knownUsageMicroUsd: 100,
      unknownCostRequests: 2, unsettled: 0, limitMicroUsd: 50000000, requestCap: 5000, state: 'open' },
    budgetAfter: { requestCount: 4, reservedMicroUsd: 12000, knownUsageMicroUsd: 100,
      unknownCostRequests: 2, unsettled: 0, limitMicroUsd: 50000000, requestCap: 5000, state: 'open' },
    attempt: { before: { requestCount: 4, reservedMicroUsd: 12000 }, requests: 0,
      reservedMicroUsd: 0, halted: null, readOnly: false, hidden: '/tmp/private' },
    wire: EMPTY_WIRE, slots: fixture.cases.flatMap((item, caseIndex) =>
      (caseIndex % 2 ? ['coverage', 'baseline'] : ['baseline', 'coverage']).map(arm => ({
        caseId: item.id, arm, status: 'not_run', durationMs: null,
        stages: arm === 'coverage' ? [stage('local-0'), stage('local-1'), stage('global')] : [stage('global')],
        hidden: 'Bearer private-value-should-not-escape',
      }))) };
}
function setParsed(report, slotIndex, stageIndex, output, { status = 'raw_invalid', compiled = null } = {}) {
  const slot = report.slots[slotIndex], current = slot.stages[stageIndex];
  current.status = status; current.compiled = compiled; current.error = status === 'raw_invalid' ? 'invalid_model_output' : null;
  current.durationMs = 3; slot.status = status === 'raw_invalid' ? 'failed' : 'completed'; slot.durationMs = 4;
  current.requests = [
    { sequence: 1, route: '/responses/input_tokens', outputStatus: 'not_generation', responseText: '{}', private: 'secret' },
    { sequence: 2, route: '/responses', outputStatus: 'parsed', output,
      responseText: JSON.stringify({ usage: { input_tokens: 100, output_tokens: 10, total_tokens: 110 },
        provider_response_id: 'should-not-escape' }) },
  ];
  refresh(report);
}
function refresh(report) {
  const all = report.slots.flatMap(slot => slot.stages.flatMap(value => value.requests));
  all.forEach((item, index) => { item.sequence = index + 1; });
  const wireFor = requests => {
    const n = requests.filter(item => item.route === '/responses').length;
    return n ? { countRequests: n, generationRequests: n, pricedGenerations: n,
      inputTokens: 100 * n, outputTokens: 10 * n, estimatedGenerationMicroUsd: 37 * n,
      countRequestCost: 'unknown_without_usage' } : EMPTY_WIRE;
  };
  for (const slot of report.slots) if (slot.stages.some(value => value.requests.length)) {
    slot.wire = wireFor(slot.stages.flatMap(value => value.requests));
  }
  report.wire = wireFor(all);
  report.attempt.requests = all.length; report.attempt.reservedMicroUsd = all.length * 3000;
  report.budgetAfter.requestCount = report.budgetBefore.requestCount + all.length;
  report.budgetAfter.reservedMicroUsd = report.budgetBefore.reservedMicroUsd + all.length * 3000;
}
const project = report => exportBasisCoverageEvidence(report, { sourceHead: SOURCE_HEAD, rawReportSha256: RAW_SHA });

test('BCE1 closed 16-slot schedule preserves unrun stages and drops private metadata', () => {
  const evidence = project(sample());
  assert.equal(evidence.slots.length, 16);
  assert.equal(evidence.slots.flatMap(slot => slot.stages).length, 32);
  assert.ok(evidence.slots.every(slot => slot.status === 'not_run'
    && slot.stages.every(value => value.proposal.state === 'not_generated' && value.compiled === null)));
  assert.equal(evidence.sourceHead, SOURCE_HEAD); assert.equal(evidence.rawReportSha256, RAW_SHA);
  assert.deepEqual(evidence.sourcePins, getBasisCoveragePins());
  assert.equal(evidence.attempt.halted, false);
  assert.ok(!JSON.stringify(evidence).includes('/tmp/private'));
  assert.ok(!JSON.stringify(evidence).includes('Bearer private-value'));
  assert.ok(!JSON.stringify(evidence).includes('capabilitySha256'));
});

test('BCE2 parsed schema-invalid raw endpoint and empty/local/unrun states remain distinct', () => {
  const report = sample();
  setParsed(report, 10, 0, { units: [], links: [] }, { status: 'compiled_empty', compiled: { units: [], links: [] } });
  setParsed(report, 10, 1, { units: [{ memory: 0, receipt: 0, role: 'update' }], links: [] });
  const projected = project(report);
  const candidate = projected.slots[10];
  assert.equal(candidate.caseId, 'explicit-replacement'); assert.equal(candidate.arm, 'coverage');
  assert.equal(candidate.stages[0].status, 'compiled_empty');
  assert.equal(candidate.stages[1].status, 'raw_invalid');
  assert.deepEqual(candidate.stages[1].proposal, { state: 'parsed',
    units: [{ memory: 0, receipt: 0, role: 'update' }], links: [] });
  assert.equal(candidate.stages[1].compiled, null);
  assert.equal(candidate.stages[2].status, 'not_run');
  assert.equal(candidate.stages[2].proposal.state, 'not_generated');
  assert.deepEqual(candidate.stages[1].requestSourceIndices, [1]);
  assert.deepEqual(candidate.stages[1].wire, WIRE);
  assert.ok(!JSON.stringify(projected).includes('should-not-escape'));
});

test('BCE3 compiled anchors publish source-local positions, not synthetic IDs or private provider envelopes', () => {
  const report = sample();
  const excerpt = fixture.cases[0].memories[0].excerpt;
  const quote = excerpt.slice(0, 7);
  const compiled = { units: [{ index: 0, role: 'decision', memoryId: 'synthetic-0', revision: 1,
    receiptId: 'synthetic-receipt-0', anchor: { start: 0, end: quote.length, text: quote },
    interpretationStatus: 'model-proposed' }], links: [] };
  setParsed(report, 0, 0, { units: [{ memory: 0, receipt: 0, quote, role: 'decision' }], links: [] },
    { status: 'compiled', compiled });
  const evidence = project(report);
  const unit = evidence.slots[0].stages[0].compiled.units[0];
  assert.deepEqual(unit, { index: 0, source: 0, requestMemory: 0, receipt: 0,
    role: 'decision', anchor: { start: 0, end: quote.length, text: quote },
    interpretationStatus: 'model-proposed' });
  assert.ok(!JSON.stringify(evidence).includes('synthetic-receipt'));
  compiled.units[0].anchor.text = 'wrong';
  assert.throws(() => project(report), /invalid_basis_coverage_evidence/);
});

test('BCE4 malformed, unavailable and parsed-invalid-shape never masquerade as empty', () => {
  const report = sample();
  setParsed(report, 0, 0, { units: [], links: [] });
  let evidence = project(report); assert.equal(evidence.slots[0].stages[0].proposal.state, 'parsed');
  report.slots[0].stages[0].requests[1].outputStatus = 'malformed';
  evidence = project(report); assert.equal(evidence.slots[0].stages[0].proposal.state, 'malformed_json');
  report.slots[0].stages[0].requests[1].outputStatus = 'not_generation';
  evidence = project(report); assert.equal(evidence.slots[0].stages[0].proposal.state, 'unavailable');
  report.slots[0].stages[0].requests[1].outputStatus = 'parsed';
  report.slots[0].stages[0].requests[1].output = { units: 'bad', links: [] };
  evidence = project(report);
  assert.deepEqual(evidence.slots[0].stages[0].proposal,
    { state: 'parsed_invalid_shape', unitsShape: 'string', linksShape: 'array' });
});

test('BCE4b a compiled-empty claim without parsed generation, or a completed slot with unrun stage, rejects', () => {
  const report = sample();
  report.slots[0].status = 'completed'; report.slots[0].durationMs = 1;
  report.slots[0].stages[0].status = 'compiled_empty';
  report.slots[0].stages[0].durationMs = 1;
  report.slots[0].stages[0].compiled = { units: [], links: [] };
  assert.throws(() => project(report), /invalid_basis_coverage_evidence/);
  setParsed(report, 0, 0, { units: [], links: [] },
    { status: 'compiled_empty', compiled: { units: [], links: [] } });
  assert.equal(project(report).slots[0].status, 'completed');
  report.slots[0].status = 'not_run';
  assert.throws(() => project(report), /invalid_basis_coverage_evidence/);
  report.slots[0].status = 'completed';
  const candidate = report.slots[1];
  candidate.status = 'completed'; candidate.durationMs = 1;
  assert.throws(() => project(report), /invalid_basis_coverage_evidence/);
});

test('BCE5 unsafe retained values and provenance/order/cost tampering reject; unknown data does not publish', () => {
  const report = sample();
  setParsed(report, 0, 0, { units: [{ memory: 0, receipt: 0, quote: 'safe', role: 'decision',
    arbitrary: { private: '/tmp/hidden' } }], links: [] });
  let evidence = project(report);
  assert.equal(evidence.slots[0].stages[0].proposal.units[0].unexpectedFields, true);
  assert.ok(!JSON.stringify(evidence).includes('/tmp/hidden'));
  for (const quote of ['/tmp/private', 'Bearer private-value-12345', 'sk-ABCDEFGHIJKLMNOPQRST']) {
    report.slots[0].stages[0].requests[1].output.units[0].quote = quote;
    assert.throws(() => project(report), /invalid_basis_coverage_evidence/);
  }
  report.slots[0].stages[0].requests[1].output.units[0].quote = 'safe';
  const swapped = structuredClone(report); [swapped.slots[0], swapped.slots[1]] = [swapped.slots[1], swapped.slots[0]];
  assert.throws(() => project(swapped), /invalid_basis_coverage_evidence/);
  const pins = structuredClone(report); pins.pins['core/source-basis.mjs'] = '0'.repeat(64);
  assert.throws(() => project(pins), /invalid_basis_coverage_evidence/);
  const cost = structuredClone(report); cost.wire.inputTokens = 99;
  assert.throws(() => project(cost), /invalid_basis_coverage_evidence/);
  assert.throws(() => exportBasisCoverageEvidence(report, { sourceHead: SOURCE_HEAD,
    rawReportSha256: 'bad' }), /invalid_basis_coverage_evidence/);
  assert.equal(createHash('sha256').update('synthetic').digest('hex').length, 64);
});

const publishedBytes = readFileSync(new URL('../../../evaluations/results/basis-coverage-pilot-v1.json', import.meta.url));
const published = JSON.parse(publishedBytes);
test('BCE6 fixed public projection preserves all rejected raw proposals, unrun stages and accounting', () => {
  assert.equal(createHash('sha256').update(publishedBytes).digest('hex'),
    '2c57d8d3f897be7a3cf60ef12aa9904b730ce598999824a5622f7400c221c718');
  assert.equal(published.sourceHead, SOURCE_HEAD);
  assert.equal(published.rawReportSha256, 'eea44bd6ce56c58779e1442eba953b35ab612e91b749408e8524a8914ccc08b9');
  assert.equal(published.slots.length, 16);
  assert.equal(published.slots.filter(slot => slot.status === 'failed').length, 3);
  const allStages = published.slots.flatMap(slot => slot.stages);
  assert.equal(allStages.length, 32);
  assert.equal(allStages.filter(value => value.status === 'not_run').length, 1);
  assert.equal(allStages.filter(value => value.proposal.state === 'parsed').length, 31);
  assert.equal(published.wire.countRequests, 31);
  assert.equal(published.wire.generationRequests, 31);
  assert.equal(published.wire.inputTokens, 23960); assert.equal(published.wire.outputTokens, 3404);
  assert.equal(published.wire.estimatedGenerationMicroUsd, 10074.8);
  assert.equal(published.attempt.requests, 62); assert.equal(published.attempt.reservedMicroUsd, 186000);
  assert.equal(published.budgetAfter.knownUsageMicroUsd - published.budgetBefore.knownUsageMicroUsd, 10097);
  assert.equal(published.budgetAfter.unknownCostRequests - published.budgetBefore.unknownCostRequests, 31);
  assert.equal(published.budgetAfter.unsettled, 0);
  assert.equal(published.slots.filter(slot => slot.arm === 'baseline' && slot.status === 'completed').length, 7);
  assert.equal(published.slots.filter(slot => slot.arm === 'coverage' && slot.status === 'completed').length, 6);
  for (const slot of published.slots.filter(value => value.caseId === 'considering-career-zh')) {
    const global = slot.stages.at(-1);
    assert.equal(global.status, 'raw_invalid'); assert.equal(global.compiled, null);
    assert.deepEqual(global.proposal.links, [{ from: 1, to: 0, relation: 'challenges-current-basis' }]);
    assert.equal(global.proposal.state, 'parsed');
  }
  const replacement = published.slots.find(slot => slot.caseId === 'explicit-replacement' && slot.arm === 'coverage');
  assert.equal(replacement.stages[1].status, 'raw_invalid');
  assert.deepEqual(replacement.stages[1].proposal.links.slice(0, 2), [
    { from: 1, to: 0, relation: 'challenges-current-basis' },
    { from: 2, to: 0, relation: 'challenges-current-basis' },
  ]);
  assert.equal(replacement.stages[2].status, 'not_run');
  assert.equal(replacement.stages[2].proposal.state, 'not_generated');
  const stale = published.slots.find(slot => slot.caseId === 'stale-report-zh' && slot.arm === 'coverage').stages.at(-1);
  assert.ok(stale.compiled.links.some(link => link.from === 2 && link.to === 0
    && link.relation === 'supports-decision'));
  assert.ok(stale.compiled.links.some(link => link.from === 3 && link.to === 2
    && link.relation === 'challenges-current-basis'));
  const temporary = published.slots.find(slot => slot.caseId === 'temporary-scope-zh' && slot.arm === 'coverage').stages.at(-1);
  assert.ok(temporary.compiled.links.some(link => link.from === 4 && link.to === 3
    && link.relation === 'challenges-current-basis'));
  for (const [caseIndex, item] of fixture.cases.entries()) {
    for (const slot of published.slots.slice(caseIndex * 2, caseIndex * 2 + 2)) {
      for (const value of slot.stages) for (const unit of value.compiled?.units ?? []) {
        const source = item.memories[unit.source].excerpt;
        assert.equal(source.slice(unit.anchor.start, unit.anchor.end), unit.anchor.text);
        assert.equal(unit.requestMemory, value.name === 'global' ? unit.source : 0);
      }
    }
  }
  assert.ok(!JSON.stringify(published).includes('provider_response_id'));
});

import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { exportRationaleModelEvidence } from '../rationale-model-evidence.mjs';
const bytes = readFileSync(new URL('../rationale-model-fixture.json', import.meta.url));
const fixture = JSON.parse(bytes);
const fixtureHash = createHash('sha256').update(bytes).digest('hex');
function sample() {
  const models = ['gpt-4.1-mini-2025-04-14', 'gpt-5.6-luna', 'gpt-5.6-sol'];
  return { version: 1, id: fixture.id, offline: false, ingestion: fixture.ingestion,
    semanticReviewRequired: true, pins: { fixture: fixtureHash }, sourceHead: 'synthetic',
    provenance: { artifactSha256: 'synthetic' }, limits: { requests: 96, microUsd: 2048000, perArmRequests: 2 },
    cases: fixture.cases.flatMap((item, i) => models.map((_, j) => models[(i + j) % 3])
      .flatMap((model, j) => ((i + j) % 2 ? ['focus', 'baseline'] : ['baseline', 'focus'])
        .map(arm => ({ id: `${item.id}-${model}-${arm}`, caseId: item.id, model, arm,
          status: 'not_run', records: [], review: null, warm: [], cold: [], traces: [] })))) };
}
test('RME1 exact frozen schedule retains every failed and not-run model arm', () => {
  assert.equal(fixtureHash, 'fdfe9258e4bb53496f39a9492d0071f290e038ea3e6c175f932862fec5da18b5');
  const raw = sample(); raw.cases[0].status = 'failed';
  const output = exportRationaleModelEvidence(raw);
  assert.equal(output.cases.length, 48); assert.equal(output.cases[0].status, 'failed');
  assert.equal(output.cases.filter(item => item.status === 'not_run').length, 47);
  raw.cases[0].model = 'other'; assert.throws(() => exportRationaleModelEvidence(raw));
});
test('RME2 unavailable or malformed proposal is not exported as empty edges', () => {
  const raw = sample();
  const trace = { requestBody: { max_output_tokens: 1024, input: [{ content: [{ text: '{"memories":[]}' }] }] },
    responseAvailable: true, providerResponse: { model: 'gpt-5.6-sol', output: [{ content: [{ text: 'malformed' }] }] } };
  raw.cases[0].traces = [trace];
  let item = exportRationaleModelEvidence(raw).cases[0].proposals[0];
  assert.equal(item.edges, null); assert.equal(item.outputAvailable, false);
  trace.providerResponse.output[0].content[0].text = '{"edges":[]}';
  item = exportRationaleModelEvidence(raw).cases[0].proposals[0];
  assert.deepEqual(item.edges, []); assert.equal(item.outputAvailable, true); assert.equal(item.responseModel, 'gpt-5.6-sol');
});
test('RME3 closed projection drops private operator metadata and rejects sensitive retained values', () => {
  const raw = sample(); raw.privatePath = '/tmp/private'; raw.provenance.packageRoot = '/home/private';
  raw.pins.authorization = 'Bearer synthetic-private';
  assert.ok(!JSON.stringify(exportRationaleModelEvidence(raw)).includes('private'));
  raw.sourceHead = '/tmp/private'; assert.throws(() => exportRationaleModelEvidence(raw), /sensitive_rationale_model_evidence/);
});
test('RME4 published evidence retains all 48 arms and unfavorable baseline/Luna/Sol outcomes', () => {
  const bytes = readFileSync(new URL('../../../evaluations/results/rationale-model-control-v1.json', import.meta.url));
  assert.equal(createHash('sha256').update(bytes).digest('hex'), '5c69612ab789f55c21f4cc42d8521557c6b268f0aa789d23e81267bf8e9c9668');
  const result = JSON.parse(bytes);
  assert.equal(result.cases.length, 48); assert.ok(result.cases.every(item => item.status === 'completed'));
  assert.equal(result.budgetAfter.requestCount - result.budgetBefore.requestCount, 96);
  assert.equal(result.budgetAfter.reservedMicroUsd - result.budgetBefore.reservedMicroUsd, 2048000);
  assert.equal(result.budgetAfter.knownUsageMicroUsd - result.budgetBefore.knownUsageMicroUsd, 75438);
  assert.equal(result.budgetAfter.unknownCostRequests - result.budgetBefore.unknownCostRequests, 48);
  assert.equal(result.budgetAfter.unsettled, 0);
  const at = id => result.cases.find(item => item.id === id).proposals[0].edges;
  assert.equal(at('assistant-recommendation-gpt-4.1-mini-2025-04-14-baseline')[0].relation, 'supports-decision');
  assert.deepEqual(at('two-reasons-storage-gpt-5.6-luna-focus').map(e => [e.from, e.to]), [[0, 1]]);
  assert.ok(at('two-reasons-storage-gpt-5.6-sol-focus').every(e => e.relation !== 'challenges-premise'));
  assert.ok(result.cases.every(item => JSON.stringify(item.warm) === JSON.stringify(item.cold)));
});

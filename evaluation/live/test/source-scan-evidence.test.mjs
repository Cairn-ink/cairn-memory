import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { exportSourceScanEvidence } from '../source-scan-evidence.mjs';

const cases = JSON.parse(readFileSync(new URL('../source-scan-fixture.json', import.meta.url))).cases;
function fixture() {
  return { version: 1, id: 'source-scan-ablation-v1', status: 'halted', ingestion: 'manual-oracle', semanticReviewRequired: true,
    fixtureSha256: '6e31bfd44eaf42de5c0c55e3ccbea617633547155869eec3c2b5d9d02f374eb5',
    provenance: { packageRoot: '/tmp/private' },
    cases: cases.flatMap((item, index) => (index % 2 ? ['source-scan', 'baseline'] : ['baseline', 'source-scan'])
      .map(arm => ({ id: `${item.id}-${arm}`, caseId: item.id, arm, status: 'not_run', records: [], recall: null, traces: [] }))) };
}
test('SE1 failed and unrun arms stay in the frozen denominator without semantic grading', () => {
  const report = fixture(); report.cases[0].status = 'failed';
  report.cases[0].recall = { ok: false, error: { code: 'invalid_model_output', retryable: false, private: '/tmp/private' } };
  const result = exportSourceScanEvidence(report);
  assert.equal(result.cases.length, 16); assert.equal(result.cases[0].status, 'failed');
  assert.equal(result.cases.filter(item => item.status === 'not_run').length, 15);
  assert.equal(result.semanticReview, 'required-not-inferred');
  assert.deepEqual(result.cases[0].recall, { ok: false, error: { code: 'invalid_model_output', retryable: false } });
  for (const mutate of [r => r.cases.pop(), r => r.cases.reverse(), r => { r.fixtureSha256 = 'a'.repeat(64); },
    r => { r.ingestion = 'automatic'; }, r => { r.semanticReviewRequired = false; }]) {
    const changed = fixture(); mutate(changed); assert.throws(() => exportSourceScanEvidence(changed));
  }
});
test('SE2 closed projection removes transport and namespace metadata and rejects retained secrets', () => {
  const report = fixture(); const record = report.cases[0];
  record.records = [{ memory: { id: 'synthetic', content: 'A synthetic choice.', namespace: '/home/private' },
    receipts: [{ id: 'r', role: 'user', excerpt: 'A synthetic choice.', sessionId: '/tmp/private' }] }];
  record.sourceCoverage = { required: 2, retainedRequired: 1, retainedIrrelevant: 0, private: '/tmp/private' };
  record.traces = [{ responseAvailable: false, headers: { authorization: 'Bearer private' } }];
  const result = exportSourceScanEvidence(report);
  assert.equal(JSON.stringify(result).includes('/tmp/'), false);
  assert.equal(Object.hasOwn(result.cases[0].records[0].memory, 'namespace'), false);
  assert.deepEqual(result.cases[0].sourceCoverage, { required: 2, retainedRequired: 1, retainedIrrelevant: 0 });
  assert.deepEqual(result.cases[0].transport, { requests: 1, unavailableResponses: 1 });
  for (const content of ['/tmp/private', 'Bearer private', `sk-proj-${'a'.repeat(50)}`]) {
    record.records[0].memory.content = content; assert.throws(() => exportSourceScanEvidence(report));
  }
});
test('SE3 missing model output is not reported as an empty selection', () => {
  const report = fixture(); const trace = { responseAvailable: false,
    requestBody: { max_output_tokens: 1024, text: { format: { name: 'cairn_select' } }, input: [{ content: [{ text: '{"maps":[],"query":"synthetic"}' }] }] },
    providerResponse: { output: [{ content: [{ text: '{"refs":[]}' }] }] } };
  report.cases[0].traces = [trace];
  assert.equal(exportSourceScanEvidence(report).cases[0].stages[0].output, null);
  trace.responseAvailable = true;
  assert.deepEqual(exportSourceScanEvidence(report).cases[0].stages[0].output, { refs: [] });
  trace.providerResponse.output[0].content[0].text = 'malformed';
  assert.equal(exportSourceScanEvidence(report).cases[0].stages[0].outputAvailable, false);
});
test('SE4 frozen live projection preserves stage attribution, fixed counts and cost uncertainty', () => {
  const bytes = readFileSync(new URL('../../../evaluations/results/source-scan-ablation-v1.json', import.meta.url));
  assert.equal(createHash('sha256').update(bytes).digest('hex'), '5b4138a542f0c20dba514c77057c202b410675642b312eea68e0ae55190d30d4');
  const result = JSON.parse(bytes);
  assert.equal(result.cases.length, 16); assert.ok(result.cases.every(item => item.status === 'completed'));
  for (const [arm, retained, requests] of [['baseline', 12, 30], ['source-scan', 16, 16]]) {
    const records = result.cases.filter(item => item.arm === arm);
    assert.equal(records.reduce((sum, item) => sum + item.sourceCoverage.required, 0), 16);
    assert.equal(records.reduce((sum, item) => sum + item.sourceCoverage.retainedRequired, 0), retained);
    assert.equal(records.reduce((sum, item) => sum + item.sourceCoverage.retainedIrrelevant, 0), 0);
    assert.equal(records.reduce((sum, item) => sum + item.transport.requests, 0), requests);
  }
  for (const caseId of ['printer-connection', 'voice-backup-zh', 'two-conditions']) {
    const baseline = result.cases.find(item => item.id === `${caseId}-baseline`);
    assert.equal(baseline.stages[0].output.refs.length, 1);
    assert.equal(baseline.stages[1].input.candidates.length, 1);
    assert.deepEqual(baseline.returnedSourceIndices, [0]);
  }
  const uncertain = result.cases.find(item => item.id === 'uncertain-course-baseline');
  assert.equal(uncertain.stages[0].output.refs.length, 3);
  assert.equal(uncertain.stages[1].input.candidates.length, 3);
  assert.deepEqual(uncertain.returnedSourceIndices, [2, 1]);
  assert.equal(result.attempt.requests, 46); assert.equal(result.attempt.reservedMicroUsd, 230000);
  assert.equal(result.budgetAfter.knownUsageMicroUsd - result.budgetBefore.knownUsageMicroUsd, 8392);
  assert.equal(result.budgetAfter.unknownCostRequests - result.budgetBefore.unknownCostRequests, 23);
  assert.equal(result.budgetAfter.reservedMicroUsd, 2690000); assert.equal(result.budgetAfter.unsettled, 0);
});

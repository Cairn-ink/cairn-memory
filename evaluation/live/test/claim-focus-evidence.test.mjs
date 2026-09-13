import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { exportClaimFocusEvidence } from '../claim-focus-evidence.mjs';

const cases = JSON.parse(readFileSync(new URL('../claim-focus-fixture.json', import.meta.url))).cases;
function fixture() {
  return { version: 1, id: 'claim-focus-ablation-v1', offline: false, ingestion: 'manual-authored-focus', status: 'failed',
    semanticReviewRequired: true, pins: { fixture: 'f4002b94bd4bb2bc2efd1594300084021e40b9cfa466eba999a287a35605d141' },
    provenance: { packageRoot: '/tmp/private' },
    cases: cases.flatMap((item, i) => (i % 2 ? ['focus', 'baseline'] : ['baseline', 'focus'])
      .map(arm => ({ id: `${item.id}-${arm}`, caseId: item.id, arm, status: 'not_run', records: [], review: null, warm: [], cold: [], traces: [] }))) };
}
test('CE1 closed schedule retains failures and unrun slots without inventing a semantic grade', () => {
  const report = fixture(); report.cases[0].status = 'failed';
  const result = exportClaimFocusEvidence(report);
  assert.equal(result.cases.length, 16); assert.equal(result.cases.filter(item => item.status === 'not_run').length, 15);
  assert.equal(result.semanticReview, 'required-not-inferred'); assert.equal(result.cases[0].review, null);
  for (const mutate of [r => r.cases.pop(), r => r.cases.reverse(), r => { r.offline = 'success'; },
    r => { r.pins.fixture = 'a'.repeat(64); }, r => { r.semanticReviewRequired = false; }]) {
    const changed = fixture(); mutate(changed); assert.throws(() => exportClaimFocusEvidence(changed));
  }
});
test('CE2 namespace, receipt metadata and provider metadata are excluded; retained secrets reject', () => {
  const report = fixture(); const item = report.cases[0];
  item.records = [{ ok: true, value: { memory: { id: 'synthetic', content: 'Not chosen.', namespace: '/home/private' },
    receipts: [{ id: 'r', role: 'user', excerpt: 'Not chosen.', sessionId: '/tmp/private' }] } }];
  item.review = { ok: false, error: { code: 'invalid_model_output', retryable: false, detail: 'Bearer private' } };
  const result = exportClaimFocusEvidence(report);
  assert.equal(JSON.stringify(result).includes('/tmp/'), false); assert.equal(JSON.stringify(result).includes('/home/'), false);
  assert.deepEqual(result.cases[0].review.error, { code: 'invalid_model_output', retryable: false });
  item.records[0].value.memory.content = 'Bearer private'; assert.throws(() => exportClaimFocusEvidence(report));
});
test('CE3 absent/malformed provider output remains distinct from empty edges and focus stays unverified', () => {
  const report = fixture(); const trace = { responseAvailable: false, requestBody: { max_output_tokens: 1024,
    input: [{ content: [{ text: JSON.stringify({ memories: [{ index: 0,
      focus: { content: 'Synthetic', interpretationStatus: 'unverified', private: '/tmp/private' }, receipts: [] }] }) }] }] },
    providerResponse: { output: [{ content: [{ text: '{"edges":[]}' }] }] } };
  report.cases[0].traces = [trace];
  assert.equal(exportClaimFocusEvidence(report).cases[0].proposals[0].edges, null);
  trace.responseAvailable = true;
  const value = exportClaimFocusEvidence(report).cases[0].proposals[0]; assert.deepEqual(value.edges, []);
  assert.deepEqual(value.memories[0].focus, { content: 'Synthetic', interpretationStatus: 'unverified' });
  trace.providerResponse.output[0].content[0].text = 'malformed';
  assert.equal(exportClaimFocusEvidence(report).cases[0].proposals[0].outputAvailable, false);
});
test('CE4 frozen evidence retains unfavorable tuples and exact accounting independently of cold persistence', () => {
  const bytes = readFileSync(new URL('../../../evaluations/results/claim-focus-ablation-v1.json', import.meta.url));
  assert.equal(createHash('sha256').update(bytes).digest('hex'), '0ccabc256518148bdefb8e9bc6ba8c6bd8da57a3684d6a8e22613719bb4ae9f0');
  const report = JSON.parse(bytes); assert.equal(report.cases.length, 16);
  assert.ok(report.cases.every(item => item.status === 'completed' && JSON.stringify(item.warm) === JSON.stringify(item.cold)));
  for (const [arm, count] of [['baseline', 9], ['focus', 6]]) {
    const records = report.cases.filter(item => item.arm === arm);
    assert.equal(records.reduce((sum, item) => sum + item.review.value.inserted, 0), count);
    assert.equal(records.reduce((sum, item) => sum + item.transport.requests, 0), 16);
  }
  const reversed = report.cases.find(item => item.id === 'two-premises-focus').proposals[0].edges;
  assert.deepEqual(reversed, [{ from: 0, to: 1, relation: 'challenges-premise', fromReceipt: 0, toReceipt: 0 }]);
  assert.equal(report.attempt.requests, 32); assert.equal(report.attempt.reservedMicroUsd, 160000);
  assert.equal(report.budgetAfter.knownUsageMicroUsd - report.budgetBefore.knownUsageMicroUsd, 4840);
  assert.equal(report.budgetAfter.unknownCostRequests - report.budgetBefore.unknownCostRequests, 16);
  assert.equal(report.budgetAfter.unsettled, 0); assert.equal(report.budgetAfter.reservedMicroUsd, 2850000);
});

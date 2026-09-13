import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { exportRationaleEvidence } from '../rationale-evidence.mjs';

const cases = JSON.parse(readFileSync(new URL('../rationale-fixture.json', import.meta.url))).cases;
function fixture() {
  return { version: 1, id: 'rationale-pilot-v1', semanticReviewRequired: true, status: 'halted',
    fixtureSha256: 'a7d3042027bf8dee46df16ef99bbe5be9a86beb622139a2795efe79fc0d73409',
    provenance: { artifactSha256: 'a'.repeat(64), packageRoot: '/tmp/private' },
    pins: { 'evaluation/live/rationale-pilot.mjs': 'b'.repeat(64), '/home/private': 'secret' },
    limits: { requests: 384, microUsd: 1920000, reservationMicroUsd: 5000 },
    cases: cases.flatMap((item, index) => (index % 2 ? ['candidate', 'baseline'] : ['baseline', 'candidate'])
      .map(arm => ({ id: `${item.id}-${arm}`, caseId: item.id, arm, status: 'not_run', coldStatus: 'not_run',
        captures: [], warmRecords: [], warmGraphs: [], recall: null, coldRecords: [], coldGraphs: [], replays: [], forgotten: [], traces: [] }))) };
}
test('RE1 all identities and failure denominators remain, no semantic grade is invented', () => {
  const report = fixture(); report.cases[0].status = 'failed';
  report.cases[0].captures = [{ ok: false, error: { code: 'invalid_model_output', retryable: false, private: '/tmp/private' } }];
  const result = exportRationaleEvidence(report);
  assert.equal(result.cases.length, 16); assert.equal(result.cases[0].status, 'failed');
  assert.equal(result.cases.filter(item => item.status === 'not_run').length, 15);
  assert.equal(result.semanticReview, 'required-not-inferred'); assert.equal(result.cases[0].recall, null);
  assert.deepEqual(result.cases[0].captures[0], { ok: false, error: { code: 'invalid_model_output', retryable: false } });
  assert.equal(JSON.stringify(result).includes('/tmp/'), false); assert.equal(JSON.stringify(result).includes('/home/'), false);
  for (const mutate of [r => r.cases.pop(), r => r.cases.reverse(), r => { r.fixtureSha256 = 'a'.repeat(64); },
    r => { r.cases[0].arm = 'candidate'; }, r => { r.id = 'other'; }, r => { r.semanticReviewRequired = false; }]) {
    const changed = fixture(); mutate(changed); assert.throws(() => exportRationaleEvidence(changed));
  }
});
test('RE2 closed source projection removes namespace and transport metadata, but refuses sensitive retained content', () => {
  const report = fixture(); report.cases[0].warmRecords = [{ ok: true, value: {
    memory: { id: 'synthetic', revision: 1, content: 'A synthetic fact.', namespace: { ownerId: '/home/private' } },
    receipts: [{ id: 'receipt', role: 'user', excerpt: 'A synthetic fact.', sessionId: '/tmp/private' }],
    qualification: null,
  } }];
  report.cases[0].traces = [{ requestBody: { headers: { authorization: 'Bearer private' } }, responseAvailable: false }];
  const result = exportRationaleEvidence(report);
  assert.deepEqual(result.cases[0].memories[0].value.receipts, [{ id: 'receipt', role: 'user', excerpt: 'A synthetic fact.' }]);
  assert.equal(Object.hasOwn(result.cases[0].memories[0].value.memory, 'namespace'), false);
  assert.deepEqual(result.cases[0].transport, { requests: 1, unavailableResponses: 1 });
  for (const text of ['/tmp/private', '/home/private', 'Bearer private', `sk-proj-${'a'.repeat(50)}`]) {
    report.cases[0].warmRecords[0].value.memory.content = text;
    assert.throws(() => exportRationaleEvidence(report));
  }
});

test('RE3 proposals are retained independently of exposed graphs, with only indexed sources and tuples', () => {
  const report = fixture(); const record = report.cases[1];
  record.traces = [{ method: 'cairn_relate', phase: 'capture-1', responseAvailable: true,
    requestBody: { max_output_tokens: 1024, authorization: 'Bearer private', input: [{ content: [{ text: JSON.stringify({
      memories: [{ index: 0, privatePath: '/tmp/private', receipts: [{ index: 0, role: 'user', excerpt: 'Synthetic.', privatePath: '/tmp/private' }] }],
    }) }] }] }, providerResponse: { privatePath: '/tmp/private', output: [{ content: [{ text: JSON.stringify({
      edges: [{ from: 0, to: 1, relation: 'challenges-premise', fromReceipt: 0, toReceipt: 0 }],
    }) }] }] } }];
  const result = exportRationaleEvidence(report);
  assert.equal(result.cases[1].graphs.length, 0);
  assert.equal(result.cases[1].proposals[0].edges[0].relation, 'challenges-premise');
  assert.equal(result.cases[1].proposals[0].candidates.length, 1);
  assert.equal(JSON.stringify(result).includes('/tmp/'), false);
  record.traces[0].responseAvailable = false;
  assert.equal(exportRationaleEvidence(report).cases[1].proposals[0].edges, null);
});

test('RE4 frozen live evidence retains all proposed versus exposed edges and honest cost components', () => {
  const bytes = readFileSync(new URL('../../../evaluations/results/rationale-pilot-v1.json', import.meta.url));
  assert.equal(createHash('sha256').update(bytes).digest('hex'), '0384051eac0c32e8cbb9c4e204a07c8f9c6c31808ff01160770638643dda752a');
  const result = JSON.parse(bytes); assert.equal(result.cases.length, 16);
  assert.ok(result.cases.every(record => record.status === 'completed' && record.coldStatus === 'completed'));
  assert.equal(result.semanticReview, 'required-not-inferred');
  assert.equal(result.cases.flatMap(record => record.proposals).flatMap(item => item.edges).length, 8);
  const exposed = new Set(result.cases.flatMap(record => record.graphs).flatMap(item => item.value.edges)
    .map(edge => JSON.stringify(edge)));
  assert.equal(exposed.size, 4);
  assert.equal(result.attempt.requests, 288); assert.equal(result.attempt.reservedMicroUsd, 1440000);
  assert.equal(result.budgetAfter.knownUsageMicroUsd - result.budgetBefore.knownUsageMicroUsd, 73096);
  assert.equal(result.budgetAfter.unknownCostRequests - result.budgetBefore.unknownCostRequests, 144);
  assert.equal(result.budgetAfter.unsettled, 0);
  const career = result.cases.find(record => record.id === 'subjective-not-trait-candidate');
  assert.ok(career.recall.value.memories.some(item => item.rationale.edges.some(edge => edge.relation === 'supports-decision')));
  assert.ok(career.recall.value.memories.some(item => item.receipts.some(receipt => receipt.excerpt.includes('still have not decided'))));
});

import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { exportSourceBasisEvidence } from '../source-basis-evidence.mjs';
const bytes = readFileSync(new URL('../source-basis-fixture.json', import.meta.url));
const fixture = JSON.parse(bytes);
const sha = value => createHash('sha256').update(value).digest('hex');
function sample() {
  const models = ['gpt-4.1-mini-2025-04-14', 'gpt-5.6-luna', 'gpt-5.6-sol'];
  return { version: 1, id: fixture.id, offline: false, ingestion: fixture.ingestion,
    semanticReviewRequired: true, pins: { fixture: sha(bytes) }, sourceHead: 'synthetic',
    provenance: { artifactSha256: 'synthetic' }, limits: { requests: 96, microUsd: 2048000, perArmRequests: 2 },
    cases: fixture.cases.flatMap((item, i) => models.map((_, j) => models[(i + j) % 3])
      .flatMap((model, j) => ((i + j) % 2 ? ['basis', 'baseline'] : ['baseline', 'basis'])
        .map(arm => ({ id: `${item.id}-${model}-${arm}`, caseId: item.id, model, arm,
          status: 'not_run', records: [], review: null, warm: [], cold: [], traces: [] })))) };
}
test('SBE1 exact frozen denominator retains failures/unrun slots without inferring cold success', () => {
  assert.equal(sha(bytes), 'e03780cf115becd1a507b73d1b7ae47f5550b311ee92802a595f73efaa2b0f5b');
  const raw = sample(); raw.cases[0].status = 'failed';
  const output = exportSourceBasisEvidence(raw);
  assert.equal(output.cases.length, 48); assert.equal(output.cases[0].status, 'failed');
  assert.equal(output.cases.filter(c => c.status === 'not_run').length, 47);
  assert.ok(output.cases.every(c => c.coldMatchesWarm === null));
  raw.cases.reverse(); assert.throws(() => exportSourceBasisEvidence(raw));
});
test('SBE2 malformed, unavailable and empty outputs stay distinct for both methods', () => {
  for (const [method, empty] of [['relate', { edges: [] }], ['reviewBasis', { units: [], links: [] }]]) {
    const raw = sample(); const trace = { requestBody: { max_output_tokens: 1024,
      text: { format: { name: `cairn_${method}` } }, input: [{ content: [{ text: '{"memories":[]}' }] }] },
    responseAvailable: true, providerResponse: { model: 'gpt-5.6-sol', output: [{ content: [{ text: 'malformed' }] }] } };
    raw.cases[0].traces = [trace];
    let p = exportSourceBasisEvidence(raw).cases[0].proposals[0];
    assert.equal(p.output, null); assert.equal(p.outputAvailable, false);
    trace.providerResponse.output[0].content[0].text = JSON.stringify(empty);
    p = exportSourceBasisEvidence(raw).cases[0].proposals[0]; assert.deepEqual(p.output, empty);
    assert.equal(p.outputAvailable, true);
    trace.responseAvailable = false;
    assert.equal(exportSourceBasisEvidence(raw).cases[0].proposals[0].output, null);
  }
});
test('SBE3 closed projection removes private metadata and rejects sensitive retained values', () => {
  const raw = sample(); raw.privatePath = '/tmp/private'; raw.provenance.packageRoot = '/home/private';
  raw.pins.authorization = 'Bearer synthetic-private';
  assert.ok(!JSON.stringify(exportSourceBasisEvidence(raw)).includes('private'));
  raw.sourceHead = '/tmp/private'; assert.throws(() => exportSourceBasisEvidence(raw), /sensitive_source_basis_evidence/);
});
const publishedBytes = readFileSync(new URL('../../../evaluations/results/source-basis-comparison-v1.json', import.meta.url));
const published = JSON.parse(publishedBytes);
test('SBE4 frozen publication preserves five rejections, exact accounting and nonpersistent cold state', () => {
  assert.equal(sha(publishedBytes), '5ac1be486898b2d3b57f600a1711fd03bff65397e2aece6f6b8a553668bfff75');
  assert.equal(published.cases.length, 48);
  assert.equal(published.cases.filter(c => c.status === 'completed').length, 43);
  assert.equal(published.cases.filter(c => c.review?.error?.code === 'invalid_model_output').length, 5);
  assert.equal(published.budgetAfter.requestCount - published.budgetBefore.requestCount, 96);
  assert.equal(published.budgetAfter.reservedMicroUsd - published.budgetBefore.reservedMicroUsd, 2048000);
  assert.equal(published.budgetAfter.knownUsageMicroUsd - published.budgetBefore.knownUsageMicroUsd, 82265);
  assert.equal(published.budgetAfter.unknownCostRequests - published.budgetBefore.unknownCostRequests, 48);
  assert.equal(published.budgetAfter.unsettled, 0);
  assert.ok(published.cases.every(c => c.originalSourcesUnchanged && c.coldMatchesWarm));
  assert.ok(published.cases.filter(c => c.arm === 'basis').every(c => c.basisNonpersistent));
});
test('SBE5 exact anchors do not erase accepted reaffirmation, temporal and scope errors', () => {
  const at = (id, model) => published.cases.find(c => c.caseId === id && c.model === model && c.arm === 'basis');
  const mini = at('two-speakers-one-receipt', 'gpt-4.1-mini-2025-04-14');
  assert.equal(mini.status, 'completed');
  const ferry = mini.proposals[0].output;
  assert.match(ferry.units[5].quote, /still allows/);
  assert.ok(ferry.links.some(link => link.from === 5 && link.to === 1 && link.relation === 'challenges-current-basis'));
  const luna = at('late-historical-report', 'gpt-5.6-luna');
  assert.equal(luna.status, 'completed');
  assert.match(luna.proposals[0].output.units[2].quote, /August 2/);
  assert.ok(luna.proposals[0].output.links.some(link => link.from === 2 && link.to === 1 && link.relation === 'challenges-current-basis'));
  const scope = at('temporary-work-scope', 'gpt-5.6-luna').proposals[0].output;
  assert.match(scope.units[0].quote, /library/); assert.match(scope.units[1].quote, /home/);
  assert.ok(scope.links.some(link => link.from === 0 && link.to === 1 && link.relation === 'supports-decision'));
  for (const c of published.cases.filter(c => c.arm === 'basis' && c.review?.ok)) {
    for (const unit of c.review.value.units) {
      const record = c.records.find(r => r.value.memory.id === unit.memoryId).value;
      const source = record.receipts.find(r => r.id === unit.receiptId);
      assert.equal(source.excerpt.slice(unit.anchor.start, unit.anchor.end), unit.anchor.text);
    }
    assert.equal(c.review.value.status, 'unassessed'); assert.equal(c.review.value.persistence, 'not-stored');
  }
});

import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { exportSourceContextEvidence } from '../source-context-evidence.mjs';

const bytes = readFileSync(new URL('../source-context-fixture.json', import.meta.url));
const fixture = JSON.parse(bytes);
const sha = value => createHash('sha256').update(value).digest('hex');
function sample() {
  const models = ['gpt-4.1-mini-2025-04-14', 'gpt-5.6-luna', 'gpt-5.6-sol'];
  return { version: 1, id: fixture.id, offline: false, ingestion: fixture.ingestion,
    semanticReviewRequired: true, pins: { fixture: sha(bytes) }, sourceHead: 'synthetic',
    provenance: { artifactSha256: 'synthetic' }, limits: { requests: 96, microUsd: 2048000, perArmRequests: 2 },
    cases: fixture.cases.flatMap((item, i) => models.map((_, j) => models[(i + j) % 3])
      .flatMap((model, j) => ((i + j) % 2 ? ['context', 'baseline'] : ['baseline', 'context'])
        .map(arm => ({ id: `${item.id}-${model}-${arm}`, caseId: item.id, model, arm,
          status: 'not_run', records: [], review: null, warm: [], cold: [], traces: [] })))) };
}
test('SCE1 frozen schedule preserves failed/unrun denominator; wrong experiment/order rejects', () => {
  assert.equal(sha(bytes), 'cb72fae1e57636e1f308943d203ac6547217c97769d77fb4338f274448c30ddd');
  const raw = sample(); raw.cases[0].status = 'failed';
  const result = exportSourceContextEvidence(raw);
  assert.equal(result.cases.length, 48); assert.equal(result.cases[0].status, 'failed');
  assert.equal(result.cases.filter(c => c.status === 'not_run').length, 47);
  assert.ok(result.cases.every(c => c.coldMatchesWarm === null && c.warmEdgeCount === null));
  raw.cases.reverse(); assert.throws(() => exportSourceContextEvidence(raw));
  for (const patch of [{ id: 'other' }, { offline: true }, { pins: { fixture: 'wrong' } }]) {
    assert.throws(() => exportSourceContextEvidence({ ...sample(), ...patch }));
  }
});
test('SCE2 malformed/unavailable and empty responses remain distinct; context nulls and quotes survive', () => {
  const raw = sample();
  const trace = { requestBody: { max_output_tokens: 1024,
    text: { format: { name: 'cairn_reviewBasis' } },
    input: [{ content: [{ text: '{"memories":[],"inputMode":"source-context-v1"}' }] }] },
  responseAvailable: true, providerResponse: { model: 'gpt-5.6-sol', output: [{ content: [{ text: 'malformed' }] }] } };
  raw.cases[0].traces = [trace];
  assert.equal(exportSourceContextEvidence(raw).cases[0].proposals[0].output, null);
  trace.providerResponse.output[0].content[0].text = '{"units":[],"links":[]}';
  assert.deepEqual(exportSourceContextEvidence(raw).cases[0].proposals[0].output, { units: [], links: [] });
  const proposal = { units: [{ memory: 0, receipt: 0, quote: 'I chose A', role: 'decision',
    context: { subject: 'I chose A', applies: null, scope: null, commitment: null } }], links: [] };
  trace.providerResponse.output[0].content[0].text = JSON.stringify(proposal);
  assert.deepEqual(exportSourceContextEvidence(raw).cases[0].proposals[0].output, proposal);
  trace.responseAvailable = false;
  assert.equal(exportSourceContextEvidence(raw).cases[0].proposals[0].outputAvailable, false);
});
test('SCE3 allowlisted projection drops private metadata and rejects sensitive retained text', () => {
  const raw = sample(); raw.privatePath = '/tmp/private'; raw.provenance.packageRoot = '/home/private';
  raw.pins.authorization = 'Bearer synthetic-private';
  assert.ok(!JSON.stringify(exportSourceContextEvidence(raw)).includes('private'));
  raw.sourceHead = '/tmp/private'; assert.throws(() => exportSourceContextEvidence(raw), /sensitive_source_context_evidence/);
});
const publishedBytes = readFileSync(new URL('../../../evaluations/results/source-context-ablation-v1.json', import.meta.url));
const published = JSON.parse(publishedBytes);
test('SCE4 frozen negative result preserves all arms, accounting and accepted receipt anchors', () => {
  assert.equal(sha(publishedBytes), 'a5d564793e48d6605073f791ed778fd05f4bc80e7b30d167453644d9f5b0d28f');
  assert.equal(published.cases.length, 48);
  for (const [arm, count] of [['baseline', 15], ['context', 8]]) {
    assert.equal(published.cases.filter(c => c.arm === arm && c.status === 'completed').length, count);
  }
  assert.equal(published.cases.filter(c => c.review?.error?.code === 'invalid_model_output').length, 25);
  assert.equal(published.budgetAfter.requestCount - published.budgetBefore.requestCount, 96);
  assert.equal(published.budgetAfter.reservedMicroUsd - published.budgetBefore.reservedMicroUsd, 2048000);
  assert.equal(published.budgetAfter.knownUsageMicroUsd - published.budgetBefore.knownUsageMicroUsd, 154360);
  assert.equal(published.budgetAfter.unknownCostRequests - published.budgetBefore.unknownCostRequests, 48);
  assert.equal(published.budgetAfter.unsettled, 0);
  for (const item of published.cases) {
    assert.ok(item.originalSourcesUnchanged && item.basisNonpersistent && item.coldMatchesWarm);
    assert.equal(item.warmEdgeCount, 0);
    for (const unit of item.review?.value?.units ?? []) {
      const receipt = item.records.find(r => r.value.memory.id === unit.memoryId).value.receipts
        .find(r => r.id === unit.receiptId);
      for (const anchor of [unit.anchor, ...Object.values(unit.context ?? {}).filter(Boolean)]) {
        assert.equal(receipt.excerpt.slice(anchor.start, anchor.end), anchor.text);
      }
      assert.equal(unit.interpretationStatus, 'model-proposed');
    }
  }
});
test('SCE5 preserve accepted semantic errors and rejected but relevant proposed edges', () => {
  const at = (caseId, model, arm) => published.cases.find(c => c.caseId === caseId && c.model === model && c.arm === arm);
  const history = at('old-inspection', 'gpt-5.6-luna', 'baseline');
  assert.equal(history.status, 'completed');
  assert.ok(history.proposals[0].output.links.some(l => l.from === 2 && l.to === 1 && l.relation === 'challenges-current-basis'));
  const backup = at('backup-region', 'gpt-5.6-sol', 'context');
  assert.equal(backup.status, 'completed');
  assert.ok(backup.proposals[0].output.units.some(u => u.role === 'decision' && /have not chosen/.test(u.quote)));
  const changed = at('explicit-plan-change', 'gpt-5.6-sol', 'baseline');
  assert.equal(changed.status, 'failed');
  assert.equal(changed.proposals[0].output.units[2].role, 'update');
  assert.ok(changed.proposals[0].output.links.some(l => l.from === 2 && l.to === 3 && l.relation === 'supports-decision'));
});

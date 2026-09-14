import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { exportSourceAddressedEvidence, exportSourceContextEvidence } from '../source-basis-ablation-evidence.mjs';

const bytes = readFileSync(new URL('../source-addressed-fixture.json', import.meta.url));
const fixture = JSON.parse(bytes);
const sha = value => createHash('sha256').update(value).digest('hex');
function sample() {
  const models = ['gpt-4.1-mini-2025-04-14', 'gpt-5.6-luna', 'gpt-5.6-sol'];
  return { version: 1, id: fixture.id, offline: false, ingestion: fixture.ingestion,
    semanticReviewRequired: true, pins: { fixture: sha(bytes) }, sourceHead: 'synthetic',
    provenance: { artifactSha256: 'synthetic' }, limits: { requests: 96, microUsd: 2048000, perArmRequests: 2 },
    cases: fixture.cases.flatMap((item, i) => models.map((_, j) => models[(i + j) % 3])
      .flatMap((model, j) => ((i + j) % 2 ? ['addressed', 'baseline'] : ['baseline', 'addressed'])
        .map(arm => ({ id: `${item.id}-${model}-${arm}`, caseId: item.id, model, arm,
          status: 'not_run', records: [], review: null, warm: [], cold: [], traces: [] })))) };
}
test('SAE1 fixed experiment rejects changed identity, fixture, order and offline claims; keeps all failure slots', () => {
  assert.equal(sha(bytes), '973e76796a3aca102572e1681552540b734c34fcd650b12957b102c1e64856a4');
  const raw = sample(); raw.cases[0].status = 'failed';
  const result = exportSourceAddressedEvidence(raw);
  assert.equal(result.cases.length, 48); assert.equal(result.cases[0].status, 'failed');
  assert.equal(result.cases.filter(c => c.status === 'not_run').length, 47);
  assert.ok(result.cases.every(c => c.coldMatchesWarm === null));
  raw.cases.reverse(); assert.throws(() => exportSourceAddressedEvidence(raw));
  for (const patch of [{ id: 'other' }, { offline: true }, { pins: { fixture: 'wrong' } }]) {
    assert.throws(() => exportSourceAddressedEvidence({ ...sample(), ...patch }));
  }
  assert.throws(() => exportSourceContextEvidence(sample()));
});
test('SAE2 exact numbered input and even rejected raw ranges survive without repair; malformed differs from empty', () => {
  const raw = sample();
  const input = { inputMode: 'source-addressed-v1', memories: [{ index: 0, receipts: [{ index: 0,
    role: 'user', excerpt: 'I I', parts: [{ index: 0, text: 'I' }, { index: 1, text: ' ' }, { index: 2, text: 'I' }] }] }] };
  const proposed = { units: [{ memory: 0, receipt: 0, role: 'premise-update', startPart: 2, endPart: 99,
    context: { subject: { startPart: 2, endPart: 3 }, applies: null, scope: null, commitment: null } }], links: [] };
  const trace = { requestBody: { max_output_tokens: 1024, text: { format: { name: 'cairn_reviewBasis' } },
    input: [{ content: [{ text: JSON.stringify(input) }] }] }, responseAvailable: true,
    providerResponse: { model: 'gpt-5.6-sol', output: [{ content: [{ text: JSON.stringify(proposed) }] }] } };
  raw.cases[0].traces = [trace];
  let result = exportSourceAddressedEvidence(raw).cases[0].proposals[0];
  assert.deepEqual(result.memories, input.memories); assert.deepEqual(result.output, proposed);
  trace.providerResponse.output[0].content[0].text = 'malformed';
  assert.equal(exportSourceAddressedEvidence(raw).cases[0].proposals[0].output, null);
  trace.providerResponse.output[0].content[0].text = '{"units":[],"links":[]}';
  assert.deepEqual(exportSourceAddressedEvidence(raw).cases[0].proposals[0].output, { units: [], links: [] });
  trace.responseAvailable = false;
  assert.equal(exportSourceAddressedEvidence(raw).cases[0].proposals[0].outputAvailable, false);
});
test('SAE3 private metadata is excluded; sensitive retained fields reject', () => {
  const raw = sample(); raw.privatePath = '/tmp/private'; raw.provenance.packageRoot = '/home/private';
  raw.pins.authorization = 'Bearer synthetic-private';
  assert.ok(!JSON.stringify(exportSourceAddressedEvidence(raw)).includes('private'));
  raw.sourceHead = '/tmp/private'; assert.throws(() => exportSourceAddressedEvidence(raw), /sensitive_source_addressed_evidence/);
});

const publishedBytes = readFileSync(new URL('../../../evaluations/results/source-addressed-ablation-v1.json', import.meta.url));
const published = JSON.parse(publishedBytes);
test('SAE4 frozen results preserve accounting, exact source ranges including rejected proposals, and cold state', () => {
  assert.equal(sha(publishedBytes), 'f95269e137ef6c67e974aa9ff5ab34717960abb80952259a1aae57f749692351');
  assert.equal(published.cases.length, 48);
  for (const [arm, count] of [['baseline', 16], ['addressed', 18]]) {
    assert.equal(published.cases.filter(c => c.arm === arm && c.status === 'completed').length, count);
  }
  assert.equal(published.cases.filter(c => c.review?.error?.code === 'invalid_model_output').length, 14);
  assert.equal(published.budgetAfter.requestCount - published.budgetBefore.requestCount, 96);
  assert.equal(published.budgetAfter.reservedMicroUsd - published.budgetBefore.reservedMicroUsd, 2048000);
  assert.equal(published.budgetAfter.knownUsageMicroUsd - published.budgetBefore.knownUsageMicroUsd, 195888);
  assert.equal(published.budgetAfter.unknownCostRequests - published.budgetBefore.unknownCostRequests, 48);
  assert.equal(published.budgetAfter.unsettled, 0);
  for (const item of published.cases) {
    assert.ok(item.originalSourcesUnchanged && item.basisNonpersistent && item.coldMatchesWarm);
    assert.equal(item.warmEdgeCount, 0);
    for (const unit of item.review?.value?.units ?? []) {
      const receipt = item.records.find(r => r.value.memory.id === unit.memoryId).value.receipts.find(r => r.id === unit.receiptId);
      for (const anchor of [unit.anchor, ...Object.values(unit.context ?? {}).filter(Boolean)]) {
        assert.equal(receipt.excerpt.slice(anchor.start, anchor.end), anchor.text);
      }
      assert.equal(unit.interpretationStatus, 'model-proposed');
    }
    if (item.arm !== 'addressed') continue;
    for (const proposal of item.proposals) {
      for (const memory of proposal.memories) for (const receipt of memory.receipts) {
        assert.equal(receipt.parts.map(p => p.text).join(''), receipt.excerpt);
        assert.deepEqual(receipt.parts.map(p => p.index), receipt.parts.map((_, i) => i));
      }
      for (const unit of proposal.output.units) {
        const parts = proposal.memories[unit.memory].receipts[unit.receipt].parts;
        for (const range of [unit, ...Object.values(unit.context).filter(Boolean)]) {
          assert.ok(Number.isSafeInteger(range.startPart) && Number.isSafeInteger(range.endPart));
          assert.ok(range.startPart >= 0 && range.endPart > range.startPart && range.endPart <= parts.length);
          const text = parts.slice(range.startPart, range.endPart).map(p => p.text).join('');
          assert.ok(text.trim() && text.length <= 200);
        }
      }
    }
  }
});
test('SAE5 preserve accepted semantic regressions: negation clipping and confirmation-as-challenge', () => {
  const at = (caseId, model, arm) => published.cases.find(c => c.caseId === caseId && c.model === model && c.arm === arm);
  const mini = at('museum-opening', 'gpt-4.1-mini-2025-04-14', 'addressed');
  assert.equal(mini.status, 'completed');
  assert.equal(mini.review.value.units[3].anchor.text, 'the old opening time was wrong when I booked');
  assert.ok(mini.review.value.links.some(l => l.from === 3 && l.to === 1 && l.relation === 'challenges-current-basis'));
  for (const model of ['gpt-5.6-luna', 'gpt-5.6-sol']) {
    const old = at('charger-reaffirmed', model, 'baseline');
    const next = at('charger-reaffirmed', model, 'addressed');
    assert.equal(old.status, 'completed'); assert.equal(next.status, 'completed');
    assert.ok(!old.review.value.links.some(l => l.relation === 'challenges-current-basis'));
    assert.ok(next.review.value.links.some(l => l.relation === 'challenges-current-basis'));
  }
});

import assert from 'node:assert/strict';
import test from 'node:test';

import { INGESTION_CLIENT } from '../ingestion.mjs';
import { verifiedEvidence } from '../mixed-evidence.mjs';
import { prepareMixedSourceCase } from '../mixed-source.mjs';
import { sourceRow } from '../testing/mixed-fixture.mjs';

function evidenceFixture(content = 'Synthetic memory fact.', windowIndex = 0) {
  const row = sourceRow();
  row.history.sessions[0].turns[0].content = content;
  const plan = structuredClone(prepareMixedSourceCase(row));
  const batch = plan.cairnPlan.batches[0];
  const window = batch.indexedWindows[windowIndex];
  assert.ok(window, 'fixture must select an indexed source window');
  const source = batch.sourceMap[window.messageIndex];
  const namespace = row.namespace;
  const receipt = { id: 'receipt-1', role: 'user', excerpt: window.content };
  const authoritative = { ...receipt, client: INGESTION_CLIENT,
    sessionId: batch.captureInput.sessionId, eventId: source.messageId };
  const recall = { memories: [{ memory: { id: 'memory-1', revision: 1,
    currentness: 'current' }, interpretationStatus: 'omitted',
  sourceSelectionCoverage: 'unassessed', receiptCount: 1, receipts: [receipt] }] };
  const detail = { memory: { id: 'memory-1', revision: 1, state: 'active',
    namespace, receiptCount: 1 }, receipts: [authoritative], exhausted: true,
  nextReceiptCursor: null };
  return { plan, namespace, recall, detail, window,
    verify: () => verifiedEvidence(recall, () => ({ ok: true, value: detail }), plan, namespace) };
}

test('M6 exact authoritative source receipt retains every matching origin coordinate', () => {
  const fixture = evidenceFixture('a'.repeat(3300), 1);
  const result = fixture.verify();
  assert.deepEqual(result.units, [{ text: fixture.window.content }]);
  assert.equal(result.provenance.length, 1);
  const expected = fixture.plan.originMap.windows.filter(item =>
    item.renderedTurnId === fixture.plan.cairnPlan.batches[0].sourceMap[0].turnId
      && fixture.plan.cairnPlan.batches[item.batchIndex].indexedWindows[item.windowIndex].content
        === fixture.window.content);
  assert.ok(expected.length >= 2, 'repeated actual P windows must be genuinely ambiguous');
  assert.deepEqual(result.provenance[0].coordinates.map(({ batchIndex, windowIndex,
    classification, originalStartUtf16, originalEndUtf16 }) =>
    ({ batchIndex, windowIndex, classification, originalStartUtf16, originalEndUtf16 })),
  expected.map(({ batchIndex, windowIndex, classification, originalStartUtf16,
    originalEndUtf16 }) => ({ batchIndex, windowIndex, classification,
    originalStartUtf16, originalEndUtf16 })));
});

test('M6 wrapper-overlapping receipt stays metadata-or-mixed with no invented raw span', () => {
  const fixture = evidenceFixture();
  const result = fixture.verify();
  assert.deepEqual(result.provenance[0].coordinates.map(item =>
    [item.classification, item.originalStartUtf16, item.originalEndUtf16]),
  [['metadata-or-mixed', null, null]]);
});

test('M6 rejects stale, partial, forged and nonauthoritative receipts before evidence', () => {
  const cases = [
    fixture => { fixture.recall.memories[0].memory.currentness = 'stale'; },
    fixture => { fixture.recall.memories[0].memory.revision = 2; },
    fixture => { fixture.detail.memory.revision = 2; },
    fixture => { fixture.detail.exhausted = false; },
    fixture => { fixture.detail.memory.receiptCount = 2; },
    fixture => { fixture.recall.memories[0].receiptCount = 2; },
    fixture => { fixture.detail.receipts[0].client = 'forged'; },
    fixture => { fixture.detail.receipts[0].sessionId = 'forged'; },
    fixture => { fixture.detail.receipts[0].eventId = 'forged'; },
    fixture => { fixture.detail.receipts[0].role = 'assistant'; },
    fixture => { fixture.detail.receipts[0].excerpt = 'forged'; },
    fixture => { fixture.recall.memories[0].receipts[0].excerpt = 'forged'; },
  ];
  for (const change of cases) {
    const fixture = evidenceFixture();
    change(fixture);
    assert.throws(fixture.verify, { code: 'invalid_recall_provenance' });
  }
});

test('M6 rejects more than 64 ambiguous source-window coordinates', () => {
  const fixture = evidenceFixture();
  const batch = fixture.plan.cairnPlan.batches[0];
  const window = batch.indexedWindows[0];
  batch.indexedWindows = Array.from({ length: 65 }, (_, index) => ({ ...window, index }));
  assert.throws(fixture.verify, { code: 'invalid_recall_provenance' });
});

test('M6 second source-only window excludes date metadata and model summary', () => {
  const fixture = evidenceFixture(`Synthetic ${'a'.repeat(2300)} fact.`, 1);
  const result = fixture.verify();
  assert.deepEqual(result.units, [{ text: fixture.window.content }]);
  assert.equal(result.units[0].text.includes('[session-date:'), false);
  assert.equal(result.units[0].text.includes('GENERATED_SUMMARY_POISON'), false);
  assert.ok(result.provenance[0].coordinates.every(item =>
    item.classification === 'original-source' || item.classification === 'normalized-source'));
});

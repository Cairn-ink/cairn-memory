import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const read = relative => readFileSync(new URL(relative, import.meta.url));
const digest = bytes => createHash('sha256').update(bytes).digest('hex');
const evidenceText = read('../../../docs/cold-neighborhood-comparison-results.json').toString();
const evidence = JSON.parse(evidenceText);
const fixture = JSON.parse(read('../../live/cold-neighborhood-fixture.json'));
const rubric = JSON.parse(read('../../../docs/cold-neighborhood-rubric.json'));
const modes = ['source-evidence', 'rationale-neighborhood-evidence'];
const answerHashes = [
  ['c060c7d341275a49f5e1f00e3a655d676a1d8a1cbcde9a3520a5db974dad95d7',
    'ada2dad94f47d999e3e3b52f9cdac494894191d45c107d04426c4f794ec85290'],
  ['31f00cb9aa58397b5cd57d41c63ded504940f0b8bdce9fe8d96ee7121e8f5004',
    '4af45501e2c74c3ed821318e1c6c63464cc4d7636b2f6ecb8c58611f96875f8a'],
  ['18e61cd1c8ce722cfa95e9ae3e64226e58efca7a2970a804959cf80150c44121',
    '09cb617258ad0e062f647e950db520f5cac5ea2de69fe28591e2765127cb2cda'],
];

test('CNRE1–2/5–6 publication keeps eight slots, exact answers and independently checkable original passages', () => {
  assert.equal(evidence.schemaVersion, 1);
  assert.equal(evidence.pins.sourceCommit, '964e4e5879956adb816c4920f2cda7a01015a6e3');
  assert.equal(evidence.pins.fixtureSha256, digest(read('../../live/cold-neighborhood-fixture.json')));
  assert.equal(evidence.pins.rubricSha256, digest(read('../../../docs/cold-neighborhood-rubric.json')));
  assert.equal(evidence.pins.retainedPrivateReportSha256,
    '9c72e31c227b75893881f4e3016406f597d3a0b00d38c859def6d17b8c7453b9');
  assert.deepEqual(evidence.cases.map(item => item.id), fixture.cases.map(item => item.id));
  assert.equal(evidence.cases.length, 4);
  let answered = 0;
  for (const [caseIndex, item] of evidence.cases.entries()) {
    const source = fixture.cases[caseIndex], gold = rubric.cases[caseIndex];
    const fixtureMessages = new Map(source.batches.flatMap(batch => batch.messages.map(message => [message.id, message])));
    assert.deepEqual(item.captures.map(entry => entry.batchId), source.batches.map(batch => batch.id));
    assert.deepEqual(item.arms.map(arm => arm.mode), modes);
    const catalog = new Map();
    for (const passage of item.deliveredSourceCatalog) {
      assert.ok(!catalog.has(passage.fixtureMessageId));
      const original = fixtureMessages.get(passage.fixtureMessageId);
      assert.ok(original);
      assert.equal(passage.role, original.role);
      assert.equal(passage.excerpt, original.content);
      catalog.set(passage.fixtureMessageId, passage);
    }
    if (caseIndex === 3) {
      assert.equal(item.status, 'interrupted');
      assert.equal(item.captures[2].status, 'started-aborted-before-operator-record');
      assert.equal(item.captures[2].operatorSlot, 'not_run');
      assert.equal(item.retention.status, 'not-measured-after-interruption');
      assert.equal(item.retention.fixtureMessageIds, null);
      assert.deepEqual(item.arms.map(arm => arm.status), ['not_run', 'not_run']);
      for (const arm of item.arms) {
        assert.equal(arm.answerText, null); assert.equal(arm.obligations, null);
        assert.equal(arm.deliveredSources, null); assert.equal(arm.beforeAfterMatchColdBaseline, null);
      }
      continue;
    }
    assert.equal(item.retention.status, 'measured');
    assert.ok(item.retention.receiptCount >= item.retention.fixtureMessageIds.length);
    for (const id of item.retention.fixtureMessageIds) assert.ok(fixtureMessages.has(id));
    for (const obligation of gold.obligations) for (const anchor of obligation.sources) {
      assert.ok(item.retention.fixtureMessageIds.includes(anchor.messageId));
    }
    for (const [armIndex, arm] of item.arms.entries()) {
      assert.equal(arm.status, 'generated-unassessed');
      assert.equal(arm.beforeAfterMatchColdBaseline, true);
      assert.equal(digest(arm.answerText), answerHashes[caseIndex][armIndex]);
      answered++;
      assert.ok(arm.deliveredSources.length <= 6);
      assert.equal(arm.selectedRoots,
        arm.deliveredSources.filter(group => group.origin === 'selected-root').length);
      const delivered = new Map();
      for (const group of arm.deliveredSources) {
        assert.ok(['selected-root', 'linked-neighborhood'].includes(group.origin));
        if (arm.mode === 'source-evidence') assert.equal(group.origin, 'selected-root');
        assert.ok(group.fixtureMessageIds.length > 0);
        for (const id of group.fixtureMessageIds) {
          assert.ok(catalog.has(id));
          assert.ok(item.retention.fixtureMessageIds.includes(id));
          delivered.set(id, catalog.get(id).excerpt);
        }
      }
      assert.deepEqual(arm.obligations.map(obligation => obligation.id), gold.obligations.map(obligation => obligation.id));
      for (const [index, obligation] of arm.obligations.entries()) {
        const expected = gold.obligations[index].sources
          .filter(anchor => !delivered.get(anchor.messageId)?.includes(anchor.passage))
          .map(anchor => anchor.messageId);
        assert.deepEqual(obligation.missingExactAnchorIds, expected);
        assert.ok(['full', 'partial', 'none'].includes(obligation.sourceSufficiency));
        assert.ok(typeof obligation.answerSupport === 'string' && obligation.answerSupport);
      }
    }
  }
  assert.equal(answered, 6);
  assert.equal(evidence.review.agreement, true);
  assert.equal(evidence.review.paidJudgeCall, false);
  assert.equal(evidence.review.generalAccuracyClaim, false);
});

test('CNRE3–4/7 halt and accounting are explicit without publishing private campaign material', () => {
  assert.equal(evidence.halt.globalStatus, 'halted');
  assert.equal(evidence.halt.lastSuccessfulHttpResponseRequest, 121);
  assert.equal(evidence.halt.lastAttemptedRequest, 122);
  assert.equal(evidence.halt.method, 'cairn_qualifyCandidates');
  assert.equal(evidence.halt.observedReason, 'request_aborted');
  assert.equal(evidence.halt.request122HasProviderResponse, false);
  assert.equal(evidence.halt.request122LedgerOutcome, 'unknown');
  assert.equal(evidence.halt.unrunAnswerSlots, 2);
  assert.equal(evidence.halt.remoteCauseEstablished, false);
  assert.equal(evidence.accounting.attemptedRequests, 122);
  assert.equal(evidence.accounting.coreRequests + evidence.accounting.hostAnswers, 122);
  assert.equal(evidence.accounting.hostAnswers, 6);
  assert.equal(evidence.accounting.runReservedMicroUsd, 880000);
  assert.equal(evidence.accounting.checkpointAfter.requestCount - evidence.accounting.checkpointBefore.requestCount, 122);
  assert.equal(evidence.accounting.checkpointAfter.reservedMicroUsd -
    evidence.accounting.checkpointBefore.reservedMicroUsd, 880000);
  assert.equal(evidence.accounting.unsettledReservationsAfter, 0);
  assert.equal(evidence.accounting.knownUsageEstimateIncreaseMicroUsd, 55808);
  assert.equal(evidence.accounting.unknownCostRequests, 59);
  assert.equal(evidence.accounting.reservationIsNotActualSpend, true);
  assert.doesNotMatch(evidenceText, /\/tmp\/|\/home\/|sk-[a-z0-9]|api[_-]?key|authorization|ledgerRunId|ownerId|sessionId|eventId|providerRequestId/iu);
  const uuids = evidenceText.match(/\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/giu) ?? [];
  const cited = evidence.cases[2].arms[1].citationReceiptToFixture;
  assert.equal(Object.keys(cited).length, 4);
  assert.equal(uuids.length, 8); // Four exact-answer citations plus their fixture mappings.
  for (const [receiptId, fixtureId] of Object.entries(cited)) {
    assert.ok(evidence.cases[2].arms[1].answerText.includes(receiptId));
    assert.ok(evidence.cases[2].arms[1].deliveredSources.some(group => group.fixtureMessageIds.includes(fixtureId)));
    assert.equal(uuids.filter(id => id === receiptId).length, 2);
  }
});

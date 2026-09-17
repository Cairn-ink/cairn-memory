import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { projectNeighborhoodSources } from '../../../core/neighborhood-source-projection.mjs';

const read = relative => readFileSync(new URL(relative, import.meta.url));
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const source = JSON.parse(read('../../live/decision-transition-fixture.json'));
const rubric = JSON.parse(read('../../../docs/decision-transition-rubric.json'));
const raw = read('../../../docs/decision-transition-results.json');
const record = JSON.parse(raw);
const paths = ['ordinary-source-evidence', 'projected-rationale-neighborhood', 'full-history-diagnostic'];
const answerHashes = {
  'export-review/ordinary-source-evidence': 'fb70906259e2d1651f57451ddda32c0ac7a306ba230fceced9c6883fcc40c42a',
  'export-review/full-history-diagnostic': '95eeceb4b2c22223829996b04e1a84e567ce5bb0a0c92b2b559632f82922b485',
  'export-replaced/ordinary-source-evidence': 'eb54a360296a96e8c60d848db8b4b0f273747b566e077cc1b2212e59eb938f98',
  'export-replaced/projected-rationale-neighborhood': 'b8e99cdbc2ae0ce07de46e652e87ad0c340c6ace8f9b99f6d745e28e9b9cd936',
  'export-replaced/full-history-diagnostic': '5e5f45fb8296a6e8e028a0fcdbf2193f661a99b8cdafaac9798e1eefbf5b790c',
  'field-unknown/ordinary-source-evidence': '5766bdb0ff69523ed60e33739cd26321a2eb4226e5cd42f8cbf64d24b667f391',
  'field-unknown/projected-rationale-neighborhood': 'ee1c4e7bf3bbe7b592e7d6db0630480f76bb0cb8bfa2a7675a3895674f1c7cf0',
  'field-unknown/full-history-diagnostic': '28ce0375ade78300bc6b6e699862e0bf0f66a9c551a68f96c7b41b85929e0b75',
  'field-active/ordinary-source-evidence': 'b796aee35d2ea6f46202d6e9e4641c4a66af8da2c6006d08b1e60f3dc44dc21d',
  'field-active/projected-rationale-neighborhood': 'e7eced7f0ef7e271f09b15edb117b935545eba9a295f5abc90f21705d2efe015',
  'field-active/full-history-diagnostic': '107604c70e8b8d080fb84a2d85c786b9b5a71254203dbb9d6edbe0e8a75931da',
};

test('DTR1 frozen inputs, exact answer texts, honest accounting and public-safe record', () => {
  assert.equal(record.version, 'decision-transition-results-v1');
  assert.equal(record.assessment, 'nonblind-synthetic-development-ai-review');
  assert.equal(record.pins.sourceCommit, 'bdc7be8a59b2a535144e1c851133a1fa970cc442');
  assert.equal(record.pins.fixtureSha256, sha(read('../../live/decision-transition-fixture.json')));
  assert.equal(record.pins.rubricSha256, sha(read('../../../docs/decision-transition-rubric.json')));
  for (const field of ['operatorSha256', 'archiveSha256', 'coldReaderSha256', 'finalReportSha256']) {
    assert.match(record.pins[field], /^[0-9a-f]{64}$/u);
  }
  assert.equal(record.model, 'gpt-4.1-mini-2025-04-14');
  assert.deepEqual([record.observed.requests, record.observed.coreRequests, record.observed.hostRequests,
    record.observed.reservedMicroUsd, record.observed.knownUsageEstimateMicroUsd,
    record.observed.unknownCostAttempts, record.observed.unsettledBefore, record.observed.unsettledAfter],
  [139, 128, 11, 1_190_000, 64_571, 64, 0, 0]);
  assert.equal(record.observed.requests, record.observed.coreRequests + record.observed.hostRequests);
  assert.ok(record.observed.requests <= record.limits.operatorRequests);
  assert.ok(record.observed.reservedMicroUsd <= record.limits.operatorReservationMicroUsd);
  assert.equal(record.limits.projectedUniqueMemoryIdentities, 6);
  assert.equal(record.observed.generatedAnswers + record.observed.unavailableAnswers, record.observed.plannedAnswers);
  assert.match(record.costMeaning, /not an invoice/u);
  assert.match(record.costMeaning, /not measured spend or a provider-enforced billing cap/u);
  assert.doesNotMatch(raw.toString(), /\/tmp\/|\/home\/|sk-[A-Za-z0-9]|(?:api[_-]?key|account[_-]?id|ledger[_-]?id|provider[_-]?id)\s*["']?\s*:/iu);
  const present = {};
  for (const item of record.cases) for (const arm of item.arms) {
    if (arm.answerText !== null) present[`${item.id}/${arm.path}`] = sha(arm.answerText);
  }
  assert.deepEqual(present, answerHashes);
});

test('DTR2/5 submitted messages, retained events, units and all eight snapshot parities stay separate', () => {
  assert.deepEqual(record.cases.map(item => item.id), source.cases.map(item => item.id));
  assert.equal(record.cases.length, 4);
  let messages = 0, retained = 0, units = 0, captures = 0, parity = 0;
  for (const [index, item] of record.cases.entries()) {
    const fixture = source.cases[index];
    const submitted = fixture.batches.flatMap(batch => batch.messages);
    const ids = submitted.map(message => message.id);
    assert.deepEqual(item.submittedMessageIds, ids);
    assert.equal(item.captureBatchStatuses.length, 3);
    assert.ok(item.captureBatchStatuses.every(status => status === 'completed'));
    assert.deepEqual(item.memoryArmSnapshotsMatchColdBaseline, [true, true]);
    assert.deepEqual(item.arms.map(arm => arm.path), paths);
    assert.equal(new Set(item.retainedMessageIds).size, item.retainedMessageIds.length);
    assert.ok(item.retainedMessageIds.every(id => ids.includes(id)));
    assert.deepEqual(new Set(Object.values(item.units)), new Set(item.retainedMessageIds));
    assert.ok(submitted.filter(message => message.role === 'user').every(message => item.retainedMessageIds.includes(message.id)));
    assert.equal(Object.keys(item.units).length, index === 0 ? 8 : index === 1 ? 7 : 6);
    messages += ids.length; retained += item.retainedMessageIds.length;
    units += Object.keys(item.units).length; captures += item.captureBatchStatuses.length;
    parity += item.memoryArmSnapshotsMatchColdBaseline.length;
  }
  assert.deepEqual([messages, retained, units, captures, parity], [36, 26, 27, 12, 8]);
  assert.deepEqual([record.observed.submittedMessages, record.observed.retainedDistinctMessages,
    record.observed.admittedMemoryUnits, record.observed.capturesCompleted, record.observed.memoryArmSnapshotParity],
  [messages, retained, units, captures, parity]);
  assert.equal(record.cases[0].units.u02, 'export-review-m07');
  assert.equal(record.cases[0].units.u03, 'export-review-m07');
});

test('DTR2/3 all twelve slots separate rank roots, delivered anchors and claim judgments', () => {
  let generated = 0, unavailable = 0, hostCalls = 0;
  for (const [index, item] of record.cases.entries()) {
    const fixture = source.cases[index];
    const gold = rubric.cases[index];
    const messages = new Map(fixture.batches.flatMap(batch => batch.messages.map(message => [message.id, message])));
    const unitIds = new Set(Object.keys(item.units));
    for (const arm of item.arms) {
      assert.ok(['generated-unassessed', 'unavailable'].includes(arm.status));
      if (arm.path !== 'full-history-diagnostic') {
        for (const field of ['rankCandidateUnitIds', 'selectedRootUnitIds', 'expandedNeighborhoodUnitIds', 'deliveredUnitIds']) {
          assert.ok(arm[field].every(id => unitIds.has(id)), `${item.id}/${arm.path}/${field}`);
        }
        assert.ok(arm.selectedRootUnitIds.every(id => arm.rankCandidateUnitIds.includes(id)));
        if (arm.path === 'ordinary-source-evidence') assert.deepEqual(arm.deliveredUnitIds, arm.selectedRootUnitIds);
        if (arm.status === 'generated-unassessed' && arm.path === 'projected-rationale-neighborhood') {
          assert.deepEqual(arm.deliveredUnitIds, arm.expandedNeighborhoodUnitIds);
          assert.ok(arm.deliveredUnitIds.length <= record.limits.projectedUniqueMemoryIdentities);
        }
        assert.deepEqual(arm.deliveredMessageIds, arm.deliveredUnitIds.map(id => item.units[id]));
      } else {
        assert.equal(arm.diagnosticSourceGroups, 3);
        assert.deepEqual(arm.deliveredMessageIds, item.submittedMessageIds);
        assert.match(arm.syntheticRevisionAndCurrentness, /not persisted state/u);
      }
      if (arm.status === 'unavailable') {
        unavailable++;
        assert.equal(arm.answerText, null);
        assert.equal(arm.literalAnchors, null);
        assert.deepEqual(arm.deliveredMessageIds, []);
        assert.deepEqual(arm.supportedRequiredClaimIds, []);
        assert.deepEqual(arm.partialRequiredClaimIds, []);
        continue;
      }
      generated++; hostCalls++;
      const anchors = gold.requiredClaims.flatMap(claim => claim.anchors);
      const delivered = new Set(arm.deliveredMessageIds);
      const matched = anchors.filter(anchor => delivered.has(anchor.messageId)
        && messages.get(anchor.messageId)?.content.includes(anchor.quote));
      const requiredWithSupport = gold.requiredClaims.filter(claim => claim.anchors.some(anchor =>
        delivered.has(anchor.messageId) && messages.get(anchor.messageId)?.content.includes(anchor.quote)));
      assert.equal(arm.literalAnchors.matched, matched.length);
      assert.equal(arm.literalAnchors.total, anchors.length);
      assert.equal(arm.literalAnchors.requiredClaimsWithSupport, requiredWithSupport.length);
      assert.deepEqual(arm.literalAnchors.missingMessageIds, [...new Set(anchors.filter(anchor =>
        !delivered.has(anchor.messageId)).map(anchor => anchor.messageId))]);
      assert.deepEqual(new Set([...arm.supportedRequiredClaimIds, ...arm.partialRequiredClaimIds]),
        new Set(gold.requiredClaims.map(claim => claim.id)));
      assert.equal(new Set([...arm.supportedRequiredClaimIds, ...arm.partialRequiredClaimIds]).size,
        arm.supportedRequiredClaimIds.length + arm.partialRequiredClaimIds.length);
      assert.ok(arm.unsupportedExtraStatements.every(statement => arm.answerText.includes(statement)));
      assert.equal(arm.forbiddenConclusion, false);
    }
  }
  assert.deepEqual([generated, unavailable, hostCalls], [11, 1, record.observed.hostRequests]);
  const review = record.cases[0];
  assert.equal(review.arms[1].recallError, 'context_item_too_large');
  assert.ok(record.cases[1].arms.every(arm => arm.unsupportedExtraStatements.length === 1));
  assert.ok(record.cases[2].arms.every(arm => arm.partialRequiredClaimIds.includes('historical-restriction')));
  assert.ok(record.cases[3].arms[0].supportedRequiredClaimIds.includes('historical-restriction'));
  assert.ok(record.cases[3].arms.slice(1).every(arm => arm.partialRequiredClaimIds.includes('historical-restriction')));
});

test('DTR4 normalized frozen post-rank projector replay fails on seven identities, not six events', () => {
  const item = record.cases[0];
  const arm = item.arms[1];
  assert.equal(arm.selectedRootUnitIds.length, 6);
  assert.equal(arm.expandedNeighborhoodUnitIds.length, 7);
  assert.equal(new Set(arm.expandedNeighborhoodUnitIds.map(id => item.units[id])).size, 6);
  assert.deepEqual(new Set(arm.expandedDistinctMessageIds),
    new Set(arm.expandedNeighborhoodUnitIds.map(id => item.units[id])));
  const messages = new Map(source.cases[0].batches.flatMap(batch => batch.messages.map(message => [message.id, message])));
  const sourceItem = id => ({ memory: { id, revision: 1, currentness: 'current' },
    receipts: [{ id: `fixture-receipt-${id}`, role: messages.get(item.units[id]).role,
      excerpt: messages.get(item.units[id]).content }], receiptCount: 1,
    interpretationStatus: 'omitted', sourceSelectionCoverage: 'unassessed' });
  const projected = arm.rootNeighborhoods.map(group => ({ ...sourceItem(group.root), rationale: {
    root: { memoryId: group.root, revision: 1 }, status: 'unassessed',
    sources: group.sources.map(sourceItem), edges: [], coverage: 'bounded-root-neighborhood', indexRevision: 1,
  } }));
  assert.equal(projectNeighborhoodSources(projected.slice(0, 2)).length, 6);
  assert.throws(() => projectNeighborhoodSources(projected), { code: 'context_item_too_large' });
  assert.deepEqual(arm.deliveredUnitIds, []);
  assert.equal(arm.answerText, null);
});

test('DTR5/6 graph warnings and limitations cannot be confused with answer authority', () => {
  assert.equal(record.graphAudit.wrongProposals.length, 3);
  assert.match(record.graphAudit.scope, /non-exhaustive/u);
  for (const edge of record.graphAudit.wrongProposals) {
    const item = record.cases.find(value => value.id === edge.caseId);
    assert.ok(item?.retainedMessageIds.includes(edge.fromMessageId));
    assert.ok(item.retainedMessageIds.includes(edge.toMessageId));
    assert.ok(['supports-decision', 'challenges-premise'].includes(edge.relation));
  }
  assert.ok(record.limitations.some(value => value.includes('not every SQLite table')));
  assert.ok(record.limitations.some(value => value.includes('not estimate general accuracy')));
  assert.ok(record.limitations.some(value => value.includes('not a product arm')));
});

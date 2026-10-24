import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const bytes = readFileSync(new URL('../results/source-selection-factorial-v1.json', import.meta.url));
const result = JSON.parse(bytes);
const sha256 = x => createHash('sha256').update(x).digest('hex');
const sum = xs => xs.reduce((a, b) => a + b, 0);
const unique = xs => assert.equal(new Set(xs).size, xs.length);
const position = x => x.batchIndex + ':' + x.windowIndex;
// Existing capture canonicalization precedes window offsets (not raw bytes).
const canonical = text => text.normalize('NFKC').replace(/\s+/gu, ' ').trim();
const ref = x => [x.namespaceIndex, x.memoryId, x.revision].join(':');
const ratingHashes = [
  '022412c5088304c97ae18a8a338c6187178b158079764240bea04cb1110c89bb',
  'f99db50f9c0d5c9593271a225654db8fcee0187eb6a0d49dd546e53ced6214af',
];

// Closed evidence only. No runtime, operational paths, key, ledger, provider,
// semantic scorer or model is imported. Frozen AI judgments remain observations.
function checkResult(v) {
  assert.equal(v.version, 'source-selection-factorial-public-v1');
  assert.equal(v.runtimeCommit, 'd549f0681d2949731254d0945acaef09155ebad4');
  assert.equal(v.status, 'completed');
  assert.equal(v.fatal, null);
  assert.equal(v.firstOnly, true);
  assert.deepEqual(v.denominator, {
    sessions: 2, writeGroups: 4, readOutcomes: 8, answersPerCell: 2,
    completedWrites: 4, completedAnswers: 8, failed: 0, notRun: 0,
  });
  assert.equal(v.sources.length, 2);
  assert.equal(v.groups.length, 4);
  assert.equal(v.rows.length, 8);
  assert.equal(v.groups.reduce((n, g) => n + g.memories.length, 0), 26);
  unique(v.groups.map(g => g.id));
  unique(v.rows.map(r => r.id));
  assert.deepEqual(v.groups.map(g => g.id), [
    'session-01:baseline', 'session-01:candidate', 'session-02:candidate', 'session-02:baseline',
  ]);
  const sources = new Map(v.sources.map(s => [s.id, s]));
  let messageCount = 0;
  for (const s of v.sources) {
    assert.equal(s.batches.length, 2);
    for (const batch of s.batches) {
      assert.equal(batch.messages.length, 6);
      batch.messages.forEach((m, i) => {
        assert.equal(m.role, i % 2 ? 'assistant' : 'user');
        messageCount++;
      });
    }
    const rubric = v.rubric.sessions.find(r => r.id === s.id);
    assert.equal(rubric.claims.length, 2);
    for (const claim of rubric.claims) for (const q of claim.quotes) {
      assert.ok(s.batches[q.batchIndex].messages[q.messageIndex].content.includes(q.text));
    }
  }
  assert.equal(messageCount, 24);
  const recordHashes = new Map(v.provenance.recordHashes.map(r => [r.record, r.sha256]));
  assert.equal(recordHashes.size, 258);
  v.provenance.recordHashes.forEach((h, i) => {
    assert.equal(h.record, 'record-' + String(i + 1).padStart(4, '0') + '.json');
    assert.match(h.sha256, /^[a-f0-9]{64}$/);
  });
  assert.equal(v.provenance.closedReportSha256, '545b6799b124f862869cc48b613765a880c87868bfc73844fb98015fe20d03b3');
  assert.equal(v.provenance.manifestSha256, 'cffc431b1cea31ee81df22aea637da134e03c4fbc8ca7b9b8de5cf6315de0ae9');
  assert.equal(v.provenance.ratingASha256, '5e75b3cdb401d305dba46640bca6c23216e471293e7b1058b6b3c99d77d9a33d');
  assert.equal(v.provenance.ratingBSha256, '21eb301084f27733cfd252778b1254f24542d04e2b35da9fff36758edda53530');
  assert.equal(v.decision.reportSha256, v.provenance.closedReportSha256);
  assert.equal(v.decision.manifestSha256, v.provenance.manifestSha256);
  const receiptsByGroup = new Map();
  for (const g of v.groups) {
    assert.equal(g.writeGroupId, g.id);
    assert.equal(g.status, 'completed');
    assert.equal(g.stage, 'completed');
    assert.equal(g.reason, null);
    assert.equal(g.cleanupCompleted, true);
    assert.deepEqual(g.calls, { extract: 2, classify: 2 });
    assert.equal(g.captures.length, 2);
    assert.equal(g.models.length, 4);
    const memories = new Map(g.memories.map(m => [m.memory.id, m]));
    unique(g.memories.map(m => m.memory.id));
    const receipts = new Map();
    const checkMemory = m => {
      assert.equal(m.memory.filing.status, 'filed');
      assert.equal(m.memory.receiptCount, m.receipts.length);
      assert.equal(m.receipts.length, m.sourceBindings.length);
      for (const b of m.sourceBindings) {
        const original = sources.get(g.sessionId).batches[b.batchIndex].messages[b.messageIndex];
        assert.equal(b.messageIndex, b.windowIndex);
        assert.equal(b.excerpt, canonical(original.content).slice(b.start, b.end));
        assert.equal(b.role, original.role);
        const receipt = m.receipts.find(r => r.id === b.receiptId);
        assert.equal(receipt.excerpt, b.excerpt);
        assert.equal(receipt.role, b.role);
        if (receipts.has(receipt.id)) assert.deepEqual(receipts.get(receipt.id), { ...b });
        receipts.set(receipt.id, { ...b });
      }
    };
    g.memories.forEach((m, i) => {
      assert.equal(m.memory.id, 'memory-' + (i + 1));
      checkMemory(m);
    });
    for (const [i, capture] of g.captures.entries()) {
      assert.equal(capture.batchIndex, i);
      assert.equal(capture.result.duplicate, false);
      assert.equal(capture.result.classification.status, 'applied');
      capture.stored.forEach(checkMemory);
      for (const admitted of capture.result.admission.memories) {
        const revision = capture.result.classification.memoryRevisions.find(r => r.memoryId === admitted.id);
        assert.ok(revision.revision > admitted.revision);
        assert.equal(memories.get(admitted.id).memory.revision, revision.revision);
      }
      if (g.arm === 'candidate') {
        assert.ok(capture.selection.groups.length > 0);
        assert.equal(capture.selection.actualRequest.input.messages.length, 6);
      }
    }
    receiptsByGroup.set(g.id, receipts);
    const reads = v.rows.filter(r => r.writeGroupId === g.id);
    assert.equal(reads.length, 2);
    assert.deepEqual(reads.map(r => r.readMode).sort(), ['bounded-source-scan', 'default']);
    const [a, b] = reads;
    assert.deepEqual(a.packing.request, b.packing.request);
    assert.equal(a.answerRequestSha256, b.answerRequestSha256);
    assert.deepEqual(a.packing.included, b.packing.included);
    const comparison = v.decision.withinWriteComparisons.find(c => c.writeGroupId === g.id);
    assert.equal(comparison.identicalAnswerRequest, true);
    assert.equal(comparison.answerRequestSha256, a.answerRequestSha256);
    assert.equal(comparison.stored, g.memories.length);
    for (const r of reads) {
      const mode = r.readMode === 'default' ? 'default' : 'scan';
      assert.equal(comparison[mode + 'Selected'], r.trace.selectedRefs.length);
      assert.equal(comparison[mode + 'Packed'], r.packing.included.length);
    }
  }
  for (const r of v.rows) {
    const g = v.groups.find(g => g.id === r.writeGroupId);
    assert.equal(r.sessionId, g.sessionId);
    assert.equal(r.arm, g.arm);
    assert.equal(r.id, g.id + ':' + r.readMode);
    assert.equal(r.status, 'completed');
    assert.equal(r.reason, null);
    assert.equal(r.snapshotUnchanged, true);
    for (const key of ['sharedSnapshotSha256', 'beforeSnapshotSha256', 'afterSnapshotSha256']) {
      assert.equal(r[key], g.snapshotSha256);
    }
    assert.equal(r.firstAnswerSha256, sha256(r.answer));
    assert.equal(r.answerRequestSha256, sha256(JSON.stringify(r.packing.request)));
    const memories = new Map(g.memories.map(m => [m.memory.id, m]));
    const receipts = receiptsByGroup.get(g.id);
    const selects = r.models.filter(m => m.phase === 'select');
    const rank = r.models.filter(m => m.phase === 'rank');
    const answer = r.models.filter(m => m.phase === 'answer');
    assert.deepEqual(r.calls, { select: selects.length, rank: rank.length, answer: answer.length });
    assert.equal(rank.length, 1);
    assert.equal(answer.length, 1);
    assert.deepEqual(answer[0].request, r.packing.request);
    assert.equal(answer[0].output.answer, r.answer);
    r.models.forEach(m => {
      assert.ok(recordHashes.has(m.startRecord));
      assert.ok(recordHashes.has(m.outputRecord));
    });
    assert.deepEqual(r.observedMapPages, r.trace.mapPages);
    const visible = r.trace.mapPages.flatMap(p => p.envelope.value.items)
      .filter(i => i.type === 'ref')
      .map(i => ({ namespaceIndex: 0, memoryId: i.ref.childId, revision: i.ref.childRevision }));
    unique(visible.map(ref));
    if (r.readMode === 'bounded-source-scan') {
      assert.equal(r.actualStrategy, 'complete-map');
      assert.equal(selects.length, 0);
      assert.equal(r.trace.selectionProvenance, 'deterministic-derived-from-actual-accepted-map-and-complete-map-strategy');
      assert.deepEqual(r.trace.selectedRefs, visible);
    } else {
      assert.equal(r.actualStrategy, 'model-selected');
      assert.equal(selects.length, 1);
      assert.equal(r.trace.selectionProvenance, 'actual-model-select-outputs');
      assert.deepEqual(r.trace.selectedRefs, selects.flatMap(m => m.output.refs));
      assert.deepEqual(selects[0].request.input.maps[0].items, r.trace.mapPages[0].envelope.value.items);
    }
    for (const selected of r.trace.selectedRefs) {
      assert.ok(visible.some(v => ref(v) === ref(selected)));
      assert.equal(selected.revision, memories.get(selected.memoryId).memory.revision);
    }
    const candidates = rank[0].request.input.candidates;
    assert.deepEqual(r.trace.rankInputRefs, candidates.map(c => ({
      namespaceIndex: c.namespaceIndex, memoryId: c.memory.id, revision: c.memory.revision,
    })));
    assert.deepEqual(r.trace.selectedNotInRankInput,
      r.trace.selectedRefs.filter(s => !r.trace.rankInputRefs.some(i => ref(i) === ref(s))));
    for (const c of candidates) {
      assert.ok(r.trace.selectedRefs.some(s => s.memoryId === c.memory.id));
      assert.equal(c.memory.content, undefined);
      for (const receipt of c.receipts) {
        assert.equal(receipt.excerpt, receipts.get(receipt.id).excerpt);
        assert.equal(receipt.role, receipts.get(receipt.id).role);
      }
    }
    assert.deepEqual(rank[0].output.refs.map(x => x.memoryId), r.recall.memories.map(x => x.memory.id));
    const recalled = new Set(r.recall.memories.flatMap(m => m.receipts.map(x => position(receipts.get(x.id)))));
    const p = r.packing;
    const positions = [...p.included, ...p.omitted, ...p.notRecalled].map(position);
    unique(positions);
    const all = sources.get(r.sessionId).batches.flatMap((b, bi) => b.messages.map((_, mi) => bi + ':' + mi));
    assert.deepEqual(positions.sort(), all.sort());
    assert.deepEqual([...p.included, ...p.omitted].map(position).sort(), [...recalled].sort());
    assert.equal(p.omitted.length, 0);
    assert.ok(p.included.length > 0);
    assert.deepEqual(p.request.input.evidence, p.included.map(x => {
      const m = sources.get(r.sessionId).batches[x.batchIndex].messages[x.windowIndex];
      return { role: m.role, content: canonical(m.content) };
    }));
    assert.equal(p.request.input.currentQuestion, sources.get(r.sessionId).question);
  }
  assert.equal(v.ratings.length, 2);
  const metrics = v.decision.cells.map(c => ({ arm: c.arm, readMode: c.readMode, answers: 0, minimalComplete: 0, fullySupported: 0, supportedMinimalClaims: 0 }));
  const mapping = v.reviewMapping.mappings;
  assert.equal(mapping.length, 8);
  unique(mapping.map(m => m.viewId));
  unique(mapping.map(m => m.readOutcomeId));
  v.ratings.forEach((rating, ri) => {
    assert.equal(sha256(JSON.stringify(rating)), ratingHashes[ri]);
    assert.equal(rating.views.length, 8);
    assert.equal(rating.packetSha256, v.provenance.reviewPacketSha256);
    let claims = 0, quotes = 0;
    for (const view of rating.views) {
      const map = mapping.find(m => m.viewId === view.viewId);
      const r = v.rows.find(r => r.id === map.readOutcomeId);
      assert.equal(view.sessionId, r.sessionId);
      assert.equal(map.writeGroupId, r.writeGroupId);
      assert.equal(map.arm, r.arm);
      assert.equal(map.readMode, r.readMode);
      assert.equal(map.snapshotSha256, r.sharedSnapshotSha256);
      const rubric = v.rubric.sessions.find(s => s.id === view.sessionId);
      assert.deepEqual(view.claims.map(c => c.id).sort(), rubric.claims.map(c => c.id).sort());
      claims += view.claims.length;
      for (const observation of [...view.claims, ...view.extraIssues, ...view.memoryObservations]) {
        if (observation.answerQuote) {
          assert.ok(r.answer.includes(observation.answerQuote));
          quotes++;
        }
        for (const q of observation.sourceEvidence ?? []) {
          assert.ok(sources.get(view.sessionId).batches[q.batchIndex].messages[q.messageIndex].content.includes(q.text));
          quotes++;
        }
        if (observation.memoryLabel) {
          for (const label of observation.memoryLabel.split(', ')) {
            assert.ok(v.groups.find(g => g.id === r.writeGroupId).memories.some(m => m.memory.id === label));
          }
        }
      }
      assert.equal(view.allMinimalClaimsSupported, view.claims.every(c => c.status === 'supported' && c.supportedByAnswerEvidence));
      const other = v.ratings[1 - ri].views.find(x => x.viewId === view.viewId);
      assert.equal(view.allMinimalClaimsSupported, other.allMinimalClaimsSupported);
      assert.equal(view.answerFullySupported, other.answerFullySupported);
      assert.deepEqual(view.claims.map(c => [c.id, c.status, c.supportedByAnswerEvidence]), other.claims.map(c => [c.id, c.status, c.supportedByAnswerEvidence]));
      if (ri === 0) {
        const m = metrics.find(m => m.arm === r.arm && m.readMode === r.readMode);
        m.answers++;
        m.minimalComplete += Number(view.allMinimalClaimsSupported);
        m.fullySupported += Number(view.allMinimalClaimsSupported && view.answerFullySupported);
        m.supportedMinimalClaims += view.claims.filter(c => c.status === 'supported' && c.supportedByAnswerEvidence).length;
      }
    }
    assert.equal(claims, 16);
    assert.equal(quotes, ri === 0 ? 100 : 85);
    assert.equal(rating.views.filter(v => v.extraIssues.length).length, 2);
  });
  assert.deepEqual(metrics, v.decision.cells);
  assert.deepEqual(metrics.map(m => [m.answers, m.minimalComplete, m.fullySupported, m.supportedMinimalClaims]), [
    [2, 2, 2, 4], [2, 2, 1, 4], [2, 2, 1, 4], [2, 2, 2, 4],
  ]);
  assert.equal(v.agreement.materialScoringDisagreements, 0);
  assert.equal(v.decision.reviewAgreementBeforeExplicitUnmask, true);
  assert.equal(v.decision.candidateScanSemanticFeasibilityPass, true);
  assert.equal(v.decision.formalQualityGatePassed, false);
  assert.equal(v.decision.advanceTo24, false);
  assert.equal(v.decision.defaultPromotion, false);
  const costs = v.resources.costs;
  assert.equal(costs.length, 72);
  unique(costs.map(c => c.request));
  unique(costs.map(c => c.record));
  assert.equal(costs.filter(c => c.route === 'count').length, 36);
  assert.equal(costs.filter(c => c.route === 'generation').length, 36);
  for (const c of costs) {
    assert.equal(c.recordSha256, recordHashes.get(c.record));
    assert.equal(c.reservedMicroUsd, 5000);
    assert.equal(c.outcome, 'succeeded');
    assert.equal(c.dispatched, true);
    assert.equal(c.httpStatus, 200);
    if (c.route === 'count') assert.equal(c.knownGenerationUsageEstimateMicroUsd, null);
    else assert.equal(c.knownGenerationUsageEstimateMicroUsd,
      Math.ceil((c.usage.input_tokens * 400000 + c.usage.output_tokens * 1600000) / 1000000));
  }
  assert.equal(v.resources.writes.length, 4);
  assert.equal(v.resources.reads.length, 8);
  for (const resource of [...v.resources.writes, ...v.resources.reads]) {
    const own = costs.filter(c => resource.readOutcomeId
      ? c.readOutcomeId === resource.readOutcomeId
      : c.writeGroupId === resource.writeGroupId && c.readOutcomeId === null);
    assert.equal(resource.physicalRequests, own.length);
    assert.equal(resource.reservedAttempts, own.length);
    assert.equal(resource.reservedMicroUsd, sum(own.map(c => c.reservedMicroUsd)));
    assert.equal(resource.knownGenerationUsageEstimateMicroUsd, sum(own.map(c => c.knownGenerationUsageEstimateMicroUsd ?? 0)));
    assert.equal(resource.unknownOutcomes, 0);
  }
  assert.equal(sum(costs.map(c => c.reservedMicroUsd)), 360000);
  assert.equal(sum(costs.map(c => c.knownGenerationUsageEstimateMicroUsd ?? 0)), 27968);
  assert.equal(sum(v.resources.writes.map(x => x.physicalRequests)), 32);
  assert.equal(sum(v.resources.reads.map(x => x.physicalRequests)), 40);
  assert.equal(v.resources.physicalRequests, costs.length);
  assert.equal(v.decision.resources.physicalRequests, costs.length);
  assert.equal(v.decision.resources.reservedMicroUsd, 360000);
  assert.equal(v.decision.resources.knownGenerationUsageEstimateMicroUsd, 27968);
  assert.equal(v.decision.resources.newUnknown, 0);
  assert.equal(v.decision.resources.newPending, 0);
  assert.equal(v.decision.resources.cleanedOwnedDatabases, 4);
}

test('closed factorial retains all sources, shared writes, first reads, ratings and nonduplicated cost', () => {
  assert.equal(sha256(bytes), '872a991f039dd6a5eaac364e910be94934d6079e239f690038460e6742d71408');
  checkResult(result);
});

test('both unsupported extras remain attributed to actual answer input and frozen review', () => {
  const [sign, rationale] = ['view-4', 'view-8'].map(id => result.ratings[0].views.find(v => v.viewId === id));
  assert.equal(sign.answerFullySupported, false);
  assert.match(sign.extraIssues[0].reason, /not established by the actual answer input/);
  const signRow = result.rows.find(r => r.id === result.reviewMapping.mappings.find(m => m.viewId === sign.viewId).readOutcomeId);
  assert.ok(signRow.packing.notRecalled.some(p => p.batchIndex === 1 && p.windowIndex === 4));
  assert.ok(signRow.answer.includes(sign.extraIssues[0].answerQuote));
  assert.equal(rationale.answerFullySupported, false);
  assert.equal(rationale.extraIssues[0].answerQuote, '招牌圖片排版也較簡單');
});

test('corruptions reject without relying on the whole-file digest', () => {
  const mutations = [
    v => v.rows.pop(),
    v => { v.denominator.answersPerCell = 8; },
    v => { v.sources[0].batches[1].messages[2].content = 'changed'; },
    v => { v.groups[0].memories[0].sourceBindings[0].excerpt += 'changed'; },
    v => { v.rows[0].afterSnapshotSha256 = 'changed'; },
    v => { v.rows[1].trace.selectedRefs.pop(); },
    v => { v.rows[0].models.find(m => m.phase === 'rank').request.input.candidates.pop(); },
    v => { v.rows[0].packing.request.system += 'changed'; },
    v => { v.rows[0].answer += 'changed'; },
    v => { v.reviewMapping.mappings[0].readOutcomeId = v.rows[1].id; },
    v => { v.ratings[0].views[0].claims[0].status = 'unsupported'; },
    v => { v.ratings[0].views.find(x => x.extraIssues.length).extraIssues = []; },
    v => { v.decision.cells[0].fullySupported = 1; },
    v => { v.decision.advanceTo24 = true; },
    v => { v.resources.writes.push(v.resources.writes[0]); },
    v => { v.resources.costs.push(v.resources.costs[0]); },
    v => { v.resources.costs.find(c => c.route === 'generation').knownGenerationUsageEstimateMicroUsd++; },
  ];
  for (const mutate of mutations) {
    const copy = structuredClone(result);
    mutate(copy);
    assert.throws(() => checkResult(copy));
  }
});

test('public result omits operational identifiers, local paths and raw provider bodies', () => {
  assert.doesNotMatch(bytes.toString(), /\/(?:home|tmp)\//);
  assert.doesNotMatch(bytes.toString(), /[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}/);
  const forbidden = new Set(['attemptId', 'attemptIds', 'runId', 'ledgerState', 'configuration', 'runtimeRoot', 'requestBody', 'responseBody', 'headers', 'authorization', 'apiKey']);
  const visit = x => {
    if (!x || typeof x !== 'object') return;
    for (const [k, child] of Object.entries(x)) {
      assert.ok(!forbidden.has(k), 'excluded field: ' + k);
      visit(child);
    }
  };
  visit(result);
  assert.ok(result.omissions.length > 0);
});

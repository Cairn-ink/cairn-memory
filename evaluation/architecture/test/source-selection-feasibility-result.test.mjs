import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const bytes = readFileSync(new URL('../results/source-selection-feasibility-v1.json', import.meta.url));
const result = JSON.parse(bytes);
const sha256 = value => createHash('sha256').update(value).digest('hex');
const judgmentHashes = [
  'c81c1972c0f6759c5999ceada3992a7738b4485550c229d9cc15b3c402ecbbe1',
  'f0e36dd302946877c778b30a1678837665a90430b72fc4c62e2ad95d5f9547c6',
  'af492d8c8c9c6d11342fd025ef03b856e297c3a5e22d0e6b0b8c58bef66a2d67',
  '83859a4001746b3160a3d1768b1a785247d1c1f61763340a9e864930a743bc40',
];
const rowOrder = ['session-01/baseline', 'session-01/candidate', 'session-02/candidate', 'session-02/baseline'];
const unique = values => assert.equal(new Set(values).size, values.length);
const sum = values => values.reduce((a, b) => a + b, 0);
const integer = value => assert.ok(Number.isSafeInteger(value) && value >= 0);

// This verifies one closed public observation. It cannot launch, resume, import
// operational data, or decide semantic support anew. Frozen judgments are data.
function checkResult(value) {
  assert.equal(value.version, 'source-selection-feasibility-public-v1');
  assert.equal(value.runtimeCommit, 'd549f0681d2949731254d0945acaef09155ebad4');
  assert.equal(value.firstOnly, true);
  assert.equal(value.status, 'completed');
  assert.deepEqual(value.denominator, { sessions: 2, scheduledArms: 4, completed: 4, failed: 0, notRun: 0 });
  assert.deepEqual(value.rows.map(r => `${r.session}/${r.arm}`), rowOrder);
  assert.equal(value.rows.length, value.denominator.scheduledArms);
  assert.equal(value.rows.filter(r => r.status === 'completed').length, value.denominator.completed);
  assert.equal(value.sources.length, value.denominator.sessions);
  const originalHashes = value.provenance;
  assert.equal(originalHashes.closedReportSha256, '0415c657678628af76deee71e0450b0b7d9929085d3e401f5b3cd84e32719fd1');
  assert.equal(originalHashes.ratingASha256, 'cb6707f542ad4903bd7dc19c675fd9346e289139938a4fcde2107545ac6d4a97');
  assert.equal(originalHashes.ratingBSha256, '4b39f1fd54b3a066fe5b5287f2fe03b981575e81b7cb9b9b6568cf31e56e9f42');
  assert.equal(originalHashes.recordHashes.length, 186);
  originalHashes.recordHashes.forEach((r, i) => {
    assert.equal(r.record, `record-${String(i + 1).padStart(4, '0')}.json`);
    assert.match(r.sha256, /^[a-f0-9]{64}$/);
  });
  const allSources = new Map();
  for (const session of value.sources) {
    assert.equal(session.batches.length, 2);
    const sources = new Map();
    session.batches.forEach((b, bi) => {
      assert.equal(b.messages.length, 6);
      b.messages.forEach((m, mi) => {
        assert.equal(m.source, `batch-${bi + 1}/window-${mi + 1}`);
        assert.equal(m.role, mi % 2 ? 'assistant' : 'user');
        assert.equal(sha256(m.content), m.sha256);
        sources.set(m.source, m);
      });
    });
    allSources.set(session.id, sources);
    const rubric = value.rubric.sessions.find(r => r.id === session.id);
    assert.equal(rubric.claims.length, 2);
    for (const claim of rubric.claims) for (const q of claim.quotes) {
      assert.ok(session.batches[q.batchIndex].messages[q.messageIndex].content.includes(q.text));
    }
  }
  const metrics = Object.fromEntries(['baseline', 'candidate'].map(arm => [arm, {
    answers: 0, minimalClaimCompleteAnswers: 0, completeAndFullySupportedAnswers: 0,
    supportedMinimalClaims: 0, minimalClaims: 0,
  }]));
  value.rows.forEach((row, index) => {
    assert.equal(row.status, 'completed');
    assert.equal(row.stage, 'completed');
    assert.equal(row.reason, null);
    assert.equal(row.cleanupCompleted, true);
    assert.deepEqual(row.calls, { extract: 2, classify: 2, select: 1, rank: 1, answer: 1 });
    assert.equal(row.captures.length, 2);
    assert.equal(row.select.length, 1);
    assert.equal(row.rank.length, 1);
    assert.equal(sha256(row.firstAnswer), row.firstAnswerSha256);
    const memories = new Map(row.memories.map(m => [m.id, m]));
    unique([...memories.keys()]);
    const receipts = new Map();
    const sources = allSources.get(row.session);
    for (const [i, memory] of row.memories.entries()) {
      assert.equal(memory.id, `memory-${i + 1}`);
      assert.equal(memory.filingStatus, 'filed');
      assert.equal(sha256(memory.preview), memory.previewSha256);
      for (const r of memory.receipts) {
        assert.match(r.id, /^receipt-[1-9][0-9]*$/);
        const original = sources.get(r.source);
        assert.equal(r.excerpt, original.content.slice(r.start, r.end));
        assert.equal(r.role, original.role);
        assert.equal(r.source, `batch-${r.batchIndex + 1}/window-${r.windowIndex + 1}`);
        assert.equal(r.messageIndex, r.windowIndex);
        if (receipts.has(r.id)) assert.deepEqual(r, receipts.get(r.id));
        receipts.set(r.id, r);
      }
    }
    for (const capture of row.captures) {
      assert.equal(capture.classification.status, 'applied');
      for (const admitted of capture.admitted) {
        const classified = capture.classification.memoryRevisions.find(r => r.memoryId === admitted.id);
        assert.ok(classified.revision > admitted.revision);
        assert.equal(memories.get(admitted.id).revision, classified.revision);
      }
    }
    const selected = row.select.flatMap(s => {
      const visible = s.input.maps.flatMap(m => m.items.filter(i => i.type === 'ref').map(i => i.ref.childId));
      for (const ref of s.output.refs) {
        assert.ok(visible.includes(ref.memoryId));
        assert.equal(ref.revision, memories.get(ref.memoryId).revision);
      }
      return s.output.refs.map(r => r.memoryId);
    });
    for (const rank of row.rank) {
      for (const c of rank.input.candidates) {
        assert.ok(selected.includes(c.memory.id));
        assert.equal(c.memory.content, undefined);
        for (const r of c.receipts) {
          assert.equal(r.excerpt, receipts.get(r.id).excerpt);
          assert.equal(r.role, receipts.get(r.id).role);
        }
      }
      const candidates = rank.input.candidates.map(c => c.memory.id);
      for (const ref of rank.output.refs) assert.ok(candidates.includes(ref.memoryId));
      assert.deepEqual(rank.output.refs.map(r => r.memoryId), row.recalled.map(r => r.id));
    }
    const recalledSources = new Set();
    for (const m of row.recalled) for (const id of m.receipts) {
      assert.ok(memories.get(m.id).receipts.some(r => r.id === id));
      recalledSources.add(receipts.get(id).source);
    }
    const packing = row.packing;
    unique([...packing.included, ...packing.omitted, ...packing.notRecalled]);
    assert.deepEqual([...packing.included, ...packing.omitted, ...packing.notRecalled].sort(), [...sources.keys()].sort());
    assert.deepEqual([...packing.included, ...packing.omitted].sort(), [...recalledSources].sort());
    assert.deepEqual(packing.evidence, packing.included.map(id => ({ role: sources.get(id).role, content: sources.get(id).content })));
    assert.equal(packing.omitted.length, 0);
    assert.equal(row.judgments.length, 2);
    assert.equal(sha256(JSON.stringify(row.judgments)), judgmentHashes[index]);
    const [a, b] = row.judgments;
    assert.equal(a.viewId, row.view);
    assert.equal(b.viewId, row.view);
    assert.deepEqual(a.claims.map(c => [c.id, c.status, c.supportedByAnswerEvidence]), b.claims.map(c => [c.id, c.status, c.supportedByAnswerEvidence]));
    assert.equal(a.answerFullySupported, b.answerFullySupported);
    assert.equal(a.allMinimalClaimsSupported, b.allMinimalClaimsSupported);
    assert.equal(a.allMinimalClaimsSupported, a.claims.every(c => c.status === 'supported' && c.supportedByAnswerEvidence));
    const metric = metrics[row.arm];
    metric.answers++;
    metric.minimalClaimCompleteAnswers += Number(a.allMinimalClaimsSupported);
    metric.completeAndFullySupportedAnswers += Number(a.allMinimalClaimsSupported && a.answerFullySupported);
    metric.supportedMinimalClaims += a.claims.filter(c => c.status === 'supported' && c.supportedByAnswerEvidence).length;
    metric.minimalClaims += a.claims.length;
  });
  assert.deepEqual(value.review.metrics, metrics);
  assert.equal(value.review.materialDisagreementsBeforeMappingReveal, 0);
  assert.equal(value.review.blindnessEstablished, false);
  assert.deepEqual(value.review.decision, { mechanicalPass: true, semanticPass: false, advanceToTwentyFourStudy: false });
  const r = value.resources;
  assert.equal(r.requests.length, 56);
  assert.equal(r.physicalRequests, r.requests.length);
  assert.equal(r.countRequests, r.requests.filter(q => q.route === 'count').length);
  const generation = r.requests.filter(q => q.route === 'generation');
  assert.equal(r.generationRequests, generation.length);
  assert.equal(r.countRequests, 28);
  assert.equal(r.generationRequests, 28);
  r.requests.forEach((q, i) => {
    assert.equal(q.ordinal, i + 1);
    assert.equal(q.outcome, 'succeeded');
    assert.equal(q.reservationMicroUsd, value.limits.reservationPerRequestMicroUsd);
    assert.ok(value.provenance.recordHashes.some(h => h.record === q.record));
    if (q.route === 'count') assert.equal(q.generationOnlyUsageEstimateMicroUsd, null);
  });
  for (const q of generation) {
    integer(q.inputTokens); integer(q.outputTokens); integer(q.generationOnlyUsageEstimateMicroUsd);
    assert.equal(q.generationOnlyUsageEstimateMicroUsd, Math.ceil((q.inputTokens * 400000 + q.outputTokens * 1600000) / 1000000));
  }
  assert.equal(r.reservationMicroUsd, sum(r.requests.map(q => q.reservationMicroUsd)));
  assert.equal(r.generationOnlyUsageEstimateMicroUsd, sum(generation.map(q => q.generationOnlyUsageEstimateMicroUsd)));
  assert.equal(r.inputTokens, sum(generation.map(q => q.inputTokens)));
  assert.equal(r.outputTokens, sum(generation.map(q => q.outputTokens)));
  assert.equal(r.reservationMicroUsd, 280000);
  assert.equal(r.generationOnlyUsageEstimateMicroUsd, 19681);
  assert.equal(r.inputTokens, 35535); assert.equal(r.outputTokens, 3409);
  assert.equal(r.durationMs, 240705.54312);
  assert.equal(r.cumulativeReservedBeforeMicroUsd + r.reservationMicroUsd, r.cumulativeReservedAfterMicroUsd);
  assert.equal(r.cumulativeReservedAfterMicroUsd, 340882281);
  assert.equal(value.limits.cumulativeMicroUsd, 400000000);
  assert.equal(value.limits.protectedMicroUsd, 30000000);
  assert.ok(r.cumulativeReservedAfterMicroUsd + value.limits.protectedMicroUsd <= value.limits.cumulativeMicroUsd);
  assert.equal(r.actualInvoice, 'unknown');
  assert.equal(r.countBilling, 'unknown; reservation retained');
  assert.equal(r.pendingAfter, 0); assert.equal(r.newUnknownAfter, 0);
}

test('frozen result hash and complete first-only evidence remain unchanged', () => {
  assert.equal(sha256(bytes), '0df5671e1129cfa0efe20ee52867c613d0ab6bd72d2e622e0d3f350e1e751eb6');
  checkResult(result);
});

test('English candidate failure is observable before rank and has no packing omission', () => {
  const r = result.rows[1];
  assert.deepEqual(r.memories.map(m => m.receipts.map(q => q.source).sort()), [
    [1, 2, 3, 4].map(i => `batch-1/window-${i}`), [1, 2, 3, 4].map(i => `batch-2/window-${i}`),
  ]);
  const visible = r.select[0].input.maps[0].items;
  assert.deepEqual(visible.map(i => i.ref.childId), ['memory-1', 'memory-2']);
  assert.ok(visible[1].label.includes("Nola's key test is still unconfirmed"));
  assert.deepEqual(r.select[0].output.refs.map(x => x.memoryId), ['memory-1']);
  assert.deepEqual(r.rank[0].input.candidates.map(x => x.memory.id), ['memory-1']);
  assert.ok(r.packing.included.every(s => s.startsWith('batch-1/')));
  assert.equal(r.packing.omitted.length, 0);
});

test('adversarial evidence, rating, denominator and cost mutations reject independently of the whole-file hash', () => {
  const mutations = [
    v => v.rows.pop(),
    v => { v.denominator.notRun = 1; },
    v => { v.sources[0].batches[0].messages[0].content += ' changed'; },
    v => { v.rows[0].firstAnswer += ' changed'; },
    v => { v.rows[0].memories[0].receipts[0].excerpt += ' changed'; },
    v => { v.rows[0].judgments[0].claims[0].status = 'supported'; },
    v => { v.rows[0].judgments[0].answerFullySupported = false; },
    v => { v.rows[0].judgments[1].claims[0].supportedByAnswerEvidence = true; },
    v => { v.review.metrics.baseline.completeAndFullySupportedAnswers = 1; },
    v => { v.rows[1].select[0].output.refs[0].memoryId = 'memory-99'; },
    v => { v.rows[1].packing.included.pop(); },
    v => { v.resources.reservationMicroUsd++; },
    v => { v.resources.requests.find(q => q.route === 'generation').generationOnlyUsageEstimateMicroUsd++; },
    v => { v.resources.generationOnlyUsageEstimateMicroUsd++; },
    v => { v.resources.actualInvoice = '19681'; },
  ];
  for (const mutate of mutations) {
    const copy = structuredClone(result);
    mutate(copy);
    assert.throws(() => checkResult(copy));
  }
});

test('public projection excludes local paths, persistence UUIDs and provider payload fields', () => {
  const text = bytes.toString('utf8');
  assert.doesNotMatch(text, /\/(?:tmp|home)\//);
  assert.doesNotMatch(text, /[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}/);
  const forbidden = new Set(['runId', 'attemptId', 'requestBody', 'responseBody', 'authorization', 'apiKey', 'ownerId', 'eventId', 'runtimeRoot', 'configuration']);
  const visit = v => {
    if (!v || typeof v !== 'object') return;
    for (const [key, child] of Object.entries(v)) {
      assert.ok(!forbidden.has(key), `excluded field: ${key}`);
      visit(child);
    }
  };
  visit(result);
});

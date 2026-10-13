import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';

// Pure evaluator tests use new, explicitly synthetic record/artifact controls;
// full actual core/wire linkage is exercised by the companion runtime suite.
const sourceRaw = () => readFileSync(new URL('../receipt-group-canonical-comparison-cases.json', import.meta.url), 'utf8');
const rubricRaw = () => readFileSync(new URL('../receipt-group-canonical-comparison-rubric.json', import.meta.url), 'utf8');
async function api() { return { ...(await import('../receipt-group-canonical-comparison-evaluation.mjs')),
  ...(await import('../receipt-group-canonical-comparison-store.mjs')), ...(await import('../../longmemeval/mixed-answer.mjs')) }; }
function synthetic(a, { absent = false, absentIndex = -1, sameSources = false, terminal = null, answerMode = null } = {}) {
  const source = a.validateCanonicalComparisonSource(sourceRaw()).value, authoredRubric = JSON.parse(rubricRaw()), rawArtifacts = [], sha = a.comparisonSha;
  const artifact = (path, body) => { rawArtifacts.push({ path, body }); return { path, bytes: Buffer.byteLength(body), sha256: sha(body) }; };
  const cases = source.cases.map((row, index) => {
    const cards = row.history.sessions.map((s, i) => ({ namespaceIndex: 0, memory: { id: `synthetic-card-${index}-${i}`, revision: 1, currentness: 'current' },
      receipts: s.turns.map((t, k) => ({ id: `synthetic-receipt-${index}-${i}-${k}`, role: t.role, excerpt: a.comparisonWrap(s, t) })), receiptCount: s.turns.length,
      interpretationStatus: 'omitted', sourceSelectionCoverage: 'unassessed' }));
    const labels = Object.fromEntries(row.history.sessions.flatMap((s, i) => s.turns.map((t, k) => [t.sourceLabel, { receiptId: cards[i].receipts[k].id, memoryId: cards[i].memory.id,
      role: t.role, excerpt: cards[i].receipts[k].excerpt, sourceSha256: sha(t.content) }])));
    return { id: row.id, namespace: row.namespace, question: { text: row.query.text, date: a.comparisonDate(row.query.date).label }, labels, rankRequest: { input: { candidates: cards } } };
  });
  const preparation = { version: a.comparisonVersion, sourceFileSha256: sha(sourceRaw()), cases }, attempts = [];
  const result = { version: a.comparisonVersion, denominator: 24, status: 'completed', failure: null, resources: { unknownIntents: 0 }, ledgerReconciliation: { accepted: true, pendingIntents: 0 },
    cases: cases.map((c, index) => {
      const selections = {}, answers = {};
      for (const arm of ['A', 'B']) {
        const chosen = arm === 'A' || sameSources ? c.rankRequest.input.candidates.slice(0, 1) : c.rankRequest.input.candidates.slice(0, 6);
        const units = chosen.map(a.comparisonUnit), refs = chosen.map(card => ({ namespaceIndex: 0, memoryId: card.memory.id, revision: 1 }));
        selections[arm] = { status: absent || index === absentIndex ? 'failed' : 'completed', refs, units, ...(arm === 'B' ? { canonicalProposal: { groups: chosen.map(card => ({ contextReceiptIds: [], terminalReceiptId: card.receipts[0].id })) } } : {}) };
        if (absent || index === absentIndex) { answers[arm] = { status: 'unanswered', accepted: false }; continue; }
        const packed = a.packMixedAnswer({ question: c.question, units, countTokens: text => Buffer.byteLength(text) });
        const body = JSON.stringify(packed.request), answer = answerMode === 'abstain' ? 'I do not know.'
          : answerMode ? authoredRubric.cases[index].calibration[answerMode] : `Synthetic first answer ${index} ${arm}`;
        answers[arm] = { status: 'completed', accepted: true, answer, requestBody: body, requestSha256: sha(body) };
        const response = JSON.stringify({ object: 'chat.completion', model: 'gpt-4.1-mini-2025-04-14', choices: [{ finish_reason: 'stop', message: { role: 'assistant', content: answer } }] });
        attempts.push({ attemptId: `synthetic-intent-${index}-${arm}`, id: c.id, arm, phase: 'answer', kind: 'answer', dispatched: true,
          requestArtifact: artifact(`/synthetic/${index}-${arm}-request`, body), responseArtifact: artifact(`/synthetic/${index}-${arm}-response`, response), post: { outcome: 'succeeded' } });
      }
      return { id: c.id, selections, answers };
    }), attempts };
  if (terminal === 'unknown') result.resources.unknownIntents = 1;
  if (terminal === 'fatal') { result.status = 'failed'; result.failure = { code: 'synthetic_fatal_integrity' }; }
  const execution = { sourceFileSha256: sha(sourceRaw()), preparationSha256: sha(JSON.stringify(preparation)), acceptedAccounting: true,
    authorIds: ['runtime-author', 'corpus-author'], reportArtifact: artifact('/synthetic/returned-report.json', JSON.stringify(result) + '\n') };
  return { sourceRaw: sourceRaw(), rubricRaw: rubricRaw(), preparation, result, execution, rawArtifacts, judgeSeed: 718239 };
}
function responses(evaluation, choose = () => 'correct') {
  return evaluation.packets.map((packet, judge) => ({ judgeId: `independent-judge-${judge + 1}`, role: 'non-author', first: true, packetSha256: packet.packetSha256,
    raw: JSON.stringify({ version: 'receipt-group-canonical-comparison-first-judgments-v1', packetSha256: packet.packetSha256,
      items: packet.payload.items.map((item, index) => ({ label: item.label, correctness: choose(item, index, judge), reviewedClaims: 1,
        unsupportedClaims: 0, staleClaims: 0, severeClaims: 0, severeRules: item.rubric.severeErrorRules.map(() => false),
        rationale: 'Synthetic parser control, not a semantic judgment.', refs: [{ targetId: item.answer.targetId, start: 0, end: 1 }] })) }) }));
}

test('Q7 exact sent artifacts precede positive-anchor diagnostics and opaque two-judge packets', async () => {
  const a = await api(), input = synthetic(a), evaluation = a.prepareCanonicalReceiptGroupComparisonEvaluation(input);
  assert.equal(evaluation.denominator, 24); assert.equal(evaluation.packets.length, 2);
  assert.equal(evaluation.packets[0].payload.items.length, 48);
  assert(evaluation.packets[0].payload.items.some(item => item.originalSources.length === 13));
  assert(!JSON.stringify(evaluation.packets.map(p => p.payload)).includes('canonicalProposal'));
  assert(evaluation.diagnostics.every(row => ['stored', 'selected', 'available', 'sent'].every(key => Object.hasOwn(row, key))));
  const damaged = structuredClone(input); damaged.rawArtifacts.find(r => r.path.endsWith('0-A-request')).body += ' ';
  assert.throws(() => a.prepareCanonicalReceiptGroupComparisonEvaluation(damaged), e => e.code === 'invalid_comparison_artifact');
});

test('Q7 missing/disagreed first correctness and safety remain unresolved, fixed24 denominator', async () => {
  const a = await api(), evaluation = a.prepareCanonicalReceiptGroupComparisonEvaluation(synthetic(a));
  const first = responses(evaluation, (_, index, judge) => index === 0 && judge === 1 ? 'incorrect' : 'correct');
  const report = a.scoreCanonicalReceiptGroupComparison({ evaluation, firstResponses: first });
  assert.equal(report.denominator, 24); assert.equal(report.arms.A.correct + report.arms.B.correct, 47);
  assert.equal(report.arms.A.unresolved + report.arms.B.unresolved, 1); assert.equal(report.decision.advance, false);
  const other = a.prepareCanonicalReceiptGroupComparisonEvaluation(synthetic(a));
  const missing = responses(other); missing[1].raw = null;
  const unresolved = a.scoreCanonicalReceiptGroupComparison({ evaluation: other, firstResponses: missing });
  assert.equal(unresolved.arms.A.correct, 0); assert.equal(unresolved.arms.B.correct, 0); assert.equal(unresolved.safetyKnown, false);
});

test('Q7 known unanswered slots are N/A, never clean or hypothetically correct', async () => {
  const a = await api(), evaluation = a.prepareCanonicalReceiptGroupComparisonEvaluation(synthetic(a, { absent: true }));
  const report = a.scoreCanonicalReceiptGroupComparison({ evaluation, firstResponses: responses(evaluation) });
  assert.equal(report.arms.A.correct, 0); assert.equal(report.arms.B.correct, 0); assert.equal(report.arms.A.completion, 0);
  assert(report.cases.every(c => c.A.safetyDisposition === 'not-observed-no-answer' && c.B.safetyDisposition === 'not-observed-no-answer'));
  assert.deepEqual(report.unresolvedNetBounds, { minimum: 0, maximum: 0 }); assert.equal(report.decision.advance, false);
});

test('Q7 disagreement in affected claims or severe rules blocks, preserves both reviewed totals', async () => {
  const a = await api(), evaluation = a.prepareCanonicalReceiptGroupComparisonEvaluation(synthetic(a)), first = responses(evaluation);
  const raw = JSON.parse(first[1].raw); raw.items[0].unsupportedClaims = 1; first[1].raw = JSON.stringify(raw);
  const report = a.scoreCanonicalReceiptGroupComparison({ evaluation, firstResponses: first });
  assert.equal(report.safetyKnown, false); assert.equal(report.decision.advance, false);
  assert.equal(report.judgeObservations[0].items[0].reviewedClaims, 1); assert.equal(report.judgeObservations[1].items[0].unsupportedClaims, 1);
});

test('Q7 exact fixed paired bootstrap, external firstness and nonauthor/clone boundaries', async () => {
  const a = await api();
  assert.deepEqual(a.canonicalComparisonPairedInterval(Array(24).fill(1)), { lower: 1, upper: 1, seed: 20261013, draws: 10000,
    percentileIndices: [249, 9749], interpretation: 'exploratory-hand-authored-development-population' });
  const evaluation = a.prepareCanonicalReceiptGroupComparisonEvaluation(synthetic(a)), first = responses(evaluation); first[0].judgeId = 'runtime-author';
  assert.throws(() => a.scoreCanonicalReceiptGroupComparison({ evaluation, firstResponses: first }), e => e.code === 'invalid_comparison_judges');
  assert.throws(() => a.scoreCanonicalReceiptGroupComparison({ evaluation: structuredClone(evaluation), firstResponses: first }), e => e.code === 'invalid_comparison_evaluation');
});

test('Q7 concise/explained calibration credit is equal; supplied near-miss judgments receive no automatic credit', async () => {
  const a = await api(), rubric = JSON.parse(rubricRaw());
  assert(rubric.cases.every(c => typeof c.calibration.conciseCorrect === 'string' && typeof c.calibration.explainedCorrect === 'string' && typeof c.calibration.nearMiss === 'string'));
  const one = a.prepareCanonicalReceiptGroupComparisonEvaluation(synthetic(a, { answerMode: 'conciseCorrect' }));
  const two = a.prepareCanonicalReceiptGroupComparisonEvaluation(synthetic(a, { answerMode: 'explainedCorrect' }));
  const concise = a.scoreCanonicalReceiptGroupComparison({ evaluation: one, firstResponses: responses(one) });
  const explained = a.scoreCanonicalReceiptGroupComparison({ evaluation: two, firstResponses: responses(two) });
  assert.deepEqual(concise.arms, explained.arms);
  const abstain = a.prepareCanonicalReceiptGroupComparisonEvaluation(synthetic(a, { answerMode: 'nearMiss' }));
  const wrong = a.scoreCanonicalReceiptGroupComparison({ evaluation: abstain, firstResponses: responses(abstain, () => 'incorrect') });
  assert.equal(wrong.arms.A.correct, 0); assert.equal(wrong.arms.B.correct, 0); assert.equal(wrong.decision.advance, false);
});

function fixedGain(evaluation, gains = 3, mutate = () => {}) {
  const first = responses(evaluation, item => {
    const match = /^Synthetic first answer (\d+) ([AB])$/u.exec(item.answer.text);
    assert(match); return match[2] === 'B' && +match[1] < gains ? 'correct' : 'incorrect';
  });
  for (const [judge, response] of first.entries()) {
    const raw = JSON.parse(response.raw);
    raw.items.forEach(item => { const packetItem = evaluation.packets[judge].payload.items.find(p => p.label === item.label);
      const match = /^Synthetic first answer (\d+) ([AB])$/u.exec(packetItem.answer.text); mutate(item, +match[1], match[2]); });
    response.raw = JSON.stringify(raw);
  }
  return first;
}

test('Q7 synthetic positive +3 fixed24 decision and known-unanswered N/A do not add an all48 gate', async () => {
  const a = await api();
  for (const absentIndex of [-1, 23]) {
    const evaluation = a.prepareCanonicalReceiptGroupComparisonEvaluation(synthetic(a, { absentIndex }));
    const report = a.scoreCanonicalReceiptGroupComparison({ evaluation, firstResponses: fixedGain(evaluation) });
    assert.equal(report.netCorrect, 3); assert(report.sentAnchorCounts.B > report.sentAnchorCounts.A);
    assert.equal(report.decision.advance, true, JSON.stringify(report.decision.checks)); assert.equal(report.arms.B.denominator, 24);
    assert.equal(report.arms.B.completion, absentIndex < 0 ? 24 : 23);
    if (absentIndex === 23) assert.equal(report.cases[23].B.safetyDisposition, 'not-observed-no-answer');
  }
});

test('Q7 independent gain/anchor/harm/severe/resource vetoes and mixed-vector paired interval', async () => {
  const a = await api();
  const variants = [
    { name: 'gain', gains: 2, failed: 'netGainAtLeastThree' },
    { name: 'anchor', setup: { sameSources: true }, failed: 'sentAnchorImproved' },
    { name: 'unsupported', failed: 'noHigherUnsupported', mutate(row, index, arm) { if (index === 4 && arm === 'B') row.unsupportedClaims = 1; } },
    { name: 'stale', failed: 'noHigherStale', mutate(row, index, arm) { if (index === 4 && arm === 'B') row.staleClaims = 1; } },
    { name: 'new-severe-equal-aggregate', failed: 'noNewSevere', mutate(row, index, arm) {
      if (index === (arm === 'A' ? 2 : 3)) { assert(row.severeRules.length > 0); row.severeRules[0] = true; row.severeClaims = 1; }
    } },
    { name: 'unknown-resource', setup: { terminal: 'unknown' }, failed: 'resourcesAccepted' },
    { name: 'fatal-resource', setup: { terminal: 'fatal' }, failed: 'resourcesAccepted' },
  ];
  for (const variant of variants) {
    const evaluation = a.prepareCanonicalReceiptGroupComparisonEvaluation(synthetic(a, variant.setup));
    const report = a.scoreCanonicalReceiptGroupComparison({ evaluation, firstResponses: fixedGain(evaluation, variant.gains ?? 3, variant.mutate) });
    assert.equal(report.decision.advance, false, variant.name); assert.equal(report.decision.checks[variant.failed], false, variant.name);
    if (variant.name === 'new-severe-equal-aggregate') assert.equal(report.arms.A.severeQuestions, report.arms.B.severeQuestions);
  }
  // Literal expected numerators from a separately run fixed-vector reference,
  // not a call to the production interval function to build its own oracle.
  const interval = a.canonicalComparisonPairedInterval([1,1,1,1,1,1,1,1,1,0,0,0,0,0,0,0,0,0,-1,-1,-1,-1,-1,-1]);
  assert.equal(interval.lower, -5 / 24); assert.equal(interval.upper, 10 / 24);
});

test('Q7 literal universal abstention and duplicate first safety keys cannot manufacture advancement', async () => {
  const a = await api(), evaluation = a.prepareCanonicalReceiptGroupComparisonEvaluation(synthetic(a, { answerMode: 'abstain' }));
  assert(evaluation.packets.every(p => p.payload.items.every(item => item.answer.text === 'I do not know.')));
  const report = a.scoreCanonicalReceiptGroupComparison({ evaluation, firstResponses: responses(evaluation, () => 'incorrect') });
  assert.equal(report.netCorrect, 0); assert.equal(report.arms.A.correct, 0); assert.equal(report.decision.advance, false);
  const other = a.prepareCanonicalReceiptGroupComparisonEvaluation(synthetic(a)), first = responses(other);
  first[0].raw = first[0].raw.replace('"unsupportedClaims":0', '"unsupportedClaims":1,"unsupportedClaims":0');
  const ambiguous = a.scoreCanonicalReceiptGroupComparison({ evaluation: other, firstResponses: first });
  assert.equal(ambiguous.safetyKnown, false); assert.equal(ambiguous.arms.A.correct, 0); assert.equal(ambiguous.arms.B.correct, 0);
  assert.equal(ambiguous.judgeObservations[0].status, 'malformed'); assert.equal(ambiguous.decision.advance, false);
});

test('Q7 unequal known reviewed totals preserve safe +3 advancement; unknown totals still block', async () => {
  const a = await api(), evaluation = a.prepareCanonicalReceiptGroupComparisonEvaluation(synthetic(a)), first = fixedGain(evaluation);
  for (const [judge, response] of first.entries()) {
    const raw = JSON.parse(response.raw); raw.items.forEach(item => { item.reviewedClaims = judge + 2; }); response.raw = JSON.stringify(raw);
  }
  const report = a.scoreCanonicalReceiptGroupComparison({ evaluation, firstResponses: first });
  assert.equal(report.netCorrect, 3); assert(report.sentAnchorCounts.B > report.sentAnchorCounts.A);
  assert.equal(report.judgeObservations[0].items[0].reviewedClaims, 2); assert.equal(report.judgeObservations[1].items[0].reviewedClaims, 3);
  assert.equal(report.safetyKnown, true, 'Segmentation totals need not be identical when each total is known and all harm observations agree');
  assert.equal(report.decision.advance, true);
  const unknown = a.prepareCanonicalReceiptGroupComparisonEvaluation(synthetic(a)), missingTotal = fixedGain(unknown);
  const raw = JSON.parse(missingTotal[1].raw);
  raw.items.forEach(item => { item.reviewedClaims = null; item.unsupportedClaims = null; item.staleClaims = null; item.severeClaims = null; });
  missingTotal[1].raw = JSON.stringify(raw);
  const blocked = a.scoreCanonicalReceiptGroupComparison({ evaluation: unknown, firstResponses: missingTotal });
  assert.equal(blocked.safetyKnown, false); assert.equal(blocked.decision.advance, false);
});

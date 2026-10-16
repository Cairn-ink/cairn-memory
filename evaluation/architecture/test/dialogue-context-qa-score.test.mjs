import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';
import { runDialogueContextQa } from '../dialogue-context-qa.mjs';
import { createDialogueContextJudgingPacket, validateDialogueContextJudgments, scoreDialogueContextQa } from '../dialogue-context-qa-score.mjs';

const supportsSqlite = Number(process.versions.node.split('.')[0]) >= 22 &&
  (Number(process.versions.node.split('.')[0]) > 22 || Number(process.versions.node.split('.')[1]) >= 16);
const sqlite = { skip: !supportsSqlite && 'real public-runner toy requires Node >=22.16' };
const groups = ['consideration', 'explicit-adoption', 'rejection', 'factual-correction', 'observation', 'insufficient-information'];
const seed = 'ab'.repeat(32);
function inputs() {
  const fixture = { version: 'dialogue-context-qa-v1', cases: Array.from({ length: 24 }, (_, i) => ({
    id: i.toString(16).padStart(12, '0'),
    messages: i >= 20 ? [{ role: 'user', content: `No berth was recorded for toy sample ${i}.` }] : [
      { role: 'user', content: `Toy sample ${i} is held at berth ${70 + i}.` },
      { role: 'assistant', content: `I have no additional observation about toy sample ${i}.` },
    ], question: `Which berth holds toy sample ${i}?`,
  })) };
  const rubric = { version: 'dialogue-context-qa-rubric-v1', fixtureVersion: fixture.version,
    cases: fixture.cases.map((source, i) => ({ id: source.id, group: groups[Math.floor(i / 4)],
      expectedAnswer: i >= 20 ? 'I do not know.' : `The sample is at berth ${70 + i}. Optional illustrative detail is not required.`,
      claims: [{ id: 'c1', text: i >= 20 ? 'State bounded uncertainty without inventing a berth.' : `The sample is at berth ${70 + i}.`,
        decision: i < 20 && i % 4 === 0,
        evidence: [{ messageIndex: 0, quote: i >= 20 ? 'No berth was recorded' : `berth ${70 + i}` }] }],
      forbiddenAssertions: [{ text: 'The sample was already shipped elsewhere.', severe: true }],
    })) };
  return { fixture, rubric, seed };
}
const toys = new Map();
async function actualToy(allSelected = false) {
  if (!toys.has(allSelected)) toys.set(allSelected, (async () => {
    const data = inputs();
    const model = { contextWindow: 8192, countTokens: text => Math.ceil(text.length / 20),
      extract({ input }) {
        const i = Number(input.messages[0].content.match(/sample (\d+)/u)[1]);
        const entry = { content: `Generated toy paraphrase ${i}`, kind: 'context', confidence: 0.8, sourceIndices: [i < 3 && !allSelected ? 1 : 0] };
        return { items: [entry, structuredClone(entry)] }; // Real canonical-memory merge, not manual admission.
      },
      classify: ({ input }) => ({ items: input.memories.map(memory => ({ memoryId: memory.id, parentIds: [] })) }) };
    const report = await runDialogueContextQa({ fixture: data.fixture, model,
      answer({ input }) {
        const i = Number(input.question.match(/sample (\d+)/u)[1]);
        return { answer: i < 20 && input.sources.some(source => source.text.includes(`berth ${70 + i}`))
          ? `The sample is at berth ${70 + i}.` : 'I do not know.' };
      }, onRecord() {}, assertActive() {} });
    assert.equal(report.status, 'completed'); assert.equal(report.completedArms, 48);
    return { ...data, report };
  })());
  return structuredClone(await toys.get(allSelected));
}
function judged(data) {
  const artifact = createDialogueContextJudgingPacket(data);
  const judgments = { packetSha256: artifact.packetSha256, pairs: artifact.packet.pairs.map(pair => {
    const key = artifact.key.pairs.find(row => row.pairId === pair.pairId);
    const i = data.fixture.cases.findIndex(row => row.id === key.caseId);
    return { pairId: pair.pairId, resolved: true, reason: 'Supplied toy adjudication, not a semantic program judgment.',
      slots: pair.slots.map(slot => {
        const correct = slot.status === 'completed' && (i >= 20 || slot.answer?.startsWith(`The sample is at berth ${70 + i}.`));
        return { slot: slot.slot, claims: pair.requiredClaims.map(claim => ({ claimId: claim.claimId,
          correct, supported: correct,
          sourceIds: correct && !pair.insufficientInformation ? ['window-0'] : [], reason: 'Toy required-claim judgment.' })) };
      }), issues: [] };
  }) };
  return { ...artifact, judgments };
}
function slotFor(artifact, caseId, arm) {
  const key = artifact.key.pairs.find(row => row.caseId === caseId);
  const pair = artifact.judgments.pairs.find(row => row.pairId === key.pairId);
  const slot = pair.slots.find(row => key.slots[row.slot] === arm);
  return { key, pair, slot };
}
function appendAnswer(data, index, arm, addition) {
  data.report.rows[index][arm].answer += addition;
  data.report.rows[index][arm].answerOutput.answer = data.report.rows[index][arm].answer;
}
function issueFor(artifact, caseId, issueId, meaning, occurrences) {
  const { pair, key } = slotFor(artifact, caseId, 'baseline');
  pair.issues.push({ issueId, meaning, occurrences: occurrences.map(({ arm, quote, ...flags }) => ({
    slot: Object.keys(key.slots).find(slot => key.slots[slot] === arm), answerQuote: quote,
    unsupported: false, severe: false, stale: false, ...flags, reason: 'Toy paired assertion adjudication.' })) });
}
const score = (data, artifact = judged(data)) => scoreDialogueContextQa({ ...data, judgments: artifact.judgments });

test('strict seed and source/rubric schemas reject before report preparation', () => {
  const data = inputs();
  assert.throws(() => createDialogueContextJudgingPacket({ ...data, seed: 'short' }), { code: 'invalid_seed' });
  const extra = structuredClone(data); extra.fixture.oracle = 'not source data';
  assert.throws(() => createDialogueContextJudgingPacket(extra), { code: 'invalid_fixture' });
  const badRubric = structuredClone(data); badRubric.rubric.cases[0].claims[0].evidence[0].quote = 'not a real quote';
  assert.throws(() => createDialogueContextJudgingPacket(badRubric), { code: 'invalid_rubric' });
});

test('actual 24-case core report yields deterministic masked packet, separate key and independent pretty-JSON hash', sqlite, async () => {
  const data = await actualToy(), frozen = structuredClone(data);
  const first = judged(data), repeated = createDialogueContextJudgingPacket(data);
  assert.deepEqual(first.packet, repeated.packet); assert.deepEqual(first.key, repeated.key);
  assert.equal(first.packetSha256, createHash('sha256').update(JSON.stringify(first.packet, null, 2) + '\n').digest('hex'));
  assert.equal(first.packet.pairs.length, 24); assert.equal(first.key.pairs.length, 24);
  assert.ok(!JSON.stringify(first.packet).includes('"baseline"'));
  assert.ok(!JSON.stringify(first.packet).includes('"candidate"'));
  assert.ok(!JSON.stringify(first.packet).includes('runtime'));
  assert.ok(first.packet.pairs.every(pair => !data.fixture.cases.some(row => row.id === pair.pairId)));
  assert.deepEqual(validateDialogueContextJudgments(first.packet, first.judgments), first.judgments);
  const different = createDialogueContextJudgingPacket({ ...data, seed: 'cd'.repeat(32) });
  assert.notEqual(different.packetSha256, first.packetSha256);
  assert.notDeepEqual(different.key, first.key);
  assert.equal(data.report.rows[0].candidate.binding.sidecar.memories[0].receiptCount, 2);
  assert.equal(data.report.rows[0].candidate.coldResolution.resolved.length, 4);
  assert.deepEqual(data, frozen);
});

test('all fixed Q8 gates pass only supplied complete toy judgments with +3 gains and actual evidence gains', sqlite, async t => {
  const data = await actualToy(), artifact = judged(data), frozen = structuredClone(artifact.judgments);
  const result = score(data, artifact);
  assert.equal(result.semanticAuthority, 'supplied-judgments-only'); assert.equal(result.pass, true);
  assert.equal(result.primaryStructuralAuditRequired, true);
  assert.deepEqual(result.denominators, { cases: 24, claims: 24, positiveCases: 20, positiveClaims: 20, insufficientCases: 4 });
  assert.equal(result.netGain, 3); assert.equal(result.gains.length, 3); assert.deepEqual(result.regressions, []);
  assert.equal(result.baseline.supportedAnswers, 21); assert.equal(result.candidate.supportedAnswers, 24);
  assert.equal(result.baseline.wrongAnswers, 3); assert.equal(result.candidate.wrongAnswers, 0);
  assert.equal(result.baseline.coverage.retained.claims, 17); assert.equal(result.candidate.coverage.retained.claims, 20);
  assert.equal(result.baseline.coverage.packed.claims, 17); assert.equal(result.candidate.coverage.packed.claims, 20);
  assert.equal(result.baseline.coverage.retained.fullCases, 17); assert.equal(result.candidate.coverage.retained.fullCases, 20);
  assert.ok(result.candidate.sourceBytes.packed > result.baseline.sourceBytes.packed);
  assert.ok(Object.values(result.gateChecks).every(Boolean));
  assert.deepEqual(artifact.judgments, frozen);
  t.diagnostic(JSON.stringify({ suppliedToyJudgments: true, denominator: result.denominators,
    netGain: result.netGain, retained: [17, 20], packed: [17, 20], pass: result.pass }));
});

test('claim denominator is derived, illustrative optional detail is not a claim, unknown audit spans excluded', sqlite, async () => {
  const data = await actualToy();
  data.rubric.cases[5].claims.push({ ...structuredClone(data.rubric.cases[5].claims[0]), id: 'c2', text: 'Second toy required claim.' });
  const artifact = judged(data), result = score(data, artifact);
  assert.equal(result.denominators.claims, 25); assert.equal(result.denominators.positiveClaims, 21);
  assert.equal(result.pass, true); assert.equal(result.candidate.coverage.retained.claims, 21);
  for (const pair of artifact.packet.pairs.filter(pair => pair.insufficientInformation)) {
    assert.ok(pair.requiredClaims[0].evidence.length > 0);
    const rating = artifact.judgments.pairs.find(row => row.pairId === pair.pairId);
    assert.ok(rating.slots.every(slot => slot.claims[0].supported && slot.claims[0].sourceIds.length === 0));
  }
});

test('strict complete judgments reject swapped/forged refs, duplicates, omissions, extras and incorrect support credit', sqlite, async () => {
  const data = await actualToy(), original = judged(data);
  const mutate = fn => { const artifact = structuredClone(original); fn(artifact); return artifact; };
  const invalid = [
    mutate(a => { a.judgments.packetSha256 = '0'.repeat(64); }),
    mutate(a => { a.judgments.pairs.pop(); }),
    mutate(a => { a.judgments.pairs[0] = a.judgments.pairs[1]; }),
    mutate(a => { a.judgments.pairs[0].extra = true; }),
    mutate(a => { a.judgments.pairs[0].pairId = 'forged'; }),
    mutate(a => { a.judgments.pairs[0].slots.pop(); }),
    mutate(a => { a.judgments.pairs[0].slots[1] = a.judgments.pairs[0].slots[0]; }),
    mutate(a => { a.judgments.pairs[0].slots[0].claims.push(a.judgments.pairs[0].slots[0].claims[0]); }),
    mutate(a => { a.judgments.pairs[0].slots[0].claims[0].claimId = 'missing'; }),
    mutate(a => { a.judgments.pairs[0].slots[0].claims[0].sourceIds = ['window-63']; }),
    mutate(a => { const slot = slotFor(a, data.fixture.cases[0].id, 'baseline').slot;
      Object.assign(slot.claims[0], { correct: true, supported: true, sourceIds: ['window-0'] }); }),
    mutate(a => { const slot = slotFor(a, data.fixture.cases[0].id, 'candidate').slot;
      Object.assign(slot.claims[0], { correct: false, supported: true }); }),
    mutate(a => { const slot = slotFor(a, data.fixture.cases[0].id, 'candidate').slot;
      slot.claims[0].sourceIds = []; }),
    mutate(a => { delete a.judgments.pairs[0].resolved; }),
  ];
  for (const artifact of invalid) assert.throws(() => validateDialogueContextJudgments(artifact.packet, artifact.judgments), { code: 'invalid_judgments' });
  const forgedPacket = structuredClone(original.packet); forgedPacket.pairs[0].slots.reverse();
  assert.throws(() => validateDialogueContextJudgments(forgedPacket, original.judgments), { code: 'invalid_judgments' });
  const changedReport = structuredClone(data); changedReport.report.rows[0].candidate.answer += ' altered';
  changedReport.report.rows[0].candidate.answerOutput.answer = changedReport.report.rows[0].candidate.answer;
  assert.throws(() => score(changedReport, original), { code: 'invalid_judgments' });
});

test('null required claims and unresolved pair issue equivalence independently prevent promotion', sqlite, async () => {
  const data = await actualToy();
  for (const unresolved of ['claim', 'pair']) {
    const artifact = judged(data), target = slotFor(artifact, data.fixture.cases[5].id, 'candidate');
    if (unresolved === 'pair') target.pair.resolved = false;
    else Object.assign(target.slot.claims[0], { correct: null, supported: null });
    const result = score(data, artifact);
    assert.equal(result.pass, false); assert.equal(result.gateChecks.noUnresolvedJudgments, false);
    assert.ok(result.unresolved.some(row => row.kind === unresolved));
    assert.ok(result.candidate.unresolvedAnswers >= 1);
  }
});

test('paired exact issue grouping distinguishes persistent same error from unrelated new candidate error', sqlite, async () => {
  const data = await actualToy(), id = data.fixture.cases[5].id;
  for (const arm of ['baseline', 'candidate']) appendAnswer(data, 5, arm, ' The crate is purple.');
  const sameError = judged(data);
  issueFor(sameError, id, 'same', 'The crate is purple.', [
    { arm: 'baseline', quote: 'The crate is purple.', unsupported: true },
    { arm: 'candidate', quote: 'The crate is purple.', unsupported: true },
  ]);
  const persistent = score(data, sameError);
  assert.deepEqual(persistent.newIssues, []); assert.equal(persistent.gateChecks.noNewUnsupported, true);
  assert.equal(persistent.baseline.issues.unsupported, 1); assert.equal(persistent.candidate.issues.unsupported, 1);
  assert.equal(persistent.rows[5].baseline.supportedAnswer, false); assert.equal(persistent.rows[5].candidate.supportedAnswer, false);
  const different = structuredClone(data);
  different.report.rows[5].candidate.answer = different.report.rows[5].candidate.answer.replace('purple', 'green');
  different.report.rows[5].candidate.answerOutput.answer = different.report.rows[5].candidate.answer;
  const distinct = judged(different);
  issueFor(distinct, id, 'baseline-purple', 'The crate is purple.', [{ arm: 'baseline', quote: 'The crate is purple.', unsupported: true }]);
  issueFor(distinct, id, 'candidate-green', 'The crate is green.', [{ arm: 'candidate', quote: 'The crate is green.', unsupported: true }]);
  const newError = score(different, distinct);
  assert.equal(newError.gateChecks.noNewUnsupported, false); assert.equal(newError.newIssues.length, 1);
  assert.equal(newError.newIssues[0].issueId, 'candidate-green');
});

test('new unsupported/severe/stale flags are each gated, and issue occurrence schema/quotes are exact', sqlite, async () => {
  const data = await actualToy(), id = data.fixture.cases[5].id;
  appendAnswer(data, 5, 'candidate', ' The crate moved yesterday.');
  for (const flag of ['unsupported', 'severe', 'stale']) {
    const artifact = judged(data);
    issueFor(artifact, id, `new-${flag}`, 'A material toy assertion.', [{ arm: 'candidate', quote: 'The crate moved yesterday.', [flag]: true }]);
    const result = score(data, artifact);
    assert.equal(result.pass, false); assert.equal(result.gateChecks[`noNew${flag[0].toUpperCase() + flag.slice(1)}`], false);
    for (const mutation of ['duplicate-slot', 'bad-quote', 'no-flag', 'extra', 'null-flag']) {
      const changed = structuredClone(artifact), { pair } = slotFor(changed, id, 'candidate');
      const occurrence = pair.issues[0].occurrences[0];
      if (mutation === 'duplicate-slot') pair.issues[0].occurrences.push(structuredClone(occurrence));
      if (mutation === 'bad-quote') occurrence.answerQuote = 'not in the answer';
      if (mutation === 'no-flag') occurrence[flag] = false;
      if (mutation === 'extra') occurrence.truth = true;
      if (mutation === 'null-flag') occurrence[flag] = null;
      assert.throws(() => validateDialogueContextJudgments(changed.packet, changed.judgments), { code: 'invalid_judgments' });
    }
  }
});

test('lost decision, insufficient net gain and paired completion loss fail their own gates', sqlite, async () => {
  const data = await actualToy();
  const decision = judged(data), decisionId = data.fixture.cases[4].id;
  Object.assign(slotFor(decision, decisionId, 'candidate').slot.claims[0], { correct: false, supported: false });
  const loss = score(data, decision);
  assert.equal(loss.gateChecks.noLostSupportedDecision, false); assert.equal(loss.lostDecisions.length, 1);
  assert.equal(loss.gateChecks.netSupportedAnswerGain, false); assert.equal(loss.regressions.length, 1);
  const failed = structuredClone(data), arm = failed.report.rows[0].candidate;
  Object.assign(arm, { status: 'failed', reason: 'answer_failed', failedPhase: 'answer', answer: null, answerOutput: null });
  failed.report.completedArms--; failed.report.failedArms++;
  const artifact = judged(failed), result = score(failed, artifact);
  assert.equal(result.gateChecks.noCompletionLoss, false); assert.equal(result.candidate.failed, 1);
  assert.equal(result.candidate.wrongAnswers, 0); assert.equal(result.denominators.cases, 24);
  const invalid = structuredClone(artifact);
  Object.assign(slotFor(invalid, failed.fixture.cases[0].id, 'candidate').slot.claims[0], { correct: true, supported: true, sourceIds: ['window-0'] });
  assert.throws(() => validateDialogueContextJudgments(invalid.packet, invalid.judgments), { code: 'invalid_judgments' });
});

test('positive coverage requires every quote, maps packed windows through authoritative eventId and rejects forged evidence', sqlite, async () => {
  const data = await actualToy(), mapped = structuredClone(data);
  for (const arm of ['baseline', 'candidate']) {
    const row = mapped.report.rows[5][arm];
    row.coldResolution.resolved.forEach(entry => { entry.windowIndex = 12; });
    row.binding.sidecar.entries.forEach(entry => { entry.windowIndex = 12; });
    row.binding.expectedDigest = createHash('sha256').update(JSON.stringify(row.binding.sidecar)).digest('hex');
    row.packed.request.input.sources[0].sourceId = 'window-12'; row.packed.includedIds[0] = 'window-12';
  }
  assert.throws(() => createDialogueContextJudgingPacket(mapped), { code: 'invalid_report' });
  const allSpans = structuredClone(data);
  allSpans.rubric.cases[5].claims[0].evidence.push({ messageIndex: 1, quote: 'no additional observation' });
  const partial = score(allSpans);
  assert.equal(partial.candidate.coverage.packed.claims, 19); // Selected first window has no predecessor; missing second quote.
  for (const corruption of ['event', 'duplicate-role', 'packed-text', 'counts', 'missing-row', 'completion']) {
    const corrupt = structuredClone(data);
    if (corruption === 'event') corrupt.report.rows[0].candidate.coldResolution.resolved[0].receipt.eventId = 'source-5';
    if (corruption === 'duplicate-role') corrupt.report.rows[0].candidate.coldResolution.resolved[0].provenanceRole = 'dialogue-context';
    if (corruption === 'packed-text') corrupt.report.rows[0].candidate.packed.request.input.sources[0].text = 'forged text';
    if (corruption === 'counts') corrupt.report.counts.extract++;
    if (corruption === 'missing-row') corrupt.report.rows.pop();
    if (corruption === 'completion') corrupt.report.rows[0].candidate.capture.value.classification.status = 'failed';
    assert.throws(() => createDialogueContextJudgingPacket(corrupt), { code: 'invalid_report' });
  }
});

test('retained and packed necessary-evidence gates are separate; zero opportunity cannot pass', sqlite, async () => {
  const data = await actualToy(), packed = structuredClone(data);
  for (let i = 0; i < 3; i++) {
    const value = packed.report.rows[i].candidate.packed;
    const omitted = value.request.input.sources.pop();
    value.includedIds.pop(); value.omittedIds.push(omitted.sourceId); value.includedCount--; value.omittedCount++;
    const size = Buffer.byteLength(omitted.text); value.includedBytes -= size; value.omittedBytes += size;
  }
  const packingJudgments = judged(packed);
  for (let i = 0; i < 3; i++) Object.assign(slotFor(packingJudgments, data.fixture.cases[i].id, 'candidate').slot.claims[0],
    { correct: true, supported: false, sourceIds: [] });
  const packing = score(packed, packingJudgments);
  assert.equal(packing.gateChecks.retainedNecessaryEvidence, true); assert.equal(packing.gateChecks.packedNecessaryEvidence, false);
  const identical = structuredClone(data);
  for (const row of identical.report.rows) {
    const candidateCalls = row.candidate.modelCalls;
    row.candidate = structuredClone(row.baseline); row.candidate.modelCalls = candidateCalls;
  }
  const noOpportunity = score(identical);
  assert.equal(noOpportunity.gateChecks.retainedNecessaryEvidence, false);
  assert.equal(noOpportunity.gateChecks.packedNecessaryEvidence, false); assert.equal(noOpportunity.pass, false);
  const complete = score(await actualToy(true));
  assert.equal(complete.baseline.supportedAnswers, 24);
  assert.equal(complete.baseline.coverage.retained.claims, 20);
  assert.equal(complete.gateChecks.opportunity, false); assert.equal(complete.pass, false);
});

test('actual stopped 24-case report preserves not-run failures in denominator, with no wrong-answer credit', sqlite, async () => {
  const data = inputs();
  data.report = await runDialogueContextQa({ fixture: data.fixture,
    model: { contextWindow: 8192, countTokens: () => 1, extract() { assert.fail('not dispatched'); }, classify() { assert.fail('not dispatched'); } },
    answer() { assert.fail('not dispatched'); }, onRecord() {}, assertActive() { throw new Error('synthetic stop'); } });
  const result = score(data);
  assert.equal(result.pass, false); assert.equal(result.denominators.cases, 24);
  assert.equal(result.baseline.notRun, 24); assert.equal(result.candidate.notRun, 24);
  assert.equal(result.baseline.wrongAnswers, 0); assert.equal(result.candidate.wrongAnswers, 0);
  assert.equal(result.gateChecks.completedRun, false);
  assert.equal(result.candidate.supportedAnswers, 0);
});

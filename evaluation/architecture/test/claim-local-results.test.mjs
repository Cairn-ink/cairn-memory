import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { createQualificationCandidateSnapshot, compileQualificationCandidates, qualifyCandidateItems } from '../../../core/qualification-candidates.mjs';
import { standardInlineQualificationPrompt } from '../../../core/qualification-candidates-prompt.mjs';
import { prepareClaimLocalCommitment, compileClaimLocalCommitment, refineClaimLocalCommitment } from '../claim-local-commitment.mjs';

const read = name => readFileSync(new URL('../../../' + name, import.meta.url), 'utf8');
const result = JSON.parse(read('evaluation/architecture/results/claim-local-commitment-v1.json'));
const fixtures = JSON.parse(read('evaluation/architecture/fixtures/claim-local-commitment-v1.json'));
const rubric = JSON.parse(read('evaluation/architecture/fixtures/claim-local-commitment-rubric-v1.json'));
const hash = value => createHash('sha256').update(value).digest('hex');
const documentHash = value => hash(JSON.stringify(value, null, 2) + '\n');
const keys = (value, expected) => assert.deepEqual(Object.keys(value).sort(), [...expected].sort());
const same = (left, right) => assert.deepEqual(left, right);
const coreFields = ['targetMatch', 'commitmentSupported', 'expectedCommitmentForTuple', 'unsupportedUpgrade', 'lostDecision'];
const arms = ['baseline', 'candidate'];
const snapshotFor = fixture => createQualificationCandidateSnapshot([{ content: fixture.content, kind: fixture.kind,
  confidence: 0.8, receipts: [{ client: 'synthetic-claim-local-acceptance', sessionId: 'claim-local-v1', eventId: fixture.id,
    role: fixture.source.role, excerpt: fixture.source.text }] }]);

function replay(data) {
  assert.equal(data.cases.length, 24);
  same(data.cases.map(row => row.id), fixtures.cases.map(row => row.id));
  assert.equal(new Set(data.cases.map(row => row.id)).size, 24);
  for (const [index, row] of data.cases.entries()) {
    const snapshot = snapshotFor(fixtures.cases[index]);
    const original = structuredClone(row.baseline.originalOutput);
    same(row.baseline.input, snapshot.input);
    const baseline = compileQualificationCandidates(original, snapshot);
    same(baseline[0].qualification, row.baseline.compiledQualification);
    const prepared = prepareClaimLocalCommitment(snapshot, original);
    same(prepared.request, { system: data.systems.candidate, input: row.candidate.input, maxOutputTokens: 1024 });
    const compiled = compileClaimLocalCommitment(prepared, row.candidate.refinementOutput);
    same(compiled.candidateOutput, row.candidate.candidateOutput);
    same(compiled.compiledItems[0].qualification, row.candidate.compiledQualification);
    same(compiled.originalOutput, row.baseline.originalOutput);
    same(original, row.baseline.originalOutput);
    for (const field of ['subject', 'property', 'scope', 'applies', 'value', 'attribution']) {
      same(row.baseline.originalOutput.qualifications[0][field], row.candidate.candidateOutput.qualifications[0][field]);
    }
    assert.equal(row.status, 'succeeded');
    for (const arm of arms) { assert.equal(row[arm].status, 'succeeded'); assert.equal(row[arm].reason, null); }
  }
}

function gradeRows(data) {
  const ratings = new Map(data.judging.a.ratings.map(row => [row.reviewId, row]));
  const other = new Map(data.judging.b.ratings.map(row => [row.reviewId, row]));
  const mapping = data.judging.mapping;
  assert.equal(mapping.length, 48);
  assert.equal(new Set(mapping.map(row => row.reviewId)).size, 48);
  assert.equal(ratings.size, 48); assert.equal(other.size, 48);
  const records = data.cases.map(row => ({ id: row.id, group: rubric.cases.find(item => item.id === row.id).group,
    ...Object.fromEntries(arms.map(arm => {
      const matches = mapping.filter(item => item.id === row.id && item.arm === arm);
      assert.equal(matches.length, 1);
      const reviewId = matches[0].reviewId, rating = ratings.get(reviewId), second = other.get(reviewId);
      assert.ok(rating && second);
      for (const field of coreFields) same(rating[field], second[field]);
      return [arm, { reviewId, completed: row[arm].status === 'succeeded',
        targetMatch: rating.targetMatch, commitmentSupported: rating.commitmentSupported,
        expectedCommitmentForTuple: rating.expectedCommitmentForTuple, unsupportedUpgrade: rating.unsupportedUpgrade,
        lostDecision: rating.lostDecision, hasOtherIssues: rating.otherIssues.length > 0,
        strictSuccess: row[arm].status === 'succeeded' && rating.targetMatch === true && rating.commitmentSupported === true,
        actualCommitment: row[arm].compiledQualification.commitment }];
    })),
  }));
  return records;
}

function score(rows) {
  const counts = arm => ({ completed: rows.filter(row => row[arm].completed).length,
    strictSuccess: rows.filter(row => row[arm].strictSuccess).length,
    targetMatch: rows.filter(row => row[arm].targetMatch).length,
    commitmentSupported: rows.filter(row => row[arm].commitmentSupported).length,
    unsupportedUpgrade: rows.filter(row => row[arm].unsupportedUpgrade).length,
    lostDecision: rows.filter(row => row[arm].lostDecision).length,
    otherIssues: rows.filter(row => row[arm].hasOtherIssues).length,
    strictWithoutOtherFlaggedIssues: rows.filter(row => row[arm].strictSuccess && !row[arm].hasOtherIssues).length });
  const gains = rows.filter(row => !row.baseline.strictSuccess && row.candidate.strictSuccess).map(row => row.id);
  const regressions = rows.filter(row => row.baseline.strictSuccess && !row.candidate.strictSuccess).map(row => row.id);
  return { denominator: rows.length, baseline: counts('baseline'), candidate: counts('candidate'),
    gains, regressions, netGain: gains.length - regressions.length };
}

function reconstructPacket(data) {
  return { version: data.judging.packetVersion, instructions: data.judging.instructions,
    items: data.judging.mapping.map(mapping => {
      const fixture = fixtures.cases.find(row => row.id === mapping.id);
      const { id, group, ...criterion } = rubric.cases.find(row => row.id === mapping.id);
      const output = data.cases.find(row => row.id === mapping.id)[mapping.arm];
      return { reviewId: mapping.reviewId, source: fixture.source, card: fixture.content, criterion,
        completed: output.status === 'succeeded', qualification: output.compiledQualification };
    }).sort((a, b) => a.reviewId.localeCompare(b.reviewId)) };
}

// The first rater retained one compact JSON object per row; preserve its exact
// original bytes rather than pretending pretty-printing has the same file hash.
const raterAText = value => '{\n  "packetSha256": ' + JSON.stringify(value.packetSha256)
  + ',\n  "reviewer": ' + JSON.stringify(value.reviewer) + ',\n  "ratings": [\n'
  + value.ratings.map(row => '    ' + JSON.stringify(row)).join(',\n') + '\n  ]\n}\n';

function assessment(data) {
  const rows = gradeRows(data), aggregate = score(rows);
  same(aggregate, data.assessment.aggregate);
  const groups = Object.fromEntries([...new Set(rubric.cases.map(row => row.group))]
    .map(group => [group, score(rows.filter(row => row.group === group))]));
  same(groups, data.assessment.groups);
  const sensitivity = { note: data.assessment.negativePolaritySensitivity.note,
    ...score(rows.filter(row => row.id !== 'cc-7db0')) };
  same(sensitivity, data.assessment.negativePolaritySensitivity);
  const newSevereErrors = rows.filter(row => (row.candidate.unsupportedUpgrade && !row.baseline.unsupportedUpgrade)
    || (row.candidate.lostDecision && !row.baseline.lostDecision)
    || (row.baseline.targetMatch === true && row.candidate.targetMatch !== true));
  const passed = aggregate.netGain >= 3 && aggregate.candidate.lostDecision === 0 && newSevereErrors.length === 0;
  assert.equal(passed, data.assessment.mechanismGatePassed);
  same(data.assessment.adjudicationOverrides, []);
  same(data.assessment.agreement, { rows: 48, fieldsPerRow: 5, agreeingFields: 240, disagreeingFields: 0 });
  const consensus = { version: 'claim-local-consensus-v1', packetSha256: data.provenance.artifacts.judgePacket,
    rawJudgeHashes: { a: data.provenance.artifacts.judgeA, b: data.provenance.artifacts.judgeB },
    decisionFieldDisagreements: 0, primarySourceAudit: data.assessment.primarySourceAudit,
    aggregate, groups, negativePolaritySensitivity: sensitivity, mechanismGatePassed: passed,
    gateMeaning: data.assessment.gateMeaning, rows };
  assert.equal(documentHash(consensus), data.provenance.artifacts.consensus);
  return rows;
}

function resources(data) {
  const r = data.resources;
  const sum = arm => data.cases.reduce((total, row) => total + row[arm].durationMs, 0);
  assert.equal(r.baseline.instrumentedStageSumMs, sum('baseline'));
  assert.equal(r.extraRefinement.instrumentedStageSumMs, sum('candidate'));
  assert.equal(r.instrumentedCaseSumMs, data.cases.reduce((total, row) => total + row.durationMs, 0));
  assert.equal(r.instrumentedRunMs, 301801.173353);
  for (const phase of [r.baseline, r.extraRefinement]) {
    assert.equal(phase.generationCalls, 24); assert.equal(phase.physicalRequests, 48); assert.equal(phase.usageUnknownRequests, 24);
  }
  assert.equal(r.fullCandidate.inputTokens, r.baseline.inputTokens + r.extraRefinement.inputTokens);
  assert.equal(r.fullCandidate.outputTokens, r.baseline.outputTokens + r.extraRefinement.outputTokens);
  assert.equal(r.fullCandidate.knownUsageMicroUsd, r.baseline.knownUsageMicroUsd + r.extraRefinement.knownUsageMicroUsd);
  assert.equal(r.fullCandidate.physicalRequests, r.baseline.physicalRequests + r.extraRefinement.physicalRequests);
  assert.equal(r.fullCandidate.generationCalls, 48);
  assert.equal(r.fullCandidate.usageUnknownRequests, 48);
  same([r.baseline.inputTokens, r.baseline.outputTokens, r.extraRefinement.inputTokens, r.extraRefinement.outputTokens], [42060, 3162, 13004, 654]);
  same([r.baseline.knownUsageMicroUsd, r.extraRefinement.knownUsageMicroUsd, r.fullCandidate.knownUsageMicroUsd], [21892, 6258, 28150]);
  assert.equal(r.reservedMicroUsd, r.fullCandidate.physicalRequests * data.protocol.limits.reservationMicroUsd);
  assert.equal(r.reservedMicroUsd, 480000);
  assert.equal(r.campaign.cumulativeReservedMicroUsd, 336882281);
  assert.equal(r.campaign.remainingMicroUsd, r.campaign.limitMicroUsd - r.campaign.cumulativeReservedMicroUsd);
  assert.equal(r.campaign.spendableMicroUsd, r.campaign.remainingMicroUsd - r.campaign.protectedMicroUsd);
  same([r.campaign.limitMicroUsd, r.campaign.protectedMicroUsd, r.campaign.spendableMicroUsd], [400000000, 30000000, 33117719]);
}

function privacy(data) {
  keys(data, ['schemaVersion', 'reportedDate', 'model', 'scope', 'provenance', 'protocol', 'systems', 'cases', 'judging', 'assessment', 'resources', 'coldAudit']);
  keys(data.provenance, ['runtimeCommit', 'frozenFiles', 'artifacts', 'caseProjectionSha256', 'preRunInterpretation']);
  keys(data.provenance.frozenFiles, ['helper', 'fixture', 'rubric', 'operator', 'operatorTests', 'launcher']);
  keys(data.provenance.artifacts, ['manifest', 'report', 'primaryAudit', 'judgeA', 'judgeB', 'judgeMapping', 'judgePacket', 'consensus', 'preRunInterpretation']);
  keys(data.systems, ['baseline', 'candidate']);
  keys(data.judging, ['packetVersion', 'instructions', 'mapping', 'a', 'b']);
  data.judging.mapping.forEach(row => keys(row, ['reviewId', 'id', 'arm']));
  for (const arm of ['a', 'b']) {
    keys(data.judging[arm], ['packetSha256', 'reviewer', 'ratings']);
    data.judging[arm].ratings.forEach(row => keys(row, ['reviewId', ...coreFields, 'otherIssues', 'reason']));
  }
  for (const row of data.cases) {
    keys(row, ['id', 'status', 'reason', 'durationMs', 'baseline', 'candidate']);
    keys(row.baseline, ['status', 'reason', 'input', 'originalOutput', 'compiledQualification', 'durationMs']);
    keys(row.candidate, ['status', 'reason', 'input', 'refinementOutput', 'candidateOutput', 'compiledQualification', 'durationMs']);
  }
  assert.ok(!/\/tmp\/|\/home\/|"(?:runId|historySha256|attemptId|Authorization|apiKey|headers|directory)"/.test(JSON.stringify(data)));
}

test('claim-local public evidence binds immutable sources, helper, original judgments and frozen packet', () => {
  privacy(result);
  assert.equal(result.schemaVersion, 'claim-local-commitment-results-v1');
  assert.equal(result.model, 'gpt-4.1-mini-2025-04-14');
  assert.equal(result.provenance.runtimeCommit, '065fd11325c4ae7fa0126b24fa4bc0ae7200dc31');
  for (const [key, path] of Object.entries({ helper: 'evaluation/architecture/claim-local-commitment.mjs',
    fixture: 'evaluation/architecture/fixtures/claim-local-commitment-v1.json', rubric: 'evaluation/architecture/fixtures/claim-local-commitment-rubric-v1.json' })) {
    assert.equal(hash(read(path)), result.provenance.frozenFiles[key]);
  }
  assert.equal(result.provenance.frozenFiles.fixture, 'fc36e37f12b298a55ef2810e6e669ca01a727d411949be59ecca4919d2afa5a2');
  assert.equal(result.provenance.frozenFiles.rubric, '3be9fa39ea44de06ce617afc71b9cc3155e8752e629463f7baa1232d18d01814');
  assert.equal(hash(JSON.stringify(result.cases)), result.provenance.caseProjectionSha256);
  assert.equal(hash(result.provenance.preRunInterpretation), result.provenance.artifacts.preRunInterpretation);
  assert.equal(hash(raterAText(result.judging.a)), result.provenance.artifacts.judgeA);
  assert.equal(documentHash(result.judging.b), result.provenance.artifacts.judgeB);
  assert.equal(documentHash(result.judging.mapping), result.provenance.artifacts.judgeMapping);
  assert.equal(documentHash(reconstructPacket(result)), result.provenance.artifacts.judgePacket);
  assert.equal(result.judging.a.packetSha256, result.provenance.artifacts.judgePacket);
  assert.equal(result.judging.b.packetSha256, result.provenance.artifacts.judgePacket);
  assert.equal(result.systems.baseline, standardInlineQualificationPrompt);
});

test('all 24 actual raw baseline/refinement outputs replay through real preparation and source compiler unchanged', () => replay(result));

test('all actual outputs also traverse existing bounded call seams offline, without provider calls', async () => {
  for (const [index, row] of result.cases.entries()) {
    const snapshot = snapshotFor(fixtures.cases[index]); let baselineCalls = 0, extraCalls = 0;
    const baseline = await qualifyCandidateItems({ contextWindow: 8192, countTokens: () => 1,
      qualifyCandidates(request) { baselineCalls++; same(request.input, row.baseline.input); return structuredClone(row.baseline.originalOutput); },
    }, snapshot.items);
    const candidate = await refineClaimLocalCommitment({ contextWindow: 8192, countTokens: () => 1,
      refineCommitment(request) { extraCalls++; same(request.input, row.candidate.input); return structuredClone(row.candidate.refinementOutput); },
    }, snapshot, row.baseline.originalOutput);
    assert.equal(baselineCalls, 1); assert.equal(extraCalls, 1);
    same(baseline[0].qualification, row.baseline.compiledQualification);
    same(candidate.compiledItems[0].qualification, row.candidate.compiledQualification);
  }
});

test('paired grades recompute strict scope, all failures, subgroup counts and polarity sensitivity', () => {
  const rows = assessment(result), observation = rows.filter(row => row.group.endsWith('observation'));
  same([result.assessment.aggregate.baseline.strictSuccess, result.assessment.aggregate.candidate.strictSuccess], [12, 18]);
  same(result.assessment.aggregate.regressions, []); assert.equal(result.assessment.aggregate.netGain, 6);
  same(arms.map(arm => observation.filter(row => row[arm].actualCommitment === 'adopted').length), [10, 5]);
  assert.equal(observation.length, 12);
  same(rows.filter(row => !row.candidate.strictSuccess).map(row => row.id), ['cc-19be', 'cc-f802', 'cc-6d31', 'cc-2f75', 'cc-d106', 'cc-0b69']);
  same(arms.map(arm => rows.filter(row => row[arm].strictSuccess && row[arm].hasOtherIssues).length), [2, 2]);
  assert.equal(result.assessment.negativePolaritySensitivity.denominator, 23);
  assert.equal(result.assessment.negativePolaritySensitivity.netGain, 5);
  assert.equal(result.assessment.aggregate.denominator, 24);
});

test('resource totals include baseline plus extra call and preserve unknown count costs and protected budget', () => {
  resources(result);
  same(result.coldAudit, { status: 'passed', actualCompiledItems: 48, coldRoundTrips: 48, unexpectedScratchResidues: 0 });
});

test('corrupted outputs, grades, pairing, aggregates and resource claims fail integrity checks', () => {
  const mutations = [
    [replay, data => { data.cases[0].candidate.candidateOutput.qualifications[0].subject.value = 'changed'; }],
    [replay, data => { data.cases[0].candidate.refinementOutput.commitments[0].commitment.value = 'adopted'; }],
    [replay, data => { data.cases[0].baseline.compiledQualification.anchors[0].text = 'changed'; }],
    [replay, data => { data.cases.pop(); }],
    [assessment, data => { data.judging.a.ratings[0].targetMatch = !data.judging.a.ratings[0].targetMatch; }],
    [assessment, data => { data.judging.mapping[0].arm = 'candidate'; }],
    [assessment, data => { data.cases[0].candidate.status = 'failed'; }],
    [assessment, data => {
      const reviewId = data.judging.mapping.find(row => row.id === 'cc-a452' && row.arm === 'candidate').reviewId;
      for (const rater of ['a', 'b']) data.judging[rater].ratings.find(row => row.reviewId === reviewId).targetMatch = false;
    }],
    [assessment, data => { data.assessment.aggregate.netGain++; }],
    [assessment, data => { data.assessment.negativePolaritySensitivity.denominator = 24; }],
    [resources, data => { data.resources.fullCandidate.knownUsageMicroUsd = data.resources.extraRefinement.knownUsageMicroUsd; }],
    [resources, data => { data.resources.campaign.spendableMicroUsd++; }],
    [privacy, data => { data.cases[0].baseline.headers = 'PRIVATE_SENTINEL'; }],
    [privacy, data => { data.provenance.directory = 'PRIVATE_SENTINEL'; }],
  ];
  for (const [check, mutate] of mutations) { const copy = structuredClone(result); mutate(copy); assert.throws(() => check(copy)); }
});

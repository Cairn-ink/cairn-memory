import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { isDeepStrictEqual } from 'node:util';
import test from 'node:test';

const read = path => readFileSync(new URL(`../../../${path}`, import.meta.url));
const resultBytes = read('evaluation/architecture/results/claim-local-extracted-v1.json');
const result = JSON.parse(resultBytes);
const fixtureBytes = read('evaluation/architecture/fixtures/claim-local-extracted-v1.json');
const rubricBytes = read('evaluation/architecture/fixtures/claim-local-extracted-rubric-v1.json');
const fixture = JSON.parse(fixtureBytes), rubric = JSON.parse(rubricBytes);
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const documentHash = value => hash(`${JSON.stringify(value, null, 2)}\n`);
// Exact first mechanical projection of the retained, adjudicated evidence.
const RESULT_SHA256 = 'b5845b92b6ef11d119d070f3069881c858c7ef0f76aeea74e9d3a3d9f95fe132';
const arms = ['baseline', 'candidate'];
const phases = ['extraction', ...arms];
const boolFields = ['targetMatch', 'commitmentSupported', 'actualDecision', 'falseAdoption', 'misassignedDecision', 'erasedQualification', 'unsupportedAuthority'];
const severeFields = ['falseAdoption', 'misassignedDecision', 'erasedQualification', 'unsupportedAuthority'];
const phaseFields = ['physicalRequests', 'generationCalls', 'inputTokens', 'outputTokens', 'knownUsageMicroUsd', 'usageUnknownRequests', 'httpDurationMs', 'stageDurationMs'];
const same = (left, right) => assert.deepEqual(left, right);
const keys = (value, expected) => { assert.ok(value && typeof value === 'object' && !Array.isArray(value)); same(Object.keys(value).sort(), [...expected].sort()); };
const text = value => { assert.equal(typeof value, 'string'); assert.ok(value.trim().length > 0); };
const tri = value => assert.ok(value === true || value === false || value === null);
const [major, minor] = process.versions.node.split('.').map(Number);
const coreSupported = major > 22 || major === 22 && minor >= 16;

function schema(data) {
  keys(data, ['schemaVersion', 'reportedDate', 'model', 'scope', 'provenance', 'protocol', 'execution', 'systems', 'cases', 'judging', 'assessment', 'resources', 'coldAudit']);
  assert.equal(data.schemaVersion, 'claim-local-extracted-results-v1'); assert.equal(data.model, 'gpt-4.1-mini-2025-04-14');
  keys(data.provenance, ['runtimeCommit', 'fixedBase', 'frozenFiles', 'artifacts', 'supportFiles', 'caseProjectionSha256', 'representation']);
  assert.equal(data.provenance.runtimeCommit, 'e0759d26b387bee48b2272ec1a981415a968462b');
  assert.equal(data.provenance.fixedBase, 'ad274b6117f86446fbf0ff16f503ae69d0278ce5');
  keys(data.provenance.frozenFiles, ['operator', 'operatorTests', 'launcher', 'helper', 'fixture', 'rubric', 'fixtureTests', 'judgingContract', 'judgingBuilder', 'primaryAudit']);
  keys(data.provenance.artifacts, ['manifest', 'report', 'primaryAudit', 'judgingContract', 'judgeA', 'judgeB', 'primaryAdjudication', 'judgePacket', 'judgeMapping', 'consensus', 'httpRecords']);
  keys(data.provenance.supportFiles, ['scoring', 'projection']);
  for (const group of ['frozenFiles', 'artifacts', 'supportFiles']) Object.values(data.provenance[group]).forEach(value => assert.match(value, /^[a-f0-9]{64}$/));
  assert.equal(hash(fixtureBytes), data.provenance.frozenFiles.fixture);
  assert.equal(hash(rubricBytes), data.provenance.frozenFiles.rubric);
  assert.equal(hash(read('evaluation/architecture/claim-local-commitment.mjs')), data.provenance.frozenFiles.helper);
  assert.equal(hash(read('evaluation/architecture/test/claim-local-extracted-fixtures.test.mjs')), data.provenance.frozenFiles.fixtureTests);
  assert.equal(hash(JSON.stringify(data.cases)), data.provenance.caseProjectionSha256);
  keys(data.protocol, ['version', 'frozenAt', 'cohort', 'limits', 'policy', 'capture']);
  assert.equal(data.protocol.cohort.fixtureSha256, hash(fixtureBytes));
  same(data.protocol.cohort.caseIds, fixture.cases.map(row => row.id));
  same(data.protocol.capture, { namespace: { ownerId: 'synthetic-extracted-acceptance', scope: 'personal', projectId: null },
    client: 'synthetic-extracted-acceptance', sessionId: 'claim-local-extracted-v1', captureQualification: 'source-bound-v2', messageIdPrefix: 'source-' });
  keys(data.execution, ['status', 'fatal', 'physicalRequests', 'durationMs']);
  keys(data.judging, ['packetVersion', 'contract', 'mapping', 'a', 'b', 'primaryAdjudication', 'interpretation']);
  keys(data.assessment, ['version', 'packetSha256', 'rawJudgeHashes', 'originalDifferingEntries', 'primaryAgreementCorrections', 'adjudicationSha256', 'aggregate', 'groups', 'runCompleted', 'unresolvedSources', 'mechanismGatePassed', 'gateMeaning', 'rows']);
  keys(data.coldAudit, ['status', 'requests', 'fixedSourceDenominator', 'completedArms', 'actualCompiledItems', 'coldRoundTrips', 'unexpectedScratchResidues']);
  assert.equal(data.cases.length, 24); same(data.cases.map(row => row.id), fixture.cases.map(row => row.id));
  assert.equal(new Set(data.cases.map(row => row.id)).size, 24);
  for (const [index, row] of data.cases.entries()) {
    keys(row, ['id', 'sourceMessages', 'status', 'reason', 'failureStage', 'durationMs', ...phases]);
    same(row.sourceMessages, fixture.cases[index].messages);
    keys(row.extraction, ['status', 'reason', 'request', 'originalOutput', 'items', 'retainedSourceWindow', 'durationMs']);
    keys(row.baseline, ['status', 'reason', 'request', 'originalOutput', 'compiledItems', 'coldAudit', 'durationMs']);
    keys(row.candidate, ['status', 'reason', 'request', 'refinementOutput', 'candidateOutput', 'compiledItems', 'coldAudit', 'durationMs']);
    for (const phase of phases) {
      const request = row[phase].request;
      if (request === null) continue;
      keys(request, ['systemRef', 'input', 'maxOutputTokens']); assert.equal(request.systemRef, phase);
      assert.equal(request.maxOutputTokens, 1024); text(data.systems[request.systemRef]);
      if (phase === 'extraction') {
        keys(request.input, ['messages']);
        request.input.messages.forEach(message => keys(message, ['index', 'role', 'content']));
      } else {
        keys(request.input, ['items']);
        for (const item of request.input.items) {
          keys(item, phase === 'baseline' ? ['itemIndex', 'content', 'kind', 'candidates'] : ['itemIndex', 'selectedClaim', 'candidates']);
          if (phase === 'candidate') keys(item.selectedClaim, ['subject', 'property', 'scope', 'applies', 'value']);
          item.candidates.forEach(candidate => keys(candidate, ['candidateIndex', 'role', 'text']));
        }
      }
    }
    if (row.extraction.status === 'succeeded') {
      assert.ok(row.extraction.items.length >= 0 && row.extraction.items.length <= 5);
      if (!row.extraction.items.length) for (const arm of arms) assert.notEqual(row[arm].status, 'succeeded');
    }
    for (const arm of arms) {
      const detail = row[arm];
      if (detail.compiledItems) {
        assert.equal(detail.compiledItems.length, row.extraction.items.length);
        const entries = arm === 'baseline' ? detail.originalOutput.qualifications : detail.candidateOutput.qualifications;
        same(entries.map(entry => entry.itemIndex).sort((a, b) => a - b), row.extraction.items.map((_, i) => i));
      }
      if (detail.coldAudit) {
        assert.ok(Object.keys(detail.coldAudit).every(key => ['status', 'phase', 'reason', 'cleanupCompleted', 'durationMs', 'inputItems', 'uniqueMemories', 'deduplicatedInputs'].includes(key)));
        if (detail.status === 'succeeded') {
          assert.equal(detail.coldAudit.status, 'succeeded'); assert.equal(detail.coldAudit.cleanupCompleted, true);
          assert.equal(detail.coldAudit.inputItems, detail.compiledItems.length);
          assert.equal(detail.coldAudit.inputItems, detail.coldAudit.uniqueMemories + detail.coldAudit.deduplicatedInputs);
        }
      } else assert.notEqual(detail.status, 'succeeded');
    }
    if (row.candidate.candidateOutput) {
      const restored = structuredClone(row.candidate.candidateOutput);
      for (const entry of restored.qualifications) entry.commitment = row.baseline.originalOutput.qualifications.find(original => original.itemIndex === entry.itemIndex).commitment;
      same(restored, row.baseline.originalOutput);
    }
  }
}

function privacy(data) {
  const forbidden = new Set(['apiKey', 'Authorization', 'headers', 'runId', 'historySha256', 'attemptId', 'directory']);
  function visit(value) {
    if (typeof value === 'string') assert.ok(!/\/tmp\/|\/home\/|Bearer\s|sk-[A-Za-z0-9]{12,}/.test(value));
    if (value && typeof value === 'object') for (const [key, child] of Object.entries(value)) { assert.ok(!forbidden.has(key)); visit(child); }
  }
  visit(data);
}

function reconstructPacket(data) {
  const { contract, mapping } = data.judging;
  assert.equal(mapping.length, 48); assert.equal(new Set(mapping.map(row => row.reviewId)).size, 48);
  assert.equal(new Set(mapping.map(row => `${row.id}/${row.arm}`)).size, 48);
  return { version: data.judging.packetVersion, contract, items: mapping.map(map => {
    keys(map, ['reviewId', 'id', 'arm']); assert.ok(arms.includes(map.arm));
    const row = data.cases.find(item => item.id === map.id), criterion = rubric.cases.find(item => item.id === map.id);
    assert.ok(row && criterion); const detail = row[map.arm];
    return { reviewId: map.reviewId, sourceMessages: row.sourceMessages, requiredClaims: criterion.requiredClaims,
      completed: detail.status === 'succeeded', coldVerified: detail.coldAudit?.status === 'succeeded' && detail.coldAudit?.cleanupCompleted === true,
      cards: (detail.compiledItems ?? row.extraction.items ?? []).map((item, itemIndex) => ({ itemIndex, content: item.content, kind: item.kind, confidence: item.confidence,
        receipts: item.receipts.map(receipt => ({ role: receipt.role, excerpt: receipt.excerpt, sourceIndex: Number(receipt.eventId.slice('source-'.length)) })), qualification: item.qualification ?? null })) };
  }).sort((a, b) => a.reviewId.localeCompare(b.reviewId)) };
}

function validateRating(rating, entry) {
  keys(rating, ['reviewId', 'claims', 'items']); assert.equal(rating.reviewId, entry.reviewId);
  same(rating.claims.map(claim => claim.key), entry.requiredClaims.map(claim => claim.key));
  for (const claim of rating.claims) {
    keys(claim, ['key', 'coverage', 'itemIndices', 'reason']); tri(claim.coverage); text(claim.reason);
    assert.equal(new Set(claim.itemIndices).size, claim.itemIndices.length);
    claim.itemIndices.forEach(index => assert.ok(entry.cards.some(card => card.itemIndex === index)));
    if (claim.coverage === true) assert.ok(claim.itemIndices.length > 0);
  }
  same(rating.items.map(item => item.itemIndex), entry.cards.map(card => card.itemIndex));
  for (const item of rating.items) {
    keys(item, ['itemIndex', ...boolFields, 'expectedCommitments', 'issues', 'reason']);
    boolFields.forEach(field => tri(item[field])); text(item.reason);
    assert.equal(new Set(item.expectedCommitments).size, item.expectedCommitments.length);
    item.expectedCommitments.forEach(value => assert.ok(['unknown', 'adopted', 'considered', 'rejected'].includes(value)));
    for (const issue of item.issues) {
      keys(issue, ['kind', 'material', 'reason']); assert.equal(typeof issue.material, 'boolean'); text(issue.reason);
      assert.ok(['attribution', 'scope', 'uncertainty', 'negation', 'authority', 'content', 'kind', 'citation'].includes(issue.kind));
    }
  }
}
const normalizeRating = rating => ({
  claims: rating.claims.map(claim => ({ key: claim.key, coverage: claim.coverage, itemIndices: [...claim.itemIndices].sort((a, b) => a - b) })),
  items: rating.items.map(item => ({ itemIndex: item.itemIndex, ...Object.fromEntries(boolFields.map(field => [field, item[field]])),
    expectedCommitments: [...item.expectedCommitments].sort(), issues: [...new Set(item.issues.map(issue => `${issue.kind}/${issue.material}`))].sort() })),
});

function deriveAssessment(data) {
  const packet = reconstructPacket(data), { a, b, primaryAdjudication: audit } = data.judging;
  assert.equal(documentHash(packet), data.provenance.artifacts.judgePacket);
  assert.equal(documentHash(data.judging.mapping), data.provenance.artifacts.judgeMapping);
  // The original contract used compact inline objects; its original byte hash
  // differs from this canonical embedded JSON. The exact packet binds content.
  assert.equal(data.provenance.frozenFiles.judgingContract, 'ed25be2854763f97f81bb802b48d2d78288ad0debab191b1b4b8cd8008c5078a');
  assert.equal(data.provenance.artifacts.judgingContract, data.provenance.frozenFiles.judgingContract);
  assert.equal(documentHash(packet.contract), '5dcc5473c8c90633d3acaf45056e87022566bbbe3326bf7b1f8ef3032b5560dd');
  for (const [name, rater] of [['judgeA', a], ['judgeB', b]]) {
    keys(rater, ['version', 'rater', 'packetSha256', 'judgments']);
    assert.equal(rater.version, 'claim-local-extracted-ratings-v1'); text(rater.rater);
    assert.equal(rater.packetSha256, documentHash(packet)); assert.equal(documentHash(rater), data.provenance.artifacts[name]);
    same(rater.judgments.map(row => row.reviewId), packet.items.map(row => row.reviewId));
    rater.judgments.forEach((rating, index) => validateRating(rating, packet.items[index]));
  }
  const differing = packet.items.filter((_, index) => !isDeepStrictEqual(normalizeRating(a.judgments[index]), normalizeRating(b.judgments[index]))).map(entry => entry.reviewId);
  keys(audit, ['packetSha256', 'primaryAudit', 'resolutions', 'agreementCorrections']);
  assert.equal(audit.packetSha256, documentHash(packet)); text(audit.primaryAudit);
  assert.equal(new Set(audit.resolutions.map(row => row.reviewId)).size, audit.resolutions.length);
  same(audit.resolutions.map(row => row.reviewId).sort(), [...differing].sort());
  assert.equal(new Set(audit.agreementCorrections.map(row => row.reviewId)).size, audit.agreementCorrections.length);
  for (const resolution of [...audit.resolutions, ...audit.agreementCorrections]) {
    keys(resolution, ['reviewId', 'reason', 'judgment']); text(resolution.reason);
    const entry = packet.items.find(item => item.reviewId === resolution.reviewId); assert.ok(entry);
    validateRating(resolution.judgment, entry);
  }
  for (const correction of audit.agreementCorrections) {
    assert.ok(!differing.includes(correction.reviewId), 'an agreement correction must reference an originally agreed entry');
    const original = a.judgments.find(rating => rating.reviewId === correction.reviewId); assert.ok(original);
    assert.ok(!isDeepStrictEqual(normalizeRating(original), normalizeRating(correction.judgment)), 'an agreement correction must change a normalized judgment');
  }
  assert.equal(documentHash(audit), data.provenance.artifacts.primaryAdjudication);
  const overrides = new Map([...audit.resolutions, ...audit.agreementCorrections].map(resolution => [resolution.reviewId, resolution.judgment]));
  const rows = rubric.cases.map(criterion => {
    const row = { id: criterion.id, group: criterion.group };
    for (const arm of arms) {
      const mapping = data.judging.mapping.find(map => map.id === row.id && map.arm === arm); assert.ok(mapping);
      const entry = packet.items.find(item => item.reviewId === mapping.reviewId);
      const rating = overrides.get(mapping.reviewId) ?? a.judgments.find(judgment => judgment.reviewId === mapping.reviewId);
      const coverage = rating.claims.every(claim => claim.coverage === true);
      const allItems = rating.items.length > 0 && rating.items.every(item => item.targetMatch === true && item.commitmentSupported === true && !item.issues.some(issue => issue.material));
      const unknowns = rating.claims.filter(claim => claim.coverage === null).length + rating.items.reduce((sum, item) => sum + boolFields.filter(field => item[field] === null).length, 0);
      row[arm] = { reviewId: mapping.reviewId, completed: entry.completed, coldVerified: entry.coldVerified, coverage, unknowns,
        strictSuccess: entry.completed && entry.coldVerified && coverage && allItems, claims: rating.claims, items: rating.items };
    }
    row.lostActualDecisions = row.baseline.items.filter(before => before.actualDecision === true && before.targetMatch === true && before.commitmentSupported === true
      && !row.candidate.items.some(after => after.itemIndex === before.itemIndex && after.actualDecision === true && after.targetMatch === true && after.commitmentSupported === true)).map(item => item.itemIndex);
    row.newSevereErrors = row.candidate.items.flatMap(after => severeFields.filter(field => after[field] === true && row.baseline.items.find(before => before.itemIndex === after.itemIndex)?.[field] !== true)
      .map(field => ({ itemIndex: after.itemIndex, field })));
    return row;
  });
  function count(selected) {
    const aggregate = { denominator: selected.length };
    for (const arm of arms) aggregate[arm] = {
      completed: selected.filter(row => row[arm].completed).length, coldVerified: selected.filter(row => row[arm].coldVerified).length,
      coverage: selected.filter(row => row[arm].coverage).length, strictSuccess: selected.filter(row => row[arm].strictSuccess).length,
      unknownJudgments: selected.reduce((sum, row) => sum + row[arm].unknowns, 0), itemCount: selected.reduce((sum, row) => sum + row[arm].items.length, 0),
      itemTargetMatch: selected.reduce((sum, row) => sum + row[arm].items.filter(item => item.targetMatch === true).length, 0),
      itemCommitmentSupported: selected.reduce((sum, row) => sum + row[arm].items.filter(item => item.commitmentSupported === true).length, 0),
      falseAdoption: selected.reduce((sum, row) => sum + row[arm].items.filter(item => item.falseAdoption === true).length, 0),
    };
    aggregate.gains = selected.filter(row => !row.baseline.strictSuccess && row.candidate.strictSuccess).map(row => row.id);
    aggregate.regressions = selected.filter(row => row.baseline.strictSuccess && !row.candidate.strictSuccess).map(row => row.id);
    aggregate.netGain = aggregate.gains.length - aggregate.regressions.length;
    aggregate.lostActualDecisions = selected.flatMap(row => row.lostActualDecisions.map(itemIndex => ({ id: row.id, itemIndex })));
    aggregate.newSevereErrors = selected.flatMap(row => row.newSevereErrors.map(error => ({ id: row.id, ...error })));
    return aggregate;
  }
  const aggregate = count(rows);
  const unresolvedSources = data.cases.filter(row => row.extraction.status !== 'succeeded'
    || row.extraction.items.length > 0 && arms.some(arm => row[arm].status !== 'succeeded')).map(row => row.id);
  const mechanismGatePassed = aggregate.netGain >= rubric.protocol.gate.minimumNetSourceGains && aggregate.lostActualDecisions.length === 0
    && aggregate.newSevereErrors.length === 0 && arms.every(arm => aggregate[arm].unknownJudgments === 0)
    && data.execution.status === 'completed' && unresolvedSources.length === 0;
  return { version: 'claim-local-extracted-consensus-v1', packetSha256: documentHash(packet),
    rawJudgeHashes: { a: data.provenance.artifacts.judgeA, b: data.provenance.artifacts.judgeB }, originalDifferingEntries: differing.length,
    primaryAgreementCorrections: audit.agreementCorrections.length,
    adjudicationSha256: data.provenance.artifacts.primaryAdjudication, aggregate,
    groups: Object.fromEntries(Object.keys(rubric.protocol.groupCounts).map(group => [group, count(rows.filter(row => row.group === group))])),
    runCompleted: data.execution.status === 'completed', unresolvedSources, mechanismGatePassed, gateMeaning: rubric.protocol.gate.meaning, rows };
}
function assessment(data) { const derived = deriveAssessment(data); same(derived, data.assessment); assert.equal(documentHash(data.assessment), data.provenance.artifacts.consensus); }

async function replay(data) {
  const { captureSnapshot, extractedItems } = await import('../../../core/capture-input.mjs');
  const { extractionRequest } = await import('../../../core/capture.mjs');
  const { callModel } = await import('../../../core/model-call.mjs');
  const { createQualificationCandidateSnapshot, compileQualificationCandidates } = await import('../../../core/qualification-candidates.mjs');
  const { prepareClaimLocalCommitment, compileClaimLocalCommitment } = await import('../claim-local-commitment.mjs');
  for (const row of data.cases) {
    const { messageIdPrefix, captureQualification, ...captureFields } = data.protocol.capture;
    const capture = captureSnapshot({ ...captureFields, eventId: row.id,
      messages: row.sourceMessages.map((message, index) => ({ id: `${messageIdPrefix}${index}`, role: message.role, content: message.text })) }, captureQualification);
    const request = extractionRequest(capture, { captureQualification });
    if (row.extraction.request) same(row.extraction.request, { systemRef: 'extraction', input: request.input, maxOutputTokens: 1024 });
    if (row.extraction.request) assert.equal(data.systems.extraction, request.system);
    if (row.extraction.status !== 'succeeded') continue;
    let calls = 0;
    const output = await callModel({ contextWindow: 8192, countTokens: () => 1, extract(actual) {
      calls++; same(actual.input, request.input); assert.equal(actual.system, request.system); return structuredClone(row.extraction.originalOutput);
    } }, 'extract', request.system, request.input);
    assert.equal(calls, 1);
    same(extractedItems(output, capture, request.retained.messages), row.extraction.items);
    same(request.retained.retainedSourceWindow, row.extraction.retainedSourceWindow);
    if (!row.extraction.items.length) continue;
    const snapshot = createQualificationCandidateSnapshot(row.extraction.items);
    if (row.baseline.request) same(row.baseline.request.input, snapshot.input);
    if (row.baseline.compiledItems) same(compileQualificationCandidates(row.baseline.originalOutput, snapshot), row.baseline.compiledItems);
    if (row.candidate.candidateOutput) {
      const prepared = prepareClaimLocalCommitment(snapshot, row.baseline.originalOutput);
      same(prepared.request, { system: data.systems.candidate, input: row.candidate.request.input, maxOutputTokens: 1024 });
      const candidate = compileClaimLocalCommitment(prepared, row.candidate.refinementOutput);
      same(candidate.originalOutput, row.baseline.originalOutput); same(candidate.candidateOutput, row.candidate.candidateOutput); same(candidate.compiledItems, row.candidate.compiledItems);
    }
  }
}

function resources(data) {
  const value = data.resources, records = value.usageRecords;
  keys(value, ['usageRecords', 'byPhase', 'fullBaseline', 'fullCandidate', 'instrumentedRunMs', 'instrumentedCaseSumMs', 'reservedMicroUsd', 'maximumNewReservationMicroUsd', 'campaign', 'accountingMeaning']);
  for (const record of records) {
    keys(record, ['caseId', 'phase', 'requestKind', 'httpStatus', 'providerInputTokens', 'usage', 'reservedMicroUsd', 'actualMicroUsd', 'outcome', 'reason', 'durationMs']);
    assert.ok(data.cases.some(row => row.id === record.caseId)); assert.ok(phases.includes(record.phase));
    assert.ok(['count', 'generation'].includes(record.requestKind));
    assert.equal(record.reservedMicroUsd, data.protocol.limits.reservationMicroUsd);
    if (record.usage) {
      assert.equal(record.requestKind, 'generation'); assert.equal(record.usage.total_tokens, record.usage.input_tokens + record.usage.output_tokens);
      assert.equal(record.actualMicroUsd, Math.ceil((record.usage.input_tokens * 4 + record.usage.output_tokens * 16) / 10));
      assert.ok(record.usage.input_tokens <= data.protocol.limits.providerInputTokens); assert.ok(record.usage.output_tokens <= data.protocol.limits.outputTokens);
    } else assert.equal(record.actualMicroUsd, null);
    if (record.providerInputTokens !== null) assert.ok(record.providerInputTokens <= data.protocol.limits.providerInputTokens);
  }
  for (const row of data.cases) for (const phase of phases) {
    const selected = records.filter(record => record.caseId === row.id && record.phase === phase);
    assert.ok(selected.length <= 2);
    assert.ok(selected.filter(record => record.requestKind === 'generation').length <= 1);
    assert.ok(selected.filter(record => record.requestKind === 'count').length <= 1);
    if (selected.length) assert.equal(selected[0].requestKind, 'count');
    if (selected.length === 2) same(selected.map(record => record.requestKind), ['count', 'generation']);
    if (row[phase].status === 'succeeded') assert.equal(selected.length, 2);
  }
  keys(value.byPhase, phases);
  for (const phase of phases) {
    const selected = records.filter(record => record.phase === phase);
    same(value.byPhase[phase], { physicalRequests: selected.length, generationCalls: selected.filter(record => record.requestKind === 'generation').length,
      inputTokens: selected.reduce((sum, record) => sum + (record.usage?.input_tokens ?? 0), 0), outputTokens: selected.reduce((sum, record) => sum + (record.usage?.output_tokens ?? 0), 0),
      knownUsageMicroUsd: selected.reduce((sum, record) => sum + (record.actualMicroUsd ?? 0), 0), usageUnknownRequests: selected.filter(record => record.actualMicroUsd === null).length,
      httpDurationMs: selected.reduce((sum, record) => sum + record.durationMs, 0), stageDurationMs: data.cases.reduce((sum, row) => sum + row[phase].durationMs, 0) });
  }
  const sum = selected => Object.fromEntries(phaseFields.map(field => [field, selected.reduce((total, phase) => total + value.byPhase[phase][field], 0)]));
  same(value.fullBaseline, sum(['extraction', 'baseline'])); same(value.fullCandidate, sum(phases));
  assert.equal(records.length, data.execution.physicalRequests);
  assert.equal(records.length, 144); assert.ok(records.length <= data.protocol.limits.physicalRequests);
  assert.equal(value.reservedMicroUsd, records.reduce((total, record) => total + record.reservedMicroUsd, 0));
  assert.equal(value.maximumNewReservationMicroUsd, data.protocol.limits.preflightMicroUsd);
  assert.equal(value.instrumentedRunMs, data.execution.durationMs);
  assert.equal(value.instrumentedCaseSumMs, data.cases.reduce((sum, row) => sum + row.durationMs, 0));
  const c = value.campaign;
  keys(c, ['limitMicroUsd', 'protectedMicroUsd', 'priorReservedMicroUsd', 'cumulativeReservedMicroUsd', 'remainingMicroUsd', 'spendableMicroUsd']);
  assert.equal(c.limitMicroUsd, data.protocol.limits.cumulativeMicroUsd); assert.equal(c.protectedMicroUsd, data.protocol.limits.protectedMicroUsd);
  assert.equal(c.cumulativeReservedMicroUsd, c.priorReservedMicroUsd + value.reservedMicroUsd);
  assert.equal(c.remainingMicroUsd, c.limitMicroUsd - c.cumulativeReservedMicroUsd);
  assert.equal(c.spendableMicroUsd, c.remainingMicroUsd - c.protectedMicroUsd); assert.ok(c.spendableMicroUsd >= 0);
  assert.equal(data.coldAudit.requests, records.length); assert.equal(data.coldAudit.fixedSourceDenominator, 24);
  const completed = data.cases.flatMap(row => arms.map(arm => row[arm])).filter(detail => detail.status === 'succeeded');
  assert.equal(data.coldAudit.completedArms, completed.length);
  assert.equal(data.coldAudit.actualCompiledItems, completed.reduce((sum, detail) => sum + detail.compiledItems.length, 0));
  assert.equal(data.coldAudit.coldRoundTrips, completed.reduce((sum, detail) => sum + detail.coldAudit.uniqueMemories, 0));
}

test('public extraction result has approved frozen bytes, strict source boundaries and privacy', () => {
  assert.equal(typeof RESULT_SHA256, 'string', 'pin the first projected artifact before completion');
  assert.equal(hash(resultBytes), RESULT_SHA256); schema(result); privacy(result);
});
test('masked packet and both unchanged raw judgments reconstruct independent fixed-denominator scores', () => assessment(result));
test('all actual first outputs replay through extraction, trusted receipts, canonical snapshot and full compilers', { skip: !coreSupported }, async () => replay(result));
test('three-phase resource and cold summaries recompute from every retained usage record and card', () => resources(result));
test('corrupted source/card/indices, judgments, mappings, aggregates, resources and privacy fail', async () => {
  const checks = [
    [schema, copy => { copy.cases[0].sourceMessages[0].text = 'changed source'; }],
    [schema, copy => { copy.cases.pop(); }],
    [schema, copy => { copy.cases[0].extraction.request.input.expectedCommitment = 'unknown'; }],
    [schema, copy => { copy.cases[0].candidate.candidateOutput.qualifications[0].subject.value = 'changed'; }],
    [assessment, copy => { copy.judging.a.judgments[0].claims[0].coverage = !copy.judging.a.judgments[0].claims[0].coverage; }],
    [assessment, copy => { copy.judging.mapping[0].arm = copy.judging.mapping[1].arm; }],
    [assessment, copy => { copy.judging.primaryAdjudication.primaryAudit += ' changed'; }],
    [assessment, copy => { copy.judging.primaryAdjudication.resolutions.pop(); }],
    [assessment, copy => { copy.judging.primaryAdjudication.resolutions.push(structuredClone(copy.judging.primaryAdjudication.resolutions[0])); }],
    [assessment, copy => { copy.judging.primaryAdjudication.agreementCorrections.push(structuredClone(copy.judging.primaryAdjudication.agreementCorrections[0])); }],
    [assessment, copy => {
      const correction = copy.judging.primaryAdjudication.agreementCorrections[0];
      correction.reviewId = copy.judging.primaryAdjudication.resolutions[0].reviewId;
      correction.judgment.reviewId = correction.reviewId;
    }],
    [assessment, copy => {
      const correction = copy.judging.primaryAdjudication.agreementCorrections[0];
      correction.judgment = structuredClone(copy.judging.a.judgments.find(rating => rating.reviewId === correction.reviewId));
    }],
    [assessment, copy => { copy.assessment.aggregate.netGain++; }],
    [assessment, copy => { copy.execution.status = 'failed'; }],
    [resources, copy => { copy.resources.usageRecords[0].reservedMicroUsd++; }],
    [resources, copy => { copy.resources.fullBaseline.knownUsageMicroUsd++; }],
    [resources, copy => { copy.resources.byPhase.extraction.inputTokens++; }],
    [privacy, copy => { copy.cases[0].extraction.headers = 'PRIVATE_SENTINEL'; }],
    [privacy, copy => { copy.scope = '/tmp/private'; }],
  ];
  for (const [check, mutate] of checks) { const copy = structuredClone(result); mutate(copy); assert.throws(() => check(copy)); }
  if (!coreSupported) return;
  for (const mutate of [
    copy => { copy.cases[0].extraction.items[0].content += ' changed'; },
    copy => { copy.cases[0].extraction.originalOutput.items[0].sourceIndices = [2]; },
    copy => { copy.cases[0].baseline.compiledItems[0].receipts[0].excerpt = 'changed'; },
    copy => { copy.cases[0].baseline.originalOutput.qualifications[0].subject.value = 'changed'; },
    copy => { copy.cases[0].candidate.compiledItems[0].qualification.commitment = 'invalid'; },
    copy => { copy.cases[0].candidate.refinementOutput.commitments[0].itemIndex = 4; },
  ]) { const copy = structuredClone(result); mutate(copy); await assert.rejects(() => replay(copy)); }
});

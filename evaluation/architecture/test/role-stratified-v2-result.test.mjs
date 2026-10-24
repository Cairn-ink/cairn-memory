import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { createRoleStratifiedJudgingPacket, validateRoleStratifiedJudgments, scoreRoleStratifiedQa } from '../role-stratified-qa-score.mjs';

// A replay of frozen synthetic evidence, never a model, store or ledger run.
const read = path => readFileSync(new URL(path, import.meta.url), 'utf8');
const bundle = JSON.parse(read('../results/role-stratified-v2.json'));
const fixtureJson = read('../fixtures/role-stratified-qa-v2.json');
const rubricJson = read('../fixtures/role-stratified-qa-rubric-v2.json');
const sha = text => createHash('sha256').update(text, 'utf8').digest('hex');
const hashes = {
  source: '6685fc6f5154e608f6e27946a2d3702c7b02dfc2d4ba69a9aa597f30db15b75a',
  rubric: '1e1cd7a68945e45a0ae43a53fe5a53358123a32e1bce67b956c4960c8c0b6bd9',
  scorer: '46773a0cb1f012ac4bc7014499af295768b5babfd7507b65fe0c6ef2abe59760',
  projection: '184f04debc1dbaedcae18fa23a27a9496ff2186f9e342f72b3d8f025160991f0',
  originalPrivateReport: 'd775f660a4fcd53edfe45ad193df05bb5a66642eda8f0434faa57d99b0c5ea09',
  packet: '9bb7fc882528c9b53b7f98429bdd710bc451568ec8bfd4b24a1e83e8a26ba08b',
  packetRawFile: '33abe84a0f7fd2096d5f4b43842bcda94b76b0a79a851d50c318127471b4df63',
  raterOne: '0186e25e799912ec2a420b1b09d930180e3ef3ccf556a20287fe3aa45a8179b7',
  raterTwo: '062cb5929d3d34e78ded9c6a5dcdfaa35ce63fe593d343cc63ac02eae065f9fd',
  adjudication: '530e1b9ea167c234da56ea2d67e2b816ddefb04bce823c5a7c3b2354aa68f7cd',
};
const options = value => ({ fixtureJson, rubricJson, report: value.report, seed: value.frozen.maskingSeed });
function originals(value) {
  return Object.fromEntries(['raterOne', 'raterTwo', 'adjudication'].map(name => {
    assert.equal(value.originals[name].sha256, hashes[name]);
    assert.equal(sha(value.originals[name].rawJson), hashes[name], `changed original ${name}`);
    return [name, JSON.parse(value.originals[name].rawJson)];
  }));
}
function replay(value) {
  assert.equal(sha(JSON.stringify(value.report)), hashes.projection, 'changed report projection');
  const judgments = originals(value);
  const { packet, mappingKey } = createRoleStratifiedJudgingPacket(options(value));
  assert.equal(packet.packetSha256, hashes.packet);
  assert.equal(sha(`${JSON.stringify(packet, null, 2)}\n`), hashes.packetRawFile);
  for (const judgment of Object.values(judgments)) {
    const checked = validateRoleStratifiedJudgments({ packet, judgments: judgment });
    assert.equal(checked.valid, true);
    assert.equal(checked.unresolved, 0);
    assert.equal(checked.answerClaimsReviewed, 84);
    assert.equal(checked.memoriesReviewed, 206);
  }
  const result = scoreRoleStratifiedQa({ ...options(value), judgments: judgments.adjudication });
  assert.deepEqual(result, { packet, mappingKey, ...value.expectedScore });
  return { result, packet, mappingKey, judgments };
}

test('v2 binds source, rubric, unchanged scorer, original bytes and the separate report projection', () => {
  assert.equal(bundle.schemaVersion, 'role-stratified-v2-public-result-v1');
  assert.equal(bundle.frozen.runtimeCommit, '9f21697bfc1c43b7b7f23782b46771c866db47b2');
  assert.equal(bundle.frozen.model, 'gpt-4.1-mini-2025-04-14');
  assert.equal(sha(fixtureJson), hashes.source);
  assert.equal(sha(rubricJson), hashes.rubric);
  assert.equal(sha(read('../role-stratified-qa-score.mjs')), hashes.scorer);
  assert.equal(bundle.frozen.sourceSha256, hashes.source);
  assert.equal(bundle.frozen.rubricSha256, hashes.rubric);
  assert.equal(bundle.frozen.originalPrivateReportFileSha256, hashes.originalPrivateReport);
  assert.equal(bundle.frozen.reportProjectionSha256, hashes.projection);
  assert.notEqual(hashes.originalPrivateReport, hashes.projection);
  assert.equal(bundle.frozen.packetSha256, hashes.packet);
  assert.equal(bundle.frozen.packetRawFileSha256, hashes.packetRawFile);
  assert.equal(sha(bundle.frozen.maskingSeed), '165252ae04fdc3f9c35dca346202ebf461757ddfb145c408c39727ccbdb3383d');
  assert.equal(sha(JSON.stringify(bundle.report)), hashes.projection);
  originals(bundle);
  assert.deepEqual(Object.keys(bundle), ['schemaVersion', 'frozen', 'report', 'originals', 'expectedScore',
    'resourceObservations', 'reviewObservations', 'limitations']);
  const privateKeys = new Set(['ledgerState', 'httpRecords', 'authorization', 'apiKey', 'accountId',
    'directory', 'headers', 'credentials', 'configuration']);
  function checkPublic(value) {
    if (typeof value === 'string') {
      assert.doesNotMatch(value, /\/(?:tmp|home|mnt|Users)\/|https?:\/\/|Bearer |sk-proj-/u);
    } else if (value && typeof value === 'object') for (const [key, child] of Object.entries(value)) {
      assert.equal(privateKeys.has(key), false, `private field ${key}`);
      checkPublic(child);
    }
  }
  checkPublic(bundle);
});

test('v2 regenerates the packet and exactly replays the unchanged scorer over all first attempts', () => {
  const { result } = replay(bundle);
  const ids = JSON.parse(fixtureJson).cases.map(row => row.id);
  assert.equal(ids.length, 24);
  assert.equal(new Set(ids).size, 24);
  assert.deepEqual(bundle.report.rows.map(row => row.id), ids);
  assert.deepEqual(result.cases, ids.map(caseId => ({ caseId, baseline: true, candidate: true })));
  assert.equal(bundle.report.caseCount, 24);
  assert.equal(bundle.report.armCount, 48);
  assert.equal(bundle.report.completedArms, 48);
  assert.equal(bundle.report.failedArms, 0);
  assert.equal(bundle.report.notRunArms, 0);
  const answers = bundle.report.rows.flatMap(row => ['baseline', 'candidate'].map(name => row[name]));
  assert.equal(answers.length, 48);
  assert.ok(answers.every(arm => arm.status === 'completed' && arm.cleanupCompleted && arm.answer.length > 0));
  for (const name of ['baseline', 'candidate']) {
    assert.equal(result.metrics[name].supportedCorrect, 24);
    assert.equal(result.metrics[name].completed, 24);
    assert.deepEqual(result.metrics[name].unknown, { total: 4, completed: 4, supportedCorrect: 4 });
    assert.deepEqual(result.metrics[name].answerClaims, { reviewed: 42, correct: 42, supportedCorrect: 42 });
    assert.deepEqual(result.metrics[name].issues.answer, { unsupported: 0, severe: 0, stale: 0 });
    for (const cohort of ['all', 'commonCompleted']) for (const stage of ['retained', 'packed']) {
      assert.equal(result.coverage[cohort][name][stage].coveredClaims, 38);
      assert.equal(result.coverage[cohort][name][stage].totalClaims, 38);
      assert.equal(result.coverage[cohort][name][stage].coveredQuotes, 38);
      assert.equal(result.coverage[cohort][name][stage].totalQuotes, 38);
    }
  }
  assert.deepEqual(result.metrics.baseline.memories, { reviewed: 111, supported: 86, unsupported: 25, unresolved: 0 });
  assert.deepEqual(result.metrics.candidate.memories, { reviewed: 95, supported: 76, unsupported: 19, unresolved: 0 });
  assert.deepEqual(result.metrics.baseline.issues.memory, { unsupported: 31, severe: 0, stale: 0 });
  assert.deepEqual(result.metrics.candidate.issues.memory, { unsupported: 26, severe: 1, stale: 1 });
  assert.deepEqual(result.paired.newIssues.memory, { unsupported: 23, severe: 1, stale: 1 });
  for (const field of ['gains', 'regressions', 'netSupportedCorrect', 'completionLosses', 'lostSupportedDecisions',
    'assistantInformationLosses', 'assistantInformationClaimLosses']) assert.equal(result.paired[field], 0);
  assert.deepEqual(result.judgments, { unresolved: 0, answerClaimsReviewed: 84, memoriesReviewed: 206 });
  assert.equal(result.gate.netGainAtLeastThree, false);
  assert.equal(result.gate.retainedCoverageGain, false);
  assert.equal(result.gate.packedCoverageGain, false);
  assert.equal(result.gate.noNewIssues, false);
  assert.equal(result.semanticGatePassed, false);
  assert.equal(result.resourceAudit, 'not-evaluated');
  assert.equal(result.advancementEligible, false);
});

test('v2 preserves both independent ratings, disagreement counts and corrections of agreed verdicts', () => {
  const { packet, judgments } = replay(bundle);
  const differentPairs = new Set();
  let memoryDifferences = 0, claimFlagDifferences = 0, citationDifferences = 0;
  const corrections = [];
  for (const [pairIndex, pair] of packet.pairs.entries()) for (const slot of pair.slots) {
    const get = name => judgments[name].pairs.find(row => row.pairId === pair.pairId).slots.find(row => row.slot === slot.slot);
    const one = get('raterOne'), two = get('raterTwo'), final = get('adjudication');
    for (const first of one.claims) {
      const second = two.claims.find(row => row.claimId === first.claimId);
      claimFlagDifferences += Number(first.correct !== second.correct || first.supported !== second.supported);
      citationDifferences += Number(JSON.stringify([...first.sourceIds].sort()) !== JSON.stringify([...second.sourceIds].sort()));
    }
    for (const first of one.memories) {
      const second = two.memories.find(row => row.memoryId === first.memoryId);
      const last = final.memories.find(row => row.memoryId === first.memoryId);
      if (first.supported !== second.supported) { memoryDifferences++; differentPairs.add(pair.pairId); }
      else if (first.supported !== last.supported) corrections.push({ pairId: pair.pairId,
        packetPairNumber: pairIndex + 1, slot: slot.slot, memoryId: first.memoryId });
    }
  }
  assert.equal(memoryDifferences, 18);
  assert.equal(differentPairs.size, 13);
  assert.equal(claimFlagDifferences, 0);
  assert.equal(citationDifferences, 26);
  assert.equal(corrections.length, 2);
  assert.deepEqual(corrections, bundle.reviewObservations.agreementCorrections);
});

test('v2 retains the stale sufficient-condition memory and its own updated receipt', () => {
  const { packet, mappingKey, judgments } = replay(bundle);
  const key = mappingKey.pairs.find(row => row.caseId === 'b72c84000401');
  assert.equal(key.right, 'candidate');
  const pair = packet.pairs.find(row => row.pairId === key.pairId);
  const memory = pair.slots.find(row => row.slot === 'right').memories.find(row => row.memoryId === 'memory-1');
  assert.ok(memory.content.includes('below 20 means rod puppets can be used'));
  assert.ok(memory.sources.some(source => source.text.includes('rod puppets need wind strictly below 20 and a latched gate')));
  const judged = judgments.adjudication.pairs.find(row => row.pairId === key.pairId);
  const severe = judged.issues.flatMap(issue => issue.occurrences).filter(row => row.severe || row.stale);
  assert.deepEqual(severe.map(({ slot, target, quote, unsupported, severe, stale }) =>
    ({ slot, target, quote, unsupported, severe, stale })), [{ slot: 'right', target: 'memory-1',
    quote: 'below 20 means rod puppets can be used', unsupported: true, severe: true, stale: true }]);
  // The second memory and receipt union preserve the gate; do not imply the
  // entire bank lost it, or that the source-only answers read memory-1 prose.
  assert.ok(pair.slots.find(row => row.slot === 'right').memories[1].content.includes('gate'));
});

test('v2 resource observations remain separate from semantic replay and billing', () => {
  const observed = bundle.resourceObservations, audit = observed.audit;
  assert.equal(observed.executionExitCode, 0);
  assert.equal(observed.status, 'completed');
  assert.equal(observed.fatal, null);
  assert.equal(audit.resourceGatePassed, true);
  assert.equal(audit.fullyAccounted, true);
  assert.equal(audit.physicalRequests, 288);
  assert.equal(audit.reservedAttempts, 288);
  assert.equal(audit.countRequests, 144);
  assert.equal(audit.generationRequests, 144);
  assert.equal(observed.reservedMicroUsd, 1_440_000);
  assert.equal(audit.generationEstimateMicroUsd, 104_164);
  assert.equal(audit.countEstimateMicroUsd, null);
  assert.equal(observed.actualInvoiceMicroUsd, null);
  assert.equal(observed.agentReviewCostMicroUsd, null);
  assert.ok(Math.abs(observed.elapsedIncludingAccountingMs - 1_111_772.585455) < 0.000001);
});

test('v2 rejects an altered original rating and a missing denominator case', () => {
  const changed = structuredClone(bundle);
  const judgment = JSON.parse(changed.originals.raterOne.rawJson);
  judgment.pairs[0].reason += ' Changed after freeze.';
  changed.originals.raterOne.rawJson = JSON.stringify(judgment);
  // Structurally valid new prose is still not the frozen independent rating.
  const { packet } = createRoleStratifiedJudgingPacket(options(bundle));
  assert.equal(validateRoleStratifiedJudgments({ packet, judgments: judgment }).valid, true);
  assert.throws(() => replay(changed), /changed original raterOne/);
  const missing = structuredClone(bundle);
  missing.report.rows.pop();
  assert.throws(() => createRoleStratifiedJudgingPacket(options(missing)), error => error.code === 'invalid_report');
  assert.throws(() => replay(missing), /changed report projection/);
});

test('v2 rejects laundering the severe/stale issue even when altered judgments remain structurally valid', () => {
  const changed = structuredClone(bundle);
  const judgment = JSON.parse(changed.originals.adjudication.rawJson);
  const occurrence = judgment.pairs.flatMap(pair => pair.issues).flatMap(issue => issue.occurrences)
    .find(row => row.severe && row.stale);
  occurrence.severe = false;
  occurrence.stale = false;
  changed.originals.adjudication.rawJson = JSON.stringify(judgment);
  const { packet } = createRoleStratifiedJudgingPacket(options(bundle));
  assert.equal(validateRoleStratifiedJudgments({ packet, judgments: judgment }).valid, true);
  assert.throws(() => replay(changed), /changed original adjudication/);
  // The unchanged scorer accepts supplied valid judgments; frozen-byte binding
  // is what prevents replacing the independently fixed semantic decision.
  const altered = scoreRoleStratifiedQa({ ...options(bundle), judgments: judgment });
  assert.equal(altered.paired.newIssues.memory.severe, 0);
  assert.equal(altered.paired.newIssues.memory.stale, 0);
  assert.notDeepEqual(altered.paired, bundle.expectedScore.paired);
});

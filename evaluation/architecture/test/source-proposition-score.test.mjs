import assert from 'node:assert/strict';
import test from 'node:test';
import { createHash } from 'node:crypto';
import { validateJudgments, scoreJudgments } from '../source-proposition-score.mjs';
import { reproduceSourcePropositionResult } from '../source-proposition-score.mjs';
import { readFileSync } from 'node:fs';

// Newly authored synthetic 24-source packets only, with no private-case input.
const clone = value => structuredClone(value);
const tuple = commitment => ({ subject: 'speaker', property: 'route', scope: null, applies: null,
  value: 'west path', attribution: 'direct', commitment });
const gold = (id = 'decision', commitment = 'adopted') => ({ id, meaning: 'Synthetic complete meaning',
  materialConditions: [], tupleInterpretations: [tuple(commitment)] });
const item = itemIndex => ({ itemIndex, content: 'Synthetic claim', kind: 'decision', confidence: 0.8,
  receipts: [{ role: 'user', excerpt: 'Synthetic source' }], qualification: { slot: { subject: 'speaker',
    property: 'route', scope: null, applies: null }, value: 'west path', attribution: 'direct', commitment: 'adopted' } });
const judgedItem = itemIndex => ({ itemIndex, materialSupport: true, tupleMeaning: true,
  commitment: true, attribution: true, conditions: true, severe: [], reason: 'Synthetic material is faithful.' });
const judgedClaim = (claimId = 'decision', itemIndices = [0]) => ({ claimId, covered: true, correct: true,
  itemIndices, reason: 'Synthetic required meaning is represented.' });
function fixture() {
  const packet = { version: 'synthetic-masked-v1', runStatus: 'completed', reviews: [] }, mapping = [], judgments = [];
  for (let sourceIndex = 0; sourceIndex < 24; sourceIndex++) for (const arm of ['baseline', 'candidate']) {
    const reviewId = `${sourceIndex}-${arm}`;
    packet.reviews.push({ reviewId, source: [], requiredClaims: [gold()], forbiddenInferences: [], status: 'succeeded',
      persistedItemIndices: [0], coldVerified: true, items: [item(0)] });
    mapping.push({ reviewId, sourceId: `source-${sourceIndex}`, sourceIndex, arm });
    judgments.push({ reviewId, claims: [judgedClaim()], items: [judgedItem(0)], reason: 'Synthetic full review.' });
  }
  return { packet, mapping, judgments };
}
const review = (data, source, arm) => data.packet.reviews.find(row => row.reviewId === `${source}-${arm}`);
const judgment = (data, source, arm) => data.judgments.find(row => row.reviewId === `${source}-${arm}`);
const miss = (data, source, arm) => Object.assign(judgment(data, source, arm).claims[0], { covered: false, correct: false, itemIndices: [] });
const score = data => scoreJudgments(data);
const invalid = operation => assert.throws(operation, { code: 'invalid_judgment_data' });
const severe = (category = 'unsupported-material') => ({ category, assertion: 'Synthetic invented completed action', claimIds: ['decision'] });
const severeRef = (source, arm, itemIndex = 0, severeIndex = 0) => ({ reviewId: `${source}-${arm}`, itemIndex, severeIndex });
const equivalent = (source = 0) => ({ candidate: severeRef(source, 'candidate'), baseline: severeRef(source, 'baseline'),
  equivalent: true, reason: 'Both denote the same complete synthetic unsupported assertion.' });

test('all 24 sources remain in denominator and identical passing arms do not meet gain gate', () => {
  const data = fixture(), result = score(data);
  assert.equal(result.denominator, 24); assert.equal(result.perSource.length, 24);
  assert.deepEqual([result.totals.baselinePasses, result.totals.candidatePasses, result.totals.netSourceGains], [24, 24, 0]);
  assert.equal(result.totals.requiredDecisions, 24); assert.equal(result.gate.pass, false);
  assert.equal(result.gate.primaryColdAuditRequired, true);
});

test('three net source gains pass only the mechanical supplied-judgment checks', () => {
  const data = fixture(); for (let source = 0; source < 3; source++) miss(data, source, 'baseline');
  const result = score(data); assert.equal(result.totals.netSourceGains, 3); assert.equal(result.gate.pass, true);
});

test('every item dimension must be true for a source pass even when required claims are correct', () => {
  for (const field of ['materialSupport', 'tupleMeaning', 'commitment', 'attribution', 'conditions']) {
    const data = fixture(); judgment(data, 0, 'candidate').items[0][field] = false;
    const result = score(data); assert.equal(result.perSource[0].candidate.pass, false, field);
    assert.equal(result.perSource[0].candidate.claims[0].correct, true);
  }
});

test('correct persisted baseline decisions are counted even inside a failed whole source', () => {
  const data = fixture(); review(data, 0, 'baseline').status = 'failed';
  review(data, 0, 'candidate').status = 'failed'; review(data, 0, 'candidate').items = [];
  review(data, 0, 'candidate').persistedItemIndices = []; review(data, 0, 'candidate').coldVerified = false;
  judgment(data, 0, 'candidate').items = []; miss(data, 0, 'candidate');
  const result = score(data);
  assert.equal(result.perSource[0].baseline.pass, false); assert.equal(result.perSource[0].candidate.pass, false);
  assert.equal(result.lostDecisions.length, 1); assert.equal(result.lostDecisions[0].claimId, 'decision');
  assert.equal(result.totals.baselineCorrectPersistedDecisions, 24);
  assert.equal(result.coldFailures.length, 0); // Empty failed output has no invented cold result.
});

test('a lost decision blocks net three source gains, including loss of individual persistence', () => {
  const data = fixture(); for (let source = 0; source < 4; source++) miss(data, source, 'baseline');
  miss(data, 4, 'candidate');
  const result = score(data); assert.equal(result.totals.netSourceGains, 3);
  assert.equal(result.totals.lostCorrectDecisions, 1); assert.equal(result.gate.pass, false);
  const persistence = fixture(); review(persistence, 0, 'candidate').persistedItemIndices = [];
  const lost = score(persistence); assert.equal(lost.totals.lostCorrectDecisions, 1);
  assert.equal(lost.coldFailures.length, 1); assert.equal(lost.perSource[0].candidate.claims[0].correct, true);
  review(persistence, 0, 'baseline').persistedItemIndices = [];
  assert.equal(score(persistence).totals.lostCorrectDecisions, 0);
});

test('observation unknowns do not become required decisions and paired gold must agree', () => {
  const data = fixture(); for (const arm of ['baseline', 'candidate']) review(data, 0, arm).requiredClaims[0] = gold('decision', 'unknown');
  miss(data, 0, 'candidate'); assert.equal(score(data).totals.requiredDecisions, 23);
  assert.equal(score(data).totals.lostCorrectDecisions, 0);
  review(data, 0, 'candidate').requiredClaims[0].meaning = 'Changed gold'; invalid(() => score(data));
  const alternatives = fixture();
  for (const arm of ['baseline', 'candidate']) review(alternatives, 0, arm).requiredClaims[0].tupleInterpretations =
    [tuple('unknown'), tuple('considered'), tuple('rejected')];
  miss(alternatives, 0, 'candidate'); assert.equal(score(alternatives).totals.lostCorrectDecisions, 1);
});

test('severe assertions are new without explicit semantic equivalence and exact source/category/indices', () => {
  const data = fixture(); judgment(data, 0, 'baseline').items[0].severe = [severe()];
  judgment(data, 0, 'candidate').items[0].severe = [severe()];
  assert.equal(score(data).totals.newSevereClaims, 1);
  data.equivalences = [equivalent()];
  assert.equal(score(data).totals.newSevereClaims, 0); assert.equal(score(data).matchedSevere.length, 1);
  data.equivalences[0].equivalent = false; assert.equal(score(data).totals.newSevereClaims, 1);
  data.equivalences[0].equivalent = null;
  const uncertain = score(data); assert.equal(uncertain.totals.newSevereClaims, 1); assert.equal(uncertain.unresolved.length, 1);
  assert.equal(uncertain.gate.pass, false);
  data.equivalences = [equivalent(), equivalent()]; invalid(() => score(data));
  data.equivalences = [equivalent()]; data.equivalences[0].baseline.severeIndex = 1; invalid(() => score(data));
  data.equivalences = [equivalent()]; data.equivalences[0].baseline = severeRef(1, 'baseline');
  judgment(data, 1, 'baseline').items[0].severe = [severe()]; invalid(() => score(data));
  data.equivalences = [equivalent()]; judgment(data, 0, 'baseline').items[0].severe[0].category = 'stale-current'; invalid(() => score(data));
  judgment(data, 0, 'baseline').items[0].severe[0].category = 'unsupported-material';
  data.equivalences = [{ ...equivalent(), reason: ' ' }]; invalid(() => score(data));
});

test('different card counts and indices may represent the same complete meaning without sidecars', () => {
  const data = fixture(); const after = review(data, 0, 'candidate'), rated = judgment(data, 0, 'candidate');
  after.items = [item(0), item(1)]; after.persistedItemIndices = [0, 1]; rated.items = [judgedItem(0), judgedItem(1)];
  rated.claims[0].itemIndices = [1, 0];
  assert.equal(score(data).perSource[0].candidate.pass, true);
  assert.equal(score(data).totals.lostCorrectDecisions, 0);
  judgment(data, 0, 'baseline').items[0].severe = [severe()]; rated.items[1].severe = [severe()];
  data.equivalences = [{ ...equivalent(), candidate: severeRef(0, 'candidate', 1) }];
  assert.equal(score(data).totals.newSevereClaims, 0);
  // A sidecar cannot rescue a missing common-persisted claim.
  miss(data, 0, 'candidate'); after.sidecars = [{ claimant: 'speaker', role: 'choice' }];
  assert.equal(score(data).totals.lostCorrectDecisions, 1);
});

test('every null remains unresolved and blocks a definitive gate', () => {
  const data = fixture(); for (let source = 0; source < 3; source++) miss(data, source, 'baseline');
  judgment(data, 5, 'candidate').items[0].conditions = null;
  judgment(data, 6, 'baseline').claims[0].correct = null;
  const result = score(data); assert.equal(result.unresolved.length, 2); assert.equal(result.gate.pass, false);
  assert.deepEqual(result.unresolved.map(row => row.field).sort(), ['conditions', 'correct']);
});

test('run status and independently supplied cold audit markers are required', () => {
  const data = fixture(); for (let source = 0; source < 3; source++) miss(data, source, 'baseline');
  data.packet.runStatus = 'failed'; assert.equal(score(data).gate.checks.runCompleted, false);
  data.packet.runStatus = 'completed'; review(data, 7, 'candidate').coldVerified = false;
  assert.equal(score(data).coldFailures.length, 1); assert.equal(score(data).gate.pass, false);
  review(data, 7, 'candidate').status = 'failed'; assert.equal(score(data).coldFailures.length, 1);
});

test('missing duplicate manufactured and out-of-range references are rejected at all levels', () => {
  const mutations = [
    data => data.judgments.pop(), data => { data.judgments[1] = clone(data.judgments[0]); },
    data => { data.judgments[0].reviewId = 'foreign'; }, data => { data.judgments[0].claims = []; },
    data => { data.judgments[0].claims.push(clone(data.judgments[0].claims[0])); },
    data => { data.judgments[0].claims[0].claimId = 'foreign'; },
    data => { data.judgments[0].claims[0].itemIndices = [0, 0]; },
    data => { const sparse = Array(1); sparse.foreign = 0; data.judgments[0].claims[0].itemIndices = sparse; },
    data => { data.judgments[0].claims[0].itemIndices = [1]; },
    data => { data.judgments[0].claims[0].itemIndices = []; },
    data => { data.judgments[0].claims[0].covered = false; },
    data => { data.judgments[0].claims[0].correct = 'true'; },
    data => { data.judgments[0].items = []; }, data => { data.judgments[0].items[0].itemIndex = 1; },
    data => { data.judgments[0].items[0].materialSupport = undefined; },
    data => { data.judgments[0].items[0].severe = [{ ...severe(), claimIds: ['foreign'] }]; },
    data => { data.judgments[0].items[0].severe = [{ ...severe(), claimIds: ['decision', 'decision'] }]; },
    data => { data.judgments[0].items[0].severe = [{ ...severe(), category: 'new-category' }]; },
    data => { data.judgments[0].reason = ' '; }, data => { data.judgments[0].extra = true; },
    data => { data.mapping[1] = clone(data.mapping[0]); }, data => { data.mapping[0].sourceIndex = 24; },
    data => { data.packet.reviews[0].persistedItemIndices = [0, 0]; },
  ];
  for (const mutate of mutations) { const data = fixture(); mutate(data); invalid(() => score(data)); }
});

test('wrapper hash binds the exact agreed packet encoding and returned data is detached', () => {
  const data = fixture(); const before = clone(data);
  const packetSha256 = createHash('sha256').update(JSON.stringify(data.packet, null, 2) + '\n').digest('hex');
  const wrapped = { packetSha256, judgments: data.judgments };
  assert.equal(validateJudgments(data.packet, wrapped).length, 48);
  invalid(() => validateJudgments(data.packet, { ...wrapped, packetSha256: '0'.repeat(64) }));
  invalid(() => validateJudgments(data.packet, { ...wrapped, extra: true }));
  const result = score(data); assert.deepEqual(data, before);
  result.perSource[0].candidate.claims[0].itemIndices.push(99); assert.deepEqual(data, before);
  const validated = validateJudgments(data.packet, data.judgments); validated[0].reason = 'changed'; assert.deepEqual(data, before);
});

const artifact = JSON.parse(readFileSync(new URL('../results/source-proposition-v1.json', import.meta.url), 'utf8'));
const sourceBytes = readFileSync(new URL('../fixtures/source-proposition-v1.json', import.meta.url), 'utf8');
const rubricBytes = readFileSync(new URL('../fixtures/source-proposition-rubric-v1.json', import.meta.url), 'utf8');
const replay = (input = artifact, bytes = { sourceBytes, rubricBytes }) => reproduceSourcePropositionResult(input, bytes);
const original = (input, name) => JSON.parse(input.originals[name].utf8);
const editOriginal = (input, name, edit) => {
  const value = original(input, name); edit(value);
  const utf8 = JSON.stringify(value, null, 2) + '\n';
  input.originals[name] = { utf8, sha256: createHash('sha256').update(utf8).digest('hex') };
};
const retained = input => ({ packet: original(input, 'judging-packet.json'),
  mapping: original(input, 'judging-map.json').mapping, judgments: original(input, 'adjudication-original.json').judgments });

test('public replay reproduces the exact retained failed gate and all claim/decision totals', () => {
  const result = replay();
  assert.deepEqual(result.score, original(artifact, 'accepted-semantic.json').score);
  assert.deepEqual(result.score.totals, {
    denominator: 24, baselinePasses: 10, candidatePasses: 11, gains: 7, regressions: 6, netSourceGains: 1,
    requiredDecisions: 21, baselineCorrectPersistedDecisions: 19, lostCorrectDecisions: 10,
    newSevereClaims: 3, matchedSevereClaims: 0, unresolvedJudgments: 0, coldFailures: 0
  });
  assert.equal(result.score.gate.pass, false);
  assert.deepEqual(result.score.gate.checks, { netSourceGains: false, noLostCorrectDecisions: false,
    noNewSevereClaims: false, noUnresolvedJudgments: true, successfulArmsColdVerified: true, runCompleted: true });
  for (const [arm, expected] of [['baseline', [21, 34, 34]], ['candidate', [20, 28, 34]]])
    assert.deepEqual(['correctRequiredClaims', 'coveredRequiredClaims', 'requiredClaims'].map(key => result.stats[arm][key]), expected);
  assert.equal(result.agreement.agreedBooleanFields, 495); assert.equal(result.agreement.booleanFields, 506);
  assert.equal(result.agreement.substantiveDisagreementRows.length, 7);
  assert.equal(result.agreement.referenceDisagreementRows.length, 2);
  assert.deepEqual(result.agreement.bothRaterAgreementCorrections, []);
  assert.equal(result.primarySemanticAudit.status, 'accepted-as-failed-candidate');
  assert.equal(result.primarySemanticAudit.ratingsChanged, false);
});

test('public all-source completion, cold markers and paid resource measurements remain separate', () => {
  const { score: result, stats, resources } = replay();
  assert.equal(result.perSource.length, 24);
  assert.deepEqual(['baseline', 'candidate'].map(arm => stats[arm].completedSources), [24, 21]);
  assert.deepEqual(['baseline', 'candidate'].map(arm => stats[arm].compiledItems), [33, 41]);
  assert.deepEqual(['baseline', 'candidate'].map(arm => stats[arm].coldItems), [33, 41]);
  for (const arm of ['baseline', 'candidate']) {
    assert.equal(stats[arm].operatorArmLatencyMs.attempts, 24);
    assert.equal(stats[arm].generationCalls, stats[arm].countCalls);
    assert.equal(stats[arm].unknownGenerationUsage, 0);
  }
  assert.deepEqual(['baseline', 'candidate'].map(arm => stats[arm].generationCalls), [48, 24]);
  assert.deepEqual(['baseline', 'candidate'].map(arm => stats[arm].knownGenerationEstimateMicroUsd), [35110, 23554]);
  assert.deepEqual(['baseline', 'candidate'].map(arm => [stats[arm].inputTokens, stats[arm].outputTokens]), [[63174, 6139], [26391, 8117]]);
  assert.equal(resources.physicalHttpRequests, 144);
  assert.equal(resources.physicalHttpRequests, Object.values(stats).reduce((n, arm) => n + arm.generationCalls + arm.countCalls, 0));
  assert.equal(resources.reservationMicroUsd, 720000); assert.equal(resources.reservationIsInvoice, false);
  assert.equal(resources.countEndpointCost, 'unknown'); assert.equal(resources.agentJudgingCost, 'unknown');
  assert.equal(resources.cumulativeConservativeMicroUsd, 338322281);
  assert.equal(resources.remainingSpendableMicroUsd, 31677719);
  assert.equal(resources.cumulativeLimitMicroUsd - resources.protectedMicroUsd - resources.cumulativeConservativeMicroUsd,
    resources.remainingSpendableMicroUsd);
});

test('public losses include three whole-output rejections and six substantive decision losses', () => {
  const result = replay();
  assert.deepEqual(result.lossCategories, { structuralRejection: 4, omittedChoice: 2,
    missingConditionalBranch: 1, consideredToUnknown: 2, intendedToCompleted: 1 });
  assert.equal(Object.values(result.lossCategories).reduce((a, b) => a + b, 0), 10);
  const failures = artifact.structuralFailures;
  assert.deepEqual(failures.map(row => row.sourceId), ['93b57e0a2fc6', 'bb6049f2a18e', '3f92d6a081ce']);
  for (const failure of failures) {
    assert.equal(failure.reason, 'invalid_proposition_output'); assert.equal(failure.failureStage, 'candidate');
    const row = result.score.perSource.find(row => row.sourceId === failure.sourceId);
    assert.equal(row.candidate.pass, false); assert.equal(row.candidate.claims.every(claim => !claim.covered), true);
  }
  const propositions = failures.map(row => row.originalOutput.propositions);
  assert.equal(propositions[0][0].role.value, 'observation'); assert.equal(propositions[0][0].commitment.value, 'adopted');
  assert.equal(propositions[1].length, 3);
  assert.equal(propositions[1].every(row => row.role.value === 'observation' && row.commitment.value === 'adopted'), true);
  assert.equal(propositions[2][1].scope.evidenceIndices.some(index => !propositions[2][1].evidenceIndices.includes(index)), true);
  assert.equal(result.score.lostDecisions.filter(row => failures.some(failure => failure.sourceId === row.sourceId)).length, 4);
});

test('physical source availability separates five retained decisions, one selection omission and four rejection losses', () => {
  const { sourceAvailability, score } = replay();
  assert.deepEqual(sourceAvailability.counts, { present: 5, 'source-selection-omission': 1, 'atomic-rejection': 4 });
  assert.equal(sourceAvailability.rows.length, score.lostDecisions.length);
  const claims = label => sourceAvailability.rows.filter(row => row.availability === label).map(row => row.claimId);
  assert.deepEqual(claims('present'), ['q12', 'q14', 'q21', 'q25', 'q28']);
  assert.deepEqual(claims('source-selection-omission'), ['q26']);
  assert.deepEqual(claims('atomic-rejection'), ['q22', 'q31', 'q32', 'q33']);
  const data = retained(artifact);
  for (const row of sourceAvailability.rows) {
    const entry = data.mapping.find(entry => entry.sourceId === row.sourceId && entry.arm === 'candidate');
    const review = data.packet.reviews.find(review => review.reviewId === entry.reviewId);
    const message = review.source[row.sourceMessageIndex];
    assert.equal(message.role, 'user');
    const retainedMessages = review.items.flatMap(item => item.receipts).filter(receipt => receipt.role === message.role)
      .map(receipt => receipt.excerpt);
    assert.equal(retainedMessages.some(excerpt => excerpt.includes(message.content)), row.availability === 'present');
  }
  const omission = data.packet.reviews.find(row => row.reviewId ===
    data.mapping.find(entry => entry.sourceId === '18bf6a30d5e2' && entry.arm === 'candidate').reviewId);
  assert.equal(omission.items.flatMap(item => item.receipts).every(receipt => receipt.role === 'assistant'), true);
  assert.match(omission.items[0].receipts[0].excerpt, /recommend the cotton blanket/);
  assert.doesNotMatch(omission.items[0].receipts[0].excerpt, /wool blanket/);
});

test('equal severe aggregates cannot launder new assertion instances across source episodes', () => {
  const data = retained(artifact), result = replay();
  assert.equal(result.stats.baseline.severeAssertionInstances, 3); assert.equal(result.stats.candidate.severeAssertionInstances, 3);
  assert.equal(result.score.newSevere.length, 3);
  assert.equal(new Set(result.score.newSevere.map(row => row.sourceId)).size, 2);
  for (const row of result.score.newSevere) {
    const baseline = data.mapping.find(entry => entry.sourceId === row.sourceId && entry.arm === 'baseline');
    assert.equal(data.judgments.find(entry => entry.reviewId === baseline.reviewId).items.flatMap(item => item.severe).length, 0);
  }
  const candidate = result.score.newSevere[0].candidate;
  const otherBaseline = data.mapping.find(entry => entry.arm === 'baseline' &&
    data.judgments.find(row => row.reviewId === entry.reviewId).items.some(item => item.severe.length));
  const baselineItem = data.judgments.find(row => row.reviewId === otherBaseline.reviewId).items.find(item => item.severe.length);
  data.equivalences = [{ candidate, baseline: { reviewId: otherBaseline.reviewId, itemIndex: baselineItem.itemIndex, severeIndex: 0 },
    equivalent: true, reason: 'Aggregate counts happen to match.' }];
  invalid(() => scoreJudgments(data));
});

test('dropping failed attempts cannot shrink or improve the frozen public denominator', () => {
  const data = retained(artifact), failed = data.packet.reviews.filter(row => row.status === 'failed').map(row => row.reviewId);
  assert.equal(failed.length, 3);
  data.packet.reviews = data.packet.reviews.filter(row => !failed.includes(row.reviewId));
  data.mapping = data.mapping.filter(row => !failed.includes(row.reviewId));
  data.judgments = data.judgments.filter(row => !failed.includes(row.reviewId));
  invalid(() => scoreJudgments(data));
  const edited = clone(artifact);
  editOriginal(edited, 'judging-packet.json', value => { value.reviews = value.reviews.filter(row => row.status !== 'failed'); });
  invalid(() => replay(edited));
});

test('original pins reject lost-decision, severe, measurement and unmasking laundering even with recomputed hashes', () => {
  const attacks = [
    ['adjudication-original.json', value => {
      const id = replay().score.lostDecisions[0];
      const reviewId = original(artifact, 'judging-map.json').mapping.find(row => row.sourceId === id.sourceId && row.arm === 'candidate').reviewId;
      const claim = value.judgments.find(row => row.reviewId === reviewId).claims.find(row => row.claimId === id.claimId);
      claim.correct = true; claim.covered = true; claim.itemIndices = [0];
    }],
    ['adjudication-original.json', value => { for (const row of value.judgments) for (const item of row.items) item.severe = []; }],
    ['accepted-semantic.json', value => { value.score.totals.lostCorrectDecisions = 0; value.score.totals.newSevereClaims = 0; value.score.gate.pass = true; }],
    ['accepted-semantic.json', value => { value.resources.countEndpointCost = 0; value.stats.candidate.knownGenerationEstimateMicroUsd = 0; }],
    ['judging-map.json', value => { value.mapping[0].arm = value.mapping[0].arm === 'baseline' ? 'candidate' : 'baseline'; }]
  ];
  for (const [name, edit] of attacks) { const edited = clone(artifact); editOriginal(edited, name, edit); invalid(() => replay(edited)); }
});

test('each original, source and rubric stays bound to exact frozen bytes', () => {
  for (const name of Object.keys(artifact.originals)) {
    const edited = clone(artifact); edited.originals[name].utf8 += ' ';
    invalid(() => replay(edited));
    const rehashed = clone(artifact);
    rehashed.originals[name].utf8 += ' ';
    rehashed.originals[name].sha256 = createHash('sha256').update(rehashed.originals[name].utf8).digest('hex');
    invalid(() => replay(rehashed));
  }
  invalid(() => replay(artifact, { sourceBytes: sourceBytes.replace('27 degrees', '28 degrees'), rubricBytes }));
  invalid(() => replay(artifact, { sourceBytes, rubricBytes: rubricBytes + ' ' }));
  const scorer = readFileSync(new URL('../source-proposition-score.mjs', import.meta.url), 'utf8');
  const originalScorer = scorer.slice(0, scorer.indexOf('\n// Public replay boundary.'));
  assert.equal(createHash('sha256').update(originalScorer).digest('hex'), artifact.provenance.originalScorerSha256);
  const edited = clone(artifact); edited.structuralFailures[0].originalOutput.propositions[0].role.value = 'choice';
  invalid(() => replay(edited));
});

test('public replay is detached, evaluation-only and excludes private operational material', () => {
  const before = clone(artifact), result = replay();
  result.score.perSource[0].baseline.claims[0].correct = false;
  result.stats.candidate.knownGenerationEstimateMicroUsd = 0;
  result.resources.countEndpointCost = 0;
  assert.deepEqual(artifact, before); assert.equal(replay().resources.countEndpointCost, 'unknown');
  assert.equal(artifact.provenance.productionDefaultsChanged, false);
  const published = JSON.stringify(artifact);
  assert.doesNotMatch(published, /\/tmp\/|\/home\/|Bearer |api[_-]?key|ledgerPath|requestHeaders/i);
  const scorer = readFileSync(new URL('../source-proposition-score.mjs', import.meta.url), 'utf8');
  assert.doesNotMatch(scorer, /from ['"](?:node:fs|node:https?|.*core\/|.*adapter)|fetch\(/);
});

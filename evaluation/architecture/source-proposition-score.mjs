// Pure primary-acceptance helper. No file, network, provider or CLI work.
import { createHash } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
const itemFields = ['materialSupport', 'tupleMeaning', 'commitment', 'attribution', 'conditions'];
const categories = ['unsupported-material', 'stale-current', 'authorization-or-action'];
const knownCommitments = ['adopted', 'considered', 'rejected'];
const reject = () => { const error = new Error('invalid_judgment_data'); error.code = 'invalid_judgment_data'; throw error; };
const check = condition => { if (!condition) reject(); };
const record = value => check(value !== null && typeof value === 'object' && !Array.isArray(value));
const exact = (value, keys) => { record(value); check(Object.keys(value).length === keys.length && keys.every(key => Object.hasOwn(value, key))); };
const nonempty = value => check(typeof value === 'string' && value.trim().length > 0);
const boolean = value => check(value === true || value === false || value === null);
const list = value => {
  check(Array.isArray(value) && Object.keys(value).length === value.length);
  for (let index = 0; index < value.length; index++) check(Object.hasOwn(value, index));
  return value;
};
const unique = values => check(new Set(values).size === values.length);
const indices = (values, allowed) => { list(values); unique(values); check(values.every(value => Number.isSafeInteger(value) && allowed.has(value))); };
const clone = value => structuredClone(value);

function packetIndex(packet) {
  record(packet); check(['completed', 'failed'].includes(packet.runStatus)); list(packet.reviews); check(packet.reviews.length === 48);
  const reviews = new Map();
  for (const review of packet.reviews) {
    record(review); nonempty(review.reviewId); check(!reviews.has(review.reviewId)); nonempty(review.status);
    check(typeof review.coldVerified === 'boolean');
    list(review.requiredClaims); list(review.items);
    const claims = new Map();
    for (const claim of review.requiredClaims) {
      exact(claim, ['id', 'meaning', 'materialConditions', 'tupleInterpretations']); nonempty(claim.id); nonempty(claim.meaning);
      check(!claims.has(claim.id)); list(claim.materialConditions).forEach(nonempty);
      list(claim.tupleInterpretations); check(claim.tupleInterpretations.length > 0);
      for (const tuple of claim.tupleInterpretations) {
        exact(tuple, ['subject', 'property', 'scope', 'applies', 'value', 'attribution', 'commitment']);
        for (const field of ['subject', 'property', 'scope', 'applies', 'value']) if (tuple[field] !== null) nonempty(tuple[field]);
        check(['direct', 'reported', 'quoted', 'proposed', 'unknown'].includes(tuple.attribution));
        check([...knownCommitments, 'unknown'].includes(tuple.commitment));
      }
      claims.set(claim.id, claim);
    }
    const itemIds = new Set(review.items.map(item => item.itemIndex));
    check(itemIds.size === review.items.length && review.items.every((item, index) => item.itemIndex === index));
    indices(review.persistedItemIndices, itemIds);
    reviews.set(review.reviewId, { review, claims, itemIds, persisted: new Set(review.persistedItemIndices) });
  }
  return reviews;
}

/** Validate all 48 original judgment rows, all claims/items and their exact refs. */
export function validateJudgments(packet, judgments) {
  const reviews = packetIndex(packet);
  let rows = judgments;
  if (!Array.isArray(judgments)) {
    exact(judgments, ['packetSha256', 'judgments']);
    check(typeof judgments.packetSha256 === 'string' && /^[a-f0-9]{64}$/.test(judgments.packetSha256));
    const packetSha256 = createHash('sha256').update(JSON.stringify(packet, null, 2) + '\n').digest('hex');
    check(judgments.packetSha256 === packetSha256);
    rows = judgments.judgments;
  }
  list(rows); check(rows.length === 48);
  const seen = new Set();
  for (const row of rows) {
    exact(row, ['reviewId', 'claims', 'items', 'reason']);
    check(reviews.has(row.reviewId) && !seen.has(row.reviewId)); seen.add(row.reviewId); nonempty(row.reason);
    const { claims, itemIds } = reviews.get(row.reviewId);
    list(row.claims); check(row.claims.length === claims.size);
    const claimIds = new Set();
    for (const claim of row.claims) {
      exact(claim, ['claimId', 'covered', 'correct', 'itemIndices', 'reason']);
      check(claims.has(claim.claimId) && !claimIds.has(claim.claimId)); claimIds.add(claim.claimId);
      boolean(claim.covered); boolean(claim.correct); indices(claim.itemIndices, itemIds); nonempty(claim.reason);
      if (claim.correct === true) check(claim.covered === true && claim.itemIndices.length > 0);
    }
    list(row.items); check(row.items.length === itemIds.size);
    const seenItems = new Set();
    for (const item of row.items) {
      exact(item, ['itemIndex', ...itemFields, 'severe', 'reason']);
      check(itemIds.has(item.itemIndex) && !seenItems.has(item.itemIndex)); seenItems.add(item.itemIndex);
      itemFields.forEach(field => boolean(item[field])); nonempty(item.reason);
      list(item.severe);
      for (const severe of item.severe) {
        exact(severe, ['category', 'assertion', 'claimIds']);
        check(categories.includes(severe.category)); nonempty(severe.assertion);
        list(severe.claimIds); unique(severe.claimIds); check(severe.claimIds.every(id => claims.has(id)));
      }
    }
  }
  return clone(rows);
}

const refKey = ref => JSON.stringify([ref.reviewId, ref.itemIndex, ref.severeIndex]);
function validateMapping(mapping, reviews) {
  list(mapping); check(mapping.length === 48);
  const sources = new Map(), seen = new Set(), sourceIds = new Set();
  for (const entry of mapping) {
    exact(entry, ['reviewId', 'sourceId', 'sourceIndex', 'arm']); nonempty(entry.sourceId);
    check(reviews.has(entry.reviewId) && !seen.has(entry.reviewId)); seen.add(entry.reviewId);
    check(Number.isSafeInteger(entry.sourceIndex) && entry.sourceIndex >= 0 && entry.sourceIndex < 24);
    check(['baseline', 'candidate'].includes(entry.arm));
    let source = sources.get(entry.sourceIndex);
    if (!source) { check(!sourceIds.has(entry.sourceId)); sourceIds.add(entry.sourceId);
      source = { sourceId: entry.sourceId, sourceIndex: entry.sourceIndex }; sources.set(entry.sourceIndex, source); }
    check(source.sourceId === entry.sourceId && !source[entry.arm]); source[entry.arm] = entry.reviewId;
  }
  check(sources.size === 24 && [...sources.values()].every(source => source.baseline && source.candidate));
  for (const source of sources.values()) {
    const baseline = reviews.get(source.baseline).claims, candidate = reviews.get(source.candidate).claims;
    check(baseline.size === candidate.size && [...baseline.keys()].every(id => candidate.has(id)
      && isDeepStrictEqual(baseline.get(id), candidate.get(id))));
  }
  return [...sources.values()].sort((a, b) => a.sourceIndex - b.sourceIndex);
}

/** Mechanical source/decision/severe gates; all semantic ratings remain supplied data. */
export function scoreJudgments({ packet, mapping, judgments, equivalences = [] }) {
  const rows = validateJudgments(packet, judgments), reviews = packetIndex(packet);
  const sources = validateMapping(mapping, reviews), byId = new Map(rows.map(row => [row.reviewId, row]));
  const sourceByReview = new Map(sources.flatMap(source => [[source.baseline, source], [source.candidate, source]]));
  const severeByRef = new Map();
  for (const row of rows) for (const item of row.items) item.severe.forEach((severe, severeIndex) => {
    const ref = { reviewId: row.reviewId, itemIndex: item.itemIndex, severeIndex };
    severeByRef.set(refKey(ref), { ref, ...severe });
  });
  list(equivalences); const equivalenceByCandidate = new Map();
  for (const equivalence of equivalences) {
    exact(equivalence, ['candidate', 'baseline', 'equivalent', 'reason']); boolean(equivalence.equivalent); nonempty(equivalence.reason);
    for (const side of ['candidate', 'baseline']) {
      exact(equivalence[side], ['reviewId', 'itemIndex', 'severeIndex']);
      check(Number.isSafeInteger(equivalence[side].itemIndex) && Number.isSafeInteger(equivalence[side].severeIndex));
      check(severeByRef.has(refKey(equivalence[side])));
    }
    const candidate = severeByRef.get(refKey(equivalence.candidate)), baseline = severeByRef.get(refKey(equivalence.baseline));
    const source = sourceByReview.get(candidate.ref.reviewId);
    check(source?.candidate === candidate.ref.reviewId && source.baseline === baseline.ref.reviewId);
    check(candidate.category === baseline.category);
    const key = refKey(candidate.ref); check(!equivalenceByCandidate.has(key)); equivalenceByCandidate.set(key, clone(equivalence));
  }
  const unresolved = [], newSevere = [], matchedSevere = [], lostDecisions = [];
  for (const row of rows) {
    for (const claim of row.claims) for (const field of ['covered', 'correct']) if (claim[field] === null)
      unresolved.push({ reviewId: row.reviewId, claimId: claim.claimId, field, reason: claim.reason });
    for (const item of row.items) for (const field of itemFields) if (item[field] === null)
      unresolved.push({ reviewId: row.reviewId, itemIndex: item.itemIndex, field, reason: item.reason });
  }
  const perSource = sources.map(source => {
    const arm = name => {
      const reviewId = source[name], { review, persisted } = reviews.get(reviewId), row = byId.get(reviewId);
      const claims = row.claims.map(claim => ({ claimId: claim.claimId, covered: claim.covered, correct: claim.correct,
        itemIndices: [...claim.itemIndices], persisted: claim.itemIndices.length > 0 && claim.itemIndices.every(index => persisted.has(index)) }));
      const coldVerified = review.coldVerified && review.items.every(item => persisted.has(item.itemIndex));
      const pass = review.status === 'succeeded' && claims.every(claim => claim.covered === true && claim.correct === true)
        && row.items.every(item => itemFields.every(field => item[field] === true) && item.severe.length === 0);
      return { reviewId, status: review.status, pass, coldVerified, needsColdVerification: review.status === 'succeeded' || review.items.length > 0, claims };
    };
    const baseline = arm('baseline'), candidate = arm('candidate'), decisions = [];
    for (const claim of reviews.get(source.baseline).claims.values()) {
      const requiredDecision = claim.tupleInterpretations.some(tuple => knownCommitments.includes(tuple.commitment));
      if (!requiredDecision) continue;
      const before = baseline.claims.find(item => item.claimId === claim.id), after = candidate.claims.find(item => item.claimId === claim.id);
      const baselineCorrectPersisted = before.correct === true && before.covered === true && before.persisted;
      const candidateCorrectPersisted = after.correct === true && after.covered === true && after.persisted;
      const lost = baselineCorrectPersisted && !candidateCorrectPersisted;
      const decision = { claimId: claim.id, baselineCorrectPersisted, candidateCorrectPersisted, lost };
      decisions.push(decision); if (lost) lostDecisions.push({ sourceId: source.sourceId, sourceIndex: source.sourceIndex, ...decision });
    }
    for (const item of byId.get(source.candidate).items) item.severe.forEach((severe, severeIndex) => {
      const ref = { reviewId: source.candidate, itemIndex: item.itemIndex, severeIndex };
      const equivalence = equivalenceByCandidate.get(refKey(ref));
      const entry = { sourceId: source.sourceId, sourceIndex: source.sourceIndex, ...clone(severe), candidate: ref,
        equivalence: equivalence ?? null };
      if (equivalence?.equivalent === true) matchedSevere.push(entry);
      else { newSevere.push(entry); if (equivalence?.equivalent === null)
        unresolved.push({ ...ref, field: 'equivalence', reason: equivalence.reason }); }
    });
    return { sourceId: source.sourceId, sourceIndex: source.sourceIndex, baseline, candidate, decisions };
  });
  const baselinePasses = perSource.filter(source => source.baseline.pass).length;
  const candidatePasses = perSource.filter(source => source.candidate.pass).length;
  const gains = perSource.filter(source => !source.baseline.pass && source.candidate.pass).length;
  const regressions = perSource.filter(source => source.baseline.pass && !source.candidate.pass).length;
  const coldFailures = perSource.flatMap(source => ['baseline', 'candidate'].filter(arm =>
    source[arm].needsColdVerification && !source[arm].coldVerified).map(arm => ({ sourceId: source.sourceId, arm, reviewId: source[arm].reviewId })));
  const totals = { denominator: 24, baselinePasses, candidatePasses, gains, regressions, netSourceGains: gains - regressions,
    requiredDecisions: perSource.reduce((sum, source) => sum + source.decisions.length, 0),
    baselineCorrectPersistedDecisions: perSource.reduce((sum, source) => sum + source.decisions.filter(decision => decision.baselineCorrectPersisted).length, 0),
    lostCorrectDecisions: lostDecisions.length, newSevereClaims: newSevere.length, matchedSevereClaims: matchedSevere.length,
    unresolvedJudgments: unresolved.length, coldFailures: coldFailures.length };
  const checks = { netSourceGains: totals.netSourceGains >= 3, noLostCorrectDecisions: totals.lostCorrectDecisions === 0,
    noNewSevereClaims: totals.newSevereClaims === 0, noUnresolvedJudgments: totals.unresolvedJudgments === 0,
    successfulArmsColdVerified: coldFailures.length === 0, runCompleted: packet.runStatus === 'completed' };
  return { denominator: 24, perSource, lostDecisions, newSevere, matchedSevere, unresolved, coldFailures, totals,
    gate: { pass: Object.values(checks).every(Boolean), checks, primaryColdAuditRequired: true,
      scope: 'Mechanical supplied-judgment gate only; primary audit remains required.' } };
}

// Public replay boundary. Everything above this marker preserves the retained
// scorer bytes (SHA-256 below); supplied semantic judgments remain supplied data.
const originalPins = Object.freeze({
  'accepted-semantic.json': '46f31471f34a316a9df5b5cd8fb3f8f8195a1ed1ee0db0ad2d5048f559cea645',
  'judging-packet.json': '3a77806713612826421460ea90af0635d982c2e913659eea9d5a132d4e8fcf85',
  'judging-map.json': '18f25ba1cec0c008a16adf7c812cb62aa1c7fac6d86cfd7e179c7017154f6d03',
  'rater-a-original.json': '3849ebb74a28d3612fd4d72312ac0d909f23f639a52ab8ba8baef3cc0b0bb5fc',
  'rater-b-original.json': '54d502ab4da9df5cc6eb6ee75657707cfa006d4ce3da72733f5e0064f20ffefa',
  'adjudication-original.json': 'd13646126f230a48ce743b3180d5891987586a402a6c693475acc5a5b3818dcd',
  'judging-contract.json': '2101abf5aeade7b15176eb8bc763b6d69f767299fb076043f70033f303f51e68'
});
const sourceHash = '2018e0502c9e4533114855c2e336cc9414a0006f53b5aa2afec1f0ca577970eb';
const rubricHash = '39f2e1eef57d59d5a93c000dbceaae9b0a2077bc024c337ddf6cc7a5e9532f26';
const scorerHash = '61d714042b6ae12b8009f228b1ca3b5d0985bf93ff309017dd2c3af1afe298ef';
const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
const same = (actual, expected) => check(isDeepStrictEqual(actual, expected));

function agreementFor(a, b, adjudication) {
  const agreement = { booleanFields: 0, agreedBooleanFields: 0, substantiveDisagreementRows: [],
    referenceDisagreementRows: [], bothRaterAgreementCorrections: [] };
  for (const rowA of a.judgments) {
    const rowB = b.judgments.find(row => row.reviewId === rowA.reviewId);
    const final = adjudication.judgments.find(row => row.reviewId === rowA.reviewId);
    let differs = false, referencesDiffer = false;
    for (const [kind, key, fields] of [['claims', 'claimId', ['covered', 'correct']], ['items', 'itemIndex', itemFields]]) {
      for (const entryA of rowA[kind]) {
        const entryB = rowB[kind].find(entry => entry[key] === entryA[key]);
        const resolved = final[kind].find(entry => entry[key] === entryA[key]);
        for (const field of fields) {
          agreement.booleanFields++;
          if (entryA[field] === entryB[field]) {
            agreement.agreedBooleanFields++;
            if (entryA[field] !== resolved[field]) agreement.bothRaterAgreementCorrections.push(
              { reviewId: rowA.reviewId, kind, ref: entryA[key], field, before: entryA[field], after: resolved[field] });
          } else differs = true;
        }
        if (kind === 'claims' && !isDeepStrictEqual(entryA.itemIndices, entryB.itemIndices)) referencesDiffer = true;
        if (kind === 'items' && entryA.severe.length !== entryB.severe.length) differs = true;
      }
    }
    if (differs) agreement.substantiveDisagreementRows.push(rowA.reviewId);
    if (referencesDiffer) agreement.referenceDisagreementRows.push(rowA.reviewId);
  }
  const ids = type => adjudication.resolutions.filter(row => row.type === type).map(row => row.reviewId).sort();
  same(ids('substantive-disagreement'), [...agreement.substantiveDisagreementRows].sort());
  same(ids('reference-selection'), [...agreement.referenceDisagreementRows].sort());
  for (const row of adjudication.resolutions.filter(row => row.originalJudgments)) {
    same(row.originalJudgments.raterA, a.judgments.find(rating => rating.reviewId === row.reviewId));
    same(row.originalJudgments.raterB, b.judgments.find(rating => rating.reviewId === row.reviewId));
  }
  return agreement;
}

/** Reproduce the frozen public negative result from exact retained originals.
 * The caller supplies source/rubric file bytes; this module performs no I/O.
 * Cold markers/resources are retained primary-audited measurements, not rerun
 * persistence or provider work. No new semantic judgment is made here.
 */
export function reproduceSourcePropositionResult(artifact, { sourceBytes, rubricBytes }) {
  exact(artifact, ['version', 'outcome', 'provenance', 'originals', 'structuralFailures', 'decision']);
  check(artifact.version === 'source-proposition-public-result-v1');
  check(artifact.outcome === 'FAIL — do not adopt');
  check(artifact.provenance.runtimeCommit === 'bae2938bf170c4ce07b42f15c7a6b4010ed0ffc3');
  check(artifact.provenance.productionDefaultsChanged === false);
  check(artifact.provenance.sourceSha256 === sourceHash && artifact.provenance.rubricSha256 === rubricHash);
  check(artifact.provenance.originalScorerSha256 === scorerHash);
  check(artifact.provenance.generationModel === 'gpt-4.1-mini-2025-04-14');
  check(artifact.provenance.provider === 'OpenAI' && artifact.provenance.maximumOutputTokensPerGeneration === 1024);
  check(artifact.provenance.localInputTokenCeiling === 6000 && artifact.provenance.providerInputTokenCeiling === 7024);
  check(sha256(sourceBytes) === sourceHash && sha256(rubricBytes) === rubricHash);
  exact(artifact.originals, Object.keys(originalPins));
  const originals = {};
  for (const [name, pin] of Object.entries(originalPins)) {
    const original = artifact.originals[name]; exact(original, ['sha256', 'utf8']);
    check(original.sha256 === pin && typeof original.utf8 === 'string' && sha256(original.utf8) === pin);
    originals[name] = JSON.parse(original.utf8);
  }
  const accepted = originals['accepted-semantic.json'], packet = originals['judging-packet.json'];
  const map = originals['judging-map.json'], mapping = map.mapping;
  const a = originals['rater-a-original.json'], b = originals['rater-b-original.json'];
  const adjudication = originals['adjudication-original.json'];
  check(map.packetSha256 === originalPins['judging-packet.json']);
  same(packet.contract, originals['judging-contract.json']);
  const source = JSON.parse(sourceBytes), rubric = JSON.parse(rubricBytes);
  same(packet.grading, rubric.grading);
  check(source.cases.length === 24 && rubric.cases.length === 24);
  check(source.cases.reduce((n, row) => n + row.messages.length, 0) === 31);
  check(rubric.cases.reduce((n, row) => n + row.requiredClaims.length, 0) === 34);
  for (const entry of mapping) {
    const review = packet.reviews.find(row => row.reviewId === entry.reviewId);
    const gold = rubric.cases[entry.sourceIndex], evidence = source.cases[entry.sourceIndex];
    check(entry.sourceId === gold.id && entry.sourceId === evidence.id);
    same(review.source, evidence.messages); same(review.requiredClaims, gold.requiredClaims);
    same(review.forbiddenInferences, gold.forbiddenInferences);
  }
  for (const original of [a, b, adjudication]) validateJudgments(packet,
    { packetSha256: original.packetSha256, judgments: original.judgments });
  const score = scoreJudgments({ packet, mapping, judgments: adjudication.judgments });
  same(score, accepted.score);
  const agreement = agreementFor(a, b, adjudication); same(agreement, accepted.agreement);
  const stats = {};
  for (const arm of ['baseline', 'candidate']) {
    const entries = mapping.filter(row => row.arm === arm).map(entry => ({
      review: packet.reviews.find(row => row.reviewId === entry.reviewId),
      rating: adjudication.judgments.find(row => row.reviewId === entry.reviewId)
    }));
    const derived = {
      sourcePasses: score.totals[arm + 'Passes'],
      correctRequiredClaims: entries.reduce((n, { rating }) => n + rating.claims.filter(row => row.correct === true).length, 0),
      coveredRequiredClaims: entries.reduce((n, { rating }) => n + rating.claims.filter(row => row.covered === true).length, 0),
      requiredClaims: entries.reduce((n, { rating }) => n + rating.claims.length, 0),
      severeAssertionInstances: entries.reduce((n, { rating }) => n + rating.items.flatMap(row => row.severe).length, 0),
      sourcesWithSevereAssertions: entries.filter(({ rating }) => rating.items.some(row => row.severe.length)).length,
      completedSources: entries.filter(({ review }) => review.status === 'succeeded').length,
      compiledItems: entries.reduce((n, { review }) => n + review.items.length, 0),
      coldItems: entries.reduce((n, { review }) => n + review.persistedItemIndices.length, 0)
    };
    for (const [field, value] of Object.entries(derived)) same(value, accepted.stats[arm][field]);
    stats[arm] = { ...clone(accepted.stats[arm]), ...derived };
  }
  // Equal aggregate severe counts are never equivalence evidence. In this run
  // each candidate severe source has zero baseline severe assertions to match.
  for (const severe of score.newSevere) {
    const baseline = mapping.find(row => row.sourceId === severe.sourceId && row.arm === 'baseline');
    check(adjudication.judgments.find(row => row.reviewId === baseline.reviewId).items.flatMap(row => row.severe).length === 0);
  }
  check(sha256(JSON.stringify(artifact.structuralFailures)) === '245682c5b3ab3ff34e68b601aa547e88908d8ad04a08cb13154aa8c794532422');
  const rejected = artifact.structuralFailures.map(row => row.sourceId);
  same(rejected, score.perSource.filter(row => row.candidate.status === 'failed').map(row => row.sourceId));
  check(score.lostDecisions.filter(row => rejected.includes(row.sourceId)).length === 4);
  // This closed cohort has exactly one user message in each lost decision's
  // source. Check physical availability of that whole exact message, including
  // its conditions, in retained receipts. This is not answer-recovery scoring.
  const sourceAvailabilityRows = score.lostDecisions.map(lost => {
    const entry = mapping.find(row => row.sourceId === lost.sourceId && row.arm === 'candidate');
    const review = packet.reviews.find(row => row.reviewId === entry.reviewId);
    const messages = review.source.map((message, index) => ({ ...message, index })).filter(message => message.role === 'user');
    check(messages.length === 1);
    const message = messages[0];
    const itemIndices = review.items.filter(item => review.persistedItemIndices.includes(item.itemIndex)
      && item.receipts.some(receipt => receipt.role === message.role && receipt.excerpt.includes(message.content))).map(item => item.itemIndex);
    return { sourceId: lost.sourceId, claimId: lost.claimId, sourceMessageIndex: message.index, itemIndices,
      availability: itemIndices.length > 0 ? 'present' : review.status === 'failed' ? 'atomic-rejection' : 'source-selection-omission' };
  });
  const sourceAvailability = { unit: 'lost required decision', rows: sourceAvailabilityRows,
    counts: Object.fromEntries(['present', 'source-selection-omission', 'atomic-rejection'].map(label =>
      [label, sourceAvailabilityRows.filter(row => row.availability === label).length])),
    scope: 'Physical whole-user-message availability in candidate persisted receipt projections only; no semantic rescore or answer-recovery proof.' };
  return { score, stats, agreement, sourceAvailability, lossCategories: clone(accepted.lossCategories), resources: clone(accepted.resources),
    primarySemanticAudit: clone(accepted.primarySemanticAudit), decision: accepted.decision,
    scope: 'Mechanical replay of exact original supplied judgments and accepted measurements; no new semantic validation, provider work or cold-persistence run.' };
}

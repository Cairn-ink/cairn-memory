import { isDeepStrictEqual } from 'node:util';

const receiptFields = (receipt) => ['client', 'sessionId', 'eventId', 'role', 'excerpt']
  .map((field) => receipt?.[field]);

export function validateEvidence({ returned, readSet, currentRecords, trustedReceipts,
  forgottenIds = [] }) {
  const violations = [];
  for (const item of returned) {
    const memory = item?.memory;
    if (!readSet.some((namespace) => isDeepStrictEqual(namespace, memory?.namespace))) violations.push('foreign_namespace');
    if (forgottenIds.includes(memory?.id)) violations.push('forgotten_reference');
    const current = currentRecords.find((record) => record.memory.id === memory?.id &&
      isDeepStrictEqual(record.memory.namespace, memory?.namespace));
    if (!current || current.memory.revision !== memory?.revision || current.memory.content !== memory?.content) {
      violations.push('noncurrent_reference');
    }
    if (!Array.isArray(item?.receipts) || item.receipts.length === 0) violations.push('missing_source');
    for (const receipt of item?.receipts ?? []) {
      if (!trustedReceipts.some((trusted) => isDeepStrictEqual(receiptFields(trusted), receiptFields(receipt))) ||
          !current?.receipts.some((trusted) => trusted.id === receipt.id &&
            isDeepStrictEqual(receiptFields(trusted), receiptFields(receipt)))) violations.push('fabricated_source');
    }
  }
  return violations;
}

export function scoreQuery({ expectedIds, forbiddenIds = [], returnedIds = [],
  status = 'completed', semanticPending = false }) {
  const completed = status === 'completed';
  const expected = new Set(expectedIds);
  const returned = completed ? returnedIds : [];
  const relevant = semanticPending ? [] : returned.filter((id) => expected.has(id));
  return { hits: new Set(relevant).size, expected: expected.size,
    returned: returned.length, relevant: relevant.length,
    forbidden: returned.filter((id) => forbiddenIds.includes(id)).length,
    emptyExpected: expected.size === 0,
    emptyPassed: expected.size === 0 && completed && returned.length === 0 && !semanticPending,
    semanticPending };
}

const unique = (values) => new Set(values).size === values.length;
const record = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);

// Labels are supplied by a separate trusted reviewer, never requested from the
// evaluated model. This checks label coverage/identity, not reviewer honesty.
function inspectReview(fixture, run, review) {
  if (review === undefined) return { pending: true };
  try {
    if (!record(review) || !['agent', 'human'].includes(review.reviewerType) || !run) throw 0;
    const allowed = new Set(fixture.memories.map((memory) => memory.id));
    const factIds = (label) => {
      if (!Array.isArray(label.factIds) || !unique(label.factIds) ||
        label.factIds.some((id) => !allowed.has(id))) throw 0;
    };
    const cover = (labels, actual, booleanField) => {
      if (!Array.isArray(labels) || !Array.isArray(actual)) throw 0;
      const actualIds = actual.map((item) => item.memory?.id);
      const labelIds = labels.map((label) => label?.memoryId);
      if (!actualIds.every((id) => typeof id === 'string') || !unique(actualIds) || !unique(labelIds) ||
        actualIds.length !== labelIds.length || labelIds.some((id) => !actualIds.includes(id))) throw 0;
      for (const label of labels) {
        if (typeof label[booleanField] !== 'boolean') throw 0;
        factIds(label);
      }
    };
    if (fixture.organize && typeof review.mocCoherent !== 'boolean') throw 0;
    if (fixture.mode === 'capture') {
      cover(review.captured, run.captured, 'supported');
      if (!Array.isArray(review.queries) || review.queries.length !== fixture.queries.length ||
        !unique(review.queries.map((query) => query.id))) throw 0;
      for (const query of fixture.queries) {
        const labels = review.queries.find((item) => item.id === query.id);
        const actual = run.queries?.filter((item) => item.id === query.id) ?? [];
        if (!labels || actual.length !== 1 || actual[0].status !== 'completed') throw 0;
        cover(labels.items, actual[0].evidence, 'relevant');
        for (const label of labels.items) {
          const captured = review.captured.find((item) => item.memoryId === label.memoryId);
          if (!captured || label.factIds.some((id) => !captured.factIds.includes(id))) throw 0;
        }
      }
    } else if ((review.captured !== undefined && (!Array.isArray(review.captured) || review.captured.length)) ||
      (review.queries !== undefined && (!Array.isArray(review.queries) || review.queries.length))) throw 0;
    return { pending: false, review };
  } catch { return { pending: true, invalid: true }; }
}

function scoreReviewedQuery(query, actual, labels) {
  const found = new Set(labels.items.filter((item) => item.relevant).flatMap((item) => item.factIds));
  return { hits: query.expectedIds.filter((id) => found.has(id)).length,
    expected: query.expectedIds.length, returned: actual.evidence.length,
    relevant: labels.items.filter((item) => item.relevant).length,
    forbidden: labels.items.filter((item) => item.factIds.some((id) => query.forbiddenIds.includes(id))).length,
    emptyExpected: query.expectedIds.length === 0,
    emptyPassed: query.expectedIds.length === 0 && actual.evidence.length === 0,
    semanticPending: false };
}

export function summarizeEvaluation(corpus, results, reviews = {}) {
  let completedRuns = 0;
  let hits = 0; let expected = 0; let returned = 0; let relevant = 0;
  let deterministicHits = 0; let deterministicExpected = 0;
  let deterministicReturned = 0; let deterministicRelevant = 0;
  let zeroReturnQueries = 0; let emptyExpected = 0; let emptyPassed = 0;
  let safetyViolations = 0; let forbidden = 0; let semanticReviewPending = false;
  let resourceMissing = false; let maxRetainedBytes = 0; let peakRssBytes = 0;
  const recallTimes = [];
  let failedQueries = 0; let mocHits = 0; let mocExpected = 0;
  let captureRecovered = 0; let capturedClaims = 0; let unsupportedClaims = 0;
  let mocCoherenceFailed = false;
  const reviewErrors = [];
  const reviewerTypes = new Set();
  const allowedReviewKeys = new Set(corpus.flatMap((fixture) =>
    [1, 2, 3].map((repetition) => `${fixture.id}:${repetition}`)));
  if (!record(reviews)) { reviewErrors.push('invalid_review_container'); reviews = {}; }
  for (const key of Object.keys(reviews)) {
    if (!allowedReviewKeys.has(key)) reviewErrors.push('foreign_review_key');
  }
  const captureExpected = corpus.filter((fixture) => fixture.mode === 'capture')
    .reduce((total, fixture) => total + fixture.memories.filter((memory) => !memory.optional).length * 3, 0);
  for (const fixture of corpus) {
    for (let repetition = 1; repetition <= 3; repetition++) {
      const matches = results.filter((result) => result.caseId === fixture.id && result.repetition === repetition);
      const run = matches.length === 1 ? matches[0] : undefined;
      if (run?.status === 'completed') completedRuns++;
      const needsReview = fixture.mode === 'capture' || fixture.organize;
      const reviewKey = `${fixture.id}:${repetition}`;
      const checked = needsReview ? inspectReview(fixture, run, reviews[reviewKey]) : { pending: false };
      if (!needsReview && Object.hasOwn(reviews, reviewKey)) reviewErrors.push('unexpected_review');
      if (checked.invalid) reviewErrors.push('invalid_review_labels');
      if (checked.pending) semanticReviewPending = true;
      if (checked.review) reviewerTypes.add(checked.review.reviewerType);
      if (fixture.mode === 'capture') {
        capturedClaims += run?.captured?.length ?? 0;
        if (checked.review) {
          const supportedFacts = new Set(checked.review.captured.filter((label) => label.supported)
            .flatMap((label) => label.factIds));
          captureRecovered += fixture.memories.filter((memory) => !memory.optional && supportedFacts.has(memory.id)).length;
          unsupportedClaims += checked.review.captured.filter((label) => !label.supported).length;
        }
      }
      if (fixture.organize) {
        mocExpected += fixture.memories.length;
        const creditedIds = new Set();
        for (const memory of fixture.memories) {
          const id = run?.logicalIds?.[memory.id];
          const records = run?.organization?.records?.filter((item) => item.memory?.id === id) ?? [];
          if (typeof id === 'string' && !creditedIds.has(id) && records.length === 1 && records[0].memory.filing?.status === 'filed' &&
            run.organization.map?.items?.some((item) => item.type === 'ref' && item.ref?.childType === 'memory' &&
              item.ref.childId === id && item.ref.childRevision === records[0].memory.revision)) {
            mocHits++; creditedIds.add(id);
          }
        }
        if (checked.review?.mocCoherent === false) mocCoherenceFailed = true;
      }
      safetyViolations += run?.safetyViolations?.length ?? 0;
      if (!Number.isFinite(run?.resources?.retainedBytes) || !Number.isFinite(run?.resources?.peakRssBytes)) resourceMissing = true;
      else {
        maxRetainedBytes = Math.max(maxRetainedBytes, run.resources.retainedBytes);
        peakRssBytes = Math.max(peakRssBytes, run.resources.peakRssBytes);
      }
      for (const query of fixture.queries) {
        const actuals = run?.queries?.filter((item) => item.id === query.id) ?? [];
        const actual = actuals.length === 1 ? actuals[0] : undefined;
        const score = fixture.mode === 'capture' && checked.review ?
          scoreReviewedQuery(query, actual, checked.review.queries.find((item) => item.id === query.id)) :
          scoreQuery({ expectedIds: query.expectedIds, forbiddenIds: query.forbiddenIds,
          returnedIds: actual?.returnedIds ?? [], status: actual?.status ?? 'unrun',
          semanticPending: fixture.mode === 'capture' || actual?.semanticPending === true });
        hits += score.hits; expected += score.expected;
        returned += score.returned; relevant += score.relevant; forbidden += score.forbidden;
        if (score.returned === 0) zeroReturnQueries++;
        if (score.emptyExpected) { emptyExpected++; if (score.emptyPassed) emptyPassed++; }
        safetyViolations += actual?.safetyViolations?.length ?? 0;
        if (fixture.mode !== 'capture') {
          deterministicHits += score.hits; deterministicExpected += score.expected;
          deterministicReturned += score.returned; deterministicRelevant += score.relevant;
        }
        if (actual?.status !== 'completed' || !Number.isFinite(actual.elapsedMs)) failedQueries++;
        else recallTimes.push(actual.elapsedMs);
      }
    }
  }
  recallTimes.sort((a, b) => a - b);
  const p95RecallMs = recallTimes.length ? recallTimes[Math.ceil(recallTimes.length * 0.95) - 1] : null;
  const complete = completedRuns === corpus.length * 3;
  const deterministicPass = (deterministicExpected === 0 || deterministicHits / deterministicExpected >= 0.9) &&
    (deterministicReturned === 0 ? deterministicExpected === 0 : deterministicRelevant / deterministicReturned >= 0.9) &&
    emptyExpected === emptyPassed && mocHits === mocExpected && forbidden === 0;
  const reviewedQualityPass = (expected === 0 || hits / expected >= 0.9) &&
    (returned === 0 ? expected === 0 : relevant / returned >= 0.9) &&
    (captureExpected === 0 || captureRecovered / captureExpected >= 0.9) && unsupportedClaims === 0 && !mocCoherenceFailed;
  const resourcesPass = !resourceMissing && failedQueries === 0 && peakRssBytes <= 512 * 1024 * 1024 &&
    maxRetainedBytes <= 5 * 1024 * 1024 && p95RecallMs !== null && p95RecallMs <= 20000;
  return { complete, expectedRuns: corpus.length * 3, completedRuns,
    recall: { hits, expected, rate: expected ? hits / expected : null, provisional: semanticReviewPending },
    precision: { relevant, returned, rate: returned ? relevant / returned : null, zeroReturnQueries,
      provisional: semanticReviewPending },
    deterministicRecall: { hits: deterministicHits, expected: deterministicExpected },
    deterministicPrecision: { relevant: deterministicRelevant, returned: deterministicReturned },
    emptyQueries: { expected: emptyExpected, passed: emptyPassed },
    mocDiscoverability: { hits: mocHits, expected: mocExpected },
    captureRecovery: { expected: captureExpected, recovered: semanticReviewPending ? null : captureRecovered,
      reviewedRecovered: captureRecovered, capturedClaims, unsupportedClaims,
      sourceSupport: !captureExpected ? 'not_applicable' : unsupportedClaims ? 'failed' :
        semanticReviewPending ? 'pending_review' : 'passed' },
    reviewErrors, reviewerTypes: [...reviewerTypes].sort(),
    forbidden, safetyViolations, semanticReviewPending,
    resources: { peakRssBytes, maxRetainedBytes, p95RecallMs, failedQueries, pass: resourcesPass },
    status: safetyViolations || reviewErrors.length || unsupportedClaims || mocCoherenceFailed ? 'failed' :
      !complete ? 'incomplete' : !deterministicPass || !resourcesPass ? 'failed' :
        semanticReviewPending ? 'pending_review' : reviewedQualityPass ? 'passed' : 'failed' };
}

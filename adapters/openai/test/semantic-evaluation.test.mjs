import assert from 'node:assert/strict';
import test from 'node:test';
import { spawnSync } from 'node:child_process';
import { scoreQuery, summarizeEvaluation, validateEvidence } from '../../../evaluations/score.mjs';
import { runEvaluation } from '../../../evaluations/semantic-runner.mjs';
import { cases } from '../../../evaluations/semantic-cases.mjs';

const completedResults = (corpus = cases) => corpus.flatMap((entry) => [1, 2, 3].map((repetition) => ({
  caseId: entry.id, repetition, status: 'completed', semanticReview: 'not_required',
  queries: entry.queries.map((query) => ({ id: query.id, status: 'completed',
    returnedIds: [...query.expectedIds], semanticPending: false, elapsedMs: 10,
    safetyViolations: [], evidence: [] })),
  resources: { retainedBytes: 1024, peakRssBytes: 64 * 1024 * 1024 },
  accounting: { requestCount: 0, reservedUsd: 0 },
})));

// Hand-authored labels validate the review accounting machinery, not model quality.
const reviewedFixture = () => {
  const results = completedResults();
  const reviews = {};
  for (const run of results) {
    const fixture = cases.find((entry) => entry.id === run.caseId);
    const records = fixture.memories.map((memory) => ({ memory: {
      id: `${run.caseId}-${run.repetition}-${memory.id}`, content: memory.content,
      revision: 1, filing: { status: 'filed' },
    }, receipts: [] }));
    run.logicalIds = Object.fromEntries(fixture.memories.map((memory, index) => [memory.id, records[index].memory.id]));
    if (fixture.mode === 'capture') {
      run.captured = records;
      for (const query of run.queries) query.evidence = query.returnedIds.map((id) =>
        records.find(({ memory }) => memory.id === run.logicalIds[id]));
      reviews[`${run.caseId}:${run.repetition}`] = { reviewerType: 'agent',
        captured: records.map(({ memory }, index) => ({ memoryId: memory.id,
          supported: true, factIds: [fixture.memories[index].id] })),
        queries: run.queries.map((query) => ({ id: query.id, items: query.evidence.map(({ memory }) => ({
          memoryId: memory.id, relevant: true,
          factIds: [fixture.memories.find((item) => run.logicalIds[item.id] === memory.id).id],
        })) })),
      };
    }
    if (fixture.organize) {
      run.organization = { records, map: { items: records.map(({ memory }, index) => ({
        type: 'ref', ref: { childType: 'memory', childId: memory.id, childRevision: memory.revision,
          parentId: index < 2 ? 'incident-group' : 'cooking-group', parentRevision: 1 },
      })) } };
      reviews[`${run.caseId}:${run.repetition}`] = { reviewerType: 'agent', mocCoherent: true };
    }
  }
  return { results, reviews };
};

test('complete independently labelled evidence resolves pending capture and MOC gates', () => {
  const { results, reviews } = reviewedFixture();
  const summary = summarizeEvaluation(cases, results, reviews);
  assert.equal(summary.status, 'passed', JSON.stringify(summary));
  assert.equal(summary.recall.hits, 45);
  assert.equal(summary.captureRecovery.expected, 24);
  assert.equal(summary.captureRecovery.recovered, 24);
  assert.deepEqual(summary.mocDiscoverability, { hits: 12, expected: 12 });
});

test('missing, duplicate, foreign and self-grading review labels cannot pass', () => {
  for (const mutate of [
    ({ reviews }) => { delete reviews['C01-editor-preference:1']; },
    ({ reviews }) => { const labels = reviews['C01-editor-preference:1'].captured; labels.push(structuredClone(labels[0])); },
    ({ reviews }) => { reviews['not-a-case:1'] = { reviewerType: 'agent' }; },
    ({ reviews }) => { reviews['C01-editor-preference:1'].captured[0].memoryId = 'foreign-memory'; },
    ({ reviews }) => { reviews['C01-editor-preference:1'].captured[0].factIds = ['foreign-fact']; },
    ({ reviews }) => { const label = reviews['C01-editor-preference:1'].captured[0]; label.factIds.push(label.factIds[0]); },
    ({ reviews }) => { reviews['C01-editor-preference:1'].queries[0].items[0].memoryId = 'foreign-query-memory'; },
    ({ reviews }) => { const labels = reviews['C01-editor-preference:1'].queries; labels.push(structuredClone(labels[0])); },
    ({ reviews }) => { reviews['C01-editor-preference:1'].reviewerType = 'evaluated-model'; },
  ]) {
    const input = reviewedFixture(); mutate(input);
    assert.notEqual(summarizeEvaluation(cases, input.results, input.reviews).status, 'passed');
  }
});

test('reviewed capture recovery and relevance retain the frozen ninety-percent gates', () => {
  const recovery = reviewedFixture();
  for (const repetition of [1, 2, 3]) {
    recovery.reviews[`C01-editor-preference:${repetition}`].captured
      .find((label) => label.factIds.includes('language-go')).factIds = [];
  }
  const lostFacts = summarizeEvaluation(cases, recovery.results, recovery.reviews);
  assert.equal(lostFacts.captureRecovery.expected, 24);
  assert.equal(lostFacts.captureRecovery.recovered, 21);
  assert.equal(lostFacts.status, 'failed');
  const relevance = reviewedFixture();
  for (const review of Object.values(relevance.reviews)) {
    for (const query of review.queries ?? []) for (const item of query.items) item.relevant = false;
  }
  const irrelevant = summarizeEvaluation(cases, relevance.results, relevance.reviews);
  assert.equal(irrelevant.recall.hits, 33);
  assert.ok(irrelevant.precision.rate < 0.9);
  assert.equal(irrelevant.status, 'failed');
  const organization = reviewedFixture();
  organization.reviews['C04-topic-organization:1'].mocCoherent = false;
  assert.equal(summarizeEvaluation(cases, organization.results, organization.reviews).status, 'failed');
});

test('independent approval cannot override hard safety or unsupported captured sources', () => {
  for (const mutate of [
    ({ results }) => { results[0].queries[0].safetyViolations = ['fabricated_source']; },
    ({ reviews }) => { reviews['C01-editor-preference:1'].captured[0].supported = false; },
  ]) {
    const input = reviewedFixture(); mutate(input);
    assert.equal(summarizeEvaluation(cases, input.results, input.reviews).status, 'failed');
  }
});

test('MOC discoverability requires current filed map references, not recall hits or approval alone', () => {
  for (const mutate of [
    (run) => { run.organization.map.items = []; },
    (run) => { run.organization.records[0].memory.filing.status = 'unfiled'; },
    (run) => { run.organization.map.items[0].ref.childRevision = 0; },
    (run) => { run.organization.map.items[0].ref.childId = 'foreign-child'; },
  ]) {
    const input = reviewedFixture();
    mutate(input.results.find((run) => run.caseId === 'C04-topic-organization'));
    const summary = summarizeEvaluation(cases, input.results, input.reviews);
    assert.equal(summary.recall.hits, 45);
    assert.equal(summary.mocDiscoverability.expected, 12);
    assert.ok(summary.mocDiscoverability.hits < 12);
    assert.equal(summary.status, 'failed');
  }
});

test('capture recovery denominator cannot lose failed or unrun cases during review', () => {
  for (const status of ['failed', 'unrun']) {
    const input = reviewedFixture();
    input.results[0].status = status;
    input.results[0].captured = [];
    input.results[0].queries = [];
    delete input.reviews['C01-editor-preference:1'];
    const summary = summarizeEvaluation(cases, input.results, input.reviews);
    assert.equal(summary.captureRecovery.expected, 24);
    assert.notEqual(summary.status, 'passed');
  }
});

test('frozen corpus fixes 36 repetitions and recall denominator even when nothing ran', () => {
  assert.equal(cases.length, 12);
  const expected = cases.reduce((sum, entry) => sum + entry.queries.reduce((n, query) => n + query.expectedIds.length, 0), 0) * 3;
  assert.equal(expected, 45);
  const summary = summarizeEvaluation(cases, []);
  assert.equal(summary.expectedRuns, 36);
  assert.equal(summary.completedRuns, 0);
  assert.equal(summary.recall.expected, expected);
  assert.equal(summary.recall.hits, 0);
  assert.equal(summary.complete, false);
  assert.equal(summary.status, 'incomplete');
});

test('missing and failed repetitions keep all expected positives in the denominator', () => {
  for (const mode of ['missing', 'failed', 'unrun', 'duplicate']) {
    const results = completedResults();
    if (mode === 'missing') results.shift();
    else if (mode === 'duplicate') results[0] = structuredClone(results[1]);
    else results[0].status = mode;
    const summary = summarizeEvaluation(cases, results);
    assert.equal(summary.recall.expected, 45, mode);
    assert.ok(summary.recall.hits < 45, mode);
    assert.equal(summary.complete, false, mode);
    assert.notEqual(summary.status, 'passed', mode);
  }
});

test('semantic and source review remains pending despite perfect ID overlap', () => {
  const results = completedResults();
  results[0].semanticReview = 'pending';
  results[0].queries[0].semanticPending = true;
  const summary = summarizeEvaluation(cases, results);
  assert.ok(summary.semanticReviewPending);
  assert.notEqual(summary.status, 'passed');
});

test('a single safety violation prevents passing otherwise perfect recall', () => {
  const results = completedResults();
  results[0].queries[0].safetyViolations = ['foreign_namespace'];
  const summary = summarizeEvaluation(cases, results);
  assert.equal(summary.recall.hits, 33); // Capture entailment cannot be pre-approved by this mock.
  assert.ok(summary.safetyViolations > 0);
  assert.equal(summary.status, 'failed');
});

test('irrelevant returns and nonempty unrelated queries cannot hide behind perfect recall', () => {
  const results = completedResults();
  for (const result of results) for (const query of result.queries) query.returnedIds.push('irrelevant');
  const summary = summarizeEvaluation(cases, results);
  assert.equal(summary.recall.hits, 33);
  assert.ok(summary.precision.rate < 0.9);
  assert.ok(summary.emptyQueries.passed < summary.emptyQueries.expected);
  assert.equal(summary.status, 'failed');
});

test('resource ceilings gate complete results independently from relevance', () => {
  for (const field of ['retainedBytes', 'peakRssBytes']) {
    const { results, reviews } = reviewedFixture();
    results[0].resources[field] = 1024 * 1024 * 1024;
    assert.equal(summarizeEvaluation(cases, results, reviews).status, 'failed', field);
  }
  const { results, reviews } = reviewedFixture();
  for (const result of results) for (const query of result.queries) query.elapsedMs = 21000;
  assert.equal(summarizeEvaluation(cases, results, reviews).status, 'failed');
});

test('complete deterministic fixtures can pass but captured facts still await independent review', () => {
  const deterministic = cases.filter((entry) => entry.mode !== 'capture' && !entry.organize);
  assert.equal(summarizeEvaluation(deterministic, completedResults(deterministic)).status, 'passed');
  const summary = summarizeEvaluation(cases, reviewedFixture().results);
  assert.equal(summary.status, 'pending_review');
  assert.equal(summary.captureRecovery.expected, 24);
  assert.equal(summary.captureRecovery.recovered, null);
});

test('query scoring counts missed targets and irrelevant or forbidden returns independently', () => {
  const score = scoreQuery({ expectedIds: ['wanted-a', 'wanted-b'], forbiddenIds: ['forbidden'],
    returnedIds: ['wanted-a', 'distractor', 'forbidden'] });
  assert.equal(score.hits, 1);
  assert.equal(score.expected, 2);
  assert.equal(score.relevant, 1);
  assert.equal(score.returned, 3);
  assert.equal(score.forbidden, 1);
});

test('failed query keeps its fixed recall denominator and cannot earn hits', () => {
  const score = scoreQuery({ expectedIds: ['wanted'], forbiddenIds: [],
    returnedIds: ['wanted'], status: 'failed' });
  assert.equal(score.expected, 1);
  assert.equal(score.hits, 0);
});

test('empty-return queries distinguish a valid empty answer from missing positive evidence', () => {
  const positive = scoreQuery({ expectedIds: ['wanted'], forbiddenIds: [], returnedIds: [] });
  assert.equal(positive.hits, 0);
  assert.equal(positive.expected, 1);
  assert.equal(positive.returned, 0);
  const empty = scoreQuery({ expectedIds: [], forbiddenIds: ['forgotten'], returnedIds: [] });
  assert.equal(empty.emptyExpected, true);
  assert.equal(empty.emptyPassed, true);
  const violated = scoreQuery({ expectedIds: [], forbiddenIds: ['forgotten'], returnedIds: ['forgotten'] });
  assert.equal(violated.emptyPassed, false);
  assert.equal(violated.forbidden, 1);
});

test('unknown semantic entailment stays pending rather than silently confirmed', () => {
  const score = scoreQuery({ expectedIds: ['wanted'], forbiddenIds: [], returnedIds: [], semanticPending: true });
  assert.equal(score.semanticPending, true);
  assert.equal(score.hits, 0);
  assert.equal(score.expected, 1);
});

const namespace = { ownerId: 'synthetic-a', scope: 'personal', projectId: null };
const receipt = { id: 'receipt-a', client: 'synthetic-eval', sessionId: 'session-a',
  eventId: 'event-a', role: 'user', excerpt: 'Use Neovim.' };
const record = { memory: { id: 'memory-a', namespace, revision: 2, content: 'Use Neovim.',
  kind: 'preference' }, receipts: [receipt] };
const evidenceInput = () => ({ returned: [structuredClone(record)], readSet: [namespace],
  currentRecords: [structuredClone(record)], trustedReceipts: [receipt], forgottenIds: [] });

test('current in-scope memory with exact trusted provenance passes evidence checks', () => {
  assert.deepEqual(validateEvidence(evidenceInput()), []);
});

test('every returned memory is validated, including a non-target foreign owner or project', () => {
  for (const foreign of [{ ...namespace, ownerId: 'synthetic-b' },
    { ...namespace, scope: 'project', projectId: 'harbor' }]) {
    const input = evidenceInput();
    input.returned.push({ ...structuredClone(record), memory: { ...record.memory, id: 'other', namespace: foreign } });
    assert.ok(validateEvidence(input).length > 0);
  }
});

test('stale revisions, changed content, absent current records and forgotten references fail safety', () => {
  for (const mutate of [
    (input) => { input.returned[0].memory.revision = 1; },
    (input) => { input.returned[0].memory.content = 'Use VS Code.'; },
    (input) => { input.currentRecords = []; },
    (input) => { input.forgottenIds = ['memory-a']; },
  ]) {
    const input = evidenceInput(); mutate(input);
    assert.ok(validateEvidence(input).length > 0);
  }
});

test('receipt validation binds every trusted provenance field and rejects missing receipts', () => {
  for (const field of ['client', 'sessionId', 'eventId', 'role', 'excerpt']) {
    const input = evidenceInput();
    input.returned[0].receipts[0][field] = 'fabricated-value';
    assert.ok(validateEvidence(input).length > 0, field);
  }
  const input = evidenceInput(); input.returned[0].receipts = [];
  assert.ok(validateEvidence(input).length > 0);
});

test('evaluation CLI has no implicit opt-in and never prints inherited credentials', () => {
  const script = new URL('../../../examples/semantic-evaluation.mjs', import.meta.url).pathname;
  for (const args of [[], ['--live'], ['--live', '--budget-usd', '0'],
    ['--live', '--budget-usd', '4.81'], ['--live', '--budget-usd', 'NaN']]) {
    const result = spawnSync(process.execPath, [script, ...args], {
      env: { PATH: process.env.PATH, OPENAI_API_KEY: 'synthetic-evaluation-secret' },
      encoding: 'utf8', timeout: 5000 });
    assert.equal(result.error, undefined);
    assert.notEqual(result.status, 0);
    assert.doesNotMatch(result.stdout + result.stderr, /synthetic-evaluation-secret/);
  }
});

test('evaluation tiny aggregate budget permits no request and retains all 36 expected repetitions', async () => {
  let calls = 0;
  const report = await runEvaluation({ apiKey: 'synthetic-evaluation-secret', budgetUsd: 0.000001,
    fetchImpl: async () => { calls++; throw new Error('must not send'); } });
  assert.equal(calls, 0);
  assert.equal(report.reservedUsd, 0);
  assert.equal(report.results.length, 36);
  assert.equal(report.summary.expectedRuns, 36);
  assert.equal(report.summary.complete, false);
  assert.equal(report.summary.status, 'incomplete');
  assert.doesNotMatch(JSON.stringify(report), /synthetic-evaluation-secret|must not send/);
});

test('failed HTTP reserves aggregate cost once then records later repetitions unrun', async () => {
  let calls = 0;
  const report = await runEvaluation({ apiKey: 'synthetic-evaluation-secret', budgetUsd: 0.005,
    fetchImpl: async () => { calls++; return new Response('{"error":"sensitive-provider-body"}', { status: 401 }); } });
  assert.equal(calls, 1);
  assert.ok(report.reservedUsd > 0 && report.reservedUsd <= 0.005);
  assert.equal(report.results.length, 36);
  assert.equal(report.summary.status, 'incomplete');
  assert.ok(report.results.some((result) => result.status === 'failed'));
  assert.ok(report.results.some((result) => result.status === 'unrun'));
  assert.doesNotMatch(JSON.stringify(report), /synthetic-evaluation-secret|sensitive-provider-body/);
});

test('malformed response is retained as failed evidence without leaking its body', async () => {
  const report = await runEvaluation({ apiKey: 'synthetic-evaluation-secret', budgetUsd: 0.005,
    fetchImpl: async () => new Response('{"object":"wrong","secret":"raw-secret"}') });
  assert.equal(report.summary.status, 'incomplete');
  assert.ok(report.results.some((result) => result.status === 'failed'));
  assert.ok(report.reservedUsd > 0);
  assert.doesNotMatch(JSON.stringify(report), /raw-secret|synthetic-evaluation-secret/);
});

test('fake HTTP exercises all 36 fresh states with fixture namespaces and per-case request caps', async () => {
  let calls = 0;
  let inFlight = 0;
  let maximumInFlight = 0;
  const report = await runEvaluation({ apiKey: 'synthetic-evaluation-secret', budgetUsd: 4.8,
    fetchImpl: async (url, options) => {
      calls++; inFlight++; maximumInFlight = Math.max(maximumInFlight, inFlight);
      await Promise.resolve(); inFlight--;
      const payload = JSON.parse(options.body);
      if (url.endsWith('/input_tokens')) return Response.json({ object: 'response.input_tokens', input_tokens: 100 });
      const input = JSON.parse(payload.input[0].content[0].text);
      let output;
      switch (payload.text.format.name) {
        case 'cairn_extract':
          output = { items: input.messages.map((message) => ({ content: message.content,
            kind: 'fact', confidence: 0.9, sourceIndices: [message.index] })) }; break;
        case 'cairn_classify':
          output = { items: input.memories.map((memory) => ({ memoryId: memory.id, parentIds: [] })) }; break;
        case 'cairn_select':
          output = { refs: input.maps.flatMap(({ namespaceIndex, items }) => items
            .filter((item) => item.type === 'unfiled').map((item) => ({ namespaceIndex, ...item.ref }))) }; break;
        case 'cairn_rank':
          output = { refs: input.candidates.map(({ namespaceIndex, memory }) => ({
            namespaceIndex, memoryId: memory.id, revision: memory.revision })) }; break;
        default: throw new Error('unexpected-model-method');
      }
      return Response.json({ object: 'response', model: payload.model, status: 'completed', error: null,
        incomplete_details: null, output: [{ type: 'message', role: 'assistant', status: 'completed',
          content: [{ type: 'output_text', text: JSON.stringify(output) }] }],
        usage: { input_tokens: 100, output_tokens: 100, total_tokens: 200 } });
    } });
  assert.equal(report.results.length, 36);
  assert.equal(report.summary.completedRuns, 36, JSON.stringify(report.results.filter((run) => run.status !== 'completed')));
  assert.equal(new Set(report.results.map((run) => run.databasePath)).size, 36);
  assert.equal(maximumInFlight, 1);
  assert.equal(calls, report.results.reduce((sum, run) => sum + run.accounting.requestCount, 0));
  assert.ok(report.reservedUsd <= 4.8);
  assert.ok(report.results.every((run) => run.accounting.maxRequests === 40 && run.accounting.requestCount <= 40));
  for (const run of report.results.filter((result) => result.caseId === 'C02-source-attribution')) {
    assert.ok(run.captured.every(({ memory }) => memory.namespace.scope === 'project'));
    assert.ok(run.queries[0].evidence.length > 0);
  }
  for (const run of report.results.filter((result) => result.caseId === 'C04-topic-organization')) {
    assert.equal(run.classificationStatus, 'applied');
  }
  assert.notEqual(report.summary.status, 'passed'); // Indiscriminate retrieval is not a quality oracle.
  assert.doesNotMatch(JSON.stringify(report), /synthetic-evaluation-secret/);
});

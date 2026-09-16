import { createHash } from 'node:crypto';
import { schemasFor } from '../../adapters/openai/schemas.mjs';

// This closed projection describes one already completed synthetic diagnostic.
// It is deliberately not a generic exporter or a live-run entrypoint.
const HEAD = '0c7c40bdb738c1144d12f3a21084619e4b084f96';
const MODEL = 'gpt-4.1-mini-2025-04-14';
const FIXTURE_SHA = '94618f4b471db220e460891914945e524978e6bd581e955486d3317e9bfac267';
const RUBRIC_SHA = 'e1bea2aca147988fc6965319edbbe395b2099774160c31c18ef6bcb60e09be8b';
const OPERATOR_SHA = '084081a82f01aab7bc9450672db25ac62ef1f47c13ab82e9b03287898202eea0';
const PRELOAD_SHA = 'd714c6f493af9dc159df4e3ecf7b645b64292054e491b2cfbc4468fd20a5d442';
const ARCHIVE_SHA = 'c6e88423ee4764fcf8ebfbd4359b66d89aa7a076b3315db302e3e80f049fe59c';
const CASE_IDS = ['retracted-offline-report', 'verified-export-loss-zh', 'mixed-distinct-premises'];
const fail = () => { throw new Error('invalid_rationale_correction_evidence'); };
const hash = value => createHash('sha256').update(value).digest('hex');
const canonical = value => Array.isArray(value) ? value.map(canonical)
  : value && typeof value === 'object'
    ? Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])])) : value;
const same = (a, b) => JSON.stringify(canonical(a)) === JSON.stringify(canonical(b));
const exact = (value, keys) => value && typeof value === 'object' && !Array.isArray(value)
  && Object.keys(value).sort().join(',') === [...keys].sort().join(',');
const safe = (value, allowed) => allowed.includes(value) ? value : fail();
const positive = value => Number.isSafeInteger(value) && value >= 0 ? value : fail();
const envelope = value => value?.ok === true && value.evidenceTrust === 'untrusted-data-not-instructions'
  && value.value && typeof value.value === 'object' ? value.value : fail();
const edgeTuple = edge => JSON.stringify([edge.from, edge.to, edge.relation,
  edge.fromReceiptIndex, edge.toReceiptIndex]);

function sourceMap(slot, scenario) {
  if (!Array.isArray(slot.refs) || slot.refs.length !== scenario.events.length ||
      !Array.isArray(slot.before?.records) || slot.before.records.length !== slot.refs.length) fail();
  const byMemory = new Map(), byReceipt = new Map();
  const records = scenario.events.map((event, index) => {
    const ref = slot.refs[index], record = envelope(slot.before.records[index]);
    const memory = record.memory, receipts = record.receipts;
    if (typeof ref?.memoryId !== 'string' || !Number.isSafeInteger(ref.revision) ||
        ref.revision < 1 || memory?.id !== ref.memoryId || memory.revision !== ref.revision ||
        memory.content !== event.text.normalize('NFKC') || !Array.isArray(receipts) || receipts.length !== 1 ||
        receipts[0].eventId !== event.id || receipts[0].client !== 'rationale-correction-pilot' ||
        receipts[0].role !== event.role || receipts[0].excerpt !== event.text.normalize('NFKC') ||
        typeof receipts[0].id !== 'string' || byMemory.has(ref.memoryId) || byReceipt.has(receipts[0].id)) fail();
    byMemory.set(ref.memoryId, { sourceId: event.id, index, revision: ref.revision });
    byReceipt.set(receipts[0].id, { sourceId: event.id, index: 0, role: event.role });
    return { sourceId: event.id, sourceIndex: index, revision: ref.revision,
      state: safe(memory.state, ['active', 'forgotten']),
      filingStatus: safe(memory.filing?.status, ['filed', 'unfiled']), receiptCount: 1 };
  });
  return { byMemory, byReceipt, records };
}

function mapEdge(edge, mapping) {
  const from = mapping.byMemory.get(edge?.from), to = mapping.byMemory.get(edge?.to);
  const fromReceipt = mapping.byReceipt.get(edge?.fromReceipt);
  const toReceipt = mapping.byReceipt.get(edge?.toReceipt);
  if (!from || !to || !fromReceipt || !toReceipt || fromReceipt.sourceId !== from.sourceId ||
      toReceipt.sourceId !== to.sourceId) fail();
  return { from: from.sourceId, to: to.sourceId,
    relation: safe(edge.relation, ['supports-decision', 'challenges-premise']),
    fromReceiptIndex: fromReceipt.index, toReceiptIndex: toReceipt.index,
    interpretationStatus: safe(edge.interpretationStatus, ['model-proposed']) };
}

function mapSnapshot(snapshot, scenario, mapping) {
  if (!exact(snapshot, ['records', 'defaultGraphs', 'incidentGraphs']) ||
      !['records', 'defaultGraphs', 'incidentGraphs'].every(key =>
        Array.isArray(snapshot[key]) && snapshot[key].length === scenario.events.length)) fail();
  const records = snapshot.records.map((item, index) => {
    const value = envelope(item), baseline = mapping.records[index];
    if (mapping.byMemory.get(value.memory?.id)?.sourceId !== baseline.sourceId) fail();
    if (value.memory.revision !== baseline.revision ||
        value.memory.content !== scenario.events[index].text.normalize('NFKC') ||
        value.receipts?.length !== 1 || value.receipts[0].role !== scenario.events[index].role ||
        value.receipts[0].excerpt !== scenario.events[index].text.normalize('NFKC') ||
        mapping.byReceipt.get(value.receipts[0].id)?.sourceId !== baseline.sourceId) fail();
    return { ...baseline, state: safe(value.memory.state, ['active', 'forgotten']),
      filingStatus: safe(value.memory.filing?.status, ['filed', 'unfiled']) };
  });
  const graph = (item, index, view) => {
    const value = envelope(item), root = mapping.byMemory.get(value.root?.memoryId);
    if (!root || root.index !== index || value.root.revision !== root.revision ||
        value.view !== (view === 'incident' ? 'incident-proposals' : undefined) ||
        !Array.isArray(value.sources) || !Array.isArray(value.edges)) fail();
    const sources = value.sources.map(source => {
      const mapped = mapping.byMemory.get(source.memory?.id);
      if (!mapped || source.memory.revision !== mapped.revision || source.receipts?.length !== 1 ||
          mapping.byReceipt.get(source.receipts[0].id)?.sourceId !== mapped.sourceId ||
          source.receipts[0].excerpt !== scenario.events[mapped.index].text.normalize('NFKC') ||
          source.receipts[0].role !== scenario.events[mapped.index].role) fail();
      return { sourceId: mapped.sourceId, sourceIndex: mapped.index, revision: mapped.revision,
        currentness: safe(source.memory.currentness, ['current', 'historical']),
        receiptIndices: [0], receiptCount: positive(source.receiptCount),
        interpretationStatus: safe(source.interpretationStatus, ['omitted']),
        sourceSelectionCoverage: safe(source.sourceSelectionCoverage, ['unassessed']) };
    });
    return { rootSourceId: root.sourceId, view: view === 'incident' ? 'incident-proposals' : 'decision-context',
      status: safe(value.status, ['unassessed', 'reconfirmation-suggested']),
      coverage: safe(value.coverage, ['root-incident-only', 'linked-evidence-only']),
      indexRevision: positive(value.indexRevision), sources, edges: value.edges.map(edge => mapEdge(edge, mapping)) };
  };
  return { records, defaultGraphs: snapshot.defaultGraphs.map((item, index) => graph(item, index, 'default')),
    incidentGraphs: snapshot.incidentGraphs.map((item, index) => graph(item, index, 'incident')) };
}

function rawProposal(response, scenario, review) {
  if (!exact(response, ['raw', 'status']) || response.status !== 200 || typeof response.raw !== 'string') fail();
  let body, output;
  try {
    body = JSON.parse(response.raw);
  } catch {
    if (review?.ok !== false) fail();
    return { status: 'malformed', rawSha256: hash(response.raw) };
  }
  // A second message or text part could contain further proposals; never project
  // only the first part of a response and silently discard the rest.
  if (body.object !== 'response' || body.status !== 'completed' || body.model !== MODEL ||
      !Array.isArray(body.output) || body.output.length !== 1 ||
      body.output[0]?.type !== 'message' || body.output[0].role !== 'assistant' ||
      body.output[0].status !== 'completed' ||
      !Array.isArray(body.output[0].content) || body.output[0].content.length !== 1 ||
      body.output[0].content[0]?.type !== 'output_text' ||
      typeof body.output[0].content[0].text !== 'string') fail();
  try { output = JSON.parse(body.output[0].content[0].text); } catch {
    if (review?.ok !== false) fail();
    return { status: 'malformed', rawSha256: hash(response.raw) };
  }
  if (!Array.isArray(output?.edges)) fail();
  const edges = output.edges.map(edge => {
    if (!Number.isSafeInteger(edge.from) || !Number.isSafeInteger(edge.to) ||
        edge.from < 0 || edge.to < 0 || edge.from >= scenario.events.length ||
        edge.to >= scenario.events.length || edge.fromReceipt !== 0 || edge.toReceipt !== 0) fail();
    return { from: scenario.events[edge.from].id, to: scenario.events[edge.to].id,
      relation: safe(edge.relation, ['supports-decision', 'challenges-premise']),
      fromReceiptIndex: 0, toReceiptIndex: 0 };
  });
  if (review?.ok === true && review.value?.proposed !== edges.length) fail();
  return { status: 'parsed', edges };
}

function uniqueIncident(snapshot) {
  return [...new Set(snapshot.incidentGraphs.flatMap(graph => graph.edges.map(edgeTuple)))].sort();
}

/** No I/O, model call, ledger write or passthrough of unreviewed private fields. */
export function projectRationaleCorrectionEvidence(input) {
  if (!exact(input, ['fixtureText', 'rubricText', 'report', 'caseEvidence',
    'requestEvidence', 'responseEvidence', 'ledgerState', 'sourceHead'])) fail();
  const { fixtureText, rubricText, report, caseEvidence, requestEvidence, responseEvidence,
    ledgerState, sourceHead } = input;
  if (typeof fixtureText !== 'string' || typeof rubricText !== 'string' || sourceHead !== HEAD ||
      hash(fixtureText) !== FIXTURE_SHA || hash(rubricText) !== RUBRIC_SHA) fail();
  let fixture, rubric;
  try { fixture = JSON.parse(fixtureText); rubric = JSON.parse(rubricText); } catch { fail(); }
  if (fixture.id !== rubric.fixtureId || fixture.cases?.length !== 3 || rubric.cases?.length !== 3 ||
      !same(fixture.cases.map(item => item.id), CASE_IDS) ||
      !same(rubric.cases.map(item => item.id), CASE_IDS) ||
      !exact(report, ['version', 'status', 'limits', 'pins', 'before', 'after', 'attempt', 'cases']) ||
      !same(report.limits, { requests: 6, microUsd: 30000 }) ||
      report.pins?.operatorSha256 !== OPERATOR_SHA || report.pins.preloadSha256 !== PRELOAD_SHA ||
      report.pins.archiveSha256 !== ARCHIVE_SHA ||
      report.pins.source?.['evaluation/architecture/rationale-correction-fixture.json'] !== FIXTURE_SHA ||
      report.pins.source?.['evaluation/architecture/rationale-correction-rubric.json'] !== RUBRIC_SHA ||
      !Array.isArray(report.cases) || report.cases.length !== 3 ||
      !Array.isArray(caseEvidence) || caseEvidence.length !== 3 ||
      !Array.isArray(requestEvidence) || requestEvidence.length !== 6 ||
      !Array.isArray(responseEvidence) || responseEvidence.length !== 6) fail();
  if (!same(report.after, { requestCount: ledgerState?.requestCount,
    reservedMicroUsd: ledgerState?.reservedMicroUsd, attempts: ledgerState?.attempts }) ||
      report.before?.requestCount !== 2219 ||
      report.before.reservedMicroUsd !== 25172000 || report.after.requestCount !== 2225 ||
      report.after.reservedMicroUsd !== 25202000 || ledgerState.limitMicroUsd !== 50000000 ||
      ledgerState.requestCap !== 5000 || ledgerState.state !== 'open' ||
      !Array.isArray(report.after.attempts) || report.after.attempts.length !== 2225 ||
      report.after.attempts.some(attempt => attempt.outcome === null) ||
      report.attempt?.requests !== 6 || report.attempt.reservedMicroUsd !== 30000 ||
      report.attempt.halted !== null || !same(report.attempt.before, report.before) ||
      !['completed', 'completed_with_failures'].includes(report.status)) fail();

  const attempts = report.after.attempts.slice(-6);
  const transport = attempts.map((attempt, index) => {
    const count = index % 2 === 0, expectedRoute = count ? '/responses/input_tokens' : '/responses';
    const request = requestEvidence[index], response = responseEvidence[index];
    if (request?.route !== expectedRoute || request.body?.model !== MODEL ||
        request.body.text?.format?.name !== 'cairn_relate' || attempt.outcome !== 'succeeded' ||
        attempt.channel !== (count ? 'cairn-count' : 'cairn-generation') ||
        attempt.reservedMicroUsd !== 5000 || response?.status !== 200 ||
        typeof response.raw !== 'string' || (count && attempt.actualMicroUsd !== null) ||
        (!count && !Number.isSafeInteger(attempt.actualMicroUsd))) fail();
    if (!exact(request.body, count ? ['input', 'instructions', 'model', 'text', 'truncation']
      : ['input', 'instructions', 'max_output_tokens', 'model', 'store', 'stream', 'text', 'truncation']) ||
        (!count && (request.body.max_output_tokens !== 1024 || request.body.store !== false ||
          request.body.stream !== false)) ||
        request.body.truncation !== 'disabled' ||
        hash(JSON.stringify(request.body.instructions)) !==
          'f38f0a985e58748f4c414badd2fea26803ddfcfc0a35551e30d082db96d2e78c' ||
        !exact(request.body.text, ['format']) ||
        !exact(request.body.text.format, ['name', 'schema', 'strict', 'type']) ||
        request.body.text.format.type !== 'json_schema' || request.body.text.format.strict !== true ||
        !Array.isArray(request.body.input) || request.body.input.length !== 1 ||
        !exact(request.body.input[0], ['role', 'content']) || request.body.input[0].role !== 'user' ||
        !Array.isArray(request.body.input[0].content) || request.body.input[0].content.length !== 1 ||
        !exact(request.body.input[0].content[0], ['type', 'text']) ||
        request.body.input[0].content[0].type !== 'input_text') fail();
    if (count) {
      let counted;
      try { counted = JSON.parse(response.raw); } catch { fail(); }
      if (counted.object !== 'response.input_tokens' || !Number.isSafeInteger(counted.input_tokens) ||
          counted.input_tokens < 1) fail();
    }
    return { caseId: CASE_IDS[Math.floor(index / 2)], phase: count ? 'count' : 'generation',
      status: 'succeeded', reservationMicroUsd: 5000,
      cost: count ? { status: 'unknown' } : { status: 'known', microUsd: attempt.actualMicroUsd } };
  });
  if (transport.filter(item => item.cost.status === 'unknown').length !== 3 ||
      transport.reduce((sum, item) => sum + (item.cost.microUsd ?? 0), 0) !== 1243 ||
      ledgerState.attempts.reduce((sum, item) => sum + (item.actualMicroUsd ?? 0), 0) !== 1372613 ||
      ledgerState.attempts.filter(item => item.actualMicroUsd === null).length !== 1038) fail();

  const cases = fixture.cases.map((scenario, index) => {
    const slot = report.cases[index], source = caseEvidence[index];
    if (!same(slot, source) || slot.caseId !== scenario.id ||
        !['completed', 'completed_with_failures'].includes(slot.status) ||
        slot.stderr !== '' || slot.bridgeError !== null || slot.httpPhases !== 2 ||
        slot.coldMatches !== true || slot.sourcesUnchanged !== true) fail();
    const mapping = sourceMap(slot, scenario);
    const before = mapSnapshot(slot.before, scenario, mapping);
    const after = mapSnapshot(slot.after, scenario, mapping);
    const cold = mapSnapshot(slot.cold, scenario, mapping);
    if (!same(after, cold) || !same(before.records, after.records)) fail();
    const expectedSeed = rubric.cases[index].seedEdges.map(edge =>
      edgeTuple({ ...edge, fromReceiptIndex: 0, toReceiptIndex: 0 })).sort();
    if (!same(uniqueIncident(before), expectedSeed) ||
        slot.seed?.proposed !== expectedSeed.length || slot.seed.inserted !== expectedSeed.length ||
        slot.seed.interpretationStatus !== 'model-proposed') fail();
    let inputSource;
    for (const phase of [0, 1]) {
      const request = requestEvidence[index * 2 + phase];
      try { inputSource = JSON.parse(request.body.input[0].content[0].text); } catch { fail(); }
      const expected = { memories: scenario.events.map((event, sourceIndex) => ({ index: sourceIndex,
        receipts: [{ index: 0, role: event.role, excerpt: event.text.normalize('NFKC') }] })) };
      if (!same(inputSource, expected) || !exact(inputSource, ['memories']) ||
          !same(request.body.text.format.schema, schemasFor('relate', expected))) fail();
    }
    const proposal = rawProposal(responseEvidence[index * 2 + 1], scenario, slot.review);
    if (proposal.status === 'parsed' && slot.review?.ok === true &&
        !same(uniqueIncident(after), [...new Set(proposal.edges.map(edgeTuple))].sort())) fail();
    const review = slot.review?.ok === true
      ? { status: 'succeeded', writeMode: safe(slot.review.value.writeMode, ['replace-reviewed']),
        proposed: positive(slot.review.value.proposed), inserted: positive(slot.review.value.inserted),
        removed: positive(slot.review.value.removed), indexRevision: positive(slot.review.value.indexRevision) }
      : { status: 'failed', errorCode: safe(slot.review?.error?.code,
        ['invalid_model_output', 'rationale_failed', 'revision_conflict', 'rationale_limit']) };
    return { caseId: scenario.id, status: slot.status, sourceIds: scenario.events.map(event => event.id),
      seed: { proposed: positive(slot.seed.proposed), inserted: positive(slot.seed.inserted),
        indexRevision: positive(slot.seed.indexRevision) },
      before, after, cold, review, rawProposal: proposal, sourcesUnchanged: true, coldMatches: true };
  });
  return { version: 1, diagnosticOnly: true, sourceHead: HEAD,
    pins: { fixtureSha256: FIXTURE_SHA, rubricSha256: RUBRIC_SHA, operatorSha256: OPERATOR_SHA,
      preloadSha256: PRELOAD_SHA, archiveSha256: ARCHIVE_SHA }, model: MODEL,
    transport, accounting: { before: { requestCount: report.before.requestCount,
      reservedMicroUsd: report.before.reservedMicroUsd }, after: { requestCount: report.after.requestCount,
      reservedMicroUsd: report.after.reservedMicroUsd }, attemptRequests: 6,
      reservedMicroUsd: 30000, knownUsageMicroUsd: 1243, unknownCostRequests: 3,
      unsettledRequests: 0, cumulativeLimitMicroUsd: 50000000, cumulativeRequestCap: 5000 },
    cases, semanticAssessment: 'separate-nonblind-source-review-required' };
}

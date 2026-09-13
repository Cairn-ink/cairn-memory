import { redactSecrets } from '../../plugins/cairn-memory/lib/redact.mjs';

const FIXTURE = 'e03780cf115becd1a507b73d1b7ae47f5550b311ee92802a595f73efaa2b0f5b';
const CASES = ['projector-fan', 'insurance-price-zh', 'two-speakers-one-receipt', 'career-feeling-zh',
  'assistant-only-advice', 'temporary-work-scope', 'positive-reaffirmation', 'late-historical-report'];
const MODELS = ['gpt-4.1-mini-2025-04-14', 'gpt-5.6-luna', 'gpt-5.6-sol'];
const pick = (value, fields) => Object.fromEntries(fields.filter(key => Object.hasOwn(value ?? {}, key)).map(key => [key, value[key]]));
const envelope = (value, project) => value == null ? null : value.ok
  ? { ok: true, value: project(value.value) } : { ok: false, error: pick(value.error, ['code', 'retryable']) };
const source = value => ({ memory: pick(value.memory, ['id', 'revision', 'content', 'state', 'currentness']),
  receipts: value.receipts.map(receipt => pick(receipt, ['id', 'role', 'excerpt'])) });
const budget = value => value == null ? null : pick(value, ['requestCount', 'reservedMicroUsd', 'knownUsageMicroUsd',
  'unknownCostRequests', 'unsettled', 'limitMicroUsd', 'requestCap', 'state']);
const edge = value => pick(value, ['from', 'to', 'relation', 'fromReceipt', 'toReceipt', 'interpretationStatus']);
const compiledUnit = value => ({ ...pick(value, ['index', 'role', 'memoryId', 'revision', 'receiptId', 'interpretationStatus']),
  anchor: pick(value.anchor, ['start', 'end', 'text']) });
function review(value) {
  return { ...pick(value, ['proposed', 'inserted', 'status', 'persistence', 'interpretationStatus', 'indexRevision']),
    ...(Array.isArray(value.units) ? { units: value.units.map(compiledUnit),
      links: value.links.map(link => pick(link, ['from', 'to', 'relation', 'interpretationStatus'])) } : {}) };
}
function proposal(trace) {
  let memories = null, output = null;
  try {
    memories = JSON.parse(trace.requestBody.input[0].content[0].text).memories.map(item => ({ index: item.index,
      receipts: item.receipts.map(receipt => pick(receipt, ['index', 'role', 'excerpt'])) }));
    if (trace.responseAvailable) {
      const raw = JSON.parse(trace.providerResponse.output.flatMap(message => message.content).map(part => part.text).join(''));
      if (trace.requestBody.text.format.name === 'cairn_relate' && Array.isArray(raw.edges)) {
        output = { edges: raw.edges.map(edge) };
      } else if (trace.requestBody.text.format.name === 'cairn_reviewBasis' && Array.isArray(raw.units) && Array.isArray(raw.links)) {
        output = { units: raw.units.map(unit => pick(unit, ['memory', 'receipt', 'quote', 'role'])),
          links: raw.links.map(link => pick(link, ['from', 'to', 'relation'])) };
      }
    }
  } catch { /* Malformed/unavailable output is not an empty successful proposal. */ }
  return { memories, output, outputAvailable: output !== null,
    responseModel: typeof trace.providerResponse?.model === 'string' ? trace.providerResponse.model : null };
}

/** Pure fixed-synthetic projection. Does not grade, invoke models or write files. */
export function exportSourceBasisEvidence(report) {
  if (report?.id !== 'source-basis-comparison-v1' || report.version !== 1 || report.offline !== false
    || report.ingestion !== 'manual-source-admission; interpretation-only; not extraction or retrieval'
    || report.pins?.fixture !== FIXTURE || report.semanticReviewRequired !== true || report.cases?.length !== 48) {
    throw new Error('invalid_source_basis_evidence');
  }
  const schedule = CASES.flatMap((caseId, i) => MODELS.map((_, j) => MODELS[(i + j) % 3])
    .flatMap((model, j) => ((i + j) % 2 ? ['basis', 'baseline'] : ['baseline', 'basis'])
      .map(arm => ({ caseId, model, arm, id: `${caseId}-${model}-${arm}` }))));
  report.cases.forEach((item, i) => {
    if (Object.entries(schedule[i]).some(([key, value]) => item[key] !== value)) throw new Error('invalid_source_basis_evidence');
  });
  const result = { version: 1, id: report.id, status: report.status, ingestion: report.ingestion,
    semanticReview: 'required-not-inferred', sourceHead: report.sourceHead,
    fixtureSha256: report.pins.fixture, operatorSha256: report.pins.operator, rubricSha256: report.pins.rubric,
    artifactSha256: report.provenance.artifactSha256, limits: pick(report.limits, ['requests', 'microUsd', 'perArmRequests']),
    budgetBefore: budget(report.budgetBefore), budgetAfter: budget(report.budgetAfter),
    attempt: pick(report.attempt, ['requests', 'reservedMicroUsd', 'halted', 'readOnly']),
    cases: report.cases.map(item => ({ ...pick(item, ['id', 'caseId', 'arm', 'model', 'status', 'durationMs', 'originalSourcesUnchanged', 'basisNonpersistent']),
      records: item.records.map(value => envelope(value, source)), review: envelope(item.review, review),
      coldMatchesWarm: item.warm.length && item.cold.length ? JSON.stringify(item.warm) === JSON.stringify(item.cold) : null,
      warm: item.warm.map(value => envelope(value, graph => ({ ...pick(graph, ['status', 'coverage', 'view', 'indexRevision']),
        root: pick(graph.root, ['memoryId', 'revision']), edges: graph.edges.map(edge) }))),
      proposals: item.traces.filter(trace => trace.requestBody?.max_output_tokens).map(proposal),
      transport: { requests: item.traces.length, unavailableResponses: item.traces.filter(trace => !trace.responseAvailable).length },
    })) };
  const encoded = JSON.stringify(result);
  if (redactSecrets(encoded) !== encoded || /\/(?:tmp|home|Users|workspace)\/|[A-Za-z]:\\|Bearer\s/iu.test(encoded)) {
    throw new Error('sensitive_source_basis_evidence');
  }
  return JSON.parse(encoded);
}

import { redactSecrets } from '../../plugins/cairn-memory/lib/redact.mjs';

const FIXTURE_SHA = 'a7d3042027bf8dee46df16ef99bbe5be9a86beb622139a2795efe79fc0d73409';
const CASES = ['pump-noise', 'notes-login-zh', 'two-reasons', 'suggestion-not-adoption',
  'third-party-scope', 'compatible-extension', 'subjective-not-trait', 'ambiguous-option'];
const pick = (value, fields) => Object.fromEntries(fields.filter(field => Object.hasOwn(value ?? {}, field)).map(field => [field, value[field]]));
const fail = () => { throw new Error('invalid_rationale_evidence'); };
const receipt = value => pick(value, ['id', 'role', 'excerpt']);
const memory = value => pick(value, ['id', 'revision', 'content', 'kind', 'origin', 'confidence', 'state', 'currentness']);
const qualification = value => value == null ? null : {
  ...pick(value, ['version', 'value', 'attribution', 'commitment', 'boundRevision', 'contentDigest']),
  slot: pick(value.slot, ['subject', 'property', 'scope', 'applies']),
  anchors: value.anchors.map(anchor => pick(anchor, ['receiptId', 'receiptDigest', 'start', 'end', 'text', 'fields'])),
};
const source = value => ({ memory: memory(value.memory), receipts: value.receipts.map(receipt),
  ...pick(value, ['receiptCount', 'interpretationStatus', 'sourceSelectionCoverage']) });
const graph = value => ({ root: pick(value.root, ['memoryId', 'revision']),
  ...pick(value, ['status', 'coverage', 'indexRevision']), sources: value.sources.map(source),
  edges: value.edges.map(edge => pick(edge, ['from', 'to', 'relation', 'fromReceipt', 'toReceipt', 'interpretationStatus'])) });
const envelope = (value, project) => value == null ? null : value.ok === true ? { ok: true, value: project(value.value) }
  : { ok: false, error: pick(value.error, ['code', 'retryable']) };
const budget = value => value == null ? null : pick(value, ['requestCount', 'reservedMicroUsd', 'knownUsageMicroUsd',
  'unknownCostRequests', 'unsettled', 'limitMicroUsd', 'requestCap', 'state']);
const proposal = trace => {
  let candidates = null, edges = null;
  try {
    const input = JSON.parse(trace.requestBody.input[0].content[0].text);
    candidates = input.memories.map(item => ({ index: item.index,
      receipts: item.receipts.map(item => pick(item, ['index', 'role', 'excerpt'])) }));
    if (trace.responseAvailable) {
      const text = trace.providerResponse.output.flatMap(message => message.content).map(part => part.text).join('');
      edges = JSON.parse(text).edges.map(edge => pick(edge, ['from', 'to', 'relation', 'fromReceipt', 'toReceipt']));
    }
  } catch { edges = null; }
  return { phase: trace.phase, candidates, edges, outputAvailable: edges !== null };
};

/** Source-linked public data only; no grading, file writes or provider calls. */
export function exportRationaleEvidence(report) {
  if (report?.id !== 'rationale-pilot-v1' || report.version !== 1 || report.fixtureSha256 !== FIXTURE_SHA
    || report.semanticReviewRequired !== true || !Array.isArray(report.cases) || report.cases.length !== 16) fail();
  const expected = CASES.flatMap((id, index) => (index % 2 ? ['candidate', 'baseline'] : ['baseline', 'candidate'])
    .map(arm => ({ id: `${id}-${arm}`, caseId: id, arm })));
  for (const [index, record] of report.cases.entries()) {
    if (Object.keys(expected[index]).some(key => record[key] !== expected[index][key])) fail();
  }
  const result = { version: 1, id: report.id, status: report.status, semanticReview: 'required-not-inferred',
    fixtureSha256: report.fixtureSha256, artifactSha256: report.provenance?.artifactSha256,
    runnerSha256: report.pins?.['evaluation/live/rationale-pilot.mjs'],
    limits: pick(report.limits, ['requests', 'microUsd', 'reservationMicroUsd']),
    budgetBefore: budget(report.budgetBefore), budgetAfter: budget(report.budgetAfter),
    attempt: report.attempt == null ? null : pick(report.attempt, ['requests', 'reservedMicroUsd', 'halted', 'readOnly']),
    cases: report.cases.map(record => ({ ...pick(record, ['id', 'caseId', 'arm', 'status', 'coldStatus', 'durationMs']),
      captures: record.captures.map(result => envelope(result, value => ({
        admission: value.admission == null ? null : { memories: value.admission.memories.map(memory) },
        classification: value.classification == null ? null : { status: value.classification.status,
          ...(value.classification.error ? { error: pick(value.classification.error, ['code', 'retryable']) } : {}) },
        rationale: value.rationale == null ? null : { ...pick(value.rationale, ['status', 'reason', 'semanticCoverage',
          'queryTruncated', 'scanExhausted', 'candidatesTruncated', 'proposed', 'inserted', 'interpretationStatus', 'indexRevision']),
          ...(value.rationale.discovery ? { discovery: pick(value.rationale.discovery, ['candidateCount', 'scanExhausted',
            'candidatesTruncated', 'queryTruncated', 'semanticCoverage']) } : {}), error: value.rationale.error == null ? undefined
          : pick(value.rationale.error, ['code', 'retryable']) },
      }))),
      memories: record.warmRecords.map(result => envelope(result, value => ({ memory: memory(value.memory),
        receipts: value.receipts.map(receipt), qualification: qualification(value.qualification) }))),
      graphs: record.warmGraphs.map(result => envelope(result, graph)),
      proposals: record.traces.filter(trace => trace.method === 'cairn_relate' && trace.requestBody?.max_output_tokens)
        .map(proposal),
      recall: envelope(record.recall, value => ({ coverage: value.coverage,
        memories: value.memories.map(item => ({ ...source(item), ...(item.rationale ? { rationale: graph(item.rationale) } : {}) })) })),
      cold: { inspectedCount: record.coldRecords.length, graphCount: record.coldGraphs.length,
        replays: record.replays.map(item => ({ event: item.event, ...envelope(item.replay, value => pick(value, ['duplicate'])) })),
        forgotten: record.forgotten.map(result => ({ ok: result.ok, ...(result.ok ? {} : { error: pick(result.error, ['code', 'retryable']) }) })) },
      transport: { requests: record.traces.length, unavailableResponses: record.traces.filter(trace => !trace.responseAvailable).length },
    })) };
  const encoded = JSON.stringify(result);
  if (redactSecrets(encoded) !== encoded || /\/(?:tmp|home|Users|workspace)\/|[A-Za-z]:\\|Bearer\s/iu.test(encoded)) fail();
  return JSON.parse(encoded);
}

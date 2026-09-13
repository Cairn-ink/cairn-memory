import { redactSecrets } from '../../plugins/cairn-memory/lib/redact.mjs';

const FIXTURE_SHA = '6e31bfd44eaf42de5c0c55e3ccbea617633547155869eec3c2b5d9d02f374eb5';
const CASES = ['printer-connection', 'voice-backup-zh', 'two-people', 'temporary-route',
  'uncertain-course', 'two-conditions', 'compatible-confirmation', 'absent-choice'];
const pick = (value, fields) => Object.fromEntries(fields.filter(field => Object.hasOwn(value ?? {}, field)).map(field => [field, value[field]]));
const memory = value => pick(value, ['id', 'revision', 'content', 'kind', 'state', 'currentness']);
const receipt = value => pick(value, ['id', 'role', 'excerpt']);
const source = value => ({ memory: memory(value.memory), receipts: value.receipts.map(receipt),
  ...pick(value, ['receiptCount', 'interpretationStatus', 'sourceSelectionCoverage']) });
const ref = value => pick(value, ['namespaceIndex', 'memoryId', 'revision']);
const budget = value => value == null ? null : pick(value, ['requestCount', 'reservedMicroUsd', 'knownUsageMicroUsd',
  'unknownCostRequests', 'unsettled', 'limitMicroUsd', 'requestCap', 'state']);
const map = value => ({ namespaceIndex: value.namespaceIndex, exhausted: value.exhausted,
  items: value.items.map(item => ({ ...pick(item, ['type', 'label']), ref: pick(item.ref,
    ['memoryId', 'revision', 'parentId', 'parentRevision', 'childType', 'childId', 'childRevision', 'relation']) })) });

function stage(trace) {
  let input = null, output = null;
  try {
    const parsed = JSON.parse(trace.requestBody.input[0].content[0].text);
    input = { ...pick(parsed, ['query', 'maxRefs', 'limit']),
      ...(parsed.maps ? { maps: parsed.maps.map(map) } : {}),
      ...(parsed.candidates ? { candidates: parsed.candidates.map(item => ({ namespaceIndex: item.namespaceIndex, ...source(item) })) } : {}) };
    if (!trace.responseAvailable) throw new Error('response_unavailable');
    const decoded = JSON.parse(trace.providerResponse.output.flatMap(message => message.content).map(part => part.text).join(''));
    if (Array.isArray(decoded.refs)) output = { refs: decoded.refs.map(ref) };
  } catch { /* An unavailable or malformed output stays absent, not an empty selection. */ }
  return { method: trace.requestBody.text.format.name, input, output, outputAvailable: output !== null };
}

/** Closed synthetic projection only: no filesystem, model call or semantic grading. */
export function exportSourceScanEvidence(report) {
  if (report?.id !== 'source-scan-ablation-v1' || report.version !== 1 || report.fixtureSha256 !== FIXTURE_SHA
    || report.ingestion !== 'manual-oracle' || report.semanticReviewRequired !== true || report.cases?.length !== 16) {
    throw new Error('invalid_source_scan_evidence');
  }
  const expected = CASES.flatMap((caseId, index) => (index % 2 ? ['source-scan', 'baseline'] : ['baseline', 'source-scan'])
    .map(arm => ({ id: `${caseId}-${arm}`, caseId, arm })));
  for (const [index, record] of report.cases.entries()) {
    if (Object.entries(expected[index]).some(([key, value]) => record[key] !== value)) throw new Error('invalid_source_scan_evidence');
  }
  const result = { version: 1, id: report.id, status: report.status, ingestion: report.ingestion,
    semanticReview: 'required-not-inferred', fixtureSha256: report.fixtureSha256,
    artifactSha256: report.provenance?.artifactSha256, runnerSha256: report.pins?.['evaluation/live/source-scan-ablation.mjs'],
    limits: pick(report.limits, ['requests', 'microUsd', 'reservationMicroUsd']),
    budgetBefore: budget(report.budgetBefore), budgetAfter: budget(report.budgetAfter),
    attempt: pick(report.attempt, ['requests', 'reservedMicroUsd', 'halted', 'readOnly']),
    cases: report.cases.map(record => ({ ...pick(record, ['id', 'caseId', 'arm', 'status', 'durationMs', 'returnedSourceIndices']),
      sourceCoverage: record.sourceCoverage == null ? null : pick(record.sourceCoverage, ['required', 'retainedRequired', 'retainedIrrelevant']),
      records: record.records.map(source),
      recall: record.recall == null ? null : record.recall.ok ? { ok: true, value: {
        coverage: record.recall.value.coverage, memories: record.recall.value.memories.map(source),
        ...(record.recall.value.selection ? { selection: pick(record.recall.value.selection, ['mode', 'strategy', 'semanticCoverage']) } : {}),
      } } : { ok: false, error: pick(record.recall.error, ['code', 'retryable']) },
      stages: record.traces.filter(trace => trace.requestBody?.max_output_tokens).map(stage),
      transport: { requests: record.traces.length, unavailableResponses: record.traces.filter(trace => !trace.responseAvailable).length },
    })) };
  const encoded = JSON.stringify(result);
  if (redactSecrets(encoded) !== encoded || /\/(?:tmp|home|Users|workspace)\/|[A-Za-z]:\\|Bearer\s/iu.test(encoded)) {
    throw new Error('sensitive_source_scan_evidence');
  }
  return JSON.parse(encoded);
}

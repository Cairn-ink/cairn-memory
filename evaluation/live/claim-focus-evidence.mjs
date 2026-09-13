import { redactSecrets } from '../../plugins/cairn-memory/lib/redact.mjs';

const FIXTURE = 'f4002b94bd4bb2bc2efd1594300084021e40b9cfa466eba999a287a35605d141';
const CASES = ['router-cable', 'recorder-network-zh', 'shared-people', 'career-not-decided',
  'two-premises', 'unsupported-focus', 'compatible-lamp', 'temporary-travel'];
const pick = (value, fields) => Object.fromEntries(fields.filter(key => Object.hasOwn(value ?? {}, key)).map(key => [key, value[key]]));
const memory = value => pick(value, ['id', 'revision', 'content', 'state', 'currentness']);
const receipt = value => pick(value, ['id', 'role', 'excerpt']);
const source = value => ({ memory: memory(value.memory), receipts: value.receipts.map(receipt),
  ...pick(value, ['receiptCount', 'interpretationStatus', 'sourceSelectionCoverage']) });
const budget = value => value == null ? null : pick(value, ['requestCount', 'reservedMicroUsd', 'knownUsageMicroUsd',
  'unknownCostRequests', 'unsettled', 'limitMicroUsd', 'requestCap', 'state']);
const envelope = (value, project) => value == null ? null : value.ok
  ? { ok: true, value: project(value.value) } : { ok: false, error: pick(value.error, ['code', 'retryable']) };
const graph = value => ({ ...pick(value, ['status', 'coverage', 'view', 'indexRevision']),
  root: pick(value.root, ['memoryId', 'revision']), sources: value.sources.map(source),
  edges: value.edges.map(edge => pick(edge, ['from', 'to', 'relation', 'fromReceipt', 'toReceipt', 'interpretationStatus'])) });
function proposal(trace) {
  let memories = null, edges = null;
  try {
    memories = JSON.parse(trace.requestBody.input[0].content[0].text).memories.map(item => ({ index: item.index,
      ...(item.focus ? { focus: pick(item.focus, ['content', 'interpretationStatus']) } : {}),
      receipts: item.receipts.map(value => pick(value, ['index', 'role', 'excerpt'])) }));
    if (trace.responseAvailable) {
      const output = JSON.parse(trace.providerResponse.output.flatMap(message => message.content).map(part => part.text).join(''));
      if (Array.isArray(output.edges)) edges = output.edges.map(edge => pick(edge, ['from', 'to', 'relation', 'fromReceipt', 'toReceipt']));
    }
  } catch { /* Malformed or unavailable output is not an empty proposal. */ }
  return { memories, edges, outputAvailable: edges !== null };
}

/** Fixed synthetic export only; no semantic grading, IO or model invocation. */
export function exportClaimFocusEvidence(report) {
  if (report?.id !== 'claim-focus-ablation-v1' || report.version !== 1 || report.offline !== false
    || report.ingestion !== 'manual-authored-focus' || report.pins?.fixture !== FIXTURE
    || report.semanticReviewRequired !== true || report.cases?.length !== 16) throw new Error('invalid_claim_focus_evidence');
  const schedule = CASES.flatMap((caseId, i) => (i % 2 ? ['focus', 'baseline'] : ['baseline', 'focus'])
    .map(arm => ({ caseId, arm, id: `${caseId}-${arm}` })));
  report.cases.forEach((item, i) => {
    if (Object.entries(schedule[i]).some(([key, value]) => item[key] !== value)) throw new Error('invalid_claim_focus_evidence');
  });
  const result = { version: 1, id: report.id, status: report.status, ingestion: report.ingestion,
    semanticReview: 'required-not-inferred', sourceHead: report.sourceHead,
    fixtureSha256: report.pins.fixture, operatorSha256: report.pins.operator, rubricSha256: report.pins.rubric,
    artifactSha256: report.provenance.artifactSha256, limits: pick(report.limits, ['requests', 'microUsd', 'perArmRequests']),
    budgetBefore: budget(report.budgetBefore), budgetAfter: budget(report.budgetAfter),
    attempt: pick(report.attempt, ['requests', 'reservedMicroUsd', 'halted', 'readOnly']),
    cases: report.cases.map(item => ({ ...pick(item, ['id', 'caseId', 'arm', 'status', 'durationMs']),
      records: item.records.map(value => envelope(value, source)),
      review: envelope(item.review, value => pick(value, ['proposed', 'inserted', 'interpretationStatus', 'indexRevision', 'inputMode'])),
      warm: item.warm.map(value => envelope(value, graph)), cold: item.cold.map(value => envelope(value, graph)),
      proposals: item.traces.filter(trace => trace.requestBody?.max_output_tokens).map(proposal),
      transport: { requests: item.traces.length, unavailableResponses: item.traces.filter(trace => !trace.responseAvailable).length },
    })) };
  const encoded = JSON.stringify(result);
  if (redactSecrets(encoded) !== encoded || /\/(?:tmp|home|Users|workspace)\/|[A-Za-z]:\\|Bearer\s/iu.test(encoded)) {
    throw new Error('sensitive_claim_focus_evidence');
  }
  return JSON.parse(encoded);
}

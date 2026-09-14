import { redactSecrets } from '../../plugins/cairn-memory/lib/redact.mjs';

const CASES = ['rill-battery', 'pickup-hours', 'temporary-reading', 'journal-belief'];
const CONTROLS = ['moc', 'lexical', 'captured-source-oracle'];
const pick = (value, keys) => Object.fromEntries(keys.filter(k => Object.hasOwn(value ?? {}, k)).map(k => [k, value[k]]));
const envelope = (value, project) => value == null ? null : value.ok
  ? { ok: true, value: project(value.value) } : { ok: false, error: pick(value.error, ['code', 'retryable']) };
const memory = value => pick(value, ['id', 'revision', 'content', 'kind', 'state', 'currentness']);
const source = value => ({ memory: memory(value.memory), receipts: value.receipts.map(r => ({
  ...pick(r, ['id', 'role', 'excerpt']), ...(Object.hasOwn(r, 'eventId') ? { sourceId: r.eventId } : {}) })),
  ...pick(value, ['receiptCount', 'interpretationStatus', 'sourceSelectionCoverage']) });
const coverage = value => value == null ? null : pick(value, ['required', 'present', 'missing', 'semanticStatus']);
const ref = value => pick(value, ['memoryId', 'revision']);
const basis = value => ({ ...pick(value, ['inputMode', 'status', 'persistence', 'interpretationStatus', 'indexRevision']),
  units: value.units.map(u => ({ ...pick(u, ['index', 'role', 'memoryId', 'revision', 'receiptId', 'interpretationStatus']),
    anchor: pick(u.anchor, ['start', 'end', 'text']) })),
  links: value.links.map(l => pick(l, ['from', 'to', 'relation', 'interpretationStatus'])), sources: value.sources.map(source) });
const phase = value => value == null ? null : { ...pick(value, ['status', 'reason', 'retiredCount', 'inserted']),
  ...(value.memoryRevisions ? { memoryRevisions: value.memoryRevisions.map(ref) } : {}),
  ...(value.error ? { error: pick(value.error, ['code', 'retryable']) } : {}) };
const capture = value => ({ ...pick(value, ['duplicate']),
  admission: value.admission ? { memories: value.admission.memories.map(memory), ...pick(value.admission, ['suppressedCount', 'indexRevision']) } : null,
  retainedSourceWindow: value.retainedSourceWindow ? pick(value.retainedSourceWindow, ['maxUnitsPerMessage', 'truncatedMessageIndices']) : null,
  classification: phase(value.classification), qualification: phase(value.qualification), reconciliation: phase(value.reconciliation) });
const budget = value => pick(value, ['requestCount', 'reservedMicroUsd', 'knownUsageMicroUsd', 'unknownCostRequests', 'unsettled', 'limitMicroUsd', 'state']);

function trace(value) {
  let input = null, outputText = null;
  try { input = JSON.parse(value.requestBody.input[0].content[0].text); } catch { /* Retain missing input as unavailable. */ }
  if (value.responseAvailable && Array.isArray(value.providerResponse?.output)) {
    outputText = value.providerResponse.output.flatMap(m => m.content ?? []).map(p => p.text ?? '').join('');
  }
  return { ...pick(value, ['sequence', 'kind', 'route', 'responseAvailable']),
    method: value.requestBody.text?.format?.name ?? null, model: value.requestBody.model,
    responseModel: value.providerResponse?.model ?? null, input, outputText,
    providerStatus: value.providerResponse?.status ?? null };
}

/** One frozen synthetic run only; raw reports are not themselves publication-safe. */
export function exportSourceLoopEvidence(report) {
  if (report?.id !== 'source-loop-controls-v1' || report.version !== 1 || report.offline !== false
    || report.pins?.fixture !== 'c35cbaf8c72c6eb3294a5b82117897a6cea8a6fb534a6625bf6915eaadb04ca2'
    || report.result?.cases?.length !== 4 || report.result.cases.some((c, i) => c.id !== CASES[i]
      || c.controls.length > 3 || c.controls.some((a, j) => a.name !== CONTROLS[j]))) {
    throw new Error('invalid_source_loop_evidence');
  }
  const result = { version: 1, id: report.id, status: report.status, sourceHead: report.sourceHead,
    semanticStatus: 'unassessed', fixtureSha256: report.pins.fixture, rubricSha256: report.pins.rubric,
    operatorSha256: report.pins.operator, artifactSha256: report.provenance.artifactSha256,
    limits: pick(report.limits, ['requests', 'microUsd']), budgetBefore: budget(report.budgetBefore), budgetAfter: budget(report.budgetAfter),
    operator: pick(report.operator, ['submitted', 'reserved', 'halted']),
    cases: report.result.cases.map(c => ({ ...pick(c, ['id', 'status', 'error', 'coldMatchesWarm', 'readOnlyChecks']),
      captures: c.captures.map(w => ({ capture: envelope(w.capture, capture), warm: w.warm.map(source), cold: w.cold.map(source), coldMatchesWarm: w.coldMatchesWarm })),
      capturedCoverage: coverage(c.capturedCoverage), recalledCoverage: coverage(c.recalledCoverage),
      recall: envelope(c.recall, v => ({ memories: v.memories.map(source) })),
      controls: CONTROLS.map((name, index) => {
        const a = c.controls[index];
        return a ? { name, status: a.status, refs: a.refs.map(ref), coverage: coverage(a.coverage), basis: envelope(a.basis, basis) }
          : { name, status: 'not_run', refs: [], coverage: null, basis: null };
      }) })),
    traces: report.traces.map(trace) };
  const encoded = JSON.stringify(result);
  if (redactSecrets(encoded) !== encoded || /\/(?:tmp|home|Users|workspace)\/|[A-Za-z]:\\|Bearer\s/iu.test(encoded)) {
    throw new Error('sensitive_source_loop_evidence');
  }
  return JSON.parse(encoded);
}

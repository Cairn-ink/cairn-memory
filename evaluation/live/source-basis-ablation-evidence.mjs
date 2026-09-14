import { redactSecrets } from '../../plugins/cairn-memory/lib/redact.mjs';

const PROFILES = {
  context: { fixture: 'cb72fae1e57636e1f308943d203ac6547217c97769d77fb4338f274448c30ddd',
    ingestion: 'manual-source-admission; development interpretation ablation; not retrieval, capture or held-out quality',
    cases: ['backup-region', 'training-stage-zh', 'device-owners', 'temporary-delivery',
      'old-inspection', 'consideration-zh', 'winter-rating', 'explicit-plan-change'] },
  addressed: { fixture: '973e76796a3aca102572e1681552540b734c34fcd650b12957b102c1e64856a4',
    ingestion: 'manual-source-admission; development addressed-basis ablation; not retrieval, capture or held-out quality',
    cases: ['watch-battery', 'museum-opening', 'planner-owners', 'temporary-office',
      'old-encryption-report', 'unadopted-vpn-zh', 'charger-reaffirmed', 'corrected-belief-zh'] },
};
const MODELS = ['gpt-4.1-mini-2025-04-14', 'gpt-5.6-luna', 'gpt-5.6-sol'];
const pick = (value, fields) => Object.fromEntries(fields.filter(key => Object.hasOwn(value ?? {}, key)).map(key => [key, value[key]]));
const anchor = value => value === null ? null : pick(value, ['start', 'end', 'text']);
const context = (value, compiled) => Object.fromEntries(['subject', 'applies', 'scope', 'commitment']
  .filter(field => Object.hasOwn(value ?? {}, field)).map(field => [field, compiled ? anchor(value[field]) : value[field]]));
const unit = (value, compiled) => ({ ...pick(value, compiled
  ? ['index', 'role', 'memoryId', 'revision', 'receiptId', 'interpretationStatus']
  : ['memory', 'receipt', 'quote', 'role', 'startPart', 'endPart']),
  ...(compiled ? { anchor: anchor(value.anchor) } : {}),
  ...(Object.hasOwn(value, 'context') ? { context: context(value.context, compiled) } : {}),
});
const links = value => value.map(link => pick(link, ['from', 'to', 'relation', 'interpretationStatus']));
const envelope = (value, project) => value == null ? null : value.ok
  ? { ok: true, value: project(value.value) } : { ok: false, error: pick(value.error, ['code', 'retryable']) };
const source = value => ({ memory: pick(value.memory, ['id', 'revision', 'content', 'state', 'currentness']),
  receipts: value.receipts.map(receipt => pick(receipt, ['id', 'role', 'excerpt'])) });
const budget = value => value == null ? null : pick(value, ['requestCount', 'reservedMicroUsd', 'knownUsageMicroUsd',
  'unknownCostRequests', 'unsettled', 'limitMicroUsd', 'requestCap', 'state']);

function proposal(trace, addressed) {
  let memories = null, output = null, inputMode = null;
  try {
    const input = JSON.parse(trace.requestBody.input[0].content[0].text);
    inputMode = input.inputMode ?? null;
    memories = input.memories.map(item => ({ index: item.index,
      receipts: item.receipts.map(receipt => ({ ...pick(receipt, ['index', 'role', 'excerpt']),
        ...(addressed && Object.hasOwn(receipt, 'parts')
          ? { parts: receipt.parts.map(part => pick(part, ['index', 'text'])) } : {}) })) }));
    if (trace.responseAvailable && trace.requestBody.text.format.name === 'cairn_reviewBasis') {
      const raw = JSON.parse(trace.providerResponse.output.flatMap(message => message.content).map(part => part.text).join(''));
      if (Array.isArray(raw.units) && Array.isArray(raw.links)) {
        output = { units: raw.units.map(value => unit(value, false)), links: links(raw.links) };
      }
    }
  } catch { /* Malformed/unavailable output is distinct from empty units/links. */ }
  return { inputMode, memories, output, outputAvailable: output !== null,
    responseModel: typeof trace.providerResponse?.model === 'string' ? trace.providerResponse.model : null };
}

/** Two fixed development-experiment projections, not a grader or generic report API. */
function exportEvidence(report, arm) {
  const profile = PROFILES[arm];
  if (report?.id !== `source-${arm}-ablation-v1` || report.version !== 1 || report.offline !== false
    || report.ingestion !== profile.ingestion
    || report.pins?.fixture !== profile.fixture || report.semanticReviewRequired !== true || report.cases?.length !== 48) {
    throw new Error(`invalid_source_${arm}_evidence`);
  }
  const schedule = profile.cases.flatMap((caseId, i) => MODELS.map((_, j) => MODELS[(i + j) % 3])
    .flatMap((model, j) => ((i + j) % 2 ? [arm, 'baseline'] : ['baseline', arm])
      .map(arm => ({ caseId, model, arm, id: `${caseId}-${model}-${arm}` }))));
  report.cases.forEach((item, i) => {
    if (Object.entries(schedule[i]).some(([key, value]) => item[key] !== value)) throw new Error(`invalid_source_${arm}_evidence`);
  });
  const result = { version: 1, id: report.id, status: report.status, ingestion: report.ingestion,
    semanticReview: 'required-not-inferred', sourceHead: report.sourceHead,
    fixtureSha256: report.pins.fixture, operatorSha256: report.pins.operator, rubricSha256: report.pins.rubric,
    artifactSha256: report.provenance.artifactSha256, limits: pick(report.limits, ['requests', 'microUsd', 'perArmRequests']),
    budgetBefore: budget(report.budgetBefore), budgetAfter: budget(report.budgetAfter),
    attempt: pick(report.attempt, ['requests', 'reservedMicroUsd', 'halted', 'readOnly']),
    cases: report.cases.map(item => ({ ...pick(item, ['id', 'caseId', 'arm', 'model', 'status', 'durationMs', 'originalSourcesUnchanged', 'basisNonpersistent']),
      records: item.records.map(value => envelope(value, source)),
      review: envelope(item.review, value => ({ ...pick(value, ['inputMode', 'status', 'persistence', 'interpretationStatus', 'indexRevision']),
        units: value.units.map(value => unit(value, true)), links: links(value.links) })),
      coldMatchesWarm: item.warm.length && item.cold.length ? JSON.stringify(item.warm) === JSON.stringify(item.cold) : null,
      warmEdgeCount: item.warm.every(value => value.ok) && item.warm.length
        ? item.warm.reduce((sum, value) => sum + value.value.edges.length, 0) : null,
      proposals: item.traces.filter(trace => trace.requestBody?.max_output_tokens).map(trace => proposal(trace, arm === 'addressed')),
      transport: { requests: item.traces.length, unavailableResponses: item.traces.filter(trace => !trace.responseAvailable).length },
    })) };
  const encoded = JSON.stringify(result);
  if (redactSecrets(encoded) !== encoded || /\/(?:tmp|home|Users|workspace)\/|[A-Za-z]:\\|Bearer\s/iu.test(encoded)) {
    throw new Error(`sensitive_source_${arm}_evidence`);
  }
  return JSON.parse(encoded);
}

export const exportSourceContextEvidence = report => exportEvidence(report, 'context');
export const exportSourceAddressedEvidence = report => exportEvidence(report, 'addressed');

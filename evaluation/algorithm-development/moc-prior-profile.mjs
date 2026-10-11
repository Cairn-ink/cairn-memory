// Closed source-facing profile. Evaluator data never enters this module.
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';

export const MOC_NATURAL_VERSION = 'moc-prior-natural-four-v1';
export const mocNaturalArms = Object.freeze(['baseline', 'prior']);
export const mocNaturalPolicies = Object.freeze({ baseline: 'bounded-keyset-v1', prior: 'moc-prior-keyset-v1' });
export const mocNaturalOrders = Object.freeze([['baseline', 'prior'], ['prior', 'baseline']].map(Object.freeze));
export const mocNaturalRoster = Object.freeze(['narrow-topic-identity-location', 'dated-scope-handoff',
  'shared-topic-interference', 'explicitly-unresolved-choice'].map((family, index) =>
  Object.freeze({ id: `P0${index + 1}`, family })));
export const mocNaturalSourceSha256 = '4446a339c252f7b863a80c059048572c8a38f805561b4f898483d0b9ccf97aad';
export const mocNaturalSourceValueSha256 = '3f2e2eda18c94dc1256880b7220245f350ad25f010518acd0409c0cfbb92204c';
export const mocNaturalLimits = Object.freeze({ cases: 4, batchesPerCase: 19, admissionsPerBatch: 5,
  admissionsPerCase: 95, coreCallsPerCase: 44, captureCallsPerCase: 38, coreCallsPerArm: 3,
  answersPerCase: 2, httpRequests: 360, reservationMicroUsd: 5000, reservedMicroUsd: 1_800_000,
  localCeilingMicroUsd: 4_000_000, protectedMicroUsd: 30_000_000, inputTokens: 6000,
  providerInputTokens: 7024, coreOutputTokens: 1024, answerOutputTokens: 512,
  callMs: 200_000, coreLogicalCallMs: 30_000, caseMs: 1_200_000, runMs: 4_800_000 });
export const freezeNatural = value => {
  if (value && typeof value === 'object') { Object.values(value).forEach(freezeNatural); Object.freeze(value); }
  return value;
};
export const naturalHash = bytes => createHash('sha256').update(bytes).digest('hex');
export const naturalFail = code => { const error = new Error(code); error.code = code; throw error; };
const codes = new Set(['natural_failure', 'natural_source_invalid', 'natural_source_drift', 'natural_batch_count',
  'natural_persistence_failure', 'natural_state_changed', 'natural_trace_failure', 'natural_admission_cap',
  'natural_manifest_mismatch', 'natural_output_changed', 'natural_output_unsafe', 'natural_output_contents',
  'natural_runtime_not_clean', 'natural_campaign_limit', 'natural_campaign_unsettled', 'natural_unaffordable',
  'natural_key_failure', 'natural_launch_failure', 'natural_artifact_invalid', 'natural_derivation_unavailable',
  'natural_protocol_invalid', 'natural_judgment_invalid', 'natural_report_invalid', 'natural_slot_not_run',
  'natural_capture_failure', 'natural_recall_failure', 'natural_answer_failure',
  'algorithm_checkpoint_mismatch', 'algorithm_unaffordable', 'algorithm_accounting_failure', 'algorithm_closed',
  'algorithm_request_denied', 'algorithm_credential_echo', 'algorithm_budget_exceeded',
  'algorithm_auth_transport_failure', 'algorithm_usage_anomaly', 'algorithm_usage_overrun',
  'algorithm_persistence_failure', 'algorithm_method_denied', 'algorithm_case_call_cap',
  'algorithm_phase_call_cap', 'algorithm_lifecycle', 'invalid_algorithm_configuration',
  'provider_failure', 'model_timeout', 'context_budget_exceeded', 'response_body_bounds',
  'invalid_answer_response', 'invalid_model_output', 'extraction_failed', 'classification_failed',
  'storage_busy', 'storage_error', 'revision_conflict', 'index_revision_conflict', 'index_unavailable',
  'invalid_recall_provenance', 'provenance_limit_exceeded', 'ledger_failed', 'ledger_closed', 'ledger_overrun']);
// Callback/provider errors are data only after passing this closed vocabulary.
export function naturalErrorCode(error, fallback = 'natural_failure') {
  try { if (error?.name === 'AbortError') return 'model_timeout';
    return typeof error?.code === 'string' && codes.has(error.code) ? error.code : fallback;
  } catch { return fallback; }
}
export const naturalFatalCode = code => ['natural_persistence_failure', 'natural_state_changed',
  'natural_trace_failure', 'natural_manifest_mismatch', 'natural_output_changed', 'natural_admission_cap',
  'algorithm_checkpoint_mismatch', 'algorithm_accounting_failure', 'algorithm_request_denied',
  'algorithm_credential_echo', 'algorithm_budget_exceeded', 'algorithm_auth_transport_failure',
  'algorithm_usage_anomaly', 'algorithm_usage_overrun', 'algorithm_persistence_failure',
  'algorithm_method_denied', 'algorithm_lifecycle', 'storage_error', 'storage_busy',
  'ledger_failed', 'ledger_closed', 'ledger_overrun'].includes(code);
const exact = (value, fields) => {
  if (!value || typeof value !== 'object' || Array.isArray(value)
    || Object.getPrototypeOf(value) !== Object.prototype
    || Object.keys(value).sort().join() !== [...fields].sort().join()) naturalFail('natural_source_invalid');
};
const text = value => typeof value === 'string' && value.trim() && value.isWellFormed() && !value.includes('\0');
const date = (value, event = false) => {
  if (typeof value !== 'string' || !(event ? /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/u : /^\d{4}-\d{2}-\d{2}$/u).test(value)
    || !Number.isFinite(Date.parse(value)) || (event ? new Date(value).toISOString().replace('.000Z', 'Z')
      : new Date(value).toISOString().slice(0, 10)) !== value) naturalFail('natural_source_invalid');
};
export function validateMocNaturalInputs(cases) {
  if (!Array.isArray(cases) || cases.length !== 4) naturalFail('natural_source_invalid');
  for (const [index, source] of cases.entries()) {
    exact(source, ['id', 'family', 'question', 'sessions']);
    if (source.id !== mocNaturalRoster[index].id || source.family !== mocNaturalRoster[index].family) naturalFail('natural_source_invalid');
    exact(source.question, ['text', 'date']); if (!text(source.question.text)) naturalFail('natural_source_invalid'); date(source.question.date);
    if (!Array.isArray(source.sessions) || source.sessions.length !== 19) naturalFail('natural_source_invalid');
    let previous = '', points = 0;
    for (const [sessionIndex, session] of source.sessions.entries()) {
      exact(session, ['id', 'eventTime', 'messages']); date(session.eventTime, true);
      if (session.id !== `${source.id}-s${sessionIndex + 1}` || session.eventTime <= previous
        || session.eventTime.slice(0, 10) > source.question.date || !Array.isArray(session.messages)
        || session.messages.length !== 3) naturalFail('natural_source_invalid');
      previous = session.eventTime;
      for (const [turn, message] of session.messages.entries()) {
        exact(message, ['role', 'content']);
        if (message.role !== (turn === 1 ? 'assistant' : 'user') || !text(message.content)
          || message.role === 'user' && message.content.length > 800) naturalFail('natural_source_invalid');
        points += [...message.content].length;
      }
    }
    if (points > 22000) naturalFail('natural_source_invalid');
  }
  return cases;
}
// Reuse existing preparation; defer import to avoid transport/old-runner cycles.
export async function prepareMocNaturalCases(cases) {
  validateMocNaturalInputs(cases);
  const { prepareAlgorithmDevelopmentCase } = await import('./runner.mjs');
  return cases.map(source => {
    const prepared = prepareAlgorithmDevelopmentCase(source);
    if (prepared.plan.cairnPlan.batches.length !== 19) naturalFail('natural_batch_count');
    return prepared;
  });
}
export async function loadMocNaturalInputs({ casesPath = new URL('./moc-prior-cases.json', import.meta.url) } = {}) {
  const bytes = await readFile(casesPath);
  if (naturalHash(bytes) !== mocNaturalSourceSha256) naturalFail('natural_source_drift');
  let cases; try { cases = JSON.parse(bytes); } catch { naturalFail('natural_source_invalid'); }
  await prepareMocNaturalCases(cases);
  return freezeNatural(cases);
}

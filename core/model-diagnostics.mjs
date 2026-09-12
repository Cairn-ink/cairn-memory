const stages = new Set(['extract', 'classify', 'select', 'rank', 'reconcile']);
const reasons = {
  core_call: new Set(['model_not_configured', 'context_budget_exceeded', 'token_count_unavailable',
    'model_timeout', 'model_cancelled', 'provider_failure', 'adapter_output_invalid',
    'output_serialization', 'output_bounds']),
  core_validation: new Set(['invalid_extraction', 'invalid_classification', 'invalid_reconciliation', 'malformed_refs',
    'duplicate_ref', 'non_visible_ref', 'namespace_selection_limit']),
  adapter: new Set(['response_envelope', 'response_usage', 'response_message', 'response_content',
    'output_json', 'output_shape', 'output_bounds', 'request_invalid', 'request_bounds',
    'token_count_response', 'transport_failure', 'response_body_bounds', 'response_json', 'model_cancelled']),
};

/** Trusted observer only; never pass model data or an exception across this boundary. */
export function emitDiagnostic(model, stage, layer, reason) {
  if (!stages.has(stage) || !Object.hasOwn(reasons, layer) || !reasons[layer].has(reason)) return;
  try {
    const observer = model?.onDiagnostic;
    if (typeof observer !== 'function') return;
    const result = observer(Object.freeze({ version: 1, stage, layer, reason }));
    Promise.resolve(result).catch(() => {});
  } catch { /* Observation must not change the operation's result. */ }
}

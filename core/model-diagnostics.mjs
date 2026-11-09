import { assertContentPort, hasContentPortBoundary } from './content-safety-boundary.mjs';
import { modelPortValue } from './model-budget.mjs';
import { fail } from './validation.mjs';
const stages = new Set(['interpretEpisode', 'extract', 'classify', 'select', 'rank', 'reconcile', 'qualify', 'qualifyCandidates', 'relate', 'relateMemories', 'reviewBasis']);
const reasons = {
  core_call: new Set(['model_not_configured', 'context_budget_exceeded', 'token_count_unavailable',
    'model_timeout', 'model_cancelled', 'provider_failure', 'adapter_output_invalid',
    'output_serialization', 'output_bounds']),
  core_validation: new Set(['invalid_extraction', 'invalid_extraction_output_shape',
    'invalid_extraction_item_shape', 'invalid_extraction_text', 'invalid_extraction_value',
    'invalid_extraction_source_shape', 'invalid_extraction_source_duplicate',
    'invalid_extraction_source_range', 'invalid_qualification',
    'qualification_citation_budget', 'qualification_citation_integrity',
    'qualification_label_canonicality', 'qualification_binding', 'invalid_classification',
    'invalid_memory_relations', 'invalid_reconciliation', 'invalid_rationale', 'malformed_refs', 'duplicate_ref',
    'non_visible_ref', 'namespace_selection_limit']),
  adapter: new Set(['response_envelope', 'response_usage', 'response_message', 'response_content',
    'output_json', 'output_shape', 'output_bounds', 'qualification_wire_shape',
    'qualification_pool_mapping', 'qualification_slot_mapping', 'qualification_value_shape',
    'request_invalid', 'request_bounds',
    'token_count_response', 'transport_failure', 'response_body_bounds', 'response_json', 'model_cancelled']),
};

/** Trusted observer only; never pass model data or an exception across this boundary. */
export function emitDiagnostic(model, stage, layer, reason) {
  if (!stages.has(stage) || !Object.hasOwn(reasons, layer) || !reasons[layer].has(reason)) return;
  if (!hasContentPortBoundary()) {
    // Main's observer call is unbound, and all observer failures are isolated.
    try {
      const observer = model?.onDiagnostic;
      if (typeof observer !== 'function') return;
      const result = observer(Object.freeze({ version: 1, stage, layer, reason }));
      Promise.resolve(result).catch(() => {});
    } catch { /* Observation must not change the operation's result. */ }
    return;
  }
  let observer;
  try { observer=modelPortValue(model,'onDiagnostic','evidence_unavailable'); }
  catch { return; } // Refused accessors/Proxies never execute caller code.
  if (typeof observer !== 'function') return;
  const protectedRead=hasContentPortBoundary();
  let asynchronous=false;
  assertContentPort({before:true});
  try {
    assertContentPort({invoke:()=>{
      const result=Reflect.apply(observer,model,[Object.freeze({version:1,stage,layer,reason})]);
      // This observer is synchronous. Discard its ordinary return into an inert
      // undefined; refuse asynchronous work before another retained dispatch.
      asynchronous=Boolean(result && typeof result.then==='function');
      if(asynchronous)Promise.resolve(result).catch(()=>{});
    }});
  } catch { /* Observer exceptions stay isolated. */ }
  finally { assertContentPort(); } // Safety failures must stop the operation.
  if(protectedRead&&asynchronous)fail('evidence_unavailable');
}

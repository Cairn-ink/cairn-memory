import { countTokens } from '../../core/model-budget.mjs';
import { fail } from '../../core/validation.mjs';
import { prepareSelectionChecklist } from './query-evidence-checklist.mjs';

const checkAbort = signal => {
  if (signal.aborted) throw new DOMException('Checklist selection cancelled', 'AbortError');
};

/** Evaluation only: retain the shared core's navigation, rank and final read. */
export function createChecklistSelectionModel(model) {
  if (!model || typeof model.selectChecklist !== 'function') fail('model_not_configured');
  if (typeof model.countTokens !== 'function') fail('token_count_unavailable');
  if (!Number.isSafeInteger(model.contextWindow) || model.contextWindow < 8192) fail('context_budget_exceeded');
  const counter = { countTokens: model.countTokens.bind(model) };
  const selectChecklist = model.selectChecklist.bind(model);
  return Object.freeze({ ...model, async select({ input, maxOutputTokens, signal }) {
    if (maxOutputTokens !== 1024 || !(signal instanceof AbortSignal)) fail('invalid_input');
    checkAbort(signal);
    const prepared = prepareSelectionChecklist(input);
    const actual = { ...prepared.request, maxOutputTokens };
    if (countTokens(counter, JSON.stringify(actual)) > 6000) fail('context_budget_exceeded');
    checkAbort(signal);
    const proposal = await selectChecklist({ ...actual, signal });
    checkAbort(signal);
    let encoded;
    try { encoded = JSON.stringify(proposal); } catch { fail('invalid_model_output'); }
    if (typeof encoded !== 'string' || encoded.length > 40_000) fail('invalid_model_output');
    // Check the model's complete output, not just the shorter compiled union.
    if (countTokens(counter, encoded) > 1024) fail('invalid_model_output');
    checkAbort(signal);
    // A supplied counter is a callback: do not compile a proposal changed by it.
    try { if (JSON.stringify(proposal) !== encoded) fail('invalid_model_output'); }
    catch { fail('invalid_model_output'); }
    return prepared.compile(proposal).selection;
  } });
}

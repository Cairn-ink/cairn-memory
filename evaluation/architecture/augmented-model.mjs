import { countTokens } from '../../core/model-budget.mjs';
import { fail } from '../../core/validation.mjs';
import { prepareBoundedSelection } from './selection-augmentation.mjs';

const checkAbort = signal => {
  if (signal.aborted) throw new DOMException('Augmented selection cancelled', 'AbortError');
};

/** Evaluation only; the shared core still ranks and authoritatively rereads. */
export function createAugmentedSelectionModel(model) {
  if (!model || typeof model.select !== 'function') fail('model_not_configured');
  if (typeof model.countTokens !== 'function') fail('token_count_unavailable');
  if (!Number.isSafeInteger(model.contextWindow) || model.contextWindow < 8192) fail('context_budget_exceeded');
  const counter = { countTokens: model.countTokens.bind(model) };
  const select = model.select.bind(model);
  return Object.freeze({ ...model, async select({ system, input, maxOutputTokens, signal }) {
    if (typeof system !== 'string' || !system.isWellFormed() || system.length > 24_000
      || maxOutputTokens !== 1024 || !(signal instanceof AbortSignal)) fail('invalid_input');
    checkAbort(signal);
    const prepared = prepareBoundedSelection(input);
    const request = { system, input: prepared.input, maxOutputTokens };
    if (countTokens(counter, JSON.stringify(request)) > 6000) fail('context_budget_exceeded');
    checkAbort(signal);
    const output = await select({ ...request, signal });
    checkAbort(signal);
    // Validate ordinary JSON and all original references before serializing
    // caller-owned output. Augmentation must not repair an invalid base result.
    const { selection } = prepared.augment(output);
    const original = JSON.stringify(output);
    if (original.length > 40_000 || countTokens(counter, original) > 1024) fail('invalid_model_output');
    checkAbort(signal);
    // A supplied counter is a callback; keep changes to the original observable
    // as failure even though the compiled selection is already detached.
    try {
      prepared.augment(output);
      if (JSON.stringify(output) !== original) fail('invalid_model_output');
    }
    catch { fail('invalid_model_output'); }
    const augmented = JSON.stringify(selection);
    if (augmented.length > 40_000 || countTokens(counter, augmented) > 1024) fail('invalid_model_output');
    checkAbort(signal);
    if (JSON.stringify(selection) !== augmented) fail('invalid_model_output');
    return selection;
  } });
}

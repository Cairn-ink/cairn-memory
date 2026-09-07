import { countTokens } from './model-budget.mjs';
import { fail, MemoryStoreError } from './validation.mjs';

/** A bounded adapter call. No database transaction may surround this helper. */
export async function callModel(model, method, system, input,
  { validateFresh = () => {}, failureCode = 'recall_failed' } = {}) {
  if (typeof model?.[method] !== 'function') fail('model_not_configured');
  if (!Number.isSafeInteger(model.contextWindow) || model.contextWindow < 8192) fail('context_budget_exceeded');
  const request = { system, input, maxOutputTokens: 1024 };
  if (countTokens(model, JSON.stringify(request)) > 6000) fail('context_budget_exceeded');
  validateFresh();
  const controller = new AbortController();
  let timer;
  let output;
  try {
    output = await Promise.race([
      Promise.resolve().then(() => model[method]({ ...structuredClone(request), signal: controller.signal })),
      new Promise((_, reject) => {
        timer = setTimeout(() => { controller.abort(); reject(new MemoryStoreError('model_timeout')); }, 30_000);
      }),
    ]);
  } catch (error) {
    if (controller.signal.aborted || error?.code === 'model_timeout') fail('model_timeout');
    if (error?.name === 'AbortError') fail('model_cancelled');
    // Trusted adapters can reject exact provider framing or malformed output.
    // Do not forward arbitrary provider errors, payloads or authority codes.
    if (error instanceof MemoryStoreError && ['context_budget_exceeded',
      'token_count_unavailable', 'invalid_model_output'].includes(error.code)) throw error;
    fail(failureCode);
  } finally { clearTimeout(timer); }
  validateFresh();
  let text;
  try { text = JSON.stringify(output); } catch { fail('invalid_model_output'); }
  if (typeof text !== 'string' || text.length > 40_000) fail('invalid_model_output');
  if (countTokens(model, text) > 1024) fail('invalid_model_output');
  validateFresh();
  return output;
}

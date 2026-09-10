import { countTokens } from './model-budget.mjs';
import { fail, MemoryStoreError } from './validation.mjs';
import { emitDiagnostic } from './model-diagnostics.mjs';

/** A bounded adapter call. No database transaction may surround this helper. */
export async function callModel(model, method, system, input,
  { validateFresh = () => {}, failureCode = 'recall_failed' } = {}) {
  const reject = (code, reason = code) => { emitDiagnostic(model, method, 'core_call', reason); fail(code); };
  const tokens = (text) => {
    try { return countTokens(model, text); }
    catch (error) { emitDiagnostic(model, method, 'core_call', 'token_count_unavailable'); throw error; }
  };
  if (typeof model?.[method] !== 'function') reject('model_not_configured');
  if (!Number.isSafeInteger(model.contextWindow) || model.contextWindow < 8192) reject('context_budget_exceeded');
  const request = { system, input, maxOutputTokens: 1024 };
  if (tokens(JSON.stringify(request)) > 6000) reject('context_budget_exceeded');
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
    if (controller.signal.aborted || error?.code === 'model_timeout') reject('model_timeout');
    if (error?.name === 'AbortError') reject('model_cancelled');
    // Trusted adapters can reject exact provider framing or malformed output.
    // Do not forward arbitrary provider errors, payloads or authority codes.
    if (error instanceof MemoryStoreError && ['context_budget_exceeded',
      'token_count_unavailable', 'invalid_model_output'].includes(error.code)) {
      emitDiagnostic(model, method, 'core_call', error.code === 'invalid_model_output'
        ? 'adapter_output_invalid' : error.code);
      throw error;
    }
    reject(failureCode, 'provider_failure');
  } finally { clearTimeout(timer); }
  validateFresh();
  let text;
  try { text = JSON.stringify(output); } catch { reject('invalid_model_output', 'output_serialization'); }
  if (typeof text !== 'string' || text.length > 40_000) reject('invalid_model_output', 'output_bounds');
  if (tokens(text) > 1024) reject('invalid_model_output', 'output_bounds');
  validateFresh();
  return output;
}

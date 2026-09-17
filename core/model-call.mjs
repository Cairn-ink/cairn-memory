import { countTokens } from './model-budget.mjs';
import { fail, MemoryStoreError } from './validation.mjs';
import { emitDiagnostic } from './model-diagnostics.mjs';

function plainJson(value, active = new Set(), budget = { nodes: 0 }, depth = 0) {
  if (++budget.nodes > 5_000 || depth > 20) return false;
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return true;
  if (typeof value === 'number') return Number.isFinite(value);
  if (typeof value !== 'object' || active.has(value)) return false;
  const array = Array.isArray(value);
  if (Object.getPrototypeOf(value) !== (array ? Array.prototype : Object.prototype)) return false;
  active.add(value);
  const keys = Reflect.ownKeys(value);
  const valid = keys.length <= 5_000 && (!array || keys.length === value.length + 1)
    && keys.every(key => {
      if (typeof key !== 'string' || (array && key !== 'length' &&
          (!/^(0|[1-9]\d*)$/.test(key) || Number(key) >= value.length))) return false;
      if (array && key === 'length') return true;
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      return descriptor?.enumerable && Object.hasOwn(descriptor, 'value')
        && plainJson(descriptor.value, active, budget, depth + 1);
    });
  active.delete(value);
  return valid;
}

/** A bounded adapter call. No database transaction may surround this helper. */
export async function callModel(model, method, system, input,
  { validateFresh = () => {}, failureCode = 'recall_failed', maxOutputTokens = 1024,
    responseSchema } = {}) {
  const reject = (code, reason = code) => { emitDiagnostic(model, method, 'core_call', reason); fail(code); };
  let validSchema = true;
  if (responseSchema !== undefined) {
    try { validSchema = responseSchema !== null && !Array.isArray(responseSchema)
      && typeof responseSchema === 'object' && plainJson(responseSchema); }
    catch { validSchema = false; }
  }
  if (![1024, 3072].includes(maxOutputTokens) || !validSchema) fail('invalid_input');
  const tokens = (text) => {
    try { return countTokens(model, text); }
    catch (error) { emitDiagnostic(model, method, 'core_call', 'token_count_unavailable'); throw error; }
  };
  if (typeof model?.[method] !== 'function') reject('model_not_configured');
  if (!Number.isSafeInteger(model.contextWindow) || model.contextWindow < 8192) reject('context_budget_exceeded');
  const request = { system, input, maxOutputTokens,
    ...(responseSchema === undefined ? {} : { responseSchema }) };
  let ownedRequest = request;
  if (responseSchema !== undefined || maxOutputTokens === 3072) {
    try { ownedRequest = structuredClone(request); }
    catch { fail('invalid_input'); }
  }
  const inputTokens = tokens(JSON.stringify(ownedRequest));
  if (inputTokens > 6000 || (maxOutputTokens === 3072 &&
      inputTokens + maxOutputTokens > model.contextWindow)) reject('context_budget_exceeded');
  validateFresh();
  const controller = new AbortController();
  let timer;
  let output;
  try {
    output = await Promise.race([
      Promise.resolve().then(() => model[method]({ ...structuredClone(ownedRequest), signal: controller.signal })),
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
  if (tokens(text) > maxOutputTokens) reject('invalid_model_output', 'output_bounds');
  validateFresh();
  return output;
}

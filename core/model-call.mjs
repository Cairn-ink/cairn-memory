import { countTokens } from './model-budget.mjs';
import { fail, MemoryStoreError } from './validation.mjs';
import { emitDiagnostic } from './model-diagnostics.mjs';

// Internal cross-layer provenance only. There is deliberately no setter and
// this predicate is not re-exported from the public core entry point.
const coreDeadlineSignals = new WeakSet();
export const isCoreModelDeadlineSignal = (signal) => coreDeadlineSignals.has(signal);

// Every core call's counted input envelope. Planners measure this exact text.
export const MODEL_INPUT_TOKENS = 6000;
export const MODEL_OUTPUT_TOKENS = 1024;
export const modelRequestText = (system, input) =>
  JSON.stringify({ system, input, maxOutputTokens: MODEL_OUTPUT_TOKENS });

/** A bounded adapter call. No database transaction may surround this helper. */
export async function callModel(model, method, system, input,
  { validateFresh = () => {}, failureCode = 'recall_failed', deadline, modelCallTimeoutMs = 30_000 } = {}) {
  if (!Number.isSafeInteger(modelCallTimeoutMs) || modelCallTimeoutMs < 1 || modelCallTimeoutMs > 120_000) fail('invalid_input');
  const reject = (code, reason = code) => { emitDiagnostic(model, method, 'core_call', reason); fail(code); };
  let controller;
  let deadlineReported = false;
  const check = () => {
    if (!deadline?.expired()) return;
    if (controller) {
      coreDeadlineSignals.add(controller.signal);
      controller.abort();
    }
    if (!deadlineReported) {
      deadlineReported = true;
      reject('model_timeout');
    }
    fail('model_timeout');
  };
  const tokens = (text) => {
    check();
    try { return countTokens(model, text); }
    catch (error) { emitDiagnostic(model, method, 'core_call', 'token_count_unavailable'); throw error; }
    finally { check(); }
  };
  check();
  if (typeof model?.[method] !== 'function') reject('model_not_configured');
  if (!Number.isSafeInteger(model.contextWindow) || model.contextWindow < 8192) reject('context_budget_exceeded');
  const request = { system, input, maxOutputTokens: MODEL_OUTPUT_TOKENS };
  if (tokens(modelRequestText(system, input)) > MODEL_INPUT_TOKENS) reject('context_budget_exceeded');
  check();
  validateFresh();
  check();
  controller = new AbortController();
  let timer;
  let output;
  const freshnessFailure = {};
  let freshnessError;
  try {
    output = await Promise.race([
      Promise.resolve().then(() => {
        check();
        const detached = structuredClone(request);
        check();
        // A token counter may have queued a discard before this invocation
        // microtask. Keep trusted freshness failures distinct from model errors
        // so the provider catch below cannot launder either one's authority.
        try { validateFresh(); }
        catch (error) { freshnessError = error; return freshnessFailure; }
        check();
        return model[method]({ ...detached, signal: controller.signal });
      }),
      new Promise((_, reject) => {
        timer = setTimeout(() => {
          coreDeadlineSignals.add(controller.signal);
          controller.abort();
          reject(new MemoryStoreError('model_timeout'));
        }, deadline ? deadline.remainingMs(modelCallTimeoutMs) : modelCallTimeoutMs);
      }),
    ]);
  } catch (error) {
    check();
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
  check();
  if (output === freshnessFailure) throw freshnessError;
  validateFresh();
  check();
  let text;
  try { text = JSON.stringify(output); }
  catch { check(); reject('invalid_model_output', 'output_serialization'); }
  check();
  if (typeof text !== 'string' || text.length > 40_000) reject('invalid_model_output', 'output_bounds');
  if (tokens(text) > 1024) reject('invalid_model_output', 'output_bounds');
  check();
  validateFresh();
  check();
  return output;
}

import { extractionOutputTokens } from './capture-input.mjs';
import { assertContentPort, inertContentPortValue, hasLegacyContentReadBoundary, hasContentPortBoundary } from './content-safety-boundary.mjs';
import { countTokens, modelPortValue } from './model-budget.mjs';
import { fail, MemoryStoreError } from './validation.mjs';
import { emitDiagnostic } from './model-diagnostics.mjs';

// Internal cross-layer provenance only. There is deliberately no setter and
// this predicate is not re-exported from the public core entry point.
const coreDeadlineSignals = new WeakSet();
const signalAborted=Object.getOwnPropertyDescriptor(AbortSignal.prototype,'aborted').get;
const isAborted=signal=>Reflect.apply(signalAborted,signal,[]);
export const isCoreModelDeadlineSignal = (signal) => coreDeadlineSignals.has(signal);

// Every core call's counted input envelope. Planners measure this exact text.
export const MODEL_INPUT_TOKENS = 6000;
export const MODEL_OUTPUT_TOKENS = 1024;
export const modelRequestText = (system, input, maxOutputTokens = MODEL_OUTPUT_TOKENS) =>
  JSON.stringify({ system, input, maxOutputTokens });

/** A bounded adapter call. No database transaction may surround this helper. */
export async function callModel(model, method, system, input,
  { validateFresh = () => {}, beforeDispatch = () => {}, failureCode = 'recall_failed', deadline, onHostWait } = {}) {
  const legacyFreshness = hasLegacyContentReadBoundary();
  const protectedRead = hasContentPortBoundary();
  const reject = (code, reason = code) => { emitDiagnostic(model, method, 'core_call', reason); fail(code); };
  let controller;
  let aborted=false;
  const observeAbort=()=>{try{aborted=aborted||Boolean(isAborted(controller.signal));}catch{aborted=true;}return aborted;};
  let deadlineReported = false;
  const check = () => {
    if (!deadline?.expired()) return;
    if (controller) {
      aborted=true;
      coreDeadlineSignals.add(controller.signal);
      assertContentPort({invoke:()=>controller.abort()});
    }
    if (!deadlineReported) {
      deadlineReported = true;
      reject('model_timeout');
    }
    fail('model_timeout');
  };
  const tokens = (text) => {
    check();
    if (!legacyFreshness) validateFresh();
    try { return countTokens(model, text); }
    catch (error) { emitDiagnostic(model, method, 'core_call', 'token_count_unavailable'); throw error; }
    finally { check(); }
  };
  check();
  let provider;
  if (protectedRead) {
    provider = modelPortValue(model,method,'model_not_configured');
    if (typeof provider !== 'function') reject('model_not_configured');
    const contextWindow = modelPortValue(model,'contextWindow','context_budget_exceeded');
    if (!Number.isSafeInteger(contextWindow) || contextWindow < 8192) reject('context_budget_exceeded');
  } else {
    if (typeof model?.[method] !== 'function') reject('model_not_configured');
    if (!Number.isSafeInteger(model.contextWindow) || model.contextWindow < 8192) reject('context_budget_exceeded');
  }
  const maxOutputTokens = method === 'extract' ? extractionOutputTokens(input?.messages) : MODEL_OUTPUT_TOKENS;
  const request = { system, input, maxOutputTokens };
  const inputTokens = tokens(modelRequestText(system, input, maxOutputTokens));
  if (inputTokens > MODEL_INPUT_TOKENS || (maxOutputTokens > MODEL_OUTPUT_TOKENS &&
      inputTokens + maxOutputTokens > model.contextWindow)) reject('context_budget_exceeded');
  check();
  if (legacyFreshness) { validateFresh(); check(); }
  controller = new AbortController();
  let timer;
  let output;
  const freshnessFailure = {};
  const serializationFailure = {};
  let freshnessError, providerInvoked = false;
  try {
    try {
    output = await Promise.race([
      Promise.resolve().then(async () => {
        check();
        const detached = structuredClone(request);
        check();
        // A token counter may have queued a discard before this invocation
        // microtask. Keep trusted freshness failures distinct from model errors
        // so the provider catch below cannot launder either one's authority.
        try { validateFresh(); }
        catch (error) { freshnessError = error; return freshnessFailure; }
        check();
        assertContentPort({before:true});
        // Synchronous durable dispatch fence, after freshness and before any
        // provider call. Its errors keep their trusted storage provenance.
        try { beforeDispatch(); }
        catch (error) { freshnessError = error; return freshnessFailure; }
        providerInvoked = true;
        return assertContentPort({invoke:async()=>{
          try {
            let result;
            const hostStart = onHostWait ? performance.now() : undefined;
            try {
              result = await (protectedRead
                ? Reflect.apply(provider,model,[{ ...detached, signal: controller.signal }])
                : model[method]({ ...detached, signal: controller.signal }));
            } finally {
              if (onHostWait) onHostWait(performance.now() - hostStart);
            }
            if (observeAbort()) return { aborted: true };
            let snapshot;
            try {
              // Preserve ordinary output fields, including undefined fields
              // that a planner must still reject. Legacy serialization hooks
              // finish here too, before the epoch observation.
              if (result && typeof result.toJSON === 'function') JSON.stringify(result);
              snapshot=inertContentPortValue(result, 'invalid_model_output');
            }
            catch { return { serializationError: true }; }
            return { value: snapshot };
          } catch (error) {
            observeAbort();
            // Exception properties are caller data too. Inspect them before
            // the epoch read, and keep only engine-owned primitive framing.
            let code, name, trusted = false;
            try {
              const rawCode = error?.code, rawName = error?.name;
              code = typeof rawCode === 'string' ? rawCode : undefined;
              name = typeof rawName === 'string' ? rawName : undefined;
              trusted = error instanceof MemoryStoreError;
            } catch { /* Uncopyable errors become ordinary provider failures. */ }
            return { providerError: true, error: trusted
              ? new MemoryStoreError(code) : { code, name } };
          }
        }});
      }),
      new Promise((_, reject) => {
        timer = setTimeout(() => {
          aborted=true;
          coreDeadlineSignals.add(controller.signal);
          assertContentPort({invoke:()=>controller.abort()});
          reject(new MemoryStoreError('model_timeout'));
        }, deadline ? deadline.remainingMs() : 30_000);
      }),
    ]);
    } finally {
      // Fence the outermost await, after materialization and before either
      // error framing, output inspection or another caller dispatch.
      if (providerInvoked) try { assertContentPort(); }
      catch (error) { freshnessError = error; throw freshnessFailure; }
    }
    if (output === freshnessFailure) throw freshnessFailure;
    if (output.serializationError) output=serializationFailure;
    else {
      if (output.providerError) throw output.error;
      output = output.value;
    }
  } catch (error) {
    if (error === freshnessFailure) { check(); throw freshnessError; }
    check();
    if (aborted || error?.code === 'model_timeout') reject('model_timeout');
    if (error?.name === 'AbortError') reject('model_cancelled');
    // Consolidation retries only explicit transient provider framing. Other
    // calls retain their existing error contract; messages never cross ports.
    if (method === 'consolidate' && (['ETIMEDOUT', 'ECONNRESET', 'ECONNREFUSED', 'ENETUNREACH',
      'EAI_AGAIN', 'rate_limit_exceeded', 'rate_limit', '429', 'network_error', 'deadline',
      'model_deadline', 'model_rate_limited', 'consolidation_transient', 'rate_limited'].includes(error?.code) ||
      ['TimeoutError', 'APIConnectionError', 'RateLimitError', 'TypeError'].includes(error?.name))) reject('consolidation_transient', 'provider_failure');
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
  // S2h captures this same S1 snapshot after serialization, immediately
  // before the output counter. E1 already fenced the provider return.
  if (legacyFreshness || output === serializationFailure) validateFresh();
  check();
  if (output === serializationFailure) reject('invalid_model_output', 'output_serialization');
  let text;
  try { text = JSON.stringify(output); }
  catch { check(); if (!legacyFreshness) validateFresh(); reject('invalid_model_output', 'output_serialization'); }
  check();
  if (typeof text !== 'string' || text.length > 40_000) { if (!legacyFreshness) validateFresh(); reject('invalid_model_output', 'output_bounds'); }
  if (tokens(text) > maxOutputTokens) reject('invalid_model_output', 'output_bounds');
  check();
  validateFresh();
  check();
  return output;
}

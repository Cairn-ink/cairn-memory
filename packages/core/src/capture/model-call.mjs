import { CoreError } from '../errors.mjs';
import { countTokens, MODEL_INPUT_TOKENS, MODEL_OUTPUT_TOKENS, modelRequestText } from './request-size.mjs';
import { detach } from './validate.mjs';
import { buildModelRequest, decodeModelOutput } from './wire.mjs';

/** @import { CallOptions, DiagnosticEvent, OwnerId } from '../ports/common.d.ts' */
/** @import { ModelGate, ModelPort, ModelRequest, ModelStage } from '../ports/model.d.ts' */
/** @import { createCaptureDeadline } from './deadline.mjs' */
/** @typedef {Parameters<typeof buildModelRequest>[0]} Method */
/** @typedef {Parameters<typeof buildModelRequest>[1]} Request */
/** @typedef {NonNullable<Parameters<typeof buildModelRequest>[2]>['qualificationInputMode']} InputMode */
/** @typedef {ReturnType<typeof createCaptureDeadline>} Deadline */
/** @typedef {ConstructorParameters<typeof CoreError>[0]} ErrorCode */
/** @typedef {{
 *   failureCode?: ErrorCode, deadline?: Deadline, validateFresh?: () => void,
 *   beforeDispatch?: () => void, gate?: ModelGate, owner?: OwnerId,
 *   signal?: AbortSignal, onDiagnostic?: CallOptions['onDiagnostic'], qualificationInputMode?: InputMode,
 * }} ModelCallOptions */

export const MIN_CONTEXT_WINDOW = 8192;
const MAX_OUTPUT_UNITS = 40_000;
const DEFAULT_TIMEOUT_MS = 30_000;

/** @param {CallOptions['onDiagnostic']} observer @param {DiagnosticEvent} event */
function notify(observer, event) {
  try { Promise.resolve(observer?.(event)).catch(() => {}); }
  catch { /* Observation must not change the operation's result. */ }
}

/** @param {CallOptions['onDiagnostic']} observer @param {Method} stage @param {string} layer @param {string} reason */
export function emitDiagnostic(observer, stage, layer, reason) {
  notify(observer, Object.freeze({ version: 1, stage, layer, reason }));
}

/** @param {Deadline | undefined} deadline @param {AbortSignal | undefined} caller */
function callSignal(deadline, caller) {
  const remaining = deadline ? deadline.remainingMs() : DEFAULT_TIMEOUT_MS;
  if (remaining <= 0) throw new CoreError('model_timeout');
  const timeout = AbortSignal.timeout(remaining);
  const signal = AbortSignal.any(caller ? [caller, timeout] : [timeout]);
  const timedOut = () => timeout.aborted && signal.reason === timeout.reason;
  return { signal, timedOut };
}

/** @param {AbortSignal} signal @param {() => Promise<unknown>} invoke */
async function untilAborted(signal, invoke) {
  if (signal.aborted) throw signal.reason;
  /** @type {() => void} */
  let onAbort = () => {};
  const abort = new Promise((_, reject) => {
    onAbort = () => reject(signal.reason);
    signal.addEventListener('abort', onAbort, { once: true });
  });
  try { return await Promise.race([abort, invoke()]); }
  finally { signal.removeEventListener('abort', onAbort); }
}

/** @param {unknown} error @param {ErrorCode} failureCode @returns {never} */
function trustedFailure(error, failureCode) {
  if (error instanceof CoreError) throw error;
  throw new CoreError(failureCode);
}

/**
 * A bounded adapter call outside any unit of work.
 * @param {ModelPort | null | undefined} model
 * @param {Method} method
 * @param {Request} request
 * @param {ModelCallOptions} [options]
 */
export async function callModel(model, method, request, options = {}) {
  const { failureCode = method === 'extract' ? 'extraction_failed' : 'qualification_failed',
    deadline, validateFresh, beforeDispatch, gate, owner, signal: caller, onDiagnostic,
    qualificationInputMode } = options;
  /** @param {Method} stage @param {string} layer @param {string} reason */
  const report = (stage, layer, reason) => emitDiagnostic(onDiagnostic, stage, layer, reason);
  /** @param {ErrorCode} code @param {string} [reason] @returns {never} */
  function reject(code, reason = code) {
    report(method, 'core_call', reason);
    throw new CoreError(code);
  }
  const check = () => { if (deadline?.expired()) reject('model_timeout'); };
  /** @param {(() => void) | undefined} hook */
  const runHook = (hook) => {
    try { hook?.(); }
    catch (error) { check(); trustedFailure(error, failureCode); }
  };
  /** @param {string} text */
  const tokens = (text) => {
    check();
    runHook(validateFresh);
    try { return countTokens(/** @type {ModelPort} */ (model), text); }
    catch {
      report(method, 'core_call', 'token_count_unavailable');
      throw new CoreError('token_count_unavailable');
    } finally { check(); }
  };
  /** @param {Parameters<ModelGate['assertOpen']>[1]} phase */
  const assertOpen = async (phase) => {
    try { await gate?.assertOpen(/** @type {OwnerId} */ (owner), phase); }
    catch (error) { trustedFailure(error, failureCode); }
  };

  check();
  const args = detach(request, 'invalid_input');
  /** @type {ModelPort['call'] | undefined} */
  let provider;
  try { provider = model?.call; }
  catch { reject('model_not_configured'); }
  if (typeof provider !== 'function') return reject('model_not_configured');
  /** @type {number | undefined} */
  let contextWindow;
  try { contextWindow = model?.contextWindow; }
  catch { reject('context_budget_exceeded'); }
  if (contextWindow === undefined || !Number.isSafeInteger(contextWindow) || contextWindow < MIN_CONTEXT_WINDOW) {
    reject('context_budget_exceeded');
  }

  if (gate) await assertOpen('pre-send');
  const { system, input, maxOutputTokens } = args;
  let sizingText;
  try { sizingText = modelRequestText(system, input, maxOutputTokens); }
  catch { throw new CoreError('invalid_input'); }
  if (tokens(sizingText) > MODEL_INPUT_TOKENS) reject('context_budget_exceeded');
  check();
  const built = buildModelRequest(method, args, { qualificationInputMode, report });

  // A counter can queue a freshness change before the provider invocation.
  await Promise.resolve();
  check();
  runHook(validateFresh);
  check();
  runHook(beforeDispatch);
  check();

  let boundary;
  try { boundary = callSignal(deadline, caller); }
  catch (error) {
    if (error instanceof CoreError && error.code === 'model_timeout') return reject('model_timeout');
    return trustedFailure(error, failureCode);
  }
  const { signal, timedOut } = boundary;
  const checkAbort = () => {
    if (timedOut()) reject('model_timeout');
    // The cancellation diagnostic is stable while the error code is pending.
    if (signal.aborted) reject('internal_error', 'model_cancelled');
  };
  if (gate) {
    await assertOpen('dispatch');
    check();
  }
  checkAbort();

  let output;
  let providerError;
  let failed = false;
  try {
    output = await untilAborted(signal, async () => provider.call(model, built.stage, built.request,
      { signal, onDiagnostic: onDiagnostic && (event => notify(onDiagnostic, event)) }));
  } catch (error) {
    failed = true;
    providerError = error;
  } finally {
    if (gate) await assertOpen('post-send');
  }

  check();
  checkAbort();
  if (failed) {
    let code, name;
    let adapterError;
    try {
      const error = /** @type {{code?: unknown, name?: unknown} | null | undefined} */ (providerError);
      code = error?.code;
      name = error?.name;
      adapterError = error instanceof CoreError ? error : undefined;
    } catch { return reject(failureCode, 'provider_failure'); }
    if (code === 'model_timeout') reject('model_timeout');
    if (name === 'AbortError') reject('internal_error', 'model_cancelled');
    if (adapterError && (code === 'context_budget_exceeded' || code === 'token_count_unavailable' ||
        code === 'invalid_model_output')) {
      report(method, 'core_call', code === 'invalid_model_output' ? 'adapter_output_invalid' : code);
      throw new CoreError(code);
    }
    reject(failureCode, 'provider_failure');
  }

  let text;
  try {
    output = structuredClone(output);
    text = JSON.stringify(output);
  } catch {
    check();
    runHook(validateFresh);
    return reject('invalid_model_output', 'output_serialization');
  }
  check();
  if (typeof text !== 'string' || text.length > MAX_OUTPUT_UNITS) {
    runHook(validateFresh);
    return reject('invalid_model_output', 'output_bounds');
  }

  let decoded;
  try { decoded = decodeModelOutput(method, built, output, report); }
  catch { return reject('invalid_model_output', 'adapter_output_invalid'); }
  // The engine sizes the adapter's logical result after wire decoding.
  if (method === 'qualifyCandidates') text = JSON.stringify(decoded);
  if (text.length > MAX_OUTPUT_UNITS || tokens(text) > MODEL_OUTPUT_TOKENS) {
    reject('invalid_model_output', 'output_bounds');
  }
  check();
  runHook(validateFresh);
  check();
  return decoded;
}

/**
 * The optional synchronous adapter hook sees the request it would send.
 * @param {ModelPort} model
 * @param {Method} method
 * @param {Request} request
 * @param {InputMode} qualificationInputMode
 */
export function adapterFits(model, method, request, qualificationInputMode) {
  try {
    const fit = /** @type {ModelPort & {fits?: (stage: ModelStage, request: ModelRequest) => boolean}} */ (model).fits;
    if (fit === undefined) return true;
    const built = buildModelRequest(method, request, { qualificationInputMode });
    const result = /** @type {unknown} */ (fit.call(model, built.stage, built.request));
    if (typeof result === 'boolean') return result;
    // A port that violates the synchronous contract can still reject.
    if (result instanceof Promise) Promise.prototype.then.call(result, undefined, () => {});
  } catch { /* Unavailable adapter sizing means the request does not fit. */ }
  return false;
}

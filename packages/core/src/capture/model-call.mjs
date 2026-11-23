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
/** The guarded call uses its method as the diagnostic stage. */
/** @typedef {(stage: string, layer: string, reason: string) => void} DiagnosticReport */
/**
 * @template Output
 * @typedef {{
 *   stage: ModelStage, request: ModelRequest, validationSchema?: object, sizingText: string,
 *   decode: (rawOutput: unknown, report: DiagnosticReport) => Output,
 * }} BuiltModelRequest */

export const MIN_CONTEXT_WINDOW = 8192;
const MAX_OUTPUT_UNITS = 40_000;
const DEFAULT_TIMEOUT_MS = 30_000;
// Only the capture entry can defer building until after the dispatch-path deadline check.
const CAPTURE_REQUEST = Symbol('capture request');
const MODEL_STAGES = ['extract', 'qualify', 'reconcile', 'classify', 'rationale'];

/** @param {CallOptions['onDiagnostic']} observer @param {DiagnosticEvent} event */
function notify(observer, event) {
  try { Promise.resolve(observer?.(event)).catch(() => {}); }
  catch { /* Observation must not change the operation's result. */ }
}

/** @param {CallOptions['onDiagnostic']} observer @param {string} stage @param {string} layer @param {string} reason */
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

/** @param {AbortSignal} signal @param {Promise<unknown>} pending */
async function untilAborted(signal, pending) {
  /** @type {() => void} */
  let onAbort = () => {};
  const abort = new Promise((_, reject) => {
    onAbort = () => reject(signal.reason);
    if (signal.aborted) onAbort();
    else signal.addEventListener('abort', onAbort, { once: true });
  });
  try { return await Promise.race([abort, pending]); }
  finally { signal.removeEventListener('abort', onAbort); }
}

/** @param {unknown} error @param {ErrorCode} fallback */
export function modelError(error, fallback = 'internal_error') {
  try { if (error instanceof CoreError) return error; }
  catch { /* A thrown proxy may trap the prototype lookup. */ }
  return new CoreError(fallback);
}

/** @param {BuiltModelRequest<unknown>} built @returns {BuiltModelRequest<unknown>} */
function snapshotBuilt(built) {
  try {
    const { stage, request, validationSchema, sizingText, decode } = built;
    const data = structuredClone({ stage, request, validationSchema, sizingText });
    const req = data.request;
    if (!MODEL_STAGES.includes(data.stage) || typeof data.sizingText !== 'string' ||
        !req || typeof req !== 'object' || Array.isArray(req) ||
        typeof req.system !== 'string' || !Object.hasOwn(req, 'input') ||
        !Number.isSafeInteger(req.maxOutputTokens) || req.maxOutputTokens <= 0 ||
        (req.schema !== undefined && (!req.schema || typeof req.schema !== 'object')) ||
        (req.schemaName !== undefined && typeof req.schemaName !== 'string') ||
        (data.validationSchema !== undefined && (!data.validationSchema || typeof data.validationSchema !== 'object')) ||
        typeof decode !== 'function') {
      throw new CoreError('invalid_input');
    }
    return { ...data, decode };
  } catch { throw new CoreError('invalid_input'); }
}

/**
 * Capture builds its wire at the engine's dispatch checkpoint.
 * @param {ModelPort | null | undefined} model
 * @param {Method} method
 * @param {Request} request
 * @param {ModelCallOptions} [options]
 */
export function callModel(model, method, request, options = {}) {
  return callBuiltModel(model, method, request, options, CAPTURE_REQUEST);
}

/**
 * A bounded adapter call outside any unit of work.
 * @template Output
 * @overload
 * @param {ModelPort | null | undefined} model
 * @param {string} method
 * @param {BuiltModelRequest<Output>} built
 * @param {ModelCallOptions} [options]
 * @returns {Promise<Output>}
 */
/**
 * @overload
 * @param {ModelPort | null | undefined} model
 * @param {Method} method
 * @param {Request} built
 * @param {ModelCallOptions} options
 * @param {typeof CAPTURE_REQUEST} capture
 * @returns {Promise<ReturnType<typeof decodeModelOutput>>}
 */
/**
 * @param {ModelPort | null | undefined} model
 * @param {string} method
 * @param {BuiltModelRequest<unknown> | Request} built
 * @param {ModelCallOptions} [options]
 * @param {typeof CAPTURE_REQUEST} [capture]
 */
export async function callBuiltModel(model, method, built, options = {}, capture) {
  try { return await call(model, method, built, options, capture === CAPTURE_REQUEST); }
  catch (error) { throw modelError(error); }
}

/**
 * @param {ModelPort | null | undefined} model
 * @param {string} method
 * @param {BuiltModelRequest<unknown> | Request} request
 * @param {ModelCallOptions} options
 * @param {boolean} capture
 */
async function call(model, method, request, options, capture) {
  const { failureCode = method === 'extract' ? 'extraction_failed' : 'qualification_failed',
    deadline, validateFresh, beforeDispatch, gate, owner, signal: caller, onDiagnostic,
    qualificationInputMode } = options;
  /** @type {DiagnosticReport} */
  const report = (_stage, layer, reason) => emitDiagnostic(onDiagnostic, method, layer, reason);
  /** @param {ErrorCode} code @param {string} [reason] @returns {never} */
  function reject(code, reason = code) {
    report(method, 'core_call', reason);
    throw new CoreError(code);
  }
  let deadlineReported = false;
  const check = () => {
    if (!deadline?.expired()) return;
    if (!deadlineReported) {
      deadlineReported = true;
      reject('model_timeout');
    }
    throw new CoreError('model_timeout');
  };
  /** @param {(() => void) | undefined} hook */
  const runHook = (hook) => {
    try { hook?.(); }
    catch (error) { throw modelError(error, failureCode); }
  };
  // The engine rechecks the deadline when a dispatch-path clock read fails.
  /** @param {unknown} error @returns {never} */
  function dispatchFailure(error) {
    check();
    if (error instanceof CoreError && error.code === 'model_timeout') throw error;
    return reject(failureCode, 'provider_failure');
  }
  const checkDispatch = () => {
    try { check(); }
    catch (error) { dispatchFailure(error); }
  };
  /** @param {(() => void) | undefined} hook */
  const runDispatchHook = (hook) => {
    try { runHook(hook); }
    catch (error) { check(); throw error; }
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
  check();
  const args = capture ? detach(/** @type {Request} */ (request), 'invalid_input') : undefined;
  if (capture && args == null) throw new CoreError('invalid_input');
  const prebuilt = capture ? undefined : snapshotBuilt(/** @type {BuiltModelRequest<unknown>} */ (request));
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

  const gateOwner = /** @type {OwnerId} */ (owner);
  if (gate) {
    try { await gate.assertOpen(gateOwner, 'pre-send'); }
    catch (error) { throw modelError(error, failureCode); }
  }
  let sizingText;
  if (prebuilt) {
    sizingText = prebuilt.sizingText;
  } else {
    const { system, input, maxOutputTokens } = /** @type {Request} */ (args);
    try { sizingText = modelRequestText(system, input, maxOutputTokens); }
    catch { throw new CoreError('invalid_input'); }
  }
  if (tokens(sizingText) > MODEL_INPUT_TOKENS) reject('context_budget_exceeded');
  check();

  let boundary;
  try { boundary = callSignal(deadline, caller); }
  catch (error) {
    if (error instanceof CoreError && error.code === 'model_timeout') {
      check();
      return reject('model_timeout');
    }
    return dispatchFailure(error);
  }
  const { signal, timedOut } = boundary;
  const checkAbort = () => {
    if (timedOut()) reject('model_timeout');
    // A non-deadline abort is the engine's model_cancelled (Phase 0 addendum 2).
    if (signal.aborted) reject('model_cancelled');
  };
  // A counter can queue a freshness change before the provider invocation.
  await Promise.resolve();
  checkDispatch();
  const built = prebuilt ?? buildCaptureRequest(/** @type {Method} */ (method), /** @type {Request} */ (args),
    qualificationInputMode, report);
  checkDispatch();
  runDispatchHook(validateFresh);
  checkDispatch();
  runDispatchHook(beforeDispatch);

  let output;
  let providerError;
  let failed = false;
  /** @type {CallOptions} */
  const portOptions = { signal, onDiagnostic: onDiagnostic && (event => notify(onDiagnostic, event)) };
  if (gate) {
    try { await gate.assertOpen(gateOwner, 'dispatch'); }
    catch (error) { throw modelError(error, failureCode); }
    // The gate await is the only await after the engine's last pre-dispatch deadline read, so a
    // deadline that expired during it must stop the send. Synchronous: nothing may await between
    // this check and the provider invocation. Without a gate the engine's read sequence is kept.
    checkDispatch();
  }
  checkAbort();
  try {
    const pending = Reflect.apply(provider, model, [built.stage, built.request, portOptions]);
    output = await untilAborted(signal, pending);
  } catch (error) {
    failed = true;
    providerError = error;
  } finally {
    if (gate) {
      try { await gate.assertOpen(gateOwner, 'post-send'); }
      catch (error) { throw modelError(error, failureCode); }
    }
  }

  if (failed) {
    check();
    checkAbort();
    let code, name;
    let adapterError;
    try {
      const error = /** @type {{code?: unknown, name?: unknown} | null | undefined} */ (providerError);
      code = error?.code;
      name = error?.name;
      adapterError = error instanceof CoreError ? error : undefined;
    } catch { return reject(failureCode, 'provider_failure'); }
    if (code === 'model_timeout') reject('model_timeout');
    if (name === 'AbortError') reject('model_cancelled');
    if (adapterError && (code === 'context_budget_exceeded' || code === 'token_count_unavailable' ||
        code === 'invalid_model_output')) {
      report(method, 'core_call', code === 'invalid_model_output' ? 'adapter_output_invalid' : code);
      throw new CoreError(code);
    }
    reject(failureCode, 'provider_failure');
  }

  checkAbort();
  try {
    output = structuredClone(output);
  } catch {
    check();
    runHook(validateFresh);
    check();
    return reject('invalid_model_output', 'output_serialization');
  }
  check(); // Provider result materialized.
  check(); // Next, the engine fences serialization.
  let text;
  try { text = JSON.stringify(output); }
  catch {
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
  try { decoded = built.decode(output, report); }
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

/** @param {Method} method @param {Request} args @param {InputMode | undefined} qualificationInputMode
 * @param {DiagnosticReport} report @returns {BuiltModelRequest<ReturnType<typeof decodeModelOutput>>} */
function buildCaptureRequest(method, args, qualificationInputMode, report) {
  const built = buildModelRequest(method, args, { qualificationInputMode, report });
  return { ...built, decode: (raw, report) => decodeModelOutput(method, built, raw, report) };
}

export const QUALIFICATION_PILOT_LIMITS = Object.freeze({ requests: 100, microUsd: 1_000_000,
  reservationMicroUsd: 5000 });
export const CANDIDATE_QUALIFICATION_LIMITS = Object.freeze({ requests: 36, microUsd: 180000,
  reservationMicroUsd: 5000 });
export const SOURCE_SUPPORT_LIMITS = Object.freeze({ requests: 96, microUsd: 480000,
  reservationMicroUsd: 5000 });
export const RATIONALE_LIMITS = Object.freeze({ requests: 384, microUsd: 1920000,
  reservationMicroUsd: 5000 });
export const SOURCE_SCAN_LIMITS = Object.freeze({ requests: 64, microUsd: 320000,
  reservationMicroUsd: 5000 });
export const RATIONALE_MODEL_LIMITS = Object.freeze({ requests: 96, microUsd: 2048000 });
export const RATIONALE_CORRECTION_LIMITS = Object.freeze({ requests: 6, microUsd: 30000,
  reservationMicroUsd: 5000 });
const RATIONALE_MODEL_RESERVATIONS = Object.freeze({
  'gpt-4.1-mini-2025-04-14': 5000, 'gpt-5.6-luna': 3000, 'gpt-5.6-sol': 56000,
});
const fail = code => { throw new Error(code); };
const exact = (value, keys) => value && typeof value === 'object' && !Array.isArray(value)
  && Object.keys(value).sort().join(',') === [...keys].sort().join(',');
const integer = value => Number.isSafeInteger(value) && value >= 0;

/** Additional one-shot cap only; send must use the existing durable campaign guard. */
export function createQualificationPilotAttempt(options) {
  return createAttempt(options, QUALIFICATION_PILOT_LIMITS, ['cairn_extract', 'cairn_qualify', 'cairn_classify']);
}

export function createCandidateQualificationAttempt(options) {
  return createAttempt(options, CANDIDATE_QUALIFICATION_LIMITS, ['cairn_extract', 'cairn_qualifyCandidates', 'cairn_classify']);
}

export function createSourceSupportAttempt(options) {
  return createAttempt(options, SOURCE_SUPPORT_LIMITS,
    ['cairn_extract', 'cairn_qualifyCandidates', 'cairn_classify', 'cairn_select', 'cairn_rank']);
}

export function createRationaleAttempt(options) {
  return createAttempt(options, RATIONALE_LIMITS,
    ['cairn_extract', 'cairn_qualifyCandidates', 'cairn_classify', 'cairn_relate', 'cairn_select', 'cairn_rank']);
}

export function createSourceScanAttempt(options) {
  return createAttempt(options, SOURCE_SCAN_LIMITS, ['cairn_select', 'cairn_rank']);
}

export function createRationaleModelAttempt(options) {
  return createAttempt(options, RATIONALE_MODEL_LIMITS, ['cairn_relate'], RATIONALE_MODEL_RESERVATIONS);
}

export function createBasisComparisonAttempt(options) {
  return createAttempt(options, RATIONALE_MODEL_LIMITS,
    ['cairn_relate', 'cairn_reviewBasis'], RATIONALE_MODEL_RESERVATIONS);
}

// A separate closed cap for one three-case source-only correction diagnostic.
// The caller still supplies the existing durable campaign guard as send.
export function createRationaleCorrectionAttempt(options) {
  return createAttempt(options, RATIONALE_CORRECTION_LIMITS, ['cairn_relate']);
}

function createAttempt(options, limits, methods, modelReservations = null) {
  if (!exact(options, ['readState', 'checkPins', 'persist', 'send', 'expectedCheckpoint'])) fail('invalid_attempt');
  const { readState, checkPins, persist, send, expectedCheckpoint } = options;
  if ([readState, checkPins, persist, send].some(value => typeof value !== 'function')
    || !exact(expectedCheckpoint, ['requestCount', 'reservedMicroUsd'])
    || !Object.values(expectedCheckpoint).every(integer)) fail('invalid_attempt');
  let expected = structuredClone(expectedCheckpoint);
  const initial = readState();
  const matches = actual => actual?.state === 'open' && Array.isArray(actual.attempts)
    && actual.attempts.every(item => item.outcome !== null)
    && actual.requestCount === expected.requestCount && actual.reservedMicroUsd === expected.reservedMicroUsd;
  if (!matches(initial) || !integer(initial.limitMicroUsd) || initial.limitMicroUsd > 50_000_000
    || !integer(initial.requestCap) || initial.requestCap - expected.requestCount < limits.requests
    || initial.limitMicroUsd - expected.reservedMicroUsd < limits.microUsd) fail('insufficient_budget');
  const before = structuredClone(expected);
  let halted = null, requests = 0, reservedMicroUsd = 0, readOnly = false, queue = Promise.resolve();
  const halt = code => { halted ??= code; return new Error(halted); };
  const getState = () => ({ before: structuredClone(before), requests, reservedMicroUsd, halted, readOnly });
  const checkState = () => { if (!matches(readState())) fail('unexpected_accounting'); };
  function request(path, body, requestOptions = {}) {
    const pending = queue.then(async () => {
      if (halted) throw halt(halted);
      let entry;
      try {
        if (!requestOptions || typeof requestOptions !== 'object' || Array.isArray(requestOptions)
          || Object.keys(requestOptions).some(key => key !== 'signal')) fail('request_rejected');
        const signal = requestOptions.signal ?? new AbortController().signal;
        if (readOnly) fail('read_only_request');
        if (!['/responses', '/responses/input_tokens'].includes(path) || typeof body !== 'string'
          || !(signal instanceof AbortSignal)) fail('request_rejected');
        let parsed;
        try { parsed = JSON.parse(body); } catch { fail('request_rejected'); }
        if ((modelReservations === null ? parsed?.model !== 'gpt-4.1-mini-2025-04-14'
          : !Object.prototype.hasOwnProperty.call(modelReservations, parsed?.model))
          || !methods.includes(parsed?.text?.format?.name)) fail('request_rejected');
        const reservation = modelReservations === null ? 5000 : modelReservations[parsed.model];
        await checkPins(); checkState();
        if (requests >= limits.requests || reservedMicroUsd + reservation > limits.microUsd) fail('attempt_limit');
        requests++; reservedMicroUsd += reservation;
        entry = { sequence: requests, endpoint: path, method: parsed.text.format.name,
          reservedMicroUsd: reservation, status: 'reserved' };
        await persist(`request-${requests}-reserved`, entry);
        await checkPins(); checkState();
        if (halted || readOnly) fail(readOnly ? 'read_only_request' : 'operator_halted');
        const response = await send(path, body, { signal });
        expected = { requestCount: expected.requestCount + 1, reservedMicroUsd: expected.reservedMicroUsd + reservation };
        checkState();
        if (!response?.ok || response.redirected) fail('transport_failed');
        await persist(`request-${requests}-settled`, { ...entry, status: 'settled', httpStatus: response.status });
        await checkPins(); checkState();
        return response;
      } catch (error) {
        const code = ['unexpected_accounting', 'attempt_limit', 'request_rejected', 'transport_failed',
          'read_only_request', 'operator_halted'].includes(error?.message) ? error.message : 'guard_pin_or_persistence_failed';
        halt(code);
        try { await persist(`request-${requests}-halted`, { ...(entry ?? {}), ...getState() }); } catch { /* Keep original error. */ }
        throw halt(code);
      }
    });
    queue = pending.then(() => undefined, () => undefined);
    return pending;
  }
  return Object.freeze({ request, getState, drain: () => queue,
    beginReadOnly() { readOnly = true; }, endReadOnly() { if (halted) throw halt(halted); readOnly = false; },
    stop() { halt('operator_halted'); } });
}

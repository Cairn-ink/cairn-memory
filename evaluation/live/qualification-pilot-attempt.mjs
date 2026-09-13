export const QUALIFICATION_PILOT_LIMITS = Object.freeze({ requests: 100, microUsd: 1_000_000,
  reservationMicroUsd: 5000 });
const fail = code => { throw new Error(code); };
const exact = (value, keys) => value && typeof value === 'object' && !Array.isArray(value)
  && Object.keys(value).sort().join(',') === [...keys].sort().join(',');
const integer = value => Number.isSafeInteger(value) && value >= 0;

/** Additional one-shot cap only; send must use the existing durable campaign guard. */
export function createQualificationPilotAttempt(options) {
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
    || !integer(initial.requestCap) || initial.requestCap - expected.requestCount < 100
    || initial.limitMicroUsd - expected.reservedMicroUsd < 1_000_000) fail('insufficient_budget');
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
        if (parsed?.model !== 'gpt-4.1-mini-2025-04-14'
          || !['cairn_extract', 'cairn_qualify', 'cairn_classify'].includes(parsed?.text?.format?.name)) fail('request_rejected');
        await checkPins(); checkState();
        if (requests >= 100 || reservedMicroUsd + 5000 > 1_000_000) fail('attempt_limit');
        requests++; reservedMicroUsd += 5000;
        entry = { sequence: requests, endpoint: path, method: parsed.text.format.name,
          reservedMicroUsd: 5000, status: 'reserved' };
        await persist(`request-${requests}-reserved`, entry);
        await checkPins(); checkState();
        if (halted || readOnly) fail(readOnly ? 'read_only_request' : 'operator_halted');
        const response = await send(path, body, { signal });
        expected = { requestCount: expected.requestCount + 1, reservedMicroUsd: expected.reservedMicroUsd + 5000 };
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

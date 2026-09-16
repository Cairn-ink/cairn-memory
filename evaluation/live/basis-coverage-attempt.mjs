import { createBasisComparisonAttempt } from './qualification-pilot-attempt.mjs';

export const BASIS_COVERAGE_LIMITS = Object.freeze({ requests: 80, microUsd: 240_000,
  reservationMicroUsd: 3_000, expectedRequests: 64, slots: 16 });
const fail = code => { throw new Error(code); };

/** Stricter one-shot cap around the existing durable comparison attempt. */
export function createBasisCoverageAttempt(options) {
  const base = createBasisComparisonAttempt(options);
  let queue = Promise.resolve();
  const request = (route, body, requestOptions) => {
    const pending = queue.then(() => {
      if (base.getState().halted) fail('basis_coverage_halted');
      const state = base.getState();
      let parsed;
      try { parsed = JSON.parse(body); } catch { /* Fail closed below. */ }
      if (state.requests >= BASIS_COVERAGE_LIMITS.requests
        || state.reservedMicroUsd + BASIS_COVERAGE_LIMITS.reservationMicroUsd > BASIS_COVERAGE_LIMITS.microUsd
        || !['/responses', '/responses/input_tokens'].includes(route)
        || parsed?.model !== 'gpt-5.6-luna' || parsed?.text?.format?.name !== 'cairn_reviewBasis') {
        base.stop(); fail('basis_coverage_limit_or_route');
      }
      return base.request(route, body, requestOptions);
    });
    queue = pending.then(() => undefined, () => undefined);
    return pending;
  };
  return Object.freeze({ request, getState: base.getState,
    drain: async () => { await queue; await base.drain(); }, stop: base.stop });
}

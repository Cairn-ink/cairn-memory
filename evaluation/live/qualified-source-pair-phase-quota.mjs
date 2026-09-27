import { isDeepStrictEqual } from 'node:util';
import { ExperimentRequestGuardError } from '../experiment-budget/request-guard.mjs';

export class QualifiedSourcePairPhaseQuotaError extends Error {
  constructor(code) { super(code); this.name = 'QualifiedSourcePairPhaseQuotaError'; this.code = code; }
}

const fail = (code) => { throw new QualifiedSourcePairPhaseQuotaError(code); };
const own = (value, key) => Object.hasOwn(value, key);
const exact = (value, keys) => value !== null && typeof value === 'object' && !Array.isArray(value)
  && Object.keys(value).length === keys.length && keys.every((key) => own(value, key));
const nonnegative = (value) => Number.isSafeInteger(value) && value >= 0;
const freeze = (value) => {
  if (value && typeof value === 'object') {
    for (const child of Object.values(value)) freeze(child);
    Object.freeze(value);
  }
  return value;
};

// A conservative launcher-local dispatch bound, not ledger accounting or a
// native guard grant. The only provider routes exposed to a model are below.
export function createQualifiedSourcePairPhaseQuota(options) {
  if (!exact(options, ['guard', 'policy', 'stages', 'phaseCaps'])) fail('invalid_options');
  let policy, stages, phaseCaps, guard;
  try {
    guard = options.guard;
    policy = structuredClone(options.policy);
    stages = structuredClone(options.stages);
    phaseCaps = structuredClone(options.phaseCaps);
  } catch { fail('invalid_options'); }
  if (!exact(phaseCaps, ['generation', 'scoring'])
    || ['generation', 'scoring'].some((phase) => !exact(phaseCaps[phase],
      ['requests', 'reservedMicroUsd']) || !nonnegative(phaseCaps[phase].requests)
      || !nonnegative(phaseCaps[phase].reservedMicroUsd))) fail('invalid_phase_caps');
  let methods;
  try {
    methods = Object.fromEntries(['cairnFetch', 'answerFetch', 'judgeFetch', 'withCaseScope',
      'isHalted', 'getState'].map((name) => [name, guard[name]]));
    if (Object.values(methods).some((method) => typeof method !== 'function')
      || !own(guard, 'qualifiedSourcePairCapability')
      || !isDeepStrictEqual(guard.policy, policy) || !isDeepStrictEqual(guard.stages, stages)) {
      fail('configuration_mismatch');
    }
  } catch (error) {
    if (error instanceof QualifiedSourcePairPhaseQuotaError) throw error;
    fail('configuration_mismatch');
  }
  const routes = new Map();
  for (const [name, channel, phase, method] of [
    ['cairnCount', policy?.cairnCount, 'generation', 'cairnFetch'],
    ['cairnGeneration', policy?.cairnGeneration, 'generation', 'cairnFetch'],
    ['answer', stages?.answer, 'generation', 'answerFetch'],
    ['judge', stages?.judge, 'scoring', 'judgeFetch'],
  ]) {
    if (!channel || typeof channel.endpoint !== 'string' || !nonnegative(channel.reservedMicroUsd)
      || channel.reservedMicroUsd === 0 || routes.has(`${method}:${channel.endpoint}`)) {
      fail('configuration_mismatch');
    }
    routes.set(`${method}:${channel.endpoint}`, freeze({ name, phase,
      reservedMicroUsd: channel.reservedMicroUsd }));
  }
  const used = { generation: { requests: 0, reservedMicroUsd: 0 },
    scoring: { requests: 0, reservedMicroUsd: 0 } };
  let halted = false;
  let haltReason = null;
  const latch = (reason) => { halted = true; haltReason ??= reason; };
  const isHalted = () => {
    if (halted) return true;
    try {
      const value = methods.isHalted.call(guard);
      if (typeof value !== 'boolean') { latch('guard_state_invalid'); return true; }
      return value;
    } catch { latch('guard_state_failed'); return true; }
  };
  const observeFailure = (error) => {
    // G's recognized scope deadline and its blocked late descendants are the
    // only local rejections. Other route/scope errors can otherwise escape G
    // without setting its halt bit; the launcher must fence them globally.
    const local = error instanceof ExperimentRequestGuardError
      && ['case_deadline_exceeded', 'case_timeout_halted'].includes(error.code);
    if (!local || isHalted()) latch('dispatch_failed');
  };
  const invoke = (method, url, request) => {
    let result;
    try { result = methods[method].call(guard, url, request); }
    catch (error) { observeFailure(error); throw error; }
    return Promise.resolve(result).catch((error) => { observeFailure(error); throw error; });
  };
  const dispatch = (method, url, request) => {
    if (isHalted()) fail(haltReason ?? 'paid_work_halted');
    // The installed adapter and stage callbacks construct primitive endpoint
    // strings. Reject caller-defined URL accessors rather than invoking them.
    if (typeof url !== 'string') { latch('route_invalid'); fail(haltReason); }
    const route = routes.get(`${method}:${url}`);
    if (!route) { latch('route_invalid'); fail(haltReason); }
    try {
      const state = methods.getState.call(guard);
      if (!state || state.state !== 'open') { latch('guard_state_invalid'); fail(haltReason); }
    } catch (error) {
      if (error instanceof QualifiedSourcePairPhaseQuotaError) throw error;
      latch('guard_state_failed'); fail(haltReason);
    }
    const tally = used[route.phase];
    const requests = tally.requests + 1;
    const reservedMicroUsd = tally.reservedMicroUsd + route.reservedMicroUsd;
    if (!Number.isSafeInteger(requests) || !Number.isSafeInteger(reservedMicroUsd)
      || requests > phaseCaps[route.phase].requests
      || reservedMicroUsd > phaseCaps[route.phase].reservedMicroUsd) {
      latch('phase_cap_exceeded'); fail(haltReason);
    }
    // No await, caller callback or quota refund between this debit and G.
    tally.requests = requests;
    tally.reservedMicroUsd = reservedMicroUsd;
    return invoke(method, url, request);
  };
  const execution = Object.freeze({
    withCaseScope(identity, operation) {
      if (isHalted()) fail(haltReason ?? 'paid_work_halted');
      let result;
      try { result = methods.withCaseScope.call(guard, identity, operation); }
      catch (error) { observeFailure(error); throw error; }
      return Promise.resolve(result).catch((error) => { observeFailure(error); throw error; });
    },
    isHalted,
  });
  return Object.freeze({
    cairnFetch: (url, request) => dispatch('cairnFetch', url, request),
    answerFetch: (url, request) => dispatch('answerFetch', url, request),
    judgeFetch: (url, request) => dispatch('judgeFetch', url, request),
    execution,
    snapshot: () => freeze({ version: 'qualified-source-pair-phase-quota-v1',
      used: structuredClone(used), caps: structuredClone(phaseCaps), halted, haltReason }),
  });
}

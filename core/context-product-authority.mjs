import { isDeepStrictEqual, types } from 'node:util';
import { boundedData, credentialDigest } from './context-product-control.mjs';
import { deepFreeze } from './private-card-input.mjs';
import { fail } from './validation.mjs';

// Binding validation is separate from the two currentness samples. The host
// derives one method grant, not one independent grant per namespace.
export function requestAuthority(host, binding, control) {
  if (!host || ['authorize', 'isCurrent'].some(k => typeof host[k] !== 'function' || types.isAsyncFunction(host[k]))) fail('authority_required');
  return function enter(method, payload, credential) {
    if (credential === undefined || credential === null) fail('authority_required');
    boundedData(credential, 16384);
    if (credentialDigest(credential) !== binding.credentialDigest) fail('authority_required');
    const request = deepFreeze({ method, input: payload, ownerId: binding.ownerId, namespaces: binding.namespaces,
      requestControl: control, credentialBindingId: binding.credentialBindingId });
    let grant;
    try {
      grant = host.authorize(request, credential);
      if (!grant || typeof grant !== 'object' || typeof grant.then === 'function' ||
          !isDeepStrictEqual(boundedData(grant), binding)) fail('authority_required');
    } catch { fail('authority_required'); }
    let finalState = 'unsampled';
    function sample(code) {
      try { if (host.isCurrent(grant, request) === true) return; } catch { /* Unverifiable state refuses. */ }
      fail(code);
    }
    sample('authority_required');
    function final() {
      if (finalState === 'failed') fail('scope_changed');
      if (finalState === 'passed') return;
      finalState = 'failed'; sample('scope_changed'); finalState = 'passed';
    }
    return Object.freeze({
      // Kept stable across independently authenticated requests; no synthetic
      // namespace generations, request IDs or issuedAt enter snapshots.
      accessGenerations: { ownerGeneration: binding.ownerGeneration ?? null },
      check() {
        if (finalState === 'passed') fail('reader_failed');
        final();
      },
      envelope(build) {
        final();
        const result = build();
        if (result && typeof result.then === 'function') fail('reader_failed');
        return result;
      },
    });
  };
}

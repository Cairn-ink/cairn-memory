import { contentAuthorityPort } from './content-safety-boundary.mjs';
import { isDeepStrictEqual, types } from 'node:util';
import { boundedData, credentialDigest } from './context-product-control.mjs';
import { deepFreeze } from './private-card-input.mjs';
import { fail } from './validation.mjs';
import { refuseAuthority } from './context-product-refusal.mjs';
import { accessDigest } from './context-product-validation.mjs';

const promiseThen = Promise.prototype.then;
function observePromise(value) {
  if (!types.isPromise(value)) return false;
  // Refuse async authority, but consume rejection without reading an own then.
  Reflect.apply(promiseThen, value, [undefined, () => {}]);
  return true;
}

// Binding validation is separate from the two currentness samples. The host
// derives one method grant, not one independent grant per namespace.
export function requestAuthority(host, binding, control) {
  if (!host || ['authorize', 'isCurrent'].some(k => typeof host[k] !== 'function' || types.isAsyncFunction(host[k]))) refuseAuthority('host_port');
  // The separate S2c pull protocol retains its existing authority contract.
  if(!binding.suppression)host=contentAuthorityPort(host,boundedData);
  return function enter(method, payload, credential) {
    if (credential === undefined || credential === null) refuseAuthority('credential_missing');
    boundedData(credential, 16384);
    if (credentialDigest(credential) !== binding.credentialDigest) refuseAuthority('credential_digest');
    const request = deepFreeze({ method, input: payload, ownerId: binding.ownerId, namespaces: binding.namespaces,
      requestControl: control, credentialBindingId: binding.credentialBindingId,
      ...(binding.suppression ? { suppression: binding.suppression } : {}) });
    let grant, authorizeReturned = false;
    try {
      grant = host.authorize(request, credential);
      authorizeReturned = true;
      if (observePromise(grant) || !grant || typeof grant !== 'object' ||
          !isDeepStrictEqual(boundedData(grant), binding)) refuseAuthority('grant_mismatch');
    } catch { refuseAuthority(authorizeReturned ? 'grant_mismatch' : 'authorize_error'); }
    let finalState = 'unsampled';
    function sample(code) {
      try {
        const current = host.isCurrent(grant, request);
        if (!observePromise(current) && current === true) return;
      } catch { /* Unverifiable state refuses. */ }
      refuseAuthority('not_current', code);
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
      accessGenerations: accessDigest(binding),
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

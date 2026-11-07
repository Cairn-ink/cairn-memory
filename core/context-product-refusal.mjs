import { fail } from './validation.mjs';

// Diagnostic state never changes the thrown Error or supplies authority proof.
export const authorityRefusals = Object.freeze(['host_port','credential_missing','credential_digest','grant_mismatch','authorize_error','not_current','request_binding','worker_epoch','semantic_outstanding','method_gate','other']);
export const refusalCause = value => authorityRefusals.includes(value) ? value : 'other';
const refusals = new WeakMap();
export const authorityRefusal = error => {const cause = refusals.get(error); return cause === undefined ? undefined : refusalCause(cause);};
export function refuseAuthority(cause, code = 'authority_required') {
  try { fail(code); }
  catch (error) {
    if (code === 'authority_required') refusals.set(error, refusalCause(cause));
    throw error;
  }
}


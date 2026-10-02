import { types } from 'node:util';

// Private observation vocabulary. These values describe guard branches, never
// provider cause, cancellation authority or durable accounting acceptance.
export const MIXED_TRANSPORT_TERMINATIONS = Object.freeze([
  'response', 'http_failure', 'invalid_response', 'deadline', 'cancelled',
  'case_sealed', 'external_abort', 'transport_failure', 'body_failure',
  'usage_bound_exceeded', 'invalid_payload', 'other_failure',
]);
const allowed = new Set(MIXED_TRANSPORT_TERMINATIONS);

export function projectMixedTransportTermination(attempt) {
  if (attempt === null || typeof attempt !== 'object' || types.isProxy(attempt)) return null;
  // Read the own descriptor once; never evaluate a getter, coerce a value or
  // serialize caller data. Missing, legacy and malformed categories are unknown.
  const descriptor = Object.getOwnPropertyDescriptor(attempt, 'transportTermination');
  const value = descriptor && Object.hasOwn(descriptor, 'value') ? descriptor.value : null;
  return typeof value === 'string' && allowed.has(value) ? value : null;
}

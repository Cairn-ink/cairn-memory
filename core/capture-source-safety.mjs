import { MemoryStoreError } from './validation.mjs';

// Private provenance, never an error-code-wide change. In particular a model
// getter's owned storage_busy retains the legacy Episode failure semantics.
const sourceBusy = new WeakSet();
export function captureSourceBusy() {
  const error = new MemoryStoreError('storage_busy');
  sourceBusy.add(error);
  return error;
}
export const isCaptureSourceBusy = error => sourceBusy.has(error);

// Private durable phase in an existing opaque token, not a new claim state.
// Old/unmarked tokens always retain conservative dispatch uncertainty.
export const preDispatchToken = token => `source-check:${token}`;
export const postDispatchToken = token => token.slice('source-check:'.length);
export const isPreDispatchToken = token => typeof token === 'string' &&
  /^source-check:[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(token);

// Private mode for the existing evidence assertion; absent from public inputs.
export const captureDispatch = Symbol('capture dispatch');

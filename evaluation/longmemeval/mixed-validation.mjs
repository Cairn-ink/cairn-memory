import { createHash } from 'node:crypto';
import { types } from 'node:util';

export class MixedComparisonError extends Error {
  constructor(code) { super(code); this.name = 'MixedComparisonError'; this.code = code; }
}

export const fail = code => { throw new MixedComparisonError(code); };
export const isObject = value => value !== null && typeof value === 'object'
  && !Array.isArray(value);
export const exact = (value, keys, code) => {
  if (!isObject(value) || Object.keys(value).length !== keys.length
    || keys.some(key => !Object.hasOwn(value, key))) fail(code);
  return value;
};
export const dense = (value, minimum, maximum, code) => {
  if (!Array.isArray(value) || value.length < minimum || value.length > maximum
    || Object.keys(value).length !== value.length) fail(code);
  return value;
};
export const wellFormed = value => typeof value === 'string'
  && value.isWellFormed() && !value.includes('\0');
export const safeInteger = (value, minimum = 0) => Number.isSafeInteger(value)
  && value >= minimum && !Object.is(value, -0);
export const sha256 = value => createHash('sha256').update(value).digest('hex');
export const canonicalValue = value => Array.isArray(value) ? value.map(canonicalValue)
  : isObject(value) ? Object.fromEntries(Object.keys(value).sort()
    .map(key => [key, canonicalValue(value[key])])) : value;
export const canonical = value => JSON.stringify(canonicalValue(value));
export const hash = (domain, value) => sha256(JSON.stringify([domain, canonicalValue(value)]));
export const freeze = value => {
  if (value !== null && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.values(value).forEach(freeze);
    Object.freeze(value);
  }
  return value;
};

// Before any descriptor walk, charge the minimum nodes implied by own width.
// Proxies are rejected before reflection; the limits bound accepted JSON data,
// not whole-process memory or caller allocation before this boundary.
export function snapshotJson(root, { bytes, nodes, depth }, code) {
  const state = { bytes: 0, nodes: 0, active: new WeakSet() };
  const charge = text => {
    state.bytes += Buffer.byteLength(text, 'utf8');
    if (state.bytes > bytes) fail(code);
  };
  function visit(value, level) {
    if (++state.nodes > nodes || level > depth) fail(code);
    if (typeof value === 'string') {
      if (!wellFormed(value)) fail(code);
      charge(value);
      return value;
    }
    if (value === null || typeof value === 'boolean') return value;
    if (typeof value === 'number' && Number.isFinite(value) && !Object.is(value, -0)) return value;
    if (!value || typeof value !== 'object' || types.isProxy(value) || state.active.has(value)) fail(code);
    const array = Array.isArray(value);
    const prototype = Object.getPrototypeOf(value);
    if (array ? prototype !== Array.prototype
      : prototype !== Object.prototype && prototype !== null) fail(code);
    const keys = Reflect.ownKeys(value);
    let length = 0;
    if (array) {
      const descriptor = Object.getOwnPropertyDescriptor(value, 'length');
      if (!descriptor || !Object.hasOwn(descriptor, 'value')
        || !safeInteger(descriptor.value) || keys.length !== descriptor.value + 1) fail(code);
      length = descriptor.value;
    }
    if (2 * keys.length - (array ? 1 : 0) > nodes - state.nodes) fail(code);
    state.active.add(value);
    const result = array ? [] : Object.create(null);
    for (const key of keys) {
      if (typeof key !== 'string' || !wellFormed(key)) fail(code);
      state.nodes += 1;
      if (state.nodes > nodes) fail(code);
      charge(key);
      if (array && key === 'length') continue;
      if (array && (!/^(0|[1-9][0-9]*)$/u.test(key)
        || Number(key) >= length || String(Number(key)) !== key)) fail(code);
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      if (!descriptor || !Object.hasOwn(descriptor, 'value') || !descriptor.enumerable) fail(code);
      Object.defineProperty(result, key, { value: visit(descriptor.value, level + 1),
        configurable: true, enumerable: true, writable: true });
    }
    state.active.delete(value);
    if (array && result.length !== length) fail(code);
    return result;
  }
  try { return visit(root, 0); }
  catch (error) { if (error instanceof MixedComparisonError) throw error; fail(code); }
}

export const sourceSnapshot = value => snapshotJson(value,
  { bytes: 128 * 1024 * 1024, nodes: 2_000_000, depth: 20 }, 'invalid_source_cases');
export const reportSnapshot = value => snapshotJson(value,
  { bytes: 32 * 1024 * 1024, nodes: 500_000, depth: 24 }, 'invalid_mixed_report');

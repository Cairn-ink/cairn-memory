// Capture boundaries read accessor-backed fields once through a snapshot. The engine may reread them.
// Proxies, functions and symbol values are refused with the entry's invalid code. Some engine entries accept stable Proxies.
import { CoreError, isErrorCode } from '../errors.mjs';

/** Engine core/validation.mjs:12. @param {ConstructorParameters<typeof CoreError>[0]} code @returns {never} */
export function fail(code) {
  throw new CoreError(isErrorCode(code) ? code : 'invalid_input');
}

/** @template T @param {T} value @param {ConstructorParameters<typeof CoreError>[0]} code @returns {T} */
export function detach(value, code) {
  try { return structuredClone(value); }
  catch { fail(code); }
}

/** Engine core/validation.mjs:16. @param {unknown} value @param {readonly string[]} allowed */
export function object(value, allowed) {
  const [data, keys] = detach(/** @type {const} */ ([value, allowed]), 'invalid_input');
  try { return validateObject(data, keys); }
  catch { fail('invalid_input'); }
}

/** @internal Shape check for detached data. @param {unknown} value @param {readonly string[]} allowed */
export function validateObject(value, allowed) {
  if (!value || typeof value !== 'object' || Array.isArray(value) ||
      Object.keys(value).some(key => !allowed.includes(key))) fail('invalid_input');
  return /** @type {Record<string, unknown>} */ (value);
}

/** Engine core/validation.mjs:22. @param {unknown} value @param {number} min @param {number} max @returns {unknown[]} */
export function denseArray(value, min, max) {
  const [data, lower, upper] = detach(/** @type {const} */ ([value, min, max]), 'invalid_input');
  try { return validateDenseArray(data, lower, upper); }
  catch { fail('invalid_input'); }
}

/** @internal Shape check. @param {unknown} value @param {number} min @param {number} max @returns {unknown[]} */
export function validateDenseArray(value, min, max) {
  if (!Array.isArray(value) || value.length < min || value.length > max ||
      Object.keys(value).length !== value.length) fail('invalid_input');
  for (let index = 0; index < value.length; index++) {
    if (!Object.hasOwn(value, index)) fail('invalid_input');
  }
  return value;
}

/** @param {unknown} value @returns {value is string} */
export function isWellFormedText(value) {
  return typeof value === 'string' && /** @type {string & {isWellFormed(): boolean}} */ (value).isWellFormed();
}

/** Engine core/validation.mjs:31. @param {unknown} value */
export function identifier(value) {
  if (!isWellFormedText(value) || !value || value.length > 200 ||
      value.trim() !== value || /[\x00-\x1f\x7f]/.test(value)) fail('invalid_input');
  return value;
}

/** Engine core/validation.mjs:107. @param {unknown} value */
export function revision(value) {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 1) fail('invalid_input');
  return value;
}

/** Engine core/validation.mjs:75. @param {unknown} value @param {string} [now] */
export function receiptEventTime(value, now) {
  const [time, clock] = detach(/** @type {const} */ ([value, now]), 'invalid_input');
  try { return validateReceiptEventTime(time, clock); }
  catch { fail('invalid_input'); }
}

/** @internal Time check for detached data. @param {unknown} value @param {string} [now] */
export function validateReceiptEventTime(value, now) {
  if (value === undefined || value === null) return null;
  if (typeof value !== 'string' || !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(value) ||
      !Number.isFinite(Date.parse(value)) || new Date(value).toISOString() !== value ||
      now !== undefined && Date.parse(value) > Date.parse(now) + 300_000) fail('invalid_input');
  return value;
}

import { CoreError } from '../errors.mjs';

/** Engine core/validation.mjs:12. @param {ConstructorParameters<typeof CoreError>[0]} code @returns {never} */
export function fail(code) {
  throw new CoreError(code);
}

/** Engine core/validation.mjs:16. @param {unknown} value @param {readonly string[]} allowed */
export function object(value, allowed) {
  if (!value || typeof value !== 'object' || Array.isArray(value) ||
      Object.keys(value).some(key => !allowed.includes(key))) fail('invalid_input');
  return /** @type {Record<string, unknown>} */ (value);
}

/** Engine core/validation.mjs:22. @param {unknown} value @param {number} min @param {number} max @returns {unknown[]} */
export function denseArray(value, min, max) {
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
  if (value === undefined || value === null) return null;
  if (typeof value !== 'string' || !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(value) ||
      !Number.isFinite(Date.parse(value)) || new Date(value).toISOString() !== value ||
      now !== undefined && Date.parse(value) > Date.parse(now) + 300_000) fail('invalid_input');
  return value;
}

import { CoreError, isErrorCode } from "../../core/src/index.mjs";
import { toPostgresError } from "./errors.mjs";

/** @import { CaptureKey, CaptureMessage, Scope } from "../../core/src/ports/index.d.ts" */
/** @import { Tx } from "../../core/src/ports/unit-of-work.d.ts" */

/** @returns {never} */
function invalid() {
  throw new CoreError("invalid_input");
}

/** @template T @param {() => T} read */
export function readInput(read) {
  try {
    return read();
  } catch (error) {
    throw toPostgresError(error);
  }
}

/** @param {unknown} value @returns {value is string} */
export function pgText(value) {
  return typeof value === "string" && !/[\u0000\uD800-\uDFFF]/u.test(value);
}

/** @param {unknown} value */
export function identifier(value) {
  if (!pgText(value) || !value) invalid();
  return value;
}

/** @param {Tx} tx @param {Scope} scope @param {boolean} [captureKey] @returns {Scope} */
export function copyScope(tx, scope, captureKey = false) {
  const owner = scope?.owner;
  if (!captureKey || (typeof owner === "string" && owner)) {
    if (owner !== tx.owner) throw new CoreError("internal_error");
  }
  const namespace = captureKey ? scope?.namespace ?? null : scope.namespace;
  if (namespace !== null && !pgText(namespace)) invalid();
  return { owner: identifier(owner), namespace };
}

/** @param {Omit<CaptureKey, "payloadDigest">} selection @param {Scope} scope */
function copySelection(selection, scope) {
  const { client, sessionId, eventId } = selection;
  return { scope, client: identifier(client), sessionId: identifier(sessionId), eventId: identifier(eventId) };
}

/** @param {Tx} tx @param {Omit<CaptureKey, "payloadDigest">} selection */
export function readSelection(tx, selection) {
  return copySelection(selection, copyScope(tx, selection?.scope, true));
}

/** @param {Tx} tx @param {CaptureKey} key */
export function copyKey(tx, key) {
  const selection = copySelection(key, copyScope(tx, key?.scope, true));
  const { payloadDigest } = key;
  if (typeof payloadDigest !== "string" || !/^[0-9a-f]{64}$/u.test(payloadDigest)) invalid();
  return { ...selection, payloadDigest };
}

/** Snapshot dense indexed data without calling a caller's iterator or any slot accessor.
 * @template T @param {readonly T[]} values @returns {T[]}
 */
export function copyArray(values) {
  try {
    if (!Array.isArray(values)) invalid();
    const length = Object.getOwnPropertyDescriptor(values, "length")?.value;
    if (!Number.isSafeInteger(length) || length < 0 || length > 0xffff_ffff || length !== values.length) invalid();
    const keys = new Set(Reflect.ownKeys(values));
    keys.delete(Symbol.iterator);
    if (!keys.delete("length") || keys.size !== length) invalid();
    return Array.from({ length }, (_, index) => {
      const key = String(index);
      const slot = Object.getOwnPropertyDescriptor(values, key);
      if (!keys.has(key) || !slot || !Object.hasOwn(slot, "value") ||
          !(key in values) || !Object.is(slot.value, values[index])) invalid();
      return slot.value;
    });
  } catch {
    invalid();
  }
}

/** @param {readonly CaptureMessage[]} messages */
export function copyMessages(messages) {
  return copyArray(messages).map((message) => {
    if (!message) invalid();
    const { id, role, content, occurredAtMs } = message;
    if (typeof id !== "string" || id.length > 512 || (role !== "user" && role !== "assistant") ||
        typeof content !== "string" || (occurredAtMs !== null && !Number.isSafeInteger(occurredAtMs))) invalid();
    return { id, role, content, occurredAtMs };
  });
}

/** @param {readonly number[]} positions */
export function copyPositions(positions) {
  const copied = copyArray(positions);
  if (new Set(copied).size !== copied.length ||
      copied.some((position) => !Number.isSafeInteger(position) || position < 0)) invalid();
  return copied;
}

/** @param {{leaseMs: number}} options */
export function readLease(options) {
  if (!options || typeof options !== "object" || Array.isArray(options)) invalid();
  const { leaseMs } = options;
  if (!Number.isSafeInteger(leaseMs) || leaseMs <= 0) invalid();
  return leaseMs;
}

/** @param {number} now */
export function clockMs(now) {
  if (!Number.isSafeInteger(now) || now < 0) invalid();
  return BigInt(now);
}

/** @param {string} token */
export function readToken(token) {
  if (typeof token !== "string") invalid();
  // Opaque tokens use exact string equality. Noncanonical UUID spellings are stale.
  return /^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/u.test(token) ? token : null;
}

/** @param {{code: string, retryable: boolean}} failure */
export function readFailure(failure) {
  if (!failure) invalid();
  const { code, retryable } = failure;
  if (!isErrorCode(code) || typeof retryable !== "boolean") invalid();
  return { code, retryable };
}

/** @param {object} value */
export function jsonbSource(value) {
  const json = JSON.stringify(value);
  // A free-form message ID may contain NUL or an unpaired surrogate, which JSONB cannot decode.
  return /\\u(?:0000|d[89a-f][0-9a-f]{2})/iu.test(json) ? JSON.stringify(json) : json;
}

/** @param {number} time */
export function hostedTime(time) {
  if (Math.abs(time) > 8.64e15) return null;
  const iso = new Date(time).toISOString();
  return iso.length === 24 && !iso.startsWith("0000") ? iso : null;
}

import { CoreError } from "@cairn-ink/core";

/** @typedef {import("./index.d.mts").CaseContext} CaseContext */

/** @param {unknown} condition @param {string} message @returns {asserts condition} */
export function check(condition, message) {
  if (!condition) throw new Error(message);
}

/** @param {unknown} value @param {Set<object>} [ancestors] */
export function assertJsonSafe(value, ancestors = new Set()) {
  if (value === null || typeof value === "boolean" || typeof value === "string" || Number.isFinite(value)) return;
  const message = "dump() must return JSON-safe data";
  if (typeof value !== "object") {
    const type = typeof value === "number" ? "a non-finite number" : typeof value;
    throw new Error(`${message}. Received ${type}`);
  }

  const prototype = Object.getPrototypeOf(value);
  const array = Array.isArray(value);
  check(array ? prototype === Array.prototype : prototype === Object.prototype || prototype === null,
    `${message}. Received an unsupported object type (${prototype?.constructor?.name ?? "unknown"})`);
  check(!ancestors.has(value), `${message}. Found a cyclic value`);
  ancestors.add(value);
  const keys = Reflect.ownKeys(value);
  if (array) {
    check(keys.length === value.length + 1, `${message}. Arrays must be dense and contain only elements`);
    for (let i = 0; i < value.length; i++) {
      check(Object.hasOwn(value, i), `${message}. Found a missing array element`);
      assertJsonSafe(value[i], ancestors);
    }
  } else {
    for (const key of keys) {
      check(typeof key === "string" && Object.prototype.propertyIsEnumerable.call(value, key),
        `${message}. Plain objects must have enumerable string keys`);
      assertJsonSafe(/** @type {Record<string, unknown>} */ (value)[key], ancestors);
    }
  }
  ancestors.delete(value);
}

/** @param {CaseContext["harness"]} harness */
export async function readDump(harness) {
  const snapshot = await harness.dump();
  assertJsonSafe(snapshot);
  return snapshot;
}

/** @param {unknown} value @returns {value is ArrayBufferView & ArrayLike<number | bigint>} */
function isTypedArray(value) {
  return ArrayBuffer.isView(value) && "length" in value;
}

/** @param {unknown} value */
function assertComparable(value) {
  if (value === null || (typeof value !== "object" && typeof value !== "function")) return;
  const prototype = Object.getPrototypeOf(value);
  if (Array.isArray(value) || isTypedArray(value) ||
      (value instanceof Map && prototype === Map.prototype) || (value instanceof Set && prototype === Set.prototype) ||
      (typeof value === "object" && (prototype === Object.prototype || prototype === null))) return;
  throw new Error("unsupported value in comparison");
}

/** @param {Map<unknown, unknown> | Set<unknown>} actual @param {Map<unknown, unknown> | Set<unknown>} expected */
function sameUnordered(actual, expected) {
  if (actual.size !== expected.size) return false;
  const unmatched = [...expected];
  for (const value of actual) {
    const index = unmatched.findIndex((candidate) => same(value, candidate));
    if (index === -1) return false;
    unmatched.splice(index, 1);
  }
  return true;
}

/** @param {unknown} actual @param {unknown} expected @returns {boolean} */
function same(actual, expected) {
  assertComparable(actual);
  assertComparable(expected);
  if (Object.is(actual, expected)) return true;
  if (actual === null || expected === null || typeof actual !== "object" || typeof expected !== "object" ||
      Object.getPrototypeOf(actual) !== Object.getPrototypeOf(expected)) return false;
  if (isTypedArray(actual) || isTypedArray(expected)) {
    if (!isTypedArray(actual) || !isTypedArray(expected) || actual.constructor !== expected.constructor ||
        actual.length !== expected.length) return false;
    for (let i = 0; i < actual.length; i++) {
      if (!Object.is(actual[i], expected[i])) return false;
    }
    return true;
  }
  if (actual instanceof Map && expected instanceof Map) return sameUnordered(actual, expected);
  if (actual instanceof Set && expected instanceof Set) return sameUnordered(actual, expected);
  if (Array.isArray(actual) || Array.isArray(expected)) {
    if (!Array.isArray(actual) || !Array.isArray(expected) || actual.length !== expected.length) return false;
  }
  const left = Object.entries(actual);
  const right = /** @type {Record<string, unknown>} */ (expected);
  return left.length === Object.keys(right).length &&
    left.every(([key, value]) => Object.prototype.propertyIsEnumerable.call(right, key) && same(value, right[key]));
}

/** @param {unknown} actual @param {unknown} expected @param {string} message */
export function equal(actual, expected, message) {
  check(same(actual, expected), message);
}

/** @param {() => Promise<unknown>} action */
export async function caught(action) {
  try {
    await action();
  } catch (error) {
    return error;
  }
  throw new Error("Expected operation to reject");
}

/** @param {() => Promise<unknown>} action @param {import("@cairn-ink/core").ErrorCode} code */
export async function rejects(action, code) {
  const error = await caught(action);
  check(error instanceof CoreError && error.code === code, `Expected CoreError ${code}`);
}

/** @type {import("@cairn-ink/core/ports").SourceRef} */
export const source = { kind: "mcp", client: null, sessionId: null };

/**
 * @param {CaseContext} ctx @param {string} text @param {number | null} [distance]
 * @returns {Promise<import("@cairn-ink/core/ports").InsertRow>}
 */
export async function row(ctx, text, distance = null) {
  return {
    kind: "fact",
    origin: "explicit",
    text,
    textHash: await ctx.hash(text),
    confidence: 0.4,
    source,
    embedding: distance === null ? null : { model: "test", vector: ctx.vec(distance) },
  };
}

/** @template T */
export function gate() {
  /** @type {(value: T) => void} */
  let release = () => {};
  /** @type {Promise<T>} */
  const promise = new Promise((resolve) => { release = resolve; });
  return { promise, release };
}

/**
 * Attach a rejection observer immediately. The originating test still awaits the
 * original promise and sees its error if a concurrent run rejects early.
 * @template T @param {Promise<T>} promise
 */
export function observe(promise) {
  promise.catch(() => {});
  return promise;
}

/** @param {() => Promise<void>} work @param {string} [message] */
export async function bounded(work, message = "Concurrent runs exceeded 5 seconds") {
  /** @type {ReturnType<typeof setTimeout> | undefined} */
  let timeout;
  try {
    await Promise.race([work(), new Promise((_, reject) => {
      timeout = setTimeout(() => reject(new Error(message)), 5000);
    })]);
  } finally {
    clearTimeout(timeout);
  }
}

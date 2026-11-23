import { CoreError, NEAR_DUPLICATE_DISTANCE, SUPPRESSION_DISTANCE, VECTOR_ONLY_FLOOR } from "@cairn-ink/core";

export const DEFAULT_TIMEOUT_MS = 5000;
export const DEFAULT_EMBEDDING_DIMENSIONS = 4;

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

/** @param {import("@cairn-ink/core/ports").Receipt} receipt */
export const projectReceipt = ({ client, sessionId, messageId, role, occurredAtMs }) =>
  [client, sessionId, messageId, role, occurredAtMs];

/** @param {string} messageId @param {number | null} occurredAtMs @returns {import("@cairn-ink/core/ports").Receipt} */
export const evidence = (messageId, occurredAtMs) =>
  ({ client: "test-client", sessionId: "test-origin", messageId, role: "user", occurredAtMs });

export class FixtureEmbeddingUnavailable extends Error {}

/** @type {WeakMap<CaseContext, number>} */
const nextFixtureVector = new WeakMap();

/** @param {CaseContext} ctx */
export function fixtureEmbedding(ctx) {
  if (!ctx.adapter.capabilities.embeddingRequiredOnInsert) return null;

  const dimensions = ctx.embeddingDimensions ?? DEFAULT_EMBEDDING_DIMENSIONS;
  const index = nextFixtureVector.get(ctx) ?? 0;
  // Reference vectors use axes 0 and 1. The signed unit vectors on the remaining
  // axes are at cosine distance 1 or 2 from one another and 1 from the references.
  const axis = 2 + Math.floor(index / 2);
  if (!Number.isSafeInteger(dimensions) || axis >= dimensions) {
    throw new FixtureEmbeddingUnavailable(
      `embeddingRequiredOnInsert needs at least ${axis + 1} dimensions for separated fixture vectors`);
  }
  check(1 > Math.max(NEAR_DUPLICATE_DISTANCE, SUPPRESSION_DISTANCE, VECTOR_ONLY_FLOOR) + 1e-6,
    "Fixture vectors must be farther apart than the vector thresholds");
  const vector = Array(dimensions).fill(0);
  vector[axis] = index % 2 === 0 ? 1 : -1;
  nextFixtureVector.set(ctx, index + 1);
  // Vector retrieval filters by model even when it ranks candidates without a cutoff.
  return { model: "fixture-only", vector };
}

/**
 * @param {CaseContext} ctx @param {string} text @param {number | null} [distance]
 * @returns {Promise<import("@cairn-ink/core/ports").InsertRow>}
 */
export async function row(ctx, text, distance = null) {
  const embedding = distance === null ? fixtureEmbedding(ctx) : null;
  return {
    kind: "fact",
    origin: "explicit",
    text,
    textHash: await ctx.hash(text),
    confidence: 0.4,
    source,
    embedding: distance === null ? embedding : { model: "test", vector: ctx.vec(distance) },
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

/** @param {() => void} callback @param {number} ms */
function startTimer(callback, ms) {
  // Timer delays above the signed 32-bit limit can fire immediately.
  const maxDelayMs = 2_147_483_647;
  let remaining = ms;
  let timer = setTimeout(tick, Math.min(Math.ceil(remaining), maxDelayMs));
  function tick() {
    if (remaining <= maxDelayMs) {
      callback();
      return;
    }
    remaining -= maxDelayMs;
    timer = setTimeout(tick, Math.min(Math.ceil(remaining), maxDelayMs));
  }
  return () => clearTimeout(timer);
}

/** @param {number} ms */
export function wait(ms) {
  return new Promise((resolve) => { startTimer(() => resolve(undefined), ms); });
}

/** @param {() => Promise<void>} work @param {string} message @param {number} ms */
export async function bounded(work, message, ms) {
  /** @type {(() => void) | undefined} */
  let cancel;
  try {
    await Promise.race([work(), new Promise((_, reject) => {
      cancel = startTimer(() => reject(new Error(`${message} exceeded ${ms} ms`)), ms);
    })]);
  } finally {
    cancel?.();
  }
}

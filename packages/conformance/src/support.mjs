import { CoreError } from "@cairn-ink/core";

/** @typedef {import("./index.d.mts").CaseContext} CaseContext */

/** @param {unknown} condition @param {string} message @returns {asserts condition} */
export function check(condition, message) {
  if (!condition) throw new Error(message);
}

/** @param {unknown} actual @param {unknown} expected @returns {boolean} */
function same(actual, expected) {
  if (Object.is(actual, expected)) return true;
  if (!actual || !expected || typeof actual !== "object" || typeof expected !== "object" ||
      Array.isArray(actual) !== Array.isArray(expected)) return false;
  const left = Object.entries(actual);
  const right = /** @type {Record<string, unknown>} */ (expected);
  return left.length === Object.keys(right).length &&
    left.every(([key, value]) => Object.hasOwn(right, key) && same(value, right[key]));
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

/** @param {() => Promise<void>} work */
export async function bounded(work) {
  /** @type {ReturnType<typeof setTimeout> | undefined} */
  let timeout;
  try {
    await Promise.race([work(), new Promise((_, reject) => {
      timeout = setTimeout(() => reject(new Error("Concurrent runs exceeded 5 seconds")), 5000);
    })]);
  } finally {
    clearTimeout(timeout);
  }
}

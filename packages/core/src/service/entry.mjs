import { detach, identifier, isWellFormedText, validateObject } from "../capture/validate.mjs";
import { CoreError, isCoreError } from "../errors.mjs";

/** @param {unknown} error */
export function entryError(error) {
  try {
    if (isCoreError(error)) return error;
  } catch {
    // Inspecting the prototype of a thrown Proxy can itself throw.
  }
  return new CoreError("internal_error");
}

/**
 * @template {unknown[]} Args
 * @template Result
 * @template [Invalid=never]
 * @param {(...args: Args) => Promise<Result>} run
 * @param {() => Invalid} [invalid]
 */
export function entry(run, invalid) {
  /** @param {Args} args */
  return async (...args) => {
    try {
      /** @type {Args} */
      let input;
      try {
        input = detach(args, "invalid_input");
      } catch (error) {
        if (invalid) return invalid();
        throw error;
      }
      return await run(...input);
    } catch (error) {
      throw entryError(error);
    }
  };
}

/** @param {unknown} value @returns {import("../ports/common.d.ts").Scope} */
export function scopeOf(value) {
  const { owner, namespace } = validateObject(value, ["owner", "namespace"]);
  if (namespace !== null && !isWellFormedText(namespace)) throw new CoreError("invalid_input");
  // Engine namespaces contain a NUL separator, so only the owner is an identifier.
  return { owner: identifier(owner), namespace };
}

export { identifier as ownerOf };

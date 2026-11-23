import { detach, identifier, isWellFormedText, validateObject } from "../capture/validate.mjs";
import { CoreError, isErrorCode } from "../errors.mjs";

/** @param {unknown} error */
export function entryError(error) {
  try {
    if (error instanceof CoreError) {
      const code = error.code;
      if (isErrorCode(code)) return new CoreError(code);
    }
  } catch {
    // Prototype inspection and code access can themselves throw.
  }
  return new CoreError("internal_error");
}

/**
 * @template {unknown[]} Args
 * @template Result
 * @template [Invalid=never]
 * @param {(...args: Args) => Promise<Result>} run
 * @param {() => Invalid} [invalid]
 * @param {(args: Args) => Args} [snapshot]
 */
export function entry(run, invalid, snapshot = args => detach(args, "invalid_input")) {
  /** @param {Args} args */
  return async (...args) => {
    try {
      /** @type {Args} */
      let input;
      try {
        input = snapshot(args);
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

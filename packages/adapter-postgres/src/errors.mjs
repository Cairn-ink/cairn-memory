import { toCoreError } from "../../core/src/index.mjs";

const NATIVE_ERRORS = Object.freeze({
  "55P03": "lock_timeout",
  "57014": "statement_timeout",
  "40001": "storage_busy",
  "40P01": "storage_busy",
  "08000": "storage_error",
  "57P01": "storage_error",
  "57P02": "storage_error",
  "57P03": "storage_error",
});

/** @param {unknown} error */
export function toPostgresError(error) {
  if (error && typeof error === "object" && Object.hasOwn(error, "code")) {
    const { code } = /** @type {{ code: unknown }} */ (error);
    if (typeof code === "string" && /^08[0-9A-Z]{3}$/.test(code)) {
      return toCoreError({ code: "08000" }, NATIVE_ERRORS);
    }
  }
  return toCoreError(error, NATIVE_ERRORS);
}

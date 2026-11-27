import { CoreError, toCoreError } from "../../core/src/index.mjs";

/** @satisfies {Readonly<Record<string, import("@cairn-ink/core").ErrorCode>>} */
export const SQLITE_ERROR_MAP = Object.freeze({
  SQLITE_BUSY: "storage_busy",
  SQLITE_LOCKED: "storage_busy",
});

/** @param {unknown} error */
export function isNativeSqliteError(error) {
  try {
    const { code } = /** @type {{ code?: unknown }} */ (error ?? {});
    return typeof code === "string" && (code.startsWith("ERR_SQLITE_") || Object.hasOwn(SQLITE_ERROR_MAP, code));
  } catch {
    return false;
  }
}

/** @param {unknown} error */
export function toSqliteError(error) {
  try {
    if (error instanceof CoreError) return error;
    const { code, errcode } = /** @type {{ code?: unknown, errcode?: unknown }} */ (error ?? {});
    if (code === "ERR_SQLITE_ERROR" && typeof errcode === "number" && Number.isInteger(errcode) && errcode > 0) {
      // SQLite stores the primary result code in the low byte of extended codes.
      const primary = errcode & 0xff;
      if (primary === 5) return toCoreError({ code: "SQLITE_BUSY" }, SQLITE_ERROR_MAP);
      if (primary === 6) return toCoreError({ code: "SQLITE_LOCKED" }, SQLITE_ERROR_MAP);
    }
    return toCoreError(error, SQLITE_ERROR_MAP);
  } catch {
    return new CoreError("internal_error");
  }
}

/** Observe a dropped write promise while preserving its rejection for callers.
 * @template {PropertyKey} K
 * @template {Record<K, (...args: any[]) => Promise<unknown>>} P
 * @param {P} ports @param {readonly K[]} names
 */
export function handleWriteRejections(ports, names) {
  for (const name of names) {
    const write = ports[name];
    ports[name] = /** @type {P[K]} */ ((/** @type {any[]} */ ...args) => {
      const pending = write.apply(ports, args);
      void pending.catch(() => {});
      return pending;
    });
  }
  return ports;
}

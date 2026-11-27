import { CoreError } from "../errors.mjs";

export function pageLimit(limit = 10) {
  return Number.isNaN(limit) ? 10 : Math.min(50, Math.max(1, Math.trunc(limit)));
}

/** @param {unknown} value */
export function encodeCursor(value) {
  const json = JSON.stringify(value) ?? "";
  const binary = encodeURIComponent(json).replace(/%([\da-f]{2})/gi,
    (_, hex) => String.fromCharCode(Number.parseInt(hex, 16)));
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

/** @param {string} cursor @returns {unknown} */
export function decodeCursor(cursor) {
  try {
    const binary = atob(cursor.replace(/-/g, "+").replace(/_/g, "/"));
    const bytes = Uint8Array.from(binary, char => char.charCodeAt(0));
    return JSON.parse(new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(bytes));
  } catch {
    throw new CoreError("invalid_cursor");
  }
}

/** @param {string | null | undefined} [cursor] */
export function searchOffset(cursor) {
  if (cursor == null) return 0;
  const offset = decodeCursor(cursor);
  if (typeof offset !== "number" || !Number.isSafeInteger(offset) || offset < 0) {
    throw new CoreError("invalid_cursor");
  }
  return offset;
}

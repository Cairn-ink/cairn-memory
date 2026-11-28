import { CoreError } from "../errors.mjs";
import { compareUtf8 } from "../utf8.mjs";

export const RAW_FIND_DEPTH = 100;

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

/** @param {string} owner @param {string | null} cursor @param {number} limit */
export function readUnfiledCursor(owner, cursor, limit) {
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 50) throw new CoreError("invalid_input");
  if (cursor == null || cursor === "") return null;
  if (typeof cursor !== "string" || !/^[A-Za-z0-9_-]+$/u.test(cursor)) throw new CoreError("invalid_cursor");
  const value = decodeCursor(cursor);
  if (!Array.isArray(value) || value.length !== 6 || value[0] !== "unfiled" || value[1] !== owner ||
      !Number.isSafeInteger(value[2]) || value[2] < 0 ||
      typeof value[3] !== "string" || !/^[0-9a-f]{64}$/u.test(value[3]) ||
      typeof value[4] !== "string" || !/^(?:0|-?[1-9][0-9]{0,18})$/u.test(value[4]) ||
      typeof value[5] !== "string" || !value[5] || /[\u0000\uD800-\uDFFF]/u.test(value[5]) ||
      encodeCursor(value) !== cursor) throw new CoreError("invalid_cursor");
  return { revision: /** @type {number} */ (value[2]), digest: value[3], createdAtUs: BigInt(value[4]), id: value[5] };
}

/** @typedef {import("../ports/topics.d.ts").UnfiledTopicPage["items"][number]} UnfiledItem */

/** @param {UnfiledItem[]} rows */
export function unfiledDigestInput(rows) {
  return JSON.stringify([...rows].sort((a, b) => compareUtf8(a.id, b.id)).map(({ id, revision }) => [id, revision]));
}

/** @param {UnfiledItem} a @param {Pick<UnfiledItem, "id" | "createdAtUs">} b */
export function compareUnfiled(a, b) {
  if (a.createdAtUs !== b.createdAtUs) return a.createdAtUs > b.createdAtUs ? -1 : 1;
  return compareUtf8(b.id, a.id);
}

/** @param {string} owner @param {number} revision @param {string} digest @param {number} count
 * @param {UnfiledItem[]} rows @param {number} limit
 * @param {ReturnType<typeof readUnfiledCursor>} position */
export function unfiledPage(owner, revision, digest, count, rows, limit, position) {
  if (position && (position.revision !== revision || position.digest !== digest)) throw new CoreError("cursor_stale");
  const items = rows.slice(0, limit);
  const last = items.at(-1);
  return {
    count, items,
    nextCursor: last && rows.length > limit
      ? encodeCursor(["unfiled", owner, revision, digest, String(last.createdAtUs), last.id]) : null,
  };
}

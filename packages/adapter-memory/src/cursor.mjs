import { CoreError, compareSortKey, compareUtf8 } from "@cairn-ink/core";

const encoder = new TextEncoder();
const decoder = new TextDecoder("utf-8", { fatal: true });

/** @param {unknown[]} data */
export function encodePayload(data) {
  let binary = "";
  for (const byte of encoder.encode(JSON.stringify(data))) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/, "");
}

/** @param {string} cursor @returns {unknown[]} */
export function decodePayload(cursor) {
  try {
    if (typeof cursor !== "string" || !/^[A-Za-z0-9_-]+$/.test(cursor)) throw new CoreError("invalid_cursor");
    const binary = atob(cursor.replaceAll("-", "+").replaceAll("_", "/"));
    const parsed = JSON.parse(decoder.decode(Uint8Array.from(binary, (char) => char.charCodeAt(0))));
    if (!Array.isArray(parsed) || encodePayload(parsed) !== cursor) throw new CoreError("invalid_cursor");
    return parsed;
  } catch {
    throw new CoreError("invalid_cursor");
  }
}

/** @param {unknown} updatedAtUs @param {unknown} id */
export function decodeSortKey(updatedAtUs, id) {
  if (typeof updatedAtUs !== "string" || !/^(0|[1-9][0-9]*)$/.test(updatedAtUs) ||
    typeof id !== "string" || !id) throw new CoreError("invalid_cursor");
  return { updatedAtUs: BigInt(updatedAtUs), id };
}

/** @param {bigint} updatedAtUs @param {string} id */
export function encodeCursor(updatedAtUs, id) {
  return encodePayload([updatedAtUs.toString(), id]);
}

/** @param {string} cursor */
export function decodeCursor(cursor) {
  const parsed = decodePayload(cursor);
  if (parsed.length !== 2) throw new CoreError("invalid_cursor");
  return decodeSortKey(parsed[0], parsed[1]);
}

/** @typedef {{id: string, updatedAtUs: bigint}} SortKey */

/** @param {SortKey} a @param {SortKey} b */
export function newestFirst(a, b) {
  return compareSortKey(b.updatedAtUs, a.updatedAtUs) || compareUtf8(b.id, a.id);
}

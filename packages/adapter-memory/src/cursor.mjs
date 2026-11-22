import { CoreError } from "@cairn-ink/core";

const encoder = new TextEncoder();
const decoder = new TextDecoder("utf-8", { fatal: true });

/** @param {bigint} updatedAtUs @param {string} id */
export function encodeCursor(updatedAtUs, id) {
  let binary = "";
  for (const byte of encoder.encode(JSON.stringify([updatedAtUs.toString(), id]))) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/, "");
}

/** @param {string} cursor */
export function decodeCursor(cursor) {
  try {
    if (typeof cursor !== "string" || !/^[A-Za-z0-9_-]+$/.test(cursor)) throw new CoreError("invalid_cursor");
    const binary = atob(cursor.replaceAll("-", "+").replaceAll("_", "/"));
    const parsed = JSON.parse(decoder.decode(Uint8Array.from(binary, (char) => char.charCodeAt(0))));
    if (!Array.isArray(parsed) || parsed.length !== 2 ||
      typeof parsed[0] !== "string" || !/^(0|[1-9][0-9]*)$/.test(parsed[0]) ||
      typeof parsed[1] !== "string" || !parsed[1]) throw new CoreError("invalid_cursor");

    const updatedAtUs = BigInt(parsed[0]);
    const id = parsed[1];
    if (encodeCursor(updatedAtUs, id) !== cursor) throw new CoreError("invalid_cursor");
    return { updatedAtUs, id };
  } catch {
    throw new CoreError("invalid_cursor");
  }
}

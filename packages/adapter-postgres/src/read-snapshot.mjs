import { compareUtf8, CoreError } from "../../core/src/index.mjs";
import { copyReadScope, pgText } from "./memory-input.mjs";

/** @import { Query } from "./memory-rows.mjs" */
/** @typedef {ReturnType<typeof copyReadScope>} ReadSet */

const encoder = new TextEncoder();
const decoder = new TextDecoder("utf-8", { fatal: true });
/** @param {unknown[]} values */
export function encode(values) {
  const binary = Array.from(encoder.encode(JSON.stringify(values)), byte => String.fromCharCode(byte)).join("");
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/u, "");
}

/** @param {string} cursor @returns {unknown[]} */
export function decode(cursor) {
  try {
    if (typeof cursor !== "string" || !/^[A-Za-z0-9_-]+$/u.test(cursor)) throw new Error();
    const bytes = Uint8Array.from(atob(cursor.replaceAll("-", "+").replaceAll("_", "/")), char => char.charCodeAt(0));
    const values = JSON.parse(decoder.decode(bytes));
    if (!Array.isArray(values) || encode(values) !== cursor) throw new Error();
    return values;
  } catch {
    throw new CoreError("invalid_cursor");
  }
}

/** @param {ReadSet} scope @param {string} revision */
function scopeToken({ owner, keys, clients, since, until, hasWindow }, revision) {
  const namespaces = keys.map(key => key ?? "").sort(compareUtf8);
  return encode([owner, revision, namespaces, clients?.slice().sort(compareUtf8) ?? null, hasWindow ? [since, until] : null]);
}

/** @param {string} token @param {boolean} [allowNonNullNamespace] */
export function validateToken(token, allowNonNullNamespace = false) {
  const [owner, revision, keys, clients, bounds, ...extra] = decode(token);
  if (extra.length || !pgText(owner) || !owner || typeof revision !== "string" ||
      !/^(?:0|[1-9][0-9]{0,18})$/u.test(revision) || BigInt(revision) > 9223372036854775807n) {
    throw new CoreError("invalid_cursor");
  }
  try {
    if (!Array.isArray(keys) || keys.some(key => typeof key !== "string") ||
        (bounds !== null && (!Array.isArray(bounds) || bounds.length !== 2))) throw new Error();
    const selection = copyReadScope(owner, { namespaces: keys.map(key => key === "" ? null : JSON.parse(key)),
      clients: clients === null ? undefined : /** @type {string[]} */ (clients),
      window: bounds === null ? undefined : { sinceMs: bounds[0] ?? undefined, untilMs: bounds[1] ?? undefined } }, allowNonNullNamespace);
    if (scopeToken(selection, revision) !== token) throw new Error();
  } catch {
    throw new CoreError("invalid_cursor");
  }
}

/** @param {Query} query @param {ReadSet} scope */
export async function readStateToken(query, scope) {
  const { rows: [row] } = await query("SELECT index_revision::text FROM core_owner_state WHERE user_id = $1", [scope.owner]);
  return scopeToken(scope, row?.index_revision ?? "0");
}

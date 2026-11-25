import { CoreError, decodeCursor, encodeCursor, memoryGuards, placementProposal } from "@cairn-ink/core";
import { invalidInput } from "./storage-values.mjs";

/** @import { Scope, TopicStore } from "@cairn-ink/core/ports" */

export const placementBatchLimit = 5;

/** @param {number} limit @param {number} [maximum] */
export function validateLimit(limit, maximum = Number.MAX_SAFE_INTEGER) {
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > maximum) invalidInput();
}

/** Snapshot indexed data without invoking a caller's traversal methods.
 * @template T @param {readonly T[]} input @param {number} maximum @param {boolean} [strict]
 */
export function placementArray(input, maximum, strict = true) {
  if (!Array.isArray(input) || input.length > maximum) invalidInput();
  const length = input.length;
  const keys = new Set(Reflect.ownKeys(input));
  keys.delete("length");
  if (!strict) keys.delete(Symbol.iterator);
  if (keys.size !== length) invalidInput();
  return Array.from({ length }, (_, index) => {
    const key = String(index);
    const slot = Object.getOwnPropertyDescriptor(input, key);
    if (!keys.has(key) || !slot || !Object.hasOwn(slot, "value") || (strict && !slot.enumerable) ||
        !Object.is(slot.value, Reflect.get(input, key))) invalidInput();
    return /** @type {T} */ (slot.value);
  });
}

/** @template T @param {T} value @param {readonly string[]} allowed */
function fields(value, allowed) {
  if (!value || typeof value !== "object" || Array.isArray(value) ||
      Object.keys(value).some(key => !allowed.includes(key))) invalidInput();
  return value;
}

/** @param {Parameters<TopicStore["applyPlacement"]>[2]} basedOn
 * @param {Parameters<TopicStore["applyPlacement"]>[3]} proposal
 */
export function placementInput(basedOn, proposal) {
  const snapshot = placementArray(fields(proposal, ["items"]).items, placementBatchLimit).map(item => {
    const { memoryId, parentIds, newL1 } = fields(item, ["memoryId", "parentIds", "newL1"]);
    const parents = placementArray(parentIds, 3);
    if (newL1 === undefined) return { memoryId, parentIds: parents };
    const { title, parentL2Ids, newL2Title } = fields(newL1, ["title", "parentL2Ids", "newL2Title"]);
    return { memoryId, parentIds: parents, newL1: { title, parentL2Ids: placementArray(parentL2Ids, 3), newL2Title } };
  });
  const { items } = placementProposal({ items: snapshot }, undefined, placementBatchLimit);
  const indexRevision = basedOn?.indexRevision;
  if (!Number.isSafeInteger(indexRevision) || indexRevision < 0) invalidInput();
  const guards = memoryGuards(placementArray(basedOn.memoryRevisions, items.length), items.map(item => item.memoryId));
  return { items, guards, indexRevision };
}

/** @template T @param {T[]} rows @param {{cursor: string | null, limit: number}} query
 * @param {Scope} scope @param {string} method @param {string | null} filter @param {number} revision
 */
export function topicPage(rows, { cursor, limit }, { owner, namespace }, method, filter, revision) {
  validateLimit(limit);
  let offset = 0;
  if (cursor !== null) {
    if (typeof cursor !== "string") throw new CoreError("invalid_cursor");
    const payload = decodeCursor(cursor);
    if (!Array.isArray(payload) || encodeCursor(payload) !== cursor) throw new CoreError("invalid_cursor");
    const [kind, tokenOwner, tokenNamespace, tokenFilter, version, start] = payload;
    if (payload.length !== 6 || kind !== method || tokenOwner !== owner || tokenNamespace !== namespace ||
        !Number.isSafeInteger(version) || version < 0 || !Number.isSafeInteger(start) || start < 1) {
      throw new CoreError("invalid_cursor");
    }
    if (version !== revision) throw new CoreError("cursor_stale");
    offset = start;
  }
  const items = rows.slice(offset, offset + limit);
  const next = offset + items.length;
  const nextCursor = next < rows.length
    ? encodeCursor([method, owner, namespace, filter, revision, next]) : null;
  return { items, nextCursor };
}

import { detach, identifier, validateDenseArray, validateObject } from "../capture/validate.mjs";
import { CoreError } from "../errors.mjs";
import { assertContextVisible } from "./context-read-evidence.mjs";
import { entry, scopeOf } from "./entry.mjs";
import { encodeListAnchor, encodeReceiptAnchor, inspectTokens, listAnchor, receiptAnchor } from "./inspect-cursor.mjs";

/** @import { ClockAndHash, MemoryService } from "../ports/index.d.ts" */

const listFields = ["states", "limit", "cursor"];
const itemFields = ["memoryId", "includeQualification", "receiptLimit", "receiptCursor"];
const allStates = /** @type {const} */ (["active", "historical"]);

/** @param {unknown} value */
function limitOf(value = 20) {
  if (typeof value !== "number" || !Number.isInteger(value) || value < 1 || value > 50) throw new CoreError("invalid_input");
  return value;
}

/** @param {unknown} value */
function cursorOf(value) {
  if (value === undefined) return undefined;
  if (typeof value !== "string" || !value || value.length > 8192) throw new CoreError("invalid_cursor");
  return value;
}

/** @param {unknown} request */
function inspectInput(request) {
  const value = validateObject(request, [...listFields, ...itemFields]);
  if (Object.hasOwn(value, "memoryId")) {
    if (listFields.some(field => Object.hasOwn(value, field)) ||
        (Object.hasOwn(value, "includeQualification") && typeof value.includeQualification !== "boolean")) {
      throw new CoreError("invalid_input");
    }
    return {
      mode: /** @type {const} */ ("item"), memoryId: identifier(value.memoryId),
      limit: limitOf(value.receiptLimit), cursor: cursorOf(value.receiptCursor),
      includeQualification: value.includeQualification === true,
    };
  }
  if (itemFields.some(field => Object.hasOwn(value, field))) throw new CoreError("invalid_input");
  const requested = value.states === undefined ? allStates : validateDenseArray(value.states, 1, 2);
  if (requested.some(state => state !== "active" && state !== "historical") ||
      new Set(requested).size !== requested.length) throw new CoreError("invalid_input");
  return {
    mode: /** @type {const} */ ("list"),
    states: allStates.filter(state => requested.includes(state)),
    limit: limitOf(value.limit), cursor: cursorOf(value.cursor),
  };
}

/** Read the ranked revisions and their retained receipts in one current-visibility transaction.
 * @param {Pick<import("../ports/index.d.ts").ReadContractStorage, "uow" | "inspect" | "fence" | "memories">} storage
 * @param {import("../ports/index.d.ts").ContextReadSet} readSet
 * @param {readonly import("../ports/index.d.ts").ContextReadRef[]} refs
 * @param {{ includeQualification: boolean, includeIndexRevision: boolean }} options */
export function inspectRecallEvidence({ uow, inspect, fence, memories }, readSet, refs,
  { includeQualification, includeIndexRevision }) {
  if (!inspect) throw new CoreError("capability_unavailable");
  return uow.run(readSet.owner, { readOnly: true }, async tx => {
    const items = [];
    for (const { scope, id, revision } of refs) {
      const { item } = await inspect.item(tx, scope, id, { limit: 100, includeQualification });
      if (!item || item.memory.state !== "active") throw new CoreError("evidence_unavailable");
      if (item.memory.revision !== revision) throw new CoreError("revision_conflict");
      items.push(item);
    }
    const indexRevision = includeIndexRevision ? await memories.committedIndexRevision?.(tx) : undefined;
    await assertContextVisible(fence, tx, readSet, refs, "current", "evidence_unavailable");
    return { items, indexRevision };
  });
}

/**
 * @param {import("./index.d.mts").KeylessInspectServiceDeps["storage"]} storage @param {ClockAndHash} clock
 * @returns {NonNullable<MemoryService["inspect"]>}
 */
export function inspectMethod({ uow, inspect, capabilities }, clock) {
  return entry(async (rawScope, rawInput) => {
    const scope = scopeOf(rawScope);
    const input = inspectInput(rawInput);
    if (capabilities.inspect !== true || !inspect) throw new CoreError("capability_unavailable");
    return uow.run(scope.owner, { readOnly: true }, async tx => {
      const { limit, cursor } = input;
      const filter = input.mode === "list"
        ? { state: input.states.length === 1 ? input.states[0] : undefined }
        : { memoryId: input.memoryId };
      const signingContext = async () => {
        const tokens = inspectTokens(await inspect.identity(tx), clock);
        return { tokens, binding: await tokens.binding(scope, limit, filter) };
      };
      const signing = cursor === undefined ? null : await signingContext();
      const position = signing && cursor !== undefined ? await signing.tokens.decode(cursor, signing.binding) : null;
      /** @param {number} epoch @param {object} anchor */
      const next = async (epoch, anchor) => {
        const { tokens, binding } = signing ?? await signingContext();
        return tokens.encode(binding, epoch, anchor);
      };
      if (input.mode === "list") {
        const page = await inspect.list(tx, scope, {
          states: input.states, limit, ...(position && { after: listAnchor(position.anchor), expectedEpoch: position.epoch }),
        });
        if (position && page.epoch !== position.epoch) throw new CoreError("cursor_stale");
        const rows = page.rows.slice(0, limit);
        const last = rows.at(-1);
        const exhausted = page.rows.length <= limit;
        const nextCursor = !exhausted && last ? await next(page.epoch, encodeListAnchor(last)) : null;
        return { mode: "list", memories: rows.map(({ updatedAtUs: _sortKey, ...row }) => row), nextCursor, exhausted };
      }

      const { memoryId, includeQualification } = input;
      const page = await inspect.item(tx, scope, memoryId, {
        limit, includeQualification, ...(position && { after: receiptAnchor(position.anchor), expectedEpoch: position.epoch }),
      });
      if (position && page.epoch !== position.epoch) throw new CoreError("cursor_stale");
      if (!page.item) throw new CoreError("memory_not_found");
      const { qualification, ...evidence } = page.item;
      const nextReceiptCursor = page.nextAnchor ? await next(page.epoch, encodeReceiptAnchor(page.nextAnchor)) : null;
      return {
        mode: "item", ...evidence, ...(includeQualification && { qualification: qualification ?? null }),
        nextReceiptCursor, exhausted: nextReceiptCursor === null,
      };
    });
  }, undefined, ([scope, input]) => detach([scope, input], "invalid_input"));
}

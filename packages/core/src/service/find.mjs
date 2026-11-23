import { isWellFormedText, validateDenseArray, validateObject } from "../capture/validate.mjs";
import { CoreError } from "../errors.mjs";
import { prepareCoreText } from "../privacy/text.mjs";
import { entry, entryError, scopeOf } from "./entry.mjs";
import { recallSearch } from "./recall.mjs";
import { readSet } from "./reads.mjs";

/** @typedef {import("../ports/host.d.ts").MemoryService} MemoryService */
/** @typedef {import("../ports/retrieval.d.ts").RetrievalScope} RetrievalScope */
/** @typedef {import("../ports/host.d.ts").Layer} Layer */
/** @typedef {import("../ports/common.d.ts").MemoryRow} MemoryRow */

/** @param {unknown} value */
function timeBound(value) {
  if (value === undefined) return value;
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) {
    throw new CoreError("invalid_input");
  }
  return value;
}

/** @param {unknown} value */
function findOptions(value) {
  const { limit = 8, kinds = ["memory", "card"], clients, sinceMs, untilMs } =
    validateObject(value, ["limit", "kinds", "clients", "sinceMs", "untilMs"]);
  if (Object.getPrototypeOf(value) !== Object.prototype ||
      typeof limit !== "number" || !Number.isInteger(limit) || limit < 1 || limit > 20) {
    throw new CoreError("invalid_input");
  }

  const requested = validateDenseArray(kinds, 1, 3);
  if (!requested.every(kind => kind === "memory" || kind === "card" || kind === "raw") ||
      new Set(requested).size !== requested.length) throw new CoreError("invalid_input");

  /** @type {Pick<RetrievalScope, "clients" | "window">} */
  const filters = {};
  if (clients !== undefined) {
    const list = validateDenseArray(clients, 1, Number.MAX_SAFE_INTEGER);
    if (!list.every(isWellFormedText) || list.includes("")) throw new CoreError("invalid_input");
    filters.clients = [...new Set(list)];
  }

  const since = timeBound(sinceMs);
  const until = timeBound(untilMs);
  if (since !== undefined && until !== undefined && since >= until) throw new CoreError("invalid_input");
  if (since !== undefined || until !== undefined) {
    filters.window = { sinceMs: since, untilMs: until };
  }
  return { limit, requested, filters };
}

/** @param {boolean} [requested] @returns {Layer} */
function notSearched(requested) {
  return requested
    ? { status: "not_searched", count: 0, code: "capability_unavailable" }
    : { status: "not_searched", count: 0 };
}

/** @param {import("./index.d.mts").MemoryServiceDeps} deps @returns {MemoryService["find"]} */
export function findMethod(deps) {
  const search = recallSearch(deps);
  return entry(async (input, raw, options) => {
    const scope = scopeOf(input);
    if (raw !== null && typeof raw !== "string") throw new CoreError("invalid_input");
    const { limit, requested, filters } = findOptions(options);
    const query = prepareCoreText(raw ?? "");

    /** @type {MemoryRow[]} */
    let memories = [];
    let memory = notSearched();
    if (requested.includes("memory")) {
      try {
        ({ items: memories } = await search(scope, query, { cursor: null, limit, mode: "search" }, filters));
        memory = { status: "ok", count: memories.length };
      } catch (error) {
        memory = { status: "unavailable", count: 0, code: entryError(error).code };
      }
    }
    return {
      memories, cards: [], raw: [],
      layers: { memory, card: notSearched(requested.includes("card")), raw: notSearched(requested.includes("raw")) },
    };
  });
}

/** @param {import("../ports/index.d.ts").StorageAdapter} storage @returns {MemoryService["read"]} */
export function readMethod({ uow, hydrate, fence }) {
  return entry(async (input, target) => {
    const scope = scopeOf(input);
    const { type, id } = validateObject(target, ["type", "id"]);
    if ((type !== "memory" && type !== "card") || typeof id !== "string") throw new CoreError("invalid_input");
    if (type === "card" || !hydrate) throw new CoreError("capability_unavailable");

    const readScope = readSet(scope);
    /** @type {import("../ports/common.d.ts").ItemRef} */
    const ref = { type, id, namespace: scope.namespace };
    /** @param {import("../ports/common.d.ts").ItemRef} candidate */
    const isRequested = candidate => candidate.type === type && candidate.id === id &&
      candidate.namespace === scope.namespace;
    /** @param {import("../ports/retrieval.d.ts").HydratedItem} candidate */
    const matches = ({ ref, memory }) => isRequested(ref) && memory?.id === id &&
      memory.scope.owner === scope.owner && memory.scope.namespace === scope.namespace;

    const initial = await uow.run(scope.owner, { readOnly: true }, tx =>
      hydrate.hydrate(tx, readScope, [ref], "read"));
    return uow.run(scope.owner, { readOnly: true }, async tx => {
      const hydrated = await hydrate.hydrate(tx, readScope, [ref], "read");
      const visible = await fence.assertVisible(tx, readScope, [ref], "read");
      const result = hydrated.find(matches);
      if (!result?.memory || !visible.some(isRequested) || !initial.some(matches)) return { status: "not_found" };
      return {
        status: "found", item: result.memory, receipts: result.receipts ?? [], sourceDates: result.sourceDates ?? null,
      };
    });
  });
}

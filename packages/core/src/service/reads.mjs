import { isWellFormedText, validateObject } from "../capture/validate.mjs";
import { CoreError } from "../errors.mjs";
import { redactHostedCurrent } from "../privacy/redact.mjs";
import { canonicalKey } from "../retrieval/bm25.mjs";
import { decodeCursor, encodeCursor, pageLimit } from "../retrieval/hosted-paging.mjs";
import { packSessionStart } from "../retrieval/session-start.mjs";
import { entry, entryError, scopeOf } from "./entry.mjs";
import { hostedProjection } from "./session-wire.mjs";

/** @typedef {import("../ports/index.d.ts").StorageAdapter} StorageAdapter */
/** @typedef {import("../ports/common.d.ts").MemoryRow} MemoryRow */
/** @typedef {import("../ports/common.d.ts").ItemRef} ItemRef */
/** @typedef {import("../ports/common.d.ts").Scope} Scope */
/** @typedef {import("../ports/retrieval.d.ts").RetrievalScope} RetrievalScope */
/** @typedef {import("../ports/unit-of-work.d.ts").Tx} Tx */

/** @param {Scope} scope @param {Pick<RetrievalScope, "clients" | "window">} [filters] @returns {RetrievalScope} */
export function readSet({ owner, namespace }, filters) {
  return { owner, namespaces: [namespace], ...filters };
}

/** @param {MemoryRow} row @returns {ItemRef} */
function memoryRef({ id, scope: { namespace } }) {
  return { type: "memory", id, namespace };
}

/** @param {MemoryRow[]} rows @param {RetrievalScope} scope */
function scopedRows(rows, scope) {
  return rows.filter(row => row.scope.owner === scope.owner && scope.namespaces.includes(row.scope.namespace));
}

/** @param {MemoryRow[]} rows @param {RetrievalScope} scope @param {Tx} tx @param {StorageAdapter["fence"]} fence */
async function visibleRows(rows, scope, tx, fence) {
  const scoped = scopedRows(rows, scope);
  const visible = await fence.assertVisible(tx, scope, scoped.map(memoryRef));
  const keys = new Set(visible.map(canonicalKey));
  return scoped.filter(row => keys.has(canonicalKey(memoryRef(row))));
}

/** @param {StorageAdapter["hydrate"]} hydrate @param {Tx} tx @param {RetrievalScope} scope
 * @param {ItemRef[]} refs @param {"recall" | "export"} intent
 */
export async function hydrateMemoryRows(hydrate, tx, scope, refs, intent) {
  /** @type {Map<string, MemoryRow>} */
  const rows = new Map();
  if (refs.length) {
    for (const { ref, memory } of await hydrate.hydrate(tx, scope, refs, intent)) {
      if (ref.type === "memory" && scope.namespaces.includes(ref.namespace) && memory?.id === ref.id &&
          memory.scope.owner === scope.owner && memory.scope.namespace === ref.namespace) {
        rows.set(canonicalKey(ref), memory);
      }
    }
  }
  return rows;
}

/** @param {unknown} cursor @param {readonly unknown[]} binding @param {number} tailLength */
export function readCursor(cursor, binding, tailLength) {
  if (cursor == null) return null;
  if (typeof cursor !== "string") throw new CoreError("invalid_cursor");
  const value = decodeCursor(cursor);
  // Cursors are unsigned. Request scope and the visibility fence still restrict every page to the caller's visible rows.
  if (!Array.isArray(value)) {
    const isOffset = typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
    throw new CoreError(isOffset ? "cursor_stale" : "invalid_cursor");
  }
  if (value.length !== binding.length + tailLength || binding.some((part, index) => value[index] !== part)) {
    throw new CoreError("cursor_stale");
  }
  return value.slice(binding.length);
}

/** @param {StorageAdapter["snapshot"]} snapshot @param {Tx} tx @param {RetrievalScope} scope
 * @param {string | undefined} positionToken
 */
export async function readStateToken(snapshot, tx, scope, positionToken) {
  if (positionToken !== undefined) {
    await snapshot.assertUnchanged(tx, scope, positionToken);
    return positionToken;
  }
  const token = await snapshot.stateToken(tx, scope);
  if (typeof token !== "string" || !token) throw new CoreError("internal_error");
  return token;
}

/** @param {StorageAdapter} storage @param {"recent-v1" | "export-v1"} route
 * @param {Scope} scope @param {unknown} options @param {Pick<RetrievalScope, "clients" | "window">} [filters]
 */
async function storePage({ uow, recent, memories, snapshot, hydrate, fence }, route, scope, options, filters) {
  const readScope = readSet(scope, filters);
  const { cursor, limit } = validateObject(options === undefined ? {} : options, ["cursor", "limit"]);
  if (limit !== undefined && typeof limit !== "number") throw new CoreError("invalid_input");
  const binding = [route, scope.owner, scope.namespace];
  const position = readCursor(cursor, binding, 2);
  const [positionToken, inner] = position ?? [];
  if (position && (typeof positionToken !== "string" || !positionToken || typeof inner !== "string" || !inner)) {
    throw new CoreError("cursor_stale");
  }
  const { items, nextCursor, token } = await uow.run(scope.owner, { readOnly: true }, async tx => {
    const token = await readStateToken(snapshot, tx, readScope, positionToken);
    const page = { cursor: inner ?? null, limit: pageLimit(limit) };
    let result;
    try {
      result = route === "recent-v1"
        ? await recent.recent(tx, readScope, page)
        : await memories.exportPage(tx, scope, page);
    } catch (error) {
      const failure = entryError(error);
      if (position && failure.code === "invalid_cursor") throw new CoreError("cursor_stale");
      throw failure;
    }
    const items = route === "recent-v1" ? result.items : await visibleRows(result.items, readScope, tx, fence);
    // Use the store's last scanned position even if the fence drops a row.
    const nextCursor = result.nextCursor === null ? null : encodeCursor([...binding, token, result.nextCursor]);
    return { items, nextCursor, token };
  });
  return uow.run(scope.owner, { readOnly: true }, async tx => {
    if (route === "export-v1") await snapshot.assertUnchanged(tx, readScope, token);
    const candidates = scopedRows(items, readScope);
    const refs = candidates.map(memoryRef);
    const current = await hydrateMemoryRows(hydrate, tx, readScope, refs, route === "export-v1" ? "export" : "recall");
    const visible = new Set((await fence.assertVisible(tx, readScope, refs)).map(canonicalKey));
    const delivered = candidates.flatMap(row => {
      const key = canonicalKey(memoryRef(row));
      const memory = current.get(key);
      return memory && memory.revision === row.revision && visible.has(key) ? [memory] : [];
    });
    return { items: delivered, nextCursor };
  });
}

/** @param {StorageAdapter} storage @param {Scope} scope @param {unknown} options
 * @param {Pick<RetrievalScope, "clients" | "window">} [filters]
 */
export function recentPage(storage, scope, options, filters) {
  return storePage(storage, "recent-v1", scope, options, filters);
}

/** @param {unknown} value @param {number} max */
function budget(value, max) {
  if (typeof value !== "number" || !Number.isInteger(value) || value < 1 || value > max) {
    throw new CoreError("invalid_input");
  }
  return value;
}

/**
 * @param {StorageAdapter} storage
 * @param {import("../ports/model.d.ts").TokenCounter} tokens
 * @returns {Pick<import("../ports/host.d.ts").MemoryService, "recent" | "sessionStart" | "exportMemories">}
 */
export function readMethods(storage, tokens) {
  const { uow, recent, fence } = storage;
  /** @param {string} text */
  const countTokens = text => {
    try {
      const count = tokens.countTokens(text);
      if (!Number.isSafeInteger(count) || count < 0) throw new CoreError("internal_error");
      return count;
    } catch (error) {
      throw entryError(error);
    }
  };

  return {
    recent: entry(async (input, options) => recentPage(storage, scopeOf(input), options)),
    exportMemories: entry(async (input, options) => storePage(storage, "export-v1", scopeOf(input), options)),
    sessionStart: entry(async (input, options) => {
      const scope = scopeOf(input);
      const { maxTokens, maxChars, projectId } = validateObject(options, ["maxTokens", "maxChars", "projectId"]);
      if (projectId != null && (!isWellFormedText(projectId) || !projectId)) throw new CoreError("invalid_input");
      const packing = {
        maxTokens: budget(maxTokens, 2000), maxChars: budget(maxChars, 8000),
        projectId, project: hostedProjection(scope.owner, projectId),
      };
      const empty = packSessionStart([], packing, countTokens);
      if (projectId != null) return empty;

      const readScope = readSet(scope);
      const rows = await uow.run(scope.owner, { readOnly: true }, async tx => {
        /** @type {MemoryRow[]} */
        const rows = [];
        let background = 0;
        let procedural = 0;
        let cursor = null;
        do {
          const page = await recent.recent(tx, readScope, { cursor, limit: 50 });
          for (const row of await visibleRows(page.items, readScope, tx, fence)) {
            if (row.kind === "instruction" && procedural < 7) {
              rows.push(row);
              procedural++;
            }
            if ((row.kind === "fact" || row.kind === "context") && background < 7) {
              rows.push(row);
              background++;
            }
          }
          cursor = page.nextCursor;
        } while (cursor !== null && (background < 7 || procedural < 7));
        return rows;
      });

      if (!rows.length) return empty;
      const context = packSessionStart(rows.map(row => {
        const text = redactHostedCurrent(row.text);
        return text === row.text ? row : { ...row, text };
      }), packing, countTokens);
      const selected = [...context.groups.background.items, ...context.groups.procedural.items];
      if (!selected.length) return context;
      const visible = await uow.run(scope.owner, { readOnly: true }, tx => visibleRows(selected, readScope, tx, fence));
      return visible.length === selected.length ? context : packSessionStart(visible, packing, countTokens);
    }),
  };
}
